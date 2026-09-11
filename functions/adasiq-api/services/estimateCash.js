// Turn an existing Books quote into a customer-pay quote (Mark 2026-09-11:
// "automatically turn on the cash thing if the technician puts that — enable
// the 700 cap if Kat checks it at creation or the technician checks it at
// Ready to Invoice"). Kat's creation path already prices CP + $700 cap
// (services/cashPricing.js); this is the Ready-to-Invoice path: the tech
// picked $350 or $700, so the quote's total must land on exactly that.
//   • strips any earlier cap line
//   • adds "Cash cap — $<n> max" as a negative line when list > quoted
//   • leaves the lines themselves alone (Cal ID etc. sit inside the cap)
import axios from 'axios'
import { cashCapFor } from './cashPricing.js'

const API = 'https://www.zohoapis.com/books/v3'
const H = t => ({ Authorization: `Zoho-oauthtoken ${t}` })
const org = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })
export const isCapLine = l => /cash cap/i.test(String(l?.name || ''))

export async function applyCashCapToEstimate(token, estimateId, limit) {
  const lim = Number(limit)
  if (!estimateId || !(lim > 0)) return null
  const r = await axios.get(`${API}/estimates/${estimateId}`, { headers: H(token), params: org(), timeout: 15000, validateStatus: s => s < 500 })
  const est = r.data?.estimate
  if (!est) return null
  const keep = (est.line_items || []).filter(l => !isCapLine(l))
  const cap = cashCapFor(keep.map(l => ({ rate: l.rate, quantity: l.quantity })), lim)
  const lines = keep.map(li => ({ line_item_id: li.line_item_id, item_id: li.item_id, name: li.name, description: li.description || '', rate: li.rate, quantity: li.quantity }))
  if (cap.capped) {
    // Plain text name — Books renders emoji as "?" on the PDF.
    lines.push({ name: `Cash cap — $${lim} max`, description: `Customer pay — list total $${cap.list_total.toFixed(2)} reduced to the $${lim} the customer was told.`, rate: cap.adjustment, quantity: 1 })
  }
  const u = await axios.put(`${API}/estimates/${estimateId}`, { line_items: lines }, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 })
  if (u.data?.code !== 0) throw new Error(u.data?.message || `HTTP ${u.status}`)
  return { list_total: cap.list_total, total: cap.total, capped: cap.capped, estimate_number: est.estimate_number }
}
