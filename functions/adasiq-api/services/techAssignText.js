// 📲 Tech assignment text (Mark 2026-09-23): when a job lands on a tech,
// text their cell — shop, vehicle, RO, calibrations, when, a Navigate link
// to the shop and an Open-job link into the app. GET SOME!!! at the end.
// Once per job per tech; never to the person who assigned it to themselves;
// held 8pm–7am PT until morning. Rides the same send path as everything
// else (so it goes from the 844 until the 425's campaign is verified).
import catalyst from 'zcatalyst-sdk-node'
import { sendTwilioSMS, normalizePhoneUS } from './twilio.js'
import { resolvePhoneConfig } from './phoneConfig.js'
import { postToCliqChannel, DISPATCH_CHANNEL } from './cliq.js'

const QUEUE_KEY = 'assign_sms_queue'
const first = s => String(s || '').trim().split(/\s+/)[0].toLowerCase()
const sameTech = (a, b) => !!a && !!b && (first(a) === first(b) || (first(a).startsWith('jay') && first(b).startsWith('jay')))
const ptHour = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date()))
const inHours = () => { const h = ptHour(); return h >= 7 && h < 20 }
const seg = req => catalyst.initialize(req, { type: 'advancedio' }).cache().segment()
const appBase = () => (process.env.WEB_BASE_URL || 'https://adas-iq-904191467.development.catalystserverless.com/app').replace(/\/$/, '')

async function techPhone(req, cfg, techName) {
  try {
    const { readTeamMembers } = await import('../routes/team.js')
    const m = (await readTeamMembers(req)).find(x => x.active !== false && sameTech(x.preferred_name || x.name, techName) || sameTech(x.name, techName))
    const p = normalizePhoneUS(m?.phone || m?.personal_phone || '')
    if (p) return { phone: p, member: m }
  } catch (e) { console.log('[assign-sms] directory lookup failed:', e.message) }
  const k = first(techName)
  const fb = k.startsWith('jay') ? cfg.JAYDEN_PHONE_NUMBER : k.startsWith('mark') ? cfg.MARK_PHONE_NUMBER : k.startsWith('kat') ? cfg.KAT_PHONE_NUMBER : ''
  return { phone: normalizePhoneUS(fb || ''), member: null }
}
function whenLine(job) {
  const d = String(job.scheduled_date || '').trim(); if (!d) return ''
  const dt = new Date(d.length <= 10 ? `${d}T12:00:00-07:00` : d)
  if (Number.isNaN(dt.getTime())) return d
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'numeric', day: 'numeric' }).format(dt)
  const time = d.length > 10 ? ' ' + new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(dt) : ''
  return `${day}${time}`
}
function calsLine(job) {
  let cals = []; try { cals = typeof job.calibrations === 'string' ? JSON.parse(job.calibrations || '[]') : (job.calibrations || []) } catch { cals = [] }
  const names = cals.filter(c => c && c.enabled !== false).map(c => c.calibration_name || c.name || c).filter(Boolean).map(String)
  if (!names.length) return ''
  const shown = names.slice(0, 4).map(n => n.replace(/\s*\((Static|Dynamic|Static or Dynamic|Reset)\)\s*$/i, '')).join(', ')
  return names.length > 4 ? `${shown} +${names.length - 4} more` : shown
}
async function shopAddress(req, shopName) {
  try { const { findShopByName } = await import('./big3.js'); const s = await findShopByName(req, shopName); return String(s?.address || '').trim() } catch { return '' }
}
export async function buildAssignText(req, job) {
  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  const ro = job.quote_number || job.invoice_number || (job.notes || '').match(/RO#?[:\s]*([^\s|,]+)/i)?.[1] || ''
  const addr = await shopAddress(req, job.shop_name)
  const lines = [
    `🔧 New job — ${job.shop_name || 'Shop TBD'}`,
    `${vehicle || 'Vehicle TBD'}${ro ? ` · RO ${ro}` : ''}`,
    calsLine(job),
    whenLine(job),
    String(job.cash_quoted || '').trim() ? `💵 CASH · customer told $${job.cash_quoted}` : '',
    addr ? `📍 Navigate: https://maps.apple.com/?daddr=${encodeURIComponent(addr)}` : '',
    `📋 Open job: ${appBase()}/?job=${encodeURIComponent(job.id)}`,
    'GET SOME!!! — Mark',
  ].filter(Boolean)
  return { body: lines.join('\n').slice(0, 900), addr }
}

async function readQueue(req) { try { const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${QUEUE_KEY}' LIMIT 1`); const r = rows?.[0]?.AppConfig; return r ? { row: String(r.ROWID), items: JSON.parse(r.config_value || '[]') } : { row: null, items: [] } } catch { return { row: null, items: [] } } }
async function writeQueue(req, row, items) { const t = catalyst.initialize(req, { type: 'advancedio' }).datastore().table('AppConfig'); const value = JSON.stringify(items.slice(-40)); if (row) await t.updateRow({ ROWID: row, config_key: QUEUE_KEY, config_value: value }); else await t.insertRow({ config_key: QUEUE_KEY, config_value: value }) }

/** Main hook. prevTech = who had it before (for the hand-off notice). by = req.user. */
export async function sendTechAssignmentText(req, job, prevTech = '') {
  try {
    const tech = String(job.technician || '').trim()
    if (!tech || String(job.status || '') === 'job_requested' || !/^dispatched_/.test(String(job.status || ''))) return { sent: false, why: 'not a dispatched job' }
    const byName = req.user?.techName || req.user?.name || ''
    const byEmail = String(req.user?.email || '').toLowerCase()
    if (sameTech(byName, tech) || (byEmail.startsWith('mark@') && first(tech) === 'mark') || (byEmail.startsWith('jayden@') && first(tech).startsWith('jay'))) return { sent: false, why: 'self-assigned' }
    const stampKey = `assign_sms:${job.id}:${first(tech)}`
    try { if (await seg(req).getValue(stampKey)) return { sent: false, why: 'already texted' } } catch { /* fine */ }
    const cfg = await resolvePhoneConfig(req)
    const { phone } = await techPhone(req, cfg, tech)
    if (!phone) { await postToCliqChannel(DISPATCH_CHANNEL, `📲 Couldn't text ${tech} about ${job.shop_name || 'the job'} — no cell on their Directory card.`).catch(() => {}); return { sent: false, why: 'no phone' } }
    const { body, addr } = await buildAssignText(req, job)
    if (!addr && job.shop_name) postToCliqChannel(DISPATCH_CHANNEL, `📍 ${job.shop_name} has no address in the CRM — the tech's text had no Navigate link.`).catch(() => {})
    const handoff = prevTech && !sameTech(prevTech, tech) ? { prev: prevTech, body: `↩️ ${job.shop_name || 'Job'} · ${job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')} moved to ${tech}. — Absolute ADAS` } : null
    try { await seg(req).put(stampKey, new Date().toISOString(), 48) } catch { /* fine */ }
    if (!inHours()) {
      const q = await readQueue(req)
      q.items.push({ to: phone, body, job_id: job.id, tech, queued_at: new Date().toISOString() })
      if (handoff) { const { phone: pp } = await techPhone(req, cfg, handoff.prev); if (pp) q.items.push({ to: pp, body: handoff.body, job_id: job.id, tech: handoff.prev, queued_at: new Date().toISOString() }) }
      await writeQueue(req, q.row, q.items)
      console.log(`[assign-sms] after hours — queued for ${tech} (${job.shop_name})`)
      return { sent: false, queued: true }
    }
    const r = await sendTwilioSMS({ to: phone, body, from: 'local', cfg })
    console.log(`[assign-sms] ${tech} ← ${job.shop_name || ''} ${job.vehicle || ''}: ${r.ok ? 'sent ' + r.sid : 'FAILED ' + r.error}`)
    if (handoff) { const { phone: pp } = await techPhone(req, cfg, handoff.prev); if (pp) await sendTwilioSMS({ to: pp, body: handoff.body, from: 'local', cfg }).catch(() => {}) }
    return { sent: !!r.ok, error: r.ok ? undefined : r.error }
  } catch (e) { console.warn('[assign-sms] failed (non-fatal):', e.message); return { sent: false, error: e.message } }
}

/** Hourly: send what was held overnight, once it's 7am PT. */
export async function drainAssignQueue(req) {
  if (!inHours()) return { drained: 0 }
  const q = await readQueue(req); if (!q.items.length) return { drained: 0 }
  const cfg = await resolvePhoneConfig(req)
  let n = 0
  for (const it of q.items) { try { const r = await sendTwilioSMS({ to: it.to, body: it.body, from: 'local', cfg }); if (r.ok) n++ } catch { /* keep going */ } }
  await writeQueue(req, q.row, [])
  console.log(`[assign-sms] drained ${n}/${q.items.length} held text(s)`)
  return { drained: n }
}
