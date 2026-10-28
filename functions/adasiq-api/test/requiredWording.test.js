import test from 'node:test'
import assert from 'node:assert/strict'
import { requiredWording, recommendLeftovers } from '../services/requiredWording.js'

test('the Promise and the old campaign lines say required, not recommend', () => {
  assert.equal(
    requiredWording("If a calibration we recommended gets denied, you don't pay us."),
    "If a calibration requirement we called out gets denied, you don't pay us.")
  assert.equal(
    requiredWording('The Absolute Promise: every calibration Absolute ADAS recommends, the shop gets paid for.'),
    'The Absolute Promise: every calibration requirement Absolute ADAS calls out, the shop gets paid for.')
  assert.equal(
    requiredWording("Calibrations the carrier denied. We only recommend what the car maker requires. If it's recommended, done and still denied, you don't pay us."),
    "Calibrations the carrier denied. We only call out what the car maker requires. If it's required, done and still denied, you don't pay us.")
})

test('calibration recommendations become calibration requirements', () => {
  assert.equal(requiredWording('Our calibration recommendations come straight from the OEM.'), 'Our calibration requirements come straight from the OEM.')
  assert.equal(requiredWording('Recommended calibrations get skipped.'), 'Required calibrations get skipped.')
  assert.equal(requiredWording('Calibrations are recommended after an alignment.'), 'Calibrations are required after an alignment.')
  assert.equal(requiredWording('We recommend a calibration after any windshield replacement.'), 'We require a calibration after any windshield replacement.')
})

test('posts that are not about calibrations are untouched', () => {
  const s = 'We recommend you text early. Same day if the car is ready by noon.'
  assert.equal(requiredWording(s), s)
  assert.equal(requiredWording(''), '')
  assert.equal(requiredWording(null), null)
})

test('a car maker\'s own word is left alone and reported', () => {
  const s = 'Honda recommends a camera calibration after glass.'
  assert.equal(requiredWording(s), s)
  assert.deepEqual(recommendLeftovers(s), [s])
})
