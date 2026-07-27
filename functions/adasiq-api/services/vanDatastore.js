// Datastore-backed key/value store for ALL From the Van state.
//
// Replaces the Catalyst Cache pattern that had two fatal flaws:
//   1. Cache values expire after 48h max (silent state evaporation)
//   2. `segment.put()` without TTL silently fails on first-ever write
//
// Uses a single Datastore table `VanKV` with columns:
//   - key_name  varchar (unique, mandatory)   — the state key
//   - value_json text (mandatory)             — JSON blob (up to ~32KB)
//   - ROWID, CREATEDTIME, MODIFIEDTIME        — auto
//
// Keys currently in use:
//   van_flags                        — {nurture, weekly, weekly_asks}
//   van_case_notes_meta              — {chunks, count, updated_at}
//   van_case_notes_chunk_<N>         — array of case notes
//   van_enrollments_meta             — {chunks, count, updated_at}
//   van_enrollments_chunk_<N>        — array of subscriber records
//   van_pending_draft                — {id, subject, body_markdown, html, ...}
//   van_issue_state                  — {next_issue_number, next_ask_type_index}

import catalyst from 'zcatalyst-sdk-node'

const TABLE = 'VanKV'

function getApp(req) {
  return catalyst.initialize(req, { type: 'advancedio' })
}
function getTable(req) {
  return getApp(req).datastore().table(TABLE)
}

/**
 * Read a JSON value by key. Returns null if the key doesn't exist.
 * Parses value_json into an object/array — callers get native JS values.
 */
export async function getVal(req, key) {
  const app = getApp(req)
  const safe = String(key).replace(/'/g, "''")
  try {
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT ROWID, value_json FROM ${TABLE} WHERE key_name = '${safe}' LIMIT 1`
    )
    const row = rows?.[0]?.[TABLE] || rows?.[0] || null
    if (!row?.value_json) return null
    try { return JSON.parse(row.value_json) }
    catch (e) {
      console.warn(`[vanDatastore] value_json parse error for ${key}:`, e.message)
      return null
    }
  } catch (e) {
    console.warn(`[vanDatastore getVal ${key}]`, e.message)
    return null
  }
}

/**
 * Write a JSON value by key. Idempotent — inserts if key doesn't exist,
 * updates the row in place if it does. `value` is JSON.stringify'd; if
 * the result exceeds ~32KB (Catalyst Text column cap) the write is rejected
 * and we throw so callers can handle (typically means the caller needs to
 * chunk their data).
 */
export async function setVal(req, key, value) {
  const app = getApp(req)
  const table = getTable(req)
  const safe = String(key).replace(/'/g, "''")
  const json = typeof value === 'string' ? value : JSON.stringify(value)
  if (json.length > 30000) {
    // Cap slightly below the 32KB Text limit to leave headroom for the row
    throw new Error(`vanDatastore.setVal: value for '${key}' is ${json.length} bytes, over 30KB safe cap — chunk it`)
  }

  // Look up existing row by key
  let existingRowId = null
  try {
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE key_name = '${safe}' LIMIT 1`
    )
    const row = rows?.[0]?.[TABLE] || rows?.[0] || null
    if (row?.ROWID) existingRowId = String(row.ROWID)
  } catch (e) {
    console.warn(`[vanDatastore setVal ${key} lookup]`, e.message)
  }

  if (existingRowId) {
    await table.updateRow({ ROWID: existingRowId, key_name: String(key), value_json: json })
  } else {
    await table.insertRow({ key_name: String(key), value_json: json })
  }
  return { ok: true, key, bytes: json.length }
}

/**
 * Delete a key. Idempotent — a missing key is not an error.
 */
export async function deleteVal(req, key) {
  const app = getApp(req)
  const table = getTable(req)
  const safe = String(key).replace(/'/g, "''")
  try {
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE key_name = '${safe}' LIMIT 1`
    )
    const row = rows?.[0]?.[TABLE] || rows?.[0] || null
    if (!row?.ROWID) return { ok: true, absent: true }
    await table.deleteRow(String(row.ROWID))
    return { ok: true, deleted: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * List all keys matching a LIKE prefix (e.g. 'van_enrollments_chunk_').
 * Returns [{key_name, value_json}] with the raw string values — caller parses.
 */
export async function listByPrefix(req, prefix) {
  const app = getApp(req)
  const safe = String(prefix).replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_')
  try {
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT key_name, value_json FROM ${TABLE} WHERE key_name LIKE '${safe}%' LIMIT 2000`
    )
    return (rows || []).map(r => {
      const rec = r[TABLE] || r
      return { key_name: rec.key_name, value_json: rec.value_json }
    })
  } catch (e) {
    console.warn(`[vanDatastore listByPrefix ${prefix}]`, e.message)
    return []
  }
}

/**
 * List every key in the table — used for admin/debug endpoints.
 */
export async function listAllKeys(req) {
  const app = getApp(req)
  try {
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT key_name, MODIFIEDTIME FROM ${TABLE} ORDER BY MODIFIEDTIME DESC LIMIT 500`
    )
    return (rows || []).map(r => {
      const rec = r[TABLE] || r
      return { key: rec.key_name, modified: rec.MODIFIEDTIME }
    })
  } catch (e) {
    console.warn('[vanDatastore listAllKeys]', e.message)
    return []
  }
}

// ─── Chunked-array helpers (for case notes + enrollments) ───────────────────
// The Text column caps at ~32KB. Any collection likely to exceed that is
// stored as N chunk rows plus one meta row:
//   <base>_meta            → { chunks: N, count: M, updated_at }
//   <base>_chunk_<0..N-1>  → array of records
//
// Callers pick a chunk size that keeps each chunk well under 30KB.

/**
 * Read a chunked array — returns the flat list.
 * @param {string} baseKey e.g. 'van_enrollments'
 */
export async function readChunkedArray(req, baseKey) {
  const meta = await getVal(req, `${baseKey}_meta`)
  if (!meta || !Number.isInteger(meta.chunks)) return []
  const all = []
  for (let i = 0; i < meta.chunks; i++) {
    const chunk = await getVal(req, `${baseKey}_chunk_${i}`)
    if (Array.isArray(chunk)) all.push(...chunk)
  }
  return all
}

/**
 * Write a chunked array. Splits `list` into chunks of `chunkSize`, writes each
 * one, deletes any stale chunks left over from a shorter previous list, then
 * writes the meta row LAST so a mid-write reader sees a consistent state.
 */
export async function writeChunkedArray(req, baseKey, list, { chunkSize = 30 } = {}) {
  const trimmed = Array.isArray(list) ? list : []
  const chunks = Math.max(1, Math.ceil(trimmed.length / chunkSize))
  for (let i = 0; i < chunks; i++) {
    const chunk = trimmed.slice(i * chunkSize, (i + 1) * chunkSize)
    await setVal(req, `${baseKey}_chunk_${i}`, chunk)
  }
  // Clean up any stale chunks past the current end
  const staleKeys = await listByPrefix(req, `${baseKey}_chunk_`)
  for (const { key_name } of staleKeys) {
    const match = key_name.match(new RegExp(`^${baseKey.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}_chunk_(\\d+)$`))
    if (match && Number(match[1]) >= chunks) {
      await deleteVal(req, key_name)
    }
  }
  // Meta LAST so a mid-write reader sees the previous consistent state
  await setVal(req, `${baseKey}_meta`, {
    chunks, count: trimmed.length, updated_at: new Date().toISOString(),
  })
  return { chunks, count: trimmed.length }
}

export const VAN_KV_TABLE = TABLE
