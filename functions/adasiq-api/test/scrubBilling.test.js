// 💳 Scrub billing (Mark 2026-11-04): Absolute ADAS customers are never charged;
// calibration shops are billed for their body shops. A failure blocks the deploy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAccount, chargeFor, rollup, houseAccount } from '../services/scrubBilling.js'

const cal = { id: 'cal1', name: 'Northwest Cal Co', type: 'cal_shop', price: 3, trial: 0, status: 'active' }
const accounts = [houseAccount(), cal]
const links = [
  { ccc_shop_id: '555', shop_name: 'Joe’s Collision', account_id: 'cal1' },
  { ccc_shop_id: '', shop_name: 'Free Friend Body Shop', account_id: 'cal1', free: true },
  { ccc_shop_id: '777', shop_name: 'Big MSO #4', account_id: 'cal1', price: 2 },
]
const now = Date.parse('2026-11-04T12:00:00Z')

test('no link → Absolute ADAS, never charged', () => {
  const r = resolveAccount({ shop: 'Some Absolute Customer', shopId: '999' }, { accounts, links })
  assert.equal(r.account.id, 'house')
  assert.equal(chargeFor({ vin: 'V1', ro: '1' }, r, [], now).billable, false)
})

test('CCC id beats name; calibration shop pays per VIN', () => {
  const r = resolveAccount({ shop: 'renamed', shopId: '555' }, { accounts, links })
  assert.equal(r.account.id, 'cal1')
  assert.deepEqual(chargeFor({ vin: 'V1', ro: '1' }, r, [], now), { price: 3, billable: true, reason: 'per VIN' })
})

test('name match, free body shop under a paying account', () => {
  const r = resolveAccount({ shop: 'FREE FRIEND body shop, LLC' }, { accounts, links })
  assert.equal(r.link.shop_name, 'Free Friend Body Shop')
  assert.equal(chargeFor({ vin: 'V2', ro: '2' }, r, [], now).billable, false)
})

test('per-shop price, and account-wide charges off', () => {
  const r = resolveAccount({ shopId: '777' }, { accounts, links })
  assert.equal(chargeFor({ vin: 'V3', ro: '3' }, r, [], now).price, 2)
  const off = { ...r, account: { ...cal, free: true } }
  assert.equal(chargeFor({ vin: 'V3', ro: '3' }, off, [], now).billable, false)
})

test('supplement on same VIN + RO is free for 30 days, then charged', () => {
  const r = resolveAccount({ shopId: '555' }, { accounts, links })
  const hist = [{ account_id: 'cal1', vin: 'V1', ro: '1', billable: true, at: '2026-10-20T00:00:00Z' }]
  assert.equal(chargeFor({ vin: 'v1', ro: '1' }, r, hist, now).billable, false)
  assert.equal(chargeFor({ vin: 'V1', ro: '2' }, r, hist, now).billable, true)
  const old = [{ ...hist[0], at: '2026-09-01T00:00:00Z' }]
  assert.equal(chargeFor({ vin: 'V1', ro: '1' }, r, old, now).billable, true)
})

test('free trial runs out', () => {
  const r = { account: { ...cal, trial: 2 }, link: null }
  const used = [{ account_id: 'cal1', reason: 'free trial' }]
  assert.equal(chargeFor({ vin: 'A', ro: '1' }, r, used, now).reason, 'free trial')
  assert.equal(chargeFor({ vin: 'B', ro: '1' }, r, [...used, ...used], now).billable, true)
})

test('roll-up per account with body shops under it', () => {
  const rows = [
    { account_id: 'cal1', shop: 'Joe', billable: true, price: 3 },
    { account_id: 'cal1', shop: 'Joe', billable: false, price: 0 },
    { account_id: 'cal1', shop: 'Big MSO #4', billable: true, price: 2 },
    { account_id: 'house', shop: 'Ours', billable: false, price: 0 },
  ]
  const [a, h] = rollup(rows, accounts)
  assert.equal(a.total, 5); assert.equal(a.billable, 2); assert.equal(a.scrubs, 3); assert.equal(a.shops[0].shop, 'Joe')
  assert.equal(h.total, 0)
})
