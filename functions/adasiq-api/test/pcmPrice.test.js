import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findBestMatchExported } from '../services/zoho.js'

const items = [
  { item_id: 'generic', name: 'PCM update', rate: 450 },
  { item_id: 'vw', name: 'PCM update for Volkswagen', rate: 350 },
  { item_id: 'mod', name: 'Module Programming and Reflash - Volkswagen', rate: 200 },
]

test('Volkswagen PCM Software Update follows shop type', () => {
  const repair = findBestMatchExported('PCM Software Update', new Map(), items, null, null, { make: 'Volkswagen', customerType: 'repair_shop' })
  assert.equal(repair?.matchedName, 'PCM update for Volkswagen')
  assert.notEqual(repair?.matchedName, 'PCM update')
  assert.equal(repair?.rate, 350)

  const body = findBestMatchExported('PCM Software Update', new Map(), items, null, null, { make: 'Volkswagen', customerType: 'body_shop' })
  assert.equal(body, null)

  const withTwin = findBestMatchExported('PCM Software Update', new Map(), [
    ...items,
    { item_id: 'vw-c', name: 'PCM update for Volkswagen (Collision)', rate: 999 },
  ], null, null, { make: 'Volkswagen', customerType: 'body_shop' })
  assert.equal(withTwin?.matchedName, 'PCM update for Volkswagen (Collision)')
  assert.notEqual(withTwin?.matchedName, 'PCM update for Volkswagen')

  const fromVehicle = findBestMatchExported('PCM Software Update', new Map(), items, null, null, { make: '', vehicle: '2015 Volkswagen Beetle', customerType: 'repair_shop' })
  assert.equal(fromVehicle?.matchedName, 'PCM update for Volkswagen')

  const vw = findBestMatchExported('PCM update', new Map(), items, null, null, { make: 'VW', customerType: 'dealer' })
  assert.equal(vw?.matchedName, 'PCM update for Volkswagen')

  const otherMake = findBestMatchExported('PCM Software Update', new Map(), items, null, null, { make: 'Ford', customerType: 'retail' })
  assert.equal(otherMake?.matchedName, 'PCM update')

  const programming = findBestMatchExported('Module Programming and Reflash - Volkswagen', new Map(), items, null, null, { make: 'Volkswagen', customerType: 'repair_shop' })
  assert.notEqual(programming?.matchedName, 'PCM update for Volkswagen')
})
