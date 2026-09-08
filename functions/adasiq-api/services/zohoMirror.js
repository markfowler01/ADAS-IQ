// Zoho Books → app read-only MIRROR (Mark 2026-09-07, books scan B-02).
//
// Zoho stays the system of record. This layer pulls invoices + customer
// payments into DURABLE Datastore tables so the app can show AR-by-shop,
// aging, and job-linked money without ever writing to Zoho. Nothing
// existing is touched: the legacy cache-backed Books module keeps its
// own paths.
//
// Storage (all Datastore, never Cache) — tables created via Catalyst MCP
// 2026-09-07:
//   AdasInvoices   one row per Zoho invoice   (key zoho_invoice_id, bucketed by inv_month)
//   AdasPayments   one row per Zoho payment   (key zoho_payment_id, bucketed by pay_month)
//   AppConfig      zb_meta → { last_sync, months, last_run }
//                  zb_mirror:<YYYY-MM-DD> → nightly stamp
//
// Column names carry inv_/pay_ prefixes because Datastore rejects
// reserved words (date, status, …) as column names.
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { getAccessToken } from './zoho.js'

const ZOHO_API_BASE = 'https://www.zohoapis.com/books/v3'
const BATCH = 100        // rows per Datastore bulk call
const ZCQL_PAGE = 300    // hard ZCQL cap per SELECT

const orgParam = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })
const hdr = token => ({ Authorization: `Zoho-oauthtoken ${token}` })
const q = s => String(s ?? '').replace(/'/g, "''")
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

// ── Datastore helpers ───────────────────────────────────────────────────
// ZCQL results come wrapped { TableName: {...} }; ROWIDs must stay strings.
async function zcqlAll(app, table, sqlNoLimit) {
  const out = []
  for (let off = 0; ; off += ZCQL_PAGE) {
    const rows = await app.zcql().executeZCQLQuery(`${sqlNoLimit} LIMIT ${off}, ${ZCQL_PAGE}`)
    const batch = (rows || []).map(r => r?.[table] || r).filter(Boolean)
    out.push(...batch)
    if (batch.length < ZCQL_PAGE) break
  }
  return out
}

// AppConfig index rows for the small bits of state (meta + nightly stamp).
async function cfgRow(app, key) {
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${q(key)}' LIMIT 1`
  ).catch(() => [])
  return rows?.[0]?.AppConfig || rows?.[0] || null
}
async function cfgSet(app, key, value) {
  const table = app.datastore().table('AppConfig')
  const str = JSON.stringify(value)
  const r = await cfgRow(app, key)
  if (r?.ROWID) await table.updateRow({ ROWID: String(r.ROWID), config_value: str })
  else await table.insertRow({ config_key: key, config_value: str })
  const check = await cfgRow(app, key)
  if (!check?.config_value) throw new Error(`Mirror write did not persist: ${key}`)
}
async function cfgGet(app, key, fallback) {
  const r = await cfgRow(app, key)
  try { return r?.config_value ? JSON.parse(r.config_value) : fallback } catch { return fallback }
}

// ── Table maps: app-facing record shape ⇄ Datastore row ────────────────
// The app-facing shape is unchanged from the AppConfig era, so the
// routes + ZohoMirrorTab keep working as-is.
const KINDS = {
  inv: {
    table: 'AdasInvoices', key: 'zoho_invoice_id', month: 'inv_month',
    toRow: (i, ym, synced_at) => ({
      zoho_invoice_id: i.invoice_id, invoice_number: i.invoice_number, customer_id: i.customer_id,
      customer_name: String(i.customer_name || '').slice(0, 255), salesperson_name: String(i.salesperson_name || '').slice(0, 100),
      reference_number: String(i.reference_number || '').slice(0, 255), inv_status: i.status,
      inv_date: i.date, inv_due_date: i.due_date, inv_total: r2(i.total), inv_balance: r2(i.balance),
      last_payment_date: i.last_payment_date, zoho_updated_time: String(i.updated_time || '').slice(0, 40),
      inv_month: ym, synced_at,
    }),
    fromRow: r => ({
      invoice_id: String(r.zoho_invoice_id || ''), invoice_number: r.invoice_number || '',
      customer_id: String(r.customer_id || ''), customer_name: r.customer_name || '',
      salesperson_name: r.salesperson_name || '', reference_number: r.reference_number || '',
      status: r.inv_status || '', date: r.inv_date || '', due_date: r.inv_due_date || '',
      total: r2(r.inv_total), balance: r2(r.inv_balance), last_payment_date: r.last_payment_date || '',
      updated_time: r.zoho_updated_time || '', job_ref: r.job_ref || '',
    }),
    amount: i => i.total,
  },
  pay: {
    table: 'AdasPayments', key: 'zoho_payment_id', month: 'pay_month',
    toRow: (p, ym, synced_at) => ({
      zoho_payment_id: p.payment_id, payment_number: p.payment_number, customer_id: p.customer_id,
      customer_name: String(p.customer_name || '').slice(0, 255), pay_date: p.date, pay_amount: r2(p.amount),
      payment_mode: String(p.payment_mode || '').slice(0, 50), reference_number: String(p.reference_number || '').slice(0, 255),
      invoice_numbers: String(p.invoice_numbers || '').slice(0, 10000), pay_description: String(p.description || '').slice(0, 10000),
      pay_month: ym, synced_at,
    }),
    fromRow: r => ({
      payment_id: String(r.zoho_payment_id || ''), payment_number: r.payment_number || '',
      customer_id: String(r.customer_id || ''), customer_name: r.customer_name || '',
      date: r.pay_date || '', amount: r2(r.pay_amount), payment_mode: r.payment_mode || '',
      reference_number: r.reference_number || '', invoice_numbers: r.invoice_numbers || '',
      description: r.pay_description || '',
    }),
    amount: p => p.amount,
  },
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
  })).filter(i => i.invoice_id)
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
  })).filter(p => p.payment_id)
}

// ── Month upsert (idempotent: Zoho is truth, keyed by Zoho id) ──────────
// 1. rows already in the table for this month  → stale-candidate set
// 2. rows already in the table for these Zoho ids (any month — an invoice
//    re-dated across months must UPDATE, not violate the unique key)
// 3. insert new / update known / delete what Zoho no longer returns for
//    the month, then write-verify the row count.
async function writeMonth(app, kind, ym, records) {
  const K = KINDS[kind]
  const table = app.datastore().table(K.table)
  const synced_at = new Date().toISOString()

  const inMonth = await zcqlAll(app, K.table, `SELECT ROWID, ${K.key} FROM ${K.table} WHERE ${K.month} = '${q(ym)}'`)
  const rowidByKey = new Map(inMonth.map(r => [String(r[K.key]), String(r.ROWID)]))
  const ids = records.map(r => String(kind === 'inv' ? r.invoice_id : r.payment_id))
  for (const part of chunk(ids, 100)) {
    const found = await zcqlAll(app, K.table,
      `SELECT ROWID, ${K.key} FROM ${K.table} WHERE ${K.key} IN (${part.map(id => `'${q(id)}'`).join(',')})`)
    for (const r of found) rowidByKey.set(String(r[K.key]), String(r.ROWID))
  }

  const inserts = [], updates = []
  const keep = new Set()
  for (const rec of records) {
    const row = K.toRow(rec, ym, synced_at)
    const rid = rowidByKey.get(String(row[K.key]))
    keep.add(String(row[K.key]))
    if (rid) updates.push({ ROWID: rid, ...row })
    else inserts.push(row)
  }
  const stale = inMonth.filter(r => !keep.has(String(r[K.key]))).map(r => String(r.ROWID))

  for (const b of chunk(inserts, BATCH)) await table.insertRows(b)
  for (const b of chunk(updates, BATCH)) await table.updateRows(b)
  for (const b of chunk(stale, BATCH)) await table.deleteRows(b)

  const after = await zcqlAll(app, K.table, `SELECT ROWID FROM ${K.table} WHERE ${K.month} = '${q(ym)}'`)
  if (after.length !== records.length) {
    throw new Error(`Mirror write did not persist for ${K.table} ${ym}: expected ${records.length} rows, found ${after.length}`)
  }
  const total = records.reduce((s, r) => s + K.amount(r), 0)
  return { count: records.length, total, inserted: inserts.length, updated: updates.length, removed: stale.length }
}

export async function readMonth(req, kind, ym) {
  const K = KINDS[kind]
  const app = catalyst.initialize(req)
  const rows = await zcqlAll(app, K.table, `SELECT * FROM ${K.table} WHERE ${K.month} = '${q(ym)}' ORDER BY ROWID`)
  return rows.map(K.fromRow)
}
export async function readAll(req, kind) {
  const K = KINDS[kind]
  const app = catalyst.initialize(req)
  const rows = await zcqlAll(app, K.table, `SELECT * FROM ${K.table} ORDER BY ROWID`)
  return rows.map(K.fromRow)
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
    const entry = { month: ym, invoices: invs.length, invoice_total: r2(it), payments: pays.length, payment_total: r2(pt) }
    if (!dryRun) {
      const wi = await writeMonth(app, 'inv', ym, invs)
      const wp = await writeMonth(app, 'pay', ym, pays)
      entry.writes = { invoices: { inserted: wi.inserted, updated: wi.updated, removed: wi.removed }, payments: { inserted: wp.inserted, updated: wp.updated, removed: wp.removed } }
    }
    result.months.push(entry)
    result.invoices += invs.length; result.payments += pays.length
    result.invoice_total += it; result.payment_total += pt
  }
  result.invoice_total = r2(result.invoice_total)
  result.payment_total = r2(result.payment_total)
  if (!dryRun) {
    const meta = await cfgGet(app, 'zb_meta', { months: [] })
    const known = new Set([...(meta.months || []), ...months])
    await cfgSet(app, 'zb_meta', { last_sync: new Date().toISOString(), months: [...known].sort(), last_run: result, storage: 'datastore' })
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
  const all = await readAll(req, 'inv')
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
