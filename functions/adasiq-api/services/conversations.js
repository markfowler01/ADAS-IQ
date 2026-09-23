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
    'AutoCreation.WebhookFilters': ['onMessageAdded', 'onParticipantAdded'],   // onConversationAdded is service-level only → 'Invalid Webhook filter'
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

// Mark 2026-09-23: "I don't need a kill switch — turn it on forever." The
// app keeps the 425's group texting on: hourly check, re-create if missing.
export async function ensureGroupTexting(cfg, { number, webhookUrl }) {
  const st = await groupTextingStatus(cfg, number)
  if (st.on && st.enabled && st.webhook === webhookUrl) return { on: true, changed: false }
  const r = await enableGroupTexting(cfg, { number, webhookUrl })
  return { on: true, changed: true, ...r }
}

// Diagnostics: the last few messages in a conversation + per-participant delivery receipts.
export async function conversationDiag(cfg, conversationSid) {
  const msgs = await call(cfg, 'get', `/Conversations/${conversationSid}/Messages`, { PageSize: 5, Order: 'desc' })
  const parts = await call(cfg, 'get', `/Conversations/${conversationSid}/Participants`, { PageSize: 50 })
  const out = []
  for (const m of msgs.messages || []) {
    let receipts = []
    try { const r = await call(cfg, 'get', `/Conversations/${conversationSid}/Messages/${m.sid}/Receipts`, { PageSize: 50 }); receipts = (r.delivery_receipts || []).map(x => ({ participant: x.participant_sid, status: x.status, error: x.error_code || null, channel: x.channel_message_sid || null })) } catch (e) { receipts = [{ error: e.message }] }
    out.push({ sid: m.sid, author: m.author, body: String(m.body || '').slice(0, 80), date: m.date_created, delivery: m.delivery || null, receipts })
  }
  return { participants: (parts.participants || []).map(p => ({ sid: p.sid, address: p.messaging_binding?.address || p.identity || '', proxy: p.messaging_binding?.proxy_address || '' })), messages: out }
}

// A2P diagnostics: messaging services (sender pools + US A2P campaign) and the
// Conversations default messaging service. Read-only.
export async function a2pDiag(cfg) {
  const A = auth(cfg)
  const get = async url => { const r = await axios.get(url, { auth: A, timeout: 15000, validateStatus: () => true }); return r.data }
  const services = (await get('https://messaging.twilio.com/v1/Services?PageSize=20')).services || []
  const out = []
  for (const s of services) {
    const nums = ((await get(`https://messaging.twilio.com/v1/Services/${s.sid}/PhoneNumbers?PageSize=50`)).phone_numbers || []).map(n => n.phone_number)
    let a2p = null
    try { const c = await get(`https://messaging.twilio.com/v1/Services/${s.sid}/Compliance/Usa2p?PageSize=5`); a2p = (c.compliance || []).map(x => ({ sid: x.sid, status: x.campaign_status, use_case: x.us_app_to_person_usecase, brand: x.brand_registration_sid })) } catch { a2p = 'n/a' }
    out.push({ sid: s.sid, name: s.friendly_name, numbers: nums, a2p })
  }
  const convCfg = await get('https://conversations.twilio.com/v1/Configuration')
  return { services: out, conversations_default_messaging_service: convCfg.default_messaging_service_sid || null, conversations_default_chat_service: convCfg.default_chat_service_sid || null }
}

// Why is A2P failing? Full campaign + brand objects, and the 425's last sends.
export async function a2pWhy(cfg) {
  const A = auth(cfg)
  const get = async url => { const r = await axios.get(url, { auth: A, timeout: 15000, validateStatus: () => true }); return r.data }
  const services = (await get('https://messaging.twilio.com/v1/Services?PageSize=20')).services || []
  const campaigns = [], brands = {}
  for (const s of services) {
    const c = await get(`https://messaging.twilio.com/v1/Services/${s.sid}/Compliance/Usa2p?PageSize=5`)
    for (const x of c.compliance || []) {
      campaigns.push({ service: s.sid, service_name: s.friendly_name, sid: x.sid, campaign_id: x.campaign_id, status: x.campaign_status, use_case: x.us_app_to_person_usecase, description: x.description, message_samples: x.message_samples, errors: x.errors || null, opt_in: x.opt_in_message, help: x.help_message, brand: x.brand_registration_sid, mock: x.mock, date_updated: x.date_updated })
      if (x.brand_registration_sid && !brands[x.brand_registration_sid]) brands[x.brand_registration_sid] = await get(`https://messaging.twilio.com/v1/a2p/BrandRegistrations/${x.brand_registration_sid}`)
    }
  }
  const last = (await get(`https://api.twilio.com/2010-04-01/Accounts/${cfg.TWILIO_ACCOUNT_SID}/Messages.json?From=${encodeURIComponent(cfg.TWILIO_PHONE_NUMBER)}&PageSize=100`)).messages || []
  const lastTf = cfg.TWILIO_TOLLFREE_NUMBER ? ((await get(`https://api.twilio.com/2010-04-01/Accounts/${cfg.TWILIO_ACCOUNT_SID}/Messages.json?From=${encodeURIComponent(cfg.TWILIO_TOLLFREE_NUMBER)}&PageSize=10`)).messages || []) : []
  const lastOkLocal = last.find(m => ['delivered', 'sent'].includes(m.status))
  return { campaigns, local_summary: { checked: last.length, undelivered: last.filter(m => m.status === 'undelivered').length, last_delivered: lastOkLocal ? { date: lastOkLocal.date_sent, to: lastOkLocal.to } : null, oldest_checked: last.length ? last[last.length - 1].date_created : null }, last_sends_from_tollfree: lastTf.map(m => ({ date: m.date_sent || m.date_created, to: m.to, status: m.status, error: m.error_code })), brands: Object.fromEntries(Object.entries(brands).map(([k, b]) => [k, { status: b.status, identity_status: b.identity_status, brand_type: b.brand_type, failure_reason: b.failure_reason, brand_feedback: b.brand_feedback, errors: b.errors, russell_3000: b.russell_3000, date_updated: b.date_updated }])), last_sends_from_local: last.map(m => ({ date: m.date_sent || m.date_created, to: m.to, status: m.status, error: m.error_code, body: String(m.body || '').slice(0, 40) })) }
}

// Is the 425 allowed to send? VERIFIED campaign on a messaging service that holds the number.
export async function localA2pStatus(cfg) {
  const A = auth(cfg)
  const get = async url => { const r = await axios.get(url, { auth: A, timeout: 15000, validateStatus: () => true }); return r.data }
  const want = normalizePhoneUS(cfg.TWILIO_PHONE_NUMBER)
  const services = (await get('https://messaging.twilio.com/v1/Services?PageSize=20')).services || []
  for (const s of services) {
    const nums = ((await get(`https://messaging.twilio.com/v1/Services/${s.sid}/PhoneNumbers?PageSize=50`)).phone_numbers || []).map(n => normalizePhoneUS(n.phone_number))
    if (!nums.includes(want)) continue
    const c = await get(`https://messaging.twilio.com/v1/Services/${s.sid}/Compliance/Usa2p?PageSize=5`)
    const st = (c.compliance || []).map(x => x.campaign_status)
    return { verified: st.includes('VERIFIED'), statuses: st, service: s.sid }
  }
  return { verified: false, statuses: [], service: null }
}
