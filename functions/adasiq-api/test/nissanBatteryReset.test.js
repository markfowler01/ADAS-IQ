import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardScrub, triggerLinesFromText, batteryOperationsNote, noteNissanBatteryProcedure, ensureNissanBatteryRow, openNissanBattery, nissanBatteryProbe, batteryDisconnectLines } from '../services/scrubGuard.js'
import { operationsList } from '../../../client/src/lib/operationsRows.js'

const car = (make, extra = []) => ({
  make, year: 2024, vehicle: `2024 ${make} Ariya`,
  calibrations: [
    { calibration_name: 'Front Radar', enabled: true, trigger: 'Front bumper cover R&I (line 2)', line_references: '2', justification: 'Front radar aiming is required after bumper removal.' },
    { calibration_name: 'Steering Angle Sensor', enabled: false, trigger: '', line_references: '', justification: '' },
    { calibration_name: 'Seat Weight Sensor', enabled: true, trigger: 'In collision', line_references: '11', justification: 'Seat weight check.' },
    ...extra,
  ],
})

const resets = data => data.calibrations.filter(c => /battery-disconnect resets/i.test(c.calibration_name || ''))
const sas = data => data.calibrations.find(c => /steering angle/i.test(c.calibration_name || ''))

const NISSAN = /Positive cable on first\. Clamp both cables tight\. Check the terminals for corrosion\. Nissan procedure: Operations Required after Disconnecting Battery\. Power windows: Position Statement Power Window Servicing Post-Repair\./

test('Nissan with a battery D&R line notes the reconnect on the one reset row', async () => {
  const hits = triggerLinesFromText('14 D&R Battery')
  assert.deepEqual(hits.battery, ['14'])
  const data = car('Nissan')
  data.calibrations.find(c => c.calibration_name === 'Front Radar').enabled = false
  const before = data.calibrations.length
  await guardScrub(data, '', { hitsPromise: Promise.resolve(hits) })
  assert.equal(resets(data).length, 1)
  assert.equal(data.calibrations.length, before + 1)
  assert.match(resets(data)[0].justification, /12V battery disconnect on line 14\./)
  assert.match(resets(data)[0].justification, NISSAN)
  assert.equal(resets(data)[0].classification, 'REVIEW NEEDED')
  assert.equal(resets(data)[0].operation_title, 'Battery Reset')
  assert.match(resets(data)[0].justification, /Operations Required after Disconnecting Battery/)
  assert.doesNotMatch(resets(data)[0].justification, /Power-loss initializations required/)
  assert.equal(sas(data).enabled, false)
  assert.equal(batteryOperationsNote(data.calibrations).includes('on line 14'), true)
})

test('Nissan with disconnect battery or battery R&I gets the same note', async () => {
  for (const line of ['9 Disconnect battery', '22 Battery R&I']) {
    const hits = triggerLinesFromText(line)
    assert.equal(hits.battery.length, 1)
    const data = car('Nissan')
    data.calibrations.find(c => c.calibration_name === 'Front Radar').enabled = false
    await guardScrub(data, '', { hitsPromise: Promise.resolve(hits) })
    assert.equal(resets(data).length, 1)
    assert.match(resets(data)[0].justification, NISSAN)
    assert.match(resets(data)[0].justification, new RegExp(`on line ${hits.battery[0]}\\.`))
    assert.equal(sas(data).enabled, false)
  }
})

test('Nissan with no battery line gets no note, even when front radar is required', async () => {
  const hits = triggerLinesFromText('2 R&I Front bumper cover')
  assert.deepEqual(hits.battery, [])
  const data = car('Nissan')
  const before = data.calibrations.length
  await guardScrub(data, '', { hitsPromise: Promise.resolve(hits) })
  assert.equal(resets(data).length, 0)
  assert.equal(batteryOperationsNote(data.calibrations), '')
  assert.equal(data.calibrations.filter(c => c.calibration_name === '4-Way Alignment').length, 1)
  assert.equal(data.calibrations.filter(c => c.calibration_name === 'Wheel Alignment').length, 0)
  assert.equal(sas(data).enabled, false)
  assert.equal(sas(data).classification, 'CONDITIONAL: VERIFICATION NEEDED')
  assert.doesNotMatch(data.calibrations.find(c => c.calibration_name === 'Front Radar').justification, /4-wheel vehicle alignment must be performed/)
  assert.equal(data.calibrations.find(c => c.calibration_name === 'Front Radar').enabled, true)
  assert.equal(data.calibrations.length, before + 1)
})

test('Honda battery line still adds the generic reset and turns steering angle on', async () => {
  const hits = triggerLinesFromText('8 D&R Battery')
  const data = car('Honda')
  await guardScrub(data, '', { hitsPromise: Promise.resolve(hits) })
  assert.equal(resets(data).length, 1)
  assert.match(resets(data)[0].justification, /Power-loss initializations required/)
  assert.doesNotMatch(resets(data)[0].justification, /Positive cable on first|Operations Required after Disconnecting Battery/)
  assert.equal(sas(data).enabled, true)
  assert.equal(batteryOperationsNote(data.calibrations), '')
})

test('Toyota battery line still adds the generic reset and leaves steering angle off', async () => {
  const hits = triggerLinesFromText('5 R&I Battery')
  const data = car('Toyota')
  await guardScrub(data, '', { hitsPromise: Promise.resolve(hits) })
  assert.equal(resets(data).length, 1)
  assert.match(resets(data)[0].justification, /Power-loss initializations required/)
  assert.doesNotMatch(resets(data)[0].justification, /Positive cable on first|Operations Required after Disconnecting Battery/)
  assert.equal(sas(data).enabled, false)
  assert.equal(batteryOperationsNote(data.calibrations), '')
})

test('a second pass does not repeat the sentences', async () => {
  const hits = triggerLinesFromText('14 D&R Battery')
  const data = car('Nissan')
  await guardScrub(data, '', { hitsPromise: Promise.resolve(hits) })
  const once = resets(data)[0].justification
  await guardScrub(data, '', { hitsPromise: Promise.resolve(hits) })
  assert.equal(resets(data)[0].justification, once)
  assert.equal(once.split('Positive cable on first.').length, 2)
  assert.equal(resets(data).length, 1)
})

test('opening a saved Nissan scrub rewrites the stored battery row without a new upload', () => {
  const data = car('Nissan', [{
    calibration_name: 'Battery-Disconnect Resets', enabled: true, line_references: '46',
    trigger: 'Battery disconnect (line 46)', justification: 'Power-loss initializations required after the battery disconnect.',
  }])
  const sasBefore = sas(data).enabled
  const before = data.calibrations.length
  assert.equal(noteNissanBatteryProcedure(data), true)
  const row = resets(data)[0]
  assert.equal(data.calibrations.length, before)
  assert.equal(row.operation_title, 'Battery Reset')
  assert.equal(row._reportRequired, true)
  assert.match(row.trigger, /line 46/)
  assert.match(row.trigger, NISSAN)
  assert.match(row.justification, /Operations Required after Disconnecting Battery/)
  assert.match(row.justification, /Position Statement Power Window Servicing Post-Repair/)
  assert.equal(sas(data).enabled, sasBefore)
  assert.equal(data.calibrations.filter(c => c.calibration_name === '4-Way Alignment').length, 0)
})

test('a saved Nissan scrub missing the battery row gains Battery Reset from the disconnect lines', () => {
  const data = car('Nissan')
  const sasBefore = sas(data).enabled
  assert.equal(ensureNissanBatteryRow(data, ['46']), true)
  assert.equal(resets(data).length, 1)
  assert.equal(resets(data)[0].operation_title, 'Battery Reset')
  assert.match(resets(data)[0].justification, /line 46/)
  assert.match(resets(data)[0].justification, NISSAN)
  assert.equal(sas(data).enabled, sasBefore)
  assert.equal(data.calibrations.filter(c => /park/i.test(c.calibration_name)).length, 0)
})

const ro8097 = () => ({
  make: 'Nissan', year: 2024, vehicle: '2024 Nissan Ariya',
  calibrations: [
    { calibration_name: 'Front Radar', enabled: true, cal_type: 'Static', line_references: '2', classification: 'REQUIRED: DIRECT TRIGGER', trigger: 'Front bumper cover R&I (line 2) — Nissan OEM requires radar aiming after any front bumper removal', justification: 'Front radar aiming is required after bumper removal.' },
    { calibration_name: 'Rear Blind Spot Radar', enabled: true, cal_type: 'Static', line_references: '37', classification: 'REQUIRED: DIRECT TRIGGER', trigger: 'Rear bumper cover R&I (line 37)', justification: 'Rear blind spot.' },
    { calibration_name: 'Seat Weight Sensor', enabled: true, line_references: '11, 22', classification: 'REQUIRED: DIRECT TRIGGER', trigger: 'In collision (Nissan)', justification: 'Seat weight check.' },
    { calibration_name: '4-Way Alignment', operation_title: '4-Way Alignment', enabled: true, line_references: '2', classification: 'REQUIRED: OEM PREREQUISITE', trigger: 'The ACC / front radar is required because of the front bumper removal (line 2). This 4-way alignment is required before that ACC radar aim, because Nissan\'s distance-sensor procedure says a 4-wheel alignment must be performed before the radar alignment.', justification: 'Alignment prerequisite.' },
  ],
})

test('RO 8097 with no enabled battery row gains Battery Reset from line 46 and the operations table shows it', () => {
  const untouched = ro8097()
  assert.equal(noteNissanBatteryProcedure(untouched), false)
  assert.equal(untouched.calibrations.some(c => /battery/i.test(c.calibration_name || '')), false)

  const data = ro8097()
  assert.equal(nissanBatteryProbe(data, { fileId: 'file-8097', batteryLines: undefined }), 'read-file')
  assert.equal(nissanBatteryProbe({ ...data, _batteryChecked: true }, { fileId: 'file-8097' }), 'read-file')
  assert.equal(openNissanBattery(data, { text: '46 D&R Battery' }), true)
  const row = data.calibrations.find(c => /battery/i.test(`${c.calibration_name} ${c.operation_title}`))
  assert.ok(row)
  assert.equal(row.enabled, true)
  assert.equal(row.operation_title, 'Battery Reset')
  assert.equal(row._learned, undefined)
  assert.equal(row._edited, undefined)
  assert.match(row.trigger, /line 46/)
  assert.match(row.trigger, /Positive cable on first\. Clamp both cables tight\. Check the terminals for corrosion\./)
  assert.match(row.trigger, /Operations Required after Disconnecting Battery/)
  assert.match(row.trigger, /Position Statement Power Window Servicing Post-Repair/)
  assert.equal(row.price, undefined)
  assert.equal(row.hours, undefined)
  assert.equal(row.labor_hours, undefined)
  assert.equal(data.calibrations.filter(c => c.calibration_name === '4-Way Alignment' && c.enabled).length, 1)
  assert.equal(data.calibrations.find(c => /blind/i.test(c.calibration_name)).cal_type, 'Static')
  assert.equal(data.calibrations.some(c => /park/i.test(c.calibration_name)), false)
  assert.equal(data.calibrations.some(c => /steering angle/i.test(c.calibration_name) && c.enabled), false)

  const shown = operationsList(data.calibrations, { make: 'Nissan', vehicle: '2024 Nissan Ariya', fsOff: true })
  const bat = shown.find(l => l.label === 'Battery Reset')
  assert.ok(bat, 'operations table dropped Battery Reset')
  assert.equal(bat.learned, '')
  assert.equal(!!(bat.required || bat.onReport), true)
  assert.equal(bat.lines, '46')
  assert.match(bat.trigger, /Operations Required after Disconnecting Battery/)
})

test('a split CCC battery line and a disabled row still become Battery Reset without a learned flag', () => {
  const split = ro8097()
  assert.deepEqual(batteryDisconnectLines('46\nD&R\nBattery\n'), ['46'])
  assert.equal(openNissanBattery(split, { text: '46\nD&R\nBattery\n' }), true)
  assert.equal(split.calibrations.find(c => /battery/i.test(c.calibration_name))._learned, undefined)

  const disabled = ro8097()
  disabled.calibrations.push({ calibration_name: 'Battery-Disconnect Resets', enabled: false, line_references: '46', _learned: '' })
  assert.equal(nissanBatteryProbe(disabled, { fileId: 'file-8097', batteryLines: ['46'] }), 'use-stored')
  assert.equal(openNissanBattery(disabled, { batteryLines: ['46'] }), true)
  const row = disabled.calibrations.find(c => /battery/i.test(c.calibration_name))
  assert.equal(row.enabled, true)
  assert.equal(row.operation_title, 'Battery Reset')
  assert.equal(row._learned, '')
  const shown = operationsList(disabled.calibrations, { make: 'Nissan', vehicle: '2024 Nissan Ariya', fsOff: true })
  assert.equal(shown.filter(l => l.label === 'Battery Reset').length, 1)
})
