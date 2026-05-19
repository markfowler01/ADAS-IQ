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
import { draftLinkedInWeek, draftSlotVariants, draftWeekVariants } from '../services/linkedInDrafter.js'
import { postToLinkedIn } from '../services/brewLinkedIn.js'
import { generateLeaveBehindPdf } from '../services/leaveBehindPdf.js'
import { scoreDraft, measureDraft, loadFingerprint, updateFingerprint, categoryTrust } from '../services/voiceScorer.js'
import { enqueueDraft, listQueue, getDraft, updateDraft, verifySignedAction, formatApprovalCard, buildSignedActionUrl } from '../services/captureApprovalQueue.js'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from '../services/cliq.js'
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

// ─── APPROVAL QUEUE + CLIQ CARD POSTING ─────────────────────────────────────
// Enqueue a draft for approval + post a Cliq card with signed action links.
//
//   POST /api/capture-calc/approval/enqueue  (cron-secret)
//        body: {channel, category, headline?, body, scheduled_for?, voice_score?, voice_deductions?}
//        → posts a Cliq card to Mark's alert channel with approve/edit/kill links
//
//   GET  /api/capture-calc/approval/approve?id=&t=&sig=  (PUBLIC, signed)
//   GET  /api/capture-calc/approval/kill?id=&t=&sig=     (PUBLIC, signed)
//   GET  /api/capture-calc/approval/edit?id=&t=&sig=     (PUBLIC, signed) → HTML form
//   POST /api/capture-calc/approval/edit?id=&t=&sig=     (PUBLIC, signed) → save edit + approve
//
//   GET  /api/capture-calc/approval/queue  (cron-secret) → list pending

const PUBLIC_BASE = 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'

captureCalcRouter.post('/approval/enqueue', requireCronSecretFlex, express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const entry = await enqueueDraft(getSegment(req), req.body || {})
    const card = formatApprovalCard({ entry, baseUrl: PUBLIC_BASE })
    const r = await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, card).catch(e => ({ ok: false, error: e.message }))
    // Persist fingerprint signal: enqueued drafts aren't approvals, just track them
    res.json({ ok: true, id: entry.id, cliq: r?.ok !== false, voice_score: entry.voice_score })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Reset/clear the queue — used to flush bad test data
captureCalcRouter.post('/approval/reset', requireCronSecretFlex, async (req, res) => {
  try {
    const seg = getSegment(req)
    await cacheSet(seg, 'capture_approval_queue', [])
    res.json({ ok: true, message: 'queue cleared' })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

captureCalcRouter.get('/approval/queue', requireCronSecretFlex, async (req, res) => {
  try {
    const status = req.query.status || undefined
    const list = await listQueue(getSegment(req), { status })
    res.json({ ok: true, count: list.length, items: list })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Public approve/kill/edit — signed via HMAC. GETs return confirmation pages
// (NO side effects, because Cliq + iMessage + Slack link-unfurl bots auto-GET
// URLs for previews). Real action requires a POST from the confirm button.
function handleConfirmGet(action) {
  return async (req, res) => {
    const { id, t, sig } = req.query || {}
    const v = verifySignedAction({ id, action, t, sig })
    if (!v.ok) return res.status(401).type('text/html').send(approvalPage({ title: 'Link invalid', message: v.error, color: '#dc2626' }))
    const draft = await getDraft(getSegment(req), id)
    if (!draft) return res.status(404).type('text/html').send(approvalPage({ title: 'Draft not found', message: '', color: '#dc2626' }))
    if (draft.status !== 'pending') return res.type('text/html').send(approvalPage({ title: `Already ${draft.status}`, message: 'This draft has already been acted on.', color: '#6b7280', body: draft.body }))

    if (action === 'edit') return res.type('text/html').send(editForm({ draft, t, sig }))

    // approve / kill — show a confirm page with a one-click POST button
    return res.type('text/html').send(confirmPage({ draft, action, t, sig }))
  }
}

function handleSignedPost(action) {
  return async (req, res) => {
    const { id, t, sig } = req.query || {}
    const v = verifySignedAction({ id, action, t, sig })
    if (!v.ok) return res.status(401).type('text/html').send(approvalPage({ title: 'Link invalid', message: v.error, color: '#dc2626' }))
    const segment = getSegment(req)
    const draft = await getDraft(segment, id)
    if (!draft) return res.status(404).type('text/html').send(approvalPage({ title: 'Draft not found', message: '', color: '#dc2626' }))
    if (draft.status !== 'pending') return res.type('text/html').send(approvalPage({ title: `Already ${draft.status}`, message: 'This draft has already been acted on.', color: '#6b7280' }))

    if (action === 'approve') {
      const updated = await updateDraft(segment, id, { status: 'approved' })
      await updateFingerprint(segment, { category: draft.category, signal: 'up', text: draft.body }).catch(() => {})
      return res.type('text/html').send(approvalPage({ title: '✅ Approved', message: `Approved for ${updated.channel}. Will publish at the scheduled time.`, color: '#16a34a', body: draft.body }))
    }
    if (action === 'kill') {
      await updateDraft(segment, id, { status: 'killed' })
      await updateFingerprint(segment, { category: draft.category, signal: 'down', text: draft.body }).catch(() => {})
      return res.type('text/html').send(approvalPage({ title: '❌ Killed', message: 'Draft will not be published.', color: '#dc2626' }))
    }
    res.status(400).type('text/plain').send('Unknown action')
  }
}

captureCalcRouter.get('/approval/approve',  handleConfirmGet('approve'))
captureCalcRouter.get('/approval/kill',     handleConfirmGet('kill'))
captureCalcRouter.get('/approval/edit',     handleConfirmGet('edit'))
captureCalcRouter.post('/approval/approve', handleSignedPost('approve'))
captureCalcRouter.post('/approval/kill',    handleSignedPost('kill'))

captureCalcRouter.post('/approval/edit', express.urlencoded({ extended: false, limit: '64kb' }), async (req, res) => {
  const { id, t, sig } = req.query || {}
  const v = verifySignedAction({ id, action: 'edit', t, sig })
  if (!v.ok) return res.status(401).type('text/html').send(approvalPage({ title: 'Link invalid', message: v.error, color: '#dc2626' }))
  const segment = getSegment(req)
  const draft = await getDraft(segment, id)
  if (!draft) return res.status(404).type('text/html').send(approvalPage({ title: 'Draft not found', message: '', color: '#dc2626' }))
  const editedBody = String(req.body?.body || '').trim()
  if (!editedBody) return res.status(400).type('text/html').send(approvalPage({ title: 'Body required', message: '', color: '#dc2626' }))
  const editedHeadline = String(req.body?.headline || draft.headline || '').trim()
  const updated = await updateDraft(segment, id, { status: 'approved', body: editedBody, headline: editedHeadline, was_edited: true })
  await updateFingerprint(segment, { category: draft.category, signal: 'edited', text: draft.body, editedText: editedBody }).catch(() => {})
  res.type('text/html').send(approvalPage({ title: '✅ Edited & Approved', message: 'Your edit is saved and the draft is queued to publish.', color: '#16a34a', body: editedBody }))
})

// ─── Approval result + edit-form HTML helpers ───────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function approvalPage({ title, message, color, body }) {
  const safe = escHtml(body || '')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title><style>body{margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;background:#0d0d0d;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.wrap{max-width:520px;background:#151515;border-radius:16px;padding:36px 32px;border-top:4px solid ${color}}h1{font-size:26px;margin:0 0 12px;color:${color}}p{font-size:15px;line-height:1.55;color:#ccc;margin:0 0 16px}.body{margin:20px 0 0;padding:16px 18px;background:#0d0d0d;border-radius:10px;font-size:14px;line-height:1.55;color:#e5e7eb;white-space:pre-wrap}</style></head><body><div class="wrap"><h1>${escHtml(title)}</h1>${message ? `<p>${escHtml(message)}</p>` : ''}${safe ? `<div class="body">${safe}</div>` : ''}</div></body></html>`
}

function confirmPage({ draft, action, t, sig }) {
  const isKill = action === 'kill'
  const heading = isKill ? '❌ Confirm Kill' : '✅ Confirm Approve'
  const accent = isKill ? '#dc2626' : '#16a34a'
  const btnText = isKill ? 'Yes, kill this draft' : 'Yes, approve this draft'
  const postUrl = `${PUBLIC_BASE}/api/capture-calc/approval/${action}?id=${encodeURIComponent(draft.id)}&t=${encodeURIComponent(t)}&sig=${encodeURIComponent(sig)}`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(heading)}</title><style>body{margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;background:#0d0d0d;color:#fff;min-height:100vh;padding:24px}.wrap{max-width:600px;margin:0 auto;background:#151515;border-radius:16px;padding:28px;border-top:4px solid ${accent}}h1{font-size:24px;margin:0 0 8px;color:${accent}}.meta{font-size:12px;color:#999;margin-bottom:14px}.body{margin:14px 0 20px;padding:16px 18px;background:#0d0d0d;border-radius:10px;font-size:14px;line-height:1.55;color:#e5e7eb;white-space:pre-wrap}.btn{background:${accent};color:#fff;font-weight:800;padding:14px 24px;border:none;border-radius:9px;cursor:pointer;font-size:15px}.score{display:inline-block;padding:5px 12px;background:rgba(205,68,25,.15);color:#CD4419;font-size:12px;font-weight:700;border-radius:6px;margin-bottom:14px}</style></head><body><div class="wrap"><h1>${escHtml(heading)}</h1><div class="meta">Channel: <strong style="color:#fff">${escHtml(draft.channel)}</strong> · Category: <strong style="color:#fff">${escHtml(draft.category)}</strong></div><div class="score">Voice score: ${draft.voice_score || '—'}/100</div>${draft.headline ? `<div style="font-size:16px;font-weight:700;margin-bottom:8px">${escHtml(draft.headline)}</div>` : ''}<div class="body">${escHtml(draft.body)}</div><form method="POST" action="${postUrl}"><button class="btn" type="submit">${escHtml(btnText)}</button></form></div></body></html>`
}

function editForm({ draft, t, sig }) {
  const action = `${PUBLIC_BASE}/api/capture-calc/approval/edit?id=${encodeURIComponent(draft.id)}&t=${encodeURIComponent(t)}&sig=${encodeURIComponent(sig)}`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Edit draft</title><style>body{margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;background:#0d0d0d;color:#fff;min-height:100vh;padding:24px}.wrap{max-width:680px;margin:0 auto;background:#151515;border-radius:16px;padding:28px;border-top:4px solid #CD4419}h1{font-size:22px;margin:0 0 8px;color:#CD4419}.meta{font-size:12px;color:#999;margin-bottom:18px}label{display:block;font-size:13px;font-weight:700;letter-spacing:.04em;color:#ccc;margin:14px 0 8px;text-transform:uppercase}input[type=text],textarea{width:100%;padding:12px 14px;background:#1e1e1e;border:1px solid rgba(255,255,255,.08);border-radius:10px;color:#fff;font-family:'Inter',sans-serif;font-size:15px;line-height:1.5}textarea{min-height:240px;resize:vertical}button{margin-top:18px;background:#CD4419;color:#fff;font-weight:800;padding:14px 22px;border:none;border-radius:9px;cursor:pointer;font-size:15px}.score{display:inline-block;padding:6px 12px;background:rgba(205,68,25,.15);color:#CD4419;font-size:13px;font-weight:700;border-radius:6px;margin-bottom:14px}</style></head><body><div class="wrap"><h1>Edit & approve</h1><div class="meta">Channel: <strong style="color:#fff">${escHtml(draft.channel)}</strong> · Category: <strong style="color:#fff">${escHtml(draft.category)}</strong></div><div class="score">Voice score: ${draft.voice_score || '—'}/100</div><form method="POST" action="${action}">${draft.headline ? `<label>Headline</label><input type="text" name="headline" value="${escHtml(draft.headline)}">` : ''}<label>Body</label><textarea name="body" required>${escHtml(draft.body)}</textarea><button type="submit">Save & Approve  →</button></form></div></body></html>`
}

// ─── VOICE SCORER (diagnostic endpoints) ────────────────────────────────────
//   POST /api/capture-calc/voice/score   body:{text, channel?}      → score 0-100
//   GET  /api/capture-calc/voice/fingerprint                        → current fingerprint
//   POST /api/capture-calc/voice/signal   body:{category, signal, text, editedText?}
//        — Update fingerprint from a Mark signal (up/down/edited).
captureCalcRouter.post('/voice/score', requireCronSecretFlex, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const text = String(req.body?.text || '')
    const channel = String(req.body?.channel || 'generic')
    if (!text) return res.status(400).json({ ok: false, error: 'text required' })
    const result = scoreDraft(text, { channel })
    res.json({ ok: true, ...result })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

captureCalcRouter.get('/voice/fingerprint', requireCronSecretFlex, async (req, res) => {
  try {
    const fp = await loadFingerprint(getSegment(req))
    const trust = {}
    for (const cat of Object.keys(fp.approvals_by_category || {})) {
      trust[cat] = categoryTrust(fp, cat)
    }
    res.json({ ok: true, fingerprint: fp, category_trust: trust })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

captureCalcRouter.post('/voice/signal', requireCronSecretFlex, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const { category, signal, text, editedText } = req.body || {}
    if (!signal || !['up', 'down', 'edited'].includes(signal)) {
      return res.status(400).json({ ok: false, error: 'signal must be up|down|edited' })
    }
    if (!text) return res.status(400).json({ ok: false, error: 'text required' })
    const fp = await updateFingerprint(getSegment(req), { category, signal, text, editedText })
    res.json({ ok: true, fingerprint: fp })
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
//   Returns: { drafts: [{day, type, headline, body}] × 5 } — single-variant
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

// ─── LINKEDIN 3-VARIANT BATCH (Sunday-night cron path) ──────────────────────
// Generates the week's Mon-Fri slots with 3 hook variants each, enqueues all
// 15 drafts, and posts a Cliq card per slot grouping the 3 variants for Mark.
//
//   POST /api/capture-calc/linkedin/draft-week-variants  (cron-secret)
//   Body: { story, caseStudy?, angle? }
//   Returns: { ok, slots: [{day, type, variant_ids: [3]}] }
//
// Schedule per the brief: Mon-Fri 6:30am Pacific. We set scheduled_for to the
// upcoming weekday at 13:30 UTC (6:30am PT) for each day.
captureCalcRouter.post('/linkedin/draft-week-variants', requireCronSecretFlex, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const story = String(req.body?.story || '').trim()
    const caseStudy = String(req.body?.caseStudy || '').trim()
    const angle = String(req.body?.angle || '').trim()
    if (!story) return res.status(400).json({ ok: false, error: 'story is required' })

    const slots = await draftWeekVariants({ story, caseStudy, angle })
    const segment = getSegment(req)
    const out = []

    for (const slot of slots) {
      if (slot.error || !slot.variants?.length) {
        out.push({ day: slot.day, error: slot.error || 'no variants', variant_ids: [] })
        continue
      }
      const scheduledFor = nextScheduledFor(slot.day)
      const variantIds = []
      const cardSections = [`📝 *${slot.day} ${slot.type} — 3 VARIANTS FOR APPROVAL*`, `Scheduled: ${scheduledFor.toISOString()}`, '']
      for (const v of slot.variants) {
        const entry = await enqueueDraft(segment, {
          channel: 'linkedin_personal',
          category: slot.type,
          headline: v.headline,
          body: v.body,
          scheduled_for: scheduledFor.toISOString(),
          voice_score: v.voice_score,
          voice_deductions: v.voice_deductions,
          meta: { hook: v.hook, slot: slot.day, group: `${slot.day}-${scheduledFor.toISOString().slice(0,10)}` },
        })
        variantIds.push(entry.id)
        cardSections.push(`*${v.hook.toUpperCase()}* (voice ${v.voice_score}/100):`)
        cardSections.push(v.body)
        cardSections.push(`👍 *Approve ${v.hook}:* ${buildSignedActionUrl(PUBLIC_BASE, entry.id, 'approve')}`)
        cardSections.push(`✏️ *Edit ${v.hook}:* ${buildSignedActionUrl(PUBLIC_BASE, entry.id, 'edit')}`)
        cardSections.push(`❌ *Kill ${v.hook}:* ${buildSignedActionUrl(PUBLIC_BASE, entry.id, 'kill')}`)
        cardSections.push('')
      }
      const card = cardSections.join('\n').slice(0, 6000)
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, card).catch(e => console.warn('[cliq card]', e.message))
      out.push({ day: slot.day, type: slot.type, variant_ids: variantIds, scheduled_for: scheduledFor.toISOString() })
    }

    res.json({ ok: true, slots: out })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Compute the next weekday at 13:30 UTC (6:30am PT) for a given Mon-Fri label.
function nextScheduledFor(day) {
  const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 }
  const target = dayMap[day]
  if (!target) return new Date(Date.now() + 24 * 3600000)
  const now = new Date()
  const todayUtc = now.getUTCDay() // 0=Sun..6=Sat
  let daysAhead = (target - todayUtc + 7) % 7
  if (daysAhead === 0) daysAhead = 7   // schedule for next week if same day
  const result = new Date(now)
  result.setUTCDate(now.getUTCDate() + daysAhead)
  result.setUTCHours(13, 30, 0, 0)
  return result
}

// ─── AUTO-PUBLISH SCHEDULER ─────────────────────────────────────────────────
// Runs every 15 minutes. For every approved draft whose scheduled_for falls
// within the next 15 min (or past-due), publishes to the target channel and
// marks the draft "published". Currently supports linkedin_personal; FB/IG
// reuse the existing brew metaPosting wrappers and can be added later.
//
//   GET /api/capture-calc/scheduler/run?secret=...   → idempotent, safe to retry
//   GET /api/capture-calc/scheduler/run?dry=1        → log what would publish
captureCalcRouter.get('/scheduler/run', requireCronSecretFlex, async (req, res) => {
  const dry = req.query.dry === '1' || req.query.dry === 'true'
  const out = []
  try {
    const segment = getSegment(req)
    const list = await listQueue(segment, { status: 'approved' })
    const now = Date.now()
    const window = 15 * 60 * 1000
    for (const draft of list) {
      const sched = draft.scheduled_for ? new Date(draft.scheduled_for).getTime() : 0
      if (!sched) continue
      // Past-due OR within next 15 min
      if (sched > now + window) continue

      if (dry) { out.push({ id: draft.id, channel: draft.channel, dry: true }); continue }

      if (draft.channel === 'linkedin_personal') {
        try {
          const r = await postToLinkedIn({ text: draft.body })
          if (r?.ok && r.id) {
            await updateDraft(segment, draft.id, { status: 'published', published_at: new Date().toISOString(), platform_id: r.id })
            out.push({ id: draft.id, channel: draft.channel, ok: true, platform_id: r.id })
            await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `✅ Published to LinkedIn: ${draft.headline || draft.body.slice(0, 60)}\n${PUBLIC_BASE}/.../${r.id}`).catch(() => {})
          } else {
            await updateDraft(segment, draft.id, { status: 'publish_failed', error: r?.error || 'unknown' })
            out.push({ id: draft.id, channel: draft.channel, ok: false, error: r?.error })
          }
        } catch (e) {
          await updateDraft(segment, draft.id, { status: 'publish_failed', error: e.message })
          out.push({ id: draft.id, channel: draft.channel, ok: false, error: e.message })
        }
      } else {
        out.push({ id: draft.id, channel: draft.channel, ok: false, error: 'unsupported channel' })
      }
    }
    res.json({ ok: true, dry, processed: out.length, results: out })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, partial: out })
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
