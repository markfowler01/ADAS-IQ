import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreLog } from '../services/scrubWatch.js'

test('weekly scorecard math: recall, precision, most-missed', () => {
  const at = new Date().toISOString()
  const log = [
    { vin: 'A', at, tp: 2, missed: ['Windshield Camera'], extra: [] },
    { vin: 'B', at, tp: 1, missed: ['Windshield Camera', 'Front Radar'], extra: ['Blind Spot'] },
    { vin: 'C', at: '2020-01-01T00:00:00Z', tp: 0, missed: ['Seat Weight'], extra: [] },   // outside the window
  ]
  const r = scoreLog(log, Date.now() - 7 * 86400000)
  assert.equal(r.cars, 2)
  assert.equal(Math.round(r.recall * 100), 50)        // 3 caught / 6 Kinetic calls
  assert.equal(Math.round(r.precision * 100), 75)     // 3 / 4 of ours
  assert.deepEqual(r.missed[0], ['Windshield Camera', 2])
})
