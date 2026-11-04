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
    if (!out.has(a.id)) out.set(a.id, { account_id: a.id, name: a.name, type: a.type, scrubs: 0, billable: 0, filtered: 0, total: 0, shops: new Map() })
    const b = out.get(a.id)
    b.scrubs++
    if (String(r.reason || '').startsWith('filtered')) b.filtered++
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

// ── 🎚 Scrub filters (Mark 2026-11-04: "nothing older than 2013 model year",
// and every collision shop and ADAS cal shop sets up its own). An estimate
// that doesn't pass is NOT scrubbed (no AI spend) and NOT charged; it's still
// written to the ledger as "filtered" so nobody wonders where a car went.
//
// Filters live on the account (a cal shop's rules for all its body shops) and
// on each body-shop link (that one shop's own rules). Both apply — the
// stricter one wins.
export const FILTER_KEYS = ['min_year', 'max_year', 'makes_only', 'makes_skip', 'insurers_only', 'insurers_skip', 'locked_only', 'skip_supplements']

const list = v => (Array.isArray(v) ? v : String(v || '').split(','))
  .map(s => String(s).trim()).filter(Boolean)
const yr = v => { const n = parseInt(v, 10); return n >= 1980 && n <= 2100 ? n : null }

/** Clean whatever a screen sent into a filter object (unknown keys dropped). */
export function cleanFilters(f = {}) {
  const out = {}
  if (yr(f.min_year)) out.min_year = yr(f.min_year)
  if (yr(f.max_year)) out.max_year = yr(f.max_year)
  for (const k of ['makes_only', 'makes_skip', 'insurers_only', 'insurers_skip']) { const l = list(f[k]); if (l.length) out[k] = l }
  if (f.locked_only === true || f.locked_only === 'true') out.locked_only = true
  if (f.skip_supplements === true || f.skip_supplements === 'true') out.skip_supplements = true
  return out
}

/** Account rules + body-shop rules → one set. Stricter wins. */
export function mergeFilters(a = {}, b = {}) {
  a = cleanFilters(a); b = cleanFilters(b)
  const out = {}
  const nums = (k, pick) => { const v = [a[k], b[k]].filter(x => x != null); if (v.length) out[k] = pick(...v) }
  nums('min_year', Math.max); nums('max_year', Math.min)
  for (const k of ['makes_skip', 'insurers_skip']) { const u = [...new Set([...(a[k] || []), ...(b[k] || [])])]; if (u.length) out[k] = u }
  for (const k of ['makes_only', 'insurers_only']) {
    if (a[k] && b[k]) out[k] = a[k].filter(x => b[k].some(y => y.toLowerCase() === x.toLowerCase()))
    else if (a[k] || b[k]) out[k] = a[k] || b[k]
  }
  if (a.locked_only || b.locked_only) out.locked_only = true
  if (a.skip_supplements || b.skip_supplements) out.skip_supplements = true
  return out
}

const has = (l, v) => {
  const s = String(v || '').toLowerCase()
  return !!s && l.some(x => { const t = x.toLowerCase(); return s === t || s.includes(t) || t.includes(s) })
}

/** Does this estimate get scrubbed? → { ok, why } */
export function passesFilters(est, f = {}) {
  const y = yr(est?.year)
  if (f.min_year && y && y < f.min_year) return { ok: false, why: `${y} is older than ${f.min_year}` }
  if (f.max_year && y && y > f.max_year) return { ok: false, why: `${y} is newer than ${f.max_year}` }
  if (f.makes_only?.length && !has(f.makes_only, est?.make)) return { ok: false, why: `${est?.make || 'unknown make'} isn't on the makes list` }
  if (f.makes_skip?.length && has(f.makes_skip, est?.make)) return { ok: false, why: `${est?.make} is a skipped make` }
  if (f.insurers_only?.length && !has(f.insurers_only, est?.insurer)) return { ok: false, why: `${est?.insurer || 'no insurer'} isn't on the insurer list` }
  if (f.insurers_skip?.length && has(f.insurers_skip, est?.insurer)) return { ok: false, why: `${est?.insurer} is a skipped insurer` }
  if (f.locked_only && est?.status !== 'C') return { ok: false, why: 'not locked yet (locked estimates only)' }
  if (f.skip_supplements && est?.verCode === 'SV') return { ok: false, why: 'supplements are skipped' }
  return { ok: true, why: '' }
}

/** Plain-English list for the screen: ["2013 and newer", "skip Tesla"]. */
export function describeFilters(f = {}) {
  const out = []
  if (f.min_year && f.max_year) out.push(`${f.min_year}–${f.max_year} only`)
  else if (f.min_year) out.push(`${f.min_year} and newer`)
  else if (f.max_year) out.push(`${f.max_year} and older`)
  if (f.makes_only?.length) out.push(`only ${f.makes_only.join(', ')}`)
  if (f.makes_skip?.length) out.push(`skip ${f.makes_skip.join(', ')}`)
  if (f.insurers_only?.length) out.push(`only ${f.insurers_only.join(', ')} claims`)
  if (f.insurers_skip?.length) out.push(`skip ${f.insurers_skip.join(', ')} claims`)
  if (f.locked_only) out.push('locked estimates only')
  if (f.skip_supplements) out.push('no supplements')
  return out
}

// ── ✅ Getting a shop fully signed up (Mark 2026-11-04: "approve people and
// deny people, get them fully signed up"). Every account walks the same five
// steps; the owner screen and the shop portal show the same list.
export const ACCOUNT_STATUS = {
  pending_review: '🕓 Waiting for your OK', pending_card: '💳 Approved · needs a card', active: '✅ Active',
  past_due: '⛔ Past due', paused: '⏸ Paused', denied: '🚫 Denied',
}
export function signupSteps(account, { users = [], links = [], contracts = [] } = {}) {
  const id = account?.id
  const steps = [
    ['login', 'Login set up', users.some(u => u.account_id === id && !u.invited)],
    ['terms', 'Terms accepted', contracts.some(c => c.account_id === id)],
    ['approved', 'Approved by ADAS IQ', !['pending_review', 'denied'].includes(account?.status)],
    ['card', 'Card on file', !!account?.card || !!account?.free],
    ['shops', account?.type === 'cal_shop' ? 'Body shops linked' : 'Shop linked', links.some(l => l.account_id === id)],
    ['ccc', 'First CCC estimate received', !!account?.first_scrub_at],
  ].map(([key, label, done]) => ({ key, label, done }))
  return { steps, done: steps.filter(s => s.done).length, total: steps.length, complete: steps.every(s => s.done) }
}
