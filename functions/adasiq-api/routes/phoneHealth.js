// Phone-system health check — cron-triggered every 5 minutes. Curls the
// voice + SMS webhooks with a synthetic Twilio payload, verifies each
// returns 200 + valid TwiML. On any failure fires a bright red Cliq
// alert to Mark's channel so a broken phone system never survives more
// than one cron interval unnoticed.
//
// Cron config (add via Catalyst console):
//   Endpoint: GET /api/cron/phone-health
//   Schedule: */5 * * * *  (every 5 minutes)
//   Header:   x-cron-secret: <PHONE_HEALTH_CRON_SECRET>
//
// The self-test also detects sig-validation regressions:
// if the health check itself gets a 403 back from the webhook, we know
// the URL reconstruction is broken again and can page Mark before a
// real customer notices.

import express from 'express'
import axios from 'axios'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from '../services/cliq.js'
import { resolvePhoneConfig } from '../services/phoneConfig.js'

const router = express.Router()

const HEALTH_BASE = process.env.TWILIO_WEBHOOK_BASE_URL
  || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'

async function pingVoice() {
  const url = `${HEALTH_BASE}/webhooks/twilio/voice`
  const body = new URLSearchParams({
    From: '+15551234567',
    To:   '+18443492327',
    CallSid: `CAhealth${Date.now()}`,
    CallStatus: 'ringing',
    Direction: 'inbound',
  }).toString()
  const t0 = Date.now()
  try {
    const r = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 8000,
      validateStatus: () => true,
    })
    const ms = Date.now() - t0
    const bodyOk = typeof r.data === 'string' && r.data.includes('<Response')
    return {
      endpoint: 'voice',
      http:     r.status,
      ms,
      ok:       r.status === 200 && bodyOk,
      body_preview: String(r.data || '').slice(0, 200),
    }
  } catch (e) {
    return { endpoint: 'voice', http: 0, ms: Date.now() - t0, ok: false, error: e.message }
  }
}

async function pingSms() {
  const url = `${HEALTH_BASE}/webhooks/twilio/sms`
  const body = new URLSearchParams({
    From: '+15551234567',
    To:   '+18443492327',
    Body: '[phone-health synthetic ping — ignore]',
    MessageSid: `SMhealth${Date.now()}`,
    NumMedia: '0',
  }).toString()
  const t0 = Date.now()
  try {
    const r = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 8000,
      validateStatus: () => true,
    })
    const ms = Date.now() - t0
    const bodyOk = typeof r.data === 'string' && r.data.includes('<Response')
    return {
      endpoint: 'sms',
      http:     r.status,
      ms,
      ok:       r.status === 200 && bodyOk,
      body_preview: String(r.data || '').slice(0, 200),
    }
  } catch (e) {
    return { endpoint: 'sms', http: 0, ms: Date.now() - t0, ok: false, error: e.message }
  }
}

async function verifyPhoneConfig(req) {
  try {
    const cfg = await resolvePhoneConfig(req)
    const problems = []
    if (!cfg.TWILIO_ACCOUNT_SID) problems.push('missing TWILIO_ACCOUNT_SID')
    if (!cfg.TWILIO_AUTH_TOKEN)  problems.push('missing TWILIO_AUTH_TOKEN')
    if (!cfg.TWILIO_PHONE_NUMBER && !cfg.TWILIO_TOLLFREE_NUMBER) {
      problems.push('no Twilio phone number configured')
    }
    if (!cfg.MARK_PHONE_NUMBER && !cfg.JAYDEN_PHONE_NUMBER && !cfg.KAT_PHONE_NUMBER) {
      problems.push('ring cascade has no targets')
    }
    return { ok: problems.length === 0, problems, cfg }
  } catch (e) {
    return { ok: false, problems: [`config load error: ${e.message}`] }
  }
}

// Verify Twilio credentials are still accepted by hitting the read-only
// Messages list endpoint. Catches the "Auth Token was rotated in Twilio
// console, our stored value is now wrong" failure before it silently
// blocks every outbound send.
async function verifyTwilioAuth(cfg) {
  if (!cfg?.TWILIO_ACCOUNT_SID || !cfg?.TWILIO_AUTH_TOKEN) {
    return { ok: false, http: 0, reason: 'creds missing in config' }
  }
  const t0 = Date.now()
  try {
    const r = await axios.get(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.TWILIO_ACCOUNT_SID}/Messages.json?PageSize=1`,
      { auth: { username: cfg.TWILIO_ACCOUNT_SID, password: cfg.TWILIO_AUTH_TOKEN }, timeout: 8000, validateStatus: () => true }
    )
    const ms = Date.now() - t0
    return { ok: r.status === 200, http: r.status, ms, reason: r.status === 200 ? null : (r.data?.message || r.data?.detail || `HTTP ${r.status}`) }
  } catch (e) {
    return { ok: false, http: 0, ms: Date.now() - t0, reason: e.message }
  }
}

router.get('/', async (req, res) => {
  // Cron secret gate — reject anyone who isn't the scheduled cron.
  const expected = process.env.PHONE_HEALTH_CRON_SECRET || process.env.BACKUP_CRON_SECRET
  const provided = req.headers['x-cron-secret']
  if (expected && provided !== expected) {
    return res.status(401).json({ error: 'Not authenticated' })
  }
  const [voice, sms, cfg] = await Promise.all([pingVoice(), pingSms(), verifyPhoneConfig(req)])
  const twilioAuth = await verifyTwilioAuth(cfg.cfg)
  const allOk = voice.ok && sms.ok && cfg.ok && twilioAuth.ok

  if (!allOk) {
    const failLines = [
      `🚨 *PHONE SYSTEM HEALTH ALERT*`,
      voice.ok ? `✅ Voice endpoint: HTTP ${voice.http} · ${voice.ms}ms` : `❌ Voice endpoint: HTTP ${voice.http} · ${voice.ms}ms · ${voice.error || voice.body_preview || ''}`,
      sms.ok   ? `✅ SMS endpoint: HTTP ${sms.http} · ${sms.ms}ms`     : `❌ SMS endpoint: HTTP ${sms.http} · ${sms.ms}ms · ${sms.error || sms.body_preview || ''}`,
      cfg.ok   ? `✅ Phone config OK` : `❌ Phone config: ${(cfg.problems || []).join(', ')}`,
      twilioAuth.ok ? `✅ Twilio auth OK` : `❌ Twilio auth: HTTP ${twilioAuth.http} · ${twilioAuth.reason}`,
      ``,
      `Customers may not be able to reach us right now.`,
    ].join('\n')
    try {
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, failLines)
    } catch (e) { console.warn('[phone-health cliq alert]', e.message) }
  }

  // Don't leak the raw cfg back to the caller — cascade numbers are
  // masked to last-4 so we can verify ring order without exposing cells.
  const last4 = n => (n ? `…${String(n).slice(-4)}` : null)
  res.json({
    ok: allOk,
    voice,
    sms,
    config: { ok: cfg.ok, problems: cfg.problems },
    cascade: {
      order: ['jayden', 'mark', 'kat'],
      jayden: last4(cfg.cfg?.JAYDEN_PHONE_NUMBER),
      mark:   last4(cfg.cfg?.MARK_PHONE_NUMBER),
      kat:    last4(cfg.cfg?.KAT_PHONE_NUMBER),
    },
    twilio_auth: twilioAuth,
    checked_at: new Date().toISOString(),
  })
})

export { router as phoneHealthRouter }
