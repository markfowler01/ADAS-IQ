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

// NO twilio SDK dependency. Catalyst kept refusing to install it despite
// package-lock.json + package.json entries (Linux-x64 sharp variant blocks
// clean local installs; Catalyst's install pipeline then can't reproduce
// the environment). We hit Twilio's REST API directly with axios and
// implement HMAC-SHA1 signature validation with node's built-in crypto.
import axios from 'axios'
import crypto from 'node:crypto'
import { resolvePhoneConfig } from './phoneConfig.js'

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01/Accounts'

// Every helper below takes a `cfg` object built from resolvePhoneConfig(req).
// That object merges Catalyst env vars (highest priority) with the in-app
// phone-config cache (fallback), so Mark can set Twilio credentials via
// the Phone Setup page even though env vars are maxed out.
//
// Callers do:
//   const cfg = await resolvePhoneConfig(req)
//   const r = await sendTwilioSMS({ to, body, from, cfg })
//
// Legacy callers that pass no cfg still work — the helpers fall through
// to process.env, matching the pre-2026-07-08 behavior.

function pickCfg(cfg) {
  cfg = cfg || {}
  return {
    accountSid: cfg.TWILIO_ACCOUNT_SID     || process.env.TWILIO_ACCOUNT_SID     || '',
    authToken:  cfg.TWILIO_AUTH_TOKEN      || process.env.TWILIO_AUTH_TOKEN      || '',
    local:      cfg.TWILIO_PHONE_NUMBER    || process.env.TWILIO_PHONE_NUMBER    || '',
    tollfree:   cfg.TWILIO_TOLLFREE_NUMBER || process.env.TWILIO_TOLLFREE_NUMBER || '',
  }
}

// Direct REST client — just the two endpoints we use. Twilio's REST API
// uses HTTP Basic auth with (accountSid, authToken).
function twilioAuth(sid, token) {
  return { username: sid, password: token }
}

async function twilioPost(sid, token, resource, form) {
  const url = `${TWILIO_BASE}/${sid}/${resource}.json`
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(form || {})) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) v.forEach(item => params.append(k, String(item)))
    else params.append(k, String(v))
  }
  const r = await axios.post(url, params.toString(), {
    auth: twilioAuth(sid, token),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
    validateStatus: () => true,  // handle 4xx/5xx ourselves
  })
  if (r.status < 200 || r.status >= 300) {
    const errMsg = r.data?.message || r.data?.error_message || `Twilio ${r.status}`
    const err = new Error(errMsg)
    err.twilioStatus = r.status
    err.twilioBody = r.data
    throw err
  }
  return r.data
}

export function checkTwilioReady(cfg) {
  const { accountSid, authToken } = pickCfg(cfg)
  if (!accountSid || !authToken) {
    throw new Error('Twilio not configured — set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN via Phone Setup')
  }
  return { accountSid, authToken }
}

// Backward-compat shim so existing callers of getTwilioClient don't break.
// Returns a wrapper with .messages.create + .calls.create matching the
// twilio-node SDK shape we were using.
export async function getTwilioClient(cfg) {
  const { accountSid, authToken } = checkTwilioReady(cfg)
  return {
    messages: {
      create: (opts) => twilioPost(accountSid, authToken, 'Messages', {
        To: opts.to, From: opts.from, Body: opts.body,
      }).then(d => ({ sid: d.sid, ...d })),
    },
    calls: {
      create: (opts) => twilioPost(accountSid, authToken, 'Calls', {
        To: opts.to, From: opts.from, Url: opts.url, Method: opts.method || 'POST',
        StatusCallback: opts.statusCallback, StatusCallbackMethod: opts.statusCallbackMethod || 'POST',
        StatusCallbackEvent: opts.statusCallbackEvent, Timeout: opts.timeout,
      }).then(d => ({ sid: d.sid, ...d })),
    },
  }
}

export function twilioConfigured(cfg) {
  const { accountSid, authToken } = pickCfg(cfg)
  return !!(accountSid && authToken)
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
export function classifyTwilioNumber(twilioNumber, cfg) {
  const { local, tollfree } = pickCfg(cfg)
  const e = normalizePhoneUS(twilioNumber) || String(twilioNumber || '')
  if (e === normalizePhoneUS(tollfree)) return 'tollfree'
  if (e === normalizePhoneUS(local))    return 'local'
  return 'unknown'
}

// Pick the correct From number for an outbound reply. Defaults to the
// local 425 number when we don't know which line the customer texted
// (matches Mark's preference — shop-facing traffic goes through local).
export function pickFromNumber(preferred /* 'local' | 'tollfree' */, cfg) {
  const { local, tollfree } = pickCfg(cfg)
  if (preferred === 'tollfree' && tollfree) return tollfree
  if (preferred === 'local'    && local)    return local
  return local || tollfree || null
}

/**
 * Send an SMS. Body params:
 *   to        — recipient (any format, normalized to E.164)
 *   body      — message text
 *   from      — optional 'local' | 'tollfree' | explicit E.164
 *   cfg       — optional resolved phone config (from resolvePhoneConfig)
 * Returns { ok, sid, error?, to, from }.
 */
export async function sendTwilioSMS({ to, body, from = 'local', cfg }) {
  const normalized = normalizePhoneUS(to)
  if (!normalized) return { ok: false, error: `invalid phone: ${to}` }
  if (!body) return { ok: false, error: 'body required' }

  let client
  try { client = await getTwilioClient(cfg) }
  catch (e) { return { ok: false, error: e.message } }
  const fromNumber = String(from).startsWith('+') ? from : pickFromNumber(from, cfg)
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

// Verify Twilio's request signature. Native HMAC-SHA1 implementation of
// Twilio's algorithm: hash the URL + sorted key/value pairs of the body,
// compare to the X-Twilio-Signature header.
// https://www.twilio.com/docs/usage/webhooks/webhooks-security
//
// Catalyst's gateway rewrites paths and hosts before the request lands
// in the function, so a naive `${proto}://${host}${req.originalUrl}`
// reconstruction can't match what Twilio actually signed. We instead
// build every plausible URL candidate — Twilio only signed ONE, so if
// any of them hashes to the header, we accept. The set covers:
//   1. What the request looks like inside the function
//   2. The X-Forwarded-Host + originalUrl combo
//   3. TWILIO_WEBHOOK_BASE_URL env override + path (learning knob)
//   4. Hard-coded Catalyst public host + /server/adasiq-api/<path>
//   5. Any of the above with a trailing slash toggled
function computeCandidateUrls(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  const fwdHost = req.headers['x-forwarded-host'] || ''
  const rawHost = req.headers['host'] || ''
  const path = req.originalUrl || req.url || ''

  // Public Catalyst URL (dev environment). Overridable via env if a prod
  // deployment moves off this host — set TWILIO_WEBHOOK_BASE_URL to the
  // scheme+host+function-prefix Twilio actually POSTs to
  // (no trailing slash).
  const CATALYST_PUBLIC = 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'
  const envBase = (process.env.TWILIO_WEBHOOK_BASE_URL || '').replace(/\/$/, '')

  const bases = [
    envBase,
    CATALYST_PUBLIC,
    fwdHost ? `${proto}://${fwdHost}` : '',
    rawHost ? `${proto}://${rawHost}` : '',
  ].filter(Boolean)

  const paths = new Set()
  paths.add(path)
  // Some Catalyst configs strip the function prefix from originalUrl.
  // Add both forms so we cover strip + no-strip.
  if (!path.startsWith('/server/adasiq-api')) paths.add(`/server/adasiq-api${path}`)
  else paths.add(path.replace(/^\/server\/adasiq-api/, ''))

  const candidates = new Set()
  for (const base of bases) {
    for (const p of paths) {
      // Preserve query string exactly as it arrived; Twilio signs it.
      candidates.add(`${base}${p}`)
      candidates.add(`${base}${p.replace(/\/$/, '')}`)
      candidates.add(`${base}${p}${p.endsWith('/') ? '' : '/'}`)
    }
  }
  return [...candidates].filter(Boolean)
}

export async function validateTwilioSignature(req, cfg) {
  const { authToken } = pickCfg(cfg)
  if (!authToken) return { ok: false, reason: 'auth token not configured' }
  const signature = req.headers['x-twilio-signature']
  if (!signature) return { ok: false, reason: 'missing x-twilio-signature' }
  const body = req.body || {}
  const keys = Object.keys(body).sort()

  const candidates = computeCandidateUrls(req)
  let sigBuf
  try { sigBuf = Buffer.from(signature) } catch { return { ok: false, reason: 'bad signature encoding' } }

  const tried = []
  for (const url of candidates) {
    let toHash = url
    for (const k of keys) toHash += k + body[k]
    let expected
    try {
      expected = crypto.createHmac('sha1', authToken).update(toHash, 'utf-8').digest('base64')
    } catch (e) { continue }
    tried.push(url)
    try {
      const expBuf = Buffer.from(expected)
      if (expBuf.length === sigBuf.length && crypto.timingSafeEqual(expBuf, sigBuf)) {
        return { ok: true, url, tried }
      }
    } catch { /* mismatched lengths — try next candidate */ }
  }
  return { ok: false, reason: `no candidate URL matched signature (tried ${tried.length})`, tried }
}

// Re-export for callers that want everything in one import.
export { resolvePhoneConfig }
