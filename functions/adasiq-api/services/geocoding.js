// Geocoding service for Absolute ADAS dispatch map.
//
// Storage: Catalyst Cache key `absolute_adas_geocache`
//   shape: { [normalizedShopName]: { lat, lng, geocoded_at, geocode_status, geocode_source } }
//
// We use a cache key rather than adding columns to CRMShops so the feature
// works without a Datastore schema migration. Mark can migrate to real
// columns later; the API stays the same.

import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'

export const GEOCACHE_KEY = 'absolute_adas_geocache'
export const TECH_CONFIG_KEY = 'absolute_adas_tech_config'

function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

export function normalizeKey(s) {
  return (s || '').trim().toLowerCase()
}

export async function readGeocache(req) {
  try {
    const item = await getSegment(req).get(GEOCACHE_KEY)
    return item?.cache_value ? JSON.parse(item.cache_value) : {}
  } catch (e) {
    if (isNotFound(e)) return {}
    console.warn('[geocoding] readGeocache failed:', e.message)
    return {}
  }
}

export async function writeGeocache(req, data) {
  const value = JSON.stringify(data)
  const seg = getSegment(req)
  try { await seg.update(GEOCACHE_KEY, value) }
  catch (e) {
    try { await seg.put(GEOCACHE_KEY, value) }
    catch (e2) { console.error('[geocoding] writeGeocache failed:', e.message, '/', e2.message) }
  }
}

export async function readTechConfig(req) {
  try {
    const item = await getSegment(req).get(TECH_CONFIG_KEY)
    return item?.cache_value ? JSON.parse(item.cache_value) : {}
  } catch (e) {
    if (isNotFound(e)) return {}
    console.warn('[geocoding] readTechConfig failed:', e.message)
    return {}
  }
}

export async function writeTechConfig(req, data) {
  const value = JSON.stringify(data)
  const seg = getSegment(req)
  try { await seg.update(TECH_CONFIG_KEY, value) }
  catch (e) {
    try { await seg.put(TECH_CONFIG_KEY, value) }
    catch (e2) { console.error('[geocoding] writeTechConfig failed:', e.message, '/', e2.message) }
  }
}

// Source of truth for tech home addresses. Changing one here and re-running
// the geocoding cron will pick up the correction (the seed function overwrites
// when the stored address differs and clears the cached lat/lng so the next
// cron run re-geocodes it).
export const TECH_HOME_DEFAULTS = {
  Mark:   { home_address: '2307 Cedar Rd, Lake Stevens, WA 98258',       label: 'Lake Stevens' },
  Jayden: { home_address: '13322 78th St NE, Lake Stevens, WA 98258',    label: 'Lake Stevens' },
}

export async function ensureTechConfigSeed(req, { force = false } = {}) {
  const current = await readTechConfig(req)
  let changed = false
  for (const [tech, cfg] of Object.entries(TECH_HOME_DEFAULTS)) {
    const existing = current[tech]
    if (!existing) {
      current[tech] = { home_address: cfg.home_address, label: cfg.label, home_lat: null, home_lng: null, geocoded_at: null }
      changed = true
      continue
    }
    // If address changed (or force), update and clear lat/lng so next cron run re-geocodes.
    if (force || existing.home_address !== cfg.home_address) {
      current[tech] = {
        ...existing,
        home_address: cfg.home_address,
        label: cfg.label,
        home_lat: null,
        home_lng: null,
        geocoded_at: null,
      }
      changed = true
    }
  }
  if (changed) await writeTechConfig(req, current)
  return current
}

/**
 * Call the Google Geocoding API for a single address string.
 * Returns { lat, lng, geocode_status, geocode_source } or null on hard failure.
 */
export async function geocodeAddress(address) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    console.warn('[geocoding] GOOGLE_PLACES_API_KEY not set; cannot geocode')
    return null
  }
  if (!address || !address.trim()) {
    return { lat: null, lng: null, geocode_status: 'failed', geocode_source: 'google' }
  }
  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address, key: apiKey, region: 'us' },
      timeout: 8000,
    })
    const status = res.data?.status
    const results = res.data?.results || []
    if (status !== 'OK' || results.length === 0) {
      return { lat: null, lng: null, geocode_status: 'failed', geocode_source: 'google' }
    }
    const top = results[0]
    const loc = top.geometry?.location
    const locType = top.geometry?.location_type
    if (!loc) return { lat: null, lng: null, geocode_status: 'failed', geocode_source: 'google' }
    const precise = locType === 'ROOFTOP' || locType === 'RANGE_INTERPOLATED'
    return {
      lat: loc.lat,
      lng: loc.lng,
      geocode_status: precise ? 'ok' : 'ambiguous',
      geocode_source: 'google',
    }
  } catch (e) {
    console.warn('[geocoding] Google API error for', JSON.stringify(address), ':', e.message)
    return null
  }
}

/**
 * Lookup helper: get lat/lng for a shop name from the geocache.
 * Returns { lat, lng, geocode_status } or null.
 */
export async function getShopCoords(req, shopName) {
  if (!shopName) return null
  const cache = await readGeocache(req)
  return cache[normalizeKey(shopName)] || null
}
