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
import { draftMetaWeek, draftMetaDay, draftMetaSlot, FB_SLOTS, IG_SLOTS } from '../services/metaDrafter.js'
import { postToFacebookPage, postToInstagram, facebookConfigured, instagramConfigured } from '../services/metaPosting.js'
import { postPhotoToTikTok, tiktokConfigured } from '../services/tikTokPosting.js'
import { imageToShortVideo, cloudinaryConfigured } from '../services/cloudinaryVideo.js'
import { postShortToYouTube, youtubeConfigured } from '../services/youtubePosting.js'
import { generateWeeklyStory } from '../services/captureStoryGenerator.js'
import { postToLinkedIn } from '../services/brewLinkedIn.js'
import { collectForDraft, applyKillRules } from '../services/engagementCollector.js'
import { generateCaptureImage, captureImagesEnabled, captureImageConfig, checkBudget, getAuditLog, getPerBatchLimit } from '../services/captureImage.js'
import { postImageToLinkedIn } from '../services/brewLinkedIn.js'
import { generateLeaveBehindPdf } from '../services/leaveBehindPdf.js'
import { scoreDraft, measureDraft, loadFingerprint, updateFingerprint, categoryTrust } from '../services/voiceScorer.js'
import { enqueueDraft, listQueue, getDraft, updateDraft, verifySignedAction, formatApprovalCard, buildSignedActionUrl, getDraftFullBody, setDraftBody, resetQueue } from '../services/captureApprovalQueue.js'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID, cliqUrlButton } from '../services/cliq.js'
import { heartbeatAttempt, stampSuccess, readAllHeartbeats, reportCronFailure } from '../services/cronHeartbeat.js'
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

    const subject = `${shopName}: your partnership margin is ${fmtCurrency(calc.annualMargin)} / year`
    const html = renderResultEmail({ contactName, shopName, calc })
    const text = renderResultText({ contactName, shopName, calc })

    sendBroadcast({
      recipients: [email], subject, html, text,
      attachments: pdfBuf ? [{ filename: `${shopName.replace(/[^a-z0-9]/gi, '_')}_Partnership_Discount_Report.pdf`, content: pdfBuf.toString('base64') }] : undefined,
      fromEmail: CAPTURE_FROM_EMAIL, fromName: CAPTURE_FROM_NAME,
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

    // Email Mark with the lead details so it lives in his inbox + CRM, not just Cliq
    const markEmailHtml = `<!doctype html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px;background:#fff">
<h2 style="color:#CD4419;font-size:22px;margin:0 0 16px">💰 New Partnership Calc Lead</h2>
<table cellpadding="8" style="font-size:15px;line-height:1.55;border-collapse:collapse;width:100%">
  <tr><td style="color:#6b7280;border-bottom:1px solid #ececec"><strong>Shop:</strong></td><td style="border-bottom:1px solid #ececec">${esc(shopName)}</td></tr>
  <tr><td style="color:#6b7280;border-bottom:1px solid #ececec"><strong>Contact:</strong></td><td style="border-bottom:1px solid #ececec">${esc(contactName)}</td></tr>
  <tr><td style="color:#6b7280;border-bottom:1px solid #ececec"><strong>Email:</strong></td><td style="border-bottom:1px solid #ececec"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
  ${phone ? `<tr><td style="color:#6b7280;border-bottom:1px solid #ececec"><strong>Phone:</strong></td><td style="border-bottom:1px solid #ececec"><a href="tel:${esc(phone)}">${esc(phone)}</a></td></tr>` : ''}
  <tr><td style="color:#6b7280;border-bottom:1px solid #ececec"><strong>Inputs:</strong></td><td style="border-bottom:1px solid #ececec">${calibrationsPerMonth} cals/mo × ${fmtCurrency(listPrice)} list</td></tr>
  <tr><td style="color:#6b7280;border-bottom:1px solid #ececec"><strong>Tier:</strong></td><td style="border-bottom:1px solid #ececec">${esc(calc.tierLabel)} (${calc.tierDiscountPct}% off list)</td></tr>
  <tr><td style="color:#6b7280;border-bottom:1px solid #ececec"><strong>Their margin:</strong></td><td style="border-bottom:1px solid #ececec"><strong>${fmtCurrency(calc.monthlyMargin)}/mo · ${fmtCurrency(calc.annualMargin)}/yr</strong></td></tr>
  <tr><td style="color:#6b7280;border-bottom:1px solid #ececec"><strong>At Volume (15+):</strong></td><td style="border-bottom:1px solid #ececec">${fmtCurrency(calc.annualAtVolume)}/yr</td></tr>
  <tr><td style="color:#6b7280;border-bottom:1px solid #ececec"><strong>At Preferred (30+):</strong></td><td style="border-bottom:1px solid #ececec">${fmtCurrency(calc.annualAtPreferred)}/yr</td></tr>
</table>
<p style="font-size:13px;color:#6b7280;margin-top:18px">PDF emailed to lead. Follow up within 24 hrs to book the Partnership Audit. Submitted ${new Date().toISOString()}.</p>
</body></html>`
    sendBroadcast({
      recipients: ['mf@absoluteadas.com'],
      subject: `💰 New calc lead: ${shopName} (${fmtCurrency(calc.annualMargin)}/yr)`,
      html: markEmailHtml,
      text: cliqMsg,
      fromEmail: 'mf@absoluteadas.com',
      fromName: 'Absolute ADAS',
    }).catch(e => console.warn('[capture-calc email-mark]', e.message))

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
  <p style="margin:0 0 22px"><a href="https://absoluteadas.com/partnership-audit" style="display:inline-block;background:#CD4419;color:#fff;padding:13px 26px;text-decoration:none;font-weight:800;border-radius:8px;font-size:14px">Book your Partnership Audit  →</a></p>

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
    `→ https://absoluteadas.com/partnership-audit`,
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

// Cron heartbeat: helpers live in services/cronHeartbeat.js so the cron-monitor
// route can stamp the same keys. See that file for the rationale.

// Flush all stored Calculator submissions. Used when clearing test data
// so the nurture cron doesn't loop through pre-launch test opt-ins.
captureCalcRouter.post('/submissions/reset', requireCronSecretFlex, async (req, res) => {
  try {
    const seg = getSegment(req)
    await cacheSet(seg, SUBMISSIONS_KEY, [])
    res.json({ ok: true, message: 'submissions cleared' })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

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
// .all() — accept GET or POST so the cron works regardless of how the
// Catalyst cron's HTTP method is configured (a POST-vs-GET mismatch 404s
// every run, which is what got capture_nurture auto-disabled).
captureCalcRouter.all('/nurture/run', heartbeatAttempt('capture_nurture'), requireCronSecretFlex, async (req, res) => {
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
        fromEmail: CAPTURE_FROM_EMAIL, fromName: CAPTURE_FROM_NAME,
      })
      const ok = r.status === 'sent' || r.status === 'partial'
      if (ok) {
        list[i] = { ...sub, nurture_sent: [...sent, day] }
        mutated = true
      }
      out.push({ email: sub.email, shop: sub.shopName, day, subject: email.subject, ok, status: r.status })
    }

    if (mutated) await cacheSet(seg, SUBMISSIONS_KEY, list)
    if (!dry) await stampSuccess(req, 'capture_nurture', { processed: out.length })
    res.json({ ok: true, dry, processed: out.length, results: out })
  } catch (e) {
    await reportCronFailure(req, 'capture_nurture', e)
    res.json({ ok: false, error: e.message, partialResults: out })
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

    const r = await sendBroadcast({ recipients: [to], subject: email.subject, html: email.html, text: email.text, fromEmail: CAPTURE_FROM_EMAIL, fromName: CAPTURE_FROM_NAME })
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
    const r = await sendBroadcast({ recipients: [to], subject: email.subject, html: email.html, text: email.text, fromEmail: CAPTURE_FROM_EMAIL, fromName: CAPTURE_FROM_NAME })
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

// Capture acquisition campaign emails go from Mark personally — separate from
// the brew newsletter sender (brew@absoluteadas.com). Newsletter stays locked.
const CAPTURE_FROM_EMAIL = 'mf@absoluteadas.com'
const CAPTURE_FROM_NAME  = 'Mark Fowler'

captureCalcRouter.post('/approval/enqueue', requireCronSecretFlex, express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const entry = await enqueueDraft(req, req.body || {})
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
    const deleted = await resetQueue(req)
    res.json({ ok: true, message: `queue cleared (${deleted} drafts deleted)` })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

captureCalcRouter.get('/approval/queue', requireCronSecretFlex, async (req, res) => {
  try {
    const status = req.query.status || undefined
    const list = await listQueue(req, { status })
    res.json({ ok: true, count: list.length, items: list })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// TEMP DEBUG — unauthenticated diagnostic endpoint. REMOVE after Sunday-batch
// outage is diagnosed (added 2026-05-26). Returns queue state, recent-draft
// summary, env-var presence (booleans only — no values), and current PT day.
captureCalcRouter.get('/debug/state', async (req, res) => {
  const out = { ok: true, generated_at: new Date().toISOString() }
  try {
    out.now_pt = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    out.day_pt = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
  } catch (e) { out.day_pt_error = e.message }

  out.env_present = {
    BREW_CRON_SECRET:        Boolean(process.env.BREW_CRON_SECRET),
    ANTHROPIC_API_KEY:       Boolean(process.env.ANTHROPIC_API_KEY),
    GEMINI_API_KEY:          Boolean(process.env.GEMINI_API_KEY),
    FB_PAGE_ID:              Boolean(process.env.FB_PAGE_ID),
    FB_PAGE_ACCESS_TOKEN:    Boolean(process.env.FB_PAGE_ACCESS_TOKEN),
    IG_BUSINESS_USER_ID:     Boolean(process.env.IG_BUSINESS_USER_ID),
    LINKEDIN_REFRESH_TOKEN:  Boolean(process.env.LINKEDIN_REFRESH_TOKEN),
    LINKEDIN_ACCESS_TOKEN:   Boolean(process.env.LINKEDIN_ACCESS_TOKEN),
    LINKEDIN_CLIENT_ID:      Boolean(process.env.LINKEDIN_CLIENT_ID),
    LINKEDIN_USER_URN:       Boolean(process.env.LINKEDIN_USER_URN),
    YOUTUBE_REFRESH_TOKEN:   Boolean(process.env.YOUTUBE_REFRESH_TOKEN),
    CLOUDINARY_URL:          Boolean(process.env.CLOUDINARY_URL),
    TIKTOK_CLIENT_KEY:       Boolean(process.env.TIKTOK_CLIENT_KEY),
    TIKTOK_REFRESH_TOKEN:    Boolean(process.env.TIKTOK_REFRESH_TOKEN),
    ZOHO_CLIQ_REFRESH_TOKEN: Boolean(process.env.ZOHO_CLIQ_REFRESH_TOKEN),
    RESEND_API_KEY:          Boolean(process.env.RESEND_API_KEY),
  }

  try {
    const all = await listQueue(req, {})
    const counts = {}
    for (const d of all) counts[d.status || 'unknown'] = (counts[d.status || 'unknown'] || 0) + 1
    out.queue_counts = counts
    out.queue_total = all.length

    const cutoff = Date.now() - 14 * 86400000
    const recent = all
      .filter(d => {
        const t = d.created_at ? new Date(d.created_at).getTime() : 0
        return t >= cutoff
      })
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 60)
      .map(d => ({
        id: d.id,
        channel: d.channel,
        category: d.category,
        status: d.status,
        created_at: d.created_at,
        scheduled_for: d.scheduled_for,
        voice_score: d.voice_score,
        has_image: Boolean(d.image_url),
        has_video: Boolean(d.video_url),
        image_status: d.image_status,
        error: d.error,
        stale_reason: d.stale_reason,
      }))
    out.recent_drafts = recent
    out.recent_count = recent.length
  } catch (e) {
    out.queue_error = e.message
    out.queue_stack = (e.stack || '').split('\n').slice(0, 4).join(' | ')
  }

  res.json(out)
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
    const draft = await getDraft(req, id)
    if (!draft) return res.status(404).type('text/html').send(approvalPage({ title: 'Draft not found', message: '', color: '#dc2626' }))

    // Fetch full body for display — queue stores truncated preview.
    const fullBody = await getDraftFullBody(req, id).catch(() => draft.body)
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
    const draft = await getDraft(req, id)
    if (!draft) return res.status(404).type('text/html').send(approvalPage({ title: 'Draft not found', message: '', color: '#dc2626' }))
    if (draft.status !== 'pending') return res.type('text/html').send(approvalPage({ title: `Already ${draft.status}`, message: 'This draft has already been acted on.', color: '#6b7280' }))

    if (action === 'approve') {
      const updated = await updateDraft(req, id, { status: 'approved' })
      await updateFingerprint(segment, { category: draft.category, signal: 'up', text: draft.body }).catch(() => {})
      return res.type('text/html').send(approvalPage({ title: '✅ Approved', message: `Approved for ${updated.channel}. Will publish at the scheduled time.`, color: '#16a34a', body: draft.body }))
    }
    if (action === 'kill') {
      await updateDraft(req, id, { status: 'killed' })
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
  const draft = await getDraft(req, id)
  if (!draft) return res.status(404).type('text/html').send(approvalPage({ title: 'Draft not found', message: '', color: '#dc2626' }))
  const editedBody = String(req.body?.body || '').trim()
  if (!editedBody) return res.status(400).type('text/html').send(approvalPage({ title: 'Body required', message: '', color: '#dc2626' }))
  const editedHeadline = String(req.body?.headline || draft.headline || '').trim()
  // Full body stored at FULL_BODY_KEY; queue entry holds only metadata.
  await setDraftBody(req, id, editedBody)
  const updated = await updateDraft(req, id, { status: 'approved', headline: editedHeadline, was_edited: true })
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

// ─── PARTNERSHIP AUDIT BOOKING (public form on absoluteadas.com/partnership-audit) ───
// Lead submits the booking form → we store it, Cliq DM Mark, send Mark an
// email with the lead details, send the lead a confirmation email.
captureCalcRouter.post('/partnership-audit/submit', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim()
    if (rateLimited(ip)) {
      return res.status(429).json({ ok: false, error: 'Too many requests. Try again in an hour, or call 1-844-349-2327.' })
    }

    const body = req.body || {}
    const name = String(body.name || '').trim().slice(0, 80)
    const shop = String(body.shop || '').trim().slice(0, 120)
    const email = String(body.email || '').trim().toLowerCase().slice(0, 180)
    const phone = String(body.phone || '').trim().slice(0, 30)
    const notes = String(body.notes || '').trim().slice(0, 600)

    if (!name) return res.status(400).json({ ok: false, error: 'Name required' })
    if (!shop) return res.status(400).json({ ok: false, error: 'Shop name required' })
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, error: 'Valid email required' })

    // Persist for Mark's CRM review
    const seg = getSegment(req)
    const PA_KEY = 'partnership_audit_requests'
    const existing = (await cacheGet(seg, PA_KEY, [])) || []
    const entry = { name, shop, email, phone, notes, ip, at: new Date().toISOString() }
    await cacheSet(seg, PA_KEY, [entry, ...existing].slice(0, 200)).catch(() => {})

    // Cliq DM Mark — this is a hot lead, they explicitly asked to talk
    const cliqMsg = [
      '🤝 NEW PARTNERSHIP AUDIT REQUEST',
      '',
      `Name: ${name}`,
      `Shop: ${shop}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : '',
      '',
      notes ? `Notes: ${notes}` : '(no notes)',
      '',
      'They expect a same-day reply. Reach out via the channel they prefer.',
    ].filter(Boolean).join('\n').slice(0, 2000)
    postToCliqUser(TECH_CLIQ_IDS.Mark, cliqMsg).catch(e => console.warn('[pa-audit cliq]', e.message))

    // Email Mark with the lead details
    const markEmailHtml = `<!doctype html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px;background:#fff">
<h2 style="color:#CD4419;font-size:22px;margin:0 0 16px">🤝 New Partnership Audit Request</h2>
<table cellpadding="8" style="font-size:15px;line-height:1.55;border-collapse:collapse;width:100%">
  <tr><td style="color:#6b7280;border-bottom:1px solid #ececec"><strong>Name:</strong></td><td style="border-bottom:1px solid #ececec">${esc(name)}</td></tr>
  <tr><td style="color:#6b7280;border-bottom:1px solid #ececec"><strong>Shop:</strong></td><td style="border-bottom:1px solid #ececec">${esc(shop)}</td></tr>
  <tr><td style="color:#6b7280;border-bottom:1px solid #ececec"><strong>Email:</strong></td><td style="border-bottom:1px solid #ececec"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
  ${phone ? `<tr><td style="color:#6b7280;border-bottom:1px solid #ececec"><strong>Phone:</strong></td><td style="border-bottom:1px solid #ececec"><a href="tel:${esc(phone)}">${esc(phone)}</a></td></tr>` : ''}
  ${notes ? `<tr><td style="color:#6b7280;border-bottom:1px solid #ececec;vertical-align:top"><strong>Notes:</strong></td><td style="border-bottom:1px solid #ececec">${esc(notes)}</td></tr>` : ''}
</table>
<p style="font-size:13px;color:#6b7280;margin-top:18px">Submitted ${new Date().toISOString()}. They expect a same-day reply.</p>
</body></html>`
    sendBroadcast({
      recipients: ['mf@absoluteadas.com'],
      subject: `🤝 Partnership Audit request from ${name} (${shop})`,
      html: markEmailHtml,
      text: `New Partnership Audit request\n\nName: ${name}\nShop: ${shop}\nEmail: ${email}\n${phone ? `Phone: ${phone}\n` : ''}${notes ? `Notes: ${notes}\n` : ''}\nSubmitted ${new Date().toISOString()}`,
      fromEmail: 'mf@absoluteadas.com',
      fromName: 'Absolute ADAS',
    }).catch(e => console.warn('[pa-audit email-mark]', e.message))

    // Auto-respond to the lead so they know it landed
    const leadEmailHtml = `<!doctype html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#f5f3f0;padding:32px 16px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;border-top:4px solid #CD4419"><tr><td style="padding:28px">
<div style="font-family:monospace;font-size:11px;font-weight:800;letter-spacing:.18em;color:#CD4419;text-transform:uppercase;margin-bottom:8px">PARTNERSHIP AUDIT · REQUEST RECEIVED</div>
<h1 style="font-size:22px;margin:0 0 14px;font-weight:800">Got it, ${esc(name.split(/\s+/)[0])}.</h1>
<p style="font-size:15px;line-height:1.55;color:#1a1a1a">Thanks for booking a Partnership Audit for ${esc(shop)}. I'll reach out same-day — either to your email or to ${phone ? esc(phone) : 'a number you give me'}.</p>
<p style="font-size:15px;line-height:1.55;color:#1a1a1a">If you want to grab the slot faster, just call me: <a href="tel:+18443492327" style="color:#CD4419;font-weight:700">1-844-349-2327</a>. I pick up.</p>
<p style="font-size:15px;line-height:1.55;color:#1a1a1a;margin-top:18px">Before we talk, if you can email me your last 30-90 days of sublet calibration invoices (PDF or photos — whatever's easiest), I'll have the math ready when we get on the call. No prep required on your end if that's a hassle.</p>
<p style="font-size:15px;line-height:1.55;margin:18px 0 0;color:#1a1a1a">— Mark Fowler<br><span style="color:#6b7280;font-size:13px">Owner, Absolute ADAS · 50,000+ calibrations · State Farm DRP preferred vendor</span></p>
</td></tr></table></td></tr></table></body></html>`
    sendBroadcast({
      recipients: [email],
      subject: `Partnership Audit booked — Mark will reply same-day`,
      html: leadEmailHtml,
      text: `Got it, ${name.split(/\s+/)[0]}.\n\nThanks for booking a Partnership Audit for ${shop}. I'll reach out same-day.\n\nIf you want to grab the slot faster, just call me: 1-844-349-2327.\n\nBefore we talk, if you can email me your last 30-90 days of sublet calibration invoices, I'll have the math ready when we get on the call.\n\n— Mark Fowler\nOwner, Absolute ADAS`,
      fromEmail: 'mf@absoluteadas.com',
      fromName: 'Mark Fowler',
    }).catch(e => console.warn('[pa-audit email-lead]', e.message))

    res.json({ ok: true, message: 'Request received. Mark will reply same-day.' })
  } catch (e) {
    console.error('[pa-audit submit]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: list recent audit requests
captureCalcRouter.get('/partnership-audit/requests', requireCronSecretFlex, async (req, res) => {
  try {
    const seg = getSegment(req)
    const list = (await cacheGet(seg, 'partnership_audit_requests', [])) || []
    res.json({ ok: true, count: list.length, items: list })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

captureCalcRouter.post('/partnership-audit/reset', requireCronSecretFlex, async (req, res) => {
  try {
    const seg = getSegment(req)
    await cacheSet(seg, 'partnership_audit_requests', [])
    res.json({ ok: true, message: 'partnership audit requests cleared' })
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

// Clear the currently stored weekly story (forces auto-gen on next cron run).
captureCalcRouter.post('/weekly-story/reset', requireCronSecretFlex, async (req, res) => {
  try {
    const segment = getSegment(req)
    await cacheSet(segment, 'capture_weekly_story_current', { story: '', ts: Date.now() })
    res.json({ ok: true, message: 'stored weekly story cleared — next Sunday cron will auto-generate' })
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

// ─── INTERNAL STORY DROPBOX (web-form-friendly, password-gated) ─────────────
// Public POST endpoint Mark uses from a private web form on absoluteadas.com.
// Gated by STORY_DROPBOX_PASSWORD env var. Same backing storage as the
// cron-secret /weekly-story endpoint so Sunday cron picks up either route.
captureCalcRouter.post('/internal/story-submit', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const required = String(process.env.STORY_DROPBOX_PASSWORD || '').trim()
    if (!required) {
      return res.status(503).json({ ok: false, error: 'Dropbox not configured. Set STORY_DROPBOX_PASSWORD env var in Catalyst.' })
    }
    const provided = String(req.body?.password || '').trim()
    if (provided !== required) {
      return res.status(401).json({ ok: false, error: 'Wrong password' })
    }
    const story = String(req.body?.story || '').trim()
    if (!story) return res.status(400).json({ ok: false, error: 'Story is required' })
    if (story.length < 60) return res.status(400).json({ ok: false, error: 'Story too short (need ~60+ chars to give the drafter material to work with)' })

    const segment = getSegment(req)
    await cacheSet(segment, 'capture_weekly_story_current', { story, ts: Date.now() })
    if (req.body?.caseStudy) await cacheSet(segment, 'capture_weekly_case_study', { value: String(req.body.caseStudy).trim() })
    if (req.body?.angle) await cacheSet(segment, 'capture_weekly_angle', { value: String(req.body.angle).trim() })

    res.json({
      ok: true,
      stored_chars: story.length,
      stored_at: new Date().toISOString(),
      message: 'Story stored. Next Sunday-night cron will use it.',
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Read endpoint so the form can show "currently stored" — same password gate.
captureCalcRouter.get('/internal/story-read', async (req, res) => {
  try {
    const required = String(process.env.STORY_DROPBOX_PASSWORD || '').trim()
    if (!required) return res.status(503).json({ ok: false, error: 'Dropbox not configured' })
    const provided = String(req.query.password || '').trim()
    if (provided !== required) return res.status(401).json({ ok: false, error: 'Wrong password' })

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
captureCalcRouter.all('/linkedin/draft-week-variants', heartbeatAttempt('capture_linkedin'), requireCronSecretFlex, express.json({ limit: '32kb' }), async (req, res) => {
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

    // Fully automated mode (per Mark 2026-05-19): if no real story has
    // been dropped, auto-generate a labeled-composite one. As Mark drops
    // real stories via /weekly-story, those override the auto-gen.
    let storySource = 'dropped'
    if (!story) {
      try {
        const recentBlob = await cacheGet(segment, 'capture_story_history', null)
        const recentStories = Array.isArray(recentBlob?.stories) ? recentBlob.stories : []
        story = await generateWeeklyStory({ recentStories })
        storySource = 'auto-generated'
        // Persist into history (cap at 4 to keep next-call dedupe small)
        const nextHistory = [story, ...recentStories].slice(0, 4)
        await cacheSet(segment, 'capture_story_history', { stories: nextHistory, last_generated_at: Date.now() })
        // Post to Cliq so Mark sees what got used + can drop a real one next week
        postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
          `🤖 *Auto-generated this week's story* (you didn't drop one). Used for the 15 LinkedIn drafts.\n\n${story.slice(0, 1500)}\n\n_Drop your own next week via /weekly-story to override._`
        ).catch(() => {})
      } catch (e) {
        return res.json({
          ok: false,
          skipped: true,
          reason: `auto-gen failed (${e.message}) — drop a story via POST /api/capture-calc/weekly-story`,
        })
      }
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
        const entry = await enqueueDraft(req, {
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
            await updateDraft(req, entry.id, { image_url: r.url, image_status: 'generated' })
          } else {
            await updateDraft(req, entry.id, { image_status: 'failed', image_error: r?.error })
          }
        } else {
          await updateDraft(req, entry.id, { image_status: 'disabled' })
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

    // Clear the dropbox after a successful batch so next week starts fresh —
    // otherwise the same story would be reused. Mark's real stories dropped
    // later in the week will land in the empty slot for the next Sunday.
    await cacheSet(segment, 'capture_weekly_story_current', { story: '', ts: Date.now() }).catch(() => {})

    await stampSuccess(req, 'capture_linkedin', { slots: out.length, story_source: storySource })
    res.json({ ok: true, story_source: storySource, slots: out })
  } catch (e) {
    await reportCronFailure(req, 'capture_linkedin', e)
    res.json({ ok: false, error: e.message })
  }
})

// Compute the next weekday at 14:00 UTC (7:00am PT) for a given Mon-Fri label.
// Schedule at top-of-hour so it aligns with Catalyst's hourly cron tick
// (Catalyst minimum interval is 1 hour, sub-hourly schedules not allowed).
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

// Same as above but with a specific PT hour/minute (used for Meta slots —
// FB at 12:00pm PT, IG at 11:30am PT per master prompt v3.1 section 16).
// PDT is UTC-7; we convert by adding 7 to the desired PT hour.
// Schedule for TODAY at the given PT time. If that time has already passed
// today, schedule for now+5min so the next scheduler tick picks it up.
// Used by the daily drafter.
function todayScheduledForAtTimePT(ptHour, ptMinute = 0) {
  const now = new Date()
  const utcHour = (ptHour + 7) % 24
  const result = new Date(now)
  result.setUTCHours(utcHour, ptMinute, 0, 0)
  if (result.getTime() <= now.getTime() + 60000) {
    return new Date(now.getTime() + 5 * 60000)
  }
  return result
}

function nextScheduledForAtTimePT(day, ptHour, ptMinute = 0) {
  const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 }
  const target = dayMap[day]
  if (target === undefined) return new Date(Date.now() + 24 * 3600000)
  const now = new Date()
  const todayUtc = now.getUTCDay()
  let daysAhead = (target - todayUtc + 7) % 7
  if (daysAhead === 0) daysAhead = 7
  const result = new Date(now)
  result.setUTCDate(now.getUTCDate() + daysAhead)
  // PDT (Mar-Nov) = UTC-7, PST (Nov-Mar) = UTC-8. Using PDT for now since
  // campaign launches in May. TODO when DST rolls back: bump by +1.
  const utcHour = (ptHour + 7) % 24
  result.setUTCHours(utcHour, ptMinute, 0, 0)
  // If picking the same day this week would land in the past, push to next week
  if (daysAhead < 7 && result.getTime() < now.getTime()) {
    result.setUTCDate(result.getUTCDate() + 7)
  }
  return result
}

// Build one Meta post's Cliq card. The post is already auto-approved and
// scheduled — the card is a heads-up with two tappable buttons: ✏️ Edit to
// tweak it, ❌ Delete to pull it before it posts. Used by /meta/draft-week
// and /meta/post-pending-cards.
function buildMetaApprovalCard(draft, fullBody) {
  const channelName = draft.channel === 'facebook_page' ? '📘 FACEBOOK'
    : draft.channel === 'instagram_business' ? '📷 INSTAGRAM'
    : draft.channel === 'tiktok_business' ? '🎵 TIKTOK'
    : draft.channel === 'youtube_shorts' ? '🎬 YOUTUBE SHORT'
    : draft.channel
  const text = [
    `${channelName} · ${draft.meta?.slot || ''} · voice ${draft.voice_score}/100`,
    `✅ Scheduled to auto-post: ${draft.scheduled_for}`,
    ``,
    draft.headline ? `*${draft.headline}*` : '',
    ``,
    fullBody,
    ``,
    draft.image_url ? `🖼️ ${draft.image_url}` : '⚠️ no image',
    ``,
    `_This post is approved and will go out on schedule. Tap Delete to pull it._`,
  ].filter(Boolean).join('\n').slice(0, 6000)
  const buttons = [
    cliqUrlButton('✏️ Edit',   buildSignedActionUrl(PUBLIC_BASE, draft.id, 'edit')),
    cliqUrlButton('❌ Delete', buildSignedActionUrl(PUBLIC_BASE, draft.id, 'kill'), '-'),
  ]
  return { text, buttons }
}

// ─── META (Facebook + Instagram) WEEKLY DRAFT BATCH ──────────────────────────
// Per master prompt v3.1 section 16:
//   FB: Mon/Wed/Fri 12:00pm PT (3/week)
//   IG: Mon/Tue/Thu 11:30am PT (3/week)
//
// Fires daily; gated to Sunday PT only (mirroring the LinkedIn weekly cron).
// Uses the same weekly story dropbox as LinkedIn so one story feeds all
// channels for the week.
//
//   POST /api/capture-calc/meta/draft-week  (cron-secret)
//   Body: { story?, caseStudy? }       ← optional, falls back to stored
//   Query: ?force=1                    ← bypass Sunday-only gate (manual test)
captureCalcRouter.all('/meta/draft-week', heartbeatAttempt('capture_meta'), requireCronSecretFlex, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true'
    if (!force) {
      const dayPT = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
      if (dayPT !== 'Sun') {
        return res.json({ ok: true, skipped: true, reason: `today is ${dayPT} PT, meta weekly batch only fires on Sun` })
      }
    }

    const segment = getSegment(req)

    // Concurrent-fire lock. Catalyst's gateway times out at 30s on long
    // drafter runs, and the platform appears to auto-retry the same request
    // — which silently produced 18 drafts (9 unique × 2) on 2026-06-17.
    // This cache key blocks any second invocation within a 10-min window of
    // a still-running drafter. Bypassable via ?force_relock=1 for genuine
    // re-run intent.
    const LOCK_KEY = `meta_batch_inprogress_${new Date().toISOString().slice(0, 10)}`
    if (req.query.force_relock !== '1') {
      const existingLock = await cacheGet(segment, LOCK_KEY, null)
      if (existingLock && (Date.now() - new Date(existingLock.at).getTime()) < 600000) {
        return res.json({ ok: true, skipped: true, reason: 'concurrent draft-week already in progress (lock held)', locked_at: existingLock.at })
      }
    }
    await cacheSet(segment, LOCK_KEY, { at: new Date().toISOString() })

    let story = String(req.body?.story || '').trim()
    let caseStudy = String(req.body?.caseStudy || '').trim()
    if (!story) {
      const blob = await cacheGet(segment, 'capture_weekly_story_current', null)
      story = String(blob?.story || '')
    }
    if (!caseStudy) {
      const blob = await cacheGet(segment, 'capture_weekly_case_study', null)
      caseStudy = String(blob?.value || '')
    }

    // Reuse the same auto-gen path as LinkedIn — if no story dropped, generate one.
    let storySource = 'dropped'
    if (!story) {
      try {
        const recentBlob = await cacheGet(segment, 'capture_story_history', null)
        const recentStories = Array.isArray(recentBlob?.stories) ? recentBlob.stories : []
        story = await generateWeeklyStory({ recentStories })
        storySource = 'auto-generated'
        // Don't overwrite story_history here (LinkedIn cron handles that). Just use it.
      } catch (e) {
        return res.json({ ok: false, skipped: true, reason: `auto-gen failed (${e.message})` })
      }
    }

    const { fb, ig, tt, yt } = await draftMetaWeek({ story, caseStudy })
    const out = { fb: [], ig: [], tt: [], yt: [] }

    // ── Generate ONE image per unique post type, shared across channels ─────
    // Per Mark's 2026-05-26 image-prompt spec: the drafter outputs the image
    // prompt with the post, and all channels that share a "type" (story /
    // framework / case_study / visual_hook / mechanism / testimonial) share
    // the same image. Drops weekly image gen from ~12 → 6, keeps voice
    // coherent across IG/TT/YT versions of the same lesson.
    const draftedSlots = [...fb, ...ig, ...tt, ...yt]
    const typeToPrompt = {}
    const typeToHeadline = {}
    for (const d of draftedSlots) {
      if (d.error || !d.type) continue
      if (!typeToPrompt[d.type] && d.image_prompt) typeToPrompt[d.type] = d.image_prompt
      if (!typeToHeadline[d.type] && d.headline) typeToHeadline[d.type] = d.headline
    }
    const typeToImageUrl = {}
    const typeToImageError = {}
    const batchSlug = `meta-${new Date().toISOString().slice(0, 10)}`
    if (captureImagesEnabled()) {
      for (const [type, prompt] of Object.entries(typeToPrompt)) {
        const r = await generateCaptureImage(
          { headline: typeToHeadline[type] || type, draftId: `${batchSlug}-${type}` },
          { segment, sceneOverride: prompt }
        ).catch(e => ({ ok: false, error: e.message }))
        if (r?.ok) typeToImageUrl[type] = r.url
        else typeToImageError[type] = r?.error || 'image generation failed'
      }
    }
    // For YouTube, also pre-compute the MP4 from each type's image (one MP4
    // per type, shared by all YT drafts of that type).
    const typeToVideoUrl = {}
    const typeToVideoError = {}
    const YT_TYPES = ['visual_hook', 'mechanism', 'testimonial']
    if (cloudinaryConfigured()) {
      for (const type of YT_TYPES) {
        const imgUrl = typeToImageUrl[type]
        if (!imgUrl) continue
        const v = await imageToShortVideo({ imageUrl: imgUrl, duration: 8 }).catch(e => ({ ok: false, error: e.message }))
        if (v?.ok) typeToVideoUrl[type] = v.url
        else typeToVideoError[type] = v?.error || 'video conversion failed'
      }
    }

    // ── Facebook drafts ─────────────────────────────────────────────────────
    for (const draft of fb) {
      if (draft.error) {
        out.fb.push({ day: draft.day, error: draft.error })
        continue
      }
      const scheduledFor = nextScheduledForAtTimePT(draft.day, draft.hour, draft.minute)
      const entry = await enqueueDraft(req, {
        channel: 'facebook_page',
        category: draft.type,
        headline: draft.headline,
        body: draft.body,
        scheduled_for: scheduledFor.toISOString(),
        voice_score: draft.voice_score,
        voice_deductions: draft.voice_deductions,
        meta: { slot: draft.day, group: `meta-${scheduledFor.toISOString().slice(0,10)}`, image_prompt: draft.image_prompt || null },
        status: 'approved',   // auto-approved; Mark deletes any he doesn't want
      })
      // Image: shared per type (see typeToImageUrl above).
      const imageUrl = typeToImageUrl[draft.type] || null
      if (imageUrl) {
        await updateDraft(req, entry.id, { image_url: imageUrl, image_status: 'generated' })
      } else if (!captureImagesEnabled()) {
        await updateDraft(req, entry.id, { image_status: 'disabled' })
      } else {
        await updateDraft(req, entry.id, { image_status: 'failed', image_error: typeToImageError[draft.type] || 'no image for type' })
      }
      out.fb.push({ day: draft.day, id: entry.id, scheduled_for: scheduledFor.toISOString(), voice_score: draft.voice_score, has_image: !!imageUrl })
    }

    // ── Instagram drafts (image REQUIRED — Graph API constraint) ────────────
    for (const draft of ig) {
      if (draft.error) {
        out.ig.push({ day: draft.day, error: draft.error })
        continue
      }
      const scheduledFor = nextScheduledForAtTimePT(draft.day, draft.hour, draft.minute)
      const entry = await enqueueDraft(req, {
        channel: 'instagram_business',
        category: draft.type,
        headline: draft.headline,
        body: draft.body,
        scheduled_for: scheduledFor.toISOString(),
        voice_score: draft.voice_score,
        voice_deductions: draft.voice_deductions,
        meta: { slot: draft.day, group: `meta-${scheduledFor.toISOString().slice(0,10)}`, image_prompt: draft.image_prompt || null },
        status: 'approved',
      })
      const imageUrl = typeToImageUrl[draft.type] || null
      if (imageUrl) {
        await updateDraft(req, entry.id, { image_url: imageUrl, image_status: 'generated' })
      } else if (!captureImagesEnabled()) {
        await updateDraft(req, entry.id, { image_status: 'disabled' })
      } else {
        await updateDraft(req, entry.id, { image_status: 'failed', image_error: typeToImageError[draft.type] || 'no image for type' })
      }
      out.ig.push({ day: draft.day, id: entry.id, scheduled_for: scheduledFor.toISOString(), voice_score: draft.voice_score, has_image: !!imageUrl })
    }

    // ── TikTok drafts (image REQUIRED — TikTok photo post needs media) ──────
    for (const draft of tt) {
      if (draft.error) {
        out.tt.push({ day: draft.day, error: draft.error })
        continue
      }
      const scheduledFor = nextScheduledForAtTimePT(draft.day, draft.hour, draft.minute)
      const entry = await enqueueDraft(req, {
        channel: 'tiktok_business',
        category: draft.type,
        headline: draft.headline,
        body: draft.body,
        scheduled_for: scheduledFor.toISOString(),
        voice_score: draft.voice_score,
        voice_deductions: draft.voice_deductions,
        meta: { slot: draft.day, group: `meta-${scheduledFor.toISOString().slice(0,10)}`, image_prompt: draft.image_prompt || null },
        status: 'approved',
      })
      const imageUrl = typeToImageUrl[draft.type] || null
      if (imageUrl) {
        await updateDraft(req, entry.id, { image_url: imageUrl, image_status: 'generated' })
      } else if (!captureImagesEnabled()) {
        await updateDraft(req, entry.id, { image_status: 'disabled' })
      } else {
        await updateDraft(req, entry.id, { image_status: 'failed', image_error: typeToImageError[draft.type] || 'no image for type' })
      }
      out.tt.push({ day: draft.day, id: entry.id, scheduled_for: scheduledFor.toISOString(), voice_score: draft.voice_score, has_image: !!imageUrl })
    }

    // ── YouTube Shorts drafts (image generated, then Cloudinary → MP4) ──────
    // Video gen happens here at draft time, not publish time — Cloudinary
    // takes 5-30s and shouldn't compete with the scheduler's tight window.
    // The MP4 URL is stashed on the draft; the scheduler downloads + uploads.
    for (const draft of yt) {
      if (draft.error) {
        out.yt.push({ day: draft.day, error: draft.error })
        continue
      }
      const scheduledFor = nextScheduledForAtTimePT(draft.day, draft.hour, draft.minute)
      const entry = await enqueueDraft(req, {
        channel: 'youtube_shorts',
        category: draft.type,
        headline: draft.headline,
        body: draft.body,
        scheduled_for: scheduledFor.toISOString(),
        voice_score: draft.voice_score,
        voice_deductions: draft.voice_deductions,
        meta: { slot: draft.day, group: `meta-${scheduledFor.toISOString().slice(0,10)}`, image_prompt: draft.image_prompt || null },
        status: 'approved',
      })
      const imageUrl = typeToImageUrl[draft.type] || null
      const videoUrl = typeToVideoUrl[draft.type] || null
      if (imageUrl) {
        await updateDraft(req, entry.id, { image_url: imageUrl, image_status: 'generated' })
      } else if (!captureImagesEnabled()) {
        await updateDraft(req, entry.id, { image_status: 'disabled' })
      } else {
        await updateDraft(req, entry.id, { image_status: 'failed', image_error: typeToImageError[draft.type] || 'no image for type' })
      }
      if (videoUrl) {
        await updateDraft(req, entry.id, { video_url: videoUrl, video_status: 'generated' })
      } else if (!cloudinaryConfigured()) {
        await updateDraft(req, entry.id, { video_status: 'cloudinary_not_configured' })
      } else if (imageUrl) {
        await updateDraft(req, entry.id, { video_status: 'failed', video_error: typeToVideoError[draft.type] || 'no video for type' })
      }
      out.yt.push({ day: draft.day, id: entry.id, scheduled_for: scheduledFor.toISOString(), voice_score: draft.voice_score, has_image: !!imageUrl, has_video: !!videoUrl })
    }

    // Cliq summary card — the batch is auto-approved and scheduled. Mark only
    // acts on a card if he wants to pull or tweak a post.
    const card = [
      `📱 *SOCIAL WEEKLY BATCH SCHEDULED* (${storySource} story)`,
      `All ${out.fb.length + out.ig.length + out.tt.length} posts are auto-approved and will post on schedule.`,
      `Tap *❌ Delete* on any card below to pull it. *✏️ Edit* to tweak it.`,
      ``,
      `*Facebook* (${out.fb.length} posts, Mon/Wed/Fri 12pm PT):`,
      ...out.fb.map(d => d.error ? `  · ${d.day}: ❌ ${d.error}` : `  · ${d.day}: voice ${d.voice_score}/100 ${d.has_image ? '🖼️' : '📝'}`),
      ``,
      `*Instagram* (${out.ig.length} posts, Mon/Tue/Thu 11:30am PT):`,
      ...out.ig.map(d => d.error ? `  · ${d.day}: ❌ ${d.error}` : `  · ${d.day}: voice ${d.voice_score}/100 ${d.has_image ? '🖼️' : '⚠️ NO IMAGE'}`),
      ``,
      `*TikTok* (${out.tt.length} posts, Mon/Wed/Fri 2pm PT):`,
      ...out.tt.map(d => d.error ? `  · ${d.day}: ❌ ${d.error}` : `  · ${d.day}: voice ${d.voice_score}/100 ${d.has_image ? '🖼️' : '⚠️ NO IMAGE'}`),
      ``,
      // YouTube only shown when YOUTUBE_REFRESH_TOKEN is set (drafter gates it).
      ...(out.yt.length ? [
        `*YouTube Shorts* (${out.yt.length} posts, Tue/Thu/Sat 1pm PT):`,
        ...out.yt.map(d => d.error ? `  · ${d.day}: ❌ ${d.error}` : `  · ${d.day}: voice ${d.voice_score}/100 ${d.has_image ? '🖼️' : '⚠️ NO IMG'} ${d.has_video ? '🎬' : '⚠️ NO VIDEO'}`),
        ``,
      ] : []),
      `Cards posting below…`,
    ].join('\n')
    postToCliqChannelById(MARK_ALERT_CHANNEL_ID, card).catch(() => {})

    // Per-post cards — full body + tappable ✏️ Edit / ❌ Delete buttons.
    const allDrafts = [...out.fb, ...out.ig, ...out.tt, ...out.yt].filter(d => !d.error)
    for (const d of allDrafts) {
      const draft = await getDraft(req, d.id).catch(() => null)
      if (!draft) continue
      const fullBody = await getDraftFullBody(req, d.id).catch(() => draft.body)
      const { text, buttons } = buildMetaApprovalCard(draft, fullBody)
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, text, buttons).catch(e => console.warn('[meta cliq card]', e.message))
    }

    await stampSuccess(req, 'capture_meta', {
      fb: out.fb.length, ig: out.ig.length, tt: out.tt.length, yt: out.yt.length,
      story_source: storySource,
    })
    res.json({ ok: true, story_source: storySource, ...out })
  } catch (e) {
    await reportCronFailure(req, 'capture_meta', e)
    res.json({ ok: false, error: e.message })
  }
})

//   POST /api/capture-calc/meta/draft-day  (cron-secret)
//   Body: { story?, caseStudy? }       ← optional, falls back to stored
//   Query: ?dayName=Mon                ← override today (testing only)
//
// Daily drafter — replaces the Sunday weekly batch with a daily 3-post pass
// (1 FB + 1 IG + 1 TT for today's slot). Skips channels that already have an
// approved/published draft for today to make the cron idempotent.
captureCalcRouter.all('/meta/draft-day', heartbeatAttempt('capture_meta'), requireCronSecretFlex, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const segment = getSegment(req)
    const todayPT = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
    const dayName = String(req.query.dayName || todayPT)
    const todayDateStr = new Date().toISOString().slice(0, 10)

    // Concurrent-fire lock — Catalyst's gateway times out at 30s on long
    // drafter runs and may auto-retry. Block second invocation within 10min.
    const LOCK_KEY = `meta_daily_inprogress_${todayDateStr}`
    if (req.query.force_relock !== '1') {
      const existingLock = await cacheGet(segment, LOCK_KEY, null)
      if (existingLock && (Date.now() - new Date(existingLock.at).getTime()) < 600000) {
        return res.json({ ok: true, skipped: true, reason: 'concurrent draft-day already in progress (lock held)', locked_at: existingLock.at })
      }
    }
    await cacheSet(segment, LOCK_KEY, { at: new Date().toISOString() })

    // Idempotence — skip channels that already have a live draft for today.
    const existing = await listQueue(req, {})
    const todayLive = existing.filter(d => {
      if (!['facebook_page', 'instagram_business', 'tiktok_business', 'youtube_shorts', 'linkedin_personal'].includes(d.channel)) return false
      if (!['approved', 'pending', 'published'].includes(d.status)) return false
      const sched = (d.scheduled_for || '').slice(0, 10)
      return sched === todayDateStr
    })
    const channelsAlreadyDone = new Set(todayLive.map(d => d.channel))

    let story = String(req.body?.story || '').trim()
    let caseStudy = String(req.body?.caseStudy || '').trim()
    if (!story) {
      const blob = await cacheGet(segment, 'capture_weekly_story_current', null)
      story = String(blob?.story || '')
    }
    if (!caseStudy) {
      const blob = await cacheGet(segment, 'capture_weekly_case_study', null)
      caseStudy = String(blob?.value || '')
    }
    let storySource = 'dropped'
    if (!story) {
      try {
        const recentBlob = await cacheGet(segment, 'capture_story_history', null)
        const recentStories = Array.isArray(recentBlob?.stories) ? recentBlob.stories : []
        story = await generateWeeklyStory({ recentStories })
        storySource = 'auto-generated'
      } catch (e) {
        return res.json({ ok: false, skipped: true, reason: `auto-gen failed (${e.message})` })
      }
    }

    const { fb, ig, tt, yt, day } = await draftMetaDay({ story, caseStudy, dayName })

    // LinkedIn — 1 post per day, single hook rotation through greed/fairness/identity
    // by day of week so the angle varies across the week. Same day map as
    // linkedInDrafter.SLOT_DEFS (Mon→Sun) so type stays consistent with FB.
    const LI_HOOK_BY_DAY = { Mon: 'greed', Tue: 'fairness', Wed: 'identity', Thu: 'greed', Fri: 'fairness', Sat: 'identity', Sun: 'greed' }
    let liDraft = null
    let liError = null
    try {
      const slot = await draftSlotVariants({ day, story, caseStudy, hooks: [LI_HOOK_BY_DAY[day] || 'greed'] })
      liDraft = slot.variants?.[0] ? { ...slot.variants[0], day, type: slot.type } : null
    } catch (e) {
      liError = e.message
    }

    const out = { day, fb: [], ig: [], tt: [], yt: [], li: [], skipped: [] }

    // Shared-image-per-type (same scaffolding as draft-week).
    const draftedSlots = [...fb, ...ig, ...tt, ...yt]
    const typeToPrompt = {}
    const typeToHeadline = {}
    for (const d of draftedSlots) {
      if (d.error || !d.type) continue
      if (!typeToPrompt[d.type] && d.image_prompt) typeToPrompt[d.type] = d.image_prompt
      if (!typeToHeadline[d.type] && d.headline) typeToHeadline[d.type] = d.headline
    }
    const typeToImageUrl = {}
    const typeToImageError = {}
    const batchSlug = `metaday-${todayDateStr}`
    if (captureImagesEnabled()) {
      for (const [type, prompt] of Object.entries(typeToPrompt)) {
        const r = await generateCaptureImage(
          { headline: typeToHeadline[type] || type, draftId: `${batchSlug}-${type}` },
          { segment, sceneOverride: prompt }
        ).catch(e => ({ ok: false, error: e.message }))
        if (r?.ok) typeToImageUrl[type] = r.url
        else typeToImageError[type] = r?.error || 'image generation failed'
      }
    }
    const typeToVideoUrl = {}
    const typeToVideoError = {}
    const YT_TYPES = ['visual_hook', 'mechanism', 'testimonial']
    if (cloudinaryConfigured()) {
      for (const type of YT_TYPES) {
        const imgUrl = typeToImageUrl[type]
        if (!imgUrl) continue
        const v = await imageToShortVideo({ imageUrl: imgUrl, duration: 8 }).catch(e => ({ ok: false, error: e.message }))
        if (v?.ok) typeToVideoUrl[type] = v.url
        else typeToVideoError[type] = v?.error || 'video conversion failed'
      }
    }

    const enqueueOne = async (channelKey, draft, bucket) => {
      if (channelsAlreadyDone.has(channelKey)) {
        out.skipped.push({ channel: channelKey, reason: 'already has a live draft for today' })
        return
      }
      if (draft.error) {
        bucket.push({ day: draft.day, error: draft.error })
        return
      }
      const scheduledFor = todayScheduledForAtTimePT(draft.hour, draft.minute)
      const entry = await enqueueDraft(req, {
        channel: channelKey,
        category: draft.type,
        headline: draft.headline,
        body: draft.body,
        scheduled_for: scheduledFor.toISOString(),
        voice_score: draft.voice_score,
        voice_deductions: draft.voice_deductions,
        meta: { slot: draft.day, group: `metaday-${todayDateStr}`, image_prompt: draft.image_prompt || null },
        status: 'approved',
      })
      const imageUrl = typeToImageUrl[draft.type] || null
      if (imageUrl) {
        await updateDraft(req, entry.id, { image_url: imageUrl, image_status: 'generated' })
      } else if (!captureImagesEnabled()) {
        await updateDraft(req, entry.id, { image_status: 'disabled' })
      } else {
        await updateDraft(req, entry.id, { image_status: 'failed', image_error: typeToImageError[draft.type] || 'no image for type' })
      }
      if (channelKey === 'youtube_shorts') {
        const videoUrl = typeToVideoUrl[draft.type] || null
        if (videoUrl) {
          await updateDraft(req, entry.id, { video_url: videoUrl, video_status: 'generated' })
        } else if (!cloudinaryConfigured()) {
          await updateDraft(req, entry.id, { video_status: 'cloudinary_not_configured' })
        } else if (imageUrl) {
          await updateDraft(req, entry.id, { video_status: 'failed', video_error: typeToVideoError[draft.type] || 'no video for type' })
        }
        bucket.push({ day: draft.day, id: entry.id, scheduled_for: scheduledFor.toISOString(), voice_score: draft.voice_score, has_image: !!imageUrl, has_video: !!videoUrl })
      } else {
        bucket.push({ day: draft.day, id: entry.id, scheduled_for: scheduledFor.toISOString(), voice_score: draft.voice_score, has_image: !!imageUrl })
      }
    }

    for (const draft of fb) await enqueueOne('facebook_page',      draft, out.fb)
    for (const draft of ig) await enqueueOne('instagram_business', draft, out.ig)
    for (const draft of tt) await enqueueOne('tiktok_business',    draft, out.tt)
    for (const draft of yt) await enqueueOne('youtube_shorts',     draft, out.yt)

    // LinkedIn — schedule for 9 AM PT (16:00 UTC), reuse the type-shared image
    // (story/framework/case_study types overlap with FB so FB's image fits).
    if (channelsAlreadyDone.has('linkedin_personal')) {
      out.skipped.push({ channel: 'linkedin_personal', reason: 'already has a live draft for today' })
    } else if (liError) {
      out.li.push({ day, error: liError })
    } else if (liDraft) {
      const scheduledForLi = todayScheduledForAtTimePT(9, 0)
      const entry = await enqueueDraft(req, {
        channel: 'linkedin_personal',
        category: liDraft.type,
        headline: liDraft.headline,
        body: liDraft.body,
        scheduled_for: scheduledForLi.toISOString(),
        voice_score: liDraft.voice_score,
        voice_deductions: liDraft.voice_deductions,
        meta: { slot: day, group: `metaday-${todayDateStr}`, hook: liDraft.hook },
        status: 'approved',
      })
      const imageUrl = typeToImageUrl[liDraft.type] || null
      if (imageUrl) {
        await updateDraft(req, entry.id, { image_url: imageUrl, image_status: 'generated' })
      } else if (!captureImagesEnabled()) {
        await updateDraft(req, entry.id, { image_status: 'disabled' })
      } else {
        await updateDraft(req, entry.id, { image_status: 'failed', image_error: typeToImageError[liDraft.type] || 'no image for type' })
      }
      out.li.push({ day, id: entry.id, scheduled_for: scheduledForLi.toISOString(), voice_score: liDraft.voice_score, has_image: !!imageUrl, hook: liDraft.hook })
    }

    const created = out.fb.length + out.ig.length + out.tt.length + out.yt.length + out.li.length
    const card = [
      `📱 *DAILY SOCIAL DRAFTED* — ${day} ${todayDateStr}`,
      `${created} new post${created === 1 ? '' : 's'} auto-approved for today.`,
      ...(out.skipped.length ? [`Skipped (already had today): ${out.skipped.map(s => s.channel).join(', ')}`] : []),
      ``,
      ...(out.li.length ? [`*LinkedIn* (9am PT):`, ...out.li.map(d => d.error ? `  · ❌ ${d.error}` : `  · ${d.hook || ''} hook · voice ${d.voice_score}/100 ${d.has_image ? '🖼️' : '📝'}`)] : []),
      ...(out.fb.length ? [``, `*Facebook* (12pm PT):`, ...out.fb.map(d => d.error ? `  · ❌ ${d.error}` : `  · voice ${d.voice_score}/100 ${d.has_image ? '🖼️' : '📝'}`)] : []),
      ...(out.ig.length ? [``, `*Instagram* (11:30am PT):`, ...out.ig.map(d => d.error ? `  · ❌ ${d.error}` : `  · voice ${d.voice_score}/100 ${d.has_image ? '🖼️' : '⚠️ NO IMAGE'}`)] : []),
      ...(out.tt.length ? [``, `*TikTok* (2pm PT):`, ...out.tt.map(d => d.error ? `  · ❌ ${d.error}` : `  · voice ${d.voice_score}/100 ${d.has_image ? '🖼️' : '⚠️ NO IMAGE'}`)] : []),
    ].join('\n')
    postToCliqChannelById(MARK_ALERT_CHANNEL_ID, card).catch(() => {})

    const allDrafts = [...out.fb, ...out.ig, ...out.tt, ...out.yt, ...out.li].filter(d => !d.error && d.id)
    for (const d of allDrafts) {
      const draft = await getDraft(req, d.id).catch(() => null)
      if (!draft) continue
      const fullBody = await getDraftFullBody(req, d.id).catch(() => draft.body)
      const { text, buttons } = buildMetaApprovalCard(draft, fullBody)
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, text, buttons).catch(e => console.warn('[meta cliq card]', e.message))
    }

    await stampSuccess(req, 'capture_meta', {
      day, fb: out.fb.length, ig: out.ig.length, tt: out.tt.length, yt: out.yt.length, li: out.li.length,
      skipped: out.skipped.length, story_source: storySource,
    })
    res.json({ ok: true, story_source: storySource, ...out })
  } catch (e) {
    await reportCronFailure(req, 'capture_meta', e)
    res.json({ ok: false, error: e.message })
  }
})

// Smoke test for the Cloudinary image→video pipeline. Takes a public image
// URL, returns the rendered MP4 URL + size. Read-only-ish (uploads to your
// Cloudinary asset library — uses ~0.1 credit per call). Use to confirm
// CLOUDINARY_URL is set correctly before relying on it in the YT pipeline.
//   GET /api/capture-calc/cloudinary/test?image=<URL>  (cron-secret)
captureCalcRouter.get('/cloudinary/test', requireCronSecretFlex, async (req, res) => {
  try {
    const imageUrl = String(req.query.image || '').trim()
    if (!imageUrl) return res.status(400).json({ ok: false, error: 'image=<url> query param required' })
    if (!cloudinaryConfigured()) return res.status(400).json({ ok: false, error: 'CLOUDINARY_URL not set' })
    const duration = Math.max(2, Math.min(30, Number(req.query.duration) || 8))
    const r = await imageToShortVideo({ imageUrl, duration })
    if (!r?.ok) return res.status(500).json({ ok: false, ...r })
    res.json({ ok: true, source_image: imageUrl, mp4_url: r.url, bytes: r.bytes, mime: r.mimeType, public_id: r.publicId, duration_sec: duration })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Retrofit: post approval cards for any pending FB/IG drafts already in the
// queue (re-show this week's cards, or backfill after a card-format change).
// Covers every Meta post still live — pending OR approved — that hasn't
// published or been killed yet.
//   POST /api/capture-calc/meta/post-pending-cards  (cron-secret)
captureCalcRouter.post('/meta/post-pending-cards', requireCronSecretFlex, async (req, res) => {
  try {
    const all = await listQueue(req)
    const meta = all.filter(d =>
      ['facebook_page', 'instagram_business', 'tiktok_business', 'youtube_shorts'].includes(d.channel) &&
      (d.status === 'pending' || d.status === 'approved'))
    let posted = 0
    for (const draft of meta) {
      const fullBody = await getDraftFullBody(req, draft.id).catch(() => draft.body)
      const { text, buttons } = buildMetaApprovalCard(draft, fullBody)
      const r = await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, text, buttons).catch(e => ({ ok: false, error: e.message }))
      if (r?.ok !== false) posted++
    }
    res.json({ ok: true, total_meta_live: meta.length, cards_posted: posted })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

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
    const draft = await getDraft(req, id)
    if (!draft) return res.status(404).json({ ok: false, error: 'draft not found' })

    const headline = String(req.body?.headline || draft.headline || draft.body.split('\n')[0]).slice(0, 100)
    // Regen consumes daily budget. Hit the kill switch only if explicitly off.
    if (!captureImagesEnabled() && !req.body?.force) {
      return res.status(409).json({ ok: false, error: 'image gen kill switch is off (set CAPTURE_IMAGES_ENABLED=true or pass force=true)' })
    }
    const r = await generateCaptureImage({ headline, draftId: id }, { segment, force: Boolean(req.body?.force) })
    if (!r.ok) {
      await updateDraft(req, id, { image_status: 'regen_failed', image_error: r.error })
      return res.status(500).json({ ok: false, error: r.error, budget: r.budget })
    }
    await updateDraft(req, id, { image_url: r.url, image_status: 'regenerated' })
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
// Accept POST too — Catalyst's cron UI defaults to POST and any cron set up
// with the default would 404 here, causing auto-disable after 20 consecutive
// failures. `.all()` accepts both methods.
captureCalcRouter.all('/engagement/run', heartbeatAttempt('capture_engagement'), requireCronSecretFlex, async (req, res) => {
  const out = []
  try {
    const segment = getSegment(req)
    const published = await listQueue(req, { status: 'published' })
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
      await updateDraft(req, draft.id, patch)
      out.push({ id: draft.id, channel: draft.channel, killed: !!killCheck.kill, reason: killCheck.reason })
    }
    await stampSuccess(req, 'capture_engagement', { processed: out.length })
    res.json({ ok: true, processed: out.length, results: out })
  } catch (e) {
    await reportCronFailure(req, 'capture_engagement', e)
    res.json({ ok: false, error: e.message, partial: out })
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
captureCalcRouter.all('/report/weekly', heartbeatAttempt('capture_weekly'), requireCronSecretFlex, async (req, res) => {
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
    const queue = await listQueue(req)
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
    await stampSuccess(req, 'capture_weekly', { length: msg.length, counts })
    res.json({ ok: true, length: msg.length, counts })
  } catch (e) {
    await reportCronFailure(req, 'capture_weekly', e)
    res.json({ ok: false, error: e.message })
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
async function runSchedulerOnce(req, { dry = false } = {}) {
  const out = []
  const segment = getSegment(req)
  const list = await listQueue(req, { status: 'approved' })
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
        if (!dry) await updateDraft(req, draft.id, { status: 'stale', stale_reason: `${Math.round((now - sched) / 3600000)}h past scheduled_for` })
        out.push({ id: draft.id, channel: draft.channel, stale: true, hours_late: Math.round((now - sched) / 3600000) })
        continue
      }

      if (dry) { out.push({ id: draft.id, channel: draft.channel, dry: true }); continue }

      if (draft.channel === 'linkedin_personal') {
        try {
          // Queue stores a truncated preview body; fetch the publish-ready
          // full version from the per-draft cache key. Falls back to queue
          // body if the full version isn't found.
          const publishBody = await getDraftFullBody(req, draft.id).catch(() => draft.body)
          // Use image-post path when an image was attached at draft time;
          // fall back to text-only if image gen failed or was disabled.
          const r = draft.image_url
            ? await postImageToLinkedIn({ imageUrl: draft.image_url, text: publishBody })
            : await postToLinkedIn({ text: publishBody })
          if (r?.ok && r.id) {
            await updateDraft(req, draft.id, { status: 'published', published_at: new Date().toISOString(), platform_id: r.id, posted_with_image: Boolean(draft.image_url) })
            out.push({ id: draft.id, channel: draft.channel, ok: true, platform_id: r.id, with_image: Boolean(draft.image_url) })
            const imgNote = draft.image_url ? ' (with image)' : ''
            await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `✅ Published to LinkedIn${imgNote}: ${draft.headline || draft.body.slice(0, 60)}`).catch(() => {})
          } else {
            await updateDraft(req, draft.id, { status: 'publish_failed', error: r?.error || 'unknown' })
            out.push({ id: draft.id, channel: draft.channel, ok: false, error: r?.error })
            await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🚨 LinkedIn publish FAILED — ${r?.error || 'unknown'}\nDraft: ${draft.headline || draft.body.slice(0, 60)} (id ${draft.id})`).catch(() => {})
          }
        } catch (e) {
          await updateDraft(req, draft.id, { status: 'publish_failed', error: e.message })
          out.push({ id: draft.id, channel: draft.channel, ok: false, error: e.message })
          await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🚨 LinkedIn publish THREW — ${e.message}\nDraft id ${draft.id}`).catch(() => {})
        }
      } else if (draft.channel === 'facebook_page') {
        try {
          if (!facebookConfigured()) {
            await updateDraft(req, draft.id, { status: 'publish_failed', error: 'FB not configured (FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN missing)' })
            out.push({ id: draft.id, channel: draft.channel, ok: false, error: 'fb_not_configured' })
            continue
          }
          const publishBody = await getDraftFullBody(req, draft.id).catch(() => draft.body)
          const r = await postToFacebookPage({ imageUrl: draft.image_url || null, caption: publishBody })
          if (r?.ok && r.id) {
            await updateDraft(req, draft.id, { status: 'published', published_at: new Date().toISOString(), platform_id: r.id, posted_with_image: Boolean(draft.image_url) })
            out.push({ id: draft.id, channel: draft.channel, ok: true, platform_id: r.id, with_image: Boolean(draft.image_url) })
            const imgNote = draft.image_url ? ' (with image)' : ''
            await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `✅ Published to Facebook${imgNote}: ${draft.headline || draft.body.slice(0, 60)}`).catch(() => {})
          } else {
            await updateDraft(req, draft.id, { status: 'publish_failed', error: r?.error || 'unknown' })
            out.push({ id: draft.id, channel: draft.channel, ok: false, error: r?.error })
            await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🚨 Facebook publish FAILED — ${r?.error || 'unknown'}\nDraft: ${draft.headline || draft.body.slice(0, 60)} (id ${draft.id})`).catch(() => {})
          }
        } catch (e) {
          await updateDraft(req, draft.id, { status: 'publish_failed', error: e.message })
          out.push({ id: draft.id, channel: draft.channel, ok: false, error: e.message })
          await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🚨 Facebook publish THREW — ${e.message}\nDraft id ${draft.id}`).catch(() => {})
        }
      } else if (draft.channel === 'instagram_business') {
        try {
          if (!instagramConfigured()) {
            await updateDraft(req, draft.id, { status: 'publish_failed', error: 'IG not configured (IG_BUSINESS_USER_ID / FB_PAGE_ACCESS_TOKEN missing)' })
            out.push({ id: draft.id, channel: draft.channel, ok: false, error: 'ig_not_configured' })
            continue
          }
          // Instagram REQUIRES an image (Graph API constraint).
          if (!draft.image_url) {
            await updateDraft(req, draft.id, { status: 'publish_failed', error: 'IG requires an image; image_url missing' })
            out.push({ id: draft.id, channel: draft.channel, ok: false, error: 'ig_image_required' })
            continue
          }
          const publishBody = await getDraftFullBody(req, draft.id).catch(() => draft.body)
          const r = await postToInstagram({ imageUrl: draft.image_url, caption: publishBody })
          if (r?.ok && r.id) {
            await updateDraft(req, draft.id, { status: 'published', published_at: new Date().toISOString(), platform_id: r.id, posted_with_image: true })
            out.push({ id: draft.id, channel: draft.channel, ok: true, platform_id: r.id, with_image: true })
            await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `✅ Published to Instagram: ${draft.headline || draft.body.slice(0, 60)}`).catch(() => {})
          } else {
            await updateDraft(req, draft.id, { status: 'publish_failed', error: r?.error || 'unknown' })
            out.push({ id: draft.id, channel: draft.channel, ok: false, error: r?.error })
            await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🚨 Instagram publish FAILED — ${r?.error || 'unknown'}\nDraft: ${draft.headline || draft.body.slice(0, 60)} (id ${draft.id})`).catch(() => {})
          }
        } catch (e) {
          await updateDraft(req, draft.id, { status: 'publish_failed', error: e.message })
          out.push({ id: draft.id, channel: draft.channel, ok: false, error: e.message })
          await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🚨 Instagram publish THREW — ${e.message}\nDraft id ${draft.id}`).catch(() => {})
        }
      } else if (draft.channel === 'youtube_shorts') {
        try {
          if (!youtubeConfigured()) {
            await updateDraft(req, draft.id, { status: 'publish_failed', error: 'YouTube not configured (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN missing)' })
            out.push({ id: draft.id, channel: draft.channel, ok: false, error: 'youtube_not_configured' })
            continue
          }
          if (!draft.video_url) {
            await updateDraft(req, draft.id, { status: 'publish_failed', error: 'YouTube draft missing video_url (Cloudinary step failed at draft time)' })
            out.push({ id: draft.id, channel: draft.channel, ok: false, error: 'youtube_video_missing' })
            continue
          }
          const publishBody = await getDraftFullBody(req, draft.id).catch(() => draft.body)
          // Download the Cloudinary-rendered MP4 buffer, then push to YouTube.
          let videoBuffer = null
          try {
            const dl = await axios.get(draft.video_url, {
              responseType: 'arraybuffer',
              timeout: 120000,
              maxContentLength: Infinity,
              maxBodyLength: Infinity,
            })
            videoBuffer = Buffer.from(dl.data)
          } catch (e) {
            await updateDraft(req, draft.id, { status: 'publish_failed', error: `video download failed: ${e.message}` })
            out.push({ id: draft.id, channel: draft.channel, ok: false, error: e.message })
            continue
          }
          const r = await postShortToYouTube({
            videoBuffer,
            title: draft.headline || String(publishBody || '').slice(0, 80),
            description: publishBody,
          })
          if (r?.ok && r.id) {
            await updateDraft(req, draft.id, { status: 'published', published_at: new Date().toISOString(), platform_id: r.id, youtube_url: r.url, posted_with_image: true })
            out.push({ id: draft.id, channel: draft.channel, ok: true, platform_id: r.id })
            await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `✅ Published to YouTube Shorts: ${draft.headline || draft.body.slice(0, 60)}\n${r.url}`).catch(() => {})
          } else {
            await updateDraft(req, draft.id, { status: 'publish_failed', error: r?.error || 'unknown' })
            out.push({ id: draft.id, channel: draft.channel, ok: false, error: r?.error })
            await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🚨 YouTube publish FAILED — ${r?.error || 'unknown'}\nDraft: ${draft.headline || draft.body.slice(0, 60)} (id ${draft.id})`).catch(() => {})
          }
        } catch (e) {
          await updateDraft(req, draft.id, { status: 'publish_failed', error: e.message })
          out.push({ id: draft.id, channel: draft.channel, ok: false, error: e.message })
          await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🚨 YouTube publish THREW — ${e.message}\nDraft id ${draft.id}`).catch(() => {})
        }
      } else if (draft.channel === 'tiktok_business') {
        try {
          if (!tiktokConfigured()) {
            await updateDraft(req, draft.id, { status: 'publish_failed', error: 'TikTok not configured (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET / TIKTOK_REFRESH_TOKEN missing)' })
            out.push({ id: draft.id, channel: draft.channel, ok: false, error: 'tiktok_not_configured' })
            continue
          }
          // TikTok REQUIRES an image (Content Posting API photo mode needs media).
          if (!draft.image_url) {
            await updateDraft(req, draft.id, { status: 'publish_failed', error: 'TikTok requires an image; image_url missing' })
            out.push({ id: draft.id, channel: draft.channel, ok: false, error: 'tiktok_image_required' })
            continue
          }
          const publishBody = await getDraftFullBody(req, draft.id).catch(() => draft.body)
          const r = await postPhotoToTikTok({ imageUrl: draft.image_url, caption: publishBody })
          if (r?.ok && r.id) {
            await updateDraft(req, draft.id, { status: 'published', published_at: new Date().toISOString(), platform_id: r.id, posted_with_image: true })
            out.push({ id: draft.id, channel: draft.channel, ok: true, platform_id: r.id, with_image: true })
            await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `✅ Published to TikTok: ${draft.headline || draft.body.slice(0, 60)}`).catch(() => {})
          } else {
            await updateDraft(req, draft.id, { status: 'publish_failed', error: r?.error || 'unknown' })
            out.push({ id: draft.id, channel: draft.channel, ok: false, error: r?.error })
            await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🚨 TikTok publish FAILED — ${r?.error || 'unknown'}\nDraft: ${draft.headline || draft.body.slice(0, 60)} (id ${draft.id})`).catch(() => {})
          }
        } catch (e) {
          await updateDraft(req, draft.id, { status: 'publish_failed', error: e.message })
          out.push({ id: draft.id, channel: draft.channel, ok: false, error: e.message })
          await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🚨 TikTok publish THREW — ${e.message}\nDraft id ${draft.id}`).catch(() => {})
        }
      } else {
        out.push({ id: draft.id, channel: draft.channel, ok: false, error: 'unsupported channel' })
      }
    }
  return { processed: out.length, results: out }
}

captureCalcRouter.all('/scheduler/run', heartbeatAttempt('capture_scheduler'), requireCronSecretFlex, async (req, res) => {
  const dry = req.query.dry === '1' || req.query.dry === 'true'
  try {
    const result = await runSchedulerOnce(req, { dry })
    if (!dry) await stampSuccess(req, 'capture_scheduler', { processed: result.processed })
    res.json({ ok: true, dry, ...result })
  } catch (e) {
    await reportCronFailure(req, 'capture_scheduler', e)
    res.json({ ok: false, error: e.message })
  }
})

// TEMP DEBUG — unauthenticated trigger that runs one scheduler pass. Same
// publishing logic as the hourly cron. Used to flush the queue when the
// real cron has been auto-disabled. REMOVE after 2026-05-26 outage.
captureCalcRouter.all('/debug/run-scheduler', async (req, res) => {
  const dry = req.query.dry === '1' || req.query.dry === 'true'
  try {
    const result = await runSchedulerOnce(req, { dry })
    if (!dry) await stampSuccess(req, 'capture_scheduler', { processed: result.processed, via: 'debug' })
    res.json({ ok: true, dry, debug: true, ...result })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// TEMP DEBUG — unauthenticated wrapper that forwards to a cron route with the
// function's own secret. Whitelisted to the recovery-relevant cron endpoints
// so it can't be used to invoke arbitrary auth-gated routes.
// REMOVE on or after 2026-06-09 (debug endpoints kept for 14 days post-outage).
const DEBUG_FORWARD_WHITELIST = {
  'draft-meta-week':     '/api/capture-calc/meta/draft-week?force=1',
  'draft-meta-day':      '/api/capture-calc/meta/draft-day',
  'draft-linkedin-week': '/api/capture-calc/linkedin/draft-week-variants?force=1',
  'nurture-run':         '/api/capture-calc/nurture/run',
  'cron-monitor-run':    '/api/cron-monitor/run',
  'holiday-poster-run':  '/api/holiday-poster/run',
  'engagement-run':      '/api/capture-calc/engagement/run',
  'weekly-run':          '/api/capture-calc/report/weekly?force=1',
  'scheduler-run-raw':   '/api/capture-calc/scheduler/run',
}
async function debugForward(req, res, target) {
  const secret = process.env.BREW_CRON_SECRET
  if (!secret) return res.status(500).json({ ok: false, error: 'BREW_CRON_SECRET not set on function' })
  const base = `https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api`
  const sep = target.includes('?') ? '&' : '?'
  const url = `${base}${target}${sep}secret=${encodeURIComponent(secret)}`
  try {
    // 250s — gateway will 504 at 30s for the OUTER curl, but the called
    // handler keeps running server-side. Poll /debug/state to watch progress.
    const r = await axios.post(url, {}, { timeout: 250000, validateStatus: () => true })
    res.json({ ok: true, debug: true, forwarded: true, url: target, status: r.status, data: r.data })
  } catch (e) {
    res.json({ ok: true, debug: true, forwarded: true, url: target, note: 'outer timed out; inner may still be running', error: e.message })
  }
}
captureCalcRouter.all('/debug/draft-meta-week',     (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['draft-meta-week']))
captureCalcRouter.all('/debug/draft-meta-day',      (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['draft-meta-day']))
captureCalcRouter.all('/debug/draft-linkedin-week', (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['draft-linkedin-week']))
captureCalcRouter.all('/debug/nurture-run',         (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['nurture-run']))
captureCalcRouter.all('/debug/cron-monitor-run',    (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['cron-monitor-run']))
captureCalcRouter.all('/debug/holiday-poster-run',  (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['holiday-poster-run']))
captureCalcRouter.all('/debug/engagement-run',      (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['engagement-run']))
captureCalcRouter.all('/debug/weekly-run',          (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['weekly-run']))
captureCalcRouter.all('/debug/scheduler-run-raw',   (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['scheduler-run-raw']))

// TEMP DEBUG — generate one meta-drafter slot and return text + image_prompt.
// No enqueue, no image gen, no cost beyond one Claude call. Used to verify
// the IMAGE_PROMPT_SPEC is producing template-correct prompts before relying
// on it for the full Sunday batch. REMOVE on 2026-06-09 sweep.
// TEMP DEBUG — post synthetic test messages to the aa + aajobs channels so
// you can eyeball the format in Cliq without waiting for a real event.
// Each message is prefixed with [TEST] so it can't be confused with a real
// notification. REMOVE on 2026-06-09 sweep.
captureCalcRouter.get('/debug/ops-test', async (req, res) => {
  const { OPS_CHANNEL_ID, JADEN_CHANNEL_ID, postToCliqChannelById } = await import('../services/cliq.js')
  const { formatDispatchMessage, formatInvoicedMessage, formatJobRequestMessage } = await import('../services/opsChannelFormat.js')

  const sampleJob = {
    shop_name: 'Avon Body Shop',
    quote_number: '20521',
    year: '2016',
    make: 'Chevrolet',
    model: 'Silverado 2500HD',
    trim: 'LT',
    vin: '1GC2KVEG2GZ200003',
    technician: 'Jayden Goshorn',
    calibrations: JSON.stringify([{ name: 'Steering Angle Sensor' }, { name: 'Front Radar' }]),
    notes: 'RO# 20521 | Quote: ABS 20521.1\nCustomer needs done by EOD Friday',
  }
  const tag = '[TEST] '
  const tests = [
    { channel: OPS_CHANNEL_ID,   name: 'aa: dispatch',     msg: tag + formatDispatchMessage(sampleJob) },
    { channel: OPS_CHANNEL_ID,   name: 'aa: invoiced',     msg: tag + formatInvoicedMessage(sampleJob, 487.50) },
    { channel: JADEN_CHANNEL_ID, name: 'aajobs: dispatch', msg: tag + formatDispatchMessage(sampleJob) },
    { channel: JADEN_CHANNEL_ID, name: 'aajobs: request',  msg: tag + formatJobRequestMessage(sampleJob) },
    { channel: JADEN_CHANNEL_ID, name: 'aajobs: invoiced', msg: tag + formatInvoicedMessage(sampleJob, 487.50) },
  ]

  const results = []
  for (const t of tests) {
    try {
      await postToCliqChannelById(t.channel, t.msg)
      results.push({ name: t.name, channel: t.channel, ok: true })
    } catch (e) {
      results.push({ name: t.name, channel: t.channel, ok: false, error: e.message })
    }
  }
  res.json({ ok: true, posted: results })
})

// TEMP DEBUG — render an image directly from a raw prompt string. Used to
// A/B test Magic Lantern verbatim-library output vs Claude's blended output.
// REMOVE 2026-06-09.
// TEMP DEBUG — regenerate images for approved drafts.
//   Default: finds drafts with image_status === 'failed' or no image_url.
//   ?id=X    : regen one specific draft regardless of current image status.
// Serial (not parallel) so we don't wedge Catalyst's concurrency again.
captureCalcRouter.all('/debug/regen-failed-images', async (req, res) => {
  try {
    const segment = getSegment(req)
    const all = await listQueue(req, { status: 'approved' })
    const forceId = String(req.query.id || '').trim()
    const bypassBudget = Boolean(forceId)  // explicit id = manual one-off, bypass daily cap
    let needs
    if (forceId) {
      needs = all.filter(d => d.id === forceId)
      if (!needs.length) return res.status(404).json({ ok: false, error: `no approved draft with id ${forceId}` })
    } else {
      needs = all.filter(d => !d.image_url || d.image_status === 'failed')
    }
    const out = []
    for (const d of needs) {
      const headline = d.headline || (d.body || '').split('\n')[0] || d.category
      try {
        const r = await generateCaptureImage(
          { headline, draftId: d.id },
          { segment, sceneOverride: d.meta?.image_prompt || null, force: bypassBudget }
        )
        if (r?.ok) {
          await updateDraft(req, d.id, { image_url: r.url, image_status: 'generated', image_error: null })
          out.push({ id: d.id, channel: d.channel, category: d.category, ok: true, url: r.url })
        } else {
          await updateDraft(req, d.id, { image_status: 'failed', image_error: r?.error || 'unknown' })
          out.push({ id: d.id, channel: d.channel, category: d.category, ok: false, error: r?.error })
        }
      } catch (e) {
        out.push({ id: d.id, channel: d.channel, category: d.category, ok: false, error: e.message })
      }
    }
    res.json({ ok: true, attempted: out.length, succeeded: out.filter(o => o.ok).length, results: out })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// TEMP DEBUG — dedupe approved meta drafts. Walks the queue, groups by
// (channel, scheduled_for, category), keeps the oldest created_at in each
// group, kills the rest. Used to clean up after a Catalyst gateway-retry
// double-fire. No-auth (debug). REMOVE on 2026-06-09 sweep window.
// TEMP DEBUG — shift a single approved draft's scheduled_for to NOW + N min
// so the next scheduler run picks it up. Used to push a real post live for
// demo / smoke-test purposes outside of natural cadence. No-auth (debug).
captureCalcRouter.all('/debug/reschedule', async (req, res) => {
  try {
    const id = String(req.query.id || '').trim()
    // Cap raised 2026-06-17 from 60min to 7 days to allow batch rescheduling.
    const offsetMin = Math.max(0, Math.min(10080, Number(req.query.offset_min) || 1))
    if (!id) return res.status(400).json({ ok: false, error: 'id query param required' })
    const draft = await getDraft(req, id)
    if (!draft) return res.status(404).json({ ok: false, error: `no draft with id ${id}` })
    const newWhen = new Date(Date.now() + offsetMin * 60000).toISOString()
    const patch = { scheduled_for: newWhen }
    // ?status=approved (or any valid status) flips status while rescheduling.
    // Used to promote a pending draft to publishable + push it to NOW in one shot.
    const newStatus = String(req.query.status || '').trim()
    if (newStatus) patch.status = newStatus
    // ?kill=1 — convenience: skip reschedule, just mark killed.
    if (req.query.kill === '1' || req.query.kill === 'true') {
      patch.status = 'killed'
      patch.killed_reason = 'killed via /debug/reschedule?kill=1'
      delete patch.scheduled_for
    }
    await updateDraft(req, id, patch)
    res.json({ ok: true, id, channel: draft.channel, category: draft.category, was: draft.scheduled_for, was_status: draft.status, ...patch })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

captureCalcRouter.all('/debug/dedupe-meta', async (req, res) => {
  try {
    const META_CHANNELS = new Set(['facebook_page', 'instagram_business', 'tiktok_business', 'youtube_shorts'])
    const all = await listQueue(req, { status: 'approved' })
    const groups = {}
    for (const d of all) {
      if (!META_CHANNELS.has(d.channel)) continue
      const key = `${d.channel}|${d.scheduled_for || ''}|${d.category || ''}`
      if (!groups[key]) groups[key] = []
      groups[key].push(d)
    }
    const killed = []
    for (const key of Object.keys(groups)) {
      const items = groups[key]
      if (items.length < 2) continue
      // Keep the oldest by created_at; kill the rest.
      items.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
      const keep = items[0]
      for (let i = 1; i < items.length; i++) {
        const d = items[i]
        await updateDraft(req, d.id, { status: 'killed', killed_reason: `dedupe — duplicate of ${keep.id}` })
        killed.push({ id: d.id, channel: d.channel, scheduled_for: d.scheduled_for, kept_id: keep.id })
      }
    }
    res.json({ ok: true, killed_count: killed.length, killed })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// TEMP DEBUG — kill approved FB/IG/TT/YT drafts scheduled within the next N
// days. Used to clear old un-locked-pattern drafts before re-firing a fresh
// batch with the new HEADLINE PATTERN rules. Default 8 days = covers a week
// plus buffer. Returns the killed draft IDs + counts. No-auth (debug).
captureCalcRouter.all('/debug/clear-approved-meta', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(30, Number(req.query.days) || 8))
    const META_CHANNELS = new Set(['facebook_page', 'instagram_business', 'tiktok_business', 'youtube_shorts'])
    const all = await listQueue(req, { status: 'approved' })
    const now = Date.now()
    const cutoff = now + days * 86400000
    const killed = []
    for (const d of all) {
      if (!META_CHANNELS.has(d.channel)) continue
      const sched = d.scheduled_for ? new Date(d.scheduled_for).getTime() : 0
      if (!sched || sched > cutoff) continue
      // Past or within window — kill it.
      await updateDraft(req, d.id, { status: 'killed', killed_reason: 'cleared via /debug/clear-approved-meta before fresh batch' })
      killed.push({ id: d.id, channel: d.channel, category: d.category, scheduled_for: d.scheduled_for })
    }
    res.json({ ok: true, days, killed_count: killed.length, killed })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

captureCalcRouter.get('/debug/render-prompt', async (req, res) => {
  try {
    const prompt = String(req.query.prompt || '').trim()
    const label = String(req.query.label || 'preview').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'preview'
    // `headline` keeps spaces (it's what renders in the overlay).
    // `label` is sanitized for the filename only.
    const headline = String(req.query.headline || label).slice(0, 200)
    if (!prompt) return res.status(400).json({ ok: false, error: 'prompt query param required' })
    if (!captureImagesEnabled()) return res.status(400).json({ ok: false, error: 'CAPTURE_IMAGES_ENABLED not set' })
    const segment = getSegment(req)
    // ?force=1 bypasses the daily budget cap (debug-route, one-off renders).
    const bypassBudget = req.query.force === '1' || req.query.force === 'true'
    const r = await generateCaptureImage(
      { headline, draftId: `${label}-${Date.now()}` },
      { segment, sceneOverride: prompt, force: bypassBudget }
    )
    if (!r?.ok) return res.status(500).json({ ok: false, error: r?.error, budget: r?.budget })
    res.json({ ok: true, label, headline, image_url: r.url })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

captureCalcRouter.get('/debug/meta-slot-preview', async (req, res) => {
  try {
    const channel = String(req.query.channel || 'facebook').toLowerCase()
    const type = String(req.query.type || 'story')
    const day = String(req.query.day || 'Mon')
    // Pass ?targetDate=YYYY-MM-DD to test Magic Lantern routing (e.g.
    // targetDate=2026-07-04 should land the Independence Day library template).
    const targetDate = req.query.targetDate ? String(req.query.targetDate) : null
    const story = String(req.query.story || `A body shop owner in Tacoma realized last month he was paying $450 list for every ADAS calibration. We sat down, walked through the partnership discount model. He's now saving $67.50 per calibration. He sublets 12 cals/month. That's $8,100 a year back in his shop.`)
    const result = await draftMetaSlot({ channel, day, type, story, targetDate })
    res.json({ ok: true, channel, type, day, target_date: targetDate, result })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// TEMP DEBUG — read cron heartbeats. Each timestamp shows the most recent
// "attempt" (cron call reached the route) and "success" (handler completed).
// Use to confirm whether a cron is reaching the function at all.
captureCalcRouter.get('/debug/heartbeats', async (req, res) => {
  try {
    const heartbeats = await readAllHeartbeats(req)
    res.json({ ok: true, now: new Date().toISOString(), heartbeats })
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
      const r = await sendBroadcast({ recipients: [t.email], subject: email.subject, html: email.html, text: email.text, fromEmail: CAPTURE_FROM_EMAIL, fromName: CAPTURE_FROM_NAME })
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
