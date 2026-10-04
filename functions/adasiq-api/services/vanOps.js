// 🚐 Van ops reminders (Mark 2026-10-04: "oil change reminders, 30, 60, 90k
// reminders, insurance docs and numbers"). Reads the shared Ops state, works out
// what is due on each van, and once a day tells Mark's alerts + #dispatch (the
// techs read #dispatch). The morning briefing reads the same list.
import catalyst from 'zcatalyst-sdk-node'
import { postToCliqChannel, postToCliqChannelById, DISPATCH_CHANNEL, MARK_ALERT_CHANNEL_ID } from './cliq.js'

// Same intervals as client/src/components/ops/maint.js (keep in step).
const INTERVALS = {
  'Oil Change':    { miles: 5000,  months: 6 },
  'Tire Rotation': { miles: 7500,  months: 6 },
  'Tires':         { miles: 50000, months: 48 },
  'Brakes':        { miles: 40000, months: 36 },
  'Inspection':    { miles: null,  months: 12 },
  'Transmission':  { miles: 60000, months: 48 },
  'Coolant':       { miles: 30000, months: 24 },
}
// Ford severe-duty milestones for a working Transit: a record of type "Milestone 30k"
// (etc.) marks one done. Due when the odometer is within 1,000 mi, overdue once past.
export const MILESTONES = [30000, 60000, 90000, 120000, 150000]

const days = d => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null
const addMonths = (d, m) => { if (!d) return ''; const x = new Date(d + 'T12:00:00'); x.setMonth(x.getMonth() + Number(m || 0)); return x.toISOString().slice(0, 10) }
const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

async function readOps(req, key) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const r = await app.zcql().executeZCQLQuery(`SELECT config_value FROM AppConfig WHERE config_key = 'ops_${key}' LIMIT 1`)
  try { return JSON.parse(r?.[0]?.AppConfig?.config_value || '[]') || [] } catch { return [] }
}
const odometerOf = v => { const recs = (v.maintenance || []).filter(r => Number(r.mileage) > 0); return Math.max(Number(v.odometer) || 0, ...recs.map(r => Number(r.mileage)), 0) || null }

/** Everything due on the vans, soonest first. sev: 3 overdue · 2 due soon · 1 later. */
export async function vanOpsDue(req) {
  const [locations, assets, oem] = await Promise.all([readOps(req, 'locations'), readOps(req, 'assets'), readOps(req, 'oem')])
  const vans = locations.filter(l => l.type === 'van')
  const out = []
  const push = (van, what, when, sev, detail = '') => out.push({ van: van.name, what, when, sev, detail })
  for (const v of vans) {
    const odo = odometerOf(v)
    const recs = (v.maintenance || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    for (const [type, iv] of Object.entries(INTERVALS)) {
      const last = recs.find(r => r.type === type); if (!last) continue
      const dueDate = iv.months ? addMonths(last.date, iv.months) : ''; const n = days(dueDate)
      const dueMiles = iv.miles && Number(last.mileage) > 0 ? Number(last.mileage) + iv.miles : null
      const left = dueMiles && odo ? dueMiles - odo : null
      let sev = 1
      if ((n !== null && n < 0) || (left !== null && left < 0)) sev = 3
      else if ((n !== null && n <= 14) || (left !== null && left <= 500)) sev = 2
      const when = [n !== null ? (n < 0 ? `${Math.abs(n)}d overdue` : `in ${n}d`) : '', left !== null ? (left < 0 ? `${Math.abs(left).toLocaleString()} mi over` : `${left.toLocaleString()} mi left`) : ''].filter(Boolean).join(' · ')
      if (sev >= 2) push(v, type, when, sev)
    }
    if (odo) for (const m of MILESTONES) {
      const done = recs.some(r => String(r.type || '').toLowerCase() === `milestone ${m / 1000}k`)
      if (done || odo < m - 1000) continue
      push(v, `${m / 1000}k service`, odo >= m ? `${(odo - m).toLocaleString()} mi past ${(m / 1000)}k` : `${(m - odo).toLocaleString()} mi away`, odo >= m ? 3 : 2, 'Ford severe-duty milestone')
    }
    for (const [f, label] of [['reg_exp', 'Registration'], ['insurance_exp', 'Insurance'], ['oil_change', 'Oil change (date)']]) {
      const n = days(v[f]); if (n === null) continue
      if (n < 0) push(v, label, `${Math.abs(n)}d overdue`, 3)
      else if (n <= 30) push(v, label, `in ${n}d`, 2)
    }
  }
  const vanName = id => locations.find(l => l.id === id)?.name || 'Spare'
  for (const a of assets) { const n = days(a.sub_exp); if (n === null) continue; if (n < 0) out.push({ van: vanName(a.location), what: `${a.name} subscription`, when: `${Math.abs(n)}d overdue`, sev: 3 }); else if (n <= 30) out.push({ van: vanName(a.location), what: `${a.name} subscription`, when: `in ${n}d`, sev: 2 }) }
  for (const s of oem) {
    if (s.status === 'inactive' || s.kind === 'pass') continue
    const r = s.purchased ? addMonths(s.purchased, s.term_months || 12) : (s.renewal || ''); const n = days(r); if (n === null) continue
    const where = s.kind === 'van' ? vanName(s.location) : 'Shared'
    if (n < 0) out.push({ van: where, what: `${s.name} renewal`, when: `${Math.abs(n)}d overdue`, sev: 3 }); else if (n <= 30) out.push({ van: where, what: `${s.name} renewal`, when: `in ${n}d`, sev: 2 })
  }
  out.sort((a, b) => b.sev - a.sev)
  return out
}

/** Spoken lines for Ada's morning briefing. */
export async function vanOpsForBrief(req) {
  try {
    const due = await vanOpsDue(req)
    const over = due.filter(d => d.sev === 3), soon = due.filter(d => d.sev === 2)
    if (!over.length && !soon.length) return []
    const lines = []
    if (over.length) lines.push(`Van ops: ${over.length} overdue. ${over.slice(0, 3).map(d => `${d.van}, ${d.what}, ${d.when}`).join('. ')}.`)
    if (soon.length) lines.push(`Coming up: ${soon.slice(0, 3).map(d => `${d.van} ${d.what} ${d.when}`).join(', ')}.`)
    return lines
  } catch { return [] }
}

/** Once per PT day, after 7am: the due list to Mark's alerts and #dispatch. */
export async function maybeVanOpsReminders(req) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date()))
  if (hour < 7) return { fired: false, reason: 'before-7am' }
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const key = `vanops_reminders:${todayPT()}`
  const r = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = '${key}' LIMIT 1`)
  if (r?.[0]) return { fired: false, reason: 'already' }
  await app.datastore().table('AppConfig').insertRow({ config_key: key, config_value: new Date().toISOString() })
  const due = await vanOpsDue(req)
  const items = due.filter(d => d.sev >= 2)
  if (!items.length) return { fired: true, sent: 0 }
  const line = d => `${d.sev === 3 ? '🔴' : '🟠'} *${d.van}* · ${d.what} · ${d.when}${d.detail ? ` · ${d.detail}` : ''}`
  const msg = `🚐 *Van ops — due today*\n${items.slice(0, 15).map(line).join('\n')}${items.length > 15 ? `\n…and ${items.length - 15} more on Ops → Due` : ''}`
  await Promise.allSettled([postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg), postToCliqChannel(DISPATCH_CHANNEL, msg)])
  return { fired: true, sent: items.length }
}
