// Durable phone-config storage in the `phone_config` Datastore table
// (config_key varchar UNIQUE mandatory, config_value text mandatory —
// Mark's schema 2026-07-09). Datastore rows never expire, unlike
// Catalyst Cache's hard 48h TTL cap that caused the July 9 outage of
// Twilio credentials.
//
// services/phoneConfig.js layers this under its cache: cache is the
// fast path, Datastore is what survives eviction/expiry.

import catalyst from 'zcatalyst-sdk-node'

const TABLE = 'phone_config'

function app(req) {
  return catalyst.initialize(req, { type: 'advancedio' })
}

function esc(s) {
  return String(s).replace(/'/g, "''")
}

// All rows → { KEY: value }. Table holds ~10 rows so a full scan is cheap.
export async function readAllFromDatastore(req) {
  const rows = await app(req).zcql().executeZCQLQuery(
    `SELECT config_key, config_value FROM ${TABLE}`
  )
  const out = {}
  for (const row of rows || []) {
    const r = row[TABLE] || row
    if (r?.config_key) out[r.config_key] = r.config_value || ''
  }
  return out
}

async function findRowId(req, key) {
  const rows = await app(req).zcql().executeZCQLQuery(
    `SELECT ROWID FROM ${TABLE} WHERE config_key = '${esc(key)}' LIMIT 1`
  )
  const r = rows?.[0]?.[TABLE] || rows?.[0] || null
  return r?.ROWID ? String(r.ROWID) : null
}

// Upsert one key. Empty value = delete the row (config_value is a
// mandatory column, so we don't store blanks).
export async function setInDatastore(req, key, value) {
  const table = app(req).datastore().table(TABLE)
  const rowid = await findRowId(req, key)
  const val = String(value == null ? '' : value)
  if (!val) {
    if (rowid) await table.deleteRow(rowid)
    return
  }
  if (rowid) {
    await table.updateRow({ ROWID: rowid, config_key: String(key), config_value: val })
  } else {
    await table.insertRow({ config_key: String(key), config_value: val })
  }
}

export async function deleteFromDatastore(req, key) {
  const table = app(req).datastore().table(TABLE)
  const rowid = await findRowId(req, key)
  if (rowid) await table.deleteRow(rowid)
}
