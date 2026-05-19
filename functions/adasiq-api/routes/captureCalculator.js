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
