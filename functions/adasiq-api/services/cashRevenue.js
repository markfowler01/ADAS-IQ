// 💵 Cash revenue (Mark 2026-10-17: "I need to operate on a cash basis and all
// these numbers need to be after discount"). Every revenue stat (GET SOME
// meeting, Ada's strip, tech bars, tech digest, Live Day, the brief) counts
// money actually received, on the day it landed, net of discounts. That is
// Books customer payments, which is what the cash-basis P&L reports.
//
// Checked 2026-10-17: invoices YTD $308.7k (accrual, incl. unpaid) vs
// payments $216.6k vs the cash P&L's $214.2k operating income.
//
// Tech credit: payment → invoice(s) → invoice salesperson. A payment that
// covers several invoices is split by ArAllocations when we have them, else
// by invoice total. Money with no invoice (unapplied) counts for the company
// but no tech.
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { getAccessToken } from './zoho.js'

const BOOKS = 'https://www.zohoapis.com/books/v3'
const q = s => String(s ?? '').replace(/'/g, "''")
const num = v => Number(v || 0) || 0

/** Books customer payments dated fromISO..toISO (inclusive). */
export async function listPayments(fromISO, toISO, { maxPages = 15 } = {}) {
  const token = await getAccessToken()
  const out = []
  for (let page = 1; page <= maxPages; page++) {
    const r = await axios.get(`${BOOKS}/customerpayments`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { organization_id: process.env.ZOHO_ORGANIZATION_ID, per_page: 200, page, date_start: fromISO, date_end: toISO, sort_column: 'date', sort_order: 'A' },
      timeout: 20000, validateStatus: s => s < 500,
    })
    const batch = r.data?.customerpayments || []
    for (const p of batch) {
      const d = String(p.date || '').slice(0, 10)
      if (!d || d < fromISO || d > toISO) continue
      out.push({ payment_id: String(p.payment_id), date: d, amount: num(p.amount), customer_name: p.customer_name || '',
        invoice_numbers: String(p.invoice_numbers || '').split(',').map(s => s.trim()).filter(Boolean) })
    }
    if (!r.data?.page_context?.has_more_page && batch.length < 200) break
  }
  return out
}

// invoice_number → { salesperson_name, total } from the mirror, live Books for the rest.
async function invoiceInfo(req, numbers) {
  const map = {}
  const want = [...new Set(numbers)]
  if (!want.length) return map
  const app = catalyst.initialize(req)
  for (let i = 0; i < want.length; i += 40) {
    const chunk = want.slice(i, i + 40)
    try {
      const rows = await app.zcql().executeZCQLQuery(`SELECT invoice_number, salesperson_name, inv_total FROM AdasInvoices WHERE invoice_number IN (${chunk.map(n => `'${q(n)}'`).join(',')})`)
      for (const r of rows || []) { const x = r.AdasInvoices || r; map[x.invoice_number] = { salesperson_name: x.salesperson_name || '', total: num(x.inv_total) } }
    } catch (e) { console.warn('[cashRevenue] mirror lookup', e.message) }
  }
  const missing = want.filter(n => !map[n]).slice(0, 25)
  if (missing.length) {
    const token = await getAccessToken()
    await Promise.all(missing.map(async n => {
      try {
        const r = await axios.get(`${BOOKS}/invoices`, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { organization_id: process.env.ZOHO_ORGANIZATION_ID, invoice_number: n }, timeout: 15000, validateStatus: s => s < 500 })
        const inv = (r.data?.invoices || [])[0]
        if (inv) map[n] = { salesperson_name: inv.salesperson_name || '', total: num(inv.total) }
      } catch { /* leave unattributed */ }
    }))
  }
  return map
}

async function allocations(req, paymentIds) {
  const by = {}
  if (!paymentIds.length) return by
  const app = catalyst.initialize(req)
  for (let i = 0; i < paymentIds.length; i += 40) {
    const chunk = paymentIds.slice(i, i + 40)
    try {
      const rows = await app.zcql().executeZCQLQuery(`SELECT al_payment_id, al_invoice_number, al_amount_cents, al_kind FROM ArAllocations WHERE al_payment_id IN (${chunk.map(n => `'${q(n)}'`).join(',')})`)
      for (const r of rows || []) { const x = r.ArAllocations || r; if (x.al_kind === 'unapplied') continue; (by[x.al_payment_id] ||= []).push({ invoice_number: x.al_invoice_number, amount: num(x.al_amount_cents) / 100 }) }
    } catch { /* table empty or missing: fall back to proportional */ }
  }
  return by
}

/**
 * Cash received fromISO..toISO, one row per (payment × invoice share), shaped
 * like listInvoicesForDateRange rows so the tech matchers keep working:
 * { invoice_number, customer_name, salesperson_name, total, date, status: 'paid', payment_id }
 */
export async function listCashForDateRange(req, fromISO, toISO) {
  const pays = await listPayments(fromISO, toISO)
  const info = await invoiceInfo(req, pays.flatMap(p => p.invoice_numbers))
  const multi = pays.filter(p => p.invoice_numbers.length > 1).map(p => p.payment_id)
  const alloc = await allocations(req, multi)
  const rows = []
  for (const p of pays) {
    const base = { customer_name: p.customer_name, date: p.date, status: 'paid', payment_id: p.payment_id }
    if (!p.invoice_numbers.length) { rows.push({ ...base, invoice_number: '', salesperson_name: '', total: p.amount }); continue }
    if (p.invoice_numbers.length === 1) { const n = p.invoice_numbers[0]; rows.push({ ...base, invoice_number: n, salesperson_name: info[n]?.salesperson_name || '', total: p.amount }); continue }
    let parts = alloc[p.payment_id]
    if (!parts?.length) {
      const w = p.invoice_numbers.map(n => Math.max(0, info[n]?.total || 0)), sum = w.reduce((a, b) => a + b, 0)
      parts = p.invoice_numbers.map((n, i) => ({ invoice_number: n, amount: sum > 0 ? p.amount * (w[i] / sum) : p.amount / p.invoice_numbers.length }))
    }
    const placed = parts.reduce((a, x) => a + x.amount, 0)
    for (const x of parts) rows.push({ ...base, invoice_number: x.invoice_number, salesperson_name: info[x.invoice_number]?.salesperson_name || '', total: Math.round(x.amount * 100) / 100 })
    const rest = Math.round((p.amount - placed) * 100) / 100
    if (rest > 0.009) rows.push({ ...base, invoice_number: '', salesperson_name: '', total: rest })   // overpayment / unapplied
  }
  return rows
}

/** Cash per PT day for a whole year: { 'YYYY-MM-DD': dollars }. */
export async function cashByDay(fromISO, toISO) {
  const byDay = {}
  const pays = await listPayments(fromISO, toISO)
  for (const p of pays) byDay[p.date] = (byDay[p.date] || 0) + p.amount
  return { byDay, payments: pays.length }
}

/** Payments as "paid invoice" rows for the older screens that sum
 *  status==='paid' / paid_at / total: { status, paid_at, date, total, amount_paid, customer_name, invoice_number }. */
export async function paidRows(fromISO, toISO) {
  return (await listPayments(fromISO, toISO, { maxPages: 40 })).map(p => ({
    status: 'paid', paid_at: `${p.date}T12:00:00.000Z`, date: p.date, total: p.amount, amount_paid: p.amount,
    customer_name: p.customer_name, invoice_number: p.invoice_numbers.join(', '), payment_id: p.payment_id, invoice_type: 'payment',
  }))
}
export const CASH_SINCE = '2025-01-01'   // before the company's first invoice (founded 2025-10-29)
