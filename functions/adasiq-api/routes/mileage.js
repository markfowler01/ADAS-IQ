import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()

const CHUNK_SIZE = 50
const DEFAULT_RATE = 0.67  // IRS 2026 standard mileage rate

// ── Cache helpers ────────────────────────────────────────────────────────────

function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

async function cacheSet(segment, key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  try { await segment.update(key, str) }
  catch (e) { await segment.put(key, str) }
}

async function cacheGet(segment, key, fallback = null) {
  try {
    const val = await segment.getValue(key)
    return val ? JSON.parse(val) : fallback
  } catch (e) {
    if (isNotFound(e)) return fallback
    throw e
  }
}

// ── Trip storage (chunked) ───────────────────────────────────────────────────

async function readTrips(req) {
  const segment = getSegment(req)
  try {
    const meta = await cacheGet(segment, 'mileage_trips_meta', null)
    if (meta && meta.chunks > 0) {
      const parts = await Promise.all(
        Array.from({ length: meta.chunks }, (_, i) =>
          cacheGet(segment, `mileage_trips_chunk_${i}`, [])
        )
      )
      return parts.flat()
    }
  } catch (e) { /* fall through */ }
  return []
}

async function writeTrips(req, trips) {
  const segment = getSegment(req)
  const chunks = []
  for (let i = 0; i < trips.length; i += CHUNK_SIZE) {
    chunks.push(trips.slice(i, i + CHUNK_SIZE))
  }
  if (chunks.length === 0) chunks.push([])
  for (let i = 0; i < chunks.length; i++) {
    await cacheSet(segment, `mileage_trips_chunk_${i}`, chunks[i])
  }
  await cacheSet(segment, 'mileage_trips_meta', {
    chunks: chunks.length,
    total: trips.length,
    updated: new Date().toISOString(),
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(req) {
  return req.user?.email || req.user?.id || req.user?.name || 'unknown'
}

function getUserName(req) {
  return req.user?.name || req.user?.email || 'Unknown'
}

function isAdmin(req) {
  return req.user?.role !== 'technician'
}

function newId(prefix = 'trip') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// Haversine distance in miles
function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3959
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

function computeTripDistance(waypoints) {
  if (!waypoints || waypoints.length < 2) return 0
  let total = 0
  for (let i = 1; i < waypoints.length; i++) {
    total += distanceMiles(
      waypoints[i-1].lat, waypoints[i-1].lng,
      waypoints[i].lat, waypoints[i].lng
    )
  }
  return Math.round(total * 100) / 100
}

const DEFAULT_SETTINGS = {
  tracking_enabled: false,
  tracking_hours: { start: '07:00', end: '18:00', days: [1,2,3,4,5] },
  auto_classify: true,
  default_type: 'business',
  home_address: '',
  home_location: null,
  privacy_mode: false,
}

// ── Endpoints ────────────────────────────────────────────────────────────────

// Get user settings
router.get('/settings', async (req, res) => {
  try {
    const segment = getSegment(req)
    const all = await cacheGet(segment, 'mileage_settings', {})
    const userId = getUserId(req)
    res.json({ ...DEFAULT_SETTINGS, ...(all[userId] || {}), user_id: userId })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Update user settings
router.put('/settings', async (req, res) => {
  try {
    const segment = getSegment(req)
    const all = await cacheGet(segment, 'mileage_settings', {})
    const userId = getUserId(req)
    all[userId] = { ...DEFAULT_SETTINGS, ...(all[userId] || {}), ...req.body }
    await cacheSet(segment, 'mileage_settings', all)
    res.json(all[userId])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Create a trip
router.post('/trips', async (req, res) => {
  try {
    const trips = await readTrips(req)
    const { start_time, end_time, start_location, end_location, waypoints, trip_type, job_id, distance_miles } = req.body

    const computedDistance = distance_miles || computeTripDistance(waypoints)
    const rate = Number(req.body.mileage_rate) || DEFAULT_RATE
    const durationMs = start_time && end_time ? (new Date(end_time) - new Date(start_time)) : 0

    const trip = {
      id: newId(),
      user_id: getUserId(req),
      user_name: getUserName(req),
      start_time: start_time || new Date().toISOString(),
      end_time: end_time || new Date().toISOString(),
      duration_minutes: Math.round(durationMs / 60000),
      start_location: start_location || null,
      end_location: end_location || null,
      waypoints: waypoints || [],
      distance_miles: computedDistance,
      trip_type: trip_type || 'unclassified',
      job_id: job_id || '',
      mileage_rate: rate,
      reimbursement_amount: Math.round(computedDistance * rate * 100) / 100,
      auto_detected: req.body.auto_detected !== false,
      created_at: new Date().toISOString(),
    }

    trips.push(trip)
    await writeTrips(req, trips)
    res.json(trip)
  } catch (e) {
    console.error('[mileage] create trip failed:', e)
    res.status(500).json({ error: e.message })
  }
})

// Batch upload trips (offline sync)
router.post('/trips/batch', async (req, res) => {
  try {
    const trips = await readTrips(req)
    const incoming = Array.isArray(req.body?.trips) ? req.body.trips : []
    const userId = getUserId(req)
    const userName = getUserName(req)

    const created = []
    for (const t of incoming) {
      const computedDistance = t.distance_miles || computeTripDistance(t.waypoints)
      const rate = Number(t.mileage_rate) || DEFAULT_RATE
      const durationMs = t.start_time && t.end_time ? (new Date(t.end_time) - new Date(t.start_time)) : 0

      const trip = {
        id: newId(),
        user_id: userId,
        user_name: userName,
        start_time: t.start_time || new Date().toISOString(),
        end_time: t.end_time || new Date().toISOString(),
        duration_minutes: Math.round(durationMs / 60000),
        start_location: t.start_location || null,
        end_location: t.end_location || null,
        waypoints: t.waypoints || [],
        distance_miles: computedDistance,
        trip_type: t.trip_type || 'unclassified',
        job_id: t.job_id || '',
        mileage_rate: rate,
        reimbursement_amount: Math.round(computedDistance * rate * 100) / 100,
        auto_detected: true,
        created_at: new Date().toISOString(),
      }
      trips.push(trip)
      created.push(trip)
    }

    await writeTrips(req, trips)
    res.json({ created: created.length, trips: created })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// List trips
router.get('/trips', async (req, res) => {
  try {
    const trips = await readTrips(req)
    const userId = getUserId(req)
    const admin = isAdmin(req)
    const { user_id, from, to, type } = req.query

    let filtered = admin
      ? (user_id ? trips.filter(t => t.user_id === user_id) : trips)
      : trips.filter(t => t.user_id === userId)

    if (from) filtered = filtered.filter(t => t.start_time >= from)
    if (to) filtered = filtered.filter(t => t.start_time <= to)
    if (type) filtered = filtered.filter(t => t.trip_type === type)

    filtered.sort((a, b) => b.start_time.localeCompare(a.start_time))
    res.json(filtered)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Update a trip (reclassify)
router.put('/trips/:id', async (req, res) => {
  try {
    const trips = await readTrips(req)
    const userId = getUserId(req)
    const idx = trips.findIndex(t => t.id === req.params.id)
    if (idx < 0) return res.status(404).json({ error: 'Not found' })
    if (!isAdmin(req) && trips[idx].user_id !== userId) {
      return res.status(403).json({ error: 'Not yours' })
    }

    const allowed = ['trip_type', 'job_id', 'mileage_rate', 'distance_miles']
    for (const f of allowed) {
      if (req.body[f] !== undefined) trips[idx][f] = req.body[f]
    }
    // Recompute reimbursement
    trips[idx].reimbursement_amount = Math.round(
      (trips[idx].distance_miles || 0) * (trips[idx].mileage_rate || DEFAULT_RATE) * 100
    ) / 100

    await writeTrips(req, trips)
    res.json(trips[idx])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Delete trip
router.delete('/trips/:id', async (req, res) => {
  try {
    const trips = await readTrips(req)
    const userId = getUserId(req)
    const idx = trips.findIndex(t => t.id === req.params.id)
    if (idx < 0) return res.status(404).json({ error: 'Not found' })
    if (!isAdmin(req) && trips[idx].user_id !== userId) {
      return res.status(403).json({ error: 'Not yours' })
    }
    trips.splice(idx, 1)
    await writeTrips(req, trips)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Link trip to job
router.post('/trips/:id/link-job', async (req, res) => {
  try {
    const trips = await readTrips(req)
    const userId = getUserId(req)
    const trip = trips.find(t => t.id === req.params.id)
    if (!trip) return res.status(404).json({ error: 'Not found' })
    if (!isAdmin(req) && trip.user_id !== userId) {
      return res.status(403).json({ error: 'Not yours' })
    }
    trip.job_id = req.body.job_id || ''
    trip.trip_type = 'business'
    await writeTrips(req, trips)
    res.json(trip)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Monthly summary
router.get('/summary', async (req, res) => {
  try {
    const trips = await readTrips(req)
    const userId = req.query.user_id || getUserId(req)
    if (!isAdmin(req) && userId !== getUserId(req)) {
      return res.status(403).json({ error: 'Not yours' })
    }
    const period = req.query.period // YYYY-MM
    let filtered = trips.filter(t => t.user_id === userId)
    if (period) {
      filtered = filtered.filter(t => (t.start_time || '').startsWith(period))
    }

    const businessMiles = filtered.filter(t => t.trip_type === 'business').reduce((s, t) => s + (t.distance_miles || 0), 0)
    const personalMiles = filtered.filter(t => t.trip_type === 'personal').reduce((s, t) => s + (t.distance_miles || 0), 0)
    const commuteMiles = filtered.filter(t => t.trip_type === 'commute').reduce((s, t) => s + (t.distance_miles || 0), 0)
    const totalMiles = filtered.reduce((s, t) => s + (t.distance_miles || 0), 0)
    const reimbursement = filtered.filter(t => t.trip_type === 'business').reduce((s, t) => s + (t.reimbursement_amount || 0), 0)

    res.json({
      user_id: userId,
      period,
      total_miles: Math.round(totalMiles * 100) / 100,
      business_miles: Math.round(businessMiles * 100) / 100,
      personal_miles: Math.round(personalMiles * 100) / 100,
      commute_miles: Math.round(commuteMiles * 100) / 100,
      reimbursement_total: Math.round(reimbursement * 100) / 100,
      trip_count: filtered.length,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// IRS-compliant annual log
router.get('/mileage-log', async (req, res) => {
  try {
    const trips = await readTrips(req)
    const userId = req.query.user_id || getUserId(req)
    if (!isAdmin(req) && userId !== getUserId(req)) {
      return res.status(403).json({ error: 'Not yours' })
    }
    const year = req.query.year || new Date().getFullYear().toString()

    const filtered = trips
      .filter(t => t.user_id === userId && (t.start_time || '').startsWith(year))
      .sort((a, b) => a.start_time.localeCompare(b.start_time))

    const log = filtered.map(t => ({
      date: t.start_time?.slice(0, 10) || '',
      from: t.start_location?.address || `${t.start_location?.lat},${t.start_location?.lng}`,
      to: t.end_location?.address || `${t.end_location?.lat},${t.end_location?.lng}`,
      purpose: t.trip_type,
      job_id: t.job_id,
      miles: t.distance_miles,
      reimbursement: t.reimbursement_amount,
    }))

    const totals = {
      total_miles: filtered.reduce((s, t) => s + (t.distance_miles || 0), 0),
      business_miles: filtered.filter(t => t.trip_type === 'business').reduce((s, t) => s + (t.distance_miles || 0), 0),
      deductible: filtered.filter(t => t.trip_type === 'business').reduce((s, t) => s + (t.reimbursement_amount || 0), 0),
    }

    res.json({ user_id: userId, year, log, totals })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
