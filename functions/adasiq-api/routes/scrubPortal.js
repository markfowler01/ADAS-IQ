// 🧑‍🔧 ADAS IQ scrub portal (Mark 2026-11-04, phase 2). The login for shops
// that pay for CCC scrubs: calibration shops (billed for their body shops) and
// body shops buying direct. Its OWN auth, separate from the Absolute ADAS app
// and the Absolute ADAS customer portal, and ADAS IQ-branded.
//
//   POST /signup   company + login + accept the terms (version stored) → account
//                  'pending_card'; listed body shops become LINK REQUESTS that
//                  Mark approves (so nobody can claim someone else's shop and
//                  see its estimates). Closed until Mark opens signup.
//   POST /login    email + password → token (X-IQ-Token)
//   GET  /me       account, body shops, filters, this month's usage, card
//   PUT  /filters  🎚 the account's filters, or one of its body shops'
//   POST /link-request          ask to add a body shop
//   POST /card  + GET /card/confirm   card on file via Stripe Checkout (setup
//                  mode — the card never touches our servers). Uses ADAS IQ's
//                  OWN Stripe key (owner screen), never the Absolute ADAS one.
//
// Users live in DurableKV `scrub_portal_users` (password hashes never leave
// this file); accounts, links, contracts and requests in `scrub_billing_config`.
import express from 'express'
import crypto from 'node:crypto'
import catalyst from 'zcatalyst-sdk-node'
import { kvGet, kvSet } from '../services/durableKV.js'
import { readConfig, writeConfig, monthSummary } from './scrubBilling.js'
import { cleanFilters, describeFilters, signupSteps, DEFAULT_PRICE, DEFAULT_TRIAL } from '../services/scrubBilling.js'
import { TERMS, TERMS_VERSION, TERMS_DRAFT } from '../services/scrubTerms.js'

const USERS = 'scrub_portal_users'
const STRIPE_KEY = 'scrub_stripe_key'
const PORTAL_URL = process.env.IQ_PORTAL_URL || 'https://adas-iq-904191467.development.catalystserverless.com/app/?iq=portal'

// ── tokens + passwords ───────────────────────────────────────────────────────
const secret = () => `iq-portal|${process.env.SESSION_SECRET || process.env.ZOHO_CLIENT_SECRET || ''}`
function signToken(p, ms = 30 * 86400000) {
  const body = Buffer.from(JSON.stringify({ ...p, exp: Date.now() + ms })).toString('base64url')
  return `${body}.${crypto.createHmac('sha256', secret()).update(body).digest('base64url')}`
}
function verifyToken(t) {
  const [body, sig] = String(t || '').split('.')
  if (!body || !sig) return null
  const want = crypto.createHmac('sha256', secret()).update(body).digest('base64url')
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null
  try { const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return d.exp > Date.now() && d.type === 'iq' ? d : null } catch { return null }
}
const hashPass = (pw, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`
const passOk = (pw, stored) => {
  const [salt, h] = String(stored || '').split(':'); if (!salt || !h) return false
  const got = crypto.scryptSync(String(pw), salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(h))
}

async function readUsers(req) { try { const v = await kvGet(catalyst.initialize(req), USERS); return v ? JSON.parse(v) : [] } catch { return [] } }
const writeUsers = (req, u) => kvSet(catalyst.initialize(req), USERS, JSON.stringify(u))
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role })
const cleanEmail = e => String(e || '').trim().toLowerCase()

async function alertMark(text) {
  try { const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js'); await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, text) } catch (e) { console.warn('[iq portal] alert', e.message) }
}

// ── Stripe (ADAS IQ's own account) ───────────────────────────────────────────
export async function stripeFor(req) {
  try {
    const v = await kvGet(catalyst.initialize(req), STRIPE_KEY)
    if (!v) return null
    const { openSecret } = await import('./ccc.js')
    const key = openSecret(v)
    if (!key) return null
    const Stripe = (await import('stripe')).default
    return new Stripe(key, { apiVersion: '2024-12-18.acacia' })
  } catch (e) { console.warn('[iq portal] stripe', e.message); return null }
}
export async function saveStripeKey(req, key) {
  const { sealSecret } = await import('./ccc.js')
  await kvSet(catalyst.initialize(req), STRIPE_KEY, sealSecret(key))
}

export async function listUsers(req) { return (await readUsers(req)).map(u => ({ ...publicUser(u), account_id: u.account_id, active: u.active !== false, invited: !u.pass })) }

/** Owner invite: a user with no password yet + a 7-day set-password link. */
export async function makeInvite(req, account, name, email) {
  email = cleanEmail(email)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('A good email is needed')
  const users = await readUsers(req)
  let u = users.find(x => x.email === email)
  if (u && u.account_id !== account.id) throw new Error('That email already logs in to another account')
  if (!u) { u = { id: `u_${crypto.randomBytes(6).toString('hex')}`, account_id: account.id, name: String(name || '').trim().slice(0, 80), email, role: 'admin', pass: '', created_at: new Date().toISOString() }; users.push(u); await writeUsers(req, users) }
  const t = signToken({ type: 'iq_invite', uid: u.id }, 7 * 86400000)
  return { link: `${PORTAL_URL}&invite=${encodeURIComponent(t)}`, user: publicUser(u) }
}

const router = express.Router()
router.use(express.json())

// Invite link → set a password, accept the terms, signed in.
router.post('/accept-invite', async (req, res) => {
  const [body, sig] = String(req.body?.token || '').split('.')
  const want = body && crypto.createHmac('sha256', secret()).update(body).digest('base64url')
  let d = null
  try { d = want && sig && want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig)) ? JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) : null } catch { d = null }
  if (!d || d.type !== 'iq_invite' || d.exp < Date.now()) return res.status(401).json({ error: 'That invite link has expired. Ask for a new one.' })
  if (String(req.body?.password || '').length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters' })
  if (req.body?.accept_terms !== true || req.body?.terms_version !== TERMS_VERSION) return res.status(400).json({ error: 'Please read and accept the terms' })
  const users = await readUsers(req)
  const u = users.find(x => x.id === d.uid)
  if (!u) return res.status(404).json({ error: 'That invite was removed' })
  u.pass = hashPass(req.body.password); if (req.body?.name) u.name = String(req.body.name).trim().slice(0, 80)
  await writeUsers(req, users)
  const cfg = await readConfig(req)
  cfg.contracts = [...(cfg.contracts || []), { account_id: u.account_id, version: TERMS_VERSION, name: u.name, email: u.email, ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(), ua: String(req.headers['user-agent'] || '').slice(0, 200), at: new Date().toISOString() }]
  await writeConfig(req, cfg)
  res.json({ ok: true, token: signToken({ type: 'iq', uid: u.id }), user: publicUser(u) })
})

async function auth(req, res, next) {
  const t = verifyToken(req.headers['x-iq-token'])
  if (!t) return res.status(401).json({ error: 'Please sign in again' })
  const [users, cfg] = await Promise.all([readUsers(req), readConfig(req)])
  const user = users.find(u => u.id === t.uid && u.active !== false)
  const account = user && cfg.accounts.find(a => a.id === user.account_id)
  if (!user || !account) return res.status(401).json({ error: 'This login is turned off' })
  if (account.status === 'denied') return res.status(403).json({ error: 'This account wasn’t approved. Questions? Reply to our email.' })
  req.iq = { user, account, cfg }
  next()
}

// ── public ───────────────────────────────────────────────────────────────────
router.get('/terms', async (req, res) => {
  const cfg = await readConfig(req)
  res.json({ version: TERMS_VERSION, draft: TERMS_DRAFT, sections: TERMS, signup_open: !!cfg.signup_open, price: DEFAULT_PRICE, trial: DEFAULT_TRIAL })
})

router.post('/signup', async (req, res) => {
  const b = req.body || {}
  const cfg = await readConfig(req)
  if (!cfg.signup_open) return res.status(403).json({ error: 'Signup isn’t open yet. Ask us for an invite.' })
  const email = cleanEmail(b.email)
  if (!b.company || !b.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Company, your name and a good email are needed' })
  if (String(b.password || '').length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters' })
  if (!['cal_shop', 'body_shop'].includes(b.type)) return res.status(400).json({ error: 'Pick calibration shop or body shop' })
  if (b.accept_terms !== true || b.terms_version !== TERMS_VERSION) return res.status(400).json({ error: 'Please read and accept the terms' })
  const users = await readUsers(req)
  if (users.find(u => u.email === email)) return res.status(409).json({ error: 'That email already has a login. Sign in instead.' })

  const now = new Date().toISOString()
  const account = { id: `acct_${Date.now().toString(36)}`, name: String(b.company).trim().slice(0, 120), type: b.type, price: DEFAULT_PRICE, trial: DEFAULT_TRIAL, free: false, status: 'pending_review', email, phone: String(b.phone || '').slice(0, 30), created_at: now, source: 'signup' }
  const user = { id: `u_${crypto.randomBytes(6).toString('hex')}`, account_id: account.id, name: String(b.name).trim().slice(0, 80), email, role: 'admin', pass: hashPass(b.password), created_at: now }
  const shops = (b.type === 'body_shop' ? [account.name] : (Array.isArray(b.body_shops) ? b.body_shops : String(b.body_shops || '').split('\n')))
    .map(s => String(s).trim()).filter(Boolean).slice(0, 200)
  cfg.accounts.push(account)
  cfg.contracts = [...(cfg.contracts || []), { account_id: account.id, version: TERMS_VERSION, name: user.name, email, ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(), ua: String(req.headers['user-agent'] || '').slice(0, 200), at: now }]
  cfg.link_requests = [...(cfg.link_requests || []), ...shops.map(s => ({ id: `lr_${crypto.randomBytes(5).toString('hex')}`, account_id: account.id, shop_name: s.slice(0, 120), status: 'pending', at: now }))]
  await writeConfig(req, cfg)
  users.push(user); await writeUsers(req, users)
  await alertMark(`🆕 *ADAS IQ signup* · ${account.name} (${account.type === 'cal_shop' ? 'calibration shop' : 'body shop'})\n${user.name} · ${email}\n${shops.length} body shop${shops.length === 1 ? '' : 's'} listed\n👉 Approve or deny: More → Admin → 💳 Scrub Billing`)
  res.json({ ok: true, token: signToken({ type: 'iq', uid: user.id }), user: publicUser(user) })
})

router.post('/login', async (req, res) => {
  const email = cleanEmail(req.body?.email)
  const users = await readUsers(req)
  const u = users.find(x => x.email === email && x.active !== false)
  if (!u || !passOk(req.body?.password, u.pass)) return res.status(401).json({ error: 'That email and password don’t match' })
  const acct = (await readConfig(req)).accounts.find(a => a.id === u.account_id)
  if (acct?.status === 'denied') return res.status(403).json({ error: 'This account wasn’t approved. Questions? Reply to our email.' })
  res.json({ ok: true, token: signToken({ type: 'iq', uid: u.id }), user: publicUser(u) })
})

// ── signed in ────────────────────────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  const { user, account, cfg } = req.iq
  const month = new Date().toISOString().slice(0, 7)
  const sum = await monthSummary(req, month, { accountId: account.id })
  const links = cfg.links.filter(l => l.account_id === account.id).map(l => ({ shop_name: l.shop_name, ccc_shop_id: l.ccc_shop_id, price: l.price ?? null, free: !!l.free, filters: l.filters || {}, reads: describeFilters(l.filters || {}) }))
  const requests = (cfg.link_requests || []).filter(r => r.account_id === account.id && r.status !== 'approved').map(r => ({ id: r.id, shop_name: r.shop_name, status: r.status }))
  const contract = (cfg.contracts || []).filter(c => c.account_id === account.id).pop() || null
  let trialUsed = 0
  try { const r = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT su_key FROM ScrubUsage WHERE su_account_id = '${String(account.id).replace(/'/g, "''")}' AND su_reason = 'free trial' LIMIT 300`); trialUsed = (r || []).length } catch { /* fine */ }
  res.json({
    user: publicUser(user),
    account: { id: account.id, name: account.name, type: account.type, price: account.price, trial: account.trial, status: account.status, free: !!account.free, filters: account.filters || {}, reads: describeFilters(account.filters || {}), card: account.card ? { brand: account.card.brand, last4: account.card.last4, exp: account.card.exp } : null, free_left: Math.max(0, (account.trial || 0) - trialUsed) },
    links, requests, contract: contract && { version: contract.version, at: contract.at, name: contract.name },
    month, usage: sum.accounts[0] || { scrubs: 0, billable: 0, filtered: 0, total: 0, shops: [] }, recent: sum.recent,
    card_ready: !!(await stripeFor(req)),
    signup: signupSteps(account, { users: (await readUsers(req)).map(u => ({ account_id: u.account_id, invited: !u.pass })), links: cfg.links, contracts: cfg.contracts || [] }),
  })
})

// 🧾 This account's invoices, last 12 months.
router.get('/invoices', auth, async (req, res) => {
  const { readDoc } = await import('./scrubInvoices.js')
  const out = []
  const d = new Date()
  for (let k = 0; k < 12; k++) {
    const m = new Date(d.getFullYear(), d.getMonth() - k, 1)
    const doc = await readDoc(req, `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
    for (const i of doc.invoices.filter(x => x.account_id === req.iq.account.id && x.status !== 'void')) out.push({ number: i.number, month: i.month, total: i.total, vins: i.vins, lines: i.lines, status: i.status === 'paid_manual' ? 'paid' : i.status === 'charging' ? 'processing' : i.status, paid_at: i.paid_at || null, fail_reason: i.status === 'failed' ? i.fail_reason : '' })
  }
  res.json({ invoices: out })
})

// Card failed? After updating it, the shop can pay the open invoices now.
router.post('/invoices/pay-open', auth, async (req, res) => {
  const { readDoc, chargeInvoice } = await import('./scrubInvoices.js')
  const d = new Date(); const results = []
  for (let k = 0; k < 4; k++) {
    const m = new Date(d.getFullYear(), d.getMonth() - k, 1)
    const doc = await readDoc(req, `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
    for (const i of doc.invoices.filter(x => x.account_id === req.iq.account.id && x.status === 'failed')) { const r = await chargeInvoice(req, i.number, { by: `portal:${req.iq.user.email}` }); results.push({ number: i.number, ok: !!r.ok, why: r.inv?.fail_reason || r.error || '' }) }
  }
  res.json({ results })
})

router.put('/filters', auth, async (req, res) => {
  const { user, account, cfg } = req.iq
  if (user.role !== 'admin') return res.status(403).json({ error: 'Only the account admin can change filters' })
  const f = cleanFilters(req.body?.filters || {})
  const name = String(req.body?.shop_name || '').trim().toLowerCase()
  const target = name ? cfg.links.find(l => l.account_id === account.id && l.shop_name.toLowerCase() === name) : cfg.accounts.find(a => a.id === account.id)
  if (!target) return res.status(404).json({ error: 'That body shop isn’t on your account' })
  Object.assign(target, { filters: f, filters_by: user.email, filters_at: new Date().toISOString() })
  await writeConfig(req, cfg)
  res.json({ ok: true, filters: f, reads: describeFilters(f) })
})

router.post('/link-request', auth, async (req, res) => {
  const { user, account, cfg } = req.iq
  const shop = String(req.body?.shop_name || '').trim().slice(0, 120)
  if (!shop) return res.status(400).json({ error: 'Body shop name needed' })
  const dup = (cfg.link_requests || []).find(r => r.account_id === account.id && r.shop_name.toLowerCase() === shop.toLowerCase() && r.status === 'pending')
  if (dup) return res.json({ ok: true, request: dup })
  const r = { id: `lr_${crypto.randomBytes(5).toString('hex')}`, account_id: account.id, shop_name: shop, ccc_shop_id: String(req.body?.ccc_shop_id || '').slice(0, 40), status: 'pending', at: new Date().toISOString(), by: user.email }
  cfg.link_requests = [...(cfg.link_requests || []), r]
  await writeConfig(req, cfg)
  await alertMark(`🔗 *ADAS IQ body shop request* · ${account.name} wants to add *${shop}* → More → Admin → 💳 Scrub Billing`)
  res.json({ ok: true, request: r })
})

router.post('/card', auth, async (req, res) => {
  const { account, cfg } = req.iq
  const stripe = await stripeFor(req)
  if (!stripe) return res.status(503).json({ error: 'Card setup isn’t switched on yet. We’ll email you when it is.' })
  const a = cfg.accounts.find(x => x.id === account.id)
  if (!a.stripe_customer) {
    const c = await stripe.customers.create({ name: a.name, email: a.email, metadata: { iq_account: a.id } })
    a.stripe_customer = c.id; await writeConfig(req, cfg)
  }
  const s = await stripe.checkout.sessions.create({
    mode: 'setup', customer: a.stripe_customer, payment_method_types: ['card'],
    success_url: `${PORTAL_URL}&card=done&sid={CHECKOUT_SESSION_ID}`, cancel_url: `${PORTAL_URL}&card=cancel`,
    metadata: { iq_account: a.id },
  })
  res.json({ ok: true, url: s.url })
})

router.get('/card/confirm', auth, async (req, res) => {
  const { account, cfg } = req.iq
  const stripe = await stripeFor(req)
  if (!stripe) return res.status(503).json({ error: 'Card setup isn’t switched on yet' })
  const s = await stripe.checkout.sessions.retrieve(String(req.query.sid || ''), { expand: ['setup_intent.payment_method'] })
  if (s.metadata?.iq_account !== account.id || s.status !== 'complete') return res.status(400).json({ error: 'That card setup didn’t finish' })
  const pm = s.setup_intent?.payment_method
  const a = cfg.accounts.find(x => x.id === account.id)
  a.card = { brand: pm?.card?.brand || 'card', last4: pm?.card?.last4 || '', exp: pm?.card ? `${pm.card.exp_month}/${String(pm.card.exp_year).slice(-2)}` : '', pm: pm?.id || '', at: new Date().toISOString() }
  if (a.status === 'pending_card') a.status = 'active'
  await stripe.customers.update(a.stripe_customer, { invoice_settings: { default_payment_method: pm?.id } }).catch(() => {})
  await writeConfig(req, cfg)
  await alertMark(`💳 *ADAS IQ card on file* · ${a.name} · ${a.card.brand} …${a.card.last4}`)
  res.json({ ok: true, card: { brand: a.card.brand, last4: a.card.last4, exp: a.card.exp } })
})

export default router
