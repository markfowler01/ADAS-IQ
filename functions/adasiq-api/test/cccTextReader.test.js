import { test } from 'node:test'
import assert from 'node:assert/strict'
import { triggerLinesFromText, parseEstimateRow } from '../services/scrubGuard.js'
import { findVinInText } from '../services/estimator/vin.js'

// Rows exactly as pdf-parse prints CCC estimates (2026-10 scrubs).
const EST = [
  'VIN:1GNEVFKW3MJ250609Interior Col',
  'Dual MirrorsBackup Camera Head/Curtain Air Bags',
  '1FRONT BUMPER & GRILLE',
  '2R&I  R&I bumper cover1.8',
  '3O/H front bumper00.003.90.0',
  '4Repl  Lower grille68445671AA1118.00Incl.0.0',
  '11R&IRT R&I mirror0.3',
  '15REAR DOOR',
  '20*S01ReplUSED RT door assy +25%8559066411,158.13',
  '37QUARTER PANEL',
  '38*S01RprRT Quarter panel4.02.6',
  '52REAR BUMPER',
  '53S01R&IR&I bumper cover2.2',
  '54S03O/H bumper assy4.7',
  '56*S03ReplBumper cover w/o auto park851695091521.07Incl.0.0',
  '57   *Rpr  Bumper cover w/prk sensor w/o',
  '58S01   Repl   Aim camera1m1.0  M',
  '63#S04SublSuspension Alignment1124.74T',
  '70Repl Air bag module w/o hybrid68526663AC1436.00m0.2M0.0',
  '71Repl  Distance sensor',
].join('\n')

test('glued CCC rows parse into number / supplement / operation / description', () => {
  assert.deepEqual(parseEstimateRow('53S01R&IR&I bumper cover2.2'), { n: '53', flags: '', sup: 'S01', op: 'r&i', desc: 'R&I bumper cover2.2' })
  assert.equal(parseEstimateRow('2019 FORD F-150 Lariat'), null)
})

test('the section heading supplies front / rear', () => {
  const h = triggerLinesFromText(EST)
  assert.deepEqual(h.front_bumper, ['2', '3'])
  assert.deepEqual(h.rear_bumper, ['53', '54', '56'])
  assert.deepEqual(h.rear_bumper_rpr, ['57'])
})

test('hours stuck to words, options block ignored', () => {
  const h = triggerLinesFromText(EST)
  assert.deepEqual(h.mirror, ['11'])
  assert.deepEqual(h.alignment, ['63'])
  assert.deepEqual(h.camera, ['58'])                 // not the "Backup Camera" options row
  assert.ok(h.structural.includes('20') && h.structural.includes('38'))
  assert.deepEqual(h.park_sensor, ['57'])            // w/prk sensor yes, w/o auto park no
})

test('an air bag "module" is the bag, a distance sensor replaced is a module', () => {
  const h = triggerLinesFromText(EST)
  assert.ok(!h.module_repl.includes('70'))
  assert.ok(h.module_repl.includes('71'))
})

test('VIN glued to the next field is still found', () => {
  assert.equal(findVinInText(EST), '1GNEVFKW3MJ250609')
})

test('Secure Share rows ("3 | R&I | …") read the operation column', () => {
  const h = triggerLinesFromText('LINES:\n3 | R&I | Front bumper cover | new OEM | 1.8 hr | S01\n9 | Align | Four wheel alignment | SUBLET |  | \n12 | Repl | Windshield | GLASS |  | ')
  assert.deepEqual(h.front_bumper, ['3'])
  assert.deepEqual(h.alignment, ['9'])
  assert.deepEqual(h.windshield, ['12'])
})
