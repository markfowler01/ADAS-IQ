// Zoho Sign — offer letters and contractor agreements (Mark 2026-09-17:
// "thinking about using Zoho Sign and integrating it… Yep it's all
// active"). One PDF we generate, one recipient, a signature + date field
// placed where the letter leaves room, sent through Sign so the signed
// copy carries Sign's audit trail. The signed PDF is pulled back by the
// hourly poll (no webhook to configure) and filed in the person's folder.
//
// Token: ZOHO_SIGN_REFRESH_TOKEN if set (a token minted with
// ZohoSign.documents.ALL + ZohoSign.templates.ALL), else the main
// ZOHO_REFRESH_TOKEN. The main token as of 2026-09-21 has NO Sign scope
// (checked: "Invalid Oauth Scope"), so until Mark mints one, isConfigured()
// is false and the UI says so instead of failing mid-send.
import axios from 'axios'

const SIGN = 'https://sign.zoho.com/api/v1'
let cached = { token: null, exp: 0, from: '' }

export function signTokenSource() { return process.env.ZOHO_SIGN_REFRESH_TOKEN ? 'sign' : (process.env.ZOHO_REFRESH_TOKEN ? 'main' : 'none') }

async function token() {
  const refresh = process.env.ZOHO_SIGN_REFRESH_TOKEN || process.env.ZOHO_REFRESH_TOKEN
  if (!refresh) throw new Error('No Zoho refresh token for Sign')
  if (cached.token && Date.now() < cached.exp - 60000 && cached.from === refresh.slice(-8)) return cached.token
  const params = new URLSearchParams({ grant_type: 'refresh_token', client_id: process.env.ZOHO_CLIENT_ID, client_secret: process.env.ZOHO_CLIENT_SECRET, refresh_token: refresh })
  const r = await axios.post('https://accounts.zoho.com/oauth/v2/token', params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 })
  if (!r.data?.access_token) throw new Error(`Sign token refresh failed: ${r.data?.error || 'no token'}`)
  cached = { token: r.data.access_token, exp: Date.now() + (Number(r.data.expires_in) || 3600) * 1000, from: refresh.slice(-8) }
  return cached.token
}
const hdr = t => ({ Authorization: `Zoho-oauthtoken ${t}` })

/** Cheap probe: can this token talk to Sign at all? Cached 10 min. */
let probe = { at: 0, ok: false, why: '' }
export async function isConfigured() {
  if (Date.now() - probe.at < 10 * 60000) return probe
  try {
    const r = await axios.get(`${SIGN}/templates`, { headers: hdr(await token()), params: { page_size: 1 }, timeout: 15000, validateStatus: () => true })
    const ok = r.status === 200
    probe = { at: Date.now(), ok, why: ok ? '' : (r.data?.message || `HTTP ${r.status}`) }
  } catch (e) { probe = { at: Date.now(), ok: false, why: e.message } }
  return probe
}

/**
 * Send one PDF for one signature.
 * fields: [{ type: 'Signature'|'Date'|'Textfield', page, x, y, w, h, name }]
 *   coordinates in PDF points from the top-left of the page (Sign's frame).
 * → { request_id, action_id, document_id, sign_url? }
 */
export async function sendForSignature({ pdf, filename, recipientName, recipientEmail, subject, note, fields, expirationDays = 14 }) {
  const t = await token()
  const FormData = (await import('form-data')).default
  const fd = new FormData()
  fd.append('file', pdf, { filename, contentType: 'application/pdf' })
  fd.append('data', JSON.stringify({ requests: {
    request_name: subject, expiration_days: expirationDays, is_sequential: false, email_reminders: true, reminder_period: 3, notes: note || '',
    actions: [{ action_type: 'SIGN', recipient_email: recipientEmail, recipient_name: recipientName, signing_order: 1, verify_recipient: false, private_notes: '' }],
  } }))
  const created = await axios.post(`${SIGN}/requests`, fd, { headers: { ...hdr(t), ...fd.getHeaders() }, timeout: 30000, maxBodyLength: Infinity })
  const reqObj = created.data?.requests
  if (!reqObj?.request_id) throw new Error(`Sign create failed: ${created.data?.message || 'no request id'}`)
  const request_id = reqObj.request_id, action_id = reqObj.actions?.[0]?.action_id, document_id = reqObj.document_ids?.[0]?.document_id
  const fieldData = (fields || []).map((f, i) => ({
    document_id, field_name: f.name || `${f.type}${i + 1}`, field_type_name: f.type, field_label: f.name || f.type, is_mandatory: true,
    page_no: f.page || 0, x_coord: Math.round(f.x), y_coord: Math.round(f.y), abs_width: Math.round(f.w), abs_height: Math.round(f.h),
    ...(f.type === 'Date' ? { date_format: 'MM/dd/yyyy' } : {}),
  }))
  const submitBody = new URLSearchParams({ data: JSON.stringify({ requests: { actions: [{ action_id, action_type: 'SIGN', recipient_email: recipientEmail, recipient_name: recipientName, signing_order: 1, verify_recipient: false, fields: fieldData }] } }) })
  const sub = await axios.post(`${SIGN}/requests/${request_id}/submit`, submitBody.toString(), { headers: { ...hdr(t), 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 })
  if (sub.data?.status && sub.data.status !== 'success') throw new Error(`Sign submit failed: ${sub.data?.message || 'unknown'}`)
  return { request_id, action_id, document_id }
}

/** → { status: 'inprogress'|'completed'|'declined'|'expired'|'recalled'|..., raw } */
export async function requestStatus(requestId) {
  const r = await axios.get(`${SIGN}/requests/${requestId}`, { headers: hdr(await token()), timeout: 15000 })
  const q = r.data?.requests || {}
  return { status: String(q.request_status || '').toLowerCase(), signed_at: q.action_time || q.modified_time || null, raw: q }
}

export async function downloadSignedPdf(requestId) {
  const r = await axios.get(`${SIGN}/requests/${requestId}/pdf`, { headers: hdr(await token()), responseType: 'arraybuffer', timeout: 30000 })
  return Buffer.from(r.data)
}

export async function recallRequest(requestId, reason = 'Withdrawn by Absolute ADAS') {
  const body = new URLSearchParams({ data: JSON.stringify({ requests: { reason } }) })
  await axios.post(`${SIGN}/requests/${requestId}/recall`, body.toString(), { headers: { ...hdr(await token()), 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 })
}
