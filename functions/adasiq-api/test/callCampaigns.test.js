import test from 'node:test'
import assert from 'node:assert/strict'
import { pickCallCampaigns, FAMILY_POSTS, INSURANCE_POSTS, HELD_POSTS } from '../services/callCampaigns.js'

const CTA = 'Call or text 1-844-FIX-ADAS.'
const SIGNOFF = 'Father and son. Same day. Done right.'

test('Friday Oct 23 2026 sends family plus the week-1 Friday insurance post', () => {
  const day = pickCallCampaigns('2026-10-23')
  assert.equal(day.weekday, true)
  assert.equal(day.family.id, 'f3')
  assert.equal(day.insurance.id, 'w1-fri')
  assert.match(day.insurance.text, /Text the van by noon/)
})

test('weekend is father-and-son only', () => {
  for (const date of ['2026-10-24', '2026-10-25']) {
    const day = pickCallCampaigns(date)
    assert.equal(day.weekday, false)
    assert.equal(day.insurance, null)
    assert.ok(day.family.text)
  }
  assert.notEqual(pickCallCampaigns('2026-10-24').family.id, pickCallCampaigns('2026-10-25').family.id)
})

test('Monday Oct 26 is the next insurance post, not a repeat of Friday', () => {
  const day = pickCallCampaigns('2026-10-26')
  assert.equal(day.weekday, true)
  assert.equal(day.insurance.id, 'w2-mon')
})

test('the same date always picks the same posts', () => {
  assert.deepEqual(pickCallCampaigns('2026-10-23'), pickCallCampaigns('2026-10-23'))
})

test('scheduled copy stays on confirmed facts and the one call to action', () => {
  const scheduled = [...FAMILY_POSTS, ...INSURANCE_POSTS]
  assert.equal(scheduled.length, 18)
  for (const post of scheduled) {
    assert.ok(post.text.endsWith(SIGNOFF), post.id)
    assert.ok(post.text.includes(CTA), post.id)
    assert.equal(post.text.split(CTA).length, 2, post.id)
    assert.doesNotMatch(post.text, /Jayden's answer|do not use|TikTok/i)
  }
  assert.ok(INSURANCE_POSTS.find(p => p.id === 'w2-thu').text.includes('about 65 shops'))
  assert.match(INSURANCE_POSTS.find(p => p.id === 'w1-mon').text, /State Farm, Allstate, USAA, GEICO, and Progressive/)
  assert.match(INSURANCE_POSTS.find(p => p.id === 'w2-wed').text, /State Farm, Allstate, USAA, GEICO, and Progressive/)
  assert.deepEqual(FAMILY_POSTS.map(p => p.id), ['f1', 'f3', 'f4'])
  assert.equal(HELD_POSTS[0].id, 'f2')
})
