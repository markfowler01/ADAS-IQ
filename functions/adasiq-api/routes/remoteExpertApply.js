// Weekly Autel Remote Expert application — "Knock".
//
// Mark 2026-09-22: Autel keeps answering "no Expert spots available" and he
// keeps forgetting to ask again. This route sends the same short application
// email from mf@absoluteadas.com once a week so the ask never lapses. It is
// deliberately a plain, polite, one-screen email — not marketing copy.
//
// Fired by .github/workflows/remote-expert-weekly.yml (Monday 8:00 AM Eastern).
// Mark 2026-09-22: wording must change every week — Claude rewrites the
// locked base letter each send (same facts, fresh phrasing), validated
// against a fact list; any failure falls back to the base copy verbatim.
// POST /api/cron/remote-expert-apply   (x-cron-secret: MORNING_CRON_SECRET)
//   ?dry=1    → compose only, return the email, send nothing
//   ?force=1  → ignore the 5-day spacing guard
//
// State lives in ONE AppConfig row (config_key `remote_expert_apply`):
//   { count, last_sent, history: [ISO...] }
// AppConfig, not Cache — Cache tops out at 48h and this is weekly.

import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import catalyst from 'zcatalyst-sdk-node'
import { getMailAccessToken, getMailAccountIdFor, sendMail } from '../services/mail.js'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from '../services/cliq.js'
import { heartbeatAttempt, stampSuccess } from '../services/cronHeartbeat.js'

const router = express.Router()

// ── Who + what ──────────────────────────────────────────────────────────────
// Recipient: the Autel Remote Expert program address Mark has been writing
// to from Zoho Mail. Env override so it can change without a code edit.
const TO_ADDRESS   = (process.env.REMOTE_EXPERT_APPLY_TO || '').trim()
const FROM_ADDRESS = 'mf@absoluteadas.com'
// Subject rotates weekly so each ask reads fresh in their inbox.
const SUBJECTS = [
  'Remote Expert standby for Pacific hours and rare makes (Mark Fowler, 30-year technician)',
  'Remote Expert: a backup for your thinnest hours (Mark Fowler, Absolute ADAS)',
  'Weekly check-in: Remote Expert application, Pacific time + network diagnostics',
  'Still here for the gaps: Remote Expert application from a 30-year technician',
  'Remote Expert overflow, West Coast hours, Bentley/Lamborghini/Stellantis (Mark Fowler)',
  'Remote Expert application, week check-in: Mark Fowler, Absolute ADAS',
]
const subjectFor = n => SUBJECTS[(Math.max(1, n) - 1) % SUBJECTS.length]
const MIN_DAYS_BETWEEN_SENDS = 5
const CRON_NAME    = 'remote_expert_apply'
const CONFIG_KEY   = 'remote_expert_apply'
const CRON_SECRET_FALLBACK = 'morning-2026'

function requireCronSecret(req, res, next) {
  const expected = String(process.env.MORNING_CRON_SECRET || CRON_SECRET_FALLBACK).trim()
  const got = String(req.headers['x-cron-secret'] || req.headers['x_cron_secret'] || req.query.secret || '').trim()
  if (!expected || got !== expected) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// ── The email ───────────────────────────────────────────────────────────────
// `n` is which weekly ask this is (1 = first). Wording stays steady on
// purpose: same subject every week so Autel's mailbox threads it, and the
// "week N" line makes the persistence visible without being pushy.
export function composeEmail(n, todayPT) {
  const nth = n <= 1 ? 'first' : `${n}${ordinalSuffix(n)}`
  const lines = [
    'Hello Autel Remote Expert team,',
    '',
    'I know you have said the Expert roster is full, so I am not asking for a seat someone else is using. I am asking for the gaps.',
    '',
    'I spent 30 years as a technician. I am off the floor now, and module programming and ADAS calibration is all I do, every day. That means two things for your platform. I know exactly what the tech on the other end expects from a remote session, because I have been that tech. And I can answer fast, because I am not being pulled back to a car.',
    '',
    'One more thing I bring that most programming experts do not: electrical and network diagnostics is my strongest skill. I can read a CAN network like an X-ray. When a flash fails halfway, a module will not wake up on the bus, or a calibration will not complete because of a communication fault, that is where I am at my best. I am happy to be the one your team sends those to.',
    '',
    'Where I think I help you most:',
    '',
    '1. Pacific time coverage. Standby Monday through Friday, 7 AM to 7 PM Pacific, with a response inside 10 minutes. West Coast shops at 3 PM are your thinnest hour.',
    '',
    '2. Makes most experts do not carry. Bentley and Lamborghini on ODIS, and Stellantis as a Master Certified Technician.',
    '',
    '3. Network and no-communication problems. The sessions that stall out on other experts.',
    '',
    '4. Overflow only, if that is all you have. Put me on as a backup that only gets pinged when your regular experts are busy. If I never get a call, it costs you nothing.',
    '',
    'OEM software I own and use, with active subscriptions:',
    '• Volkswagen, Audi, Bentley, Lamborghini: ODIS. Module flashing, coding and adaptations, and ADAS calibrations.',
    '• Mercedes-Benz: XENTRY Diagnosis. Module programming, SCN coding, and camera and radar calibrations.',
    '• BMW: ISTA. Module programming and coding, and ADAS calibrations.',
    '• Ford and Lincoln: FDRS and FJDS software support. Module programming, Programmable Module Installation, as-built data, and calibrations.',
    '• GM: Techline Connect with GDS2 and SPS2. Module programming, setup and configuration, and calibrations.',
    '• Stellantis (Chrysler, Dodge, Jeep, Ram, Fiat, Alfa Romeo): wiTECH 2.0 with TechAuthority. Module flashing, PROXI alignment and configuration, and calibrations. Stellantis Master Certified Technician.',
    '',
    'Background: owner of Absolute ADAS (absoluteadas.com), a mobile ADAS calibration and module programming company serving body shops along the I-5 corridor in the Pacific Northwest, with insurance-grade documentation and pre and post scan reports on every job.',
    '',
    'I can send verification today: OEM subscription confirmations, certifications, tool serial numbers, business license, insurance certificate, and shop references. Tell me what you need and I will have it back to you the same day.',
    '',
    `This is my ${nth} weekly check-in. I will keep it short each week and stop as soon as you tell me I am in, or that the program is closed for good.`,
    '',
    'Thank you,',
    'Mark Fowler',
    'Owner, Absolute ADAS',
    FROM_ADDRESS,
    'absoluteadas.com',
  ]
  const text = lines.join('\n')
  const html = toHtml(text)
  return { to: TO_ADDRESS, from: FROM_ADDRESS, subject: subjectFor(n), text, html, week: n, date: todayPT, variant: 'base' }
}

function toHtml(text) {
  return String(text).split('\n').map(l => l === '' ? '<br>' : `<div>${escapeHtml(l)}</div>`).join('\n')
}

// ── Weekly rewording ────────────────────────────────────────────────────────
// Facts that must survive any rewrite. If Claude drops one, or invents a
// number the base letter never had, we send the base copy instead.
const REQUIRED = ['ODIS', 'XENTRY', 'ISTA', 'FDRS', 'FJDS', 'GDS2', 'SPS2', 'wiTECH', 'Master Certified',
  'Bentley', 'Lamborghini', '30 years', 'Pacific', 'CAN', 'Absolute ADAS', FROM_ADDRESS, 'weekly check-in']
const numbersIn = t => new Set((String(t).match(/\d+/g) || []))

export function validateVariant(text, base) {
  const problems = []
  for (const r of REQUIRED) if (!text.includes(r)) problems.push(`missing: ${r}`)
  const allowed = numbersIn(base)
  for (const n of numbersIn(text)) if (!allowed.has(n)) problems.push(`new number: ${n}`)
  if (/[—!]/.test(text)) problems.push('em dash or exclamation')
  const ratio = text.length / base.length
  if (ratio < 0.6 || ratio > 1.4) problems.push(`length ratio ${ratio.toFixed(2)}`)
  return problems
}

export async function varyEmail(base, n) {
  if (!process.env.ANTHROPIC_API_KEY) return { text: base, variant: 'base', reason: 'no api key' }
  const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const seed = ['plain and direct', 'warm and brief', 'matter-of-fact, shop-floor voice', 'confident and short', 'friendly, one idea per sentence', 'straight talk, no filler'][(n - 1) % 6]
  const prompt = `Rewrite the letter below so it reads fresh, in a ${seed} tone. It is week ${n} of a weekly check-in to Autel's Remote Expert program from Mark Fowler, a 30-year technician.

Hard rules:
- Same facts only. Do not add, remove, or change any claim, tool, make, number, year, hour, or credential. Do not invent anything.
- Keep every OEM tool line (ODIS, XENTRY, ISTA, FDRS, FJDS, GDS2, SPS2, wiTECH) and what each is used for. You may reorder or reformat them.
- Keep the four "gaps" ideas: Pacific hours standby with a 10 minute response, rare makes, network and no-communication problems, overflow-only.
- Keep the CAN network X-ray idea and the "I have been that tech" idea.
- Keep the line "This is my ${n <= 1 ? 'first' : n + ordinalSuffix(n)} weekly check-in." exactly, and the closing signature block exactly as written.
- Short sentences. No em dashes. No exclamation points. No marketing words. No headings. Plain text only, no markdown.
- Length within 20 percent of the original.

Return only the rewritten letter, starting with the greeting.

LETTER:
${base}`
  try {
    const r = await claude.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1800, temperature: 1,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = (r.content?.[0]?.text || '').trim()
    const problems = validateVariant(text, base)
    if (problems.length) return { text: base, variant: 'base', reason: problems.join('; ') }
    return { text, variant: 'claude' }
  } catch (e) {
    return { text: base, variant: 'base', reason: e.message }
  }
}

function ordinalSuffix(n) {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return 'th'
  return ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── State (AppConfig) ───────────────────────────────────────────────────────
async function readState(app) {
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${CONFIG_KEY}' LIMIT 1`
  ).catch(() => [])
  const r = rows?.[0]?.AppConfig || rows?.[0] || null
  let val = { count: 0, last_sent: null, history: [] }
  try { if (r?.config_value) val = { ...val, ...JSON.parse(r.config_value) } } catch { /* keep default */ }
  return { rowId: r?.ROWID ? String(r.ROWID) : null, ...val }
}

async function writeState(app, state) {
  const table = app.datastore().table('AppConfig')
  const config_value = JSON.stringify({
    count: state.count, last_sent: state.last_sent, history: (state.history || []).slice(-60),
  })
  if (state.rowId) await table.updateRow({ ROWID: state.rowId, config_value })
  else await table.insertRow({ config_key: CONFIG_KEY, config_value })
}

function todayPT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function daysBetween(isoA, isoB) {
  return Math.abs(new Date(isoA).getTime() - new Date(isoB).getTime()) / 86400000
}

// ── Route ───────────────────────────────────────────────────────────────────
router.all('/', heartbeatAttempt(CRON_NAME), requireCronSecret, async (req, res) => {
  const dry   = ['1', 'true'].includes(String(req.query.dry || ''))
  const force = ['1', 'true'].includes(String(req.query.force || ''))
  const app   = catalyst.initialize(req)
  const today = todayPT()

  try {
    const state = await readState(app)
    const n = (state.count || 0) + 1
    const email = composeEmail(n, today)
    const varied = await varyEmail(email.text, n)
    email.text = varied.text
    email.html = toHtml(varied.text)
    email.variant = varied.variant
    if (varied.reason) email.fallback_reason = varied.reason

    if (dry) {
      return res.json({ ok: true, dry: true, would_send: !!TO_ADDRESS, state: { count: state.count, last_sent: state.last_sent }, email })
    }
    if (!TO_ADDRESS) {
      return res.status(400).json({ ok: false, error: 'REMOTE_EXPERT_APPLY_TO is not set — no recipient, nothing sent' })
    }
    if (!force && state.last_sent && daysBetween(state.last_sent, new Date().toISOString()) < MIN_DAYS_BETWEEN_SENDS) {
      return res.json({ ok: true, skipped: `sent ${state.last_sent}, under ${MIN_DAYS_BETWEEN_SENDS}-day spacing`, count: state.count })
    }

    const token = await getMailAccessToken()
    const accountId = await getMailAccountIdFor(token, FROM_ADDRESS)
    await sendMail(token, accountId, { to: TO_ADDRESS, subject: email.subject, body: email.html })

    const sentAt = new Date().toISOString()
    await writeState(app, { ...state, count: n, last_sent: sentAt, history: [...(state.history || []), { at: sentAt, subject: email.subject, variant: email.variant }] })
    await stampSuccess(req, CRON_NAME, { count: n, variant: email.variant })

    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
      `📨 Knock #${n}: weekly Autel Remote Expert application sent to ${TO_ADDRESS} from ${FROM_ADDRESS} (${email.variant === 'claude' ? 'fresh wording' : 'base copy'}). ` +
      `It's in your Zoho Sent folder. If they reply, this keeps going until you tell me to stop.`
    ).catch(() => {})

    return res.json({ ok: true, sent: true, count: n, to: TO_ADDRESS, at: sentAt, subject: email.subject, variant: email.variant })
  } catch (e) {
    console.error('[remote-expert-apply] failed:', e.response?.data || e.message)
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
      `⚠️ Knock: weekly Remote Expert application did NOT send — ${e.message}`
    ).catch(() => {})
    return res.status(500).json({ ok: false, error: e.message })
  }
})

export default router
