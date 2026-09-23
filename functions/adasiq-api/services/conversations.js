// Twilio Conversations — group texting on the local 425 (Mark 2026-09-23:
// "build out all the stuff for the 425 number… I'm gonna test it out first").
// Twilio refuses group MMS on toll-free; a US long code can join a group
// text only through Conversations. Once an Address Configuration exists for
// the 425, EVERY inbound text to it (1:1 too) arrives as a Conversation
// message at our webhook, so the handler folds 1:1 back onto the same phone
// thread and only real groups (2+ outside numbers) get a group thread.
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { normalizePhoneUS, formatPhonePretty } from './twilio.js'

const BASE = 'https://conversations.twilio.com/v1'
export const OUR_AUTHOR = 'absolute-adas'          // Author on messages we send into a conversation
const auth = cfg => ({ username: cfg.TWILIO_ACCOUNT_SID, password: cfg.TWILIO_AUTH_TOKEN })

async function call(cfg, method, path, form) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(form || {})) { if (v == null) continue; Array.isArray(v) ? v.forEach(x => params.append(k, String(x))) : params.append(k, String(v)) }
  const r = await axios({ method, url: `${BASE}${path}`, data: method === 'get' || method === 'delete' ? undefined : params.toString(), params: method === 'get' ? Object.fromEntries(params) : undefined, auth: auth(cfg), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, validateStatus: () => true })
  if (r.status >= 400) throw new Error(`Twilio Conversations ${method.toUpperCase()} ${path} → ${r.status}: ${r.data?.message || JSON.stringify(r.data || {}).slice(0, 200)}`)
  return r.data
}

// ── Address Configuration = the switch ─────────────────────────────────────
export async function groupTextingStatus(cfg, number) {
  const want = normalizePhoneUS(number)
  const d = await call(cfg, 'get', '/Configuration/Addresses', { PageSize: 50 })
  const hit = (d.address_configurations || []).find(a => normalizePhoneUS(a.address) === want)
  return hit ? { on: true, sid: hit.sid, address: hit.address, webhook: hit.auto_creation?.webhook_url || '', enabled: !!hit.auto_creation?.enabled, filters: hit.auto_creation?.webhook_filters || [] } : { on: false }
}
export async function enableGroupTexting(cfg, { number, webhookUrl }) {
  const cur = await groupTextingStatus(cfg, number)
  const form = {
    Type: 'sms', Address: normalizePhoneUS(number), FriendlyName: 'Absolute ADAS app — 425 group texting',
    'AutoCreation.Enabled': true, 'AutoCreation.Type': 'webhook',
    'AutoCreation.WebhookUrl': webhookUrl, 'AutoCreation.WebhookMethod': 'POST',
    'AutoCreation.WebhookFilters': ['onMessageAdded', 'onConversationAdded', 'onParticipantAdded'],
  }
  if (cur.on) { const d = await call(cfg, 'post', `/Configuration/Addresses/${cur.sid}`, form); return { updated: true, sid: d.sid } }
  const d = await call(cfg, 'post', '/Configuration/Addresses', form)
  return { created: true, sid: d.sid }
}
export async function disableGroupTexting(cfg, number) {
  const cur = await groupTextingStatus(cfg, number)
  if (!cur.on) return { off: true, was: 'off' }
  await call(cfg, 'delete', `/Configuration/Addresses/${cur.sid}`)
  return { off: true, was: 'on' }
}

// ── Participants → thread key (cached 48h; Catalyst cap) ───────────────────
const seg = req => catalyst.initialize(req, { type: 'advancedio' }).cache().segment()
export async function conversationInfo(req, cfg, conversationSid, ourNumbers) {
  const key = `conv:${conversationSid}`
  try { const v = await seg(req).getValue(key); if (v) return JSON.parse(v) } catch { /* miss */ }
  const d = await call(cfg, 'get', `/Conversations/${conversationSid}/Participants`, { PageSize: 50 })
  const ours = new Set((ourNumbers || []).map(normalizePhoneUS).filter(Boolean))
  const phones = []
  for (const p of d.participants || []) {
    const a = normalizePhoneUS(p.messaging_binding?.address || '')
    if (a && !ours.has(a) && !phones.includes(a)) phones.push(a)
  }
  const info = { participants: phones, is_group: phones.length >= 2, key: phones.length >= 2 ? `group:${conversationSid}` : (phones[0] || `group:${conversationSid}`) }
  try { await seg(req).put(key, JSON.stringify(info), 48) } catch { /* fine */ }
  return info
}
export async function forgetConversation(req, conversationSid) { try { await seg(req).delete(`conv:${conversationSid}`) } catch { /* fine */ } }

export async function sendConversationMessage(cfg, conversationSid, body, author = OUR_AUTHOR) {
  const d = await call(cfg, 'post', `/Conversations/${conversationSid}/Messages`, { Author: author, Body: String(body).slice(0, 1600) })
  return { sid: d.sid, index: d.index }
}
export async function fetchConversationMedia(cfg, chatServiceSid, mediaSid) {
  const r = await axios.get(`https://mcs.us1.twilio.com/v1/Services/${chatServiceSid}/Media/${mediaSid}/Content`, { auth: auth(cfg), responseType: 'arraybuffer', timeout: 20000, maxRedirects: 5 })
  return { data: Buffer.from(r.data), contentType: r.headers['content-type'] || 'application/octet-stream' }
}
export const groupLabel = (phones, phoneIdx) => phones.map(p => { const c = phoneIdx?.get?.(p.replace(/\D/g, '')); return c?.contact_name ? c.contact_name.split(' ')[0] : formatPhonePretty(p) }).join(', ')
