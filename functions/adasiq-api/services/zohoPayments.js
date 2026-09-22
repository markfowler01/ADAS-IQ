// Zoho Payments on every invoice (Mark 2026-09-22: "I need every invoice to
// have this enabled"). Invoices the app creates already carry the gateway.
// The gap was Kat's (and Mark's) "Convert to invoice" on a Books quote —
// the quote has no payment option, so the invoice comes out with the Zoho
// Payments box unchecked. Fix: PUT payment_options on the invoice when
// Books tells us it was created (webhook) and hourly for anything unpaid.
// Each invoice is touched ONCE (AppConfig `zoho_payments_done`) — an update
// re-fires the Books workflow, so a second PUT would loop.
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { getAccessToken, listInvoicesForDateRange } from './zoho.js'

const API = 'https://www.zohoapis.com/books/v3'
const org = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })
const H = t => ({ Authorization: `Zoho-oauthtoken ${t}`, 'Content-Type': 'application/json' })
const KEY = 'zoho_payments_done'
const UNPAID = new Set(['sent', 'overdue', 'partially_paid', 'viewed', 'unpaid'])

// AppConfig text columns cap at ~10k chars: store bare ids, newest last, keep 400 (~9k).
async function readDone(req) {
  try {
    const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${KEY}' LIMIT 1`)
    const r = rows?.[0]?.AppConfig; if (!r) return { row: null, ids: new Set() }
    return { row: String(r.ROWID), ids: new Set(JSON.parse(r.config_value || '[]')) }
  } catch { return { row: null, ids: new Set() } }
}
async function writeDone(req, row, ids) {
  const value = JSON.stringify([...ids].slice(-400))
  const t = catalyst.initialize(req, { type: 'advancedio' }).datastore().table('AppConfig')
  if (row) await t.updateRow({ ROWID: row, config_key: KEY, config_value: value }); else await t.insertRow({ config_key: KEY, config_value: value })
}

export async function enableZohoPayments(token, invoiceId) {
  const r = await axios.put(`${API}/invoices/${invoiceId}`, { payment_options: { payment_gateways: [{ gateway_name: 'zoho_payments', configured: true }] } }, { headers: H(token), params: org(), timeout: 15000, validateStatus: s => s < 500 })
  if (r.data?.code !== 0) throw new Error(r.data?.message || `HTTP ${r.status}`)
  return true
}

// One invoice, once. Called from the Books webhook with the invoice payload.
export async function ensureZohoPayments(req, invoice) {
  const id = String(invoice?.invoice_id || ''); if (!id) return { done: false, why: 'no id' }
  const status = String(invoice?.status || '').toLowerCase()
  if (status && !UNPAID.has(status) && status !== 'draft') return { done: false, why: status }
  const { row, ids } = await readDone(req)
  if (ids.has(id)) return { done: false, why: 'already' }
  ids.add(id); await writeDone(req, row, ids)   // stamp first — never twice
  try { await enableZohoPayments(await getAccessToken(), id); console.log(`[zoho-payments] on · ${invoice.invoice_number || id}`); return { done: true } }
  catch (e) { console.log(`[zoho-payments] failed · ${invoice.invoice_number || id}: ${e.message}`); return { done: false, why: e.message } }
}

// Hourly: every unpaid invoice from the last 120 days, once each.
export async function sweepZohoPayments(req) {
  const today = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const invoices = (await listInvoicesForDateRange(from, today)).filter(i => UNPAID.has(i.status))
  const { row, ids } = await readDone(req)
  const todo = invoices.filter(i => !ids.has(String(i.invoice_id)))
  if (!todo.length) return { checked: invoices.length, enabled: 0 }
  const token = await getAccessToken()
  let enabled = 0, failed = 0
  // Gateway caps a call at 30s — 8 per run, the hourly piggyback finishes the rest.
  const batch = todo.slice(0, 8)
  for (const inv of batch) {
    ids.add(String(inv.invoice_id))
    try { await enableZohoPayments(token, inv.invoice_id); enabled++ } catch (e) { failed++; console.log(`[zoho-payments] sweep failed · ${inv.invoice_number}: ${e.message}`) }
  }
  await writeDone(req, row, ids)
  console.log(`[zoho-payments] sweep: ${enabled} switched on, ${failed} failed, ${todo.length - batch.length} left, ${invoices.length} unpaid checked`)
  return { checked: invoices.length, enabled, failed, remaining: todo.length - batch.length }
}
