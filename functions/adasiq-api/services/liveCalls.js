// 📞 Live calls — who is on the 844 right now (Mark 2026-10-05: "with Grasshopper I
// used to hit ## and an extension and it transferred"). Twilio tells us the moment a
// cascade leg is answered (statusCallback on the <Number>/<Client> noun); we keep
// that in Catalyst Cache for the length of the call so the app can show the person
// on the call a "Transfer → Mark · Jayden · Kat · Voicemail" bar. Transfer itself is a
// Twilio call-update on the CALLER's leg (see routes/voice.js transferTwiML).
import catalyst from 'zcatalyst-sdk-node'

const INDEX = 'live_calls_index'
const KEY = sid => `live_call:${sid}`
const TTL_H = 2      // Catalyst Cache TTL is 1–48h; a call never runs 2h
const STALE_MS = 3 * 3600 * 1000

const seg = req => catalyst.initialize(req, { type: 'advancedio' }).cache().segment()
async function put(req, key, value) {
  const s = seg(req), v = JSON.stringify(value)
  try { await s.update(key, v) } catch { await s.put(key, v, TTL_H) }
}
async function get(req, key) {
  try { const v = await seg(req).getValue(key); if (!v) return null; return typeof v === 'string' ? JSON.parse(v) : v } catch { return null }
}
async function readIndex(req) { const a = await get(req, INDEX); return Array.isArray(a) ? a : [] }

/** A leg was answered: remember the live call keyed by the CALLER's (parent) CallSid. */
export async function setLive(req, sid, data) {
  if (!sid) return null
  const prev = (await get(req, KEY(sid))) || {}
  const row = { ...prev, ...data, sid, updated_at: new Date().toISOString(), answered_at: prev.answered_at || data.answered_at || new Date().toISOString() }
  await put(req, KEY(sid), row)
  const idx = await readIndex(req)
  if (!idx.includes(sid)) await put(req, INDEX, [...idx, sid].slice(-50))
  return row
}
export async function patchLive(req, sid, data) {
  const cur = await get(req, KEY(sid)); if (!cur) return null
  const row = { ...cur, ...data, updated_at: new Date().toISOString() }
  await put(req, KEY(sid), row); return row
}
export async function getLive(req, sid) { return sid ? get(req, KEY(sid)) : null }
export async function clearLive(req, sid) {
  if (!sid) return
  try { await put(req, KEY(sid), { sid, ended: true, updated_at: new Date().toISOString() }) } catch { /* fine */ }
  const idx = await readIndex(req)
  if (idx.includes(sid)) await put(req, INDEX, idx.filter(x => x !== sid))
}
/** Every call still live (ended / stale rows dropped). */
export async function listLive(req) {
  const idx = await readIndex(req)
  const rows = await Promise.all(idx.map(sid => get(req, KEY(sid))))
  const live = rows.filter(r => r && !r.ended && Date.now() - new Date(r.answered_at || r.updated_at).getTime() < STALE_MS)
  if (live.length !== idx.length) { try { await put(req, INDEX, live.map(r => r.sid)) } catch { /* fine */ } }
  return live.sort((a, b) => String(b.answered_at).localeCompare(String(a.answered_at)))
}

// Who is this app user in cascade terms? Owner = mark; otherwise by first name.
export function cascadeKeyFor(user) {
  const email = String(user?.email || '').toLowerCase(), name = String(user?.techName || user?.name || '').toLowerCase()
  if (user?.role === 'owner' || email.startsWith('mark@') || email.startsWith('mf@') || /\bmark\b/.test(name)) return 'mark'
  if (/\bkat\b|katherine|kathleen|belmonte/.test(name) || email.startsWith('kat')) return 'kat'
  if (/jayden|jaden|goshorn/.test(name) || email.startsWith('jayden') || email.startsWith('jaden')) return 'jayden'
  return ''
}
export const KEY_NAMES = { mark: 'Mark', kat: 'Kat', jayden: 'Jayden', desk: 'the desk', voicemail: 'Voicemail' }
/** Can this user see / transfer this call? Owner always; otherwise the person on it (desk counts for any staff). */
export function canSee(user, call) {
  if (!call) return false
  if (user?.role === 'owner' || cascadeKeyFor(user) === 'mark') return true
  const me = cascadeKeyFor(user)
  if (!call.who || call.status === 'ringing') return true
  return call.who === me || (call.who === 'desk' && user?.role !== 'technician')
}

// Ring buffer of the last 60 leg events (debug: "I called her, nothing popped up").
export async function logEvent(req, ev) {
  try { const a = (await get(req, 'live_call_events')) || []; await put(req, 'live_call_events', [...(Array.isArray(a) ? a : []), { at: new Date().toISOString(), ...ev }].slice(-60)) } catch { /* fine */ }
}
export async function recentEvents(req) { const a = await get(req, 'live_call_events'); return Array.isArray(a) ? a : [] }

/** Append one activity to a CRM shop's timeline (auto-log calls, drawer notes). */
export async function logShopActivity(req, { shopId = '', shopName = '', text, by = 'phone' }) {
  const { getAllShops, updateShop } = await import('../routes/shops.js')
  const all = await getAllShops(req)
  const shop = all.find(s => (shopId && String(s.id) === String(shopId)) || (!shopId && shopName && String(s.shop_name).toLowerCase() === String(shopName).toLowerCase()))
  if (!shop) return null
  const act = { id: `a_${Date.now()}${Math.random().toString(36).slice(2, 5)}`, type: 'call', at: new Date().toISOString(), by, text: String(text || '').slice(0, 400) }
  await updateShop(req, shop.id, { ...shop, activities: [...(Array.isArray(shop.activities) ? shop.activities : []), act].slice(-200), last_contact: new Date().toISOString().slice(0, 10) })
  return act
}
