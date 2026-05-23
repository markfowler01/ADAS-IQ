// Pinned shops: durable Catalyst Datastore storage for manually-set shop
// locations (Mark's main client list). Replaces the cache-based manual pins
// in absolute_adas_geocache so a cache flush can't lose hand-entered data.
//
// Table: PinnedShops
//   shop_name      VARCHAR(255)  display name
//   shop_name_key  VARCHAR(255)  normalized lowercase (lookup key)
//   address        TEXT          full street address
//   lat            VARCHAR(50)   stored as string, parsed at read time
//   lng            VARCHAR(50)
//   geocoded_at    VARCHAR(50)   ISO timestamp
//   created_at     VARCHAR(50)   ISO timestamp

import catalyst from 'zcatalyst-sdk-node'
import { normalizeKey } from './geocoding.js'

const TABLE_NAME = 'PinnedShops'

function getTable(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.datastore().table(TABLE_NAME)
}

function rowToPin(row) {
  const r = row.PinnedShops || row
  const lat = r.lat != null ? parseFloat(r.lat) : null
  const lng = r.lng != null ? parseFloat(r.lng) : null
  return {
    id: String(r.ROWID || ''),
    shop_name: r.shop_name || '',
    shop_name_key: r.shop_name_key || normalizeKey(r.shop_name || ''),
    address: r.address || '',
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    geocoded_at: r.geocoded_at || '',
    created_at: r.created_at || '',
  }
}

export async function listPinnedShops(req) {
  try {
    const table = getTable(req)
    const rows = await table.getAllRows()
    return (rows || []).map(rowToPin)
  } catch (e) {
    console.warn('[pinnedShops] list failed:', e.message)
    return []
  }
}

// Returns a { [shop_name_key]: { lat, lng, address, ... } } map matching
// the existing geocache shape, so dispatch code can layer it on top of
// the cache without changes.
export async function getPinnedShopsMap(req) {
  const pins = await listPinnedShops(req)
  const map = {}
  for (const p of pins) {
    if (p.lat == null || p.lng == null) continue
    map[p.shop_name_key] = {
      lat: p.lat,
      lng: p.lng,
      address: p.address,
      geocoded_at: p.geocoded_at,
      geocode_status: 'ok',
      geocode_source: 'manual',
      address_source: 'pinned',
    }
  }
  return map
}

export async function findPinByKey(req, shopNameKey) {
  const pins = await listPinnedShops(req)
  return pins.find(p => p.shop_name_key === shopNameKey) || null
}

export async function upsertPinnedShop(req, { shop_name, address, lat, lng }) {
  const table = getTable(req)
  const key = normalizeKey(shop_name)
  const now = new Date().toISOString()
  const existing = await findPinByKey(req, key)
  const payload = {
    shop_name: shop_name,
    shop_name_key: key,
    address: address || '',
    lat: String(lat),
    lng: String(lng),
    geocoded_at: now,
  }
  if (existing) {
    const updated = await table.updateRow({ ROWID: String(existing.id), ...payload })
    return rowToPin(updated)
  }
  const inserted = await table.insertRow({ ...payload, created_at: now })
  return rowToPin(inserted)
}

export async function deletePinnedShopByKey(req, shopNameKey) {
  const existing = await findPinByKey(req, shopNameKey)
  if (!existing) return false
  const table = getTable(req)
  await table.deleteRow(String(existing.id))
  return true
}
