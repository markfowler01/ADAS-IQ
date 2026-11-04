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
import { getEstimate, resolveTemplates, applyEstimateTemplate, applyDiscount, isPart, NO_DISCOUNT, discountEligible, invoiceCustomFields, createCostInvoice, createSingleInvoice, retailTax, emailEstimate, emailInvoice, ensureLinked } from '../services/costInvoice.js'
import catalyst from 'zcatalyst-sdk-node'
import { attachJobReports } from '../services/reportAttach.js'
import { isCashJob, isCashCustomer } from '../services/cashPricing.js'
import { defaultPct, repriceLines, clampPct } from '../services/billDefaults.js'
import { kvGet, kvSet } from '../services/durableKV.js'
import { presentScanLine } from '../services/big3.js'
import { DIAG_RULES, DIAG_PILL, looksDiagOnly, diagState, stripBig4 } from '../services/diagOnly.js'
const router = express.Router()
const API = 'https://www.zohoapis.com/books/v3'
const H = t => ({ Authorization: `Zoho-oauthtoken ${t}` })
const org = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
// 💵 Cash switch + editable % (Mark 2026-11-02) — Mark and Kat only.
const isOffice = req => ['mark@absoluteadas.com', 'mf@absoluteadas.com', 'mfowler4456@gmail.com'].includes(String(req.user?.email || '').toLowerCase()) || req.user?.role === 'owner'
// The switch is saved per card (DurableKV cash_switch:<id>) so reopening Bill it keeps it.
// Paper trail on the card + #dispatch: "· cash job, default 15" / "· 💵 cash OFF by Kat".
function pctNote(p, pct) {
  const bits = []
  if (p.cash_switch && p.cash_switch.on === false) bits.push(`💵 cash OFF by ${p.cash_switch.by}`)
  if (p.cash_switch && p.cash_switch.on === true) bits.push(`💵 cash ON by ${p.cash_switch.by}`)
  if ((p.pct_source === 'cash' || p.pct_source === 'insurer') && Number(pct) !== Number(p.pct_default)) bits.push(`${p.pct_label} default is ${p.pct_default}%`)
  return bits.length ? ` (${bits.join(' · ')})` : ''
}
async function readCashSwitch(req, jobId) {
  try { const v = await kvGet(catalyst.initialize(req), `cash_switch:${jobId}`); const o = v ? JSON.parse(v) : null; return typeof o?.on === 'boolean' ? o : null } catch { return null }
}
async function cashSwitchFor(req, job) {
  const asked = req.body?.cash
  const saved = await readCashSwitch(req, job.id)
  if (typeof asked !== 'boolean' || !isOffice(req)) return saved
  if (saved?.on !== asked) {
    const rec = { on: asked, by: req.user?.name || req.user?.email || 'staff', at: new Date().toISOString() }
    try { await kvSet(catalyst.initialize(req), `cash_switch:${job.id}`, rec) } catch (e) { console.warn('[bill-it] cash switch save', e.message) }
    return rec
  }
  return saved
}
// 🔌 Diag only (Mark 2026-11-03): a per-car switch on the job state, never the
// shop's CRM rule. Kat's flip in the window is saved like the cash switch.
async function diagSwitchFor(req, job) {
  const { readJobState, updateJobStateFields } = await import('../services/dispatch.js')
  const saved = (await readJobState(req).catch(() => ({})))[String(job.id)]?.diag_only || null
  const asked = req.body?.diag_only
  if (typeof asked !== 'boolean' || saved?.on === asked) return saved
  const rec = { on: asked, by: req.user?.name || req.user?.email || 'staff', at: new Date().toISOString() }
  try { await updateJobStateFields(req, job.id, { diag_only: rec }) } catch (e) { console.warn('[bill-it] diag switch save', e.message) }
  return rec
}
// Diag on → every Big 4 line comes off this invoice; the shop's own rule rides along untouched.
function applyDiag(lines, big3Block, saved) {
  const diag = diagState(saved, looksDiagOnly(lines))
  if (!diag.on) return { lines, big3Block, diag: { ...diag, pill: '' } }
  return { lines: stripBig4(lines), big3Block: { ...big3Block, shop_rules: big3Block.rules, rules: { ...DIAG_RULES }, diag: true }, diag: { ...diag, pill: DIAG_PILL } }
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
async function buildPreview(req, job, pickType = '') {
  const sw = await cashSwitchFor(req, job)
  const diagSaved = await diagSwitchFor(req, job)
  const cashOverride = sw ? sw.on : null
  // Single-invoice mode (Mark 2026-09-22): the shop's customer type
  // decides. Repair shops, dealers and retail get ONE invoice straight
  // from the job's lines; so does any card with no Books estimate.
  // Phase F: an estimator estimate tied to this card IS the document — no re-pricing here.
  try {
    const { estimateForJob } = await import('./estimator.js')
    const est = await estimateForJob(req, job.id)
    if (est && est.status !== 'declined' && est.status !== 'draft') return buildEstimatorPreview(req, job, est)
  } catch (e) { console.log('[bill-it] estimate lookup failed (falling through):', e.message) }
  const big3mod = await import('../services/big3.js')
  const isRetailJob = job.customer?.kind === 'retail'
  const shopRow = isRetailJob ? null : await big3mod.findShopByName(req, job.shop_name).catch(() => null)
  const brSaved = isRetailJob ? { customer_type: 'retail', discount_value: 0, pay_mode: 'on_site' } : (shopRow?.billing_rules ? (typeof shopRow.billing_rules === 'string' ? JSON.parse(shopRow.billing_rules || '{}') : shopRow.billing_rules) : {})
  // Four pills on the modal (Mark 2026-09-22): the pick wins over the file
  // for this preview; sending learns it on the shop. A person is always retail.
  const pick = !isRetailJob && big3mod.CUSTOMER_TYPES[pickType] ? pickType : ''
  const brEarly = pick && pick !== brSaved.customer_type
    ? { ...brSaved, customer_type: pick, discount_value: big3mod.CUSTOMER_TYPES[pick].discount ?? 0, pay_mode: big3mod.CUSTOMER_TYPES[pick].pay }
    : brSaved
  const ctypeEarly = (cashOverride ?? !!String(job.cash_quoted || '').trim()) ? 'cash' : (brEarly.customer_type || '')
  const extra = { saved_type: brSaved.customer_type || '', can_dual: !!job.zoho_estimate_id, customer_types: big3mod.CUSTOMER_TYPES, cash_switch: sw, can_switch_cash: isOffice(req) }
  // 🧾 Collision = two invoices, always (Mark 2026-10-01). Two invoices are built
  // from the job's Books estimate; a collision card without one (built by hand,
  // or a link lost on a save) gets its estimate created right here from the
  // card's calibrations, then bills like any other collision job.
  if (!job.zoho_estimate_id && !isRetailJob && big3mod.billingModeFor(ctypeEarly) === 'dual') {
    const made = await ensureCollisionEstimate(req, job, shopRow).catch(e => { console.warn('[bill-it] auto-estimate failed:', e.message); return { error: e.message } })
    if (made?.id) { job = { ...job, zoho_estimate_id: made.id, quote_number: made.number }; extra.can_dual = true; extra.estimate_created = made.number }
    else extra.estimate_missing = made?.error || 'No calibrations on the card yet. Add the work on the card, then Bill it makes both invoices.'
  }
  if (!job.zoho_estimate_id || big3mod.billingModeFor(ctypeEarly) === 'single') return { ...(await buildSinglePreview(req, job, shopRow, brEarly, cashOverride, diagSaved)), ...extra }
  const dual = await buildDualPreview(req, job, brEarly, cashOverride, diagSaved)
  return { ...dual, ...extra }
}
// Create the Books estimate for a collision card that has none, from the card's
// enabled calibrations (same createDraftQuote the quote screen uses), and save
// the link on the card. One at a time per card (Cache lock) so two opens of the
// modal can't make two estimates.
async function ensureCollisionEstimate(req, job, shopRow) {
  let cals = []
  try { cals = (typeof job.calibrations === 'string' ? JSON.parse(job.calibrations || '[]') : (job.calibrations || [])).filter(c => c && c.enabled !== false) } catch { cals = [] }
  if (!cals.length) return null
  const seg = catalyst.initialize(req, { type: 'advancedio' }).cache().segment()
  const k = `auto_est:${job.id}`
  try { if (await seg.getValue(k)) return { error: 'The estimate is being created. Close and reopen Bill it in a few seconds.' }; await seg.put(k, '1', 1) } catch { /* no cache — carry on */ }
  const token = await getAccessToken()
  let customerId = shopRow?.zoho_contact_id || job.zoho_customer_id || ''
  let customerName = shopRow?.shop_name || job.shop_name || ''
  if (!customerId && customerName) {
    const r = await axios.get(`${API}/contacts`, { headers: H(token), params: { ...org(), contact_name: customerName }, timeout: 15000, validateStatus: st => st < 500 }).catch(() => null)
    const hit = (r?.data?.contacts || []).find(c => String(c.contact_name).toLowerCase() === customerName.toLowerCase())
    if (hit) { customerId = hit.contact_id; customerName = hit.contact_name }
  }
  if (!customerId) return { error: `${customerName || 'This shop'} isn't linked to a Books customer yet. Link it on the CRM card (Billing tab), then Bill it again.` }
  const b3 = await import('../services/big3.js')
  const rules = b3.effectiveBig3((await b3.readBig3(req, customerName)).rules, job.insurer).rules
  const { createDraftQuote } = await import('../services/zoho.js')
  const ro = String(job.ro_number || job.quote_number || (job.vin ? String(job.vin).slice(-8) : '') || '').trim()
  const est = await createDraftQuote({
    collision: String(job.insurer || '').toLowerCase() !== 'cash', customerId, customerName, shop: job.shop_name, ro_number: ro,
    vin: job.vin || '', vehicle: job.vehicle || '', year: job.year || '', make: job.make || '', model: job.model || '', insurer: job.insurer || '', claim: '',
    calibrations: cals.map(c => ({ calibration_name: c.calibration_name || c.name, enabled: true, cal_type: c.cal_type || '', trigger: c.trigger || '', line_references: c.line_references || '', justification: c.justification || '' })),
    notes: 'Created by Bill it: this collision card had no estimate.', big3Rules: rules, req,
  })
  const id = String(est?.quoteId || ''), number = est?.quoteNumber || ''
  if (!id) return { error: 'Books did not return an estimate.' }
  await updateJobPublic(req, job.id, { zoho_estimate_id: id, quote_number: number, quote_url: est.quoteUrl || '', ...(!job.folder_url && est.folderUrl ? { folder_url: est.folderUrl } : {}) })
  console.log(`[bill-it] ${job.shop_name}: created estimate ${number} for card ${job.id} (collision, had none)`)
  postToCliqChannel(DISPATCH_CHANNEL, `🧾 *Estimate ${number} created by Bill it* · ${job.shop_name} · ${job.vehicle || ''}. The collision card had no estimate, so two invoices can go out.`).catch(() => {})
  return { id, number }
}

async function buildDualPreview(req, job, brPicked, cashOverride = null, diagSaved = null) {
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
  const br = brPicked || (shop?.billing_rules ? (typeof shop.billing_rules === 'string' ? JSON.parse(shop.billing_rules || '{}') : shop.billing_rules) : {})
  const estInsurer = (est.custom_fields || []).find(c => c.label === 'Insurer')?.value || ''
  const cashJob = cashOverride ?? isCashJob(job, { insurer: estInsurer, lines: est.line_items })
  // The real insurer behind a cash swap (Swap to Cash writes "Cash" over it) — null pool = standard list.
  const realInsurer = [estInsurer, job.insurer].find(i => String(i || '').trim() && !isCashCustomer({ insurer: i })) || ''
  const realPool = resolvePricingPool(realInsurer, null)
  const dflt = defaultPct({ cash: cashJob, pool: realPool, shopPct: br.discount_value })
  const pct = dflt.pct
  const customerType = cashJob ? 'cash' : (br.customer_type || '')
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

  let lines = [
    ...(est.line_items || []).map(li => { const shown = presentScanLine(li.name, li.description); return { line_item_id: li.line_item_id, item_id: li.item_id || null, name: shown.name, description: shown.description, rate: Number(li.rate) || 0, quantity: Number(li.quantity) || 1, product_type: byId.get(String(li.item_id))?.product_type || 'service', _extra: false } }),
    ...extraLines,
  ]
  const insurerCf = (est.custom_fields || []).find(c => c.label === 'Insurer')?.value || job.insurer || ''
  const effB3 = big3.effectiveBig3(rule.rules, insurerCf)
  let big3Block = { rules: effB3.rules, insurer_rule: effB3.insurer_rule, set_by: rule.set_by || '', set_at: rule.set_at || '', has_rule: !!rule.rules || !!effB3.insurer_rule, items: big3Items(big3, catalog, byName, insurerCf) }
  const dg = applyDiag(lines, big3Block, diagSaved); lines = dg.lines; big3Block = dg.big3Block
  const discounted = lines.map(li => {
    const amount = r2(li.rate * li.quantity)
    const part = isPart(li)
    const eligible = pct != null && pct > 0 && discountEligible({ ...li, amount })
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
  if (pct == null && !cashJob) warnings.push(`No cost-invoice discount on file for ${shopName} — set the customer type / % on the CRM Billing tab. Preview shows 0%.`)
  if (cashOverride === false && job.cash_quoted) warnings.push(`💵 Cash is switched OFF, but the customer was told $${job.cash_quoted}. This bills list price.`)
  // 💲 One-tap reprice onto the list that matches the switch (CP ⇄ standard / insurer).
  const rp = repriceLines(lines, cashJob ? 'CP' : realPool, catalog.allItems || [])
  const reprice = rp.changed ? { to: cashJob ? 'cash list (CP · $700 max)' : realPool ? `${realInsurer} list` : 'standard list', lines: rp.lines.map(l => ({ ...l, big3_key: big3KeyFor(l.name) })), missing: rp.missing, from_total: rp.from_total, to_total: rp.to_total } : null
  if (!emails.length) warnings.push('No email on the Books contact — add one in Books or type it below.')
  if (!tpl.estimate) warnings.push('No estimate PDF template named "Absolute List invoice" in Books — the button will not send until it exists.')
  if (!tpl.invoice) warnings.push('No invoice PDF template named "Absolute ADAS vrs 1" (or "Retail…") in Books — the button will not send until it exists.')
  const alreadyConverted = est.status === 'invoiced'
  if (alreadyConverted) warnings.push('Books says this estimate was already converted to an invoice (by hand?) — the button will not bill it again.')
  return {
    ok: true, mode: 'dual', job_id: job.id, shop_name: shopName, estimate_id: est.estimate_id, estimate_number: est.estimate_number, estimate_status: est.status,
    customer_id: est.customer_id, customer_type: customerType, discount_pct: pct ?? 0, has_discount: pct != null, emails, cash_job: cashJob,
    pct_source: dflt.source, pct_label: dflt.label, pct_default: pct ?? 0, shop_pct: Number.isFinite(Number(br.discount_value)) ? Number(br.discount_value) : null, reprice, est_insurer: estInsurer, real_insurer: realInsurer,
    cash_quoted: String(job.cash_quoted || ''), tires_set: String(job.tires_set || ''),
    lines: discounted, insurance_total: insuranceTotal, cost_total: costTotal, saved: r2(insuranceTotal - costTotal),
    extras_count: extraLines.length, existing_invoice: existing ? { number: existing.invoice_number, status: existing.status, total: existing.total } : null,
    can_bill: !existing && !alreadyConverted && !job.billed_via_app && !!emails.length && !!tpl.estimate && !!tpl.invoice, already_converted: alreadyConverted,
    templates: { estimate: tpl.estimate, invoice: tpl.invoice, estimate_current: est.template_name || '' },
    big3: big3Block, diag_only: dg.diag,
    warnings, rule: rule.rules ? big3.describeRules(rule.rules) : 'default',
    _byId: byId, _byName: byName,
    _est: { custom_fields: est.custom_fields || [], terms: est.terms || '', notes: est.notes || '', reference_number: est.reference_number || '', salesperson_name: est.salesperson_name || '' },
  }
}
// ONE invoice, priced from the job itself — the same engine the
// calibration review uses (pools, tiers, Big 3) plus the tech's extras.
async function buildSinglePreview(req, job, shop, br, cashOverride = null, diagSaved = null) {
  const token = await getAccessToken()
  const big3 = await import('../services/big3.js')
  const retailJob = job.customer?.kind === 'retail'
  const cashJob = cashOverride ?? !!String(job.cash_quoted || '').trim()
  const customerType = cashJob ? 'cash' : (br.customer_type || '')
  const typeDef = big3.CUSTOMER_TYPES[customerType] || null
  const cashRule = cashOverride ?? isCashJob(job)
  // Cash switched off on a card whose insurer says Cash → price the standard list, not CP.
  const cashOffInsurer = !cashRule && isCashCustomer(job)
  const dflt = defaultPct({ cash: cashRule, pool: retailJob || cashOffInsurer ? null : resolvePricingPool(job.insurer, null), shopPct: Number.isFinite(Number(br.discount_value)) ? br.discount_value : (typeDef?.discount ?? null) })
  const pct = dflt.pct
  const payMode = br.pay_mode || typeDef?.pay || 'on_site'
  const catalog = await getItemCatalogForAudit().catch(() => ({ allItems: [] }))
  const zohoMod = await import('../services/zoho.js')
  const byName = new Map((catalog.allItems || []).map(it => [String(it.name).toLowerCase().trim(), it]))
  const byId = new Map((catalog.allItems || []).map(it => [String(it.item_id), it]))
  let cals = []; try { cals = JSON.parse(job.calibrations || '[]') } catch { cals = [] }
  cals = (Array.isArray(cals) ? cals : []).filter(c => c && (c.enabled !== false)).map(c => ({ calibration_name: c.calibration_name || c.name || String(c), cal_type: c.cal_type || '', quantity: Number(c.quantity) || 1 }))
  const rule = await big3.readBig3(req, job.shop_name)
  const effB3 = big3.effectiveBig3(rule.rules, job.insurer)
  let priced = { lines: [] }
  if (cals.length) {
    const { previewInvoiceLines } = await import('../services/zoho.js')
    // A retail person bills the STANDARD list ($450 a static) + tax, no discount
    // (Mark 2026-09-22: "standard price at 450"). Only a cash-quoted shop job uses the CP schedule.
    const { alignmentInvoiceOn } = await import('../services/alignmentInvoice.js')
    priced = await previewInvoiceLines({ insurer: cashJob ? 'Cash' : (retailJob || cashOffInsurer ? '' : (job.insurer || '')), make: job.make || '', vehicle: job.vehicle || '', calibrations: cals, req, poolOverride: cashJob ? 'CP' : (retailJob || cashOffInsurer ? 'STD' : null), big3Rules: effB3.rules, collision: customerType === 'body_shop', alignmentOn: alignmentInvoiceOn(br) })
  }
  let extras = []; try { extras = job.extra_items ? JSON.parse(job.extra_items) : [] } catch { extras = [] }
  const extraLines = (Array.isArray(extras) ? extras : []).map(x => {
    let it = x.item_id ? byId.get(String(x.item_id)) : byName.get(String(x.name || '').toLowerCase().trim())
    if (it && customerType === 'body_shop' && x.rate == null) { const { collisionTwin } = zohoMod; it = collisionTwin(it, catalog.allItems) || it }
    return { item_id: it?.item_id || null, name: it?.name || x.name || 'Extra', description: x.note || '', rate: x.rate != null ? Number(x.rate) : Number(it?.rate) || 0, quantity: Number(x.quantity) || 1, product_type: it?.product_type || 'service', _extra: true }
  })
  let lines = [
    ...(priced.lines || []).filter(l => !l.needs_price || Number(l.rate) > 0).map(l => { const it = byName.get(String(l.name || '').toLowerCase().trim()); return { item_id: it?.item_id || null, name: l.name, description: '', rate: Number(l.rate) || 0, quantity: Number(l.quantity) || 1, product_type: it?.product_type || 'service', needs_price: !!l.needs_price, _extra: false } }),
    ...extraLines,
  ]
  const dg = applyDiag(lines, { rules: effB3.rules, insurer_rule: effB3.insurer_rule, has_rule: !!rule.rules, items: {} }, diagSaved); lines = dg.lines
  const discounted = lines.map(li => {
    const amount = r2(li.rate * li.quantity); const part = isPart(li)
    const eligible = pct != null && pct > 0 && discountEligible({ ...li, amount })
    const disc = eligible ? pct : 0
    return { ...li, amount, big3_key: big3KeyFor(li.name), is_part: part, never_discount: NO_DISCOUNT.test(li.name || ''), discount_pct: disc, cost_amount: r2(amount * (1 - disc / 100)), why: !eligible && amount > 0 && pct ? (part ? 'part — no discount' : NO_DISCOUNT.test(li.name || '') ? 'never discounted' : '') : '' }
  })
  const listTotal = r2(discounted.reduce((s, l) => s + l.amount, 0))
  const costTotal = r2(discounted.reduce((s, l) => s + l.cost_amount, 0))
  // Retail = sales tax 10.1%, always (Mark 2026-09-22).
  let tax = null
  if (customerType === 'retail' || typeDef?.tax) {
    // A Books tax record is used if one exists; otherwise the tax rides as the
    // labeled adjustment line above Total, which is how Mark's invoices carry it.
    const t = await retailTax(token, catalyst.initialize(req)).catch(() => ({ tax_id: '', pct: 10.1 }))
    tax = { pct: t.pct || 10.1, tax_id: t.tax_id || '', name: t.name || 'Tax 10.1% (adjustment line)', missing: false, via: t.tax_id ? 'tax record' : 'adjustment', amount: r2(costTotal * (t.pct || 10.1) / 100) }
  }
  const grand = r2(costTotal + (tax?.amount || 0))
  // Books customer: the CRM shop's linked contact, else a name search.
  let customerId = job.customer?.zoho_contact_id || shop?.zoho_contact_id || job.zoho_customer_id || ''
  let customerName = job.customer?.name || shop?.shop_name || job.shop_name || ''
  if (retailJob && !customerId && job.customer?.id) {
    try { const { ensureRetailBooksContact } = await import('./estimator.js'); const c = await ensureRetailBooksContact(req, job.customer.id); customerId = c.contact_id; customerName = c.contact_name || customerName } catch (e) { console.log('[bill-it single] retail Books contact failed:', e.message) }
  }
  if (!customerId && customerName) {
    const r = await axios.get(`${API}/contacts`, { headers: H(token), params: { ...org(), contact_name: customerName }, timeout: 15000, validateStatus: s => s < 500 }).catch(() => null)
    const hit = (r?.data?.contacts || []).find(c => String(c.contact_name).toLowerCase() === customerName.toLowerCase()) || (r?.data?.contacts || [])[0]
    if (hit) { customerId = hit.contact_id; customerName = hit.contact_name }
  }
  const emails = customerId ? await contactEmails(token, customerId).catch(() => []) : []
  const tpl = await resolveTemplates(token, customerType === 'retail' ? 'retail' : customerType)
  const ro = String(job.invoice_number || job.quote_number || '').trim()
  let existing = null
  if (ro) { const r = await axios.get(`${API}/invoices`, { headers: H(token), params: { ...org(), reference_number: ro }, timeout: 15000, validateStatus: s => s < 500 }).catch(() => null); existing = (r?.data?.invoices || []).find(i => i.reference_number === ro && i.customer_id === customerId) || null }
  const warnings = []
  if (cashOverride === false && job.cash_quoted) warnings.push(`💵 Cash is switched OFF, but the customer was told $${job.cash_quoted}. This bills list price.`)
  if (!customerType) warnings.push(`No customer type on file for ${job.shop_name} — answer the three billing questions on the CRM card (or pick one below) and it's remembered.`)
  if (!customerId) warnings.push(`No Zoho Books customer linked to ${job.shop_name} — link one on the CRM card (🧾 Zoho Books) so the invoice has somewhere to go.`)
  if (!lines.length) warnings.push('No lines yet — add the work (calibrations on the card, or items below).')
  if (lines.some(l => l.needs_price)) warnings.push('A line has no price in Books — type one or swap the item.')
  if (existing) warnings.push(`Invoice ${existing.invoice_number} already exists in Books for RO ${ro} (${existing.status}). The button will not create a second one.`)
  if (job.invoiced || job.billed_via_app) warnings.push(`This card is already marked invoiced${job.billed_via_app ? ` (via app ${job.billed_via_app})` : ''}.`)
  if (!emails.length) warnings.push('No email on the Books contact — add one in Books or type it below.')
  if (!tpl.invoice) warnings.push('No invoice PDF template in Books — the button will not send until it exists.')
  return {
    ok: true, mode: 'single', job_id: job.id, shop_name: customerName, estimate_id: null, estimate_number: ro || '', customer_id: customerId,
    customer_type: customerType, customer_types: big3.CUSTOMER_TYPES, pay_mode: payMode, discount_pct: pct ?? 0, has_discount: pct != null, cash_job: cashRule, has_type: !!br.customer_type,
    pct_source: dflt.source, pct_label: dflt.label, pct_default: pct ?? 0, shop_pct: Number.isFinite(Number(br.discount_value)) ? Number(br.discount_value) : null, retail_person: retailJob, emails,
    cash_quoted: String(job.cash_quoted || ''), tires_set: String(job.tires_set || ''), agreed_price: job.agreed_price || null,
    lines: discounted, insurance_total: listTotal, list_total: listTotal, cost_total: costTotal, tax, grand_total: grand, saved: r2(listTotal - costTotal),
    extras_count: extraLines.length, existing_invoice: existing ? { number: existing.invoice_number, status: existing.status, total: existing.total } : null,
    can_bill: !existing && !job.billed_via_app && !!customerId && !!emails.length && !!tpl.invoice && lines.length > 0 && !lines.some(l => l.needs_price),
    templates: { estimate: null, invoice: tpl.invoice }, big3: dg.big3Block, diag_only: dg.diag,
    warnings, rule: rule.rules ? big3.describeRules(rule.rules) : 'default', _byId: byId, _byName: byName, _shop: shop || null,
  }
}
// Estimator-linked card: show the estimate, bill through the estimator's own push.
async function buildEstimatorPreview(req, job, est) {
  const token = await getAccessToken()
  const big3 = await import('../services/big3.js')
  const retailJob = job.customer?.kind === 'retail' || est.customer_kind === 'retail'
  let customerId = job.customer?.zoho_contact_id || ''
  if (!customerId && !retailJob) { const sh = await big3.findShopByName(req, job.shop_name).catch(() => null); customerId = sh?.zoho_contact_id || '' }
  const emails = customerId ? await contactEmails(token, customerId).catch(() => []) : []
  const warnings = []
  if (est.status === 'invoiced') warnings.push(`Estimate ${est.number} is already invoiced in Books.`)
  if (est.status === 'sent') warnings.push(`Estimate ${est.number} is out for approval — no invoice until they say yes (or approve it in the estimator if they did in person).`)
  if (!emails.length) warnings.push('No email on the Books contact — type one below.')
  if (job.invoiced || job.billed_via_app) warnings.push(`This card is already marked invoiced${job.billed_via_app ? ` (via app ${job.billed_via_app})` : ''}.`)
  return {
    ok: true, mode: 'estimator', job_id: job.id, shop_name: job.customer?.name || job.shop_name, estimate: est, estimate_number: est.number, customer_id: customerId, customer_type: retailJob ? 'retail' : '', emails,
    lines: [], insurance_total: 0, cost_total: 0, grand_total: (est.grand_total_cents || 0) / 100, discount_pct: 0, has_discount: true, has_type: true,
    can_bill: est.status === 'approved' && !job.billed_via_app, templates: { estimate: null, invoice: { name: 'estimator' } }, big3: { rules: null, items: {} }, warnings, rule: '', _byId: new Map(), _byName: new Map(),
  }
}
async function billEstimator(req, res, job, p, dry) {
  const emails = (Array.isArray(req.body?.emails) && req.body.emails.length ? req.body.emails : p.emails).map(e => String(e).trim().toLowerCase()).filter(e => /.+@.+\..+/.test(e))
  if (!emails.length) return res.status(400).json({ error: 'No email to send to.' })
  if (p.estimate.status !== 'approved') return res.status(409).json({ error: `Estimate ${p.estimate.number} is ${p.estimate.status} — it has to be approved first.` })
  if (job.billed_via_app) return res.status(409).json({ error: `Already billed via the app (${job.billed_via_app}).` })
  const by = req.user?.name || req.user?.email || 'staff'
  let out = null
  if (!dry) {
    const { pushEstimateInvoice } = await import('./estimatorMore.js')
    out = await pushEstimateInvoice(req, p.estimate.id, by)
    const token = await getAccessToken()
    const att = await attachJobReports(req, token, job, [{ kind: 'invoices', id: out.id }]).catch(e => ({ attached: [], errors: [e.message] }))
    p.attached = att.attached; p.attach_errors = att.errors
    // 🔬 The scrub that started this car now knows it became an invoice.
    try { const { setScrubStage } = await import('../services/scrubStore.js'); await setScrubStage(req, job.id, 'invoiced', { invoiceNumber: out.number, invoiceId: out.id, quoteNumber: p.estimate?.number || '' }) } catch { /* bookkeeping only */ }
    const e2 = await emailInvoice(token, out.id, emails)
    if (e2) await postToCliqChannel(DISPATCH_CHANNEL, `⚠️ Bill it · ${p.shop_name} ${out.number}: invoice created from estimate ${p.estimate.number} but email failed (${e2}) — send from Books by hand.`).catch(() => {})
    const onSite = p.customer_type === 'retail' || String(req.body?.pay_mode || '') === 'on_site'
    await updateJobPublic(req, job.id, { ...job, status: onSite ? 'ready_invoice' : 'complete', invoiced: true, invoice_number: out.number, invoice_status: 'sent', billed_via_app: `${by} ${new Date().toISOString().slice(0, 16)}`,
      notes: `${job.notes ? job.notes + '\n' : ''}💸 Billed via app by ${by}: invoice ${out.number} from estimate ${p.estimate.number} ($${p.grand_total.toFixed(2)}) → ${emails.join(', ')}${onSite ? ' · collect on site' : ''}` })
    try { const { spotPayBilled } = await import('../services/spotPay.js'); await Promise.race([spotPayBilled(req, job, { number: out.number, total: p.grand_total }), new Promise(r => setTimeout(r, 5000))]) } catch (e) { console.warn('[spot-pay] billed', e.message) }
  }
  await postToCliqChannel(DISPATCH_CHANNEL, `💸 *${dry ? 'DRY RUN — would bill' : 'Billed'} · ${p.shop_name}* — invoice ${out?.number || '(dry)'} from estimate ${p.estimate.number} $${p.grand_total.toFixed(2)} → ${emails.join(', ')} · by ${by}`).catch(() => {})
  res.json({ ok: true, dry, mode: 'estimator', invoice: out ? { number: out.number, id: out.id } : null, emails, preview: pub(p) })
}
const pub = p => { const { _byId, _byName, _est, _shop, ...rest } = p; return rest }

// Which Big 4 slot a line belongs to (by name — Books items vary by insurer pool).
export function big3KeyFor(name) {
  const n = String(name || '').toLowerCase()
  if (/calibration identification report/.test(n)) return 'cal_id'
  if (/post collision safety inspection|\bpcsi\b/.test(n)) return 'pcsi'
  if (/calibration snapshot/.test(n)) return 'snapshot'
  if (/\bpre[- ]?scan/.test(n) && !/post/.test(n)) return 'pre_scan'
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
    const shown = presentScanLine(it?.name || x.name || 'Item', x.description || '')
    const name = shown.name
    const product_type = it?.product_type || x.product_type || 'service'
    const amount = r2(rate * quantity)
    return { line_item_id: x.line_item_id || null, item_id: it?.item_id || x.item_id || null, name, description: shown.description, rate, quantity, product_type, amount, is_part: isPart({ product_type, name }), never_discount: NO_DISCOUNT.test(name), _extra: !!x._extra, _edited: true }
  }).filter(l => l.quantity > 0)
}

router.post('/:id/bill/preview', async (req, res) => {
  try {
    const job = (await readJobsPublic(req)).find(j => String(j.id) === String(req.params.id))
    if (!job) return res.status(404).json({ error: 'Job not found' })
    res.json(pub(await buildPreview(req, job, String(req.body?.customer_type || ''))))
  } catch (e) { res.status(e.status || 500).json({ error: e.response?.data?.message || e.message }) }
})

router.post('/:id/bill', async (req, res) => {
  const dry = String(req.query.dry || req.body?.dry || '') === '1'
  try {
    const job = (await readJobsPublic(req)).find(j => String(j.id) === String(req.params.id))
    if (!job) return res.status(404).json({ error: 'Job not found' })
    const p = await buildPreview(req, job, String(req.body?.customer_type || ''))
    if (p.mode === 'estimator') return billEstimator(req, res, job, p, dry)
    if (p.mode === 'single') return billSingle(req, res, job, p, dry)
    const emails = (Array.isArray(req.body?.emails) && req.body.emails.length ? req.body.emails : p.emails).map(e => String(e).trim().toLowerCase()).filter(e => /.+@.+\..+/.test(e))
    if (!emails.length) return res.status(400).json({ error: 'No email to send to.' })
    if (p.existing_invoice) return res.status(409).json({ error: `Already billed — invoice ${p.existing_invoice.number} exists in Books.`, preview: pub(p) })
    if (job.billed_via_app) return res.status(409).json({ error: `Already billed via the app (${job.billed_via_app}).` })
    if (p.already_converted) return res.status(409).json({ error: `Already billed — Books shows estimate ${p.estimate_number} converted to an invoice.`, preview: pub(p) })
    if (!p.templates.estimate || !p.templates.invoice) return res.status(400).json({ error: 'PDF template missing in Books — see the warning above. Nothing sent.', preview: pub(p) })
    const by = req.user?.name || req.user?.email || 'staff'
    const pct = clampPct(req.body?.discount_pct ?? p.discount_pct)
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
        ...(l.line_item_id ? { line_item_id: l.line_item_id } : {}), ...(l.item_id ? { item_id: l.item_id } : {}),
        name: l.name, description: l.description || '', rate: l.rate, quantity: l.quantity,
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
    // A cash or insurer-list % belongs to the car — never learned onto the shop.
    const learnPct = !dry && !p.cash_job && p.pct_source !== 'insurer' && (!p.has_discount || Number(p.discount_pct) !== pct)
    const learnType = !dry && !p.cash_job && p.saved_type !== 'body_shop'   // picked the Collision pill → remembered
    const saveRules = !p.diag_only?.on && (!p.big3?.insurer_rule || req.body?.big3_edited === true) && req.body?.big3_rules && (req.body?.big3_save === true || (!p.big3?.has_rule && req.body?.big3_save !== false))
    if (!dry && (saveRules || learnPct || learnType)) {
      try {
        const b3 = await import('../services/big3.js')
        const want = saveRules ? b3.withDefaults(req.body.big3_rules) : b3.withDefaults(p.big3?.shop_rules || p.big3?.rules)
        const r = await b3.saveBig3(req, p.shop_name, want, by, (learnPct || learnType) ? { discount_pct: pct, customer_type: 'body_shop' } : {})
        if (r?.changed) console.log(`[bill-it] learned for ${p.shop_name}: ${b3.describeRules(want)}${learnPct ? ` · ${pct}%` : ''}`)
      } catch (e) { console.log('[bill-it] rule/discount save failed (non-fatal):', e.message) }
    }
    // 💵 Cash switched on the modal → the estimate's Insurer field follows, so the insurance invoice doesn't say "Cash" on a standard bill (or the reverse).
    if (!dry && p.cash_switch) {
      const cf = (p._est.custom_fields || []).find(c => c.label === 'Insurer')
      const want = p.cash_job ? 'Cash' : (p.real_insurer || '')
      if (cf?.customfield_id && String(cf.value || '') !== want && (p.cash_job ? !isCashCustomer({ insurer: cf.value }) : isCashCustomer({ insurer: cf.value }))) {
        const u = await axios.put(`${API}/estimates/${p.estimate_id}`, { custom_fields: [{ customfield_id: cf.customfield_id, value: want }] }, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 }).catch(e => ({ data: { message: e.message } }))
        if (u.data?.code !== 0) console.warn(`[bill-it] insurer field → "${want}" failed: ${u.data?.message || u.status}`)
      }
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
      // 📎 Kinetic report from the job folder rides along on both documents (Mark 2026-09-24).
      const att = await attachJobReports(req, token, job, [{ kind: 'estimates', id: p.estimate_id }, { kind: 'invoices', id: inv.invoice_id }]).catch(e => ({ attached: [], errors: [e.message] }))
      p.attached = att.attached; p.attach_errors = att.errors
      // 🔬 The scrub that started this car now knows it became an invoice.
      try { const { setScrubStage } = await import('../services/scrubStore.js'); await setScrubStage(req, job.id, 'invoiced', { invoiceNumber: inv.invoice_number, invoiceId: inv.invoice_id, quoteNumber: p.estimate_number, quoteId: p.estimate_id }) } catch { /* bookkeeping only */ }
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
        notes: `${job.notes ? job.notes + '\n' : ''}💸 Billed via app by ${by}: insurance invoice (estimate ${p.estimate_number}) + cost invoice ${inv.invoice_number} at ${pct}%${pctNote(p, pct)} → ${emails.join(', ')}` })
      try { const { spotPayBilled } = await import('../services/spotPay.js'); await Promise.race([spotPayBilled(req, job, { number: inv.invoice_number, total: p.cost_total }), new Promise(r => setTimeout(r, 5000))]) } catch (e) { console.warn('[spot-pay] billed', e.message) }
    }
    const summary = [
      `💸 *${dry ? 'DRY RUN — would bill' : 'Billed'} · ${p.shop_name}*`,
      `Insurance invoice (estimate ${p.estimate_number}) $${p.insurance_total.toFixed(2)} → ${emails.join(', ')}`,
      `Cost invoice ${inv?.invoice_number || p.estimate_number} at ${pct}%${pctNote(p, pct)} → $${p.cost_total.toFixed(2)} (saves the shop $${p.saved.toFixed(2)})${p.extras_count ? ` · ${p.extras_count} extra item${p.extras_count === 1 ? '' : 's'} added` : ''}`,
      changedLines ? `Estimate ${p.estimate_number} updated in Books to match the review` : '',
      `Templates: ${p.templates.estimate.name} / ${p.templates.invoice.name}`,
      p.attached?.length ? `📎 Attached to both: ${p.attached.join(', ')}` : (dry ? '' : '📎 No calibration report PDF found in the job folder — nothing attached'),
      p.attach_errors?.length ? `⚠️ attach: ${p.attach_errors.join(' | ')}` : '',
      `by ${by}`,
    ].filter(Boolean).join('\n')
    await postToCliqChannel(DISPATCH_CHANNEL, summary).catch(() => {})
    console.log(`[bill-it] ${dry ? 'DRY' : 'LIVE'} ${p.shop_name} ${p.estimate_number} ${pct}% by ${by}`)
    // 📨 First invoice to a new collision shop → "Welcome to Absolute ADAS" (once, ever; Mark 2026-10-01).
    if (!dry && inv && p._shop) { try { const { sendShopWelcome2 } = await import('../services/shopWelcome.js'); await Promise.race([sendShopWelcome2(req, p._shop, { by: req.user?.name || 'Bill it' }), new Promise(r => setTimeout(r, 8000))]) } catch { /* never blocks billing */ } }
    res.json({ ok: true, dry, invoice: inv ? { number: inv.invoice_number, id: inv.invoice_id, total: inv.total } : null, emails, estimate_updated: changedLines, attached: p.attached || [], preview: pub(p) })
  } catch (e) {
    console.error('[bill-it]', e.message)
    res.status(e.status || 500).json({ error: e.response?.data?.message || e.message })
  }
})

// ── Single mode: one Books invoice, emailed, card stamped ──────────────
async function billSingle(req, res, job, p, dry) {
  const emails = (Array.isArray(req.body?.emails) && req.body.emails.length ? req.body.emails : p.emails).map(e => String(e).trim().toLowerCase()).filter(e => /.+@.+\..+/.test(e))
  if (!emails.length) return res.status(400).json({ error: 'No email to send to.' })
  if (p.existing_invoice) return res.status(409).json({ error: `Already billed — invoice ${p.existing_invoice.number} exists in Books.`, preview: pub(p) })
  if (job.billed_via_app) return res.status(409).json({ error: `Already billed via the app (${job.billed_via_app}).` })
  if (!p.customer_id) return res.status(400).json({ error: `No Zoho Books customer linked to ${p.shop_name} — link one on the CRM card first.` })
  if (!p.templates.invoice) return res.status(400).json({ error: 'Invoice PDF template missing in Books. Nothing sent.', preview: pub(p) })
  const by = req.user?.name || req.user?.email || 'staff'
  const big3 = await import('../services/big3.js')
  // The type can be picked right on the modal the first time; remembered on the shop.
  const ctype = big3.CUSTOMER_TYPES[req.body?.customer_type] ? req.body.customer_type : p.customer_type
  const pct = clampPct(req.body?.discount_pct ?? p.discount_pct)
  const pay = big3.PAY_MODES[req.body?.pay_mode] ? req.body.pay_mode : p.pay_mode
  const edited = Array.isArray(req.body?.lines) ? linesFromEdit(p, req.body.lines) : null
  if (edited) { if (!edited.length) return res.status(400).json({ error: 'Nothing to bill.' }); p.lines = edited }
  p.lines = applyDiscount(p.lines, pct)
  p.cost_total = r2(p.lines.reduce((s, l) => s + l.cost_amount, 0)); p.list_total = r2(p.lines.reduce((s, l) => s + l.amount, 0))
  const isRetail = ctype === 'retail'
  if (p.tax) p.tax.amount = r2(p.cost_total * p.tax.pct / 100)
  p.grand_total = r2(p.cost_total + (p.tax?.amount || 0))
  // Learn: type / % / pay for the shop (never for a cash job — that's the card, not the shop).
  if (!dry && ctype !== 'cash' && !p.cash_job && ctype && !p.retail_person && (p.pct_source !== 'insurer' || ctype !== (p.saved_type || p.customer_type)) && (!p.has_type || Number(p.discount_pct) !== pct || p.pay_mode !== pay || ctype !== (p.saved_type || p.customer_type))) {
    try { const rules = big3.withDefaults(p.big3?.shop_rules || p.big3?.rules); await big3.saveBig3(req, p.shop_name, rules, by, { shop: p._shop || undefined, customer_type: ctype, discount_pct: p.pct_source === 'insurer' ? (p.shop_pct ?? pct) : pct, pay_mode: pay, silent: true }); console.log(`[bill-it single] learned ${p.shop_name}: ${ctype} · ${pct}% · ${pay}`) } catch (e) { console.log('[bill-it single] learn failed (non-fatal):', e.message) }
  }
  let inv = null
  if (!dry) {
    const token = await getAccessToken()
    inv = await createSingleInvoice({ token, app: catalyst.initialize(req), customerId: p.customer_id, job, lines: p.lines, pct, customerType: ctype, technician: job.technician, by, template: p.templates.invoice, taxId: isRetail ? p.tax?.tax_id : '', taxPct: isRetail ? p.tax?.pct : 0 })
    const att = await attachJobReports(req, token, job, [{ kind: 'invoices', id: inv.invoice_id }]).catch(e => ({ attached: [], errors: [e.message] }))
    p.attached = att.attached; p.attach_errors = att.errors
    const e2 = await emailInvoice(token, inv.invoice_id, emails)
    if (e2) await postToCliqChannel(DISPATCH_CHANNEL, `⚠️ Bill it · ${p.shop_name} ${inv.invoice_number}: invoice created but email failed (${e2}) — send from Books by hand.`).catch(() => {})
    // On-site payers stay on the board until Collect flips them Paid (Phase B); net-terms cards are done.
    const onSite = pay === 'on_site' || pay === 'either'
    await updateJobPublic(req, job.id, { ...job, status: onSite ? 'ready_invoice' : 'complete', invoiced: true, invoice_number: inv.invoice_number, invoice_status: inv.status || 'sent', zoho_invoice_id: inv.invoice_id, billed_via_app: `${by} ${new Date().toISOString().slice(0, 16)}`, billing_mode: 'single', pay_mode: pay,
      notes: `${job.notes ? job.notes + '\n' : ''}💸 Billed via app by ${by}: invoice ${inv.invoice_number} ($${p.grand_total.toFixed(2)}${pct ? `, ${pct}% off` : ''}${pctNote(p, pct)}${isRetail ? `, tax ${p.tax?.pct}%` : ''}) → ${emails.join(', ')}${onSite ? ' · collect on site' : ''}` })
  }
  const summary = [
    `💸 *${dry ? 'DRY RUN — would bill' : 'Billed'} · ${p.shop_name}* (${big3.CUSTOMER_TYPES[ctype]?.label || ctype || 'shop'})`,
    `Invoice ${inv?.invoice_number || '(dry)'} $${p.grand_total.toFixed(2)}${pct ? ` · ${pct}% shown (list $${p.list_total.toFixed(2)})` : ''}${pctNote(p, pct)}${isRetail && p.tax ? ` · tax $${p.tax.amount.toFixed(2)}` : ''} → ${emails.join(', ')}`,
    pay === 'net_terms' ? 'Net terms — emailed.' : '🚐 Collect on site — check, cash, or the card QR on the job card.',
    p.attached?.length ? `📎 Attached: ${p.attached.join(', ')}` : '',
    p.attach_errors?.length ? `⚠️ attach: ${p.attach_errors.join(' | ')}` : '',
    `by ${by}`,
  ].filter(Boolean).join('\n')
  await postToCliqChannel(DISPATCH_CHANNEL, summary).catch(() => {})
  console.log(`[bill-it single] ${dry ? 'DRY' : 'LIVE'} ${p.shop_name} ${ctype} ${pct}% $${p.grand_total} by ${by}`)
  res.json({ ok: true, dry, mode: 'single', invoice: inv ? { number: inv.invoice_number, id: inv.invoice_id, total: inv.total } : null, emails, attached: p.attached || [], preview: pub(p) })
}

export default router
