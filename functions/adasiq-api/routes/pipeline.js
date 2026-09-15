// Pipeline territories, cadence, Monday lists, setup.
import express from 'express'
import { ZONES, STAGE_META, IN_PLAY_CAP, OWNERS, zoneOf, ownerOf, staleDays, fitSuggest, mondayList, formatMonday, setupPreview, applySetup, stats, postMonday, maybeMondayPipeline, withInvoiceDates } from '../services/pipeline.js'

const router = express.Router()
const isOwner = req => String(req.user?.email || '').toLowerCase().startsWith('mark@') || req.user?.role === 'owner'
const fail = (res, e, w) => { console.log(`[pipeline] ${w}:`, e.message); res.status(500).json({ error: e.message }) }
const shops = async req => withInvoiceDates(await (await import('./shops.js')).getAllShops(req))

router.get('/zones', (req, res) => res.json({ ok: true, zones: ZONES, stages: STAGE_META, cap: IN_PLAY_CAP, owners: OWNERS }))
router.get('/stats', async (req, res) => { try { res.json({ ok: true, ...stats(await shops(req)) }) } catch (e) { fail(res, e, 'stats') } })
router.get('/setup/preview', async (req, res) => { try { res.json({ ok: true, ...setupPreview(await shops(req)) }) } catch (e) { fail(res, e, 'preview') } })
router.post('/setup/apply', async (req, res) => {
  try { if (!isOwner(req)) return res.status(403).json({ error: 'Only Mark can apply the territory setup.' }); res.json({ ok: true, ...(await applySetup(req, await shops(req), req.body?.overrides || {})) }) }
  catch (e) { fail(res, e, 'apply') }
})
router.get('/monday', async (req, res) => {
  try { const owner = OWNERS.includes(req.query.owner) ? req.query.owner : 'Mark'; const l = mondayList(await shops(req), owner); res.json({ ok: true, list: l, text: formatMonday(l) }) }
  catch (e) { fail(res, e, 'monday') }
})
router.post('/monday/send', async (req, res) => { try { if (!isOwner(req)) return res.status(403).json({ error: 'Owner only.' }); res.json({ ok: true, ...(await postMonday(req, await shops(req), req.user?.email)) }) } catch (e) { fail(res, e, 'monday send') } })
router.get('/fit-suggest/:id', async (req, res) => { try { const s = (await shops(req)).find(x => String(x.id) === String(req.params.id)); if (!s) return res.status(404).json({ error: 'Shop not found' }); res.json({ ok: true, fit: fitSuggest(s), zone: zoneOf(s), owner: ownerOf(s), stale: staleDays(s) }) } catch (e) { fail(res, e, 'fit') } })
export default router

export const pipelineCronRouter = express.Router()
pipelineCronRouter.get('/monday', async (req, res) => {
  const secret = String(process.env.BRIEFING_CRON_SECRET || process.env.MORNING_CRON_SECRET || 'morning-2026').trim()
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'bad secret' })
  try { res.json({ ok: true, ...(await maybeMondayPipeline(req)) }) } catch (e) { fail(res, e, 'cron') }
})
