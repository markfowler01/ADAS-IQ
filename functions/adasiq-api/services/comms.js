// Unified communications layer: email (Zoho Mail) + SMS (Twilio stub) + log.
// Every send is logged in cache so nothing vanishes silently.

import catalyst from 'zcatalyst-sdk-node'
import axios from 'axios'
import { getMailAccessToken, getMailAccountId, sendMail } from './mail.js'

function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

async function cacheSet(segment, key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  try { await segment.update(key, str) }
  catch (e) { await segment.put(key, str) }
}

async function cacheGet(segment, key, fallback = null) {
  try {
    const val = await segment.getValue(key)
    return val ? JSON.parse(val) : fallback
  } catch (e) {
    if (isNotFound(e)) return fallback
    throw e
  }
}

async function logMessage(req, entry) {
  try {
    const segment = getSegment(req)
    const log = (await cacheGet(segment, 'comms_log', [])) || []
    log.unshift({
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ...entry,
      created_at: new Date().toISOString(),
    })
    await cacheSet(segment, 'comms_log', log.slice(0, 2000))
  } catch (e) {
    console.warn('[comms] log write failed:', e.message)
  }
}

// ── Email via Zoho Mail ──────────────────────────────────────────────────────

export async function sendEmail(req, { to, subject, body, category = 'general', related_id = '' }) {
  if (!to) throw new Error('to required')
  if (!subject) throw new Error('subject required')

  try {
    const token = await getMailAccessToken()
    const accountId = await getMailAccountId(token)
    await sendMail(token, accountId, { to, subject, body })
    await logMessage(req, {
      channel: 'email', status: 'sent', to, subject, category, related_id,
    })
    return { sent: true, channel: 'email' }
  } catch (e) {
    console.error('[comms] email failed:', e.message)
    await logMessage(req, {
      channel: 'email', status: 'failed', to, subject, category, related_id,
      error: e.message,
    })
    throw e
  }
}

// ── SMS via Twilio (requires TWILIO_* env vars to activate) ─────────────────

function twilioConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID
    && process.env.TWILIO_AUTH_TOKEN
    && process.env.TWILIO_FROM_NUMBER)
}

export async function sendSMS(req, { to, body, category = 'general', related_id = '' }) {
  if (!to) throw new Error('to required')
  if (!body) throw new Error('body required')

  if (!twilioConfigured()) {
    console.warn(`[comms] SMS skipped (Twilio not configured) — would have sent: ${to}: ${body.slice(0, 60)}…`)
    await logMessage(req, {
      channel: 'sms', status: 'stubbed', to, body, category, related_id,
      note: 'Twilio not configured',
    })
    return { sent: false, channel: 'sms', reason: 'not_configured' }
  }

  try {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    const from = process.env.TWILIO_FROM_NUMBER
    const params = new URLSearchParams({ To: to, From: from, Body: body })
    const auth = Buffer.from(`${sid}:${authToken}`).toString('base64')

    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      params.toString(),
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000,
      }
    )
    await logMessage(req, {
      channel: 'sms', status: 'sent', to, body, category, related_id,
    })
    return { sent: true, channel: 'sms' }
  } catch (e) {
    console.error('[comms] SMS failed:', e.message)
    await logMessage(req, {
      channel: 'sms', status: 'failed', to, body, category, related_id,
      error: e.message,
    })
    throw e
  }
}

// ── Send both (prefer email, add SMS if phone available) ─────────────────────

export async function sendBoth(req, { email, phone, subject, body, sms_body, category = 'general', related_id = '' }) {
  const results = {}
  if (email) {
    try { results.email = await sendEmail(req, { to: email, subject, body, category, related_id }) }
    catch (e) { results.email = { error: e.message } }
  }
  if (phone) {
    try { results.sms = await sendSMS(req, { to: phone, body: sms_body || subject, category, related_id }) }
    catch (e) { results.sms = { error: e.message } }
  }
  return results
}

// ── Get branding for templates ───────────────────────────────────────────────

export async function getBranding(req) {
  const segment = getSegment(req)
  const defaults = {
    company_name: 'Absolute ADAS',
    website: 'absoluteadas.com',
    primary_color: '#CD4419',
    phone: '',
    email: '',
    email_signature: 'The Absolute ADAS Team',
  }
  try {
    const stored = await cacheGet(segment, 'adas_iq_branding', {}) || {}
    return { ...defaults, ...stored }
  } catch {
    return defaults
  }
}

// ── Log access ──────────────────────────────────────────────────────────────

export async function getLog(req, { limit = 100, category, channel } = {}) {
  const segment = getSegment(req)
  let log = (await cacheGet(segment, 'comms_log', [])) || []
  if (category) log = log.filter(l => l.category === category)
  if (channel)  log = log.filter(l => l.channel === channel)
  return log.slice(0, limit)
}
