// Absolute ADAS Books — Phase 1 (2026-09-15, Mark: "go").
// The AR mirror + the DRIFT NUMBER. Zoho Books stays the system of record.
// This layer pulls accounts (contacts), credit notes and payment→invoice
// allocations on top of the existing invoice/payment mirror (zohoMirror.js),
// computes every balance on its own, and reconciles against Books:
//   drift = Σ |app balance − Books outstanding| per account
// Nothing here writes to Zoho. Money is integer cents. Datastore only.
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { getAccessToken } from './zoho.js'
import { readAll, readMeta, monthsBetween, todayPT } from './zohoMirror.js'

const API = 'https://www.zohoapis.com/books/v3'
const org = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })
const H = t => ({ Authorization: `Zoho-oauthtoken ${t}` })
const q = s => String(s ?? '').replace(/'/g, "''")
const cents = n => Math.round((Number(n) || 0) * 100)
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
const now = () => new Date().toISOString()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const app = req => catalyst.initialize(req, { type: 'advancedio' })
const T = { acc: 'ArAccounts', cn: 'ArCreditNotes', al: 'ArAllocations', lg: 'ArLedger', sr: 'ArSyncRuns' }

async function zcqlAll(a, table, sql) {
  const out = []
  for (let off = 0; ; off += 300) {
    const rows = await a.zcql().executeZCQLQuery(`${sql} LIMIT ${off}, 300`)
    const b = (rows || []).map(r => r?.[table] || r).filter(Boolean)
    out.push(...b); if (b.length < 300) break
  }
  return out
}
async function cfgGet(a, key, fb) { const r = (await a.zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${q(key)}' LIMIT 1`).catch(() => []))?.[0]; const row = r?.AppConfig || r; try { return row?.config_value ? JSON.parse(row.config_value) : fb } catch { return fb } }
async function cfgSet(a, key, v) { const r = (await a.zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = '${q(key)}' LIMIT 1`).catch(() => []))?.[0]; const row = r?.AppConfig || r; const t = a.datastore().table('AppConfig'); if (row?.ROWID) await t.updateRow({ ROWID: String(row.ROWID), config_value: JSON.stringify(v) }); else await t.insertRow({ config_key: key, config_value: JSON.stringify(v) }) }
async function pageAll(token, path, params, key, max = 60) {
  const all = []
  for (let page = 1; page <= max; page++) {
    const r = await axios.get(`${API}/${path}`, { headers: H(token), params: { ...org(), per_page: 200, page, ...params }, timeout: 25000 })
    all.push(...(r.data?.[key] || []))
    if (r.data?.page_context?.has_more_page !== true) break
  }
  return all
}
async function logRun(req, kind, started, ok, counts, extra = {}, by = 'system') {
  try { await app(req).datastore().table(T.sr).insertRow({ sr_kind: kind, sr_started: started, sr_finished: now(), sr_ok: !!ok, sr_counts_json: JSON.stringify(counts || {}).slice(0, 9500), sr_drift_cents: extra.drift_cents || 0, sr_mismatched: extra.mismatched || 0, sr_unmatched: extra.unmatched || 0, sr_top_json: JSON.stringify(extra.top || []).slice(0, 9500), sr_error: String(extra.error || '').slice(0, 255), sr_by: by }) } catch (e) { console.log('[ar] run log failed:', e.message) }
}

// ── Import plan: every month from the first Books invoice to today ───────
export async function importPlan(req) {
  const token = await getAccessToken()
  const r = await axios.get(`${API}/invoices`, { headers: H(token), params: { ...org(), per_page: 1, page: 1, sort_column: 'date', sort_order: 'A' }, timeout: 20000 })
  const first = r.data?.invoices?.[0]?.date || todayPT()
  const meta = await readMeta(req)
  const all = monthsBetween(first.slice(0, 7), todayPT().slice(0, 7))
  const done = new Set(meta.months || [])
  return { first_invoice_date: first, months: all, remaining: all.filter(m => !done.has(m)), mirrored: [...done], last_sync: meta.last_sync }
}

// ── Accounts: every Books customer ──────────────────────────────────────
const accRow = (c, synced_at) => ({
  ac_contact_id: String(c.contact_id), ac_name: String(c.contact_name || '').slice(0, 200), ac_company: String(c.company_name || '').slice(0, 200), ac_email: String(c.email || '').slice(0, 200), ac_phone: String(c.phone || c.mobile || '').slice(0, 40),
  ac_kind: c.customer_sub_type === 'individual' ? 'individual' : 'business', ac_billing_json: JSON.stringify(c.billing_address || {}).slice(0, 4000), ac_terms: String(c.payment_terms_label || '').slice(0, 60), ac_status: String(c.status || '').slice(0, 20),
  ac_outstanding_cents: cents(c.outstanding_receivable_amount), ac_unused_credits_cents: cents(c.unused_credits_receivable_amount), ac_books_updated: String(c.last_modified_time || '').slice(0, 40), ac_synced_at: synced_at,
})
export const rowToAccount = r => ({
  id: String(r.ROWID), contact_id: r.ac_contact_id || '', name: r.ac_name || '', company: r.ac_company || '', email: r.ac_email || '', phone: r.ac_phone || '', kind: r.ac_kind || 'business', terms: r.ac_terms || '', status: r.ac_status || '',
  books_outstanding_cents: Number(r.ac_outstanding_cents) || 0, unused_credits_cents: Number(r.ac_unused_credits_cents) || 0, crm_shop_id: r.ac_crm_shop_id || '', retail_id: r.ac_retail_id || '',
  statement: (() => { try { return r.ac_statement_json ? JSON.parse(r.ac_statement_json) : {} } catch { return {} } })(), books_updated: r.ac_books_updated || '', synced_at: r.ac_synced_at || '', notes: r.ac_notes || '', flags: String(r.ac_flags || '').split(',').filter(Boolean),
  app_balance_cents: Number(r.ac_app_balance_cents) || 0, ledger_balance_cents: Number(r.ac_ledger_balance_cents) || 0, drift_cents: Number(r.ac_drift_cents) || 0,
  aging: (() => { try { return r.ac_aging_json ? JSON.parse(r.ac_aging_json) : null } catch { return null } })(), last_payment: r.ac_last_payment || '', open_count: Number(r.ac_open_count) || 0,
})
export async function syncAccounts(req, by = 'system') {
  const started = now(); const a = app(req)
  try {
    const token = await getAccessToken()
    const contacts = (await pageAll(token, 'contacts', { contact_type: 'customer' }, 'contacts')).filter(c => c.contact_id)
    const existing = await zcqlAll(a, T.acc, `SELECT ROWID, ac_contact_id FROM ${T.acc}`)
    const byId = new Map(existing.map(r => [String(r.ac_contact_id), String(r.ROWID)]))
    // Links: CRM shops + repair customers that already carry this Books id
    const links = {}
    const byName = {}; const norm = x => String(x || '').toLowerCase().replace(/\b(inc|llc|corp|ltd|co|the|llp|dba)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    try { const { getAllShops } = await import('../routes/shops.js'); for (const s of await getAllShops(req)) { if (s.zoho_contact_id) links[String(s.zoho_contact_id)] = { crm: String(s.id) }; if (s.shop_name) byName[norm(s.shop_name)] = String(s.id) } } catch (e) { console.log('[ar] shop link skipped:', e.message) }
    // Fallback: same name in CRM (most CRM shops predate the Books id link)
    for (const c of contacts) { const k = String(c.contact_id); if (!links[k]?.crm) { const hit = byName[norm(c.contact_name)] || byName[norm(c.company_name)]; if (hit) links[k] = { ...(links[k] || {}), crm: hit, by_name: true } } }
    try { for (const r of await zcqlAll(a, 'EstRetailCustomers', `SELECT ROWID, er_zoho_contact_id FROM EstRetailCustomers`)) if (r.er_zoho_contact_id) links[String(r.er_zoho_contact_id)] = { ...(links[String(r.er_zoho_contact_id)] || {}), retail: String(r.ROWID) } } catch { /* optional */ }
    const synced_at = now(); const inserts = [], updates = []
    for (const c of contacts) {
      const row = accRow(c, synced_at); const l = links[row.ac_contact_id]
      if (l?.crm) row.ac_crm_shop_id = l.crm; if (l?.retail) row.ac_retail_id = l.retail
      const rid = byId.get(row.ac_contact_id)
      if (rid) updates.push({ ROWID: rid, ...row }); else inserts.push(row)
    }
    const t = a.datastore().table(T.acc)
    for (const b of chunk(inserts, 100)) await t.insertRows(b)
    for (const b of chunk(updates, 100)) await t.updateRows(b)
    const counts = { contacts: contacts.length, inserted: inserts.length, updated: updates.length, linked_crm: Object.values(links).filter(l => l.crm).length, linked_retail: Object.values(links).filter(l => l.retail).length }
    await logRun(req, 'accounts', started, true, counts, {}, by)
    return { ok: true, ...counts }
  } catch (e) { await logRun(req, 'accounts', started, false, {}, { error: e.message }, by); throw e }
}

// ── Credit notes by month ───────────────────────────────────────────────
export async function syncCreditNotes(req, months, by = 'system') {
  const started = now(); const a = app(req); const token = await getAccessToken(); const t = a.datastore().table(T.cn)
  const counts = { months: months.length, inserted: 0, updated: 0, removed: 0, total_cents: 0 }
  try {
    for (const ym of months) {
      const [y, m] = ym.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
      const list = (await pageAll(token, 'creditnotes', { date_start: `${ym}-01`, date_end: `${ym}-${String(last).padStart(2, '0')}` }, 'creditnotes')).filter(c => c.creditnote_id)
      const inMonth = await zcqlAll(a, T.cn, `SELECT ROWID, cn_creditnote_id FROM ${T.cn} WHERE cn_month = '${q(ym)}'`)
      const byId = new Map(inMonth.map(r => [String(r.cn_creditnote_id), String(r.ROWID)]))
      const keep = new Set(); const ins = [], upd = []
      for (const c of list) {
        // Which invoices this credit was applied to (detail call; credit notes are few)
        let applied = []
        try { const d = await axios.get(`${API}/creditnotes/${c.creditnote_id}`, { headers: H(token), params: org(), timeout: 20000, validateStatus: st => st < 500 }); applied = (d.data?.creditnote?.invoices_credited || []).map(i => ({ invoice_id: String(i.invoice_id || ''), invoice_number: String(i.invoice_number || ''), amount_cents: cents(i.credited_amount ?? i.amount ?? i.amount_applied), date: String(i.date || i.credited_date || '').slice(0, 20) })); await sleep(300) } catch (e) { console.log('[ar] credit note detail failed:', c.creditnote_id, e.message) }
        const row = { cn_creditnote_id: String(c.creditnote_id), cn_number: String(c.creditnote_number || '').slice(0, 40), cn_customer_id: String(c.customer_id || ''), cn_customer_name: String(c.customer_name || '').slice(0, 200), cn_date: String(c.date || '').slice(0, 20), cn_status: String(c.status || '').slice(0, 20), cn_total_cents: cents(c.total), cn_balance_cents: cents(c.balance), cn_invoices_json: JSON.stringify(applied.length ? applied : (c.invoices || [])).slice(0, 4000), cn_month: ym, cn_synced_at: now() }
        keep.add(row.cn_creditnote_id); counts.total_cents += row.cn_total_cents
        const rid = byId.get(row.cn_creditnote_id); if (rid) upd.push({ ROWID: rid, ...row }); else ins.push(row)
      }
      const stale = inMonth.filter(r => !keep.has(String(r.cn_creditnote_id))).map(r => String(r.ROWID))
      for (const b of chunk(ins, 100)) await t.insertRows(b)
      for (const b of chunk(upd, 100)) await t.updateRows(b)
      for (const b of chunk(stale, 100)) await t.deleteRows(b)
      counts.inserted += ins.length; counts.updated += upd.length; counts.removed += stale.length
    }
    await logRun(req, 'credit_notes', started, true, counts, {}, by)
    return { ok: true, ...counts }
  } catch (e) { await logRun(req, 'credit_notes', started, false, counts, { error: e.message }, by); throw e }
}

// ── Payment → invoice allocations (one Books call per payment, resumable) ──
export async function syncAllocations(req, { limit = 60, by = 'system' } = {}) {
  const started = now(); const a = app(req); const token = await getAccessToken(); const t = a.datastore().table(T.al)
  const have = new Set((await zcqlAll(a, T.al, `SELECT al_payment_id FROM ${T.al}`)).map(r => String(r.al_payment_id)))
  const pays = (await readAll(req, 'pay')).filter(p => !have.has(String(p.payment_id)))
  const todo = pays.slice(0, limit); const counts = { pending_before: pays.length, fetched: 0, rows: 0, unapplied: 0, errors: 0 }
  try {
    for (const p of todo) {
      try {
        const r = await axios.get(`${API}/customerpayments/${p.payment_id}`, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 })
        if (r.status === 429) { await sleep(2000); counts.errors++; continue }
        const pay = r.data?.payment; if (!pay) { counts.errors++; continue }
        const rows = (pay.invoices || []).filter(i => Number(i.amount_applied) > 0).map(i => ({ al_payment_id: String(p.payment_id), al_invoice_id: String(i.invoice_id || ''), al_invoice_number: String(i.invoice_number || '').slice(0, 40), al_customer_id: String(pay.customer_id || p.customer_id || ''), al_amount_cents: cents(i.amount_applied), al_applied_date: String(i.date || pay.date || '').slice(0, 20), al_kind: 'payment', al_synced_at: now() }))
        const applied = rows.reduce((s, x) => s + x.al_amount_cents, 0); const excess = cents(pay.amount) - applied
        if (excess > 0 || rows.length === 0) { rows.push({ al_payment_id: String(p.payment_id), al_invoice_id: '', al_invoice_number: '', al_customer_id: String(pay.customer_id || p.customer_id || ''), al_amount_cents: Math.max(0, excess) || cents(pay.amount), al_applied_date: String(pay.date || '').slice(0, 20), al_kind: 'unapplied', al_synced_at: now() }); counts.unapplied++ }
        for (const b of chunk(rows, 100)) await t.insertRows(b)
        counts.fetched++; counts.rows += rows.length
        await sleep(350)   // stay well under Books' per-minute limit
      } catch (e) { counts.errors++; console.log('[ar] allocation fetch failed:', p.payment_id, e.message) }
    }
    counts.pending_after = pays.length - counts.fetched
    await logRun(req, 'allocations', started, true, counts, {}, by)
    return { ok: true, ...counts }
  } catch (e) { await logRun(req, 'allocations', started, false, counts, { error: e.message }, by); throw e }
}

// ── Reconcile: the drift number ──────────────────────────────────────────
export async function reconcile(req, by = 'system') {
  const started = now(); const a = app(req); const today = todayPT()
  try {
    const [invoices, payments, accRows, allocs, cns] = await Promise.all([
      readAll(req, 'inv'), readAll(req, 'pay'), zcqlAll(a, T.acc, `SELECT * FROM ${T.acc}`), zcqlAll(a, T.al, `SELECT al_payment_id, al_invoice_id, al_customer_id, al_amount_cents, al_kind FROM ${T.al}`), zcqlAll(a, T.cn, `SELECT cn_customer_id, cn_balance_cents, cn_total_cents, cn_status, cn_invoices_json FROM ${T.cn}`),
    ])
    const accounts = accRows.map(rowToAccount)
    const live = i => !['draft', 'void'].includes(String(i.status || '').toLowerCase())
    const allocByInv = {}; const allocPays = new Set(); let unmatched = 0
    for (const x of allocs) { allocPays.add(String(x.al_payment_id)); if (x.al_kind === 'unapplied') { unmatched++; continue } allocByInv[String(x.al_invoice_id)] = (allocByInv[String(x.al_invoice_id)] || 0) + (Number(x.al_amount_cents) || 0) }
    const coverage = payments.length ? allocPays.size / payments.length : 0
    const credits = {}, creditByInv = {}, creditDetailMissing = {}
    for (const c of cns) {
      if (String(c.cn_status || '') === 'void') continue
      credits[String(c.cn_customer_id)] = (credits[String(c.cn_customer_id)] || 0) + (Number(c.cn_total_cents) || 0)
      let applied = []; try { applied = JSON.parse(c.cn_invoices_json || '[]') } catch { applied = [] }
      if (!applied.length && (Number(c.cn_total_cents) || 0) > (Number(c.cn_balance_cents) || 0)) creditDetailMissing[String(c.cn_customer_id)] = true
      for (const x of applied) if (x.invoice_id && Number(x.amount_cents) > 0) creditByInv[String(x.invoice_id)] = (creditByInv[String(x.invoice_id)] || 0) + Number(x.amount_cents)
    }
    const byCust = {}
    const daysPast = i => Math.max(0, Math.floor((new Date(today) - new Date(i.due_date || i.date)) / 86400000))
    const bucket = d => d <= 0 ? 'current' : d <= 30 ? 'd30' : d <= 60 ? 'd60' : d <= 90 ? 'd90' : 'd90plus'
    let mismatched = 0; const mismatches = []
    for (const i of invoices) {
      if (!live(i)) continue
      const c = byCust[i.customer_id] || (byCust[i.customer_id] = { name: i.customer_name, app: 0, ledger: 0, open: 0, aging: { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 }, invoices: 0 })
      c.invoices++
      const bal = cents(i.balance); const total = cents(i.total); const applied = allocByInv[String(i.invoice_id)] || 0; const credited = creditByInv[String(i.invoice_id)] || 0
      const ledgerBal = Math.max(0, total - applied - credited)
      c.app += bal; c.ledger += ledgerBal
      if (bal > 0) { c.open++; c.aging[bucket(daysPast(i))] += bal }
      // invoice-level check only where we hold allocation detail (or nothing was ever applied)
      if (coverage > 0 && ledgerBal !== bal && !creditDetailMissing[String(i.customer_id)]) { mismatched++; if (mismatches.length < 25) mismatches.push({ invoice: i.invoice_number, customer: i.customer_name, books_balance_cents: bal, ledger_balance_cents: ledgerBal, total_cents: total, paid_cents: applied, credited_cents: credited, hint: bal === 0 && ledgerBal > 0 ? 'paid in Books with no payment or credit behind it — write-off?' : bal > ledgerBal ? 'Books shows more owed than our math' : 'payment applied that Books does not count' }) }
    }
    const lastPay = {}; for (const p of payments) if (!lastPay[p.customer_id] || p.date > lastPay[p.customer_id]) lastPay[p.customer_id] = p.date
    let drift = 0, ledgerDrift = 0; const diffs = [], ledgerDiffs = []; const upd = []; const ledgerRows = []
    for (const acc of accounts) {
      const c = byCust[acc.contact_id] || { app: 0, ledger: 0, open: 0, aging: { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 }, invoices: 0 }
      const d = Math.abs(c.app - acc.books_outstanding_cents); drift += d
      // Independent number: total − payments applied (our own math) vs what Books says is owed
      const ld = Math.abs(c.ledger - acc.books_outstanding_cents); ledgerDrift += ld
      if (ld > 0 && ledgerDiffs.length < 25) ledgerDiffs.push({ account: acc.name, contact_id: acc.contact_id, books_cents: acc.books_outstanding_cents, ledger_cents: c.ledger, diff_cents: c.ledger - acc.books_outstanding_cents, credits_cents: credits[acc.contact_id] || 0 })
      if (d > 0 && diffs.length < 25) diffs.push({ account: acc.name, contact_id: acc.contact_id, books_cents: acc.books_outstanding_cents, app_cents: c.app, ledger_cents: c.ledger, diff_cents: c.app - acc.books_outstanding_cents })
      if (acc.app_balance_cents !== c.app && acc.synced_at) ledgerRows.push({ lg_kind: 'balance_change', lg_ref_id: acc.contact_id, lg_ref_number: '', lg_account_id: acc.contact_id, lg_amount_cents: c.app - acc.app_balance_cents, lg_memo: `app balance ${acc.app_balance_cents} → ${c.app} (Books ${acc.books_outstanding_cents})`.slice(0, 255), lg_before_json: JSON.stringify({ app: acc.app_balance_cents, books: acc.books_outstanding_cents }), lg_after_json: JSON.stringify({ app: c.app, ledger: c.ledger, books: acc.books_outstanding_cents }), lg_at: now(), lg_by: by })
      upd.push({ ROWID: acc.id, ac_app_balance_cents: c.app, ac_ledger_balance_cents: c.ledger, ac_drift_cents: c.app - acc.books_outstanding_cents, ac_aging_json: JSON.stringify(c.aging), ac_last_payment: String(lastPay[acc.contact_id] || '').slice(0, 20), ac_open_count: c.open })
    }
    // Invoices whose customer is not in the accounts table at all
    const known = new Set(accounts.map(x => x.contact_id)); const orphans = Object.entries(byCust).filter(([id]) => !known.has(id)).map(([id, c]) => ({ contact_id: id, name: c.name, app_cents: c.app }))
    const ta = a.datastore().table(T.acc); for (const b of chunk(upd, 100)) await ta.updateRows(b)
    if (ledgerRows.length) { const tl = a.datastore().table(T.lg); for (const b of chunk(ledgerRows, 100)) await tl.insertRows(b) }
    diffs.sort((x, y) => Math.abs(y.diff_cents) - Math.abs(x.diff_cents))
    const counts = { accounts: accounts.length, invoices: invoices.length, live_invoices: invoices.filter(live).length, payments: payments.length, allocations: allocs.length, credit_notes: cns.length, coverage: Math.round(coverage * 100), orphan_customers: orphans.length }
    ledgerDiffs.sort((x, y) => Math.abs(y.diff_cents) - Math.abs(x.diff_cents))
    const summary = { ok: true, at: now(), by, drift_cents: drift, accounts_with_drift: diffs.length, ledger_drift_cents: ledgerDrift, accounts_with_ledger_drift: ledgerDiffs.length, mismatched, unmatched, coverage_pct: counts.coverage, counts, top: diffs.slice(0, 10), ledger_top: ledgerDiffs.slice(0, 10), mismatches: mismatches.slice(0, 10), orphans: orphans.slice(0, 10) }
    await logRun(req, 'reconcile', started, true, counts, { drift_cents: drift, mismatched, unmatched, top: { diffs: diffs.slice(0, 15), ledger: ledgerDiffs.slice(0, 15), mismatches: mismatches.slice(0, 15), orphans: orphans.slice(0, 10) } }, by)
    await cfgSet(a, 'ar_last_reconcile', summary)
    return summary
  } catch (e) { await logRun(req, 'reconcile', started, false, {}, { error: e.message }, by); throw e }
}

export async function lastReconcile(req) { return cfgGet(app(req), 'ar_last_reconcile', null) }
export async function runs(req, limit = 30) { const rows = await zcqlAll(app(req), T.sr, `SELECT * FROM ${T.sr} ORDER BY CREATEDTIME DESC`); return rows.slice(0, limit).map(r => ({ id: String(r.ROWID), kind: r.sr_kind, started: r.sr_started, finished: r.sr_finished, ok: r.sr_ok === true || r.sr_ok === 'true', counts: (() => { try { return JSON.parse(r.sr_counts_json || '{}') } catch { return {} } })(), drift_cents: Number(r.sr_drift_cents) || 0, mismatched: Number(r.sr_mismatched) || 0, unmatched: Number(r.sr_unmatched) || 0, top: (() => { try { return JSON.parse(r.sr_top_json || '[]') } catch { return [] } })(), error: r.sr_error || '', by: r.sr_by || '' })) }

// ── Nightly (stamped, after 8pm PT; needs the first import done) ────────
export async function maybeNightlyAr(req) {
  const a = app(req)
  const hourPT = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date()))
  if (hourPT < 20) return { fired: false, reason: 'before-window' }
  const meta = await readMeta(req); if (!meta.last_sync) return { fired: false, reason: 'no-initial-import' }
  const key = `ar_nightly:${todayPT()}`; if (await cfgGet(a, key, null)) return { fired: false, reason: 'already' }
  await cfgSet(a, key, now())
  const out = { fired: true }
  try { out.accounts = await syncAccounts(req, 'nightly') } catch (e) { out.accounts = { error: e.message } }
  try { const cur = todayPT().slice(0, 7); const [y, m] = cur.split('-').map(Number); const prev = n => { let mm = m - n, yy = y; while (mm < 1) { mm += 12; yy-- } return `${yy}-${String(mm).padStart(2, '0')}` }; out.credit_notes = await syncCreditNotes(req, [prev(2), prev(1), cur], 'nightly') } catch (e) { out.credit_notes = { error: e.message } }
  try { out.allocations = await syncAllocations(req, { limit: 60, by: 'nightly' }) } catch (e) { out.allocations = { error: e.message } }
  try { out.reconcile = await reconcile(req, 'nightly'); await postDrift(req, out.reconcile, 'nightly') } catch (e) { out.reconcile = { error: e.message } }
  return out
}
const $ = c => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
export async function postDrift(req, s, label = 'manual') {
  try {
    const { postToCliqChannel, DISPATCH_CHANNEL } = await import('./cliq.js')
    const emoji = s.drift_cents === 0 && s.mismatched === 0 ? '🟢' : s.drift_cents < 10000 ? '🟡' : '🔴'
    const top = (s.top || []).slice(0, 3).map(d => `${d.account} ${d.diff_cents > 0 ? '+' : ''}${$(d.diff_cents)}`).join(' · ')
    const ltop = (s.ledger_top || []).slice(0, 3).map(d => `${d.account} ${d.diff_cents > 0 ? '+' : ''}${$(d.diff_cents)}`).join(' · ')
    await postToCliqChannel(DISPATCH_CHANNEL, `${emoji} *Absolute ADAS Books · mirror drift ${$(s.drift_cents)} · independent ledger drift ${$(s.ledger_drift_cents || 0)}* (${label}) · ${s.accounts_with_drift} of ${s.counts.accounts} accounts differ from Zoho · ${s.accounts_with_ledger_drift || 0} differ on our own math · ${s.mismatched} invoice mismatches · ${s.unmatched} unapplied payments · allocation coverage ${s.coverage_pct}%${top ? `\n${top}` : ''}${ltop ? `\nledger: ${ltop}` : ''}`)
  } catch (e) { console.log('[ar] drift post failed:', e.message) }
}
