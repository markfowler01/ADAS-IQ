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
import { listScrubs, getScrub, scrubsForJob, scrubStats } from '../services/scrubStore.js'

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

router.get('/:id', async (req, res) => {
  const s = await getScrub(req, req.params.id)
  if (!s) return res.status(404).json({ error: 'not found' })
  res.json(s)
})

export default router
