// Invoice switch for the Nissan 4-Way Alignment report row.
// The calibration report always lists the row. Invoicing it is off until a
// shop turns it on (billing_rules.invoice_4way_alignment === true). Missing
// means off, including shops saved before the switch existed.
// A priced line is created only from an Item Map entry or a catalog service
// that already has a price. No invented dollar amount and no labor hour.

const ALIGN_NAME = /^(?:4-way alignment|four-way alignment|four wheel alignment|wheel alignment)$/i
const BATTERY_NAME = /battery[-\s]?disconnect resets|\bbattery reset\b|operations required after disconnecting battery/i

export const ALIGN_INVOICE_NAMES = ['4-Way Alignment', 'Wheel Alignment', 'Four-Wheel Alignment']
export const BATTERY_INVOICE_NAMES = ['Battery-Disconnect Resets', 'Battery Reset', 'Operations Required after Disconnecting Battery']

function parseRules(billingRulesOrShop) {
  const raw = billingRulesOrShop?.billing_rules ?? billingRulesOrShop
  if (!raw) return {}
  if (typeof raw === 'string') { try { return JSON.parse(raw) || {} } catch { return {} } }
  return typeof raw === 'object' ? raw : {}
}

function keyOf(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function alignmentInvoiceOn(billingRulesOrShop) {
  return parseRules(billingRulesOrShop).invoice_4way_alignment === true
}

export function isFourWayAlignmentRow(c) {
  return [c?.calibration_name, c?.operation_title, c?.name].some(n => ALIGN_NAME.test(String(n || '').trim()))
}

export function isBatteryResetRow(c) {
  const n = [c?.calibration_name, c?.operation_title, c?.name].filter(Boolean).join(' ')
  return BATTERY_NAME.test(n)
}

/** Item Map hit with a real catalog price, or null. */
export function pricedMappedItem(itemMap, allItems, names) {
  if (!itemMap) return null
  for (const name of names || []) {
    const entry = itemMap[keyOf(name)]
    if (!entry) continue
    const item = (allItems || []).find(i => (entry.item_id && String(i.item_id) === String(entry.item_id)) || (entry.item_name && keyOf(i.name) === keyOf(entry.item_name)))
    if (item && Number(item.rate) > 0) return { item_id: item.item_id || null, name: item.name, rate: Number(item.rate) }
  }
  return null
}

/** Catalog service whose name is one of the known rows and already has a price. */
export function pricedCatalogService(services, names) {
  const keys = new Set((names || []).map(keyOf))
  const hit = (services || []).find(s => keys.has(keyOf(s.name)) && Number(s.unit_price || s.rate) > 0)
  if (!hit) return null
  return { item_id: hit.zoho_item_id || hit.item_id || null, id: hit.id || null, name: hit.name, rate: Number(hit.unit_price || hit.rate) }
}

/**
 * null = leave this row off the invoice.
 * object = invoice this existing priced item (quantity 1, no labor hour).
 * undefined = not an alignment or battery-reset row.
 */
export function invoiceLineForReportRow(cal, { alignmentOn = false, mappedItem = null } = {}) {
  const four = isFourWayAlignmentRow(cal)
  const bat = isBatteryResetRow(cal)
  if (!four && !bat) return undefined
  if (four && alignmentOn !== true) return null
  if (!mappedItem || !(Number(mappedItem.rate) > 0)) return null
  return {
    name: mappedItem.name,
    item_id: mappedItem.item_id || null,
    id: mappedItem.id || null,
    rate: Number(mappedItem.rate),
    quantity: 1,
    hours: null,
  }
}
