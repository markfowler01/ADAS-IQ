import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardScrub, stripTeslaBlindSpot } from '../services/scrubGuard.js'

const hits = (extra = {}) => Promise.resolve({ rear_bumper: ['12'], ...extra })

test('Tesla drops a required blind spot row and keeps the camera', async () => {
  const data = {
    make: 'Tesla', year: 2021, vehicle: '2021 Tesla Model S',
    calibrations: [
      { calibration_name: 'Rear Blind Spot Radar Calibration', enabled: true, trigger: 'Rear bumper replaced', line_references: '12' },
      { calibration_name: 'Around View Camera', enabled: true, trigger: 'Liftgate replaced' },
    ],
  }
  const out = await guardScrub(data, '', { hitsPromise: hits(), text: '' })
  assert.equal(data.calibrations.some(c => /blind|rear radar/i.test(c.calibration_name)), false)
  assert.equal(data.calibrations.some(c => /around view/i.test(c.calibration_name)), true)
  assert.ok(out.dropped.some(d => /blind spot/i.test(d)))
})

test('Tesla drops the full-service blind spot aim a rear bumper would add', async () => {
  const data = {
    make: 'Tesla', year: 2024,
    calibrations: [
      { calibration_name: 'Rear Blind Spot Radar', enabled: false, trigger: '', line_references: '' },
    ],
  }
  await guardScrub(data, '', { hitsPromise: hits(), text: '' })
  assert.equal(data.calibrations.some(c => /blind/i.test(c.calibration_name)), false)
})

test('a Honda rear bumper still keeps blind spot', async () => {
  const data = {
    make: 'Honda', year: 2021,
    calibrations: [
      { calibration_name: 'Rear Blind Spot Radar Calibration', enabled: true, trigger: 'Rear bumper cover replaced', line_references: '4' },
    ],
  }
  await guardScrub(data, '', { hitsPromise: Promise.resolve({ rear_bumper: ['4'] }), text: '' })
  assert.equal(data.calibrations.some(c => /blind/i.test(c.calibration_name) && c.enabled === true), true)
})

test('vehicle text is enough when make is blank', () => {
  const data = { make: '', vehicle: '2024 Tesla Model Y', calibrations: [{ calibration_name: 'Blind Spot Aim (Rear Bumper Removed)', enabled: false }] }
  const dropped = stripTeslaBlindSpot(data)
  assert.equal(dropped.length, 1)
  assert.equal(data.calibrations.length, 0)
})
