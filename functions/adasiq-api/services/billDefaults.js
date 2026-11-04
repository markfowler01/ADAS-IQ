// 💸 Bill it — the cost-invoice % and the cash switch (Mark 2026-11-02).
//
// "I want that 15% in there as a default, but I want it to be editable, and
// also I want to be able to switch the cash off from that menu."
// "Also State Farm cars default on State Farm or Allstate is 15%."
// "yes to the 15% overrides the 25% for the state farm and allstate and all
//  other special insurance pricing." (Mark 2026-11-03)
//
//   cash job            → starts at 15%, editable on the job
//   any insurer price list (SF/Allstate/AmFam/GEICO) → starts at 15%, editable,
//                         even over the shop's own % (a 25% shop still starts at 15)
//   everything else     → the shop's own % from the CRM (learned as before)
//
// The 15% belongs to the car, never the shop: changing it on one of these
// jobs does not touch the shop's saved discount.
import { CASH_DISCOUNT_PCT, CASH_MAX_OUT_OF_POCKET, cashCapFor, cashCapLine } from './cashPricing.js'

export const INSURER_DEFAULT_PCT = 15
// Every special insurer price list starts at the insurer default (Liberty Mutual etc. ride the AS pool).
export const INSURER_DEFAULT_POOLS = { SF: 'State Farm', AS: 'Allstate', AMFAM: 'American Family', GEICO: 'GEICO' }

export const clampPct = v => Math.max(0, Math.min(50, Math.round((Number(v) || 0) * 100) / 100))

/**
 * Where the starting % comes from. pool = resolvePricingPool(insurer) (null = standard).
 * Returns { pct, source: 'cash'|'insurer'|'shop'|'none', label }.
 */
export function defaultPct({ cash, pool, shopPct }) {
  if (cash) return { pct: CASH_DISCOUNT_PCT, source: 'cash', label: 'Cash job' }
  if (pool && INSURER_DEFAULT_POOLS[pool]) return { pct: INSURER_DEFAULT_PCT, source: 'insurer', label: INSURER_DEFAULT_POOLS[pool] }
  if (Number.isFinite(Number(shopPct)) && shopPct !== null && shopPct !== '') return { pct: Number(shopPct), source: 'shop', label: 'Shop %' }
  return { pct: null, source: 'none', label: '' }
}

const PREFIX = /^(SF|SFP|AS|CP|AMFAM|GEICO)\s*[-\s]\s*/i
const CAP = /cash cap/i
const key = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Swap every priced line to its twin on another price list — "CP - Front Radar"
 * ⇄ "Front Radar" (⇄ "SF - Front Radar"). toPool: 'CP' | null (standard) | 'SF' | 'AS' …
 * Going to cash adds the $700 cap line; leaving cash drops it. Parts, extras, $0
 * lines and anything with no twin stay as they are (listed in `missing`).
 */
export function repriceLines(lines, toPool, allItems, { capLimit = CASH_MAX_OUT_OF_POCKET } = {}) {
  const byName = new Map((allItems || []).map(it => [key(it.name), it]))
  const prefixes = !toPool ? [''] : toPool === 'SF' ? ['SF - ', 'SFP - '] : [`${toPool} - `]
  const out = [], missing = []
  let changed = 0
  for (const l of lines || []) {
    if (CAP.test(l.name || '')) { changed++; continue }   // re-added below when going to cash
    const rate = Number(l.rate) || 0
    if (rate <= 0 || l.is_part || l._extra) { out.push(l); continue }
    const base = String(l.name || '').replace(PREFIX, '').trim()
    const twin = prefixes.map(p => byName.get(key(p + base))).find(Boolean)
    if (!twin) { if (key(l.name) !== key(prefixes[0] + base)) missing.push(l.name); out.push(l); continue }
    if (key(twin.name) === key(l.name) && Number(twin.rate) === rate) { out.push(l); continue }
    changed++
    out.push({ ...l, line_item_id: null, item_id: twin.item_id || null, name: twin.name, rate: Number(twin.rate) || 0, product_type: twin.product_type || l.product_type || 'service', _repriced: true, _edited: true })
  }
  if (toPool === 'CP' && capLimit) {
    const cap = cashCapFor(out, capLimit)
    if (cap.capped) { const c = cashCapLine(cap, capLimit); out.push({ item_id: null, name: c.name, description: c.description, rate: c.rate, quantity: 1, product_type: 'service', is_part: false, never_discount: true, _edited: true }); changed++ }
  }
  const total = ls => Math.round(ls.reduce((s, l) => s + (Number(l.rate) || 0) * (Number(l.quantity) || 1), 0) * 100) / 100
  return { lines: out, changed, missing, from_total: total(lines || []), to_total: total(out) }
}
