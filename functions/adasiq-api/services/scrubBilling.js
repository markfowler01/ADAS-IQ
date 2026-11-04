// 💳 Scrub billing (Mark 2026-11-04): the CCC scrubber is going to be sold to
// other shops at about $3 per VIN. Every CCC estimate that gets scrubbed is
// matched to a billing account and written to the ScrubUsage ledger; the
// monthly invoice is built from that ledger, never typed.
//
// Two levels, like Absolute ADAS itself:
//   • account = who gets the bill. A calibration shop (bills directly, its body
//     shops roll up under it), a body shop that buys direct, or the HOUSE
//     account (Absolute ADAS — never charged).
//   • shop link = one body shop (CCC shop ID + name) → the account it bills to.
//     A link can have its own price, or be switched to free.
//
// "Charges off" (Mark: "I need to be able to turn off the charges for my
// Absolute ADAS customers"): the house account never charges, any account or
// link can be switched to free, and a body shop with no link falls to the
// house account — so nothing is ever charged to anyone until Mark links a shop
// to a paying account.
//
// This file is pure (no Catalyst) so the rules can be tested; storage lives in
// routes/scrubBilling.js.

export const DEFAULT_PRICE = 3
export const DEFAULT_TRIAL = 25            // free scrubs for a new paying account
export const SUPPLEMENT_FREE_DAYS = 30     // supplements on the same VIN + RO are free this long
export const HOUSE_ID = 'house'

export const ACCOUNT_TYPES = { house: '🏠 Absolute ADAS', cal_shop: '🔧 Calibration shop', body_shop: '🚗 Body shop (direct)' }

export const normName = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(inc|llc|co|corp|the)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()

export function houseAccount() {
  return { id: HOUSE_ID, name: 'Absolute ADAS', type: 'house', free: true, price: 0, trial: 0, status: 'active' }
}

/** Which account an estimate bills to. CCC shop ID first, then the shop name. */
export function resolveAccount(est, { accounts = [], links = [] } = {}) {
  const byId = id => accounts.find(a => a.id === id)
  const house = byId(HOUSE_ID) || houseAccount()
  const sid = String(est?.shopId || '').trim()
  const nm = normName(est?.shop)
  const link = (sid && links.find(l => l.ccc_shop_id && String(l.ccc_shop_id).trim() === sid))
    || (nm && links.find(l => normName(l.shop_name) === nm))
    || null
  const account = (link && byId(link.account_id)) || house
  return { account, link, how: link ? (sid && link.ccc_shop_id === sid ? 'ccc id' : 'name') : 'no link → Absolute ADAS' }
}

const dayMs = 86400000
const keyOf = r => `${String(r.vin || '').toUpperCase()}|${String(r.ro || '').trim().toUpperCase()}`

/**
 * What this scrub costs. history = earlier ScrubUsage rows for the same
 * account (at least those with the same VIN). Returns { price, billable, reason }.
 */
export function chargeFor(est, { account, link } = {}, history = [], now = Date.now()) {
  const free = reason => ({ price: 0, billable: false, reason })
  if (!account || account.type === 'house') return free('Absolute ADAS — no charge')
  if (account.free) return free(`${account.name} — charges off`)
  if (link?.free) return free(`${link.shop_name || 'this body shop'} — charges off`)
  if (account.status === 'paused') return free('account paused — not charged')
  const k = keyOf(est)
  if (est?.vin && k !== '|') {
    const prior = history.filter(r => r.account_id === account.id && keyOf(r) === k && r.billable)
    const within = prior.find(r => now - new Date(r.at).getTime() < SUPPLEMENT_FREE_DAYS * dayMs)
    if (within) return free(`same VIN + RO charged ${new Date(within.at).toISOString().slice(0, 10)} — supplement free`)
  }
  const trial = account.trial ?? DEFAULT_TRIAL
  const used = history.filter(r => r.account_id === account.id && r.reason === 'free trial').length
  if (used < trial) return { price: 0, billable: false, reason: 'free trial' }
  const price = Number(link?.price ?? account.price ?? DEFAULT_PRICE)
  return { price, billable: price > 0, reason: link?.price != null ? `${link.shop_name} price` : 'per VIN' }
}

/** Monthly roll-up: one block per account, body shops listed under it. */
export function rollup(rows, accounts = []) {
  const out = new Map()
  for (const r of rows) {
    const a = accounts.find(x => x.id === r.account_id) || { id: r.account_id, name: r.account_name || r.account_id, type: 'unknown' }
    if (!out.has(a.id)) out.set(a.id, { account_id: a.id, name: a.name, type: a.type, scrubs: 0, billable: 0, total: 0, shops: new Map() })
    const b = out.get(a.id)
    b.scrubs++
    if (r.billable) { b.billable++; b.total += Number(r.price) || 0 }
    const s = r.shop || 'Unknown shop'
    if (!b.shops.has(s)) b.shops.set(s, { shop: s, scrubs: 0, billable: 0, total: 0 })
    const sh = b.shops.get(s); sh.scrubs++
    if (r.billable) { sh.billable++; sh.total += Number(r.price) || 0 }
  }
  return [...out.values()]
    .map(b => ({ ...b, total: Math.round(b.total * 100) / 100, shops: [...b.shops.values()].map(s => ({ ...s, total: Math.round(s.total * 100) / 100 })).sort((x, y) => y.scrubs - x.scrubs) }))
    .sort((x, y) => y.total - x.total || y.scrubs - x.scrubs)
}
