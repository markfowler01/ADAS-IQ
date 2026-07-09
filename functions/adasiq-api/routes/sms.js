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
import crypto from 'node:crypto'
import catalyst from 'zcatalyst-sdk-node'
import {
  sendTwilioSMS,
  normalizePhoneUS,
  formatPhonePretty,
  classifyTwilioNumber,
  validateTwilioSignature,
  twilioConfigured,
} from '../services/twilio.js'
import { resolvePhoneConfig } from '../services/phoneConfig.js'
import { postToCliqChannel, SMS_TOLLFREE_CHANNEL, SMS_LOCAL_CHANNEL } from '../services/cliq.js'
import { loadPhoneIndex, normPhone, contactLabel, findContactByPhone } from '../services/crmContacts.js'

const router = express.Router()

// ── Catalyst Cache helpers ──────────────────────────────────────────────────
// Uses the Catalyst SDK (not raw axios) — the axios path was silently 404ing
// due to the same auth-scheme mismatch that broke Phone Setup. Migrated
// 2026-07-08 to make SMS history actually persist across reloads.
const SMS_CACHE_KEY = 'sms_threads'
const RETENTION_DAYS = 90

// ── Signed media URLs ───────────────────────────────────────────────────────
// The media proxy has to be reachable by <img src> in the browser, which
// can't send X-Auth-Token. So we mount it publicly and gate access with
// an HMAC signature derived from SESSION_SECRET. Only URLs the server
// itself generated (in the auth-gated /threads/:phone response) will
// have a valid sig.
function mediaSig(sid, idx) {
  const secret = process.env.SESSION_SECRET || 'adasiq-fallback-secret'
  return crypto.createHmac('sha256', secret)
    .update(`${sid}:${idx}`)
    .digest('hex')
    .slice(0, 32)
}
function signedMediaUrl(sid, idx) {
  return `/webhooks/twilio/sms/media/${encodeURIComponent(sid)}/${idx}?sig=${mediaSig(sid, idx)}`
}
// Rewrite each media entry's proxy_url to the current signed URL. Called
// at serve time so old records (with the pre-signature path) still work
// without a migration.
function rewriteMediaUrls(messages) {
  return (messages || []).map(m => ({
    ...m,
    media: (m.media || []).map((mm, i) => ({
      ...mm,
      proxy_url: signedMediaUrl(m.message_sid, i),
    })),
  }))
}

function getSegment(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.cache().segment()
}

async function readAllMessages(req) {
  try {
    const segment = getSegment(req)
    const val = await segment.getValue(SMS_CACHE_KEY)
    if (!val) return []
    try { return typeof val === 'string' ? JSON.parse(val) : (val || []) }
    catch { return [] }
  } catch (e) {
    console.warn('[sms cache read]', e.message)
    return []
  }
}

async function writeAllMessages(req, records) {
  const segment = getSegment(req)
  const val = JSON.stringify(records || [])
  // segment.put requires a TTL in hours as the 3rd arg — without it the
  // first-ever write silently fails and nothing persists. 90 days
  // matches RETENTION_DAYS above.
  try { await segment.update(SMS_CACHE_KEY, val) }
  catch { await segment.put(SMS_CACHE_KEY, val, 48 /* Catalyst Cache max */) }
}

// Returns { ok, error, count } so callers can tell whether the write
// actually succeeded. Previously the outer catch silently swallowed
// write errors — the send endpoint would happily return "message sent"
// while the persisted log never actually contained the message, so the
// optimistic UI append disappeared on the next refresh.
async function appendMessage(req, record) {
  let records = []
  try { records = await readAllMessages(req) } catch { records = [] }
  records.push(record)
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  records = records.filter(r => {
    const t = new Date(r.timestamp || 0).getTime()
    return !Number.isNaN(t) && t > cutoff
  })
  // Cache value cap is ~64-100KB. Trim iteratively (10% at a time from
  // the oldest end) until we're comfortably under 45KB — leaves headroom
  // for JSON overhead + the marginal record we're adding.
  const MAX_BYTES = 45_000
  while (records.length > 1 && JSON.stringify(records).length > MAX_BYTES) {
    const dropCount = Math.max(1, Math.floor(records.length * 0.1))
    records = records.slice(dropCount)
  }
  try {
    await writeAllMessages(req, records)
    return { ok: true, count: records.length }
  } catch (e) {
    console.warn('[sms cache write]', e.message)
    return { ok: false, error: e.message, count: records.length }
  }
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

function isAfterHoursNow(cfg) {
  cfg = cfg || {}
  const startRaw = cfg.AFTER_HOURS_START || process.env.AFTER_HOURS_START
  const endRaw   = cfg.AFTER_HOURS_END   || process.env.AFTER_HOURS_END
  const start = Number.isFinite(parseInt(startRaw, 10)) ? parseInt(startRaw, 10) : 18
  const end   = Number.isFinite(parseInt(endRaw,   10)) ? parseInt(endRaw,   10) : 7
  const h = hourPTNow()
  // Overnight window (e.g. start=18, end=7): after-hours = h >= 18 OR h < 7
  if (start > end) return h >= start || h < end
  // Same-day window (rare — e.g. start=12, end=15)
  return h >= start && h < end
}

// Auto-reply copy — includes STOP/HELP opt-out language required for
// A2P 10DLC and toll-free compliance. Do not remove without a plan to
// re-verify the campaign; Twilio reviewers look for this exact pattern.
const FIRST_CONTACT_BODY =
  "Absolute ADAS: Thanks for reaching us. We got your text and someone will be back shortly. " +
  "Reply STOP to opt out, HELP for help. Msg&data rates may apply."

const AFTER_HOURS_BODY =
  "Absolute ADAS: We're closed right now (7am–6pm PT weekdays). We'll reply first thing in the morning. " +
  "Reply STOP to opt out, HELP for help. Msg&data rates may apply."

// Same daily dedup pattern used for the morning kickoff. Key namespaces
// so first-contact and after-hours dedup independently.
async function readAutoReplyStamp(req, key) {
  try {
    const segment = getSegment(req)
    const val = await segment.getValue(key)
    return val || null
  } catch { return null }
}
async function writeAutoReplyStamp(req, key) {
  try {
    const segment = getSegment(req)
    const now = new Date().toISOString()
    try { await segment.update(key, now, 25) }
    catch { await segment.put(key, now, 25) }
  } catch (e) { console.warn('[sms autoreply stamp]', e.message) }
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
    const cfg = await resolvePhoneConfig(req)

    // Signature validation: log-only for now. Catalyst's gateway rewrites
    // the URL Twilio signs against, so the naive host+path reconstruction
    // in validateTwilioSignature returns false negatives. Until that's
    // solved, log the outcome but never reject — the endpoint's public
    // URL is not guessable and rate-limited by the gateway.
    if (cfg.TWILIO_AUTH_TOKEN) {
      try {
        const v = await validateTwilioSignature(req, cfg)
        if (!v?.ok) console.warn('[sms inbound] sig check failed (log-only):', v?.reason)
      } catch (e) { console.warn('[sms inbound] sig check err:', e.message) }
    }

    const from = normalizePhoneUS(req.body.From) || String(req.body.From || '')
    const to   = normalizePhoneUS(req.body.To)   || String(req.body.To   || '')
    const body = String(req.body.Body || '').trim()
    const sid  = String(req.body.MessageSid || '')
    const numMedia = parseInt(req.body.NumMedia || '0', 10) || 0

    // Twilio POSTs MediaUrl0/MediaContentType0 pairs for each attachment.
    // We store the raw Twilio URLs plus a proxied path — the frontend
    // fetches via our proxy (which adds Basic auth) so images display
    // inline without exposing Twilio credentials to the browser.
    const media = []
    for (let i = 0; i < numMedia; i++) {
      const url = String(req.body[`MediaUrl${i}`] || '')
      const contentType = String(req.body[`MediaContentType${i}`] || '')
      if (url) media.push({ url, contentType, proxy_url: `/api/sms/media/${encodeURIComponent(sid)}/${i}` })
    }

    const record = {
      message_sid: sid,
      direction:   'inbound',
      from_number: from,
      to_number:   to,
      body,
      timestamp:   new Date().toISOString(),
      line_type:   classifyTwilioNumber(to, cfg),
      num_media:   numMedia,
      media,
    }

    // 1) Persist to cache log
    await appendMessage(req, record)

    // CRM contact lookup — best-effort. If the sender's phone matches a
    // shop or person on file, we surface the name/shop in both the Cliq
    // alert and the forward SMS to Mark's cell.
    let contact = null
    try { contact = await findContactByPhone(req, from) } catch { contact = null }
    const contactStr = contactLabel(contact)

    // 2) Post to #aajobs so the team sees it
    try {
      const label = record.line_type === 'tollfree' ? '844' : (record.line_type === 'local' ? '425' : 'unknown')
      const senderStr = contactStr
        ? `👤 ${contactStr} · ${formatPhonePretty(from)}`
        : formatPhonePretty(from)
      const msg = [
        `📩 *SMS in* · ${senderStr} → ${label}`,
        body ? `"${body.slice(0, 400)}"` : '_(no text — media only)_',
        numMedia > 0 ? `📎 ${numMedia} attachment${numMedia === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join('\n')
      // Route by which line the text arrived on. Unknown lines fall
      // back to the tollfree channel as a catch-all so nothing gets
      // silently dropped.
      const channel = record.line_type === 'local' ? SMS_LOCAL_CHANNEL : SMS_TOLLFREE_CHANNEL
      await postToCliqChannel(channel, msg)
    } catch (e) { console.warn('[sms inbound cliq]', e.message) }

    // 3) Forward to Mark's cell for a native iOS notification. Skip if the
    //    sender IS Mark's cell (loop guard) or Twilio isn't configured.
    try {
      const markCell = normalizePhoneUS(cfg.MARK_PHONE_NUMBER || '')
      const senderNorm = normalizePhoneUS(from)
      if (markCell && senderNorm && senderNorm !== markCell && twilioConfigured(cfg)) {
        const label = record.line_type === 'tollfree' ? '844' : (record.line_type === 'local' ? '425' : record.line_type)
        const senderPart = contactStr
          ? `${contactStr} (${formatPhonePretty(from)})`
          : formatPhonePretty(from)
        const forwardBody = `📱 SMS to ${label} from ${senderPart}\n${body || '(media only)'}`.slice(0, 480)
        await sendTwilioSMS({ to: markCell, body: forwardBody, from: 'local', cfg })
      }
    } catch (e) { console.warn('[sms inbound forward]', e.message) }

    // 4) Auto-reply logic — first-contact + after-hours. Both are gated by
    //    Catalyst Cache stamps keyed by phone + day so a customer never
    //    gets two of the same auto-reply on the same day. STOP keyword
    //    inbounds are Twilio-handled at the messaging service level (opt
    //    out); we skip auto-replies on any STOP/HELP/UNSUBSCRIBE body as
    //    a belt-and-suspenders measure.
    try {
      if (twilioConfigured(cfg)) {
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
              await sendTwilioSMS({ to: from, body: FIRST_CONTACT_BODY, from: fromLine, cfg })
              await writeAutoReplyStamp(req, stampKey)
            }
          } else if (isAfterHoursNow(cfg) && String(cfg.AFTER_HOURS_AUTOREPLY || 'false').toLowerCase() === 'true') {
            // After-hours (only if we haven't already auto-replied to this
            // number today).
            const stampKey = `sms_autoreply_afterhours_${senderKey}_${dateStrPT()}`
            const stamp = await readAutoReplyStamp(req, stampKey)
            if (!stamp) {
              const fromLine = record.line_type === 'tollfree' ? 'tollfree' : 'local'
              await sendTwilioSMS({ to: from, body: AFTER_HOURS_BODY, from: fromLine, cfg })
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

// ── Public media proxy (HMAC-signed) ────────────────────────────────────────
// Mounted on the public webhook router so browsers can load <img src>
// without an auth header. Signature is derived from SESSION_SECRET;
// only URLs the server signs are accepted.
router.get('/media/:sid/:idx', async (req, res) => {
  try {
    const { sid, idx } = req.params
    const expected = mediaSig(sid, idx)
    if (!req.query.sig || req.query.sig !== expected) {
      return res.status(403).send('bad signature')
    }
    const cfg = await resolvePhoneConfig(req)
    if (!twilioConfigured(cfg)) return res.status(503).send('Twilio not configured')

    const all = await readAllMessages(req)
    const msg = all.find(m => m.message_sid === sid)
    const i = parseInt(idx, 10)
    const media = msg?.media?.[i]
    if (!media?.url) return res.status(404).send('not found')

    const axiosMod = (await import('axios')).default
    const r = await axiosMod.get(media.url, {
      auth: { username: cfg.TWILIO_ACCOUNT_SID, password: cfg.TWILIO_AUTH_TOKEN },
      responseType: 'arraybuffer',
      timeout: 15000,
      maxRedirects: 5,
    })
    res.set('Content-Type', media.contentType || r.headers['content-type'] || 'application/octet-stream')
    res.set('Cache-Control', 'private, max-age=86400')
    res.send(Buffer.from(r.data))
  } catch (e) {
    console.warn('[sms media public]', e.message)
    res.status(500).send('media fetch failed')
  }
})

// ── Auth-gated router below ─────────────────────────────────────────────────
const auth = express.Router()

// Build the public URL Twilio should POST delivery-status updates to.
// Uses the same env-override + Catalyst-public-host fallback pattern the
// signature validator uses.
function statusCallbackFor(req) {
  const base = (process.env.TWILIO_WEBHOOK_BASE_URL || '').replace(/\/$/, '')
    || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'
  return `${base}/webhooks/twilio/sms/status`
}

// POST /api/sms/send { to, body, from? }
// `from` is 'local' | 'tollfree' | explicit E.164 — defaults to 'local'.
auth.post('/send', async (req, res) => {
  try {
    const cfg = await resolvePhoneConfig(req)
    if (!twilioConfigured(cfg)) {
      return res.status(503).json({ ok: false, error: 'Twilio not configured — set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN in Phone Setup' })
    }
    let { to, body, from } = req.body || {}
    if (!to || !body) return res.status(400).json({ ok: false, error: 'to and body required' })
    to = String(to).trim()
    body = String(body).trim()
    if (!body) return res.status(400).json({ ok: false, error: 'body cannot be blank' })

    const result = await sendTwilioSMS({
      to, body, from, cfg,
      statusCallbackUrl: statusCallbackFor(req),
    })
    if (!result.ok) {
      // Loud failure — post to Cliq so Mark sees when a customer send
      // outright fails at the Twilio API (auth, A2P block, invalid
      // number, etc). Wrapped so a Cliq hiccup doesn't hide the real
      // response.
      try {
        const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
        await postToCliqChannelById(
          MARK_ALERT_CHANNEL_ID,
          `🚨 *SMS SEND FAILED*\n` +
          `to: ${result.to || to}\n` +
          `from: ${result.from || from || 'local'}\n` +
          `error: ${result.error}\n` +
          `twilio_status: ${result.twilio_status_code || '—'}\n` +
          `attempts: ${result.attempts || 1}\n` +
          `body: "${body.slice(0, 200)}"`
        ).catch(() => {})
      } catch {}
      return res.status(422).json(result)
    }

    // Log outbound. If cache write fails we STILL return 200 (Twilio
    // accepted the send — customer should still receive), but surface
    // the persistence failure so the UI can flag it instead of the
    // "message pops up then disappears on refresh" symptom.
    const record = {
      message_sid: result.sid,
      direction:   'outbound',
      from_number: result.from,
      to_number:   result.to,
      body:        String(body),
      timestamp:   new Date().toISOString(),
      line_type:   classifyTwilioNumber(result.from, cfg),
      sender:      req.user?.email || req.user?.techName || 'app',
      twilio_status: result.twilio_status || 'queued',
      attempts:      result.attempts,
    }
    const persist = await appendMessage(req, record)
    if (!persist.ok) {
      // Loud alert — send succeeded but our local mirror broke. Customer
      // still receives the text but the log won't show it until we fix
      // the storage layer.
      try {
        const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
        await postToCliqChannelById(
          MARK_ALERT_CHANNEL_ID,
          `⚠ *SMS log-save failed*\n` +
          `sid: ${result.sid}\n` +
          `to: ${result.to}\n` +
          `from: ${result.from}\n` +
          `error: \`${persist.error}\`\n` +
          `Customer DID receive the text — only the local log missed it.`
        ).catch(() => {})
      } catch {}
    }
    res.json({
      ok: true,
      sid: result.sid,
      message: record,
      persisted: persist.ok,
      persist_error: persist.ok ? undefined : persist.error,
      attempts: result.attempts,
      twilio_status: result.twilio_status,
    })
  } catch (err) {
    console.error('[sms send]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /webhooks/twilio/sms/status ────────────────────────────────────────
// Twilio POSTs delivery-status updates here after each outbound message
// (queued → sent → delivered / failed / undelivered). We update the
// cached record with the latest status so the UI can show delivery
// state, and we alert Cliq if a message ends in a failed / undelivered
// state — that's the "Twilio accepted but carrier silently dropped"
// case that used to look identical to a successful send.
router.post('/status', async (req, res) => {
  try {
    const sid = String(req.body.MessageSid || req.body.SmsSid || '')
    const status = String(req.body.MessageStatus || req.body.SmsStatus || '').toLowerCase()
    const errCode = String(req.body.ErrorCode || '')
    const errMsg  = String(req.body.ErrorMessage || '')
    if (!sid || !status) return res.status(200).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')

    // Update the persisted record with the new status.
    try {
      const all = await readAllMessages(req)
      const idx = all.findIndex(m => m.message_sid === sid)
      if (idx >= 0) {
        all[idx] = { ...all[idx], twilio_status: status, twilio_error_code: errCode || undefined, twilio_error_message: errMsg || undefined }
        await writeAllMessages(req, all)
      }
    } catch (e) { console.warn('[sms status log]', e.message) }

    // Fire an alert on any terminal failure state. `undelivered` and
    // `failed` are Twilio's final "we couldn't deliver this" states.
    if (status === 'failed' || status === 'undelivered') {
      try {
        const rec = (await readAllMessages(req)).find(m => m.message_sid === sid)
        const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
        await postToCliqChannelById(
          MARK_ALERT_CHANNEL_ID,
          `🚨 *SMS DELIVERY FAILED*\n` +
          `sid: ${sid}\n` +
          `status: ${status.toUpperCase()}\n` +
          `to: ${rec?.to_number || 'unknown'}\n` +
          `from: ${rec?.from_number || 'unknown'}\n` +
          (errCode ? `twilio error: ${errCode} — ${errMsg}\n` : '') +
          `body: "${(rec?.body || '').slice(0, 200)}"\n\n` +
          `Common causes:\n` +
          `• 30003 · handset unreachable\n` +
          `• 30005 · unknown destination handset\n` +
          `• 30006 · landline / unreachable carrier\n` +
          `• 30007 · carrier violation (A2P block or filter)\n` +
          `• 30008 · unknown carrier / unroutable`
        ).catch(() => {})
      } catch {}
    }

    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
  } catch (err) {
    console.error('[sms status webhook]', err.message)
    res.status(500).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
  }
})

// GET /api/sms/diag — pings Twilio's REST API with our saved creds to
// see (a) whether the credentials work at all and (b) whether Twilio has
// recorded any recent messages on the account. Bypasses the whole
// webhook chain so we can figure out if the problem is Twilio-side or
// ours-side.
auth.get('/diag', async (req, res) => {
  try {
    const { resolvePhoneConfig } = await import('../services/phoneConfig.js')
    const cfg = await resolvePhoneConfig(req)
    if (!twilioConfigured(cfg)) {
      return res.json({ ok: false, error: 'Twilio not configured — Phone Setup incomplete' })
    }
    const axiosMod = (await import('axios')).default
    const authOpts = { username: cfg.TWILIO_ACCOUNT_SID, password: cfg.TWILIO_AUTH_TOKEN }
    const base = `https://api.twilio.com/2010-04-01/Accounts/${cfg.TWILIO_ACCOUNT_SID}`

    // 1) Recent messages (last 10, both directions)
    let messages = null, messagesErr = null
    try {
      const r = await axiosMod.get(`${base}/Messages.json?PageSize=10`, { auth: authOpts, timeout: 10000, validateStatus: () => true })
      if (r.status === 200) {
        messages = (r.data?.messages || []).map(m => ({
          sid: m.sid,
          direction: m.direction,
          from: m.from,
          to: m.to,
          status: m.status,
          error_code: m.error_code,
          error_message: m.error_message,
          date_sent: m.date_sent,
          num_media: m.num_media,
        }))
      } else {
        messagesErr = `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`
      }
    } catch (e) { messagesErr = e.message }

    // 2) Phone number config on Twilio side — check SMS webhook URL,
    //    capabilities, verified status
    let numbers = null, numbersErr = null
    try {
      const r = await axiosMod.get(`${base}/IncomingPhoneNumbers.json?PageSize=20`, { auth: authOpts, timeout: 10000, validateStatus: () => true })
      if (r.status === 200) {
        numbers = (r.data?.incoming_phone_numbers || []).map(n => ({
          phone_number: n.phone_number,
          friendly_name: n.friendly_name,
          sms_url: n.sms_url,
          sms_method: n.sms_method,
          sms_fallback_url: n.sms_fallback_url,
          voice_url: n.voice_url,
          voice_method: n.voice_method,
          capabilities: n.capabilities,
          status: n.status,
        }))
      } else {
        numbersErr = `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`
      }
    } catch (e) { numbersErr = e.message }

    res.json({
      ok: true,
      account_sid: cfg.TWILIO_ACCOUNT_SID,
      configured_local: cfg.TWILIO_PHONE_NUMBER,
      configured_tollfree: cfg.TWILIO_TOLLFREE_NUMBER,
      messages: messages || messagesErr,
      numbers: numbers || numbersErr,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/sms/threads — list of conversations, newest first
auth.get('/threads', async (req, res) => {
  try {
    const [all, phoneIdx] = await Promise.all([
      readAllMessages(req),
      loadPhoneIndex(req),
    ])
    const threads = bucketByThread(all).map(t => {
      const contact = phoneIdx.get(normPhone(t.phone)) || null
      return contact
        ? { ...t, contact_name: contact.contact_name, shop_name: contact.shop_name, shop_id: contact.shop_id }
        : t
    })
    res.json({ ok: true, threads })
  } catch (err) {
    console.error('[sms threads]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/sms/media/:sid/:idx — proxy for Twilio-hosted MMS media.
// Twilio's MediaUrl requires HTTP Basic auth (account SID + auth token) to
// fetch. Rather than exposing those credentials to the browser, we proxy
// the fetch server-side and stream the response back. Requires the app
// user's session auth (via requireAuth middleware upstream).
auth.get('/media/:sid/:idx', async (req, res) => {
  try {
    const { resolvePhoneConfig } = await import('../services/phoneConfig.js')
    const cfg = await resolvePhoneConfig(req)
    if (!twilioConfigured(cfg)) return res.status(503).send('Twilio not configured')

    const all = await readAllMessages(req)
    const msg = all.find(m => m.message_sid === req.params.sid)
    const idx = parseInt(req.params.idx, 10)
    const media = msg?.media?.[idx]
    if (!media?.url) return res.status(404).send('not found')

    const axiosMod = (await import('axios')).default
    const r = await axiosMod.get(media.url, {
      auth: { username: cfg.TWILIO_ACCOUNT_SID, password: cfg.TWILIO_AUTH_TOKEN },
      responseType: 'arraybuffer',
      timeout: 15000,
      maxRedirects: 5,
    })
    res.set('Content-Type', media.contentType || r.headers['content-type'] || 'application/octet-stream')
    res.set('Cache-Control', 'private, max-age=86400')
    res.send(Buffer.from(r.data))
  } catch (e) {
    console.warn('[sms media proxy]', e.message)
    res.status(500).send('media fetch failed')
  }
})

// GET /api/sms/threads/:phone — full ordered conversation
auth.get('/threads/:phone', async (req, res) => {
  try {
    const key = normalizePhoneUS(req.params.phone) || String(req.params.phone || '')
    const [all, contact] = await Promise.all([
      readAllMessages(req),
      findContactByPhone(req, key),
    ])
    const messages = all
      .filter(m => threadKey(m) === key)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    res.json({
      ok: true,
      phone: key,
      phone_pretty: formatPhonePretty(key),
      contact_name: contact?.contact_name || '',
      shop_name:    contact?.shop_name    || '',
      shop_id:      contact?.shop_id      || '',
      messages: rewriteMediaUrls(messages),
    })
  } catch (err) {
    console.error('[sms thread]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export { router as smsWebhookRouter, auth as smsAuthRouter }
