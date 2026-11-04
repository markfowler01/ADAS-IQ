// 💳 Scrub billing — storage + owner routes (Mark 2026-11-04). Rules live in
// services/scrubBilling.js.
//
//   Accounts + shop links → DurableKV `scrub_billing_config` (a few hundred rows of JSON).
//   Every CCC scrub       → one ScrubUsage row (su_key unique = CCC document + version,
//                           so a queue retry can never charge twice).
//
// Phase 1 only records. Nothing here sends an invoice or charges a card.
import catalyst from 'zcatalyst-sdk-node'
import express from 'express'
import { kvGet, kvSet } from '../services/durableKV.js'
import { resolveAccount, chargeFor, rollup, houseAccount, HOUSE_ID, DEFAULT_PRICE, DEFAULT_TRIAL, ACCOUNT_TYPES, ACCOUNT_STATUS, signupSteps, cleanFilters, mergeFilters, passesFilters, describeFilters } from '../services/scrubBilling.js'

const CFG = 'scrub_billing_config'
const TABLE = 'ScrubUsage'
const esc = s => String(s ?? '').replace(/'/g, "''")
const isOwner = req => ['mark@absoluteadas.com', 'mf@absoluteadas.com', 'mfowler4456@gmail.com'].includes(String(req.user?.email || '').toLowerCase())

export async function readConfig(req) {
  let c = null
  try { const v = await kvGet(catalyst.initialize(req), CFG); c = v ? JSON.parse(v) : null } catch { c = null }
  c = c || { accounts: [], links: [] }
  if (!c.accounts.find(a => a.id === HOUSE_ID)) c.accounts.unshift(houseAccount())
  return c
}
export const writeConfig = (req, c) => kvSet(catalyst.initialize(req), CFG, JSON.stringify(c))

const fromRow = r => ({ key: r.su_key, month: r.su_month, account_id: r.su_account_id, account_name: r.su_account_name, shop: r.su_shop, shop_id: r.su_shop_id, vin: r.su_vin, ro: r.su_ro, version: r.su_version, scrub_id: r.su_scrub_id, price: Number(r.su_price) || 0, billable: r.su_billable === true || r.su_billable === 'true', reason: r.su_reason, at: r.su_at, invoice_id: r.su_invoice_id || '' })

/**
 * Called by the CCC scrub worker after a scrub is saved. Never throws — a
 * billing hiccup must not stop a car from being scrubbed.
 * est = parseBms() output; ref = `${documentId}#${verCode}${version}`.
 */
/**
 * 🎚 Before any AI spend: does this estimate pass its account's + body shop's
 * filters? Never throws; a config hiccup means "scrub it" (a car is never lost).
 */
export async function checkCccFilters(req, est) {
  try {
    const cfg = await readConfig(req)
    const who = resolveAccount(est, cfg)
    // ⛔ Past due (card failed, day 7): hold new estimates (not scrubbed, not charged) until paid.
    if (who.account.status === 'past_due') return { ok: false, why: 'account past due, held until paid', account: who.account.name, filters: [] }
    const f = mergeFilters(who.account.filters, who.link?.filters)
    return { ...passesFilters(est, f), account: who.account.name, filters: describeFilters(f) }
  } catch (e) { console.warn('[scrub filters] skipped:', e.message); return { ok: true, why: '' } }
}

export async function recordCccUsage(req, est, { scrubId = '', ref = '', filtered = '' } = {}) {
  try {
    const key = `ccc:${ref || `${est.vin}|${est.ro}|${est.version}`}`.slice(0, 200)
    const zcql = catalyst.initialize(req, { type: 'advancedio' }).zcql()
    const dup = await zcql.executeZCQLQuery(`SELECT ROWID FROM ${TABLE} WHERE su_key = '${esc(key)}' LIMIT 1`)
    if (dup?.length) return { skipped: 'already recorded' }
    const cfg = await readConfig(req)
    const who = resolveAccount(est, cfg)
    let history = []
    if (who.account.id !== HOUSE_ID) {
      const rows = await zcql.executeZCQLQuery(`SELECT * FROM ${TABLE} WHERE su_account_id = '${esc(who.account.id)}' AND su_vin = '${esc(String(est.vin || '').toUpperCase())}' LIMIT 200`)
      const trial = await zcql.executeZCQLQuery(`SELECT su_key, su_account_id, su_reason FROM ${TABLE} WHERE su_account_id = '${esc(who.account.id)}' AND su_reason = 'free trial' LIMIT 200`)
      history = [...(rows || []), ...(trial || [])].map(x => fromRow(x[TABLE]))
    }
    if (who.account.id !== HOUSE_ID && !who.account.first_scrub_at) {
      try { const cf = await readConfig(req); const a = cf.accounts.find(x => x.id === who.account.id); if (a && !a.first_scrub_at) { a.first_scrub_at = new Date().toISOString(); await writeConfig(req, cf) } } catch { /* fine */ }
    }
    const c = filtered ? { price: 0, billable: false, reason: `filtered: ${filtered}` } : chargeFor(est, who, history)
    const at = new Date().toISOString()
    await catalyst.initialize(req, { type: 'advancedio' }).datastore().table(TABLE).insertRow({
      su_key: key, su_month: at.slice(0, 7), su_account_id: who.account.id, su_account_name: String(who.account.name || '').slice(0, 200),
      su_shop: String(est.shop || '').slice(0, 200), su_shop_id: String(est.shopId || '').slice(0, 64), su_vin: String(est.vin || '').toUpperCase().slice(0, 20),
      su_ro: String(est.ro || '').slice(0, 64), su_version: `${est.verCode || 'EM'}${est.version || ''}`.slice(0, 20), su_scrub_id: String(scrubId).slice(0, 64),
      su_price: c.price, su_billable: c.billable, su_reason: c.reason.slice(0, 255), su_at: at,
    })
    console.log(`[scrub billing] ${est.shop} → ${who.account.name} (${who.how}) · ${c.billable ? `$${c.price}` : 'no charge'} · ${c.reason}`)
    return { account: who.account.id, ...c }
  } catch (e) {
    console.warn('[scrub billing] not recorded:', e.message)
    return { error: e.message }
  }
}

export async function monthRows(req, month, accountId = '') {
  const zcql = catalyst.initialize(req, { type: 'advancedio' }).zcql()
  const out = []
  const and = accountId ? ` AND su_account_id = '${esc(accountId)}'` : ''
  for (let off = 0; off < 20000; off += 300) {   // ZCQL pages of 300
    const r = await zcql.executeZCQLQuery(`SELECT * FROM ${TABLE} WHERE su_month = '${esc(month)}'${and} LIMIT ${off}, 300`)
    out.push(...(r || []).map(x => fromRow(x[TABLE])))
    if (!r || r.length < 300) break
  }
  return out
}

export const scrubBillingRouter = express.Router()
scrubBillingRouter.use(express.json())
scrubBillingRouter.use((req, res, next) => isOwner(req) ? next() : res.status(403).json({ error: 'Mark only' }))

scrubBillingRouter.get('/config', async (req, res) => {
  const { listUsers } = await import('./scrubPortal.js')
  const { ping } = await import('../services/iqBooks.js')
  const pre = await readConfig(req)
  const which = pre.iq_books?.org === 'absolute' ? 'absolute' : 'iq'
  const [cfg, books, users] = await Promise.all([Promise.resolve(pre), ping(which), listUsers(req)])
  books.which = which
  for (const a of cfg.accounts) if (a.type !== 'house') a.signup = signupSteps(a, { users, links: cfg.links, contracts: cfg.contracts || [] })
  res.json({ ...cfg, users, statuses: ACCOUNT_STATUS, books, defaults: { price: DEFAULT_PRICE, trial: DEFAULT_TRIAL }, types: ACCOUNT_TYPES })
})

// Add or change an account. Body: { id?, name, type, price?, trial?, free?, status?, email? }
scrubBillingRouter.put('/account', async (req, res) => {
  const b = req.body || {}
  if (!b.name || !ACCOUNT_TYPES[b.type] || b.type === 'house') return res.status(400).json({ error: 'name + type (cal_shop | body_shop) needed' })
  const c = await readConfig(req)
  const id = b.id && b.id !== HOUSE_ID ? String(b.id) : `acct_${Date.now().toString(36)}`
  const cur = c.accounts.find(a => a.id === id) || { id, created_at: new Date().toISOString() }
  Object.assign(cur, { name: String(b.name).trim(), type: b.type, price: b.price == null ? DEFAULT_PRICE : Number(b.price), trial: b.trial == null ? DEFAULT_TRIAL : Number(b.trial), free: !!b.free, status: b.status === 'paused' ? 'paused' : ['pending_review', 'denied', 'past_due'].includes(cur.status) ? cur.status : 'active', email: String(b.email || cur.email || ''), updated_by: req.user?.email || '', updated_at: new Date().toISOString() })
  if (!c.accounts.includes(cur)) c.accounts.push(cur)
  await writeConfig(req, c)
  res.json({ ok: true, account: cur })
})

// Link a body shop to an account. Body: { ccc_shop_id?, shop_name, account_id, price?, free? }
scrubBillingRouter.put('/link', async (req, res) => {
  const b = req.body || {}
  const c = await readConfig(req)
  if (!b.shop_name || !c.accounts.find(a => a.id === b.account_id)) return res.status(400).json({ error: 'shop_name + a real account_id needed' })
  const sid = String(b.ccc_shop_id || '').trim()
  // One body shop bills to one account — a second account taking it is a move, and it's said out loud.
  const cur = c.links.find(l => (sid && l.ccc_shop_id === sid) || l.shop_name.toLowerCase() === String(b.shop_name).trim().toLowerCase())
  const moved = cur && cur.account_id !== b.account_id ? cur.account_id : null
  const link = cur || {}
  Object.assign(link, { ccc_shop_id: sid || link.ccc_shop_id || '', shop_name: String(b.shop_name).trim(), account_id: b.account_id, price: b.price == null || b.price === '' ? null : Number(b.price), free: !!b.free, updated_by: req.user?.email || '', updated_at: new Date().toISOString() })
  if (!cur) c.links.push(link)
  await writeConfig(req, c)
  res.json({ ok: true, link, moved_from: moved })
})

scrubBillingRouter.delete('/link', async (req, res) => {
  const c = await readConfig(req)
  const n = String(req.query.shop_name || '').toLowerCase()
  const before = c.links.length
  c.links = c.links.filter(l => l.shop_name.toLowerCase() !== n)
  await writeConfig(req, c)
  res.json({ ok: true, removed: before - c.links.length })
})

// The month at a glance: every account, its body shops, scrubs and dollars.
/** One month: totals, per-account roll-up, latest rows. accountId = just that account (the shop portal). */
export async function monthSummary(req, month, { accountId = '' } = {}) {
  const [cfg, rows] = await Promise.all([readConfig(req), monthRows(req, month, accountId)])
  const accounts = rollup(rows, cfg.accounts)
  // Body shops that fell to Absolute ADAS with no link — the list to link when a cal shop signs up.
  const unlinked = [...new Set(rows.filter(r => r.account_id === HOUSE_ID).map(r => r.shop).filter(Boolean))]
    .filter(s => !cfg.links.find(l => l.shop_name.toLowerCase() === s.toLowerCase()))
  const recent = rows.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 25)
  return { recent, month, scrubs: rows.length, billable: rows.filter(r => r.billable).length, filtered: rows.filter(r => String(r.reason || '').startsWith('filtered')).length, total: Math.round(rows.reduce((t, r) => t + (r.billable ? r.price : 0), 0) * 100) / 100, accounts, unlinked }
}
scrubBillingRouter.get('/summary', async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7)
  res.json(await monthSummary(req, month))
})

// 🎚 Set filters on an account (all its body shops) or on one body shop.
// Body: { account_id } or { shop_name }, plus filters: { min_year, max_year,
// makes_only, makes_skip, insurers_only, insurers_skip, locked_only, skip_supplements }.
// An empty filters object clears them. Phase 2's shop portal calls the same
// rules for a shop's own login.
scrubBillingRouter.put('/filters', async (req, res) => {
  const b = req.body || {}
  const c = await readConfig(req)
  const target = b.account_id ? c.accounts.find(a => a.id === b.account_id)
    : b.shop_name ? c.links.find(l => l.shop_name.toLowerCase() === String(b.shop_name).trim().toLowerCase()) : null
  if (!target) return res.status(404).json({ error: 'no such account or linked body shop' })
  const f = cleanFilters(b.filters || {})
  target.filters = f
  target.filters_by = req.user?.email || ''; target.filters_at = new Date().toISOString()
  await writeConfig(req, c)
  res.json({ ok: true, filters: f, reads: describeFilters(f) })
})

// Try an estimate against the filters without scrubbing anything.
// Body: { shop, shopId, year, make, insurer, status, verCode }
scrubBillingRouter.post('/filters/test', async (req, res) => res.json(await checkCccFilters(req, req.body || {})))

// ── Phase 2 owner controls ───────────────────────────────────────────────────
// Open / close public signup (closed until the terms are reviewed).
scrubBillingRouter.post('/signup-open', async (req, res) => {
  const c = await readConfig(req)
  c.signup_open = req.body?.open === true
  await writeConfig(req, c)
  res.json({ ok: true, signup_open: c.signup_open })
})

// Approve / deny a body-shop link request from the portal.
// Body: { action: 'approve'|'deny', ccc_shop_id?, move?: true }
scrubBillingRouter.post('/link-request/:id', async (req, res) => {
  const c = await readConfig(req)
  const r = (c.link_requests || []).find(x => x.id === req.params.id)
  if (!r) return res.status(404).json({ error: 'No such request' })
  if (req.body?.action === 'deny') { r.status = 'denied'; r.decided_by = req.user?.email || ''; await writeConfig(req, c); return res.json({ ok: true, request: r }) }
  const sid = String(req.body?.ccc_shop_id || r.ccc_shop_id || '').trim()
  const cur = c.links.find(l => (sid && l.ccc_shop_id === sid) || l.shop_name.toLowerCase() === r.shop_name.toLowerCase())
  if (cur && cur.account_id !== r.account_id && req.body?.move !== true) {
    const owner = c.accounts.find(a => a.id === cur.account_id)
    return res.status(409).json({ error: `${cur.shop_name} already bills to ${owner?.name || cur.account_id}. Approve again with “move” to switch it.`, current: owner?.name })
  }
  const link = cur || {}
  Object.assign(link, { shop_name: r.shop_name, ccc_shop_id: sid || link.ccc_shop_id || '', account_id: r.account_id, price: link.price ?? null, free: cur?.account_id === r.account_id ? !!link.free : false, updated_by: req.user?.email || '', updated_at: new Date().toISOString() })
  if (!cur) c.links.push(link)
  Object.assign(r, { status: 'approved', decided_by: req.user?.email || '', decided_at: new Date().toISOString() })
  await writeConfig(req, c)
  res.json({ ok: true, link })
})

// Invite someone to an account's portal login. Returns a set-password link for
// Mark to send himself (he proofreads every outbound message).
scrubBillingRouter.post('/invite', async (req, res) => {
  const c = await readConfig(req)
  const a = c.accounts.find(x => x.id === req.body?.account_id && x.type !== 'house')
  if (!a) return res.status(404).json({ error: 'Pick a paying account' })
  const { makeInvite } = await import('./scrubPortal.js')
  try { res.json({ ok: true, ...(await makeInvite(req, a, req.body?.name, req.body?.email)) }) } catch (e) { res.status(400).json({ error: e.message }) }
})

// ── 🧾 Phase 3: invoices ─────────────────────────────────────────────────────
const inv = () => import('./scrubInvoices.js')
scrubBillingRouter.get('/invoices', async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7)
  const { readDoc } = await inv(); const { reminderText } = await import('../services/scrubInvoice.js')
  const d = await readDoc(req, month)
  const cfg = await readConfig(req)
  res.json({ ...d, invoices: d.invoices.map(i => ({ ...i, reminder: i.past_due_at || i.status === 'failed' ? reminderText(i) : '' })), absolute_org: process.env.ZOHO_ORGANIZATION_ID || '' })
})
scrubBillingRouter.post('/invoices/close', async (req, res) => {
  const month = req.body?.month
  if (!/^\d{4}-\d{2}$/.test(month || '')) return res.status(400).json({ error: 'month YYYY-MM' })
  if (month >= new Date().toISOString().slice(0, 7)) return res.status(400).json({ error: 'Only a month that’s over can be invoiced' })
  const { closeMonth } = await inv()
  const r = await closeMonth(req, month, { by: req.user?.email || 'mark' })
  res.json({ made: r.made || 0, skipped: r.skipped || '', charged: r.charged || null })
})
scrubBillingRouter.post('/invoices/push', async (req, res) => { const { pushAll } = await inv(); res.json(await pushAll(req, req.body?.month)) })   // put any missing ones in Books
scrubBillingRouter.post('/invoices/:number/charge', async (req, res) => { const { chargeInvoice } = await inv(); const r = await chargeInvoice(req, req.params.number, { by: req.user?.email }); r.error ? res.status(400).json(r) : res.json(r) })
scrubBillingRouter.post('/invoices/:number/mark-paid', async (req, res) => { const { markPaid } = await inv(); const r = await markPaid(req, req.params.number, req.user?.email, { mode: req.body?.mode, reference: req.body?.reference }); r.error ? res.status(400).json(r) : res.json(r) })
scrubBillingRouter.post('/invoices/:number/void', async (req, res) => { const { voidInvoice } = await inv(); const r = await voidInvoice(req, req.params.number, req.user?.email); r.error ? res.status(400).json(r) : res.json(r) })
scrubBillingRouter.post('/billing-settings', async (req, res) => {
  const c = await readConfig(req)
  c.billing = { ...(c.billing || {}), auto_charge: req.body?.auto_charge === true, auto_charge_by: req.user?.email, auto_charge_at: new Date().toISOString() }
  await writeConfig(req, c)
  res.json({ ok: true, billing: c.billing })
})

// ── ✅ Approve / deny a shop (Mark 2026-11-04) ───────────────────────────────
// Body: { action: 'approve'|'deny', price?, trial?, approve_shops?: true }
// Approve → 'active' (shops pay from the Books invoice), its body-shop requests
// approved too unless another account already has that shop. Deny → logins
// off, requests denied. Either way a message DRAFT comes back for Mark to send.
scrubBillingRouter.post('/account/:id/review', async (req, res) => {
  const c = await readConfig(req)
  const a = c.accounts.find(x => x.id === req.params.id && x.type !== 'house')
  if (!a) return res.status(404).json({ error: 'No such account' })
  const now = new Date().toISOString(), by = req.user?.email || ''
  const { listUsers } = await import('./scrubPortal.js')
  const first = (await listUsers(req)).find(u => u.account_id === a.id)
  const hi = (first?.name || '').split(' ')[0] || 'there'
  const portal = `${process.env.IQ_PORTAL_URL || 'https://adas-iq-904191467.development.catalystserverless.com/app/?iq=portal'}`
  if (req.body?.action === 'deny') {
    Object.assign(a, { status: 'denied', reviewed_by: by, reviewed_at: now })
    for (const r of (c.link_requests || []).filter(r => r.account_id === a.id && r.status === 'pending')) Object.assign(r, { status: 'denied', decided_by: by, decided_at: now })
    await writeConfig(req, c)
    return res.json({ ok: true, account: a, message: `Hi ${hi},\n\nThanks for your interest in ADAS IQ. We're not able to open an account for ${a.name} right now. If something changes on our side we'll reach out.\n\nADAS IQ` })
  }
  if (req.body?.price != null && req.body.price !== '') a.price = Number(req.body.price)
  if (req.body?.trial != null && req.body.trial !== '') a.trial = Number(req.body.trial)
  Object.assign(a, { status: 'active', reviewed_by: by, reviewed_at: now })
  const linked = [], conflicts = []
  if (req.body?.approve_shops !== false) {
    for (const r of (c.link_requests || []).filter(r => r.account_id === a.id && r.status === 'pending')) {
      const cur = c.links.find(l => (r.ccc_shop_id && l.ccc_shop_id === r.ccc_shop_id) || l.shop_name.toLowerCase() === r.shop_name.toLowerCase())
      if (cur && cur.account_id !== a.id) { conflicts.push(r.shop_name); continue }
      if (!cur) c.links.push({ shop_name: r.shop_name, ccc_shop_id: r.ccc_shop_id || '', account_id: a.id, price: null, free: false, updated_by: by, updated_at: now })
      Object.assign(r, { status: 'approved', decided_by: by, decided_at: now }); linked.push(r.shop_name)
    }
  }
  await writeConfig(req, c)
  const message = `Hi ${hi},\n\nYou're approved for ADAS IQ. Welcome aboard.\n\nTo finish setting up:\n1. Sign in: ${portal}\n2. Add your billing email and address (your first ${a.trial ?? DEFAULT_TRIAL} scrubs are free; after that it's $${Number(a.price ?? DEFAULT_PRICE).toFixed(2)} per VIN, invoiced monthly).\n3. Have each body shop turn on the ADAS IQ app in CCC Secure Share.${linked.length ? `\n\nBody shops on your account: ${linked.join(', ')}.` : ''}\n\nReports show up in your portal as estimates come in.\n\nADAS IQ`
  res.json({ ok: true, account: a, linked, conflicts, message })
})

// Early-access requests from adas-iq.com → invite (approve) or dismiss (deny).
scrubBillingRouter.get('/applicants', async (req, res) => {
  const c = await readConfig(req)
  let rows = []
  try { rows = (await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery('SELECT ROWID, name, company, email, pain, submitted_at FROM AdasEarlyAccess ORDER BY CREATEDTIME DESC LIMIT 200')).map(r => r.AdasEarlyAccess) } catch (e) { console.warn('[applicants]', e.message) }
  const d = c.lead_decisions || {}
  res.json({ applicants: rows.map(r => ({ id: String(r.ROWID), name: r.name, company: r.company, email: r.email, pain: r.pain, at: r.submitted_at, decision: d[String(r.ROWID)] || null })) })
})
scrubBillingRouter.post('/applicants/:id', async (req, res) => {
  const c = await readConfig(req)
  const b = req.body || {}, now = new Date().toISOString(), by = req.user?.email || ''
  c.lead_decisions = c.lead_decisions || {}
  if (b.action === 'dismiss') { c.lead_decisions[req.params.id] = { action: 'dismissed', by, at: now }; await writeConfig(req, c); return res.json({ ok: true }) }
  if (!b.company || !b.email || !['cal_shop', 'body_shop'].includes(b.type)) return res.status(400).json({ error: 'company, email and type needed' })
  const a = { id: `acct_${Date.now().toString(36)}`, name: String(b.company).trim().slice(0, 120), type: b.type, price: b.price === '' || b.price == null ? DEFAULT_PRICE : Number(b.price), trial: b.trial === '' || b.trial == null ? DEFAULT_TRIAL : Number(b.trial), free: false, status: 'active', email: String(b.email).trim().toLowerCase(), created_at: now, source: 'early-access', reviewed_by: by, reviewed_at: now }
  c.accounts.push(a)
  c.lead_decisions[req.params.id] = { action: 'invited', account_id: a.id, by, at: now }
  await writeConfig(req, c)
  const { makeInvite } = await import('./scrubPortal.js')
  const inv = await makeInvite(req, a, b.name, b.email)
  const hi = String(b.name || '').split(' ')[0] || 'there'
  res.json({ ok: true, account: a, link: inv.link, message: `Hi ${hi},\n\nThanks for asking about ADAS IQ. You're in. Set up your login here (the link works for 7 days):\n${inv.link}\n\nYou'll accept the terms, add your billing details (first ${a.trial} scrubs free, then $${a.price.toFixed(2)} per VIN, invoiced monthly), and list the body shops you work with.\n\nADAS IQ` })
})

// 📒 Which Zoho Books the scrub invoices go into: 'absolute' (now) or 'iq' (ADAS IQ LLC, later).
scrubBillingRouter.post('/books-org', async (req, res) => {
  const which = req.body?.org === 'iq' ? 'iq' : 'absolute'
  const c = await readConfig(req)
  c.iq_books = { ...(c.iq_books || {}), org: which, org_by: req.user?.email, org_at: new Date().toISOString() }
  await writeConfig(req, c)
  res.json({ ok: true, org: which })
})

// 🔌 ADAS IQ engine key (made in the ADAS IQ owner console, pasted here by Mark).
scrubBillingRouter.get('/iq-engine', async (req, res) => { const { engineKeySet } = await import('./iqEngine.js'); res.json({ connected: await engineKeySet(req) }) })
scrubBillingRouter.post('/iq-engine', async (req, res) => {
  const k = String(req.body?.key || '').trim()
  if (!/^iqk_[a-f0-9]{48}$/.test(k)) return res.status(400).json({ error: 'Paste the key from the ADAS IQ owner console (starts with iqk_)' })
  const { saveEngineKey } = await import('./iqEngine.js'); await saveEngineKey(req, k)
  console.log(`[iq engine] key set by ${req.user?.email}`)   // never the value
  res.json({ ok: true, connected: true })
})
