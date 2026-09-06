// Push vs steady day accounting.
//
// The old brief printed one blended pace number — "projecting $54,254 against
// $50,000" — which averages two different targets and is therefore wrong on
// every day of the month. Push days and steady days carry different
// expectations and get evaluated independently. They are never combined into a
// single verdict.
//
//   Push days   = the first 4 and last 5 WORKING days of the month
//   Steady days = everything else
//
// The push ratio is derived from Mark's own invoice history rather than picked,
// so drift in it is real information. Clamped to 1.0-2.5; outside that the
// sample is too thin or too skewed to trust and the clamp is flagged.

// Push window is the LAST 7 working days, not the spec's original
// "first 4 + last 5". Derived from 633 invoices, Nov 2025 - Sep 2026:
//
//   first 4 + last 5 -> push $1,627 vs steady $1,391, ratio 1.17
//   last 7 only      -> push $1,939 vs steady $1,286, ratio 1.51
//
// The month-START is not a push for Mark. Including it diluted the bucket to
// the point where the two-bucket split stopped meaning anything. Week 4 alone
// is 29% of revenue against 19-22% for weeks 1-3.
const PUSH_HEAD = Number(process.env.PACE_PUSH_HEAD ?? 0)
const PUSH_TAIL = Number(process.env.PACE_PUSH_TAIL ?? 7)
export const RATIO_MIN = 1.0
export const RATIO_MAX = 2.5

/** Working days (Mon-Fri) of a month, as YYYY-MM-DD, in order. */
export function workingDaysOf(year, monthIdx) {
  const out = []
  const last = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate()
  for (let d = 1; d <= last; d++) {
    const dt = new Date(Date.UTC(year, monthIdx, d))
    const dow = dt.getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(dt.toISOString().slice(0, 10))
  }
  return out
}

/** Split a month's working days into push and steady buckets. */
export function bucketsFor(year, monthIdx) {
  const days = workingDaysOf(year, monthIdx)
  // A short month could overlap head and tail; dedupe so a day is never
  // counted in both buckets.
  const push = new Set([
    ...(PUSH_HEAD > 0 ? days.slice(0, PUSH_HEAD) : []),
    ...(PUSH_TAIL > 0 ? days.slice(-PUSH_TAIL) : []),
  ])
  return {
    all: days,
    push: days.filter(d => push.has(d)),
    steady: days.filter(d => !push.has(d)),
  }
}

/** Which bucket is a given date in? */
export function bucketOf(dateISO) {
  const [y, m] = dateISO.split('-').map(Number)
  const b = bucketsFor(y, m - 1)
  if (b.push.includes(dateISO)) return 'push'
  if (b.steady.includes(dateISO)) return 'steady'
  return null   // weekend or holiday
}

/**
 * Derive the push:steady ratio from history.
 * Returns { ratio, clamped, sample, pushAvg, steadyAvg } — clamped is true when
 * the raw figure fell outside 1.0-2.5 and the boundary was used instead.
 */
export function deriveRatio(invoices) {
  const byDay = {}
  for (const inv of invoices || []) {
    if (!inv.date) continue
    byDay[inv.date] = (byDay[inv.date] || 0) + (inv.total || 0)
  }
  const push = [], steady = []
  for (const [date, total] of Object.entries(byDay)) {
    const b = bucketOf(date)
    if (b === 'push') push.push(total)
    else if (b === 'steady') steady.push(total)
  }
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
  const pushAvg = mean(push), steadyAvg = mean(steady)
  const sample = { pushDays: push.length, steadyDays: steady.length }

  // Below this the ratio is noise, not signal — fall back to the midpoint and
  // say so rather than printing a confident number off three days.
  if (push.length < 3 || steady.length < 5 || steadyAvg <= 0) {
    return { ratio: 1.5, clamped: true, reason: 'insufficient history', sample, pushAvg, steadyAvg }
  }
  const raw = pushAvg / steadyAvg
  const ratio = Math.min(RATIO_MAX, Math.max(RATIO_MIN, raw))
  return { ratio, raw, clamped: ratio !== raw, sample, pushAvg, steadyAvg }
}

/**
 * Daily targets for each bucket, given a monthly goal and the ratio.
 * steady*nSteady + push*nPush = goal, with push = steady * ratio.
 */
export function targetsFor(year, monthIdx, monthlyGoal, ratio) {
  const b = bucketsFor(year, monthIdx)
  const denom = b.steady.length + b.push.length * ratio
  const steadyTarget = denom > 0 ? monthlyGoal / denom : 0
  return {
    steadyTarget: Math.round(steadyTarget),
    pushTarget: Math.round(steadyTarget * ratio),
    steadyCount: b.steady.length,
    pushCount: b.push.length,
    buckets: b,
  }
}

/**
 * Actual vs target per bucket, up to and including `today`.
 * Never returns a combined figure — that is the whole point of this module.
 */
export function evaluate({ invoices, today, monthlyGoal, ratio }) {
  const [y, m] = today.split('-').map(Number)
  const t = targetsFor(y, m - 1, monthlyGoal, ratio)
  const byDay = {}
  for (const inv of invoices || []) {
    if (inv.date && inv.date <= today) byDay[inv.date] = (byDay[inv.date] || 0) + (inv.total || 0)
  }
  const sum = days => days.reduce((s, d) => s + (byDay[d] || 0), 0)
  const elapsed = bucket => bucket.filter(d => d <= today)

  const pushElapsed = elapsed(t.buckets.push)
  const steadyElapsed = elapsed(t.buckets.steady)
  const pushActual = sum(pushElapsed)
  const steadyActual = sum(steadyElapsed)

  const verdict = (actual, days, target) => {
    if (!days.length) return { started: false, days: 0, target }
    const avg = actual / days.length
    return {
      started: true, days: days.length, actual, avg: Math.round(avg), target,
      onPlan: avg >= target, gap: Math.round((avg - target) * days.length),
    }
  }
  return {
    bucketToday: bucketOf(today),
    push: verdict(pushActual, pushElapsed, t.pushTarget),
    steady: verdict(steadyActual, steadyElapsed, t.steadyTarget),
    remaining: {
      push: t.buckets.push.filter(d => d > today).length,
      steady: t.buckets.steady.filter(d => d > today).length,
    },
    nextPushStart: t.buckets.push.find(d => d > today) || null,
    targets: t,
  }
}

/**
 * Month projection, bucket-aware.
 *
 * The old projection multiplied a flat daily average across the month, which
 * ignores that Mark's last 7 working days run ~1.5x his steady days — it
 * under-projects all month and then over-corrects at the end. This carries
 * what he has actually booked and adds each remaining bucket at that bucket's
 * own observed rate.
 *
 * Push rate falls back to steady x ratio until push days have started, since
 * there is nothing observed to use yet.
 */
export function projectMonth(ev, ratio) {
  const steadyRate = ev.steady.started ? ev.steady.avg : ev.steady.target
  const pushRate = ev.push.started ? ev.push.avg : Math.round(steadyRate * ratio)
  const booked = (ev.steady.actual || 0) + (ev.push.actual || 0)
  const projected = Math.round(
    booked + ev.remaining.steady * steadyRate + ev.remaining.push * pushRate
  )
  const elapsed = ev.steady.days + ev.push.days
  return {
    booked,
    projected,
    steadyRate,
    pushRate,
    elapsedWorkingDays: elapsed,
    remainingWorkingDays: ev.remaining.steady + ev.remaining.push,
    // Same floor the rest of the coach uses: below 5 elapsed working days a
    // projection is noise dressed as a forecast.
    reliable: elapsed >= 5,
  }
}
