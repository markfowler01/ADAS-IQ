// 🔬 Scrub button + scrub library (Mark 2026-09-28).
//
//   POST /api/scrubs/job/:id      run a scrub on that card's estimate, now
//   GET  /api/scrubs              search the library
//   GET  /api/scrubs/stats        how many scrubs we hold
//   GET  /api/scrubs/job/:id      every scrub ever run on one card
//   GET  /api/scrubs/:id          one scrub, full payload
//
// The run route deliberately reuses the email queue's machinery rather than
// repeating it: requeueScrub picks the right PDF out of the car's WorkDrive
// folder, runScrubQueue does the scrub, patches the card, writes the review
// blob and posts to Cliq. The button just starts it and waits.
//
// Catalyst caps a gateway request near 30s. A scrub usually lands inside
// that (the upload screen has always run one synchronously), but when it
// does not we return queued:true and the 15-minute ticker finishes the job
// instead of the request dying with nothing saved.
import express from 'express'
import { requeueScrub, runScrubQueue, scrubQueue } from '../services/emailToJob.js'
import { listScrubs, getScrub, scrubsForJob, scrubStats, refreshFromCard } from '../services/scrubStore.js'

const router = express.Router()
const who = req => req.user?.name || req.user?.email || 'staff'

// ── Run a scrub on a card, on demand ────────────────────────────────────────
router.post('/job/:id', async (req, res) => {
  const jobId = String(req.params.id || '')
  if (!jobId) return res.status(400).json({ error: 'job id required' })
  try {
    const picked = await requeueScrub(req, jobId, { source: 'button', by: who(req) })
    const run = await runScrubQueue(req, { max: 1 })
    const item = (run.items || [])[0] || {}
    if (run.ok) {
      const scrubs = await scrubsForJob(req, jobId)
      return res.json({ ok: true, file: picked.name, scrub: scrubs[0] || null, result: item.result || 'scrubbed' })
    }
    if (run.failed) return res.status(502).json({ error: item.result || 'the scrub failed', file: picked.name })
    // Still on the queue: the gateway ran out of time, the ticker will finish it.
    return res.json({ ok: true, queued: true, file: picked.name })
  } catch (e) {
    const msg = String(e.message || 'scrub failed')
    const known = /card not found|no folder|no PDF/i.test(msg)
    res.status(known ? 400 : 500).json({ error: msg })
  }
})

// Is this card waiting on a scrub right now? (drives the button's spinner)
router.get('/job/:id/pending', async (req, res) => {
  try {
    const q = await scrubQueue(req)
    res.json({ pending: q.some(x => String(x.job) === String(req.params.id)) })
  } catch { res.json({ pending: false }) }
})

// ── The library ─────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  res.json(await scrubStats(req))
})

router.get('/job/:id', async (req, res) => {
  res.json({ scrubs: await scrubsForJob(req, req.params.id) })
})

router.get('/', async (req, res) => {
  try {
    const r = await listScrubs(req, {
      q: req.query.q || '',
      make: req.query.make || '',
      shop: req.query.shop || '',
      sensor: req.query.sensor || '',
      limit: Math.min(Number(req.query.limit) || 60, 200),
    })
    res.json(r)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 📄 The Absolute ADAS report for this scrub, straight off the library
// (Mark 2026-09-28: "I want to be able to download a PDF the Absolute ADAS
// report directly from here"). Built from the stored payload, so it works
// for a scrub that never reached a job card or an invoice.
router.get('/:id/pdf', async (req, res) => {
  try {
    const s = await getScrub(req, req.params.id)
    if (!s) return res.status(404).json({ error: 'not found' })
    const p = s.payload || {}
    const cals = Array.isArray(p.calibrations) && p.calibrations.length
      ? p.calibrations
      : (s.sensors || []).map(x => ({ calibration_name: x.n, cal_type: x.t, trigger: x.g, line_references: x.l, enabled: !!x.r, justification: '' }))
    if (!cals.length) {
      // Billed before the library learned to read the card, and the card is
      // gone (removed on invoice-sent, Mark's rule). The report that actually
      // went out is still in WorkDrive — serve that rather than a dead button.
      const stored = (s.reports || []).find(r => r.kind === 'absolute' && r.id)
      if (!stored) return res.status(400).json({ error: 'this scrub has no calibrations and no stored report' })
      const { getAccessToken } = await import('../services/zoho.js')
      const { downloadFile } = await import('../services/workdrive.js')
      const { buffer } = await downloadFile(stored.id, await getAccessToken())
      if (!buffer || buffer.length < 512) return res.status(502).json({ error: 'could not read the stored report from WorkDrive' })
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${String(stored.name || 'Absolute ADAS report.pdf').replace(/"/g, '')}"`)
      res.setHeader('Content-Length', buffer.length)
      return res.end(buffer)
    }

    const { generateADASIQPdf } = await import('../services/pdf.js')
    const buffer = await generateADASIQPdf({
      shop: s.shop || p.shop || '',
      ro_number: s.ro || p.ro_number || '',
      insurer: s.insurer || p.insurer || '',
      vin: s.vin || p.vin || '',
      vehicle: s.vehicle || p.vehicle || '',
      year: s.year || p.year || '',
      make: s.make || p.make || '',
      model: s.model || p.model || '',
      claim: s.claim || p.claim || '',
      calibrations: cals,
      document_links: Array.isArray(p.document_links) ? p.document_links : [],
      technician: s.by || '',
      folder_share_url: '',
    })
    const safe = [s.year, s.make, s.model].filter(Boolean).join(' ').replace(/[^A-Za-z0-9 _-]/g, '').trim()
    const name = `Absolute ADAS_${s.ro || safe || 'report'}${s.vin ? `_${s.vin}` : ''}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    res.setHeader('Content-Length', buffer.length)
    res.end(buffer)
  } catch (e) {
    console.error('[scrubs] pdf failed:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// 🔄 Reload this row's calibrations from the job card it points at.
router.post('/:id/from-card', async (req, res) => {
  try {
    const r = await refreshFromCard(req, req.params.id)
    if (!r.ok) return res.status(400).json(r)
    res.json({ ...r, scrub: await getScrub(req, req.params.id) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/:id', async (req, res) => {
  const s = await getScrub(req, req.params.id)
  if (!s) return res.status(404).json({ error: 'not found' })
  res.json(s)
})

export default router
