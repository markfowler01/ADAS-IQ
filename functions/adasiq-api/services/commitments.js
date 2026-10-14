// Commitments that can actually be finished.
//
// Before this, commitments were extracted into Catalyst Cache with a
// `status: 'open'` field that NOTHING ever changed. The only way one left the
// list was to age out at 45 days or fall off the 60-item cap. Mark's words:
// "I have no way of checking them done so they're just stacking up."
//
// So: durable Datastore rows, an explicit done path, and a stable short number
// per item so he can act on one from a text without typing its text back.
import catalyst from 'zcatalyst-sdk-node'
import { createTodo, titleFor } from './todoPush.js'

const TABLE = 'OpsCommitments'
const CACHE_KEY = 'ops_commitments'      // legacy store — still read, for migration
let dsAvailable = null

function seg(req) { return catalyst.initialize(req, { type: 'advancedio' }).cache().segment() }
const q = s => String(s).replace(/'/g, "''")

// The extractor re-phrases the same promise every run. On 2026-09-30, 28 of
// Mark's 60 open commitments were restatements: "Prepare budget", "Prepare
// budget document", "Prepare budget documentation", "Prepare budget
// information", "Prepare monthly budget" — five rows, one task. A done button
// alone would just mean checking the same thing off five times.
const STOP = new Set(['the','a','an','to','and','for','of','on','in','is','it','with','by','me','my','get','that','this','will','have','has'])
const tokens = t => new Set(String(t).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w && !STOP.has(w)))

/** Kat and Kath are one person. Match on the shorter name being a prefix. */
export function canonPerson(name, known = []) {
  const n = String(name || '').trim()
  const low = n.toLowerCase()
  for (const k of known) {
    const kl = String(k).toLowerCase()
    if (kl === low) return k
    const [short, long] = kl.length < low.length ? [kl, low] : [low, kl]
    if (long.startsWith(short) && long.length - short.length <= 2) return short === kl ? k : n
  }
  return n
}

/** Same person, same job, different words. Jaccard on content words. */
export function isSameTask(a, b) {
  const A = tokens(a), B = tokens(b)
  if (!A.size || !B.size) return false
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / (A.size + B.size - inter) >= 0.5
}

export const commitKey = c =>
  `${c.person}|${c.text}`.toLowerCase().replace(/\s+/g, ' ').slice(0, 140)

function fromRow(r) {
  const row = r?.[TABLE] || r
  try {
    return { ...JSON.parse(row.payload || '{}'), key: row.commit_key, status: row.status || 'open', ROWID: row.ROWID }
  } catch { return null }
}

async function dsList(req, { includeDone = false } = {}) {
  if (dsAvailable === false) return null
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const where = includeDone ? '' : " WHERE status = 'open'"
    const rows = await app.zcql().executeZCQLQuery(`SELECT * FROM ${TABLE}${where} LIMIT 300`)
    dsAvailable = true
    return (rows || []).map(fromRow).filter(Boolean)
  } catch (e) {
    if (/not\s*exist|invalid table|unknown table/i.test(e.message || '')) {
      if (dsAvailable !== false) console.warn(`[commitments] table ${TABLE} missing — cache only`)
      dsAvailable = false
    } else console.warn('[commitments ds read]', e.message)
    return null
  }
}

/**
 * Merge freshly extracted commitments in. Existing rows keep their status, so
 * something Mark already marked done never comes back just because the same
 * sentence is still sitting in the Cliq history.
 */
export async function persist(req, fresh, today) {
  const existing = (await dsList(req, { includeDone: true })) || []
  const byKey = new Map(existing.map(i => [i.key, i]))
  const app = catalyst.initialize(req, { type: 'advancedio' })

  const openItems = [...byKey.values()].filter(i => i.status === 'open')
  const people = [...new Set(openItems.map(i => i.person).filter(Boolean))]

  for (const c of fresh) {
    const person = canonPerson(c.person, people)
    const key = commitKey({ ...c, person })
    // Exact key first, then a restatement of something already open.
    const prev = byKey.get(key) ||
      openItems.find(i => canonPerson(i.person, people) === person && isSameTask(i.text, c.text))
    if (prev) {
      // Only a changed due date is worth a write. Never resurrect a done item.
      if (c.due && c.due !== prev.due && prev.status === 'open') {
        await writeRow(app, { ...prev, due: c.due }, prev.status, prev.ROWID).catch(() => {})
        prev.due = c.due
      }
      continue
    }
    const item = {
      key, text: c.text, person: c.person, direction: c.direction || 'inbound',
      due: c.due || null, source: c.source || 'cliq', first_seen: today,
      num: nextNum([...byKey.values()]),   // permanent, never reused
    }
    // Hand it to Zoho ToDo. If that fails we keep the row as 'pending' and try
    // again next run rather than dropping a real commitment on the floor.
    let status = 'pending'
    try {
      const made = await createTodo(item)
      item.todo_id = made.id
      item.todo_title = made.title
      item.pushed_on = today
      status = 'pushed'
    } catch (e) {
      console.warn('[todo push]', e.message)
      item.push_error = String(e.message).slice(0, 180)
    }
    await writeRow(app, item, status, null).catch(e => console.warn('[commitments write]', e.message))
    byKey.set(key, { ...item, status })
  }

  // What the brief should mention: pushed to ToDo, not yet mentioned. Said
  // once, the next morning, then never again.
  return [...byKey.values()].filter(i => i.status === 'pushed')
}

async function writeRow(app, item, status, rowid) {
  const { ROWID, status: _s, ...payload } = item
  const row = { commit_key: item.key, payload: JSON.stringify(payload), status }
  const table = app.datastore().table(TABLE)
  if (rowid) await table.updateRow({ ROWID: String(rowid), ...row })
  else await table.insertRow(row)
}

/**
 * Order for display. The NUMBER is not positional — it is `num`, assigned once
 * when the row is created and never reused.
 *
 * This was a real bug, and it was mine. The number used to be the item's index
 * in the open list, which meant closing #4 renumbered everything after it, and
 * a new commitment could land mid-list and shift the rest. The morning email
 * would say "Done 12", Mark would tap it that afternoon, and 12 was now a
 * different commitment. He could close something he had not done, and never
 * know. An identifier that moves is not an identifier.
 */
export function numbered(items) {
  return [...items]
    .sort((a, b) => (a.num || 1e9) - (b.num || 1e9))
    .map(it => ({ ...it, n: it.num }))
}

function nextNum(all) {
  return all.reduce((m, i) => Math.max(m, Number(i.num) || 0), 0) + 1
}

export async function listOpen(req) {
  const ds = await dsList(req)
  if (ds) return numbered(ds)
  // Cache fallback so the brief still works if the table is missing.
  try {
    const raw = await seg(req).getValue(CACHE_KEY)
    const store = raw ? JSON.parse(raw) : { items: [] }
    return numbered((store.items || []).filter(i => i.status === 'open'))
  } catch { return [] }
}

/** Mark done by short number or by key. Returns what was closed. */
export async function complete(req, { n, key }) {
  const open = await listOpen(req)
  const target = key ? open.find(i => i.key === key) : open.find(i => Number(i.num) === Number(n))
  if (!target) return { ok: false, error: 'no open commitment matches', open: open.length }

  const app = catalyst.initialize(req, { type: 'advancedio' })
  const done = { ...target, done_at: new Date().toISOString() }
  try {
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE commit_key = '${q(target.key)}' LIMIT 1`)
    const rowid = rows?.[0]?.[TABLE]?.ROWID
    await writeRow(app, done, 'done', rowid)
  } catch (e) {
    return { ok: false, error: e.message }
  }
  return { ok: true, closed: { n: target.n, text: target.text, person: target.person }, remaining: open.length - 1 }
}

/**
 * Collapse restatements already in the table. Returns a plan when dry, and
 * only writes when dry is false — this is a bulk mutation on Mark's data, so
 * it never runs on its own.
 */
export async function dedupe(req, { dry = true } = {}) {
  const open = await listOpen(req)
  const people = [...new Set(open.map(i => i.person).filter(Boolean))]
  const keep = [], merge = []
  for (const it of open) {
    const person = canonPerson(it.person, people)
    const hit = keep.find(k => canonPerson(k.person, people) === person && isSameTask(k.text, it.text))
    if (hit) merge.push({ from: it, into: hit })
    else keep.push(it)
  }
  if (!dry) {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    for (const m of merge) {
      try {
        const rows = await app.zcql().executeZCQLQuery(
          `SELECT ROWID FROM ${TABLE} WHERE commit_key = '${q(m.from.key)}' LIMIT 1`)
        const rowid = rows?.[0]?.[TABLE]?.ROWID
        // 'merged', not 'done' — he never did it, it was never a separate task.
        await writeRow(app, { ...m.from, merged_into: m.into.key }, 'merged', rowid)
      } catch (e) { console.warn('[dedupe]', e.message) }
    }
  }
  return { dry, before: open.length, after: keep.length, merged: merge.length,
           examples: merge.slice(0, 10).map(m => ({ person: m.from.person, dropped: m.from.text, kept: m.into.text })) }
}

/** Pushed yesterday or earlier and never mentioned. These get one line. */
export async function pendingMention(req, today) {
  const all = (await dsList(req, { includeDone: true })) || []
  return all.filter(i => i.status === 'pushed' && i.pushed_on && i.pushed_on < today)
}

/** Said it once. Never bring it up again. */
export async function markMentioned(req, items) {
  if (!items?.length) return 0
  const app = catalyst.initialize(req, { type: 'advancedio' })
  let n = 0
  for (const it of items) {
    try { await writeRow(app, { ...it, mentioned_on: today0() }, 'mentioned', it.ROWID); n++ }
    catch (e) { console.warn('[markMentioned]', e.message) }
  }
  return n
}
const today0 = () => new Date().toISOString().slice(0, 10)

/**
 * Give every existing row a permanent num. Ordered by first_seen then key so
 * the numbers land close to what the last brief showed, then they stop moving
 * forever.
 */
export async function assignNums(req) {
  const all = (await dsList(req, { includeDone: true })) || []
  const missing = all.filter(i => !i.num)
  if (!missing.length) return { assigned: 0, total: all.length }
  const app = catalyst.initialize(req, { type: 'advancedio' })
  let n = all.reduce((m, i) => Math.max(m, Number(i.num) || 0), 0)
  const ordered = missing.sort((a, b) =>
    String(a.first_seen || '').localeCompare(String(b.first_seen || '')) || String(a.key).localeCompare(String(b.key)))
  for (const it of ordered) {
    n += 1
    await writeRow(app, { ...it, num: n }, it.status || 'open', it.ROWID).catch(e => console.warn('[assignNums]', e.message))
  }
  return { assigned: ordered.length, total: all.length }
}

/** One-time lift of whatever is still in the old Cache store. */
export async function migrateFromCache(req, today) {
  let items = []
  try {
    const raw = await seg(req).getValue(CACHE_KEY)
    items = raw ? (JSON.parse(raw).items || []) : []
  } catch { return { migrated: 0 } }
  const open = items.filter(i => i.status === 'open')
  if (!open.length) return { migrated: 0 }
  await persist(req, open.map(i => ({ ...i, due: i.due })), today)
  return { migrated: open.length }
}
