// Shop Talk — private weekly two-tech episode from ADAS Brew.
// Script in one request. Each spoken line in its own request (30s gate).

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { buildShopTalkEpisode, loadRecentIssues } from '../services/shopTalk.js'
import { speakShopTalkLine } from '../services/shopTalkAudio.js'

const router = express.Router()
const CACHE_KEY = 'shop_talk_latest'
const SOURCES_KEY = 'shop_talk_sources'
const MARK_EMAILS = ['mark@absoluteadas.com', 'mf@absoluteadas.com', 'mfowler4456@gmail.com']

function isOwner(req) {
  const email = String(req.user?.email || '').trim().toLowerCase()
  return MARK_EMAILS.includes(email) || req.user?.role === 'owner'
}

function deny(res) { return res.status(403).json({ error: 'Owner only.' }) }

function withDeadline(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out. Hit Cut this week again.`)), ms)),
  ])
}

function segment(req) { return catalyst.initialize(req).cache().segment() }

async function cacheGet(req, key) {
  try {
    const val = await segment(req).getValue(key)
    return val ? JSON.parse(val) : null
  } catch { return null }
}
async function cacheSet(req, key, value) {
  const str = JSON.stringify(value)
  try { await segment(req).update(key, str) }
  catch { await segment(req).put(key, str, 48) }
}

router.get('/latest', async (req, res) => {
  if (!isOwner(req)) return deny(res)
  try {
    const script = await cacheGet(req, CACHE_KEY)
    res.json({ ok: true, script })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/sources', async (req, res) => {
  if (!isOwner(req)) return deny(res)
  try {
    const issues = await withDeadline(loadRecentIssues(5, req), 22000, 'Pulling Brew')
    await cacheSet(req, SOURCES_KEY, issues)
    res.json({
      ok: true,
      issues: issues.map(i => ({ number: i.number, date: i.date, title: i.title, stories: i.stories.length })),
    })
  } catch (e) {
    console.error('[shop-talk sources]', e.message)
    res.status(500).json({ error: e.message })
  }
})

router.post('/script', async (req, res) => {
  if (!isOwner(req)) return deny(res)
  try {
    const issues = await cacheGet(req, SOURCES_KEY)
    if (!issues?.length) return res.status(409).json({ error: 'Pull the week first.' })
    const script = await withDeadline(buildShopTalkEpisode(issues), 25000, 'Writing Carl and Cole')
    await cacheSet(req, CACHE_KEY, script)
    res.json({ ok: true, script })
  } catch (e) {
    console.error('[shop-talk script]', e.message)
    res.status(500).json({ error: e.message })
  }
})

router.post('/line', async (req, res) => {
  if (!isOwner(req)) return deny(res)
  try {
    const who = String(req.body?.who || 'carl').toLowerCase() === 'cole' ? 'cole' : 'carl'
    const text = String(req.body?.text || '').trim()
    const buf = await speakShopTalkLine(who, text)
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-store')
    res.send(buf)
  } catch (e) {
    console.error('[shop-talk line]', e.message)
    res.status(500).json({ error: e.message })
  }
})

export default router
