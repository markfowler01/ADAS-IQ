// Public free calibration-denial AUDIT tool — the lead magnet that delivers
// the Godfather Offer at scale. Body shops submit denial details; Claude
// generates an OEM-cited rebuttal. The shop gets the rebuttal on-screen
// AND via email; Mark gets a Cliq DM with each submission as a hot lead.
//
//   GET  /api/audit-tool/form         — HTML form (also hosted at absoluteadas.com/audit)
//   POST /api/audit-tool/generate     — accepts inputs, returns rebuttal + emails it
//
// No auth — public-facing. Rate limiting by IP via in-memory map (modest
// abuse protection; for serious abuse we'd add a proper rate limiter).

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { generateRebuttal } from '../services/auditAssembly.js'
import { sendBroadcast } from '../services/brewResend.js'
import { postToCliqUser, TECH_CLIQ_IDS } from '../services/cliq.js'
import { syncNewsletterSubscriberToCrm } from '../services/zohoCrm.js'

export const auditRouter = express.Router()

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

// ─── In-memory IP rate-limit ────────────────────────────────────────────────
// 5 submissions per IP per hour. Keeps abuse manageable without a redis dep.
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

// ─── Submission tracking (so Mark can review submissions later) ─────────────
const SUBMISSIONS_KEY = 'audit_tool_submissions'
async function recordSubmission(req, payload) {
  try {
    const seg = getSegment(req)
    const existing = (await cacheGet(seg, SUBMISSIONS_KEY, [])) || []
    // Cap at the 200 most recent
    const next = [{ ...payload, at: new Date().toISOString() }, ...existing].slice(0, 200)
    await cacheSet(seg, SUBMISSIONS_KEY, next)
  } catch (e) {
    console.warn('[audit-tool record]', e.message)
  }
}

// ─── HTML form (also embedded in the public landing page) ───────────────────
auditRouter.get('/form', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Free Calibration Denial Audit · ADAS Brew</title></head><body><h1>Free Calibration Denial Audit</h1><p>Public form lives at <a href="https://absoluteadas.com/audit">absoluteadas.com/audit</a>.</p></body></html>`)
})

// ─── POST /generate — accepts inputs, runs Claude, emails + DMs Mark ────────
auditRouter.post('/generate', express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim()
    if (rateLimited(ip)) {
      return res.status(429).json({ ok: false, error: 'Too many requests. Try again in an hour, or just text 1-844-FIX-ADAS.' })
    }

    const body = req.body || {}
    const shopName = String(body.shopName || '').trim().slice(0, 120)
    const email = String(body.email || '').trim().toLowerCase().slice(0, 180)
    const year = String(body.year || '').trim().slice(0, 8)
    const make = String(body.make || '').trim().slice(0, 40)
    const model = String(body.model || '').trim().slice(0, 60)
    const carrier = String(body.carrier || '').trim().slice(0, 80)
    const deniedItem = String(body.deniedItem || '').trim().slice(0, 120)
    const denialLanguage = String(body.denialLanguage || '').trim().slice(0, 2500)
    const deniedAmount = Number(String(body.deniedAmount || '').replace(/[^0-9.]/g, '')) || null
    const subscribeOptIn = body.subscribe === true || body.subscribe === 'true' || body.subscribe === 1

    if (!shopName) return res.status(400).json({ ok: false, error: 'Shop name required' })
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, error: 'Valid email required' })
    if (!carrier) return res.status(400).json({ ok: false, error: 'Carrier required' })
    if (!deniedItem) return res.status(400).json({ ok: false, error: 'Tell us what was denied' })

    // Run Claude
    const audit = await generateRebuttal({
      shopName, year, make, model, carrier, deniedItem, denialLanguage, deniedAmount,
    })
    if (!audit.ok) {
      console.error('[audit-tool gen]', audit.error)
      return res.status(500).json({ ok: false, error: `Could not generate rebuttal: ${audit.error}` })
    }

    // Persist submission for Mark's records
    await recordSubmission(req, {
      shopName, email, year, make, model, carrier, deniedItem,
      denialLanguage, deniedAmount, ip,
    })

    // Email the rebuttal to the shop (HTML + plain text)
    const vehicle = [year, make, model].filter(Boolean).join(' ')
    const subject = `Your OEM-cited rebuttal — ${carrier} denial${vehicle ? ` (${vehicle})` : ''}`
    const html = renderRebuttalEmail({
      shopName, rebuttal: audit.rebuttal, carrier, vehicle, deniedItem,
    })
    const text = renderRebuttalText({ shopName, rebuttal: audit.rebuttal, carrier, vehicle, deniedItem })
    sendBroadcast({ recipients: [email], subject, html, text })
      .catch(e => console.warn('[audit-tool email]', e.message))

    // CRM-sync the email if subscribing (treats it like a brew signup)
    if (subscribeOptIn) {
      syncNewsletterSubscriberToCrm({ email, shop: shopName }).catch(e => console.warn('[audit-tool crm]', e.message))
    }

    // Cliq DM Mark — hot lead, shop is actively dealing with a denial
    const cliqMsg = [
      '🎯 NEW AUDIT LEAD via /audit tool',
      '',
      `Shop: ${shopName}`,
      `Email: ${email}`,
      `Vehicle: ${vehicle || '(not provided)'}`,
      `Carrier: ${carrier}`,
      `Denied: ${deniedItem}${deniedAmount ? ` · $${deniedAmount}` : ''}`,
      '',
      `Their denial language: "${(denialLanguage || '(not provided)').slice(0, 400)}"`,
      '',
      'Rebuttal already emailed to them. Follow up to land the sublet.',
    ].join('\n').slice(0, 2000)
    postToCliqUser(TECH_CLIQ_IDS.Mark, cliqMsg).catch(e => console.warn('[audit-tool cliq]', e.message))

    res.json({ ok: true, rebuttal: audit.rebuttal })
  } catch (e) {
    console.error('[audit-tool generate]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ─── Email rendering ────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderRebuttalEmail({ shopName, rebuttal, carrier, vehicle, deniedItem }) {
  const greeting = shopName ? `Hey ${esc(shopName)} team` : 'Hey there'
  const lines = rebuttal.split('\n').map(l => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;color:#1a1a1a">${esc(l)}</p>`).join('')
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f3f0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3f0"><tr><td align="center" style="padding:32px 16px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-radius:14px;border-top:4px solid #CD4419">
<tr><td style="padding:32px 28px">
  <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.16em;color:#CD4419;text-transform:uppercase;margin-bottom:6px">ADAS Brew · Free Audit Delivery</div>
  <h1 style="font-size:22px;margin:0 0 14px;font-weight:800;line-height:1.25">Your OEM-cited rebuttal is ready</h1>
  <p style="font-size:15px;line-height:1.55;margin:0 0 14px">${greeting} —</p>
  <p style="font-size:15px;line-height:1.55;margin:0 0 18px">Below is your rebuttal for the ${esc(carrier)} denial${vehicle ? ` on the ${esc(vehicle)}` : ''}. It's written in shop voice, OEM-cited, and ready to copy into your supplement response or email reply. Edit as needed for your situation.</p>
  <div style="background:#fff8f4;border-left:3px solid #CD4419;border-radius:8px;padding:20px 22px;margin:0 0 22px">
    ${lines}
  </div>
  <p style="font-size:15px;line-height:1.55;margin:0 0 14px"><strong>If it lands you the line item</strong> — text me at <a href="tel:+18443492327" style="color:#CD4419;font-weight:700;text-decoration:none">1-844-FIX-ADAS</a> and let me know. Patterns help me sharpen the next one.</p>
  <p style="font-size:15px;line-height:1.55;margin:0 0 14px"><strong>If you need more help fighting denials</strong> — subscribe to <a href="https://absoluteadas.com/brew" style="color:#CD4419;font-weight:700;text-decoration:none">ADAS Brew</a>. 5-minute daily read for shops doing real calibration volume. Free.</p>
  <p style="font-size:15px;line-height:1.55;margin:0">— Mark Fowler<br><span style="color:#6b7280;font-size:13px">Owner, Absolute ADAS · 1-844-FIX-ADAS</span></p>
</td></tr>
<tr><td style="padding:18px 28px 28px;border-top:1px solid #ececec">
  <p style="font-size:12px;color:#6b7280;margin:0">Not legal or insurance advice. Use at your own discretion. Each carrier and claim is different. Always confirm OEM citations against the current manufacturer documentation before submitting.</p>
</td></tr>
</table></td></tr></table></body></html>`
}

function renderRebuttalText({ shopName, rebuttal, carrier, vehicle, deniedItem }) {
  return [
    `${shopName ? `Hey ${shopName} team` : 'Hey there'} —`,
    '',
    `Below is your rebuttal for the ${carrier} denial${vehicle ? ` on the ${vehicle}` : ''}. Copy/paste, edit as needed.`,
    '',
    '---',
    rebuttal,
    '---',
    '',
    `If it lands you the line item, text me at 1-844-FIX-ADAS so I can learn from the pattern.`,
    `For more like this, subscribe to ADAS Brew: https://absoluteadas.com/brew`,
    '',
    '— Mark Fowler, Owner, Absolute ADAS',
  ].join('\n')
}

// ─── Admin: list recent submissions (cron-secret protected) ─────────────────
function requireCronSecretFlex(req, res, next) {
  const want = String(process.env.BREW_CRON_SECRET || '').replace(/[^a-zA-Z0-9]/g, '')
  const got = String(req.headers['x_cron_secret'] || req.headers['x-cron-secret'] || req.query.secret || '').replace(/[^a-zA-Z0-9]/g, '')
  if (want && got !== want) return res.status(401).type('text/plain').send('Unauthorized')
  next()
}

auditRouter.get('/submissions', requireCronSecretFlex, async (req, res) => {
  try {
    const seg = getSegment(req)
    const list = await cacheGet(seg, SUBMISSIONS_KEY, []) || []
    res.json({ ok: true, count: list.length, items: list })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})
