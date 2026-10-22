// 📊 Sales basis (Mark 2026-10-22: "I want all of my text messages and
// everything invoiced sales after discount, minus Cal ID for the technicians
// and also minus Remote Expert fees for the technicians"; and on the bonus:
// "I didn't mean cash collected … I meant after discount").
//
// Every sales number = Books invoices by invoice date, `total` = what the shop
// was billed after the partnership discount. Drafts and voids never count.
// Technician numbers (tech bars, texts, Live Day, bonus) also drop the
// pass-through lines (Calibration ID, technology / security / gateway access
// fees — services/bonusFees.js) and the Remote Expert fee matched to the
// invoice (services/remoteExpert.js). Company totals do not.

/** Invoices dated fromISO..toISO, voids and drafts out. */
export async function invoicedRows(fromISO, toISO) {
  const { listInvoicesForDateRange } = await import('./zoho.js')
  return (await listInvoicesForDateRange(fromISO, toISO))
    .filter(i => !/void|draft/i.test(String(i.status || '')))
    .map(i => ({ ...i, date: String(i.date || '').slice(0, 10), total: Number(i.total) || 0 }))
}

/**
 * Per-invoice technician cut: pass-through lines + Remote Expert, capped at the
 * invoice. Returns cutOf(inv) → dollars to take off that invoice for tech numbers.
 */
export async function techCutter(req, invoices) {
  let byInvoice = {}, reFees = {}, reCut = () => 0
  try { const { loadPassThrough } = await import('./bonusFees.js'); byInvoice = (await loadPassThrough(req, invoices.map(i => i.invoice_number))).byInvoice || {} } catch (e) { console.warn('[salesBasis] pass-through', e.message) }
  try { const re = await import('./remoteExpert.js'); reFees = await re.remoteExpertFeesByInvoice(req); reCut = re.remoteExpertCut } catch (e) { console.warn('[salesBasis] remote expert', e.message) }
  return inv => {
    const total = Number(inv.total) || 0
    if (!(total > 0)) return 0
    const pass = Math.max(0, Number(byInvoice[inv.invoice_number]?.excluded) || 0)
    const re = reCut(reFees, inv.invoice_number, total) || 0
    return Math.min(total, Math.round((pass + re) * 100) / 100)
  }
}

/** Invoices shaped like the old "paid invoice" rows (status/paid_at/total) for the report screens. */
export async function invoicedReportRows(fromISO, toISO) {
  return (await invoicedRows(fromISO, toISO)).map(i => ({
    status: 'paid', paid_at: `${i.date}T12:00:00.000Z`, date: i.date, total: i.total, amount_paid: i.total,
    customer_name: i.customer_name, invoice_number: i.invoice_number, salesperson_name: i.salesperson_name, invoice_type: 'invoice',
  }))
}

export const SALES_SINCE = '2025-01-01'

// Salesperson on the invoice ↔ tech. Books has typos ("Jaden", "Mark Folwer")
// that a plain substring match missed, so those sales never reached the tech's
// numbers or bonus (found 2026-10-22: $800 under "Jaden", $385 under "Mark Folwer").
const lev = (a, b) => { const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n] }
export function salespersonMatches(salesperson, tech) {
  const sp = String(salesperson || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
  const t = String(tech || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
  if (!sp || !t) return false
  if (sp.includes(t) || t.includes(sp)) return true
  if (lev(sp, t) <= 2 && Math.min(sp.length, t.length) >= 6) return true            // "mark folwer" ~ "mark fowler"
  const f1 = sp.split(' ')[0], f2 = t.split(' ')[0]
  const l1 = sp.split(' ').slice(1).join(' '), l2 = t.split(' ').slice(1).join(' ')
  if (f1.length >= 4 && f2.length >= 4 && lev(f1, f2) <= 1 && (!l1 || !l2 || lev(l1, l2) <= 2)) return true   // "jaden" ~ "jayden goshorn"
  return false
}
