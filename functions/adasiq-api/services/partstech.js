// PartsTech punchout (Mark 2026-09-22: "can we build this into our system?"
// — parts ordering like Tekmetric). Flow: create a punchout session on the
// estimate's VIN → Mark shops in PartsTech → PartsTech POSTs the cart to
// our callback → the parts land on the estimate as part lines with cost,
// supplier and PO → Mark's parts markup applies. Spec: api-docs.partstech.com
// (openapi 2.021). Credentials are pasted by Mark in Estimator settings —
// never typed here, never echoed back.
import axios from 'axios'

const BASE = process.env.PARTSTECH_API_BASE || 'https://api.partstech.com'
const KEYS = ['partner_id', 'partner_key', 'user_id', 'user_key']

export function partsTechConfigured(settings) {
  const p = settings?.partstech || {}
  return KEYS.every(k => String(p[k] || '').trim())
}
// What the settings screen may see: ids in the clear, keys as dots.
export function maskPartsTech(settings) {
  const p = settings?.partstech || {}
  return { partner_id: p.partner_id || '', user_id: p.user_id || '', partner_key: p.partner_key ? '••••••••' : '', user_key: p.user_key ? '••••••••' : '', connected: partsTechConfigured(settings) }
}
// PUT /settings: dots or blanks keep the stored key; anything else replaces it.
export function mergePartsTech(cur, incoming) {
  if (!incoming || typeof incoming !== 'object') return cur?.partstech || {}
  const out = { ...(cur?.partstech || {}) }
  for (const k of KEYS) {
    const v = String(incoming[k] ?? '').trim()
    if (!v || /^•+$/.test(v)) continue
    out[k] = v
  }
  return out
}

async function accessToken(settings) {
  const p = settings.partstech
  const r = await axios.post(`${BASE}/oauth/access`, { accessType: 'user', credentials: { user: { id: p.user_id, key: p.user_key }, partner: { id: p.partner_id, key: p.partner_key } } }, { timeout: 15000, validateStatus: s => s < 500 })
  if (r.status !== 200 || !r.data?.accessToken) throw new Error(`PartsTech sign-in failed (${r.status}): ${r.data?.message || r.data?.error || 'check the four keys in Estimator settings'}`)
  return r.data.accessToken
}
const H = t => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })

/** Create the punchout session. Returns { sessionId, redirectUrl }. */
export async function createQuoteSession(settings, { vin, urls, poNumber }) {
  const token = await accessToken(settings)
  const body = { searchParams: { vin }, urls, ...(poNumber ? { settings: { poNumber: String(poNumber).slice(0, 40) } } : {}) }
  const r = await axios.post(`${BASE}/punchout/quote/create`, body, { headers: H(token), timeout: 20000, validateStatus: s => s < 500 })
  if (r.status !== 200 || !r.data?.redirectUrl) throw new Error(`PartsTech could not start a session (${r.status}): ${r.data?.message || JSON.stringify(r.data || {}).slice(0, 200)}`)
  return { sessionId: r.data.sessionId, redirectUrl: r.data.redirectUrl }
}
/** Pull a session's quote/cart when the callback didn't reach us. */
export async function quoteInfo(settings, sessionId) {
  const token = await accessToken(settings)
  const r = await axios.post(`${BASE}/punchout/quote/info`, { sessionId }, { headers: H(token), timeout: 20000, validateStatus: s => s < 500 })
  if (r.status !== 200) throw new Error(`PartsTech quote lookup failed (${r.status}): ${r.data?.message || ''}`)
  return r.data
}

const OEM_RE = /dealer|oem|genuine|toyota|honda|ford|chevrolet|gm\b|nissan|hyundai|kia|subaru|mazda|bmw|mercedes|audi|volkswagen|vw\b|volvo|lexus|acura|infiniti|chrysler|dodge|jeep|ram\b|tesla|rivian/i
const money = v => Math.round((Number(v) || 0) * 100)

/** PartsTech orders[] → our part lines (one line per supplier order). */
export function ordersToLines(orders, { action = 'SUBMIT_QUOTE', sessionId = '', poNumber = '' } = {}) {
  const lines = []
  for (const o of Array.isArray(orders) ? orders : []) {
    const supplier = o.supplier?.name || o.supplier?.title || ''
    const store = o.store?.name || o.store?.title || ''
    const source = OEM_RE.test(`${supplier} ${store}`) ? 'oem' : 'aftermarket'
    const parts = (o.parts || []).map(p => {
      const pr = p.price && typeof p.price === 'object' ? p.price : {}
      const cost = pr.cost ?? pr.price ?? (typeof p.price === 'number' ? p.price : 0)
      const brand = typeof p.brand === 'string' ? p.brand : (p.brand?.name || '')
      return {
        pn: String(p.partNumber || '').slice(0, 60),
        desc: [p.partName, brand && !String(p.partName || '').toLowerCase().includes(brand.toLowerCase()) ? brand : '', supplier].filter(Boolean).join(' · ').slice(0, 200),
        source, qty: Number(p.quantity) > 0 ? Number(p.quantity) : 1,
        cost_cents: money(cost), markup_bp: null, price_cents: null, taxable: true,
      }
    }).filter(p => p.pn || p.desc)
    if (!parts.length) continue
    const orderNo = o.orderNumber || o.confirmationNumber || o.orderId || o.id || ''
    const bits = [`PartsTech ${action === 'PURCHASE' ? 'ORDER' : 'quote'}`, supplier + (store ? ` (${store})` : ''), poNumber ? `PO ${poNumber}` : '', orderNo ? `#${orderNo}` : '', o.delivery?.name ? `delivery: ${o.delivery.name}` : '', sessionId ? `session ${String(sessionId).slice(0, 10)}` : '']
    lines.push({ desc: `Parts — ${supplier || 'PartsTech'}`, rate_key: 'mechanical', hours: 0, rate_override_cents: null, flat_cents: null, taxable: true, notes: bits.filter(Boolean).join(' · ').slice(0, 500), parts })
  }
  return lines
}
