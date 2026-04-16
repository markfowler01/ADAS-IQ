import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()

const CHUNK_SIZE = 50

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

// ── Entry storage (chunked) ──────────────────────────────────────────────────

async function readEntries(req) {
  const segment = getSegment(req)
  try {
    const meta = await cacheGet(segment, 'timeclock_entries_meta', null)
    if (meta && meta.chunks > 0) {
      const parts = await Promise.all(
        Array.from({ length: meta.chunks }, (_, i) =>
          cacheGet(segment, `timeclock_entries_chunk_${i}`, [])
        )
      )
      return parts.flat()
    }
  } catch (e) { /* fall through */ }
  return []
}

async function writeEntries(req, entries) {
  const segment = getSegment(req)
  const chunks = []
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    chunks.push(entries.slice(i, i + CHUNK_SIZE))
  }
  if (chunks.length === 0) chunks.push([])
  for (let i = 0; i < chunks.length; i++) {
    await cacheSet(segment, `timeclock_entries_chunk_${i}`, chunks[i])
  }
  await cacheSet(segment, 'timeclock_entries_meta', {
    chunks: chunks.length,
    total: entries.length,
    updated: new Date().toISOString(),
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(req) {
  return req.user?.email || req.user?.id || req.user?.name || 'unknown'
}

function getUserName(req) {
  return req.user?.name || req.user?.email || 'Unknown User'
}

function isAdmin(req) {
  return req.user?.role !== 'technician'
}

function newId(prefix = 'te') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function computeBreakMinutes(breaks) {
  return (breaks || []).reduce((sum, b) => {
    if (!b.start || !b.end) return sum
    return sum + Math.max(0, (new Date(b.end) - new Date(b.start)) / 60000)
  }, 0)
}

function computeEntryMinutes(entry) {
  if (!entry.clock_in || !entry.clock_out) return 0
  const total = (new Date(entry.clock_out) - new Date(entry.clock_in)) / 60000
  const breakMin = computeBreakMinutes(entry.breaks)
  return Math.max(0, Math.round(total - breakMin))
}

function getWeekStart(dateStr) {
  // Returns Monday 00:00 of the week containing the given date, ISO format
  const d = new Date(dateStr)
  const day = d.getDay() // 0=Sun..6=Sat
  const offset = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + offset)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function splitOvertime(entries) {
  // Given a list of entries for a single user, compute regular vs overtime per week
  // Returns entries with regular_minutes/overtime_minutes set
  const byWeek = new Map()
  for (const e of entries) {
    if (!e.clock_out) continue
    const wk = getWeekStart(e.clock_in)
    if (!byWeek.has(wk)) byWeek.set(wk, [])
    byWeek.get(wk).push(e)
  }
  for (const [, list] of byWeek) {
    list.sort((a, b) => a.clock_in.localeCompare(b.clock_in))
    let weekTotal = 0
    for (const e of list) {
      const mins = e.total_minutes || 0
      const remainingRegular = Math.max(0, 2400 - weekTotal) // 40h = 2400 min
      e.regular_minutes = Math.min(mins, remainingRegular)
      e.overtime_minutes = mins - e.regular_minutes
      weekTotal += mins
    }
  }
  return entries
}

// ── Endpoints ────────────────────────────────────────────────────────────────

// Clock in
router.post('/clock-in', async (req, res) => {
  try {
    const userId = getUserId(req)
    const entries = await readEntries(req)
    const open = entries.find(e => e.user_id === userId && !e.clock_out)
    if (open) return res.status(409).json({ error: 'Already clocked in', entry: open })

    const now = new Date().toISOString()
    const entry = {
      id: newId(),
      user_id: userId,
      user_name: getUserName(req),
      clock_in: now,
      clock_out: null,
      breaks: [],
      clock_in_location: req.body?.location || null,
      clock_out_location: null,
      total_minutes: 0,
      regular_minutes: 0,
      overtime_minutes: 0,
      notes: '',
      job_ids: [],
      approved: false,
      approved_by: '',
      approved_at: '',
      created_at: now,
    }
    entries.push(entry)
    await writeEntries(req, entries)
    res.json(entry)
  } catch (e) {
    console.error('[timeclock] clock-in failed:', e)
    res.status(500).json({ error: e.message })
  }
})

// Clock out
router.post('/clock-out', async (req, res) => {
  try {
    const userId = getUserId(req)
    const entries = await readEntries(req)
    const entry = entries.find(e => e.user_id === userId && !e.clock_out)
    if (!entry) return res.status(404).json({ error: 'Not clocked in' })

    // Auto-close any open break
    const openBreak = (entry.breaks || []).find(b => !b.end)
    if (openBreak) openBreak.end = new Date().toISOString()

    entry.clock_out = new Date().toISOString()
    entry.clock_out_location = req.body?.location || null
    entry.notes = req.body?.notes || entry.notes
    entry.job_ids = req.body?.job_ids || entry.job_ids
    entry.total_minutes = computeEntryMinutes(entry)

    // Recompute OT for this user's current week
    const userEntries = entries.filter(e => e.user_id === userId)
    splitOvertime(userEntries)

    await writeEntries(req, entries)
    res.json(entry)
  } catch (e) {
    console.error('[timeclock] clock-out failed:', e)
    res.status(500).json({ error: e.message })
  }
})

// Start break
router.post('/break/start', async (req, res) => {
  try {
    const userId = getUserId(req)
    const entries = await readEntries(req)
    const entry = entries.find(e => e.user_id === userId && !e.clock_out)
    if (!entry) return res.status(404).json({ error: 'Not clocked in' })
    const openBreak = (entry.breaks || []).find(b => !b.end)
    if (openBreak) return res.status(409).json({ error: 'Break already active', entry })

    entry.breaks = entry.breaks || []
    entry.breaks.push({
      start: new Date().toISOString(),
      end: null,
      type: req.body?.type || 'short',
    })
    await writeEntries(req, entries)
    res.json(entry)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// End break
router.post('/break/end', async (req, res) => {
  try {
    const userId = getUserId(req)
    const entries = await readEntries(req)
    const entry = entries.find(e => e.user_id === userId && !e.clock_out)
    if (!entry) return res.status(404).json({ error: 'Not clocked in' })
    const openBreak = (entry.breaks || []).find(b => !b.end)
    if (!openBreak) return res.status(404).json({ error: 'No active break' })

    openBreak.end = new Date().toISOString()
    await writeEntries(req, entries)
    res.json(entry)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Current entry
router.get('/current', async (req, res) => {
  try {
    const userId = getUserId(req)
    const entries = await readEntries(req)
    const entry = entries.find(e => e.user_id === userId && !e.clock_out)
    res.json(entry || null)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// List entries
router.get('/entries', async (req, res) => {
  try {
    const entries = await readEntries(req)
    const userId = getUserId(req)
    const admin = isAdmin(req)
    const { user_id, from, to } = req.query

    let filtered = admin
      ? (user_id ? entries.filter(e => e.user_id === user_id) : entries)
      : entries.filter(e => e.user_id === userId)

    if (from) filtered = filtered.filter(e => e.clock_in >= from)
    if (to) filtered = filtered.filter(e => e.clock_in <= to)

    filtered.sort((a, b) => b.clock_in.localeCompare(a.clock_in))
    res.json(filtered)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Weekly timesheet
router.get('/timesheet', async (req, res) => {
  try {
    const entries = await readEntries(req)
    const userId = getUserId(req)
    const admin = isAdmin(req)
    const targetUserId = (admin && req.query.user_id) ? req.query.user_id : userId

    const weekStart = req.query.week ? getWeekStart(req.query.week) : getWeekStart(new Date().toISOString())
    const weekEnd = new Date(new Date(weekStart).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const userEntries = entries
      .filter(e => e.user_id === targetUserId)
      .filter(e => e.clock_in >= weekStart && e.clock_in < weekEnd)
      .sort((a, b) => a.clock_in.localeCompare(b.clock_in))

    // Compute per-day totals
    const byDay = {}
    for (let i = 0; i < 7; i++) {
      const d = new Date(new Date(weekStart).getTime() + i * 24 * 60 * 60 * 1000)
      const key = d.toISOString().slice(0, 10)
      byDay[key] = { date: key, entries: [], regular: 0, overtime: 0, breaks: 0 }
    }
    for (const e of userEntries) {
      const key = e.clock_in.slice(0, 10)
      if (!byDay[key]) byDay[key] = { date: key, entries: [], regular: 0, overtime: 0, breaks: 0 }
      byDay[key].entries.push(e)
      byDay[key].regular += e.regular_minutes || 0
      byDay[key].overtime += e.overtime_minutes || 0
      byDay[key].breaks += computeBreakMinutes(e.breaks)
    }

    const totals = {
      regular: userEntries.reduce((s, e) => s + (e.regular_minutes || 0), 0),
      overtime: userEntries.reduce((s, e) => s + (e.overtime_minutes || 0), 0),
      total: userEntries.reduce((s, e) => s + (e.total_minutes || 0), 0),
      breaks: userEntries.reduce((s, e) => s + computeBreakMinutes(e.breaks), 0),
    }

    res.json({
      user_id: targetUserId,
      week_start: weekStart,
      week_end: weekEnd,
      days: Object.values(byDay),
      totals,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Edit entry (admin only)
router.put('/entries/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const entries = await readEntries(req)
    const idx = entries.findIndex(e => e.id === req.params.id)
    if (idx < 0) return res.status(404).json({ error: 'Not found' })

    const allowed = ['clock_in', 'clock_out', 'breaks', 'notes', 'job_ids']
    for (const f of allowed) {
      if (req.body[f] !== undefined) entries[idx][f] = req.body[f]
    }
    entries[idx].total_minutes = computeEntryMinutes(entries[idx])

    // Recompute OT
    const userEntries = entries.filter(e => e.user_id === entries[idx].user_id)
    splitOvertime(userEntries)

    await writeEntries(req, entries)
    res.json(entries[idx])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Delete entry (admin)
router.delete('/entries/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const entries = await readEntries(req)
    const idx = entries.findIndex(e => e.id === req.params.id)
    if (idx < 0) return res.status(404).json({ error: 'Not found' })
    entries.splice(idx, 1)
    await writeEntries(req, entries)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Approve entry (admin)
router.post('/entries/:id/approve', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const entries = await readEntries(req)
    const entry = entries.find(e => e.id === req.params.id)
    if (!entry) return res.status(404).json({ error: 'Not found' })

    entry.approved = true
    entry.approved_by = getUserId(req)
    entry.approved_at = new Date().toISOString()
    await writeEntries(req, entries)
    res.json(entry)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Pending approvals (admin)
router.get('/pending-approvals', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const entries = await readEntries(req)
    const pending = entries
      .filter(e => e.clock_out && !e.approved)
      .sort((a, b) => a.clock_out.localeCompare(b.clock_out))
    res.json(pending)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
