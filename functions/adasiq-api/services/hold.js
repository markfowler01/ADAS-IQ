// The Hold — relationship tracking, ported from the 5:30 planner.
//
// The model is Mark's, kept intact: contacts sit in a circle (inner, close,
// community, network), each circle carries a default touch cadence, and a
// contact goes overdue when the days since the last logged touch pass that
// cadence. Priority is `daysOverdue * circle weight`, so a week of silence in
// the inner circle outranks a month of silence in the network.
//
// STORAGE — the reason this move matters. In the planner the Hold lived in
// browser localStorage on his phone. iOS evicts a PWA's storage when it needs
// the space, with no warning and no recovery. Every contact, every logged
// touch, one eviction away from gone. So this is Datastore first, cache as a
// working buffer, vault as the long record — the same three layers the day
// ledger uses, and for the same reason.
import catalyst from 'zcatalyst-sdk-node'

const TABLE = 'hold_contacts'
const CACHE_KEY = 'hold_contacts'
const CACHE_TTL_HOURS = 48
const CACHE_MAX_BYTES = 20_000

export const CIRCLE_TIERS = [
  { key: 'inner',     label: 'Inner',     weight: 4, defaultGoal: 'weekly' },
  { key: 'close',     label: 'Close',     weight: 3, defaultGoal: 'biweekly' },
  { key: 'community', label: 'Community', weight: 2, defaultGoal: 'monthly' },
  { key: 'network',   label: 'Network',   weight: 1, defaultGoal: 'quarterly' },
]

export const TOUCH_FREQUENCIES = [
  { key: 'daily', days: 1 }, { key: 'weekly', days: 7 }, { key: 'biweekly', days: 14 },
  { key: 'monthly', days: 30 }, { key: 'quarterly', days: 90 },
]

function goalDays(goal) {
  if (!goal) return 7
  if (goal.customDays) return Number(goal.customDays)
  return TOUCH_FREQUENCIES.find(f => f.key === goal.type)?.days ?? 7
}

export function emptyContact(name = '') {
  return {
    id: 'hold_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, phone: '', email: '', birthday: '',
    circle: 'network',
    touchGoal: { type: 'quarterly', customDays: null },
    howWeMet: '', sharedInterests: '', notes: '', prayerRequests: '', giftIdeas: '',
    goals: [], rapport: 0, valueGiven: 0, valueReceived: 0, trajectory: 'steady',
    location: '', industry: '', howICanHelp: '', howTheyCanHelp: '',
    log: [], createdAt: new Date().toISOString(), archived: false,
  }
}

/**
 * Days since last touch, whether that is past the cadence, and the priority
 * score. `todayISO` is passed in rather than read from the clock so the brief
 * and the tests agree about what day it is.
 */
export function holdStatus(contact, todayISO) {
  const log = [...(contact.log || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const last = log[0]
  const today = new Date(todayISO + 'T12:00:00Z')

  // Never touched is not "999 days overdue" — it is unknown, and dressing it
  // up as a huge number would park every new contact at the top of the list
  // forever. It is flagged separately instead.
  const daysSince = last?.date
    ? Math.floor((today - new Date(String(last.date).slice(0, 10) + 'T12:00:00Z')) / 86400000)
    : null

  const target = goalDays(contact.touchGoal)
  const tier = CIRCLE_TIERS.find(c => c.key === contact.circle) || CIRCLE_TIERS[3]
  const isOverdue = daysSince != null && daysSince > target
  const daysOverdue = isOverdue ? daysSince - target : 0

  return {
    daysSince, target, isOverdue, daysOverdue,
    neverTouched: daysSince == null,
    weight: tier.weight,
    circle: tier.label,
    powerScore: daysOverdue * tier.weight,
    lastTouch: last || null,
  }
}

export function daysUntilBirthday(contact, todayISO) {
  if (!contact.birthday) return null
  const parts = String(contact.birthday).split('-').map(Number)
  const [m, d] = parts.length === 3 ? [parts[1], parts[2]] : [parts[0], parts[1]]
  if (!m || !d) return null
  const today = new Date(todayISO + 'T12:00:00Z')
  let b = new Date(Date.UTC(today.getUTCFullYear(), m - 1, d, 12))
  if (b < today) b = new Date(Date.UTC(today.getUTCFullYear() + 1, m - 1, d, 12))
  return Math.floor((b - today) / 86400000)
}

// ── storage ─────────────────────────────────────────────────────────────────

let dsAvailable = null

function seg(req) { return catalyst.initialize(req, { type: 'advancedio' }).cache().segment() }

const toRow = c => ({ hold_id: c.id, name: c.name || '', circle: c.circle || 'network', payload: JSON.stringify(c) })
function fromRow(r) {
  try { return JSON.parse(r.payload) } catch { return null }
}

async function dsList(req) {
  if (dsAvailable === false) return []
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const rows = await app.zcql().executeZCQLQuery(`SELECT * FROM ${TABLE} LIMIT 500`)
    dsAvailable = true
    return (rows || []).map(r => fromRow(r[TABLE] || r)).filter(Boolean)
  } catch (e) {
    if (/not\s*exist|invalid table|unknown table/i.test(e.message || '')) {
      if (dsAvailable !== false) console.warn(`[hold] Datastore table '${TABLE}' missing — cache only`)
      dsAvailable = false
    } else console.warn('[hold ds read]', e.message)
    return []
  }
}

async function readCache(req) {
  try {
    const v = await seg(req).getValue(CACHE_KEY)
    if (!v) return []
    const p = typeof v === 'string' ? JSON.parse(v) : v
    return Array.isArray(p) ? p : []
  } catch { return [] }
}

async function writeCache(req, list) {
  // Trim the longest logs before dropping contacts — a contact with no recent
  // history still belongs on the list.
  let out = list
  let payload = JSON.stringify(out)
  while (payload.length > CACHE_MAX_BYTES && out.length) {
    out = out.map(c => ({ ...c, log: (c.log || []).slice(-3) }))
    payload = JSON.stringify(out)
    if (payload.length > CACHE_MAX_BYTES) { out = out.slice(0, Math.max(1, out.length - 5)); payload = JSON.stringify(out) }
  }
  const s = seg(req)
  try { await s.update(CACHE_KEY, payload) } catch { await s.put(CACHE_KEY, payload, CACHE_TTL_HOURS) }
}

export async function listContacts(req, { includeArchived = false } = {}) {
  const [ds, cache] = await Promise.all([dsList(req), readCache(req)])
  const byId = new Map()
  for (const c of cache) if (c?.id) byId.set(c.id, c)
  for (const c of ds) if (c?.id) byId.set(c.id, { ...(byId.get(c.id) || {}), ...c })
  const all = [...byId.values()]
  return includeArchived ? all : all.filter(c => !c.archived)
}

export async function upsertContact(req, patch) {
  const all = await listContacts(req, { includeArchived: true })
  const i = all.findIndex(c => c.id === patch.id)
  const merged = i >= 0 ? { ...all[i], ...patch, log: patch.log || all[i].log || [] } : { ...emptyContact(), ...patch }
  if (i >= 0) all[i] = merged; else all.push(merged)

  if (dsAvailable !== false) {
    try {
      const app = catalyst.initialize(req, { type: 'advancedio' })
      const rows = await app.zcql().executeZCQLQuery(
        `SELECT ROWID FROM ${TABLE} WHERE hold_id = '${String(merged.id).replace(/'/g, "''")}' LIMIT 1`)
      const existing = rows?.[0]?.[TABLE]
      const table = app.datastore().table(TABLE)
      if (existing?.ROWID) await table.updateRow({ ROWID: String(existing.ROWID), ...toRow(merged) })
      else await table.insertRow(toRow(merged))
      dsAvailable = true
    } catch (e) {
      if (/not\s*exist|invalid table|unknown table/i.test(e.message || '')) dsAvailable = false
      else console.warn('[hold ds write]', e.message)
    }
  }
  await writeCache(req, all)
  return merged
}

/** Log a touch. This is the only write that happens in the normal week. */
export async function logTouch(req, id, { type = 'texted', note = '', date } = {}) {
  const all = await listContacts(req, { includeArchived: true })
  const c = all.find(x => x.id === id)
  if (!c) throw new Error(`no contact ${id}`)
  const entry = { date: (date || new Date().toISOString()).slice(0, 10), type, note }
  return upsertContact(req, { ...c, log: [...(c.log || []), entry] })
}

/**
 * Who to reach out to, worst first. Never-touched contacts ride at the end
 * rather than the top — they are a different problem from a lapsed friendship.
 */
export async function overdue(req, todayISO, limit = 5) {
  const all = await listContacts(req)
  const scored = all.map(c => ({ contact: c, st: holdStatus(c, todayISO) }))
  const late = scored.filter(x => x.st.isOverdue).sort((a, b) => b.st.powerScore - a.st.powerScore)
  const never = scored.filter(x => x.st.neverTouched)
  return { late: late.slice(0, limit), never: never.slice(0, 3), total: all.length }
}

export async function birthdays(req, todayISO, withinDays = 14) {
  const all = await listContacts(req)
  return all
    .map(c => ({ contact: c, days: daysUntilBirthday(c, todayISO) }))
    .filter(x => x.days != null && x.days <= withinDays)
    .sort((a, b) => a.days - b.days)
}

/** Import an export of the planner's localStorage `planner:holds`. */
export async function importFromPlanner(req, raw) {
  const list = Array.isArray(raw) ? raw : []
  let n = 0
  for (const c of list) {
    if (!c?.id && !c?.name) continue
    await upsertContact(req, { ...emptyContact(), ...c, id: c.id || undefined })
    n++
  }
  return { imported: n }
}
