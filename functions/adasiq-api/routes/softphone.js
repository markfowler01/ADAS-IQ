// Browser softphone (Mark 2026-08-12: "Kat needs to answer the phone
// with her computer"). Twilio Voice JS SDK in the app registers as
// client identity "aa-desk"; the voice cascade rings it FIRST when on
// duty (see voice.js cascadeTargets), falling through to the cell
// cascade untouched.
//
//   GET  /api/softphone/token     → { token, identity } (auto-provisions
//                                   API key + TwiML app on first call)
//   GET  /api/softphone/status    → { on }
//   POST /api/softphone/duty      { on } — desk on/off duty
//   GET  /api/softphone/lookup?phone= → { contact_name, shop_name }
//   POST /api/softphone/transfer  { call_sid, to: 'mark'|'jayden' }
//                                   — hand the live caller to a cell
//
// All requireAuth (mounted in index.js). Credentials live in
// phone_config (env vars are maxed): TWILIO_API_KEY_SID/SECRET,
// TWILIO_TWIML_APP_SID, DESK_PHONE_ON.

import express from 'express'
import twilio from 'twilio'
import {
  resolvePhoneConfig, setPhoneConfigValue,
} from '../services/phoneConfig.js'

const router = express.Router()
const IDENTITY = 'aa-desk'

function restClient(cfg) {
  const sid = cfg.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID
  const token = cfg.TWILIO_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) throw new Error('Twilio account credentials not configured (Phone Setup)')
  return twilio(sid, token)
}

function webhookBase() {
  return (process.env.TWILIO_WEBHOOK_BASE_URL || '').replace(/\/$/, '')
    || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'
}

// Auto-provision the API key + TwiML app once, persisting to phone_config.
async function ensureVoiceInfra(req, cfg) {
  let apiKeySid = cfg.TWILIO_API_KEY_SID
  let apiKeySecret = cfg.TWILIO_API_KEY_SECRET
  let twimlAppSid = cfg.TWILIO_TWIML_APP_SID
  const client = restClient(cfg)

  if (!apiKeySid || !apiKeySecret) {
    const key = await client.newKeys.create({ friendlyName: 'ADAS IQ softphone' })
    apiKeySid = key.sid
    apiKeySecret = key.secret
    await setPhoneConfigValue(req, 'TWILIO_API_KEY_SID', apiKeySid)
    await setPhoneConfigValue(req, 'TWILIO_API_KEY_SECRET', apiKeySecret)
    console.log('[softphone] provisioned API key', apiKeySid)
  }

  if (!twimlAppSid) {
    const app = await client.applications.create({
      friendlyName: 'ADAS IQ softphone',
      voiceUrl: `${webhookBase()}/webhooks/twilio/voice/client-outgoing`,
      voiceMethod: 'POST',
    })
    twimlAppSid = app.sid
    await setPhoneConfigValue(req, 'TWILIO_TWIML_APP_SID', twimlAppSid)
    console.log('[softphone] provisioned TwiML app', twimlAppSid)
  }

  return { apiKeySid, apiKeySecret, twimlAppSid }
}

router.get('/token', async (req, res) => {
  try {
    const cfg = await resolvePhoneConfig(req)
    const { apiKeySid, apiKeySecret, twimlAppSid } = await ensureVoiceInfra(req, cfg)
    const accountSid = cfg.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID

    const AccessToken = twilio.jwt.AccessToken
    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity: IDENTITY,
      ttl: 86400,  // 24h (Twilio max) — background-tab throttling was
                   // letting 1h tokens expire (error 20104, 2026-08-29)
    })
    token.addGrant(new AccessToken.VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true,
    }))
    res.json({ ok: true, token: token.toJwt(), identity: IDENTITY })
  } catch (err) {
    console.error('[softphone token]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/status', async (req, res) => {
  try {
    const cfg = await resolvePhoneConfig(req)
    res.json({ ok: true, on: String(cfg.DESK_PHONE_ON || '').toLowerCase() === 'true' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/duty', async (req, res) => {
  try {
    const on = !!req.body?.on
    await setPhoneConfigValue(req, 'DESK_PHONE_ON', on ? 'true' : 'false')
    res.json({ ok: true, on })
  } catch (err) {
    console.error('[softphone duty]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/lookup', async (req, res) => {
  try {
    const phone = String(req.query.phone || '')
    if (!phone) return res.json({ ok: true, contact_name: '', shop_name: '' })
    const { findContactByPhone } = await import('../services/crmContacts.js')
    const contact = await findContactByPhone(req, phone).catch(() => null)
    res.json({
      ok: true,
      contact_name: contact?.contact_name || contact?.name || '',
      shop_name: contact?.shop_name || '',
    })
  } catch (err) {
    res.json({ ok: true, contact_name: '', shop_name: '' })
  }
})

// Transfer the live caller to Mark's or Jayden's cell. The browser leg
// is a CHILD call — redirecting the PARENT (the customer) to new dial
// TwiML moves them and drops the browser leg automatically.
router.post('/transfer', async (req, res) => {
  try {
    const childSid = String(req.body?.call_sid || '')
    const who = String(req.body?.to || '').toLowerCase()
    if (!childSid) return res.status(400).json({ error: 'call_sid required' })
    const cfg = await resolvePhoneConfig(req)
    const numbers = {
      mark:   cfg.MARK_PHONE_NUMBER,
      jayden: cfg.JAYDEN_PHONE_NUMBER || '+14257379022',
    }
    const target = numbers[who]
    if (!target) return res.status(400).json({ error: `No number configured for "${who}"` })

    const client = restClient(cfg)
    const child = await client.calls(childSid).fetch()
    const parentSid = child.parentCallSid
    if (!parentSid) return res.status(400).json({ error: 'No parent call to transfer (is this an active inbound call?)' })

    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const callerId = child.to && child.to.startsWith('client:') ? undefined : child.to
    await client.calls(parentSid).update({
      twiml: `<Response><Say voice="Polly.Matthew">Transferring you now.</Say><Dial callerId="${esc(cfg.TWILIO_TOLLFREE_NUMBER || '')}" record="record-from-answer"><Number>${esc(target)}</Number></Dial></Response>`,
    })
    console.log(`[softphone] transferred parent ${parentSid} → ${who}`)
    res.json({ ok: true, transferred_to: who })
  } catch (err) {
    console.error('[softphone transfer]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export { router as softphoneRouter }
