// Dispatch service for the Absolute ADAS map + tech day view.
//
// Responsibilities:
//   1) Per-job state extensions stored outside Datastore (cache-backed):
//      drive_order, en_route_at, started_at, completed_at, time_window_start/_end.
//      Lives in cache key `absolute_adas_job_state`: { [jobId]: { ...fields } }.
//   2) Nearest-neighbor route calculation for a tech's day.
//   3) Auto-ETA based on historical durations + drive time.
//
// Why a cache instead of new Datastore columns: lets the feature ship without
// a schema migration. Mark can migrate to real columns later if he wants
// (see docs/dispatch-map-setup.md).

import catalyst from 'zcatalyst-sdk-node'
import { readGeocache, readTechConfig, normalizeKey } from './geocoding.js'

export const JOB_STATE_KEY = 'absolute_adas_job_state'

function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

export async function readJobState(req) {
  try {
    const item = await getSegment(req).get(JOB_STATE_KEY)
    return item?.cache_value ? JSON.parse(item.cache_value) : {}
  } catch (e) {
    if (isNotFound(e)) return {}
    console.warn('[dispatch] readJobState failed:', e.message)
    return {}
  }
}

export async function writeJobState(req, data) {
  const value = JSON.stringify(data)
  const seg = getSegment(req)
  try { await seg.update(JOB_STATE_KEY, value) }
  catch (e) {
    try { await seg.put(JOB_STATE_KEY, value) }
    catch (e2) { console.error('[dispatch] writeJobState failed:', e.message, '/', e2.message) }
  }
}

// Merge cached state into a job object so callers see all fields in one shape.
export function mergeJobState(job, stateMap) {
  const s = stateMap[String(job.id)] || {}
  return {
    ...job,
    drive_order:        s.drive_order       ?? null,
    en_route_at:        s.en_route_at       ?? null,
    started_at:         s.started_at        ?? null,
    completed_at:       s.completed_at      ?? null,
    time_window_start:  s.time_window_start ?? null,
    time_window_end:    s.time_window_end   ?? null,
  }
}

export async function updateJobStateFields(req, jobId, patch) {
  const state = await readJobState(req)
  const key = String(jobId)
  state[key] = { ...(state[key] || {}), ...patch }
  await writeJobState(req, state)
  return state[key]
}

export async function updateJobStateMany(req, updates) {
  // updates: array of { jobId, patch }
  if (!updates?.length) return
  const state = await readJobState(req)
  for (const { jobId, patch } of updates) {
    const key = String(jobId)
    state[key] = { ...(state[key] || {}), ...patch }
  }
  await writeJobState(req, state)
}

// ── Tech name matching ──────────────────────────────────────────────────────
// Jobs store technician as either "Mark" or "Mark Fowler", "Jayden" or
// "Jayden Goshorn" (and the legacy "Jaden" alias). Match loosely on first name.
export function isAssignedTo(job, techName) {
  if (!job?.technician || !techName) return false
  const j = job.technician.toLowerCase()
  const t = techName.toLowerCase()
  if (j === t) return true
  if (j.startsWith(t + ' ') || j.endsWith(' ' + t) || j.includes(' ' + t + ' ')) return true
  if (j.includes(t)) return true
  // legacy spelling
  if (t === 'jayden' && j.includes('jaden')) return true
  return false
}

// ── Haversine distance (miles) ──────────────────────────────────────────────
export function haversineMiles(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity
  const R = 3958.8
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// ── Tech home base lookup ───────────────────────────────────────────────────
export async function getTechHomeBase(req, techName) {
  const cfg = await readTechConfig(req)
  // Try exact match, then first-name match
  if (cfg[techName]) return cfg[techName]
  const key = Object.keys(cfg).find(k => isAssignedTo({ technician: techName }, k))
  return key ? cfg[key] : null
}

// ── Resolve coords for a job (shop lookup) ──────────────────────────────────
export async function getJobCoords(req, job) {
  if (!job?.shop_name) return null
  const cache = await readGeocache(req)
  const entry = cache[normalizeKey(job.shop_name)]
  if (!entry || entry.lat == null) return null
  return { lat: entry.lat, lng: entry.lng, status: entry.geocode_status }
}

// ── Nearest-neighbor drive order ────────────────────────────────────────────
/**
 * Compute drive_order for one tech on one date.
 *
 * @param {object} req
 * @param {string} techName    e.g. "Mark" or "Jayden"
 * @param {string} dateISO     YYYY-MM-DD
 * @param {Array}  techJobs    jobs already filtered to this tech + date
 * @returns {Array<{jobId, drive_order}>}  updates to persist
 */
export async function calculateDriveOrder(req, techName, dateISO, techJobs) {
  const [geocache, techConfig] = await Promise.all([
    readGeocache(req),
    readTechConfig(req),
  ])
  const homeKey = Object.keys(techConfig).find(k => isAssignedTo({ technician: techName }, k))
  const home = homeKey ? techConfig[homeKey] : null
  const start = (home?.home_lat != null && home?.home_lng != null)
    ? { lat: home.home_lat, lng: home.home_lng }
    : null

  // Skip completed jobs (they don't reroute).
  const open = techJobs.filter(j => !j.completed_at)

  // Sort: pinned drive_order first (manual overrides), then nearest-neighbor for the rest.
  // V1: ignore pinned; just nearest-neighbor everything not completed.
  const remaining = [...open]
  const ordered = []
  let current = start

  while (remaining.length > 0) {
    let best = null
    for (const job of remaining) {
      const coords = geocache[normalizeKey(job.shop_name)]
      if (!coords || coords.lat == null) continue
      if (!current) {
        // no start point; pick the first geocoded job
        best = { job, dist: 0 }
        break
      }
      const d = haversineMiles(current, { lat: coords.lat, lng: coords.lng })
      if (!best || d < best.dist) best = { job, dist: d }
    }
    if (!best) break
    ordered.push(best.job)
    const c = geocache[normalizeKey(best.job.shop_name)]
    current = { lat: c.lat, lng: c.lng }
    remaining.splice(remaining.indexOf(best.job), 1)
  }

  // Build updates: assign drive_order 1..N to ordered; null for un-geocoded leftovers.
  const updates = []
  ordered.forEach((j, i) => updates.push({ jobId: j.id, patch: { drive_order: i + 1 } }))
  for (const j of remaining) updates.push({ jobId: j.id, patch: { drive_order: null } })
  return updates
}

// ── ETA + time window calculation ───────────────────────────────────────────
const DEFAULT_JOB_MIN = 90          // baseline calibration duration if no history
const AVG_DRIVE_MPH = 30            // local-road average
const WINDOW_MIN = 30               // customer-facing window length
const DAY_START_HOUR = 8            // 8:00 AM start

function fmtHHMM(date) {
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

// ── Capacity ────────────────────────────────────────────────────────────────
export async function getTechCapacity(req, techName, dateISO, allJobs, techConfig) {
  const homeKey = Object.keys(techConfig || {}).find(k => isAssignedTo({ technician: techName }, k))
  const cap = techConfig?.[homeKey]?.daily_cap ?? 4
  const used = (allJobs || []).filter(j =>
    isAssignedTo(j, techName)
    && (j.scheduled_date || '') === dateISO
    && j.status !== 'complete'
    && j.status !== 'ready_invoice'
  ).length
  const status = used > cap ? 'over' : (used >= cap ? 'full' : 'room')
  return { cap, used, available: Math.max(0, cap - used), atCap: used >= cap, overCap: used > cap, status }
}

// ── Live snapshot per tech ──────────────────────────────────────────────────
export function deriveLiveStatusForTech(orderedJobs) {
  const open = orderedJobs.filter(j => !j.completed_at)
  const inProgress = open.find(j => j.started_at)
  const enRoute = open.find(j => j.en_route_at && !j.started_at)
  const next = open.find(j => !j.en_route_at && !j.started_at)
  let status = 'idle'
  if (inProgress) status = 'on-site'
  else if (enRoute) status = 'en-route'
  else if (open.length === 0) status = 'done'
  else status = 'idle'

  let elapsedMin = null
  if (inProgress?.started_at) {
    elapsedMin = Math.floor((Date.now() - new Date(inProgress.started_at).getTime()) / 60000)
  }

  return {
    status,
    current_job: inProgress || enRoute || null,
    current_elapsed_min: elapsedMin,
    next_job: next || null,
  }
}

/**
 * Calculate time_window_start/_end for the tech's day, in order.
 *
 * Mid-day-aware: if the tech has already completed some stops, the route
 * recomputes from the last completed shop's location at the completed_at
 * time, NOT from home at 8am.
 *
 * @param {Array} orderedJobs  jobs in drive_order
 * @param {object} state       job-state cache map
 * @param {object} geocache    geocoded-shop cache map
 * @param {object} home        tech home base { home_lat, home_lng }
 * @returns updates array
 */
export function calculateTimeWindows(orderedJobs, state, geocache, home) {
  const updates = []

  // Find the latest completed job (the tech's current position point).
  let lastCompleted = null
  for (const j of orderedJobs) {
    if (j.completed_at) {
      if (!lastCompleted || new Date(j.completed_at) > new Date(lastCompleted.completed_at)) {
        lastCompleted = j
      }
    }
  }

  // Starting cursor: at the last completed shop (mid-day), or at home at day start.
  let cursorMs, prev
  if (lastCompleted) {
    const c = geocache[normalizeKey(lastCompleted.shop_name)]
    if (c?.lat != null) {
      prev = { lat: c.lat, lng: c.lng }
      cursorMs = new Date(lastCompleted.completed_at).getTime()
    }
  }
  if (!prev) {
    const dayStart = new Date()
    dayStart.setHours(DAY_START_HOUR, 0, 0, 0)
    cursorMs = dayStart.getTime()
    prev = (home?.home_lat != null) ? { lat: home.home_lat, lng: home.home_lng } : null
  }

  for (const job of orderedJobs) {
    if (job.completed_at) continue // skip done jobs
    const coords = geocache[normalizeKey(job.shop_name)]
    if (!coords || coords.lat == null) continue

    if (prev) {
      const miles = haversineMiles(prev, coords)
      cursorMs += (miles / AVG_DRIVE_MPH) * 60 * 60 * 1000
    }

    const arrival = new Date(cursorMs)
    const windowEnd = new Date(cursorMs + WINDOW_MIN * 60 * 1000)
    updates.push({
      jobId: job.id,
      patch: { time_window_start: fmtHHMM(arrival), time_window_end: fmtHHMM(windowEnd) },
    })

    cursorMs += DEFAULT_JOB_MIN * 60 * 1000
    prev = coords
  }
  return updates
}

// ── Combined: recompute drive_order + windows for tech/date ─────────────────
export async function recomputeDayForTech(req, techName, dateISO, allJobsForTechDate) {
  const orderUpdates = await calculateDriveOrder(req, techName, dateISO, allJobsForTechDate)
  // Apply order, then derive windows from the now-ordered list
  const orderById = new Map(orderUpdates.map(u => [u.jobId, u.patch.drive_order]))
  const orderedJobs = [...allJobsForTechDate]
    .filter(j => orderById.get(j.id) != null)
    .sort((a, b) => orderById.get(a.id) - orderById.get(b.id))

  const [geocache, techConfig] = await Promise.all([
    readGeocache(req),
    readTechConfig(req),
  ])
  const homeKey = Object.keys(techConfig).find(k => isAssignedTo({ technician: techName }, k))
  const home = homeKey ? techConfig[homeKey] : null
  const windowUpdates = calculateTimeWindows(orderedJobs, {}, geocache, home)

  // Merge order + windows per job
  const merged = new Map()
  for (const u of orderUpdates) merged.set(u.jobId, { ...(merged.get(u.jobId) || {}), ...u.patch })
  for (const u of windowUpdates) merged.set(u.jobId, { ...(merged.get(u.jobId) || {}), ...u.patch })

  const all = [...merged.entries()].map(([jobId, patch]) => ({ jobId, patch }))
  await updateJobStateMany(req, all)
  return all
}

// ── Date helper: today as YYYY-MM-DD in Pacific Time ────────────────────────
export function todayPT() {
  const d = new Date()
  const pt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const y = pt.getFullYear()
  const m = String(pt.getMonth() + 1).padStart(2, '0')
  const day = String(pt.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
