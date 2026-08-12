// Item Map — the deterministic Kinetic-sensor-name → Zoho Books item
// mapping (Mark 2026-08-11: "most calibrations are getting removed on
// the swap"). Replaces fuzzy guessing with a lookup Mark owns and edits
// in the app (More → Item Mapping).
//
// Storage: AppConfig KV rows `item_map:<normalized kinetic name>` →
//   { item_name, item_id, source: 'seed'|'manual', updated_at }
// (same durable pattern as card notes / sched meta). A Catalyst Cache
// copy keeps the invoice hot path fast; writes invalidate it.
//
// Matching precedence inside the invoice builders:
//   1. Item Map lookup (this file) — deterministic
//   2. exact / alias / fuzzy matching (legacy, still there as fallback)

import catalyst from 'zcatalyst-sdk-node'

const TABLE = 'AppConfig'
const PREFIX = 'item_map:'
const CACHE_KEY = 'aa_item_map'

export function normalizeMapKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function mapRowKey(kineticName) {
  return (PREFIX + normalizeMapKey(kineticName)).slice(0, 64)
}

function segment(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.cache().segment()
}

async function invalidateCache(req) {
  try { await segment(req).update(CACHE_KEY, '') } catch { /* rebuilt on next read */ }
}

// Exact-key read — full-table LIMIT/OFFSET scans of AppConfig proved
// unreliable (seeded rows invisible on read-back, 2026-08-11), so the map
// keeps its own index row listing every kinetic key and reads each row
// with WHERE config_key = '...'. Deterministic regardless of table size.
const INDEX_KEY = 'item_map_index'

async function readRow(req, key) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT config_value FROM ${TABLE} WHERE config_key = '${key.replace(/'/g, "''")}' LIMIT 1`
  )
  const r = rows?.[0]?.[TABLE] || rows?.[0] || null
  return r?.config_value || null
}

async function readIndex(req) {
  try {
    const val = await readRow(req, INDEX_KEY)
    const arr = val ? JSON.parse(val) : []
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

async function writeIndex(req, keys) {
  await upsertRow(req, INDEX_KEY, JSON.stringify([...new Set(keys)].sort()))
}

async function upsertRow(req, key, value) {
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

async function scanMap(req) {
  // Index-driven read; self-heals by probing the vocab keys if the index
  // is empty (covers rows seeded before the index existed).
  let keys = await readIndex(req)
  if (keys.length === 0) {
    const probes = KINETIC_SENSOR_VOCAB.map(normalizeMapKey)
    const found = []
    for (const k of probes) {
      try { if (await readRow(req, PREFIX + k)) found.push(k) } catch { /* skip */ }
    }
    if (found.length > 0) {
      keys = found
      try { await writeIndex(req, keys) } catch (e) { console.warn('[item-map] index rebuild:', e.message) }
    }
  }
  const out = {}
  for (const k of keys) {
    try {
      const val = await readRow(req, PREFIX + k)
      if (val) out[k] = JSON.parse(val)
    } catch { /* skip */ }
  }
  return out
}

// Read the whole map — cache first, Datastore scan on miss.
export async function readItemMap(req) {
  try {
    const val = await segment(req).getValue(CACHE_KEY)
    if (val) {
      const parsed = typeof val === 'string' ? JSON.parse(val) : val
      if (parsed && typeof parsed === 'object') return parsed
    }
  } catch { /* fall through */ }
  const map = await scanMap(req)
  try {
    const val = JSON.stringify(map)
    try { await segment(req).update(CACHE_KEY, val) }
    catch { await segment(req).put(CACHE_KEY, val, 48) }
  } catch (e) { console.warn('[item-map] cache write:', e.message) }
  return map
}

export async function upsertMapping(req, kineticName, { item_name, item_id, source = 'manual' }) {
  const key = mapRowKey(kineticName)
  const value = JSON.stringify({
    kinetic_name: String(kineticName).trim(),
    item_name: String(item_name || '').trim(),
    item_id: String(item_id || ''),
    source,
    updated_at: new Date().toISOString(),
  })
  await upsertRow(req, key, value)
  const idx = await readIndex(req)
  const norm = normalizeMapKey(kineticName)
  if (!idx.includes(norm)) await writeIndex(req, [...idx, norm])
  await invalidateCache(req)
}

export async function deleteMapping(req, kineticName) {
  const key = mapRowKey(kineticName)
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID FROM ${TABLE} WHERE config_key = '${key.replace(/'/g, "''")}' LIMIT 1`
  )
  const existing = rows?.[0]?.[TABLE] || rows?.[0] || null
  if (existing?.ROWID) {
    await app.datastore().table(TABLE).deleteRow(String(existing.ROWID))
    const idx = await readIndex(req)
    await writeIndex(req, idx.filter(k => k !== normalizeMapKey(kineticName)))
    await invalidateCache(req)
    return true
  }
  return false
}

// Lookup helper for the invoice builders: returns the mapping entry or null.
export function lookupMapping(itemMap, calName) {
  if (!itemMap) return null
  return itemMap[normalizeMapKey(calName)] || null
}

// The standard Kinetic sensor vocabulary — what their ID reports call
// things. Used to seed the map (Claude proposes the Books item for each).
export const KINETIC_SENSOR_VOCAB = [
  'Front Radar',
  'Front Windshield Camera',
  'Front Camera',
  'Around View Camera',
  'Surround View Camera',
  'Rear Camera',
  'Backup Camera',
  'Rear Blind Spot Radar',
  'Blind Spot Radar',
  'Side Radar',
  'Rear Cross Traffic Radar',
  'Park Distance Sensor',
  'Parking Sensors',
  'Steering Angle Sensor',
  'Seat Weight Sensor',
  'Occupant Classification System',
  'Night Vision Camera',
  'Adaptive Headlamps',
  'Headlamp Leveling',
  'Rain Light Sensor',
  'Lane Departure Camera',
  'Calibration Identification Report',
  'Post Collision Safety Inspection 1 (L-M)',
  'Post-Scan (L-M)',
]
