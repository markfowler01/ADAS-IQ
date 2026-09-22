// Estimator phases 4–6 (2026-09-14, Mark: "build it all out"):
//   send (email + text with a signed approval link), PDF, Zoho Books push,
//   Rick's 3 C's per job, 3C template library. Mounted onto the estimator
//   router by estimator.js so it shares the loaders and the recompute.
import crypto from 'crypto'
import { buildEstimatePdf } from '../services/estimator/pdf.js'
import { pushToBooks } from '../services/estimator/booksPush.js'
import { generateThreeC, inputsToText, PLACEHOLDER_RE, TRIGGERS, SYSTEMS, BLOCKERS, OUTCOMES, POST_SCAN } from '../services/estimator/threeC.js'
import { computeEstimate } from '../services/estimator/calc.js'

const T3 = 'EstThreeC'
export function tokenSecret() { return process.env.SESSION_SECRET || 'adasiq-portal-secret' }
export function makeEstimateToken(id) {
  const body = Buffer.from(JSON.stringify({ type: 'estimate_approval', estimate_id: String(id), exp: Date.now() + 90 * 86400000 })).toString('base64url')
  return `${body}.${crypto.createHmac('sha256', tokenSecret()).update(body).digest('base64url')}`
}
export function verifyEstimateToken(token, id) {
  if (!token) return null
  const [body, sig] = String(token).split('.')
  if (!body || !sig) return null
  if (sig !== crypto.createHmac('sha256', tokenSecret()).update(body).digest('base64url')) return null
  try { const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); if (d.type !== 'estimate_approval' || d.exp < Date.now() || String(d.estimate_id) !== String(id)) return null; return d } catch { return null }
}
export function approvalUrl(req, id) {
  const base = process.env.WEB_BASE_URL || `${req.protocol}://${req.get('host')}/app`
  // Catalyst static hosting only serves real files (no SPA rewrites), so the link targets /app/?estimate=…
  return `${base}/?estimate=${encodeURIComponent(id)}&t=${encodeURIComponent(makeEstimateToken(id))}`
}

const rowToTC = r => ({ id: String(r.ROWID), job_id: r.ec_job_id || '', estimate_id: r.ec_estimate_id || '', trigger_event: r.ec_trigger_event || '', systems: String(r.ec_systems || '').split('|').filter(Boolean), outcome: r.ec_outcome || '', audience: r.ec_audience || '', inputs: safe(r.ec_inputs_json, {}), generated: safe(r.ec_generated_json, null), approved: safe(r.ec_approved_json, null), approved_at: r.ec_approved_at || '', approved_by: r.ec_approved_by || '', model_used: r.ec_model_used || '', created_at: r.ec_created_at || r.CREATEDTIME || '' })
const safe = (v, f) => { if (v == null || v === '') return f; try { return JSON.parse(v) } catch { return f } }

/** Full estimate (est + computed jobs + totals) or null. Shared with the public router. */
export async function loadFull(req, I, id) {
  const est = await I.getEst(req, id); if (!est) return null
  const jobs = await I.getJobs(req, est.id)
  const settings = await I.loadSettings(req)
  const r = computeEstimate({ ...est, jobs }, settings)
  return { est, jobs: r.jobs, totals: r.totals, settings }
}
export async function approvedThreeC(req, I, estId) {
  const rows = I.unwrap(await I.zcql(req, `SELECT * FROM ${T3} WHERE ec_estimate_id = '${I.esc(estId)}' LIMIT 100`).catch(() => []), T3).map(rowToTC)
  const by = {}
  for (const t of rows) if (t.approved) by[t.job_id] = t.approved
  return by
}
export function threeCNotesText(byJob, jobs) {
  return jobs.filter(j => j.status === 'approved' && byJob[j.id]).map(j => { const t = byJob[j.id]; return `${j.name}\nConcern: ${t.concern}\nCause: ${t.cause}\nCorrection: ${t.correction}\nVerification: ${t.verification}` }).join('\n\n')
}
export async function renderPdf(req, I, id, kind) {
  const f = await loadFull(req, I, id); if (!f) return null
  const threeC = await approvedThreeC(req, I, id)
  const company = f.settings.company || {}
  const warranty = { months: Number(f.settings.warranty_months ?? 12) || 0, miles: Number(f.settings.warranty_miles ?? 12000) || 0 }
  return buildEstimatePdf({ est: f.est, jobs: f.jobs, totals: f.totals, kind, company, threeC, warranty })
}

/** Bill it (Phase F): create the Books invoice from an approved estimate — same
 *  push the estimator's own button does (3 C's notes, tax, discount), same
 *  row patch. internals is imported lazily to dodge the circular import. */
export async function pushEstimateInvoice(req, estId, by = 'staff') {
  const { internals: I } = await import('./estimator.js')
  const f = await loadFull(req, I, estId); if (!f) throw new Error('Estimate not found')
  if (f.est.status === 'invoiced' && f.est.zoho_invoice_id) return { id: f.est.zoho_invoice_id, number: f.est.zoho_invoice_number || '', warnings: ['already invoiced'], existing: true }
  const byJob = await approvedThreeC(req, I, f.est.id)
  const out = await pushToBooks({ req, est: f.est, jobs: f.jobs, totals: f.totals, settings: f.settings, mode: 'invoice', detail: null, by, threeCNotes: threeCNotesText(byJob, f.jobs) })
  await I.tbl(req, I.T.est).updateRow({ ROWID: String(f.est.id), ...I.estToRow({ zoho_invoice_id: out.id, zoho_invoice_number: out.number, status: 'invoiced', pushed_at: I.now(), push_status: `invoice ${out.number} via Bill it by ${by}${out.warnings?.length ? ' · ' + out.warnings.join(' · ') : ''}`.slice(0, 255), updated_at: I.now() }) })
  return out
}

export function mountMore(R, I) {
  const { staffOnly, fail, tbl, T, estToRow, now, who, isOwner } = I

  // ── PDF (staff) ────────────────────────────────────────────────────────
  R.get('/:id/pdf', async (req, res) => {
    try {
      const kind = req.query.kind === 'invoice' ? 'invoice' : 'estimate'
      const buf = await renderPdf(req, I, req.params.id, kind); if (!buf) return res.status(404).json({ error: 'Estimate not found' })
      const est = await I.getEst(req, req.params.id)
      res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `${req.query.dl ? 'attachment' : 'inline'}; filename="AbsoluteADAS-${kind}-${est.number}.pdf"`); res.send(buf)
    } catch (e) { fail(res, e, 'pdf') }
  })
  R.get('/:id/link', staffOnly, async (req, res) => { try { res.json({ ok: true, url: approvalUrl(req, req.params.id) }) } catch (e) { fail(res, e, 'link') } })

  // ── Send: email and/or text the approval link; marks the estimate sent ──
  R.post('/:id/send', staffOnly, async (req, res) => {
    try {
      const f = await loadFull(req, I, req.params.id); if (!f) return res.status(404).json({ error: 'Estimate not found' })
      const { est, totals } = f
      if (est.status === 'invoiced') return res.status(409).json({ error: 'Invoiced estimates are locked.' })
      const ready = I.readyToSend({ ...est, jobs: f.jobs })
      if (!ready.ok && !(req.body?.force && isOwner(req))) return res.status(422).json({ error: `Not ready to send: ${ready.missing.join(', ')}`, missing: ready.missing })
      const b = req.body || {}
      const url = approvalUrl(req, est.id)
      const vehicle = [est.year, est.make, est.model].filter(Boolean).join(' ')
      const results = { email: null, sms: null }
      const openCents = totals.grand_total + totals.recommended_total
      if (b.email) {
        try {
          const { getMailAccessToken, getMailAccountId, sendMail } = await import('../services/mail.js')
          const token = await getMailAccessToken(); const accountId = await getMailAccountId(token)
          const jobsHtml = f.jobs.map(j => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${j.name}${j.invoice_description && j.invoice_description !== j.name ? `<div style="color:#666;font-size:12px">${j.invoice_description}</div>` : ''}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${(j.total_cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</td></tr>`).join('')
          const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:560px;color:#1a1a1a">
            <div style="background:#CD4419;color:white;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:700">Absolute ADAS · Estimate ${est.number}</div>
            <div style="border:1px solid #e8e4e0;border-top:none;padding:18px;border-radius:0 0 10px 10px">
              <p>Hi ${(est.customer_contact?.name || est.customer_name || '').split(' ')[0] || 'there'},</p>
              <p>${b.message ? String(b.message).replace(/</g, '&lt;').replace(/\n/g, '<br>') : `Here is your estimate for the <b>${vehicle || 'vehicle'}</b>${est.ro_number ? ` (RO ${est.ro_number})` : ''}. Tap the button to review it, approve the work you want done, and we'll get it scheduled.`}</p>
              <table style="width:100%;border-collapse:collapse;margin:12px 0">${jobsHtml}<tr><td style="padding:8px;font-weight:700">Total for approved work</td><td style="padding:8px;text-align:right;font-weight:700">${(totals.grand_total / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</td></tr></table>
              <p style="text-align:center;margin:20px 0"><a href="${url}" style="background:#15803d;color:white;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">Review &amp; approve estimate</a></p>
              <p style="color:#666;font-size:12px">The link is good for 90 days. Charges will not exceed 110% of the amount you authorize, exclusive of sales tax, without your further authorization (RCW 46.71).</p>
              <p style="color:#666;font-size:12px">Absolute ADAS · Mobile ADAS Calibration &amp; Diagnostics · absoluteadas.com</p>
            </div></div>`
          await sendMail(token, accountId, { to: b.email, subject: `Estimate ${est.number} · ${vehicle || 'your vehicle'} · Absolute ADAS`, body: html })
          results.email = { ok: true, to: b.email }
        } catch (e) { results.email = { ok: false, to: b.email, error: e.message } }
      }
      if (b.phone) {
        try {
          const { sendTwilioSMS, resolvePhoneConfig, normalizePhoneUS } = await import('../services/twilio.js')
          const cfg = await resolvePhoneConfig(req)
          const body = `Absolute ADAS: your estimate ${est.number} for the ${vehicle || 'vehicle'} is ready (${(openCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} incl. options). Review and approve here: ${url}${b.message ? `\n${String(b.message).slice(0, 200)}` : ''}`
          await sendTwilioSMS({ to: normalizePhoneUS(b.phone) || b.phone, body, from: 'local', cfg })
          results.sms = { ok: true, to: b.phone }
        } catch (e) { results.sms = { ok: false, to: b.phone, error: e.message } }
      }
      const anyOk = results.email?.ok || results.sms?.ok || (!b.email && !b.phone)
      const note = `${now().slice(0, 16).replace('T', ' ')} sent by ${who(req)}${results.email ? ` · email ${results.email.ok ? '✓' : '✗ ' + results.email.error} ${results.email.to}` : ''}${results.sms ? ` · text ${results.sms.ok ? '✓' : '✗ ' + results.sms.error} ${results.sms.to}` : ''}`
      const patch = { approve_token: url.slice(-40), notes: [est.notes, ''].join('').slice(0, 9000), updated_at: now() }
      if (anyOk) { patch.status = 'sent'; patch.sent_at = now() }
      await tbl(req, T.est).updateRow({ ROWID: String(est.id), ...estToRow(patch), es_push_status: note.slice(0, 255) })
      try { const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js'); if (anyOk) postToCliqChannel(DISPATCH_CHANNEL, `📤 *Estimate ${est.number} sent* · ${est.customer_name} · ${vehicle} · ${(totals.grand_total / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} approved-so-far${results.email ? ` · email ${results.email.ok ? '✓' : '✗'}` : ''}${results.sms ? ` · text ${results.sms.ok ? '✓' : '✗'}` : ''} · by ${who(req)}`).catch(() => {}) } catch { /* optional */ }
      res.status(anyOk ? 200 : 502).json({ ok: anyOk, url, results, estimate: await I.recompute(req, est.id) })
    } catch (e) { fail(res, e, 'send') }
  })

  // ── Books push ────────────────────────────────────────────────────────
  R.post('/:id/push', staffOnly, async (req, res) => {
    try {
      const f = await loadFull(req, I, req.params.id); if (!f) return res.status(404).json({ error: 'Estimate not found' })
      const mode = req.body?.mode === 'estimate' ? 'estimate' : 'invoice'
      const byJob = await approvedThreeC(req, I, f.est.id)
      const out = await pushToBooks({ req, est: f.est, jobs: f.jobs, totals: f.totals, settings: f.settings, mode, detail: req.body?.detail || null, by: who(req), threeCNotes: threeCNotesText(byJob, f.jobs) })
      const patch = mode === 'invoice' ? { zoho_invoice_id: out.id, zoho_invoice_number: out.number, status: 'invoiced', pushed_at: now(), push_status: `invoice ${out.number} by ${who(req)}${out.warnings.length ? ' · ' + out.warnings.join(' · ') : ''}`.slice(0, 255) }
        : { zoho_estimate_id: out.id, zoho_estimate_number: out.number, pushed_at: now(), push_status: `estimate ${out.number} by ${who(req)}`.slice(0, 255) }
      await tbl(req, T.est).updateRow({ ROWID: String(f.est.id), ...estToRow({ ...patch, updated_at: now() }) })
      try { const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js'); postToCliqChannel(DISPATCH_CHANNEL, `🧾 *${mode === 'invoice' ? 'Invoice' : 'Books estimate'} ${out.number} created from estimate ${f.est.number}* · ${f.est.customer_name} · ${(f.totals.grand_total / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} · draft in Books · by ${who(req)}`).catch(() => {}) } catch { /* optional */ }
      res.json({ ok: true, ...out, estimate: await I.recompute(req, f.est.id) })
    } catch (e) { console.log('[estimator] push:', e.message); res.status(e.status || 500).json({ error: e.message, books: e.books || null }) }
  })

  // ── 3 C's (Rick) ─────────────────────────────────────────────────────
  R.get('/threec/options', (req, res) => res.json({ ok: true, triggers: TRIGGERS, systems: SYSTEMS, blockers: BLOCKERS, outcomes: OUTCOMES, post_scan: POST_SCAN }))
  R.get('/threec/library', async (req, res) => {
    try {
      const rows = I.unwrap(await I.zcql(req, `SELECT * FROM ${T3} ORDER BY CREATEDTIME DESC LIMIT 300`), T3).map(rowToTC).filter(t => t.approved)
      const by = {}
      for (const t of rows) (by[t.trigger_event || 'other'] = by[t.trigger_event || 'other'] || []).push({ id: t.id, systems: t.systems, outcome: t.outcome, approved: t.approved, approved_at: t.approved_at, vehicle: t.inputs?.vehicle || '' })
      res.json({ ok: true, library: by })
    } catch (e) { fail(res, e, 'threec library') }
  })
  async function getTC(req, jobId) {
    const rows = I.unwrap(await I.zcql(req, `SELECT * FROM ${T3} WHERE ec_job_id = '${I.esc(jobId)}' ORDER BY CREATEDTIME DESC LIMIT 1`), T3)
    return rows[0] ? rowToTC(rows[0]) : null
  }
  function prefill(est, job) {
    const name = `${job.name} ${(job.lines || []).map(l => l.desc).join(' ')}`.toLowerCase()
    const systems = SYSTEMS.filter(s => s !== 'other' && name.includes(s.replace(/ (front|rear|left|right)$/, '')) || (s === 'front camera' && /camera|windshield/.test(name)) || (s === 'front radar' && /radar/.test(name) && !/blind|rear/.test(name)) || (s === 'left blind spot' && /blind/.test(name)) || (s === 'right blind spot' && /blind/.test(name)))
    const trig = /windshield/.test(name) ? 'windshield replacement' : /front bumper/.test(name) ? 'front bumper cover R&R or replacement' : /rear bumper/.test(name) ? 'rear bumper R&R or replacement' : /mirror/.test(name) ? 'mirror replacement' : /align/.test(name) ? 'wheel alignment performed' : /program|module/.test(name) ? 'module replacement or reprogramming' : /diagnos|fault|code/.test(name) ? 'customer-reported system fault' : ''
    return { vehicle: [est.year, est.make, est.model, est.trim].filter(Boolean).join(' '), vin: est.vin, ro_number: est.ro_number, shop: est.customer_name, trigger_event: trig, systems: [...new Set(systems)], calibration_types: {}, pre_scan_dtcs: '', no_dtcs_present: false, post_scan_result: '', post_scan_remaining_dtcs: '', outcome: 'completed', blocking_reason: '', road_test: false, oem_reference: '', audience: est.insurer ? 'insurer' : 'shop', free_notes: '' }
  }
  R.get('/:id/jobs/:jid/threec', async (req, res) => {
    try {
      const f = await loadFull(req, I, req.params.id); if (!f) return res.status(404).json({ error: 'Estimate not found' })
      const job = f.jobs.find(j => j.id === String(req.params.jid)); if (!job) return res.status(404).json({ error: 'Job not found' })
      const rec = await getTC(req, job.id)
      res.json({ ok: true, record: rec, prefill: prefill(f.est, job), options: { triggers: TRIGGERS, systems: SYSTEMS, blockers: BLOCKERS, outcomes: OUTCOMES, post_scan: POST_SCAN } })
    } catch (e) { fail(res, e, 'threec get') }
  })
  async function saveTC(req, estId, jobId, inputs, extra = {}) {
    const cur = await getTC(req, jobId)
    const row = { ec_job_id: String(jobId), ec_estimate_id: String(estId), ec_trigger_event: String(inputs.trigger_event || '').slice(0, 80), ec_systems: (inputs.systems || []).join('|').slice(0, 255), ec_outcome: String(inputs.outcome || '').slice(0, 40), ec_audience: String(inputs.audience || '').slice(0, 20), ec_inputs_json: JSON.stringify(inputs).slice(0, 9500), ...extra }
    if (cur) { await tbl(req, T3).updateRow({ ROWID: cur.id, ...row }); return cur.id }
    const ins = await tbl(req, T3).insertRow({ ...row, ec_created_at: now() }); return String(ins.ROWID)
  }
  R.put('/:id/jobs/:jid/threec', staffOnly, async (req, res) => { try { const id = await saveTC(req, req.params.id, req.params.jid, req.body?.inputs || {}); res.json({ ok: true, id }) } catch (e) { fail(res, e, 'threec save') } })
  R.post('/:id/jobs/:jid/threec/generate', staffOnly, async (req, res) => {
    try {
      const inputs = req.body?.inputs || {}
      const settings = await I.loadSettings(req)
      // Learning loop: last three approved sets with the same trigger become examples
      const ex = inputs.trigger_event ? I.unwrap(await I.zcql(req, `SELECT * FROM ${T3} WHERE ec_trigger_event = '${I.esc(inputs.trigger_event)}' ORDER BY CREATEDTIME DESC LIMIT 20`).catch(() => []), T3).map(rowToTC).filter(t => t.approved && t.job_id !== String(req.params.jid)).slice(0, 3).map(t => ({ inputs: t.inputs, approved: t.approved })) : []
      const out = await generateThreeC({ inputs, examples: ex, model: settings.rick_model_3c || settings.rick_model || 'claude-sonnet-4-6' })
      const generated = out.ok ? { concern: out.concern, cause: out.cause, correction: out.correction, verification: out.verification } : { raw: out.raw }
      const id = await saveTC(req, req.params.id, req.params.jid, inputs, { ec_generated_json: JSON.stringify(generated).slice(0, 9500), ec_model_used: out.model })
      res.json({ ok: true, id, generated, examples_used: ex.length, model: out.model, input_text: inputsToText(inputs) })
    } catch (e) { fail(res, e, 'threec generate') }
  })
  R.post('/:id/jobs/:jid/threec/approve', staffOnly, async (req, res) => {
    try {
      const a = req.body?.approved || {}
      const fields = ['concern', 'cause', 'correction', 'verification']
      const bad = fields.filter(k => PLACEHOLDER_RE.test(String(a[k] || '')))
      if (bad.length) return res.status(422).json({ error: `Fill the placeholders in: ${bad.join(', ')}`, fields: bad })
      if (fields.some(k => !String(a[k] || '').trim())) return res.status(422).json({ error: 'All four sections are required.' })
      const approved = Object.fromEntries(fields.map(k => [k, String(a[k]).trim().slice(0, 2000)]))
      const inputs = req.body?.inputs || (await getTC(req, req.params.jid))?.inputs || {}
      const id = await saveTC(req, req.params.id, req.params.jid, inputs, { ec_approved_json: JSON.stringify(approved), ec_approved_at: now(), ec_approved_by: who(req) })
      // Append to the job notes (spec: on approve → job notes → Books notes on push → PDF)
      const jr = await tbl(req, T.job).getRow(String(req.params.jid))
      if (jr) { const cur = String(jr.ej_notes || '').replace(/\n?— 3 C's —[\s\S]*$/, ''); await tbl(req, T.job).updateRow({ ROWID: String(req.params.jid), ej_three_c_id: id, ej_notes: `${cur}${cur ? '\n' : ''}— 3 C's —\nConcern: ${approved.concern}\nCause: ${approved.cause}\nCorrection: ${approved.correction}\nVerification: ${approved.verification}`.slice(0, 9000) }) }
      res.json({ ok: true, id, approved, estimate: await I.recompute(req, req.params.id) })
    } catch (e) { fail(res, e, 'threec approve') }
  })
}
