// 🎯 The GET SOME!!! count + ⏰ arrival windows (Mark 2026-11-03).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTechCapacity, onLaneFor, todayPT } from '../services/dispatch.js'
import { arriveOf, arriveSort, takeArrive } from '../services/arrive.js'

const today = todayPT()
const job = (id, o) => ({ id, technician: 'Jayden', status: 'dispatched_jaden', scheduled_date: '', ...o })

test('undated + carried-over dispatched jobs count on today', async () => {
  const jobs = [job(1), job(2, { scheduled_date: '2020-01-01' }), job(3, { scheduled_date: `${today}T09:30` }), job(4, { scheduled_date: '2099-01-01' })]
  const c = await getTechCapacity(null, 'Jayden', today, jobs, {}, {})
  assert.equal(c.used, 3)
  assert.equal(c.done, 0)
})

test('done today still counts after Kat marks it complete; old completions do not', async () => {
  const now = new Date().toISOString()
  const jobs = [job(1, { status: 'complete' }), job(2, { status: 'ready_invoice' }), job(3)]
  const state = { 1: { completed_at: now }, 2: { completed_at: '2020-01-01T18:00:00Z' } }
  const c = await getTechCapacity(null, 'Jayden', today, jobs, {}, state)
  assert.equal(c.done, 1)
  assert.equal(c.used, 2)
})

test('someone else\'s jobs never count', async () => {
  const c = await getTechCapacity(null, 'Jayden', today, [job(1, { technician: 'Mark', status: 'dispatched_mark' })], {}, {})
  assert.equal(c.used, 0)
})

test('future date counts jobs + requests booked that day', async () => {
  const jobs = [job(1, { scheduled_date: '2099-01-05' }), job(2, { status: 'job_requested', scheduled_date: '2099-01-05T08:00' }), job(3, { scheduled_date: '2099-01-06' })]
  assert.equal((await getTechCapacity(null, 'Jayden', '2099-01-05', jobs, {}, {})).used, 2)
})

test('lane rule: undated requests stay in Kat\'s queue', () => {
  assert.equal(onLaneFor({ status: 'job_requested', scheduled_date: '' }, today), false)
  assert.equal(onLaneFor({ status: 'job_requested', scheduled_date: today }, today), true)
  assert.equal(onLaneFor({ status: 'pending_parts' }, today), false)
})

test('arrival window: stored window, exact time, website note, none', () => {
  assert.equal(arriveOf({}, { arrive: 'first' }).label, 'First thing')
  assert.equal(arriveOf({ scheduled_date: '2026-11-04T13:15' }).label, '1:15 PM')
  assert.equal(arriveOf({ notes: '🌐 Website booking · After lunch' }).kind, 'pm')
  assert.equal(arriveOf({ scheduled_date: '2026-11-04' }), null)
  assert.ok(arriveSort(arriveOf({}, { arrive: 'first' })) < arriveSort(null))
  assert.ok(arriveSort(null) < arriveSort(arriveOf({}, { arrive: 'pm' })))
})

test('takeArrive strips the field and rejects junk', () => {
  const b = { arrive: 'eod', shop_name: 'x' }; assert.equal(takeArrive(b), 'eod'); assert.equal('arrive' in b, false)
  assert.equal(takeArrive({ arrive: 'lunch?' }), '')
  assert.equal(takeArrive({ shop_name: 'x' }), undefined)
})
