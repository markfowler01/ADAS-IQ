// 💸 Bill it (Mark 2026-09-10) — one button that does Kat's four steps at
// Ready to Invoice, with a full in-app preview first:
//   1. add the tech's extra items to the Books estimate
//   2. email the estimate to the shop = the INSURANCE invoice
//   3. create the Books invoice from it with the shop's discount per line
//      = the COST invoice (same number, Due on Receipt)
//   4. email the cost invoice
// Runs IN PARALLEL with the manual process: refuses if an invoice with
// that number already exists. Staff only (technicians locked out at the
// mount). ?dry=1 builds everything and posts what it would do, touching
// nothing in Books.
//
// Discount rules (Mark): customer type sets the % (body shop 25 …);
// applies to SERVICES (calibrations, labor, PCSI, Post-Scan, Snapshot);
// never to goods/parts, the Calibration Identification Report, or the
// State Farm Post-Scan item; $0 lines untouched.
import express from 'express'
import axios from 'axios'
import { getAccessToken, getItemCatalogForAudit } from '../services/zoho.js'
import { readJobsPublic, updateJobPublic } from './jobs.js'
import { postToCliqChannel, DISPATCH_CHANNEL } from '../services/cliq.js'

const router = express.Router()
const API = 'https://www.zohoapis.com/books/v3'
const H = t => ({ Authorization: `Zoho-oauthtoken ${t}` })
const org = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const NO_DISCOUNT = /calibration identification report|^sfp?\s*[-\s].*post[- ]?scan/i
// Books' goods/service flag is unreliable (Pre-Calibration Scan, Subaru
// MonoCam, AMFAM scans… are typed "goods"). A line is a PART only when
// Books says goods AND the name doesn't read like work we did.
const LOOKS_LIKE_SERVICE = /scan|calibrat|inspection|labor|set-?up|program|diagnos|report|snapshot|aim|alignment|ride|remove|install|r&i|r & i/i
const isPart = l => l.product_type === 'goods' && !LOOKS_LIKE_SERVICE.test(l.name || '')

async function getEstimate(token, id) {
  const r = await axios.get(`${API}/estimates/${id}`, { headers: H(token), params: org(), timeout: 15000, validateStatus: s => s < 500 })
  return r.data?.estimate || null
}
async function invoiceByNumber(token, number) {
  const r = await axios.get(`${API}/invoices`, { headers: H(token), params: { ...org(), invoice_number: number }, timeout: 15000, validateStatus: s => s < 500 })
  return (r.data?.invoices || []).find(i => i.invoice_number === number) || null
}
async function contactEmails(token, customerId) {
  const r = await axios.get(`${API}/contacts/${customerId}/contactpersons`, { headers: H(token), params: org(), timeout: 15000, validateStatus: s => s < 500 })
  const persons = r.data?.contact_persons || []
  const primary = persons.filter(p => p.is_primary_contact && p.email)
  const withEmail = persons.filter(p => p.email)
  return [...new Set((primary.length ? primary : withEmail).map(p => String(p.email).toLowerCase()))]
}

// Everything the modal shows. Pure read except for nothing — no writes.
async function buildPreview(req, job) {
  if (!job.zoho_estimate_id) throw Object.assign(new Error('This card has no Books estimate to bill from.'), { status: 400 })
  const token = await getAccessToken()
  const [est, catalog, big3] = await Promise.all([
    getEstimate(token, job.zoho_estimate_id),
    getItemCatalogForAudit().catch(() => ({ allItems: [] })),
    import('../services/big3.js'),
  ])
  if (!est) throw Object.assign(new Error('Estimate not found in Books — was it deleted?'), { status: 404 })
  const shopName = est.customer_name || job.shop_name
  const rule = await big3.readBig3(req, shopName)
  const shop = rule.shop_id ? await big3.findShopByName(req, shopName) : null
  const br = shop?.billing_rules ? (typeof shop.billing_rules === 'string' ? JSON.parse(shop.billing_rules || '{}') : shop.billing_rules) : {}
  const pct = Number.isFinite(Number(br.discount_value)) ? Number(br.discount_value) : null
  const customerType = br.customer_type || ''
  const byName = new Map((catalog.allItems || []).map(it => [String(it.name).toLowerCase().trim(), it]))
  const byId = new Map((catalog.allItems || []).map(it => [String(it.item_id), it]))

  // Extra items the tech added at Ready to Invoice → real Books lines.
  let extras = []
  try { extras = job.extra_items ? JSON.parse(job.extra_items) : [] } catch { extras = [] }
  const extraLines = (Array.isArray(extras) ? extras : []).map(x => {
    const it = x.item_id ? byId.get(String(x.item_id)) : byName.get(String(x.name || '').toLowerCase().trim())
    const qty = Number(x.quantity) || 1
    const rate = x.rate != null ? Number(x.rate) : Number(it?.rate) || 0
    return { item_id: it?.item_id || null, name: it?.name || x.name || 'Extra', description: x.note || '', rate, quantity: qty, product_type: it?.product_type || 'service', _extra: true }
  })

  const lines = [
    ...(est.line_items || []).map(li => ({ item_id: li.item_id || null, name: li.name, description: li.description || '', rate: Number(li.rate) || 0, quantity: Number(li.quantity) || 1, product_type: byId.get(String(li.item_id))?.product_type || 'service', _extra: false })),
    ...extraLines,
  ]
  const discounted = lines.map(li => {
    const amount = r2(li.rate * li.quantity)
    const part = isPart(li)
    const eligible = pct != null && pct > 0 && amount > 0 && !part && !NO_DISCOUNT.test(li.name || '')
    const disc = eligible ? pct : 0
    const cost = r2(amount * (1 - disc / 100))
    return { ...li, amount, is_part: part, never_discount: NO_DISCOUNT.test(li.name || ''), discount_pct: disc, cost_amount: cost, why: !eligible && amount > 0 && pct ? (part ? 'part — no discount' : NO_DISCOUNT.test(li.name || '') ? 'never discounted' : '') : '' }
  })
  const insuranceTotal = r2(discounted.reduce((s, l) => s + l.amount, 0))
  const costTotal = r2(discounted.reduce((s, l) => s + l.cost_amount, 0))
  const existing = await invoiceByNumber(token, est.estimate_number)
  const emails = est.customer_id ? await contactEmails(token, est.customer_id).catch(() => []) : []
  const warnings = []
  if (existing) warnings.push(`Invoice ${existing.invoice_number} already exists in Books (${existing.status}) — billed by hand? The button will not create a second one.`)
  if (job.invoiced || job.billed_via_app) warnings.push(`This card is already marked invoiced${job.billed_via_app ? ` (via app ${job.billed_via_app})` : ''}.`)
  if (pct == null) warnings.push(`No cost-invoice discount on file for ${shopName} — set the customer type / % on the CRM Billing tab. Preview shows 0%.`)
  if (!emails.length) warnings.push('No email on the Books contact — add one in Books or type it below.')
  const alreadyConverted = est.status === 'invoiced'
  if (alreadyConverted) warnings.push('Books says this estimate was already converted to an invoice (by hand?) — the button will not bill it again.')
  return {
    ok: true, job_id: job.id, shop_name: shopName, estimate_id: est.estimate_id, estimate_number: est.estimate_number, estimate_status: est.status,
    customer_id: est.customer_id, customer_type: customerType, discount_pct: pct ?? 0, emails,
    lines: discounted, insurance_total: insuranceTotal, cost_total: costTotal, saved: r2(insuranceTotal - costTotal),
    extras_count: extraLines.length, existing_invoice: existing ? { number: existing.invoice_number, status: existing.status, total: existing.total } : null,
    can_bill: !existing && !alreadyConverted && !job.billed_via_app && !!emails.length, already_converted: alreadyConverted,
    warnings, rule: rule.rules ? big3.describeRules(rule.rules) : 'default',
  }
}

router.post('/:id/bill/preview', async (req, res) => {
  try {
    const job = (await readJobsPublic(req)).find(j => String(j.id) === String(req.params.id))
    if (!job) return res.status(404).json({ error: 'Job not found' })
    res.json(await buildPreview(req, job))
  } catch (e) { res.status(e.status || 500).json({ error: e.response?.data?.message || e.message }) }
})

router.post('/:id/bill', async (req, res) => {
  const dry = String(req.query.dry || req.body?.dry || '') === '1'
  try {
    const job = (await readJobsPublic(req)).find(j => String(j.id) === String(req.params.id))
    if (!job) return res.status(404).json({ error: 'Job not found' })
    const p = await buildPreview(req, job)
    const emails = (Array.isArray(req.body?.emails) && req.body.emails.length ? req.body.emails : p.emails).map(e => String(e).trim().toLowerCase()).filter(e => /.+@.+\..+/.test(e))
    if (!emails.length) return res.status(400).json({ error: 'No email to send to.' })
    if (p.existing_invoice) return res.status(409).json({ error: `Already billed — invoice ${p.existing_invoice.number} exists in Books.`, preview: p })
    if (job.billed_via_app) return res.status(409).json({ error: `Already billed via the app (${job.billed_via_app}).` })
    if (p.already_converted) return res.status(409).json({ error: `Already billed — Books shows estimate ${p.estimate_number} converted to an invoice.`, preview: p })
    const by = req.user?.name || req.user?.email || 'staff'
    const pct = Number(req.body?.discount_pct ?? p.discount_pct) || 0
    const token = await getAccessToken()

    // 1. Extras → estimate (so the insurance invoice carries them too)
    const extraLines = p.lines.filter(l => l._extra)
    if (extraLines.length && !dry) {
      const est = await getEstimate(token, p.estimate_id)
      const merged = [
        ...(est.line_items || []).map(li => ({ line_item_id: li.line_item_id, item_id: li.item_id, name: li.name, description: li.description, rate: li.rate, quantity: li.quantity })),
        ...extraLines.map(l => ({ ...(l.item_id ? { item_id: l.item_id } : { name: l.name }), description: l.description, rate: l.rate, quantity: l.quantity })),
      ]
      const u = await axios.put(`${API}/estimates/${p.estimate_id}`, { line_items: merged }, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 })
      if (u.data?.code !== 0) throw new Error(`Could not add extras to the estimate: ${u.data?.message || u.status}`)
    }
    // 2. Cost invoice FIRST (same lines, per-line discount, same number, Due
    //    on Receipt) — if Books rejects it, nothing has been emailed yet.
    const eligible = l => l.amount > 0 && !isPart(l) && !NO_DISCOUNT.test(l.name || '')
    p.lines = p.lines.map(l => { const d = pct > 0 && eligible(l) ? pct : 0; return { ...l, discount_pct: d, cost_amount: r2(l.amount * (1 - d / 100)) } })
    p.cost_total = r2(p.lines.reduce((s, l) => s + l.cost_amount, 0)); p.saved = r2(p.insurance_total - p.cost_total)
    const invLines = p.lines.map(l => ({
      ...(l.item_id ? { item_id: l.item_id } : { name: l.name }), description: l.description || '', rate: l.rate, quantity: l.quantity,
      ...(l.discount_pct > 0 ? { discount: `${l.discount_pct}%` } : {}),
    }))
    let inv = null
    if (!dry) {
      const body = {
        customer_id: p.customer_id, invoice_number: p.estimate_number, reference_number: job.quote_number || p.estimate_number,
        date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }), payment_terms: 0, payment_terms_label: 'Due on Receipt',
        discount_type: 'item_level', is_discount_before_tax: true, line_items: invLines,
        notes: `Cost invoice · ${pct}% partnership discount${p.customer_type ? ` (${p.customer_type.replace(/_/g, ' ')})` : ''} on services · billed via Absolute ADAS app by ${by} · from estimate ${p.estimate_number}`,
        custom_fields: [], salesperson_name: job.technician || '',
      }
      // Books auto-numbers invoices; this flag lets us reuse the estimate number.
      const c = await axios.post(`${API}/invoices`, body, { headers: H(token), params: { ...org(), ignore_auto_number_generation: true }, timeout: 20000, validateStatus: s => s < 500 })
      if (c.data?.code !== 0) {
        // Number collision / numbering rule → let Books number it, note the estimate in the reference.
        if (/number|already exists|duplicate/i.test(String(c.data?.message || ''))) {
          delete body.invoice_number
          const c2 = await axios.post(`${API}/invoices`, body, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 })
          if (c2.data?.code !== 0) throw new Error(`Cost invoice failed: ${c2.data?.message || c2.status}`)
          inv = c2.data.invoice
        } else throw new Error(`Cost invoice failed: ${c.data?.message || c.status}`)
      } else inv = c.data.invoice
      // 3. Insurance invoice = the estimate, emailed as-is
      const e1 = await axios.post(`${API}/estimates/${p.estimate_id}/email`, { to_mail_ids: emails }, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 })
      if (e1.data?.code !== 0) console.log('[bill-it] estimate email failed:', e1.data?.message)
      // 4. Email the cost invoice
      const e2 = await axios.post(`${API}/invoices/${inv.invoice_id}/email`, { to_mail_ids: emails }, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 })
      if (e2.data?.code !== 0) console.log('[bill-it] cost invoice email failed:', e2.data?.message)
      const emailNote = [e1.data?.code !== 0 ? `estimate email failed (${e1.data?.message})` : '', e2.data?.code !== 0 ? `invoice email failed (${e2.data?.message})` : ''].filter(Boolean).join('; ')
      if (emailNote) await postToCliqChannel(DISPATCH_CHANNEL, `⚠️ Bill it · ${p.shop_name} ${inv.invoice_number}: invoice created but ${emailNote} — send from Books by hand.`).catch(() => {})
      // Stamp the card
      await updateJobPublic(req, job.id, { ...job, invoiced: true, invoice_number: inv.invoice_number, invoice_status: inv.status || 'sent', billed_via_app: `${by} ${new Date().toISOString().slice(0, 16)}`,
        notes: `${job.notes ? job.notes + '\n' : ''}💸 Billed via app by ${by}: insurance invoice (estimate ${p.estimate_number}) + cost invoice ${inv.invoice_number} at ${pct}% → ${emails.join(', ')}` })
    }
    const summary = [
      `💸 *${dry ? 'DRY RUN — would bill' : 'Billed'} · ${p.shop_name}*`,
      `Insurance invoice (estimate ${p.estimate_number}) $${p.insurance_total.toFixed(2)} → ${emails.join(', ')}`,
      `Cost invoice ${inv?.invoice_number || p.estimate_number} at ${pct}% → $${p.cost_total.toFixed(2)} (saves the shop $${p.saved.toFixed(2)})${p.extras_count ? ` · ${p.extras_count} extra item${p.extras_count === 1 ? '' : 's'} added` : ''}`,
      `by ${by}`,
    ].join('\n')
    await postToCliqChannel(DISPATCH_CHANNEL, summary).catch(() => {})
    console.log(`[bill-it] ${dry ? 'DRY' : 'LIVE'} ${p.shop_name} ${p.estimate_number} ${pct}% by ${by}`)
    res.json({ ok: true, dry, invoice: inv ? { number: inv.invoice_number, id: inv.invoice_id, total: inv.total } : null, emails, preview: p })
  } catch (e) {
    console.error('[bill-it]', e.message)
    res.status(e.status || 500).json({ error: e.response?.data?.message || e.message })
  }
})

export default router
