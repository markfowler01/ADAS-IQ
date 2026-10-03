// Shop type at a glance (Mark 2026-10-03): the billing customer type drives a
// badge + colored left edge on every card, so a collision shop, repair shop and
// dealer are told apart in search, the map and the duplicates list. No type yet
// = "? Set type" (tap to set; saves to billing so CRM and billing never disagree).
export const SHOP_TYPES = {
  body_shop:   { label: '🏢 COLLISION', color: '#CD4419', bg: '#fdf3ef' },
  repair_shop: { label: '🔧 REPAIR',    color: '#1d4ed8', bg: '#eff6ff' },
  dealer:      { label: '🚗 DEALER',    color: '#7c3aed', bg: '#f3e8ff' },
  retail:      { label: '🙂 RETAIL',    color: '#0e7490', bg: '#cffafe' },
}
export const UNSET_TYPE = { label: '? Set type', color: '#888', bg: '#f5f3f0' }
export const typeBadge = t => SHOP_TYPES[t] || UNSET_TYPE
export function shopTypeOf(shop) {
  let br = shop?.billing_rules
  if (typeof br === 'string') { try { br = JSON.parse(br) } catch { br = {} } }
  return String(br?.customer_type || '')
}
