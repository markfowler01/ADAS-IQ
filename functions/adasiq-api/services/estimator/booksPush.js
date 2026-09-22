// Zoho Books push (spec §7). Rolled up = one line per approved job;
// itemized = header / lines / subtotal per job. Tax is never computed
// here — the line carries tax_id and Books does the math. Every request
// and response is logged to EstPushLog. Books custom fields are the ones
// Kat's invoices already use (cf_ro_1, cf_vin, cf_year/make/model, cf_insurer).
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { getAccessToken } from '../zoho.js'
import { STANDARD_TERMS } from '../costInvoice.js'

const API = 'https://www.zohoapis.com/books/v3'
const org = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })
const H = t => ({ Authorization: `Zoho-oauthtoken ${t}` })
const dollars = c => Math.round(Number(c) || 0) / 100
const sleep = ms => new Promise(r => setTimeout(r, ms))
export const booksUrl = (kind, id) => `https://books.zoho.com/app#/${kind === 'invoice' ? 'invoices' : 'estimates'}/${id}?organization_id=${process.env.ZOHO_ORGANIZATION_ID}`

async function log(req, estId, direction, endpoint, body, resp, status, by) {
  try {
    await catalyst.initialize(req, { type: 'advancedio' }).datastore().table('EstPushLog').insertRow({
      ep_estimate_id: String(estId), ep_direction: direction, ep_endpoint: endpoint, ep_request_body: JSON.stringify(body || {}).slice(0, 9500), ep_response_body: JSON.stringify(resp || {}).slice(0, 9500), ep_http_status: Number(status) || 0, ep_by: String(by || '').slice(0, 100), ep_created_at: new Date().toISOString(),
    })
  } catch (e) { console.log('[books-push] log failed:', e.message) }
}

/** Build Books line_items from approved jobs. */
export function buildLines({ est, jobs, totals, settings, detail }) {
  const approved = jobs.filter(j => j.status === 'approved')
  const items = settings.category_items || {}
  const taxOn = est.tax_enabled && est.zoho_tax_id
  const withTax = l => (taxOn ? { ...l, tax_id: est.zoho_tax_id } : l)
  const out = []
  let order = 1
  if (detail === 'itemized') {
    for (const j of approved) {
      out.push({ line_item_category: 'header', name: j.name, item_order: order++ })
      for (const l of j.lines || []) {
        const itemId = l.item_id || items[j.category] || items.labor || ''
        out.push(withTax({ ...(itemId ? { item_id: itemId } : {}), name: l.desc || j.name, description: '', rate: l.flat_cents != null ? dollars(l.flat_cents) : dollars(l.rate_override_cents ?? (l.hours ? Math.round(l.labor_cents / l.hours) : 0)), quantity: l.flat_cents != null ? 1 : Number(l.hours || 0), item_order: order++ }))
        for (const p of l.parts || []) out.push(withTax({ ...(items.parts ? { item_id: items.parts } : {}), name: `${p.pn ? p.pn + ' ' : ''}${p.desc || 'Part'} (${p.source || 'oem'})`, rate: dollars(p.price_each_cents ?? p.price_cents ?? 0), quantity: Number(p.qty || 1), item_order: order++ }))
      }
      out.push({ line_item_category: 'subtotal', name: `${j.name} subtotal`, item_order: order++ })
    }
  } else {
    for (const j of approved) {
      const itemId = items[j.category] || ''
      out.push(withTax({ ...(itemId ? { item_id: itemId } : {}), name: (j.invoice_description || j.name || 'Repair').slice(0, 200), description: '', rate: dollars(j.total_cents), quantity: 1, item_order: order++ }))
    }
  }
  if (est.supplies_enabled && totals.supplies > 0) out.push(withTax({ ...(items.supplies ? { item_id: items.supplies } : {}), name: 'Shop supplies', rate: dollars(totals.supplies), quantity: 1, item_order: order++ }))
  return out
}

/**
 * Push an estimate to Books as an invoice or an estimate (draft, not emailed).
 * Returns { id, number, url, warnings[] }.
 */
export async function pushToBooks({ req, est, jobs, totals, settings, mode = 'invoice', detail = null, by = 'staff', threeCNotes = '' }) {
  const warnings = []
  if (!est.zoho_contact_id) throw Object.assign(new Error('No Zoho Books customer on this estimate — link or create one first (Customer panel / CRM).'), { status: 422 })
  if (!jobs.some(j => j.status === 'approved')) throw Object.assign(new Error('Nothing approved to push.'), { status: 422 })
  if (mode === 'invoice' && est.zoho_invoice_id) throw Object.assign(new Error(`Already pushed as invoice ${est.zoho_invoice_number || est.zoho_invoice_id}.`), { status: 409 })
  if (mode === 'estimate' && est.zoho_estimate_id) throw Object.assign(new Error(`Already pushed as Books estimate ${est.zoho_estimate_number || est.zoho_estimate_id}.`), { status: 409 })
  if (est.customer_type === 'wholesale' && !est.tax_enabled && !est.reseller_permit) warnings.push('Wholesale with no reseller permit on file')
  if (est.tax_enabled && !est.zoho_tax_id && !(totals.tax > 0)) warnings.push(`Sales tax is ON but the estimate computed $0 tax — check the rate in Estimator settings.`)
  const level = detail || est.detail_level || settings.detail_level || 'rolled_up'
  const lines = buildLines({ est, jobs, totals, settings, detail: level })
  const unmapped = [...new Set(jobs.filter(j => j.status === 'approved' && !(settings.category_items || {})[j.category]).map(j => j.category))]
  if (level !== 'itemized' && unmapped.length) warnings.push(`No Books item mapped for: ${unmapped.join(', ')} — pushed as plain lines (map them in Estimator settings)`)

  const token = await getAccessToken()
  const kind = mode === 'invoice' ? 'invoices' : 'estimates'
  // Dedupe: an invoice/estimate already carrying this app number in its reference or notes
  try {
    const s = await axios.get(`${API}/${kind}`, { headers: H(token), params: { ...org(), search_text: est.number }, timeout: 15000, validateStatus: st => st < 500 })
    const hit = (s.data?.[kind] || []).find(x => String(x.reference_number || '').includes(est.number) || String(x.notes || '').includes(est.number))
    if (hit) { const id = hit[mode === 'invoice' ? 'invoice_id' : 'estimate_id']; const number = hit[mode === 'invoice' ? 'invoice_number' : 'estimate_number']; return { id, number, url: booksUrl(mode, id), linked_existing: true, warnings } }
  } catch (e) { console.log('[books-push] dedupe search failed:', e.message) }

  const notes = [est.notes, threeCNotes, `Absolute ADAS estimate ${est.number}${est.ro_number ? ` · RO ${est.ro_number}` : ''}`].filter(Boolean).join('\n\n').slice(0, 5000)
  const custom_fields = [
    est.ro_number && { api_name: 'cf_ro_1', value: est.ro_number }, est.vin && { api_name: 'cf_vin', value: est.vin },
    est.year && { api_name: 'cf_year', value: est.year }, est.make && { api_name: 'cf_make', value: est.make }, est.model && { api_name: 'cf_model', value: est.model },
    est.insurer && { api_name: 'cf_insurer', value: est.insurer },
  ].filter(Boolean)
  const body = {
    customer_id: est.zoho_contact_id, reference_number: est.ro_number || est.number,
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }),
    line_items: lines, notes, terms: est.terms || STANDARD_TERMS, custom_fields, salesperson_name: by,
    ...(mode === 'invoice' ? { payment_terms: 0, payment_terms_label: 'Due on Receipt', ...(est.zoho_estimate_id ? { invoiced_estimate_id: est.zoho_estimate_id } : {}), payment_options: { payment_gateways: [{ gateway_name: 'zoho_payments', configured: true }] } } : { ...(est.valid_until ? { expiry_date: est.valid_until } : {}) }),
    ...(totals.discount > 0 ? { discount: est.discount_type === 'pct' ? `${(est.discount_value / 100).toFixed(2)}%` : dollars(totals.discount), discount_type: 'entity_level', is_discount_before_tax: true } : {}),
    // No Books tax record (Mark's org, 2026-09-22): the engine's tax rides as the
    // labeled adjustment line above Total — "Tax 10.1%" — same number the estimate showed.
    ...(est.tax_enabled && !est.zoho_tax_id && totals.tax > 0 ? { adjustment: Math.round(totals.tax) / 100, adjustment_description: `Tax ${(est.tax_rate_bp / 100).toFixed(1).replace(/\.0$/, '')}%` } : {}),
  }
  const post = async b => { let r; for (let i = 0; i < 3; i++) { r = await axios.post(`${API}/${kind}`, b, { headers: H(token), params: org(), timeout: 25000, validateStatus: st => st < 500 }); if (r.status === 429) { await sleep(1500 * (i + 1)); continue } break } return r }
  let r = await post(body)
  const msg = () => String(r.data?.message || '')
  const failed = () => r.data?.code !== 0
  if (failed() && /line_item_category|header|subtotal/i.test(msg())) { warnings.push(`Books rejected header/subtotal rows (${msg()}) — pushed itemized lines without them`); body.line_items = lines.filter(l => !l.line_item_category).map((l, i) => ({ ...l, item_order: i + 1 })); r = await post(body) }
  if (failed() && /estimate/i.test(msg()) && body.invoiced_estimate_id) { warnings.push(`Estimate link rejected: ${msg()}`); delete body.invoiced_estimate_id; r = await post(body) }
  if (failed() && /payment|gateway/i.test(msg())) { delete body.payment_options; r = await post(body) }
  if (failed() && /custom ?field|cf_/i.test(msg())) { warnings.push(`Custom field rejected: ${msg()}`); body.custom_fields = []; r = await post(body) }
  if (failed() && /tax/i.test(msg())) { warnings.push(`Tax rejected by Books (${msg()}) — pushed without tax_id; set tax in Books`); body.line_items = body.line_items.map(({ tax_id, ...l }) => l); r = await post(body) }
  if (failed() && /discount/i.test(msg())) { warnings.push(`Discount rejected (${msg()}) — pushed without; apply in Books`); delete body.discount; delete body.discount_type; delete body.is_discount_before_tax; r = await post(body) }
  if (failed() && /item/i.test(msg())) { warnings.push(`Item id rejected (${msg()}) — pushed as plain lines`); body.line_items = body.line_items.map(({ item_id, ...l }) => l); r = await post(body) }
  await log(req, est.id, `push:${mode}`, `POST /${kind}`, body, r.data, r.status, by)
  if (failed()) throw Object.assign(new Error(`Books said: ${msg() || r.status}`), { status: 502, books: r.data })
  const doc = r.data[mode === 'invoice' ? 'invoice' : 'estimate']
  const id = doc[mode === 'invoice' ? 'invoice_id' : 'estimate_id'], number = doc[mode === 'invoice' ? 'invoice_number' : 'estimate_number']
  return { id, number, url: booksUrl(mode, id), warnings, total: doc.total }
}
