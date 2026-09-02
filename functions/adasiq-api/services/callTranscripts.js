// Call transcription → Cliq (Mark 2026-09-02: "use ai to make a
// transcript of the conversation and post it to a channel").
//
// Pipeline: recording-done webhook → Twilio Voice Intelligence
// transcript (runs on the existing Twilio account, dual-channel so the
// caller and our side are separated) → transcript-ready webhook →
// Claude summary → Cliq post with caller ID, CRM match, summary, and
// the conversation.
//
// The Intelligence Service is auto-provisioned once (same pattern as
// the TwiML app) and remembered in phone_config.

import axios from 'axios'

const INTEL_API = 'https://intelligence.twilio.com/v2'

function twilioAuth(cfg) {
  return {
    username: cfg.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID,
    password: cfg.TWILIO_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN,
  }
}

export async function ensureIntelligenceService(req, cfg, webhookBase) {
  if (cfg.INTELLIGENCE_SERVICE_SID) return cfg.INTELLIGENCE_SERVICE_SID
  const auth = twilioAuth(cfg)
  // Reuse by unique name if it exists (e.g. config row lost)
  try {
    const list = await axios.get(`${INTEL_API}/Services?PageSize=50`, { auth, timeout: 15000 })
    const hit = (list.data?.services || []).find(s => s.unique_name === 'absolute-adas-calls')
    if (hit?.sid) {
      const { setPhoneConfigValue } = await import('./phoneConfig.js')
      await setPhoneConfigValue(req, 'INTELLIGENCE_SERVICE_SID', hit.sid)
      return hit.sid
    }
  } catch { /* fall through to create */ }
  const params = new URLSearchParams({
    UniqueName: 'absolute-adas-calls',
    FriendlyName: 'Absolute ADAS call transcripts',
    WebhookUrl: `${webhookBase}/webhooks/twilio/voice/transcript-ready`,
    WebhookHttpMethod: 'POST',
  })
  const r = await axios.post(`${INTEL_API}/Services`, params, { auth, timeout: 15000 })
  const sid = r.data?.sid
  if (sid) {
    const { setPhoneConfigValue } = await import('./phoneConfig.js')
    await setPhoneConfigValue(req, 'INTELLIGENCE_SERVICE_SID', sid)
    console.log('[transcripts] provisioned Intelligence service', sid)
  }
  return sid
}

export async function startTranscript(cfg, serviceSid, recordingSid) {
  const auth = twilioAuth(cfg)
  const params = new URLSearchParams({
    ServiceSid: serviceSid,
    Channel: JSON.stringify({ media_properties: { source_sid: recordingSid } }),
  })
  const r = await axios.post(`${INTEL_API}/Transcripts`, params, { auth, timeout: 15000 })
  return r.data?.sid || null
}

export async function fetchTranscript(cfg, transcriptSid) {
  const auth = twilioAuth(cfg)
  const r = await axios.get(`${INTEL_API}/Transcripts/${transcriptSid}`, { auth, timeout: 15000 })
  return r.data
}

export async function fetchSentences(cfg, transcriptSid) {
  const auth = twilioAuth(cfg)
  const r = await axios.get(`${INTEL_API}/Transcripts/${transcriptSid}/Sentences?PageSize=500`, { auth, timeout: 20000 })
  return r.data?.sentences || []
}

// Channel 1 = the caller's leg, channel 2 = whoever answered for us.
export function formatConversation(sentences) {
  const lines = []
  let last = null
  for (const s of sentences) {
    const who = Number(s.media_channel) === 2 ? 'Absolute ADAS' : 'Caller'
    const text = String(s.transcript || '').trim()
    if (!text) continue
    if (who === last) {
      lines[lines.length - 1] += ' ' + text
    } else {
      lines.push(`*${who}:* ${text}`)
      last = who
    }
  }
  return lines.join('\n')
}

export async function summarizeCall(conversation) {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 20000, maxRetries: 1 })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content:
        `Summarize this phone call for a busy ADAS calibration shop owner. Return EXACTLY this format, nothing else:\n` +
        `Summary: <1-2 plain sentences — who called about what, outcome>\n` +
        `Action: <one line — what we owe them or "none">\n\n` +
        `Transcript:\n${conversation.slice(0, 8000)}` }],
    })
    return (msg.content || []).map(b => b.text || '').join('').trim()
  } catch (e) {
    console.warn('[transcripts] summary failed (posting raw):', e.message)
    return ''
  }
}
