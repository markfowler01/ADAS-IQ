import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchShop, shopCoreKey } from '../services/shopResolve.js'

const woodinville = { id: '1', shop_name: 'Maaco In Woodinville (MAW)', pipeline_stage: 'active' }
const bellingham = { id: '2', shop_name: 'Maaco - Bellingham', pipeline_stage: 'active' }

test('a CCC Maaco Woodinville name matches the CRM shop', () => {
  const m = matchShop('MAACO WOODINVILLE - M2517', [woodinville, bellingham])
  assert.equal(m.shop?.id, '1')
  assert.equal(shopCoreKey('MAACO WOODINVILLE - M2517'), shopCoreKey('Maaco In Woodinville (MAW)'))
})

test('Woodinville does not match Maaco Bellingham', () => {
  const m = matchShop('MAACO WOODINVILLE - M2517', [bellingham])
  assert.equal(m.shop, null)
})

test('two Woodinville shops stay unmatched', () => {
  const other = { id: '3', shop_name: 'Maaco Woodinville', pipeline_stage: 'active' }
  const m = matchShop('MAACO WOODINVILLE - M2517', [woodinville, other])
  assert.equal(m.shop, null)
  assert.equal(m.how, 'ambiguous')
})

test('the brand alone does not attach to one city shop', () => {
  const m = matchShop('Maaco', [woodinville, bellingham])
  assert.equal(m.shop, null)
})
