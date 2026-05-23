// GET /api/today — list the logged-in tech's today's jobs in drive_order.
// For techs (role === 'technician'), uses req.user.techName.
// For admins (Mark), derives from req.user.name (first word).
// Supports ?date=YYYY-MM-DD to view another day, and ?tech=Jayden for admins.

import express from 'express'
import { readJobsPublic } from './jobs.js'
import { getAllShops } from './shops.js'
import {
  readJobState, mergeJobState, isAssignedTo, todayPT,
  recomputeDayForTech, getTechHomeBase,
} from '../services/dispatch.js'
import { readGeocache, normalizeKey } from '../services/geocoding.js'

const router = express.Router()

function resolveTechName(user, override) {
  if (override) return override
  if (user?.techName) return user.techName
  const name = (user?.name || '').trim()
  return name.split(/\s+/)[0] || ''
}

router.get('/', async (req, res) => {
  try {
    const dateISO = (req.query.date || todayPT()).toString()
    const techOverride = req.query.tech?.toString() || ''
    const techName = resolveTechName(req.user, techOverride)
    if (!techName) {
      return res.status(400).json({ error: 'Cannot resolve technician from user; pass ?tech=' })
    }

    const [allJobs, stateMap, shops, geocache] = await Promise.all([
      readJobsPublic(req),
      readJobState(req),
      getAllShops(req).catch(() => []),
      readGeocache(req),
    ])
    const shopByName = new Map(shops.map(s => [(s.shop_name || '').toLowerCase().trim(), s]))

    let techJobs = allJobs
      .filter(j => isAssignedTo(j, techName))
      .filter(j => (j.scheduled_date || '') === dateISO)
      .map(j => {
        const merged = mergeJobState(j, stateMap)
        const shop = shopByName.get((j.shop_name || '').toLowerCase().trim()) || null
        const coords = geocache[normalizeKey(j.shop_name)] || null
        return {
          ...merged,
          shop_address: shop?.address || '',
          shop_contact: shop?.contact_name || '',
          shop_phone: shop?.phone || '',
          coords: coords ? { lat: coords.lat, lng: coords.lng, status: coords.geocode_status } : null,
        }
      })

    // If no drive_order set yet for any job, compute it on the fly.
    const anyOrdered = techJobs.some(j => j.drive_order != null)
    if (!anyOrdered && techJobs.length > 0) {
      try {
        const updates = await recomputeDayForTech(req, techName, dateISO, techJobs)
        const orderMap = new Map(updates.map(u => [u.jobId, u.patch]))
        techJobs = techJobs.map(j => ({ ...j, ...(orderMap.get(j.id) || {}) }))
      } catch (e) {
        console.warn('[today] auto drive_order failed (non-fatal):', e.message)
      }
    }

    // Sort: by drive_order asc, nulls at end.
    techJobs.sort((a, b) => {
      const ao = a.drive_order ?? Number.POSITIVE_INFINITY
      const bo = b.drive_order ?? Number.POSITIVE_INFINITY
      return ao - bo
    })

    const home = await getTechHomeBase(req, techName)

    res.json({
      ok: true,
      tech: techName,
      date: dateISO,
      home,
      jobs: techJobs,
    })
  } catch (err) {
    console.error('[today]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

export default router
