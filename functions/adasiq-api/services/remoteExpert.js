// 🕶 Remote Expert, tracked quietly (Mark 2026-10-17: "I don't want remote
// expert to be on the invoice either; it needs to be coded kind of
// secretly"). Nothing touches the invoice or the shop. The app reads Autel's
// "Remote Expert order completion/cancellation" emails in mf@, matches each
// order to our invoice by year/make/model + date (the invoice custom fields
// cf_year/cf_make/cf_model), and the tech bonus drops that order's fee from
// the invoice's cash. Fees: AppConfig remote_expert_fees
// { "default": 450, "makes": { "mercedes": 450 } }.
//
// Email shape (Autel, 2026-09-18):
//   "Sheldon Smith has requested completion of order number 2101075021817327617 …
//    Order Number: 2101075021817327617  Model Information: 2026/ZDX/Acura"
import axios from 'axios'
import { getAccessToken } from './zoho.js'

const ORDERS_KEY = 're_orders'
const FEES_KEY = 're_fees_config'
const BOOKS = 'https://www.zohoapis.com/books/v3'
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

async function cfg() { return import('../routes/people.js') }
export async function readOrders(req) { const { cfgReadJson } = await cfg(); return (await cfgReadJson(req, ORDERS_KEY, null)) || { orders: {}, seen: [] } }
async function writeOrders(req, v) { const { cfgWriteJson } = await cfg(); return cfgWriteJson(req, ORDERS_KEY, v) }
export async function readFees(req) { const { cfgReadJson } = await cfg(); return (await cfgReadJson(req, FEES_KEY, null)) || { default: 450, makes: {} } }
export async function writeFees(req, v) { const { cfgWriteJson } = await cfg(); return cfgWriteJson(req, FEES_KEY, { default: Number(v.default) || 0, makes: Object.fromEntries(Object.entries(v.makes || {}).map(([k, x]) => [norm(k), Number(x) || 0])) }) }
export function feeFor(fees, make) { const m = fees.makes?.[norm(make)]; return Number(m ?? fees.default) || 0 }

export function parseOrderEmail(text, subject = '') {
  const t = String(text || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
  const order = (t.match(/order number[:\s]*(\d{10,})/i) || [])[1]
  if (!order) return null
  const kind = /cancel/i.test(subject + ' ' + t.slice(0, 200)) ? 'cancel' : /complet/i.test(subject + ' ' + t.slice(0, 200)) ? 'complete' : 'other'
  const expert = (t.match(/Hello,?\s*(.+?) has requested/i) || [])[1] || ''
  const mi = (t.match(/Model Information:\s*(\d{4})\s*\/\s*([^/]+?)\s*\/\s*([A-Za-z][A-Za-z -]*?)(?:\s{2,}|$|\s(?:Please|Thank|If)\b)/i) || [])
  return { order, kind, expert: expert.trim(), year: mi[1] || '', model: (mi[2] || '').trim(), make: (mi[3] || '').trim() }
}

// Books invoices dated around the order, read in detail for Year/Make/Model.
async function findInvoice(token, o) {
  const d = new Date(o.at)
  const from = new Date(d.getTime() - 3 * 86400000).toISOString().slice(0, 10)
  const to = new Date(d.getTime() + 14 * 86400000).toISOString().slice(0, 10)
  const params = { organization_id: process.env.ZOHO_ORGANIZATION_ID }
  const list = (await axios.get(`${BOOKS}/invoices`, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { ...params, date_start: from, date_end: to, per_page: 200 }, timeout: 15000, validateStatus: s => s < 500 })).data?.invoices || []
  const cand = list.filter(i => !/void|draft/i.test(String(i.status || '')))
  const hits = []
  for (const i of cand.slice(0, 40)) {
    try {
      const inv = (await axios.get(`${BOOKS}/invoices/${i.invoice_id}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, params, timeout: 12000 })).data?.invoice
      const cf = Object.fromEntries((inv?.custom_fields || []).map(c => [c.api_name, String(c.value ?? '')]))
      const text = `${cf.cf_year || ''} ${cf.cf_make || ''} ${cf.cf_model || ''} ${(inv?.line_items || []).map(l => l.description || '').join(' ')}`
      const okYear = !o.year || norm(text).includes(o.year)
      const okModel = !o.model || norm(text).includes(norm(o.model))
      const okMake = !o.make || norm(text).includes(norm(o.make).slice(0, 4))
      if (okYear && okModel && okMake) hits.push({ number: i.invoice_number, date: i.date, gap: Math.abs(new Date(i.date) - d) })
    } catch { /* skip one */ }
  }
  hits.sort((a, b) => a.gap - b.gap)
  return hits[0] || null
}

/** Hourly: read new Remote Expert emails, record orders, match to invoices. */
export async function maybeSyncRemoteExpert(req, { lookback = 60 } = {}) {
  const st = await readOrders(req)
  st.orders = st.orders || {}; st.seen = st.seen || []
  const out = { new: 0, matched: 0, unmatched: 0 }
  const M = await import('./mail.js')
  const mt = await M.getMailAccessToken()
  const acct = await M.getMailAccountIdFor(mt, 'mf@absoluteadas.com')
  const msgs = await M.searchMessages(mt, acct, 'subject:Remote Expert order', 50, 1).catch(() => [])
  const since = Date.now() - lookback * 86400000
  for (const m of msgs || []) {
    const id = String(m.messageId || ''); if (!id || st.seen.includes(id)) continue
    const at = Number(m.receivedTime) || Date.parse(m.receivedTime) || Date.now()
    if (at < since) { st.seen.push(id); continue }
    let body = m.summary || ''
    try { const c = await M.getMessageContent(mt, acct, m.folderId, id); body = c.content || body } catch { /* summary only */ }
    const p = parseOrderEmail(body, m.subject)
    st.seen.push(id)
    if (!p) continue
    const o = st.orders[p.order] || { order: p.order, at: new Date(at).toISOString() }
    Object.assign(o, { expert: p.expert || o.expert, year: p.year || o.year, model: p.model || o.model, make: p.make || o.make })
    if (p.kind === 'cancel' && !o.completed_at) o.cancelled_at = new Date(at).toISOString()
    if (p.kind === 'complete') { o.completed_at = new Date(at).toISOString(); delete o.cancelled_at }
    st.orders[p.order] = o; out.new++
  }
  // Match completed orders that have no invoice yet (invoices can lag the job).
  const token = await getAccessToken()
  for (const o of Object.values(st.orders)) {
    if (!o.completed_at || o.cancelled_at || o.invoice_number) continue
    if (Date.now() - Date.parse(o.completed_at) > 45 * 86400000) continue
    const hit = await findInvoice(token, { ...o, at: o.completed_at }).catch(() => null)
    if (hit) { o.invoice_number = hit.number; o.matched_at = new Date().toISOString(); out.matched++ } else out.unmatched++
  }
  st.seen = st.seen.slice(-400)
  await writeOrders(req, st)
  return out
}

/** invoice number → Remote Expert fee to take out of bonus cash. */
export async function remoteExpertFeesByInvoice(req) {
  const [st, fees] = await Promise.all([readOrders(req), readFees(req)])
  const by = {}
  for (const o of Object.values(st.orders || {})) {
    if (!o.invoice_number || !o.completed_at || o.cancelled_at) continue
    const fee = o.fee != null ? Number(o.fee) : feeFor(fees, o.make)
    by[o.invoice_number] = (by[o.invoice_number] || 0) + fee
  }
  return by
}
