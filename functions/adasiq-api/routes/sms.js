// SMS routes — Phase 1 rebuild (2026-07-07).
//
// Endpoints:
//   POST /webhooks/twilio/sms   — Twilio inbound webhook (public, signature-validated)
//   POST /api/sms/send          — send an SMS (auth required)
//   GET  /api/sms/threads       — list threads (auth required)
//   GET  /api/sms/threads/:phone — full conversation for one number (auth required)
//
// Storage: Catalyst Cache key `sms_threads` — array of message events,
// rolling 90 days. Same pattern used by ready_invoice_events and other
// event logs. Avoids the need to create a new Datastore table in the
// Catalyst console.
//
// Cliq: every inbound message posts to #aajobs so the team sees it.
// Every inbound also forwards to Mark's cell (MARK_PHONE_NUMBER env)
// unless the sender IS Mark's cell (loop guard).

import express from 'express'
import axios from 'axios'
import {
  sendTwilioSMS,
  normalizePhoneUS,
  formatPhonePretty,
  classifyTwilioNumber,
  validateTwilioSignature,
  twilioConfigured,
} from '../services/twilio.js'
import { postToCliqChannel, AA_JOBS_CHANNEL } from '../services/cliq.js'

const router = express.Router()

// ── Catalyst Cache helpers ──────────────────────────────────────────────────
const CATALYST_API = 'https://api.catalyst.zoho.com'
const SMS_CACHE_KEY = 'sms_threads'
const RETENTION_DAYS = 90

function catalystHeaders(req) {
  const token = req.headers['x-zc-admin-cred-token'] || req.headers['x-zc-user-cred-token'] || ''
  return { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }
}
function catalystProjectId(req) {
  return req.headers['x-zc-projectid'] || process.env.CATALYST_PROJECT_ID || ''
}

async function readAllMessages(req) {
  const url = `${CATALYST_API}/baas/v1/project/${catalystProjectId(req)}/cache/${SMS_CACHE_KEY}`
  try {
    const r = await axios.get(url, { headers: catalystHeaders(req) })
    const val = r.data?.data?.cache_value
    return val ? JSON.parse(val) : []
  } catch (e) {
    if (e.response?.status === 404) return []
    console.warn('[sms cache read]', e.message)
    return []
  }
}

async function writeAllMessages(req, records) {
  const projectId = catalystProjectId(req)
  const baseUrl = `${CATALYST_API}/baas/v1/project/${projectId}/cache`
  const headers = catalystHeaders(req)
  const body = { cache_name: SMS_CACHE_KEY, cache_value: JSON.stringify(records), expiry_in_hours: null }
  try {
    await axios.put(`${baseUrl}/${SMS_CACHE_KEY}`, { cache_value: body.cache_value, expiry_in_hours: null }, { headers })
  } catch (e) {
    if (e.response?.status === 404) {
      await axios.post(baseUrl, body, { headers })
    } else {
      throw e
    }
  }
}

async function appendMessage(req, record) {
  let records = []
  try { records = await readAllMessages(req) } catch { records = [] }
  records.push(record)
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  records = records.filter(r => {
    const t = new Date(r.timestamp || 0).getTime()
    return !Number.isNaN(t) && t > cutoff
  })
  // Cache value cap is ~64-100KB. Trim from the oldest if we approach it.
  const serialized = JSON.stringify(records)
  if (serialized.length > 60_000) {
    records = records.slice(-500) // keep the 500 most recent as a safety net
  }
  try { await writeAllMessages(req, records) }
  catch (e) { console.warn('[sms cache write]', e.message) }
}

// ── Thread key & bucketing ──────────────────────────────────────────────────
// A "thread" is a conversation with one external phone number. Key = the
// counterparty's E.164, regardless of direction. Groups inbound + outbound
// on the same number into one back-and-forth view.
function threadKey(record) {
  return record.direction === 'inbound' ? record.from_number : record.to_number
}

function bucketByThread(messages) {
  const buckets = new Map()
  for (const m of messages) {
    const key = threadKey(m)
    if (!key) continue
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(m)
  }
  const threads = []
  for (const [phone, msgs] of buckets) {
    msgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    const last = msgs[msgs.length - 1]
    threads.push({
      phone,
      phone_pretty: formatPhonePretty(phone),
      last_body: last.body || '',
      last_direction: last.direction,
      last_timestamp: last.timestamp,
      message_count: msgs.length,
      unread_count: msgs.filter(m => m.direction === 'inbound' && !m.read_at).length,
    })
  }
  threads.sort((a, b) => new Date(b.last_timestamp) - new Date(a.last_timestamp))
  return threads
}

// ── Auto-reply logic ────────────────────────────────────────────────────────
// Two rules, both gated by a Catalyst Cache dedup key so we never spam a
// customer with duplicate auto-replies:
//
//   1. First-contact — the first time we ever hear from this phone,
//      send a welcome. Detected by checking whether the number has any
//      other messages in the log at the time of receipt (only the
//      just-inserted inbound record).
//
//   2. After-hours — controlled by env vars. If enabled + we're outside
//      business hours in PT + we haven't already auto-replied today,
//      send the after-hours message.
function hourPTNow() {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false,
  }).format(new Date())
  return parseInt(s, 10) % 24
}

function isAfterHoursNow() {
  const startEnv = process.env.AFTER_HOURS_START
  const endEnv   = process.env.AFTER_HOURS_END
  const start = Number.isFinite(parseInt(startEnv, 10)) ? parseInt(startEnv, 10) : 18
  const end   = Number.isFinite(parseInt(endEnv,   10)) ? parseInt(endEnv,   10) : 7
  const h = hourPTNow()
  // Overnight window (e.g. start=18, end=7): after-hours = h >= 18 OR h < 7
  if (start > end) return h >= start || h < end
  // Same-day window (rare — e.g. start=12, end=15)
  return h >= start && h < end
}

const FIRST_CONTACT_BODY =
  "Thanks for reaching Absolute ADAS. We got your text and someone will be back with you shortly. " +
  "Reply STOP to opt out."

const AFTER_HOURS_BODY =
  "Thanks for texting Absolute ADAS. We're closed right now (7am–6pm PT weekdays). " +
  "We'll reply first thing in the morning. Reply STOP to opt out."

// Same daily dedup pattern used for the morning kickoff. Key namespaces
// so first-contact and after-hours dedup independently.
async function readAutoReplyStamp(req, key) {
  const url = `${CATALYST_API}/baas/v1/project/${catalystProjectId(req)}/cache/${key}`
  try {
    const r = await axios.get(url, { headers: catalystHeaders(req) })
    return r.data?.data?.cache_value || null
  } catch (e) {
    if (e.response?.status === 404) return null
    return null
  }
}
async function writeAutoReplyStamp(req, key) {
  const baseUrl = `${CATALYST_API}/baas/v1/project/${catalystProjectId(req)}/cache`
  const headers = catalystHeaders(req)
  const now = new Date().toISOString()
  try {
    await axios.put(`${baseUrl}/${key}`, { cache_value: now, expiry_in_hours: 25 }, { headers })
  } catch (e) {
    if (e.response?.status === 404) {
      await axios.post(baseUrl, { cache_name: key, cache_value: now, expiry_in_hours: 25 }, { headers })
    }
  }
}
function dateStrPT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

// ── POST /webhooks/twilio/sms ────────────────────────────────────────────────
// Twilio inbound webhook. Twilio POSTs application/x-www-form-urlencoded.
// We validate signature, log the message, post to Cliq, forward to Mark.
// Response is TwiML (empty message) so Twilio doesn't retry.
router.post('/', async (req, res) => {
  try {
    // Validate signature — but log-and-continue on missing token config so
    // Mark can bring the system online BEFORE he pastes the auth token, if
    // he ever wants to. Once TWILIO_AUTH_TOKEN is set, invalid signatures
    // reject with 403 as the spec requires.
    if (twilioConfigured()) {
      const check = validateTwilioSignature(req)
      if (!check.ok) {
        console.warn('[sms inbound] signature check failed:', check.reason, 'url:', check.url)
        return res.status(403).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
      }
    } else {
      console.warn('[sms inbound] Twilio not configured — accepting webhook without signature validation')
    }

    const from = normalizePhoneUS(req.body.From) || String(req.body.From || '')
    const to   = normalizePhoneUS(req.body.To)   || String(req.body.To   || '')
    const body = String(req.body.Body || '').trim()
    const sid  = String(req.body.MessageSid || '')
    const numMedia = parseInt(req.body.NumMedia || '0', 10) || 0

    const record = {
      message_sid: sid,
      direction:   'inbound',
      from_number: from,
      to_number:   to,
      body,
      timestamp:   new Date().toISOString(),
      line_type:   classifyTwilioNumber(to),
      num_media:   numMedia,
    }

    // 1) Persist to cache log
    await appendMessage(req, record)

    // 2) Post to #aajobs so the team sees it
    try {
      const label = record.line_type === 'tollfree' ? '844' : (record.line_type === 'local' ? '425' : 'unknown')
      const msg = [
        `📩 *SMS in* · ${formatPhonePretty(from)} → ${label}`,
        body ? `"${body.slice(0, 400)}"` : '_(no text — media only)_',
        numMedia > 0 ? `📎 ${numMedia} attachment${numMedia === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join('\n')
      await postToCliqChannel(AA_JOBS_CHANNEL, msg)
    } catch (e) { console.warn('[sms inbound cliq]', e.message) }

    // 3) Forward to Mark's cell for a native iOS notification. Skip if the
    //    sender IS Mark's cell (loop guard) or Twilio isn't configured.
    try {
      const markCell = normalizePhoneUS(process.env.MARK_PHONE_NUMBER || '')
      const senderNorm = normalizePhoneUS(from)
      if (markCell && senderNorm && senderNorm !== markCell && twilioConfigured()) {
        const label = record.line_type === 'tollfree' ? '844' : (record.line_type === 'local' ? '425' : record.line_type)
        const forwardBody = `📱 SMS to ${label} from ${formatPhonePretty(from)}\n${body || '(media only)'}`.slice(0, 480)
        await sendTwilioSMS({ to: markCell, body: forwardBody, from: 'local' })
      }
    } catch (e) { console.warn('[sms inbound forward]', e.message) }

    // 4) Auto-reply logic — first-contact + after-hours. Both are gated by
    //    Catalyst Cache stamps keyed by phone + day so a customer never
    //    gets two of the same auto-reply on the same day. STOP keyword
    //    inbounds are Twilio-handled at the messaging service level (opt
    //    out); we skip auto-replies on any STOP/HELP/UNSUBSCRIBE body as
    //    a belt-and-suspenders measure.
    try {
      if (twilioConfigured()) {
        const bodyUpper = (body || '').toUpperCase().trim()
        const isStopish = /^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|HELP)$/.test(bodyUpper)
        if (!isStopish) {
          const senderKey = (from || '').replace(/[^0-9+]/g, '')
          // First-contact: is this the ONLY message we have on this number?
          const all = await readAllMessages(req)
          const messagesForNumber = all.filter(m => (m.from_number === from) || (m.to_number === from))
          if (messagesForNumber.length <= 1) {
            const stampKey = `sms_autoreply_first_${senderKey}`
            const stamp = await readAutoReplyStamp(req, stampKey)
            if (!stamp) {
              const fromLine = record.line_type === 'tollfree' ? 'tollfree' : 'local'
              await sendTwilioSMS({ to: from, body: FIRST_CONTACT_BODY, from: fromLine })
              await writeAutoReplyStamp(req, stampKey)
            }
          } else if (isAfterHoursNow() && String(process.env.AFTER_HOURS_AUTOREPLY || 'false').toLowerCase() === 'true') {
            // After-hours (only if we haven't already auto-replied to this
            // number today).
            const stampKey = `sms_autoreply_afterhours_${senderKey}_${dateStrPT()}`
            const stamp = await readAutoReplyStamp(req, stampKey)
            if (!stamp) {
              const fromLine = record.line_type === 'tollfree' ? 'tollfree' : 'local'
              await sendTwilioSMS({ to: from, body: AFTER_HOURS_BODY, from: fromLine })
              await writeAutoReplyStamp(req, stampKey)
            }
          }
        }
      }
    } catch (e) { console.warn('[sms auto-reply]', e.message) }

    // 5) Ack Twilio with empty TwiML
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
  } catch (err) {
    console.error('[sms inbound]', err.message, err.stack)
    res.status(500).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
  }
})

// ── Auth-gated router below ─────────────────────────────────────────────────
const auth = express.Router()

// POST /api/sms/send { to, body, from? }
// `from` is 'local' | 'tollfree' | explicit E.164 — defaults to 'local'.
auth.post('/send', async (req, res) => {
  try {
    if (!twilioConfigured()) {
      return res.status(503).json({ ok: false, error: 'Twilio not configured (set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN)' })
    }
    const { to, body, from } = req.body || {}
    if (!to || !body) return res.status(400).json({ ok: false, error: 'to and body required' })

    const result = await sendTwilioSMS({ to, body, from })
    if (!result.ok) return res.status(422).json(result)

    // Log outbound
    const record = {
      message_sid: result.sid,
      direction:   'outbound',
      from_number: result.from,
      to_number:   result.to,
      body:        String(body),
      timestamp:   new Date().toISOString(),
      line_type:   classifyTwilioNumber(result.from),
      sender:      req.user?.email || req.user?.techName || 'app',
    }
    await appendMessage(req, record)
    res.json({ ok: true, sid: result.sid, message: record })
  } catch (err) {
    console.error('[sms send]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/sms/threads — list of conversations, newest first
auth.get('/threads', async (req, res) => {
  try {
    const all = await readAllMessages(req)
    res.json({ ok: true, threads: bucketByThread(all) })
  } catch (err) {
    console.error('[sms threads]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/sms/threads/:phone — full ordered conversation
auth.get('/threads/:phone', async (req, res) => {
  try {
    const key = normalizePhoneUS(req.params.phone) || String(req.params.phone || '')
    const all = await readAllMessages(req)
    const messages = all
      .filter(m => threadKey(m) === key)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    res.json({
      ok: true,
      phone: key,
      phone_pretty: formatPhonePretty(key),
      messages,
    })
  } catch (err) {
    console.error('[sms thread]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export { router as smsWebhookRouter, auth as smsAuthRouter }
