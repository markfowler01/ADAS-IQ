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
    const tech = req.user?.role === 'technician'
    for (const [id, s] of Object.entries(rh.shops)) { shops[id] = { n: s.n, top: s.top, quiet: s.quiet || null, gap: s.gap || null, ...(tech ? {} : { pay: s.pay || null }) }; byName[shopKey(s.name)] = id }
    const co = rh.company || {}
    res.json({ ready: true, minJobs: rh.minJobs, shops, byName, quiet: co.quiet || [], company: tech ? null : co })
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
    const out = { ready: true, at: rh.at, minJobs: rh.minJobs, n: s?.n || 0, top: s?.top || [], quiet: s?.quiet || null, gap: s?.gap || null }
    if (req.user?.role !== 'technician' && s) {
      const last = (bbq?.shops?.[sid]?.history || []).slice(-1)[0] || null
      Object.assign(out, { pay: s.pay || null, lifetime: s.lifetime, nextMilestone: s.nextMilestone, step: BBQ_STEP, bbq: last ? { date: last.date, milestone: last.milestone } : null })
    }
    res.json(out)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 🧾 Billed work for one shop (Mark 2026-11-04: Jobs tab said "No jobs" on a shop
// with $1.3k lifetime — invoiced jobs leave the board). From the in-app Books
// mirror (AdasInvoices). Techs get the list without dollars.
router.get('/history', async (req, res) => {
  try {
    const name = String(req.query.name || '').trim()
    if (!name) return res.json({ invoices: [] })
    const { readAll } = await import('../services/zohoMirror.js')
    const key = shopKey(name)
    const all = (await readAll(req, 'inv')).filter(i => shopKey(i.customer_name) === key && i.status !== 'void')
    const tech = req.user?.role === 'technician'
    const invoices = all.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 200)
      .map(i => ({ number: i.invoice_number, date: i.date, ref: i.reference_number, status: i.status, ...(tech ? {} : { total: i.total, balance: i.balance }) }))
    res.json({ invoices, count: all.length, ...(tech ? {} : { total: Math.round(all.reduce((t, i) => t + (Number(i.total) || 0), 0) * 100) / 100 }) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default router
