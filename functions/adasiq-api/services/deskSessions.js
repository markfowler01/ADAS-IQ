// 📞 Desk phone per device (Mark 2026-10-28): "when I open my computer it automatically turns
// my phone desk system on and then sometimes it starts ringing … I need it to only turn on
// when I intended." The old On Duty switch was one company-wide flag, so every app tab that
// woke up re-registered as the desk. Now each device that taps On duty holds a session here,
// kept alive by a heartbeat; a closed or sleeping laptop drops off in minutes, and every
// session ends at 6 PM Pacific. DESK_PHONE_ON (what voice.js reads) simply mirrors
// "anyone live?", so call routing itself is untouched.
import catalyst from 'zcatalyst-sdk-node'
import { kvGet, kvSet } from './durableKV.js'
import { resolvePhoneConfig, setPhoneConfigValue, parseCascadeOrder } from './phoneConfig.js'

const KEY = 'desk_sessions'
export const HEARTBEAT_MS = 2 * 60 * 1000
const STALE_MS = 6 * 60 * 1000
const OFF_HOUR_PT = 18
const app = req => catalyst.initialize(req)

// Next 6 PM Pacific after `iso` (or midnight, when turned on after 6 PM).
function endsAt(iso) {
  const t = Date.parse(iso)
  const pt = new Date(new Date(t).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const offset = t - pt.getTime()                       // PT wall clock → real time
  const end = new Date(pt); end.setHours(pt.getHours() >= OFF_HOUR_PT ? 24 : OFF_HOUR_PT, 0, 0, 0)
  return end.getTime() + offset
}
const live = (s, now = Date.now()) => now - Date.parse(s.seen) < STALE_MS && now < endsAt(s.since)

async function read(req) { try { return JSON.parse((await kvGet(app(req), KEY)) || '[]') } catch { return [] } }
async function write(req, list) { await kvSet(app(req), KEY, JSON.stringify(list)) }

/** Drop dead sessions and make DESK_PHONE_ON match. Returns the live list. */
export async function syncDesk(req) {
  const all = await read(req), now = Date.now()
  const alive = all.filter(s => live(s, now))
  if (alive.length !== all.length) await write(req, alive)
  const cfg = await resolvePhoneConfig(req)
  const want = alive.length ? 'true' : 'false'
  if (String(cfg.DESK_PHONE_ON || 'false').toLowerCase() !== want) await setPhoneConfigValue(req, 'DESK_PHONE_ON', want)
  return { alive, cfg: { ...cfg, DESK_PHONE_ON: want } }
}

const whoOf = req => String(req.user?.techName || req.user?.name || req.user?.email || 'Someone').split(/[\s@]/)[0]

export async function setDuty(req, device, on) {
  if (!device) throw Object.assign(new Error('device required'), { status: 400 })
  const list = (await read(req)).filter(s => s.device !== device)
  const now = new Date().toISOString()
  if (on) list.push({ device, who: whoOf(req), email: String(req.user?.email || '').toLowerCase(), since: now, seen: now })
  await write(req, list)
  return status(req, device)
}

export async function heartbeat(req, device) {
  const list = await read(req), s = list.find(x => x.device === device)
  if (s && live(s)) { s.seen = new Date().toISOString(); await write(req, list) }
  return status(req, device)
}

/** Who's on + the ring order, for the pill on every screen. */
export async function status(req, device) {
  const { alive, cfg } = await syncDesk(req)
  const mine = alive.find(s => s.device === device)
  const order = parseCascadeOrder(cfg)   // same order voice.js rings
  const names = { mark: 'Mark', kat: 'Kat', jayden: 'Jayden' }
  const deskWho = [...new Set(alive.map(s => s.who))].join(' + ')
  const ring = []
  if (alive.length && !order.includes('desk')) ring.push(`🖥 Desk (${deskWho})`)
  for (const k of order) {
    if (k === 'desk') { if (alive.length) ring.push(`🖥 Desk (${deskWho})`) }
    else ring.push(`📱 ${names[k] || k}'s cell`)
  }
  return {
    ok: true,
    on: !!mine,                       // old tabs read `on`: only true for a device that tapped On duty
    mine: !!mine, mine_ends_at: mine ? new Date(endsAt(mine.since)).toISOString() : null,
    desk: alive.map(s => ({ who: s.who, since: s.since, me: s.device === device })),
    ring, heartbeat_ms: HEARTBEAT_MS,
  }
}
