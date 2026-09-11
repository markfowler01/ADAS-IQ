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
import { getAccessToken, getItemCatalogForAudit, resolvePricingPool, paidAlternativeFor } from '../services/zoho.js'
import { readJobsPublic, updateJobPublic } from './jobs.js'
import { postToCliqChannel, DISPATCH_CHANNEL } from '../services/cliq.js'

import axios from 'axios'
import { getEstimate, resolveTemplates, applyEstimateTemplate, applyDiscount, isPart, NO_DISCOUNT, invoiceCustomFields, createCostInvoice, emailEstimate, emailInvoice, ensureLinked } from '../services/costInvoice.js'
import catalyst from 'zcatalyst-sdk-node'
const router = express.Router()
const API = 'https://www.zohoapis.com/books/v3'
const H = t => ({ Authorization: `Zoho-oauthtoken ${t}` })
const org = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
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
    ...(est.line_items || []).map(li => ({ line_item_id: li.line_item_id, item_id: li.item_id || null, name: li.name, description: li.description || '', rate: Number(li.rate) || 0, quantity: Number(li.quantity) || 1, product_type: byId.get(String(li.item_id))?.product_type || 'service', _extra: false })),
    ...extraLines,
  ]
  const insurerCf = (est.custom_fields || []).find(c => c.label === 'Insurer')?.value || job.insurer || ''
  const big3Block = { rules: big3.withDefaults(rule.rules), set_by: rule.set_by || '', set_at: rule.set_at || '', has_rule: !!rule.rules, items: big3Items(big3, catalog, byName, insurerCf) }
  const discounted = lines.map(li => {
    const amount = r2(li.rate * li.quantity)
    const part = isPart(li)
    const eligible = pct != null && pct > 0 && amount > 0 && !part && !NO_DISCOUNT.test(li.name || '')
    const disc = eligible ? pct : 0
    const cost = r2(amount * (1 - disc / 100))
    return { ...li, amount, big3_key: big3KeyFor(li.name), is_part: part, never_discount: NO_DISCOUNT.test(li.name || ''), discount_pct: disc, cost_amount: cost, why: !eligible && amount > 0 && pct ? (part ? 'part — no discount' : NO_DISCOUNT.test(li.name || '') ? 'never discounted' : '') : '' }
  })
  const insuranceTotal = r2(discounted.reduce((s, l) => s + l.amount, 0))
  const costTotal = r2(discounted.reduce((s, l) => s + l.cost_amount, 0))
  const tpl = await resolveTemplates(token, customerType)
  let existing = await invoiceByNumber(token, est.estimate_number)
  // Books' own link (Convert to Invoice, or our invoiced_estimate_id) — catches a hand conversion under a different number.
  if (!existing && Array.isArray(est.invoice_ids) && est.invoice_ids.length) {
    const r = await axios.get(`${API}/invoices/${est.invoice_ids[0]}`, { headers: H(token), params: org(), timeout: 15000, validateStatus: s => s < 500 }).catch(() => null)
    if (r?.data?.invoice) existing = r.data.invoice
  }
  const emails = est.customer_id ? await contactEmails(token, est.customer_id).catch(() => []) : []
  const warnings = []
  if (existing) warnings.push(`Invoice ${existing.invoice_number} already exists in Books (${existing.status}) — billed by hand? The button will not create a second one.`)
  if (job.invoiced || job.billed_via_app) warnings.push(`This card is already marked invoiced${job.billed_via_app ? ` (via app ${job.billed_via_app})` : ''}.`)
  if (pct == null) warnings.push(`No cost-invoice discount on file for ${shopName} — set the customer type / % on the CRM Billing tab. Preview shows 0%.`)
  if (!emails.length) warnings.push('No email on the Books contact — add one in Books or type it below.')
  if (!tpl.estimate) warnings.push('No estimate PDF template named "Absolute List invoice" in Books — the button will not send until it exists.')
  if (!tpl.invoice) warnings.push('No invoice PDF template named "Absolute ADAS vrs 1" (or "Retail…") in Books — the button will not send until it exists.')
  const alreadyConverted = est.status === 'invoiced'
  if (alreadyConverted) warnings.push('Books says this estimate was already converted to an invoice (by hand?) — the button will not bill it again.')
  return {
    ok: true, job_id: job.id, shop_name: shopName, estimate_id: est.estimate_id, estimate_number: est.estimate_number, estimate_status: est.status,
    customer_id: est.customer_id, customer_type: customerType, discount_pct: pct ?? 0, has_discount: pct != null, emails,
    cash_quoted: String(job.cash_quoted || ''), tires_set: String(job.tires_set || ''),
    lines: discounted, insurance_total: insuranceTotal, cost_total: costTotal, saved: r2(insuranceTotal - costTotal),
    extras_count: extraLines.length, existing_invoice: existing ? { number: existing.invoice_number, status: existing.status, total: existing.total } : null,
    can_bill: !existing && !alreadyConverted && !job.billed_via_app && !!emails.length && !!tpl.estimate && !!tpl.invoice, already_converted: alreadyConverted,
    templates: { estimate: tpl.estimate, invoice: tpl.invoice, estimate_current: est.template_name || '' },
    big3: big3Block,
    warnings, rule: rule.rules ? big3.describeRules(rule.rules) : 'default',
    _byId: byId, _byName: byName,
    _est: { custom_fields: est.custom_fields || [], terms: est.terms || '', notes: est.notes || '', reference_number: est.reference_number || '', salesperson_name: est.salesperson_name || '' },
  }
}
const pub = p => { const { _byId, _byName, _est, ...rest } = p; return rest }

// Which Big 4 slot a line belongs to (by name — Books items vary by insurer pool).
export function big3KeyFor(name) {
  const n = String(name || '').toLowerCase()
  if (/calibration identification report/.test(n)) return 'cal_id'
  if (/post collision safety inspection|\bpcsi\b/.test(n)) return 'pcsi'
  if (/calibration snapshot/.test(n)) return 'snapshot'
  if (/post[- ]?(calibration )?scan/.test(n)) return 'post_scan'
  return null
}
// The base "(included)" $0 item and the paid item per slot, for THIS shop's insurer pool.
function big3Items(big3, catalog, byName, insurer) {
  const pool = resolvePricingPool(insurer, null)
  const out = {}
  for (const b of big3.BIG3) {
    const base = b.base ? byName.get(b.base.toLowerCase()) : null
    const paid = byName.get(String(b.paid).toLowerCase())
      || (b.base ? paidAlternativeFor(catalog.allItems || [], pool, b.base) : null)
      || (b.paidFallback ? byName.get(b.paidFallback.toLowerCase()) : null)
    out[b.key] = {
      label: b.label, modes: b.modes || ['charge', 'included'],
      base: base ? { item_id: base.item_id, name: base.name, rate: 0, product_type: base.product_type || 'service' } : null,
      paid: paid ? { item_id: paid.item_id, name: paid.name, rate: Number(paid.rate) || 0, product_type: paid.product_type || 'service' } : null,
    }
  }
  return out
}

// Kat edited the lines in the modal → rebuild the line set from her list.
function linesFromEdit(p, edited) {
  return edited.map(x => {
    const it = x.item_id ? p._byId.get(String(x.item_id)) : p._byName.get(String(x.name || '').toLowerCase().trim())
    const rate = r2(x.rate), quantity = Number(x.quantity) || 1
    const name = it?.name || x.name || 'Item'
    const product_type = it?.product_type || x.product_type || 'service'
    const amount = r2(rate * quantity)
    return { line_item_id: x.line_item_id || null, item_id: it?.item_id || x.item_id || null, name, description: x.description || '', rate, quantity, product_type, amount, is_part: isPart({ product_type, name }), never_discount: NO_DISCOUNT.test(name), _extra: !!x._extra, _edited: true }
  }).filter(l => l.quantity > 0)
}

router.post('/:id/bill/preview', async (req, res) => {
  try {
    const job = (await readJobsPublic(req)).find(j => String(j.id) === String(req.params.id))
    if (!job) return res.status(404).json({ error: 'Job not found' })
    res.json(pub(await buildPreview(req, job)))
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
    if (p.existing_invoice) return res.status(409).json({ error: `Already billed — invoice ${p.existing_invoice.number} exists in Books.`, preview: pub(p) })
    if (job.billed_via_app) return res.status(409).json({ error: `Already billed via the app (${job.billed_via_app}).` })
    if (p.already_converted) return res.status(409).json({ error: `Already billed — Books shows estimate ${p.estimate_number} converted to an invoice.`, preview: pub(p) })
    if (!p.templates.estimate || !p.templates.invoice) return res.status(400).json({ error: 'PDF template missing in Books — see the warning above. Nothing sent.', preview: pub(p) })
    const by = req.user?.name || req.user?.email || 'staff'
    const pct = Number(req.body?.discount_pct ?? p.discount_pct) || 0
    const token = await getAccessToken()

    // 1. Make the Books estimate match what Kat approved on the left side:
    //    her edits (price / qty / removed / added) + the tech's extras.
    //    The insurance invoice IS the estimate, so both documents agree.
    const edited = Array.isArray(req.body?.lines) ? linesFromEdit(p, req.body.lines) : null
    if (edited) {
      if (!edited.length) return res.status(400).json({ error: 'Nothing left to bill — the estimate needs at least one line.' })
      p.lines = edited
      p.insurance_total = r2(edited.reduce((s, l) => s + l.amount, 0))
    }
    const original = (await getEstimate(token, p.estimate_id))?.line_items || []
    const same = original.length === p.lines.length && original.every((li, i) => {
      const l = p.lines[i]; return l && String(li.item_id || '') === String(l.item_id || '') && r2(li.rate) === r2(l.rate) && Number(li.quantity) === Number(l.quantity) && (li.name === l.name)
    })
    if (!same && !dry) {
      const lineItems = p.lines.map(l => ({
        ...(l.line_item_id ? { line_item_id: l.line_item_id } : {}), ...(l.item_id ? { item_id: l.item_id } : { name: l.name }),
        description: l.description || '', rate: l.rate, quantity: l.quantity,
      }))
      const u = await axios.put(`${API}/estimates/${p.estimate_id}`, { line_items: lineItems }, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 })
      if (u.data?.code !== 0) throw new Error(`Could not update the estimate in Books: ${u.data?.message || u.status}`)
      // Books re-issues line_item_ids; re-read so the invoice mirrors exactly what it now holds.
      const fresh = (u.data.estimate?.line_items || [])
      if (fresh.length === p.lines.length) p.lines = p.lines.map((l, i) => ({ ...l, line_item_id: fresh[i].line_item_id, item_id: fresh[i].item_id || l.item_id, rate: r2(fresh[i].rate), quantity: Number(fresh[i].quantity), amount: r2(fresh[i].rate * fresh[i].quantity) }))
      p.insurance_total = r2(p.lines.reduce((s, l) => s + l.amount, 0))
    }
    const changedLines = !same
    // Big 4 rule from the modal → remember for the shop (pings #dispatch like the review modal).
    // Learn (Mark 2026-09-11): a shop with no rule yet gets whatever this
    // first invoice used — no switch needed. Shops with a rule only change
    // when Kat flips a switch and leaves "remember" on.
    // Remember the discount too (Mark 2026-09-11: "if I set their discount to
    // 25% I want it to remember this") — whenever it differs from the file.
    const learnPct = !dry && (!p.has_discount || Number(p.discount_pct) !== pct)
    const saveRules = req.body?.big3_rules && (req.body?.big3_save === true || (!p.big3?.has_rule && req.body?.big3_save !== false))
    if (!dry && (saveRules || learnPct)) {
      try {
        const b3 = await import('../services/big3.js')
        const want = saveRules ? b3.withDefaults(req.body.big3_rules) : b3.withDefaults(p.big3?.rules)
        const r = await b3.saveBig3(req, p.shop_name, want, by, learnPct ? { discount_pct: pct, customer_type: p.customer_type || 'body_shop' } : {})
        if (r?.changed) console.log(`[bill-it] learned for ${p.shop_name}: ${b3.describeRules(want)}${learnPct ? ` · ${pct}%` : ''}`)
      } catch (e) { console.log('[bill-it] rule/discount save failed (non-fatal):', e.message) }
    }
    // Pin the insurance-invoice look before anything is emailed (strict, like shop quotes).
    if (!dry) await applyEstimateTemplate(token, p.estimate_id, p.templates.estimate)
    // 2. Cost invoice FIRST — same lines, per-line rule at the % Kat chose,
    //    same number, Due on Receipt, Kat's header/notes/terms. If Books
    //    rejects it, nothing has been emailed yet.
    p.lines = applyDiscount(p.lines, pct)
    p.cost_total = r2(p.lines.reduce((s, l) => s + l.cost_amount, 0)); p.saved = r2(p.insurance_total - p.cost_total)
    let inv = null
    if (!dry) {
      const estFull = await getEstimate(token, p.estimate_id)
      inv = await createCostInvoice({ token, app: catalyst.initialize(req), est: estFull, lines: p.lines, pct, customerType: p.customer_type, technician: job.technician, by, templates: p.templates })
      // 3. Insurance invoice = the estimate, emailed as-is. 4. Cost invoice emailed.
      const e1 = await emailEstimate(token, p.estimate_id, emails)
      const e2 = await emailInvoice(token, inv.invoice_id, emails)
      const quoteStatus = await ensureLinked(token, inv.invoice_id, p.estimate_id)
      console.log(`[bill-it] quote ${p.estimate_number} status after billing: ${quoteStatus}`)
      const emailNote = [e1 ? `estimate email failed (${e1})` : '', e2 ? `invoice email failed (${e2})` : ''].filter(Boolean).join('; ')
      if (emailNote) await postToCliqChannel(DISPATCH_CHANNEL, `⚠️ Bill it · ${p.shop_name} ${inv.invoice_number}: invoice created but ${emailNote} — send from Books by hand.`).catch(() => {})
      // Stamp the card
      // Mark 2026-09-11: "after I send both invoices… I want it gone" → Completed column.
      await updateJobPublic(req, job.id, { ...job, status: 'complete', invoiced: true, invoice_number: inv.invoice_number, invoice_status: inv.status || 'sent', billed_via_app: `${by} ${new Date().toISOString().slice(0, 16)}`,
        notes: `${job.notes ? job.notes + '\n' : ''}💸 Billed via app by ${by}: insurance invoice (estimate ${p.estimate_number}) + cost invoice ${inv.invoice_number} at ${pct}% → ${emails.join(', ')}` })
    }
    const summary = [
      `💸 *${dry ? 'DRY RUN — would bill' : 'Billed'} · ${p.shop_name}*`,
      `Insurance invoice (estimate ${p.estimate_number}) $${p.insurance_total.toFixed(2)} → ${emails.join(', ')}`,
      `Cost invoice ${inv?.invoice_number || p.estimate_number} at ${pct}% → $${p.cost_total.toFixed(2)} (saves the shop $${p.saved.toFixed(2)})${p.extras_count ? ` · ${p.extras_count} extra item${p.extras_count === 1 ? '' : 's'} added` : ''}`,
      changedLines ? `Estimate ${p.estimate_number} updated in Books to match the review` : '',
      `Templates: ${p.templates.estimate.name} / ${p.templates.invoice.name}`,
      `by ${by}`,
    ].filter(Boolean).join('\n')
    await postToCliqChannel(DISPATCH_CHANNEL, summary).catch(() => {})
    console.log(`[bill-it] ${dry ? 'DRY' : 'LIVE'} ${p.shop_name} ${p.estimate_number} ${pct}% by ${by}`)
    res.json({ ok: true, dry, invoice: inv ? { number: inv.invoice_number, id: inv.invoice_id, total: inv.total } : null, emails, estimate_updated: changedLines, preview: pub(p) })
  } catch (e) {
    console.error('[bill-it]', e.message)
    res.status(e.status || 500).json({ error: e.response?.data?.message || e.message })
  }
})

export default router
