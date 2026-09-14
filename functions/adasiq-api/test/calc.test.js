// node --test functions/adasiq-api/test   (spec §5 required cases + rounding)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeEstimate, computeJob, partTotal, lineLabor, readyToSend, authorizationComplete, toCents, fromCents } from '../services/estimator/calc.js'

const S = { rates: { mechanical: 15000, diagnostic: 17500, calibration: 20000, programming: 20000, r_and_i: 15000 }, supplies_pct_bp: 700, supplies_cap_cents: 5000, supplies_taxable: true }
const line = (o = {}) => ({ id: 'l', desc: 'x', rate_key: 'mechanical', hours: 1, rate_override_cents: null, flat_cents: null, taxable: true, parts: [], ...o })
const part = (o = {}) => ({ id: 'p', pn: '', desc: 'p', source: 'oem', qty: 1, cost_cents: 10000, markup_bp: 4000, price_cents: null, taxable: true, ...o })
const job = (o = {}) => ({ id: 'j', name: 'Job', status: 'approved', lines: [line()], ...o })
const est = (o = {}) => ({ tax_enabled: false, tax_rate_bp: 1030, supplies_enabled: false, supplies_pct_bp: 700, supplies_cap_cents: 5000, discount_type: 'none', discount_value: 0, jobs: [job()], ...o })

test('part total = qty × round(cost × (1+markup))', () => {
  assert.equal(partTotal(part()), 14000)
  assert.equal(partTotal(part({ qty: 3, cost_cents: 3333, markup_bp: 2500 })), 3 * 4166) // 3333*1.25 = 4166.25 → 4166, then ×3
  assert.equal(partTotal(part({ price_cents: 9999 })), 9999)             // manual override wins
})

test('line labor = hours × rate, one decimal, override and flat price', () => {
  assert.equal(lineLabor(line({ hours: 1.5 }), S.rates), 22500)
  assert.equal(lineLabor(line({ hours: 1.55 }), S.rates), 24000)         // 1.55 → 1.6 (one place) × 150
  assert.equal(lineLabor(line({ hours: 2, rate_override_cents: 9900 }), S.rates), 19800)
  assert.equal(lineLabor(line({ hours: 5, flat_cents: 45000 }), S.rates), 45000)
})

test('tax off → zero tax; tax on → taxable base × rate', () => {
  const off = computeEstimate(est(), S).totals
  assert.equal(off.tax, 0); assert.equal(off.grand_total, 15000)
  const on = computeEstimate(est({ tax_enabled: true }), S).totals
  assert.equal(on.tax, 1545); assert.equal(on.grand_total, 16545)        // 15000 × 10.30%
})

test('supplies off → 0; on → 7% of approved LABOR only, parts ignored', () => {
  const e = est({ jobs: [job({ lines: [line({ hours: 2, parts: [part({ cost_cents: 100000 })] })] })] })
  assert.equal(computeEstimate(e, S).totals.supplies, 0)
  const t = computeEstimate({ ...e, supplies_enabled: true }, S).totals
  assert.equal(t.labor_subtotal, 30000); assert.equal(t.parts_subtotal, 140000)
  assert.equal(t.supplies, 2100); assert.equal(t.supplies_capped, false)  // 7% of $300 labor, not of parts
})

test('supplies cap hit at $50', () => {
  const t = computeEstimate(est({ supplies_enabled: true, jobs: [job({ lines: [line({ hours: 10 })] })] }), S).totals
  assert.equal(t.labor_subtotal, 150000); assert.equal(t.supplies, 5000); assert.equal(t.supplies_capped, true)
})

test('mixed taxable and non-taxable lines and parts', () => {
  const e = est({ tax_enabled: true, tax_rate_bp: 1000, jobs: [job({ lines: [
    line({ hours: 1, taxable: true }),                                   // 15000 taxable
    line({ hours: 1, taxable: false, parts: [part({ taxable: true }), part({ taxable: false })] }), // labor 15000 non-tax, parts 14000 tax + 14000 non
  ] })] })
  const t = computeEstimate(e, S).totals
  assert.equal(t.subtotal, 58000); assert.equal(t.taxable_base, 29000); assert.equal(t.tax, 2900)
})

test('declined, recommended, deferred jobs never enter the money math', () => {
  const e = est({ tax_enabled: true, supplies_enabled: true, jobs: [
    job({ id: 'a', status: 'approved', lines: [line({ hours: 1 })] }),
    job({ id: 'b', status: 'declined', lines: [line({ hours: 4 })] }),
    job({ id: 'c', status: 'recommended', lines: [line({ hours: 2 })] }),
    job({ id: 'd', status: 'deferred', lines: [line({ hours: 3 })] }),
  ] })
  const t = computeEstimate(e, S).totals
  assert.equal(t.subtotal, 15000); assert.equal(t.supplies, 1050)
  assert.equal(t.declined_total, 60000); assert.equal(t.recommended_total, 30000); assert.equal(t.deferred_total, 45000)
  assert.equal(t.grand_total, 15000 + 1050 + Math.round((15000 + 1050) * 0.103))
})

test('multi-job rollup with per-job cents', () => {
  const r = computeEstimate(est({ jobs: [
    job({ id: 'a', lines: [line({ hours: 1, parts: [part()] })] }),
    job({ id: 'b', lines: [line({ hours: 0.5, rate_key: 'diagnostic' }), line({ hours: 1, rate_key: 'programming' })] }),
  ] }), S)
  assert.equal(r.jobs[0].total_cents, 29000); assert.equal(r.jobs[1].labor_cents, 8750 + 20000)
  assert.equal(r.totals.subtotal, 29000 + 28750)
})

test('discount: pct is basis points, flat is cents and never exceeds subtotal; tax share is proportional', () => {
  const pct = computeEstimate(est({ discount_type: 'pct', discount_value: 2500, tax_enabled: true, tax_rate_bp: 1000 }), S).totals
  assert.equal(pct.discount, 3750); assert.equal(pct.after_discount, 11250); assert.equal(pct.taxable_base, 11250); assert.equal(pct.tax, 1125)
  const flat = computeEstimate(est({ discount_type: 'flat', discount_value: 999999 }), S).totals
  assert.equal(flat.discount, 15000); assert.equal(flat.grand_total, 0)
})

test('110% threshold: flag flips exactly when approved pre-tax exceeds 110% of authorized', () => {
  const at = computeEstimate(est({ jobs: [job({ authorized_amount_cents: 13637, lines: [line({ hours: 1 })] })] }), S).totals
  assert.equal(at.over_110, false)                                        // 13637 × 1.1 = 15000.7 → 15001 ≥ 15000
  const edge = computeEstimate(est({ jobs: [job({ authorized_amount_cents: 13636, lines: [line({ hours: 1 })] })] }), S).totals
  assert.equal(edge.over_110, false)                                      // 13636 × 1.1 = 14999.6 → 15000, equal is not over
  const over = computeEstimate(est({ jobs: [job({ authorized_amount_cents: 13635, lines: [line({ hours: 1 })] })] }), S).totals
  assert.equal(over.over_110, true)                                       // 13635 × 1.1 = 14998.5 → 14999 < 15000
})

test('110% uses pre-tax total (tax excluded per RCW)', () => {
  const t = computeEstimate(est({ tax_enabled: true, tax_rate_bp: 1000, jobs: [job({ authorized_amount_cents: 14000, lines: [line({ hours: 1 })] })] }), S).totals
  assert.equal(t.pre_tax_total, 15000); assert.equal(t.over_110, false) // 15000 ≤ 15400 even though grand total is 16500
  assert.equal(t.unauthorized_approved, 0)
})

test('readyToSend lists every missing RCW header field', () => {
  const r = readyToSend({ jobs: [] })
  assert.ok(r.missing.includes('customer name')); assert.ok(r.missing.includes('odometer')); assert.ok(r.missing.includes('plate or VIN'))
  const ok = readyToSend({ customer_name: 'Shop', customer_contact: { phone: '425' }, service_address: '1 Main', year: '2023', make: 'Acura', model: 'RDX', vin: '5J8YE1H31PL000000', mileage: '12000', concern: 'Windshield', jobs: [job()] })
  assert.equal(ok.ok, true)
})

test('oral authorization needs all five', () => {
  assert.equal(authorizationComplete({}).missing.length, 5)
  assert.equal(authorizationComplete({ authorized_at: 'x', authorized_amount_cents: 100, authorized_by_name: 'a', authorized_method: 'oral', authorized_by_employee: 'Kat' }).ok, true)
})

test('cents helpers', () => {
  assert.equal(toCents('$1,234.56'), 123456); assert.equal(toCents('12.345'), 1235); assert.equal(fromCents(123456), '1234.56')
})
