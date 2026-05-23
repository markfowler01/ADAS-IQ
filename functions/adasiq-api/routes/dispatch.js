// GET /api/dispatch/live — real-time snapshot per tech.
// Used by the mobile Live Day command center. Returns:
//   - per-tech: capacity, current status (idle / en-route / on-site / done),
//     current job + elapsed time, next job + ETA, end-of-day projection,
//     full ordered job list for today (4 slots)
//   - unassigned_today: jobs scheduled for today with no tech
router.get('/live', async (req, res) => {
  try {
    const dateISO = (req.query.date || todayPT()).toString()
    const [allJobs, stateMap, geocache, techConfig] = await Promise.all([
      readJobsPublic(req),
      readJobState(req),
      readGeocache(req),
      readTechConfig(req),
    ])

    const todays = allJobs.filter(j => (j.scheduled_date || '') === dateISO)
    const decorate = (j) => {
      const merged = mergeJobState(j, stateMap)
      const coords = geocache[normalizeKey(j.shop_name)] || null
      return { ...merged, coords: coords ? { lat: coords.lat, lng: coords.lng } : null }
    }

    const techs = []
    for (const techName of TECHS) {
      const techJobs = todays
        .filter(j => isAssignedTo(j, techName))
        .map(decorate)
        .sort((a, b) => (a.drive_order ?? 999) - (b.drive_order ?? 999))

      const capacity = await getTechCapacity(req, techName, dateISO, allJobs, techConfig)
      const liveStatus = deriveLiveStatusForTech(techJobs)

      // End-of-day projection: last job's window end, or null if no scheduled
      const lastWithWindow = [...techJobs].reverse().find(j => j.time_window_end)
      const eod_projected = lastWithWindow?.time_window_end || null

      // Current geographic position: last completed job's coords, or current
      // in-progress job's coords, or home base. Used for the Live map.
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
      })
    }

    const unassigned_today = todays
      .filter(j => !j.technician || j.status === 'need_dispatch')
      .map(decorate)

    res.json({ ok: true, date: dateISO, techs, unassigned_today })
  } catch (err) {
    console.error('[dispatch live]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/dispatch/suggest-slot — capacity-aware insertion suggestion.
// Body: { shop_name, date? }
// Returns ranked suggestions for which tech and where to insert a new job.
// If both techs are at cap, suggests scheduling for tomorrow's first slot.
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

    const suggestions = []
    let bothAtCap = true
    for (const techName of TECHS) {
      const cap = await getTechCapacity(req, techName, dateISO, allJobs, techConfig)
      const techJobs = allJobs
        .filter(j => isAssignedTo(j, techName))
        .filter(j => (j.scheduled_date || '') === dateISO)
        .map(j => mergeJobState(j, stateMap))
        .sort((a, b) => (a.drive_order ?? 999) - (b.drive_order ?? 999))

      if (!cap.atCap) bothAtCap = false

      // Find the position that adds minimal extra drive miles. If we have no
      // target coords, just append at end.
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
        suggest_insert_at: bestInsertAt + 1, // 1-indexed for display
        extra_miles: Math.round(bestExtraMiles * 10) / 10,
        recommend: !cap.atCap,
      })
    }

    // Sort: recommended techs first (room), then by extra miles asc
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

// PATCH /api/dispatch/reorder — manually renumber a tech's day.
// Body: { tech, date, order: [jobId, jobId, ...] }
// Renumbers drive_order to 1..N in the given sequence. Used by the side
// panel's drag-to-reorder within a tech group. Any job IDs not in `order`
// keep their existing drive_order (no-op for them).
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

// GET /api/dispatch/map-data — pins for the dispatch map.
// Returns jobs for a given date (default today PT) joined with their shop's
// lat/lng, plus tech home bases. Admins see all techs; techs see only their own.

import express from 'express'
import { readJobsPublic } from './jobs.js'
import {
  readJobState, mergeJobState, isAssignedTo, todayPT,
  getTechCapacity, deriveLiveStatusForTech, haversineMiles,
} from '../services/dispatch.js'
import { readGeocache, readTechConfig, normalizeKey } from '../services/geocoding.js'

const router = express.Router()

const TECHS = ['Mark', 'Jayden']

router.get('/map-data', async (req, res) => {
  try {
    const dateISO = (req.query.date || todayPT()).toString()
    const techFilter = req.query.tech?.toString() || '' // 'Mark' / 'Jayden' / '' (all)
    // includeUnassigned: also surface need_dispatch jobs (no scheduled_date filter)
    const includeUnassigned = req.query.unassigned === 'true'

    const [allJobs, stateMap, geocache, techConfig] = await Promise.all([
      readJobsPublic(req),
      readJobState(req),
      readGeocache(req),
      readTechConfig(req),
    ])

    // Capacity snapshot per tech (used by side panel indicators)
    const capacities = {}
    for (const t of TECHS) {
      capacities[t] = await getTechCapacity(req, t, dateISO, allJobs, techConfig)
    }

    // Statuses that show on the dispatch map
    const MAP_STATUSES = new Set([
      'dispatched_jaden', 'dispatched_mark', 'pending_parts',
    ])

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
          coords: coords ? {
            lat: coords.lat, lng: coords.lng, status: coords.geocode_status,
          } : null,
        }
      })

    // Sort by drive_order so dispatch sees the route order
    pins.sort((a, b) => {
      const ao = a.drive_order ?? Number.POSITIVE_INFINITY
      const bo = b.drive_order ?? Number.POSITIVE_INFINITY
      return ao - bo
    })

    res.json({
      ok: true,
      date: dateISO,
      tech_filter: techFilter || null,
      tech_homes: techConfig,
      capacities,
      pins,
      // Surface shops with no/ambiguous geocode for the manual-override panel
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
