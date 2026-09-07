// Zoho Books → app read-only MIRROR (Mark 2026-09-07, books scan B-02).
//
// Zoho stays the system of record. This layer pulls invoices + customer
// payments into DURABLE Datastore rows (AppConfig, chunked by month,
// write-verified) so the app can show AR-by-shop, aging, and job-linked
// money without ever writing to Zoho. Nothing existing is touched: the
// legacy cache-backed Books module keeps its own paths.
//
// Storage (all Datastore, never Cache):
//   zb_inv_meta:<YYYY-MM>   → { chunks, count, total, synced_at }
//   zb_inv:<YYYY-MM>:<n>    → [invoice, …]  (≤ CHUNK records)
//   zb_pay_meta:<YYYY-MM>   → { chunks, count, total, synced_at }
//   zb_pay:<YYYY-MM>:<n>    → [payment, …]
//   zb_meta                 → { last_sync, months, invoices, payments }
//   zb_mirror:<YYYY-MM-DD>  → nightly stamp
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { getAccessToken } from './zoho.js'

const ZOHO_API_BASE = 'https://www.zohoapis.com/books/v3'
const CHUNK = 40

const orgParam = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })
const hdr = token => ({ Authorization: `Zoho-oauthtoken ${token}` })

// ── Datastore helpers (index-row pattern, write-verified) ───────────────
async function cfgRow(app, key) {
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key.replace(/'/g, "''")}' LIMIT 1`
  ).catch(() => [])
  return rows?.[0]?.AppConfig || rows?.[0] || null
}
async function cfgSet(app, key, value) {
  const table = app.datastore().table('AppConfig')
  const str = JSON.stringify(value)
  const r = await cfgRow(app, key)
  if (r?.ROWID) await table.updateRow({ ROWID: r.ROWID, config_value: str })
  else await table.insertRow({ config_key: key, config_value: str })
  const check = await cfgRow(app, key)
  if (!check?.config_value) throw new Error(`Mirror write did not persist: ${key}`)
}
async function cfgGet(app, key, fallback) {
  const r = await cfgRow(app, key)
  try { return r?.config_value ? JSON.parse(r.config_value) : fallback } catch { return fallback }
}
async function cfgDel(app, key) {
  const r = await cfgRow(app, key)
  if (r?.ROWID) await app.datastore().table('AppConfig').deleteRow(String(r.ROWID)).catch(() => {})
}

// ── Month helpers ───────────────────────────────────────────────────────
export function monthKey(dateStr) { return String(dateStr || '').slice(0, 7) }
export function monthsBetween(fromYM, toYM) {
  const out = []
  let [y, m] = fromYM.split('-').map(Number)
  const [ty, tm] = toYM.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}
export function todayPT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}` }
}

// ── Zoho pulls (read-only) ──────────────────────────────────────────────
async function pageAll(token, path, params, listKey) {
  const all = []
  let page = 1, more = true
  while (more && page <= 50) {
    const r = await axios.get(`${ZOHO_API_BASE}/${path}`, {
      headers: hdr(token), params: { ...orgParam(), per_page: 200, page, ...params }, timeout: 20000,
    })
    all.push(...(r.data?.[listKey] || []))
    more = r.data?.page_context?.has_more_page === true
    page++
  }
  return all
}

export async function fetchZohoInvoices(token, ym) {
  const { start, end } = monthRange(ym)
  const raw = await pageAll(token, 'invoices', { date_start: start, date_end: end }, 'invoices')
  return raw.map(inv => ({
    invoice_id:       String(inv.invoice_id || ''),
    invoice_number:   inv.invoice_number || '',
    customer_id:      String(inv.customer_id || ''),
    customer_name:    inv.customer_name || '',
    salesperson_name: inv.salesperson_name || '',
    reference_number: inv.reference_number || '',
    status:           String(inv.status || '').toLowerCase(),
    date:             inv.date || '',
    due_date:         inv.due_date || '',
    total:            Number(inv.total || 0) || 0,
    balance:          Number(inv.balance || 0) || 0,
    last_payment_date: inv.last_payment_date || '',
    updated_time:     inv.updated_time || inv.last_modified_time || '',
  }))
}

export async function fetchZohoPayments(token, ym) {
  const { start, end } = monthRange(ym)
  const raw = await pageAll(token, 'customerpayments', { date_start: start, date_end: end }, 'customerpayments')
  return raw.map(p => ({
    payment_id:       String(p.payment_id || ''),
    payment_number:   p.payment_number || '',
    customer_id:      String(p.customer_id || ''),
    customer_name:    p.customer_name || '',
    date:             p.date || '',
    amount:           Number(p.amount || 0) || 0,
    payment_mode:     p.payment_mode || '',
    reference_number: p.reference_number || '',
    invoice_numbers:  p.invoice_numbers || (Array.isArray(p.invoices) ? p.invoices.map(i => i.invoice_number).join(',') : ''),
    description:      p.description || '',
  }))
}

// ── Chunked month writes (idempotent: Zoho is truth, month is rebuilt) ──
async function writeMonth(app, kind, ym, records) {
  const metaKey = `zb_${kind}_meta:${ym}`
  const prev = await cfgGet(app, metaKey, { chunks: 0 })
  const chunks = []
  for (let i = 0; i < records.length; i += CHUNK) chunks.push(records.slice(i, i + CHUNK))
  for (let n = 0; n < chunks.length; n++) await cfgSet(app, `zb_${kind}:${ym}:${n}`, chunks[n])
  for (let n = chunks.length; n < (prev.chunks || 0); n++) await cfgDel(app, `zb_${kind}:${ym}:${n}`)
  const total = records.reduce((s, r) => s + (kind === 'inv' ? r.total : r.amount), 0)
  await cfgSet(app, metaKey, { chunks: chunks.length, count: records.length, total: Math.round(total * 100) / 100, synced_at: new Date().toISOString() })
  return { count: records.length, total }
}
export async function readMonth(req, kind, ym) {
  const app = catalyst.initialize(req)
  const meta = await cfgGet(app, `zb_${kind}_meta:${ym}`, null)
  if (!meta) return []
  const parts = await Promise.all(Array.from({ length: meta.chunks || 0 }, (_, n) => cfgGet(app, `zb_${kind}:${ym}:${n}`, [])))
  return parts.flat()
}

// ── Sync ────────────────────────────────────────────────────────────────
// dryRun = preview only: counts + totals, zero writes (Mark's rule: confirm
// before bulk mutations — the first full import is previewed first).
export async function syncMonths(req, months, { dryRun = false } = {}) {
  const app = catalyst.initialize(req)
  const token = await getAccessToken()
  const result = { dryRun, months: [], invoices: 0, payments: 0, invoice_total: 0, payment_total: 0 }
  for (const ym of months) {
    const [invs, pays] = await Promise.all([fetchZohoInvoices(token, ym), fetchZohoPayments(token, ym)])
    const it = invs.reduce((s, r) => s + r.total, 0)
    const pt = pays.reduce((s, r) => s + r.amount, 0)
    if (!dryRun) {
      await writeMonth(app, 'inv', ym, invs)
      await writeMonth(app, 'pay', ym, pays)
    }
    result.months.push({ month: ym, invoices: invs.length, invoice_total: Math.round(it * 100) / 100, payments: pays.length, payment_total: Math.round(pt * 100) / 100 })
    result.invoices += invs.length; result.payments += pays.length
    result.invoice_total += it; result.payment_total += pt
  }
  result.invoice_total = Math.round(result.invoice_total * 100) / 100
  result.payment_total = Math.round(result.payment_total * 100) / 100
  if (!dryRun) {
    const meta = await cfgGet(app, 'zb_meta', { months: [] })
    const known = new Set([...(meta.months || []), ...months])
    await cfgSet(app, 'zb_meta', { last_sync: new Date().toISOString(), months: [...known].sort(), last_run: result })
  }
  return result
}

export async function readMeta(req) {
  return cfgGet(catalyst.initialize(req), 'zb_meta', { last_sync: null, months: [] })
}

// ── Nightly refresh: current + previous two months (payments land late) ─
// Once per PT day, after 8pm. Stamp-then-run; non-fatal.
export async function maybeNightlyMirror(req) {
  const app = catalyst.initialize(req)
  const hourPT = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date()))
  if (hourPT < 20) return { fired: false, reason: 'before-window' }
  const meta = await readMeta(req)
  if (!meta.last_sync) return { fired: false, reason: 'no-initial-import' }  // never auto-start the first import
  const today = todayPT()
  const stampKey = `zb_mirror:${today}`
  if (await cfgGet(app, stampKey, null)) return { fired: false, reason: 'already' }
  await cfgSet(app, stampKey, new Date().toISOString())
  const cur = today.slice(0, 7)
  const [y, m] = cur.split('-').map(Number)
  const prev = n => { let mm = m - n, yy = y; while (mm < 1) { mm += 12; yy-- } return `${yy}-${String(mm).padStart(2, '0')}` }
  const months = [prev(2), prev(1), cur]
  const r = await syncMonths(req, months)
  return { fired: true, ...r }
}

// ── Summary: AR by shop, aging, MTD — computed from the mirror only ─────
export async function buildSummary(req) {
  const meta = await readMeta(req)
  const months = meta.months || []
  const today = todayPT()
  const all = (await Promise.all(months.map(ym => readMonth(req, 'inv', ym)))).flat()
  const open = all.filter(i => i.balance > 0 && !['draft', 'void'].includes(i.status))
  const daysPast = i => Math.max(0, Math.floor((new Date(today) - new Date(i.due_date || i.date)) / 86400000))
  const bucket = d => d <= 0 ? 'current' : d <= 30 ? '1-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+'
  const aging = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
  const byShop = {}
  for (const i of open) {
    const b = bucket(daysPast(i))
    aging[b] += i.balance
    const s = byShop[i.customer_name] || (byShop[i.customer_name] = { shop: i.customer_name, open: 0, count: 0, oldest_days: 0, buckets: { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 } })
    s.open += i.balance; s.count++; s.buckets[b] += i.balance
    s.oldest_days = Math.max(s.oldest_days, daysPast(i))
  }
  const cur = today.slice(0, 7)
  const mtd = all.filter(i => i.date.startsWith(cur) && !['draft', 'void'].includes(i.status))
  const paysCur = await readMonth(req, 'pay', cur)
  const r2 = n => Math.round(n * 100) / 100
  return {
    last_sync: meta.last_sync, months_mirrored: months.length,
    invoices_mirrored: all.length,
    ar_total: r2(open.reduce((s, i) => s + i.balance, 0)),
    open_count: open.length,
    aging: Object.fromEntries(Object.entries(aging).map(([k, v]) => [k, r2(v)])),
    mtd_invoiced: r2(mtd.reduce((s, i) => s + i.total, 0)),
    mtd_invoice_count: mtd.length,
    mtd_collected: r2(paysCur.reduce((s, p) => s + p.amount, 0)),
    by_shop: Object.values(byShop).map(s => ({ ...s, open: r2(s.open), buckets: Object.fromEntries(Object.entries(s.buckets).map(([k, v]) => [k, r2(v)])) })).sort((a, b) => b.open - a.open),
  }
}
