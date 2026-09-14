// 💬 Text as Mark (2026-09-14) — an outbox for texts that go out from
// Mark's PERSONAL cell number. Catalyst never sends these itself: a bridge
// script on Mark's Mac polls the queue every minute and hands each text to
// the Messages app (iMessage / SMS via iPhone text forwarding), then reports
// back. Replies are picked up by the same bridge and posted here as
// direction=in (Phase 2).
//
// Guardrails (Mark 2026-09-14 plan): every text logged with who asked and
// why; only known contacts (CRM shop people, team, Mark himself) unless the
// owner forces it; quiet hours 7am–8pm PT; daily cap; nothing automatic —
// a human (Mark) or an approved draft enqueues, the bridge only delivers.
import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { getMarkPhone } from '../services/markPhone.js'

const TABLE = 'PersonalTexts'
const QUIET_START_H = 7      // sends allowed from 07:00 PT
const QUIET_END_H = 20       // …until 20:00 PT
const DAILY_CAP = 20
const SECRET = () => String(process.env.BRIEFING_CRON_SECRET || process.env.MORNING_CRON_SECRET || 'morning-2026').trim()

const tbl = req => catalyst.initialize(req, { type: 'advancedio' }).datastore().table(TABLE)
const zcql = (req, q) => catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(q)
const unwrap = rows => (rows || []).map(r => r[TABLE] || r)
const nowIso = () => new Date().toISOString()
const esc = s => String(s || '').replace(/'/g, "''")

export function normalizePhone(p) {
  const d = String(p || '').replace(/[^\d+]/g, '')
  if (!d) return ''
  if (d.startsWith('+')) return d
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return d
}
function hourPT() {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false }).format(new Date()))
}
function todayPT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}
const rowToText = r => ({
  id: String(r.ROWID), to: r.pt_to || '', to_name: r.pt_to_name || '', body: r.pt_body || '', purpose: r.pt_purpose || '',
  requested_by: r.pt_requested_by || '', status: r.pt_status || '', sent_at: r.pt_sent_at || '', error: r.pt_error || '',
  shop_id: r.pt_shop_id || '', direction: r.pt_direction || 'out', created_at: r.pt_created_at || r.CREATEDTIME || '',
})

// Known contact? CRM shop people/phones, team phones, Mark himself.
async function isKnownContact(req, phone) {
  const mark = normalizePhone(await getMarkPhone(req))
  if (mark && mark === phone) return { ok: true, who: 'Mark' }
  try {
    const { resolvePhoneConfig } = await import('../services/phoneConfig.js')
    const cfg = await resolvePhoneConfig(req)
    for (const [k, v] of Object.entries(cfg || {})) {
      if (/PHONE/i.test(k) && normalizePhone(v) === phone) return { ok: true, who: k }
    }
  } catch { /* optional */ }
  try {
    const { getAllShops } = await import('./shops.js')
    const shops = await getAllShops(req)
    for (const s of shops || []) {
      if (normalizePhone(s.phone) === phone) return { ok: true, who: s.shop_name, shop_id: s.id }
      let people = s.people
      if (typeof people === 'string') { try { people = JSON.parse(people) } catch { people = [] } }
      for (const p of people || []) if (normalizePhone(p.phone) === phone) return { ok: true, who: `${p.name || 'contact'} · ${s.shop_name}`, shop_id: s.id }
    }
  } catch (e) { console.log('[personal-texts] shop lookup failed:', e.message) }
  return { ok: false }
}

async function sentTodayCount(req) {
  const rows = unwrap(await zcql(req, `SELECT ROWID FROM ${TABLE} WHERE pt_direction = 'out' AND pt_created_at LIKE '${todayPT()}%'`).catch(() => []))
  return rows.length
}

// ── Owner routes (mounted behind requireAuth + requireOwner) ─────────────
export const ownerRouter = express.Router()

// POST / — enqueue { to, to_name, body, purpose, shop_id, force }
ownerRouter.post('/', async (req, res) => {
  try {
    const to = normalizePhone(req.body?.to)
    const body = String(req.body?.body || '').trim()
    if (!to || !/^\+\d{10,15}$/.test(to)) return res.status(400).json({ error: 'Need a valid phone number.' })
    if (!body) return res.status(400).json({ error: 'Nothing to send.' })
    if (body.length > 1200) return res.status(400).json({ error: 'Keep it under 1200 characters.' })
    const known = await isKnownContact(req, to)
    if (!known.ok && !req.body?.force) return res.status(400).json({ error: `${to} isn't a known contact (CRM person, team, or you). Add them to the CRM first, or send with force.`, unknown: true })
    const n = await sentTodayCount(req)
    if (n >= DAILY_CAP) return res.status(429).json({ error: `Daily cap reached (${DAILY_CAP} personal texts today).` })
    const by = req.user?.name || req.user?.email || 'Mark'
    const row = {
      pt_to: to, pt_to_name: String(req.body?.to_name || known.who || '').slice(0, 120), pt_body: body,
      pt_purpose: String(req.body?.purpose || 'manual').slice(0, 120), pt_requested_by: String(by).slice(0, 80),
      pt_status: 'queued', pt_shop_id: String(req.body?.shop_id || known.shop_id || '').slice(0, 40), pt_direction: 'out', pt_created_at: nowIso(),
    }
    const ins = await tbl(req).insertRow(row)
    const h = hourPT()
    const inWindow = h >= QUIET_START_H && h < QUIET_END_H
    console.log(`[personal-texts] queued → ${to} (${row.pt_to_name}) by ${by}: ${body.slice(0, 60)}`)
    res.json({ ok: true, text: rowToText({ ...row, ROWID: ins?.ROWID }), sends: inWindow ? 'within a minute, from your number' : `at ${QUIET_START_H}:00 PT (quiet hours)`, today: n + 1, cap: DAILY_CAP })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /recent — last 50, newest first
ownerRouter.get('/recent', async (req, res) => {
  try {
    const rows = unwrap(await zcql(req, `SELECT * FROM ${TABLE} ORDER BY CREATEDTIME DESC LIMIT 50`))
    res.json({ ok: true, texts: rows.map(rowToText), cap: DAILY_CAP, today: await sentTodayCount(req) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /:id — cancel a queued text
ownerRouter.delete('/:id', async (req, res) => {
  try {
    await tbl(req).updateRow({ ROWID: String(req.params.id), pt_status: 'cancelled' })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Bridge routes (mounted WITHOUT session auth; x-cron-secret) ──────────
export const bridgeRouter = express.Router()
bridgeRouter.use((req, res, next) => {
  const got = String(req.headers['x-cron-secret'] || req.query.secret || '').trim()
  if (got !== SECRET()) return res.status(401).json({ error: 'Unauthorized' })
  next()
})

// GET /queue — what the Mac should send right now (respects quiet hours)
bridgeRouter.get('/queue', async (req, res) => {
  try {
    const h = hourPT()
    if (h < QUIET_START_H || h >= QUIET_END_H) return res.json({ ok: true, texts: [], quiet: true })
    const rows = unwrap(await zcql(req, `SELECT * FROM ${TABLE} WHERE pt_status = 'queued' AND pt_direction = 'out' ORDER BY CREATEDTIME ASC LIMIT 10`))
    res.json({ ok: true, texts: rows.map(rowToText) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /:id/result { ok, error }
bridgeRouter.post('/:id/result', async (req, res) => {
  try {
    const ok = !!req.body?.ok
    await tbl(req).updateRow({ ROWID: String(req.params.id), pt_status: ok ? 'sent' : 'failed', pt_sent_at: ok ? nowIso() : '', pt_error: ok ? '' : String(req.body?.error || 'send failed').slice(0, 255) })
    console.log(`[personal-texts] ${req.params.id} → ${ok ? 'SENT' : 'FAILED ' + String(req.body?.error || '').slice(0, 120)}`)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /inbound { from, body, at } — replies seen by the bridge (Phase 2)
bridgeRouter.post('/inbound', async (req, res) => {
  try {
    const from = normalizePhone(req.body?.from)
    const body = String(req.body?.body || '').trim()
    if (!from || !body) return res.status(400).json({ error: 'from + body required' })
    const known = await isKnownContact(req, from)
    await tbl(req).insertRow({ pt_to: from, pt_to_name: String(known.who || '').slice(0, 120), pt_body: body, pt_purpose: 'reply', pt_requested_by: '', pt_status: 'received', pt_shop_id: String(known.shop_id || '').slice(0, 40), pt_direction: 'in', pt_created_at: String(req.body?.at || nowIso()).slice(0, 40) })
    res.json({ ok: true, known: known.ok, who: known.who || null })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /health — bridge heartbeat check
bridgeRouter.get('/health', (req, res) => res.json({ ok: true, hour_pt: hourPT(), window: `${QUIET_START_H}:00–${QUIET_END_H}:00 PT`, cap: DAILY_CAP }))
