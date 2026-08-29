// Shop Quotes (Mark 2026-08-29 "ya" — pre-repair quote pipeline, Phase 1).
//
// The Kinetic scrub already creates the draft Books estimate at insurer-
// schedule list pricing (createDraftQuote). This layer makes it a QUOTE:
// one tap emails it to the shop with Mark's quote template, and a durable
// record feeds the Quotes kanban column until the quote is approved (we
// flip it — no shop portal), dead, or converted (Phase 3).
//
//   POST /api/shop-quotes/send       { estimate_id } → template + email + record
//   GET  /api/shop-quotes            → open records for the board
//   POST /api/shop-quotes/:id/status { status: approved|dead|quoted }
//   POST /api/shop-quotes/:id/resend → email again
//
// Storage: AppConfig index-row + exact-key rows (same pattern as the Item
// Map — full-table LIMIT/OFFSET scans silently miss rows). NOT cache: the
// legacy /api/quotes feature stored quotes in cache and they evaporated
// at the 48h TTL. Quotes wait longer than that for an answer.

import express from 'express'
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { getAccessToken } from '../services/zoho.js'

const router = express.Router()
const ZOHO_API_BASE = 'https://www.zohoapis.com/books/v3'
const INDEX_KEY = 'shopquote_index'
const ROW_KEY = id => `shopquote:${id}`

function orgParam() {
  // Same env var the rest of zoho.js uses — NOT ZOHO_BOOKS_ORG_ID
  return { organization_id: process.env.ZOHO_ORGANIZATION_ID }
}
function zohoHeaders(token) {
  return { Authorization: `Zoho-oauthtoken ${token}` }
}

// ── Durable storage (AppConfig index-row pattern) ───────────────────────
async function cfgRow(app, key) {
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key}' LIMIT 1`
  ).catch(() => [])
  return rows?.[0]?.AppConfig || rows?.[0] || null
}
async function cfgSet(app, key, value) {
  const table = app.datastore().table('AppConfig')
  const str = JSON.stringify(value)
  const r = await cfgRow(app, key)
  if (r?.ROWID) await table.updateRow({ ROWID: r.ROWID, config_value: str })
  else await table.insertRow({ config_key: key, config_value: str })
}
async function readIndex(app) {
  const r = await cfgRow(app, INDEX_KEY)
  try { return JSON.parse(r?.config_value || '[]') } catch { return [] }
}
export async function readQuoteRecords(req) {
  const app = catalyst.initialize(req)
  const ids = await readIndex(app)
  if (!ids.length) return []
  const rows = await Promise.all(ids.map(async id => {
    const r = await cfgRow(app, ROW_KEY(id))
    try { return JSON.parse(r?.config_value || 'null') } catch { return null }
  }))
  return rows.filter(Boolean)
}
async function writeQuoteRecord(req, record) {
  const app = catalyst.initialize(req)
  await cfgSet(app, ROW_KEY(record.estimate_id), record)
  const ids = await readIndex(app)
  if (!ids.includes(record.estimate_id)) {
    ids.push(record.estimate_id)
    await cfgSet(app, INDEX_KEY, ids)
  }
  // Write-verify (payroll-grade habit): read back the row we just wrote.
  const check = await cfgRow(app, ROW_KEY(record.estimate_id))
  if (!check?.config_value) throw new Error('Quote record write did not persist — try again')
}

// ── Per-shop Partnership Discount registry (Phase 2) ────────────────────
// One AppConfig row: { customer_id: pct }. The billing step reads it and
// persists whatever Mark confirms, so the discount is asked once per
// shop and never fat-fingered again. 25 is the standard tier.
const DISCOUNTS_KEY = 'shop_discounts'
async function readDiscounts(app) {
  const r = await cfgRow(app, DISCOUNTS_KEY)
  try { return JSON.parse(r?.config_value || '{}') || {} } catch { return {} }
}

// ── Books helpers ───────────────────────────────────────────────────────
async function getEstimate(token, estimateId) {
  const r = await axios.get(`${ZOHO_API_BASE}/estimates/${estimateId}`, {
    headers: zohoHeaders(token), params: orgParam(), timeout: 15000,
  })
  return r.data?.estimate
}

// Mark built a dedicated quote PDF template in Books. Find it by name
// (contains "quote"), cache the id, allow an explicit override row
// (config_key QUOTE_TEMPLATE_ID) to beat the guess. Never fatal — a
// quote on the default template still beats no quote.
async function resolveQuoteTemplateId(req, token) {
  const app = catalyst.initialize(req)
  const override = await cfgRow(app, 'QUOTE_TEMPLATE_ID')
  if (override?.config_value) return override.config_value.replace(/"/g, '')
  const cached = await cfgRow(app, 'quote_template_id_cache')
  if (cached?.config_value) return cached.config_value.replace(/"/g, '')
  try {
    const r = await axios.get(`${ZOHO_API_BASE}/estimates/templates`, {
      headers: zohoHeaders(token), params: orgParam(), timeout: 15000,
    })
    const templates = r.data?.templates || []
    const hit = templates.find(t => /quote/i.test(t.template_name || ''))
    if (hit?.template_id) {
      await cfgSet(app, 'quote_template_id_cache', hit.template_id)
      console.log('[shop-quotes] using template', hit.template_name, hit.template_id)
      return hit.template_id
    }
    console.warn('[shop-quotes] no template named *quote* — using estimate default. Names:',
      templates.map(t => t.template_name).join(', '))
  } catch (e) {
    console.warn('[shop-quotes] template lookup failed (non-fatal):', e.message)
  }
  return null
}

async function applyTemplate(token, estimateId, templateId) {
  if (!templateId) return
  await axios.put(
    `${ZOHO_API_BASE}/estimates/${estimateId}/templates/${templateId}`,
    {}, { headers: zohoHeaders(token), params: orgParam(), timeout: 15000 }
  ).catch(e => console.warn('[shop-quotes] template apply failed (non-fatal):', e.message))
}

async function shopEmails(token, customerId) {
  const r = await axios.get(`${ZOHO_API_BASE}/contacts/${customerId}/contactpersons`, {
    headers: zohoHeaders(token), params: orgParam(), timeout: 15000,
  })
  const persons = r.data?.contact_persons || []
  const primary = persons.filter(p => p.is_primary_contact && p.email)
  const withEmail = persons.filter(p => p.email)
  return (primary.length ? primary : withEmail).map(p => p.email)
}

async function emailEstimate(token, estimateId, toEmails) {
  await axios.post(`${ZOHO_API_BASE}/estimates/${estimateId}/email`,
    { to_mail_ids: toEmails },
    { headers: zohoHeaders(token), params: orgParam(), timeout: 20000 })
}

// ── Endpoints ───────────────────────────────────────────────────────────

// One tap: template → email → durable board record.
router.post('/send', async (req, res) => {
  try {
    const estimateId = String(req.body?.estimate_id || '')
    if (!estimateId) return res.status(400).json({ error: 'estimate_id required' })
    if (req.user?.demo) return res.json({ ok: true, _demo: true, sent_to: ['demo@shop.com'] })

    const token = await getAccessToken()
    const est = await getEstimate(token, estimateId)
    if (!est) return res.status(404).json({ error: 'Estimate not found in Zoho Books' })

    const emails = await shopEmails(token, est.customer_id)
    if (!emails.length) {
      return res.status(400).json({
        error: `No email on file for ${est.customer_name} in Zoho Books — add a contact email, then resend.`,
      })
    }

    const templateId = await resolveQuoteTemplateId(req, token)
    await applyTemplate(token, estimateId, templateId)
    await emailEstimate(token, estimateId, emails)

    const meta = req.body?.meta || {}
    const now = new Date().toISOString()
    await writeQuoteRecord(req, {
      estimate_id: estimateId,
      estimate_number: est.estimate_number || '',
      customer_id: est.customer_id || '',
      shop: est.customer_name || meta.shop || '',
      vehicle: meta.vehicle || '',
      vin: meta.vin || '',
      ro_number: meta.ro_number || '',
      claim: meta.claim || '',
      insurer: meta.insurer || '',
      cal_count: Number(meta.cal_count) || (est.line_items?.length ?? 0),
      total: Number(est.total) || 0,
      salesperson: est.salesperson_name || meta.salesperson || '',
      status: 'quoted',
      sent_to: emails,
      sent_at: now, approved_at: '', dead_at: '',
      sent_by: req.user?.email || req.user?.name || '',
      created_at: now, updated_at: now,
    })
    res.json({ ok: true, sent_to: emails, estimate_number: est.estimate_number, total: est.total })
  } catch (e) {
    console.error('[shop-quotes send]', e.response?.data?.message || e.message)
    res.status(500).json({ error: e.response?.data?.message || e.message })
  }
})

// Board feed — everything not dead, newest first, with days waiting.
router.get('/', async (req, res) => {
  try {
    if (req.user?.demo) {
      return res.json([{
        estimate_id: 'demo-q1', estimate_number: 'EST-DEMO-101', shop: 'Demo Body Shop',
        vehicle: '2023 Toyota Camry', insurer: 'State Farm', total: 1240, cal_count: 3,
        status: 'quoted', sent_at: new Date(Date.now() - 2 * 864e5).toISOString(), days_waiting: 2,
      }])
    }
    const records = (await readQuoteRecords(req))
      .filter(q => q.status !== 'dead' && q.status !== 'billed')
      .map(q => ({
        ...q,
        days_waiting: q.status === 'quoted'
          ? Math.floor((Date.now() - new Date(q.sent_at || q.created_at)) / 864e5)
          : 0,
      }))
      .sort((a, z) => String(z.sent_at).localeCompare(String(a.sent_at)))
    res.json(records)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// We flip status by hand (Mark: "we will be doing the approval").
router.post('/:id/status', async (req, res) => {
  try {
    const status = String(req.body?.status || '')
    if (!['approved', 'dead', 'quoted'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved, dead, or quoted' })
    }
    const records = await readQuoteRecords(req)
    const q = records.find(r => r.estimate_id === req.params.id)
    if (!q) return res.status(404).json({ error: 'Quote not found' })
    q.status = status
    q.updated_at = new Date().toISOString()
    if (status === 'approved') q.approved_at = q.updated_at
    if (status === 'dead') q.dead_at = q.updated_at
    await writeQuoteRecord(req, q)
    if (status === 'approved') {
      await onQuoteApproved(req, q).catch(e => console.warn('[shop-quotes approve hook]', e.message))
    }
    res.json({ ok: true, quote: q })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/:id/resend', async (req, res) => {
  try {
    const records = await readQuoteRecords(req)
    const q = records.find(r => r.estimate_id === req.params.id)
    if (!q) return res.status(404).json({ error: 'Quote not found' })
    const token = await getAccessToken()
    const emails = q.sent_to?.length ? q.sent_to : await shopEmails(token, q.customer_id)
    if (!emails.length) return res.status(400).json({ error: 'No email on file for this shop' })
    await emailEstimate(token, q.estimate_id, emails)
    q.sent_at = new Date().toISOString()
    q.updated_at = q.sent_at
    await writeQuoteRecord(req, q)
    res.json({ ok: true, sent_to: emails })
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message })
  }
})

// ── Phase 2: approved quote must land in scheduling, not memory ─────────
async function onQuoteApproved(req, q) {
  const { postToCliqChannel, AA_JOBS_CHANNEL, DISPATCH_CHANNEL } = await import('../services/cliq.js')
  const { readJobsPublic, insertJobPublic } = await import('./jobs.js')
  const { createNotification } = await import('./notifications.js')

  // The scrub usually already made a job card for this estimate — never
  // create a duplicate. Only create one if it's missing (card deleted).
  let job = null
  try {
    const jobs = await readJobsPublic(req)
    job = (jobs || []).find(j => String(j.zoho_estimate_id) === String(q.estimate_id)) || null
  } catch { /* lookup best-effort */ }
  let createdJob = false
  if (!job) {
    try {
      job = await insertJobPublic(req, {
        status: 'job_requested',
        shop_name: q.shop,
        vehicle: q.vehicle,
        quote_number: q.ro_number || q.estimate_number,
        zoho_estimate_id: q.estimate_id,
        insurer: q.insurer,
        vin: q.vin,
        notes: `From approved quote ${q.estimate_number}`,
      })
      createdJob = true
    } catch (e) { console.warn('[shop-quotes] job create on approve failed:', e.message) }
  }

  const msg = [
    `✅ *Quote APPROVED* · ${q.shop}`,
    `${q.vehicle || 'Vehicle TBD'}${q.ro_number ? ` · RO# ${q.ro_number}` : ''} · $${Number(q.total).toFixed(2)}${q.insurer ? ` · 🏦 ${q.insurer}` : ''}`,
    createdJob ? 'New job card created — needs scheduling.' : 'Job card is on the board — schedule it.',
  ].join('\n')
  await postToCliqChannel(AA_JOBS_CHANNEL, msg).catch(e => console.warn('[shop-quotes cliq]', e.message))
  await postToCliqChannel(DISPATCH_CHANNEL, msg).catch(e => console.warn('[shop-quotes cliq]', e.message))
  await createNotification(req, {
    to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com',
    type: 'job_requested',
    title: `Quote approved: ${q.shop}`,
    body: `${q.vehicle || ''} — needs scheduling`,
    jobId: job?.id, job,
    skipCliq: true, skipTechChannel: true,
  }).catch(e => console.warn('[shop-quotes notif]', e.message))
}

// ── Phase 2: discount registry endpoints ────────────────────────────────
router.get('/discounts', async (req, res) => {
  try {
    const app = catalyst.initialize(req)
    res.json(await readDiscounts(app))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/discounts/:customerId', async (req, res) => {
  try {
    if (req.user?.role === 'technician') return res.status(403).json({ error: 'Staff only' })
    const pct = Number(req.body?.pct)
    if (!(pct >= 0 && pct <= 50)) return res.status(400).json({ error: 'pct must be 0-50' })
    const app = catalyst.initialize(req)
    const map = await readDiscounts(app)
    map[req.params.customerId] = pct
    await cfgSet(app, DISCOUNTS_KEY, map)
    res.json({ ok: true, customer_id: req.params.customerId, pct })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Phase 3: one-tap billing ────────────────────────────────────────────
// Insurance invoice = the SAME Books estimate, final scope, re-rendered
// with the insurance-invoice template and re-sent (list price — the shop
// forwards it to the insurer). Cost invoice = real Books invoice built
// from the estimate's lines with the shop's discount applied (what the
// shop pays us). Two emails, zero retyping.
async function resolveInsuranceTemplateId(req, token) {
  const app = catalyst.initialize(req)
  const override = await cfgRow(app, 'INSURANCE_TEMPLATE_ID')
  if (override?.config_value) return override.config_value.replace(/"/g, '')
  const cached = await cfgRow(app, 'insurance_template_id_cache')
  if (cached?.config_value) return cached.config_value.replace(/"/g, '')
  try {
    const r = await axios.get(`${ZOHO_API_BASE}/estimates/templates`, {
      headers: zohoHeaders(token), params: orgParam(), timeout: 15000,
    })
    const templates = r.data?.templates || []
    const hit = templates.find(t => /insur/i.test(t.template_name || ''))
      || templates.find(t => /invoic/i.test(t.template_name || ''))
    if (hit?.template_id) {
      await cfgSet(app, 'insurance_template_id_cache', hit.template_id)
      console.log('[shop-quotes] insurance template', hit.template_name, hit.template_id)
      return hit.template_id
    }
    console.warn('[shop-quotes] no *insurance* estimate template — keeping current. Names:',
      templates.map(t => t.template_name).join(', '))
  } catch (e) { console.warn('[shop-quotes] insurance template lookup failed:', e.message) }
  return null
}

router.get('/:id/billing-preview', async (req, res) => {
  try {
    const records = await readQuoteRecords(req)
    const q = records.find(r => r.estimate_id === req.params.id)
    if (!q) return res.status(404).json({ error: 'Quote not found' })
    const token = await getAccessToken()
    const est = await getEstimate(token, q.estimate_id)
    if (!est) return res.status(404).json({ error: 'Estimate no longer exists in Books' })
    const app = catalyst.initialize(req)
    const discounts = await readDiscounts(app)
    const pct = discounts[q.customer_id] ?? null
    const insuranceTotal = Number(est.total) || 0
    res.json({
      ok: true,
      shop: q.shop,
      quoted_total: Number(q.total) || 0,
      insurance_total: insuranceTotal,
      drift: Math.abs(insuranceTotal - (Number(q.total) || 0)) > 0.005,
      discount_pct: pct,
      cost_total: pct != null ? Math.round(insuranceTotal * (100 - pct)) / 100 : null,
    })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

router.post('/:id/bill', async (req, res) => {
  try {
    if (req.user?.role === 'technician') return res.status(403).json({ error: 'Staff only' })
    const pct = Number(req.body?.discount_pct)
    if (!(pct >= 0 && pct <= 50)) return res.status(400).json({ error: 'discount_pct must be 0-50' })
    const records = await readQuoteRecords(req)
    const q = records.find(r => r.estimate_id === req.params.id)
    if (!q) return res.status(404).json({ error: 'Quote not found' })
    if (q.status === 'billed') return res.status(409).json({ error: `Already billed (invoice ${q.cost_invoice_number || q.cost_invoice_id})` })

    const token = await getAccessToken()
    const est = await getEstimate(token, q.estimate_id)
    if (!est) return res.status(404).json({ error: 'Estimate no longer exists in Books' })
    const emails = q.sent_to?.length ? q.sent_to : await shopEmails(token, est.customer_id)
    if (!emails.length) return res.status(400).json({ error: 'No email on file for this shop' })

    // Remember the discount for this shop — asked once, never again.
    const app = catalyst.initialize(req)
    const discounts = await readDiscounts(app)
    if (discounts[q.customer_id] !== pct) {
      discounts[q.customer_id] = pct
      await cfgSet(app, DISCOUNTS_KEY, discounts)
    }

    // 1. Insurance invoice: re-render + re-send the estimate at list.
    const insTemplate = await resolveInsuranceTemplateId(req, token)
    await applyTemplate(token, q.estimate_id, insTemplate)
    await emailEstimate(token, q.estimate_id, emails)

    // 2. Cost invoice: same lines, shop discount, sent as a separate
    // email (shops forward the insurance one to the insurer untouched).
    const lineItems = (est.line_items || []).map(li => ({
      ...(li.item_id ? { item_id: li.item_id } : { name: li.name }),
      description: li.description || '',
      rate: li.rate,
      quantity: li.quantity,
    }))
    const invRes = await axios.post(`${ZOHO_API_BASE}/invoices`, {
      customer_id: est.customer_id,
      reference_number: q.ro_number ? `RO ${q.ro_number}` : est.estimate_number,
      salesperson_name: est.salesperson_name || q.salesperson || '',
      line_items: lineItems,
      discount: `${pct}%`,
      discount_type: 'entity_level',
      is_discount_before_tax: true,
      notes: `Partnership discount ${pct}% applied · from quote ${est.estimate_number}`,
    }, { headers: zohoHeaders(token), params: orgParam(), timeout: 20000 })
    const inv = invRes.data?.invoice
    if (!inv?.invoice_id) throw new Error('Cost invoice creation returned no invoice')
    await axios.post(`${ZOHO_API_BASE}/invoices/${inv.invoice_id}/email`,
      { to_mail_ids: emails },
      { headers: zohoHeaders(token), params: orgParam(), timeout: 20000 })

    const now = new Date().toISOString()
    Object.assign(q, {
      status: 'billed', billed_at: now, updated_at: now,
      discount_pct: pct,
      insurance_total: Number(est.total) || 0,
      cost_invoice_id: inv.invoice_id,
      cost_invoice_number: inv.invoice_number || '',
      cost_total: Number(inv.total) || 0,
    })
    await writeQuoteRecord(req, q)

    try {
      const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
        `🧾 *Billed from quote* — ${q.shop}\n` +
        `Insurance invoice ${est.estimate_number}: $${Number(est.total).toFixed(2)} · ` +
        `Cost invoice ${inv.invoice_number}: $${Number(inv.total).toFixed(2)} (${pct}% partnership discount)`)
    } catch { /* non-fatal */ }

    res.json({
      ok: true, sent_to: emails,
      insurance_total: Number(est.total) || 0,
      cost_invoice_number: inv.invoice_number,
      cost_total: Number(inv.total) || 0,
      discount_pct: pct,
    })
  } catch (e) {
    console.error('[shop-quotes bill]', e.response?.data?.message || e.message)
    res.status(500).json({ error: e.response?.data?.message || e.message })
  }
})

export { router as shopQuotesRouter }
