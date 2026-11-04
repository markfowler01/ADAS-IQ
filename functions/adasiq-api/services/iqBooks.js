// 📒 The Zoho Books the scrub invoices go into (Mark 2026-11-04). Two choices:
//   'absolute' → Absolute ADAS's Books (ZOHO_ORGANIZATION_ID). Mark: "for now
//                run this through absolute adas" — no ADAS IQ LLC/customers yet.
//   'iq'       → ADAS IQ's own Books, org 945498731, once the LLC + its own
//                Zoho Payments exist. Flip on the Scrub Billing screen.
// Item + customer ids are kept PER org, so flipping never mixes the two. Mark picked Zoho as the
// whole system, so the monthly scrub invoices land here: the app builds them
// (routes/scrubInvoices.js), this file creates the customer + invoice in Books,
// marks it sent (no email: the customer templates wait for Mark's OK), and
// records payments / voids. Same Zoho login and token as the main app.
//
// Every call passes the chosen org explicitly.
import axios from 'axios'

const BOOKS = 'https://www.zohoapis.com/books/v3'
export const IQ_ORG = process.env.IQ_BOOKS_ORG_ID || '945498731'
export const ORGS = { absolute: () => process.env.ZOHO_ORGANIZATION_ID, iq: () => IQ_ORG }
export const orgId = which => (ORGS[which] || ORGS.absolute)()
const ITEM_NAME = 'ADAS IQ scrub (per VIN)'

async function H(which) {
  const { getAccessToken } = await import('./zoho.js')
  return { headers: { Authorization: `Zoho-oauthtoken ${await getAccessToken()}` }, params: { organization_id: orgId(which) }, timeout: 20000 }
}
const why = e => e?.response?.data?.message || e.message

/** Can the app's token reach ADAS IQ's Books? → { ok, name } */
export async function ping(which) {
  try {
    const h = await H(which)
    const r = await axios.get(`${BOOKS}/organizations/${orgId(which)}`, h)
    return { ok: true, name: r.data?.organization?.name, currency: r.data?.organization?.currency_code, org_id: orgId(which) }
  } catch (e) { return { ok: false, error: why(e) } }
}

/** The one service item every line uses (made once, id cached by the caller). */
export async function ensureItem(which, cachedId) {
  if (cachedId) return cachedId
  const h = await H(which)
  const found = await axios.get(`${BOOKS}/items`, { ...h, params: { ...h.params, name: ITEM_NAME } })
  const hit = (found.data?.items || []).find(i => i.name === ITEM_NAME)
  if (hit) return hit.item_id
  const r = await axios.post(`${BOOKS}/items`, { name: ITEM_NAME, rate: 3, description: 'Calibration identification report for one VIN, from a CCC Secure Share estimate', product_type: 'service' }, h)
  return r.data?.item?.item_id
}

/** The shop as a Books customer. Returns contact_id (caller stores it on the account). */
export async function ensureContact(which, account) {
  const have = account.books_contacts?.[which]
  if (have) return have
  const h = await H(which)
  if (account.email) {
    const s = await axios.get(`${BOOKS}/contacts`, { ...h, params: { ...h.params, email: account.email } })
    const hit = (s.data?.contacts || []).find(c => c.contact_type === 'customer')
    if (hit) return hit.contact_id
  }
  const a = account.address || {}
  const r = await axios.post(`${BOOKS}/contacts`, {
    contact_name: account.name, company_name: account.name, contact_type: 'customer',
    notes: `ADAS IQ account ${account.id}`,
    ...(account.email ? { contact_persons: [{ email: account.email, phone: account.phone || '', is_primary_contact: true }] } : {}),
    ...(a.street || a.city ? { billing_address: { address: a.street || '', city: a.city || '', state: a.state || '', zip: a.zip || '', country: 'U.S.A.' } } : {}),
  }, h)
  return r.data?.contact?.contact_id
}

/**
 * Put one app invoice into Books. Uses the app's number (IQ-YYYYMM-###) so
 * both sides match, and marks it sent without emailing anyone.
 * → { invoice_id, invoice_url }
 */
export async function pushInvoice(which, inv, { contactId, itemId }) {
  const h = await H(which)
  // Already there? (a retry after a timeout must not make a second one)
  const s = await axios.get(`${BOOKS}/invoices`, { ...h, params: { ...h.params, invoice_number: inv.number } })
  const have = (s.data?.invoices || []).find(i => i.invoice_number === inv.number)
  if (have) return { invoice_id: have.invoice_id, invoice_url: have.invoice_url || '' }
  const [y, m] = inv.month.split('-').map(Number)
  const date = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)   // the 1st after the month
  const r = await axios.post(`${BOOKS}/invoices`, {
    customer_id: contactId, invoice_number: inv.number, reference_number: `ADAS IQ ${inv.month}`, date, payment_terms: 0,
    line_items: inv.lines.map(l => ({ item_id: itemId, name: ITEM_NAME, description: l.text, rate: l.price, quantity: l.qty })),
    notes: `${inv.vins} VINs scrubbed in ${inv.month}.${inv.filtered_count ? ` ${inv.filtered_count} more were skipped by your filters (no charge).` : ''}`,
  }, { ...h, params: { ...h.params, ignore_auto_number_generation: true } })
  const out = r.data?.invoice
  try { await axios.post(`${BOOKS}/invoices/${out.invoice_id}/status/sent`, {}, h) } catch (e) { console.warn('[iq books] mark sent', why(e)) }
  return { invoice_id: out.invoice_id, invoice_url: out.invoice_url || '' }
}

/** "Paid other way" (check / ACH) → a payment in Books against the invoice. */
export async function recordPayment(inv, { contactId, mode = 'check', reference = '' }) {
  const h = await H(inv.books_org)
  await axios.post(`${BOOKS}/customerpayments`, {
    customer_id: contactId, payment_mode: mode, amount: inv.total, date: new Date().toISOString().slice(0, 10), reference_number: reference || inv.number,
    invoices: [{ invoice_id: inv.books_invoice_id, amount_applied: inv.total }],
  }, h)
}

export async function voidInBooks(inv) {
  if (!inv.books_invoice_id) return
  const h = await H(inv.books_org)
  await axios.post(`${BOOKS}/invoices/${inv.books_invoice_id}/status/void`, {}, h)
}

/** Is it paid in Books (e.g. the shop paid through the Books payment link)? */
export async function booksStatus(inv) {
  if (!inv.books_invoice_id) return null
  const h = await H(inv.books_org)
  const r = await axios.get(`${BOOKS}/invoices/${inv.books_invoice_id}`, h)
  return r.data?.invoice?.status || null   // draft | sent | overdue | paid | partially_paid | void
}
export { why as booksError }
