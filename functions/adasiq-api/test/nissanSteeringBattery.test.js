import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardScrub } from '../services/scrubGuard.js'
import { tagRows } from '../services/fullService.js'
import { KINETIC_SENSOR_VOCAB } from '../services/itemMap.js'

const WHEEL = 'The ACC / front radar is required because of the front bumper removal (line 2). This 4-way alignment is required before that ACC radar aim, because Nissan\'s distance-sensor procedure says a 4-wheel alignment must be performed before the radar alignment.'
const SAS_CONDITIONAL = 'Conditional. The steering angle sensor neutral-position adjustment is required only when a four-wheel alignment adjustment was performed.'

const car = (make, { radar = true, bsmType = 'Static', sas = false } = {}) => ({
  make, year: 2024, vehicle: `2024 ${make} Ariya`,
  calibrations: [
    { calibration_name: 'Front Radar', enabled: radar, cal_type: 'Static', trigger: 'Front bumper cover R&I (line 2)', line_references: '2', justification: 'Front radar aiming is required after bumper removal. Prerequisite: wheel alignment required before this radar can be aimed. A 4-wheel vehicle alignment must be performed before proceeding with radar alignment procedure. Always perform the radar alignment after removing and installing or replacing the distance sensor.' },
    { calibration_name: 'Rear Blind Spot Radar', enabled: true, cal_type: bsmType, trigger: 'Rear bumper cover R&I (line 37)', line_references: '37', justification: 'Rear blind spot.' },
    { calibration_name: 'Seat Weight Sensor', enabled: true, trigger: 'In collision (Nissan)', line_references: '11, 22', justification: 'Seat weight check.' },
    { calibration_name: 'Park Distance Sensor', enabled: true, trigger: 'Front bumper cover R&I (line 2)', line_references: '2', justification: 'Park sensors.' },
    ...(sas ? [{ calibration_name: 'Steering Angle Sensor', enabled: false, cal_type: '', trigger: '', line_references: '', justification: '' }] : []),
  ],
})

const wheels = data => data.calibrations.filter(c => /^(wheel alignment|4-way alignment)$/i.test(c.calibration_name || ''))
const sasRows = data => data.calibrations.filter(c => /steering angle/i.test(c.calibration_name || ''))
const resets = data => data.calibrations.filter(c => /battery-disconnect resets/i.test(c.calibration_name || ''))
const run = (data, hits) => guardScrub(data, '', { hitsPromise: Promise.resolve(hits) })

test('Nissan and Infiniti with front radar and a battery D&R line add the three rows once', async () => {
  assert.equal(KINETIC_SENSOR_VOCAB.includes('Wheel Alignment'), false)
  assert.equal(KINETIC_SENSOR_VOCAB.includes('Steering Angle Sensor'), true)
  for (const make of ['Nissan', 'Infiniti']) {
    for (const bsmType of ['Static', 'Dynamic']) {
      const data = car(make, { bsmType })
      const before = data.calibrations.length
      await run(data, { front_bumper: ['2'], battery: ['46'], rear_bumper: ['37'] })
      assert.equal(data.calibrations.length, before + 3, make)
      assert.equal(wheels(data).length, 1)
      assert.equal(wheels(data)[0].enabled, true)
      assert.equal(wheels(data)[0].line_references, '2')
      assert.match(wheels(data)[0].trigger, /required before that ACC radar aim/)
      assert.equal(wheels(data)[0].calibration_name, '4-Way Alignment')
      assert.equal(wheels(data)[0].operation_title, '4-Way Alignment')
      assert.doesNotMatch(wheels(data)[0].justification, /alignment is required because of the front bumper/)
      assert.match(wheels(data)[0].trigger, /distance-sensor procedure/)
      assert.doesNotMatch(wheels(data)[0].trigger, /Front bumper installed/)
      assert.match(wheels(data)[0].justification, /required before that ACC radar aim/)
      assert.equal(wheels(data)[0].justification, WHEEL)
      assert.equal(wheels(data)[0].classification, 'REQUIRED: OEM PREREQUISITE')
      assert.equal(sasRows(data).length, 1)
      assert.equal(sasRows(data)[0].enabled, false)
      assert.equal(sasRows(data)[0].classification, 'CONDITIONAL: VERIFICATION NEEDED')
      assert.match(sasRows(data)[0].justification, new RegExp(SAS_CONDITIONAL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.equal(resets(data).length, 1)
      assert.equal(resets(data)[0].enabled, true)
      assert.equal(resets(data)[0]._reportRequired, true)
      assert.equal(resets(data)[0].classification, 'REVIEW NEEDED')
      assert.equal(resets(data)[0].operation_title, 'Battery Reset')
      assert.match(resets(data)[0].justification, /Operations Required after Disconnecting Battery/)
      assert.match(resets(data)[0].trigger, /line 46/)
      assert.match(resets(data)[0].trigger, /Operations Required after Disconnecting Battery/)
      assert.match(resets(data)[0].trigger, /Positive cable on first/)
      assert.match(resets(data)[0].trigger, /Clamp both cables tight/)
      assert.match(resets(data)[0].trigger, /corrosion/)
      assert.match(resets(data)[0].trigger, /Position Statement Power Window Servicing Post-Repair/)
      assert.match(resets(data)[0].justification, /line 46/)
      assert.match(resets(data)[0].justification, /Positive cable on first/)
      assert.match(resets(data)[0].justification, /do not make every available reset mandatory/)
      assert.equal(data.calibrations.find(c => c.calibration_name === 'Front Radar').classification, 'REQUIRED: DIRECT TRIGGER')
      assert.equal(data.calibrations.find(c => /blind/i.test(c.calibration_name)).classification, 'REQUIRED: DIRECT TRIGGER')
      assert.equal(data.calibrations.find(c => /seat weight/i.test(c.calibration_name)).classification, 'REQUIRED: DIRECT TRIGGER')
      assert.equal(data.calibrations.find(c => /park/i.test(c.calibration_name)).classification, 'NOT REQUIRED: VERIFIED')
      const radar = data.calibrations.find(c => c.calibration_name === 'Front Radar')
      assert.doesNotMatch(radar.justification, /4-wheel vehicle alignment must be performed/)
      assert.doesNotMatch(radar.justification, /Prerequisite: wheel alignment/)
      assert.equal(data.calibrations.find(c => /blind/i.test(c.calibration_name)).cal_type, bsmType)
      assert.equal(data.calibrations.find(c => /seat weight/i.test(c.calibration_name)).enabled, true)
      assert.equal(data.calibrations.find(c => /park/i.test(c.calibration_name)).enabled, false)
      const kept = tagRows(data.calibrations.map(c => ({ ...c })), { resets: 'off' }, { collision: true })
      const bat = kept.find(c => /battery-disconnect resets/i.test(c.calibration_name))
      assert.ok(bat)
      assert.equal(bat._fs, undefined)
      assert.equal(bat.enabled, true)
      const held = c => /^(CONDITIONAL:|REVIEW NEEDED)/.test(c?.classification || '') || c?._reportRequired === true
      const summary = [...kept.filter(c => c.enabled && !c._fs && !held(c)), ...kept.filter(c => held(c) && (!c._fs || c._reportRequired || c._onReport))]
      assert.equal(summary.filter(c => c.calibration_name === '4-Way Alignment').length, 1)
      assert.equal(summary.some(c => c.calibration_name === 'Wheel Alignment'), false)
      assert.ok(summary.some(c => c.operation_title === 'Battery Reset'))
    }
  }
})

test('an alignment line is named on the one wheel-alignment row and SAS stays one row', async () => {
  const data = car('Nissan', { sas: true })
  await run(data, { front_bumper: ['2'], alignment: ['8'] })
  assert.equal(wheels(data).length, 1)
  assert.equal(wheels(data)[0].line_references, '8')
  assert.match(wheels(data)[0].trigger, /Wheel alignment \(line 8\)/)
  assert.equal(wheels(data)[0].justification, WHEEL)
  assert.equal(sasRows(data).length, 1)
  assert.equal(sasRows(data)[0].enabled, true)
  assert.equal(sasRows(data)[0].classification, 'REQUIRED: SECONDARY OPERATION')
  assert.equal(data.calibrations.find(c => c.calibration_name === 'Front Radar').justification.includes(WHEEL), false)
})

test('Nissan with no front radar and no battery line adds neither wheel alignment nor SAS', async () => {
  const data = car('Nissan', { radar: false, sas: true })
  data.calibrations.find(c => c.calibration_name === 'Front Radar').justification = 'Not required.'
  const before = data.calibrations.length
  await run(data, {})
  assert.equal(wheels(data).length, 0)
  assert.equal(sasRows(data)[0].enabled, false)
  assert.equal(resets(data).length, 0)
  assert.equal(data.calibrations.length, before)
})

test('Nissan battery disconnect without front radar keeps SAS off and the battery row on', async () => {
  const data = car('Nissan', { radar: false, sas: true })
  await run(data, { battery: ['46'] })
  assert.equal(sasRows(data)[0].enabled, false)
  assert.equal(wheels(data).length, 0)
  assert.equal(resets(data).length, 1)
  assert.equal(resets(data)[0].enabled, true)
  assert.equal(resets(data)[0]._reportRequired, true)
  assert.match(resets(data)[0].justification, /line 46/)
  const kept = tagRows(data.calibrations.map(c => ({ ...c })), { resets: 'off' }, { collision: true })
  assert.equal(kept.some(c => /battery-disconnect resets/i.test(c.calibration_name) && c.enabled && !c._fs), true)
})

test('Honda with a front bumper does not get a Nissan wheel-alignment row', async () => {
  const data = {
    make: 'Honda', year: 2024, vehicle: '2024 Honda Accord',
    calibrations: [
      { calibration_name: 'Front Radar', enabled: true, cal_type: 'Static', line_references: '4', justification: 'Aim the radar.' },
      { calibration_name: 'Steering Angle Sensor', enabled: false, justification: '' },
    ],
  }
  await run(data, { front_bumper: ['4'] })
  assert.equal(wheels(data).length, 0)
  assert.doesNotMatch(data.calibrations.find(c => c.calibration_name === 'Front Radar').justification, /4-wheel vehicle alignment must be performed/)
  assert.equal(data.calibrations.find(c => /steering/i.test(c.calibration_name)).enabled, false)
})

test('an alignment inspection does not make the steering angle sensor required', async () => {
  const data = car('Nissan', { sas: true })
  await guardScrub(data, '', { hitsPromise: Promise.resolve({ front_bumper: ['2'], alignment: ['8'] }), text: '8 Inspect alignment' })
  assert.equal(wheels(data).length, 1)
  assert.equal(sasRows(data).length, 1)
  assert.equal(sasRows(data)[0].enabled, false)
  assert.equal(sasRows(data)[0].classification, 'CONDITIONAL: VERIFICATION NEEDED')
})

test('running the guard twice does not duplicate the rows', async () => {
  const data = car('Nissan')
  const hits = { front_bumper: ['2'], battery: ['46'] }
  await run(data, hits)
  await run(data, hits)
  assert.equal(wheels(data).length, 1)
  assert.equal(sasRows(data).length, 1)
  assert.equal(resets(data).length, 1)
  assert.equal(wheels(data)[0].justification.split('4-wheel alignment must be performed').length, 2)
  assert.equal(sasRows(data)[0].justification.split('alignment adjustment was performed').length, 2)
  assert.equal(resets(data)[0].justification.split('Positive cable on first').length, 2)
})
