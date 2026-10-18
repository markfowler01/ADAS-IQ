// Jayden's letter: calibrations, pre/post scans, diagnostics and labor count
// toward the monthly bonus. Calibration ID, technology, and other
// pass-through fees do not. Cash is still the payment amount; these lines
// are taken out in proportion to what that payment covered.
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { getAccessToken } from './zoho.js'

const round2 = n => Math.round((Number(n) || 0) * 100) / 100

// Line NAMES only. Programming and labor stay in. Travel is our own charge.
export function isPassThroughLine(name) {
  const n = String(name || '')
  if (/calibration identification/i.test(n)) return true
  if (/security access/i.test(n)) return true
  if (/gateway access/i.test(n)) return true
  if (/\btechnology\b/i.test(n)) return true
  if (/pass[- ]?through/i.test(n)) return true
  return false
}

export function lineAmount(line) {
  if (line?.item_total != null && line.item_total !== '') return Number(line.item_total) || 0
  if (line?.amount != null && line.amount !== '') return Number(line.amount) || 0
  const rate = Number(line?.rate) || 0
  const qty = Number(line?.quantity ?? 1) || 0
  const discount = Number(line?.discount_amount) || 0
  return rate * qty - discount
}

// excluded = dollars on pass-through lines. base = every line, so a partial
// payment drops the same fraction of those fees.
//
// Item cost (Mark 2026-10-17): any Books item with a purchase cost only
// counts what we keep. "Remote Expert – Mercedes Programming" sold at $500
// with a $450 cost puts $50 toward the bonus; set cost = price and it puts $0.
// OEM per-use programming fees work the same way.
export function passThroughTotals(lines, costs = {}) {
  let excluded = 0
  let base = 0
  for (const line of lines || []) {
    const amount = lineAmount(line)
    base += amount
    if (isPassThroughLine(line?.name || line?.item_name)) { excluded += Math.max(0, amount); continue }
    const unit = Number(costs[String(line?.item_id || '')]) || 0
    if (unit > 0 && amount > 0) excluded += Math.min(amount, unit * (Number(line?.quantity ?? 1) || 1))
  }
  return { excluded: round2(excluded), base: round2(base) }
}

// item_id → purchase cost, from Books items. Remembered in AppConfig for 6h
// so a cost Mark changes in Books shows up the same day.
const COST_KEY = 'books_item_costs'
export async function loadItemCosts(req, token) {
  if (req._itemCosts) return req._itemCosts
  const app = catalyst.initialize(req)
  let row = null
  try { const r = await app.zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${COST_KEY}' LIMIT 1`); row = r?.[0]?.AppConfig || r?.[0] || null } catch { /* none */ }
  try { const v = row?.config_value ? JSON.parse(row.config_value) : null; if (v?.at && Date.now() - new Date(v.at).getTime() < 6 * 3600 * 1000) return (req._itemCosts = v.costs || {}) } catch { /* refetch */ }
  const costs = {}
  try {
    for (let page = 1; page <= 10; page++) {
      const r = await booksGet(token, '/items', { per_page: 200, page }, 12000)
      const items = r.data?.items || []
      for (const it of items) { const c = Number(it.purchase_rate) || 0; if (c > 0) costs[String(it.item_id)] = c }
      if (!r.data?.page_context?.has_more_page) break
    }
    const value = JSON.stringify({ at: new Date().toISOString(), costs })
    const table = app.datastore().table('AppConfig')
    if (row?.ROWID) await table.updateRow({ ROWID: String(row.ROWID), config_key: COST_KEY, config_value: value })
    else await table.insertRow({ config_key: COST_KEY, config_value: value })
  } catch (e) { console.warn('[bonus-fees] item costs', e.message) }
  return (req._itemCosts = costs)
}

export function eligibleCash(payment, info) {
  const amount = round2(payment)
  if (!info || !(info.excluded > 0)) return { eligible: amount, excluded: 0 }
  // Invoice total (after discount, with tax) when we have it, so tax doesn't
  // make a $15 fee look like more than $15 of the cash.
  const denom = Math.max(info.base || 0, info.total || 0, amount)
  if (!(denom > 0)) return { eligible: amount, excluded: 0 }
  const cut = Math.min(info.excluded, amount, round2(amount * (info.excluded / denom)))
  return { eligible: round2(amount - cut), excluded: cut }
}

// ── Books line items, remembered so the next bonus view does not refetch ──

const BOOKS = 'https://www.zohoapis.com/books/v3'
const q = s => String(s ?? '').replace(/'/g, "''")
const feeKey = n => `bex2:${String(n).replace(/[^A-Za-z0-9._-]/g, '_')}`

function parseCached(raw) {
  try {
    const v = JSON.parse(raw)
    if (!v || typeof v !== 'object') return null
    return { excluded: round2(v.e), base: round2(v.b), total: v.t == null ? null : round2(v.t) }
  } catch { return null }
}

async function readCached(app, numbers) {
  const out = {}
  for (let i = 0; i < numbers.length; i += 40) {
    const chunk = numbers.slice(i, i + 40)
    let rows = []
    try {
      rows = await app.zcql().executeZCQLQuery(
        `SELECT config_key, config_value FROM AppConfig WHERE config_key IN (${chunk.map(n => `'${q(feeKey(n))}'`).join(',')})`
      )
    } catch (e) { console.warn('[bonus-fees] cache read', e.message); continue }
    for (const row of rows || []) {
      const x = row.AppConfig || row
      const hit = chunk.find(n => feeKey(n) === x.config_key)
      const parsed = parseCached(x.config_value)
      if (hit && parsed) out[hit] = parsed
    }
  }
  return out
}

async function remember(app, number, info, invoiceTotal) {
  const key = feeKey(number)
  const value = JSON.stringify({ e: info.excluded, b: info.base, t: invoiceTotal == null ? null : round2(invoiceTotal) })
  const table = app.datastore().table('AppConfig')
  try {
    const rows = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = '${q(key)}' LIMIT 1`)
    const existing = rows?.[0]?.AppConfig || rows?.[0] || null
    if (existing?.ROWID) await table.updateRow({ ROWID: String(existing.ROWID), config_key: key, config_value: value })
    else await table.insertRow({ config_key: key, config_value: value })
  } catch (e) { console.warn('[bonus-fees] cache write', number, e.message) }
}

async function invoiceIds(app, numbers) {
  const map = {}
  for (let i = 0; i < numbers.length; i += 40) {
    const chunk = numbers.slice(i, i + 40)
    try {
      const rows = await app.zcql().executeZCQLQuery(
        `SELECT invoice_number, zoho_invoice_id, inv_total FROM AdasInvoices WHERE invoice_number IN (${chunk.map(n => `'${q(n)}'`).join(',')})`
      )
      for (const row of rows || []) {
        const x = row.AdasInvoices || row
        if (x.invoice_number) map[x.invoice_number] = { id: String(x.zoho_invoice_id || ''), total: round2(x.inv_total) }
      }
    } catch (e) { console.warn('[bonus-fees] invoice lookup', e.message) }
  }
  return map
}

function booksGet(token, path, params, timeout = 8000) {
  return axios.get(`${BOOKS}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    params: { organization_id: process.env.ZOHO_ORGANIZATION_ID, ...params },
    timeout,
    validateStatus: s => s < 500,
  })
}

async function linesForInvoice(token, id) {
  const r = await booksGet(token, `/invoices/${id}`, {}, 10000)
  return r.data?.invoice?.line_items || null
}

async function idByNumber(token, number) {
  const r = await booksGet(token, '/invoices', { invoice_number: String(number) }, 8000)
  const candidates = r.data?.invoices || []
  const inv = candidates.find(i => i.invoice_number === String(number)) || candidates[0]
  return inv?.invoice_id ? String(inv.invoice_id) : ''
}

async function pool(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/**
 * invoice number → { excluded, base } for the pass-through lines.
 * `pending` is how many invoices we could not read this call.
 */
export async function loadPassThrough(req, numbers) {
  const want = [...new Set((numbers || []).map(n => String(n || '').trim()).filter(Boolean))]
  req._bonusFees = req._bonusFees || {}
  const cachedOnReq = req._bonusFees
  const pending = []
  const known = {}
  const missing = []
  for (const n of want) {
    if (cachedOnReq[n]) known[n] = cachedOnReq[n]
    else missing.push(n)
  }
  if (!missing.length) return { byInvoice: known, pending: 0 }

  const app = catalyst.initialize(req)
  const stored = await readCached(app, missing)
  const ids = await invoiceIds(app, missing)
  const stale = []
  for (const n of missing) {
    const hit = stored[n]
    const mirrorTotal = ids[n]?.total
    const totalChanged = hit && mirrorTotal && hit.total != null && Math.abs(hit.total - mirrorTotal) > 0.009
    if (hit && !totalChanged) { known[n] = hit; cachedOnReq[n] = hit }
    else stale.push(n)
  }
  if (!stale.length) return { byInvoice: known, pending: 0 }

  let token = ''
  try { token = await getAccessToken() } catch (e) {
    console.warn('[bonus-fees] no Books token', e.message)
    return { byInvoice: known, pending: stale.length }
  }
  // One budget for the whole request, so the all-tech view doesn't start
  // a fresh 18 seconds for every technician.
  req._bonusFeeDeadline = req._bonusFeeDeadline || Date.now() + 18000
  await pool(stale, 6, async number => {
    if (Date.now() > req._bonusFeeDeadline) { pending.push(number); return }
    let id = ids[number]?.id
    try {
      if (!id) id = await idByNumber(token, number)
      if (!id) { pending.push(number); return }
      const lines = await linesForInvoice(token, id)
      if (!lines) { pending.push(number); return }
      const totals = passThroughTotals(lines, await loadItemCosts(req, token))
      const info = { ...totals, total: ids[number]?.total ?? null }
      known[number] = info
      cachedOnReq[number] = info
      await remember(app, number, totals, ids[number]?.total ?? null)
    } catch (e) {
      console.warn('[bonus-fees] invoice lines', number, e.message)
      pending.push(number)
    }
  })
  return { byInvoice: known, pending: pending.length }
}
