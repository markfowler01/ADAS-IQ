// Dispatch routes: map data, live snapshot, slot suggestions, reorder.
//
// /map-data       pins + capacities for the Dispatch Map screen
// /live           per-tech real-time snapshot for the Live Day mobile view
// /suggest-slot   capacity-aware insertion suggestion for a same-day quote
// /reorder        manual renumber of a tech's day (drag-to-reorder)

import express from 'express'
import { readJobsPublic, updateJobPublic } from './jobs.js'
import {
  readJobState, mergeJobState, isAssignedTo, todayPT,
  getTechCapacity, deriveLiveStatusForTech, haversineMiles, arriveSort,
} from '../services/dispatch.js'
import { readGeocache, readTechConfig, normalizeKey } from '../services/geocoding.js'
import { readDispatchTechs, statusIdForTech } from '../services/techRoster.js'
import { postToCliqChannel, DISPATCH_CHANNEL } from '../services/cliq.js'

const router = express.Router()

async function techNames(req) {
  return (await readDispatchTechs(req)).map(t => t.name)
}

// PATCH /api/dispatch/reorder, manually renumber a tech's day.
// Body: { tech, date, order: [jobId, jobId, ...] }
// Renumbers drive_order to 1..N in the given sequence.
router.patch('/reorder', async (req, res) => {
  try {
    const { updateJobStateMany } = await import('../services/dispatch.js')
    const order = Array.isArray(req.body?.order) ? req.body.order : []
    if (order.length === 0) return res.status(400).json({ error: 'order array is required' })
    const updates = order.map((jobId, i) => ({ jobId: String(jobId), patch: { drive_order: i + 1 } }))
    await updateJobStateMany(req, updates)
    res.json({ ok: true, count: updates.length })
  } catch (err) {
    console.error('[dispatch reorder]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/dispatch/live, real-time per-tech snapshot for the Live Day view.
router.get('/live', async (req, res) => {
  try {
    const dateISO = (req.query.date || todayPT()).toString()
    const [allJobs, stateMap, geocache, techConfig] = await Promise.all([
      readJobsPublic(req),
      readJobState(req),
      readGeocache(req),
      readTechConfig(req),
    ])

    const TECHS = await techNames(req)
    // 🏖 Who's off today — the "Everyone's day" strip flags their lane (Mark 2026-11-03).
    let offToday = []
    try { const { readTimeOffMap } = await import('./schedule.js'); offToday = ((await readTimeOffMap(req))[dateISO] || []).map(n => String(n).toLowerCase()) } catch { offToday = [] }
    const todays = allJobs.filter(j => (j.scheduled_date || '') === dateISO)
    const decorate = (j) => {
      const merged = mergeJobState(j, stateMap)
      const coords = geocache[normalizeKey(j.shop_name)] || null
      return { ...merged, coords: coords ? { lat: coords.lat, lng: coords.lng } : null }
    }

    // Status → hand-off filter. Once a job is Ready-to-Invoice or Complete,
    // the tech is done with it (Kat owns invoicing from there), so it
    // shouldn't linger on the field view. Mark 2026-07-08.
    const OPEN_STATUSES = new Set([
      'need_dispatch', 'dispatched_jaden', 'dispatched_mark', 'pending_parts',
    ])

    const techs = []
    for (const techName of TECHS) {
      // A tech's card shows every job in their DISPATCHED column, no
      // date filter (Mark 2026-07-13/14). pending_parts jobs come off
      // the live view (they're parked, not workable) and return when
      // moved back to dispatched. ready_invoice/complete stay hidden.
      // Schedule calendar (2026-08-10): FUTURE-dated jobs are parked on
      // the calendar — they join the live view the morning their date
      // arrives. No-date and past-date jobs still show (carryover work).
      // Scheduled REQUESTS whose day arrived ride in the tech's lane too
      // (Mark 2026-08-31): the tech can navigate + text before Kat has
      // created the paperwork. Undated requests stay in Kat's queue.
      const techJobs = allJobs
        .filter(j => isAssignedTo(j, techName))
        .filter(j => {
          const st = j.status || ''
          if (/^dispatched_/.test(st)) return !j.scheduled_date || String(j.scheduled_date).slice(0, 10) <= dateISO
          if (st === 'job_requested') {
            const d = String(j.scheduled_date || '').slice(0, 10)
            return d && d <= dateISO
          }
          return false
        })
        .map(decorate)
        // ⏰ When he has to be there comes first (Mark 2026-11-03); drive order breaks ties.
        .sort((a, b) => arriveSort(a.arrive_info) - arriveSort(b.arrive_info) || (a.drive_order ?? 999) - (b.drive_order ?? 999))

      // 📅 Coming up (Mark 2026-11-03: "often Jayden doesn't know when jobs are scheduled") —
      // future-dated jobs + requests are parked off the lane until their morning, and techs
      // can't open the Schedule screen. Next 7 days, read-only.
      const horizon = (() => { const d = new Date(`${dateISO}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10) })()
      const upcoming = allJobs
        .filter(j => isAssignedTo(j, techName) && /^dispatched_|^need_dispatch$|^job_requested$|^pending_parts$/.test(j.status || ''))
        .filter(j => { const d = String(j.scheduled_date || '').slice(0, 10); return d > dateISO && d <= horizon })
        .map(j => { const m = mergeJobState(j, stateMap); return { id: m.id, shop_name: m.shop_name, vehicle: m.vehicle || [m.year, m.make, m.model].filter(Boolean).join(' '), scheduled_date: m.scheduled_date, status: m.status, arrive: m.arrive, arrive_info: m.arrive_info } })
        .sort((a, b) => String(a.scheduled_date).slice(0, 10).localeCompare(String(b.scheduled_date).slice(0, 10)) || arriveSort(a.arrive_info) - arriveSort(b.arrive_info))

      const capacity = await getTechCapacity(req, techName, dateISO, allJobs, techConfig, stateMap)
      const liveStatus = deriveLiveStatusForTech(techJobs)

      const lastWithWindow = [...techJobs].reverse().find(j => j.time_window_end)
      const eod_projected = lastWithWindow?.time_window_end || null

      const homeKey = Object.keys(techConfig || {}).find(k => isAssignedTo({ technician: techName }, k))
      const home = homeKey ? techConfig[homeKey] : null
      let position = null
      const lastCompleted = [...techJobs].reverse().find(j => j.completed_at && j.coords)
      if (liveStatus.current_job?.coords) position = liveStatus.current_job.coords
      else if (lastCompleted?.coords) position = lastCompleted.coords
      else if (home?.home_lat != null) position = { lat: home.home_lat, lng: home.home_lng }

      techs.push({
        name: techName,
        ...capacity,
        ...liveStatus,
        eod_projected,
        position,
        home: home && home.home_lat != null ? { lat: home.home_lat, lng: home.home_lng, address: home.home_address } : null,
        jobs: techJobs,
        upcoming,
        off_today: offToday.includes(String(techName).split(/\s+/)[0].toLowerCase()),
      })
    }

    // Needs-Dispatch feed (Mark 2026-07-11): anything at need_dispatch
    // shows regardless of scheduled_date, plus anything scheduled today
    // that's open but unassigned. Tech-requested jobs are NOT dispatch
    // work (Mark 2026-07-13) — they go in the Waiting-for-Kat list below.
    const unassigned_today = allJobs
      .filter(j => {
        const s = j.status || ''
        // Future-dated need_dispatch jobs are parked on the Schedule
        // calendar until their morning.
        if (s === 'need_dispatch') return !j.scheduled_date || String(j.scheduled_date).slice(0, 10) <= dateISO
        if (s === 'job_requested') return false
        return (j.scheduled_date || '') === dateISO && !j.technician && OPEN_STATUSES.has(s)
      })
      .map(decorate)

    // Waiting-for-Kat feed (Mark 2026-07-13): tech-requested jobs sit
    // here until Kat turns them into an invoice — any status change
    // (or the Upload-Report flow deleting the card) drops them off.
    // Schedule calendar (Mark 2026-08-11): FUTURE-dated requests live on
    // the calendar only — this box holds what needs Kat NOW (undated,
    // today, or overdue). They roll back in the morning of their date.
    const waiting_for_kat = allJobs
      .filter(j => (j.status || '') === 'job_requested')
      .filter(j => !j.scheduled_date || String(j.scheduled_date).slice(0, 10) <= dateISO)
      .map(decorate)

    // Count of requests parked on the calendar for later — the Live view
    // shows a "📅 N scheduled" breadcrumb so they're never invisible.
    const scheduled_future = allJobs.filter(j =>
      (j.status || '') === 'job_requested' &&
      j.scheduled_date && String(j.scheduled_date).slice(0, 10) > dateISO
    ).length

    res.json({ ok: true, date: dateISO, techs, unassigned_today, waiting_for_kat, scheduled_future })
  } catch (err) {
    console.error('[dispatch live]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/dispatch/suggest-slot, capacity-aware insertion suggestion.
// Body: { shop_name, date? }
// 🙋 Take it (Mark 2026-11-03: "sometimes my jobs are transferred to Jayden and we forget …
// can the tech transfer the job to himself?"). A tech pulls a job onto HIS OWN lane from
// another lane or the no-tech pile — never between other people, never once that lane's
// tech is en route or working it. Every take posts in #dispatch.
router.post('/take/:id', async (req, res) => {
  try {
    const me = String(req.user?.techName || req.user?.name || '').trim().split(/\s+/)[0]
    if (!me) return res.status(400).json({ error: 'Who are you? Sign in again.' })
    const [allJobs, stateMap] = await Promise.all([readJobsPublic(req), readJobState(req)])
    const job = allJobs.find(j => String(j.id) === String(req.params.id))
    if (!job) return res.status(404).json({ error: 'That job is gone. Pull down to refresh.' })
    if (isAssignedTo(job, me)) return res.json({ ok: true, already: true })
    const st = String(job.status || '')
    if (!/^(dispatched_|need_dispatch$|job_requested$)/.test(st)) return res.status(409).json({ error: 'That job is not open any more.' })
    const s = stateMap[String(job.id)] || {}
    if (s.en_route_at || s.started_at) return res.status(409).json({ error: `${job.technician || 'Someone'} already started this one.` })
    const from = String(job.technician || '').trim() || 'no tech'
    const patch = { technician: me }
    if (/^dispatched_|^need_dispatch$/.test(st)) patch.status = statusIdForTech(me) || st
    await updateJobPublic(req, job.id, patch)
    const veh = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ') || 'the car'
    postToCliqChannel(DISPATCH_CHANNEL, `🙋 *${me} took* ${veh} at ${job.shop_name || 'the shop'} from ${from === 'no tech' ? 'the no-tech pile' : `${from}'s lane`}.`).catch(() => {})
    console.log(`[dispatch take] ${me} took job ${job.id} from ${from}`)
    res.json({ ok: true, from, to: me })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/suggest-slot', async (req, res) => {
  try {
    const dateISO = (req.body?.date || todayPT()).toString()
    const shopName = (req.body?.shop_name || '').toString()
    if (!shopName) return res.status(400).json({ error: 'shop_name is required' })

    const [allJobs, stateMap, geocache, techConfig] = await Promise.all([
      readJobsPublic(req),
      readJobState(req),
      readGeocache(req),
      readTechConfig(req),
    ])
    const targetCoords = geocache[normalizeKey(shopName)] || null

    const TECHS = await techNames(req)
    const suggestions = []
    let bothAtCap = true
    for (const techName of TECHS) {
      const cap = await getTechCapacity(req, techName, dateISO, allJobs, techConfig, stateMap)
      const techJobs = allJobs
        .filter(j => isAssignedTo(j, techName))
        .filter(j => (j.scheduled_date || '') === dateISO)
        .map(j => mergeJobState(j, stateMap))
        .sort((a, b) => (a.drive_order ?? 999) - (b.drive_order ?? 999))

      if (!cap.atCap) bothAtCap = false

      let bestInsertAt = techJobs.length
      let bestExtraMiles = Infinity
      if (targetCoords && techJobs.length > 0) {
        const homeKey = Object.keys(techConfig || {}).find(k => isAssignedTo({ technician: techName }, k))
        const home = homeKey ? techConfig[homeKey] : null
        const start = (home?.home_lat != null) ? { lat: home.home_lat, lng: home.home_lng } : null
        const coordsAt = (idx) => {
          if (idx === -1) return start
          const j = techJobs[idx]
          if (!j) return null
          const c = geocache[normalizeKey(j.shop_name)]
          return (c && c.lat != null) ? { lat: c.lat, lng: c.lng } : null
        }
        for (let i = 0; i <= techJobs.length; i++) {
          const before = coordsAt(i - 1)
          const after = coordsAt(i)
          let extra = 0
          if (before && targetCoords) extra += haversineMiles(before, targetCoords)
          if (after && targetCoords) {
            extra += haversineMiles(targetCoords, after)
            if (before) extra -= haversineMiles(before, after)
          }
          if (extra < bestExtraMiles) {
            bestExtraMiles = extra
            bestInsertAt = i
          }
        }
      } else {
        bestExtraMiles = 0
      }

      suggestions.push({
        tech: techName,
        ...cap,
        suggest_insert_at: bestInsertAt + 1,
        extra_miles: Math.round(bestExtraMiles * 10) / 10,
        recommend: !cap.atCap,
      })
    }

    suggestions.sort((a, b) => {
      if (a.recommend !== b.recommend) return a.recommend ? -1 : 1
      return a.extra_miles - b.extra_miles
    })

    res.json({
      ok: true,
      shop_name: shopName,
      date: dateISO,
      both_at_cap: bothAtCap,
      recommend_tomorrow: bothAtCap,
      suggestions,
    })
  } catch (err) {
    console.error('[dispatch suggest-slot]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/dispatch/map-data, pins + capacities for the Dispatch Map.
router.get('/map-data', async (req, res) => {
  try {
    const dateISO = (req.query.date || todayPT()).toString()
    const techFilter = req.query.tech?.toString() || ''
    const includeUnassigned = req.query.unassigned === 'true'

    const [allJobs, stateMap, geocache, techConfig] = await Promise.all([
      readJobsPublic(req),
      readJobState(req),
      readGeocache(req),
      readTechConfig(req),
    ])

    const TECHS = await techNames(req)
    const capacities = {}
    for (const t of TECHS) {
      capacities[t] = await getTechCapacity(req, t, dateISO, allJobs, techConfig, stateMap)
    }

    const MAP_STATUSES = new Set(['dispatched_jaden', 'dispatched_mark', 'pending_parts'])

    let pins = allJobs
      .filter(j => {
        if (j.status === 'need_dispatch' && includeUnassigned) return true
        if (!MAP_STATUSES.has(j.status)) return false
        return (j.scheduled_date || '') === dateISO
      })
      .filter(j => !techFilter || isAssignedTo(j, techFilter))
      .map(j => {
        const merged = mergeJobState(j, stateMap)
        const coords = geocache[normalizeKey(j.shop_name)] || null
        return {
          ...merged,
          coords: coords ? { lat: coords.lat, lng: coords.lng, status: coords.geocode_status } : null,
        }
      })

    pins.sort((a, b) => {
      const ao = a.drive_order ?? Number.POSITIVE_INFINITY
      const bo = b.drive_order ?? Number.POSITIVE_INFINITY
      return ao - bo
    })

    // All manually-pinned shops (Mark's main clients), regardless of date/job.
    // rendered as faded background markers so dispatch sees client locations
    // even when no active job is on the map.
    const pinned_shops = Object.entries(geocache)
      .filter(([, v]) => v.geocode_source === 'manual' && v.lat != null)
      .map(([key, v]) => ({
        shop_name_key: key,
        lat: v.lat,
        lng: v.lng,
        address: v.address || '',
      }))

    res.json({
      ok: true,
      date: dateISO,
      tech_filter: techFilter || null,
      tech_homes: techConfig,
      capacities,
      pins,
      pinned_shops,
      ambiguous_shops: pins
        .filter(p => p.coords && p.coords.status !== 'ok')
        .map(p => ({ shop_name: p.shop_name, status: p.coords.status })),
      ungeocoded_shops: pins
        .filter(p => !p.coords)
        .map(p => p.shop_name)
        .filter((v, i, arr) => arr.indexOf(v) === i),
    })
  } catch (err) {
    console.error('[dispatch map-data]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

export default router
