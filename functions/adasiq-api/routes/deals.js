// 💼 /api/deals — the Deals module + Sales Mode queue (Mark 2026-10-07/08).
// Mounted with requireAuth (no requireStaff): Jayden sells too.
//   GET  /                 list (?stage=&owner=&open=1)
//   GET  /meta             stages, scores, coaching, pick-lists
//   GET  /queue            Sales Mode queue for this user (?owner=)
//   GET  /due              next steps due today + overdue (Ada / Cliq use the same)
//   GET  /scorecard
//   POST /                 { shop_id | shop_name, deal_type?, scores? } create (or return the open one)
//   GET  /:id              deal + activities + history + linked jobs + coaching
//   PATCH /:id             fields
//   POST /:id/move         { stage, note?, objection? } — server-side gates
//   POST /:id/activity     { type, step_tag?, summary, next_step?, next_step_date?, objection_type? }
import express from 'express'
import * as D from '../services/deals.js'

const router = express.Router()
router.use(express.json())
const who = req => req.user?.techName || req.user?.name || req.user?.email || 'staff'
const firstName = req => String(who(req)).split(/\s+/)[0]
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message, gate: !!e.gate })

router.get('/meta', (req, res) => res.json({ stages: D.STAGES, open_stages: D.OPEN_STAGES, scores: D.SCORES, deal_types: D.DEAL_TYPES, setups: D.SETUPS, pain_types: D.PAIN_TYPES, objections: D.OBJECTIONS, activity_types: D.ACTIVITY_TYPES, step_tags: D.STEP_TAGS, coach: D.COACH }))

router.get('/', async (req, res) => {
  try { res.json({ ok: true, deals: await D.listDeals(req, { stage: String(req.query.stage || ''), owner: String(req.query.owner || ''), open: req.query.open === '1' ? true : req.query.open === '0' ? false : null }) }) }
  catch (e) { fail(res, e) }
})
router.get('/queue', async (req, res) => {
  try { const owner = String(req.query.owner || '') || (req.user?.role === 'technician' ? firstName(req) : ''); res.json({ ok: true, me: firstName(req), ...(await D.salesQueue(req, { owner })) }) }
  catch (e) { fail(res, e) }
})
router.get('/due', async (req, res) => {
  try { const l = await D.dueList(req); res.json({ ok: true, ...l, text: D.formatDue(l), spoken: D.spokenDue(l) }) }
  catch (e) { fail(res, e) }
})
router.get('/scorecard', async (req, res) => {
  try { res.json({ ok: true, ...(await D.scorecard(req)) }) } catch (e) { fail(res, e) }
})
router.post('/', async (req, res) => {
  try { const r = await D.createDeal(req, req.body || {}, who(req)); res.status(r.existed ? 200 : 201).json({ ok: true, ...r }) } catch (e) { fail(res, e) }
})
router.get('/:id', async (req, res) => {
  try {
    const deal = await D.getDeal(req, req.params.id); if (!deal) return res.status(404).json({ error: 'not found' })
    const [activities, history] = await Promise.all([D.listActivities(req, deal.id), D.listHistory(req, deal.id)])
    let jobs = [], shop = null
    try { const { readJobsPublic } = await import('./jobs.js'); const all = await readJobsPublic(req); jobs = all.filter(j => String(j.id) === deal.first_job_id || String(j.id) === deal.second_job_id || String(j.shop_name || '').toLowerCase() === String(deal.shop_name).toLowerCase()).slice(0, 10).map(j => ({ id: j.id, vehicle: j.vehicle, status: j.status, scheduled_date: j.scheduled_date, invoice_number: j.invoice_number, technician: j.technician })) } catch { /* fine */ }
    try { const { getAllShops } = await import('./shops.js'); const s = (await getAllShops(req)).find(x => String(x.id) === String(deal.shop_id)); if (s) shop = { id: s.id, name: s.shop_name, phone: s.phone, address: s.address, people: s.people || [], pipeline_stage: s.pipeline_stage, region: s.region, assigned_to: s.assigned_to, fit_score: s.fit_score, drps: s.drps, notes: String(s.notes || '').slice(0, 400) } } catch { /* fine */ }
    res.json({ ok: true, deal, activities, history, jobs, shop, coach: D.COACH[deal.stage] || null, gates: D.STAGES.map(s => ({ stage: s, blocked_by: s === deal.stage ? '' : D.gateFor(s, { ...deal, _has_visit_or_call: activities.some(a => a.type === 'Visit' || a.type === 'Call') }) })) })
  } catch (e) { fail(res, e) }
})
router.patch('/:id', async (req, res) => {
  try { res.json({ ok: true, deal: await D.updateDeal(req, req.params.id, req.body || {}, who(req)) }) } catch (e) { fail(res, e) }
})
router.post('/:id/move', async (req, res) => {
  try { res.json({ ok: true, deal: await D.moveDeal(req, req.params.id, String(req.body?.stage || ''), who(req), { note: String(req.body?.note || ''), objection: String(req.body?.objection || '') }) }) } catch (e) { fail(res, e) }
})
router.post('/:id/activity', async (req, res) => {
  try { res.json({ ok: true, deal: await D.addActivity(req, req.params.id, req.body || {}, who(req)) }) } catch (e) { fail(res, e) }
})

export default router
