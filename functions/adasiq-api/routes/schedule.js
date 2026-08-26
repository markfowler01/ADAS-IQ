// Schedule calendar backend (Mark 2026-08-10, "Request Calendar" spec).
//
// The calendar itself is client-side over the existing jobs list —
// requests are jobs at status job_requested, scheduled via the existing
// scheduled_date field. This route adds the bits that need a server:
//
//   GET  /api/schedule/meta         → { [job_id]: { confirmed, confirmed_at } }
//   POST /api/schedule/confirm      { job_id, confirmed } — shop-confirmed toggle
//   POST /api/schedule/digest-run   (x-cron-secret) — post the digest now
//
// plus maybeFireScheduleDigest(req), piggybacked on the hourly postscan
// cron like the morning kickoff: 6am PT daily digest to #dispatch with
// today / tomorrow / 10-day / unconfirmed / overdue / unscheduled counts.
//
// Confirmed flags live in AppConfig KV rows `sched_meta:<jobId>` (same
// durable pattern as card notes / tech to-dos — no console schema work).

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { readJobsPublic } from './jobs.js'
import { todayPT } from '../services/dispatch.js'
import { postToCliqChannel, DISPATCH_CHANNEL, TECHNICIANS_CHANNEL } from '../services/cliq.js'

const router = express.Router()
const TABLE = 'AppConfig'
const PREFIX = 'sched_meta:'
const DIGEST_STAMP_PREFIX = 'sched_digest_sent:'

function metaKey(jobId) {
  return (PREFIX + String(jobId || '')).slice(0, 64)
}

async function scanScheduleMeta(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const out = {}
  const PAGE = 250
  for (let offset = 0; offset < 20000; offset += PAGE) {
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT config_key, config_value FROM ${TABLE} LIMIT ${PAGE} OFFSET ${offset}`
    )
    for (const row of rows || []) {
      const r = row[TABLE] || row
      const key = String(r?.config_key || '')
      if (key.startsWith(PREFIX) && r.config_value) {
        try { out[key.slice(PREFIX.length)] = JSON.parse(r.config_value) } catch { /* skip */ }
      }
    }
    if (!rows || rows.length < PAGE) break
  }
  return out
}

async function upsertKV(req, key, value) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID FROM ${TABLE} WHERE config_key = '${key.replace(/'/g, "''")}' LIMIT 1`
  )
  const existing = rows?.[0]?.[TABLE] || rows?.[0] || null
  const table = app.datastore().table(TABLE)
  if (existing?.ROWID) {
    await table.updateRow({ ROWID: String(existing.ROWID), config_key: key, config_value: value })
  } else {
    await table.insertRow({ config_key: key, config_value: value })
  }
}

async function readKV(req, key) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT config_value FROM ${TABLE} WHERE config_key = '${key.replace(/'/g, "''")}' LIMIT 1`
  )
  const r = rows?.[0]?.[TABLE] || rows?.[0] || null
  return r?.config_value || null
}

// Approved PTO → per-day off map (Mark 2026-08-15: "no jobs can be
// booked those days for the person that's off" — soft block, always
// overridable in the UI). Reads the same pto_requests store the Time
// Off page writes. First name only, matching job.technician values.
async function readTimeOffMap(req) {
  let requests = []
  try {
    const { getRequestsDurable } = await import('./pto.js')
    requests = await getRequestsDurable(req)
  } catch { return {} }
  const today = todayPT()
  const horizon = addDaysISO(today, 120)
  const out = {}
  for (const r of requests) {
    if (String(r.status) !== 'approved') continue
    if (!r.start_date || !r.end_date || r.end_date < today || r.start_date > horizon) continue
    const first = String(r.user_name || '').trim().split(/\s+/)[0]
    if (!first) continue
    for (let d = r.start_date; d <= r.end_date && d <= horizon; d = addDaysISO(d, 1)) {
      if (d < today) continue
      ;(out[d] = out[d] || []).includes(first) || out[d].push(first)
    }
  }
  return out
}

// One-call payload for the Schedule screen: every job (requests included),
// confirmed flags, and per-shop city + coords for the cards and the map.
router.get('/board', async (req, res) => {
  try {
    const { readGeocache, normalizeKey, geocodeAddress, readGeocacheRaw, writeGeocache } = await import('../services/geocoding.js')
    const app = catalyst.initialize(req, { type: 'advancedio' })

    let [jobs, meta, geocache, timeOff] = await Promise.all([
      readJobsPublic(req),
      scanScheduleMeta(req),
      readGeocache(req).catch(() => ({})),
      readTimeOffMap(req).catch(() => ({})),
    ])

    // Shop → city from CRMShops addresses ("123 Main St, Everett, WA 98201"
    // → "Everett"). Paginated like every other big-table read.
    const shops = {}
    const addresses = {}
    const PAGE = 250
    for (let offset = 0; offset < 10000; offset += PAGE) {
      const rows = await app.zcql().executeZCQLQuery(
        `SELECT shop_name, address FROM CRMShops LIMIT ${PAGE} OFFSET ${offset}`
      )
      for (const row of rows || []) {
        const r = row.CRMShops || row
        const name = String(r?.shop_name || '')
        if (!name) continue
        const parts = String(r?.address || '').split(',').map(s => s.trim()).filter(Boolean)
        // ["street", "city", "ST zip"] — city is second-to-last when we have 3+
        const city = parts.length >= 3 ? parts[parts.length - 2]
          : (parts.length === 2 ? parts[1].replace(/\s+[A-Z]{2}\s*\d*$/, '') : '')
        const norm = normalizeKey(name)
        const geo = geocache[norm]
        addresses[norm] = String(r?.address || '')
        shops[norm] = {
          city: city || '',
          lat: geo?.lat ?? null,
          lng: geo?.lng ?? null,
        }
      }
      if (!rows || rows.length < PAGE) break
    }

    // The geocache is Catalyst-Cache-only (48h TTL) so it can come back
    // empty. Re-geocode request shops on demand — bounded to 5 per call,
    // written back so the next load is a cache hit.
    const needGeo = [...new Set(
      jobs.filter(j => (j.status || '') === 'job_requested')
        .map(j => normalizeKey(j.shop_name))
        .filter(n => n && shops[n] && shops[n].lat == null && addresses[n])
    )].slice(0, 5)
    if (needGeo.length > 0) {
      let cacheDirty = false
      let rawCache = null
      for (const norm of needGeo) {
        try {
          const geo = await geocodeAddress(addresses[norm])
          if (geo?.lat != null) {
            shops[norm].lat = geo.lat
            shops[norm].lng = geo.lng
            if (!rawCache) rawCache = await readGeocacheRaw(req).catch(() => ({}))
            rawCache[norm] = { ...geo, geocoded_at: new Date().toISOString() }
            cacheDirty = true
          }
        } catch (e) { console.warn('[schedule board geocode]', norm, e.message) }
      }
      if (cacheDirty && rawCache) {
        await writeGeocache(req, rawCache).catch(e => console.warn('[schedule board geocache write]', e.message))
      }
    }

    res.json({
      ok: true,
      jobs: jobs.map(j => ({
        id: j.id, shop_name: j.shop_name, vehicle: j.vehicle,
        year: j.year, make: j.make, model: j.model,
        technician: j.technician, status: j.status,
        scheduled_date: j.scheduled_date, calibrations: j.calibrations,
        quote_number: j.quote_number, vin: j.vin,
      })),
      meta,
      shops,
      time_off: timeOff,
    })
  } catch (err) {
    console.error('[schedule board]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Soft-block check for booking flows: is this tech off that day?
router.get('/off', async (req, res) => {
  try {
    const date = String(req.query.date || '').slice(0, 10)
    const tech = String(req.query.technician || '').trim().split(/\s+/)[0].toLowerCase()
    if (!date || !tech) return res.json({ ok: true, off: false })
    const map = await readTimeOffMap(req)
    const names = map[date] || []
    const hit = names.find(n => n.toLowerCase() === tech || tech.startsWith(n.toLowerCase()) || n.toLowerCase().startsWith(tech))
    res.json({ ok: true, off: !!hit, who: hit || '', date })
  } catch (err) {
    res.json({ ok: true, off: false, error: err.message })
  }
})

router.get('/meta', async (req, res) => {
  try {
    res.json({ ok: true, meta: await scanScheduleMeta(req) })
  } catch (err) {
    console.error('[schedule meta]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/confirm', async (req, res) => {
  try {
    const jobId = String(req.body?.job_id || '')
    if (!jobId) return res.status(400).json({ error: 'job_id required' })
    const confirmed = !!req.body?.confirmed
    const value = JSON.stringify({
      confirmed,
      confirmed_at: confirmed ? new Date().toISOString() : null,
    })
    await upsertKV(req, metaKey(jobId), value)
    res.json({ ok: true, job_id: jobId, confirmed })
  } catch (err) {
    console.error('[schedule confirm]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── 6am digest ────────────────────────────────────────────────────────

function addDaysISO(iso, n) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function isWeekendISO(iso) {
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay()
  return dow === 0 || dow === 6
}
function fmtShort(iso) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

const ACTIVE_JOB = s => /^dispatched_|^need_dispatch$|^pending_parts$/.test(s || '')

// scheduled_date is usually YYYY-MM-DD but some rows carry a time suffix
// ("2026-08-05T08:00") — compare on the date part only.
const dateOnly = v => String(v || '').slice(0, 10)

export async function buildScheduleDigest(req) {
  const [jobs, meta] = await Promise.all([readJobsPublic(req), scanScheduleMeta(req)])
  const today = todayPT()
  const tomorrow = addDaysISO(today, 1)

  const requests = jobs.filter(j => (j.status || '') === 'job_requested')
  const active   = jobs.filter(j => ACTIVE_JOB(j.status))

  // Next 10 working days (starting today)
  const horizon = []
  for (let d = today, added = 0; added < 10; d = addDaysISO(d, 1)) {
    if (!isWeekendISO(d)) { horizon.push(d); added++ }
  }
  const horizonSet = new Set(horizon)

  const count = (list, date) => list.filter(j => dateOnly(j.scheduled_date) === date).length
  const label = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

  const unscheduled = requests.filter(j => !dateOnly(j.scheduled_date))
  const overdue = requests.filter(j => dateOnly(j.scheduled_date) && dateOnly(j.scheduled_date) < today)
  const unconfirmed = requests.filter(j =>
    dateOnly(j.scheduled_date) && dateOnly(j.scheduled_date) >= today && !meta[String(j.id)]?.confirmed)
  const horizonRequests = requests.filter(j => horizonSet.has(dateOnly(j.scheduled_date)))

  const lines = [
    `📅 *Schedule* — ${fmtShort(today)}`,
    `Today: ${label(count(active, today), 'job')}${count(requests, today) ? `, ${label(count(requests, today), 'request')}` : ''}`,
    `Tomorrow: ${label(count(active, tomorrow), 'job')}${count(requests, tomorrow) ? `, ${label(count(requests, tomorrow), 'request')}` : ''}`,
    `Next 10 working days: ${label(horizonRequests.length, 'request')}`,
  ]
  if (unconfirmed.length) lines.push(`⏳ Unconfirmed: ${unconfirmed.length}`)
  for (const j of overdue.slice(0, 5)) {
    const vehicle = j.vehicle || [j.year, j.make, j.model].filter(Boolean).join(' ')
    lines.push(`🔴 Overdue: ${j.shop_name || 'Unknown shop'} · ${vehicle || 'Vehicle TBD'} · was ${fmtShort(dateOnly(j.scheduled_date))}`)
  }
  if (unscheduled.length) lines.push(`📥 Unscheduled: ${unscheduled.length}`)

  const nothingToSay = !unconfirmed.length && !overdue.length && !unscheduled.length &&
    horizonRequests.length === 0 && count(requests, today) === 0

  // Tech-facing post — "what's on the board today" so nothing gets
  // missed (Mark 2026-08-11). Grouped by tech, requests flagged so the
  // crew knows Kat still has to promote them.
  const todayItems = [...active, ...requests].filter(j => dateOnly(j.scheduled_date) === today)
  let techText = null
  if (todayItems.length > 0) {
    const byTech = {}
    for (const j of todayItems) {
      const t = j.technician ? String(j.technician) : 'Unassigned'
      ;(byTech[t] = byTech[t] || []).push(j)
    }
    const techLines = [`🔧 *Today's schedule* — ${fmtShort(today)} · ${todayItems.length} on the board`]
    for (const [tech, list] of Object.entries(byTech)) {
      techLines.push(`*${tech}*`)
      for (const j of list) {
        const vehicle = j.vehicle || [j.year, j.make, j.model].filter(Boolean).join(' ')
        const ro = j.invoice_number || j.quote_number
        const isReq = (j.status || '') === 'job_requested'
        techLines.push(`• ${j.shop_name || 'Unknown shop'} — ${vehicle || 'Vehicle TBD'}${ro ? ` (RO# ${ro})` : ''}${isReq ? ' · 🟠 request, not promoted yet' : ''}`)
      }
    }
    techText = techLines.join('\n')
  }

  return { text: lines.join('\n'), techText, counts: {
    today_jobs: count(active, today), overdue: overdue.length,
    unconfirmed: unconfirmed.length, unscheduled: unscheduled.length,
    today_total: todayItems.length,
  }, quiet: nothingToSay }
}

// Piggybacks the hourly postscan cron. Fires once per day in the 6am PT
// hour. Skips weekends (no dispatch on Sat/Sun) and skips entirely-quiet
// days so the channel doesn't get a daily "nothing to report".
export async function maybeFireScheduleDigest(req) {
  const now = new Date()
  const hourPT = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false,
  }).format(now))
  if (hourPT !== 6) return { fired: false, reason: `outside 6am window (hour=${hourPT})` }
  const today = todayPT()
  if (isWeekendISO(today)) return { fired: false, reason: 'weekend' }
  const stampKey = (DIGEST_STAMP_PREFIX + today).slice(0, 64)
  try {
    if (await readKV(req, stampKey)) return { fired: false, reason: 'already sent today' }
  } catch (e) { console.warn('[sched-digest dedup]', e.message) }
  try {
    const digest = await buildScheduleDigest(req)
    if (!digest.quiet) await postToCliqChannel(DISPATCH_CHANNEL, digest.text)
    // Tech-facing "today's board" — only posts when something is
    // actually scheduled today; a quiet day posts nothing.
    if (digest.techText) {
      await postToCliqChannel(TECHNICIANS_CHANNEL, digest.techText)
        .catch(e => console.warn('[sched-digest] tech post failed:', e.message))
    }
    await upsertKV(req, stampKey, new Date().toISOString())
    return { fired: !digest.quiet || !!digest.techText, ...digest.counts }
  } catch (e) {
    console.error('[sched-digest]', e.message)
    return { fired: false, error: e.message }
  }
}

// Manual / external-cron trigger (same secret family as the other
// maintenance endpoints).
router.post('/digest-run', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret || ''
  if (secret !== 'backup-2026') return res.status(401).json({ error: 'unauthorized' })
  try {
    const digest = await buildScheduleDigest(req)
    await postToCliqChannel(DISPATCH_CHANNEL, digest.text)
    if (digest.techText) await postToCliqChannel(TECHNICIANS_CHANNEL, digest.techText)
    res.json({ ok: true, tech_posted: !!digest.techText, ...digest.counts })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export { router as scheduleRouter }
