import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardScrub, triggerLinesFromText, demoteNissanParkRows } from '../services/scrubGuard.js'
import { applyMiss } from '../services/scrubLearn.js'

const ariya = (extra = {}) => ({
  make: 'Nissan', year: 2024, vehicle: '2024 Nissan Ariya',
  calibrations: [
    { calibration_name: 'Front Radar', enabled: true, trigger: 'Front bumper cover R&I (line 2)', line_references: '2' },
    { calibration_name: 'Rear Blind Spot Radar', enabled: true, trigger: 'Rear bumper cover R&I (line 37)', line_references: '37' },
    { calibration_name: 'Park Distance Sensor', enabled: true, cal_type: 'Reset', trigger: 'Rear bumper cover R&I (line 37) and front bumper cover R&I (line 2)', line_references: '2, 37', justification: 'Nissan ALLDATA requires zero-point reset after bumper removal.' },
    { calibration_name: 'Seat Weight Sensor', enabled: true, trigger: 'In collision (Nissan)', line_references: '11, 22' },
  ],
  ...extra,
})

test('Nissan bumper-cover drop turns park sensors off and keeps the radar', async () => {
  const data = ariya()
  const out = await guardScrub(data, '', { hitsPromise: Promise.resolve({ front_bumper: ['2'], rear_bumper: ['37'] }), text: '' })
  const park = data.calibrations.find(c => /park/i.test(c.calibration_name))
  assert.equal(park.enabled, false)
  assert.equal(park.line_references, '')
  assert.match(park.justification, /does not call for a Nissan sonar sensor reset/)
  assert.equal(data.calibrations.find(c => c.calibration_name === 'Front Radar').enabled, true)
  assert.equal(data.calibrations.find(c => /blind/i.test(c.calibration_name)).enabled, true)
  assert.equal(data.calibrations.find(c => /seat weight/i.test(c.calibration_name)).enabled, true)
  assert.ok(out.demoted.some(d => /park/i.test(d)))
})

test('Nissan keeps park sensors when a sonar line is removed', async () => {
  const data = ariya()
  data.calibrations.find(c => /park/i.test(c.calibration_name)).enabled = false
  await guardScrub(data, '', { hitsPromise: Promise.resolve({ front_bumper: ['2'], park_sensor: ['15'] }), text: '' })
  const park = data.calibrations.find(c => /park/i.test(c.calibration_name))
  assert.equal(park.enabled, true)
  assert.equal(park.line_references, '15')
})

test('CCC text with the line number glued to the operation still sees a sonar line', () => {
  const hits = triggerLinesFromText([
    'Wood Interior TrimParking SensorsHead/Curtain Air Bags',
    '2   *R&I  R&I bumper cover0.5',
    '37*R&I  R&I bumper cover0.5',
    '15*R&I  R&I sonar sensor1.0',
  ].join('\n'))
  assert.deepEqual(hits.park_sensor, ['15'])
})

test('a saved Ariya report with the bumper-drop trigger turns park sensors off', () => {
  const data = ariya()
  data.calibrations.find(c => /park/i.test(c.calibration_name)).trigger = 'Rear bumper cover R&I (line 37) and front bumper cover R&I (line 2) — Parking Sensors confirmed in options; Nissan ALLDATA requires zero-point reset after bumper removal'
  assert.equal(demoteNissanParkRows(data), true)
  assert.equal(data.calibrations.find(c => /park/i.test(c.calibration_name)).enabled, false)
  assert.equal(data.calibrations.find(c => c.calibration_name === 'Front Radar').enabled, true)
})

test('Honda bumper removal still requires the park sensor reset', async () => {
  const data = {
    make: 'Honda', year: 2024,
    calibrations: [
      { calibration_name: 'Park Distance Sensor', enabled: false, trigger: '', line_references: '' },
    ],
  }
  await guardScrub(data, '', { hitsPromise: Promise.resolve({ front_bumper: ['3'] }), text: '' })
  const park = data.calibrations.find(c => /park/i.test(c.calibration_name))
  assert.equal(park.enabled, true)
})

test('Missed does not turn a demoted guard row back on', () => {
  const row = { calibration_name: 'Park Distance Sensor', enabled: false, _guard: 'demoted', classification: 'NOT REQUIRED: VERIFIED' }
  const applied = applyMiss(row)
  assert.equal(applied.keptOff, true)
  assert.equal(row.enabled, false)
  assert.equal(row._guard, 'demoted')
  assert.equal(row.classification, 'NOT REQUIRED: VERIFIED')
})

test('Missed on a not-required row clears the classification that hid the click', () => {
  const row = { calibration_name: 'Back Up Camera', enabled: false, classification: 'NOT REQUIRED: VERIFIED' }
  const applied = applyMiss(row)
  assert.equal(applied.keptOff, false)
  assert.equal(row.enabled, true)
  assert.equal(row.classification, undefined)
  assert.equal(row._learned, 'flipped')
})
