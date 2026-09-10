// Big 3 rules per shop (Mark 2026-09-10): Cal ID report, Post Collision
// Safety Inspection, Post-Scan. Every shop is different — some bill
// these to insurance themselves, some let us. The rule lives on the CRM
// shop (billing_rules.big3), is applied to every invoice preview/create
// automatically, and is learned from Kat's first pick when unset.
//
//   modes:  bill      → we invoice the paid item
//           included  → we do it, line shows at $0
//           shop      → shop handles it, line is left off entirely
import { getAllShops, insertShop, updateShop } from '../routes/shops.js'
import { postToCliqChannel, postToCliqChannelById, DISPATCH_CHANNEL, MARK_ALERT_CHANNEL_ID } from './cliq.js'

export const BIG3 = [
  { key: 'cal_id',    base: 'Calibration Identification Report',        label: 'Cal ID report' },
  { key: 'pcsi',      base: 'Post Collision Safety Inspection 1 (L-M)', label: 'Post Collision Safety Inspection' },
  { key: 'post_scan', base: 'Post-Scan (L-M)',                          label: 'Post-Scan' },
]
export const MODES = { bill: 'We bill it', included: 'We do it · no charge', shop: 'Shop handles it' }
export const BASE_TO_KEY = Object.fromEntries(BIG3.map(b => [b.base, b.key]))

const shopKeyOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const loose = s => shopKeyOf(s).replace(/(autobody|bodyshop|collision|repair|center|centre|inc|llc|auto|body|shop)/g, '')

export function normalizeRules(r) {
  if (!r || typeof r !== 'object') return null
  const out = {}
  for (const b of BIG3) if (MODES[r[b.key]]) out[b.key] = r[b.key]
  return Object.keys(out).length ? out : null
}
export function describeRules(rules) {
  if (!rules) return 'no rule yet'
  return BIG3.map(b => `${b.label}: ${rules[b.key] ? MODES[rules[b.key]].toLowerCase() : 'default'}`).join(' · ')
}

export async function findShopByName(req, name) {
  const k = shopKeyOf(name)
  if (!k) return null
  const shops = await getAllShops(req)
  return shops.find(s => shopKeyOf(s.shop_name) === k)
    || shops.find(s => loose(s.shop_name) && loose(s.shop_name) === loose(name))
    || null
}
function parseBR(shop) {
  const br = shop?.billing_rules
  if (!br) return {}
  if (typeof br === 'string') { try { return JSON.parse(br) || {} } catch { return {} } }
  return typeof br === 'object' ? br : {}
}

export async function readBig3(req, shopName) {
  const shop = await findShopByName(req, shopName)
  if (!shop) return { rules: null, shop_id: null, shop_name: shopName || '', set_by: '', set_at: '' }
  const br = parseBR(shop)
  return { rules: normalizeRules(br.big3), shop_id: shop.id, shop_name: shop.shop_name, set_by: br.big3_set_by || '', set_at: br.big3_set_at || '' }
}

// Save (learn) a shop's rule. Creates the CRM shop if it isn't there yet
// so the rule has somewhere to live. Pings #dispatch + Mark when a rule
// changes (a wrong rule applied silently is the one real risk).
export async function saveBig3(req, shopName, rules, by = '') {
  const clean = normalizeRules(rules)
  if (!clean || !shopName) return null
  let shop = await findShopByName(req, shopName)
  const before = shop ? normalizeRules(parseBR(shop).big3) : null
  const same = before && BIG3.every(b => before[b.key] === clean[b.key])
  if (same) return { shop_id: shop.id, changed: false }
  const br = { ...(shop ? parseBR(shop) : {}), big3: clean, big3_set_by: by || 'app', big3_set_at: new Date().toISOString() }
  if (shop) shop = await updateShop(req, shop.id, { ...shop, billing_rules: br })
  else shop = await insertShop(req, { shop_name: shopName, pipeline_stage: 'active', referral_source: 'Invoice', billing_rules: br, people: [], activities: [] })
  const line = `🧾 *Big 3 rule ${before ? 'changed' : 'set'} · ${shop.shop_name}*\n${describeRules(clean)}${before ? `\n(was: ${describeRules(before)})` : ''}\nby ${by || 'app'}`
  postToCliqChannel(DISPATCH_CHANNEL, line).catch(() => {})
  postToCliqChannelById(MARK_ALERT_CHANNEL_ID, line).catch(() => {})
  console.log(`[big3] ${shop.shop_name}: ${describeRules(clean)} (by ${by || 'app'})`)
  return { shop_id: shop.id, changed: true }
}
