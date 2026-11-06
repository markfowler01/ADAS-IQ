// Shop type at a glance (Mark 2026-10-03): the billing customer type drives a
// badge + colored left edge on every card, so a collision shop, repair shop and
// dealer are told apart in search, the map and the duplicates list. No type yet
// = "? Set type" (tap to set; saves to billing so CRM and billing never disagree).
// Ring color on CRM cards. Collision stays brand orange. The others are
// far enough apart that a mixed list reads at a glance (Mark 2026-10-15).
export const SHOP_TYPES = {
  body_shop:   { label: '🏢 COLLISION', color: '#CD4419', bg: '#fdf3ef' }, // orange
  repair_shop: { label: '🔧 REPAIR',    color: '#1F8B8B', bg: '#e6f4f4' }, // teal
  dealer:      { label: '🚗 DEALER',    color: '#1d4ed8', bg: '#eff6ff' }, // blue
  retail:      { label: '🙂 RETAIL',    color: '#15803D', bg: '#dcfce7' }, // green
}
export const UNSET_TYPE = { label: '? Set type', color: '#888', bg: '#f5f3f0' }
export const typeBadge = t => SHOP_TYPES[t] || UNSET_TYPE
export function shopTypeOf(shop) {
  let br = shop?.billing_rules
  if (typeof br === 'string') { try { br = JSON.parse(br) } catch { br = {} } }
  return String(br?.customer_type || '')
}
