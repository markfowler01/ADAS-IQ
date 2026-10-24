// GET /api/shop-rhythm?id=<CRM shop id>&name=<shop name>
// The CRM card's "Usually calls" line and 🍖 BBQ badge (services/shopRhythm.js).
// Techs see the call days only; sales totals stay with owners/admins.
import express from 'express'
import { readRhythm, readBbq, BBQ_STEP } from '../services/shopRhythm.js'
import { shopKey } from '../services/shopResolve.js'

const router = express.Router()

// Every shop at once for the Customers cards: { ready, shops: { [id]: { n, top } }, byName: { [shopKey]: id } }.
router.get('/all', async (req, res) => {
  try {
    const rh = await readRhythm(req)
    if (!rh) return res.json({ ready: false, shops: {} })
    const shops = {}, byName = {}
    for (const [id, s] of Object.entries(rh.shops)) { shops[id] = { n: s.n, top: s.top }; byName[shopKey(s.name)] = id }
    res.json({ ready: true, minJobs: rh.minJobs, shops, byName })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/', async (req, res) => {
  try {
    const [rh, bbq] = await Promise.all([readRhythm(req), readBbq(req)])
    if (!rh) return res.json({ ready: false })
    const id = String(req.query.id || ''), name = shopKey(req.query.name || '')
    let sid = id && rh.shops[id] ? id : ''
    if (!sid && name) sid = Object.keys(rh.shops).find(k => shopKey(rh.shops[k].name) === name) || ''
    const s = sid ? rh.shops[sid] : null
    const out = { ready: true, at: rh.at, minJobs: rh.minJobs, n: s?.n || 0, top: s?.top || [] }
    if (req.user?.role !== 'technician' && s) {
      const last = (bbq?.shops?.[sid]?.history || []).slice(-1)[0] || null
      Object.assign(out, { lifetime: s.lifetime, nextMilestone: s.nextMilestone, step: BBQ_STEP, bbq: last ? { date: last.date, milestone: last.milestone } : null })
    }
    res.json(out)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default router
