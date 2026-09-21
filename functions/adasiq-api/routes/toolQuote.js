// Public tool-quote / shop-setup lead capture for the Absolute Diagnostics NW
// storefront (absolutediagnosticsnw.com). A shop fills the "Get price / Book a
// setup call" form; Mark gets a Cliq alert and the lead is logged for review.
//
//   POST /api/tool-quote/submit   — accepts { name, shop, contact, tool }, alerts Mark
//
// No auth — public-facing. Sent as x-www-form-urlencoded from a static site, so
// it must parse urlencoded (JSON POST would trigger a CORS preflight the gateway
// won't answer). Mirrors routes/auditTool.js.

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from '../services/cliq.js'

export const toolQuoteRouter = express.Router()

// ─── Cache helpers ──────────────────────────────────────────────────────────
function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}
function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}
async function cacheGet(seg, key, fallback = null) {
  try {
    const val = await seg.getValue(key)
    return val ? JSON.parse(val) : fallback
  } catch (e) {
    if (isNotFound(e)) return fallback
    throw e
  }
}
async function cacheSet(seg, key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  try { await seg.update(key, str) }
  catch { await seg.put(key, str) }
}

// ─── In-memory IP rate-limit (5 / hour) ─────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const RATE_LIMIT_MAX = 5
const ipHits = new Map()
function rateLimited(ip) {
  if (!ip) return false
  const now = Date.now()
  const hits = (ipHits.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS)
  if (hits.length >= RATE_LIMIT_MAX) return true
  hits.push(now)
  ipHits.set(ip, hits)
  return false
}

const SUBMISSIONS_KEY = 'tool_quote_submissions'
async function recordSubmission(req, payload) {
  try {
    const seg = getSegment(req)
    const existing = (await cacheGet(seg, SUBMISSIONS_KEY, [])) || []
    const next = [{ ...payload, at: new Date().toISOString() }, ...existing].slice(0, 200)
    await cacheSet(seg, SUBMISSIONS_KEY, next)
  } catch (e) {
    console.warn('[tool-quote record]', e.message)
  }
}

// ─── POST /submit ────────────────────────────────────────────────────────────
toolQuoteRouter.post('/submit', express.json({ limit: '32kb' }), express.urlencoded({ extended: false, limit: '32kb' }), async (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim()
    if (rateLimited(ip)) {
      return res.status(429).json({ ok: false, error: 'Too many requests. Try again shortly, or call 1-844-FIX-ADAS.' })
    }

    const body = req.body || {}
    const name = String(body.name || '').trim().slice(0, 120)
    const shop = String(body.shop || '').trim().slice(0, 160)
    const contact = String(body.contact || '').trim().slice(0, 180)
    const tool = String(body.tool || '').trim().slice(0, 160)

    if (!name) return res.status(400).json({ ok: false, error: 'Name required' })
    if (!contact) return res.status(400).json({ ok: false, error: 'Phone or email required' })

    await recordSubmission(req, { name, shop, contact, tool, ip })

    const isSetup = /setup|bay|calibration-bay|10k/i.test(tool)
    const cliqMsg = [
      isSetup ? '🏗️ NEW SHOP-SETUP LEAD — Absolute Diagnostics NW' : '🛠️ NEW TOOL LEAD — Absolute Diagnostics NW',
      '',
      `Name: ${name}`,
      `Shop: ${shop || '(not provided)'}`,
      `Contact: ${contact}`,
      `Interested in: ${tool || '(not specified)'}`,
      '',
      'Reply fast to land it. GET SOME!!!',
    ].join('\n').slice(0, 2000)
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, cliqMsg).catch(e => console.warn('[tool-quote cliq]', e.message))

    res.json({ ok: true })
  } catch (e) {
    console.error('[tool-quote submit]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ─── GET /submissions — cron-secret protected review endpoint ────────────────
function requireCronSecretFlex(req, res, next) {
  const want = String(process.env.BREW_CRON_SECRET || '').replace(/[^a-zA-Z0-9]/g, '')
  const got = String(req.headers['x_cron_secret'] || req.headers['x-cron-secret'] || req.query.secret || '').replace(/[^a-zA-Z0-9]/g, '')
  if (want && got !== want) return res.status(401).type('text/plain').send('Unauthorized')
  next()
}
toolQuoteRouter.get('/submissions', requireCronSecretFlex, async (req, res) => {
  try {
    const seg = getSegment(req)
    const list = await cacheGet(seg, SUBMISSIONS_KEY, []) || []
    res.json({ ok: true, count: list.length, items: list })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})
