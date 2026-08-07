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
import { syncNewsletterSubscriberToCrm, fetchLeadsPage, fetchContactsPage, fetchAccountsPage, createLeadFlat, deleteLead } from '../services/zohoCrm.js'
import { addVanSubscriber, listVanSubscribers, getVanAudienceId, createVanBroadcast, sendVanBroadcast, deleteVanBroadcast, unsubscribeVanContact, hardDeleteVanContact, signUnsubEmail, verifyUnsubSig, vanUnsubscribeUrl, listRecentResendSends } from '../services/fromTheVan.js'
import { VAN_NURTURE_DAYS, vanNurtureDayFor, buildVanNurtureEmail, VAN_UNSUB_PLACEHOLDER, buildGoodbyeEmail } from '../services/fromTheVanNurture.js'
import { buildWelcomeEmail } from '../services/vanWelcome.js'
import { draftWeeklyIssue, addCaseNote, readCaseNotes, pickNextCaseNote, markCaseNoteUsed, unmarkCaseNoteUsed, readIssueState, writeIssueState, computeIssueSlot, readPendingDraft, writePendingDraft, clearPendingDraft, signVanAction, verifyVanAction, nextTuesday7amPT, isVanFlagEnabled, setVanFlag, readAllVanFlags } from '../services/vanWeekly.js'
import { renderWeeklyIssue } from '../services/vanWeeklyRender.js'
import { computeCurrentStats, readVanStatsSnapshot, writeVanStatsSnapshot, buildDigestSMS } from '../services/vanDailyDigest.js'
import { sendTwilioSMS, resolvePhoneConfig } from '../services/twilio.js'
import { buildNurtureEmail, nurtureDayFor, NURTURE_DAYS } from '../services/captureNurture.js'
import { buildColdEmail, COLD_HOOKS, COLD_DAYS } from '../services/coldOutreach.js'
import { draftLinkedInWeek, draftSlotVariants, draftWeekVariants } from '../services/linkedInDrafter.js'
import { draftMetaWeek, draftMetaDay, draftMetaSlot, draftUnifiedDailyPost, UNIFIED_DAY_TYPE_FOR, FB_SLOTS, IG_SLOTS } from '../services/metaDrafter.js'
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
import crypto from 'crypto'

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

    // TIME-BOXED (2026-08-07): sequential Zoho Mail sends blew the 30s
    // gateway cap when enough nurture emails were due — 20 consecutive
    // gateway timeouts auto-disabled this cron (same failure mode as
    // capture_engagement). Cap sends per run; the hourly schedule
    // drains the rest, and per-day nurture_sent tracking keeps re-runs
    // safe.
    const RUN_STARTED = Date.now()
    const TIME_BUDGET_MS = 20_000
    const MAX_SENDS_PER_RUN = 10
    let sends = 0

    for (let i = 0; i < list.length; i++) {
      if (!dry && (sends >= MAX_SENDS_PER_RUN || (Date.now() - RUN_STARTED) > TIME_BUDGET_MS)) break
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
      sends++

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
//   Body: { story?, caseStudy? }
//   Query: ?dayName=Mon  ← override today (testing)
//          ?type=story|framework|case_study  ← override today's rotation
//
// UNIFIED daily drafter (2026-06-19): ONE post per day, identical body +
// identical image fanned across FB + IG + LinkedIn. Single Claude call,
// single image gen. Channel-specific drafting was replaced because Mark
// wanted one coherent message everywhere instead of 3-4 slight variants.
// Skips any channel that already has a live draft for today (idempotent).
captureCalcRouter.all('/meta/draft-day', heartbeatAttempt('capture_meta'), requireCronSecretFlex, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const segment = getSegment(req)
    const todayPT = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
    const dayName = String(req.query.dayName || todayPT)
    const todayDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

    // Concurrent-fire lock. Window is 3 min (was 10): Catalyst's cron daemon
    // kills a handler at ~30s, so anything older than 3 min is dead — and the
    // staggered retry crons (6:13/6:17/6:21) must get through, not bounce off
    // a stale lock from a killed attempt.
    const LOCK_KEY = `meta_daily_inprogress_${todayDateStr}`
    if (req.query.force_relock !== '1') {
      const existingLock = await cacheGet(segment, LOCK_KEY, null)
      if (existingLock && (Date.now() - new Date(existingLock.at).getTime()) < 180000) {
        return res.json({ ok: true, skipped: true, reason: 'concurrent draft-day already in progress (lock held)', locked_at: existingLock.at })
      }
    }
    await cacheSet(segment, LOCK_KEY, { at: new Date().toISOString() })

    // Idempotence — skip channels that already have a live EDUCATIONAL draft
    // for today. Must exclude other pillars (van_field posts share the same
    // channels — before 2026-07-06 they falsely blocked this drafter and no
    // educational post went out after the van pillar launched).
    const existing = await listQueue(req, {})
    const metaPtDay = iso => { try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) } catch { return '' } }
    const todayLive = existing.filter(d => {
      if (!['facebook_page', 'instagram_business', 'linkedin_personal'].includes(d.channel)) return false
      if (!['approved', 'pending', 'published'].includes(d.status)) return false
      if (d.category === 'van_field') return false
      return metaPtDay(d.scheduled_for) === todayDateStr
    })
    const channelsAlreadyDone = new Set(todayLive.map(d => d.channel))

    // Story sourcing for the DAILY drafter:
    //   1. If req.body.story is provided, use it verbatim (manual override).
    //   2. Otherwise ALWAYS auto-generate a fresh story — do NOT read the
    //      cached weekly story (that'd reuse the same shop/owner every day).
    //   3. Pass the last 10 stories to Claude as anti-examples and append the
    //      new one to history so tomorrow's run avoids today's owner/city.
    // Early exit BEFORE the expensive work when every channel already has
    // today's educational draft — retry crons on good days must return in
    // ~2s (cron success), not re-run 60s of Claude/Gemini just to skip.
    if (['facebook_page', 'instagram_business', 'linkedin_personal'].every(ch => channelsAlreadyDone.has(ch))) {
      return res.json({ ok: true, skipped: true, reason: 'all channels already have today\'s educational draft' })
    }

    // RESUMABLE PIPELINE (2026-07-08): Catalyst's cron daemon kills the
    // handler at the 30s gateway timeout, and this drafter takes 60-120s.
    // Every expensive step persists its output to META_CONTENT_KEY so the
    // staggered retry crons (6:13/6:17/6:21) resume instead of restarting:
    // run 1 drafts the post (~25s, dies), run 2 reuses it + builds the image,
    // run 3 enqueues. Same-day re-runs also ship the identical post.
    const META_CONTENT_KEY = `meta_content_${todayDateStr}`
    const metaCached = (await cacheGet(segment, META_CONTENT_KEY, null)) || {}

    let story = String(req.body?.story || '').trim() || metaCached.story || ''
    let caseStudy = String(req.body?.caseStudy || '').trim()
    if (!caseStudy) {
      const blob = await cacheGet(segment, 'capture_weekly_case_study', null)
      caseStudy = String(blob?.value || '')
    }
    let storySource = metaCached.story ? 'cached-same-day' : 'dropped'
    if (!story) {
      try {
        const recentBlob = await cacheGet(segment, 'capture_story_history', null)
        const recentStories = Array.isArray(recentBlob?.stories) ? recentBlob.stories : []
        story = await generateWeeklyStory({ recentStories: recentStories.slice(0, 10) })
        storySource = 'auto-generated-fresh-daily'
        // Grow history so tomorrow's auto-gen sees today's story and avoids it.
        const nextHistory = [story, ...recentStories].slice(0, 20)
        await cacheSet(segment, 'capture_story_history', { stories: nextHistory, last_generated_at: Date.now() }).catch(() => {})
      } catch (e) {
        return res.json({ ok: false, skipped: true, reason: `auto-gen failed (${e.message})` })
      }
    }

    // ── ONE unified post for today, fanned across FB + IG + LinkedIn ──────
    const todayType = String(req.query.type || UNIFIED_DAY_TYPE_FOR(dayName))
    const todayDateIso = new Date().toISOString()
    let unified
    if (metaCached.unified?.body && metaCached.type === todayType) {
      unified = metaCached.unified
    } else {
      try {
        unified = await draftUnifiedDailyPost({ story, caseStudy, type: todayType, targetDate: todayDateIso, day: dayName })
      } catch (e) {
        await reportCronFailure(req, 'capture_meta', e)
        return res.json({ ok: false, error: `unified draft failed: ${e.message}` })
      }
      await cacheSet(segment, META_CONTENT_KEY, { ...metaCached, story, type: todayType, unified }).catch(() => {})
    }

    // ── ONE image, shared across all 3 channels ────────────────────────────
    let imageUrl = metaCached.image_url || null
    let imageError = null
    if (!imageUrl && captureImagesEnabled()) {
      const batchSlug = `metaday-${todayDateStr}-${todayType}`
      const r = await generateCaptureImage(
        { headline: unified.headline, draftId: batchSlug },
        { segment, sceneOverride: unified.image_prompt }
      ).catch(e => ({ ok: false, error: e.message }))
      if (r?.ok) {
        imageUrl = r.url
        await cacheSet(segment, META_CONTENT_KEY, { ...metaCached, story, type: todayType, unified, image_url: imageUrl }).catch(() => {})
      } else imageError = r?.error || 'image generation failed'
    }

    // ── Fan out to 3 channels at their prime times ─────────────────────────
    const CHANNEL_SCHEDULE = [
      { channel: 'linkedin_personal',  hour: 9,  minute: 0,  label: 'LinkedIn (9am PT)' },
      { channel: 'instagram_business', hour: 11, minute: 30, label: 'Instagram (11:30am PT)' },
      { channel: 'facebook_page',      hour: 12, minute: 0,  label: 'Facebook (12pm PT)' },
    ]
    const out = { day: dayName, type: todayType, drafts: [], skipped: [] }

    for (const { channel, hour, minute, label } of CHANNEL_SCHEDULE) {
      if (channelsAlreadyDone.has(channel)) {
        out.skipped.push({ channel, reason: 'already has a live draft for today' })
        continue
      }
      const scheduledFor = todayScheduledForAtTimePT(hour, minute)
      const entry = await enqueueDraft(req, {
        channel,
        category: todayType,
        headline: unified.headline,
        body: unified.body,
        scheduled_for: scheduledFor.toISOString(),
        voice_score: unified.voice_score,
        voice_deductions: unified.voice_deductions,
        meta: { slot: dayName, group: `metaday-${todayDateStr}`, image_prompt: unified.image_prompt || null, unified: true },
        status: 'approved',
      })
      if (imageUrl) {
        await updateDraft(req, entry.id, { image_url: imageUrl, image_status: 'generated' })
      } else if (!captureImagesEnabled()) {
        await updateDraft(req, entry.id, { image_status: 'disabled' })
      } else {
        await updateDraft(req, entry.id, { image_status: 'failed', image_error: imageError || 'image generation failed' })
      }
      out.drafts.push({ channel, label, id: entry.id, scheduled_for: scheduledFor.toISOString(), has_image: !!imageUrl })
    }

    // Cliq summary card
    const card = [
      `📱 *DAILY UNIFIED POST DRAFTED* — ${dayName} ${todayDateStr} (${todayType})`,
      `${out.drafts.length} channel${out.drafts.length === 1 ? '' : 's'} got the same body + same image, auto-approved.`,
      ...(out.skipped.length ? [`Skipped (already had today): ${out.skipped.map(s => s.channel).join(', ')}`] : []),
      ``,
      `*Headline:* ${unified.headline}`,
      `*Voice score:* ${unified.voice_score}/100${imageUrl ? '  🖼️' : (imageError ? '  ⚠️ NO IMAGE: ' + imageError : '')}`,
      ``,
      ...out.drafts.map(d => `  · ${d.label}  →  scheduled ${d.scheduled_for.slice(11, 16)} UTC`),
    ].join('\n')
    postToCliqChannelById(MARK_ALERT_CHANNEL_ID, card).catch(() => {})

    // Single approval card (one per channel, all sharing the same body)
    for (const d of out.drafts) {
      const draft = await getDraft(req, d.id).catch(() => null)
      if (!draft) continue
      const fullBody = await getDraftFullBody(req, d.id).catch(() => draft.body)
      const { text, buttons } = buildMetaApprovalCard(draft, fullBody)
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, text, buttons).catch(e => console.warn('[meta cliq card]', e.message))
    }

    await stampSuccess(req, 'capture_meta', {
      day: dayName, type: todayType, drafts: out.drafts.length, skipped: out.skipped.length,
      with_image: !!imageUrl, story_source: storySource,
    })
    res.json({ ok: true, story_source: storySource, ...out })
  } catch (e) {
    await reportCronFailure(req, 'capture_meta', e)
    res.json({ ok: false, error: e.message })
  }
})

//   POST /api/capture-calc/van/draft-day  (cron-secret)
//   Query: ?dayName=Mon  ← override today (testing)
//
// VAN-IN-THE-FIELD daily pillar (2026-07-05): brand-presence post following
// the collision shop's weekly rhythm (Mon teardown → Fri delivery → weekend
// rest/prep). ONE caption + ONE image (Mark's real van photo placed into the
// day's scene via Gemini image-to-image) fanned to FB + IG + LinkedIn at
// 6:30 AM PT — before the educational unified post (9 AM-noon window).
// The van wrap carries the branding, so NO SVG masthead/footer composite.
// Idempotent: skips any channel with a live van-pillar draft for today.
captureCalcRouter.all('/van/draft-day', heartbeatAttempt('van_post'), requireCronSecretFlex, express.json({ limit: '32kb' }), async (req, res) => {
  let vanStep = 'init'
  try {
    const segment = getSegment(req)
    const { draftVanPost, todayDayName } = await import('../services/vanPostDrafter.js')
    const { pickNextVanPhoto } = await import('../services/vanPhotoLibrary.js')
    const { generateVanSceneImage } = await import('../services/nanoBanana.js')
    const { commitBinaryFile } = await import('../services/brewArchive.js')

    const dayName = String(req.query.dayName || todayDayName())
    // PT-based date: UTC rolls to tomorrow at 5 PM PT, which made evening
    // runs draft for the wrong day and poison the next day's content cache.
    const todayDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

    // Concurrent-fire lock. Window is 3 min (was 10): Catalyst's cron daemon
    // kills a handler at ~30s, and the staggered retry crons (6:01/6:05/6:09)
    // must get through instead of bouncing off a stale lock from a killed run.
    const LOCK_KEY = `van_daily_inprogress_${todayDateStr}`
    if (req.query.force_relock !== '1') {
      const existingLock = await cacheGet(segment, LOCK_KEY, null)
      if (existingLock && (Date.now() - new Date(existingLock.at).getTime()) < 180000) {
        return res.json({ ok: true, skipped: true, reason: 'concurrent van draft-day already in progress (lock held)', locked_at: existingLock.at })
      }
    }
    vanStep = 'lock-write'
    await cacheSet(segment, LOCK_KEY, { at: new Date().toISOString() })

    vanStep = 'idempotence-read'
    // Idempotence — one van post per channel per day (category 'van_field').
    const existing = await listQueue(req, {})
    // Compare scheduled_for in PT — the raw ISO string is UTC, and a 10 PM PT
    // post lands on "tomorrow" in UTC, which made the next morning's run skip
    // that channel entirely.
    const ptDay = iso => { try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) } catch { return '' } }
    const channelsAlreadyDone = new Set(existing.filter(d =>
      d.category === 'van_field' &&
      ['approved', 'pending', 'published'].includes(d.status) &&
      ptDay(d.scheduled_for) === todayDateStr
    ).map(d => d.channel))

    // Early exit when every channel already has today's van post — the
    // staggered retry crons (6:05/6:09) must return in ~2s on good days.
    if (['facebook_page', 'instagram_business', 'linkedin_personal'].every(ch => channelsAlreadyDone.has(ch))) {
      return res.json({ ok: true, skipped: true, reason: 'all channels already have today\'s van post' })
    }

    // SAME-CONTENT GUARANTEE (Mark 2026-07-05: "they all need to be the same
    // exact pic"): the day's caption + image are cached on first successful
    // build. Any re-run the same day (channel repair, manual re-fire) REUSES
    // the cached content for missing channels instead of generating new —
    // all channels always carry the identical post.
    vanStep = 'content-read'
    const CONTENT_KEY = `van_content_${todayDateStr}`
    const cachedContent = await cacheGet(segment, CONTENT_KEY, null)
    vanStep = 'draft'

    // 1. Draft the caption (or reuse today's)
    const draft = (cachedContent?.body)
      ? { headline: cachedContent.headline, body: cachedContent.body, image_prompt: cachedContent.image_prompt, voice_score: cachedContent.voice_score || null, voice_deductions: [], angle: cachedContent.angle || 'cached' }
      : await draftVanPost({ dayName, targetDate: new Date().toISOString() })

    // CAPTION-FIRST CACHE (2026-07-08): Catalyst's cron daemon kills the
    // handler at the 30s gateway timeout (curl-initiated calls survive it,
    // cron-initiated ones don't — the 6:01 aa_van_post died mid-image and left
    // nothing behind). Persist the caption NOW so the staggered retry crons
    // resume at the image step instead of redoing the Claude draft.
    if (!cachedContent?.body) {
      await cacheSet(segment, CONTENT_KEY, {
        headline: draft.headline, body: draft.body, image_prompt: draft.image_prompt,
        voice_score: draft.voice_score, angle: draft.angle, image_url: null, image_source: null,
      }).catch(() => {})
    }

    // 2. Pick a real van photo (LRU rotation) — skipped when reusing cache.
    vanStep = 'photo-pick'
    let vanPhoto = null
    if (!cachedContent?.image_url) {
      try {
        vanPhoto = await pickNextVanPhoto(segment, cacheGet, cacheSet)
      } catch (e) {
        console.warn('[van photo library]', e.message)
      }
    }

    // 3. Build the image. Preference order (Mark 2026-07-05):
    //      a. COMPOSITE — pixel-exact van cutout (van-cutouts/<name>.png in
    //         the site repo) placed onto a generated background with a ground
    //         shadow. Van authenticity guaranteed by construction, so no
    //         vision verification needed.
    //      b. SCENE-GEN — Gemini image-to-image + Claude-vision wrap verify
    //         (2 attempts). Usually fails verification; kept as second shot.
    //      c. REAL PHOTO — Mark's untouched upload. Always authentic.
    //    Then stamp the locked dark brand footer on whichever image wins.
    const { compositeVanFooter, compositeVanOnBackground, verifyVanWrap, verifyImageSane } = await import('../services/vanImageComposite.js')
    const { generateVanBackground } = await import('../services/nanoBanana.js')
    const { fetchBinaryFile } = await import('../services/brewArchive.js')
    let imageUrl = cachedContent?.image_url || null
    let imageError = null
    let imageSource = cachedContent?.image_url ? `cached:${cachedContent.image_source || 'same-day'}` : 'none'
    if (!imageUrl && captureImagesEnabled() && vanPhoto) {
      vanStep = 'image-build'
      let finalBuffer = null

      // (a) Composite path — needs a pre-cut cutout for this photo.
      const cutoutName = vanPhoto.name.replace(/\.[^.]+$/, '') + '.png'
      const cutout = await fetchBinaryFile({ path: `van-cutouts/${cutoutName}` }).catch(e => ({ ok: false, error: e.message }))
      if (cutout?.ok) {
        const bg = await generateVanBackground({ scenePrompt: draft.image_prompt }).catch(e => ({ ok: false, error: e.message }))
        if (bg?.ok) {
          try {
            finalBuffer = await compositeVanOnBackground({ cutoutBuffer: cutout.buffer, backgroundBuffer: bg.buffer })
            imageSource = `composite:${vanPhoto.name}`
          } catch (e) {
            console.warn('[van composite]', e.message)
          }
        } else {
          console.warn('[van background gen]', bg?.error)
        }
      }

      // (b) Scene-gen path with wrap verification.
      for (let attempt = 1; attempt <= 2 && !finalBuffer; attempt++) {
        const gen = await generateVanSceneImage({
          vanPhotoBuffer: vanPhoto.buffer,
          vanPhotoMime: vanPhoto.mimeType,
          scenePrompt: draft.image_prompt,
        }).catch(e => ({ ok: false, error: e.message }))
        if (!gen?.ok) { imageError = gen?.error || 'scene gen failed'; continue }
        const verdict = await verifyVanWrap(gen.buffer, gen.mimeType).catch(e => ({ ok: false, issues: [e.message] }))
        if (verdict.ok) {
          finalBuffer = gen.buffer
          imageSource = `scene:${vanPhoto.name} (verified, attempt ${attempt})`
        } else {
          console.warn('[van verify] attempt', attempt, 'failed:', verdict.issues.join('; '))
        }
      }

      // (c) Authenticity fallback: the real photo as-is.
      if (!finalBuffer) {
        finalBuffer = vanPhoto.buffer
        imageSource = `real-photo:${vanPhoto.name}`
      }

      try {
        const stamped = await compositeVanFooter(finalBuffer)
        // FINAL SANITY GATE (2026-07-05: a sideways EXIF-rotated photo hit
        // Facebook): Claude vision confirms the image is upright, the van is
        // the clear subject, wheels on the ground. Fail → NO image posts,
        // Cliq alert fires. Better a text-only post than a broken image.
        const sane = await verifyImageSane(stamped).catch(e => ({ ok: false, issues: [e.message] }))
        if (!sane.ok) {
          imageError = `sanity gate rejected image: ${sane.issues.join('; ')}`
          await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🚨 Van image BLOCKED by sanity gate (${imageSource}):\n${sane.issues.join('\n')}`).catch(() => {})
        } else {
          // Cloudinary primary — URL is live instantly. GitHub Pages builds
          // are rate-limited and took 10+ min on 2026-07-06, so platforms
          // fetching the image at publish time were hitting 404s.
          const { uploadImageToCloudinary, cloudinaryImageConfigured } = await import('../services/cloudinaryImage.js')
          const slug = `van-${todayDateStr}-${dayName.toLowerCase()}-${Date.now().toString(36)}`
          if (cloudinaryImageConfigured()) {
            const up = await uploadImageToCloudinary({ buffer: stamped, publicId: slug })
            if (up.ok) imageUrl = up.url
            else imageError = up.error
          }
          // GH commit kept as archive; also the fallback host if Cloudinary failed.
          const path = `capture-images/${slug}.jpg`
          const c = await commitBinaryFile({ path, buffer: stamped, message: `Van post image ${todayDateStr}` }).catch(e => ({ ok: false, error: e.message }))
          if (!imageUrl && c?.ok) imageUrl = `https://absoluteadas.com/${path}`
          else if (!imageUrl) imageError = imageError || c?.error || 'hosting failed'
        }
      } catch (e) {
        imageError = `footer composite failed: ${e.message}`
      }
      vanStep = 'content-write'
      // Persist today's content so any same-day re-run ships the identical post.
      if (imageUrl) {
        await cacheSet(segment, CONTENT_KEY, {
          headline: draft.headline, body: draft.body, image_prompt: draft.image_prompt,
          voice_score: draft.voice_score, angle: draft.angle, image_url: imageUrl, image_source: imageSource,
        }).catch(() => {})
      }
    } else if (captureImagesEnabled() && !vanPhoto) {
      imageError = 'no van photos in WorkDrive folder — upload photos to enable the image'
    }

    // 4. Fan to 3 channels at 6:30 AM PT (or now+5min if past).
    vanStep = 'enqueue'
    const CHANNELS = ['linkedin_personal', 'instagram_business', 'facebook_page']
    const scheduledFor = todayScheduledForAtTimePT(6, 30)
    const out = { day: dayName, angle: draft.angle, image_source: imageSource, drafts: [], skipped: [] }
    for (const channel of CHANNELS) {
      if (channelsAlreadyDone.has(channel)) {
        out.skipped.push({ channel, reason: 'already has a van post today' })
        continue
      }
      // IG requires an image — skip IG (not the whole run) if img failed.
      if (channel === 'instagram_business' && !imageUrl) {
        out.skipped.push({ channel, reason: `no image (${imageError || 'gen disabled'})` })
        continue
      }
      const entry = await enqueueDraft(req, {
        channel,
        category: 'van_field',
        headline: draft.headline,
        body: draft.body,
        scheduled_for: scheduledFor.toISOString(),
        voice_score: draft.voice_score,
        voice_deductions: draft.voice_deductions,
        meta: { slot: dayName, group: `van-${todayDateStr}`, image_prompt: draft.image_prompt || null, pillar: 'van_field' },
        status: 'approved',
      })
      if (imageUrl) await updateDraft(req, entry.id, { image_url: imageUrl, image_status: 'generated' })
      else await updateDraft(req, entry.id, { image_status: imageError ? 'failed' : 'disabled', image_error: imageError || undefined })
      out.drafts.push({ channel, id: entry.id, scheduled_for: scheduledFor.toISOString(), has_image: !!imageUrl })
    }

    const card = [
      `🚐 *VAN POST DRAFTED* — ${dayName} ${todayDateStr} (${draft.angle})`,
      `${out.drafts.length} channel${out.drafts.length === 1 ? '' : 's'}, image: ${imageSource}${imageError ? ` ⚠️ ${imageError}` : ''}`,
      ``,
      `*${draft.headline}*`,
      draft.body,
      ...(imageUrl ? [``, `🖼️ ${imageUrl}`] : []),
    ].join('\n')
    postToCliqChannelById(MARK_ALERT_CHANNEL_ID, card).catch(() => {})

    await stampSuccess(req, 'van_post', { day: dayName, drafts: out.drafts.length, image: imageSource })
    res.json({ ok: true, ...out, headline: draft.headline, body: draft.body, image_url: imageUrl })
  } catch (e) {
    await reportCronFailure(req, 'van_post', e)
    res.json({ ok: false, error: e.message, step: vanStep, code: e.code || e.errorInfo?.error_code || null, info: e.errorInfo || null, stack: (e.stack || '').split('\n').slice(0, 4) })
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

    // TIME-BOXED (2026-08-01): this used to walk EVERY published draft
    // from the last 30 days sequentially — one external API call each —
    // and blew Catalyst's 30s gateway cap every run. 20 consecutive
    // timeouts got the cron auto-disabled. Now each run takes the
    // least-recently-checked posts, caps the batch, and returns fast;
    // the hourly schedule rotates through the rest.
    const RUN_STARTED = Date.now()
    const TIME_BUDGET_MS = 20_000
    const MAX_PER_RUN = 8
    const eligible = published
      .filter(d => (Date.now() - new Date(d.published_at || d.created_at).getTime()) <= 30 * 86400000)
      .sort((a, b) =>
        new Date(a.engagement_checked_at || a.engagement?.checked_at || 0) -
        new Date(b.engagement_checked_at || b.engagement?.checked_at || 0))
    let attempted = 0

    for (const draft of eligible) {
      if (attempted >= MAX_PER_RUN || (Date.now() - RUN_STARTED) > TIME_BUDGET_MS) break
      attempted++
      const stampNow = new Date().toISOString()

      const engagement = await collectForDraft(draft)
      if (!engagement) {
        // Still stamp the check — otherwise no-data drafts sit at the
        // front of the least-recently-checked queue and hog every batch.
        await updateDraft(req, draft.id, { engagement_checked_at: stampNow })
        out.push({ id: draft.id, channel: draft.channel, skipped: 'no_data' })
        continue
      }

      // Apply kill rules
      const killCheck = applyKillRules({ ...draft, engagement })
      const patch = { engagement, engagement_checked_at: stampNow }
      if (killCheck.kill) {
        patch.status = 'killed_by_engagement'
        patch.kill_reason = killCheck.reason
      }
      await updateDraft(req, draft.id, patch)
      out.push({ id: draft.id, channel: draft.channel, killed: !!killCheck.kill, reason: killCheck.reason })
    }
    await stampSuccess(req, 'capture_engagement', { processed: out.length, of: eligible.length })
    res.json({ ok: true, processed: out.length, of: eligible.length, results: out })
  } catch (e) {
    await reportCronFailure(req, 'capture_engagement', e)
    res.json({ ok: false, error: e.message, partial: out })
  }
})

// ─── LINKEDIN COMMENT WATCHER ───────────────────────────────────────────────
// For every LinkedIn post Mark published in the last 7 days, fetch the
// current comment list and compare against the seen-list in cache. For each
// new comment, ping Mark in Cliq with the comment text + reply URL.
//
//   GET/POST /api/capture-calc/linkedin/comments/check   (cron-secret)
//
// Runs hourly via GH Actions. Idempotent — a comment is only notified once
// (cache key li_comments_seen_{platformId} tracks notified ids).
captureCalcRouter.all('/linkedin/comments/check', heartbeatAttempt('li_comments'), requireCronSecretFlex, async (req, res) => {
  const out = []
  try {
    const segment = getSegment(req)
    const { fetchPostComments, fetchAuthorName } = await import('../services/linkedInComments.js')
    const published = await listQueue(req, { status: 'published' })
    const cutoff = Date.now() - 7 * 86400000
    const recentLi = published.filter(d =>
      d.channel === 'linkedin_personal' &&
      d.platform_id &&
      new Date(d.published_at || d.created_at).getTime() >= cutoff
    )

    for (const draft of recentLi) {
      const cacheKey = `li_comments_seen_${draft.platform_id}`
      const seenBlob = await cacheGet(segment, cacheKey, null)
      const seen = new Set(Array.isArray(seenBlob?.ids) ? seenBlob.ids : [])
      const firstPass = !seenBlob

      let comments
      try {
        comments = await fetchPostComments(draft.platform_id)
      } catch (e) {
        out.push({ draftId: draft.id, urn: draft.platform_id, error: e.message })
        continue
      }

      const newOnes = comments.filter(c => c.id && !seen.has(c.id))
      // On the FIRST pass for a post we DO NOT spam Mark with historical
      // comments — just seed the cache. Going forward, only genuinely new
      // comments fire alerts.
      if (firstPass) {
        await cacheSet(segment, cacheKey, { ids: comments.map(c => c.id), updated_at: new Date().toISOString(), seeded: true })
        out.push({ draftId: draft.id, urn: draft.platform_id, total: comments.length, new: 0, seeded: true })
        continue
      }

      for (const c of newOnes) {
        const author = await fetchAuthorName(c.authorUrn).catch(() => '')
        const liUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(draft.platform_id)}/`
        const headline = draft.headline || draft.body?.slice(0, 60) || '(LinkedIn post)'
        const msg = [
          `💬 *New comment on your LinkedIn post*`,
          `_${headline}_`,
          ``,
          `${author ? `*${author}:* ` : ''}${c.message.slice(0, 300)}${c.message.length > 300 ? '…' : ''}`,
          ``,
          `Reply: ${liUrl}`,
        ].join('\n')
        await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg).catch(() => {})
      }

      // Update seen-list with the full current set of comment IDs.
      await cacheSet(segment, cacheKey, { ids: comments.map(c => c.id), updated_at: new Date().toISOString() })
      out.push({ draftId: draft.id, urn: draft.platform_id, total: comments.length, new: newOnes.length })
    }

    await stampSuccess(req, 'li_comments', { posts_checked: out.length, new_comments: out.reduce((s, r) => s + (r.new || 0), 0) })
    res.json({ ok: true, processed: out.length, results: out })
  } catch (e) {
    await reportCronFailure(req, 'li_comments', e)
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
// ── LINKEDIN OUTREACH (wingman, not a bot) ─────────────────────────────────
// Weekday-morning Cliq card: ~10 CRM shops to connect with, each with a
// LinkedIn people-search link + ready-to-paste invite note in Mark's voice.
// MARK sends everything by hand on linkedin.com — nothing here automates
// LinkedIn (that's how the IG account died). See services/linkedInOutreach.js.
captureCalcRouter.all('/li-outreach/run', heartbeatAttempt('li_outreach'), requireCronSecretFlex, async (req, res) => {
  try {
    const dayPt = new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
    if (['Sat', 'Sun'].includes(dayPt) && req.query.force !== '1') {
      await stampSuccess(req, 'li_outreach', { skipped: 'weekend' })
      return res.json({ ok: true, skipped: true, reason: 'weekend' })
    }
    const { pickOutreachBatch, draftInviteNotes, formatOutreachCard, readOutreachState, writeOutreachState } =
      await import('../services/linkedInOutreach.js')
    const { getAllShops } = await import('./shops.js')

    const dry = req.query.dry === '1'
    const count = Math.max(1, Math.min(15, Number(req.query.count) || 10))
    const shops = await getAllShops(req)
    const state = await readOutreachState(req)
    const batch = pickOutreachBatch({ shops, state, count })
    if (!batch.length) {
      await stampSuccess(req, 'li_outreach', { skipped: 'list exhausted' })
      return res.json({ ok: true, skipped: true, reason: 'no un-suggested shops left', total_shops: shops.length })
    }
    const items = await draftInviteNotes({ targets: batch })
    const card = formatOutreachCard({ items })
    if (!dry) {
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, card)
      const suggested = { ...(state.suggested || {}) }
      const now = new Date().toISOString()
      for (const t of items) suggested[t.shop_id] = now
      await writeOutreachState(req, { ...state, suggested })
    }
    await stampSuccess(req, 'li_outreach', { sent: items.length, dry })
    res.json({ ok: true, dry, count: items.length, items: dry ? items : items.map(t => ({ shop: t.shop_name, contact: t.contact_name })) })
  } catch (e) {
    await reportCronFailure(req, 'li_outreach', e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Phone-friendly form: paste a new connection's name, get a welcome DM draft
// to copy into LinkedIn. Text generation only — no auth needed, nothing to leak.
captureCalcRouter.all('/debug/li-welcome', async (req, res) => {
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  let draftHtml = ''
  const name = String(req.body?.name || req.query.name || '').trim()
  const company = String(req.body?.company || req.query.company || '').trim()
  const context = String(req.body?.context || req.query.context || '').trim()
  if (name) {
    try {
      const { draftWelcomeMessage } = await import('../services/linkedInOutreach.js')
      const message = await draftWelcomeMessage({ name, company, context })
      draftHtml = `<label>Draft — long-press to copy</label>
        <textarea id="out" rows="5" readonly onclick="this.select()">${esc(message)}</textarea>
        <button type="button" onclick="navigator.clipboard.writeText(document.getElementById('out').value).then(()=>this.textContent='Copied ✓')">Copy</button>`
    } catch (e) {
      draftHtml = `<p style="color:#b91c1c">Draft failed: ${esc(e.message)}</p>`
    }
  }
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LinkedIn Welcome — Absolute ADAS</title><style>
body{font-family:-apple-system,Helvetica,Arial,sans-serif;background:#0d0d0d;color:#f5f5f5;margin:0;padding:24px;max-width:520px;margin:0 auto}
h1{font-size:20px}h1 span{color:#CD4419}
label{display:block;font-size:13px;color:#9ca3af;margin:14px 0 4px}
input,textarea{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #333;background:#1a1a1a;color:#f5f5f5;font-size:16px}
button{margin-top:14px;width:100%;padding:14px;border:0;border-radius:8px;background:#CD4419;color:#fff;font-size:16px;font-weight:700}
</style></head><body>
<h1>Absolute <span>ADAS</span> — LinkedIn welcome</h1>
<form method="POST">
<label>Their name</label><input name="name" value="${esc(name)}" placeholder="Jake Arnold" required>
<label>Company (optional)</label><input name="company" value="${esc(company)}" placeholder="Gerber Collision, Tacoma">
<label>Anything to work in? (optional)</label><input name="context" value="${esc(context)}" placeholder="commented on the van post">
<button type="submit">Draft the message</button>
</form>
${draftHtml}
</body></html>`)
})

const DEBUG_FORWARD_WHITELIST = {
  'draft-meta-week':     '/api/capture-calc/meta/draft-week?force=1',
  'draft-meta-day':      '/api/capture-calc/meta/draft-day',
  'draft-linkedin-week': '/api/capture-calc/linkedin/draft-week-variants?force=1',
  'nurture-run':         '/api/capture-calc/nurture/run',
  'cron-monitor-run':    '/api/cron-monitor/run',
  'holiday-poster-run':  '/api/holiday-poster/run',
  'engagement-run':      '/api/capture-calc/engagement/run',
  'li-comments-check':   '/api/capture-calc/linkedin/comments/check',
  'brew-run-bonus':      '/api/cron/brew/run-bonus',
  'van-draft-day':       '/api/capture-calc/van/draft-day',
  'weekly-run':          '/api/capture-calc/report/weekly?force=1',
  'scheduler-run-raw':   '/api/capture-calc/scheduler/run',
  'li-outreach-run':     '/api/capture-calc/li-outreach/run',
}
async function debugForward(req, res, target) {
  const secret = process.env.BREW_CRON_SECRET
  if (!secret) return res.status(500).json({ ok: false, error: 'BREW_CRON_SECRET not set on function' })
  const base = `https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api`
  // Pass through query params from the debug request (e.g. ?force_relock=1
  // or ?type=story) onto the forwarded target. Without this, debug-only
  // overrides get silently dropped at the forward layer.
  const forwardedParams = new URLSearchParams()
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k === 'secret') continue
    forwardedParams.set(k, String(v))
  }
  forwardedParams.set('secret', secret)
  const sep = target.includes('?') ? '&' : '?'
  const url = `${base}${target}${sep}${forwardedParams.toString()}`
  try {
    // 250s — gateway will 504 at 30s for the OUTER curl, but the called
    // handler keeps running server-side. Poll /debug/state to watch progress.
    // Send the secret as a header too — some downstream routes (e.g. the
    // strict requireCronSecret on the brew router) accept ONLY the header
    // and ignore the query-string version.
    const r = await axios.post(url, {}, {
      timeout: 250000,
      validateStatus: () => true,
      headers: { 'x-cron-secret': secret },
    })
    res.json({ ok: true, debug: true, forwarded: true, url: target, status: r.status, data: r.data })
  } catch (e) {
    res.json({ ok: true, debug: true, forwarded: true, url: target, note: 'outer timed out; inner may still be running', error: e.message })
  }
}
captureCalcRouter.all('/debug/draft-meta-week',     (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['draft-meta-week']))
captureCalcRouter.all('/debug/draft-meta-day',      (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['draft-meta-day']))
captureCalcRouter.all('/debug/draft-linkedin-week', (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['draft-linkedin-week']))
captureCalcRouter.all('/debug/nurture-run',         (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['nurture-run']))
captureCalcRouter.all('/debug/cron-monitor-run',    async (req, res) => {
  // Self-healing (2026-07-07): the aa_* marketing crons live inside Catalyst;
  // the long drafters 408 at the 30s gateway, which Catalyst counts as
  // failures and auto-disables after 20 in a row. This hook runs hourly via
  // aa_hourly_monitor and flips any disabled aa_* cron back on — fully
  // Catalyst-native, no GitHub dependency. Best-effort: never blocks the scan.
  try {
    const catalystMod = (await import('zcatalyst-sdk-node')).default
    const cronApi = catalystMod.initialize(req).cron()
    const all = await cronApi.getAllCron()
    for (const c of (all || [])) {
      const disabled = c.status === false || c.cron_status === false
      if (String(c.cron_name || '').startsWith('aa_') && disabled) {
        await cronApi.updateCron({ ...c, status: true, cron_status: true }).catch(e =>
          console.warn(`[cron-revive] ${c.cron_name} failed: ${e.message}`))
        console.warn(`[cron-revive] re-enabled ${c.cron_name}`)
      }
    }
  } catch (e) { console.warn('[cron-revive] skipped:', e.message) }
  return debugForward(req, res, DEBUG_FORWARD_WHITELIST['cron-monitor-run'])
})
captureCalcRouter.all('/debug/holiday-poster-run',  (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['holiday-poster-run']))
captureCalcRouter.all('/debug/engagement-run',      (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['engagement-run']))
captureCalcRouter.all('/debug/li-comments-check',   (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['li-comments-check']))
captureCalcRouter.all('/debug/brew-run-bonus',      (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['brew-run-bonus']))
captureCalcRouter.all('/debug/van-draft-day',       (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['van-draft-day']))
captureCalcRouter.all('/debug/weekly-run',          (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['weekly-run']))
captureCalcRouter.all('/debug/scheduler-run-raw',   (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['scheduler-run-raw']))
captureCalcRouter.all('/debug/li-outreach-run',     (req, res) => debugForward(req, res, DEBUG_FORWARD_WHITELIST['li-outreach-run']))

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
    // ?image_url=<url> — pin the draft's image (used to force identical
    // images across channels after a per-channel repair).
    const newImageUrl = String(req.query.image_url || '').trim()
    if (newImageUrl) { patch.image_url = newImageUrl; patch.image_status = 'generated' }
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

// List all photos in the van WorkDrive folder, or stream one by id.
// Used by the local cutout workflow (Apple Vision segmentation runs on
// Mark's Mac; cutouts get committed to the site repo as van-cutouts/*.png).
//   GET /debug/van-photos            → [{id, name}]
//   GET /debug/van-photos?id=XYZ     → raw image bytes
captureCalcRouter.get('/debug/van-photos', async (req, res) => {
  try {
    const { listVanPhotos, downloadVanPhoto } = await import('../services/vanPhotoLibrary.js')
    const id = String(req.query.id || '')
    if (id) {
      const { buffer, mimeType } = await downloadVanPhoto(id)
      res.set('Content-Type', mimeType)
      return res.send(buffer)
    }
    res.json({ ok: true, photos: await listVanPhotos() })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Catalyst dynamic-cron setup — creates the marketing cron schedule inside
// Catalyst itself via the SDK (old Cloud Scale cron component; the newer Job
// Scheduling service needs a console-created job pool, defeating the point).
// These are URL-type crons hitting the no-auth /debug/* forwarders.
//   GET /debug/setup-crons?list=1   → dump existing crons (learn/verify)
//   GET /debug/setup-crons?create=1 → create the marketing crons (skips existing)
//   GET /debug/setup-crons?revive=1 → re-enable any disabled aa_* cron
//     (long drafters 408 at the 30s gateway; if Catalyst ever racks up 20
//      consecutive "failures" and auto-disables, this flips them back on)
captureCalcRouter.get('/debug/setup-crons', async (req, res) => {
  try {
    const catalystMod = (await import('zcatalyst-sdk-node')).default
    const cronApi = catalystMod.initialize(req).cron()
    const TZ = 'America/Los_Angeles'
    const SELF = 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api/api/capture-calc/debug'

    if (req.query.list === '1') {
      const all = await cronApi.getAllCron()
      return res.json({ ok: true, count: all?.length, crons: all })
    }

    if (req.query.revive === '1') {
      const all = await cronApi.getAllCron()
      const revived = []
      for (const c of (all || [])) {
        const disabled = c.status === false || c.cron_status === false
        if (String(c.cron_name || '').startsWith('aa_') && disabled) {
          try {
            await cronApi.updateCron({ ...c, status: true, cron_status: true })
            revived.push(c.cron_name)
          } catch (e) {
            revived.push(`${c.cron_name}: FAILED ${e.message}`)
          }
        }
      }
      return res.json({ ok: true, revived })
    }

    if (req.query.create === '1') {
      const WANT = [
        { cron_name: 'aa_hourly_publisher', path: 'run-scheduler',   type: 'periodic', intervalHours: 1 },
        { cron_name: 'aa_hourly_nurture',   path: 'nurture-run',     type: 'periodic', intervalHours: 1 },
        { cron_name: 'aa_hourly_monitor',   path: 'cron-monitor-run', type: 'periodic', intervalHours: 1 },
        // Long drafters get 3 staggered attempts: Catalyst's cron daemon kills
        // the handler at the 30s gateway timeout, but both routes persist
        // progress (caption/story/image) to a same-day cache, so each attempt
        // resumes where the last died. On good days attempts 2-3 hit the
        // idempotence guard and return fast (which also resets failure streaks).
        { cron_name: 'aa_van_post',         path: 'van-draft-day',   type: 'daily', hour: 6, minute: 1 },
        { cron_name: 'aa_van_post_r2',      path: 'van-draft-day',   type: 'daily', hour: 6, minute: 5 },
        { cron_name: 'aa_van_post_r3',      path: 'van-draft-day',   type: 'daily', hour: 6, minute: 9 },
        { cron_name: 'aa_daily_drafters',   path: 'draft-meta-day',  type: 'daily', hour: 6, minute: 13 },
        { cron_name: 'aa_drafters_r2',      path: 'draft-meta-day',  type: 'daily', hour: 6, minute: 17 },
        { cron_name: 'aa_drafters_r3',      path: 'draft-meta-day',  type: 'daily', hour: 6, minute: 21 },
        { cron_name: 'aa_daily_tasks',      path: 'engagement-run',  type: 'daily', hour: 6, minute: 23 },
        { cron_name: 'aa_li_outreach',      path: 'li-outreach-run', type: 'daily', hour: 7, minute: 45 },
        { cron_name: 'aa_holiday_poster',   path: 'holiday-poster-run', type: 'daily', hour: 6, minute: 27 },
        { cron_name: 'aa_li_comments',      path: 'li-comments-check', type: 'daily', hour: 8, minute: 15 },
        { cron_name: 'aa_weekly_report',    path: 'weekly-run',      type: 'weekly', hour: 7, minute: 17, weekDay: 6 }, // Catalyst week_day: 1=Sun … 6=Fri
      ]
      const existing = await cronApi.getAllCron().catch(() => [])
      const existingNames = new Set((existing || []).map(c => c.cron_name))
      const out = []
      for (const w of WANT) {
        if (existingNames.has(w.cron_name)) { out.push({ cron: w.cron_name, skipped: 'exists' }); continue }
        const base = {
          cron_name: w.cron_name,
          description: `Absolute ADAS marketing: ${w.path} (created programmatically 2026-07-07)`,
          status: true,
          cron_url_details: { url: `${SELF}/${w.path}`, request_method: 'GET' },
        }
        let payload
        if (w.type === 'periodic') {
          payload = { ...base, cron_type: 'Periodic', job_detail: { hour: w.intervalHours, minute: 0, second: 0, repetition_type: 'every' } }
        } else if (w.type === 'weekly') {
          // NB: server wants "Calendar"/"Weekly" — the SDK enum's "Calender" is rejected
          payload = { ...base, cron_type: 'Calendar', job_detail: { repetition_type: 'Weekly', hour: w.hour, minute: w.minute, second: 0, week_day: [w.weekDay], timezone: TZ } }
        } else {
          payload = { ...base, cron_type: 'Calendar', job_detail: { repetition_type: 'Daily', hour: w.hour, minute: w.minute, second: 0, timezone: TZ } }
        }
        try {
          const r = await cronApi.createCron(payload)
          out.push({ cron: w.cron_name, ok: true, id: r?.id })
        } catch (e) {
          out.push({ cron: w.cron_name, ok: false, error: String(e.message).slice(0, 300) })
        }
      }
      return res.json({ ok: true, results: out })
    }

    // Live-fire test: create a cron that fires ~4 min from now at a harmless
    // idempotent endpoint, so the daily-cron mechanism is proven TODAY instead
    // of discovering a config problem at 6 AM tomorrow.
    //   ?testfire=1  → create aa_test_fire (OneTime, now+4min; falls back to Calendar Daily)
    //   ?teststatus=1 → success/failure counts for every aa_* cron
    //   ?testclean=1 → delete aa_test_fire
    if (req.query.testfire === '1' || req.query.testfire === 'calendar') {
      const calendarMode = req.query.testfire === 'calendar'
      const base = {
        cron_name: calendarMode ? 'aa_test_fire2' : 'aa_test_fire',
        description: 'TEMP live-fire test of Catalyst dynamic crons — safe to delete',
        status: true,
        cron_url_details: { url: `${SELF}/run-scheduler`, request_method: 'GET' },
      }
      if (calendarMode) {
        // Exact same shape as the production 6:01 AM crons (Calendar Daily, PT)
        const pt = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))
        pt.setMinutes(pt.getMinutes() + 4)
        const jd = { repetition_type: 'Daily', hour: pt.getHours(), minute: pt.getMinutes(), second: 0, timezone: TZ }
        const r2 = await cronApi.createCron({ ...base, cron_type: 'Calendar', job_detail: jd })
        return res.json({ ok: true, mode: 'CalendarDaily', id: r2?.id, fires_at_pt: `${jd.hour}:${String(jd.minute).padStart(2, '0')}` })
      }
      const fireAt = Date.now() + 4 * 60000
      const r = await cronApi.createCron({ ...base, cron_type: 'OneTime', job_detail: { time_of_execution: String(fireAt), timezone: TZ } })
      return res.json({ ok: true, mode: 'OneTime', id: r?.id, fires_at: new Date(fireAt).toISOString() })
    }

    if (req.query.teststatus === '1') {
      const all = await cronApi.getAllCron()
      const rows = (all || []).filter(c => String(c.cron_name || '').startsWith('aa_'))
        .map(c => ({ name: c.cron_name, active: c.cron_status ?? c.status, success: c.success_count, failure: c.failure_count }))
      return res.json({ ok: true, crons: rows })
    }

    if (req.query.testclean === '1') {
      const all = await cronApi.getAllCron()
      const out = []
      for (const name of ['aa_test_fire', 'aa_test_fire2']) {
        const t = (all || []).find(c => c.cron_name === name)
        if (!t) { out.push({ name, deleted: false, note: 'not found' }); continue }
        await cronApi.deleteCron(t.id)
        out.push({ name, deleted: true, final_counts: { success: t.success_count, failure: t.failure_count } })
      }
      return res.json({ ok: true, results: out })
    }

    res.json({ ok: false, error: 'pass ?list=1, ?create=1, ?revive=1, ?testfire=1, ?teststatus=1 or ?testclean=1' })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, stack: String(e.stack).split('\n').slice(0, 4) })
  }
})

// Catalyst admin API explorer — lists this project's cron jobs and functions
// using the admin cred token the gateway injects into every request. Used to
// learn the exact payload shape before creating crons programmatically.
//   GET /debug/catalyst-crons
captureCalcRouter.get('/debug/catalyst-crons', async (req, res) => {
  try {
    const axios = (await import('axios')).default
    const token = req.headers['x-zc-admin-cred-token'] || ''
    const projectId = req.headers['x-zc-projectid'] || process.env.CATALYST_PROJECT_ID || ''
    if (!token || !projectId) return res.json({ ok: false, error: 'no admin cred token / project id on request', have_token: !!token, have_project: !!projectId })
    const hdr = { Authorization: `Catalyst-Cred-Token ${token}` }
    const get = (path) => axios.get(`https://api.catalyst.zoho.com${path}`, { headers: hdr, timeout: 15000, validateStatus: s => s < 500 })
    const [crons, fns] = await Promise.all([
      get(`/baas/v1/project/${projectId}/cron`),
      get(`/baas/v1/project/${projectId}/function`),
    ])
    res.json({
      ok: true,
      crons: { http: crons.status, data: crons.data },
      functions: { http: fns.status, data: (Array.isArray(fns.data?.data) ? fns.data.data : fns.data)?.map?.(f => ({ id: f.id, name: f.function_name || f.name, type: f.type })) ?? fns.data },
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Watchdog alert relay — lets the external daily pipeline-watchdog (Claude
// scheduled routine) post a short status line to Mark's Cliq alert channel.
// No-auth like the rest of /debug/*; message is length-capped and prefixed so
// it can't impersonate other alert types.  GET /debug/alert-mark?msg=...
captureCalcRouter.get('/debug/alert-mark', async (req, res) => {
  try {
    const msg = String(req.query.msg || '').slice(0, 500).trim()
    if (!msg) return res.status(400).json({ ok: false, error: 'msg required' })
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🤖 *Pipeline watchdog:* ${msg}`)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// GitHub Actions health check — reports the marketing-crons workflow state
// (active vs disabled) and its recent runs, so a silent scheduler morning is
// diagnosable without the gh CLI.  GET /debug/gh-actions-status
captureCalcRouter.get('/debug/gh-actions-status', async (req, res) => {
  try {
    const axios = (await import('axios')).default
    const token = process.env.GITHUB_TOKEN || ''
    if (!token) return res.json({ ok: false, error: 'GITHUB_TOKEN not set' })
    const gh = (path) => axios.get(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      timeout: 15000, validateStatus: s => s < 500,
    })
    const repoFull = 'markfowler01/ADAS-IQ'
    const [wf, runs, repoInfo] = await Promise.all([
      gh(`/repos/${repoFull}/actions/workflows/marketing-crons.yml`),
      gh(`/repos/${repoFull}/actions/workflows/marketing-crons.yml/runs?per_page=10`),
      gh(`/repos/${repoFull}`),
    ])
    res.json({
      ok: true,
      workflow_state: wf.data?.state ?? `HTTP ${wf.status}`,
      workflow_path: wf.data?.path,
      default_branch: repoInfo.data?.default_branch ?? `HTTP ${repoInfo.status}`,
      recent_runs: (runs.data?.workflow_runs || []).map(r => ({
        started: r.run_started_at, event: r.event, status: r.status,
        conclusion: r.conclusion, branch: r.head_branch,
      })),
      runs_http: runs.status,
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Rehost an already-committed repo image on Cloudinary (instant URL) —
// used when GitHub Pages is too slow to serve a freshly committed image.
//   GET /debug/van-rehost?file=capture-images/x.jpg
captureCalcRouter.get('/debug/van-rehost', async (req, res) => {
  try {
    const { fetchBinaryFile } = await import('../services/brewArchive.js')
    const { uploadImageToCloudinary } = await import('../services/cloudinaryImage.js')
    const file = String(req.query.file || '').trim()
    if (!file) return res.status(400).json({ ok: false, error: 'file required' })
    const f = await fetchBinaryFile({ path: file })
    if (!f?.ok) return res.json({ ok: false, error: `repo fetch failed: ${f?.error}` })
    const up = await uploadImageToCloudinary({ buffer: f.buffer, publicId: file.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) })
    res.json(up)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Clear a day's cached van post content (used when a bad run poisons the
// same-day reuse cache). GET /debug/van-clear-content?date=YYYY-MM-DD
captureCalcRouter.get('/debug/van-clear-content', async (req, res) => {
  try {
    const segment = getSegment(req)
    const date = String(req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
    await cacheSet(segment, `van_content_${date}`, '')
    res.json({ ok: true, cleared: `van_content_${date}` })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Delete a Facebook Page post by id — for pulling a broken-image post
// before republishing the corrected one. GET /debug/fb-delete-post?id=<postId>
captureCalcRouter.get('/debug/fb-delete-post', async (req, res) => {
  try {
    const { deleteFacebookPagePost } = await import('../services/metaPosting.js')
    const id = String(req.query.id || '').trim()
    if (!id) return res.status(400).json({ ok: false, error: 'id required' })
    res.json(await deleteFacebookPagePost({ postId: id }))
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Run the FULL van image pipeline (real photo → scene gen → wrap verify →
// footer stamp → hosted URL) WITHOUT enqueueing or posting anything.
// Mark uses this to eyeball a sample before trusting the daily cron.
//   GET /debug/van-image-test?day=Mon        (scene-gen + verify + footer)
//   GET /debug/van-image-test?raw=1          (skip scene gen: real photo + footer only)
captureCalcRouter.get('/debug/van-image-test', async (req, res) => {
  try {
    const segment = getSegment(req)
    const { draftVanPost, todayDayName } = await import('../services/vanPostDrafter.js')
    const { pickNextVanPhoto } = await import('../services/vanPhotoLibrary.js')
    const { generateVanSceneImage } = await import('../services/nanoBanana.js')
    const { compositeVanFooter, verifyVanWrap } = await import('../services/vanImageComposite.js')
    const { commitBinaryFile } = await import('../services/brewArchive.js')

    const dayName = String(req.query.day || todayDayName())
    const rawOnly = req.query.raw === '1'
    const wantComposite = req.query.mode === 'composite'

    const vanPhoto = await pickNextVanPhoto(segment, cacheGet, cacheSet)
    if (!vanPhoto) return res.json({ ok: false, error: 'no van photos in the WorkDrive folder yet' })

    let buffer = vanPhoto.buffer
    let source = `real-photo:${vanPhoto.name}`
    let verdict = null
    if (wantComposite) {
      const { compositeVanOnBackground } = await import('../services/vanImageComposite.js')
      const { generateVanBackground } = await import('../services/nanoBanana.js')
      const { fetchBinaryFile } = await import('../services/brewArchive.js')
      const draft = await draftVanPost({ dayName, targetDate: new Date().toISOString() })
      const cutoutName = vanPhoto.name.replace(/\.[^.]+$/, '') + '.png'
      const cutout = await fetchBinaryFile({ path: `van-cutouts/${cutoutName}` })
      if (!cutout?.ok) return res.json({ ok: false, error: `no cutout for ${vanPhoto.name} (${cutout?.error})`, photo: vanPhoto.name })
      const bg = await generateVanBackground({ scenePrompt: draft.image_prompt })
      if (!bg?.ok) return res.json({ ok: false, error: `background gen failed: ${bg?.error}` })
      buffer = await compositeVanOnBackground({ cutoutBuffer: cutout.buffer, backgroundBuffer: bg.buffer })
      source = `composite:${vanPhoto.name}`
    } else if (!rawOnly) {
      const draft = await draftVanPost({ dayName, targetDate: new Date().toISOString() })
      const gen = await generateVanSceneImage({
        vanPhotoBuffer: vanPhoto.buffer, vanPhotoMime: vanPhoto.mimeType, scenePrompt: draft.image_prompt,
      })
      if (gen?.ok) {
        verdict = await verifyVanWrap(gen.buffer, gen.mimeType).catch(e => ({ ok: false, issues: [e.message] }))
        if (verdict.ok) { buffer = gen.buffer; source = `scene:${vanPhoto.name}` }
        else source = `real-photo:${vanPhoto.name} (scene REJECTED by verifier)`
      } else {
        source = `real-photo:${vanPhoto.name} (scene gen error: ${gen?.error})`
      }
    }
    const stamped = await compositeVanFooter(buffer)
    const path = `capture-images/van-test-${Date.now().toString(36)}.jpg`
    const c = await commitBinaryFile({ path, buffer: stamped, message: 'Van image pipeline test' })
    if (!c?.ok) return res.json({ ok: false, error: c?.error || 'github commit failed' })
    res.json({ ok: true, day: dayName, source, verifier: verdict, image_url: `https://absoluteadas.com/${path}` })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Preview a van-in-the-field post WITHOUT enqueueing or generating an image.
// Returns headline + body + image_prompt so Mark can react to the copy
// before the daily van cron fires it for real.
//   GET /debug/van-preview?day=Mon
captureCalcRouter.get('/debug/van-preview', async (req, res) => {
  try {
    const { draftVanPost, todayDayName } = await import('../services/vanPostDrafter.js')
    const dayName = String(req.query.day || todayDayName())
    const draft = await draftVanPost({ dayName, targetDate: new Date().toISOString() })
    res.json({ ok: true, day: dayName, ...draft, body_word_count: draft.body.split(/\s+/).length })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Preview the unified daily post WITHOUT enqueueing or generating an image.
// Returns the headline + body + image_prompt so Mark can verify the unified
// drafter is producing good copy before tomorrow's cron fires it for real.
//   GET /debug/unified-preview?type=story|framework|case_study&day=Sat
captureCalcRouter.get('/debug/unified-preview', async (req, res) => {
  try {
    const segment = getSegment(req)
    const dayName = String(req.query.day || new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' }))
    const type = String(req.query.type || UNIFIED_DAY_TYPE_FOR(dayName))
    let story = String(req.query.story || '').trim()
    let caseStudy = String(req.query.caseStudy || '').trim()
    if (!story) {
      const blob = await cacheGet(segment, 'capture_weekly_story_current', null)
      story = String(blob?.story || '')
    }
    if (!caseStudy) {
      const blob = await cacheGet(segment, 'capture_weekly_case_study', null)
      caseStudy = String(blob?.value || '')
    }
    if (!story) {
      const recentBlob = await cacheGet(segment, 'capture_story_history', null)
      const recentStories = Array.isArray(recentBlob?.stories) ? recentBlob.stories : []
      story = await generateWeeklyStory({ recentStories })
    }
    const unified = await draftUnifiedDailyPost({ story, caseStudy, type, day: dayName, targetDate: new Date().toISOString() })
    res.json({ ok: true, day: dayName, type, ...unified, body_word_count: unified.body.split(/\s+/).length })
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
// ─── From the Van Magic Lantern (7-day partnership pitch nurture) ───────────
//
// Enrollment records live in Catalyst Cache under `van_nurture_enrollments`
// as an array of { email, name?, shop?, enrolled_at, nurture_sent[] }.
// The cron reads all enrollments daily, computes each one's current day,
// and sends the corresponding email (once per day per subscriber).
//
// NOTE: with only enrollment tracking in cache, we're back to the "cache
// can expire" risk. Keeping it simple for now — if we see attrition, migrate
// to Datastore like we did with the marketing queue.

// Enrollments are now stored in Datastore (VanKV table) not Cache. See
// services/vanDatastore.js. Chunked at 30 records per row — records are
// ~400 bytes each with all the metadata fields, so 30×400 = ~12KB per
// chunk, well under the 30KB safe cap.
const VAN_ENROLLMENTS_BASEKEY = 'van_enrollments'
const VAN_ENROLLMENTS_CHUNK_SIZE = 30

async function readVanEnrollments(req) {
  const { readChunkedArray } = await import('../services/vanDatastore.js')
  return await readChunkedArray(req, VAN_ENROLLMENTS_BASEKEY)
}
async function writeVanEnrollments(req, list) {
  const { writeChunkedArray } = await import('../services/vanDatastore.js')
  return await writeChunkedArray(req, VAN_ENROLLMENTS_BASEKEY, list, { chunkSize: VAN_ENROLLMENTS_CHUNK_SIZE })
}

async function enrollVanSubscriber(req, { email, name, shop, cohort, source }) {
  const clean = String(email || '').trim().toLowerCase()
  if (!clean || !/^\S+@\S+\.\S+$/.test(clean)) return { ok: false, error: 'valid email required' }
  const list = await readVanEnrollments(req)
  const existing = list.find(e => e.email === clean)
  if (existing) return { ok: true, duplicate: true, enrolled_at: existing.enrolled_at }
  const entry = {
    email: clean,
    // Trim aggressively — storage-only fields, personalization uses just first name
    name: String(name || '').slice(0, 40),
    enrolled_at: new Date().toISOString(),
    nurture_sent: [],
    // 'signup' → future contacts Mark just met in person, gets Day-1 signup variant
    // 'backfill' → seeded from an existing warm list (default), gets Day-1 backfill variant
    cohort: cohort === 'signup' ? 'signup' : 'backfill',
    source: String(source || '').slice(0, 40),
    // NEW signups get their Magic Lantern Day 1 delayed 24h so the welcome
    // email + pricing sheet lands first. Backfilled subs (imported 2026-07-06)
    // have no delay set → their cadence stays exactly as-is.
    nurture_delay_days: cohort === 'signup' ? 1 : 0,
  }
  list.push(entry)
  await writeVanEnrollments(req, list.slice(-10000))
  return { ok: true, duplicate: false, enrolled_at: entry.enrolled_at }
}

// ─── From the Van newsletter — subscribe + admin ────────────────────────────
//
// Public signup endpoint. Called from absoluteadas.com/van (Mark uses it on
// his phone after shop visits; shop owners can also self-signup). Adds to
// the Resend "From the Van" Audience, notifies Mark in Cliq.
//   POST /api/capture-calc/from-the-van/subscribe
//   Body: { email, name?, shop?, phone?, notes?, source? }
captureCalcRouter.post('/from-the-van/subscribe', express.json({ limit: '16kb' }), async (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim()
    if (rateLimited(ip)) {
      return res.status(429).json({ ok: false, error: 'Too many requests. Try again in an hour.' })
    }
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 180)
    const name = String(req.body?.name || '').trim().slice(0, 100)
    const shop = String(req.body?.shop || '').trim().slice(0, 120)
    const phone = String(req.body?.phone || '').trim().slice(0, 30)
    const notes = String(req.body?.notes || '').trim().slice(0, 500)
    const source = String(req.body?.source || 'van-visit').trim().slice(0, 30)
    // Honeypot
    if (req.body?.website) return res.json({ ok: true, message: 'ok' })

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Valid email required' })
    }

    const [firstName, ...rest] = name.split(/\s+/).filter(Boolean)
    const lastName = rest.join(' ') || undefined

    const r = await addVanSubscriber({ email, firstName, lastName })
    if (!r.ok) return res.status(500).json({ ok: false, error: r.error })

    // Cliq DM Mark — a real subscription is a mini-milestone.
    const cliqMsg = [
      r.duplicate ? '📬 FROM THE VAN — duplicate (already subscribed)' : '🚐 NEW FROM THE VAN SUBSCRIBER',
      '',
      `Email: ${email}`,
      name ? `Name: ${name}` : '',
      shop ? `Shop: ${shop}` : '',
      phone ? `Phone: ${phone}` : '',
      notes ? `Notes: ${notes}` : '',
      `Source: ${source}`,
    ].filter(Boolean).join('\n').slice(0, 2000)
    postToCliqChannelById(MARK_ALERT_CHANNEL_ID, cliqMsg).catch(e => console.warn('[from-the-van cliq]', e.message))

    // Also mirror to Zoho CRM so the shop shows up in Contacts with the tag.
    syncNewsletterSubscriberToCrm({ email, name, shop, source: `from-the-van-${source}` })
      .catch(e => console.warn('[from-the-van crm]', e.message))

    // Auto-enroll in the 7-day Magic Lantern (Partnership Discount pitch).
    // New signups get `nurture_delay_days: 1` set internally — Day 1 fires
    // the day AFTER signup, so today's welcome + pricing sheet lands first.
    // cohort='signup' → warm handoff Day 1 ("thanks for the minute at your shop today").
    await enrollVanSubscriber(req, { email, name, shop, cohort: 'signup', source })
      .catch(e => console.warn('[van nurture enroll]', e.message))

    // Send the instant welcome email with the pricing-sheet button. Idempotent —
    // only fires on first-time subscribers (duplicates skip). Opener variant is
    // picked from `source`: self-signup → "Grabbed your info off the form",
    // anything else → "Great meeting you today". Non-fatal — a failed send
    // doesn't block the subscription (they still get Day 1 next morning).
    if (!r.duplicate) {
      try {
        const unsubUrl = vanUnsubscribeUrl(email)
        const welcome = buildWelcomeEmail({ email, name, source }, unsubUrl)
        const sendResult = await sendBroadcast({
          recipients: [email],
          subject: welcome.subject,
          html: welcome.html,
          text: welcome.text,
          fromEmail: 'brew@absoluteadas.com',
          fromName: 'Mark @ Absolute ADAS',
          replyTo: 'mark@absoluteadas.com',
          headersForRecipient: () => ({
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          }),
        })
        const ok = sendResult?.status === 'sent' || sendResult?.status === 'partial'
        if (ok) {
          // Flip welcome_sent on the enrollment record so we never send twice
          try {
            const list = await readVanEnrollments(req)
            let mut = false
            for (let i = 0; i < list.length; i++) {
              if (list[i].email === email && !list[i].welcome_sent) {
                list[i] = { ...list[i], welcome_sent: true, welcome_sent_at: new Date().toISOString() }
                mut = true
              }
            }
            if (mut) await writeVanEnrollments(req, list)
          } catch (e) { console.warn('[van welcome flag write]', e.message) }
        } else {
          console.warn('[van welcome send]', sendResult?.results?.[0]?.error || 'unknown')
        }
      } catch (e) { console.warn('[van welcome]', e.message) }
    }

    res.json({ ok: true, message: r.duplicate ? 'Already subscribed.' : 'Subscribed.', duplicate: !!r.duplicate })
  } catch (e) {
    console.error('[from-the-van subscribe]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: create a Resend Broadcast against the From the Van audience.
// Created as a DRAFT (no scheduled_at) — Mark previews in Resend dashboard,
// then either schedules or sends via /from-the-van/send-broadcast.
//   POST /api/capture-calc/from-the-van/create-broadcast (cron-secret)
//   Body: { subject, html, text?, preview_text?, from?, reply_to?, name? }
captureCalcRouter.post('/from-the-van/create-broadcast', requireCronSecretFlex, express.json({ limit: '4mb' }), async (req, res) => {
  try {
    const { subject, html, text, preview_text, from, reply_to, name } = req.body || {}
    const r = await createVanBroadcast({ subject, html, text, previewText: preview_text, from, replyTo: reply_to, name })
    if (!r.ok) return res.status(500).json(r)
    res.json(r)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: send or schedule an existing draft Broadcast.
//   POST /api/capture-calc/from-the-van/send-broadcast (cron-secret)
//   Body: { id, scheduled_at? } — omit scheduled_at to send NOW
captureCalcRouter.post('/from-the-van/send-broadcast', requireCronSecretFlex, express.json({ limit: '16kb' }), async (req, res) => {
  try {
    const id = String(req.body?.id || '').trim()
    const scheduledAt = req.body?.scheduled_at ? String(req.body.scheduled_at) : undefined
    if (!id) return res.status(400).json({ ok: false, error: 'id required' })
    const r = await sendVanBroadcast(id, scheduledAt)
    if (!r.ok) return res.status(500).json(r)
    res.json(r)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Render any one day of the Magic Lantern for review. Used to proofread the
// sequence before enabling it live. Optional ?name=X substitutes a first
// name into the personalization slots.
//   GET /api/capture-calc/from-the-van/nurture/preview?day=N&name=Mark&cohort=backfill|signup&as=email
// Day 1 has two variants; cohort picks which one. Defaults to backfill (matches
// the 1,410 currently enrolled records that predate the cohort field).
// `as` sets the email the unsubscribe URL is signed for (default: preview@).
captureCalcRouter.get('/from-the-van/nurture/preview', requireCronSecretFlex, async (req, res) => {
  try {
    const day = Number(req.query.day) || 1
    const name = String(req.query.name || 'Mark')
    const cohort = String(req.query.cohort || 'backfill') === 'signup' ? 'signup' : 'backfill'
    const asEmail = String(req.query.as || 'preview@absoluteadas.com').trim().toLowerCase()
    const fakeSub = { email: asEmail, name, cohort, enrolled_at: new Date().toISOString(), nurture_sent: [] }
    const built = buildVanNurtureEmail(fakeSub, day)
    if (!built) return res.status(400).json({ ok: false, error: `unknown day: ${day}` })
    // Substitute unsubscribe placeholder with a real signed URL so Mark can
    // click through and verify the whole flow works.
    let unsubUrl
    try { unsubUrl = vanUnsubscribeUrl(asEmail) } catch { unsubUrl = 'https://absoluteadas.com/#unsub-secret-missing' }
    const html = String(built.html || '').split(VAN_UNSUB_PLACEHOLDER).join(unsubUrl)
    const text = String(built.text || '')
    res.json({ ok: true, day, cohort, unsubUrl, subject: built.subject, preview: built.preview, html, text })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Bulk-enroll every current audience member into the Magic Lantern. Used
// once to seed the 1,410 existing subs. Idempotent — already-enrolled emails
// return duplicate:true and are not re-added.
//   POST /api/capture-calc/from-the-van/backfill-nurture (cron-secret)
captureCalcRouter.post('/from-the-van/backfill-nurture', requireCronSecretFlex, async (req, res) => {
  try {
    const audience = await listVanSubscribers()
    const contacts = audience.contacts || []
    const out = { total_in_audience: contacts.length, enrolled: 0, duplicates: 0, invalid: 0 }

    // Read the current list ONCE, batch every new record in memory, write ONCE.
    // Avoids 1,410 individual read-modify-write cycles hitting Catalyst limits.
    const list = await readVanEnrollments(req)
    const existingEmails = new Set(list.map(e => e.email))
    const nowIso = new Date().toISOString()

    for (const c of contacts) {
      const email = String(c.email || '').trim().toLowerCase()
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) { out.invalid++; continue }
      if (existingEmails.has(email)) { out.duplicates++; continue }
      const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim().slice(0, 40)
      list.push({ email, name, enrolled_at: nowIso, nurture_sent: [], cohort: 'backfill' })
      existingEmails.add(email)
      out.enrolled++
    }

    if (out.enrolled > 0) await writeVanEnrollments(req, list)
    res.json({ ok: true, ...out, total_enrolled_now: list.length })
  } catch (e) {
    console.error('[van backfill]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Cron handler: send each subscriber their day-N Magic Lantern email.
// Runs once daily. Fires the next email in each sub's sequence based on
// enrolled_at + days_since. Skips days already sent (nurture_sent tracks).
//   POST /api/capture-calc/from-the-van/nurture/run (cron-secret)
//   ?dry=1 to log what would send without actually sending
captureCalcRouter.all('/from-the-van/nurture/run', heartbeatAttempt('capture_van_nurture'), requireCronSecretFlex, async (req, res) => {
  const dry = req.query.dry === '1' || req.query.dry === 'true'
  const out = []
  try {
    // KILL SWITCH — cache-backed with env var fallback. Flip via
    // POST /from-the-van/flags {name:'nurture', value:true} when ready.
    // Dry runs bypass the switch so previewing is always safe.
    const seg0 = getSegment(req)
    const nurtureOn = await isVanFlagEnabled(req, 'nurture')
    if (!dry && !nurtureOn) {
      return res.json({
        ok: true,
        paused: true,
        reason: 'van_flag_nurture not set to true (and VAN_NURTURE_ENABLED env var not "true" either) — no emails will send. Flip via POST /from-the-van/flags {name:"nurture", value:true} when ready.',
      })
    }
    const list = await readVanEnrollments(req)
    let mutated = false
    let sentCount = 0
    let capReached = false

    // Belt-and-suspenders unsubscribe filter: fetch the Resend audience once
    // and build a Set of emails Resend has flagged unsubscribed. The cron uses
    // /emails (transactional) instead of Broadcasts, so Resend does not enforce
    // audience-level unsubscribes for us — we have to filter locally. Anyone
    // Resend marks but our local record doesn't get back-filled here so future
    // runs are fast without the API call.
    let resendUnsubSet = new Set()
    try {
      const audience = await listVanSubscribers()
      const contacts = audience?.contacts || []
      for (const c of contacts) {
        if (c.unsubscribed === true) {
          const em = String(c.email || '').trim().toLowerCase()
          if (em) resendUnsubSet.add(em)
        }
      }
    } catch (e) {
      // If Resend is unreachable, fall back to local-only tracking. Better than aborting.
      console.warn('[van nurture] Resend audience fetch failed, using local-only unsub check:', e.message)
    }

    // Send-cap + mid-loop persistence — prevents Catalyst function timeouts
    // from silently losing sent state. On 1,411 subs the previous
    // write-at-end pattern would time out mid-way and lose everything past
    // the killpoint. Now we cap per-fire and flush state every N sends.
    //   MAX_SENDS_PER_FIRE  — hard ceiling per cron invocation. If more
    //                        subs are owed, they roll to tomorrow.
    //   FLUSH_EVERY         — write nurture_sent[] to cache every N ok sends
    //                        so a mid-loop kill only loses this batch.
    // Numbers chosen so 400 sends × 400ms max = 160s well under Catalyst
    // gateway (30s HTTP) and function (300-540s) caps. Flushing every 25
    // keeps worst-case duplicate risk to 25 recipients.
    const MAX_SENDS_PER_FIRE = 400
    const FLUSH_EVERY = 25

    for (let i = 0; i < list.length; i++) {
      if (sentCount >= MAX_SENDS_PER_FIRE) {
        capReached = true
        break
      }
      const sub = list[i]
      // Local unsubscribe flag — set by our own /from-the-van/unsubscribe endpoint.
      if (sub.unsubscribed_at) continue
      // Resend audience flag — set by our endpoint AND by Gmail's List-Unsubscribe
      // header, plus any direct Resend dashboard action. Back-fill local so
      // future runs can skip via the fast local check.
      if (resendUnsubSet.has(sub.email)) {
        list[i] = { ...sub, unsubscribed_at: new Date().toISOString(), unsubscribed_source: 'resend-sync' }
        mutated = true
        continue
      }

      const day = vanNurtureDayFor(sub)
      if (day < 1 || day > 7) continue
      const sent = Array.isArray(sub.nurture_sent) ? sub.nurture_sent : []
      if (sent.includes(day)) continue

      const built = buildVanNurtureEmail(sub, day)
      if (!built) continue

      // Substitute the unsubscribe placeholder with a per-recipient signed URL.
      // Without this, footer links go to `__VAN_UNSUB_URL__` literal string.
      let unsubUrl
      try { unsubUrl = vanUnsubscribeUrl(sub.email) } catch (e) {
        console.error('[van nurture] cannot sign unsub URL — VAN_UNSUB_SECRET / BREW_CRON_SECRET missing:', e.message)
        out.push({ email: sub.email, day, error: 'unsub-sign-failed' })
        continue
      }
      const html = String(built.html).split(VAN_UNSUB_PLACEHOLDER).join(unsubUrl)
      const text = String(built.text || '')

      if (dry) {
        out.push({ email: sub.email, day, subject: built.subject, unsubUrl, dry: true })
        continue
      }

      const r = await sendBroadcast({
        recipients: [sub.email],
        subject: built.subject,
        html,
        text,
        // brew@ has proven Gmail deliverability; mark@ was landing in
        // Promotions or getting silently dropped during preview testing.
        fromEmail: 'brew@absoluteadas.com',
        fromName: 'Mark @ Absolute ADAS',
        replyTo: 'mark@absoluteadas.com',
        // Gmail one-click unsubscribe — the header URL must match the footer
        // for CAN-SPAM compliance. Both point at our signed endpoint.
        headersForRecipient: () => ({
          'List-Unsubscribe': `<${unsubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }),
      })
      const ok = r.status === 'sent' || r.status === 'partial'
      if (ok) {
        list[i] = { ...sub, nurture_sent: [...sent, day] }
        mutated = true
        sentCount++
        // Flush state periodically so a mid-loop kill loses AT MOST the
        // last FLUSH_EVERY sends worth of "already-sent" tracking.
        if (sentCount % FLUSH_EVERY === 0) {
          try { await writeVanEnrollments(req, list) }
          catch (e) { console.warn('[van nurture] mid-loop flush failed:', e.message) }
        }
      }
      out.push({ email: sub.email, day, subject: built.subject, ok, status: r.status })
    }

    if (mutated) await writeVanEnrollments(req, list)
    await stampSuccess(req, 'capture_van_nurture', { processed: out.length, sent: sentCount, capReached, dry })
    res.json({ ok: true, dry, processed: out.length, sent: sentCount, capReached, cap: MAX_SENDS_PER_FIRE, results: out })
  } catch (e) {
    console.error('[van nurture]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message, partial: out })
  }
})

// Public unsubscribe endpoint. Accepts both GET (email footer click) and POST
// (Gmail one-click via List-Unsubscribe-Post header). URL-signed with an HMAC
// so recipients can only unsub themselves.
//   GET  /api/capture-calc/from-the-van/unsubscribe?e=email&s=sig
//   POST /api/capture-calc/from-the-van/unsubscribe?e=email&s=sig
async function handleVanUnsubscribe(req, res) {
  const email = String(req.query.e || '').trim().toLowerCase()
  const sig = String(req.query.s || '').trim()
  if (!email || !sig || !verifyUnsubSig(email, sig)) {
    return res.status(400).send(renderUnsubPage({
      ok: false,
      title: 'Unsubscribe link expired or invalid',
      message: 'That link doesn\'t match. Reply to any email from Mark with "unsub" and he\'ll take you off the list personally.',
    }))
  }
  try {
    // 1) Remove from Resend audience so future weekly Broadcasts skip them
    const resendResult = await unsubscribeVanContact(email).catch(e => ({ ok: false, error: e.message }))
    // 2) Mark unsubscribed_at in local enrollment so the Magic Lantern cron skips them.
    // Also decide whether to send the goodbye email (idempotent: only if
    // goodbye_sent flag isn't already set on the record — protects against
    // Gmail preview auto-GETs, double-clicks, etc.).
    let localMarked = false
    let shouldSendGoodbye = true  // default: send. If we find a record with goodbye_sent, flip off.
    try {
      const list = await readVanEnrollments(req)
      let mutated = false
      for (let i = 0; i < list.length; i++) {
        if (list[i].email === email) {
          if (list[i].goodbye_sent) shouldSendGoodbye = false
          if (!list[i].unsubscribed_at) {
            list[i] = { ...list[i], unsubscribed_at: new Date().toISOString() }
            mutated = true
            localMarked = true
          }
        }
      }
      if (mutated) await writeVanEnrollments(req, list)
    } catch (e) {
      console.warn('[van unsubscribe local]', e.message)
    }

    // 3) Send the "Van Is Sad" goodbye email. Fires once, from brew@ (proven
    // deliverability), no unsubscribe link (they already are). Idempotent via
    // goodbye_sent flag on the enrollment record. Errors are non-fatal — the
    // unsubscribe itself already succeeded above.
    let goodbyeSent = false
    if (shouldSendGoodbye) {
      try {
        const g = buildGoodbyeEmail()
        const r = await sendBroadcast({
          recipients: [email],
          subject: g.subject,
          html: g.html,
          text: g.text,
          fromEmail: 'brew@absoluteadas.com',
          fromName: 'Mark @ Absolute ADAS',
          replyTo: 'mark@absoluteadas.com',
        })
        goodbyeSent = r.status === 'sent' || r.status === 'partial'
        // Flag it as sent so a subsequent unsub click doesn't re-fire.
        if (goodbyeSent) {
          try {
            const list2 = await readVanEnrollments(req)
            let mut = false
            for (let i = 0; i < list2.length; i++) {
              if (list2[i].email === email && !list2[i].goodbye_sent) {
                list2[i] = { ...list2[i], goodbye_sent: true, goodbye_sent_at: new Date().toISOString() }
                mut = true
              }
            }
            if (mut) await writeVanEnrollments(req, list2)
          } catch (e) { console.warn('[van goodbye flag write]', e.message) }
        }
      } catch (e) { console.warn('[van goodbye send]', e.message) }
    }

    // Ping Mark so he sees who dropped
    postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
      `📤 FROM THE VAN — unsubscribe\n\nEmail: ${email}\nResend: ${resendResult.ok ? 'ok' : 'err — ' + resendResult.error}\nLocal enrollment: ${localMarked ? 'marked' : 'not found'}\nGoodbye email: ${goodbyeSent ? 'sent' : (shouldSendGoodbye ? 'attempted but failed' : 'skipped (already sent)')}`
    ).catch(() => {})

    // For POST (Gmail one-click) just return 200. For GET show the confirmation page.
    if (req.method === 'POST') return res.status(200).send('unsubscribed')
    return res.status(200).send(renderUnsubPage({
      ok: true,
      title: "You're unsubscribed",
      message: 'You won\'t get any more emails from the From the Van list. Thanks for the time you gave it.',
    }))
  } catch (e) {
    console.error('[van unsubscribe]', e.message, e.stack)
    return res.status(500).send(renderUnsubPage({
      ok: false,
      title: 'Something went wrong on our end',
      message: 'Reply to any email from Mark with "unsub" and he\'ll take you off manually.',
    }))
  }
}
captureCalcRouter.get('/from-the-van/unsubscribe', handleVanUnsubscribe)
captureCalcRouter.post('/from-the-van/unsubscribe', handleVanUnsubscribe)

// Minimal branded confirmation page. Rendered by the unsubscribe endpoint.
function renderUnsubPage({ ok, title, message }) {
  const accent = ok ? '#CD4419' : '#8B0000'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;}
.wrap{max-width:560px;margin:8vh auto 0;padding:32px 24px;background:#fff;border-top:4px solid ${accent};border-radius:10px;box-shadow:0 2px 30px rgba(0,0,0,0.04);}
.tag{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#666;margin-bottom:16px;}
h1{font-size:24px;line-height:1.25;margin:0 0 14px;}
p{font-size:16px;line-height:1.55;color:#333;margin:0 0 14px;}
.sig{color:#666;font-size:14px;margin-top:24px;}
a{color:${accent};}
</style></head><body>
<div class="wrap">
<div class="tag">From the Van · Absolute ADAS</div>
<h1>${title}</h1>
<p>${message}</p>
<p class="sig">Mark Fowler<br>Absolute ADAS · Lake Stevens, WA</p>
</div></body></html>`
}

// ─── From the Van weekly newsletter automation ─────────────────────────────

// Public base URL used for the approve/kill links Mark receives in Cliq.
const VAN_APPROVE_BASE = 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api/api/capture-calc'

// Weekly BLAST endpoint — sends the current pending draft to all Van
// enrollments via /emails (transactional Pro tier, bypasses the Marketing
// contacts cap that blocks Resend Broadcasts). Same reliability pattern as
// the Magic Lantern nurture cron:
//   - 400-send cap per fire (well under the 30s Catalyst gateway cap)
//   - Mid-loop persistence every 25 sends so a kill mid-loop loses at most 25
//   - Per-recipient signed unsub URL + Gmail List-Unsubscribe header
//   - Sync from Resend audience unsub flag before send
//   - Skips subscribers already sent this issue (tracked on pending draft)
//   - When complete, commits archive HTML to absoluteadas.com/van/issues/N.html
//
// Fires from:
//   1. Manual invocation (Mark can hit it anytime to force send now)
//   2. Safety-net cron detects pending draft past scheduled_for → triggers
//   3. Dedicated Tuesday-morning cron (optional)
//
//   ALL /api/capture-calc/from-the-van/weekly-blast?secret=X
//   ?dry=1  → count who would get emailed, no actual sends
//   ?force=1 → send even if scheduled_for hasn't arrived (for manual override)
captureCalcRouter.all('/from-the-van/weekly-blast', heartbeatAttempt('capture_van_weekly_blast'), requireCronSecretFlex, async (req, res) => {
  const dry   = req.query.dry === '1' || req.query.dry === 'true'
  const force = req.query.force === '1' || req.query.force === 'true'
  try {
    const pending = await readPendingDraft(req)
    if (!pending) return res.json({ ok: true, skipped: true, reason: 'no pending draft' })
    if (pending.status === 'blast_complete') return res.json({ ok: true, skipped: true, reason: 'already sent', pending })
    // Time gate — don't send early unless force=1
    const nowMs = Date.now()
    const scheduledMs = Date.parse(pending.scheduled_for || 0)
    if (!force && Number.isFinite(scheduledMs) && nowMs < scheduledMs) {
      return res.json({ ok: true, skipped: true, reason: 'not yet scheduled', scheduled_for: pending.scheduled_for })
    }

    // Load enrollments + Resend audience unsub set (belt + suspenders)
    const enrollments = await readVanEnrollments(req)
    let resendUnsubSet = new Set()
    try {
      const audience = await listVanSubscribers()
      for (const c of (audience?.contacts || [])) {
        if (c.unsubscribed === true) {
          const em = String(c.email || '').trim().toLowerCase()
          if (em) resendUnsubSet.add(em)
        }
      }
    } catch (e) { console.warn('[weekly-blast] audience fetch failed, local-only:', e.message) }

    // Already-sent-this-issue set — persisted on pending.blast_sent_emails[]
    const sentSet = new Set((pending.blast_sent_emails || []).map(e => String(e).toLowerCase()))

    // The email content is baked into pending.html/pending.text/pending.subject
    // but the unsub URL is a placeholder — substitute per-recipient
    const { VAN_UNSUB_PLACEHOLDER } = await import('../services/fromTheVanNurture.js')

    const MAX_PER_FIRE = 400
    const FLUSH_EVERY = 25
    const results = { eligible: 0, sent: 0, skipped_unsub: 0, skipped_already_sent: 0, skipped_bad_email: 0, failed: 0, capReached: false, errors: [] }

    for (const sub of enrollments) {
      if (results.sent >= MAX_PER_FIRE) { results.capReached = true; break }
      const email = String(sub.email || '').trim().toLowerCase()
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) { results.skipped_bad_email++; continue }
      if (sentSet.has(email)) { results.skipped_already_sent++; continue }
      if (sub.unsubscribed_at) { results.skipped_unsub++; continue }
      if (resendUnsubSet.has(email)) {
        results.skipped_unsub++
        // Backfill local unsub so we don't keep re-checking
        sub.unsubscribed_at = new Date().toISOString()
        sub.unsubscribed_source = 'resend-sync'
        continue
      }
      results.eligible++

      let unsubUrl
      try { unsubUrl = vanUnsubscribeUrl(email) } catch (e) {
        results.failed++
        results.errors.push({ email, error: 'unsub-sign-failed' })
        continue
      }
      const html = String(pending.html || '').split(VAN_UNSUB_PLACEHOLDER).join(unsubUrl)
      const text = String(pending.text || '').split(VAN_UNSUB_PLACEHOLDER).join(unsubUrl)

      if (dry) { results.sent++; continue }

      const r = await sendBroadcast({
        recipients: [email],
        subject: pending.subject,
        html, text,
        fromEmail: 'brew@absoluteadas.com',
        fromName: 'Mark @ Absolute ADAS',
        replyTo: 'mark@absoluteadas.com',
        headersForRecipient: () => ({
          'List-Unsubscribe': `<${unsubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }),
      })
      if (r?.status === 'sent' || r?.status === 'partial') {
        results.sent++
        sentSet.add(email)
        if (results.sent % FLUSH_EVERY === 0) {
          // Mid-loop flush — persist progress so a mid-loop kill loses at most FLUSH_EVERY
          try {
            const flushed = { ...pending, blast_sent_emails: Array.from(sentSet), status: 'blast_in_progress' }
            await writePendingDraft(req, flushed)
          } catch (e) { console.warn('[weekly-blast] mid-loop flush failed:', e.message) }
        }
      } else {
        results.failed++
        if (results.errors.length < 10) results.errors.push({ email, error: r?.error || 'unknown' })
      }
    }

    if (!dry) {
      const done = !results.capReached
      const patched = {
        ...pending,
        blast_sent_emails: Array.from(sentSet),
        status: done ? 'blast_complete' : 'blast_in_progress',
        blast_last_run_at: new Date().toISOString(),
      }
      await writePendingDraft(req, patched)

      // On completion: advance issue state, retire case note, publish archive
      if (done) {
        await advanceIssueState(req, pending).catch(e => console.warn('[blast] advance state:', e.message))
        if (pending.case_note_id) {
          await markCaseNoteUsed(req, pending.case_note_id, pending.issue_number).catch(e => console.warn('[blast] mark case used:', e.message))
        }
        try {
          const { commitFile } = await import('../services/brewArchive.js')
          const archiveHtml = wrapVanIssueForArchive(pending)
          await commitFile({
            path: `van/issues/${pending.issue_number}.html`,
            content: archiveHtml,
            message: `From the Van #${pending.issue_number}: ${String(pending.subject).slice(0, 80)}`,
          })
        } catch (e) { console.warn('[blast] archive commit:', e.message) }
        // Clear pending so next Sunday's drafter starts fresh
        await clearPendingDraft(req).catch(() => {})
        postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
          `✅ FROM THE VAN #${pending.issue_number} — SENT COMPLETE.\nSent: ${results.sent} · Skipped unsub: ${results.skipped_unsub} · Failed: ${results.failed}\nArchive: absoluteadas.com/van/issues/${pending.issue_number}.html`
        ).catch(() => {})
      } else {
        // Cap hit — still more to send next fire
        postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
          `📮 FROM THE VAN #${pending.issue_number} — batch sent (cap reached). ${results.sent} this fire. Continues next hour.`
        ).catch(() => {})
      }
    }

    await stampSuccess(req, 'capture_van_weekly_blast', { sent: results.sent, capReached: results.capReached })
    res.json({ ok: true, dry, ...results })
  } catch (e) {
    console.error('[weekly-blast]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Van safety-net endpoint — hourly reliability layer that catches every way
// the Van pipeline can silently fail. Three concurrent responsibilities:
//
// 1. RETRY PENDING BROADCAST — if a pending draft has broadcast_error set
//    (typically Resend 403 during quota hiccup), retry sendVanBroadcast every
//    hour until it succeeds. Cliq alerts on success.
//
// 2. TRIGGER MISSED WEEKLY DRAFTER — if today is Sun/Mon after 8am PT AND
//    capture_van_weekly_draft heartbeat is >7 days old, fire the drafter
//    now. Cliq alerts on the auto-trigger.
//
// 3. TRIGGER MISSED NURTURE — if now is between 6am-noon PT AND
//    capture_van_nurture heartbeat is >24h old, fire the nurture cron.
//    Cliq alerts on auto-trigger.
//
// Mark schedules this endpoint as an HOURLY Catalyst cron. Even if the
// dedicated Van crons are broken/disabled/misconfigured, this safety net
// picks up the slack — and its own heartbeat proves IT is firing.
//
//   ALL /api/capture-calc/from-the-van/safety-net  (cron-secret)
captureCalcRouter.all('/from-the-van/safety-net', heartbeatAttempt('capture_van_safety_net'), requireCronSecretFlex, async (req, res) => {
  const out = { actions: [], skipped: [] }
  try {
    const nowMs = Date.now()
    const heartbeats = await readAllHeartbeats(req)
    // Compute PT day + hour from server UTC
    const pt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    const dayPt = pt.getDay()   // 0=Sun ... 6=Sat
    const hourPt = pt.getHours()

    // ─── 1. RETRY PENDING BROADCAST SCHEDULE (if broadcast_error is set) ──
    try {
      const pending = await readPendingDraft(req)
      if (pending && pending.broadcast_id && pending.broadcast_error && pending.scheduled_for) {
        const scheduledMs = Date.parse(pending.scheduled_for)
        if (Number.isFinite(scheduledMs) && scheduledMs > nowMs) {
          // Still in the future — worth retrying
          const sched = await sendVanBroadcast(pending.broadcast_id, pending.scheduled_for)
          if (sched.ok) {
            const patched = { ...pending, broadcast_error: null, status: 'auto_scheduled', safety_net_scheduled_at: new Date().toISOString() }
            await writePendingDraft(req, patched)
            const msg = `🛡️ Safety-net RESCHEDULED Issue #${pending.issue_number} for ${new Date(pending.scheduled_for).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}.\nBroadcast: ${pending.broadcast_url || pending.broadcast_id}`
            await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg).catch(() => {})
            out.actions.push({ action: 'retry_schedule', ok: true, broadcast_id: pending.broadcast_id })
          } else {
            out.actions.push({ action: 'retry_schedule', ok: false, error: sched.error })
          }
        }
      }
    } catch (e) { console.warn('[van safety-net retry]', e.message) }

    // ─── 2. TRIGGER MISSED WEEKLY DRAFTER (Sun/Mon after 8am PT) ──────────
    // Weekly drafter should fire Sunday ~8am PT. Check if it happened.
    const canTriggerWeekly = (dayPt === 0 && hourPt >= 8) || (dayPt === 1 && hourPt >= 0)
    if (canTriggerWeekly) {
      const wk = heartbeats['capture_van_weekly_draft']
      const lastMs = wk?.last_success ? Date.parse(wk.last_success) : 0
      const daysStale = lastMs ? (nowMs - lastMs) / 86400000 : 999
      if (daysStale >= 6.5) {
        // Trigger via internal call to the drafter endpoint
        try {
          const secret = process.env.BREW_CRON_SECRET || ''
          const url = `https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api/api/capture-calc/from-the-van/draft-weekly?secret=${encodeURIComponent(secret)}`
          const r = await axios.post(url, {}, { timeout: 180000, validateStatus: () => true })
          const msg = `🛡️ Safety-net TRIGGERED weekly drafter (dedicated cron missed — heartbeat was ${daysStale.toFixed(1)} days stale).\nResult: ${r.data?.ok ? `Issue #${r.data.issue_number} status=${r.data.scheduledStatus}` : `error: ${JSON.stringify(r.data).slice(0, 200)}`}`
          await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg).catch(() => {})
          out.actions.push({ action: 'trigger_weekly_drafter', http_status: r.status, ok: !!r.data?.ok })
        } catch (e) {
          console.warn('[van safety-net trigger weekly]', e.message)
          out.actions.push({ action: 'trigger_weekly_drafter', ok: false, error: e.message })
        }
      } else {
        out.skipped.push({ check: 'weekly_drafter', reason: `fresh heartbeat ${daysStale.toFixed(1)}d ago` })
      }
    } else {
      out.skipped.push({ check: 'weekly_drafter', reason: `not Sun/Mon (day_pt=${dayPt}, hour_pt=${hourPt})` })
    }

    // ─── 3. TRIGGER MISSED NURTURE CRON (any day 6am-noon PT) ─────────────
    if (hourPt >= 6 && hourPt <= 12) {
      const nu = heartbeats['capture_van_nurture']
      const lastMs = nu?.last_success ? Date.parse(nu.last_success) : 0
      const hoursStale = lastMs ? (nowMs - lastMs) / 3600000 : 999
      if (hoursStale >= 23) {
        try {
          const secret = process.env.BREW_CRON_SECRET || ''
          const url = `https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api/api/capture-calc/from-the-van/nurture/run?secret=${encodeURIComponent(secret)}`
          const r = await axios.post(url, {}, { timeout: 180000, validateStatus: () => true })
          const msg = `🛡️ Safety-net TRIGGERED nurture cron (dedicated cron missed — heartbeat was ${hoursStale.toFixed(0)}h stale).\nResult: sent=${r.data?.sent || 0}, processed=${r.data?.processed || 0}`
          await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg).catch(() => {})
          out.actions.push({ action: 'trigger_nurture', ok: !!r.data?.ok, sent: r.data?.sent })
        } catch (e) {
          console.warn('[van safety-net trigger nurture]', e.message)
          out.actions.push({ action: 'trigger_nurture', ok: false, error: e.message })
        }
      } else {
        out.skipped.push({ check: 'nurture', reason: `fresh heartbeat ${hoursStale.toFixed(1)}h ago` })
      }
    } else {
      out.skipped.push({ check: 'nurture', reason: `outside 6am-noon PT window (hour_pt=${hourPt})` })
    }

    await stampSuccess(req, 'capture_van_safety_net', { actions: out.actions.length, skipped: out.skipped.length })
    res.json({ ok: true, day_pt: dayPt, hour_pt: hourPt, ...out })
  } catch (e) {
    console.error('[van safety-net]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message, partial: out })
  }
})

// Admin: submit a case note that the Sunday drafter will use.
//   POST /api/capture-calc/from-the-van/case-notes  (cron-secret)
//   Body: { note: string, source?: string }
captureCalcRouter.post('/from-the-van/case-notes', requireCronSecretFlex, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim()
    const source = String(req.body?.source || 'manual').trim()
    if (note.length < 20) return res.status(400).json({ ok: false, error: 'note too short — need at least 20 chars' })
    const seg = getSegment(req)
    const entry = await addCaseNote(req, { note, source })
    res.json({ ok: true, entry })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: mark a case note used (retire it without a real send). Used when
// a note is superseded by a better one, or when a note is no longer relevant.
//   POST /api/capture-calc/from-the-van/case-notes/mark-used
//   Body: { id: 'XXX' }
captureCalcRouter.post('/from-the-van/case-notes/mark-used', requireCronSecretFlex, express.json({ limit: '2kb' }), async (req, res) => {
  try {
    const id = String(req.body?.id || '').trim()
    if (!id) return res.status(400).json({ ok: false, error: 'id required' })
    const seg = getSegment(req)
    const done = await markCaseNoteUsed(req, id, 0)  // issue 0 = manually retired, not published
    res.json({ ok: true, marked: done })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: list case notes (both used + unused).
//   GET /api/capture-calc/from-the-van/case-notes?secret=X
captureCalcRouter.get('/from-the-van/case-notes', requireCronSecretFlex, async (req, res) => {
  try {
    const seg = getSegment(req)
    const list = await readCaseNotes(req)
    res.json({ ok: true, total: list.length, unused: list.filter(n => !n.used).length, notes: list })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: read all Van feature flags (nurture, weekly, weekly_asks).
//   GET /api/capture-calc/from-the-van/flags?secret=X
// Response: { ok: true, flags: { nurture: bool, weekly: bool, weekly_asks: bool } }
captureCalcRouter.get('/from-the-van/flags', requireCronSecretFlex, async (req, res) => {
  try {
    const seg = getSegment(req)
    const flags = await readAllVanFlags(req)
    res.json({ ok: true, flags })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: flip a Van feature flag. Replaces the env-var-based kill switches
// (VAN_NURTURE_ENABLED / VAN_WEEKLY_ENABLED / VAN_WEEKLY_ASKS_ENABLED) for
// instances where the function's env var slots are full. Flag lives in the
// Catalyst cache; missing = respect env var; env var also missing = false.
//   POST /api/capture-calc/from-the-van/flags?secret=X
//   Body: { name: 'nurture' | 'weekly' | 'weekly_asks', value: true | false }
//   Also accepts convenience shortcut: { flip: 'nurture' } → toggles current value.
captureCalcRouter.post('/from-the-van/flags', requireCronSecretFlex, express.json({ limit: '1kb' }), async (req, res) => {
  try {
    const validFlags = new Set(['nurture', 'weekly', 'weekly_asks'])
    let name = String(req.body?.name || req.body?.flip || '').trim()
    if (!validFlags.has(name)) {
      return res.status(400).json({ ok: false, error: `name must be one of: ${[...validFlags].join(', ')}` })
    }
    const seg = getSegment(req)
    let value
    if (req.body?.flip) {
      const current = await isVanFlagEnabled(req, name)
      value = !current
    } else {
      value = req.body?.value === true || req.body?.value === 'true'
    }
    const result = await setVanFlag(req, name, value)
    // Also send a Cliq DM so Mark has an audit trail when he flips these
    postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
      `🔧 VAN FLAG — \`${name}\` set to \`${value ? 'true' : 'false'}\`\n${name === 'nurture' && value ? '⚠️ Magic Lantern will start sending Day 1 at next 6am PT cron.' : ''}${name === 'weekly' && value ? '⚠️ Weekly drafter will auto-schedule Tuesday sends from now on.' : ''}`
    ).catch(() => {})
    res.json({ ok: true, ...result })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: reset the issue counter + ask-rotation state. Rarely needed;
// exists so Mark can re-seed if he moves the Cadillac issue or wants to
// restart the cycle.
//   POST /api/capture-calc/from-the-van/reset-issue-state
//   Body: { next_issue_number: number, next_ask_type_index?: number }
captureCalcRouter.post('/from-the-van/reset-issue-state', requireCronSecretFlex, express.json({ limit: '2kb' }), async (req, res) => {
  try {
    const seg = getSegment(req)
    const next_issue_number = Number(req.body?.next_issue_number) || 2
    const next_ask_type_index = Number(req.body?.next_ask_type_index) || 0
    const state = { next_issue_number, next_ask_type_index }
    await writeIssueState(req, state)
    res.json({ ok: true, state })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Cron: Sunday 8am PT — draft next Tuesday's issue and DM Mark for approval.
//   ALL /api/capture-calc/from-the-van/draft-weekly  (cron-secret)
//   ?dry=1 — draft only, no Cliq DM, return the draft in the response
captureCalcRouter.all('/from-the-van/draft-weekly', heartbeatAttempt('capture_van_weekly_draft'), requireCronSecretFlex, async (req, res) => {
  const dry = req.query.dry === '1' || req.query.dry === 'true'
  try {
    const seg = getSegment(req)
    // Bail if a previous draft is still pending — don't clobber unread work.
    const existing = await readPendingDraft(req)
    if (existing && !dry) {
      const msg = [
        '⚠️ FROM THE VAN — weekly drafter skipped',
        '',
        `Reason: pending draft from ${existing.drafted_at} is still awaiting your approval.`,
        `Draft: "${existing.subject}"`,
        '',
        `Approve/kill it, or POST /from-the-van/clear-pending-draft to discard.`,
      ].join('\n')
      postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg).catch(() => {})
      return res.json({ ok: true, skipped: true, reason: 'previous draft still pending', pending: existing })
    }
    // Pull the case note to use. If ?case_note_id=X is provided (used for
    // manual triggering when Mark wants a specific note, not the oldest),
    // pick that one; otherwise pickNextCaseNote returns the oldest unused.
    const notes = await readCaseNotes(req)
    const forcedId = req.query.case_note_id ? String(req.query.case_note_id) : null
    const nextNote = forcedId
      ? notes.find(n => n.id === forcedId && !n.used) || null
      : pickNextCaseNote(notes)
    if (!nextNote) {
      // SYNTHETIC MODE — no unused case notes. Instead of skipping the week,
      // let the drafter generate a plausible composite from common ADAS field
      // patterns. Result requires explicit approve (silence does NOT ship).
      console.log('[van weekly] no case notes queued — entering SYNTHETIC MODE')
    }
    // Compute issue slot (number + cycle position + ask type). Ask injection
    // is gated by the weekly_asks flag.
    const state = await readIssueState(req)
    const asksOn = await isVanFlagEnabled(req, 'weekly_asks')
    const slot = computeIssueSlot(state.next_issue_number, state.next_ask_type_index, asksOn)

    // Draft — if no case note, drafter enters SYNTHETIC MODE and generates a composite
    const drafted = await draftWeeklyIssue({
      caseNote: nextNote?.note,   // undefined triggers synthetic mode in the drafter
      issueNumber: state.next_issue_number,
      forcedAskType: slot.askType,
    })

    // Render + build the pending draft record
    const rendered = renderWeeklyIssue({
      subject: drafted.subject,
      previewText: drafted.preview_text,
      bodyMarkdown: drafted.body_markdown,
      issueNumber: state.next_issue_number,
    })
    const id = crypto.randomBytes(9).toString('base64url')
    const scheduledFor = nextTuesday7amPT().toISOString()
    const pending = {
      id,
      issue_number: state.next_issue_number,
      cycle_position: slot.cyclePos,
      type: drafted.type || slot.type,
      ask_type: drafted.ask_type || slot.askType || null,
      case_note_id: nextNote?.id || null,
      case_note_source: nextNote?.source || (drafted.is_synthetic ? 'synthetic-composite' : ''),
      is_synthetic: Boolean(drafted.is_synthetic),
      drafted_at: new Date().toISOString(),
      scheduled_for: scheduledFor,
      subject: rendered.subject,
      preview_text: rendered.previewText,
      body_markdown: drafted.body_markdown,
      html: rendered.html,
      text: rendered.text,
      notes_for_mark: drafted.notes_for_mark || '',
      status: 'pending',
    }

    if (dry) {
      return res.json({ ok: true, dry: true, pending })
    }

    // Silence-approves pattern (matches ADAS Brew): when VAN_WEEKLY_ENABLED
    // is set, the drafter creates + schedules the Resend Broadcast RIGHT NOW
    // for Tuesday 7am PT. Mark's Cliq DM becomes a Kill/Preview card. No
    // action = it ships. When the switch is off, we still create the
    // Resend broadcast (as a draft) but wait for an explicit Approve click
    // to schedule it.
    // Silence-approves for BOTH real + synthetic drafts. When weekly flag is
    // ON, drafter creates + auto-schedules the Resend Broadcast. Only way to
    // stop: click Kill from Cliq. Mark's explicit preference — he trusts the
    // drafter and prefers silence = ships (same as ADAS Brew Bonus).
    const enabled = await isVanFlagEnabled(req, 'weekly')
    let broadcastId = null
    let broadcastUrl = null
    let scheduledStatus = 'paused'  // 'scheduled' | 'draft-only' | 'paused'

    try {
      const created = await createVanBroadcast({
        subject: pending.subject,
        html: pending.html,
        text: pending.text,
        previewText: pending.preview_text,
        name: `From the Van #${pending.issue_number}${pending.is_synthetic ? ' 🤖' : ''}${enabled ? '' : ' (paused draft)'}`,
      })
      if (!created.ok) throw new Error(created.error)
      broadcastId = created.id
      broadcastUrl = created.dashboardUrl
      pending.broadcast_id = broadcastId
      pending.broadcast_url = broadcastUrl
      if (enabled) {
        const sched = await sendVanBroadcast(broadcastId, pending.scheduled_for)
        if (!sched.ok) throw new Error('schedule failed: ' + sched.error)
        scheduledStatus = 'scheduled'
        pending.status = 'auto_scheduled'
      } else {
        scheduledStatus = 'draft-only'
        pending.status = 'paused_draft'
      }
    } catch (e) {
      console.warn('[van weekly] broadcast create/schedule failed:', e.message)
      pending.broadcast_error = e.message
      // Still write the pending draft so Mark can retry approval manually
    }

    await writePendingDraft(req, pending)

    // URLs
    const killUrl    = `${VAN_APPROVE_BASE}/from-the-van/kill-weekly?id=${id}&s=${signVanAction(id, 'kill')}`
    const previewUrl = `${VAN_APPROVE_BASE}/from-the-van/preview-weekly?id=${id}&s=${signVanAction(id, 'preview')}`
    // Approve URL only relevant in paused mode; keep it available in both cases as an "acknowledge/reviewed" no-op when already scheduled
    const approveUrl = `${VAN_APPROVE_BASE}/from-the-van/approve-weekly?id=${id}&s=${signVanAction(id, 'approve')}`

    const scheduledForLocal = new Date(pending.scheduled_for).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    const cliqMsg = [
      scheduledStatus === 'scheduled'
        ? `📰 FROM THE VAN #${state.next_issue_number}${pending.is_synthetic ? ' 🤖 (AI-drafted, no case note)' : ''} — SCHEDULED for ${scheduledForLocal}`
        : scheduledStatus === 'draft-only'
          ? `📰 FROM THE VAN #${state.next_issue_number}${pending.is_synthetic ? ' 🤖 (AI-drafted, no case note)' : ''} — DRAFT ready (paused: weekly flag off)`
          : `⚠️ FROM THE VAN #${state.next_issue_number} — drafted but Resend create/schedule failed (see logs)`,
      scheduledStatus === 'scheduled'
        ? `Silence = ships. Kill or preview if you want to intervene.`
        : `Approve to schedule it.`,
      `${slot.type === 'soft-ask' ? `Ask type: ${slot.askType}` : 'Type: value'}   ·   Cycle pos ${slot.cyclePos}/4`,
      '',
      `SUBJECT: ${rendered.subject}`,
      `PREVIEW: ${rendered.previewText}`,
      '',
      '───',
      drafted.body_markdown.slice(0, 1800),
      drafted.body_markdown.length > 1800 ? '…[truncated in Cliq — full body via preview link]' : '',
      '───',
      '',
      drafted.notes_for_mark ? `📝 Notes: ${drafted.notes_for_mark}` : '',
      pending.broadcast_error ? `❗ Broadcast error: ${pending.broadcast_error}` : '',
      '',
      `👀 Preview: ${previewUrl}`,
      scheduledStatus === 'scheduled' ? `❌ Kill (cancels the scheduled send): ${killUrl}` : `✅ Approve (schedules the send): ${approveUrl}`,
      scheduledStatus === 'scheduled' ? '' : `❌ Kill (discard): ${killUrl}`,
      broadcastUrl ? `🔗 Resend broadcast: ${broadcastUrl}` : '',
    ].filter(Boolean).join('\n').slice(0, 4000)

    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, cliqMsg).catch(e => console.warn('[van weekly cliq]', e.message))

    // When auto-scheduled, advance the issue counter + retire the case note
    // right away (silence = approve, so we commit immediately).
    if (scheduledStatus === 'scheduled') {
      await advanceIssueState(req, pending).catch(e => console.warn('[van weekly advance]', e.message))
      if (pending.case_note_id) {
        await markCaseNoteUsed(req, pending.case_note_id, pending.issue_number).catch(e => console.warn('[van weekly mark case used]', e.message))
      }
      // Publish the issue to the website archive at absoluteadas.com/van/issues/N.html
      // Same pattern as ADAS Brew archive. Non-fatal — a failed commit doesn't
      // block the send; Mark can always re-run this later via /van/republish.
      try {
        const { commitFile } = await import('../services/brewArchive.js')
        const archiveHtml = wrapVanIssueForArchive(pending)
        const r = await commitFile({
          path: `van/issues/${pending.issue_number}.html`,
          content: archiveHtml,
          message: `From the Van #${pending.issue_number}: ${String(pending.subject).slice(0, 80)}`,
        })
        if (r.ok) console.log(`[van archive] committed issue #${pending.issue_number}: ${r.url}`)
        else console.warn(`[van archive] commit failed:`, r.error)
      } catch (e) { console.warn('[van archive]', e.message) }
    }

    await stampSuccess(req, 'capture_van_weekly_draft', { issue: state.next_issue_number, id, scheduled: scheduledStatus === 'scheduled' })
    res.json({ ok: true, issue_number: state.next_issue_number, id, approveUrl, killUrl, previewUrl, scheduledFor, scheduledStatus, broadcastId, broadcastUrl })
  } catch (e) {
    console.error('[van weekly draft]', e.message, e.stack)
    postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🛑 VAN WEEKLY DRAFT FAILED: ${e.message.slice(0, 500)}`).catch(() => {})
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Public — HMAC signed. Mark clicks from Cliq. GET returns the confirmation
// page (no side effects until the confirm button POSTs the same URL).
// This mirrors the pattern used by /approval/approve — Cliq/iMessage bots
// often pre-GET URLs for previews, so real action lives in POST.
async function handleVanApproveGet(req, res) {
  const id = String(req.query.id || '')
  const sig = String(req.query.s || '')
  if (!verifyVanAction(id, 'approve', sig)) return res.status(401).type('html').send(vanApprovalPage({ ok: false, title: 'Link invalid or expired', message: 'This approve link doesn\'t match. If it was cut off in Cliq, tap the full URL from the DM.' }))
  const seg = getSegment(req)
  const pending = await readPendingDraft(req)
  if (!pending || pending.id !== id) return res.status(404).type('html').send(vanApprovalPage({ ok: false, title: 'Draft not found', message: 'This draft is no longer pending — it was already approved, killed, or replaced.' }))
  const enabled = await isVanFlagEnabled(req, 'weekly')
  res.type('html').send(vanConfirmPage({ action: 'approve', pending, sig, enabled }))
}
async function handleVanKillGet(req, res) {
  const id = String(req.query.id || '')
  const sig = String(req.query.s || '')
  if (!verifyVanAction(id, 'kill', sig)) return res.status(401).type('html').send(vanApprovalPage({ ok: false, title: 'Link invalid or expired', message: 'This kill link doesn\'t match.' }))
  const seg = getSegment(req)
  const pending = await readPendingDraft(req)
  if (!pending || pending.id !== id) return res.status(404).type('html').send(vanApprovalPage({ ok: false, title: 'Draft not found', message: 'This draft is no longer pending.' }))
  res.type('html').send(vanConfirmPage({ action: 'kill', pending, sig, enabled: true }))
}
async function handleVanPreviewGet(req, res) {
  const id = String(req.query.id || '')
  const sig = String(req.query.s || '')
  if (!verifyVanAction(id, 'preview', sig)) return res.status(401).type('html').send(vanApprovalPage({ ok: false, title: 'Link invalid or expired', message: 'This preview link doesn\'t match.' }))
  const seg = getSegment(req)
  const pending = await readPendingDraft(req)
  if (!pending || pending.id !== id) return res.status(404).type('html').send(vanApprovalPage({ ok: false, title: 'Draft not found', message: 'This draft is no longer pending.' }))
  // Render the full email + approval controls above it
  res.type('html').send(vanPreviewPage({ pending, sig }))
}

// POST — real action. Approve creates the Resend Broadcast + schedules it.
async function handleVanApprovePost(req, res) {
  const id = String(req.query.id || '')
  const sig = String(req.query.s || '')
  if (!verifyVanAction(id, 'approve', sig)) return res.status(401).type('html').send(vanApprovalPage({ ok: false, title: 'Link invalid or expired', message: '' }))
  const seg = getSegment(req)
  const pending = await readPendingDraft(req)
  if (!pending || pending.id !== id) return res.status(404).type('html').send(vanApprovalPage({ ok: false, title: 'Draft not found', message: 'Already handled.' }))

  // Path 1: already auto-scheduled (silence-approves mode). Approve is a
  // no-op acknowledgement — just clear the pending draft state.
  if (pending.status === 'auto_scheduled' && pending.broadcast_id) {
    await clearPendingDraft(req)
    postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `✅ Acknowledged — Issue #${pending.issue_number} was already scheduled by the drafter. Nothing else to do.`).catch(() => {})
    return res.type('html').send(vanApprovalPage({ ok: true, title: 'Acknowledged', message: `Issue #${pending.issue_number} is already scheduled for ${new Date(pending.scheduled_for).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}. Silence approves, so no action needed — this just clears the pending state.` }))
  }

  // Path 2: paused-mode draft (broadcast created but not scheduled). Approve
  // schedules it. If the broadcast was never created due to an earlier error,
  // create it now, then schedule.
  try {
    let broadcastId = pending.broadcast_id
    if (!broadcastId) {
      const created = await createVanBroadcast({
        subject: pending.subject, html: pending.html, text: pending.text,
        previewText: pending.preview_text,
        name: `From the Van #${pending.issue_number}`,
      })
      if (!created.ok) throw new Error(created.error)
      broadcastId = created.id
      pending.broadcast_url = created.dashboardUrl
    }
    const enabled = await isVanFlagEnabled(req, 'weekly')
    if (enabled) {
      const sched = await sendVanBroadcast(broadcastId, pending.scheduled_for)
      if (!sched.ok) throw new Error(sched.error)
      await clearPendingDraft(req)
      await advanceIssueState(req, pending)
      await markCaseNoteUsed(req, pending.case_note_id, pending.issue_number)
      postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `✅ SCHEDULED — Issue #${pending.issue_number} will send at ${new Date(pending.scheduled_for).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}.\nBroadcast: ${pending.broadcast_url || broadcastId}`).catch(() => {})
      return res.type('html').send(vanApprovalPage({ ok: true, title: 'Approved and scheduled', message: `Issue #${pending.issue_number} will send Tuesday at 7:00 AM PT.` }))
    } else {
      // Kill switch off — approve creates the Resend draft but doesn't schedule
      await clearPendingDraft(req)
      await advanceIssueState(req, pending)
      await markCaseNoteUsed(req, pending.case_note_id, pending.issue_number)
      postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `✅ Approved — Issue #${pending.issue_number} created as DRAFT in Resend (not scheduled — VAN_WEEKLY_ENABLED not set).\nBroadcast: ${pending.broadcast_url || broadcastId}`).catch(() => {})
      return res.type('html').send(vanApprovalPage({ ok: true, title: 'Approved (paused mode)', message: `Issue #${pending.issue_number} exists as a Resend draft. Scheduling was skipped because VAN_WEEKLY_ENABLED is not set. Open the Resend dashboard to schedule manually, or flip the env var.` }))
    }
  } catch (e) {
    console.error('[van weekly approve]', e.message, e.stack)
    return res.status(500).type('html').send(vanApprovalPage({ ok: false, title: 'Approve failed', message: `Error: ${e.message}` }))
  }
}
async function handleVanKillPost(req, res) {
  const id = String(req.query.id || '')
  const sig = String(req.query.s || '')
  if (!verifyVanAction(id, 'kill', sig)) return res.status(401).type('html').send(vanApprovalPage({ ok: false, title: 'Link invalid or expired', message: '' }))
  const seg = getSegment(req)
  const pending = await readPendingDraft(req)
  if (!pending || pending.id !== id) return res.status(404).type('html').send(vanApprovalPage({ ok: false, title: 'Draft not found', message: 'Already handled.' }))

  // If the drafter already created + scheduled the broadcast (silence-approves
  // mode), cancel the Resend send. Idempotent — a 404 from Resend is treated
  // as success (already gone).
  let broadcastCancelled = false
  if (pending.broadcast_id) {
    const del = await deleteVanBroadcast(pending.broadcast_id).catch(e => ({ ok: false, error: e.message }))
    broadcastCancelled = del.ok
    if (!del.ok) console.warn('[van weekly kill] Resend delete failed:', del.error)
  }

  // Roll back issue-state advance + case-note-used mark, since auto-schedule
  // committed those and now we're cancelling.
  try {
    const state = await readIssueState(req)
    if (pending.status === 'auto_scheduled' && state.next_issue_number > pending.issue_number) {
      const rolledBack = { next_issue_number: pending.issue_number, next_ask_type_index: state.next_ask_type_index }
      if (pending.type === 'soft-ask') rolledBack.next_ask_type_index = (state.next_ask_type_index + 2) % 3  // undo advance
      await writeIssueState(req, rolledBack)
    }
  } catch (e) { console.warn('[van weekly kill] state rollback failed:', e.message) }
  // Un-mark the case note as used. Uses the helper so the chunked-storage
  // write path stays consistent (direct segment writes would bust the meta).
  try {
    await unmarkCaseNoteUsed(req, pending.case_note_id, pending.issue_number)
  } catch (e) { console.warn('[van weekly kill] case-note un-mark failed:', e.message) }

  await clearPendingDraft(req)
  postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
    `❌ Killed — Issue #${pending.issue_number} discarded.${pending.broadcast_id ? (broadcastCancelled ? ' Scheduled Resend send cancelled.' : ' ⚠️ Resend broadcast delete FAILED — check dashboard: ' + (pending.broadcast_url || '')) : ''} Case note is back in the queue.`
  ).catch(() => {})
  res.type('html').send(vanApprovalPage({ ok: true, title: 'Killed', message: `Draft discarded${pending.broadcast_id && broadcastCancelled ? ' and scheduled send cancelled' : ''}. The case note stays in the queue.` }))
}

// Wrap the email HTML into a standalone webpage suitable for the website
// archive at absoluteadas.com/van/issues/N.html. The email HTML has its own
// doctype + inline styles designed for inbox rendering; we add a proper
// <head> for SEO/social + a back-to-archive nav link. Keeps the body markup
// intact so the page reads identically to the email.
function wrapVanIssueForArchive(pending) {
  const rawBody = String(pending.html || '')
  const bodyMatch = rawBody.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const bodyInner = bodyMatch ? bodyMatch[1] : rawBody
  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const title = esc(pending.subject || `From the Van #${pending.issue_number}`)
  const desc  = esc(pending.preview_text || '')
  const iso   = esc(pending.drafted_at || pending.scheduled_for || '')
  const num   = Number(pending.issue_number) || 0

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — From the Van #${num}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:site_name" content="Absolute ADAS · From the Van">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://absoluteadas.com/van/issues/${num}.html">
<style>
body { margin:0; background:#faf9f7; }
.archive-nav {
  max-width: 640px; margin: 0 auto; padding: 14px 20px;
  font: 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
  color: #666; letter-spacing: .06em; text-transform: uppercase;
  border-bottom: 1px solid #e5e5e5;
}
.archive-nav a { color: #CD4419; text-decoration: none; }
.archive-nav a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="archive-nav">
  <a href="/van/">← From the Van archive</a>
  &nbsp;·&nbsp; Issue #${num}${iso ? ` &nbsp;·&nbsp; ${iso.slice(0, 10)}` : ''}
</div>
${bodyInner}
</body>
</html>`
}

// Cron-safe helper: bump issue counter + ask rotation forward after approval.
async function advanceIssueState(req, approvedPending) {
  const state = await readIssueState(req)
  const nextIssueNumber = approvedPending.issue_number + 1
  let askIdx = state.next_ask_type_index
  if (approvedPending.type === 'soft-ask') askIdx = (askIdx + 1) % 3  // advance rotation only on ask
  await writeIssueState(req, { next_issue_number: nextIssueNumber, next_ask_type_index: askIdx })
}

// Admin — nuke the pending draft (used when Mark ignores it and needs to
// start fresh).  POST /api/capture-calc/from-the-van/clear-pending-draft
captureCalcRouter.post('/from-the-van/clear-pending-draft', requireCronSecretFlex, async (req, res) => {
  const seg = getSegment(req)
  await clearPendingDraft(req)
  res.json({ ok: true, cleared: true })
})

// Admin — read the current pending draft.
captureCalcRouter.get('/from-the-van/pending-draft', requireCronSecretFlex, async (req, res) => {
  const seg = getSegment(req)
  const p = await readPendingDraft(req)
  res.json({ ok: true, pending: p })
})

captureCalcRouter.get('/from-the-van/approve-weekly',  handleVanApproveGet)
captureCalcRouter.post('/from-the-van/approve-weekly', handleVanApprovePost)
captureCalcRouter.get('/from-the-van/kill-weekly',     handleVanKillGet)
captureCalcRouter.post('/from-the-van/kill-weekly',    handleVanKillPost)
captureCalcRouter.get('/from-the-van/preview-weekly',  handleVanPreviewGet)

// ─── Approval UI ───────────────────────────────────────────────────────────

function vanApprovalPage({ ok, title, message }) {
  const accent = ok ? '#CD4419' : '#8B0000'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;}
.wrap{max-width:560px;margin:8vh auto 0;padding:32px 24px;background:#fff;border-top:4px solid ${accent};border-radius:10px;box-shadow:0 2px 30px rgba(0,0,0,0.04);}
.tag{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#666;margin-bottom:16px;}
h1{font-size:24px;line-height:1.25;margin:0 0 14px;} p{font-size:16px;line-height:1.55;color:#333;margin:0 0 14px;}
.sig{color:#666;font-size:14px;margin-top:24px;} a{color:${accent};}</style></head><body>
<div class="wrap"><div class="tag">From the Van · Absolute ADAS</div>
<h1>${title}</h1><p>${message || ''}</p>
<p class="sig">Mark Fowler<br>Absolute ADAS · Lake Stevens, WA</p></div></body></html>`
}

function vanConfirmPage({ action, pending, sig, enabled }) {
  const actionColor = action === 'approve' ? '#16a34a' : '#dc2626'
  const actionVerb = action === 'approve' ? 'Schedule for Tuesday 7:00 AM PT' : 'Discard this draft'
  const kickerColor = enabled ? '#16a34a' : '#c88a00'
  const kickerLabel = enabled ? 'LIVE MODE — will schedule the send' : 'PAUSED MODE — will create Resend draft but NOT schedule'
  const postUrl = `${VAN_APPROVE_BASE}/from-the-van/${action}-weekly?id=${pending.id}&s=${sig}`
  const bodyHtml = pending.body_markdown
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .split(/\n\s*\n/).map(p => `<p>${p.trim().replace(/\n/g, '<br>')}</p>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${action === 'approve' ? 'Approve' : 'Kill'} — From the Van #${pending.issue_number}</title>
<style>body{margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;}
.wrap{max-width:720px;margin:24px auto 60px;padding:0 16px;} .card{background:#fff;border-radius:10px;padding:24px 22px;border-top:4px solid #CD4419;box-shadow:0 2px 30px rgba(0,0,0,0.04);}
.tag{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#666;} .kicker{font-size:12px;font-weight:600;letter-spacing:.06em;color:${kickerColor};margin:8px 0 14px;}
h1{font-size:22px;margin:0 0 6px;line-height:1.3;} .meta{color:#666;font-size:13px;margin:0 0 20px;} .subject{font-size:17px;font-weight:700;margin:8px 0 6px;}
.preview{color:#666;font-size:14px;font-style:italic;margin:0 0 20px;} .body{border-top:1px solid #e5e5e5;padding-top:16px;font-size:16px;line-height:1.6;color:#1a1a1a;}
.body p{margin:0 0 14px;} form{margin:24px 0 0;text-align:center;} button{background:${actionColor};color:#fff;border:none;padding:14px 26px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;min-width:220px;}
button:hover{opacity:0.92;} .notes{background:#fdf1ec;border-left:3px solid #CD4419;padding:14px 16px;margin:0 0 18px;font-size:14px;line-height:1.55;color:#333;}</style></head><body>
<div class="wrap"><div class="card"><div class="tag">From the Van · Issue #${pending.issue_number}</div><div class="kicker">${kickerLabel}</div>
<h1>${action === 'approve' ? 'Approve this issue?' : 'Kill this draft?'}</h1>
<p class="meta">Scheduled for ${new Date(pending.scheduled_for).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })} · Type: ${pending.type}${pending.ask_type ? ' · Ask: ' + pending.ask_type : ''}</p>
${pending.notes_for_mark ? `<div class="notes"><strong>Notes from drafter:</strong> ${pending.notes_for_mark.replace(/</g,'&lt;')}</div>` : ''}
<div class="subject">${pending.subject.replace(/</g,'&lt;')}</div>
<p class="preview">${pending.preview_text.replace(/</g,'&lt;')}</p>
<div class="body">${bodyHtml}</div>
<form method="POST" action="${postUrl}"><button type="submit">${actionVerb}</button></form>
</div></div></body></html>`
}

function vanPreviewPage({ pending, sig }) {
  const approveUrl = `${VAN_APPROVE_BASE}/from-the-van/approve-weekly?id=${pending.id}&s=${signVanAction(pending.id, 'approve')}`
  const killUrl    = `${VAN_APPROVE_BASE}/from-the-van/kill-weekly?id=${pending.id}&s=${signVanAction(pending.id, 'kill')}`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview — From the Van #${pending.issue_number}</title>
<style>body{margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;}
.wrap{max-width:720px;margin:24px auto 60px;padding:0 16px;} .bar{background:#fff;padding:16px 20px;border-radius:10px;box-shadow:0 2px 30px rgba(0,0,0,0.04);margin-bottom:20px;border-top:4px solid #CD4419;}
.bar .tag{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#666;margin-bottom:8px;} .bar h1{margin:0 0 8px;font-size:18px;}
.bar .meta{color:#666;font-size:13px;margin:0 0 12px;} .btnrow{display:flex;gap:10px;margin-top:12px;}
.btnrow a{flex:1;text-align:center;padding:12px 16px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;}
.approve{background:#16a34a;color:#fff;} .kill{background:#dc2626;color:#fff;}
.frame{background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 30px rgba(0,0,0,0.04);}</style></head><body>
<div class="wrap"><div class="bar"><div class="tag">Preview — Issue #${pending.issue_number}</div><h1>${pending.subject.replace(/</g,'&lt;')}</h1>
<div class="meta">Scheduled: ${new Date(pending.scheduled_for).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })} · ${pending.type}${pending.ask_type ? ' · ' + pending.ask_type : ''}</div>
<div class="btnrow"><a class="approve" href="${approveUrl}">✅ Approve</a><a class="kill" href="${killUrl}">❌ Kill</a></div>
</div><div class="frame">${pending.html.replace(/^[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '')}</div></div></body></html>`
}

// Admin: reconstruct the per-subscriber Magic Lantern nurture_sent state
// from Resend's send history. Used to recover after Cache evaporation lost
// the mid-sequence progress on ~217 subscribers. Walks recent Resend sends,
// matches by subject line against the known Magic Lantern day subjects,
// groups by recipient, returns {email: [days_received]}.
//
//   POST /api/capture-calc/from-the-van/reconstruct-nurture-from-resend
//   ?dry=1 → return the reconstruction report without writing anything
//   (real path also writes back to Datastore enrollments)
captureCalcRouter.post('/from-the-van/reconstruct-nurture-from-resend', requireCronSecretFlex, async (req, res) => {
  const dry = req.query.dry === '1' || req.query.dry === 'true'
  try {
    // Known Magic Lantern day subjects (from services/fromTheVanNurture.js)
    const DAY_SUBJECTS = {
      1: [
        "Following up on the business card I left with you",  // backfill variant
        "Thanks for the minute at your shop today",           // signup variant
      ],
      2: ["Your sublet vendor uses your bay. Charges you list. Sound right?"],
      3: ["The Partnership Discount Model — 4 components"],
      4: ["$450 → $382.50 → $67.50 stays with your shop"],
      5: ["Two-bay shop in Marysville. Nine cals a month. Nobody had done the math."],
      6: ["The Absolute Partnership Guarantee"],
      7: ["15 minutes on your calibration workflow. That's the whole ask."],
    }
    // Reverse-map for fast lookup: normalized-subject → day number
    const SUBJECT_TO_DAY = {}
    for (const [day, subjects] of Object.entries(DAY_SUBJECTS)) {
      for (const s of subjects) SUBJECT_TO_DAY[s.trim().toLowerCase()] = Number(day)
    }

    // Fetch recent Resend sends. Magic Lantern sends were between
    // ~2026-07-12 and ~2026-07-14 based on flag timing; use a generous window.
    const listResult = await listRecentResendSends({ limit: 100, maxPages: 40, sinceDaysAgo: 45 })
    if (listResult?.ok === false) {
      return res.status(500).json({ ok: false, error: `Resend list failed: ${listResult.error}` })
    }
    const emails = Array.isArray(listResult) ? listResult : []

    // Filter to just our Magic Lantern sends + group by recipient
    const perRecipient = new Map()
    let matchCount = 0
    for (const e of emails) {
      const subj = String(e.subject || '').trim().toLowerCase()
      const day = SUBJECT_TO_DAY[subj]
      if (!day) continue
      matchCount++
      for (const to of (e.to || [])) {
        const em = String(to || '').trim().toLowerCase()
        if (!em) continue
        if (!perRecipient.has(em)) perRecipient.set(em, { days: new Set(), earliest: e.created_at })
        const rec = perRecipient.get(em)
        rec.days.add(day)
        if (e.created_at && e.created_at < rec.earliest) rec.earliest = e.created_at
      }
    }

    // Build report + convert Sets to sorted arrays
    const report = []
    for (const [email, { days, earliest }] of perRecipient.entries()) {
      report.push({
        email,
        days_received: Array.from(days).sort((a, b) => a - b),
        highest_day: Math.max(...days),
        earliest_send: earliest,
      })
    }
    report.sort((a, b) => (a.email || '').localeCompare(b.email || ''))

    // Summary
    const distribution = {}
    for (const r of report) distribution[r.highest_day] = (distribution[r.highest_day] || 0) + 1

    if (dry) {
      return res.json({
        ok: true, dry: true,
        resend_sends_scanned: emails.length,
        magic_lantern_matches: matchCount,
        unique_recipients: report.length,
        highest_day_distribution: distribution,
        sample: report.slice(0, 20),
        total_report_items: report.length,
      })
    }

    // Real path — patch the Datastore enrollments so each recipient has
    // nurture_sent filled in AND their enrolled_at adjusted so the next
    // eligible day fires on the next cron run.
    const enrollments = await readVanEnrollments(req)
    const byEmail = new Map(enrollments.map(e => [String(e.email || '').toLowerCase(), e]))
    let updated = 0
    const now = Date.now()
    for (const r of report) {
      const record = byEmail.get(r.email)
      if (!record) continue
      const highest = r.highest_day
      const nextDay = highest + 1
      // Set nurture_sent to the days they actually received (source of truth = Resend)
      record.nurture_sent = r.days_received
      // Shift enrolled_at so today = the day AFTER highest received. E.g. if
      // they got days 1-4, they should be at day 5 tomorrow — meaning
      // daysSince = highest, so enrolled_at = now - highest days.
      // We compute enrolled_at so nextDay fires on next cron.
      if (nextDay >= 1 && nextDay <= 7) {
        const daysAgo = highest  // vanNurtureDayFor returns daysSince+1
        record.enrolled_at = new Date(now - daysAgo * 86400000).toISOString()
        record.nurture_reconstructed_at = new Date().toISOString()
        record.nurture_reconstructed_from = 'resend-2026-07-18'
        updated++
      }
      // People past day 7 are already done — no reshuffle needed
    }
    if (updated > 0) await writeVanEnrollments(req, enrollments)
    res.json({
      ok: true, dry: false,
      resend_sends_scanned: emails.length,
      magic_lantern_matches: matchCount,
      unique_recipients: report.length,
      highest_day_distribution: distribution,
      updated_enrollments: updated,
      sample_updates: report.slice(0, 20),
    })
  } catch (e) {
    console.error('[van reconstruct]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: edit the pending draft's body markdown, re-render, and swap the
// scheduled Resend Broadcast in-place. Used when Mark wants to hand-edit the
// draft after the drafter has already created + scheduled the Broadcast.
//
//   POST /api/capture-calc/from-the-van/edit-pending-body?secret=X
//   Body: { body_markdown, subject? , preview_text? }
captureCalcRouter.post('/from-the-van/edit-pending-body', requireCronSecretFlex, express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const newBody = String(req.body?.body_markdown || '').trim()
    const newSubject = req.body?.subject ? String(req.body.subject).trim() : null
    const newPreview = req.body?.preview_text ? String(req.body.preview_text).trim() : null
    if (!newBody) return res.status(400).json({ ok: false, error: 'body_markdown required' })

    const pending = await readPendingDraft(req)
    if (!pending) return res.status(404).json({ ok: false, error: 'no pending draft to edit' })

    // Re-render html + text from the new body
    const subject = newSubject || pending.subject
    const preview = newPreview || pending.preview_text
    const rendered = renderWeeklyIssue({
      subject,
      previewText: preview,
      bodyMarkdown: newBody,
      issueNumber: pending.issue_number,
    })

    // Delete the OLD Resend Broadcast (if one exists)
    if (pending.broadcast_id) {
      const del = await deleteVanBroadcast(pending.broadcast_id).catch(e => ({ ok: false, error: e.message }))
      if (!del.ok) console.warn('[edit-pending-body] delete old broadcast:', del.error)
    }

    // Create a NEW broadcast with the edited content
    const created = await createVanBroadcast({
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      previewText: rendered.previewText,
      name: `From the Van #${pending.issue_number} (edited)`,
    })
    if (!created.ok) return res.status(500).json({ ok: false, error: `create failed: ${created.error}` })

    // Reschedule for the same scheduled_for as before
    const sched = await sendVanBroadcast(created.id, pending.scheduled_for)
    if (!sched.ok) {
      // Broadcast exists but couldn't be scheduled — save the ID so safety-net can retry
      const patched = {
        ...pending,
        subject: rendered.subject,
        preview_text: rendered.previewText,
        body_markdown: newBody,
        html: rendered.html,
        text: rendered.text,
        broadcast_id: created.id,
        broadcast_url: created.dashboardUrl,
        broadcast_error: `reschedule failed: ${sched.error}`,
        status: 'pending',
      }
      await writePendingDraft(req, patched)
      return res.status(500).json({ ok: false, error: `schedule failed: ${sched.error}`, broadcast_id: created.id })
    }

    // Success — update pending draft with new content + cleared error
    const patched = {
      ...pending,
      subject: rendered.subject,
      preview_text: rendered.previewText,
      body_markdown: newBody,
      html: rendered.html,
      text: rendered.text,
      broadcast_id: created.id,
      broadcast_url: created.dashboardUrl,
      broadcast_error: null,
      status: 'auto_scheduled',
      hand_edited_at: new Date().toISOString(),
    }
    await writePendingDraft(req, patched)
    res.json({
      ok: true,
      issue_number: pending.issue_number,
      scheduled_for: pending.scheduled_for,
      broadcast_id: created.id,
      broadcast_url: created.dashboardUrl,
    })
  } catch (e) {
    console.error('[edit-pending-body]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: rebuild the local Van enrollment records in the VanKV Datastore
// from the current Resend audience. Used to recover after the Cache-TTL
// evaporation on 2026-07-18 (Cache 48h TTL wiped all van_enrollments rows —
// Resend audience is intact so we can rebuild cleanly).
//
// Idempotent: if the local record already exists for an email, skip. Existing
// subscribers keep their `nurture_sent` progress. Rebuilt records assume
// `cohort: 'backfill'` + `nurture_delay_days: 0` so the Magic Lantern cadence
// picks up from wherever they are (based on enrolled_at date).
//
//   POST /api/capture-calc/from-the-van/rebuild-enrollments-from-resend
//   ?dry=1 → report what would be added without writing
captureCalcRouter.post('/from-the-van/rebuild-enrollments-from-resend', requireCronSecretFlex, async (req, res) => {
  const dry = req.query.dry === '1' || req.query.dry === 'true'
  try {
    const audience = await listVanSubscribers()
    const contacts = audience?.contacts || []
    const existing = await readVanEnrollments(req)
    const existingByEmail = new Map(existing.map(e => [String(e.email || '').toLowerCase(), e]))

    const nowIso = new Date().toISOString()
    // Backfill enrollment date — use audience import date as a reasonable
    // proxy. Since the original enrollment was 2026-07-06 for the warm-list,
    // set enrolled_at to that date so days-since-enrolled matches reality
    // (they should be well past Day 7 by now → outside the 1-7 nurture window,
    // won't get any Magic Lantern emails, just weekly Van newsletter).
    const backfillEnrolledAt = '2026-07-06T14:00:00.000Z'

    const out = { total_in_audience: contacts.length, already_local: 0, added: 0, skipped_unsub: 0, invalid: 0, dry }
    const additions = []
    for (const c of contacts) {
      const email = String(c.email || '').trim().toLowerCase()
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) { out.invalid++; continue }
      if (existingByEmail.has(email)) { out.already_local++; continue }
      const entry = {
        email,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ').slice(0, 40),
        enrolled_at: backfillEnrolledAt,
        nurture_sent: [],
        cohort: 'backfill',
        source: 'resend-rebuild-2026-07-18',
        nurture_delay_days: 0,
        unsubscribed_at: c.unsubscribed === true ? nowIso : null,
      }
      if (entry.unsubscribed_at) { out.skipped_unsub++; /* still add so we don't try to send later */ }
      additions.push(entry)
      out.added++
    }

    if (!dry && additions.length) {
      const combined = [...existing, ...additions]
      await writeVanEnrollments(req, combined)
    }
    res.json({ ok: true, ...out })
  } catch (e) {
    console.error('[van rebuild]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: republish a specific past issue to the website archive. Useful for
// hotfixes when the auto-publish step failed. If pending_draft is gone (which
// it will be for past issues), Mark passes issue_number + subject + html.
//   POST /from-the-van/republish?secret=X
//   Body: { issue_number, subject, html, preview_text? }
captureCalcRouter.post('/from-the-van/republish', requireCronSecretFlex, express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const issue_number = Number(req.body?.issue_number)
    const subject = String(req.body?.subject || '')
    const html = String(req.body?.html || '')
    const preview_text = String(req.body?.preview_text || '')
    if (!issue_number || !html) return res.status(400).json({ ok: false, error: 'issue_number + html required' })
    const { commitFile } = await import('../services/brewArchive.js')
    const archiveHtml = wrapVanIssueForArchive({ issue_number, subject, html, preview_text, drafted_at: new Date().toISOString() })
    const r = await commitFile({
      path: `van/issues/${issue_number}.html`,
      content: archiveHtml,
      message: `From the Van #${issue_number} (republish): ${subject.slice(0, 80)}`,
    })
    res.json({ ok: r.ok, url: r.url, error: r.error })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: list current From the Van subscribers.
captureCalcRouter.get('/from-the-van/subscribers', requireCronSecretFlex, async (req, res) => {
  try {
    const r = await listVanSubscribers()
    res.json(r)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: bulk import a batch of email addresses into the audience. Used to
// seed the initial list from the CRM Mailing Labels CSV. Body accepts either
// { emails: ["a@b.com", ...] } for quick seeding, or an array of full contact
// Cron: send Mark a daily SMS digest of Van + Magic Lantern activity.
// Fires 8pm PT. Compares current stats to yesterday's snapshot to show
// today's deltas. Also posts to Cliq as a backup in case SMS fails.
// ?dry=1 returns the composed message + stats without sending anything.
//   ALL /api/capture-calc/from-the-van/daily-digest  (cron-secret)
captureCalcRouter.all('/from-the-van/daily-digest', heartbeatAttempt('capture_van_daily_digest'), requireCronSecretFlex, async (req, res) => {
  const dry = req.query.dry === '1' || req.query.dry === 'true'
  try {
    const seg = getSegment(req)
    // Collect state
    const [enrollments, audience, caseNotes, pendingDraft] = await Promise.all([
      readVanEnrollments(req),
      listVanSubscribers().catch(() => ({ count: 0 })),
      readCaseNotes(req),
      readPendingDraft(req),
    ])
    const current = computeCurrentStats({
      enrollments,
      audienceCount: audience?.count || 0,
      caseNotes,
      pendingDraft,
    })
    const yesterday = await readVanStatsSnapshot(seg)
    const smsBody = buildDigestSMS(current, yesterday)

    if (dry) {
      return res.json({ ok: true, dry: true, current, yesterday, sms_preview: smsBody })
    }

    // Resolve Mark's phone number from cache-backed config (env vars are maxed).
    const cfg = await resolvePhoneConfig(req).catch(() => null)
    const markNumber = cfg?.MARK_PHONE_NUMBER || process.env.MARK_PHONE_NUMBER
    let smsResult = null
    if (markNumber) {
      try {
        const r = await sendTwilioSMS({ to: markNumber, body: smsBody, from: 'local', cfg })
        smsResult = { ok: true, sid: r?.sid || null }
      } catch (e) {
        smsResult = { ok: false, error: e.message }
      }
    } else {
      smsResult = { ok: false, error: 'MARK_PHONE_NUMBER not configured (set via Phone Setup)' }
    }

    // Also post to Cliq as a backup — if SMS drops, Mark still sees it in the morning
    postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `📮 Van daily digest\n\n${smsBody}`).catch(() => {})

    // Snapshot today's numbers so tomorrow's digest can compute deltas
    await writeVanStatsSnapshot(seg, current).catch(e => console.warn('[van digest snapshot]', e.message))
    await stampSuccess(req, 'capture_van_daily_digest', { sent_sms: !!smsResult?.ok, chars: smsBody.length })
    res.json({ ok: true, sms: smsResult, cliq: 'posted', current, delta_baseline: yesterday ? yesterday.date : 'first-run' })
  } catch (e) {
    console.error('[van daily digest]', e.message, e.stack)
    // Cliq the failure so Mark knows the digest broke
    postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `⚠️ Van daily digest FAILED: ${e.message.slice(0, 400)}`).catch(() => {})
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: HARD DELETE contacts from Resend audience. Removes them entirely
// (vs. silent-remove which just flags as unsubscribed). Used to purge test
// @example.com contacts that block Broadcast validation with a 422 error.
//   POST /api/capture-calc/from-the-van/hard-delete
//   Body: { emails: ['x@y.com', ...] }
captureCalcRouter.post('/from-the-van/hard-delete', requireCronSecretFlex, express.json({ limit: '16kb' }), async (req, res) => {
  try {
    const emails = (req.body?.emails || []).map(e => String(e).trim().toLowerCase()).filter(Boolean)
    if (!emails.length) return res.status(400).json({ ok: false, error: 'emails[] required' })
    const results = []
    for (const em of emails) {
      const r = await hardDeleteVanContact(em)
      results.push({ email: em, ...r })
      await new Promise(r => setTimeout(r, 120))  // throttle for Resend
    }
    res.json({ ok: true, total: emails.length, results })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: silently remove subscribers from the Van audience. Used to scrub
// competitors, spam signups, and anyone flagged for stealth removal. Marks
// them unsubscribed in Resend (so no Broadcasts) and unsubscribed_at plus
// admin_removed=true in local enrollments (so no Magic Lantern cron sends).
// Does NOT fire the "Van Is Sad" goodbye email. Does NOT ping Cliq. The
// point is they never know they were removed.
//
//   POST /api/capture-calc/from-the-van/silent-remove  (cron-secret)
//   Body: { emails: ['x@y.com', ...], reason?: 'competitor sweep' }
captureCalcRouter.post('/from-the-van/silent-remove', requireCronSecretFlex, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const emails = (req.body?.emails || []).map(e => String(e).trim().toLowerCase()).filter(Boolean)
    const reason = String(req.body?.reason || 'silent removal').slice(0, 80)
    if (!emails.length) return res.status(400).json({ ok: false, error: 'emails[] required' })
    const seg = getSegment(req)
    const results = []
    // Snapshot the local enrollments once, mutate in-place, write once at the end
    const list = await readVanEnrollments(req)
    let mutated = false
    for (const email of emails) {
      // 1. Resend audience — mark unsubscribed
      const resendResult = await unsubscribeVanContact(email).catch(e => ({ ok: false, error: e.message }))
      // 2. Local enrollments — mark unsubscribed_at + admin_removed so cron skips
      //    AND set goodbye_sent so the unsubscribe endpoint would skip its email too
      let localFound = false
      for (let i = 0; i < list.length; i++) {
        if (list[i].email === email) {
          localFound = true
          list[i] = {
            ...list[i],
            unsubscribed_at: list[i].unsubscribed_at || new Date().toISOString(),
            admin_removed: true,
            admin_removed_reason: reason,
            goodbye_sent: true,  // block future goodbye email if they hit unsubscribe URL
          }
          mutated = true
        }
      }
      results.push({ email, resend: resendResult.ok ? 'ok' : `err:${resendResult.error}`, local: localFound ? 'marked' : 'not-in-local' })
    }
    if (mutated) await writeVanEnrollments(req, list)
    res.json({ ok: true, total: emails.length, results, reason })
  } catch (e) {
    console.error('[van silent-remove]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: purge leads from Zoho CRM matching any of the given criteria. Walks
// every page of Leads, filters by email-domain match OR company-substring match
// (both case-insensitive), and deletes each hit. Returns a full report so
// nothing is deleted invisibly.
//
//   POST /api/capture-calc/leads/purge?dry=1  (cron-secret)
//   Body: { email_domains: ['accurateab.com', ...], company_substrings: ['calibration', ...] }
//   ?dry=1 lists matches without deleting.
captureCalcRouter.post('/leads/purge', requireCronSecretFlex, express.json({ limit: '16kb' }), async (req, res) => {
  try {
    const dry = req.query.dry === '1' || req.query.dry === 'true'
    const emailDomains = (req.body?.email_domains || []).map(d => String(d).trim().toLowerCase()).filter(Boolean)
    const companySubs = (req.body?.company_substrings || []).map(s => String(s).trim().toLowerCase()).filter(Boolean)
    if (!emailDomains.length && !companySubs.length) {
      return res.status(400).json({ ok: false, error: 'email_domains[] or company_substrings[] required' })
    }
    const matches = []
    // Walk pages up to 10 (2,000 leads cap — Zoho's DISCRETE_PAGINATION_LIMIT).
    // Beyond 2,000 leads we'd need to switch to page_token-based pagination.
    for (let page = 1; page <= 10; page++) {
      const zoho = await fetchLeadsPage({ page, perPage: 200 })
      const leads = zoho.data || []
      for (const l of leads) {
        const email = String(l.Email || '').trim().toLowerCase()
        const company = String(l.Company || '').trim().toLowerCase()
        const domain = email.split('@')[1] || ''
        const emailMatch = emailDomains.some(d => domain === d || domain.endsWith('.' + d))
        const companyMatch = companySubs.some(s => company.includes(s))
        if (emailMatch || companyMatch) {
          matches.push({
            id: l.id, email: l.Email, company: l.Company,
            first_name: l.First_Name, last_name: l.Last_Name,
            reason: emailMatch ? `domain:${domain}` : `company:${company}`,
          })
        }
      }
      if (!zoho.more) break
    }
    if (dry) {
      return res.json({ ok: true, dry: true, matched: matches.length, matches })
    }
    // Actually delete
    let deleted = 0, failed = 0, errors = []
    for (const m of matches) {
      const r = await deleteLead(m.id)
      if (r.ok) deleted++
      else { failed++; if (errors.length < 10) errors.push({ id: m.id, email: m.email, error: r.error }) }
      await new Promise(r => setTimeout(r, 150))  // throttle
    }
    res.json({ ok: true, matched: matches.length, deleted, failed, errors, matches })
  } catch (e) {
    console.error('[leads purge]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message, detail: e.response?.data })
  }
})

// TEMP DEBUG — generate a sample cover image so Mark can preview both styles
// (editorial-typography vs. moody-photo) before deciding which to ship on
// the LinkedIn post. Returns raw PNG bytes with the correct Content-Type.
//   GET /api/capture-calc/debug/brew-image-sample?secret=X&style=cover|photo&subject=...
captureCalcRouter.get('/debug/brew-image-sample', requireCronSecretFlex, async (req, res) => {
  try {
    const style = String(req.query.style || 'photo').toLowerCase()
    const { generateCoverImage, generateTipCardImage } = await import('../services/nanoBanana.js')
    let result
    if (style === 'cover') {
      result = await generateCoverImage({
        issueNumber: String(req.query.issue || '49'),
        dateISO: String(req.query.date || new Date().toISOString().slice(0, 10)),
        headline: String(req.query.headline || 'Rhode Island just made it harder to total a car'),
      })
    } else {
      // Photo-only style — no text baked in, LinkedIn scroll-stopper
      result = await generateTipCardImage({
        photoSubject: String(req.query.subject || '')
          || 'A heavily damaged late-model sedan sitting in an appraiser bay, moody low-key lighting, shop paperwork on a clipboard in the foreground, dark blue and gunmetal palette, cinematic automotive editorial photography',
      })
    }
    if (!result?.ok) {
      return res.status(500).json({ ok: false, error: result?.error || 'unknown' })
    }
    res.setHeader('Content-Type', result.mimeType || 'image/png')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(result.buffer)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin: bulk-add leads to Zoho CRM Leads module with flat contact-shaped
// fields. Used for one-off harvests (OOO reply team lists, event attendee
// lists, etc.) where each person from one company becomes its own lead.
//   POST /api/capture-calc/leads/bulk-create (cron-secret)
//   Body: { leads: [{ company, first_name, last_name, email, phone, title, lead_source, description }, ...] }
captureCalcRouter.post('/leads/bulk-create', requireCronSecretFlex, express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const leads = Array.isArray(req.body?.leads) ? req.body.leads : []
    if (!leads.length) return res.status(400).json({ ok: false, error: 'leads[] required' })
    const results = []
    let created = 0
    let duplicates = 0
    let failed = 0
    for (const l of leads) {
      const r = await createLeadFlat({
        company:      l.company,
        firstName:    l.first_name || l.firstName,
        lastName:     l.last_name  || l.lastName,
        email:        l.email,
        phone:        l.phone,
        title:        l.title,
        leadSource:   l.lead_source || l.leadSource,
        description:  l.description,
      })
      if (r.duplicate) duplicates++
      else if (r.ok)   created++
      else             failed++
      results.push({ email: l.email, ok: r.ok, id: r.id, duplicate: r.duplicate, error: r.error })
      await new Promise(r => setTimeout(r, 150))  // small throttle for Zoho rate limits
    }
    res.json({ ok: true, total: leads.length, created, duplicates, failed, results })
  } catch (e) {
    console.error('[leads bulk-create]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message, detail: e.response?.data })
  }
})

// Pull one page of Zoho CRM Accounts (customer businesses) and add each to
// the Resend From the Van audience. Accounts is the BUSINESSES module — one
// row per shop Mark works with. Emails on Account records are typically the
// primary shop contact for invoicing and scheduling.
//
// Existing customers already know Mark, so we SKIP the 7-day Magic Lantern
// (which pitches Partnership Discount to warm leads — irrelevant for people
// who already work with him). They go straight into the weekly newsletter.
//
//   POST /api/capture-calc/from-the-van/import-crm-accounts?secret=X
//   Body (optional): { page: 1, per_page: 200 }
//
// Call repeatedly with incrementing page numbers until has_more:false.
captureCalcRouter.post('/from-the-van/import-crm-accounts', requireCronSecretFlex, express.json({ limit: '4kb' }), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.body?.page) || 1)
    const perPage = Math.min(200, Math.max(1, Number(req.body?.per_page) || 200))
    const zoho = await fetchAccountsPage({ page, perPage })
    const accounts = zoho.data || []
    const hasMore = zoho.more === true
    const out = {
      page, per_page: perPage, has_more: hasMore,
      fetched: accounts.length,
      added: 0, duplicates: 0, invalid_or_no_email: 0, skipped_opt_out: 0,
      errors: [],
    }
    for (const a of accounts) {
      if (a.Email_Opt_Out === true) { out.skipped_opt_out++; continue }
      const email = String(a.Email || '').trim().toLowerCase()
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) { out.invalid_or_no_email++; continue }
      // Use the account name as the "firstName" for personalization since
      // that's the shop's identity in the Van context — the weekly email
      // greeting reads "Hey Body Shop Downtown" better than "Hey <no name>".
      const shopName = String(a.Account_Name || '').trim().slice(0, 60)
      const r = await addVanSubscriber({
        email,
        firstName: shopName || undefined,
      })
      if (r.duplicate) out.duplicates++
      else if (r.ok)   out.added++
      else { out.invalid_or_no_email++; if (out.errors.length < 5) out.errors.push({ email, error: r.error }) }
      // Throttle so we stay well under Resend's rate limit
      await new Promise(r => setTimeout(r, 90))
    }
    out.next_page = hasMore ? page + 1 : null
    res.json({ ok: true, ...out })
  } catch (e) {
    console.error('[from-the-van import-crm-accounts]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message, detail: e.response?.data })
  }
})

// Debug — peek at one page of Zoho CRM Accounts. Used to verify field shape
// (Email present? Account_Name populated?) before running the full import.
//   GET /api/capture-calc/debug/accounts-page?secret=X&page=N&per_page=200
captureCalcRouter.get('/debug/accounts-page', requireCronSecretFlex, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const perPage = Math.min(200, Math.max(1, Number(req.query.per_page) || 200))
    const fields = req.query.fields ? String(req.query.fields) : undefined
    const r = await fetchAccountsPage({ page, perPage, fields })
    res.json(r)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, detail: e.response?.data })
  }
})

// Pull one page of Zoho CRM Contacts (customers) and add each to the Resend
// From the Van audience. Existing customers already know Mark, so we SKIP
// the 7-day Magic Lantern (which pitches Partnership Discount to warm leads
// — irrelevant for people who already work with him). They go straight into
// the weekly newsletter list.
//
//   POST /api/capture-calc/from-the-van/import-crm-contacts?secret=X
//   Body (optional): { page: 1, per_page: 200 }
//
// Call repeatedly with incrementing page numbers until the response says
// has_more:false. The 30s Catalyst gateway cap means we do one page per
// request (~200 contacts) rather than walking the whole module in one call.
captureCalcRouter.post('/from-the-van/import-crm-contacts', requireCronSecretFlex, express.json({ limit: '4kb' }), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.body?.page) || 1)
    const perPage = Math.min(200, Math.max(1, Number(req.body?.per_page) || 200))
    const zoho = await fetchContactsPage({ page, perPage })
    const contacts = zoho.data || []
    const hasMore = zoho.more === true || zoho.info?.more_records === true
    // Hardcoded exclude-list of Account_Name substrings (case-insensitive).
    // Anyone whose Account matches is skipped from the Van audience — Mark
    // asked to keep Evergreen Calibration contacts out. Add more entries here
    // as needed; kept in-code so the exclusion is version-controlled + obvious.
    const excludedAccountSubstrings = ['evergreen calibration']
    const out = {
      page, per_page: perPage, has_more: hasMore,
      fetched: contacts.length,
      added: 0, duplicates: 0, invalid: 0,
      skipped_personal: 0,    // no Account_Name = personal contact, not a shop
      skipped_opt_out: 0,     // Email_Opt_Out flag set in CRM
      skipped_excluded: 0,    // Account matches the excluded-list above
      errors: [],
    }
    // Extract an Account_Name value from Zoho's contact record. Zoho returns
    // this as either a string OR a { name, id } lookup object depending on
    // API version + how the field is populated. Handle both.
    const accountName = c => {
      const a = c.Account_Name
      if (!a) return ''
      if (typeof a === 'string') return a.trim()
      if (typeof a === 'object') return String(a.name || '').trim()
      return ''
    }
    for (const c of contacts) {
      // BUSINESS ONLY — skip personal contacts. Business contacts in Zoho
      // are always linked to an Account (the shop/company). Personal contacts
      // have no Account_Name.
      const acct = accountName(c)
      if (!acct) { out.skipped_personal++; continue }
      // Skip accounts on the exclusion list (case-insensitive substring match).
      const acctLower = acct.toLowerCase()
      if (excludedAccountSubstrings.some(s => acctLower.includes(s))) {
        out.skipped_excluded++
        continue
      }
      // Respect Zoho's opt-out flag on the record.
      if (c.Email_Opt_Out === true) { out.skipped_opt_out++; continue }

      const email = String(c.Email || c.email || '').trim().toLowerCase()
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) { out.invalid++; continue }
      const r = await addVanSubscriber({
        email,
        firstName: c.First_Name || c.first_name,
        lastName:  c.Last_Name  || c.last_name,
      })
      if (r.duplicate) out.duplicates++
      else if (r.ok)   out.added++
      else { out.invalid++; if (out.errors.length < 5) out.errors.push({ email, error: r.error }) }
      // Throttle so we stay well under Resend's rate limit
      await new Promise(r => setTimeout(r, 90))
    }
    out.next_page = hasMore ? page + 1 : null
    res.json({ ok: true, ...out })
  } catch (e) {
    console.error('[from-the-van import-crm-contacts]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message, detail: e.response?.data })
  }
})

// objects { email, first_name, last_name }.
//   POST /api/capture-calc/from-the-van/bulk-import (cron-secret)
captureCalcRouter.post('/from-the-van/bulk-import', requireCronSecretFlex, express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.contacts) ? req.body.contacts
              : Array.isArray(req.body?.emails)   ? req.body.emails.map(e => ({ email: e }))
              : []
    if (!raw.length) return res.status(400).json({ ok: false, error: 'contacts[] or emails[] required' })

    const out = { added: 0, duplicates: 0, failed: 0, errors: [] }
    for (const c of raw) {
      const email = String(c.email || '').trim().toLowerCase()
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) { out.failed++; continue }
      const r = await addVanSubscriber({
        email,
        firstName: c.first_name || c.firstName,
        lastName:  c.last_name  || c.lastName,
      })
      if (r.duplicate) out.duplicates++
      else if (r.ok)   out.added++
      else { out.failed++; if (out.errors.length < 10) out.errors.push({ email, error: r.error }) }
      // Small throttle so we don't hammer Resend
      await new Promise(r => setTimeout(r, 100))
    }
    res.json({ ok: true, total_submitted: raw.length, ...out })
  } catch (e) {
    console.error('[from-the-van bulk-import]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// One-off test email send — used to preview From the Van issues before the
// real Resend broadcast. Uses the existing sendBroadcast wrapper (Resend
// under the hood).
//   POST /api/capture-calc/debug/send-test-email  (cron-secret)
//   Body: { to, subject, html, text?, from_email?, from_name?, reply_to? }
captureCalcRouter.post('/debug/send-test-email', requireCronSecretFlex, express.json({ limit: '4mb' }), async (req, res) => {
  try {
    const to = String(req.body?.to || '').trim()
    const subject = String(req.body?.subject || '').trim()
    const html = String(req.body?.html || '')
    if (!to || !subject || !html) return res.status(400).json({ ok: false, error: 'to, subject, html required' })
    const fromEmail = String(req.body?.from_email || 'mark@absoluteadas.com')
    const fromName = String(req.body?.from_name || 'Mark @ Absolute ADAS')
    const replyTo = String(req.body?.reply_to || 'mark@absoluteadas.com')
    const text = String(req.body?.text || '')
    const r = await sendBroadcast({
      recipients: [to],
      subject, html, text: text || undefined,
      fromEmail, fromName, replyTo,
    })
    res.json({ ok: true, to, sender: `${fromName} <${fromEmail}>`, resend: r })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, detail: e.response?.data })
  }
})

// Paginated dump of Zoho CRM Leads. Pull one page at a time so the loop can
// walk the entire module without hitting the 30s HTTP gateway timeout.
//   GET /api/capture-calc/debug/leads-page?secret=X&page=N&per_page=200
captureCalcRouter.get('/debug/leads-page', requireCronSecretFlex, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const perPage = Math.min(200, Math.max(1, Number(req.query.per_page) || 200))
    const fields = req.query.fields ? String(req.query.fields) : undefined
    const cvid = req.query.cvid ? String(req.query.cvid) : undefined
    const r = await fetchLeadsPage({ page, perPage, fields, cvid })
    res.json(r)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, detail: e.response?.data })
  }
})

// Same pattern as /leads-page but for the Contacts module (the ~1,200 people
// Mark has actually worked with — real emails, real relationships). This is
// the source for the From the Van warm-list build.
//   GET /api/capture-calc/debug/contacts-page?secret=X&page=N&per_page=200
captureCalcRouter.get('/debug/contacts-page', requireCronSecretFlex, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const perPage = Math.min(200, Math.max(1, Number(req.query.per_page) || 200))
    const fields = req.query.fields ? String(req.query.fields) : undefined
    const r = await fetchContactsPage({ page, perPage, fields })
    res.json(r)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, detail: e.response?.data })
  }
})

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
