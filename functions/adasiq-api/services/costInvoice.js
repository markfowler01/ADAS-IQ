// Cost invoice builder (Mark 2026-09-11: "it looks like it is not using
// the right PDF templates"). Both were actually on the same Books
// template — what differed was the CONTENT the template renders. This
// module makes an app-made cost invoice look exactly like one Kat converts
// by hand:
//   • PDF template pinned by name ("Absolute ADAS vrs 1", Retail for retail)
//   • header custom fields copied from the estimate: Scan Report link, RO#,
//     Year, Make, Model, VIN
//   • RO# as the reference, technician as salesperson
//   • the standard "Thank you for trusting us…" notes + "Payment due when
//     invoice is sent" terms
//   • Payment Options (Zoho Payments) button
//   • item-level discount → Discount column; Due on Receipt; same number
//     as the estimate (Books auto-numbering is ON → ignore flag)
// Shared by 💸 Bill it (routes/billIt.js) and the Quotes Out bill path
// (routes/shopQuotes.js) so both produce the same document.
import axios from 'axios'

const API = 'https://www.zohoapis.com/books/v3'
const H = t => ({ Authorization: `Zoho-oauthtoken ${t}` })
const org = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })
const r2 = n => Math.round((Number(n) || 0) * 100) / 100

// ── Discount eligibility (Mark's rules) ────────────────────────────────
export const NO_DISCOUNT = /calibration identification report|^sfp?\s*[-\s].*post[- ]?scan/i
// Books' goods/service flag is unreliable (Pre-Calibration Scan, Subaru
// MonoCam, AMFAM scans… are typed "goods"). A line is a PART only when
// Books says goods AND the name doesn't read like work we did.
export const LOOKS_LIKE_SERVICE = /scan|calibrat|inspection|labor|set-?up|program|diagnos|report|snapshot|aim|alignment|ride|remove|install|r&i|r & i/i
export const isPart = l => l.product_type === 'goods' && !LOOKS_LIKE_SERVICE.test(l.name || '')
export const discountEligible = l => (Number(l.amount) || 0) > 0 && !isPart(l) && !NO_DISCOUNT.test(l.name || '')

// ── Standard notes / terms (what Kat's invoices carry) ──────────────────
// Override without a deploy: AppConfig rows BILL_IT_NOTES / BILL_IT_TERMS.
export const STANDARD_NOTES = 'Thank you for trusting us with your vehicle. Your safety is always our top priority, and we truly appreciate your business. \nLabor rate is $220 per hour.\n\nDriving safety forward, one calibration at a time. '
export const STANDARD_TERMS = 'Payment due when invoice is sent. Thank you for choosing Absolute ADAS.\n'
async function cfgValue(app, key) {
  if (!app) return null
  try {
    const rows = await app.zcql().executeZCQLQuery(`SELECT config_value FROM AppConfig WHERE config_key = '${key}' LIMIT 1`)
    const v = rows?.[0]?.AppConfig?.config_value ?? rows?.[0]?.config_value
    if (!v) return null
    try { return JSON.parse(v) } catch { return v }
  } catch { return null }
}
export async function standardText(app) {
  const [notes, terms] = await Promise.all([cfgValue(app, 'BILL_IT_NOTES'), cfgValue(app, 'BILL_IT_TERMS')])
  return { notes: typeof notes === 'string' && notes.trim() ? notes : STANDARD_NOTES, terms: typeof terms === 'string' && terms.trim() ? terms : STANDARD_TERMS }
}

// ── PDF templates, pinned by name, cached 6h ────────────────────────────
const TEMPLATE_RULES = {
  estimate: [/absolute list invoice/i],
  invoice_retail: [/retail/i, /absolute adas vrs/i],
  invoice: [/absolute adas vrs/i],
}
let _tplCache = { at: 0, estimate: [], invoice: [] }
async function templates(token) {
  if (Date.now() - _tplCache.at < 6 * 3600e3 && (_tplCache.estimate.length || _tplCache.invoice.length)) return _tplCache
  const [e, i] = await Promise.all([
    axios.get(`${API}/estimates/templates`, { headers: H(token), params: org(), timeout: 12000, validateStatus: s => s < 500 }),
    axios.get(`${API}/invoices/templates`, { headers: H(token), params: org(), timeout: 12000, validateStatus: s => s < 500 }),
  ])
  _tplCache = { at: Date.now(), estimate: e.data?.templates || [], invoice: i.data?.templates || [] }
  return _tplCache
}
const pick = (list, patterns) => { for (const re of patterns) { const hit = list.find(t => re.test(t.template_name || '')); if (hit) return hit } return null }
export async function resolveTemplates(token, customerType) {
  const t = await templates(token).catch(() => ({ estimate: [], invoice: [] }))
  const est = pick(t.estimate, TEMPLATE_RULES.estimate)
  const inv = pick(t.invoice, /retail/i.test(customerType || '') ? TEMPLATE_RULES.invoice_retail : TEMPLATE_RULES.invoice)
  return { estimate: est ? { id: est.template_id, name: est.template_name } : null, invoice: inv ? { id: inv.template_id, name: inv.template_name } : null }
}
export async function getEstimate(token, id) {
  const r = await axios.get(`${API}/estimates/${id}`, { headers: H(token), params: org(), timeout: 15000, validateStatus: s => s < 500 })
  return r.data?.estimate || null
}
export async function applyEstimateTemplate(token, estimateId, tpl) {
  const r = await axios.put(`${API}/estimates/${estimateId}/templates/${tpl.id}`, {}, { headers: H(token), params: org(), timeout: 15000, validateStatus: s => s < 500 })
  const got = r.data?.estimate?.template_id || (await getEstimate(token, estimateId))?.template_id
  if (String(got) !== String(tpl.id)) throw new Error(`The "${tpl.name}" template did not apply to the estimate — nothing sent.`)
}
export async function applyInvoiceTemplate(token, invoiceId, tpl) {
  const r = await axios.put(`${API}/invoices/${invoiceId}/templates/${tpl.id}`, {}, { headers: H(token), params: org(), timeout: 15000, validateStatus: s => s < 500 })
  if (r.data?.code !== 0) throw new Error(`The "${tpl.name}" template did not apply to the invoice — invoice created but NOT emailed.`)
}

// ── Header custom fields: estimate → invoice (same labels, different api_names) ──
const INVOICE_CF_BY_LABEL = { 'Scan Report and Documentation': 'cf_calibration', 'RO#': 'cf_ro_1', 'Year': 'cf_year', 'Make': 'cf_make', 'Model': 'cf_model', 'VIN': 'cf_vin', 'Insurer': 'cf_insurer' }
export function invoiceCustomFields(estFields) {
  return (estFields || []).map(c => { const api = INVOICE_CF_BY_LABEL[c.label]; return api && c.value !== '' && c.value != null ? { api_name: api, value: c.value } : null }).filter(Boolean)
}

// ── Lines: apply the per-line rule at a given % ─────────────────────────
export function applyDiscount(lines, pct) {
  return lines.map(l => {
    const amount = r2((Number(l.rate) || 0) * (Number(l.quantity) || 1))
    const base = { ...l, amount }
    const d = pct > 0 && discountEligible(base) ? pct : 0
    return { ...base, is_part: isPart(base), never_discount: NO_DISCOUNT.test(l.name || ''), discount_pct: d, cost_amount: r2(amount * (1 - d / 100)) }
  })
}

/**
 * Create the cost invoice in Books from an estimate + discounted lines.
 * Returns the Books invoice. Does NOT email anything.
 *   est: full Books estimate (custom_fields, reference_number, salesperson_name, estimate_number, customer_id)
 *   lines: from applyDiscount()
 */
export async function createCostInvoice({ token, app, est, lines, pct, customerType, technician, by, templates: tpl }) {
  const text = await standardText(app)
  const invLines = lines.map(l => ({
    ...(l.item_id ? { item_id: l.item_id } : { name: l.name }), description: l.description || '', rate: l.rate, quantity: l.quantity,
    ...(l.discount_pct > 0 ? { discount: `${l.discount_pct}%` } : {}),
  }))
  const body = {
    customer_id: est.customer_id, invoice_number: est.estimate_number, reference_number: est.reference_number || est.estimate_number,
    // Link to the estimate like Books' own "Convert to Invoice" (estimate → status invoiced).
    estimate_id: est.estimate_id,
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }), payment_terms: 0, payment_terms_label: 'Due on Receipt',
    discount_type: 'item_level', is_discount_before_tax: true, line_items: invLines,
    notes: text.notes, terms: text.terms,
    custom_fields: invoiceCustomFields(est.custom_fields), salesperson_name: est.salesperson_name || technician || '',
    ...(tpl?.invoice?.id ? { template_id: tpl.invoice.id } : {}),
    // The "Payment Options" button on Kat's invoices = Zoho Payments gateway.
    payment_options: { payment_gateways: [{ gateway_name: 'zoho_payments', configured: true }] },
  }
  const post = b => axios.post(`${API}/invoices`, b, { headers: H(token), params: { ...org(), ignore_auto_number_generation: true }, timeout: 20000, validateStatus: s => s < 500 })
  let c = await post(body)
  const msg = () => String(c.data?.message || '')
  if (c.data?.code !== 0 && /estimate/i.test(msg())) { console.log('[cost-invoice] estimate link rejected, retrying without:', msg()); delete body.estimate_id; c = await post(body) }
  if (c.data?.code !== 0 && /payment|gateway/i.test(msg())) { console.log('[cost-invoice] payment options rejected, retrying without:', msg()); delete body.payment_options; c = await post(body) }
  if (c.data?.code !== 0 && /custom ?field|cf_/i.test(msg())) {
    console.log('[cost-invoice] custom field rejected, retrying without insurer:', msg())
    body.custom_fields = body.custom_fields.filter(f => f.api_name !== 'cf_insurer'); c = await post(body)
    if (c.data?.code !== 0 && /custom ?field|cf_/i.test(msg())) { body.custom_fields = []; c = await post(body) }
  }
  if (c.data?.code !== 0 && /number|already exists|duplicate/i.test(msg())) {
    // Number collision / numbering rule → let Books number it.
    console.log('[cost-invoice] number rejected, letting Books number it:', msg())
    delete body.invoice_number
    c = await axios.post(`${API}/invoices`, body, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 })
  }
  if (c.data?.code !== 0) throw new Error(`Cost invoice failed: ${msg() || c.status}`)
  const inv = c.data.invoice
  if (tpl?.invoice?.id && String(inv.template_id) !== String(tpl.invoice.id)) await applyInvoiceTemplate(token, inv.invoice_id, tpl.invoice)
  // Audit trail stays inside Books (comment), never on the customer's PDF.
  await axios.post(`${API}/invoices/${inv.invoice_id}/comments`, { description: `Cost invoice · ${pct}% partnership discount${customerType ? ` (${String(customerType).replace(/_/g, ' ')})` : ''} on services · billed via Absolute ADAS app by ${by || 'staff'} · from estimate ${est.estimate_number}` }, { headers: H(token), params: org(), timeout: 12000, validateStatus: s => s < 500 }).catch(() => {})
  return inv
}

export async function emailEstimate(token, estimateId, emails) {
  const r = await axios.post(`${API}/estimates/${estimateId}/email`, { to_mail_ids: emails }, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 })
  return r.data?.code === 0 ? null : (r.data?.message || `HTTP ${r.status}`)
}
export async function emailInvoice(token, invoiceId, emails) {
  const r = await axios.post(`${API}/invoices/${invoiceId}/email`, { to_mail_ids: emails }, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 })
  return r.data?.code === 0 ? null : (r.data?.message || `HTTP ${r.status}`)
}
