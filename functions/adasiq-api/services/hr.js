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
  const { getRequestsDurable } = await import('../routes/pto.js')
  const [entries, requests] = await Promise.all([
    readEntriesPublic(req),
    getRequestsDurable(req).catch(() => []),
  ])

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
  for (const key of keys) {
    const workedHours = (workedMin[key] || 0) / 60
    const accrued = workedHours / 40
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
