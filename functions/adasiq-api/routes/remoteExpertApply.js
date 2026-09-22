// Weekly Autel Remote Expert application — "Knock".
//
// Mark 2026-09-22: Autel keeps answering "no Expert spots available" and he
// keeps forgetting to ask again. This route sends the same short application
// email from mf@absoluteadas.com once a week so the ask never lapses. It is
// deliberately a plain, polite, one-screen email — not marketing copy.
//
// Fired by .github/workflows/remote-expert-weekly.yml (Tuesday ~9:17 AM PT).
// POST /api/cron/remote-expert-apply   (x-cron-secret: MORNING_CRON_SECRET)
//   ?dry=1    → compose only, return the email, send nothing
//   ?force=1  → ignore the 5-day spacing guard
//
// State lives in ONE AppConfig row (config_key `remote_expert_apply`):
//   { count, last_sent, history: [ISO...] }
// AppConfig, not Cache — Cache tops out at 48h and this is weekly.

import express from 'express'
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
const SUBJECT      = 'Remote Expert application — OEM tool coverage across 8 makes (Mark Fowler, Absolute ADAS)'
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
    'I am applying again to become a Remote Expert. I know spots have been full the last few times I asked. I would like to be on the list for the next one, and I will keep checking in weekly until there is a spot.',
    '',
    'What I bring to the platform is OEM software access across the makes shops ask for most:',
    '• Volkswagen, Audi, Bentley, Lamborghini: ODIS',
    '• Mercedes-Benz: XENTRY',
    '• BMW: ISTA',
    '• Ford and Lincoln: FDRS and FJDS software support',
    '• GM: OEM programming and diagnostics',
    '• Stellantis: OEM programming and diagnostics, Master Certified Technician',
    '',
    'Background: 26 years in the trade, Stellantis Master Certified, and owner of Absolute ADAS (absoluteadas.com), a mobile ADAS calibration and module programming company serving body shops along the I-5 corridor in the Pacific Northwest. My daily work is module programming, coding, and static and dynamic calibrations with Autel and OEM tools, with insurance-grade documentation on every job.',
    '',
    'I can take Remote Expert requests during business hours, and my own technicians will use the platform as well, so the account will be active from day one.',
    '',
    'I can send documentation today: certifications, OEM subscription proof, tool serial numbers, business license, and references. Tell me what you need.',
    '',
    `This is my ${nth} weekly check-in. I will keep it short each week and stop as soon as you tell me the spots are gone for good or I am in.`,
    '',
    'Thank you,',
    'Mark Fowler',
    'Owner, Absolute ADAS',
    FROM_ADDRESS,
    'absoluteadas.com',
  ]
  const text = lines.join('\n')
  const html = lines.map(l => l === '' ? '<br>' : `<div>${escapeHtml(l)}</div>`).join('\n')
  return { to: TO_ADDRESS, from: FROM_ADDRESS, subject: SUBJECT, text, html, week: n, date: todayPT }
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
    await sendMail(token, accountId, { to: TO_ADDRESS, subject: SUBJECT, body: email.html })

    const sentAt = new Date().toISOString()
    await writeState(app, { ...state, count: n, last_sent: sentAt, history: [...(state.history || []), sentAt] })
    await stampSuccess(req, CRON_NAME, { count: n })

    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
      `📨 Knock #${n}: weekly Autel Remote Expert application sent to ${TO_ADDRESS} from ${FROM_ADDRESS}. ` +
      `It's in your Zoho Sent folder. If they reply, this keeps going until you tell me to stop.`
    ).catch(() => {})

    return res.json({ ok: true, sent: true, count: n, to: TO_ADDRESS, at: sentAt })
  } catch (e) {
    console.error('[remote-expert-apply] failed:', e.response?.data || e.message)
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
      `⚠️ Knock: weekly Remote Expert application did NOT send — ${e.message}`
    ).catch(() => {})
    return res.status(500).json({ ok: false, error: e.message })
  }
})

export default router
