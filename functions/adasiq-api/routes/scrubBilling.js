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
import { resolveAccount, chargeFor, rollup, houseAccount, HOUSE_ID, DEFAULT_PRICE, DEFAULT_TRIAL, ACCOUNT_TYPES, cleanFilters, mergeFilters, passesFilters, describeFilters } from '../services/scrubBilling.js'

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
const writeConfig = (req, c) => kvSet(catalyst.initialize(req), CFG, JSON.stringify(c))

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

async function monthRows(req, month) {
  const zcql = catalyst.initialize(req, { type: 'advancedio' }).zcql()
  const out = []
  for (let off = 0; off < 20000; off += 300) {   // ZCQL pages of 300
    const r = await zcql.executeZCQLQuery(`SELECT * FROM ${TABLE} WHERE su_month = '${esc(month)}' LIMIT ${off}, 300`)
    out.push(...(r || []).map(x => fromRow(x[TABLE])))
    if (!r || r.length < 300) break
  }
  return out
}

export const scrubBillingRouter = express.Router()
scrubBillingRouter.use(express.json())
scrubBillingRouter.use((req, res, next) => isOwner(req) ? next() : res.status(403).json({ error: 'Mark only' }))

scrubBillingRouter.get('/config', async (req, res) => {
  res.json({ ...(await readConfig(req)), defaults: { price: DEFAULT_PRICE, trial: DEFAULT_TRIAL }, types: ACCOUNT_TYPES })
})

// Add or change an account. Body: { id?, name, type, price?, trial?, free?, status?, email? }
scrubBillingRouter.put('/account', async (req, res) => {
  const b = req.body || {}
  if (!b.name || !ACCOUNT_TYPES[b.type] || b.type === 'house') return res.status(400).json({ error: 'name + type (cal_shop | body_shop) needed' })
  const c = await readConfig(req)
  const id = b.id && b.id !== HOUSE_ID ? String(b.id) : `acct_${Date.now().toString(36)}`
  const cur = c.accounts.find(a => a.id === id) || { id, created_at: new Date().toISOString() }
  Object.assign(cur, { name: String(b.name).trim(), type: b.type, price: b.price == null ? DEFAULT_PRICE : Number(b.price), trial: b.trial == null ? DEFAULT_TRIAL : Number(b.trial), free: !!b.free, status: b.status === 'paused' ? 'paused' : 'active', email: String(b.email || cur.email || ''), updated_by: req.user?.email || '', updated_at: new Date().toISOString() })
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
scrubBillingRouter.get('/summary', async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7)
  const [cfg, rows] = await Promise.all([readConfig(req), monthRows(req, month)])
  const accounts = rollup(rows, cfg.accounts)
  // Body shops that fell to Absolute ADAS with no link — the list to link when a cal shop signs up.
  const unlinked = [...new Set(rows.filter(r => r.account_id === HOUSE_ID).map(r => r.shop).filter(Boolean))]
    .filter(s => !cfg.links.find(l => l.shop_name.toLowerCase() === s.toLowerCase()))
  res.json({ month, scrubs: rows.length, billable: rows.filter(r => r.billable).length, total: Math.round(rows.reduce((t, r) => t + (r.billable ? r.price : 0), 0) * 100) / 100, accounts, unlinked })
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
