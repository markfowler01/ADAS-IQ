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

// A2P campaign resubmission (Mark 2026-09-23 "let's fix this"): delete the FAILED
// campaign on the messaging service that holds the 425, create the corrected one.
export const A2P_CAMPAIGN = {
  UsAppToPersonUsecase: 'LOW_VOLUME',
  Description: 'Two-way customer-service texting between Absolute ADAS (mobile ADAS calibration, programming and diagnostics) and the commercial auto body / repair shops that hire us for a specific vehicle job. Outbound texts: appointment confirmations, technician arrival ETAs, calibration-complete notices with a link to the OEM report, parts or pre-work needed before we can calibrate, and invoice follow-ups. Inbound texts from the shop are answered by our team on the same number. No marketing, no promotions, no purchased lists.',
  MessageFlow: 'Recipients are commercial auto body and repair shops (business contacts, not consumers). A shop opts in through ONE of these documented methods before any message is sent: (1) Web form at https://absoluteadas.com/sms-consent.html — the shop enters its business name, email and mobile number and must tick an UNCHECKED consent box that reads: "I consent to receive SMS messages about my ADAS calibration appointment and service updates from Absolute ADAS. I understand message and data rates may apply." The page states: up to ~10 messages per job, message and data rates may apply, reply STOP to opt out, HELP for help, and links to Terms (https://absoluteadas.com/terms/) and Privacy Policy (https://absoluteadas.com/privacy/). (2) Written service quote — the shop signs/accepts a quote that contains the same SMS consent clause and enters the mobile number to be texted. (3) The shop texts our published business line first; our first reply is the opt-in confirmation message (brand, frequency, rates, STOP, HELP). Consent is not a condition of purchase and is optional. The privacy policy states mobile numbers and consent data are never shared with third parties or affiliates for marketing. Opt-out: STOP (and STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT); help: HELP. Expected volume: about 10 messages per job, well under 2,000 per day.',
  OptInMessage: 'Absolute ADAS: You\'re opted in to job update texts (appointment confirmations, ETAs, completion reports, invoices). Msg frequency varies, ~10 per job. Msg & data rates may apply. Reply STOP to opt out, HELP for help.',
  OptOutMessage: 'Absolute ADAS: You\'re unsubscribed and will receive no more texts. Reply START to opt back in. Questions: (844) 349-2327.',
  HelpMessage: 'Absolute ADAS: Job update texts, ~10 per job. Msg & data rates may apply. Call (844) 349-2327 or email mark@absoluteadas.com. Reply STOP to opt out.',
  OptInKeywords: ['START', 'YES', 'UNSTOP'],
  OptOutKeywords: ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'],
  HelpKeywords: ['HELP', 'INFO'],
  MessageSamples: [
    'Hi Joe — your 2024 Honda CR-V (RO# 24223) is scheduled for tomorrow 10am at Bellevue Body Shop. We\'ll text when we arrive. Reply STOP to opt out. — Absolute ADAS',
    'Calibration complete on RO# 24223. Front radar + camera verified to OEM spec. Report uploaded to your WorkDrive folder: https://workdrive.zohoexternal.com/... Reply STOP to opt out. — Absolute ADAS',
    'Hey Sam — I\'m en route to your shop, ETA about 25 minutes. Please have the keys to RO# 24225 ready. Reply STOP to opt out. — Mark, Absolute ADAS',
    'RO# 24225 — front radar calibration requires the wheel alignment to be completed first. Can you confirm? Reply STOP to opt out. — Absolute ADAS',
    'Quick reminder — invoice #INV-5512 for the 6/8 calibration job is past due. Let us know if there\'s any question. Reply STOP to opt out. — Absolute ADAS',
  ],
  HasEmbeddedLinks: true, HasEmbeddedPhone: true, SubscriberOptIn: true, AgeGated: false, DirectLending: false,
}
export async function resubmitA2p(cfg, { dry = false } = {}) {
  const A = auth(cfg)
  const get = async url => { const r = await axios.get(url, { auth: A, timeout: 15000, validateStatus: () => true }); return r.data }
  const want = normalizePhoneUS(cfg.TWILIO_PHONE_NUMBER)
  const services = (await get('https://messaging.twilio.com/v1/Services?PageSize=20')).services || []
  let svc = null
  for (const s of services) { const nums = ((await get(`https://messaging.twilio.com/v1/Services/${s.sid}/PhoneNumbers?PageSize=50`)).phone_numbers || []).map(n => normalizePhoneUS(n.phone_number)); if (nums.includes(want)) { svc = s; break } }
  if (!svc) throw new Error('No messaging service holds the 425')
  const cur = (await get(`https://messaging.twilio.com/v1/Services/${svc.sid}/Compliance/Usa2p?PageSize=5`)).compliance || []
  const brand = cur[0]?.brand_registration_sid
  if (!brand) throw new Error('No brand registration sid on the existing campaign')
  const plan = { service: svc.sid, service_name: svc.friendly_name, brand, existing: cur.map(c => ({ sid: c.sid, status: c.campaign_status })) }
  if (dry) return { dry: true, ...plan, campaign: A2P_CAMPAIGN }
  for (const c of cur) {
    if (['VERIFIED', 'IN_PROGRESS', 'PENDING_REVIEW'].includes(c.campaign_status)) throw new Error(`Campaign ${c.sid} is ${c.campaign_status} — not touching it`)
    const d = await axios.delete(`https://messaging.twilio.com/v1/Services/${svc.sid}/Compliance/Usa2p/${c.sid}`, { auth: A, timeout: 15000, validateStatus: () => true })
    if (d.status >= 400) throw new Error(`Delete ${c.sid} → ${d.status}: ${d.data?.message || ''}`)
  }
  const params = new URLSearchParams()
  params.append('BrandRegistrationSid', brand)
  for (const [k, v] of Object.entries(A2P_CAMPAIGN)) { if (Array.isArray(v)) v.forEach(x => params.append(k, x)); else params.append(k, String(v)) }
  const r = await axios.post(`https://messaging.twilio.com/v1/Services/${svc.sid}/Compliance/Usa2p`, params.toString(), { auth: A, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000, validateStatus: () => true })
  if (r.status >= 400) throw new Error(`Create → ${r.status}: ${r.data?.message || JSON.stringify(r.data || {}).slice(0, 300)}`)
  return { ...plan, created: { sid: r.data.sid, status: r.data.campaign_status, campaign_id: r.data.campaign_id } }
}
