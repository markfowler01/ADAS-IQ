// 🔌 Diag only (Mark 2026-11-03): per car, never a shop rule. A failure blocks the deploy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksDiagOnly, calsLookDiagOnly, diagState, stripBig4, takeDiag, isDiagName } from '../services/diagOnly.js'

test('diag lines only → diag-only; any calibration → not', () => {
  assert.equal(looksDiagOnly([{ name: 'Diagnostic 1', rate: 175 }, { name: 'Post-Scan', rate: 0 }, { name: 'Calibration Identification Report', rate: 45 }]), true)
  assert.equal(looksDiagOnly([{ name: 'Diagnostic', rate: 175 }, { name: 'Front Radar', rate: 450 }]), false)
  assert.equal(looksDiagOnly([{ name: 'Post-Scan', rate: 0 }]), false)
  assert.equal(looksDiagOnly([]), false)
})

test('scan lines whose text says diagnostic are not diag work', () => {
  assert.equal(isDiagName('Pre-Scan'), false)
  assert.equal(isDiagName('Diagnostic 1'), true)
})

test('card calibrations', () => {
  assert.equal(calsLookDiagOnly([{ calibration_name: 'Diagnostic 1' }]), true)
  assert.equal(calsLookDiagOnly([{ calibration_name: 'Diagnostic 1' }, { calibration_name: 'Front Camera' }]), false)
  assert.equal(calsLookDiagOnly([{ calibration_name: 'Front Camera', enabled: false }, { calibration_name: 'Diagnostic' }]), true)
})

test("Kat's flip wins over the auto guess", () => {
  assert.equal(diagState({ on: false, by: 'Kat' }, true).on, false)
  assert.equal(diagState(null, true).auto, true)
  assert.equal(diagState({ on: true }, false).on, true)
})

test('strip Big 4, keep the diag', () => {
  const r = stripBig4([{ name: 'Diagnostic 1' }, { name: 'Calibration Identification Report' }, { name: 'Post Collision Safety Inspection 1 (included)' }, { name: 'Post-Scan' }, { name: 'Pre-Scan' }, { name: 'Calibration Snapshot' }])
  assert.deepEqual(r.map(l => l.name), ['Diagnostic 1'])
})

test('takeDiag strips the field', () => {
  const b = { diag_only: true, x: 1 }
  assert.equal(takeDiag(b), true); assert.equal('diag_only' in b, false)
  assert.equal(takeDiag({ x: 1 }), undefined)
  assert.equal(takeDiag({ diag_only: false }), false)
})
