// Pipeline territories, cadence, Monday lists, setup.
import express from 'express'
import { ZONES, STAGE_META, IN_PLAY_CAP, OWNERS, zoneOf, ownerOf, staleDays, fitSuggest, mondayList, formatMonday, setupPreview, applySetup, stats, postMonday, maybeMondayPipeline, withInvoiceDates } from '../services/pipeline.js'

const router = express.Router()
const isOwner = req => String(req.user?.email || '').toLowerCase().startsWith('mark@') || req.user?.role === 'owner'
const fail = (res, e, w) => { console.log(`[pipeline] ${w}:`, e.message); res.status(500).json({ error: e.message }) }
const shops = async req => withInvoiceDates(await (await import('./shops.js')).getAllShops(req))

router.get('/zones', (req, res) => res.json({ ok: true, zones: ZONES, stages: STAGE_META, cap: IN_PLAY_CAP, owners: OWNERS }))

// ── Discovery: every body shop in a city via Google Places (Mark 2026-09-15:
// "add every shop in western Washington"). One city per call (gateway 30s);
// the client walks the zone city lists. Competitors and shops already in the
// CRM are filtered out. Nothing is written here — /api/shops/bulk does that
// after Mark reviews the list.
const COMPETITOR_RE = /calibrat|abs-c|avsc|hivecalib|adas\b|mobile diag|windshield|auto glass|glass repair|towing|tow\b|detail|tint|wrap|tire|muffler|transmission|oil change|lube|car wash|dealership|rental|u-haul|parts store|autozone|o'reilly|napa auto parts/i
router.get('/discover', async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (!apiKey) return res.status(500).json({ error: 'Google Places API key not configured' })
    const city = String(req.query.city || '').trim(); if (!city) return res.status(400).json({ error: 'city required' })
    const axios = (await import('axios')).default
    const headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,places.businessStatus,places.primaryType,places.types,nextPageToken' }
    const queries = [`auto body shop in ${city}, WA`, `collision repair center in ${city}, WA`]
    const found = new Map()
    for (const q of queries) {
      let pageToken = null
      for (let page = 0; page < 2; page++) {
        try {
          const r = await axios.post('https://places.googleapis.com/v1/places:searchText', { textQuery: q, maxResultCount: 20, ...(pageToken ? { pageToken } : {}) }, { headers, timeout: 12000 })
          for (const p of r.data?.places || []) if (p.id && !found.has(p.id)) found.set(p.id, p)
          pageToken = r.data?.nextPageToken || null; if (!pageToken) break
          await new Promise(x => setTimeout(x, 1500))
        } catch (e) { console.log('[discover]', city, q, e.response?.data?.error?.message || e.message); break }
      }
    }
    const existing = await shops(req)
    const norm = x => String(x || '').toLowerCase().replace(/\b(inc|llc|corp|ltd|co|the|llp|dba)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    const street = a => String(a || '').toLowerCase().split(',')[0].replace(/[^a-z0-9]+/g, ' ').trim()
    const haveNames = new Set(existing.map(s => norm(s.shop_name))), haveStreets = new Set(existing.map(s => street(s.address)).filter(Boolean))
    const out = []
    for (const p of found.values()) {
      const name = p.displayName?.text || ''; const address = p.formattedAddress || ''
      if (!name || !/\bWA\b|Washington/i.test(address)) continue
      if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue
      if (COMPETITOR_RE.test(name) && !/body|collision/i.test(name)) continue
      // Body shops only: the name says so, or Google's type does. General mechanics are not our customers.
      const BODY_RE = /body|collision|carstar|gerber|caliber|maaco|abra\b|dent|paint|refinish|crash champion|fix auto|service king|joe hudson|frame|bumper/i
      const types = [p.primaryType, ...(p.types || [])].filter(Boolean).join(' ')
      if (!BODY_RE.test(name) && !/auto_body|body_shop|collision/i.test(types)) continue
      const dup = haveNames.has(norm(name)) || (street(address) && haveStreets.has(street(address)))
      out.push({ place_id: p.id, shop_name: name, address, phone: p.nationalPhoneNumber || '', website: p.websiteUri || '', google_maps_url: p.googleMapsUri || '', rating: p.rating || 0, reviews: p.userRatingCount || 0, zone: zoneOf({ region: '', address, shop_name: name }), in_crm: dup, city })
    }
    out.sort((a, b) => (b.reviews || 0) - (a.reviews || 0))
    res.json({ ok: true, city, found: found.size, candidates: out.filter(c => !c.in_crm), already: out.filter(c => c.in_crm).length })
  } catch (e) { fail(res, e, 'discover') }
})
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
