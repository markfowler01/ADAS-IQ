// 🗑 Jobs can't silently disappear (Mark 2026-10-29). Real cases from the incident:
// the hourly invoice re-check deleted the Stanwood Gerber BMW M2 (dispatched to Jayden)
// and Northwest Diesel on loose RO matches.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAutoRemove, MAX_AUTO } from '../services/jobTrash.js'
import { notesMatchInvoice } from '../routes/webhook.js'

const gerber = { id: '45874000000716012', shop_name: 'Stanwood Gerber Collision & Glass', status: 'dispatched_jaden', invoiced: false, notes: 'Quote: SGC&G 24 BMW M2' }
const nwDiesel = { id: '45874000000703743', shop_name: 'Northwest Diesel', status: 'need_dispatch', invoiced: false, notes: 'Quote: ND 10 Dodge Ram 2500' }
const billed = { id: '1', shop_name: 'Perfect Reflections Auto Body', status: 'ready_invoice', invoiced: true, notes: 'RO#: NM479232\n💸 Billed via app by Kat: invoice PRAB NM479232 from estimate' }

test('automation never removes live work on a weak match', () => {
  assert.equal(checkAutoRemove(gerber, { reason: 'invoice_sent', match: 'name' }).ok, false)
  assert.equal(checkAutoRemove(nwDiesel, { reason: 'invoice_sent', match: 'name' }).ok, false)
  assert.equal(checkAutoRemove(gerber, { reason: 'cleanup', match: 'invoiced' }).ok, false)   // not invoiced
  assert.equal(checkAutoRemove(gerber, { reason: 'automation' }).ok, false)
})

test('a closed quote only clears an untouched card', () => {
  assert.equal(checkAutoRemove(nwDiesel, { reason: 'estimate_closed', match: 'estimate' }).ok, true)
  assert.equal(checkAutoRemove(gerber, { reason: 'estimate_closed', match: 'estimate' }).ok, false)   // dispatched → a person decides
})

test('an invoiced card matched exactly can go', () => {
  assert.equal(checkAutoRemove(billed, { reason: 'invoice_sent', match: 'ro' }).ok, true)
  assert.equal(checkAutoRemove(billed, { reason: 'cleanup', match: 'invoiced' }).ok, true)
  assert.equal(checkAutoRemove(gerber, { reason: 'invoice_sent', match: 'vin' }).ok, true)   // the invoice itself is the proof
})

test('RO match is exact, never a substring', () => {
  assert.equal(notesMatchInvoice('RO#: 1779 | Quote: CB 1779', '1779', 'CB 1779'), true)
  assert.equal(notesMatchInvoice('RO#: 177 | Quote: CB 177', '1779', 'CB 1779'), false)
  assert.equal(notesMatchInvoice('RO#: 11003 | Quote: BBR 11003', '110030', 'BBR 110030'), false)
  assert.equal(notesMatchInvoice('RO#: 15 | Quote: X', '15 Ford Transitvan', 'JT 15 Ford Transitvan'), false)
  assert.equal(notesMatchInvoice(gerber.notes, '1779', 'CB 1779'), false)
  assert.equal(notesMatchInvoice(nwDiesel.notes, '15 Ford Transitvan', 'JT 15 Ford Transitvan'), false)
})

test('Bill it note matches its own invoice number only', () => {
  assert.equal(notesMatchInvoice(billed.notes, 'NM479232', 'PRAB NM479232'), true)
  assert.equal(notesMatchInvoice('invoice PRAB NM4792321 from estimate', 'X', 'PRAB NM479232'), false)
})

test('the per-run cap is small', () => { assert.ok(MAX_AUTO <= 3) })
