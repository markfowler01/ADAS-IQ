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
import axios from 'axios'
import {
  normalizePhoneUS,
  formatPhonePretty,
  classifyTwilioNumber,
  validateTwilioSignature,
  twilioConfigured,
} from '../services/twilio.js'
import { postToCliqChannel, AA_JOBS_CHANNEL } from '../services/cliq.js'

const router = express.Router()

// ── Catalyst Cache ──────────────────────────────────────────────────────────
const CATALYST_API = 'https://api.catalyst.zoho.com'
const VM_CACHE_KEY = 'voicemails'
const RETENTION_DAYS = 90

function catalystHeaders(req) {
  const token = req.headers['x-zc-admin-cred-token'] || req.headers['x-zc-user-cred-token'] || ''
  return { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }
}
function catalystProjectId(req) {
  return req.headers['x-zc-projectid'] || process.env.CATALYST_PROJECT_ID || ''
}

async function readVoicemails(req) {
  const url = `${CATALYST_API}/baas/v1/project/${catalystProjectId(req)}/cache/${VM_CACHE_KEY}`
  try {
    const r = await axios.get(url, { headers: catalystHeaders(req) })
    const val = r.data?.data?.cache_value
    return val ? JSON.parse(val) : []
  } catch (e) {
    if (e.response?.status === 404) return []
    console.warn('[voice cache read]', e.message)
    return []
  }
}
async function writeVoicemails(req, records) {
  const projectId = catalystProjectId(req)
  const baseUrl = `${CATALYST_API}/baas/v1/project/${projectId}/cache`
  const headers = catalystHeaders(req)
  const body = { cache_name: VM_CACHE_KEY, cache_value: JSON.stringify(records), expiry_in_hours: null }
  try {
    await axios.put(`${baseUrl}/${VM_CACHE_KEY}`, { cache_value: body.cache_value, expiry_in_hours: null }, { headers })
  } catch (e) {
    if (e.response?.status === 404) await axios.post(baseUrl, body, { headers })
    else throw e
  }
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
function requireTwilioSignature(req, res, next) {
  if (!twilioConfigured()) return next()  // Pre-config: log-and-continue.
  const check = validateTwilioSignature(req)
  if (!check.ok) {
    console.warn('[voice] signature check failed:', check.reason, 'url:', check.url)
    return res.status(403).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
  }
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
  const targets = [
    { key: 'mark',   number: normalizePhoneUS(process.env.MARK_PHONE_NUMBER   || ''), afterUrl: '/webhooks/twilio/voice/after-mark' },
    { key: 'jayden', number: normalizePhoneUS(process.env.JAYDEN_PHONE_NUMBER || ''), afterUrl: '/webhooks/twilio/voice/after-jayden' },
    { key: 'kat',    number: normalizePhoneUS(process.env.KAT_PHONE_NUMBER    || ''), afterUrl: '/webhooks/twilio/voice/after-kat' },
  ]
  // Find the first configured target at or after the requested step.
  for (let i = order; i < targets.length; i++) {
    if (targets[i].number) {
      const url = `${baseUrl(req)}${targets[i].afterUrl}`
      return `
<Response>
  <Dial timeout="${CASCADE_RING_TIMEOUT_SEC}" action="${esc(url)}" method="POST" callerId="${esc(req.body.To || '')}">
    <Number>${esc(targets[i].number)}</Number>
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

// ── POST /webhooks/twilio/voice ─────────────────────────────────────────────
// Inbound call. Starts the ring cascade immediately — no menu, no greeting.
router.post('/', requireTwilioSignature, async (req, res) => {
  res.type('text/xml').send(xml(nextCascadeTwiML(req, 0)))
})

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

router.post('/after-mark',   requireTwilioSignature, cascadeContinueHandler(1))
router.post('/after-jayden', requireTwilioSignature, cascadeContinueHandler(2))
router.post('/after-kat',    requireTwilioSignature, cascadeContinueHandler(3))

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
      line_type: classifyTwilioNumber(to),
      timestamp: new Date().toISOString(),
    })

    // Only post a follow-up to Cliq if we got usable text.
    if (transcriptText && (status === 'completed' || !status)) {
      try {
        const label = classifyTwilioNumber(to) === 'tollfree' ? '844' : '425'
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

// ── Auth-gated: list voicemails ─────────────────────────────────────────────
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

export { router as voiceWebhookRouter, auth as voicemailsAuthRouter }
