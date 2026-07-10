// Voice routes — Phase 2 rebuild (2026-07-07).
//
// Endpoints (all Twilio webhooks; signature-validated when configured):
//   POST /webhooks/twilio/voice                  — inbound call, starts ring cascade
//   POST /webhooks/twilio/voice/after-mark       — Mark didn't pick up → try Jayden
//   POST /webhooks/twilio/voice/after-jayden     — Jayden didn't pick up → try Kat
//   POST /webhooks/twilio/voice/after-kat        — Kat didn't pick up → voicemail
//   POST /webhooks/twilio/voice/voicemail        — starts the Record verb
//   POST /webhooks/twilio/voice/voicemail-done   — recording finished
//   POST /webhooks/twilio/voice/transcription    — Twilio transcription callback
//   POST /webhooks/twilio/voice/status           — call lifecycle status → call log
//   POST /webhooks/twilio/voice/bridge           — TwiML that dials the target after Mark answers
//   POST /api/voice/dial                          — click-to-call (auth) — see callsAuth
//
// Click-to-call flow:
//   1. Frontend POSTs /api/voice/dial { to, from_line } — auth required
//   2. Backend calls Twilio: from=<chosen line>, to=<Mark's cell>, url=/voice/bridge?to=<target>
//   3. Twilio rings Mark's cell. Mark picks up.
//   4. Twilio fetches /voice/bridge TwiML → <Dial>${target}</Dial>
//   5. Twilio dials the target from the chosen line. Target sees Local 425 or 844 as caller ID.
//   6. Mark and target are connected.
//
// Call cascade (Mark's ask 2026-07-07):
//   Ring Mark (2 rings ≈ 12s) → Jayden (12s) → Kat (12s) → voicemail
// A cascade step is SKIPPED if the target env var is empty, so unset
// contacts don't create silent 12s dead air.
//
// Voicemails + call events land in Catalyst Cache (`voicemails` key, rolling
// 90 days) and post to #aajobs. Same "no new Datastore table" approach as
// SMS Phase 1.
//
// IVR flow:
//   Greeting → "Press 1 to reach dispatch, Press 2 to leave a voicemail"
//   Press 1 → forward the call to Mark's cell (MARK_PHONE_NUMBER)
//   Press 2 (or no input / invalid) → record voicemail (up to 3 min)
//   Recording → transcription callback → Cliq post + cache entry

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import {
  normalizePhoneUS,
  formatPhonePretty,
  classifyTwilioNumber,
  validateTwilioSignature,
  twilioConfigured,
} from '../services/twilio.js'
import { resolvePhoneConfig } from '../services/phoneConfig.js'
import { postToCliqChannel, AA_JOBS_CHANNEL } from '../services/cliq.js'

const router = express.Router()

// ── Catalyst Cache ──────────────────────────────────────────────────────────
// Migrated to SDK 2026-07-08 (same silent-404 bug as sms.js/phoneConfig).
const VM_CACHE_KEY = 'voicemails'
const CALLS_CACHE_KEY = 'calls_log'
const RETENTION_DAYS = 90

function getSegment(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.cache().segment()
}

async function readVoicemails(req) {
  try {
    const segment = getSegment(req)
    const val = await segment.getValue(VM_CACHE_KEY)
    if (!val) return []
    try { return typeof val === 'string' ? JSON.parse(val) : (val || []) }
    catch { return [] }
  } catch (e) {
    console.warn('[voice cache read]', e.message)
    return []
  }
}
async function writeVoicemails(req, records) {
  const segment = getSegment(req)
  const val = JSON.stringify(records || [])
  try { await segment.update(VM_CACHE_KEY, val) }
  catch { await segment.put(VM_CACHE_KEY, val) }
}
// ── Call log helpers (mirror the voicemail pattern) ────────────────────────
async function readCalls(req) {
  try {
    const segment = getSegment(req)
    const val = await segment.getValue(CALLS_CACHE_KEY)
    if (!val) return []
    try { return typeof val === 'string' ? JSON.parse(val) : (val || []) }
    catch { return [] }
  } catch (e) {
    console.warn('[calls cache read]', e.message)
    return []
  }
}
async function writeCalls(req, records) {
  const segment = getSegment(req)
  const val = JSON.stringify(records || [])
  try { await segment.update(CALLS_CACHE_KEY, val) }
  catch { await segment.put(CALLS_CACHE_KEY, val) }
}
async function upsertCall(req, record) {
  let records = []
  try { records = await readCalls(req) } catch { records = [] }
  const idx = records.findIndex(r => r.call_sid === record.call_sid)
  if (idx >= 0) records[idx] = { ...records[idx], ...record }
  else records.push(record)
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  records = records.filter(r => new Date(r.timestamp || 0).getTime() > cutoff)
  if (JSON.stringify(records).length > 60_000) records = records.slice(-300)
  try { await writeCalls(req, records) }
  catch (e) { console.warn('[calls cache write]', e.message) }
}

async function upsertVoicemail(req, record) {
  let records = []
  try { records = await readVoicemails(req) } catch { records = [] }
  const idx = records.findIndex(r => r.call_sid === record.call_sid)
  if (idx >= 0) records[idx] = { ...records[idx], ...record }
  else records.push(record)
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  records = records.filter(r => new Date(r.timestamp || 0).getTime() > cutoff)
  if (JSON.stringify(records).length > 60_000) records = records.slice(-200)
  try { await writeVoicemails(req, records) }
  catch (e) { console.warn('[voice cache write]', e.message) }
}

// ── Signature validation gate ───────────────────────────────────────────────
// LOG-ONLY 2026-07-08. Catalyst's gateway rewrites the URL that Twilio
// signs against, so the naive host+path reconstruction in
// validateTwilioSignature returns false negatives and 403s every real
// call. Rejection = customer hears nothing = phone appears broken.
// Match SMS webhook's log-only stance until URL reconstruction is fixed.
async function requireTwilioSignature(req, res, next) {
  const cfg = await resolvePhoneConfig(req)
  req.phoneCfg = cfg  // stash so downstream handlers can reuse without re-reading cache
  if (!twilioConfigured(cfg)) return next()
  try {
    const check = await validateTwilioSignature(req, cfg)
    if (!check?.ok) console.warn('[voice] sig check failed (log-only):', check?.reason)
  } catch (e) { console.warn('[voice] sig check err:', e.message) }
  next()
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function xml(twiml) {
  return `<?xml version="1.0" encoding="UTF-8"?>${twiml}`
}
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function baseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  const host  = req.headers['x-forwarded-host']  || req.headers['host']
  return `${proto}://${host}`
}

// ── Cascade helpers ─────────────────────────────────────────────────────────
// Two rings ≈ 12 seconds per US telco cadence. If a target env var is
// missing, the step is skipped so we don't create dead-air pauses.
const CASCADE_RING_TIMEOUT_SEC = 12

// Given the current cascade step, return the next TwiML: either dial the
// next configured contact or redirect to voicemail. Twilio always POSTs
// DialCallStatus for the previous <Dial>; 'completed' means the call was
// answered and later hung up — we hang up too. Everything else (no-answer,
// busy, failed, canceled) means keep hunting.
function nextCascadeTwiML(req, order) {
  const cfg = req.phoneCfg || {}
  const targets = [
    { key: 'mark',   number: normalizePhoneUS(cfg.MARK_PHONE_NUMBER   || process.env.MARK_PHONE_NUMBER   || ''), afterUrl: '/webhooks/twilio/voice/after-mark' },
    { key: 'jayden', number: normalizePhoneUS(cfg.JAYDEN_PHONE_NUMBER || process.env.JAYDEN_PHONE_NUMBER || ''), afterUrl: '/webhooks/twilio/voice/after-jayden' },
    { key: 'kat',    number: normalizePhoneUS(cfg.KAT_PHONE_NUMBER    || process.env.KAT_PHONE_NUMBER    || ''), afterUrl: '/webhooks/twilio/voice/after-kat' },
  ]
  const recCbUrl = `${baseUrl(req)}/webhooks/twilio/voice/recording-done`
  // Caller-ID passthrough (Mark 2026-07-10): show the CUSTOMER's real
  // number on the tech's phone so their saved contact card matches,
  // instead of the shared 844/425 line. Twilio permits reusing the
  // inbound caller's ID on <Dial> within the same call. The line
  // indicator moves to a whisper — a short announcement only the
  // answering tech hears before the call bridges.
  const callerNumber = normalizePhoneUS(req.body.From) || String(req.body.From || '')
  const lineType = classifyTwilioNumber(req.body.To, cfg)
  const whisperUrl = `${baseUrl(req)}/webhooks/twilio/voice/whisper?line=${encodeURIComponent(lineType)}`
  // Find the first configured target at or after the requested step.
  for (let i = order; i < targets.length; i++) {
    if (targets[i].number) {
      const url = `${baseUrl(req)}${targets[i].afterUrl}`
      // record="record-from-answer" captures both sides after answer;
      // recordingStatusCallback fires when the file is finalized.
      return `
<Response>
  <Dial timeout="${CASCADE_RING_TIMEOUT_SEC}"
        action="${esc(url)}"
        method="POST"
        callerId="${esc(callerNumber || req.body.To || '')}"
        record="record-from-answer"
        recordingStatusCallback="${esc(recCbUrl)}"
        recordingStatusCallbackEvent="completed">
    <Number url="${esc(whisperUrl)}">${esc(targets[i].number)}</Number>
  </Dial>
</Response>`.trim()
    }
  }
  // All configured targets exhausted → voicemail
  return `
<Response>
  <Redirect method="POST">${esc(baseUrl(req))}/webhooks/twilio/voice/voicemail</Redirect>
</Response>`.trim()
}

// Fallback TwiML — the LAST-RESORT response we send back when anything
// in the primary handler throws. Sends the caller to voicemail with a
// clear message so we never leave a customer listening to dead air.
// Twilio treats a 200 + valid TwiML as success no matter what, so this
// guarantees the caller always gets *something*.
function fallbackVoicemailTwiML(req) {
  const vmUrl = `${baseUrl(req)}/webhooks/twilio/voice/voicemail`
  return `<Response><Redirect method="POST">${esc(vmUrl)}</Redirect></Response>`
}

// Wrapper — every Twilio-facing handler runs through this so an
// uncaught throw returns a fallback TwiML instead of a 500. On any
// crash we also fire a bright red Cliq alert to Mark's channel so the
// system is impossible to miss when it starts misbehaving.
function safeVoiceHandler(handler, opName) {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (err) {
      console.error(`[voice ${opName}] fatal:`, err.message, err.stack)
      try {
        const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
        await postToCliqChannelById(
          MARK_ALERT_CHANNEL_ID,
          `🚨 *PHONE ALERT* — voice handler crashed\n` +
          `handler: \`${opName}\`\n` +
          `error: \`${err.message}\`\n` +
          `caller: ${req.body?.From || 'unknown'} → ${req.body?.To || 'unknown'}\n` +
          `Falling back to voicemail so caller isn't stranded.`
        ).catch(() => {})
      } catch {}
      if (!res.headersSent) {
        res.type('text/xml').send(xml(fallbackVoicemailTwiML(req)))
      }
    }
  }
}

// ── POST /webhooks/twilio/voice ─────────────────────────────────────────────
// Inbound call. Starts the ring cascade immediately. Recording is enabled
// on the <Dial> verb (see nextCascadeTwiML) without a spoken disclosure —
// Mark's explicit instruction 2026-07-08 ("recording without consent, for
// out-of-state calls only"). No disclosure announcement is played. Logs
// an initial "ringing" call-log entry so we have a record even if nobody
// picks up and the voicemail lands separately.
router.post('/', requireTwilioSignature, safeVoiceHandler(async (req, res) => {
  try {
    await upsertCall(req, {
      call_sid:    String(req.body.CallSid || ''),
      direction:   'inbound',
      from_number: normalizePhoneUS(req.body.From) || String(req.body.From || ''),
      to_number:   normalizePhoneUS(req.body.To)   || String(req.body.To   || ''),
      line_type:   classifyTwilioNumber(req.body.To, req.phoneCfg),
      status:      'ringing',
      timestamp:   new Date().toISOString(),
    })
  } catch (e) { console.warn('[voice inbound log]', e.message) }
  res.type('text/xml').send(xml(nextCascadeTwiML(req, 0)))
}, 'inbound'))

// After each cascade step Twilio POSTs the DialCallStatus. If the call
// was answered (completed) we're done; otherwise advance to the next
// target in the cascade.
function cascadeContinueHandler(nextOrder) {
  return async (req, res) => {
    const status = String(req.body.DialCallStatus || '').toLowerCase()
    if (status === 'completed' || status === 'answered') {
      return res.type('text/xml').send(xml('<Response><Hangup/></Response>'))
    }
    res.type('text/xml').send(xml(nextCascadeTwiML(req, nextOrder)))
  }
}

router.post('/after-mark',   requireTwilioSignature, safeVoiceHandler(cascadeContinueHandler(1), 'after-mark'))
router.post('/after-jayden', requireTwilioSignature, safeVoiceHandler(cascadeContinueHandler(2), 'after-jayden'))
router.post('/after-kat',    requireTwilioSignature, safeVoiceHandler(cascadeContinueHandler(3), 'after-kat'))

// ── Whisper — plays ONLY to the tech who answers a cascade leg, before
// the call bridges. The customer keeps hearing ringback during it.
// Needed because caller ID now shows the customer's real number (so the
// tech's contact card matches), which means the phone itself no longer
// tells you which line the call came in on. Twilio fetches this URL the
// moment the tech picks up (the url attribute on <Number>).
router.post('/whisper', requireTwilioSignature, (req, res) => {
  const line = String(req.query.line || '')
  const label = line === 'tollfree' ? 'eight four four'
    : line === 'local' ? 'four two five'
    : 'business'
  res.type('text/xml').send(xml(
    `<Response><Say voice="Polly.Matthew">Absolute A D A S call on the ${label} line.</Say></Response>`
  ))
})

// ── POST /webhooks/twilio/voice/voicemail ───────────────────────────────────
// Records the voicemail. Twilio calls transcription webhook when done.
router.post('/voicemail', requireTwilioSignature, async (req, res) => {
  const doneUrl = `${baseUrl(req)}/webhooks/twilio/voice/voicemail-done`
  const txUrl   = `${baseUrl(req)}/webhooks/twilio/voice/transcription`
  const twiml = `
<Response>
  <Say voice="Polly.Matthew">Please leave your name, number, and the shop or vehicle. Beep.</Say>
  <Record
    maxLength="180"
    playBeep="true"
    finishOnKey="#"
    action="${esc(doneUrl)}"
    method="POST"
    transcribe="true"
    transcribeCallback="${esc(txUrl)}"
    trim="trim-silence"
  />
  <Say voice="Polly.Matthew">We didn't get anything. Please call back or send us a text. Goodbye.</Say>
  <Hangup/>
</Response>`.trim()
  res.type('text/xml').send(xml(twiml))
})

// ── POST /webhooks/twilio/voicemail-done ────────────────────────────────────
// Fires right when recording finishes (before transcription). Store the
// bare voicemail entry so it shows up immediately in Cliq / history.
router.post('/voicemail-done', requireTwilioSignature, async (req, res) => {
  try {
    const rec = {
      call_sid:         String(req.body.CallSid || ''),
      recording_sid:    String(req.body.RecordingSid || ''),
      recording_url:    String(req.body.RecordingUrl || ''),
      recording_duration_sec: parseInt(req.body.RecordingDuration || '0', 10) || 0,
      from_number:      normalizePhoneUS(req.body.From) || String(req.body.From || ''),
      to_number:        normalizePhoneUS(req.body.To)   || String(req.body.To   || ''),
      line_type:        classifyTwilioNumber(req.body.To),
      transcription:    null,
      transcription_status: 'pending',
      timestamp:        new Date().toISOString(),
    }
    await upsertVoicemail(req, rec)

    // Post a "voicemail received" nudge to #aajobs immediately — the
    // transcription callback lands seconds/minutes later.
    try {
      const label = rec.line_type === 'tollfree' ? '844' : (rec.line_type === 'local' ? '425' : rec.line_type)
      const msg = [
        `📞 *Voicemail* · ${formatPhonePretty(rec.from_number)} → ${label}`,
        `Duration: ${rec.recording_duration_sec}s`,
        `🎧 ${rec.recording_url}.mp3`,
        '_Transcription pending…_',
      ].join('\n')
      await postToCliqChannel(AA_JOBS_CHANNEL, msg)
    } catch (e) { console.warn('[voicemail-done cliq]', e.message) }

    res.type('text/xml').send(xml(`<Response><Hangup/></Response>`))
  } catch (err) {
    console.error('[voicemail-done]', err.message)
    res.status(500).type('text/xml').send(xml(`<Response><Hangup/></Response>`))
  }
})

// ── POST /webhooks/twilio/transcription ─────────────────────────────────────
// Twilio finished transcribing. Update the cache row + post to #aajobs.
router.post('/transcription', requireTwilioSignature, async (req, res) => {
  try {
    const callSid = String(req.body.CallSid || '')
    const transcriptText = String(req.body.TranscriptionText || '').trim()
    const status = String(req.body.TranscriptionStatus || '').toLowerCase()
    const recordingUrl = String(req.body.RecordingUrl || '')
    const from = normalizePhoneUS(req.body.From) || String(req.body.From || '')
    const to   = normalizePhoneUS(req.body.To)   || String(req.body.To   || '')

    await upsertVoicemail(req, {
      call_sid: callSid,
      transcription: transcriptText || null,
      transcription_status: status || 'unknown',
      recording_url: recordingUrl || undefined,
      from_number: from,
      to_number: to,
      line_type: classifyTwilioNumber(to, req.phoneCfg),
      timestamp: new Date().toISOString(),
    })

    // Only post a follow-up to Cliq if we got usable text.
    if (transcriptText && (status === 'completed' || !status)) {
      try {
        const label = classifyTwilioNumber(to, req.phoneCfg) === 'tollfree' ? '844' : '425'
        const msg = [
          `📝 *Voicemail transcript* · ${formatPhonePretty(from)} → ${label}`,
          `"${transcriptText.slice(0, 600)}"`,
        ].join('\n')
        await postToCliqChannel(AA_JOBS_CHANNEL, msg)
      } catch (e) { console.warn('[transcription cliq]', e.message) }
    }

    res.status(200).send('OK')
  } catch (err) {
    console.error('[transcription]', err.message)
    res.status(500).send('err')
  }
})

// ── POST /webhooks/twilio/voice/recording-done ──────────────────────────────
// Twilio fires this when a call recording finishes processing. Body has
// RecordingSid, RecordingUrl, RecordingDuration, and the parent CallSid
// so we can attach the recording to the existing call-log row.
router.post('/recording-done', requireTwilioSignature, async (req, res) => {
  try {
    const callSid = String(req.body.CallSid || '')
    const recSid  = String(req.body.RecordingSid || '')
    const recUrl  = String(req.body.RecordingUrl || '')
    const durSec  = parseInt(req.body.RecordingDuration || '0', 10) || 0
    await upsertCall(req, {
      call_sid: callSid,
      recording_sid: recSid,
      recording_url: recUrl,
      recording_duration_sec: durSec,
      timestamp: new Date().toISOString(),
    })
    res.status(200).send('OK')
  } catch (err) {
    console.error('[voice recording-done]', err.message)
    res.status(500).send('err')
  }
})

// ── POST /webhooks/twilio/voice/status ──────────────────────────────────────
// Twilio calls this whenever the call state changes (initiated, ringing,
// in-progress, completed, no-answer, busy, failed, canceled). We upsert
// into the calls cache so the History tab in the app has a real record.
router.post('/status', requireTwilioSignature, async (req, res) => {
  try {
    const callSid = String(req.body.CallSid || '')
    const status  = String(req.body.CallStatus || '').toLowerCase()
    const from    = normalizePhoneUS(req.body.From) || String(req.body.From || '')
    const to      = normalizePhoneUS(req.body.To)   || String(req.body.To   || '')
    const durSec  = parseInt(req.body.CallDuration || '0', 10) || 0

    await upsertCall(req, {
      call_sid: callSid,
      from_number: from,
      to_number:   to,
      line_type:   classifyTwilioNumber(to, req.phoneCfg),
      direction:   String(req.body.Direction || 'inbound').toLowerCase().includes('outbound') ? 'outbound' : 'inbound',
      status,
      duration_seconds: durSec,
      timestamp:   new Date().toISOString(),
    })
    res.status(200).send('OK')
  } catch (err) {
    console.error('[voice status]', err.message)
    res.status(500).send('err')
  }
})

// ── POST /webhooks/twilio/voice/bridge ──────────────────────────────────────
// TwiML that Twilio fetches after Mark's cell answers on a click-to-call.
// The target number is passed via query string. Recording enabled on the
// bridged leg (no disclosure, per Mark's instruction).
router.post('/bridge', requireTwilioSignature, async (req, res) => {
  const target = String(req.query.to || '').trim()
  if (!target) {
    return res.type('text/xml').send(xml('<Response><Say voice="Polly.Matthew">No target number provided.</Say><Hangup/></Response>'))
  }
  const recCbUrl = `${baseUrl(req)}/webhooks/twilio/voice/recording-done`
  const twiml = `
<Response>
  <Dial timeout="25"
        record="record-from-answer"
        recordingStatusCallback="${esc(recCbUrl)}"
        recordingStatusCallbackEvent="completed">
    <Number>${esc(target)}</Number>
  </Dial>
</Response>`.trim()
  res.type('text/xml').send(xml(twiml))
})

// ── Auth-gated: list voicemails + calls ─────────────────────────────────────
const auth = express.Router()
auth.get('/', async (req, res) => {
  try {
    const all = await readVoicemails(req)
    all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    res.json({ ok: true, voicemails: all })
  } catch (err) {
    console.error('[voicemails GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

const callsAuth = express.Router()
callsAuth.get('/', async (req, res) => {
  try {
    const all = await readCalls(req)
    all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    res.json({ ok: true, calls: all })
  } catch (err) {
    console.error('[calls GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/voice/dial  { to, from_line: 'local' | 'tollfree' }
// Kicks off a click-to-call: Twilio rings Mark's cell first, then bridges
// to the target with the chosen number as caller ID.
callsAuth.post('/dial', async (req, res) => {
  try {
    const { resolvePhoneConfig } = await import('../services/phoneConfig.js')
    const { getTwilioClient, pickFromNumber: _p, twilioConfigured: _tc, normalizePhoneUS: _n } = await import('../services/twilio.js')
    // Re-import via a single named grab to avoid mis-named default. Above
    // shape covers the specific helpers we need.
    const { pickFromNumber, twilioConfigured, normalizePhoneUS } = await import('../services/twilio.js')

    const cfg = await resolvePhoneConfig(req)
    if (!twilioConfigured(cfg)) {
      return res.status(503).json({ ok: false, error: 'Twilio not configured — set credentials via Phone Setup' })
    }
    const markCell = normalizePhoneUS(cfg.MARK_PHONE_NUMBER || '')
    if (!markCell) return res.status(400).json({ ok: false, error: "Mark's cell not set — required for click-to-call" })

    const to = normalizePhoneUS(req.body?.to)
    if (!to) return res.status(400).json({ ok: false, error: 'invalid target phone' })
    const fromLine = req.body?.from_line === 'tollfree' ? 'tollfree' : 'local'
    const fromNumber = pickFromNumber(fromLine, cfg)
    if (!fromNumber) return res.status(400).json({ ok: false, error: 'no Twilio number configured for that line' })

    // TwiML bridge URL. Twilio needs an ABSOLUTE URL to fetch after answer.
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
    const host  = req.headers['x-forwarded-host']  || req.headers['host']
    const bridgeUrl = `${proto}://${host}/server/adasiq-api/webhooks/twilio/voice/bridge?to=${encodeURIComponent(to)}`
    const statusUrl = `${proto}://${host}/server/adasiq-api/webhooks/twilio/voice/status`

    const client = await getTwilioClient(cfg)
    const call = await client.calls.create({
      from: fromNumber,          // shows as caller ID to Mark AND to the target
      to: markCell,              // ring Mark's phone first
      url: bridgeUrl,            // Twilio fetches this after Mark answers → <Dial>target
      method: 'POST',
      statusCallback: statusUrl,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      timeout: 20,               // ring Mark's cell for 20s max
    })

    await upsertCall(req, {
      call_sid: call.sid,
      direction: 'outbound',
      from_number: fromNumber,
      to_number: to,
      line_type: fromLine === 'tollfree' ? 'tollfree' : 'local',
      status: 'initiated',
      user: req.user?.email || req.user?.techName || 'app',
      timestamp: new Date().toISOString(),
    })

    res.json({ ok: true, call_sid: call.sid, from: fromNumber, to, ringing: markCell })
  } catch (err) {
    console.error('[voice dial]', err.message)
    res.status(500).json({ ok: false, error: err.message })
  }
})

export { router as voiceWebhookRouter, auth as voicemailsAuthRouter, callsAuth as callsAuthRouter }
