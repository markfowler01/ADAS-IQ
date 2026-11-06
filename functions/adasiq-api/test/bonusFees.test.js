import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPassThroughLine, passThroughTotals, eligibleCash } from '../services/bonusFees.js'

test('calibration ID and OEM fees are pass-through; the work is not', () => {
  assert.equal(isPassThroughLine('Calibration Identification Report'), true)
  assert.equal(isPassThroughLine('Calibration Identification Report (included)'), true)
  assert.equal(isPassThroughLine('Security Access and Authorization Fee'), true)
  assert.equal(isPassThroughLine('Gateway Access Fee (Collision)'), true)
  assert.equal(isPassThroughLine('Technology Fee'), true)
  assert.equal(isPassThroughLine('Front Radar Calibration'), false)
  assert.equal(isPassThroughLine('Pre-Scan'), false)
  assert.equal(isPassThroughLine('Post-Scan'), false)
  assert.equal(isPassThroughLine('Diagnostic 1'), false)
  assert.equal(isPassThroughLine('Module Programming and Reflash - Ford'), false)
  assert.equal(isPassThroughLine('Travel Fee'), false)
})

test('a $15 Calibration ID comes out of a $465 invoice', () => {
  const totals = passThroughTotals([
    { name: 'Calibration Identification Report', item_total: 15 },
    { name: 'Front Radar Calibration', item_total: 450 },
  ])
  assert.deepEqual(totals, { excluded: 15, base: 465 })
  assert.deepEqual(eligibleCash(465, totals), { eligible: 450, excluded: 15 })
})

test('a partial payment drops the same fraction of the fees', () => {
  const totals = passThroughTotals([
    { name: 'Security Access and Authorization Fee', rate: 50, quantity: 1 },
    { name: 'Gateway Access Fee', item_total: 25 },
    { name: 'Module Programming and Reflash - Ford', item_total: 200 },
  ])
  assert.equal(totals.excluded, 75)
  assert.equal(totals.base, 275)
  const half = eligibleCash(137.5, totals)
  assert.equal(half.excluded, 37.5)
  assert.equal(half.eligible, 100)
})

test('tax on the invoice does not turn a $15 fee into more than $15', () => {
  const totals = passThroughTotals([
    { name: 'Calibration Identification Report', item_total: 15 },
    { name: 'Front Radar Calibration', item_total: 450 },
  ])
  assert.deepEqual(eligibleCash(505, { ...totals, total: 505 }), { eligible: 490, excluded: 15 })
})

test('a $0 included Calibration ID does not change the cash', () => {
  const totals = passThroughTotals([
    { name: 'Calibration Identification Report (included)', item_total: 0 },
    { name: 'Post-Scan', item_total: 150 },
  ])
  assert.deepEqual(eligibleCash(150, totals), { eligible: 150, excluded: 0 })
})
