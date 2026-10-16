import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseBucket, unionEntries, addMissingEntries, packLists, punchesThatWouldBeLost, TEXT_MAX,
} from '../services/timeclockGuard.js'

const punch = (id, extra = {}) => ({ id, clock_in: '2026-10-01T15:00:00.000Z', total_minutes: 480, ...extra })

test('a bad read is an error, not an empty month', () => {
  assert.deepEqual(parseBucket('', 'k'), [])
  assert.deepEqual(parseBucket(null, 'k'), [])
  assert.deepEqual(parseBucket('[]', 'k'), [])
  assert.throws(() => parseBucket('{', 'october'), /unreadable/)
  assert.throws(() => parseBucket('{"hours":1}', 'october'), /not a list/)
})

test('a short save keeps punches it did not mention', () => {
  const existing = [punch('a'), punch('b'), punch('c')]
  const saved = unionEntries(existing, [punch('a', { total_minutes: 500 })])
  assert.deepEqual(saved.map(e => e.id).sort(), ['a', 'b', 'c'])
  assert.equal(saved.find(e => e.id === 'a').total_minutes, 500)
})

test('only a named delete removes a punch', () => {
  const existing = [punch('a'), punch('b')]
  const saved = unionEntries(existing, [punch('a')], ['b'])
  assert.deepEqual(saved.map(e => e.id), ['a'])
  const lost = punchesThatWouldBeLost(existing, saved.map(e => e.id), [])
  assert.deepEqual(lost.map(e => e.id), ['b'])
  assert.deepEqual(punchesThatWouldBeLost(existing, ['a'], ['b']), [])
})

test('restore adds missing punches and does not overwrite live ones', () => {
  const live = [punch('a', { total_minutes: 100 })]
  const backup = [punch('a', { total_minutes: 1 }), punch('b')]
  const { entries, added } = addMissingEntries(live, backup)
  assert.equal(added, 1)
  assert.equal(entries.find(e => e.id === 'a').total_minutes, 100)
  assert.equal(entries.find(e => e.id === 'b').total_minutes, 480)
})

test('a big month is split under the text limit', () => {
  const list = Array.from({ length: 40 }, (_, i) => punch(`p${i}`, { notes: 'x'.repeat(400) }))
  const packed = packLists({ 'tc2:jayden:2026-10': list })
  const keys = Object.keys(packed)
  assert.ok(keys.length > 1)
  assert.equal(keys[0], 'tc2:jayden:2026-10')
  for (const chunk of Object.values(packed)) {
    assert.ok(JSON.stringify(chunk).length <= TEXT_MAX)
  }
  assert.equal(Object.values(packed).flat().length, 40)
})
