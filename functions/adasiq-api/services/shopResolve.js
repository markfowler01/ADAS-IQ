// One shop name → the CRM customer it belongs to.
// CCC prints the legal letterhead ("Express Auto Body Collision Repair LLC");
// the CRM keeps the trade name ("Express Auto Body & Paint"). Those must
// land on the same shop. Chains with a city in the name (Maaco Tacoma vs
// Maaco Federal Way) stay separate because the city is a distinctive token.

import { getAllShops, updateShop } from '../routes/shops.js'

const STOP = new Set([
  'the', 'a', 'an', 'and', 'of', 'at', 'for',
  'auto', 'automotive', 'body', 'bodyshop', 'shop',
  'collision', 'repair', 'repairs', 'paint', 'rebuild', 'rebuilders', 'rebuilding',
  'center', 'centre', 'works',
  'inc', 'llc', 'llp', 'co', 'corp', 'corporation', 'company', 'ltd', 'dba',
])
const ACTIVE = new Set(['active', 'active2', 'second_active'])

export function shopKey(name) {
  return String(name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')
}

export function shopTokens(name) {
  return String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/).filter(w => w && !STOP.has(w))
}

export function shopCore(name) {
  return shopTokens(name).join(' ').trim()
}

export function shopCoreKey(name) {
  return shopTokens(name).join('')
}

function parseBR(shop) {
  const br = shop?.billing_rules
  if (!br) return {}
  if (typeof br === 'string') { try { return JSON.parse(br) || {} } catch { return {} } }
  return typeof br === 'object' ? br : {}
}

export function aliasesOf(shop) {
  const a = parseBR(shop).aliases
  return Array.isArray(a) ? a.map(x => String(x || '').trim()).filter(Boolean) : []
}

function allNames(shop) {
  return [shop.shop_name, ...aliasesOf(shop)].filter(Boolean)
}

let _cache = { at: 0, shops: null }
export function bustShopCache() { _cache = { at: 0, shops: null } }
export async function loadShops(req) {
  if (_cache.shops && Date.now() - _cache.at < 60 * 1000) return _cache.shops
  const shops = await getAllShops(req)
  _cache = { at: Date.now(), shops }
  return shops
}

/**
 * Pure match against an already-loaded shop list.
 * confidence 1 = exact/alias, ~0.8–0.9 = distinctive-token, 0 = no / ambiguous.
 */
export function matchShop(name, shops, { city = '' } = {}) {
  const raw = String(name || '').trim()
  if (!raw) return { shop: null, how: '', confidence: 0 }
  const k = shopKey(raw)
  const core = shopCoreKey(raw)
  const cityK = shopCoreKey(city)

  const exact = shops.find(s => shopKey(s.shop_name) === k)
  if (exact) return { shop: exact, how: 'exact', confidence: 1 }

  const alias = shops.find(s => aliasesOf(s).some(a => shopKey(a) === k))
  if (alias) return { shop: alias, how: 'alias', confidence: 1 }

  if (core.length >= 4) {
    const cores = shops.filter(s => allNames(s).some(n => shopCoreKey(n) === core))
    if (cores.length === 1) return { shop: cores[0], how: 'core', confidence: 0.9 }
    if (cores.length > 1) {
      if (cityK) {
        const byCity = cores.filter(s => shopCoreKey(`${s.address || ''} ${s.shop_name || ''}`).includes(cityK))
        if (byCity.length === 1) return { shop: byCity[0], how: 'core+city', confidence: 0.85 }
      }
      const booked = cores.filter(s => s.zoho_contact_id)
      if (booked.length === 1) return { shop: booked[0], how: 'core+books', confidence: 0.82 }
      const active = cores.filter(s => ACTIVE.has(s.pipeline_stage))
      if (active.length === 1) return { shop: active[0], how: 'core+customer', confidence: 0.8 }
      return { shop: null, how: 'ambiguous', confidence: 0, candidates: cores }
    }
  }

  return { shop: null, how: '', confidence: 0 }
}

export async function rememberAlias(req, shop, printed) {
  const a = String(printed || '').trim()
  if (!a || !shop?.id || shopKey(a) === shopKey(shop.shop_name)) return false
  if (aliasesOf(shop).some(x => shopKey(x) === shopKey(a))) return false
  const br = parseBR(shop)
  const aliases = [...new Set([...(Array.isArray(br.aliases) ? br.aliases : []), a])].slice(0, 40)
  await updateShop(req, shop.id, { ...shop, billing_rules: { ...br, aliases } })
  bustShopCache()
  console.log(`[shop] alias "${a}" → ${shop.shop_name}`)
  return true
}

/** Resolve a printed name to the CRM shop. Never creates a shop. */
export async function resolveShop(req, name, { city = '', remember = false } = {}) {
  const printed = String(name || '').trim()
  if (!printed) return { name: '', shop: null, printed: '', how: '', unmatched: true }
  const shops = await loadShops(req)
  const m = matchShop(printed, shops, { city })
  if (m.shop) {
    if (remember && m.how !== 'exact') {
      try { await rememberAlias(req, m.shop, printed) } catch (e) { console.warn('[shop] alias save failed:', e.message) }
    }
    return { name: m.shop.shop_name, shop: m.shop, printed, how: m.how, unmatched: false }
  }
  return { name: printed, shop: null, printed, how: m.how || '', unmatched: true, candidates: m.candidates || [] }
}

/** Apply a resolved name onto a scrub/job data object. Mutates data. */
export async function applyShopResolve(req, data, { remember = true } = {}) {
  const printed = String(data?.shop || '').trim()
  if (!printed) return data
  try {
    const r = await resolveShop(req, printed, { city: data.shop_city || data.city || '', remember })
    if (r.shop) {
      data._shopPrinted = data._shopPrinted || printed
      data.shop = r.name
      data._shopId = r.shop.id
      data._shopMatch = r.how
      delete data._shopUnmatched
    } else {
      data._shopUnmatched = true
    }
  } catch (e) { console.warn('[shop] resolve skipped:', e.message) }
  return data
}
