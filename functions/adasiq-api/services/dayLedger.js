// Day ledger — one structured record per day. This is the substrate the
// coaching layer learns from: what Mark planned (morning), what actually
// happened (evening check-in), and how the day felt.
//
// STORAGE, and why it's layered (learned the hard way 2026-07-15, when the
// 48h Cache TTL silently ate the entire SMS history — "all of my
// conversations are gone"):
//   1. Datastore `day_ledger`  — durable, no TTL. Source of truth IF the
//      table exists. Falls back silently when it doesn't, so this ships
//      before Mark creates it in the console.
//   2. Catalyst Cache          — working buffer, re-put on every write so
//      the 48h TTL keeps rolling forward. Survives a missing table.
//   3. The vault               — the real long-term record. vault_bridge.py
//      pulls /api/ledger/export daily into Second Brain, which is git-backed
//      and syncs to Mark's phone. The weekly review reads from there.
//
// A record is built up across the day: the morning brief writes big3 +
// hard_thing, the evening check-in fills in rating/energy/win/drag/f3.
// Both go through upsertDay(), which merges rather than overwrites so a
// late-arriving morning run can't blank an evening answer.

import catalyst from 'zcatalyst-sdk-node'

const TABLE = 'day_ledger'
const CACHE_KEY = 'day_ledger'
const CACHE_TTL_HOURS = 48        // Catalyst hard max — see reference notes
const CACHE_MAX_DAYS = 45         // ~20KB ceiling; Datastore/vault hold the rest
const CACHE_MAX_BYTES = 20_000

const iso = () => new Date().toISOString()

function getSegment(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.cache().segment()
}

// ── shape ───────────────────────────────────────────────────────────────────

export function emptyDay(date) {
  return {
    date,
    big3: [],            // [{ text, source, done }]
    hard_thing: null,    // { text, done }
    rating: null,        // 1-10, Mark's own call on the day
    energy: {},          // { morning, midday, evening } 1-5
    win: '',             // what made it good
    drag: '',            // what got in the way
    f3: {},              // { faith, family, fitness, finances } booleans
    plan_note: '',       // the coach's one-line 'why these three'
    raw_reply: '',       // the unparsed SMS, kept so parsing can improve later
    planned_at: '',
    checkin_at: '',
  }
}

// Merge that never destroys: a later write only fills or replaces fields it
// actually carries. Big 3 merges by text so the evening "hit 1 and 3" can mark
// done without resending the items.
function mergeDay(prev, next) {
  const out = { ...prev, ...stripEmpty(next) }
  if (next.big3?.length) {
    const byText = new Map(prev.big3?.map(b => [b.text.toLowerCase(), b]) || [])
    out.big3 = next.big3.map(b => ({ ...(byText.get(b.text.toLowerCase()) || {}), ...b }))
  } else {
    out.big3 = prev.big3 || []
  }
  out.energy = { ...(prev.energy || {}), ...(next.energy || {}) }
  out.f3 = { ...(prev.f3 || {}), ...(next.f3 || {}) }
  if (next.hard_thing) out.hard_thing = { ...(prev.hard_thing || {}), ...next.hard_thing }
  return out
}

// Drop undefined/null/'' so a partial write can't blank an existing answer.
function stripEmpty(o) {
  const out = {}
  for (const [k, v] of Object.entries(o || {})) {
    if (v === undefined || v === null || v === '') continue
    out[k] = v
  }
  return out
}

// ── cache layer ─────────────────────────────────────────────────────────────

async function readCache(req) {
  try {
    const val = await getSegment(req).getValue(CACHE_KEY)
    if (!val) return []
    const parsed = typeof val === 'string' ? JSON.parse(val) : val
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.warn('[ledger cache read]', e.message)
    return []
  }
}

async function writeCache(req, days) {
  let recs = [...days].sort((a, b) => String(a.date).localeCompare(b.date))
  if (recs.length > CACHE_MAX_DAYS) recs = recs.slice(-CACHE_MAX_DAYS)
  while (recs.length > 1 && JSON.stringify(recs).length > CACHE_MAX_BYTES) recs = recs.slice(1)
  const val = JSON.stringify(recs)
  const seg = getSegment(req)
  // update() fails on a key that doesn't exist yet; put() needs the TTL.
  try { await seg.update(CACHE_KEY, val) }
  catch { await seg.put(CACHE_KEY, val, CACHE_TTL_HOURS) }
  return recs
}

// ── datastore layer (best-effort — table may not exist yet) ─────────────────

function toRow(d) {
  return {
    day_date:   String(d.date || ''),
    big3:       JSON.stringify(d.big3 || []),
    hard_thing: JSON.stringify(d.hard_thing || null),
    rating:     String(d.rating ?? ''),
    energy:     JSON.stringify(d.energy || {}),
    win:        String(d.win || ''),
    drag:       String(d.drag || ''),
    f3:         JSON.stringify(d.f3 || {}),
    plan_note:  String(d.plan_note || ''),
    raw_reply:  String(d.raw_reply || '').slice(0, 2000),
    planned_at: String(d.planned_at || ''),
    checkin_at: String(d.checkin_at || ''),
  }
}

function fromRow(row) {
  const r = row[TABLE] || row
  const j = (s, fb) => { try { return JSON.parse(s) ?? fb } catch { return fb } }
  return {
    date:       r.day_date || '',
    big3:       j(r.big3, []),
    hard_thing: j(r.hard_thing, null),
    rating:     r.rating === '' || r.rating == null ? null : Number(r.rating),
    energy:     j(r.energy, {}),
    win:        r.win || '',
    drag:       r.drag || '',
    f3:         j(r.f3, {}),
    plan_note:  r.plan_note || '',
    raw_reply:  r.raw_reply || '',
    planned_at: r.planned_at || '',
    checkin_at: r.checkin_at || '',
  }
}

let dsAvailable = null   // null = untested, false = table missing (stop trying)

async function dsUpsert(req, day) {
  if (dsAvailable === false) return false
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const safe = String(day.date).replace(/'/g, "''")
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE day_date = '${safe}' LIMIT 1`
    )
    const existing = rows?.[0]?.[TABLE] || rows?.[0] || null
    const table = app.datastore().table(TABLE)
    if (existing?.ROWID) await table.updateRow({ ROWID: String(existing.ROWID), ...toRow(day) })
    else await table.insertRow(toRow(day))
    dsAvailable = true
    return true
  } catch (e) {
    // Table not created yet is the expected case on first deploy — log once,
    // then stop hammering ZCQL on every write.
    if (/not\s*exist|invalid table|unknown table/i.test(e.message || '')) {
      if (dsAvailable !== false) console.warn(`[ledger] Datastore table '${TABLE}' missing — cache+vault only`)
      dsAvailable = false
    } else {
      console.warn('[ledger ds write]', e.message)
    }
    return false
  }
}

async function dsList(req, limit = 120) {
  if (dsAvailable === false) return []
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT * FROM ${TABLE} ORDER BY day_date DESC LIMIT ${Math.min(Math.max(1, limit), 250)}`
    )
    dsAvailable = true
    return (rows || []).map(fromRow)
  } catch (e) {
    if (/not\s*exist|invalid table|unknown table/i.test(e.message || '')) dsAvailable = false
    else console.warn('[ledger ds read]', e.message)
    return []
  }
}

// ── public API ──────────────────────────────────────────────────────────────

// Merged view, newest last. Datastore wins on date clash (it's durable);
// the cache fills in anything written since the last successful table write.
export async function listDays(req, { limit = 120 } = {}) {
  const [ds, cache] = await Promise.all([dsList(req, limit), readCache(req)])
  const byDate = new Map()
  for (const d of cache) byDate.set(d.date, d)
  for (const d of ds) byDate.set(d.date, { ...(byDate.get(d.date) || {}), ...d })
  return [...byDate.values()]
    .sort((a, b) => String(a.date).localeCompare(b.date))
    .slice(-limit)
}

export async function getDay(req, date) {
  const all = await listDays(req, { limit: 120 })
  return all.find(d => d.date === date) || null
}

// The single write path. Merges into whatever exists for that date.
export async function upsertDay(req, date, patch) {
  const prev = (await getDay(req, date)) || emptyDay(date)
  const merged = mergeDay(prev, { ...patch, date })
  await dsUpsert(req, merged)
  const cache = await readCache(req)
  const others = cache.filter(d => d.date !== date)
  await writeCache(req, [...others, merged])
  return merged
}

// Morning: record what Mark committed to.
export async function recordPlan(req, date, { big3, hardThing }) {
  return upsertDay(req, date, {
    big3: (big3 || []).map(b => ({
      text: typeof b === 'string' ? b : b.text,
      source: typeof b === 'string' ? '' : (b.source || ''),
      done: false,
    })),
    hard_thing: hardThing ? { text: hardThing, done: false } : null,
    planned_at: iso(),
  })
}

// Evening: record what actually happened.
export async function recordCheckin(req, date, parsed) {
  const prev = (await getDay(req, date)) || emptyDay(date)
  const big3 = (prev.big3 || []).map((b, i) => ({
    ...b,
    done: Array.isArray(parsed.big3_done) ? !!parsed.big3_done[i] : b.done,
  }))
  return upsertDay(req, date, {
    big3,
    hard_thing: prev.hard_thing ? { ...prev.hard_thing, done: !!parsed.hard_thing_done } : null,
    rating: parsed.rating ?? null,
    energy: parsed.energy || {},
    win: parsed.win || '',
    drag: parsed.drag || '',
    f3: parsed.f3 || {},
    raw_reply: parsed.raw_reply || '',
    checkin_at: iso(),
  })
}

// Remove a day entirely. Needed for test rows and misparsed check-ins — a
// wrong day is worse than a missing one, because the coach reasons from it.
export async function deleteDay(req, date) {
  let ds = false
  if (dsAvailable !== false) {
    try {
      const app = catalyst.initialize(req, { type: 'advancedio' })
      const safe = String(date).replace(/'/g, "''")
      const rows = await app.zcql().executeZCQLQuery(
        `SELECT ROWID FROM ${TABLE} WHERE day_date = '${safe}' LIMIT 1`)
      const existing = rows?.[0]?.[TABLE] || rows?.[0] || null
      if (existing?.ROWID) { await app.datastore().table(TABLE).deleteRow(existing.ROWID); ds = true }
    } catch (e) { console.warn('[ledger ds delete]', e.message) }
  }
  const cache = await readCache(req)
  const kept = cache.filter(d => d.date !== date)
  await writeCache(req, kept)
  return { deleted: date, datastore: ds, remaining: kept.length }
}

// Rollups the coach uses — kept here so the brief, the review, and any
// future dashboard all compute "a good day" the same way.
export function summarize(days) {
  const rated = days.filter(d => typeof d.rating === 'number')
  const hitRate = d => {
    const b = d.big3 || []
    return b.length ? b.filter(x => x.done).length / b.length : null
  }
  const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  return {
    days: days.length,
    rated: rated.length,
    avgRating: avg(rated.map(d => d.rating)),
    goodDays: rated.filter(d => d.rating >= 8).map(d => d.date),
    roughDays: rated.filter(d => d.rating <= 5).map(d => d.date),
    avgBig3HitRate: avg(days.map(hitRate).filter(x => x !== null)),
    hardThingHitRate: avg(
      days.filter(d => d.hard_thing).map(d => (d.hard_thing.done ? 1 : 0))
    ),
    f3Counts: ['faith', 'family', 'fitness', 'finances'].reduce((acc, k) => {
      acc[k] = days.filter(d => d.f3?.[k]).length
      return acc
    }, {}),
    missedCheckins: days.filter(d => !d.checkin_at).map(d => d.date),
  }
}

export const LEDGER_TABLE_NAME = TABLE
