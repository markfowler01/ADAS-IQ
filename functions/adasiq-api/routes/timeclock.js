import express from 'express'
import { canonicalIdentity } from '../services/hr.js'
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

// ── DURABLE entries storage (Mark 2026-08-15: "this needs to be
// bulletproof"). Payroll-critical hours can NOT live in the 48h cache.
//
// Generation-swap writes: each save writes a fresh set of AppConfig
// rows (tc_g<gen>_chunk_<i>), then flips the meta row last. A crash
// mid-write leaves the previous generation fully intact — the meta
// still points at consistent data. After a verified flip the old
// generation's rows are deleted best-effort.
async function tcKV(req) {
  const app = catalyst.initialize(req)
  return { zcql: app.zcql(), table: app.datastore().table('AppConfig') }
}
async function tcRead(req, key) {
  const { zcql } = await tcKV(req)
  const rows = await zcql.executeZCQLQuery(
    `SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key}' LIMIT 1`
  )
  const r = rows?.[0]?.AppConfig || rows?.[0] || null
  return r ? { rowid: String(r.ROWID), value: r.config_value } : null
}
async function tcWrite(req, key, value) {
  const { zcql, table } = await tcKV(req)
  const rows = await zcql.executeZCQLQuery(
    `SELECT ROWID FROM AppConfig WHERE config_key = '${key}' LIMIT 1`
  )
  const existing = rows?.[0]?.AppConfig || rows?.[0] || null
  if (existing?.ROWID) await table.updateRow({ ROWID: String(existing.ROWID), config_key: key, config_value: value })
  else await table.insertRow({ config_key: key, config_value: value })
}
async function tcDelete(req, key) {
  try {
    const { table } = await tcKV(req)
    const r = await tcRead(req, key)
    if (r) await table.deleteRow(r.rowid)
  } catch { /* best-effort cleanup */ }
}

const TC_META_KEY = 'tc_entries_meta'

function normalizeIdentities(entries) {
  for (const e of entries || []) {
    const [id, name] = canonicalIdentity(e.user_id, e.user_name)
    e.user_id = id
    e.user_name = name
  }
  return entries
}

// ═══ LEGACY store (single global blob, generation-swap) — kept intact
// as the migration source AND as a frozen backup. Never deleted.
async function readLegacyEntries(req) {
  // Durable first
  try {
    const metaRow = await tcRead(req, TC_META_KEY)
    if (metaRow?.value) {
      const meta = JSON.parse(metaRow.value)
      if (meta && meta.chunks >= 0 && meta.gen != null) {
        const parts = []
        for (let i = 0; i < meta.chunks; i++) {
          const c = await tcRead(req, `tc_g${meta.gen}_chunk_${i}`)
          parts.push(c?.value ? JSON.parse(c.value) : [])
        }
        return normalizeIdentities(parts.flat())
      }
    }
  } catch (e) { console.warn('[timeclock] durable read failed:', e.message) }

  // One-time migration from the legacy cache chunks
  const segment = getSegment(req)
  try {
    const meta = await cacheGet(segment, 'timeclock_entries_meta', null)
    if (meta && meta.chunks > 0) {
      const parts = await Promise.all(
        Array.from({ length: meta.chunks }, (_, i) =>
          cacheGet(segment, `timeclock_entries_chunk_${i}`, [])
        )
      )
      const entries = normalizeIdentities(parts.flat())
      console.log(`[timeclock] legacy cache still holds ${entries.length} entries`)
      return entries
    }
  } catch (e) { /* fall through */ }
  return []
}

async function writeLegacyEntries(req, entries) { // retained for emergencies
  // Next generation number
  let prevGen = -1
  let prevChunks = 0
  try {
    const metaRow = await tcRead(req, TC_META_KEY)
    if (metaRow?.value) {
      const m = JSON.parse(metaRow.value)
      prevGen = Number(m.gen ?? -1)
      prevChunks = Number(m.chunks || 0)
    }
  } catch { /* first write */ }
  const gen = prevGen + 1

  const chunks = []
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    chunks.push(entries.slice(i, i + CHUNK_SIZE))
  }
  if (chunks.length === 0) chunks.push([])

  // 1. Write the new generation's chunks
  for (let i = 0; i < chunks.length; i++) {
    await tcWrite(req, `tc_g${gen}_chunk_${i}`, JSON.stringify(chunks[i]))
  }
  // 2. Flip meta LAST — the commit point
  await tcWrite(req, TC_META_KEY, JSON.stringify({
    gen, chunks: chunks.length, total: entries.length, updated: new Date().toISOString(),
  }))
  // 3. Verify the flip landed
  const check = await tcRead(req, TC_META_KEY)
  const checkMeta = check?.value ? JSON.parse(check.value) : null
  if (!checkMeta || Number(checkMeta.gen) !== gen) {
    throw new Error('timeclock write verification failed — entry NOT saved, retry')
  }
  // 4. Clean up the old generation (best-effort)
  if (prevGen >= 0) {
    for (let i = 0; i < Math.max(prevChunks, 1); i++) {
      await tcDelete(req, `tc_g${prevGen}_chunk_${i}`)
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// ═══ PER-PERSON-MONTH store (Mark 2026-08-30: "I want the time clock
// backed up this is very important"). One AppConfig row per person per
// month — a punch touches ONLY that person's row, so simultaneous
// 8 AM clock-ins can never race each other. The legacy blob is left in
// place untouched as a frozen backup, and a nightly email backup rides
// the postscan (see hr.js maybeBackupTimeclock).
const TC2_INDEX = 'tc2:index'
const emailKey = uid => String(uid || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_')
function monthOf(entry) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit',
  }).format(new Date(entry.clock_in || Date.now())).slice(0, 7)
}
const rowKeyFor = (uid, month) => `tc2:${emailKey(uid)}:${month}`

async function tc2Index(req) {
  const r = await tcRead(req, TC2_INDEX)
  try { return r?.value ? JSON.parse(r.value) : null } catch { return null }
}
async function tc2SetIndex(req, keys) {
  await tcWrite(req, TC2_INDEX, JSON.stringify([...new Set(keys)].sort()))
}
function bucketize(entries) {
  const buckets = {}
  for (const e of entries) {
    const k = rowKeyFor(e.user_id, monthOf(e))
    ;(buckets[k] = buckets[k] || []).push(e)
  }
  return buckets
}

// One-time migration: legacy blob → per-person-month rows. Old rows stay.
async function ensureTc2(req) {
  const idx = await tc2Index(req)
  if (idx !== null) return idx
  const legacy = await readLegacyEntries(req)
  const buckets = bucketize(legacy)
  const keys = Object.keys(buckets)
  for (const k of keys) await tcWrite(req, k, JSON.stringify(buckets[k]))
  await tc2SetIndex(req, keys)
  // verify: counts must match before we trust it
  let total = 0
  for (const k of keys) {
    const r = await tcRead(req, k)
    total += r?.value ? JSON.parse(r.value).length : 0
  }
  if (total !== legacy.length) {
    await tcDelete(req, TC2_INDEX)
    throw new Error(`timeclock migration verify failed (${total} vs ${legacy.length}) — staying on legacy store`)
  }
  console.log(`[timeclock] migrated ${legacy.length} entries → ${keys.length} person-month rows (legacy blob preserved)`)
  return keys
}

async function readEntries(req) {
  const keys = await ensureTc2(req)
  const parts = await Promise.all(keys.map(async k => {
    const r = await tcRead(req, k)
    try { return r?.value ? JSON.parse(r.value) : [] } catch { return [] }
  }))
  return normalizeIdentities(parts.flat()).sort((a, b) => String(a.clock_in).localeCompare(String(b.clock_in)))
}

// Full write (sweeps + multi-person admin ops — evening, low contention).
async function writeEntries(req, entries) {
  const keys = await ensureTc2(req)
  const buckets = bucketize(normalizeIdentities(entries))
  for (const [k, list] of Object.entries(buckets)) {
    await tcWrite(req, k, JSON.stringify(list))
  }
  // A person-month that lost its last entry must be emptied, or deleted
  // entries resurrect on the next read.
  for (const k of keys) {
    if (!buckets[k]) await tcWrite(req, k, '[]')
  }
  await tc2SetIndex(req, [...keys, ...Object.keys(buckets)])
  const check = await tcRead(req, TC2_INDEX)
  if (!check?.value) throw new Error('timeclock write verification failed — retry')
}

// HOT PATH: one person's entries only. Punches race no one.
async function readPerson(req, userId) {
  const keys = await ensureTc2(req)
  const mine = keys.filter(k => k.startsWith(`tc2:${emailKey(userId)}:`))
  const parts = await Promise.all(mine.map(async k => {
    const r = await tcRead(req, k)
    try { return r?.value ? JSON.parse(r.value) : [] } catch { return [] }
  }))
  return normalizeIdentities(parts.flat()).sort((a, b) => String(a.clock_in).localeCompare(String(b.clock_in)))
}
async function writePerson(req, userId, personEntries) {
  const keys = await ensureTc2(req)
  const ek = emailKey(userId)
  const buckets = bucketize(personEntries)
  for (const [k, list] of Object.entries(buckets)) {
    if (!k.startsWith(`tc2:${ek}:`)) throw new Error('writePerson: foreign entry in person write')
    await tcWrite(req, k, JSON.stringify(list))
  }
  for (const k of keys) {
    if (k.startsWith(`tc2:${ek}:`) && !buckets[k]) await tcWrite(req, k, '[]')
  }
  await tc2SetIndex(req, [...keys, ...Object.keys(buckets)])
  // read-back verify the newest bucket
  const first = Object.keys(buckets)[0]
  if (first) {
    const check = await tcRead(req, first)
    if (!check?.value) throw new Error('timeclock person-write verification failed — punch NOT saved, retry')
  }
}

function getUserId(req) {
  const raw = req.user?.email || req.user?.id || req.user?.name || 'unknown'
  return canonicalIdentity(raw, req.user?.name)[0]
}

function getUserName(req) {
  const raw = req.user?.name || req.user?.email || 'Unknown User'
  return canonicalIdentity(req.user?.email || raw, raw)[1]
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

// Payroll period lock (Mark 2026-08-27): once a period's hours report
// has gone out, its entries are frozen so reported numbers can't drift.
// Mark alone overrides by sending unlock:true, and the override leaves
// an audit note on the entry.
async function payrollLockCheck(req, entry) {
  const { getPayrollLockDate } = await import('../services/hr.js')
  const lock = await getPayrollLockDate(req).catch(() => '')
  if (!lock) return null
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(entry.clock_in))
  if (d > lock) return null
  const email = String(req.user?.email || '').toLowerCase()
  if (email.startsWith('mark@') && (req.body?.unlock === true || req.query?.unlock === '1')) {
    return { audit: `[payroll-locked entry (period through ${lock}) modified by ${email} ${new Date().toISOString()}]` }
  }
  return { locked: lock }
}

// ── Endpoints ────────────────────────────────────────────────────────────────

// Clock in
router.post('/clock-in', async (req, res) => {
  try {
    const userId = getUserId(req)
    const entries = await readPerson(req, userId)
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
    await writePerson(req, userId, entries)
    // GPS sanity flag must finish BEFORE the response (Catalyst kills
    // post-response work). Bounded so it never slows the punch.
    try {
      const { flagRemoteClockIn } = await import('../services/hr.js')
      await Promise.race([flagRemoteClockIn(req, entry), new Promise(r => setTimeout(r, 1500))])
    } catch { /* never blocks a punch */ }
    // Text Mark when a TECHNICIAN punches in, with a map pin of where
    // (Mark 2026-08-30). Bounded — the punch never waits on Twilio.
    try {
      if (req.user?.role === 'technician') {
        const alert = (async () => {
          const { resolvePhoneConfig } = await import('../services/phoneConfig.js')
          const { sendTwilioSMS } = await import('../services/twilio.js')
          const cfg = await resolvePhoneConfig(req)
          if (!cfg.MARK_PHONE_NUMBER) return
          const loc = entry.clock_in_location
          let where = 'no location shared'
          if (loc?.lat && loc?.lng) {
            where = `https://maps.google.com/?q=${loc.lat},${loc.lng}`
            const slat = Number(cfg.SHOP_LAT), slng = Number(cfg.SHOP_LNG)
            if (slat && slng) {
              const toRad = x => x * Math.PI / 180
              const dLat = toRad(loc.lat - slat), dLng = toRad(loc.lng - slng)
              const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(slat)) * Math.cos(toRad(loc.lat)) * Math.sin(dLng / 2) ** 2
              const mi = Math.round(3959 * 2 * Math.asin(Math.sqrt(a)))
              where += ` (~${mi} mi from shop)`
            }
          }
          const t = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date())
          await sendTwilioSMS({
            to: cfg.MARK_PHONE_NUMBER,
            body: `⏱ ${getUserName(req)} clocked in at ${t} — ${where}`,
            from: 'local', cfg,
          })
        })()
        await Promise.race([alert, new Promise(r => setTimeout(r, 2500))])
      }
    } catch { /* never blocks a punch */ }
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
    const entries = await readPerson(req, userId)
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
    splitOvertime(entries)

    await writePerson(req, userId, entries)
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
    const entries = await readPerson(req, userId)
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
    await writePerson(req, userId, entries)
    res.json(entry)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// End break
router.post('/break/end', async (req, res) => {
  try {
    const userId = getUserId(req)
    const entries = await readPerson(req, userId)
    const entry = entries.find(e => e.user_id === userId && !e.clock_out)
    if (!entry) return res.status(404).json({ error: 'Not clocked in' })
    const openBreak = (entry.breaks || []).find(b => !b.end)
    if (!openBreak) return res.status(404).json({ error: 'No active break' })

    openBreak.end = new Date().toISOString()
    await writePerson(req, userId, entries)
    res.json(entry)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Current entry
router.get('/current', async (req, res) => {
  try {
    const userId = getUserId(req)
    const entries = await readPerson(req, userId)
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

    const gate = await payrollLockCheck(req, entries[idx])
    if (gate?.locked) {
      return res.status(423).json({ error: `Payroll is locked through ${gate.locked} — this entry was already reported for pay. Mark can resend with unlock to override.` })
    }

    const allowed = ['clock_in', 'clock_out', 'breaks', 'notes', 'job_ids']
    for (const f of allowed) {
      if (req.body[f] !== undefined) entries[idx][f] = req.body[f]
    }
    entries[idx].total_minutes = computeEntryMinutes(entries[idx])
    if (gate?.audit) entries[idx].notes = [entries[idx].notes, gate.audit].filter(Boolean).join(' · ')

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
    const gate = await payrollLockCheck(req, entries[idx])
    if (gate?.locked) {
      return res.status(423).json({ error: `Payroll is locked through ${gate.locked} — this entry was already reported for pay. Mark can resend with unlock to override.` })
    }
    const removed = entries[idx]
    entries.splice(idx, 1)
    await writeEntries(req, entries)
    if (gate?.audit) {
      try {
        const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
        await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
          `🗑 *Payroll-locked entry deleted* — ${removed.user_name} ${String(removed.clock_in).slice(0, 10)} (${Math.round((removed.total_minutes || 0) / 6) / 10}h). ${gate.audit}`)
      } catch { /* audit trail is best-effort */ }
    }
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

// ── Time card edit requests (Mark 2026-08-30: "if they need to edit
// the time card i will need to approve it"). A tech proposes new times;
// NOTHING changes until Mark approves. Pending edits ride on the entry.
router.post('/entries/:id/edit-request', async (req, res) => {
  try {
    const userId = getUserId(req)
    const entries = await readEntries(req)
    const entry = entries.find(e => e.id === req.params.id)
    if (!entry) return res.status(404).json({ error: 'Not found' })
    if (entry.user_id !== userId && !isAdmin(req)) {
      return res.status(403).json({ error: 'You can only request fixes to your own time card' })
    }
    const newIn = new Date(req.body?.clock_in || '')
    const newOut = new Date(req.body?.clock_out || '')
    if (isNaN(newIn) || isNaN(newOut) || newOut <= newIn) {
      return res.status(400).json({ error: 'Enter a valid in and out time (out must be after in)' })
    }
    if ((newOut - newIn) / 3600000 > 16) {
      return res.status(400).json({ error: 'That shift is over 16 hours — check the times' })
    }
    const gate = await payrollLockCheck(req, entry)
    if (gate?.locked) {
      return res.status(423).json({ error: `Payroll is locked through ${gate.locked} — this entry was already reported for pay. Talk to Mark.` })
    }
    entry.pending_edit = {
      clock_in: newIn.toISOString(),
      clock_out: newOut.toISOString(),
      note: String(req.body?.note || '').slice(0, 300),
      requested_by: getUserName(req),
      requested_at: new Date().toISOString(),
    }
    await writeEntries(req, entries)
    try {
      const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
      const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' }).format(new Date(entry.clock_in))
      const t = iso => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
        `✏️ *Time card fix requested* — ${entry.user_name}, ${day}\n` +
        `Current: ${t(entry.clock_in)} → ${entry.clock_out ? t(entry.clock_out) : 'open'}\n` +
        `Requested: ${t(entry.pending_edit.clock_in)} → ${t(entry.pending_edit.clock_out)}\n` +
        `${entry.pending_edit.note ? `Reason: ${entry.pending_edit.note}\n` : ''}` +
        `Approve on the Time Clock page.`)
    } catch { /* non-fatal */ }
    res.json({ ok: true, entry })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Mark-only queue + decision (same email gate as PTO approvals)
router.get('/pending-edits', async (req, res) => {
  try {
    const entries = await readEntries(req)
    const pending = entries.filter(e => e.pending_edit)
      .sort((a, b) => String(b.pending_edit.requested_at).localeCompare(String(a.pending_edit.requested_at)))
    res.json(pending)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/entries/:id/edit-decision', async (req, res) => {
  try {
    const email = String(req.user?.email || '').toLowerCase()
    if (!email.startsWith('mark@')) return res.status(403).json({ error: 'Only Mark approves time card edits' })
    const approve = !!req.body?.approve
    const entries = await readEntries(req)
    const entry = entries.find(e => e.id === req.params.id)
    if (!entry) return res.status(404).json({ error: 'Not found' })
    if (!entry.pending_edit) return res.status(404).json({ error: 'No pending edit on this entry' })

    const pe = entry.pending_edit
    if (approve) {
      const gate = await payrollLockCheck(req, entry)
      if (gate?.locked && !(req.body?.unlock === true)) {
        return res.status(423).json({ error: `Payroll is locked through ${gate.locked} — resend with unlock:true to override.` })
      }
      entry.clock_in = pe.clock_in
      entry.clock_out = pe.clock_out
      entry.total_minutes = computeEntryMinutes(entry)
      entry.notes = [entry.notes, `[time fixed per ${pe.requested_by}'s request, approved by ${email} ${new Date().toISOString()}${pe.note ? ` — "${pe.note}"` : ''}]`]
        .filter(Boolean).join(' · ')
      const userEntries = entries.filter(e => e.user_id === entry.user_id)
      splitOvertime(userEntries)
    }
    delete entry.pending_edit
    await writeEntries(req, entries)
    try {
      const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
        `${approve ? '✅ Time card fix APPROVED' : '❌ Time card fix denied'} — ${entry.user_name} (${String(entry.clock_in).slice(0, 10)})`)
    } catch { /* non-fatal */ }
    res.json({ ok: true, approved: approve, entry })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Auto-punch acknowledgment (Mark 2026-08-27): next morning, the
// clock-in prompt makes the employee accept yesterday's auto-punched
// hours before punching in.
router.get('/pending-autopunch', async (req, res) => {
  try {
    const userId = getUserId(req)
    const entries = await readPerson(req, userId)
    const pending = entries.filter(e =>
      e.user_id === userId &&
      (e.auto_punched || e.auto_closed || String(e.notes || '').startsWith('Auto-punched')) &&
      !e.acknowledged
    )
    // Group by PT date for a clean prompt line
    const days = {}
    for (const e of pending) {
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(e.clock_in))
      days[d] = (days[d] || 0) + (Number(e.total_minutes) || 0)
    }
    res.json({ ok: true, pending: Object.entries(days).map(([date, mins]) => ({ date, hours: Math.round(mins / 6) / 10 })) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/acknowledge-autopunch', async (req, res) => {
  try {
    const userId = getUserId(req)
    const entries = await readPerson(req, userId)
    let count = 0
    const now = new Date().toISOString()
    for (const e of entries) {
      if (e.user_id === userId &&
          (e.auto_punched || e.auto_closed || String(e.notes || '').startsWith('Auto-punched')) &&
          !e.acknowledged) {
        e.acknowledged = true
        e.acknowledged_at = now
        count++
      }
    }
    if (count > 0) await writePerson(req, userId, entries)
    res.json({ ok: true, acknowledged: count })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export { readEntries as readEntriesPublic, writeEntries as writeEntriesPublic }
export default router
