// Public estimate approval (spec + Mark: "send quotes… so I can approve").
// Signed link, no login. The shop or car owner sees the estimate, approves
// or declines each job (that is the RCW authorization: method = portal,
// name, time, IP), and can download the itemized PDF.
import express from 'express'
import { verifyEstimateToken, loadFull, renderPdf } from './estimatorMore.js'
import { authorizationComplete } from '../services/estimator/calc.js'

export function publicRouter(I) {
  const R = express.Router()
  const { tbl, T, jobToRow, estToRow, now } = I
  const check = (req, res) => { const d = verifyEstimateToken(req.query.t || req.body?.t, req.params.id); if (!d) { res.status(401).json({ error: 'This link is invalid or has expired. Ask Absolute ADAS to resend it.' }); return null } return d }
  const view = f => ({
    id: f.est.id, number: f.est.number, status: f.est.status, customer_name: f.est.customer_name, customer_contact: { name: f.est.customer_contact?.name || '' },
    vehicle: [f.est.year, f.est.make, f.est.model, f.est.trim].filter(Boolean).join(' '), vin: f.est.vin, plate: f.est.plate, mileage: f.est.mileage, ro_number: f.est.ro_number, insurer: f.est.insurer, concern: f.est.concern,
    created_at: f.est.created_at, valid_until: f.est.valid_until, sent_at: f.est.sent_at, tax_enabled: f.est.tax_enabled, supplies_enabled: f.est.supplies_enabled, discount_type: f.est.discount_type, discount_value: f.est.discount_value,
    totals: f.totals, company: f.settings.company || {}, warranty: { months: Number(f.settings.warranty_months ?? 12) || 0, miles: Number(f.settings.warranty_miles ?? 12000) || 0 },
    jobs: f.jobs.map(j => ({ id: j.id, name: j.name, invoice_description: j.invoice_description, category: j.category, status: j.status, total_cents: j.total_cents, labor_cents: j.labor_cents, parts_cents: j.parts_cents, decline_reason: j.decline_reason, authorized_by_name: j.authorized_by_name, authorized_at: j.authorized_at, authorized_method: j.authorized_method,
      lines: (j.lines || []).map(l => ({ desc: l.desc, hours: l.hours, labor_cents: l.labor_cents, flat: l.flat_cents != null, parts: (l.parts || []).map(p => ({ pn: p.pn, desc: p.desc, source: p.source, qty: p.qty, price_each_cents: p.price_each_cents, total_cents: p.total_cents })) })) })),
  })
  const ip = req => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 60)

  R.get('/:id', async (req, res) => {
    try { if (!check(req, res)) return; const f = await loadFull(req, I, req.params.id); if (!f) return res.status(404).json({ error: 'Estimate not found' }); res.json({ ok: true, estimate: view(f) }) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })
  R.get('/:id/pdf', async (req, res) => {
    try { if (!check(req, res)) return; const buf = await renderPdf(req, I, req.params.id, 'estimate'); if (!buf) return res.status(404).send('Not found'); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="AbsoluteADAS-estimate.pdf"`); res.send(buf) }
    catch (e) { res.status(500).send(e.message) }
  })
  async function decide(req, res, status) {
    if (!check(req, res)) return
    const f = await loadFull(req, I, req.params.id); if (!f) return res.status(404).json({ error: 'Estimate not found' })
    if (f.est.status === 'invoiced') return res.status(409).json({ error: 'This estimate has already been invoiced.' })
    const name = String(req.body?.name || '').trim().slice(0, 120)
    if (!name) return res.status(422).json({ error: 'Please enter your name so we can record the authorization.' })
    const ids = req.params.jid ? [String(req.params.jid)] : f.jobs.filter(j => j.status !== 'declined').map(j => j.id)
    const changed = []
    for (const jid of ids) {
      const job = f.jobs.find(j => j.id === jid); if (!job) continue
      const patch = status === 'approved'
        ? { status: 'approved', authorized_at: now(), authorized_by_name: name, authorized_method: 'portal', authorized_by_employee: 'customer via approval link', authorized_amount_cents: job.total_cents, authorized_meta: `ip ${ip(req)} · ${String(req.body?.contact || '').slice(0, 80)}` }
        : { status: 'declined', decline_reason: `Declined by ${name} via approval link${req.body?.reason ? `: ${String(req.body.reason).slice(0, 180)}` : ''}` }
      if (status === 'approved' && !authorizationComplete(patch).ok) continue
      await tbl(req, T.job).updateRow({ ROWID: jid, ...jobToRow({ ...patch, updated_at: now() }) })
      changed.push(job.name)
    }
    const full = await I.recompute(req, f.est.id)
    const live = full.jobs.filter(j => j.status !== 'declined')
    const estPatch = {}
    if (live.length && live.every(j => j.status === 'approved') && full.status !== 'approved') Object.assign(estPatch, { status: 'approved', approved_at: now() })
    else if (!live.length && full.status !== 'declined') Object.assign(estPatch, { status: 'declined' })
    if (Object.keys(estPatch).length) await tbl(req, T.est).updateRow({ ROWID: String(f.est.id), ...estToRow({ ...estPatch, updated_at: now() }) })
    // Phase F (Mark 2026-09-22): the signed yes creates or links the job card.
    // Linked request → Needs Dispatch (Kat schedules it). No card yet → make one.
    if (estPatch.status === 'approved') {
      try {
        const J = await import('./jobs.js')
        const approvedTotal = (full.totals?.grand_total || 0) / 100
        const cals = live.map(j => ({ calibration_name: j.name, enabled: true, cal_type: '', trigger: `Estimate ${f.est.number} approved by ${name}`, justification: j.invoice_description || '' }))
        const noteLine = `📝 Estimate ${f.est.number} approved by ${name} · $${approvedTotal.toFixed(2)} · ${live.length} job${live.length === 1 ? '' : 's'}`
        let card = f.est.job_id ? (await J.readJobsPublic(req)).find(x => String(x.id) === String(f.est.job_id)) : null
        if (card) {
          const patch = { ...card, calibrations: JSON.stringify(cals), notes: `${card.notes ? card.notes + '\n' : ''}${noteLine}` }
          if (card.status === 'job_requested') { patch.status = card.technician ? (card.technician === 'Jayden' ? 'dispatched_jaden' : card.technician === 'Mark' ? 'dispatched_mark' : 'need_dispatch') : 'need_dispatch'; patch.request_type = '' }
          await J.updateJobPublic(req, card.id, patch)
        } else {
          const customer = f.est.customer_kind === 'retail' ? { kind: 'retail', id: f.est.customer_id || '', name: f.est.customer_name, zoho_contact_id: f.est.zoho_contact_id || '' } : { kind: 'shop', id: '', name: f.est.customer_name, zoho_contact_id: f.est.zoho_contact_id || '' }
          card = await J.insertJobPublic(req, { shop_name: f.est.customer_name, year: f.est.year || '', make: f.est.make || '', model: f.est.model || '', vehicle: [f.est.year, f.est.make, f.est.model].filter(Boolean).join(' '), vin: f.est.vin || '', insurer: f.est.insurer || '', quote_number: f.est.ro_number || '', status: 'need_dispatch', calibrations: JSON.stringify(cals), notes: noteLine, customer, created_at: now() })
          await tbl(req, T.est).updateRow({ ROWID: String(f.est.id), ...estToRow({ job_id: String(card.id), updated_at: now() }) })
        }
        const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js')
        postToCliqChannel(DISPATCH_CHANNEL, `🗂 Job card ${f.est.job_id ? 'updated' : 'created'} from estimate ${f.est.number} → ${card.status === 'need_dispatch' ? 'Needs Dispatch' : card.status}. Bill it on that card uses the estimate.`).catch(() => {})
      } catch (e) { console.warn('[estimator approve] job card hook failed:', e.message) }
    }
    try {
      const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js')
      postToCliqChannel(DISPATCH_CHANNEL, `${status === 'approved' ? '✅' : '❌'} *Estimate ${f.est.number} · ${name} ${status} ${changed.length === 1 ? changed[0] : changed.length + ' jobs'}* · ${f.est.customer_name} · ${[f.est.year, f.est.make, f.est.model].filter(Boolean).join(' ')} · approved total now ${(full.totals.grand_total / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}${estPatch.status ? ` · estimate ${estPatch.status.toUpperCase()}` : ''}`).catch(() => {})
    } catch { /* optional */ }
    const f2 = await loadFull(req, I, f.est.id)
    res.json({ ok: true, changed, estimate: view(f2) })
  }
  R.post('/:id/jobs/:jid/approve', (req, res) => decide(req, res, 'approved').catch(e => res.status(500).json({ error: e.message })))
  R.post('/:id/jobs/:jid/decline', (req, res) => decide(req, res, 'declined').catch(e => res.status(500).json({ error: e.message })))
  R.post('/:id/approve-all', (req, res) => decide(req, res, 'approved').catch(e => res.status(500).json({ error: e.message })))
  return R
}
