// HR engine (Mark 2026-08-15 "go", built to his Zoho People SOP).
//
// - WA Paid Sick Leave: 1 hour accrued per 40 hours actually worked
//   (including overtime), computed LIVE from the durable timeclock —
//   there is no stored counter to drift out of sync. Balance = accrued
//   minus approved sick hours. May go negative to -40 (advance), never
//   further; every negative balance is flagged to Mark in Cliq.
// - Paid holidays: the 5 from the handbook, on their true dates, 8h at
//   regular rate for full-time (pay itself happens in Zoho Payroll —
//   the hours report lines them up for Joyce).
// - Hours report: emailed to Mark twice a month — the 14th and the
//   SECOND-TO-LAST day of the month (the exact schedule Zoho's fixed-day
//   scheduler couldn't do). Rides the hourly postscan piggyback.

import catalyst from 'zcatalyst-sdk-node'

// ── The 5 paid holidays (handbook list — NOT the social-post list) ──────
function nthWeekdayOfMonth(year, month, weekday, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const lastDay = new Date(Date.UTC(year, month + 1, 0))
  const back = (lastDay.getUTCDay() - weekday + 7) % 7
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay.getUTCDate() - back).padStart(2, '0')}`
}

export function paidHolidaysForYear(year) {
  return [
    { name: "New Year's Day",   date: `${year}-01-01` },
    { name: 'Memorial Day',     date: nthWeekdayOfMonth(year, 4, 1, -1) },
    { name: 'Independence Day', date: `${year}-07-04` },
    { name: 'Labor Day',        date: nthWeekdayOfMonth(year, 8, 1, 1) },
    { name: 'Christmas Day',    date: `${year}-12-25` },
  ]
}

// ── Worked minutes per entry — trust computed totals, verify raw ────────
export function entryWorkedMinutes(e) {
  if (Number(e?.total_minutes) > 0) return Number(e.total_minutes)
  if (!e?.clock_in || !e?.clock_out) return 0
  let ms = new Date(e.clock_out) - new Date(e.clock_in)
  for (const b of e.breaks || []) {
    if (b?.start && b?.end) ms -= (new Date(b.end) - new Date(b.start))
  }
  return Math.max(0, Math.round(ms / 60000))
}

function firstName(s) {
  return String(s || '').trim().split(/\s+/)[0]
}

// ── WA sick-leave balances, live-computed ───────────────────────────────
// accrued = total worked hours / 40 (per WA RCW 49.46.210, incl. OT)
// used    = sum of APPROVED sick requests (hours)
export async function computeSickBalances(req) {
  const { readEntriesPublic } = await import('../routes/timeclock.js')
  const { getRequestsDurable, getBalancesDurable } = await import('../routes/pto.js')
  const [entries, requests, stored] = await Promise.all([
    readEntriesPublic(req),
    getRequestsDurable(req).catch(() => []),
    getBalancesDurable(req).catch(() => ({})),
  ])

  // Opening credits: sick hours earned BEFORE the timeclock existed
  // (e.g. Jayden hired 2025-05-11, credited 2026-08-28). Keyed by the
  // balance row's user_id (email) → first name.
  const openingCredit = {}
  for (const [uid, b] of Object.entries(stored || {})) {
    const credit = Number(b?.sick_opening_credit || 0)
    if (!credit) continue
    const key = String(uid).split('@')[0].split('.')[0].toLowerCase()
    openingCredit[key] = (openingCredit[key] || 0) + credit
  }

  const workedMin = {}   // keyed by lowercase first name
  const nameById = {}
  for (const e of entries) {
    const key = firstName(e.user_name || e.user_id).toLowerCase()
    if (!key) continue
    workedMin[key] = (workedMin[key] || 0) + entryWorkedMinutes(e)
    nameById[key] = firstName(e.user_name || e.user_id)
  }

  const usedHours = {}
  for (const r of requests) {
    if (String(r.status) !== 'approved') continue
    if (String(r.type) !== 'sick') continue
    const key = firstName(r.user_name || r.user_id).toLowerCase()
    usedHours[key] = (usedHours[key] || 0) + Number(r.hours_requested || 0)
  }

  const out = {}
  const keys = new Set([...Object.keys(workedMin), ...Object.keys(usedHours)])
  for (const k of Object.keys(openingCredit)) keys.add(k)
  for (const key of keys) {
    const workedHours = (workedMin[key] || 0) / 60
    const accrued = workedHours / 40 + (openingCredit[key] || 0)
    const used = usedHours[key] || 0
    out[key] = {
      name: nameById[key] || key,
      worked_hours: Math.round(workedHours * 100) / 100,
      sick_accrued_hours: Math.round(accrued * 100) / 100,
      sick_used_hours: Math.round(used * 100) / 100,
      sick_balance_hours: Math.round((accrued - used) * 100) / 100,
    }
  }
  return out
}

export const SICK_NEGATIVE_FLOOR = -40

// ── Twice-monthly hours report ──────────────────────────────────────────
function todayPT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
function daysInMonth(year, month1) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

export async function buildHoursReport(req, startISO, endISO) {
  const { readEntriesPublic } = await import('../routes/timeclock.js')
  const { getRequestsDurable } = await import('../routes/pto.js')
  const [entries, requests, balances] = await Promise.all([
    readEntriesPublic(req),
    getRequestsDurable(req).catch(() => []),
    computeSickBalances(req),
  ])

  const inWindow = iso => {
    const d = String(iso || '').slice(0, 10)
    return d >= startISO && d <= endISO
  }

  const per = {}
  const bucket = key => (per[key] = per[key] || {
    name: key, worked_min: 0, ot_min: 0, entries: 0,
    sick_hours: 0, vacation_hours: 0, unpaid_hours: 0,
  })

  for (const e of entries) {
    if (!inWindow(e.clock_in)) continue
    const b = bucket(firstName(e.user_name || e.user_id))
    b.worked_min += entryWorkedMinutes(e)
    b.ot_min += Number(e.overtime_minutes || 0)
    b.entries += 1
  }
  for (const r of requests) {
    if (String(r.status) !== 'approved') continue
    if (!(String(r.start_date) <= endISO && String(r.end_date) >= startISO)) continue
    const b = bucket(firstName(r.user_name || r.user_id))
    const hrs = Number(r.hours_requested || 0)
    if (r.type === 'sick') b.sick_hours += hrs
    else if (r.type === 'vacation' || r.type === 'personal') b.vacation_hours += hrs
    else if (r.type === 'unpaid') b.unpaid_hours += hrs
  }

  const year = Number(startISO.slice(0, 4))
  const holidays = [...paidHolidaysForYear(year), ...paidHolidaysForYear(year + 1)]
    .filter(h => h.date >= startISO && h.date <= endISO)

  const holidayHours = holidays.length * 8

  const lines = []
  lines.push(`ABSOLUTE ADAS — PAYROLL HOURS REPORT`)
  lines.push(`Period: ${startISO} through ${endISO}`)
  lines.push('')
  for (const b of Object.values(per).sort((a, z) => a.name.localeCompare(z.name))) {
    const hrs = Math.round((b.worked_min / 60) * 100) / 100
    const ot = Math.round((b.ot_min / 60) * 100) / 100
    const bal = balances[b.name.toLowerCase()]
    // PAYABLE = worked + paid sick + paid vacation/personal + holiday pay.
    // Unpaid leave shown for context, never added. Holiday hours are not
    // hours worked and never count toward OT (policy).
    const payable = Math.round((hrs + b.sick_hours + b.vacation_hours + holidayHours) * 100) / 100
    lines.push(`${b.name}`)
    lines.push(`  Worked:          ${hrs}h across ${b.entries} shifts${ot ? ` (incl. ${ot}h OT)` : ''}`)
    lines.push(`  Sick paid:       ${b.sick_hours}h`)
    lines.push(`  Vacation paid:   ${b.vacation_hours}h`)
    lines.push(`  Holiday pay:     ${holidayHours}h${holidays.length ? ` (${holidays.map(h => h.name).join(', ')})` : ''}`)
    if (b.unpaid_hours) lines.push(`  Unpaid time off: ${b.unpaid_hours}h — NOT paid`)
    lines.push(`  >> PAY THIS PERIOD: ${payable}h`)
    if (bal) lines.push(`  (sick balance after: ${bal.sick_balance_hours}h)`)
    lines.push('')
  }
  if (holidays.length) {
    lines.push(`Paid holidays in period: ${holidays.map(h => `${h.name} ${h.date}`).join(' · ')}`)
    lines.push('')
  }
  lines.push(`Generated ${new Date().toISOString()} · source: ADAS IQ time clock (durable)`)
  return { text: lines.join('\n'), employees: Object.keys(per).length, holidays: holidays.length }
}

// ── Auto-punch for forgotten days (Mark 2026-08-27) ─────────────────────
// If an employee has ZERO punches on a weekday, create the standard day:
// in 8:00, out 12:00 (lunch), in 13:00, out 17:00 PT — 8.0h. Skipped
// when: weekend, paid holiday, ANY entry exists that day (partial days
// are theirs to fix), or approved time off covers the day. Every
// auto-punch is Cliq-flagged to Mark for review. Runs in the 6pm PT
// hour via the postscan piggyback, once per day.
const AUTO_PUNCH_ROSTER = [
  // user_id must match what the timeclock stores (email) so /current and
  // timesheets line up. Update here when the team changes.
  { user_id: 'mark@absoluteadas.com',      user_name: 'Mark Fowler' },
  { user_id: 'jayden@absoluteadas.com',    user_name: 'Jayden Goshorn' },
  { user_id: 'k.belmonte@absoluteadas.com', user_name: 'Kat Belmonte' },
]

function ptInstant(dateISO, hour) {
  for (const off of ['-07:00', '-08:00']) {
    const d = new Date(`${dateISO}T${String(hour).padStart(2, '0')}:00:00${off}`)
    const back = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(d))
    if (back === hour) return d.toISOString()
  }
  return new Date(`${dateISO}T${String(hour).padStart(2, '0')}:00:00-07:00`).toISOString()
}

export async function maybeAutoPunch(req) {
  const today = todayPT()
  const dow = new Date(today + 'T12:00:00Z').getUTCDay()
  if (dow === 0 || dow === 6) return { fired: false, reason: 'weekend' }

  const hourNow = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false,
  }).format(new Date()))
  if (hourNow !== 18) return { fired: false, reason: `outside 6pm window (hour=${hourNow})` }

  const year = Number(today.slice(0, 4))
  if (paidHolidaysForYear(year).some(h => h.date === today)) {
    return { fired: false, reason: 'paid holiday' }
  }

  const app = catalyst.initialize(req)
  const stampKey = `auto_punch_done:${today}`
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT config_value FROM AppConfig WHERE config_key = '${stampKey}' LIMIT 1`
  ).catch(() => [])
  const r0 = rows?.[0]?.AppConfig || rows?.[0] || null
  if (r0?.config_value) return { fired: false, reason: 'already ran today' }

  const { readEntriesPublic } = await import('../routes/timeclock.js')
  const { getRequestsDurable } = await import('../routes/pto.js')
  const [entries, requests] = await Promise.all([
    readEntriesPublic(req),
    getRequestsDurable(req).catch(() => []),
  ])

  const punchedToday = new Set(
    entries.filter(e => String(e.clock_in || '').slice(0, 10) === today ||
      // compare in PT, not UTC — an evening punch crosses the UTC date line
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date(e.clock_in || 0)) === today)
      .map(e => String(e.user_id).toLowerCase())
  )
  const offToday = new Set(
    requests.filter(r => String(r.status) === 'approved' &&
      String(r.start_date) <= today && String(r.end_date) >= today)
      .map(r => String(r.user_id).toLowerCase())
  )

  const punched = []
  const newEntries = []
  const mkId = () => `tc_auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  for (const person of AUTO_PUNCH_ROSTER) {
    const key = person.user_id.toLowerCase()
    if (punchedToday.has(key) || offToday.has(key)) continue
    const base = {
      user_id: person.user_id, user_name: person.user_name,
      breaks: [], clock_in_location: null, clock_out_location: null,
      regular_minutes: 240, overtime_minutes: 0,
      notes: 'Auto-punched — no clock-in recorded this day (standard 8-12, 1-5)',
      job_ids: [], approved: false, approved_by: '', approved_at: '',
      auto_punched: true, acknowledged: false, acknowledged_at: '',
      created_at: new Date().toISOString(),
    }
    newEntries.push(
      { ...base, id: mkId(), clock_in: ptInstant(today, 8),  clock_out: ptInstant(today, 12), total_minutes: 240 },
      { ...base, id: mkId(), clock_in: ptInstant(today, 13), clock_out: ptInstant(today, 17), total_minutes: 240 },
    )
    punched.push(person.user_name)
  }

  if (newEntries.length > 0) {
    const { writeEntriesPublic } = await import('../routes/timeclock.js')
    await writeEntriesPublic(req, [...entries, ...newEntries])
    try {
      const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('./cliq.js')
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, [
        `⏱ *Auto-punched (forgot to clock in)* — ${today}`,
        ...punched.map(n => `• ${n} — 8:00-12:00 and 1:00-5:00 PT (8.0h)`),
        '',
        'If someone actually didn\'t work, fix it on the Time Clock page before payroll.',
      ].join('\n'))
    } catch { /* non-fatal */ }
  }

  await app.datastore().table('AppConfig')
    .insertRow({ config_key: stampKey, config_value: new Date().toISOString() }).catch(() => {})
  return { fired: true, auto_punched: punched }
}

// Fires on the 14th and the second-to-last day of each month (PT).
// Dedup stamp per date. Weekends included — payroll doesn't wait.
export async function maybeFireHoursReport(req) {
  const today = todayPT()
  const [y, m, d] = today.split('-').map(Number)
  const secondToLast = daysInMonth(y, m) - 1
  const isMid = d === 14
  const isEnd = d === secondToLast
  if (!isMid && !isEnd) return { fired: false, reason: `not a report day (14 or ${secondToLast})` }

  const app = catalyst.initialize(req)
  const stampKey = `hours_report_sent:${today}`
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT config_value FROM AppConfig WHERE config_key = '${stampKey}' LIMIT 1`
  ).catch(() => [])
  const r0 = rows?.[0]?.AppConfig || rows?.[0] || null
  if (r0?.config_value) return { fired: false, reason: 'already sent today' }

  const start = isMid ? `${today.slice(0, 8)}01` : `${today.slice(0, 8)}01`
  const end = today
  const report = await buildHoursReport(req, start, end)

  let emailed = false
  try {
    const { sendBroadcast, resendConfigured } = await import('./brewResend.js')
    if (resendConfigured()) {
      await sendBroadcast({
        recipients: ['mark@absoluteadas.com'],
        subject: `Hours report — ${start} to ${end} (${isMid ? 'mid-month' : 'month-end'})`,
        text: report.text,
        html: `<pre style="font-family:monospace;font-size:13px">${report.text.replace(/</g, '&lt;')}</pre>`,
      })
      emailed = true
    }
  } catch (e) { console.warn('[hours-report] email failed:', e.message) }

  // Cliq copy either way — belt and suspenders
  try {
    const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('./cliq.js')
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
      `🕒 *Hours report (${isMid ? 'mid-month' : 'month-end'})*${emailed ? ' — emailed to mark@' : ' — ⚠️ email failed, full copy here'}\n\n` +
      '```\n' + report.text.slice(0, 3000) + '\n```')
  } catch (e) { console.warn('[hours-report] cliq failed:', e.message) }

  const table = app.datastore().table('AppConfig')
  await table.insertRow({ config_key: stampKey, config_value: new Date().toISOString() }).catch(() => {})
  return { fired: true, emailed, ...report }
}
