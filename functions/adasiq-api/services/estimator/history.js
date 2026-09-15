// Vehicle service history + warranty (Mark 2026-09-15: "customers that I
// do all their maintenance… see all the work we have done with the car
// info and mileage… I guarantee the work for 12 months or 12,000 miles…
// customers may have several cars").
// Derived from estimates: every approved/invoiced job on a car, with the
// odometer at that visit. Warranty per job = service date + months, and
// odometer + miles; "active" while today is inside the window and the
// latest odometer we know is under the mile cap.
import { computeEstimate } from './calc.js'

export const DEFAULT_WARRANTY = { warranty_months: 12, warranty_miles: 12000 }
export const parseMiles = v => { const n = parseInt(String(v || '').replace(/[^0-9]/g, ''), 10); return Number.isFinite(n) ? n : null }
const addMonths = (iso, m) => { const d = new Date(iso); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10) }
const vkey = v => (v.vin && String(v.vin).length >= 8) ? `vin:${String(v.vin).toUpperCase()}` : `ymm:${[v.year, v.make, v.model].map(x => String(x || '').toLowerCase().trim()).join('|')}`

/**
 * History for one retail customer (all cars) or one VIN across customers.
 * I = estimator internals (zcql/unwrap/esc/rowToJob/loadSettings/…)
 */
export async function vehicleHistory(req, I, { customer_id = '', vin = '' } = {}) {
  const settings = await I.loadSettings(req)
  const months = Number(settings.warranty_months ?? DEFAULT_WARRANTY.warranty_months) || 0
  const miles = Number(settings.warranty_miles ?? DEFAULT_WARRANTY.warranty_miles) || 0
  const where = customer_id ? `es_customer_id = '${I.esc(customer_id)}'` : `es_vin = '${I.esc(String(vin).toUpperCase())}'`
  const ests = I.unwrap(await I.zcql(req, `SELECT * FROM ${I.T.est} WHERE ${where} ORDER BY CREATEDTIME DESC LIMIT 300`), I.T.est).map(I.rowToEst)
  if (!ests.length) return { vehicles: [], warranty: { months, miles } }
  const jobsByEst = {}
  for (const part of chunk(ests.map(e => e.id), 40)) {
    const rows = I.unwrap(await I.zcql(req, `SELECT * FROM ${I.T.job} WHERE ej_estimate_id IN (${part.map(id => `'${I.esc(id)}'`).join(',')}) ORDER BY ej_sort ASC LIMIT 300`), I.T.job).map(I.rowToJob)
    for (const j of rows) (jobsByEst[j.estimate_id] = jobsByEst[j.estimate_id] || []).push(j)
  }
  const today = new Date().toISOString().slice(0, 10)
  const vehicles = {}
  for (const e of ests) {
    if (!e.vin && !e.make) continue
    const key = vkey(e)
    const v = vehicles[key] || (vehicles[key] = { key, vin: e.vin || '', year: e.year || '', make: e.make || '', model: e.model || '', trim: e.trim || '', plate: e.plate || '', last_mileage: null, last_service: '', visits: 0, lifetime_cents: 0, entries: [] })
    const jobs = (jobsByEst[e.id] || [])
    const r = computeEstimate({ ...e, jobs }, settings)
    // Imported Books invoices keep the Books total as the number of record (tax/rounding lived in Books)
    if (e.created_by === 'Zoho Books import' && e.grand_total_cents) r.totals.grand_total = e.grand_total_cents
    const date = (e.approved_at || e.sent_at || e.created_at || '').slice(0, 10)
    const mileage = parseMiles(e.mileage)
    const done = ['approved', 'invoiced'].includes(e.status)
    const entry = {
      estimate_id: e.id, number: e.number, status: e.status, date, mileage, total_cents: r.totals.grand_total, invoiced: !!e.zoho_invoice_id, invoice_number: e.zoho_invoice_number || '', concern: e.concern || '',
      jobs: r.jobs.map(j => ({ id: j.id, name: j.name, category: j.category, status: j.status, total_cents: j.total_cents, invoice_description: j.invoice_description,
        lines: (j.lines || []).map(l => ({ desc: l.desc, hours: l.hours, labor_cents: l.labor_cents, parts: (l.parts || []).map(p => ({ pn: p.pn, desc: p.desc, source: p.source, qty: p.qty, total_cents: p.total_cents })) })),
        warranty: done && j.status === 'approved' && (months || miles) ? { from_date: date, from_miles: mileage, until_date: months ? addMonths(date, months) : null, until_miles: miles && mileage != null ? mileage + miles : null } : null })),
    }
    v.entries.push(entry)
    if (done) { v.visits++; v.lifetime_cents += r.totals.grand_total; if (!v.last_service || date > v.last_service) v.last_service = date }
    if (mileage != null && (v.last_mileage == null || mileage > v.last_mileage)) v.last_mileage = mileage
    if (!v.trim && e.trim) v.trim = e.trim; if (!v.plate && e.plate) v.plate = e.plate
  }
  // Warranty status needs the latest odometer on the car
  for (const v of Object.values(vehicles)) {
    v.entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    for (const en of v.entries) for (const j of en.jobs) if (j.warranty) {
      const w = j.warranty
      const dateOk = !w.until_date || today <= w.until_date
      const milesOk = w.until_miles == null || v.last_mileage == null || v.last_mileage <= w.until_miles
      w.active = dateOk && milesOk; w.expired_by = !dateOk ? 'time' : !milesOk ? 'miles' : null
      w.days_left = w.until_date ? Math.ceil((new Date(w.until_date) - new Date(today)) / 86400000) : null
      w.miles_left = w.until_miles != null && v.last_mileage != null ? w.until_miles - v.last_mileage : null
    }
    v.under_warranty = v.entries.flatMap(en => en.jobs).filter(j => j.warranty?.active).length
  }
  return { vehicles: Object.values(vehicles).sort((a, b) => (b.last_service || '').localeCompare(a.last_service || '')), warranty: { months, miles } }
}
function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
