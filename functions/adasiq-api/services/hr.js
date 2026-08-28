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

// ── Canonical identity ──────────────────────────────────────────────────
// The auth layer hands different sessions different ids: real app logins
// fall back to display names ('Jayden', 'Kath Belmonte') while HR jobs
// use emails. Left alone, that split DOUBLE-PAYS (auto-punch can't see a
// name-keyed real shift) and hides acknowledgments. Everything funnels
// through here: user_id = email, user_name = the roster spelling.
const IDENTITY_ALIASES = {
  'mark@absoluteadas.com':      ['mark@absoluteadas.com', 'Mark Fowler'],
  'mark fowler':                ['mark@absoluteadas.com', 'Mark Fowler'],
  'mark':                       ['mark@absoluteadas.com', 'Mark Fowler'],
  'jayden@absoluteadas.com':    ['jayden@absoluteadas.com', 'Jayden Goshorn'],
  'jayden goshorn':             ['jayden@absoluteadas.com', 'Jayden Goshorn'],
  'jayden':                     ['jayden@absoluteadas.com', 'Jayden Goshorn'],
  'k.belmonte@absoluteadas.com': ['k.belmonte@absoluteadas.com', 'Kat Belmonte'],
  'kath belmonte':              ['k.belmonte@absoluteadas.com', 'Kat Belmonte'],
  'kat belmonte':               ['k.belmonte@absoluteadas.com', 'Kat Belmonte'],
  'kath':                       ['k.belmonte@absoluteadas.com', 'Kat Belmonte'],
  'kat':                        ['k.belmonte@absoluteadas.com', 'Kat Belmonte'],
}
export function canonicalIdentity(rawId, rawName) {
  for (const raw of [rawId, rawName]) {
    const k = String(raw || '').trim().toLowerCase()
    if (IDENTITY_ALIASES[k]) return IDENTITY_ALIASES[k]
  }
  return [rawId || rawName || 'unknown', rawName || rawId || 'Unknown']
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
    const [, canonName] = canonicalIdentity(uid, '')
    const key = firstName(canonName).toLowerCase() || String(uid).split('@')[0].split('.')[0].toLowerCase()
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
function ptDateOf(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}
function ptHourNow() {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false,
  }).format(new Date()))
}
function mondayOf(dateISO) {
  const d = new Date(dateISO + 'T12:00:00Z')
  const dow = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  return d.toISOString().slice(0, 10)
}
export function addDaysISO(dateISO, n) {
  const d = new Date(dateISO + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const r2 = n => Math.round(n * 100) / 100

// WA overtime: minutes past 40h in a Mon-Sun workweek are OT, attributed
// to the DAY they were worked. Weeks straddling a pay-period boundary use
// the FULL week's minutes, so a Friday that crosses 40h is OT even when
// the period started Wednesday.
function weeklyOvertimeByDay(dayMin) {
  const byWeek = {}
  for (const d of Object.keys(dayMin)) (byWeek[mondayOf(d)] = byWeek[mondayOf(d)] || []).push(d)
  const ot = {}
  for (const days of Object.values(byWeek)) {
    days.sort()
    let cum = 0
    for (const d of days) {
      const prevOver = Math.max(0, cum - 2400)
      cum += dayMin[d]
      ot[d] = Math.max(0, cum - 2400) - prevOver
    }
  }
  return ot
}

// ── Payroll period marker + lock ────────────────────────────────────────
// One AppConfig row records the last date a payroll report covered. It
// does double duty: the next report starts the day after (no hour ever
// double-paid or lost), and timeclock edits at or before it are frozen
// unless Mark overrides with an audit note.
async function getConfigRowByKey(app, key) {
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key}' LIMIT 1`
  ).catch(() => [])
  return rows?.[0]?.AppConfig || rows?.[0] || null
}
export async function getPayrollLockDate(req) {
  const app = catalyst.initialize(req)
  const r = await getConfigRowByKey(app, 'payroll_reported_through')
  return r?.config_value || ''
}
async function setPayrollLockDate(req, dateISO) {
  const app = catalyst.initialize(req)
  const table = app.datastore().table('AppConfig')
  const r = await getConfigRowByKey(app, 'payroll_reported_through')
  if (r?.ROWID) await table.updateRow({ ROWID: r.ROWID, config_value: dateISO })
  else await table.insertRow({ config_key: 'payroll_reported_through', config_value: dateISO })
}

export async function buildHoursReport(req, startISO, endISO) {
  const { readEntriesPublic } = await import('../routes/timeclock.js')
  const { getRequestsDurable } = await import('../routes/pto.js')
  const [entries, requests, balances] = await Promise.all([
    readEntriesPublic(req),
    getRequestsDurable(req).catch(() => []),
    computeSickBalances(req),
  ])

  const per = {}
  const bucket = key => (per[key] = per[key] || {
    name: key, worked_min: 0, entries: 0, day_min: {},
    sick_hours: 0, vacation_hours: 0, unpaid_hours: 0,
  })

  // day_min spans ALL history so weekly OT is right at period edges.
  // An entry is COUNTED (paid this period) when it's finished and either
  // falls in the window, or predates it but was never reported — a shift
  // that closed after its period's report went out (late night on report
  // day, outage) gets swept in as a late adjustment instead of vanishing.
  // The report marks counted entries reported:true, so nothing is ever
  // paid twice.
  const countedIds = []
  for (const e of entries) {
    if (!e.clock_in) continue
    const b = bucket(firstName(e.user_name || e.user_id))
    const d = ptDateOf(e.clock_in)
    const mins = entryWorkedMinutes(e)
    b.day_min[d] = (b.day_min[d] || 0) + mins
    const finished = !!e.clock_out
    const inWindow = d >= startISO && d <= endISO
    const lateAdj = finished && !e.reported && d < startISO
    if (finished && (inWindow || lateAdj)) {
      b.worked_min += mins
      b.entries += 1
      if (lateAdj) b.late_min = (b.late_min || 0) + mins
      b.counted_dates = b.counted_dates || new Set()
      b.counted_dates.add(d)
      countedIds.push(e.id)
    }
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
  const csvRows = [[
    'Name', 'Regular Hours', 'Overtime Hours (1.5x)', 'Sick Paid', 'Vacation Paid',
    'Holiday Pay', 'Unpaid (not paid)', 'Regular-Rate Total', 'Shifts',
  ]]
  lines.push(`ABSOLUTE ADAS — PAYROLL HOURS REPORT`)
  lines.push(`Period: ${startISO} through ${endISO}`)
  lines.push('')
  for (const b of Object.values(per).sort((a, z) => a.name.localeCompare(z.name))) {
    // Weekly OT computed HERE from the durable clock — not trusted from
    // whatever clock-out happened to store. WA: 1.5x past 40h/week.
    const otByDay = weeklyOvertimeByDay(b.day_min)
    let otMin = 0
    for (const [d, m] of Object.entries(otByDay)) if (b.counted_dates?.has(d)) otMin += m
    const worked = r2(b.worked_min / 60)
    const ot = r2(otMin / 60)
    const regular = r2(worked - ot)
    const bal = balances[b.name.toLowerCase()]
    // Regular-rate payable = regular worked + paid sick + paid vacation +
    // holiday pay. OT listed separately at 1.5x. Unpaid leave shown for
    // context, never added. Holiday hours never count toward OT (policy).
    const payable = r2(regular + b.sick_hours + b.vacation_hours + holidayHours)
    lines.push(`${b.name}`)
    lines.push(`  Regular:         ${regular}h across ${b.entries} shifts`)
    if (b.late_min) lines.push(`  (includes ${r2(b.late_min / 60)}h finished after the last report — late adjustment)`)
    if (ot) lines.push(`  Overtime:        ${ot}h — pay at 1.5x (past 40h/week)`)
    lines.push(`  Sick paid:       ${b.sick_hours}h`)
    lines.push(`  Vacation paid:   ${b.vacation_hours}h`)
    lines.push(`  Holiday pay:     ${holidayHours}h${holidays.length ? ` (${holidays.map(h => h.name).join(', ')})` : ''}`)
    if (b.unpaid_hours) lines.push(`  Unpaid time off: ${b.unpaid_hours}h — NOT paid`)
    lines.push(`  >> PAY THIS PERIOD: ${payable}h at regular rate${ot ? ` + ${ot}h at 1.5x` : ''}`)
    if (bal) lines.push(`  (sick balance after: ${bal.sick_balance_hours}h)`)
    lines.push('')
    csvRows.push([
      b.name, regular, ot, b.sick_hours, b.vacation_hours,
      holidayHours, b.unpaid_hours, payable, b.entries,
    ])
  }
  if (holidays.length) {
    lines.push(`Paid holidays in period: ${holidays.map(h => `${h.name} ${h.date}`).join(' · ')}`)
    lines.push('')
  }
  lines.push(`Generated ${new Date().toISOString()} · source: ADAS IQ time clock (durable)`)
  const csv = csvRows.map(r => r.map(v => /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\n')
  return { text: lines.join('\n'), csv, employees: Object.keys(per).length, holidays: holidays.length, balances, counted_entry_ids: countedIds }
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
  if (hourNow < 18 || hourNow > 21) return { fired: false, reason: `outside 6-9pm window (hour=${hourNow})` }

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

// Fires on the 14th and the second-to-last day of each month (PT),
// on the first hourly run at/after 7pm — AFTER the 6pm auto-punch and
// auto-close sweeps, so the day's hours are complete when counted.
// Period = everything since the last report's marker (the month-end
// report used to restart at the 1st and double-count the first half —
// fixed 2026-08-27). Sending the report LOCKS the period.
export async function maybeFireHoursReport(req) {
  const today = todayPT()
  const [y, m, d] = today.split('-').map(Number)
  const secondToLast = daysInMonth(y, m) - 1
  // Due-WINDOW, not due-day: if the report day itself is missed (outage),
  // the report still goes out the next evening instead of never.
  const half = d >= secondToLast ? 'end' : d >= 14 ? 'mid' : null
  if (!half) return { fired: false, reason: `not due (mid from the 14th, end from the ${secondToLast}th)` }
  if (ptHourNow() < 19) return { fired: false, reason: 'waiting for the 7pm PT run' }
  const isMid = half === 'mid'

  const app = catalyst.initialize(req)
  const stampKey = `hours_report_sent:${today.slice(0, 7)}:${half}`
  const r0 = await getConfigRowByKey(app, stampKey)
  if (r0?.config_value) return { fired: false, reason: `${half} report already sent this month` }

  const lock = await getPayrollLockDate(req).catch(() => '')
  let start = `${today.slice(0, 8)}01`
  if (lock && lock < today) start = addDaysISO(lock, 1)
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
        attachments: [{
          filename: `hours-${start}-to-${end}.csv`,
          content: Buffer.from(report.csv, 'utf8').toString('base64'),
        }],
      })
      emailed = true

      // WA per-pay-period sick-leave notice — one email per employee so
      // compliance (RCW 49.46: notify each pay period) is automatic and
      // provable, not dependent on anyone opening the app.
      for (const p of AUTO_PUNCH_ROSTER) {
        const key = firstName(p.user_name).toLowerCase()
        const b = report.balances?.[key]
        if (!b) continue
        await sendBroadcast({
          recipients: [p.user_id],
          subject: 'Your sick leave balance — Absolute ADAS',
          text: [
            `Hi ${firstName(p.user_name)},`,
            '',
            'Your paid sick leave (Washington State):',
            `  Earned so far:  ${b.sick_accrued_hours}h`,
            `  Used:           ${b.sick_used_hours}h`,
            `  Balance:        ${b.sick_balance_hours}h`,
            '',
            'You earn 1 hour for every 40 hours you work.',
            'See the Time Off page in ADAS IQ anytime.',
            '',
            'GET SOME!!!',
            '— Absolute ADAS',
          ].join('\n'),
        }).catch(e => console.warn('[hours-report] balance notice failed:', p.user_id, e.message))
      }
    }
  } catch (e) { console.warn('[hours-report] email failed:', e.message) }

  // Cliq copy either way — belt and suspenders
  let cliqd = false
  try {
    const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('./cliq.js')
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
      `🕒 *Hours report (${isMid ? 'mid-month' : 'month-end'})*${emailed ? ' — emailed to mark@ with CSV for Joyce' : ' — ⚠️ email failed, full copy here'}\n` +
      `Period ${start} → ${end} is now LOCKED — time clock edits to it need your unlock.\n\n` +
      '```\n' + report.text.slice(0, 3000) + '\n```')
    cliqd = true
  } catch (e) { console.warn('[hours-report] cliq failed:', e.message) }

  // NO delivery → NO lock, NO stamp, NO reported flags. The whole thing
  // retries on the next hourly run instead of silently losing a payroll.
  if (!emailed && !cliqd) {
    return { fired: false, reason: 'delivery failed (email AND cliq) — will retry next hour' }
  }

  // Mark every counted entry reported:true (fresh read — entries may have
  // changed since the report was built; flag by id only).
  try {
    if (report.counted_entry_ids?.length) {
      const { readEntriesPublic, writeEntriesPublic } = await import('../routes/timeclock.js')
      const all = await readEntriesPublic(req)
      const ids = new Set(report.counted_entry_ids)
      const now = new Date().toISOString()
      let n = 0
      for (const e of all) if (ids.has(e.id) && !e.reported) { e.reported = true; e.reported_at = now; n++ }
      if (n) await writeEntriesPublic(req, all)
    }
  } catch (e) { console.warn('[hours-report] reported-flag write failed:', e.message) }

  await setPayrollLockDate(req, end).catch(e => console.warn('[hours-report] lock failed:', e.message))
  const table = app.datastore().table('AppConfig')
  await table.insertRow({ config_key: stampKey, config_value: new Date().toISOString() }).catch(() => {})
  return { fired: true, emailed, cliqd, period: { start, end }, employees: report.employees, holidays: report.holidays, counted: report.counted_entry_ids?.length || 0 }
}

// ── Forgot-to-clock-OUT (Mark 2026-08-27 "get this all fixed") ──────────
// Mirror of auto-punch. 5pm PT: push nudge to every subscribed device
// naming whoever's still on the clock. 6pm PT: any shift still open
// (started before 4pm, or left over from a past day) is closed at 5:00
// PT of its own day, Cliq-flagged, and acknowledged next morning right
// alongside auto-punches. An open shift never inflates payroll silently.
export async function maybeAutoClose(req) {
  const today = todayPT()
  const hourNow = ptHourNow()
  if (hourNow !== 17 && (hourNow < 18 || hourNow > 21)) return { fired: false, reason: `outside 5-9pm window (hour=${hourNow})` }

  const app = catalyst.initialize(req)
  const stampKey = (hourNow === 17 ? 'clockout_nudge:' : 'auto_close_done:') + today
  const r0 = await getConfigRowByKey(app, stampKey)
  if (r0?.config_value) return { fired: false, reason: 'already ran today' }

  const { readEntriesPublic, writeEntriesPublic } = await import('../routes/timeclock.js')
  const entries = await readEntriesPublic(req)
  const open = entries.filter(e => e.clock_in && !e.clock_out)
  const stamp = () => app.datastore().table('AppConfig')
    .insertRow({ config_key: stampKey, config_value: new Date().toISOString() }).catch(() => {})

  if (hourNow === 17) {
    if (open.length) {
      try {
        const { sendPushToAll } = await import('../routes/push.js')
        const names = open.map(e => firstName(e.user_name || e.user_id)).join(', ')
        await sendPushToAll(req, {
          title: '⏱ Still on the clock?',
          body: `${names} — done for the day? Clock out now. Open shifts auto-close at 5:00 when 6pm hits.`,
          url: '/app/index.html',
          tag: 'clockout-nudge',
        })
      } catch (e) { console.warn('[auto-close] nudge push failed:', e.message) }
    }
    await stamp()
    return { fired: true, nudged: open.length }
  }

  const closed = []
  for (const e of open) {
    const inDate = ptDateOf(e.clock_in)
    const inHour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false,
    }).format(new Date(e.clock_in)))
    // Evening shifts (started 4pm or later today) are real work — skip.
    if (inDate === today && inHour >= 16) continue
    let closeAt = ptInstant(inDate, 17)
    if (new Date(closeAt) <= new Date(e.clock_in)) {
      closeAt = new Date(new Date(e.clock_in).getTime() + 4 * 3600e3).toISOString()
    }
    for (const b of e.breaks || []) {
      if (b?.start && !b?.end) b.end = new Date(b.start) < new Date(closeAt) ? closeAt : b.start
    }
    e.clock_out = closeAt
    e.clock_out_location = null
    let ms = new Date(e.clock_out) - new Date(e.clock_in)
    for (const b of e.breaks || []) if (b?.start && b?.end) ms -= (new Date(b.end) - new Date(b.start))
    e.total_minutes = Math.max(0, Math.round(ms / 60000))
    e.auto_closed = true
    e.acknowledged = false
    e.notes = [e.notes, 'Auto-closed — no clock-out recorded (closed at 5:00 PT)'].filter(Boolean).join(' · ')
    closed.push(`• ${firstName(e.user_name || e.user_id)} — ${inDate}, clocked out at 5:00 PT (${Math.round(e.total_minutes / 6) / 10}h)`)
  }

  if (closed.length) {
    await writeEntriesPublic(req, entries)
    try {
      const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('./cliq.js')
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, [
        `⏱ *Auto-closed (forgot to clock out)* — ${today}`,
        ...closed,
        '',
        'If a shift really ran later, fix it on the Time Clock page before payroll.',
      ].join('\n'))
    } catch { /* non-fatal */ }
  }
  await stamp()
  return { fired: true, auto_closed: closed.length }
}

// ── GPS sanity flag (quiet honesty-keeper) ──────────────────────────────
// Needs SHOP_LAT / SHOP_LNG set on the Phone Setup page. If a clock-in
// with GPS lands farther than SERVICE_RADIUS_MI (default 60) from the
// shop, Mark gets a quiet Cliq note. Never blocks the punch.
export async function flagRemoteClockIn(req, entry) {
  const loc = entry?.clock_in_location
  if (!loc || !Number(loc.lat) || !Number(loc.lng)) return
  const { resolvePhoneConfig } = await import('./phoneConfig.js')
  const cfg = await resolvePhoneConfig(req)
  const slat = Number(cfg.SHOP_LAT), slng = Number(cfg.SHOP_LNG)
  if (!slat || !slng) return
  const radius = Number(cfg.SERVICE_RADIUS_MI) || 60
  const toRad = x => x * Math.PI / 180
  const dLat = toRad(Number(loc.lat) - slat), dLng = toRad(Number(loc.lng) - slng)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(slat)) * Math.cos(toRad(Number(loc.lat))) * Math.sin(dLng / 2) ** 2
  const miles = 3959 * 2 * Math.asin(Math.sqrt(a))
  if (miles <= radius) return
  const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('./cliq.js')
  await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
    `📍 *Clock-in location check* — ${entry.user_name || entry.user_id} punched in about ${Math.round(miles)} miles from the shop (flag radius ${radius} mi).`)
}
