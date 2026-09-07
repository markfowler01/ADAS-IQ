// Sales against goal, five periods, bar style.
//
// This used to measure days elapsed. Days are not the thing being tracked —
// dollars are. So the bar fill is money booked against the goal for that
// period, and the clock rides along as a tick mark on the same bar. One bar
// answers both questions: how much of the number is in, and whether that is
// ahead of where the calendar says it should be.
//
// Everything is in WORKING days. Mark does not invoice on a Sunday, so a
// calendar-day clock would show him permanently behind for no reason.
import { workingDaysOf, targetsFor, bucketsFor } from './paceModel.js'
import { sumRange } from './salesRollup.js'

function pct(a, b) { return b > 0 ? Math.max(0, Math.min(1, a / b)) : 0 }

function monthGoalDays(year, mIdx, monthlyGoal, ratio) {
  const t = targetsFor(year, mIdx, monthlyGoal, ratio)
  const push = new Set(t.buckets.push)
  const out = {}
  for (const d of t.buckets.all) out[d] = push.has(d) ? t.pushTarget : t.steadyTarget
  return out
}

/**
 * Per-day goal for the whole year, push/steady aware. Summing a slice of this
 * gives the goal for any window — which is what makes a week or a quarter bar
 * meaningful rather than a monthly number divided by four.
 */
function yearGoalDays(year, monthlyGoal, ratio) {
  let out = {}
  for (let m = 0; m < 12; m++) out = { ...out, ...monthGoalDays(year, m, monthlyGoal, ratio) }
  return out
}

function sumGoal(goalDays, startISO, endISO) {
  let t = 0
  for (const [d, v] of Object.entries(goalDays)) if (d >= startISO && d <= endISO) t += v
  return Math.round(t)
}

function weekBounds(todayISO) {
  const d = new Date(todayISO + 'T12:00:00Z')
  const dow = d.getUTCDay()               // 0 Sun
  const back = dow === 0 ? 6 : dow - 1     // weeks start Monday
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - back)
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
  return [mon.toISOString().slice(0, 10), sun.toISOString().slice(0, 10)]
}

function band(booked, goal, workDays, todayISO) {
  const elapsed = workDays.filter(x => x <= todayISO).length
  return {
    booked, goal,
    left: Math.max(0, goal - booked),
    goalPct: pct(booked, goal),
    timePct: pct(elapsed, workDays.length),
    daysLeft: Math.max(0, workDays.length - elapsed),
    days: workDays.length,
    // A period that hasn't started has no clock to be ahead of.
    started: elapsed > 0,
  }
}

export function buildProgress({ today, byDay, monthlyGoal, ratio }) {
  const [y, m] = today.split('-').map(Number)
  const mIdx = m - 1
  const goalDays = yearGoalDays(y, monthlyGoal, ratio)

  const monthDays = workingDaysOf(y, mIdx)
  const mStart = `${y}-${String(m).padStart(2, '0')}-01`
  const mEnd = monthDays[monthDays.length - 1]

  const [wStart, wEnd] = weekBounds(today)
  const weekDays = monthDaysAcross(y, wStart, wEnd)

  const qNo = Math.floor(mIdx / 3) + 1
  const qStartIdx = Math.floor(mIdx / 3) * 3
  let qDays = []
  for (let i = 0; i < 3; i++) qDays = qDays.concat(workingDaysOf(y, qStartIdx + i))
  const qStart = qDays[0], qEnd = qDays[qDays.length - 1]

  let yDays = []
  for (let i = 0; i < 12; i++) yDays = yDays.concat(workingDaysOf(y, i))

  // Today is its own bar: one day's target, push or steady.
  const todayGoal = goalDays[today] || 0
  const todayBooked = sumRange(byDay, today, today)

  return {
    day: {
      label: 'Day', booked: todayBooked, goal: todayGoal,
      left: Math.max(0, todayGoal - todayBooked),
      goalPct: pct(todayBooked, todayGoal),
      timePct: null,                       // a single day has no clock
      isWorkDay: todayGoal > 0,
      push: bucketsFor(y, mIdx).push.includes(today),
    },
    week:    { label: 'Week', ...band(sumRange(byDay, wStart, wEnd), sumGoal(goalDays, wStart, wEnd), weekDays, today) },
    month:   { label: 'Month', ...band(sumRange(byDay, mStart, mEnd), monthlyGoal, monthDays, today) },
    quarter: { label: `Q${qNo}`, ...band(sumRange(byDay, qStart, qEnd), sumGoal(goalDays, qStart, qEnd), qDays, today) },
    year:    { label: String(y), ...band(sumRange(byDay, `${y}-01-01`, `${y}-12-31`), sumGoal(goalDays, `${y}-01-01`, `${y}-12-31`), yDays, today) },
  }
}

// Working days inside an arbitrary window, which a week can straddle a month
// boundary and need.
function monthDaysAcross(year, startISO, endISO) {
  const out = []
  for (let m = 0; m < 12; m++) for (const d of workingDaysOf(year, m)) if (d >= startISO && d <= endISO) out.push(d)
  return out
}

// Inside this band the money and the clock are level and neither word applies.
// Without it the strip called 18.18% against 18.13% "behind" — a verdict on
// five hundredths of a percent, which flips daily on rounding alone.
const EVEN_BAND = 0.02

export function standing(b) {
  if (!b || b.timePct == null || !b.started) return null
  const d = b.goalPct - b.timePct
  if (Math.abs(d) <= EVEN_BAND) return { word: 'even with', delta: d, even: true }
  return { word: d > 0 ? 'ahead of' : 'behind', delta: d, even: false }
}

const money = n => n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : `$${Math.round(n)}`

/** Text/SMS/Cliq version — the same bars, drawn in characters. */
export function formatProgress(p) {
  if (!p) return ''
  const bar = f => { const n = Math.round(Math.max(0, Math.min(1, f)) * 20); return '█'.repeat(n) + '·'.repeat(20 - n) }
  const L = ['', 'Sales against goal']
  const row = (b) => {
    if (!b.goal) return null
    const st = standing(b)
    return `${b.label.padEnd(6)} ${bar(b.goalPct)} ${String(Math.round(b.goalPct * 100)).padStart(3)}%  ` +
           `${money(b.booked)} of ${money(b.goal)}` + (st && !st.even ? `, ${st.word} pace` : st ? ', even' : '')
  }
  if (p.day.isWorkDay) L.push(row(p.day))
  for (const k of ['week', 'month', 'quarter', 'year']) { const r = row(p[k]); if (r) L.push(r) }
  const m = standing(p.month)
  if (m) L.push(`Month is ${m.word} the clock. ${money(p.month.left)} left over ${p.month.daysLeft} working days.`)
  return L.join('\n')
}

export { money as moneyShort }
