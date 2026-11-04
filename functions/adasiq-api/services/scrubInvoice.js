// 🧾 Scrub invoices (Mark 2026-11-04, phase 3). Pure rules; storage and Stripe
// live in routes/scrubInvoices.js.
//
// On the 1st (PT) the app closes LAST month: one invoice per paying account,
// built only from the ScrubUsage ledger (billable rows), with one line per
// body shop + price. Charging is a separate step: Mark presses Charge until he
// turns auto-charge on. Every charge carries a Stripe idempotency key tied to
// the invoice + try number, so a double press or two ticks can't charge twice.
//
// Failed card: retry on day 3 and day 7 after the first failure; still unpaid
// on day 7 → account 'past_due' → new estimates are held (not scrubbed) until
// it's paid.

export const RETRY_DAYS = [3, 7]
export const PAST_DUE_DAY = 7
const DAY = 86400000
const r2 = n => Math.round(n * 100) / 100

export const prevMonth = (now = new Date()) => {
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const d = new Date(pt.getFullYear(), pt.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export const ptDay = (now = new Date()) => Number(new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })).getDate())
export const ptHour = (now = new Date()) => Number(new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })).getHours())

/** Is it time to close last month? The 1st–5th PT, after 2 AM (later days catch a missed run). */
export const closeWindow = (now = new Date()) => { const d = ptDay(now); return d >= 1 && d <= 5 && (d > 1 || ptHour(now) >= 2) }

export const invoiceNumber = (month, seq) => `IQ-${month.replace('-', '')}-${String(seq).padStart(3, '0')}`

/**
 * One account's invoice for the month. rows = that account's ScrubUsage rows.
 * Returns null when nothing is billable (no $0 invoices).
 */
export function buildInvoice(account, rows, { month, seq }) {
  const bill = rows.filter(r => r.billable && Number(r.price) > 0)
  if (!bill.length || account.type === 'house' || account.free) return null
  const lines = new Map()
  for (const r of bill) {
    const k = `${r.shop || 'Unknown shop'}|${Number(r.price)}`
    if (!lines.has(k)) lines.set(k, { shop: r.shop || 'Unknown shop', price: Number(r.price), qty: 0 })
    lines.get(k).qty++
  }
  const out = [...lines.values()].map(l => ({ ...l, amount: r2(l.qty * l.price), text: `${l.shop}: ${l.qty} VIN${l.qty === 1 ? '' : 's'} scrubbed × $${l.price.toFixed(2)}` }))
    .sort((a, b) => b.amount - a.amount)
  const free = rows.filter(r => !r.billable)
  return {
    id: `${month}:${account.id}`, number: invoiceNumber(month, seq), month, account_id: account.id, account_name: account.name, email: account.email || '',
    lines: out, total: r2(out.reduce((t, l) => t + l.amount, 0)), vins: bill.length,
    free_count: free.length, filtered_count: free.filter(r => String(r.reason || '').startsWith('filtered')).length,
    status: 'draft', tries: 0, created_at: new Date().toISOString(),
  }
}

/**
 * What to do with an unpaid invoice today. → 'retry' | 'past_due' | null
 * (first_failed_at = when the first charge failed).
 */
export function dunningStep(inv, now = Date.now()) {
  if (inv.status !== 'failed' || !inv.first_failed_at) return null
  const days = (now - new Date(inv.first_failed_at).getTime()) / DAY
  const nextRetry = RETRY_DAYS[(inv.tries || 1) - 1]
  if (nextRetry != null && days >= nextRetry) return 'retry'          // day 7: one last try first
  if (days >= PAST_DUE_DAY && !inv.past_due_at) return 'past_due'
  return null
}

/** Plain reminder text for Mark to send (he proofreads every outbound message). */
export function reminderText(inv) {
  const days = inv.first_failed_at ? Math.floor((Date.now() - new Date(inv.first_failed_at).getTime()) / DAY) : 0
  return `Hi ${inv.account_name} team,\n\nThe card on file didn't go through for ADAS IQ invoice ${inv.number} ($${inv.total.toFixed(2)}, ${inv.vins} VINs scrubbed in ${inv.month}).${inv.fail_reason ? ` The bank said: ${inv.fail_reason}.` : ''}\n\nYou can update the card in your ADAS IQ portal and we'll run it again.${days < PAST_DUE_DAY ? ` Scrubbing pauses on day ${PAST_DUE_DAY} if it's still open.` : ' Scrubbing is paused until it\'s paid; your estimates are kept.'}\n\nThanks,\nADAS IQ`
}
