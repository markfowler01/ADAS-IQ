// Datastore-backed phone config. Uses a dedicated `phone_config` table
// (columns: config_key varchar UNIQUE, config_value text) — Mark's
// schema 2026-07-09. Same pattern as datastoreCallLog / datastoreSms.
//
// This is the DURABLE source of truth. Cache (services/phoneConfig.js)
// is a fast read-through layer that auto-refreshes TTL on every read;
// Datastore is what makes the config survive cache eviction, a
// container restart, or anything else.

import catalyst from 'zcatalyst-sdk-node'

const TABLE = 'phone_config'

function getTable(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.datastore().table(TABLE)
}

async function findRowByKey(req, key) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const safe = String(key).replace(/'/g, "''")
  const q = `SELECT ROWID, config_key, config_value FROM ${TABLE} WHERE config_key = '${safe}' LIMIT 1`
  const rows = await app.zcql().executeZCQLQuery(q)
  const r = rows?.[0]?.[TABLE] || rows?.[0] || null
  return r?.ROWID ? { rowid: String(r.ROWID), key: r.config_key || '', value: r.config_value || '' } : null
}

// UPSERT by config_key.
export async function setConfigValue(req, key, value) {
  if (!key) throw new Error('setConfigValue: key required')
  const table = getTable(req)
  const existing = await findRowByKey(req, key)
  if (existing) {
    await table.updateRow({
      ROWID: existing.rowid,
      config_key: String(key),
      config_value: String(value == null ? '' : value),
    })
  } else {
    await table.insertRow({
      config_key: String(key),
      config_value: String(value == null ? '' : value),
    })
  }
}

export async function getConfigValue(req, key) {
  const r = await findRowByKey(req, key)
  return r?.value ?? null
}

// Bulk read of all phone-config keys in one Datastore round trip.
// Returns { KEY: value, ... } shaped like resolvePhoneConfig output so
// callers can drop it in without reshaping.
export async function readAllPhoneConfig(req, keys) {
  if (!Array.isArray(keys) || keys.length === 0) return {}
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const list = keys.map(k => `'${String(k).replace(/'/g, "''")}'`).join(',')
  const q = `SELECT config_key, config_value FROM ${TABLE} WHERE config_key IN (${list})`
  const rows = await app.zcql().executeZCQLQuery(q)
  const out = {}
  for (const row of rows || []) {
    const r = row[TABLE] || row
    if (r?.config_key) out[r.config_key] = r.config_value || ''
  }
  return out
}

// Bulk write. Same order-agnostic upsert per key.
export async function writeAllPhoneConfig(req, obj) {
  const entries = Object.entries(obj || {})
  for (const [k, v] of entries) {
    await setConfigValue(req, k, v)
  }
}

// Delete a single key (used when Mark clears a Phone Setup field).
export async function deleteConfigValue(req, key) {
  const existing = await findRowByKey(req, key)
  if (!existing) return
  const table = getTable(req)
  await table.deleteRow(existing.rowid)
}
