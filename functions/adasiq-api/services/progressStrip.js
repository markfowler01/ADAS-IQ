// Time-elapsed vs goal-attained, side by side.
//
// A bar showing "the month is 20% gone" is decoration on its own. Paired with
// "you have booked 18% of the number" it answers the only question the strip is
// for: am I ahead of the clock or behind it. The gap between the two bars is
// the whole signal.
//
// Month is measured in WORKING days, not calendar days — Mark does not invoice
// on a Sunday and a calendar-day bar would show him permanently behind.
import { workingDaysOf } from './paceModel.js'

function pct(a, b) { return b > 0 ? Math.max(0, Math.min(1, a / b)) : 0 }

export function buildProgress({ today, booked, goal }) {
  const [y, m, d] = today.split('-').map(Number)
  const mIdx = m - 1

  const monthDays = workingDaysOf(y, mIdx)
  const monthElapsed = monthDays.filter(x => x <= today).length

  // Quarter, in working days too.
  const qStart = Math.floor(mIdx / 3) * 3
  let qDays = []
  for (let i = 0; i < 3; i++) qDays = qDays.concat(workingDaysOf(y, qStart + i))
  const qElapsed = qDays.filter(x => x <= today).length

  let yDays = []
  for (let i = 0; i < 12; i++) yDays = yDays.concat(workingDaysOf(y, i))
  const yElapsed = yDays.filter(x => x <= today).length

  const quarterNo = Math.floor(mIdx / 3) + 1

  return {
    month: {
      elapsed: monthElapsed, total: monthDays.length,
      left: monthDays.length - monthElapsed,
      timePct: pct(monthElapsed, monthDays.length),
      goalPct: pct(booked, goal),
      booked, goal,
    },
    quarter: {
      label: `Q${quarterNo}`,
      elapsed: qElapsed, total: qDays.length,
      left: qDays.length - qElapsed,
      timePct: pct(qElapsed, qDays.length),
    },
    year: {
      elapsed: yElapsed, total: yDays.length,
      left: yDays.length - yElapsed,
      timePct: pct(yElapsed, yDays.length),
    },
  }
}

// Inside this band the two bars are level and neither word applies. Without it
// the strip called 18.18% elapsed against 18.13% booked "behind the clock" —
// a verdict on five hundredths of a percent, which would flip daily on
// rounding alone.
const EVEN_BAND = 0.02

export function clockStanding(month) {
  const d = month.goalPct - month.timePct
  if (Math.abs(d) <= EVEN_BAND) return { word: 'even with', delta: d, even: true }
  return { word: d > 0 ? 'ahead of' : 'behind', delta: d, even: false }
}

/** Text form — one line, no bars. */
export function formatProgress(p) {
  if (!p) return ''
  const r = x => Math.round(x * 100)
  const st = clockStanding(p.month)
  return [
    '',
    `Month ${r(p.month.timePct)}% elapsed, ${r(p.month.goalPct)}% of goal booked ` +
      `— ${st.word} the clock. ${p.month.left} workdays left.`,
    `${p.quarter.label}: ${p.quarter.left} workdays left. Year: ${p.year.left}.`,
  ].join('\n')
}
