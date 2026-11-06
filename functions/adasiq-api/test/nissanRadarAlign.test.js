import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardScrub, noteNissanRadarAlignment } from '../services/scrubGuard.js'
import { alignmentInvoiceOn, invoiceLineForReportRow } from '../services/alignmentInvoice.js'

const WHEEL = 'The ACC / front radar is required because of the front bumper removal (line 2). This 4-way alignment is required before that ACC radar aim, because Nissan\'s distance-sensor procedure says a 4-wheel alignment must be performed before the radar alignment.'

const nissan = (extra = []) => ({
  make: 'Nissan', year: 2024, vehicle: '2024 Nissan Ariya',
  calibrations: [
    { calibration_name: 'Front Radar', enabled: true, trigger: 'Front bumper cover R&I (line 2)', line_references: '2', justification: 'Front radar aiming is required after bumper removal.' },
    { calibration_name: 'Steering Angle Sensor', enabled: false, trigger: '', line_references: '' },
    { calibration_name: 'Front Windshield Camera', enabled: false, trigger: '', line_references: '' },
    { calibration_name: 'Rear Blind Spot Radar', enabled: true, cal_type: 'Static', trigger: 'Rear bumper cover R&I (line 37)', line_references: '37' },
    { calibration_name: 'Seat Weight Sensor', enabled: true, trigger: 'In collision (Nissan)', line_references: '11, 22' },
    ...extra,
  ],
})

test('Nissan front radar gets a wheel-alignment row and one static SAS, not a banner on the radar', async () => {
  const data = nissan()
  const before = data.calibrations.length
  await guardScrub(data, '', { hitsPromise: Promise.resolve({ front_bumper: ['2'] }), text: '' })
  const radar = data.calibrations.find(c => c.calibration_name === 'Front Radar')
  const wheel = data.calibrations.find(c => c.calibration_name === '4-Way Alignment')
  const sas = data.calibrations.find(c => /steering/i.test(c.calibration_name))
  assert.equal(radar.enabled, true)
  assert.doesNotMatch(radar.justification, /4-wheel vehicle alignment must be performed/)
  assert.equal(wheel.enabled, true)
  assert.equal(wheel.line_references, '2')
  assert.match(wheel.trigger, /required before that ACC radar aim/)
  assert.equal(wheel.operation_title, '4-Way Alignment')
  assert.equal(data.calibrations.filter(c => /alignment/i.test(c.calibration_name || '') && !/steering/i.test(c.calibration_name || '')).length, 1)
  assert.doesNotMatch(wheel.trigger, /Front bumper installed/)
  assert.match(wheel.justification, /required before that ACC radar aim/)
  assert.doesNotMatch(wheel.justification, /alignment is required because of the front bumper/)
  assert.equal(wheel.justification, WHEEL)
  assert.equal(wheel.classification, 'REQUIRED: OEM PREREQUISITE')
  assert.equal(sas.enabled, false)
  assert.equal(sas.classification, 'CONDITIONAL: VERIFICATION NEEDED')
  assert.equal(data.calibrations.find(c => /windshield/i.test(c.calibration_name)).enabled, false)
  assert.equal(data.calibrations.find(c => /blind/i.test(c.calibration_name)).cal_type, 'Static')
  assert.equal(data.calibrations.length, before + 1)
})

test('an alignment line is named on the wheel-alignment row and a second pass does not repeat the sentence', () => {
  const data = nissan()
  assert.equal(noteNissanRadarAlignment(data, ['14']), true)
  const radar = data.calibrations.find(c => c.calibration_name === 'Front Radar')
  const wheel = data.calibrations.find(c => c.calibration_name === '4-Way Alignment')
  assert.equal(wheel.line_references, '14')
  assert.match(wheel.trigger, /line 14/)
  assert.equal(wheel.justification, WHEEL)
  assert.doesNotMatch(radar.justification, /line 14/)
  assert.doesNotMatch(radar.justification, /4-wheel vehicle alignment must be performed/)
  const sas = data.calibrations.find(c => /steering/i.test(c.calibration_name))
  assert.equal(sas.enabled, true)
  assert.equal(sas.classification, 'REQUIRED: SECONDARY OPERATION')
  assert.equal(noteNissanRadarAlignment(data, ['14']), false)
  assert.equal(data.calibrations.filter(c => c.calibration_name === '4-Way Alignment').length, 1)
  assert.equal(data.calibrations.filter(c => c.calibration_name === 'Wheel Alignment').length, 0)
  assert.equal(data.calibrations.filter(c => /steering/i.test(c.calibration_name)).length, 1)
  assert.equal(wheel.justification.split('4-wheel alignment must be performed').length, 2)
})

test('Honda front radar is left alone', () => {
  const data = { make: 'Honda', calibrations: [{ calibration_name: 'Front Radar', enabled: true, justification: 'Aim the radar.' }] }
  assert.equal(noteNissanRadarAlignment(data, []), false)
  assert.equal(data.calibrations[0].justification, 'Aim the radar.')
  assert.equal(data.calibrations.some(c => c.calibration_name === 'Wheel Alignment' || c.calibration_name === '4-Way Alignment'), false)
})

test('a stored Wheel Alignment row is renamed, not copied', () => {
  const data = nissan([{ calibration_name: 'Wheel Alignment', enabled: true, trigger: 'old', justification: 'old' }])
  noteNissanRadarAlignment(data)
  const align = data.calibrations.filter(c => /alignment/i.test(c.calibration_name || '') && !/steering/i.test(c.calibration_name || ''))
  assert.equal(align.length, 1)
  assert.equal(align[0].calibration_name, '4-Way Alignment')
  assert.equal(align[0].operation_title, '4-Way Alignment')
  assert.equal(align[0].classification, 'REQUIRED: OEM PREREQUISITE')
})

test('alignment invoice switch defaults off and does not create an invoice line', () => {
  assert.equal(alignmentInvoiceOn(undefined), false)
  assert.equal(alignmentInvoiceOn({}), false)
  assert.equal(alignmentInvoiceOn({ invoice_4way_alignment: false }), false)
  assert.equal(alignmentInvoiceOn({ full_service_on: true }), false)
  assert.equal(alignmentInvoiceOn({ billing_rules: {} }), false)
  const data = nissan()
  noteNissanRadarAlignment(data)
  const row = data.calibrations.find(c => c.calibration_name === '4-Way Alignment')
  assert.equal(row.enabled, true)
  assert.equal(invoiceLineForReportRow(row, { alignmentOn: alignmentInvoiceOn({}), mappedItem: { name: 'Wheel Alignment', item_id: '9', rate: 125 } }), null)
  assert.equal(invoiceLineForReportRow(row, { alignmentOn: true, mappedItem: null }), null)
  assert.equal(invoiceLineForReportRow(row, { alignmentOn: true, mappedItem: { name: 'Wheel Alignment', item_id: '9', rate: 0 } }), null)
  const line = invoiceLineForReportRow(row, { alignmentOn: true, mappedItem: { name: 'Wheel Alignment', item_id: '9', rate: 125 } })
  assert.equal(line.item_id, '9')
  assert.equal(line.rate, 125)
  assert.equal(line.quantity, 1)
  assert.equal(line.hours, null)
  const bat = { calibration_name: 'Battery-Disconnect Resets', operation_title: 'Battery Reset', enabled: true }
  assert.equal(invoiceLineForReportRow(bat, { alignmentOn: false, mappedItem: null }), null)
})
