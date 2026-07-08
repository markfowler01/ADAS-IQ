// Phone → CRM contact lookup. Powers the "Jake Arnold texted me" case:
// when an inbound SMS arrives on our Twilio numbers, the sender's phone
// gets matched against every phone we know for every shop in CRM
// (shop.phone + each shop.people[].phone), and the SMS Log + Cliq alert
// show the person's name and shop instead of just a raw number.
//
// The lookup runs on the /api/sms/threads polling loop (every 10s per
// browser tab), so we build a phone→contact index once per request from
// getAllShops rather than scanning shops on every match.

import { getAllShops } from '../routes/shops.js'

// Normalize to a comparable canonical form: last 10 digits. Handles all
// the shapes CRM data comes in — "(425) 555-1234", "+14255551234",
// "425.555.1234", etc.
export function normPhone(input) {
  if (!input) return ''
  const digits = String(input).replace(/\D/g, '')
  if (!digits) return ''
  // Drop the leading country code if present so "+14255551234" and
  // "4255551234" both compare equal.
  return digits.length > 10 ? digits.slice(-10) : digits
}

// Build a { last10digits: {contact_name, shop_name, phone, source} } index
// from the full shop list. Each shop can contribute multiple phones
// (main phone + every person's phone).
export function buildPhoneIndex(shops) {
  const idx = new Map()
  for (const shop of shops || []) {
    const shopMain = normPhone(shop.phone)
    if (shopMain && !idx.has(shopMain)) {
      idx.set(shopMain, {
        contact_name: shop.contact_name || '',
        shop_name:    shop.shop_name || '',
        phone:        shop.phone || '',
        source:       'shop_main',
        shop_id:      shop.id,
      })
    }
    for (const p of shop.people || []) {
      const pn = normPhone(p?.phone)
      if (pn && !idx.has(pn)) {
        idx.set(pn, {
          contact_name: p.name || shop.contact_name || '',
          shop_name:    shop.shop_name || '',
          phone:        p.phone || '',
          source:       'person',
          shop_id:      shop.id,
        })
      }
    }
  }
  return idx
}

// One-shot loader — fetches CRM shops + returns the phone index.
export async function loadPhoneIndex(req) {
  try {
    const shops = await getAllShops(req)
    return buildPhoneIndex(shops)
  } catch (e) {
    console.warn('[crmContacts] loadPhoneIndex failed:', e.message)
    return new Map()
  }
}

// Convenience — one-off lookup for a single phone.
export async function findContactByPhone(req, phone) {
  const idx = await loadPhoneIndex(req)
  return idx.get(normPhone(phone)) || null
}

// Format a contact into the label the UI wants: "Jake Arnold · L-M Body Shop"
export function contactLabel(contact) {
  if (!contact) return ''
  const name = (contact.contact_name || '').trim()
  const shop = (contact.shop_name || '').trim()
  if (name && shop) return `${name} · ${shop}`
  return name || shop || ''
}
