// 🔬 Scan lifecycle (Mark 2026-10-07/08): a scrub is the car's whole stay at the shop —
// scrubbed → pre-scan done → pre-scan invoiced → post-scan done → post-scan invoiced
// → green "complete" → archived after a 7-day grace.
//
// Pre-scan billing = Bill it with ONE line (Mark: "these invoices need to be blank,
// nothing but the pre-scan"): collision shop → Books estimate (insurance invoice) +
// discounted cost invoice, both emailed; repair / dealer / retail → one invoice.
// The shop's Big 3 rule decides: charge → bill, included → no charge (box ticks),
// off → the shop does its own pre-scans (box ticks, nothing billed). Big 4
// enforcement never runs here. Refuses if a pre-scan document for the RO exists.
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'

const API = 'https://www.zohoapis.com/books/v3'
const H = t => ({ Authorization: `Zoho-oauthtoken ${t}` })
const org = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const nowIso = () => new Date().toISOString()
const GRACE_DAYS = 7

async function contactEmails(token, customerId) {
  const r = await axios.get(`${API}/contacts/${customerId}/contactpersons`, { headers: H(token), params: org(), timeout: 15000, validateStatus: s => s < 500 })
  const persons = r.data?.contact_persons || []
  const primary = persons.filter(p => p.is_primary_contact && p.email)
  const withEmail = persons.filter(p => p.email)
  return [...new Set((primary.length ? primary : withEmail).map(p => String(p.email).toLowerCase()))]
}

/** Everything the confirm sheet shows before a pre-scan is billed. Pure read. */
export async function preScanPreview(req, scrub) {
  const big3 = await import('./big3.js')
  const { getAccessToken, getItemCatalogForAudit, resolvePricingPool, paidAlternativeFor } = await import('./zoho.js')
  const { resolveTemplates } = await import('./costInvoice.js')
  const { scansOf } = await import('./scrubStore.js')
  const shopName = scrub.shop || scrub.payload?.shop || ''
  const rule = await big3.readBig3(req, shopName)
  const shop = rule.shop_id ? await big3.findShopByName(req, shopName) : null
  let br = shop?.billing_rules || {}; if (typeof br === 'string') { try { br = JSON.parse(br) } catch { br = {} } }
  const customerType = br.customer_type || 'body_shop'
  const collision = !br.customer_type || br.customer_type === 'body_shop'
  const insurer = scrub.insurer || scrub.payload?.insurer || ''
  const eff = big3.effectiveBig3(rule.rules, insurer)
  const mode = String(eff.rules?.pre_scan || 'off')     // charge | included | off
  const pct = Number.isFinite(Number(br.discount_value)) ? Number(br.discount_value) : (collision ? 25 : 0)
  const out = { shop_name: shopName, shop_id: shop?.id || null, customer_id: shop?.zoho_contact_id || '', customer_type: customerType, collision, insurer, mode, discount_pct: pct, item: null, emails: [], warnings: [], existing: scansOf(scrub).pre, billing_mode: collision ? 'dual' : 'single' }
  if (!shop) out.warnings.push(`${shopName || 'This shop'} is not in the CRM — add it first.`)
  if (mode === 'off') out.warnings.push(`${shopName}'s rule says the shop does its own pre-scans — nothing will be billed, the box just gets checked.`)
  if (mode === 'included') out.warnings.push(`${shopName}'s rule says pre-scans are no charge — nothing will be billed, the box just gets checked.`)
  if (mode === 'charge') {
    const token = await getAccessToken()
    const catalog = await getItemCatalogForAudit().catch(() => ({ allItems: [] }))
    const byName = new Map((catalog.allItems || []).map(it => [String(it.name).toLowerCase().trim(), it]))
    const pool = resolvePricingPool(insurer, null)
    const paid = byName.get('pre-scan') || paidAlternativeFor(catalog.allItems || [], pool, 'Pre-Scan (included)')
    if (paid) out.item = { item_id: paid.item_id, name: paid.name, rate: Number(paid.rate) || 0, product_type: paid.product_type || 'service' }
    else out.warnings.push('No paid Pre-Scan item in the Books catalog.')
    if (!out.customer_id) out.warnings.push(`No Zoho Books customer linked to ${shopName} — link one on the CRM card.`)
    if (out.customer_id) { out.emails = await contactEmails(token, out.customer_id).catch(() => []); if (!out.emails.length) out.warnings.push('No email on the Books contact.') }
    const tpl = await resolveTemplates(token, customerType).catch(() => ({}))
    out.templates = { estimate: tpl?.estimate || null, invoice: tpl?.invoice || null }
    if (collision && !tpl?.estimate) out.warnings.push('Estimate PDF template missing in Books.')
    if (!tpl?.invoice) out.warnings.push('Invoice PDF template missing in Books.')
    if (out.existing?.invoice_number) out.warnings.push(`Pre-scan already billed: ${out.existing.invoice_number}.`)
    if (out.item) out.cost = r2(out.item.rate * (1 - pct / 100)); out.list = out.item?.rate || 0
  }
  out.can_bill = mode === 'charge' && !!out.item && !!out.customer_id && !!out.emails.length && !out.existing?.invoice_number && (!collision || !!out.templates?.estimate) && !!out.templates?.invoice
  return out
}

/** Bill the pre-scan: one line, dual or single, both documents emailed. */
export async function billPreScan(req, scrub, { by = 'staff', emails: emailsIn = null } = {}) {
  const p = await preScanPreview(req, scrub)
  if (p.mode !== 'charge') return { ok: true, billed: false, mode: p.mode, preview: p }
  if (!p.can_bill) throw Object.assign(new Error(p.warnings[0] || 'cannot bill'), { status: 400, preview: p })
  const { getAccessToken } = await import('./zoho.js')
  const CI = await import('./costInvoice.js')
  const { postToCliqChannel, DISPATCH_CHANNEL } = await import('./cliq.js')
  const token = await getAccessToken()
  const emails = (Array.isArray(emailsIn) && emailsIn.length ? emailsIn : p.emails).map(e => String(e).trim().toLowerCase()).filter(e => /.+@.+\..+/.test(e))
  const ro = String(scrub.ro || scrub.payload?.ro_number || '').trim()
  // Idempotent against Books too: any invoice on this RO that already carries a pre-scan line.
  if (ro) {
    const r = await axios.get(`${API}/invoices`, { headers: H(token), params: { ...org(), reference_number: ro, customer_id: p.customer_id }, timeout: 15000, validateStatus: s => s < 500 }).catch(() => null)
    for (const inv of r?.data?.invoices || []) {
      if (/\bpre[- ]?scan/i.test(String(inv.line_items?.map?.(l => l.name).join(' ') || ''))) throw Object.assign(new Error(`Pre-scan already billed on invoice ${inv.invoice_number}.`), { status: 409 })
    }
  }
  const app = catalyst.initialize(req)
  const lineBase = { item_id: p.item.item_id, name: p.item.name, description: `Pre-repair diagnostic scan · RO ${ro || '—'} · ${scrub.vehicle || ''}${scrub.vin ? ` · VIN ${scrub.vin}` : ''}`.slice(0, 500), rate: p.item.rate, quantity: 1, product_type: p.item.product_type }
  const lines = CI.applyDiscount([lineBase], p.discount_pct)
  let est = null, inv = null, mode = p.billing_mode
  const cfLabels = [['RO#', ro], ['VIN', scrub.vin], ['Year', scrub.year], ['Make', scrub.make], ['Model', scrub.model], ['Insurer', p.insurer]].filter(([, v]) => v).map(([label, value]) => ({ label, value: String(value).slice(0, 100) }))
  if (mode === 'dual') {
    const body = { customer_id: p.customer_id, ...(ro ? { reference_number: ro } : {}), date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }), line_items: [{ item_id: lineBase.item_id, description: lineBase.description, rate: lineBase.rate, quantity: 1 }], custom_fields: cfLabels, salesperson_name: scrub.by || by, notes: 'Pre-repair diagnostic scan.' }
    const c = await axios.post(`${API}/estimates`, body, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 })
    if (c.data?.code !== 0) throw new Error(`Books estimate: ${c.data?.message || c.status}`)
    est = c.data.estimate
    await CI.applyEstimateTemplate(token, est.estimate_id, p.templates.estimate).catch(() => {})
    const estFull = await CI.getEstimate(token, est.estimate_id)
    inv = await CI.createCostInvoice({ token, app, est: estFull, lines, pct: p.discount_pct, customerType: p.customer_type, technician: scrub.by || '', by, templates: p.templates })
    const e1 = await CI.emailEstimate(token, est.estimate_id, emails)
    const e2 = await CI.emailInvoice(token, inv.invoice_id, emails)
    await CI.ensureLinked(token, inv.invoice_id, est.estimate_id).catch(() => {})
    if (e1 || e2) await postToCliqChannel(DISPATCH_CHANNEL, `⚠️ Pre-scan bill · ${p.shop_name} ${inv.invoice_number}: created but ${[e1 && `estimate email failed (${e1})`, e2 && `invoice email failed (${e2})`].filter(Boolean).join('; ')} — send from Books by hand.`).catch(() => {})
  } else {
    const job = { invoice_number: '', quote_number: '', ro_number: ro, vin: scrub.vin, year: scrub.year, make: scrub.make, model: scrub.model }
    inv = await CI.createSingleInvoice({ token, app, customerId: p.customer_id, job, lines, pct: p.discount_pct, customerType: p.customer_type, technician: scrub.by || '', by, template: p.templates.invoice, taxPct: p.customer_type === 'retail' ? 10.1 : 0 })   // retail = Mark's org tax line (no tax records in Books, 2026-09-22)
    const e2 = await CI.emailInvoice(token, inv.invoice_id, emails)
    if (e2) await postToCliqChannel(DISPATCH_CHANNEL, `⚠️ Pre-scan bill · ${p.shop_name} ${inv.invoice_number}: created but email failed (${e2}) — send from Books by hand.`).catch(() => {})
  }
  // Attach the pre-scan report if one is already on the scrub (postscan@ files them by RO).
  let attached = []
  try {
    const pdf = (scrub.reports || []).find(r => r.kind === 'prescan' && r.id)
    if (pdf) {
      const { downloadFile } = await import('./workdrive.js'); const { attachToBooks } = await import('./reportAttach.js')
      const { buffer } = await downloadFile(pdf.id, token)
      if (est) await attachToBooks(token, 'estimates', est.estimate_id, { name: pdf.name, buffer })
      await attachToBooks(token, 'invoices', inv.invoice_id, { name: pdf.name, buffer }); attached.push(pdf.name)
    }
  } catch (e) { console.warn('[prescan] attach:', e.message) }
  await postToCliqChannel(DISPATCH_CHANNEL, `🔬 *Pre-scan billed · ${p.shop_name}* ${scrub.vehicle ? '· ' + scrub.vehicle : ''}${ro ? ` · RO ${ro}` : ''}\n${mode === 'dual' ? `Estimate ${est.estimate_number} $${r2(p.list).toFixed(2)} + cost invoice ${inv.invoice_number} $${r2(p.cost).toFixed(2)} (${p.discount_pct}% off)` : `Invoice ${inv.invoice_number} $${r2(lines[0].cost_amount).toFixed(2)}`} — emailed to ${emails.join(', ')}${attached.length ? ` · 📎 ${attached.join(', ')}` : ''}\nby ${by}`).catch(() => {})
  return { ok: true, billed: true, mode, estimate_number: est?.estimate_number || '', estimate_id: est?.estimate_id || '', invoice_number: inv.invoice_number, invoice_id: inv.invoice_id, emails, attached, preview: p }
}

/** Tick a box. Pre-scan done + rule charge → bills on the spot. */
export async function markScan(req, scrubId, which, { done = true, by = 'staff', emails = null } = {}) {
  const S = await import('./scrubStore.js')
  const scrub = await S.getScrub(req, scrubId)
  if (!scrub) throw Object.assign(new Error('not found'), { status: 404 })
  const scans = S.scansOf(scrub)
  const key = which === 'post' ? 'post' : 'pre'
  if (!done) { scans[key] = scans[key].invoice_number ? scans[key] : {}; const w = await S.writeScans(req, scrubId, scans); return { ok: true, scans: w.scans, state: w.state } }
  scans[key] = { ...scans[key], done_at: scans[key].done_at || nowIso(), by: scans[key].by || by }
  let bill = null
  if (key === 'pre' && !scans.pre.invoice_number) {
    bill = await billPreScan(req, scrub, { by, emails })
    scans.pre.mode = bill.mode
    if (bill.billed) Object.assign(scans.pre, { invoice_number: bill.invoice_number, invoice_id: bill.invoice_id, estimate_number: bill.estimate_number, estimate_id: bill.estimate_id, billed_at: nowIso() })
  }
  if (key === 'post' && !scans.post.invoice_number) {
    // Post-scan rides on the calibration invoice: if the scrub is already invoiced, that's the number.
    if (scrub.invoiceNumber) Object.assign(scans.post, { invoice_number: scrub.invoiceNumber, invoice_id: scrub.invoiceId || '' })
    else { try { const b3 = await import('./big3.js'); const rule = await b3.readBig3(req, scrub.shop); const eff = b3.effectiveBig3(rule.rules, scrub.insurer || ''); scans.post.mode = String(eff.rules?.post_scan || 'included') } catch { /* fine */ } }
  }
  const w = await S.writeScans(req, scrubId, scans)
  return { ok: true, scans: w.scans, state: w.state, bill }
}

/** postscan@ filed a PDF for an RO → tick the matching box, remember the file, attach to the invoice if there is one. */
export async function recordScanPdf(req, ro, { fileId, name, buffer = null }) {
  const S = await import('./scrubStore.js')
  const rows = await S.scrubsByRo(req, ro)
  const row = rows.find(r => r.status !== 'archived') || rows[0]
  if (!row) return { ok: false, reason: 'no scrub for this RO' }
  const scrub = await S.getScrub(req, row.id)
  const scans = S.scansOf(scrub)
  const isPre = /pre[- ]?scan|prescan/i.test(name) && !/post/i.test(name)
  const key = isPre ? 'pre' : 'post'
  scans[key] = { ...scans[key], done_at: scans[key].done_at || nowIso(), by: scans[key].by || 'postscan@', pdf: { id: String(fileId || ''), name: String(name || '').slice(0, 255), at: nowIso() } }
  if (key === 'post' && !scans.post.invoice_number && scrub.invoiceNumber) Object.assign(scans.post, { invoice_number: scrub.invoiceNumber, invoice_id: scrub.invoiceId || '' })
  const w = await S.writeScans(req, row.id, scans)
  // Also keep it in reports[] (kind prescan/postscan) and on the Books document.
  let attached = ''
  try {
    const { getAccessToken } = await import('./zoho.js'); const token = await getAccessToken()
    const invId = scans[key].invoice_id || (key === 'post' ? scrub.invoiceId : '')
    if (invId && buffer) { const { attachToBooks } = await import('./reportAttach.js'); await attachToBooks(token, 'invoices', invId, { name, buffer }); attached = invId }
  } catch (e) { console.warn('[scan pdf] attach:', e.message) }
  return { ok: true, id: row.id, which: key, state: w.state, attached }
}

/** Hourly: green cards older than the grace period → archived (auto). */
export async function autoArchiveCompleted(req) {
  const S = await import('./scrubStore.js')
  const { scrubs } = await S.listScrubs(req, { limit: 1000, maxScan: 3000 })
  const cutoff = Date.now() - GRACE_DAYS * 86400000
  const out = { checked: scrubs.length, archived: [] }
  for (const s of scrubs) {
    const sc = S.scansOf(s)
    if (S.scanState(s) !== 'complete' || !sc.completed_at) continue
    if (new Date(sc.completed_at).getTime() > cutoff) continue
    try { await S.archiveScrub(req, s.id, { reason: 'complete', auto: true, by: 'auto' }); out.archived.push(s.id) } catch (e) { console.warn('[auto-archive]', s.id, e.message) }
  }
  return out
}
