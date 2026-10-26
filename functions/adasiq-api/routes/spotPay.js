// ⚡ Pays-on-the-spot routes (services/spotPay.js). Techs use these from the field.
//   GET  /api/spot-pay/open            open spot-pay jobs (board timer + Live Day "checks to pick up")
//   POST /api/spot-pay/:jobId/heads-up "10 min out" → Kat push
//   POST /api/spot-pay/:jobId/check    { number, amount } → #financeadmin
import express from 'express'
import { openSpots, spotHeadsUp, spotCheck } from '../services/spotPay.js'

const router = express.Router()
const who = req => req.user?.techName || req.user?.name || req.user?.email || 'staff'
async function jobFor(req) {
  const { readJobsPublic } = await import('./jobs.js')
  return (await readJobsPublic(req)).find(j => String(j.id) === String(req.params.jobId)) || null
}

router.get('/open', async (req, res) => {
  try { res.json({ spots: await openSpots(req) }) } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/:jobId/heads-up', async (req, res) => {
  try { const job = await jobFor(req); if (!job) return res.status(404).json({ error: 'Job not found' }); res.json({ ok: true, spot: await spotHeadsUp(req, job, who(req)) }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/:jobId/check', async (req, res) => {
  try {
    const amount = Number(req.body?.amount)
    if (!(amount > 0)) return res.status(400).json({ error: 'Check amount required' })
    const job = (await jobFor(req)) || { id: req.params.jobId, shop_name: String(req.body?.shop || '') }
    res.json({ ok: true, spot: await spotCheck(req, job, { number: req.body?.number, amount, by: who(req) }) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default router
