// GET /api/dispatch/map-data — pins for the dispatch map.
// Returns jobs for a given date (default today PT) joined with their shop's
// lat/lng, plus tech home bases. Admins see all techs; techs see only their own.

import express from 'express'
import { readJobsPublic } from './jobs.js'
import {
  readJobState, mergeJobState, isAssignedTo, todayPT,
} from '../services/dispatch.js'
import { readGeocache, readTechConfig, normalizeKey } from '../services/geocoding.js'

const router = express.Router()

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
