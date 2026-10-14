// Learned scrub lessons (Mark 2026-10-09): after every correction the next
// car of that make gets the same call. Stored in AppConfig — durable, not
// Cache (48h TTL). Require-lessons apply immediately. Drop-lessons need
// two confirms and never override a guard flip.
import catalyst from 'zcatalyst-sdk-node'

const KEY = 'scrub_lessons'
const MAX = 300

const CANON = [
  [/windshield|front camera|lane depart|forward camera|lkas|ldw|eyesight|honda sensing/i, 'Front Windshield Camera'],
  [/front side radar|front corner|front cross/i, 'Front Side Radar'],
  [/front radar|acc radar|distronic|pre.?collision radar|forward radar/i, 'Front Radar'],
  [/blind ?spot|rear cross|rear corner|bsm|blis|rcta/i, 'Rear Blind Spot Radar'],
  [/around view|surround|360|bird/i, 'Around View Camera'],
  [/back ?up|rear view camera|rear camera|reverse camera/i, 'Back Up Camera'],
  [/park distance|ultrasonic|pdc|parktronic/i, 'Park Distance Sensor'],
  [/steering angle|sas\b/i, 'Steering Angle Sensor'],
  [/seat weight|occupant|ocs|passenger seat/i, 'Seat Weight Sensor'],
  [/side camera|lanewatch|lane change/i, 'Side Camera'],
  [/headlamp|headlight/i, 'Headlamp Aim'],
]

export function canonSensor(n) {
  const t = String(n || '')
  for (const [re, name] of CANON) if (re.test(t)) return name
  return String(n || '').trim()
}

function makeKey(m) { return String(m || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function makeHit(lessonMake, carMake) {
  const a = makeKey(lessonMake), b = makeKey(carMake)
  if (!a || !b) return false
  return a === b || a.includes(b.split(' ')[0]) || b.includes(a.split(' ')[0])
}
function trigHit(lessonTrig, repair) {
  const t = String(lessonTrig || '').toLowerCase()
  const r = String(repair || '').toLowerCase()
  if (!t) return true
  const words = t.split(/[^a-z0-9]+/).filter(w => w.length > 3)
  if (!words.length) return true
  return words.filter(w => r.includes(w)).length >= Math.min(2, words.length)
}

async function cfgRead(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const rows = await app.zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${KEY}' LIMIT 1`)
  const r = rows?.[0]?.AppConfig || rows?.[0] || null
  if (!r?.config_value) return { rowid: r?.ROWID ? String(r.ROWID) : '', lessons: [] }
  try { return { rowid: String(r.ROWID || ''), lessons: JSON.parse(r.config_value).lessons || [] } }
  catch { return { rowid: String(r.ROWID || ''), lessons: [] } }
}
async function cfgWrite(req, lessons, rowid) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const table = app.datastore().table('AppConfig')
  const value = JSON.stringify({ lessons: lessons.slice(-MAX) })
  if (rowid) await table.updateRow({ ROWID: String(rowid), config_key: KEY, config_value: value })
  else await table.insertRow({ config_key: KEY, config_value: value })
}

export async function listLessons(req) {
  const { lessons } = await cfgRead(req)
  return lessons
}

/** Record one correction. Same make+sensor+action stacks (n++). */
export async function recordLesson(req, raw) {
  const sensor = canonSensor(raw.sensor)
  const action = raw.action === 'drop' ? 'drop' : 'require'
  if (!sensor) return { ok: false, error: 'sensor required' }
  const { lessons, rowid } = await cfgRead(req)
  const make = String(raw.make || '').trim()
  const i = lessons.findIndex(l => l.action === action && canonSensor(l.sensor) === sensor && makeKey(l.make) === makeKey(make))
  const now = new Date().toISOString()
  if (i >= 0) {
    const prev = lessons[i]
    lessons[i] = {
      ...prev, n: (prev.n || 1) + 1, at: now, by: raw.by || prev.by,
      trigger: raw.trigger || prev.trigger, lines: raw.lines || prev.lines,
      note: raw.note || prev.note, vin: raw.vin || prev.vin, scrub_id: raw.scrub_id || prev.scrub_id,
      active: action === 'require' || (prev.n || 1) + 1 >= 2,
    }
  } else {
    lessons.push({
      id: `L${Date.now().toString(36)}`, at: now, by: raw.by || 'staff',
      scrub_id: String(raw.scrub_id || ''), vin: String(raw.vin || ''),
      make, year: String(raw.year || ''), sensor, action,
      trigger: String(raw.trigger || '').slice(0, 240),
      lines: String(raw.lines || '').slice(0, 80),
      note: String(raw.note || '').slice(0, 240),
      n: 1, active: action === 'require',
    })
  }
  await cfgWrite(req, lessons, rowid)
  const lesson = lessons[i >= 0 ? i : lessons.length - 1]
  console.log(`[scrub-learn] ${lesson.action} ${lesson.sensor} · ${lesson.make || 'any'} · n=${lesson.n} active=${!!lesson.active}`)
  return { ok: true, lesson }
}

/** Diff two calibration lists (edit save) → one lesson per flipped sensor. */
export async function recordEditDiff(req, before, after, meta = {}) {
  const prev = new Map((before || []).map(c => [canonSensor(c.calibration_name || c.sensor || c.name), !!c.enabled || !!c.required]))
  const next = Array.isArray(after) ? after : []
  const out = []
  for (const c of next) {
    const sensor = canonSensor(c.calibration_name || c.sensor || c.name)
    const was = prev.has(sensor) ? prev.get(sensor) : null
    const now = c.enabled !== false && c.required !== false
    if (was === now) continue
    if (was === null && now) {
      const r = await recordLesson(req, { ...meta, sensor, action: 'require', trigger: c.trigger, lines: c.line_references || c.lines })
      if (r.lesson) out.push(r.lesson)
      continue
    }
    if (was === true && !now) {
      const r = await recordLesson(req, { ...meta, sensor, action: 'drop', trigger: c.trigger, lines: c.line_references || c.lines })
      if (r.lesson) out.push(r.lesson)
    }
    if (was === false && now) {
      const r = await recordLesson(req, { ...meta, sensor, action: 'require', trigger: c.trigger, lines: c.line_references || c.lines })
      if (r.lesson) out.push(r.lesson)
    }
  }
  return out
}

/**
 * Apply active lessons to a finished scrub (after the guard). Mutates
 * data.calibrations. Require can add a missing row — that is the point of
 * a "we missed it" lesson. Drop never touches `_guard`.
 */
export async function applyLessons(req, data) {
  const { lessons } = await cfgRead(req)
  const active = (lessons || []).filter(l => l.active)
  if (!active.length || !data?.calibrations) return { applied: [] }
  const make = data.make || data.vehicle || ''
  const repair = [
    data._repairText || '',
    ...(data.calibrations || []).map(c => `${c.trigger || ''} ${c.line_references || ''}`),
  ].join(' ')
  const applied = []
  for (const l of active) {
    if (l.make && !makeHit(l.make, make)) continue
    if (!trigHit(l.trigger, repair) && l.trigger) continue
    const re = new RegExp(l.sensor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '.+'), 'i')
    const row = data.calibrations.find(c => re.test(String(c.calibration_name || c.sensor || '')))
    if (l.action === 'require') {
      if (row) {
        if (row.enabled === true) continue
        row.enabled = true
        row._learned = 'flipped'
        if (l.trigger && !row.trigger) row.trigger = l.trigger
        row.justification = `${row.justification || ''} Learned: we missed this on ${l.make || 'this make'} (${l.n || 1}×).`.trim()
        applied.push(`require ${l.sensor}`)
      } else {
        data.calibrations.push({
          calibration_name: l.sensor, cal_type: '', trigger: l.trigger || 'learned from a prior correction',
          line_references: l.lines || '', enabled: true, _learned: 'added',
          justification: `Learned: required on ${l.make || 'this make'} (${l.n || 1}×). ${l.note || ''}`.trim(),
        })
        applied.push(`add ${l.sensor}`)
      }
    } else if (l.action === 'drop' && row && !row._guard && row.enabled === true) {
      row.enabled = false
      row._learned = 'dropped'
      row.justification = `${row.justification || ''} Learned: extra on ${l.make || 'this make'} (${l.n || 1}×).`.trim()
      applied.push(`drop ${l.sensor}`)
    }
  }
  if (applied.length) console.log(`[scrub-learn] applied ${applied.join(', ')} · ${make}`)
  data._learned = applied
  return { applied }
}
