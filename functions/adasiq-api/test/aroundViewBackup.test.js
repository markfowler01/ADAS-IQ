import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardScrub } from '../services/scrubGuard.js'

const row = (name, enabled) => ({ calibration_name: name, enabled, trigger: 'Liftgate replaced', line_references: '8', justification: 'Required.' })

test('Around View covers the backup camera', async () => {
  const data = {
    make: 'Mercedes-Benz', year: 2021,
    calibrations: [row('Around View Camera', true), row('Back Up Camera', true)],
  }
  await guardScrub(data, '', { hitsPromise: Promise.resolve({ liftgate: ['8'] }), text: 'Options: Surround View Camera\n8 Repl Liftgate' })
  const avc = data.calibrations.find(c => /around view/i.test(c.calibration_name))
  const buc = data.calibrations.find(c => /back up/i.test(c.calibration_name))
  assert.equal(avc.enabled, true)
  assert.equal(buc.enabled, false)
  assert.match(buc.justification, /covered by the around view/i)
})

test('a backup camera with no Around View stays required', async () => {
  const data = {
    make: 'Honda', year: 2019,
    calibrations: [row('Back Up Camera', true)],
  }
  await guardScrub(data, '', { hitsPromise: Promise.resolve({ liftgate: ['8'] }), text: '8 Repl Liftgate' })
  const buc = data.calibrations.find(c => /back up/i.test(c.calibration_name))
  assert.equal(buc.enabled, true)
})

test('a demoted Around View does not take the backup camera with it', async () => {
  const data = {
    make: 'Ford', year: 2020,
    calibrations: [row('Around View Camera', true), row('Back Up Camera', true)],
  }
  await guardScrub(data, '', { hitsPromise: Promise.resolve({ liftgate: ['8'] }), text: '8 Repl Liftgate shell' })
  const avc = data.calibrations.find(c => /around view/i.test(c.calibration_name))
  const buc = data.calibrations.find(c => /back up/i.test(c.calibration_name))
  assert.equal(avc.enabled, false)
  assert.equal(buc.enabled, true)
})
