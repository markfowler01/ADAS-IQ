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
// Mark 2026-10-01 (v2): "default it off … for Collision shops only, then we'll
// turn it on based on the discussions and negotiations". So:
//   • collision shop (or type not set), Full Service OFF (default) → every item = shop
//   • collision shop, Full Service ON → per-item rule, unset item = we
//   • repair shop / dealer / retail → not Full Service at all: the rows are ordinary
//     billable lines (untagged), no section, no toggle
import { updateShop } from '../routes/shops.js'
import { findShopByName } from './big3.js'
import { postToCliqChannel, DISPATCH_CHANNEL } from './cliq.js'

// `match` runs on the scrub row's calibration_name.
export const FULL_SERVICE = [
  // Manual aim only — electronic (adaptive / auto-leveling) headlamps are a calibration we always do (Mark 2026-10-01).
  { key: 'headlamp',   emoji: '💡', label: 'Headlamp aim (manual)',   match: /^(?!.*(adaptive|level|swivel|afs|matrix|module|initiali|calibration|electronic)).*(headlamp|headlight)/i },
  // Optional = not OEM-required; shows only for Full Service shops (Mark 2026-10-02).
  { key: 'bsm_rr',     emoji: '📡', label: 'Blind spot aim after rear bumper removal', match: /rear bumper removed/i, optional: true },
  { key: 'tpms',       emoji: '🛞', label: 'TPMS relearn',            match: /\btpms\b|tire pressure/i },
  // 'programming' left Full Service 2026-10-02: required on every make except Toyota/Honda (scrubGuard 7b).
  { key: 'resets',     emoji: '🪟', label: 'Battery-disconnect resets', match: /window|sunroof|moon ?roof|power (liftgate|tailgate|sliding door)|initiali[sz]ation after battery|battery.*reset|reset.*battery/i },
]
export const FS_MODES = { we: 'We do it', shop: 'Shop does it', ask: 'Ask' }
export const FS_DEFAULT = 'we'   // per-item default once a shop is switched ON

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

/** A shop's effective rule for every item, plus the switch and what was set. */
export function fsRulesOf(shop) {
  const br = parseBR(shop)
  const set = normalizeFs(br.full_service)
  const ctype = String(br.customer_type || '')
  const collision = !ctype || ctype === 'body_shop'
  const on = collision && br.full_service_on === true
  // Full Service OFF in the CRM = the items are left off the report and the quote entirely
  // (Mark 2026-10-02: "the full service items are on the report and it is turned off in the crm").
  const rules = Object.fromEntries(FULL_SERVICE.map(f => [f.key, !collision ? 'we' : on ? (set[f.key] || FS_DEFAULT) : 'off']))
  return { rules, set, on, collision, customer_type: ctype, set_by: br.full_service_set_by || '', set_at: br.full_service_set_at || '' }
}

export async function readFullService(req, shopName) {
  const shop = shopName ? await findShopByName(req, shopName).catch(() => null) : null
  return { shop_id: shop?.id || null, shop_name: shop?.shop_name || shopName || '', ...fsRulesOf(shop) }
}

/**
 * Save some or all items for a shop. learnOnly = only fill items that have no
 * rule yet (first choice wins; later deviations don't overwrite).
 */
export async function saveFullService(req, shop, patch, by = '', { learnOnly = false, silent = false, on = null } = {}) {
  if (!shop) return { changed: false }
  const br = parseBR(shop)
  if (typeof on === 'boolean' && on !== (br.full_service_on === true)) {
    await updateShop(req, shop.id, { ...shop, billing_rules: { ...br, full_service_on: on, full_service_set_by: by || 'app', full_service_set_at: new Date().toISOString() } })
    console.log(`[full-service] ${shop.shop_name}: switched ${on ? 'ON' : 'OFF'} by ${by || 'app'}`)
    if (!silent) await postToCliqChannel(DISPATCH_CHANNEL, `🧰 *Full Service ${on ? 'ON' : 'OFF'} · ${shop.shop_name}*\nby ${by || 'app'}`).catch(() => {})
    return { changed: true }
  }
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
export function tagRows(cals, rules, { collision = true } = {}) {
  const keep = []
  const seenFs = new Set()
  for (const c of Array.isArray(cals) ? cals : []) {
    const key = fsKeyFor(c.calibration_name || c.name)
    const f = key ? FULL_SERVICE.find(x => x.key === key) : null
    if (f && collision && rules?.[key] === 'off') continue          // Full Service switched off for this shop
    if (f) { if (seenFs.has(key)) continue; seenFs.add(key) }        // one row per item (two "Battery-Disconnect Resets" on CH11819)
    // Optional items (not OEM-required) exist only for Full Service shops that do or offer them.
    if (f?.optional && (!collision || (rules?.[key] || FS_DEFAULT) === 'shop' || !rules)) continue
    if (!collision || !f) { delete c._fs; keep.push(c); continue }   // non-collision customers: plain lines
    c._fs = { key, label: f.label, emoji: f.emoji, mode: rules?.[key] || FS_DEFAULT, optional: !!f.optional }
    if (f.optional && c._fs.mode === 'we') c.enabled = true   // the shop's Full Service makes it part of the job
    if (f.optional && c._fs.mode === 'ask') c.enabled = true  // shown as an offer in the Full Service section
    keep.push(c)
  }
  return keep
}

// 🔁 Per-report override (Mark 2026-10-07: "toggle Full Service on or off live on the
// report … but remember whatever their account is set up as in the CRM"). The CRM rule
// is the account default and is never touched; `scrub.payload.fs_override` = 'on' | 'off'
// bends THIS report (PDF, online report, quote lines) only.
export function applyFsOverride(r, override) {
  if (!r || !override || !r.collision) return r
  if (override === 'off') return { ...r, on: false, override, rules: Object.fromEntries(FULL_SERVICE.map(f => [f.key, 'off'])) }
  if (override === 'on') return { ...r, on: true, override, rules: Object.fromEntries(FULL_SERVICE.map(f => [f.key, r.set?.[f.key] || FS_DEFAULT])) }
  return r
}
export async function readFullServiceForScrub(req, scrub) {
  const r = await readFullService(req, scrub?.shop || scrub?.payload?.shop || '')
  return applyFsOverride(r, scrub?.payload?.fs_override || '')
}
