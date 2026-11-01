// 📈 Month curve (Mark 2026-11-01: "end of month numbers drives it").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { learnCurve, curveAt, priorMonths, businessDays } from '../services/monthCurve.js'

// A back-loaded month: each working day sells more than the last.
function backLoaded(ym) {
  const [y, m] = ym.split('-').map(Number), out = {}, end = new Date(Date.UTC(y, m, 0)).getUTCDate()
  let k = 0
  for (let d = 1; d <= end; d++) { const iso = `${ym}-${String(d).padStart(2, '0')}`; const w = new Date(`${iso}T12:00:00Z`).getUTCDay(); if (w === 0 || w === 6) continue; out[iso] = 200 + 150 * k++ }
  return out
}

test('learns a back-loaded month', () => {
  const months = priorMonths('2026-11-02', 8)
  const byDay = Object.assign({}, ...months.map(backLoaded))
  const c = learnCurve(byDay, months)
  assert.equal(c.months, 8)
  assert.ok(curveAt(c, 0.5) < 0.4, `half the days → well under half the sales (${curveAt(c, 0.5)})`)
  assert.equal(curveAt(c, 0), 0); assert.equal(curveAt(c, 1), 1)
  for (let i = 1; i < c.points.length; i++) assert.ok(c.points[i] >= c.points[i - 1])
})

test('no history = even split', () => {
  const c = learnCurve({}, priorMonths('2026-11-02', 12))
  assert.equal(c.months, 0)
  assert.ok(Math.abs(curveAt(c, 0.5) - 0.5) < 1e-9)
})

test('thin history blends toward even', () => {
  const months = priorMonths('2026-11-02', 2)
  const c = learnCurve(Object.assign({}, ...months.map(backLoaded)), months)
  const full = learnCurve(Object.assign({}, ...priorMonths('2026-11-02', 8).map(backLoaded)), priorMonths('2026-11-02', 8))
  assert.ok(curveAt(c, 0.5) > curveAt(full, 0.5))
})

test('helpers', () => {
  assert.deepEqual(priorMonths('2026-01-05', 2), ['2025-12', '2025-11'])
  assert.equal(businessDays('2026-11-02', '2026-11-06'), 5)
})
