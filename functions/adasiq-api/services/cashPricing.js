// Cash-customer pricing model.
//
// When a job's insurer field is blank or explicitly self-pay, we apply a
// flat pricing schedule that caps out-of-pocket at $700 and forces the
// Kinetic-populated line items that don't apply to cash jobs (Calibration
// ID cost, Post-Collision Safety Inspection, Post Scan) to $0. Kat used
// to have to remember to zero these by hand every time — this codifies
// the rule so it's applied automatically and can be alerted on.
//
// Pricing rules (agreed with Mark 2026-07-03):
//   • 0 calibrations   → $0
//   • 1 calibration    → $350
//   • 2+ calibrations  → $700  (flat cap)
//   • SAS (Steering Angle Sensor / Center) → +$100 IF room under the $700 cap
//   • SWS (Seat Weight Sensor)              → +$100 IF room under the $700 cap
//   • Everything else auto-zero on cash: Calibration ID cost, PCSI, Post Scan
// Total NEVER exceeds $700.

export const CASH_MAX_OUT_OF_POCKET = 700
export const CASH_SINGLE_CAL_PRICE = 350
export const CASH_MULTI_CAL_CAP = 700
export const CASH_SAS_PRICE = 100
export const CASH_SWS_PRICE = 100

// Line-item name fragments that must be zeroed on cash invoices. Match is
// case-insensitive substring — covers Kinetic's various spellings ("Post-
// Collision Safety Inspection", "PCSI", "Post Scan", "Postscan", "Calibration
// Identification Cost", etc.).
const CASH_ZERO_FRAGMENTS = [
  'calibration id',
  'calibration identification',
  'pcsi',
  'post-collision safety',
  'post collision safety',
  'post scan',
  'postscan',
  'pre scan',
  'prescan',
]

// Returns true when the job should be treated as a cash / self-pay customer.
// Cash = insurer explicitly matches a self-pay marker. Blank insurer is
// NOT cash (2026-07-08 — Mark: "if there's an insurance company it's not
// cash; blank alone shouldn't apply cash pricing"). Previously blank
// insurer defaulted to cash, which was silently zeroing PCSI/Post-Scan
// on jobs where the insurer was just not filled in yet.
export function isCashCustomer(job) {
  if (!job) return false
  const insurer = String(job.insurer || '').trim()
  if (!insurer) return false
  return /^(cash|customer pay|cp|self.?pay|owner.?pay|out of pocket|oop)$/i.test(insurer)
}

// Convenience — a human label for logs / notifications.
export function cashCustomerLabel(job) {
  return isCashCustomer(job) ? 'Cash Customer' : ''
}

// A calibration line item is a "SAS" (steering angle sensor / center) if
// its name mentions steering angle. Same idea for seat weight sensor.
function isSasLine(name)  { return /steering\s*angle/i.test(name || '') }
function isSwsLine(name)  { return /seat\s*weight/i.test(name || '') || /\bsws\b/i.test(name || '') }
function isAutoZeroLine(name) {
  const lc = String(name || '').toLowerCase()
  return CASH_ZERO_FRAGMENTS.some(frag => lc.includes(frag))
}

// Count "real" calibrations for the tier decision — SAS, SWS, and auto-zero
// line items don't count toward the 1-vs-2+ tier.
function isRealCalibration(name) {
  return !isSasLine(name) && !isSwsLine(name) && !isAutoZeroLine(name)
}

// Core transform: given a list of calibrations (as objects with a `name`
// field — the shape used everywhere on the job), return an array of line
// items with cash pricing applied. Each output item has:
//   { name, qty, rate, amount, cash_note }
// The cash_note is a short human-readable string ("cash cap", "zeroed —
// cash customer", "SAS", "SWS") so the invoice UI can render a tooltip
// or diff row explaining what happened.
export function computeCashLineItems(calibrations) {
  const cals = Array.isArray(calibrations) ? calibrations : []
  const realCals = cals.filter(c => isRealCalibration(c?.name))
  const sasCals  = cals.filter(c => isSasLine(c?.name))
  const swsCals  = cals.filter(c => isSwsLine(c?.name))
  const autoZero = cals.filter(c => isAutoZeroLine(c?.name))

  // Tier price for the calibration bucket
  let calBucket = 0
  if (realCals.length === 1) calBucket = CASH_SINGLE_CAL_PRICE
  else if (realCals.length >= 2) calBucket = CASH_MULTI_CAL_CAP

  // Distribute the bucket across the real cals so each shows a rate.
  // A single cal gets the full $350 on that line. Multiple cals split the
  // $700 evenly (rounded to whole dollars, with the last row absorbing the
  // rounding remainder so the total is exact).
  const realLines = realCals.map((c, idx) => {
    let rate = 0
    if (realCals.length === 1) rate = CASH_SINGLE_CAL_PRICE
    else if (realCals.length >= 2) {
      const even = Math.floor(CASH_MULTI_CAL_CAP / realCals.length)
      const remainder = CASH_MULTI_CAL_CAP - (even * realCals.length)
      rate = even + (idx === realCals.length - 1 ? remainder : 0)
    }
    return { name: c.name, qty: 1, rate, amount: rate, cash_note: realCals.length >= 2 ? 'cash cap split' : 'single cal' }
  })

  // SAS and SWS add-ons — only if there's headroom under the $700 cap.
  let usedSoFar = calBucket
  const sasLines = sasCals.map(c => {
    const room = CASH_MAX_OUT_OF_POCKET - usedSoFar
    const rate = room >= CASH_SAS_PRICE ? CASH_SAS_PRICE : 0
    usedSoFar += rate
    return { name: c.name, qty: 1, rate, amount: rate, cash_note: rate > 0 ? 'SAS' : 'SAS zeroed — cap reached' }
  })
  const swsLines = swsCals.map(c => {
    const room = CASH_MAX_OUT_OF_POCKET - usedSoFar
    const rate = room >= CASH_SWS_PRICE ? CASH_SWS_PRICE : 0
    usedSoFar += rate
    return { name: c.name, qty: 1, rate, amount: rate, cash_note: rate > 0 ? 'SWS' : 'SWS zeroed — cap reached' }
  })

  // Auto-zero lines (PCSI, Post Scan, Calibration ID cost) — always $0 on cash.
  const zeroLines = autoZero.map(c => ({
    name: c.name, qty: 1, rate: 0, amount: 0, cash_note: 'zeroed — cash customer',
  }))

  return [...realLines, ...sasLines, ...swsLines, ...zeroLines]
}

// Sum helper — useful for logging and for the "max $700" sanity check.
export function totalCashPricing(lineItems) {
  return (lineItems || []).reduce((sum, li) => sum + (Number(li.amount) || 0), 0)
}

// Human-readable summary for Cliq / email alerts.
// e.g. "3 cals @ $700 cap · SAS $0 (cap reached) · Total $700"
export function summarizeCashPricing(calibrations) {
  const lines = computeCashLineItems(calibrations)
  const total = totalCashPricing(lines)
  const realCount = lines.filter(l => l.cash_note === 'single cal' || l.cash_note === 'cash cap split').length
  const parts = []
  if (realCount === 0) parts.push('0 cals')
  else if (realCount === 1) parts.push('1 cal @ $350')
  else parts.push(`${realCount} cals @ $700 cap`)
  const sas = lines.find(l => /SAS/i.test(l.cash_note || ''))
  const sws = lines.find(l => /SWS/i.test(l.cash_note || ''))
  if (sas) parts.push(sas.rate > 0 ? `SAS $${sas.rate}` : 'SAS $0 (cap)')
  if (sws) parts.push(sws.rate > 0 ? `SWS $${sws.rate}` : 'SWS $0 (cap)')
  const zeroCount = lines.filter(l => l.cash_note === 'zeroed — cash customer').length
  if (zeroCount > 0) parts.push(`${zeroCount} zeroed`)
  parts.push(`Total $${total}`)
  return parts.join(' · ')
}
