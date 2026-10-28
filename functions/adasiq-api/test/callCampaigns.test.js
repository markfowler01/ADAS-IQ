import test from 'node:test'
import assert from 'node:assert/strict'
import { pickCallCampaigns, FAMILY_POSTS, INSURANCE_POSTS, HELD_POSTS } from '../services/callCampaigns.js'

const CTA = 'Call or text 1-844-FIX-ADAS.'
const SIGNOFF = 'Father and son. Same day. Done right.'

test('every day has an insurance post, weekends included', () => {
  for (const date of ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-31', '2026-11-01']) {
    const day = pickCallCampaigns(date)
    assert.ok(day.insurance && day.insurance.text, date)
    assert.ok(day.family.text, date)
  }
})

test('Sunday Oct 25 2026 starts the daily insurance rotation with the ADAS Maps post', () => {
  assert.equal(pickCallCampaigns('2026-10-25').insurance.id, 'w1-mon')
  assert.equal(pickCallCampaigns('2026-10-26').insurance.id, 'w1-tue')
})

test('no insurance post repeats within one full rotation', () => {
  const ids = []
  for (let i = 0; i < INSURANCE_POSTS.length; i++) {
    const d = new Date(Date.UTC(2026, 9, 25 + i)).toISOString().slice(0, 10)
    ids.push(pickCallCampaigns(d).insurance.id)
  }
  assert.equal(new Set(ids).size, INSURANCE_POSTS.length)
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

test('no campaign post says "recommend" (Mark 2026-10-28: calibration requirements)', () => {
  for (const p of [...FAMILY_POSTS, ...INSURANCE_POSTS, ...HELD_POSTS]) {
    assert.ok(!/recommend/i.test(p.text), p.id)
  }
})
