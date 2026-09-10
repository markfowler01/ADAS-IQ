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

// Mark 2026-09-10 (v2): ALL THREE go on EVERY invoice — "so people get
// used to seeing it and eventually we can start charging them". Per shop
// each is either charged or shown as the "(included)" $0 item.
//   base      = the $0 "(included)" Books item (always exists)
//   paid      = the charged Books item; post_scan is pool-aware (AS/SFP/
//               AmFam have their own) and falls back to Post-Calibration Scan
export const BIG3 = [
  { key: 'cal_id',    base: 'Calibration Identification Report (included)',        paid: 'Calibration Identification Report',        label: 'Cal ID report' },
  { key: 'pcsi',      base: 'Post Collision Safety Inspection 1 (included)', paid: 'Post Collision Safety Inspection 1',        label: 'Post Collision Safety Inspection' },
  { key: 'post_scan', base: 'Post-Scan (included)',                          paid: 'Post-Scan', paidFallback: 'Post-Calibration Scan', label: 'Post-Scan' },
]
export const MODES = { charge: 'Charge', included: 'Included' }
// Until a shop has a rule: Cal ID charged (as today), the other two included.
export const DEFAULT_RULES = { cal_id: 'charge', pcsi: 'included', post_scan: 'included' }
export const BASE_TO_KEY = Object.fromEntries(BIG3.map(b => [b.base, b.key]))
const LEGACY = { bill: 'charge', shop: 'included' }

const shopKeyOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const loose = s => shopKeyOf(s).replace(/(autobody|bodyshop|collision|repair|center|centre|inc|llc|auto|body|shop)/g, '')

export function normalizeRules(r) {
  if (!r || typeof r !== 'object') return null
  const out = {}
  for (const b of BIG3) { const v = LEGACY[r[b.key]] || r[b.key]; if (MODES[v]) out[b.key] = v }
  return Object.keys(out).length ? out : null
}
export function withDefaults(rules) { return { ...DEFAULT_RULES, ...(normalizeRules(rules) || {}) } }
export function describeRules(rules) {
  if (!rules) return 'no rule yet'
  const charge = BIG3.filter(b => rules[b.key] === 'charge').map(b => b.label)
  const inc = BIG3.filter(b => rules[b.key] === 'included').map(b => b.label)
  return [charge.length ? `Charge: ${charge.join(', ')}` : null, inc.length ? `Included: ${inc.join(', ')}` : null].filter(Boolean).join(' · ') || 'no rule yet'
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
export async function saveBig3(req, shopName, rules, by = '', extra = {}) {
  const clean = normalizeRules(rules)
  if (!clean || !shopName) return null
  let shop = await findShopByName(req, shopName)
  const prevBR = shop ? parseBR(shop) : {}
  const before = shop ? normalizeRules(prevBR.big3) : null
  // Optional cost-invoice discount + customer type ride along (Mark's list, 2026-09-10).
  const pct = Number.isFinite(Number(extra.discount_pct)) ? Number(extra.discount_pct) : null
  const ctype = extra.customer_type ? String(extra.customer_type) : null
  const sameBig3 = before && BIG3.every(b => before[b.key] === clean[b.key])
  const sameExtra = (pct == null || Number(prevBR.discount_value) === pct) && (!ctype || prevBR.customer_type === ctype)
  if (sameBig3 && sameExtra) return { shop_id: shop.id, changed: false }
  const br = { ...prevBR, big3: clean, big3_set_by: by || 'app', big3_set_at: new Date().toISOString(),
    ...(pct != null ? { discount_type: 'percentage', discount_value: pct } : {}), ...(ctype ? { customer_type: ctype } : {}) }
  if (shop) shop = await updateShop(req, shop.id, { ...shop, billing_rules: br })
  else shop = await insertShop(req, { shop_name: shopName, pipeline_stage: 'active', referral_source: 'Invoice', billing_rules: br, people: [], activities: [] })
  const line = `🧾 *Big 3 rule ${before ? 'changed' : 'set'} · ${shop.shop_name}*\n${describeRules(clean)}${pct != null ? ` · cost-invoice discount ${pct}%` : ''}${before ? `\n(was: ${describeRules(before)})` : ''}\nby ${by || 'app'}`
  postToCliqChannel(DISPATCH_CHANNEL, line).catch(() => {})
  postToCliqChannelById(MARK_ALERT_CHANNEL_ID, line).catch(() => {})
  console.log(`[big3] ${shop.shop_name}: ${describeRules(clean)} (by ${by || 'app'})`)
  return { shop_id: shop.id, changed: true }
}


// ── Phase 2 ──────────────────────────────────────────────────────────────
// Every shop's rule at once (for card badges) + which active shops have
// none yet.
export async function big3Map(req) {
  const shops = await getAllShops(req)
  const map = {}, missing = []
  for (const sh of shops) {
    const br = parseBR(sh)
    const rules = normalizeRules(br.big3)
    const complete = rules && BIG3.every(b => rules[b.key])
    const drps = Array.isArray(sh.drps) ? sh.drps : []
    if (rules || drps.length) map[shopKeyOf(sh.shop_name)] = { rules, set_by: br.big3_set_by || '', complete: !!complete, drps }
    if (!complete && ['active', 'second_active', 'active2'].includes(sh.pipeline_stage)) missing.push({ id: sh.id, shop_name: sh.shop_name })
  }
  return { map, missing }
}

// Suggest a rule from the shop's last few Books invoices: a paid line →
// bill, a $0 (L-M) line → included, never on the invoice → shop handles.
export async function suggestBig3(shopName, limit = 5) {
  const axios = (await import('axios')).default
  const { getAccessToken } = await import('./zoho.js')
  const token = await getAccessToken()
  const H = { headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { organization_id: process.env.ZOHO_ORGANIZATION_ID }, timeout: 15000 }
  const list = await axios.get('https://www.zohoapis.com/books/v3/invoices', { ...H, params: { ...H.params, customer_name: shopName, per_page: limit, sort_column: 'date', sort_order: 'D' } })
  const invoices = (list.data?.invoices || []).filter(i => String(i.customer_name || '').toLowerCase() === String(shopName).toLowerCase()).slice(0, limit)
  const tests = {
    cal_id:    n => /calibration identification/i.test(n),
    pcsi:      n => /post collision safety inspection/i.test(n),
    post_scan: n => /post[- ]?scan/i.test(n) && !/pre\s*&|pre and/i.test(n),
  }
  const evidence = []
  const seen = { cal_id: { paid: 0, zero: 0 }, pcsi: { paid: 0, zero: 0 }, post_scan: { paid: 0, zero: 0 } }
  for (const inv of invoices) {
    const d = await axios.get(`https://www.zohoapis.com/books/v3/invoices/${inv.invoice_id}`, H)
    const lines = d.data?.invoice?.line_items || []
    const row = { number: inv.invoice_number, date: inv.date, cal_id: '—', pcsi: '—', post_scan: '—' }
    for (const key of Object.keys(tests)) {
      const hits = lines.filter(l => tests[key](String(l.name || l.description || '')))
      if (!hits.length) continue
      const paid = hits.some(l => Number(l.rate) > 0 || Number(l.item_total) > 0)
      if (paid) { seen[key].paid++; row[key] = `$${hits.reduce((a, l) => a + (Number(l.item_total) || Number(l.rate) || 0), 0)}` }
      else { seen[key].zero++; row[key] = '$0' }
    }
    evidence.push(row)
  }
  const suggested = {}
  for (const key of Object.keys(seen)) {
    if (!invoices.length) continue
    // Two states: charged on most recent invoices → charge, else included
    // (never on the invoice at all also reads as included — it goes on now).
    suggested[key] = (seen[key].paid > 0 && seen[key].paid >= seen[key].zero) ? 'charge' : 'included'
  }
  return { invoices: invoices.length, suggested: invoices.length ? suggested : null, evidence }
}
