// 🧰 Full Service (Mark 2026-10-01). The work around the calibrations that some
// shops do themselves and some hand to us — headlamp aim, TPMS relearn, module
// programming, the resets after a battery disconnect. "Kinetic is missing it"
// and it's where Mark wants to grow.
//
// The scrub ALWAYS finds these (the car needs them either way). Each shop's
// CRM rule (billing_rules.full_service) decides what we do with them:
//   we    → We do it: on the report and the quote, billed
//   shop  → Shop does it: on the report as "Required · shop handles", never quoted
//   ask   → Ask: shown as an offer ("💰 Offer"), the quoter decides
// No rule yet = ask. The first choice someone makes for a shop becomes its rule.
import { updateShop } from '../routes/shops.js'
import { findShopByName } from './big3.js'
import { postToCliqChannel, DISPATCH_CHANNEL } from './cliq.js'

// `match` runs on the scrub row's calibration_name.
export const FULL_SERVICE = [
  // Manual aim only — electronic (adaptive / auto-leveling) headlamps are a calibration we always do (Mark 2026-10-01).
  { key: 'headlamp',   emoji: '💡', label: 'Headlamp aim (manual)',   match: /^(?!.*(adaptive|level|swivel|afs|matrix|module|initiali|calibration|electronic)).*(headlamp|headlight)/i },
  { key: 'tpms',       emoji: '🛞', label: 'TPMS relearn',            match: /\btpms\b|tire pressure/i },
  { key: 'programming', emoji: '🔑', label: 'Module programming',     match: /programming|software update|module (setup|coding|config|replacement)|\bcoding\b/i },
  { key: 'resets',     emoji: '🪟', label: 'Battery-disconnect resets', match: /window|sunroof|moon ?roof|power (liftgate|tailgate|sliding door)|initiali[sz]ation after battery|battery.*reset|reset.*battery/i },
]
export const FS_MODES = { we: 'We do it', shop: 'Shop does it', ask: 'Ask' }
export const FS_DEFAULT = 'ask'

/** Which Full Service item a calibration row is, or null for a calibration. */
export function fsKeyFor(name) {
  const n = String(name || '')
  for (const f of FULL_SERVICE) if (f.match.test(n)) return f.key
  return null
}

export function normalizeFs(r) {
  const out = {}
  if (r && typeof r === 'object') for (const f of FULL_SERVICE) if (FS_MODES[r[f.key]]) out[f.key] = r[f.key]
  return out
}

const parseBR = shop => { const br = shop?.billing_rules; if (!br) return {}; if (typeof br === 'string') { try { return JSON.parse(br) || {} } catch { return {} } } return br }

/** A shop's rules with every item filled (unset = ask) + which items were set. */
export function fsRulesOf(shop) {
  const br = parseBR(shop)
  const set = normalizeFs(br.full_service)
  const rules = Object.fromEntries(FULL_SERVICE.map(f => [f.key, set[f.key] || FS_DEFAULT]))
  return { rules, set, set_by: br.full_service_set_by || '', set_at: br.full_service_set_at || '' }
}

export async function readFullService(req, shopName) {
  const shop = shopName ? await findShopByName(req, shopName).catch(() => null) : null
  return { shop_id: shop?.id || null, shop_name: shop?.shop_name || shopName || '', ...fsRulesOf(shop) }
}

/**
 * Save some or all items for a shop. learnOnly = only fill items that have no
 * rule yet (first choice wins; later deviations don't overwrite).
 */
export async function saveFullService(req, shop, patch, by = '', { learnOnly = false, silent = false } = {}) {
  if (!shop) return { changed: false }
  const br = parseBR(shop)
  const before = normalizeFs(br.full_service)
  const clean = normalizeFs(patch)
  const next = { ...before }
  for (const [k, v] of Object.entries(clean)) if (!learnOnly || !before[k]) next[k] = v
  const changed = FULL_SERVICE.filter(f => next[f.key] !== before[f.key])
  if (!changed.length) return { changed: false, rules: next }
  await updateShop(req, shop.id, { ...shop, billing_rules: { ...br, full_service: next, full_service_set_by: by || 'app', full_service_set_at: new Date().toISOString() } })
  const what = changed.map(f => `${f.emoji} ${f.label}: ${FS_MODES[next[f.key]]}${before[f.key] ? ` (was ${FS_MODES[before[f.key]]})` : ''}`).join('\n')
  console.log(`[full-service] ${shop.shop_name}: ${what.replace(/\n/g, ' · ')} (by ${by || 'app'}${learnOnly ? ', learned' : ''})`)
  if (!silent) await postToCliqChannel(DISPATCH_CHANNEL, `🧰 *Full Service ${learnOnly ? 'learned' : 'set'} · ${shop.shop_name}*\n${what}\nby ${by || 'app'}`).catch(() => {})
  return { changed: true, rules: next }
}

/**
 * Tag each scrub row with its Full Service item and the shop's mode for it:
 * row._fs = { key, label, emoji, mode }. Calibrations are left untouched.
 */
export function tagRows(cals, rules) {
  for (const c of Array.isArray(cals) ? cals : []) {
    const key = fsKeyFor(c.calibration_name || c.name)
    if (!key) { delete c._fs; continue }
    const f = FULL_SERVICE.find(x => x.key === key)
    c._fs = { key, label: f.label, emoji: f.emoji, mode: rules?.[key] || FS_DEFAULT }
  }
  return cals
}
