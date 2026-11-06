// Time card review window: 2 days before period end (weekend → Friday), weekdays only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reviewOpensISO, reviewDue } from '../services/hr.js'

test('opens 2 days before the end, a weekend rolls back to Friday', () => {
  assert.equal(reviewOpensISO('2026-11-15'), '2026-11-13')   // Sun end → Fri
  assert.equal(reviewOpensISO('2026-11-30'), '2026-11-27')   // Mon end → Sat → Fri
  assert.equal(reviewOpensISO('2026-12-15'), '2026-12-11')   // Tue end → Sun → Fri
  assert.equal(reviewOpensISO('2026-12-31'), '2026-12-29')   // Thu end → Tue
})
test('weekdays only, through 4 days after', () => {
  assert.equal(reviewDue('2026-11-12', '2026-11-15'), false)  // Thu, too early
  assert.equal(reviewDue('2026-11-13', '2026-11-15'), true)   // Fri
  assert.equal(reviewDue('2026-11-14', '2026-11-15'), false)  // Sat
  assert.equal(reviewDue('2026-11-15', '2026-11-15'), false)  // Sun end day
  assert.equal(reviewDue('2026-11-16', '2026-11-15'), true)   // Mon catch-up
  assert.equal(reviewDue('2026-11-19', '2026-11-15'), true)
  assert.equal(reviewDue('2026-11-20', '2026-11-15'), false)  // past the catch-up
})
