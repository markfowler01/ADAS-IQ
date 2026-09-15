// Estimator calculation engine (2026-09-14, Mark's build spec §3).
//
// Pure, dependency-free, shared by the browser (live totals) and the server
// (authoritative numbers on save). Every amount is INTEGER CENTS. Percentages
// are stored as basis points (2500 = 25.00%) so the whole money path stays
// integer. Nothing in here reads or writes calibration pricing — a
// calibration line arrives with its price already set (flat_cents) from
// the Books catalog and is treated like any other line.
//
// Tree:  estimate { jobs: [ job { lines: [ line { parts: [ part ] } ] } ] }
//
// Order of operations (spec §3, do not reorder):
//   1 part_total  2 line labor/parts  3 job totals  4 approved-only subtotals
//   5 discount  6 shop supplies (labor only, capped)  7 taxable base
//   8 tax  9 grand total.  Declined / recommended / deferred are display only.

export const RATE_KEYS = ['calibration', 'diagnostic', 'programming', 'r_and_i', 'mechanical']
export const RATE_LABELS = { calibration: 'Calibration', diagnostic: 'Diagnostic', programming: 'Programming', r_and_i: 'R&I', mechanical: 'Mechanical' }
// Placeholders for the mechanical/diagnostic paths only (spec §0). Calibration
// lines are priced by the Books item, never by this rate.
export const DEFAULT_RATES = { calibration: 20000, diagnostic: 17500, programming: 20000, r_and_i: 15000, mechanical: 15000 }
export const JOB_STATUSES = ['recommended', 'approved', 'declined', 'deferred']
export const JOB_CATEGORIES = ['calibration', 'diagnostic', 'mechanical', 'programming', 'sublet']
export const PART_SOURCES = ['oem', 'aftermarket', 'recycled', 'reconditioned', 'sublet']
export const AUTH_METHODS = ['oral', 'written', 'email', 'text', 'portal']
export const DEFAULT_SETTINGS = {
  rates: { ...DEFAULT_RATES },
  labor_rate_cents: 20000,       // Mark 2026-09-14: default labor $200/hr (one box at the top of the estimate)
  parts_markup_bp: 4000,         // Mark 2026-09-14: default parts markup 40% on cost (shown as a percent)
  supplies_pct_bp: 700,          // 7.00%
  supplies_cap_cents: 5000,      // $50
  supplies_taxable: true,        // WA taxes shop supplies with the repair
  detail_level: 'rolled_up',
  tax_by_zip: {},                // zip -> { rate_bp, tax_id, city }
  category_items: {},            // job category -> Books item_id
  resale_exemption_id: '',
  warranty_months: 12,           // Mark 2026-09-15: work guaranteed 12 months / 12,000 miles
  warranty_miles: 12000,
}

const int = v => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0 }
// Round half away from zero on an already-scaled integer product.
const rnd = v => Math.sign(v) * Math.round(Math.abs(v))
const bp = (cents, basisPoints) => rnd(cents * int(basisPoints) / 10000)

export function effectiveRate(line, rates = DEFAULT_RATES, estimateRate = null) {
  if (line.rate_override_cents != null && line.rate_override_cents !== '') return int(line.rate_override_cents)
  if (estimateRate != null && estimateRate !== '' && int(estimateRate) > 0) return int(estimateRate)
  return int((rates || DEFAULT_RATES)[line.rate_key] ?? DEFAULT_RATES[line.rate_key] ?? 0)
}
/** Part markup: the part's own markup if set, else the estimate's box, else the settings default. */
export function effectiveMarkupBp(part, defaultMarkupBp = null) {
  if (part.markup_bp != null && part.markup_bp !== '') return int(part.markup_bp)
  if (defaultMarkupBp != null && defaultMarkupBp !== '') return int(defaultMarkupBp)
  return DEFAULT_SETTINGS.parts_markup_bp
}

/** 1. part price = override or cost × (1 + markup); part total = qty × price. */
export function partPrice(part, defaultMarkupBp = null) {
  if (part.price_cents != null && part.price_cents !== '') return int(part.price_cents)
  return rnd(int(part.cost_cents) * (10000 + effectiveMarkupBp(part, defaultMarkupBp)) / 10000)
}
export function partTotal(part, defaultMarkupBp = null) {
  const qty = Number(part.qty)
  return rnd((Number.isFinite(qty) && qty > 0 ? qty : 1) * partPrice(part, defaultMarkupBp))
}

/** 2. line labor = flat price if set, else hours × rate (hours to one place). */
// ctx = { rates, labor_rate_cents, parts_markup_bp } (estimate-level boxes win over the per-type table)
const ctxOf = c => (c && typeof c === 'object' && !Array.isArray(c) && ('rates' in c || 'labor_rate_cents' in c || 'parts_markup_bp' in c)) ? c : { rates: c }
export function lineLabor(line, ctx) {
  const c = ctxOf(ctx)
  if (line.flat_cents != null && line.flat_cents !== '') return int(line.flat_cents)
  const hours = Math.round((Number(line.hours) || 0) * 10) / 10
  return rnd(hours * effectiveRate(line, c.rates, c.labor_rate_cents))
}
export function lineParts(line, ctx) { const c = ctxOf(ctx); return (line.parts || []).reduce((s, p) => s + partTotal(p, c.parts_markup_bp), 0) }

export function computeLine(line, ctx) {
  const c = ctxOf(ctx)
  const labor = lineLabor(line, c)
  const parts = (line.parts || []).map(p => ({ ...p, total_cents: partTotal(p, c.parts_markup_bp), price_each_cents: partPrice(p, c.parts_markup_bp), markup_bp_effective: effectiveMarkupBp(p, c.parts_markup_bp) }))
  const partsCents = parts.reduce((s, p) => s + p.total_cents, 0)
  const taxableLabor = line.taxable === false ? 0 : labor
  const taxableParts = parts.reduce((s, p) => s + (p.taxable === false ? 0 : p.total_cents), 0)
  return { ...line, parts, labor_cents: labor, parts_cents: partsCents, total_cents: labor + partsCents, taxable_cents: taxableLabor + taxableParts }
}

/** 3. job totals. */
export function computeJob(job, ctx) {
  const lines = (job.lines || []).map(l => computeLine(l, ctx))
  const labor = lines.reduce((s, l) => s + l.labor_cents, 0)
  const parts = lines.reduce((s, l) => s + l.parts_cents, 0)
  const taxable = lines.reduce((s, l) => s + l.taxable_cents, 0)
  return { ...job, lines, labor_cents: labor, parts_cents: parts, total_cents: labor + parts, taxable_cents: taxable }
}

/**
 * 4–9. Whole estimate. `est` carries the pricing switches:
 *   tax_enabled, tax_rate_bp, supplies_enabled, supplies_pct_bp, supplies_cap_cents,
 *   supplies_taxable, discount_type ('none'|'pct'|'flat'), discount_value (bp or cents)
 */
export function computeEstimate(est, settings = DEFAULT_SETTINGS) {
  const rates = { ...DEFAULT_RATES, ...(settings?.rates || {}) }
  // null boxes mean "no estimate-level rate" → per-type table / settings default (the server fills the boxes at creation)
  const ctx = { rates, labor_rate_cents: est.labor_rate_cents ?? null, parts_markup_bp: est.parts_markup_bp ?? settings?.parts_markup_bp ?? null }
  const jobs = (est.jobs || []).map(j => computeJob(j, ctx))
  const approved = jobs.filter(j => j.status === 'approved')

  const labor_subtotal = approved.reduce((s, j) => s + j.labor_cents, 0)
  const parts_subtotal = approved.reduce((s, j) => s + j.parts_cents, 0)
  const subtotal = labor_subtotal + parts_subtotal

  // 5. discount (estimate level only)
  let discount = 0
  if (est.discount_type === 'pct') discount = bp(subtotal, est.discount_value)
  else if (est.discount_type === 'flat') discount = Math.min(int(est.discount_value), subtotal)
  discount = Math.max(0, discount)
  const after_discount = subtotal - discount

  // 6. shop supplies — approved LABOR only, hard cap
  const supPct = est.supplies_pct_bp ?? settings?.supplies_pct_bp ?? DEFAULT_SETTINGS.supplies_pct_bp
  const supCap = est.supplies_cap_cents ?? settings?.supplies_cap_cents ?? DEFAULT_SETTINGS.supplies_cap_cents
  const supplies = est.supplies_enabled ? Math.min(bp(labor_subtotal, supPct), int(supCap)) : 0
  const supplies_capped = est.supplies_enabled && bp(labor_subtotal, supPct) > int(supCap)

  // 7. taxable base — approved taxable amounts + supplies (if taxable) − proportional discount share
  const taxable_approved = approved.reduce((s, j) => s + j.taxable_cents, 0)
  const supplies_taxable = est.supplies_taxable ?? settings?.supplies_taxable ?? true
  const discount_share = subtotal > 0 ? rnd(discount * taxable_approved / subtotal) : 0
  const taxable_base = Math.max(0, taxable_approved + (supplies_taxable ? supplies : 0) - discount_share)

  // 8. tax
  const tax = est.tax_enabled ? bp(taxable_base, est.tax_rate_bp) : 0

  // 9. grand total
  const grand_total = after_discount + supplies + tax
  const pre_tax_total = after_discount + supplies

  // Display-only buckets
  const bucket = st => jobs.filter(j => j.status === st).reduce((s, j) => s + j.total_cents, 0)
  const declined_total = bucket('declined')
  const recommended_total = bucket('recommended')
  const deferred_total = bucket('deferred')

  // 110% guardrail (RCW 46.71): approved pre-tax total vs authorized amounts
  const authorized_total = approved.reduce((s, j) => s + int(j.authorized_amount_cents), 0)
  const over_110 = authorized_total > 0 && pre_tax_total > rnd(authorized_total * 1.1)
  const unauthorized_approved = approved.filter(j => !int(j.authorized_amount_cents)).length

  return {
    jobs,
    totals: {
      labor_subtotal, parts_subtotal, subtotal, discount, after_discount,
      supplies, supplies_capped, taxable_base, tax, tax_rate_bp: est.tax_enabled ? int(est.tax_rate_bp) : 0,
      pre_tax_total, grand_total,
      declined_total, recommended_total, deferred_total,
      authorized_total, over_110, unauthorized_approved,
      approved_jobs: approved.length, job_count: jobs.length,
    },
  }
}

/** RCW 46.71.025 header fields required before an estimate can be marked sent. */
export function readyToSend(est) {
  const missing = []
  const has = v => String(v ?? '').trim() !== ''
  if (!has(est.customer_name)) missing.push('customer name')
  const c = est.customer_contact || {}
  if (!has(c.phone) && !has(c.email)) missing.push('customer phone or email')
  if (!has(c.address) && !has(est.service_address)) missing.push('customer or service address')
  if (!has(est.year)) missing.push('vehicle year')
  if (!has(est.make)) missing.push('vehicle make')
  if (!has(est.model)) missing.push('vehicle model')
  if (!has(est.plate) && String(est.vin || '').trim().length < 8) missing.push('plate or VIN')
  if (!has(est.mileage)) missing.push('odometer')
  if (!has(est.concern)) missing.push('reported problem / requested repairs')
  if (!(est.jobs || []).some(j => (j.lines || []).length)) missing.push('at least one job with a line')
  if (est.customer_type === 'wholesale' && !est.tax_enabled && !has(est.reseller_permit)) missing.push('reseller permit number (wholesale, no tax)')
  return { ok: missing.length === 0, missing }
}

/** Oral authorization needs all five (spec §5). Other methods need who + amount. */
export function authorizationComplete(a = {}) {
  const has = v => String(v ?? '').trim() !== ''
  const missing = []
  if (!has(a.authorized_at)) missing.push('date and time')
  if (!int(a.authorized_amount_cents)) missing.push('amount authorized')
  if (!has(a.authorized_by_name)) missing.push('who authorized')
  if (!has(a.authorized_method)) missing.push('method')
  if (!has(a.authorized_by_employee)) missing.push('who took it')
  return { ok: missing.length === 0, missing }
}

export const fmtCents = c => `$${(int(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const toCents = dollars => rnd((Number(String(dollars ?? '').replace(/[^0-9.\-]/g, '')) || 0) * 100)
export const fromCents = c => (int(c) / 100).toFixed(2)
export const newId = () => Math.random().toString(36).slice(2, 10)
export function blankPart() {
  // markup_bp null = "use the estimate's parts markup box" (Mark's 40% default)
  return { id: newId(), pn: '', desc: '', source: 'oem', qty: 1, cost_cents: 0, markup_bp: null, price_cents: null, taxable: true }
}
export function blankLine(rate_key = 'mechanical') {
  return { id: newId(), desc: '', rate_key, hours: 0, rate_override_cents: null, flat_cents: null, taxable: true, notes: '', parts: [] }
}
