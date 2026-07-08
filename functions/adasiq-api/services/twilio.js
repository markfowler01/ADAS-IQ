// Twilio SMS helpers — outbound send, inbound signature validation, phone
// number normalization. Rebuilt 2026-07-07 after the earlier version got
// iCloud-evicted along with the rest of the phone-system code.
//
// Environment variables expected on Catalyst:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_PHONE_NUMBER         (local 425 number, E.164)
//   TWILIO_TOLLFREE_NUMBER      (844 number, E.164)
//   MARK_PHONE_NUMBER           (Mark's cell for inbound-SMS forward)

import twilio from 'twilio'

// Lazy client so the module doesn't crash on cold container start when the
// env vars aren't populated. First send/validate call will throw a clear
// error naming the missing var.
let cached = null
export function getTwilioClient() {
  if (cached) return cached
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) {
    throw new Error('Twilio not configured — set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN in Catalyst env vars')
  }
  cached = twilio(sid, token)
  return cached
}

export function twilioConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
}

// Normalize any US phone into E.164 (+1XXXXXXXXXX). Accepts 10 digits,
// 11-with-leading-1, or already-E.164. Returns null on obvious junk.
export function normalizePhoneUS(input) {
  if (!input) return null
  const digits = String(input).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length === 12 && digits.startsWith('01')) return `+${digits.slice(1)}`
  if (String(input).startsWith('+') && digits.length >= 10) return `+${digits}`
  return null
}

// Human display — "(425) 555-1234". Falls back to raw input if not US.
export function formatPhonePretty(input) {
  const e = normalizePhoneUS(input)
  if (!e) return String(input || '')
  const d = e.slice(2) // strip "+1"
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`
}

// Which Twilio number did the message come to? Used to pick the right
// From number when replying so the customer sees the same thread.
// Returns 'local' | 'tollfree' | 'unknown'.
export function classifyTwilioNumber(twilioNumber) {
  const e = normalizePhoneUS(twilioNumber) || String(twilioNumber || '')
  if (e === normalizePhoneUS(process.env.TWILIO_TOLLFREE_NUMBER)) return 'tollfree'
  if (e === normalizePhoneUS(process.env.TWILIO_PHONE_NUMBER))    return 'local'
  return 'unknown'
}

// Pick the correct From number for an outbound reply. Defaults to the
// local 425 number when we don't know which line the customer texted
// (matches Mark's preference — shop-facing traffic goes through local).
export function pickFromNumber(preferred /* 'local' | 'tollfree' */) {
  const local = process.env.TWILIO_PHONE_NUMBER
  const tollfree = process.env.TWILIO_TOLLFREE_NUMBER
  if (preferred === 'tollfree' && tollfree) return tollfree
  if (preferred === 'local'    && local)    return local
  return local || tollfree || null
}

/**
 * Send an SMS. Body params:
 *   to        — recipient (any format, normalized to E.164)
 *   body      — message text
 *   from      — optional 'local' | 'tollfree' | explicit E.164
 * Returns { ok, sid, error?, to, from }.
 */
export async function sendTwilioSMS({ to, body, from = 'local' }) {
  const normalized = normalizePhoneUS(to)
  if (!normalized) return { ok: false, error: `invalid phone: ${to}` }
  if (!body) return { ok: false, error: 'body required' }

  const client = getTwilioClient()
  const fromNumber = String(from).startsWith('+') ? from : pickFromNumber(from)
  if (!fromNumber) return { ok: false, error: 'no Twilio From number configured' }

  try {
    const msg = await client.messages.create({
      to: normalized,
      from: fromNumber,
      body: String(body).slice(0, 1600), // stay well under the 1600-char SMS/MMS body cap
    })
    return { ok: true, sid: msg.sid, to: normalized, from: fromNumber }
  } catch (e) {
    console.error('[twilio send]', e.message)
    return { ok: false, error: e.message, to: normalized, from: fromNumber }
  }
}

// Verify Twilio's request signature so nobody but Twilio can hit our
// inbound webhook. `req` is an Express request; `url` is the full public
// URL of the endpoint (Twilio signs against the exact URL). We build the
// URL from proto/host headers plus originalUrl so it matches the Catalyst
// gateway view of the request.
export function validateTwilioSignature(req) {
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!token) return { ok: false, reason: 'TWILIO_AUTH_TOKEN not set' }
  const signature = req.headers['x-twilio-signature']
  if (!signature) return { ok: false, reason: 'missing x-twilio-signature' }
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  const host  = req.headers['x-forwarded-host']  || req.headers['host']
  const url   = `${proto}://${host}${req.originalUrl}`
  try {
    const ok = twilio.validateRequest(token, signature, url, req.body || {})
    return { ok, reason: ok ? null : 'signature mismatch', url }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}
