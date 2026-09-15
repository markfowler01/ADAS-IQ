// Automotive repair estimator (2026-09-14, Mark's build spec).
// Estimate → Job → Line → Part. Lines + parts live as JSON on the job row
// (Datastore has no joins, gateway has a 30s cap, one write per job).
// Money is integer cents end to end; the engine in services/estimator/calc.js
// is the single source of truth and also runs in the browser.
//
// Hard rules honoured here: nothing reads or writes calibration pricing
// (a calibration line carries a Books list price the user picked), all
// tables are new, every external call is server side.
import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { computeEstimate, readyToSend, authorizationComplete, DEFAULT_SETTINGS, JOB_STATUSES, JOB_CATEGORIES, newId } from '../services/estimator/calc.js'
import { decodeVin, validateVin } from '../services/estimator/vin.js'
import { mountMore } from './estimatorMore.js'

const T = { est: 'EstEstimates', job: 'EstJobs', tpl: 'EstTemplates', retail: 'EstRetailCustomers' }
const SETTINGS_KEY = 'estimator:settings'
const app = req => catalyst.initialize(req, { type: 'advancedio' })
const tbl = (req, t) => app(req).datastore().table(t)
const zcql = (req, q) => app(req).zcql().executeZCQLQuery(q)
const unwrap = (rows, t) => (rows || []).map(r => r[t] || r)
const esc = s => String(s ?? '').replace(/'/g, "''")
const now = () => new Date().toISOString()
const who = req => req.user?.name || req.user?.email || 'staff'
const isOwner = req => String(req.user?.email || '').toLowerCase().startsWith('mark@') || req.user?.role === 'owner'
const int = v => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0 }
const bool = v => v === true || v === 'true' || v === 1
const str = (v, n = 255) => String(v ?? '').slice(0, n)
const json = (v, fallback) => { if (v == null || v === '') return fallback; if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return fallback } }

// ── Settings (AppConfig row, JSON) ──────────────────────────────────────────
async function loadSettings(req) {
  try {
    const rows = unwrap(await zcql(req, `SELECT config_value FROM AppConfig WHERE config_key = '${SETTINGS_KEY}' LIMIT 1`), 'AppConfig')
    const s = json(rows[0]?.config_value, {})
    return { ...DEFAULT_SETTINGS, company: { name: 'Absolute ADAS', tagline: 'Mobile ADAS Calibration & Diagnostics', address: 'Lake Stevens, WA', phone: '', email: '', web: 'absoluteadas.com' }, ...s, rates: { ...DEFAULT_SETTINGS.rates, ...(s.rates || {}) }, company: { name: 'Absolute ADAS', tagline: 'Mobile ADAS Calibration & Diagnostics', address: 'Lake Stevens, WA', phone: '', email: '', web: 'absoluteadas.com', ...(s.company || {}) } }
  } catch (e) { console.log('[estimator] settings read failed:', e.message); return { ...DEFAULT_SETTINGS } }
}
async function saveSettings(req, s) {
  const value = JSON.stringify(s).slice(0, 9000)
  const rows = unwrap(await zcql(req, `SELECT ROWID FROM AppConfig WHERE config_key = '${SETTINGS_KEY}' LIMIT 1`), 'AppConfig')
  const t = tbl(req, 'AppConfig')
  if (rows[0]?.ROWID) await t.updateRow({ ROWID: String(rows[0].ROWID), config_value: value })
  else await t.insertRow({ config_key: SETTINGS_KEY, config_value: value })
}

// ── Row mappers ─────────────────────────────────────────────────────────────
function rowToEst(r) {
  return {
    id: String(r.ROWID), number: r.es_number || '', status: r.es_status || 'draft',
    customer_kind: r.es_customer_kind || 'shop', customer_id: r.es_customer_id || '', customer_name: r.es_customer_name || '',
    customer_type: r.es_customer_type || 'wholesale', customer_contact: json(r.es_customer_contact, {}), zoho_contact_id: r.es_zoho_contact_id || '',
    reseller_permit: r.es_reseller_permit || '',
    year: r.es_year || '', make: r.es_make || '', model: r.es_model || '', trim: r.es_trim || '', vin: r.es_vin || '', plate: r.es_plate || '', mileage: r.es_mileage || '',
    ro_number: r.es_ro_number || '', claim_number: r.es_claim_number || '', insurer: r.es_insurer || '',
    service_address: r.es_service_address || '', service_city: r.es_service_city || '', service_zip: r.es_service_zip || '',
    tax_rate_bp: Math.round(Number(r.es_tax_rate_pct || 0) * 100), zoho_tax_id: r.es_zoho_tax_id || '', tax_enabled: bool(r.es_tax_enabled), tax_note: r.es_tax_note || '',
    supplies_enabled: bool(r.es_supplies_enabled), supplies_pct_bp: Math.round(Number(r.es_supplies_pct ?? 7) * 100), supplies_cap_cents: r.es_supplies_cap_cents == null ? 5000 : int(r.es_supplies_cap_cents),
    discount_type: r.es_discount_type || 'none', discount_value: int(r.es_discount_value), detail_level: r.es_detail_level || '',
    labor_rate_cents: r.es_labor_rate_cents == null ? null : int(r.es_labor_rate_cents), parts_markup_bp: r.es_parts_markup_bp == null ? null : int(r.es_parts_markup_bp),
    concern: r.es_concern || '', notes: r.es_notes || '', terms: r.es_terms || '', valid_until: r.es_valid_until || '',
    totals: json(r.es_totals_json, null), grand_total_cents: int(r.es_grand_total_cents), flags: (r.es_flags || '').split(',').filter(Boolean),
    zoho_invoice_id: r.es_zoho_invoice_id || '', zoho_invoice_number: r.es_zoho_invoice_number || '', zoho_estimate_id: r.es_zoho_estimate_id || '', zoho_estimate_number: r.es_zoho_estimate_number || '',
    pushed_at: r.es_pushed_at || '', push_status: r.es_push_status || '', sent_at: r.es_sent_at || '', approved_at: r.es_approved_at || '',
    created_by: r.es_created_by || '', created_at: r.es_created_at || r.CREATEDTIME || '', updated_at: r.es_updated_at || '', job_id: r.es_job_id || '',
  }
}
// Only the keys present in `e` are written (partial updates).
function estToRow(e) {
  const m = {
    number: v => ({ es_number: str(v, 40) }), status: v => ({ es_status: str(v, 30) }),
    customer_kind: v => ({ es_customer_kind: str(v, 20) }), customer_id: v => ({ es_customer_id: str(v, 60) }), customer_name: v => ({ es_customer_name: str(v, 200) }),
    customer_type: v => ({ es_customer_type: str(v, 20) }), customer_contact: v => ({ es_customer_contact: JSON.stringify(v || {}).slice(0, 9000) }), zoho_contact_id: v => ({ es_zoho_contact_id: str(v, 40) }),
    reseller_permit: v => ({ es_reseller_permit: str(v, 60) }),
    year: v => ({ es_year: str(v, 10) }), make: v => ({ es_make: str(v, 60) }), model: v => ({ es_model: str(v, 80) }), trim: v => ({ es_trim: str(v, 80) }), vin: v => ({ es_vin: str(v, 20).toUpperCase() }), plate: v => ({ es_plate: str(v, 20) }), mileage: v => ({ es_mileage: str(v, 20) }),
    ro_number: v => ({ es_ro_number: str(v, 40) }), claim_number: v => ({ es_claim_number: str(v, 60) }), insurer: v => ({ es_insurer: str(v, 100) }),
    service_address: v => ({ es_service_address: str(v, 200) }), service_city: v => ({ es_service_city: str(v, 80) }), service_zip: v => ({ es_service_zip: str(v, 12) }),
    tax_rate_bp: v => ({ es_tax_rate_pct: int(v) / 100 }), zoho_tax_id: v => ({ es_zoho_tax_id: str(v, 40) }), tax_enabled: v => ({ es_tax_enabled: !!v }), tax_note: v => ({ es_tax_note: str(v) }),
    supplies_enabled: v => ({ es_supplies_enabled: !!v }), supplies_pct_bp: v => ({ es_supplies_pct: int(v) / 100 }), supplies_cap_cents: v => ({ es_supplies_cap_cents: int(v) }),
    discount_type: v => ({ es_discount_type: str(v, 10) }), discount_value: v => ({ es_discount_value: int(v) }), detail_level: v => ({ es_detail_level: str(v, 20) }),
    labor_rate_cents: v => ({ es_labor_rate_cents: v == null ? null : int(v) }), parts_markup_bp: v => ({ es_parts_markup_bp: v == null ? null : int(v) }),
    concern: v => ({ es_concern: str(v, 9000) }), notes: v => ({ es_notes: str(v, 9000) }), terms: v => ({ es_terms: str(v, 9000) }), valid_until: v => ({ es_valid_until: str(v, 20) }),
    totals: v => ({ es_totals_json: JSON.stringify(v || {}).slice(0, 9000) }), grand_total_cents: v => ({ es_grand_total_cents: int(v) }), flags: v => ({ es_flags: str((v || []).join(','), 255) }),
    zoho_invoice_id: v => ({ es_zoho_invoice_id: str(v, 40) }), zoho_invoice_number: v => ({ es_zoho_invoice_number: str(v, 40) }), zoho_estimate_id: v => ({ es_zoho_estimate_id: str(v, 40) }), zoho_estimate_number: v => ({ es_zoho_estimate_number: str(v, 40) }),
    pushed_at: v => ({ es_pushed_at: str(v, 40) }), push_status: v => ({ es_push_status: str(v) }), sent_at: v => ({ es_sent_at: str(v, 40) }), approved_at: v => ({ es_approved_at: str(v, 40) }),
    approve_token: v => ({ es_approve_token: str(v, 80) }), created_by: v => ({ es_created_by: str(v, 100) }), created_at: v => ({ es_created_at: str(v, 40) }), updated_at: v => ({ es_updated_at: str(v, 40) }), job_id: v => ({ es_job_id: str(v, 40) }),
  }
  const row = {}
  for (const [k, fn] of Object.entries(m)) if (e[k] !== undefined) Object.assign(row, fn(e[k]))
  return row
}
function rowToJob(r) {
  return {
    id: String(r.ROWID), estimate_id: r.ej_estimate_id || '', sort: int(r.ej_sort), name: r.ej_name || '', invoice_description: r.ej_invoice_description || '',
    category: r.ej_category || 'mechanical', status: r.ej_status || 'recommended', decline_reason: r.ej_decline_reason || '',
    authorized_at: r.ej_authorized_at || '', authorized_by_name: r.ej_authorized_by_name || '', authorized_method: r.ej_authorized_method || '', authorized_by_employee: r.ej_authorized_by_employee || '',
    authorized_amount_cents: int(r.ej_authorized_amount_cents), authorized_meta: r.ej_authorized_meta || '', notes: r.ej_notes || '', three_c_id: r.ej_three_c_id || '',
    lines: json(r.ej_lines_json, []), labor_cents: int(r.ej_labor_cents), parts_cents: int(r.ej_parts_cents), total_cents: int(r.ej_total_cents),
    created_at: r.ej_created_at || '', updated_at: r.ej_updated_at || '',
  }
}
function jobToRow(j) {
  const m = {
    estimate_id: v => ({ ej_estimate_id: str(v, 40) }), sort: v => ({ ej_sort: int(v) }), name: v => ({ ej_name: str(v, 200) }), invoice_description: v => ({ ej_invoice_description: str(v) }),
    category: v => ({ ej_category: str(v, 30) }), status: v => ({ ej_status: str(v, 20) }), decline_reason: v => ({ ej_decline_reason: str(v) }),
    authorized_at: v => ({ ej_authorized_at: str(v, 40) }), authorized_by_name: v => ({ ej_authorized_by_name: str(v, 120) }), authorized_method: v => ({ ej_authorized_method: str(v, 20) }), authorized_by_employee: v => ({ ej_authorized_by_employee: str(v, 120) }),
    authorized_amount_cents: v => ({ ej_authorized_amount_cents: int(v) }), authorized_meta: v => ({ ej_authorized_meta: str(v) }), notes: v => ({ ej_notes: str(v, 9000) }), three_c_id: v => ({ ej_three_c_id: str(v, 40) }),
    lines: v => ({ ej_lines_json: JSON.stringify(cleanLines(v)) }), labor_cents: v => ({ ej_labor_cents: int(v) }), parts_cents: v => ({ ej_parts_cents: int(v) }), total_cents: v => ({ ej_total_cents: int(v) }),
    created_at: v => ({ ej_created_at: str(v, 40) }), updated_at: v => ({ ej_updated_at: str(v, 40) }),
  }
  const row = {}
  for (const [k, fn] of Object.entries(m)) if (j[k] !== undefined) Object.assign(row, fn(j[k]))
  return row
}
// Strip computed fields + keep only the shape the engine reads (keeps the JSON small).
function cleanLines(lines) {
  return (Array.isArray(lines) ? lines : []).map(l => ({
    id: l.id || newId(), desc: str(l.desc, 300), rate_key: str(l.rate_key, 20) || 'mechanical', hours: Math.round((Number(l.hours) || 0) * 10) / 10,
    rate_override_cents: l.rate_override_cents == null || l.rate_override_cents === '' ? null : int(l.rate_override_cents),
    flat_cents: l.flat_cents == null || l.flat_cents === '' ? null : int(l.flat_cents), item_id: l.item_id ? str(l.item_id, 40) : undefined,
    taxable: l.taxable !== false, notes: str(l.notes, 500),
    parts: (l.parts || []).map(p => ({
      id: p.id || newId(), pn: str(p.pn, 60), desc: str(p.desc, 200), source: str(p.source, 20) || 'oem', qty: Number(p.qty) > 0 ? Number(p.qty) : 1,
      cost_cents: int(p.cost_cents), markup_bp: p.markup_bp == null || p.markup_bp === '' ? null : int(p.markup_bp), price_cents: p.price_cents == null || p.price_cents === '' ? null : int(p.price_cents), taxable: p.taxable !== false,
    })),
  }))
}

// ── Loaders + recompute ─────────────────────────────────────────────────────
async function getEst(req, id) {
  const r = await tbl(req, T.est).getRow(String(id))
  if (!r) return null
  return rowToEst(r)
}
async function getJobs(req, estId) {
  const rows = unwrap(await zcql(req, `SELECT * FROM ${T.job} WHERE ej_estimate_id = '${esc(estId)}' ORDER BY ej_sort ASC LIMIT 200`), T.job)
  return rows.map(rowToJob)
}
function flagsFor(est, totals, settings) {
  const f = []
  if (totals.over_110) f.push('over110')
  if (totals.unauthorized_approved) f.push('needs_auth')
  if (est.tax_enabled && !est.tax_rate_bp) f.push('no_tax_rate')
  if (est.customer_type === 'wholesale' && !est.tax_enabled && !est.reseller_permit) f.push('no_permit')
  return f
}
/** Recompute the whole estimate, persist totals + flags, return the full object. */
async function recompute(req, estId, { est = null, jobs = null, touchedJobId = null } = {}) {
  const settings = await loadSettings(req)
  est = est || await getEst(req, estId)
  if (!est) return null
  jobs = jobs || await getJobs(req, estId)
  const r = computeEstimate({ ...est, jobs }, settings)
  const flags = flagsFor(est, r.totals, settings)
  const patch = { totals: r.totals, grand_total_cents: r.totals.grand_total, flags, updated_at: now() }
  await tbl(req, T.est).updateRow({ ROWID: String(estId), ...estToRow(patch) })
  // Per-job cents: write the touched job (or all when rates could have changed)
  for (const j of r.jobs) {
    if (touchedJobId && j.id !== touchedJobId) continue
    if (j.labor_cents !== (jobs.find(x => x.id === j.id)?.labor_cents) || j.parts_cents !== (jobs.find(x => x.id === j.id)?.parts_cents) || touchedJobId === j.id) {
      await tbl(req, T.job).updateRow({ ROWID: String(j.id), ej_labor_cents: j.labor_cents, ej_parts_cents: j.parts_cents, ej_total_cents: j.total_cents })
    }
  }
  const ready = readyToSend({ ...est, jobs })
  return { ...est, ...patch, jobs: r.jobs, ready, settings }
}

async function nextNumber(req) {
  try {
    const rows = await zcql(req, `SELECT COUNT(ROWID) FROM ${T.est}`)
    const first = rows?.[0] ? Object.values(rows[0])[0] : null
    const count = int(first && typeof first === 'object' ? Object.values(first)[0] : first)
    return `E-${String(1000 + count + 1)}`
  } catch { return `E-${Date.now().toString(36).toUpperCase()}` }
}

// ── Router ──────────────────────────────────────────────────────────────────
export const estimatorRouter = express.Router()
const R = estimatorRouter
const staffOnly = (req, res, next) => req.user?.role === 'technician' ? res.status(403).json({ error: 'Technicians can view estimates but not change them.' }) : next()
const ownerOnly = (req, res, next) => isOwner(req) ? next() : res.status(403).json({ error: 'Owner only.' })
const fail = (res, e, where) => { console.log(`[estimator] ${where}:`, e.message); res.status(500).json({ error: e.message }) }

// Settings
R.get('/settings', async (req, res) => { try { res.json({ ok: true, settings: await loadSettings(req), is_owner: isOwner(req) }) } catch (e) { fail(res, e, 'settings') } })
R.put('/settings', ownerOnly, async (req, res) => {
  try {
    const cur = await loadSettings(req)
    const b = req.body || {}
    const next = { ...cur, ...b, rates: { ...cur.rates, ...(b.rates || {}) } }
    for (const k of Object.keys(next.rates)) next.rates[k] = int(next.rates[k])
    await saveSettings(req, next)
    res.json({ ok: true, settings: next })
  } catch (e) { fail(res, e, 'settings put') }
})

// VIN
R.get('/vin/:vin', async (req, res) => {
  try { const d = await decodeVin(req, req.params.vin); res.status(d.ok ? 200 : 422).json(d) }
  catch (e) { res.status(502).json({ ok: false, reason: `NHTSA unreachable: ${e.message}` }) }
})

// Calibration items from Books (read only — list price becomes the line's flat price)
let catalogCache = { at: 0, items: [] }
R.get('/catalog', async (req, res) => {
  try {
    if (Date.now() - catalogCache.at > 10 * 60 * 1000) {
      const { getItemCatalogForAudit } = await import('../services/zoho.js')
      const all = await getItemCatalogForAudit()
      const items = (Array.isArray(all) ? all : all?.allItems || all?.items || []).map(it => ({ item_id: String(it.item_id || it.id || ''), name: it.name || '', rate_cents: Math.round(Number(it.rate || 0) * 100), type: it.product_type || it.type || '' })).filter(it => it.name && it.item_id)
      catalogCache = { at: Date.now(), items }
    }
    res.json({ ok: true, items: catalogCache.items })
  } catch (e) { fail(res, e, 'catalog') }
})

// Customers: CRM shops (light) + retail people
R.get('/shops', async (req, res) => {
  try {
    const { getAllShops } = await import('./shops.js')
    const shops = await getAllShops(req)
    res.json({ ok: true, shops: (shops || []).map(s => ({
      id: String(s.id), name: s.shop_name || '', phone: s.phone || '', email: s.email || '', address: s.address || '', city: s.city || '', zip: s.zip || '',
      zoho_contact_id: s.zoho_contact_id || '', contact_name: s.contact_name || '',
      discount_pct: Number(s.billing_rules?.discount_pct ?? s.discount_pct ?? 0) || 0, customer_type: s.billing_rules?.customer_type || '', status: s.status || '',
    })).filter(s => s.name) })
  } catch (e) { fail(res, e, 'shops') }
})
// ── Repair customers (Mark 2026-09-14: "build my repair customers in the
// CRM also but keep them separate") — their own table, their own CRM tab.
// Never mixed into CRMShops, so the shop pipeline / marketing / dispatch
// code never sees them.
const rowToRetail = r => ({
  id: String(r.ROWID), name: r.er_name || '', phone: r.er_phone || '', email: r.er_email || '', address: r.er_address || '', city: r.er_city || '', zip: r.er_zip || '',
  zoho_contact_id: r.er_zoho_contact_id || '', notes: r.er_notes || '', vehicles: json(r.er_vehicles_json, []), source: r.er_source || '', tags: String(r.er_tags || '').split(',').filter(Boolean),
  last_contact: r.er_last_contact || '', created_at: r.er_created_at || r.CREATEDTIME || '', updated_at: r.er_updated_at || '',
})
function retailToRow(c) {
  const m = {
    name: v => ({ er_name: str(v, 200) }), phone: v => ({ er_phone: str(v, 30) }), email: v => ({ er_email: str(v, 200) }), address: v => ({ er_address: str(v, 200) }), city: v => ({ er_city: str(v, 80) }), zip: v => ({ er_zip: str(v, 12) }),
    zoho_contact_id: v => ({ er_zoho_contact_id: str(v, 40) }), notes: v => ({ er_notes: str(v, 9000) }), vehicles: v => ({ er_vehicles_json: JSON.stringify((Array.isArray(v) ? v : []).slice(0, 12).map(x => ({ vin: str(x.vin, 20).toUpperCase(), year: str(x.year, 10), make: str(x.make, 60), model: str(x.model, 80), trim: str(x.trim, 80), plate: str(x.plate, 20), last_mileage: x.last_mileage == null || x.last_mileage === '' ? null : int(x.last_mileage), last_service: str(x.last_service, 20) }))) }),
    source: v => ({ er_source: str(v, 60) }), tags: v => ({ er_tags: str((Array.isArray(v) ? v : String(v || '').split(',')).map(t => t.trim()).filter(Boolean).join(','), 255) }),
    last_contact: v => ({ er_last_contact: str(v, 40) }), updated_at: v => ({ er_updated_at: str(v, 40) }), created_at: v => ({ er_created_at: str(v, 40) }),
  }
  const row = {}
  for (const [k, fn] of Object.entries(m)) if (c[k] !== undefined) Object.assign(row, fn(c[k]))
  return row
}
async function getRetail(req, id) { const r = await tbl(req, T.retail).getRow(String(id)); return r ? rowToRetail(r) : null }
/** Estimates per retail customer: count, open/won cents, last activity, list. */
async function retailStats(req) {
  const rows = unwrap(await zcql(req, `SELECT ROWID, es_number, es_customer_id, es_status, es_grand_total_cents, es_created_at, es_year, es_make, es_model, es_vin FROM ${T.est} WHERE es_customer_kind = 'retail' ORDER BY CREATEDTIME DESC LIMIT 300`), T.est)
  const by = {}
  for (const r of rows) {
    const k = String(r.es_customer_id || ''); if (!k) continue
    const g = by[k] || (by[k] = { count: 0, open_cents: 0, won_cents: 0, last_at: '', estimates: [] })
    const cents = int(r.es_grand_total_cents); const st = r.es_status || 'draft'
    g.count += 1; if (st === 'draft' || st === 'sent') g.open_cents += cents; if (st === 'approved' || st === 'invoiced') g.won_cents += cents
    if (!g.last_at) g.last_at = r.es_created_at || r.CREATEDTIME || ''
    g.estimates.push({ id: String(r.ROWID), number: r.es_number || '', status: st, grand_total_cents: cents, created_at: r.es_created_at || r.CREATEDTIME || '', vehicle: [r.es_year, r.es_make, r.es_model].filter(Boolean).join(' '), vin: r.es_vin || '' })
  }
  return by
}
/** Learning: a vehicle seen on an estimate is remembered on the person (by VIN, else year+make+model). */
async function rememberVehicle(req, customerId, v) {
  try {
    const c = await getRetail(req, customerId); if (!c) return
    const vin = str(v.vin, 20).toUpperCase(); const ymm = [v.year, v.make, v.model].filter(Boolean).join(' ').toLowerCase()
    if (!vin && !ymm) return
    const same = x => (vin && String(x.vin || '').toUpperCase() === vin) || (!vin && [x.year, x.make, x.model].filter(Boolean).join(' ').toLowerCase() === ymm)
    const cur = c.vehicles.find(same)
    const miles = parseInt(String(v.mileage || '').replace(/[^0-9]/g, ''), 10)
    const merged = { vin: vin || cur?.vin || '', year: v.year || cur?.year || '', make: v.make || cur?.make || '', model: v.model || cur?.model || '', trim: v.trim || cur?.trim || '', plate: v.plate || cur?.plate || '',
      last_mileage: Number.isFinite(miles) ? Math.max(miles, Number(cur?.last_mileage) || 0) : (cur?.last_mileage ?? null), last_service: [v.last_service, cur?.last_service].filter(Boolean).sort().pop() || '' }
    const vehicles = [merged, ...c.vehicles.filter(x => !same(x))].slice(0, 12)
    await tbl(req, T.retail).updateRow({ ROWID: c.id, ...retailToRow({ vehicles, last_contact: now(), updated_at: now() }) })
  } catch (e) { console.log('[estimator] rememberVehicle failed:', e.message) }
}
R.get('/retail-customers', async (req, res) => {
  try {
    const q = str(req.query.q || '', 80).toLowerCase()
    const [rows, stats] = await Promise.all([zcql(req, `SELECT * FROM ${T.retail} ORDER BY CREATEDTIME DESC LIMIT 300`), retailStats(req).catch(() => ({}))])
    let list = unwrap(rows, T.retail).map(rowToRetail).map(c => { const s = stats[c.id] || {}; return { ...c, estimates_count: s.count || 0, open_cents: s.open_cents || 0, won_cents: s.won_cents || 0, last_estimate_at: s.last_at || '' } })
    if (q) list = list.filter(c => `${c.name} ${c.phone} ${c.email} ${c.vehicles.map(v => `${v.vin} ${v.year} ${v.make} ${v.model} ${v.plate}`).join(' ')}`.toLowerCase().includes(q))
    res.json({ ok: true, customers: list })
  } catch (e) { fail(res, e, 'retail list') }
})
R.get('/retail-customers/:id', async (req, res) => {
  try {
    const c = await getRetail(req, req.params.id); if (!c) return res.status(404).json({ error: 'Customer not found' })
    const stats = (await retailStats(req).catch(() => ({})))[c.id] || { count: 0, open_cents: 0, won_cents: 0, estimates: [] }
    res.json({ ok: true, customer: { ...c, estimates_count: stats.count, open_cents: stats.open_cents, won_cents: stats.won_cents, estimates: stats.estimates } })
  } catch (e) { fail(res, e, 'retail get') }
})
R.post('/retail-customers', staffOnly, async (req, res) => {
  try {
    const b = req.body || {}
    if (!str(b.name).trim()) return res.status(400).json({ error: 'Name is required' })
    const row = await tbl(req, T.retail).insertRow(retailToRow({ name: b.name, phone: b.phone || '', email: b.email || '', address: b.address || '', city: b.city || '', zip: b.zip || '', notes: b.notes || '', vehicles: b.vehicles || [], source: b.source || (who(req) ? `app · ${who(req)}` : 'app'), tags: b.tags || [], last_contact: now(), created_at: now(), updated_at: now() }))
    res.json({ ok: true, customer: { ...rowToRetail(row), estimates_count: 0, open_cents: 0, won_cents: 0 } })
  } catch (e) { fail(res, e, 'retail create') }
})
R.put('/retail-customers/:id', staffOnly, async (req, res) => {
  try {
    const c = await getRetail(req, req.params.id); if (!c) return res.status(404).json({ error: 'Customer not found' })
    const b = { ...(req.body || {}) }; for (const k of ['id', 'created_at', 'estimates', 'estimates_count', 'open_cents', 'won_cents']) delete b[k]
    if (b.name !== undefined && !str(b.name).trim()) return res.status(400).json({ error: 'Name is required' })
    await tbl(req, T.retail).updateRow({ ROWID: c.id, ...retailToRow({ ...b, updated_at: now() }) })
    // keep the name/contact on open estimates in step
    if (b.name || b.phone || b.email || b.address) {
      const st = (await retailStats(req).catch(() => ({})))[c.id]
      const nc = { ...c, ...b }
      for (const e of st?.estimates || []) if (e.status === 'draft' || e.status === 'sent') await tbl(req, T.est).updateRow({ ROWID: e.id, ...estToRow({ customer_name: nc.name, customer_contact: { phone: nc.phone, email: nc.email, address: nc.address, city: nc.city, zip: nc.zip } }) }).catch(() => {})
    }
    res.json({ ok: true, customer: await getRetail(req, c.id) })
  } catch (e) { fail(res, e, 'retail update') }
})
R.delete('/retail-customers/:id', staffOnly, async (req, res) => {
  try {
    const c = await getRetail(req, req.params.id); if (!c) return res.status(404).json({ error: 'Customer not found' })
    const st = (await retailStats(req).catch(() => ({})))[c.id]
    if (st?.count && !isOwner(req)) return res.status(409).json({ error: `${st.count} estimate${st.count === 1 ? '' : 's'} on file — only Mark can delete a customer with history.` })
    await tbl(req, T.retail).deleteRow(c.id)
    res.json({ ok: true })
  } catch (e) { fail(res, e, 'retail delete') }
})
// Zoho Books: link by exact name or create an INDIVIDUAL customer (shops are business customers; these are people).
R.post('/retail-customers/:id/books-customer', staffOnly, async (req, res) => {
  try {
    const c = await getRetail(req, req.params.id); if (!c) return res.status(404).json({ error: 'Customer not found' })
    if (c.zoho_contact_id && !req.body?.relink) return res.json({ ok: true, existing: true, contact_id: c.zoho_contact_id })
    const axios = (await import('axios')).default
    const { getAccessToken } = await import('../services/zoho.js')
    const token = await getAccessToken()
    const B = 'https://www.zohoapis.com/books/v3', H = { Authorization: `Zoho-oauthtoken ${token}` }, P = { organization_id: process.env.ZOHO_ORGANIZATION_ID }
    const name = c.name.trim(); const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const found = await axios.get(`${B}/contacts`, { headers: H, params: { ...P, contact_name_contains: name.slice(0, 40), contact_type: 'customer' }, timeout: 15000, validateStatus: s => s < 500 })
    const hit = (found.data?.contacts || []).find(x => norm(x.contact_name) === norm(name))
    const link = async id => { await tbl(req, T.retail).updateRow({ ROWID: c.id, er_zoho_contact_id: String(id), er_updated_at: now() }); const st = (await retailStats(req).catch(() => ({})))[c.id]; for (const e of st?.estimates || []) await tbl(req, T.est).updateRow({ ROWID: e.id, es_zoho_contact_id: String(id) }).catch(() => {}) }
    if (hit) { await link(hit.contact_id); return res.json({ ok: true, linked: true, contact_id: hit.contact_id, contact_name: hit.contact_name }) }
    const [first, ...rest] = name.split(/\s+/); const last = rest.join(' ')
    const billing_address = c.address ? { address: c.address, city: c.city || '', state: 'WA', zip: c.zip || '', country: 'U.S.A' } : undefined
    const body = { contact_name: name, contact_type: 'customer', customer_sub_type: 'individual', first_name: first, last_name: last, ...(c.email ? { email: c.email } : {}), ...(c.phone ? { phone: c.phone } : {}), ...(billing_address ? { billing_address, shipping_address: billing_address } : {}), contact_persons: [{ first_name: first, last_name: last, ...(c.email ? { email: c.email } : {}), ...(c.phone ? { phone: c.phone } : {}), is_primary_contact: true }], payment_terms: 0, payment_terms_label: 'Due on Receipt', notes: 'Repair customer · created from the Absolute ADAS app estimator' }
    const r = await axios.post(`${B}/contacts`, body, { headers: H, params: P, timeout: 20000, validateStatus: s => s < 500 })
    if (r.data?.code !== 0) return res.status(502).json({ error: `Books said: ${r.data?.message || r.status}` })
    await link(r.data.contact.contact_id)
    console.log(`[estimator] Books individual customer created: ${name} (${r.data.contact.contact_id}) by ${who(req)}`)
    res.json({ ok: true, created: true, contact_id: r.data.contact.contact_id, contact_name: r.data.contact.contact_name })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// Templates (whole jobs with lines)
const SEED_TEMPLATES = [
  { name: 'Front camera — static calibration', category: 'calibration', lines: [{ desc: 'Front camera static calibration (target setup, aim procedure)', rate_key: 'calibration', hours: 1.5 }] },
  { name: 'Front camera — dynamic calibration', category: 'calibration', lines: [{ desc: 'Front camera dynamic calibration (road drive procedure)', rate_key: 'calibration', hours: 1.0 }] },
  { name: 'Front radar calibration', category: 'calibration', lines: [{ desc: 'Front radar calibration', rate_key: 'calibration', hours: 1.2 }] },
  { name: 'Blind spot / rear radar (pair)', category: 'calibration', lines: [{ desc: 'Left + right blind spot radar calibration', rate_key: 'calibration', hours: 1.5 }] },
  { name: '360 camera calibration', category: 'calibration', lines: [{ desc: 'Surround view camera calibration, all four cameras', rate_key: 'calibration', hours: 2.0 }] },
  { name: 'Pre / post scan', category: 'diagnostic', lines: [{ desc: 'Pre-repair diagnostic scan, all modules', rate_key: 'diagnostic', hours: 0.5 }, { desc: 'Post-repair diagnostic scan, all modules, clear codes', rate_key: 'diagnostic', hours: 0.5 }] },
  { name: 'Module programming', category: 'programming', lines: [{ desc: 'Module programming / software update', rate_key: 'programming', hours: 1.0 }] },
  { name: 'Steering angle sensor reset', category: 'diagnostic', lines: [{ desc: 'Steering angle sensor zero-point reset', rate_key: 'diagnostic', hours: 0.3 }] },
  { name: 'Diagnostic (1 hr cap)', category: 'diagnostic', lines: [{ desc: 'Diagnostic time, customer-reported fault', rate_key: 'diagnostic', hours: 1.0 }] },
  { name: 'Windshield replacement calibration package', category: 'calibration', lines: [{ desc: 'Front camera static calibration after windshield replacement', rate_key: 'calibration', hours: 1.5 }, { desc: 'Post-calibration scan and clear', rate_key: 'diagnostic', hours: 0.5 }] },
]
const rowToTpl = r => ({ id: String(r.ROWID), name: r.et_name || '', category: r.et_category || 'mechanical', invoice_description: r.et_invoice_description || '', lines: json(r.et_lines_json, []), sort: int(r.et_sort), uses: int(r.et_uses), seed: bool(r.et_seed), created_by: r.et_created_by || '' })
R.get('/templates', async (req, res) => {
  try {
    let rows = unwrap(await zcql(req, `SELECT * FROM ${T.tpl} ORDER BY et_uses DESC LIMIT 200`), T.tpl)
    if (rows.length === 0) {   // first run: seed the spec list (mechanical/diagnostic placeholders; calibration hours only matter when no Books item is picked)
      const t = tbl(req, T.tpl)
      for (const [i, s] of SEED_TEMPLATES.entries()) await t.insertRow({ et_name: s.name, et_category: s.category, et_invoice_description: s.name, et_lines_json: JSON.stringify(cleanLines(s.lines)), et_sort: i, et_uses: 0, et_seed: true, et_created_by: 'seed', et_created_at: now() })
      rows = unwrap(await zcql(req, `SELECT * FROM ${T.tpl} ORDER BY et_sort ASC LIMIT 200`), T.tpl)
    }
    res.json({ ok: true, templates: rows.map(rowToTpl) })
  } catch (e) { fail(res, e, 'templates') }
})
R.post('/templates', staffOnly, async (req, res) => {
  try {
    const b = req.body || {}
    if (!str(b.name).trim()) return res.status(400).json({ error: 'Template needs a name' })
    const row = await tbl(req, T.tpl).insertRow({ et_name: str(b.name, 200), et_category: JOB_CATEGORIES.includes(b.category) ? b.category : 'mechanical', et_invoice_description: str(b.invoice_description || b.name), et_lines_json: JSON.stringify(cleanLines(b.lines)), et_sort: 99, et_uses: 0, et_seed: false, et_created_by: who(req), et_created_at: now() })
    res.json({ ok: true, template: rowToTpl(row) })
  } catch (e) { fail(res, e, 'template create') }
})
R.delete('/templates/:id', staffOnly, async (req, res) => { try { await tbl(req, T.tpl).deleteRow(String(req.params.id)); res.json({ ok: true }) } catch (e) { fail(res, e, 'template delete') } })

// Learned jobs (Mark 2026-09-14: "have this app learn the most common jobs
// and pricing for these jobs"). Every saved job teaches the app: group by
// name, count uses, take the most recent lines (latest prices) and the
// median total as "usually". No separate table — it reads what was billed.
R.get('/common-jobs', async (req, res) => {
  try {
    const rows = unwrap(await zcql(req, `SELECT ej_name, ej_category, ej_lines_json, ej_total_cents, ej_invoice_description, ej_status FROM ${T.job} ORDER BY CREATEDTIME DESC LIMIT 300`), T.job)
    const groups = new Map()
    for (const r of rows) {
      const name = String(r.ej_name || '').replace(/\s*\(copy\)\s*$/i, '').trim()
      if (!name || /^job \d+$/i.test(name)) continue
      const key = name.toLowerCase()
      const lines = json(r.ej_lines_json, [])
      if (!lines.length) continue
      const g = groups.get(key) || { name, category: r.ej_category || 'mechanical', count: 0, totals: [], lines, invoice_description: r.ej_invoice_description || '', approved: 0 }
      g.count += 1; g.totals.push(int(r.ej_total_cents)); if (r.ej_status === 'approved') g.approved += 1
      groups.set(key, g)
    }
    const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }
    const common = [...groups.values()].map(g => ({ name: g.name, category: g.category, count: g.count, approved: g.approved, usual_cents: median(g.totals), last_cents: g.totals[0], lines: g.lines, invoice_description: g.invoice_description }))
      .sort((a, b) => b.count - a.count || b.approved - a.approved).slice(0, 15)
    res.json({ ok: true, common })
  } catch (e) { fail(res, e, 'common-jobs') }
})

// 🤖 Rick — the estimator's AI (Mark 2026-09-14: "the estimator AI agent's
// name is Rick"). Rick writes prose, never facts: the invoice line comes
// only from the job's own lines and parts. Model is a settings value.
R.post('/rick/describe', staffOnly, async (req, res) => {
  try {
    const { name = '', lines = [], vehicle = '' } = req.body || {}
    const facts = (Array.isArray(lines) ? lines : []).filter(l => l?.desc).map(l => `- ${l.desc}${Number(l.hours) ? ` (${l.hours} hr)` : ''}${(l.parts || []).length ? ' · parts: ' + l.parts.filter(p => p?.desc || p?.pn).map(p => `${p.desc || ''}${p.pn ? ` ${p.pn}` : ''} (${p.source || 'oem'}${Number(p.qty) > 1 ? ` ×${p.qty}` : ''})`).join(', ') : ''}`).join('\n')
    if (!facts) return res.status(400).json({ error: 'Rick needs at least one line with a description.' })
    const settings = await loadSettings(req)
    const model = settings.rick_model || 'claude-haiku-4-5'
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 20000, maxRetries: 1 })
    const msg = await client.messages.create({
      model, max_tokens: 120, temperature: 0.2,
      system: 'You are Rick, the estimator at Absolute ADAS, a mobile ADAS calibration company in Washington State. Write ONE customer-facing invoice line for a repair job, the way it should read on a Zoho Books invoice a collision shop or vehicle owner sees. Rules: use ONLY the operations and parts given; never invent a part, operation, procedure, or spec; no prices, no marketing words, no exclamation points; at most 18 words; plain words a shop owner reads at a glance (e.g. "Replace front brake pads and rotors with installation"). Output the sentence only, no quotes.',
      messages: [{ role: 'user', content: `Job name: ${name || '(none)'}\nVehicle: ${vehicle || '(unknown)'}\nWork performed:\n${facts}` }],
    })
    const description = String(msg.content?.[0]?.text || '').trim().replace(/^["“]|["”]$/g, '').slice(0, 255)
    res.json({ ok: true, description, model })
  } catch (e) { fail(res, e, 'rick describe') }
})

// Import a Zoho Books customer as a repair customer with their whole history
// (Mark 2026-09-15: "transfer over Mindy Grant… with all transactions and
// repair history"). Books stays untouched. Each Books invoice becomes an
// estimate marked invoiced (vehicle from the invoice custom fields, lines
// as flat-priced work), so the car's service history and warranty read
// exactly like work done in the app. Resumable: already-imported invoices
// are skipped, so call again until `remaining` is 0.
R.post('/retail-customers/import-books', staffOnly, async (req, res) => {
  try {
    const axios = (await import('axios')).default
    const { getAccessToken } = await import('../services/zoho.js')
    const token = await getAccessToken()
    const B = 'https://www.zohoapis.com/books/v3', H = { Authorization: `Zoho-oauthtoken ${token}` }, P = { organization_id: process.env.ZOHO_ORGANIZATION_ID }
    const name = str(req.body?.name || '', 200).trim(); let contactId = str(req.body?.contact_id || '', 40)
    const limit = Math.min(Number(req.body?.limit) || 12, 25)
    const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    // 1. the Books contact
    let contact = null
    if (contactId) { const r = await axios.get(`${B}/contacts/${contactId}`, { headers: H, params: P, timeout: 15000, validateStatus: st => st < 500 }); contact = r.data?.contact || null }
    else if (name) { const r = await axios.get(`${B}/contacts`, { headers: H, params: { ...P, contact_name_contains: name.slice(0, 40), contact_type: 'customer' }, timeout: 15000, validateStatus: st => st < 500 }); const list = r.data?.contacts || []; contact = list.find(c => norm(c.contact_name) === norm(name)) || (list.length === 1 ? list[0] : null); if (!contact && list.length > 1) return res.status(409).json({ error: 'More than one Books customer matches — pick one', candidates: list.map(c => ({ contact_id: c.contact_id, name: c.contact_name, email: c.email, outstanding: c.outstanding_receivable_amount })) }) }
    if (!contact) return res.status(404).json({ error: `No Zoho Books customer named "${name}"` })
    contactId = String(contact.contact_id)
    // 2. the repair customer (find by Books id, else exact name, else create)
    let rows = unwrap(await zcql(req, `SELECT * FROM ${T.retail} WHERE er_zoho_contact_id = '${esc(contactId)}' LIMIT 1`), T.retail)
    if (!rows.length) rows = unwrap(await zcql(req, `SELECT * FROM ${T.retail} WHERE er_name = '${esc(contact.contact_name)}' LIMIT 1`), T.retail)
    const ba = contact.billing_address || {}
    const fields = { name: contact.contact_name, phone: contact.phone || contact.mobile || (rows[0]?.er_phone || ''), email: contact.email || (rows[0]?.er_email || ''), address: ba.address || (rows[0]?.er_address || ''), city: ba.city || (rows[0]?.er_city || ''), zip: ba.zip || (rows[0]?.er_zip || ''), zoho_contact_id: contactId, updated_at: now() }
    let customer
    if (rows.length) { await tbl(req, T.retail).updateRow({ ROWID: String(rows[0].ROWID), ...retailToRow(fields) }); customer = await getRetail(req, String(rows[0].ROWID)) }
    else { const ins = await tbl(req, T.retail).insertRow(retailToRow({ ...fields, source: 'imported from Zoho Books', vehicles: [], tags: [], last_contact: now(), created_at: now() })); customer = await getRetail(req, String(ins.ROWID)) }
    // 3. every Books invoice for this contact (all time), minus the ones already imported
    const invs = []
    for (let page = 1; page <= 20; page++) { const r = await axios.get(`${B}/invoices`, { headers: H, params: { ...P, customer_id: contactId, per_page: 200, page, sort_column: 'date', sort_order: 'A' }, timeout: 20000 }); invs.push(...(r.data?.invoices || [])); if (r.data?.page_context?.has_more_page !== true) break }
    const live = invs.filter(i => !['void', 'draft'].includes(String(i.status || '').toLowerCase()))
    const have = new Set(unwrap(await zcql(req, `SELECT es_zoho_invoice_id FROM ${T.est} WHERE es_customer_id = '${esc(customer.id)}' LIMIT 300`), T.est).map(r => String(r.es_zoho_invoice_id || '')).filter(Boolean))
    const todo = live.filter(i => !have.has(String(i.invoice_id))).slice(0, limit)
    const settings = await loadSettings(req)
    const cf = (inv, ...keys) => { for (const f of inv.custom_fields || []) { const k = String(f.api_name || '').toLowerCase(), l = String(f.label || '').toLowerCase(); if (keys.some(x => k === x || l === x)) return String(f.value || '').trim() } return '' }
    const imported = []
    for (const li of todo) {
      const d = await axios.get(`${B}/invoices/${li.invoice_id}`, { headers: H, params: P, timeout: 20000, validateStatus: st => st < 500 })
      const inv = d.data?.invoice; if (!inv) continue
      const notes = String(inv.notes || '')
      const milesM = notes.match(/(?:odometer|mileage|miles)[^0-9]{0,12}([0-9][0-9,]{3,7})/i) || String(cf(inv, 'cf_odometer', 'odometer', 'mileage')).match(/([0-9][0-9,]{3,7})/)
      const vehicle = { year: cf(inv, 'cf_year', 'year'), make: cf(inv, 'cf_make', 'make'), model: cf(inv, 'cf_model', 'model'), vin: cf(inv, 'cf_vin', 'vin').toUpperCase().replace(/[^A-Z0-9]/g, ''), plate: cf(inv, 'cf_plate', 'plate', 'license plate') }
      const subtotal = Math.round(Number(inv.sub_total || 0) * 100), tax = Math.round(Number(inv.tax_total || 0) * 100), discount = Math.round(Number(inv.discount_total ?? inv.discount ?? 0) * 100)
      const GENERIC = /^(mechanical|diagnostic|labor|parts?|sublet|service|calibration)$/i
      const lines = (inv.line_items || []).map(x => ({ id: newId(), desc: (GENERIC.test(String(x.name || '').trim()) && x.description ? `${x.description} (${x.name})` : [x.name, x.description].filter(Boolean).join(' — ')).slice(0, 300), rate_key: 'mechanical', hours: 0, rate_override_cents: null, flat_cents: Math.round(Number(x.item_total ?? (Number(x.rate) * Number(x.quantity || 1))) * 100), item_id: x.item_id ? String(x.item_id) : undefined, taxable: tax > 0 && (Number(x.tax_percentage) > 0 || !!x.tax_id || !(inv.line_items || []).some(y => Number(y.tax_percentage) > 0 || y.tax_id)), notes: '', parts: [] }))
      const invDate = String(inv.date || li.date || '').slice(0, 10)
      const e = {
        number: await nextNumber(req), status: 'invoiced', customer_kind: 'retail', customer_id: customer.id, customer_name: customer.name, customer_type: 'retail',
        customer_contact: { phone: customer.phone, email: customer.email, address: customer.address, city: customer.city, zip: customer.zip }, zoho_contact_id: contactId, reseller_permit: '',
        ...vehicle, trim: '', mileage: milesM ? milesM[1] : '', ro_number: cf(inv, 'cf_ro_1', 'ro#', 'ro #', 'ro') || String(inv.reference_number || ''), claim_number: '', insurer: cf(inv, 'cf_insurer', 'insurer'),
        service_address: customer.address, service_city: customer.city, service_zip: customer.zip,
        tax_enabled: tax > 0, tax_rate_bp: tax > 0 && subtotal > 0 ? Math.round(tax / Math.max(1, subtotal - discount) * 10000) : 0, zoho_tax_id: '', tax_note: tax > 0 ? '' : 'imported from Zoho Books · no tax on the invoice',
        supplies_enabled: false, supplies_pct_bp: settings.supplies_pct_bp, supplies_cap_cents: settings.supplies_cap_cents, discount_type: discount > 0 ? 'flat' : 'none', discount_value: discount, detail_level: '',
        labor_rate_cents: settings.labor_rate_cents || 20000, parts_markup_bp: settings.parts_markup_bp ?? 4000,
        concern: notes.slice(0, 2000) || `Imported from Zoho Books invoice ${inv.invoice_number}`, notes: `Imported from Zoho Books · invoice ${inv.invoice_number} · status ${inv.status} · balance $${Number(inv.balance || 0).toFixed(2)}`, terms: '', valid_until: '',
        totals: {}, grand_total_cents: Math.round(Number(inv.total || 0) * 100), flags: [], zoho_invoice_id: String(inv.invoice_id), zoho_invoice_number: String(inv.invoice_number || ''), pushed_at: invDate, push_status: `imported from Books by ${who(req)}`,
        sent_at: invDate, approved_at: invDate, created_by: 'Zoho Books import', created_at: `${invDate}T12:00:00.000Z`, updated_at: now(),
      }
      const row = await tbl(req, T.est).insertRow(estToRow(e)); const estId = String(row.ROWID)
      const jobName = (lines[0]?.desc || `Invoice ${inv.invoice_number}`).split(' — ')[0].slice(0, 200)
      await tbl(req, T.job).insertRow(jobToRow({ estimate_id: estId, sort: 0, name: lines.length > 1 ? `Invoice ${inv.invoice_number} · ${lines.length} items` : jobName, invoice_description: lines.map(l => l.desc.split(' — ')[0]).join(', ').slice(0, 255), category: /calibrat|scan|adas|radar|camera/i.test(lines.map(l => l.desc).join(' ')) ? 'calibration' : 'mechanical', status: 'approved', lines, notes: '', authorized_at: `${invDate}T12:00:00.000Z`, authorized_by_name: customer.name, authorized_method: 'written', authorized_by_employee: 'Zoho Books (imported)', authorized_amount_cents: Math.round(Number(inv.total || 0) * 100), created_at: now(), updated_at: now() }))
      await recompute(req, estId, { touchedJobId: null })
      // keep the Books total as the number of record on the imported estimate
      await tbl(req, T.est).updateRow({ ROWID: estId, es_grand_total_cents: Math.round(Number(inv.total || 0) * 100) })
      if (vehicle.vin || vehicle.make) await rememberVehicle(req, customer.id, { ...vehicle, mileage: e.mileage, last_service: invDate })
      imported.push({ estimate_id: estId, number: e.number, invoice: inv.invoice_number, date: invDate, total: Number(inv.total || 0), vehicle: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' '), lines: lines.length })
    }
    res.json({ ok: true, customer: await getRetail(req, customer.id), books: { contact_id: contactId, name: contact.contact_name, invoices_total: live.length, outstanding: Number(contact.outstanding_receivable_amount || 0) }, imported, remaining: live.length - have.size - imported.length })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// Service history + warranty (Mark 2026-09-15)
R.get('/retail-customers/:id/history', async (req, res) => { try { const { vehicleHistory } = await import('../services/estimator/history.js'); res.json({ ok: true, ...(await vehicleHistory(req, internals, { customer_id: String(req.params.id) })) }) } catch (e) { fail(res, e, 'history') } })
R.get('/vehicle-history', async (req, res) => { try { const { vehicleHistory } = await import('../services/estimator/history.js'); const vin = String(req.query.vin || '').trim(); const cid = String(req.query.customer_id || '').trim(); if (!vin && !cid) return res.json({ ok: true, vehicles: [] }); res.json({ ok: true, ...(await vehicleHistory(req, internals, vin.length >= 8 ? { vin } : { customer_id: cid })) }) } catch (e) { fail(res, e, 'vehicle history') } })

// Estimates
R.get('/', async (req, res) => {
  try {
    const rows = unwrap(await zcql(req, `SELECT ROWID, es_number, es_status, es_customer_name, es_customer_kind, es_year, es_make, es_model, es_ro_number, es_grand_total_cents, es_flags, es_created_at, es_updated_at, es_sent_at, es_created_by, es_insurer, es_vin FROM ${T.est} ORDER BY CREATEDTIME DESC LIMIT 300`), T.est)
    res.json({ ok: true, estimates: rows.map(r => ({
      id: String(r.ROWID), number: r.es_number, status: r.es_status || 'draft', customer_name: r.es_customer_name || '', customer_kind: r.es_customer_kind || 'shop',
      year: r.es_year || '', make: r.es_make || '', model: r.es_model || '', ro_number: r.es_ro_number || '', insurer: r.es_insurer || '', vin: r.es_vin || '',
      grand_total_cents: int(r.es_grand_total_cents), flags: (r.es_flags || '').split(',').filter(Boolean), created_at: r.es_created_at || r.CREATEDTIME || '', updated_at: r.es_updated_at || '', sent_at: r.es_sent_at || '', created_by: r.es_created_by || '',
    })) })
  } catch (e) { fail(res, e, 'list') }
})
R.post('/', staffOnly, async (req, res) => {
  try {
    const b = req.body || {}
    const settings = await loadSettings(req)
    const kind = b.customer_kind === 'retail' ? 'retail' : 'shop'
    const customer_type = b.customer_type || (kind === 'retail' ? 'retail' : 'wholesale')
    const zip = str(b.service_zip || b.customer_contact?.zip || '', 12)
    const taxRow = settings.tax_by_zip?.[zip]
    const discountPct = Number(b.discount_pct || 0)
    const e = {
      number: await nextNumber(req), status: 'draft', customer_kind: kind, customer_id: b.customer_id || '', customer_name: b.customer_name || '', customer_type,
      customer_contact: b.customer_contact || {}, zoho_contact_id: b.zoho_contact_id || '', reseller_permit: b.reseller_permit || '',
      year: b.year || '', make: b.make || '', model: b.model || '', trim: b.trim || '', vin: b.vin || '', plate: b.plate || '', mileage: b.mileage || '',
      ro_number: b.ro_number || '', claim_number: b.claim_number || '', insurer: b.insurer || '',
      service_address: b.service_address || '', service_city: b.service_city || (taxRow?.city || ''), service_zip: zip,
      tax_enabled: customer_type === 'retail', tax_rate_bp: int(taxRow?.rate_bp), zoho_tax_id: taxRow?.tax_id || '', tax_note: '',
      supplies_enabled: customer_type === 'retail', supplies_pct_bp: settings.supplies_pct_bp, supplies_cap_cents: settings.supplies_cap_cents,
      discount_type: discountPct > 0 ? 'pct' : 'none', discount_value: discountPct > 0 ? Math.round(discountPct * 100) : 0, detail_level: '',
      labor_rate_cents: int(settings.labor_rate_cents) || 20000, parts_markup_bp: settings.parts_markup_bp == null ? 4000 : int(settings.parts_markup_bp),
      concern: b.concern || '', notes: '', terms: '', valid_until: '', totals: {}, grand_total_cents: 0, flags: [],
      created_by: who(req), created_at: now(), updated_at: now(), job_id: b.job_id || '',
    }
    if (kind === 'retail' && e.customer_id) { const rc = await getRetail(req, e.customer_id).catch(() => null); if (rc) { e.zoho_contact_id = e.zoho_contact_id || rc.zoho_contact_id; e.customer_name = e.customer_name || rc.name; if (!Object.keys(e.customer_contact || {}).length) e.customer_contact = { phone: rc.phone, email: rc.email, address: rc.address, city: rc.city, zip: rc.zip }; if (!e.service_zip && rc.zip) e.service_zip = rc.zip } }
    const row = await tbl(req, T.est).insertRow(estToRow(e))
    const id = String(row.ROWID)
    if (kind === 'retail' && e.customer_id && (e.vin || e.make)) rememberVehicle(req, e.customer_id, e).catch(() => {})
    const full = await recompute(req, id, { est: { ...e, id }, jobs: [] })
    res.json({ ok: true, estimate: full })
  } catch (e) { fail(res, e, 'create') }
})
R.get('/:id', async (req, res) => {
  try {
    const est = await getEst(req, req.params.id)
    if (!est) return res.status(404).json({ error: 'Estimate not found' })
    const jobs = await getJobs(req, est.id)
    const settings = await loadSettings(req)
    const r = computeEstimate({ ...est, jobs }, settings)
    res.json({ ok: true, estimate: { ...est, totals: r.totals, jobs: r.jobs, ready: readyToSend({ ...est, jobs }), settings, flags: flagsFor(est, r.totals, settings) } })
  } catch (e) { fail(res, e, 'get') }
})
R.put('/:id', staffOnly, async (req, res) => {
  try {
    const cur = await getEst(req, req.params.id)
    if (!cur) return res.status(404).json({ error: 'Estimate not found' })
    if (cur.status === 'invoiced') return res.status(409).json({ error: 'Invoiced estimates are locked.' })
    const b = { ...(req.body || {}) }
    for (const k of ['id', 'number', 'status', 'totals', 'grand_total_cents', 'flags', 'created_at', 'created_by', 'zoho_invoice_id', 'zoho_estimate_id', 'pushed_at', 'push_status', 'sent_at', 'approved_at']) delete b[k]
    if (b.tax_enabled === false && cur.tax_enabled && !str(b.tax_note ?? cur.tax_note).trim() && (b.customer_type ?? cur.customer_type) === 'retail') return res.status(400).json({ error: 'Turning tax off for a retail customer needs a note (why).' })
    if (b.customer_type === 'wholesale' && cur.customer_type !== 'wholesale' && b.tax_enabled === undefined) b.tax_enabled = false
    if (b.customer_type === 'retail' && cur.customer_type !== 'retail' && b.tax_enabled === undefined) b.tax_enabled = true
    await tbl(req, T.est).updateRow({ ROWID: String(cur.id), ...estToRow({ ...b, updated_at: now() }) })
    const nx = { ...cur, ...b }
    if (nx.customer_kind === 'retail' && nx.customer_id && ['vin', 'year', 'make', 'model', 'trim', 'plate', 'customer_id'].some(k => b[k] !== undefined) && (nx.vin || nx.make)) await rememberVehicle(req, nx.customer_id, nx)
    res.json({ ok: true, estimate: await recompute(req, cur.id) })
  } catch (e) { fail(res, e, 'update') }
})
R.delete('/:id', staffOnly, async (req, res) => {
  try {
    const cur = await getEst(req, req.params.id)
    if (!cur) return res.status(404).json({ error: 'Estimate not found' })
    if (cur.status === 'invoiced' && !isOwner(req)) return res.status(409).json({ error: 'Invoiced estimates can only be deleted by Mark.' })
    for (const j of await getJobs(req, cur.id)) await tbl(req, T.job).deleteRow(String(j.id))
    await tbl(req, T.est).deleteRow(String(cur.id))
    res.json({ ok: true })
  } catch (e) { fail(res, e, 'delete') }
})
// Status: draft → sent (RCW header check) → approved → invoiced; declined
R.post('/:id/status', staffOnly, async (req, res) => {
  try {
    const status = str(req.body?.status, 30)
    if (!['draft', 'sent', 'approved', 'declined', 'invoiced'].includes(status)) return res.status(400).json({ error: 'Bad status' })
    const cur = await getEst(req, req.params.id)
    if (!cur) return res.status(404).json({ error: 'Estimate not found' })
    const jobs = await getJobs(req, cur.id)
    const patch = { status }
    if (status === 'sent') {
      const ready = readyToSend({ ...cur, jobs })
      if (!ready.ok && !(req.body?.force && isOwner(req))) return res.status(422).json({ error: `Not ready to send: ${ready.missing.join(', ')}`, missing: ready.missing })
      patch.sent_at = now()
    }
    if (status === 'approved') {
      if (!jobs.some(j => j.status === 'approved')) return res.status(422).json({ error: 'Approve at least one job first.' })
      patch.approved_at = now()
      if (cur.customer_kind === 'retail' && cur.customer_id) rememberVehicle(req, cur.customer_id, { ...cur, last_service: now().slice(0, 10) }).catch(() => {})
    }
    if (status === 'invoiced') return res.status(409).json({ error: 'Invoiced is set by the Books push (next phase).' })
    await tbl(req, T.est).updateRow({ ROWID: String(cur.id), ...estToRow({ ...patch, updated_at: now() }) })
    res.json({ ok: true, estimate: await recompute(req, cur.id) })
  } catch (e) { fail(res, e, 'status') }
})

// Jobs
R.post('/:id/jobs', staffOnly, async (req, res) => {
  try {
    const cur = await getEst(req, req.params.id)
    if (!cur) return res.status(404).json({ error: 'Estimate not found' })
    if (cur.status === 'invoiced') return res.status(409).json({ error: 'Invoiced estimates are locked.' })
    const b = req.body || {}
    const jobs = await getJobs(req, cur.id)
    let lines = b.lines, name = b.name, category = b.category, invoice_description = b.invoice_description
    if (b.template_id) {
      const tr = await tbl(req, T.tpl).getRow(String(b.template_id))
      if (tr) { const t = rowToTpl(tr); lines = lines || t.lines; name = name || t.name; category = category || t.category; invoice_description = invoice_description || t.invoice_description; await tbl(req, T.tpl).updateRow({ ROWID: t.id, et_uses: t.uses + 1 }).catch(() => {}) }
    }
    const j = {
      estimate_id: cur.id, sort: jobs.length ? Math.max(...jobs.map(x => x.sort)) + 1 : 0, name: name || `Job ${jobs.length + 1}`, invoice_description: invoice_description || name || '',
      category: JOB_CATEGORIES.includes(category) ? category : 'mechanical', status: JOB_STATUSES.includes(b.status) ? b.status : 'recommended',
      lines: cleanLines(lines || []), notes: b.notes || '', created_at: now(), updated_at: now(),
    }
    const row = await tbl(req, T.job).insertRow(jobToRow(j))
    res.json({ ok: true, job_id: String(row.ROWID), estimate: await recompute(req, cur.id, { touchedJobId: String(row.ROWID) }) })
  } catch (e) { fail(res, e, 'job create') }
})
R.put('/:id/jobs/:jid', staffOnly, async (req, res) => {
  try {
    const cur = await getEst(req, req.params.id)
    if (!cur) return res.status(404).json({ error: 'Estimate not found' })
    if (cur.status === 'invoiced') return res.status(409).json({ error: 'Invoiced estimates are locked.' })
    const jr = await tbl(req, T.job).getRow(String(req.params.jid))
    if (!jr || String(jr.ej_estimate_id) !== String(cur.id)) return res.status(404).json({ error: 'Job not found' })
    const job = rowToJob(jr)
    const b = { ...(req.body || {}) }
    for (const k of ['id', 'estimate_id', 'labor_cents', 'parts_cents', 'total_cents', 'created_at']) delete b[k]
    if (b.status && !JOB_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Bad job status' })
    if (b.category && !JOB_CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'Bad job category' })
    // Approving records the authorization (RCW 46.71: date+time, amount, who, method, employee — all five for oral)
    if (b.status === 'approved' && job.status !== 'approved') {
      const auth = { authorized_at: b.authorized_at || now(), authorized_amount_cents: b.authorized_amount_cents, authorized_by_name: b.authorized_by_name, authorized_method: b.authorized_method || 'oral', authorized_by_employee: b.authorized_by_employee || who(req) }
      const chk = authorizationComplete(auth)
      if (!chk.ok) return res.status(422).json({ error: `Authorization incomplete: ${chk.missing.join(', ')}`, missing: chk.missing })
      Object.assign(b, auth)
    }
    if (b.status === 'declined' && !str(b.decline_reason ?? job.decline_reason).trim()) b.decline_reason = 'declined'
    await tbl(req, T.job).updateRow({ ROWID: String(job.id), ...jobToRow({ ...b, updated_at: now() }) })
    res.json({ ok: true, estimate: await recompute(req, cur.id, { touchedJobId: String(job.id) }) })
  } catch (e) { fail(res, e, 'job update') }
})
R.post('/:id/jobs/:jid/duplicate', staffOnly, async (req, res) => {
  try {
    const cur = await getEst(req, req.params.id)
    if (!cur) return res.status(404).json({ error: 'Estimate not found' })
    const jr = await tbl(req, T.job).getRow(String(req.params.jid))
    if (!jr) return res.status(404).json({ error: 'Job not found' })
    const job = rowToJob(jr)
    const jobs = await getJobs(req, cur.id)
    const copy = { estimate_id: cur.id, sort: Math.max(...jobs.map(x => x.sort), -1) + 1, name: `${job.name} (copy)`, invoice_description: job.invoice_description, category: job.category, status: 'recommended', lines: cleanLines(job.lines).map(l => ({ ...l, id: newId(), parts: l.parts.map(p => ({ ...p, id: newId() })) })), notes: job.notes, created_at: now(), updated_at: now() }
    const row = await tbl(req, T.job).insertRow(jobToRow(copy))
    res.json({ ok: true, job_id: String(row.ROWID), estimate: await recompute(req, cur.id, { touchedJobId: String(row.ROWID) }) })
  } catch (e) { fail(res, e, 'job duplicate') }
})
R.delete('/:id/jobs/:jid', staffOnly, async (req, res) => {
  try {
    const cur = await getEst(req, req.params.id)
    if (!cur) return res.status(404).json({ error: 'Estimate not found' })
    if (cur.status === 'invoiced') return res.status(409).json({ error: 'Invoiced estimates are locked.' })
    await tbl(req, T.job).deleteRow(String(req.params.jid))
    res.json({ ok: true, estimate: await recompute(req, cur.id) })
  } catch (e) { fail(res, e, 'job delete') }
})
R.post('/:id/reorder', staffOnly, async (req, res) => {
  try {
    const order = Array.isArray(req.body?.order) ? req.body.order.map(String) : []
    const jobs = await getJobs(req, req.params.id)
    for (const j of jobs) { const i = order.indexOf(j.id); if (i >= 0 && i !== j.sort) await tbl(req, T.job).updateRow({ ROWID: j.id, ej_sort: i }) }
    res.json({ ok: true, estimate: await recompute(req, req.params.id) })
  } catch (e) { fail(res, e, 'reorder') }
})
// Save a job as a template
R.post('/:id/jobs/:jid/save-template', staffOnly, async (req, res) => {
  try {
    const jr = await tbl(req, T.job).getRow(String(req.params.jid))
    if (!jr) return res.status(404).json({ error: 'Job not found' })
    const job = rowToJob(jr)
    const row = await tbl(req, T.tpl).insertRow({ et_name: str(req.body?.name || job.name, 200), et_category: job.category, et_invoice_description: job.invoice_description || job.name, et_lines_json: JSON.stringify(cleanLines(job.lines)), et_sort: 99, et_uses: 0, et_seed: false, et_created_by: who(req), et_created_at: now() })
    res.json({ ok: true, template: rowToTpl(row) })
  } catch (e) { fail(res, e, 'save template') }
})

// Shared internals for the send / push / 3C routes and the public approval router
export const internals = { getEst, getJobs, recompute, loadSettings, tbl, T, zcql, unwrap, esc, estToRow, jobToRow, rowToJob, rowToEst, readyToSend, now, who, isOwner, staffOnly, fail, json }
mountMore(R, internals)

export default estimatorRouter
