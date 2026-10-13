// From the Van audience = contacts at the collision and auto repair shops that
// are Mark's customers (Mark 2026-10-13: "any shop that I add to my customers,
// any collision shops ... or auto repair shops, I want them to get this").
// A customer = CRM pipeline stage active / active2 / second_active (same set
// as the ⭐ Customers view). Shop type = billing customer_type body_shop or
// repair_shop. Dealers, retail, and untyped shops are not added.
//
// Adds only addresses Resend has never seen (addVanSubscriberIfNew), so an
// unsubscribe or silent removal is never undone. No welcome or nurture email
// is sent; they simply start getting the weekly issue.
import { addVanSubscriberIfNew } from './fromTheVan.js'

export const VAN_SHOP_TYPES = new Set(['body_shop', 'repair_shop'])
export const VAN_CUSTOMER_STAGES = new Set(['active', 'active2', 'second_active'])
const SKIP_EMAIL = /@absoluteadas\.com$|calibrat|avscalibrations|hivecalibrations|\babs-c\b/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function shopType(shop) {
  let br = shop?.billing_rules
  if (typeof br === 'string') { try { br = JSON.parse(br) } catch { br = {} } }
  return String(br?.customer_type || '')
}

export function vanEligible(shop) {
  return VAN_SHOP_TYPES.has(shopType(shop)) && VAN_CUSTOMER_STAGES.has(String(shop?.pipeline_stage || ''))
}

/** Every usable email on a shop: its people plus the shop's own address. */
export function shopContacts(shop) {
  const out = new Map()
  const add = (email, name) => {
    const e = String(email || '').trim().toLowerCase()
    if (!EMAIL_RE.test(e) || SKIP_EMAIL.test(e) || out.has(e)) return
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
    out.set(e, { email: e, firstName: parts[0] || '', lastName: parts.slice(1).join(' ') })
  }
  for (const p of Array.isArray(shop?.people) ? shop.people : []) add(p?.email, p?.name)
  add(shop?.email, shop?.contact_name)
  return [...out.values()]
}

/** Subscribe a shop's contacts when it is a collision/repair customer. Never throws. */
export async function syncShopToVan(shop) {
  if (!vanEligible(shop)) return { skipped: true, reason: `type ${shopType(shop) || 'unset'} · stage ${shop?.pipeline_stage || '?'}` }
  const results = []
  for (const c of shopContacts(shop)) {
    const r = await addVanSubscriberIfNew(c).catch(e => ({ ok: false, error: e.message }))
    results.push({ email: c.email, added: !!r.added, exists: !!r.exists, error: r.ok ? null : r.error })
  }
  const added = results.filter(r => r.added).map(r => r.email)
  if (added.length) console.log(`[van sync] ${shop.shop_name}: added ${added.join(', ')}`)
  return { ok: true, shop: shop.shop_name, added, results }
}
