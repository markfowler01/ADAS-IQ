// 💸 Bill it defaults (Mark 2026-11-02): cash + State Farm/Allstate start at 15%, editable;
// the cash switch reprices CP ⇄ standard in one tap. A failure blocks the deploy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultPct, repriceLines, clampPct } from '../services/billDefaults.js'

const items = [
  { item_id: '1', name: 'Front Radar', rate: 450 },
  { item_id: '2', name: 'CP - Front Radar', rate: 350 },
  { item_id: '3', name: 'Front Camera', rate: 450 },
  { item_id: '4', name: 'CP - Front Camera', rate: 350 },
  { item_id: '5', name: 'Rear Radar', rate: 450 },
  { item_id: '6', name: 'CP - Rear Radar', rate: 350 },
  { item_id: '7', name: 'SFP - Front Radar', rate: 500 },
]

test('cash and every insurer price list start at 15 (over the shop %); others use the shop %', () => {
  assert.deepEqual(defaultPct({ cash: true, pool: 'SF', shopPct: 25 }).pct, 15)
  assert.equal(defaultPct({ cash: false, pool: 'SF', shopPct: 25 }).pct, 15)
  assert.equal(defaultPct({ cash: false, pool: 'AS', shopPct: 25 }).source, 'insurer')
  assert.equal(defaultPct({ cash: false, pool: 'GEICO', shopPct: 25 }).pct, 15)
  assert.equal(defaultPct({ cash: false, pool: 'AMFAM', shopPct: 25 }).source, 'insurer')
  assert.equal(defaultPct({ cash: false, pool: null, shopPct: 20 }).source, 'shop')
  assert.equal(defaultPct({ cash: false, pool: null, shopPct: null }).pct, null)
})

test('pct is clamped 0–50', () => {
  assert.equal(clampPct(-5), 0); assert.equal(clampPct(80), 50); assert.equal(clampPct('12.5'), 12.5); assert.equal(clampPct(undefined), 0)
})

test('cash off: CP lines → standard twins, cap line dropped', () => {
  const lines = [
    { name: 'CP - Front Radar', rate: 350, quantity: 1, line_item_id: 'a' },
    { name: 'CP - Front Camera', rate: 350, quantity: 1 },
    { name: 'CP - Rear Radar', rate: 350, quantity: 1 },
    { name: '💵 Cash cap — $700 max', rate: -350, quantity: 1 },
    { name: 'Post-Scan (included)', rate: 0, quantity: 1 },
  ]
  const r = repriceLines(lines, null, items)
  assert.deepEqual(r.lines.map(l => l.name), ['Front Radar', 'Front Camera', 'Rear Radar', 'Post-Scan (included)'])
  assert.equal(r.to_total, 1350); assert.equal(r.from_total, 700)
  assert.equal(r.lines[0].line_item_id, null)
  assert.deepEqual(r.missing, [])
})

test('cash on: standard → CP and the $700 cap comes back', () => {
  const lines = [{ name: 'Front Radar', rate: 450, quantity: 1 }, { name: 'Front Camera', rate: 450, quantity: 1 }, { name: 'Rear Radar', rate: 450, quantity: 1 }, { name: 'Wheel Alignment', rate: 150, quantity: 1 }]
  const r = repriceLines(lines, 'CP', items)
  assert.equal(r.to_total, 700)
  assert.ok(r.lines.some(l => /cash cap/i.test(l.name)))
  assert.deepEqual(r.missing, ['Wheel Alignment'])   // no CP twin → stays at its price, listed
})

test('already on the right list → nothing changes', () => {
  const r = repriceLines([{ name: 'Front Radar', rate: 450, quantity: 1 }], null, items)
  assert.equal(r.changed, 0)
})

test('State Farm twin uses SFP prefix', () => {
  const r = repriceLines([{ name: 'CP - Front Radar', rate: 350, quantity: 1 }], 'SF', items)
  assert.equal(r.lines[0].name, 'SFP - Front Radar')
})
