// Capture Rate Calculator — the lead magnet at the top of the v2.5
// acquisition funnel. Public form at absoluteadas.com/calculator.
//
//   POST /api/capture-calc/generate — accepts inputs, returns the leak/capture
//                                     numbers + emails a personalized PDF.
//   GET  /api/capture-calc/submissions — cron-secret protected, lets Mark
//                                        review every lead that came through.
//
// No auth on /generate — public-facing. IP rate-limit (5/hr) for abuse.
// Same fail-soft pattern as /audit-tool: every step is independent so a flaky
// email/CRM/Cliq call never blocks the user from seeing their numbers.

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { computeCaptureNumbers, generateCaptureReportPdf } from '../services/captureReportPdf.js'
import { sendBroadcast } from '../services/brewResend.js'
import { postToCliqUser, TECH_CLIQ_IDS } from '../services/cliq.js'
import { syncNewsletterSubscriberToCrm } from '../services/zohoCrm.js'
import { buildNurtureEmail, nurtureDayFor, NURTURE_DAYS } from '../services/captureNurture.js'
import { buildColdEmail, COLD_HOOKS, COLD_DAYS } from '../services/coldOutreach.js'
import { draftLinkedInWeek } from '../services/linkedInDrafter.js'
import { generateLeaveBehindPdf } from '../services/leaveBehindPdf.js'
import axios from 'axios'

export const captureCalcRouter = express.Router()

// ─── Cache + IP rate-limit ──────────────────────────────────────────────────
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

const SUBMISSIONS_KEY = 'capture_calc_submissions'
async function recordSubmission(req, payload) {
  try {
    const seg = getSegment(req)
    const existing = (await cacheGet(seg, SUBMISSIONS_KEY, [])) || []
    const next = [{ ...payload, at: new Date().toISOString() }, ...existing].slice(0, 200)
    await cacheSet(seg, SUBMISSIONS_KEY, next)
  } catch (e) {
    console.warn('[capture-calc record]', e.message)
  }
}

function fmtCurrency(n) {
  if (!Number.isFinite(n)) return '$0'
  return '$' + Math.round(n).toLocaleString('en-US')
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── POST /generate ─────────────────────────────────────────────────────────
captureCalcRouter.post('/generate', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim()
    if (rateLimited(ip)) {
      return res.status(429).json({ ok: false, error: 'Too many requests. Try again in an hour, or text 1-844-FIX-ADAS.' })
    }

    const body = req.body || {}
    const contactName = String(body.contactName || '').trim().slice(0, 80)
    const email = String(body.email || '').trim().toLowerCase().slice(0, 180)
    const shopName = String(body.shopName || '').trim().slice(0, 120)
    const phone = String(body.phone || '').trim().slice(0, 30)
    const calibrationsPerMonth = Number(String(body.calibrationsPerMonth || '').replace(/[^0-9.]/g, ''))
    const avgTicket = Number(String(body.avgTicket || '').replace(/[^0-9.]/g, ''))
    const currentCapturePct = Number(String(body.currentCapturePct || '').replace(/[^0-9.]/g, ''))

    if (!contactName) return res.status(400).json({ ok: false, error: 'Your name is required' })
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, error: 'Valid email required' })
    if (!shopName) return res.status(400).json({ ok: false, error: 'Shop name is required' })
    if (!Number.isFinite(calibrationsPerMonth) || calibrationsPerMonth <= 0) {
      return res.status(400).json({ ok: false, error: 'Tell us roughly how many calibrations you sublet per month' })
    }
    if (!Number.isFinite(avgTicket) || avgTicket <= 0) {
      return res.status(400).json({ ok: false, error: 'Tell us your average sublet ticket' })
    }
    if (!Number.isFinite(currentCapturePct) || currentCapturePct < 0 || currentCapturePct > 100) {
      return res.status(400).json({ ok: false, error: 'Current capture % must be 0-100' })
    }

    const calc = computeCaptureNumbers({ calibrationsPerMonth, avgTicket, currentCapturePct })

    // Persist for Mark's CRM review
    recordSubmission(req, {
      contactName, email, shopName, phone, calibrationsPerMonth, avgTicket,
      currentCapturePct, ip,
      annualLeak: calc.annualLeak, annualCapture: calc.annualCapture,
    }).catch(() => {})

    // Build the PDF, then send everything in parallel (PDF is the slow part,
    // ~200-400ms; everything else < 100ms).
    let pdfBuf = null
    try {
      pdfBuf = await generateCaptureReportPdf({
        shopName, contactName, calibrationsPerMonth, avgTicket, currentCapturePct, calc,
      })
    } catch (e) {
      console.warn('[capture-calc pdf]', e.message)
    }

    const subject = `${shopName} — your hidden GP leak is ${fmtCurrency(calc.annualLeak)} / year`
    const html = renderResultEmail({ contactName, shopName, calc })
    const text = renderResultText({ contactName, shopName, calc })

    sendBroadcast({
      recipients: [email], subject, html, text,
      attachments: pdfBuf ? [{ filename: `${shopName.replace(/[^a-z0-9]/gi, '_')}_Capture_Report.pdf`, content: pdfBuf.toString('base64') }] : undefined,
    }).catch(e => console.warn('[capture-calc email]', e.message))

    // CRM sync — same path as newsletter, tagged differently downstream
    syncNewsletterSubscriberToCrm({ email, shop: shopName, name: contactName, source: 'capture_calculator' })
      .catch(e => console.warn('[capture-calc crm]', e.message))

    // Cliq Mark — this is a hot lead, they just self-qualified themselves
    const cliqMsg = [
      '💰 NEW CAPTURE CALC LEAD',
      '',
      `Shop: ${shopName}`,
      `Contact: ${contactName}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : '',
      '',
      `Inputs: ${calibrationsPerMonth} cals/mo × ${fmtCurrency(avgTicket)} ticket @ ${currentCapturePct}% current capture`,
      `Their annual leak: ${fmtCurrency(calc.annualLeak)}`,
      `Their annual capture upside: ${fmtCurrency(calc.annualCapture)}`,
      '',
      'PDF report already emailed. Follow up within 24 hrs to book the Revenue Audit.',
    ].filter(Boolean).join('\n').slice(0, 2000)
    postToCliqUser(TECH_CLIQ_IDS.Mark, cliqMsg).catch(e => console.warn('[capture-calc cliq]', e.message))

    res.json({
      ok: true,
      shopName,
      monthlyLeak: calc.monthlyLeak,
      annualLeak: calc.annualLeak,
      monthlyCapture: calc.monthlyCapture,
      annualCapture: calc.annualCapture,
      currentMonthlyGp: calc.currentMonthlyGp,
      targetMonthlyGp: calc.targetMonthlyGp,
      targetCapturePct: calc.targetCapturePct,
      pdfDelivered: Boolean(pdfBuf),
    })
  } catch (e) {
    console.error('[capture-calc generate]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ─── Email rendering ────────────────────────────────────────────────────────
function renderResultEmail({ contactName, shopName, calc }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f3f0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3f0"><tr><td align="center" style="padding:32px 16px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-radius:14px;border-top:4px solid #CD4419">
<tr><td style="padding:32px 28px">
  <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:800;letter-spacing:.18em;color:#CD4419;text-transform:uppercase;margin-bottom:6px">Capture Rate Report</div>
  <h1 style="font-size:24px;margin:0 0 6px;font-weight:800;line-height:1.2;color:#0d0d0d">${esc(shopName)}'s hidden GP leak</h1>
  <p style="font-size:14px;color:#6b7280;margin:0 0 22px">Personalized for ${esc(contactName)}. PDF attached.</p>

  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:20px 22px;margin-bottom:14px">
    <div style="font-size:10px;font-weight:800;letter-spacing:.18em;color:#dc2626;text-transform:uppercase;margin-bottom:6px">The leak, right now</div>
    <div style="font-size:36px;font-weight:800;color:#dc2626;line-height:1">${fmtCurrency(calc.annualLeak)}</div>
    <div style="font-size:13px;color:#374151;margin-top:8px">per year walking out your bay door as sublet vendor margin.</div>
  </div>

  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px 22px;margin-bottom:22px">
    <div style="font-size:10px;font-weight:800;letter-spacing:.18em;color:#16a34a;text-transform:uppercase;margin-bottom:6px">The capture, with the absolute capture system</div>
    <div style="font-size:36px;font-weight:800;color:#16a34a;line-height:1">${fmtCurrency(calc.annualCapture)}</div>
    <div style="font-size:13px;color:#374151;margin-top:8px">net new gross profit per year. Captured automatically through your existing RO flow. No capex.</div>
  </div>

  <p style="font-size:15px;line-height:1.55;margin:0 0 14px;color:#1a1a1a">${esc(contactName)},</p>
  <p style="font-size:15px;line-height:1.55;margin:0 0 14px;color:#1a1a1a">${esc(shopName)} is leaking ${fmtCurrency(calc.monthlyLeak)} every month in gross profit to your sublet vendor. That's not a guess. That's your number based on what you just told us.</p>
  <p style="font-size:15px;line-height:1.55;margin:0 0 18px;color:#1a1a1a">There's a 4-step system to close it. We call it <strong>The Absolute Capture System</strong> — Audit, Activate, Allocate, Amplify. It runs through your existing RO workflow. No new software. No new staff. A defined percentage of every calibration just shows up as shop GP.</p>

  <div style="background:#0d0d0d;border-radius:10px;padding:20px 22px;margin:18px 0">
    <div style="font-size:10px;font-weight:800;letter-spacing:.18em;color:#CD4419;text-transform:uppercase;margin-bottom:6px">The guarantee</div>
    <p style="font-size:14px;line-height:1.55;color:#ffffff;margin:0;font-weight:600">If the Absolute Capture System doesn't add at least $10,000 in new monthly GP within 90 days of activation, we work for free until it does. And we cut you a check for $1,000 for the time we wasted.</p>
  </div>

  <p style="font-size:15px;line-height:1.55;margin:18px 0 18px;color:#1a1a1a"><strong>Next step:</strong> a 15-minute Revenue Audit. We pull your actual sublet invoices and confirm the real number, not the calculator estimate. Free. No commitment.</p>
  <p style="margin:0 0 22px"><a href="https://absoluteadas.com/audit" style="display:inline-block;background:#CD4419;color:#fff;padding:13px 26px;text-decoration:none;font-weight:800;border-radius:8px;font-size:14px">Book your Revenue Audit  →</a></p>

  <p style="font-size:13px;color:#6b7280;margin:0 0 4px">Or text me direct: <a href="tel:+18443492327" style="color:#CD4419;font-weight:700;text-decoration:none">1-844-FIX-ADAS</a></p>
  <p style="font-size:15px;line-height:1.55;margin:18px 0 0;color:#1a1a1a">— Mark Fowler<br><span style="color:#6b7280;font-size:13px">Owner, Absolute ADAS  ·  50,000+ calibrations on the floor</span></p>
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #ececec">
  <p style="font-size:12px;color:#6b7280;margin:0">Estimate based on industry-typical sublet margins. Real numbers vary by carrier mix and vehicle profile. Detailed breakdown in the attached PDF.</p>
</td></tr>
</table></td></tr></table></body></html>`
}

function renderResultText({ contactName, shopName, calc }) {
  return [
    `${shopName} — Your Capture Rate Report`,
    '',
    `${contactName},`,
    '',
    `THE LEAK (right now): ${fmtCurrency(calc.annualLeak)} per year walking out your bay door as sublet vendor margin.`,
    '',
    `THE CAPTURE (with the Absolute Capture System): ${fmtCurrency(calc.annualCapture)} net new GP per year, captured automatically through your existing RO flow.`,
    '',
    `That's ${fmtCurrency(calc.monthlyLeak)} every single month, leaking out of ${shopName} in gross profit. It is automatic. The capture is a choice.`,
    '',
    `THE GUARANTEE: If The Absolute Capture System doesn't add at least $10,000 in new monthly GP within 90 days of activation, we work for free until it does. AND we cut you a check for $1,000 for the time we wasted.`,
    '',
    `NEXT STEP: Book a 15-minute Revenue Audit. We pull your actual sublet invoices and confirm the real number. Free, no commitment.`,
    `→ https://absoluteadas.com/audit`,
    `→ Or text: 1-844-FIX-ADAS`,
    '',
    `— Mark Fowler, Owner, Absolute ADAS`,
  ].join('\n')
}

// ─── Admin submissions list ─────────────────────────────────────────────────
function requireCronSecretFlex(req, res, next) {
  const want = String(process.env.BREW_CRON_SECRET || '').replace(/[^a-zA-Z0-9]/g, '')
  const got = String(req.headers['x_cron_secret'] || req.headers['x-cron-secret'] || req.query.secret || '').replace(/[^a-zA-Z0-9]/g, '')
  if (want && got !== want) return res.status(401).type('text/plain').send('Unauthorized')
  next()
}

captureCalcRouter.get('/submissions', requireCronSecretFlex, async (req, res) => {
  try {
    const seg = getSegment(req)
    const list = await cacheGet(seg, SUBMISSIONS_KEY, []) || []
    res.json({ ok: true, count: list.length, items: list })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ─── DAILY NURTURE CRON ─────────────────────────────────────────────────────
// Run once per day. For each opt-in, computes which nurture day they're on
// (1-7) and sends that day's email if it hasn't been sent yet. Idempotent
// via per-submission nurture_sent[] tracking, so safe to re-run.
//
//   GET /api/capture-calc/nurture/run?secret=...
//   GET /api/capture-calc/nurture/run?secret=...&dry=1   — log what would send, no email
//   GET /api/capture-calc/nurture/preview?secret=...&day=N&to=email   — send single day to test address
captureCalcRouter.get('/nurture/run', requireCronSecretFlex, async (req, res) => {
  const dry = req.query.dry === '1' || req.query.dry === 'true'
  const out = []
  try {
    const seg = getSegment(req)
    const list = (await cacheGet(seg, SUBMISSIONS_KEY, [])) || []
    let mutated = false

    for (let i = 0; i < list.length; i++) {
      const sub = list[i]
      const day = nurtureDayFor(sub)
      if (day < 1 || day > 7) continue
      const sent = Array.isArray(sub.nurture_sent) ? sub.nurture_sent : []
      if (sent.includes(day)) continue

      const email = buildNurtureEmail(sub, day)
      if (!email) continue

      if (dry) {
        out.push({ email: sub.email, shop: sub.shopName, day, subject: email.subject, dry: true })
        continue
      }

      const r = await sendBroadcast({
        recipients: [sub.email],
        subject: email.subject,
        html: email.html,
        text: email.text,
      })
      const ok = r.status === 'sent' || r.status === 'partial'
      if (ok) {
        list[i] = { ...sub, nurture_sent: [...sent, day] }
        mutated = true
      }
      out.push({ email: sub.email, shop: sub.shopName, day, subject: email.subject, ok, status: r.status })
    }

    if (mutated) await cacheSet(seg, SUBMISSIONS_KEY, list)
    res.json({ ok: true, dry, processed: out.length, results: out })
  } catch (e) {
    console.error('[capture-calc nurture]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message, partialResults: out })
  }
})

// Preview / test a single day's nurture email by sending it to a test address.
//   ?day=1..7  ?to=test@example.com  (defaults: day=1, to=brew@absoluteadas.com)
captureCalcRouter.get('/nurture/preview', requireCronSecretFlex, async (req, res) => {
  try {
    const day = Math.max(1, Math.min(7, Number(req.query.day) || 1))
    const to = String(req.query.to || 'brew@absoluteadas.com').trim()
    const shopName = String(req.query.shop || 'Test Shop Calibration')
    const contactName = String(req.query.name || 'Mark Tester')

    // Synthesize a fake submission so we can preview without needing a real opt-in
    const fake = {
      contactName, email: to, shopName,
      calibrationsPerMonth: 20, avgTicket: 475, currentCapturePct: 10,
      annualLeak: 22800, annualCapture: 22800,
      at: new Date(Date.now() - day * 86400000).toISOString(),
    }
    const email = buildNurtureEmail(fake, day)
    if (!email) return res.status(400).json({ ok: false, error: `Day ${day} not defined` })

    const r = await sendBroadcast({ recipients: [to], subject: email.subject, html: email.html, text: email.text })
    res.json({ ok: r.status === 'sent' || r.status === 'partial', day, to, subject: email.subject, status: r.status })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ─── COLD OUTREACH — preview / test-send / batch-send ───────────────────────
//
//   GET  /api/capture-calc/cold/render?secret=...&hook=greed|fear|curiosity&day=0|4|10
//        — Render a single cold email as HTML for review (no send).
//   GET  /api/capture-calc/cold/preview?secret=...&hook=...&day=...&to=...&shop=...&name=...
//        — Send a single cold email to a test address.
//   POST /api/capture-calc/cold/send?secret=...
//        — Body: { hook, day, targets: [{contactName, shopName, email, city?}] }
//        — Sends to a list of targets. Throttled by sendBroadcast (~5/sec).
//          Use small batches (50-100/day max) to keep domain reputation healthy.

captureCalcRouter.get('/cold/render', requireCronSecretFlex, async (req, res) => {
  try {
    const hook = String(req.query.hook || 'greed')
    const day = Number(req.query.day) || 0
    const target = {
      contactName: String(req.query.name || 'Mark Tester'),
      shopName: String(req.query.shop || 'Test Shop Calibration'),
      email: String(req.query.to || 'preview@absoluteadas.com'),
    }
    const email = buildColdEmail({ hook, day }, target)
    if (!email) return res.status(400).type('text/plain').send(`Invalid hook=${hook} or day=${day}. Hooks: ${COLD_HOOKS.join(', ')}. Days: ${COLD_DAYS.join(', ')}.`)
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(email.html)
  } catch (e) {
    res.status(500).type('text/plain').send(e.message)
  }
})

captureCalcRouter.get('/cold/preview', requireCronSecretFlex, async (req, res) => {
  try {
    const hook = String(req.query.hook || 'greed')
    const day = Number(req.query.day) || 0
    const to = String(req.query.to || 'brew@absoluteadas.com').trim()
    const target = {
      contactName: String(req.query.name || 'Mark Tester'),
      shopName: String(req.query.shop || 'Test Shop Calibration'),
      email: to,
    }
    const email = buildColdEmail({ hook, day }, target)
    if (!email) return res.status(400).json({ ok: false, error: `Invalid hook or day` })
    const r = await sendBroadcast({ recipients: [to], subject: email.subject, html: email.html, text: email.text })
    res.json({ ok: r.status === 'sent' || r.status === 'partial', hook, day, to, subject: email.subject, status: r.status })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ─── SALES LEAVE-BEHIND PDF (public, no auth) ───────────────────────────────
// Mark + Kat print this for in-person shop visits and direct mail drops.
// 2-page brochure, front = hook + math, back = 4-A system + Grand Slam.
//   GET /api/capture-calc/leave-behind.pdf  → inline PDF
captureCalcRouter.get('/leave-behind.pdf', async (req, res) => {
  try {
    const pdfBuf = await generateLeaveBehindPdf()
    res.set('Content-Type', 'application/pdf')
    res.set('Content-Disposition', 'inline; filename="absolute-adas-capture-system.pdf"')
    res.set('Cache-Control', 'public, max-age=86400')
    res.send(pdfBuf)
  } catch (e) {
    res.status(500).type('text/plain').send(e.message)
  }
})

// ─── LINKEDIN DRAFT WEEK ────────────────────────────────────────────────────
//   POST /api/capture-calc/linkedin/draft-week
//   Body: { story: "Mark's ~200-word weekly shop-visit story", caseStudy?, angle? }
//   Returns: { drafts: [{day, type, headline, body}] × 5 } — Mon/Tue/Wed/Thu/Fri
captureCalcRouter.post('/linkedin/draft-week', requireCronSecretFlex, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const story = String(req.body?.story || '').trim()
    const caseStudy = String(req.body?.caseStudy || '').trim()
    const angle = String(req.body?.angle || '').trim()
    if (!story) return res.status(400).json({ ok: false, error: 'story is required' })
    const result = await draftLinkedInWeek({ story, caseStudy, angle })
    res.json({ ok: true, ...result })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

captureCalcRouter.post('/cold/send', requireCronSecretFlex, express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const hook = String(req.body?.hook || 'greed')
    const day = Number(req.body?.day) || 0
    const targets = Array.isArray(req.body?.targets) ? req.body.targets : []
    if (!targets.length) return res.status(400).json({ ok: false, error: 'targets[] required' })
    if (targets.length > 100) return res.status(400).json({ ok: false, error: 'Batch capped at 100 to protect domain reputation' })

    const results = []
    for (const t of targets) {
      const email = buildColdEmail({ hook, day }, t)
      if (!email || !t.email) { results.push({ to: t.email, ok: false, error: 'invalid_target_or_email' }); continue }
      const r = await sendBroadcast({ recipients: [t.email], subject: email.subject, html: email.html, text: email.text })
      results.push({ to: t.email, ok: r.status === 'sent' || r.status === 'partial', status: r.status })
      await new Promise(rs => setTimeout(rs, 250)) // belt-and-suspenders pacing
    }
    res.json({ ok: true, hook, day, count: results.length, results })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Render a single day's email as HTML for browser preview (no send).
//   ?day=1..7
captureCalcRouter.get('/nurture/render', requireCronSecretFlex, async (req, res) => {
  try {
    const day = Math.max(1, Math.min(7, Number(req.query.day) || 1))
    const fake = {
      contactName: 'Mark Tester', email: 'preview@absoluteadas.com', shopName: 'Test Shop Calibration',
      calibrationsPerMonth: 20, avgTicket: 475, currentCapturePct: 10,
      annualLeak: 22800, annualCapture: 22800,
      at: new Date(Date.now() - day * 86400000).toISOString(),
    }
    const email = buildNurtureEmail(fake, day)
    if (!email) return res.status(400).type('text/plain').send(`Day ${day} not defined`)
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(email.html)
  } catch (e) {
    res.status(500).type('text/plain').send(e.message)
  }
})
