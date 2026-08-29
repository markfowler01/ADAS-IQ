// Insurer tier map (Mark 2026-08-29): State Farm and Allstate price by
// THEIR tier codes, and the tier depends on the vehicle — a Toyota
// front radar is SF "3a" while a 2024 Audi front radar is SF "3c" /
// Allstate "3c complex". That vehicle→tier knowledge lived in Kat's
// head; every pick she makes in the review modal is saved here, so the
// next scrub of the same make prices itself.
//
// One AppConfig row keyed `insurer_tier_map`:
//   { "AS|toyota|front radar": "AS - 3A Calibration", ... }
// Key = pricing prefix | make | calibration name (all normalized).
// Make-level granularity on purpose — tiers track platforms, not trims.
// If two models of one make ever need different tiers, add model to the
// key then.

import catalyst from 'zcatalyst-sdk-node'

const ROW_KEY = 'insurer_tier_map'

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function tierKey(insurerPrefix, make, calName) {
  if (!insurerPrefix || !make || !calName) return null
  return `${String(insurerPrefix).toUpperCase()}|${norm(make)}|${norm(calName)}`
}

async function cfgRow(app, key) {
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key}' LIMIT 1`
  ).catch(() => [])
  return rows?.[0]?.AppConfig || rows?.[0] || null
}

export async function readTierMap(req) {
  try {
    const app = catalyst.initialize(req)
    const r = await cfgRow(app, ROW_KEY)
    const parsed = JSON.parse(r?.config_value || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

export async function saveTierMappings(req, entries) {
  // entries: [{ insurerPrefix, make, calName, itemName }]
  const valid = (entries || []).map(e => ({
    key: tierKey(e.insurerPrefix, e.make, e.calName),
    itemName: e.itemName,
  })).filter(e => e.key && e.itemName)
  if (!valid.length) return { saved: 0 }
  const app = catalyst.initialize(req)
  const table = app.datastore().table('AppConfig')
  const r = await cfgRow(app, ROW_KEY)
  let map = {}
  try { map = JSON.parse(r?.config_value || '{}') || {} } catch { map = {} }
  let changed = 0
  for (const e of valid) {
    if (map[e.key] !== e.itemName) { map[e.key] = e.itemName; changed++ }
  }
  if (changed) {
    const str = JSON.stringify(map)
    if (r?.ROWID) await table.updateRow({ ROWID: r.ROWID, config_value: str })
    else await table.insertRow({ config_key: ROW_KEY, config_value: str })
    console.log(`[tier-map] learned ${changed} mapping(s):`, valid.map(v => `${v.key} → ${v.itemName}`).join(' · '))
  }
  return { saved: changed }
}

export async function deleteTierMapping(req, key) {
  const app = catalyst.initialize(req)
  const table = app.datastore().table('AppConfig')
  const r = await cfgRow(app, ROW_KEY)
  let map = {}
  try { map = JSON.parse(r?.config_value || '{}') || {} } catch { map = {} }
  if (!(key in map)) return { deleted: false }
  delete map[key]
  if (r?.ROWID) await table.updateRow({ ROWID: r.ROWID, config_value: JSON.stringify(map) })
  console.log('[tier-map] forgot mapping:', key)
  return { deleted: true }
}

// ── Per-shop default pricing schedule (Mark 2026-08-29 fix #3) ──────────
// Some shops are always cash. First explicit schedule pick on a shop's
// invoice is remembered; the review screen opens on it next time.
const POOLS_KEY = 'shop_default_pools'

export async function readShopPools(req) {
  try {
    const app = catalyst.initialize(req)
    const r = await cfgRow(app, POOLS_KEY)
    const parsed = JSON.parse(r?.config_value || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

export async function saveShopPool(req, customerId, pool) {
  if (!customerId || !pool) return
  const app = catalyst.initialize(req)
  const table = app.datastore().table('AppConfig')
  const r = await cfgRow(app, POOLS_KEY)
  let map = {}
  try { map = JSON.parse(r?.config_value || '{}') || {} } catch { map = {} }
  if (map[customerId] === pool) return
  map[customerId] = pool
  const str = JSON.stringify(map)
  if (r?.ROWID) await table.updateRow({ ROWID: r.ROWID, config_value: str })
  else await table.insertRow({ config_key: POOLS_KEY, config_value: str })
  console.log(`[shop-pools] ${customerId} defaults to ${pool}`)
}
