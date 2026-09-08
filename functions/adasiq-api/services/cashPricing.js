// Cash-customer pricing (Mark 2026-09-08, replaces the 2026-07-03 flat
// $350/$700 schedule).
//
// Two rules, and only two:
//   1. Cash jobs price on the CP pool in Zoho Books ("CP - …" items).
//      The pool is chosen by the "💵 Swap to Cash" button on the invoice
//      editor (pre-pressed when the Kinetic report's insurer is blank or
//      says cash) or by the Cash chip in the review modal.
//   2. The estimate total never exceeds $700. When the CP lines add up to
//      more, a "Cash cap" adjustment line brings the total to exactly
//      $700 — list prices stay visible, the paper trail shows the cap.
//
// The old flat schedule (tiered $350/$700, PCSI / Post Scan zeroed by
// rule) is gone: CP items carry their own prices now.

export const CASH_MAX_OUT_OF_POCKET = 700
export const CASH_CAP_LINE_NAME = '💵 Cash cap — $700 max'

const CASH_MARKERS = /^(cash|customer pay|cp|self.?pay|owner.?pay|out of pocket|oop)$/i

// Explicit self-pay marker on the insurer field. Blank is NOT cash here
// (a request card with no insurer yet must not get CASH badges/alerts).
export function isCashCustomer(job) {
  if (!job) return false
  const insurer = String(job.insurer || '').trim()
  if (!insurer) return false
  return CASH_MARKERS.test(insurer) || /\b(cash|customer pay|self pay)\b/i.test(insurer)
}

// The Kinetic-upload rule (Mark 2026-09-08): blank OR cash → the cash
// button starts pressed. Client mirrors this in ToggleBoard.jsx.
export function isCashInsurerOrBlank(insurer) {
  const s = String(insurer || '').trim()
  if (!s) return true
  return CASH_MARKERS.test(s) || /\b(cash|customer pay|self pay)\b/i.test(s)
}

export function cashCustomerLabel(job) {
  return isCashCustomer(job) ? 'Cash Customer' : ''
}

// Given priced lines ({ rate, quantity }), return the cap decision:
//   { list_total, capped, adjustment, total }
// adjustment is negative (what the cap line carries) or 0.
export function cashCapFor(lines, limit = CASH_MAX_OUT_OF_POCKET) {
  const list_total = Math.round((lines || []).reduce((s, l) => {
    const qty = Number(l?.quantity ?? l?.qty ?? 1) || 1
    const rate = Number(l?.rate) || 0
    return s + rate * qty
  }, 0) * 100) / 100
  if (list_total <= limit) return { list_total, capped: false, adjustment: 0, total: list_total }
  const adjustment = -Math.round((list_total - limit) * 100) / 100
  return { list_total, capped: true, adjustment, total: limit }
}

// The adjustment line itself, in the shape Zoho / the in-app ledger take.
export function cashCapLine(cap) {
  return {
    name: CASH_CAP_LINE_NAME,
    description: `Cash customer — list total $${cap.list_total.toFixed(2)} reduced to $${CASH_MAX_OUT_OF_POCKET} per Absolute ADAS cash policy.`,
    rate: cap.adjustment,
    quantity: 1,
  }
}

// One-liner for Cliq alerts.
export function summarizeCashPricing() {
  return `CP pricing · $${CASH_MAX_OUT_OF_POCKET} max`
}
