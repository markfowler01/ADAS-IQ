// 🧾 Scrub invoices (Mark 2026-11-04): built only from billable ledger rows, never
// for Absolute ADAS or a charges-off account, retries then past due. Blocks the deploy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInvoice, dunningStep, prevMonth, closeWindow, invoiceNumber } from '../services/scrubInvoice.js'

const acct = { id: 'cal1', name: 'NW Cal', type: 'cal_shop', email: 'a@b.co' }
const rows = [
  { shop: 'Joe', billable: true, price: 3 }, { shop: 'Joe', billable: true, price: 3 },
  { shop: 'MSO', billable: true, price: 2 }, { shop: 'Joe', billable: false, price: 0, reason: 'free trial' },
  { shop: 'Joe', billable: false, price: 0, reason: 'filtered: 2011 is older than 2013' },
]

test('one line per body shop + price; free rows counted, not billed', () => {
  const inv = buildInvoice(acct, rows, { month: '2026-11', seq: 7 })
  assert.equal(inv.total, 8); assert.equal(inv.vins, 3); assert.equal(inv.number, 'IQ-202611-007')
  assert.deepEqual(inv.lines.map(l => [l.shop, l.qty, l.amount]), [['Joe', 2, 6], ['MSO', 1, 2]])
  assert.equal(inv.free_count, 2); assert.equal(inv.filtered_count, 1); assert.equal(inv.status, 'draft')
})

test('never invoices Absolute ADAS, a charges-off account, or $0', () => {
  assert.equal(buildInvoice({ ...acct, type: 'house' }, rows, { month: '2026-11', seq: 1 }), null)
  assert.equal(buildInvoice({ ...acct, free: true }, rows, { month: '2026-11', seq: 1 }), null)
  assert.equal(buildInvoice(acct, rows.filter(r => !r.billable), { month: '2026-11', seq: 1 }), null)
})

test('failed card: retry day 3, retry day 7, then past due', () => {
  const t0 = Date.parse('2026-12-01T10:00:00Z'), d = n => t0 + n * 86400000
  const inv = { status: 'failed', first_failed_at: new Date(t0).toISOString(), tries: 1 }
  assert.equal(dunningStep(inv, d(1)), null)
  assert.equal(dunningStep(inv, d(3)), 'retry')
  assert.equal(dunningStep({ ...inv, tries: 2 }, d(5)), null)
  assert.equal(dunningStep({ ...inv, tries: 2 }, d(7)), 'retry')
  assert.equal(dunningStep({ ...inv, tries: 3 }, d(7)), 'past_due')
  assert.equal(dunningStep({ ...inv, tries: 3, past_due_at: 'x' }, d(9)), null)
  assert.equal(dunningStep({ ...inv, status: 'paid' }, d(9)), null)
})

test('month close timing (Pacific)', () => {
  assert.equal(prevMonth(new Date('2026-12-01T12:00:00Z')), '2026-11')
  assert.equal(prevMonth(new Date('2026-01-02T12:00:00Z')), '2025-12')
  assert.equal(closeWindow(new Date('2026-12-01T09:30:00Z')), false)   // 1:30 AM PT
  assert.equal(closeWindow(new Date('2026-12-01T11:00:00Z')), true)    // 3 AM PT
  assert.equal(closeWindow(new Date('2026-12-09T11:00:00Z')), false)
  assert.equal(invoiceNumber('2026-11', 12), 'IQ-202611-012')
})
