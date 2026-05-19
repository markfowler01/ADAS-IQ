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
import { collectForDraft, applyKillRules } from '../services/engagementCollector.js'
import { generateCaptureImage, captureImagesEnabled, captureImageConfig, checkBudget, getAuditLog, getPerBatchLimit } from '../services/captureImage.js'
import { postImageToLinkedIn } from '../services/brewLinkedIn.js'
import { generateLeaveBehindPdf } from '../services/leaveBehindPdf.js'
import { scoreDraft, measureDraft, loadFingerprint, updateFingerprint, categoryTrust } from '../services/voiceScorer.js'
import { enqueueDraft, listQueue, getDraft, updateDraft, verifySignedAction, formatApprovalCard, buildSignedActionUrl, getDraftFullBody, setDraftBody } from '../services/captureApprovalQueue.js'
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
// v3.1 inputs: calibrationsPerMonth + listPrice (default $450 from cost-list xlsx).
// Tier auto-derives from monthly volume (15/20/25% at 1-14 / 15-29 / 30+).
captureCalcRouter.post('/generate', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim()
    if (rateLimited(ip)) {
      return res.status(429).json({ ok: false, error: 'Too many requests. Try again in an hour, or text 1-844-349-2327.' })
    }

    const body = req.body || {}
    const contactName = String(body.contactName || '').trim().slice(0, 80)
    const email = String(body.email || '').trim().toLowerCase().slice(0, 180)
    const shopName = String(body.shopName || '').trim().slice(0, 120)
    const phone = String(body.phone || '').trim().slice(0, 30)
    const calibrationsPerMonth = Number(String(body.calibrationsPerMonth || '').replace(/[^0-9.]/g, ''))
    // listPrice optional — defaults to $450 (canonical static cal list price)
    const listPriceRaw = String(body.listPrice || '').replace(/[^0-9.]/g, '')
    const listPrice = listPriceRaw ? Number(listPriceRaw) : 450

    if (!contactName) return res.status(400).json({ ok: false, error: 'Your name is required' })
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, error: 'Valid email required' })
    if (!shopName) return res.status(400).json({ ok: false, error: 'Shop name is required' })
    if (!Number.isFinite(calibrationsPerMonth) || calibrationsPerMonth <= 0) {
      return res.status(400).json({ ok: false, error: 'Tell us roughly how many calibrations per month you sublet' })
    }
    if (!Number.isFinite(listPrice) || listPrice <= 0 || listPrice > 2000) {
      return res.status(400).json({ ok: false, error: 'List price must be a positive number under $2,000' })
    }

    const calc = computeCaptureNumbers({ calibrationsPerMonth, listPrice })

    recordSubmission(req, {
      contactName, email, shopName, phone, calibrationsPerMonth, listPrice, ip,
      tier: calc.tier, tierDiscountPct: calc.tierDiscountPct,
      monthlyMargin: calc.monthlyMargin, annualMargin: calc.annualMargin,
    }).catch(() => {})

    let pdfBuf = null
    try {
      pdfBuf = await generateCaptureReportPdf({
        shopName, contactName, calibrationsPerMonth, listPrice, calc,
      })
    } catch (e) {
      console.warn('[capture-calc pdf]', e.message)
    }

    const subject = `${shopName} — your partnership margin is ${fmtCurrency(calc.annualMargin)} / year`
    const html = renderResultEmail({ contactName, shopName, calc })
    const text = renderResultText({ contactName, shopName, calc })

    sendBroadcast({
      recipients: [email], subject, html, text,
      attachments: pdfBuf ? [{ filename: `${shopName.replace(/[^a-z0-9]/gi, '_')}_Partnership_Discount_Report.pdf`, content: pdfBuf.toString('base64') }] : undefined,
    }).catch(e => console.warn('[capture-calc email]', e.message))

    syncNewsletterSubscriberToCrm({ email, shop: shopName, name: contactName, source: 'capture_calculator' })
      .catch(e => console.warn('[capture-calc crm]', e.message))

    const cliqMsg = [
      '💰 NEW PARTNERSHIP CALC LEAD',
      '',
      `Shop: ${shopName}`,
      `Contact: ${contactName}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : '',
      '',
      `Inputs: ${calibrationsPerMonth} cals/mo × ${fmtCurrency(listPrice)} list = ${calc.tierLabel} tier (${calc.tierDiscountPct}% off)`,
      `Their margin: ${fmtCurrency(calc.monthlyMargin)}/mo · ${fmtCurrency(calc.annualMargin)}/yr`,
      `At Volume tier (15+/mo): ${fmtCurrency(calc.annualAtVolume)}/yr`,
      `At Preferred (30+/mo): ${fmtCurrency(calc.annualAtPreferred)}/yr`,
      '',
      'PDF emailed. Follow up within 24 hrs to book the Partnership Audit.',
    ].filter(Boolean).join('\n').slice(0, 2000)
    postToCliqUser(TECH_CLIQ_IDS.Mark, cliqMsg).catch(e => console.warn('[capture-calc cliq]', e.message))

    res.json({
      ok: true,
      shopName,
      tier: calc.tier,
      tierLabel: calc.tierLabel,
      tierDiscountPct: calc.tierDiscountPct,
      marginPerCal: calc.marginPerCal,
      partnerPrice: calc.partnerPrice,
      monthlyMargin: calc.monthlyMargin,
      annualMargin: calc.annualMargin,
      annualAtStandard: calc.annualAtStandard,
      annualAtVolume: calc.annualAtVolume,
      annualAtPreferred: calc.annualAtPreferred,
      pdfDelivered: Boolean(pdfBuf),
    })
  } catch (e) {
    console.error('[capture-calc generate]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ─── Email rendering ────────────────────────────────────────────────────────
function renderResultEmail({ contactName, shopName, calc }) {
  const ladder = [
    ['Standard (1-14 cals/mo)',      '15% off list', calc.annualAtStandard,  calc.tier === 'standard'],
    ['Volume (15-29 cals/mo)',       '20% off list', calc.annualAtVolume,    calc.tier === 'volume'],
    ['Preferred Partner (30+/mo)',   '25% off list', calc.annualAtPreferred, calc.tier === 'preferred'],
  ].map(([label, disc, amt, cur]) =>
    `<tr><td style="padding:10px 14px;font-size:13px;color:${cur ? '#CD4419' : '#374151'};font-weight:${cur ? 700 : 500};background:${cur ? '#fef7ed' : '#fff'};border:1px solid ${cur ? '#fdba74' : '#e5e7eb'};border-radius:6px">${esc(label)}<br><span style="font-size:11px;color:#6b7280;font-weight:500">${esc(disc)}</span></td><td style="padding:10px 14px;font-size:15px;color:${cur ? '#CD4419' : '#1a1a1a'};font-weight:700;text-align:right;background:${cur ? '#fef7ed' : '#fff'};border:1px solid ${cur ? '#fdba74' : '#e5e7eb'};border-radius:6px">${fmtCurrency(amt)}/yr</td></tr><tr><td colspan="2" style="height:6px"></td></tr>`
  ).join('')

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f3f0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3f0"><tr><td align="center" style="padding:32px 16px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-radius:14px;border-top:4px solid #CD4419">
<tr><td style="padding:32px 28px">
  <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:800;letter-spacing:.18em;color:#CD4419;text-transform:uppercase;margin-bottom:6px">Partnership Discount Report</div>
  <h1 style="font-size:24px;margin:0 0 6px;font-weight:800;line-height:1.2;color:#0d0d0d">${esc(shopName)}'s margin on calibrations</h1>
  <p style="font-size:14px;color:#6b7280;margin:0 0 22px">Personalized for ${esc(contactName)}. Full PDF attached.</p>

  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:22px 22px;margin-bottom:22px">
    <div style="font-size:10px;font-weight:800;letter-spacing:.18em;color:#15803d;text-transform:uppercase;margin-bottom:6px">Your partnership margin</div>
    <div style="font-size:42px;font-weight:800;color:#16a34a;line-height:1">${fmtCurrency(calc.annualMargin)}<span style="font-size:18px;color:#374151;font-weight:600">/year</span></div>
    <div style="font-size:14px;color:#374151;margin-top:10px;line-height:1.5">That's <strong>${fmtCurrency(calc.monthlyMargin)} every month</strong>, earned automatically on calibrations you're already billing insurance for at list. You're at the <strong>${esc(calc.tierLabel)}</strong> tier (${calc.tierDiscountPct}% off list).</div>
  </div>

  <p style="font-size:15px;line-height:1.55;margin:0 0 14px;color:#1a1a1a">${esc(contactName)},</p>
  <p style="font-size:15px;line-height:1.55;margin:0 0 14px;color:#1a1a1a">Most mobile calibration vendors show up at your bay, use your power and parking, charge full list, send the invoice, and leave. The standard sublet playbook. They keep 100% of the margin on a job your facility helped make possible.</p>
  <p style="font-size:15px;line-height:1.55;margin:0 0 18px;color:#1a1a1a">We do it differently. <strong>The Partnership Discount Model</strong> means every invoice from Absolute ADAS shows a 15-25% partner discount off list. You bill insurance at list (insurance-approved — we're a preferred vendor with State Farm and other major carriers). The difference between list and what you pay us is your margin. Automatic, every invoice, no paperwork.</p>

  <div style="margin:18px 0">
    <div style="font-size:12px;font-weight:700;color:#1a1a1a;letter-spacing:.04em;margin-bottom:8px">YOUR ANNUAL MARGIN AT EVERY TIER</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0">${ladder}</table>
    <p style="font-size:11px;color:#9ca3af;margin:0 0 0 2px">Tier upgrades automatically based on a rolling 90-day average. Same list price; bigger partner discount.</p>
  </div>

  <div style="background:#0d0d0d;border-radius:10px;padding:20px 22px;margin:22px 0">
    <div style="font-size:10px;font-weight:800;letter-spacing:.18em;color:#CD4419;text-transform:uppercase;margin-bottom:6px">The Partnership Guarantee</div>
    <p style="font-size:14px;line-height:1.55;color:#ffffff;margin:0;font-weight:600">If we don't deliver every calibration on-time, with full OEM documentation, AND apply your partnership discount on every single invoice for your first 90 days, we work for free until we do. AND we cut you a check for $500 to make it right.</p>
  </div>

  <p style="font-size:15px;line-height:1.55;margin:18px 0 18px;color:#1a1a1a"><strong>Next step:</strong> 15-minute Partnership Audit. We walk through how the discount lands on your specific RO workflow + answer any questions before your first trial calibration. Free, no commitment.</p>
  <p style="margin:0 0 22px"><a href="https://absoluteadas.com/audit" style="display:inline-block;background:#CD4419;color:#fff;padding:13px 26px;text-decoration:none;font-weight:800;border-radius:8px;font-size:14px">Book your Partnership Audit  →</a></p>

  <p style="font-size:13px;color:#6b7280;margin:0 0 4px">Or call me direct: <a href="tel:+18443492327" style="color:#CD4419;font-weight:700;text-decoration:none">1-844-349-2327</a></p>
  <p style="font-size:15px;line-height:1.55;margin:18px 0 0;color:#1a1a1a">— Mark Fowler<br><span style="color:#6b7280;font-size:13px">Owner, Absolute ADAS  ·  50,000+ calibrations  ·  State Farm DRP preferred vendor</span></p>
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #ececec">
  <p style="font-size:12px;color:#6b7280;margin:0">Estimate based on $${calc.listPrice} static calibration list price (canonical insurance-approved rate). Per-job pricing varies by service type — full cost list in the attached PDF.</p>
</td></tr>
</table></td></tr></table></body></html>`
}

function renderResultText({ contactName, shopName, calc }) {
  return [
    `${shopName} — Your Partnership Discount Report`,
    '',
    `${contactName},`,
    '',
    `YOUR PARTNERSHIP MARGIN: ${fmtCurrency(calc.annualMargin)}/year (${fmtCurrency(calc.monthlyMargin)}/mo) at the ${calc.tierLabel} tier (${calc.tierDiscountPct}% off list).`,
    '',
    `HOW IT WORKS: Most mobile calibration vendors charge full list and walk. The Partnership Discount Model means every Absolute ADAS invoice shows a 15-25% partner discount off list. You bill insurance at list (insurance-approved — we're a State Farm preferred vendor). The difference is your margin. Automatic, every invoice, no paperwork.`,
    '',
    `YOUR ANNUAL MARGIN AT EVERY TIER (same list price, bigger discount):`,
    `  · Standard (1-14/mo, 15% off):     ${fmtCurrency(calc.annualAtStandard)}/yr`,
    `  · Volume (15-29/mo, 20% off):      ${fmtCurrency(calc.annualAtVolume)}/yr`,
    `  · Preferred Partner (30+/mo, 25%): ${fmtCurrency(calc.annualAtPreferred)}/yr`,
    '',
    `THE PARTNERSHIP GUARANTEE: If we don't deliver every calibration on-time, with full OEM documentation, AND apply your partnership discount on every single invoice for your first 90 days, we work for free until we do. AND we cut you a $500 check to make it right.`,
    '',
    `NEXT STEP: Book a 15-minute Partnership Audit. Free, no commitment.`,
    `→ https://absoluteadas.com/audit`,
    `→ Or call: 1-844-349-2327`,
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
    const segment = getSegment(req)
    const draft = await getDraft(segment, id)
    if (!draft) return res.status(404).type('text/html').send(approvalPage({ title: 'Draft not found', message: '', color: '#dc2626' }))

    // Fetch full body for display — queue stores truncated preview.
    const fullBody = await getDraftFullBody(segment, id).catch(() => draft.body)
    const draftForView = { ...draft, body: fullBody }

    if (draft.status !== 'pending') return res.type('text/html').send(approvalPage({ title: `Already ${draft.status}`, message: 'This draft has already been acted on.', color: '#6b7280', body: fullBody }))

    if (action === 'edit') return res.type('text/html').send(editForm({ draft: draftForView, t, sig }))

    // approve / kill — show a confirm page with a one-click POST button
    return res.type('text/html').send(confirmPage({ draft: draftForView, action, t, sig }))
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
  // Full body stored at FULL_BODY_KEY; queue entry holds only metadata.
  await setDraftBody(segment, id, editedBody)
  const updated = await updateDraft(segment, id, { status: 'approved', headline: editedHeadline, was_edited: true })
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

  // Image preview block — mandatory so Mark never blind-approves a draft with
  // a bad image attached. If image_url is missing but image_status is set,
  // show the status so the failure mode is visible.
  let imageBlock = ''
  if (draft.image_url) {
    imageBlock = `<div style="margin:18px 0 20px"><div style="font-size:11px;color:#9ca3af;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">🖼️ Image that will publish with this post</div><a href="${escHtml(draft.image_url)}" target="_blank" rel="noopener"><img src="${escHtml(draft.image_url)}" alt="Generated post image" style="width:100%;max-width:560px;border-radius:10px;border:1px solid rgba(255,255,255,.08);display:block"/></a><div style="font-size:12px;color:#6b7280;margin-top:6px">Tap to view full size. If the image is wrong, hit kill instead, or regenerate via the API.</div></div>`
  } else if (draft.image_status === 'failed') {
    imageBlock = `<div style="margin:18px 0 20px;padding:14px 16px;background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.4);border-radius:10px;font-size:13px;color:#fda4af">🖼️ Image gen <strong>failed</strong> for this draft. ${draft.image_error ? `Error: ${escHtml(String(draft.image_error).slice(0, 200))}` : ''} Post will publish as text-only.</div>`
  } else if (draft.image_status === 'disabled') {
    imageBlock = `<div style="margin:18px 0 20px;padding:12px 16px;background:#1e1e1e;border-radius:8px;font-size:13px;color:#9ca3af">🖼️ Image gen was OFF when this draft was created. Post will publish as text-only.</div>`
  }

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(heading)}</title><style>body{margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;background:#0d0d0d;color:#fff;min-height:100vh;padding:24px}.wrap{max-width:640px;margin:0 auto;background:#151515;border-radius:16px;padding:28px;border-top:4px solid ${accent}}h1{font-size:24px;margin:0 0 8px;color:${accent}}.meta{font-size:12px;color:#999;margin-bottom:14px}.body{margin:14px 0 20px;padding:16px 18px;background:#0d0d0d;border-radius:10px;font-size:14px;line-height:1.55;color:#e5e7eb;white-space:pre-wrap}.btn{background:${accent};color:#fff;font-weight:800;padding:14px 24px;border:none;border-radius:9px;cursor:pointer;font-size:15px}.score{display:inline-block;padding:5px 12px;background:rgba(205,68,25,.15);color:#CD4419;font-size:12px;font-weight:700;border-radius:6px;margin-bottom:14px}</style></head><body><div class="wrap"><h1>${escHtml(heading)}</h1><div class="meta">Channel: <strong style="color:#fff">${escHtml(draft.channel)}</strong> · Category: <strong style="color:#fff">${escHtml(draft.category)}</strong></div><div class="score">Voice score: ${draft.voice_score || '—'}/100</div>${draft.headline ? `<div style="font-size:16px;font-weight:700;margin-bottom:8px">${escHtml(draft.headline)}</div>` : ''}<div class="body">${escHtml(draft.body)}</div>${imageBlock}<form method="POST" action="${postUrl}"><button class="btn" type="submit">${escHtml(btnText)}</button></form></div></body></html>`
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

// ─── WEEKLY STORY DROPBOX ───────────────────────────────────────────────────
// Mark drops his ~200-word weekly story Tuesday/Wednesday morning. The
// Sunday-night cron reads it from the cache and generates the LinkedIn batch.
//
//   POST /api/capture-calc/weekly-story (cron-secret)
//   Body: { story, caseStudy?, angle? }
//   GET  /api/capture-calc/weekly-story (cron-secret) — read current stored story
captureCalcRouter.post('/weekly-story', requireCronSecretFlex, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const segment = getSegment(req)
    const story = String(req.body?.story || '').trim()
    if (!story) return res.status(400).json({ ok: false, error: 'story is required' })
    if (story.length < 60) return res.status(400).json({ ok: false, error: 'story is too short (need at least ~60 chars to give the drafter material to work with)' })

    // Wrap in {story} object — cacheSet skips JSON encoding for raw strings
    // and cacheGet always JSON.parses on read, so raw strings round-trip badly.
    await cacheSet(segment, 'capture_weekly_story_current', { story, ts: Date.now() })
    if (req.body?.caseStudy) await cacheSet(segment, 'capture_weekly_case_study', { value: String(req.body.caseStudy).trim() })
    if (req.body?.angle) await cacheSet(segment, 'capture_weekly_angle', { value: String(req.body.angle).trim() })

    res.json({
      ok: true,
      stored_chars: story.length,
      message: 'Weekly story stored. Sunday-night LinkedIn batch cron will pick it up.',
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

captureCalcRouter.get('/weekly-story', requireCronSecretFlex, async (req, res) => {
  try {
    const segment = getSegment(req)
    const storyBlob = await cacheGet(segment, 'capture_weekly_story_current', null)
    const caseStudyBlob = await cacheGet(segment, 'capture_weekly_case_study', null)
    const angleBlob = await cacheGet(segment, 'capture_weekly_angle', null)
    res.json({
      ok: true,
      stored: Boolean(storyBlob?.story),
      story: storyBlob?.story || '',
      story_stored_at: storyBlob?.ts ? new Date(storyBlob.ts).toISOString() : null,
      caseStudy: caseStudyBlob?.value || '',
      angle: angleBlob?.value || '',
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ─── LINKEDIN 3-VARIANT BATCH (Sunday-night cron path) ──────────────────────
// Generates the week's Mon-Fri slots with 3 hook variants each, enqueues all
// 15 drafts, and posts a Cliq card per slot grouping the 3 variants for Mark.
//
//   POST /api/capture-calc/linkedin/draft-week-variants  (cron-secret)
//   Body: { story?, caseStudy?, angle? }  ← all optional; falls back to stored
//   Query: ?force=1  ← bypass the Sunday-only day gate (for manual testing)
//   Returns: { ok, slots: [{day, type, variant_ids: [3]}] }
//
// Catalyst cron UI has no "weekly" option, so cron is set to DAILY at 6pm PT
// (01:00 UTC) and the handler gates by day-of-week — no-op every day except
// Sunday Pacific. Story is read from cache key capture_weekly_story_current
// (drop via POST /api/capture-calc/weekly-story) if not provided in body.
captureCalcRouter.post('/linkedin/draft-week-variants', requireCronSecretFlex, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true'

    // Day-of-week gate: only fires on Sunday PT.
    if (!force) {
      const dayPT = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
      if (dayPT !== 'Sun') {
        return res.json({ ok: true, skipped: true, reason: `today is ${dayPT} PT, weekly LinkedIn batch only fires on Sun` })
      }
    }

    const segment = getSegment(req)

    // Story can come from body OR the stored "current week's story" cache key
    // (Mark drops a fresh one Tuesday morning via /weekly-story endpoint).
    let story = String(req.body?.story || '').trim()
    let caseStudy = String(req.body?.caseStudy || '').trim()
    let angle = String(req.body?.angle || '').trim()
    if (!story) {
      const blob = await cacheGet(segment, 'capture_weekly_story_current', null)
      story = String(blob?.story || '')
    }
    if (!caseStudy) {
      const blob = await cacheGet(segment, 'capture_weekly_case_study', null)
      caseStudy = String(blob?.value || '')
    }
    if (!angle) {
      const blob = await cacheGet(segment, 'capture_weekly_angle', null)
      angle = String(blob?.value || '')
    }

    if (!story) {
      return res.json({
        ok: true,
        skipped: true,
        reason: 'no weekly story available — drop one via POST /api/capture-calc/weekly-story before next Sun',
      })
    }

    const slots = await draftWeekVariants({ story, caseStudy, angle })
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

        // Generate image — guardrails enforced inside the service. Failure is
        // non-blocking: draft ships text-only and we tag image_status.
        let imageUrl = null
        if (captureImagesEnabled()) {
          const r = await generateCaptureImage(
            { headline: v.headline || v.body.split('\n')[0], draftId: entry.id },
            { segment }
          ).catch(e => ({ ok: false, error: e.message }))
          if (r?.ok) {
            imageUrl = r.url
            await updateDraft(segment, entry.id, { image_url: r.url, image_status: 'generated' })
          } else {
            await updateDraft(segment, entry.id, { image_status: 'failed', image_error: r?.error })
          }
        } else {
          await updateDraft(segment, entry.id, { image_status: 'disabled' })
        }

        cardSections.push(`*${v.hook.toUpperCase()}* (voice ${v.voice_score}/100):`)
        cardSections.push(v.body)
        if (imageUrl) cardSections.push(`🖼️ *Image:* ${imageUrl}`)
        cardSections.push(`👍 *Approve ${v.hook}:* ${buildSignedActionUrl(PUBLIC_BASE, entry.id, 'approve')}`)
        cardSections.push(`✏️ *Edit ${v.hook}:* ${buildSignedActionUrl(PUBLIC_BASE, entry.id, 'edit')}`)
        cardSections.push(`❌ *Kill ${v.hook}:* ${buildSignedActionUrl(PUBLIC_BASE, entry.id, 'kill')}`)
        cardSections.push('')
      }
      const card = cardSections.join('\n').slice(0, 6000)
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, card).catch(e => console.warn('[cliq card]', e.message))
      out.push({ day: slot.day, type: slot.type, variant_ids: variantIds, scheduled_for: scheduledFor.toISOString() })
    }

    // Post-batch alerts: budget warning + failure-rate warning
    if (captureImagesEnabled()) {
      const budget = await checkBudget(segment)
      const warnings = []
      if (budget.used >= budget.cap) warnings.push(`🛑 *Daily image cap hit:* ${budget.used}/${budget.cap}. New image gen blocked until midnight UTC.`)
      else if (budget.used >= Math.floor(budget.cap * 0.8)) warnings.push(`⚠️ *Image budget at ${Math.round(budget.used / budget.cap * 100)}%* (${budget.used}/${budget.cap}).`)
      if (budget.recentCount >= 5 && budget.recentFailRate >= 0.5) warnings.push(`⚠️ *Image gen fail rate ${Math.round(budget.recentFailRate * 100)}%* over last ${budget.recentCount} attempts. Check Gemini API health.`)
      if (warnings.length) {
        postToCliqChannelById(MARK_ALERT_CHANNEL_ID, warnings.join('\n')).catch(() => {})
      }
    }

    res.json({ ok: true, slots: out })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Compute the next weekday at 14:00 UTC (7:00am PT) for a given Mon-Fri label.
// Schedule at top-of-hour so it aligns with Catalyst's hourly cron tick
// (Catalyst minimum interval is 1 hour — sub-hourly schedules not allowed).
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
  result.setUTCHours(14, 0, 0, 0)  // 14:00 UTC = 7am PT (PDT)
  return result
}

// ─── IMAGE GEN — TEST + STATUS + AUDIT + REGEN ──────────────────────────────
//   GET /image/test     — generate one image, regardless of kill switch (force=true).
//                         Doesn't consume daily budget.
//   GET /image/status   — kill switch + budget + recent fail rate
//   GET /image/audit    — last 50 image gen attempts (success + failure)
//   POST /image/regen   — regenerate image for an existing draft (consumes budget)
captureCalcRouter.get('/image/test', requireCronSecretFlex, async (req, res) => {
  try {
    const headline = String(req.query.headline || 'Earn $8,100 a year on calibrations you already bill insurance for.').slice(0, 100)
    const draftId = `test-${Date.now()}`
    const r = await generateCaptureImage({ headline, draftId }, { force: true, segment: getSegment(req) })
    if (!r.ok) return res.status(500).json({ ok: false, error: r.error })
    postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🖼️ *Capture-image test*\nHeadline: _${headline}_\nPreview: ${r.url}`).catch(() => {})
    res.json({ ok: true, url: r.url, headline })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

captureCalcRouter.get('/image/status', requireCronSecretFlex, async (req, res) => {
  const cfg = captureImageConfig()
  const budget = await checkBudget(getSegment(req))
  res.json({
    ok: true,
    ...cfg,
    budget,
    note: cfg.enabled
      ? `Live. ${budget.remaining}/${budget.cap} images remaining today.`
      : 'OFF: set CAPTURE_IMAGES_ENABLED=true in Catalyst env vars to activate.',
  })
})

captureCalcRouter.get('/image/audit', requireCronSecretFlex, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50))
    const log = await getAuditLog(getSegment(req), limit)
    const ok = log.filter(a => a.ok).length
    const failed = log.length - ok
    res.json({ ok: true, count: log.length, success: ok, failed, items: log })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

captureCalcRouter.post('/image/regen', requireCronSecretFlex, express.json({ limit: '8kb' }), async (req, res) => {
  try {
    const segment = getSegment(req)
    const id = String(req.body?.id || req.query?.id || '')
    if (!id) return res.status(400).json({ ok: false, error: 'id required' })
    const draft = await getDraft(segment, id)
    if (!draft) return res.status(404).json({ ok: false, error: 'draft not found' })

    const headline = String(req.body?.headline || draft.headline || draft.body.split('\n')[0]).slice(0, 100)
    // Regen consumes daily budget. Hit the kill switch only if explicitly off.
    if (!captureImagesEnabled() && !req.body?.force) {
      return res.status(409).json({ ok: false, error: 'image gen kill switch is off (set CAPTURE_IMAGES_ENABLED=true or pass force=true)' })
    }
    const r = await generateCaptureImage({ headline, draftId: id }, { segment, force: Boolean(req.body?.force) })
    if (!r.ok) {
      await updateDraft(segment, id, { image_status: 'regen_failed', image_error: r.error })
      return res.status(500).json({ ok: false, error: r.error, budget: r.budget })
    }
    await updateDraft(segment, id, { image_url: r.url, image_status: 'regenerated' })
    res.json({ ok: true, id, url: r.url, budget: r.budget })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ─── ENGAGEMENT COLLECTOR (cron, hourly) ────────────────────────────────────
// Pulls post performance metrics for every published draft, updates engagement
// blob per draft, applies kill rules from the brief, and marks failing
// variants as "killed_by_engagement" so they stop influencing the fingerprint.
//
//   GET /api/capture-calc/engagement/run  (cron-secret)
captureCalcRouter.get('/engagement/run', requireCronSecretFlex, async (req, res) => {
  const out = []
  try {
    const segment = getSegment(req)
    const published = await listQueue(segment, { status: 'published' })
    for (const draft of published) {
      // Skip stale (>30 days) — we won't get new analytics value
      const ageMs = Date.now() - new Date(draft.published_at || draft.created_at).getTime()
      if (ageMs > 30 * 86400000) continue

      const engagement = await collectForDraft(draft)
      if (!engagement) { out.push({ id: draft.id, channel: draft.channel, skipped: 'no_data' }); continue }

      // Apply kill rules
      const killCheck = applyKillRules({ ...draft, engagement })
      const patch = { engagement }
      if (killCheck.kill) {
        patch.status = 'killed_by_engagement'
        patch.kill_reason = killCheck.reason
      }
      await updateDraft(segment, draft.id, patch)
      out.push({ id: draft.id, channel: draft.channel, killed: !!killCheck.kill, reason: killCheck.reason })
    }
    res.json({ ok: true, processed: out.length, results: out })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, partial: out })
  }
})

// ─── FRIDAY WEEKLY REPORT ───────────────────────────────────────────────────
// Per the brief: Friday 6am PT Cliq message to Mark summarizing the week.
// Posts to MARK_ALERT_CHANNEL_ID.
//
// Catalyst cron UI doesn't have a "weekly" option (only hourly/daily/monthly/
// yearly). So the cron is set to DAILY at 6am PT and we gate by day-of-week
// here. The handler is a no-op every day except Friday Pacific.
//   ?force=1 bypasses the day gate (for manual testing).
captureCalcRouter.get('/report/weekly', requireCronSecretFlex, async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true'
    if (!force) {
      // Day-of-week gate: only run on Fridays (Pacific time).
      const dayPT = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
      if (dayPT !== 'Fri') {
        return res.json({ ok: true, skipped: true, reason: `today is ${dayPT} PT, weekly report only fires on Fri` })
      }
    }
    const segment = getSegment(req)
    const sevenDaysAgo = Date.now() - 7 * 86400000

    // Approval queue stats
    const queue = await listQueue(segment)
    const weekItems = queue.filter(d => new Date(d.created_at).getTime() >= sevenDaysAgo)
    const counts = {
      drafted:    weekItems.length,
      approved:   weekItems.filter(d => d.status === 'approved' || d.status === 'published').length,
      killed:     weekItems.filter(d => d.status === 'killed').length,
      published:  weekItems.filter(d => d.status === 'published').length,
      pending:    weekItems.filter(d => d.status === 'pending').length,
      edited:     weekItems.filter(d => d.was_edited).length,
    }
    const approvalRate = counts.drafted ? Math.round((counts.approved / counts.drafted) * 100) : 0

    // Voice trend
    const fp = await loadFingerprint(segment)
    const trustLines = Object.entries(fp.approvals_by_category || {})
      .filter(([, c]) => (c.up + c.down) > 0)
      .map(([cat, c]) => {
        const total = c.up + c.down
        const pct = total ? Math.round((c.up / total) * 100) : 0
        return `  · ${cat.padEnd(12)} ${pct}% approval (${c.up}/${total})`
      }).join('\n') || '  · (no signals yet)'

    // Top + bottom posts by voice score
    const published = queue.filter(d => d.status === 'published')
    const byScore = [...published].sort((a, b) => (b.voice_score || 0) - (a.voice_score || 0))
    const top3 = byScore.slice(0, 3).map(d => `  · ${d.voice_score}/100 · ${(d.headline || d.body || '').slice(0, 70)}`).join('\n') || '  · (none yet)'
    const bottom3 = byScore.slice(-3).reverse().map(d => `  · ${d.voice_score}/100 · ${(d.headline || d.body || '').slice(0, 70)}`).join('\n') || '  · (none yet)'

    // Calculator opt-ins this week
    const subs = (await cacheGet(segment, 'capture_calc_submissions', [])) || []
    const weekSubs = subs.filter(s => new Date(s.at).getTime() >= sevenDaysAgo)
    const totalLeak = weekSubs.reduce((acc, s) => acc + (Number(s.annualLeak) || 0), 0)

    // Killed posts this week (with reasons-ish)
    const killedRecent = weekItems.filter(d => d.status === 'killed').slice(0, 5)
    const killedLines = killedRecent.map(d => `  · ${d.channel}: ${(d.headline || d.body || '').slice(0, 70)}`).join('\n') || '  · (none)'

    const msg = [
      `📊 *CAPTURE WEEKLY REPORT*  ·  ${new Date().toISOString().slice(0, 10)}`,
      ``,
      `*Drafts this week*`,
      `  · Drafted: ${counts.drafted}`,
      `  · Approved: ${counts.approved}  (${approvalRate}%)`,
      `  · Killed: ${counts.killed}`,
      `  · Edited by Mark: ${counts.edited}`,
      `  · Published: ${counts.published}`,
      `  · Pending approval: ${counts.pending}`,
      ``,
      `*Voice approval rate by category*`,
      trustLines,
      ``,
      `*Top 3 published (by voice score)*`,
      top3,
      ``,
      `*Bottom 3 published*`,
      bottom3,
      ``,
      `*Recently killed*`,
      killedLines,
      ``,
      `*Capture Calculator opt-ins this week*: ${weekSubs.length}`,
      weekSubs.length ? `  · Total annual leak shown to leads: $${Math.round(totalLeak).toLocaleString('en-US')}` : '',
      ``,
      `_Engagement metrics (impressions/clicks) will appear once the engagement collector is wired._`,
    ].filter(Boolean).join('\n').slice(0, 6000)

    if (req.query.dry === '1') {
      res.set('Content-Type', 'text/plain').send(msg)
      return
    }

    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg).catch(e => console.warn('[weekly report cliq]', e.message))
    res.json({ ok: true, length: msg.length, counts })
  } catch (e) {
    console.error('[capture-calc weekly]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

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
    // Catalyst's minimum cron interval is 1 hour. Pickup window matches:
    // a draft whose scheduled_for is within the next 60 min (or in the past)
    // is fair game. Combined with a top-of-hour scheduled_for, posts publish
    // within minutes of their intended time.
    const window = 60 * 60 * 1000   // 60 min forward window
    const staleCutoff = 24 * 3600000 // don't publish drafts >24h past-due
    for (const draft of list) {
      const sched = draft.scheduled_for ? new Date(draft.scheduled_for).getTime() : 0
      if (!sched) continue
      // Future beyond the cron window — wait for next tick
      if (sched > now + window) continue
      // Way past-due (>24h) — likely orphaned, mark stale instead of posting
      if (now - sched > staleCutoff) {
        if (!dry) await updateDraft(segment, draft.id, { status: 'stale', stale_reason: `${Math.round((now - sched) / 3600000)}h past scheduled_for` })
        out.push({ id: draft.id, channel: draft.channel, stale: true, hours_late: Math.round((now - sched) / 3600000) })
        continue
      }

      if (dry) { out.push({ id: draft.id, channel: draft.channel, dry: true }); continue }

      if (draft.channel === 'linkedin_personal') {
        try {
          // Queue stores a truncated preview body; fetch the publish-ready
          // full version from the per-draft cache key. Falls back to queue
          // body if the full version isn't found.
          const publishBody = await getDraftFullBody(segment, draft.id).catch(() => draft.body)
          // Use image-post path when an image was attached at draft time;
          // fall back to text-only if image gen failed or was disabled.
          const r = draft.image_url
            ? await postImageToLinkedIn({ imageUrl: draft.image_url, text: publishBody })
            : await postToLinkedIn({ text: publishBody })
          if (r?.ok && r.id) {
            await updateDraft(segment, draft.id, { status: 'published', published_at: new Date().toISOString(), platform_id: r.id, posted_with_image: Boolean(draft.image_url) })
            out.push({ id: draft.id, channel: draft.channel, ok: true, platform_id: r.id, with_image: Boolean(draft.image_url) })
            const imgNote = draft.image_url ? ' (with image)' : ''
            await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `✅ Published to LinkedIn${imgNote}: ${draft.headline || draft.body.slice(0, 60)}`).catch(() => {})
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
