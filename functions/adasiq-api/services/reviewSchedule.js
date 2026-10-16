// ⭐ Automatic review check-ins (Mark 2026-10-16: "when I hire somebody, I
// want a six month review built-in and a 90 day review built-in… these
// meetings just get set automatically on a weekday… coffee before work or
// drinks after work").
//
// For every active W-2 hire with a start date: a 90-day ☕ coffee before work and
// a 6-month 🍺 drinks after work, booked on Mark's Zoho calendar with the
// employee invited. Weekend dates move to the nearest weekday, company paid
// holidays and anything already on Mark's calendar push it to the next
// weekday. Only future dates get booked (past ones are just recorded). If the
// start date changes, future check-ins are cancelled and re-booked.
//
// MARK ONLY: stored in AppConfig `mpb_reviews:<memberId>` (same private
// prefix as Pay & Benefits). Invites carry no pay information.

export const SLOTS = {
  coffee: { start: '07:00', end: '07:45', emoji: '☕', name: 'Coffee before work' },
  drinks: { start: '17:30', end: '18:30', emoji: '🍺', name: 'Drinks after work' },
}
export const PLAN = [
  { key: '90d', label: '90-day check-in', days: 90, slot: 'coffee' },
  { key: '6mo', label: '6-month check-in', months: 6, slot: 'drinks' },
]
const KEY = id => `mpb_reviews:${String(id).replace(/[^a-z0-9_]/gi, '')}`
const iso = d => d.toISOString().slice(0, 10)
const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

export function targetDate(hireISO, p) {
  const d = new Date(hireISO + 'T12:00:00Z')
  if (p.days) d.setUTCDate(d.getUTCDate() + p.days)
  if (p.months) { const day = d.getUTCDate(); d.setUTCMonth(d.getUTCMonth() + p.months); if (d.getUTCDate() !== day) d.setUTCDate(0) }
  const dow = d.getUTCDay()
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1)   // Saturday → Friday
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1)   // Sunday → Monday
  return iso(d)
}
function nextWeekday(dateISO) {
  const d = new Date(dateISO + 'T12:00:00Z')
  do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay()))
  return iso(d)
}
const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE

async function pickDay(dateISO, slot, holidays, busyFn) {
  let d = dateISO
  for (let i = 0; i < 10; i++) {
    let clash = holidays.has(d)
    if (!clash && busyFn) {
      try { clash = (await busyFn(d)).some(b => b.start && b.end && overlaps(SLOTS[slot].start, SLOTS[slot].end, b.start, b.end)) } catch { /* can't read → book anyway */ }
    }
    if (!clash) return d
    d = nextWeekday(d)
  }
  return d
}

export async function readSchedule(req, memberId) {
  const { cfgReadJson } = await import('../routes/people.js')
  return await cfgReadJson(req, KEY(memberId), null)
}
async function writeSchedule(req, memberId, s) {
  const { cfgWriteJson } = await import('../routes/people.js')
  await cfgWriteJson(req, KEY(memberId), s)
}

// Make sure one person's check-ins exist and match their start date.
export async function ensureSchedule(req, m, { dryRun = false } = {}) {
  // W-2 hires only (contractors are remote: Kat, Joyce); skip test records.
  if (!m?.hire_date || m.active === false || m.employment !== 'w2' || /^test\b/i.test(m.name || '')) return null
  const cal = await import('../routes/calendar.js')
  const { paidHolidaysForYear } = await import('./hr.js')
  const today = todayPT()
  let s = await readSchedule(req, m.id)
  const changed = s && s.hire_date !== m.hire_date
  if (changed && !dryRun) {
    for (const it of s.items || []) if (it.event_uid && it.date > today && it.status === 'booked') { try { await cal.calDeleteEvent(it.event_uid, it.etag) } catch (e) { console.log('[reviews] cancel failed', m.name, e.message) } }
  }
  if (!s || changed) s = { hire_date: m.hire_date, items: [] }
  const first = String(m.preferred_name || m.name || '').split(' ')[0]
  const out = []
  for (const p of PLAN) {
    if (s.items.some(x => x.key === p.key)) continue
    const target = targetDate(m.hire_date, p)
    const hy = new Set([...paidHolidaysForYear(+target.slice(0, 4)), ...paidHolidaysForYear(+target.slice(0, 4) + 1)].map(h => h.date || h))
    if (target <= today) { s.items.push({ key: p.key, label: p.label, date: target, slot: p.slot, status: 'past' }); continue }
    const date = await pickDay(target, p.slot, hy, d => cal.calDayBusy(d))
    const sl = SLOTS[p.slot]
    const item = { key: p.key, label: p.label, date, slot: p.slot, start: sl.start, end: sl.end, status: 'planned' }
    if (!dryRun) {
      try {
        const ev = await cal.calCreateEvent({
          title: `${sl.emoji} ${first} · ${p.label}`, date, startTime: sl.start, endTime: sl.end,
          description: `${sl.name} with ${m.name}: ${p.label}. How's it going, what's working, what's hard, what's next. Set automatically by the Absolute ADAS app; move it in the calendar if the day doesn't work.`,
          attendees: m.email ? [m.email] : [],
        })
        Object.assign(item, { status: 'booked', event_uid: ev.uid, etag: ev.etag, booked_at: new Date().toISOString() })
      } catch (e) { item.status = 'failed'; item.error = String(e.response?.data?.error?.[0]?.message || e.message).slice(0, 200) }
    }
    s.items.push(item); out.push(item)
  }
  if (!dryRun) await writeSchedule(req, m.id, s)
  return { schedule: s, new: out }
}

// Hourly piggyback: everyone. Tells Mark (private alerts chat) what got booked.
export async function maybeScheduleReviews(req) {
  const { readTeamMembers } = await import('../routes/team.js')
  const booked = []
  const today = todayPT()
  for (const m of await readTeamMembers(req)) {
    // Left the company (or moved off W-2): cancel any future check-ins still on the calendar.
    if (m.active === false || m.employment !== 'w2') {
      const s = await readSchedule(req, m.id).catch(() => null)
      const live = (s?.items || []).filter(it => it.status === 'booked' && it.date > today)
      if (live.length) {
        const cal = await import('../routes/calendar.js')
        for (const it of live) { try { await cal.calDeleteEvent(it.event_uid, it.etag); it.status = 'cancelled'; it.cancelled_at = new Date().toISOString(); booked.push(`• ${m.name}: ${it.label} on ${it.date} cancelled (no longer an active W-2)`) } catch (e) { console.log('[reviews] cancel', m.name, e.message) } }
        await writeSchedule(req, m.id, s)
      }
      continue
    }
    if (!m.hire_date) continue
    try {
      const r = await ensureSchedule(req, m)
      for (const it of r?.new || []) booked.push(`• ${m.name}: ${SLOTS[it.slot].emoji} ${it.label} ${it.status === 'booked' ? `booked ${it.date} ${it.start}` : `could not book (${it.error || it.status})`}`)
    } catch (e) { console.log('[reviews]', m.name, e.message) }
  }
  if (booked.length) {
    try { const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('./cliq.js'); await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `⭐ *Check-ins on your calendar*\n${booked.join('\n')}`) } catch { /* fine */ }
  }
  return { booked: booked.length }
}
