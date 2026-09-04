// Pace wording. Two verdicts, always independent, never blended.
//
// Rules this enforces, from the spec:
//  - name which bucket today falls in and give that bucket's target
//  - report the two verdicts separately; never one combined percentage
//  - when a bucket is on plan, say so out loud rather than leaving it bare
//  - state a gap as a number, never as an adjective
//  - working days remaining, absences broken out
function money0(n) { return '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) }

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function bucketLine(name, v, nextStart) {
  // A bucket that has not started says WHEN, once. The old version printed
  // "start later this month" and then repeated the date on the next line.
  if (!v.started) {
    return nextStart
      ? `${name} week starts the ${ordinal(Number(nextStart.slice(-2)))}. Target ${money0(v.target)}/day.`
      : `${name} days have not started. Target ${money0(v.target)}/day.`
  }
  const verdict = v.onPlan ? 'on plan at' : 'at'
  const tail = v.onPlan ? '' : ` Gap is ${money0(Math.abs(v.gap))}.`
  return `${name} days are ${verdict} ${money0(v.avg)} against ${money0(v.target)}. ` +
         `${v.days} so far.${tail}`
}

export function formatPace(p, { goal, ratio, absences = 0 } = {}) {
  if (!p) return ''
  const L = []
  const todayBucket = p.bucketToday
  if (todayBucket) {
    const t = todayBucket === 'push' ? p.push.target : p.steady.target
    L.push(`Today is a ${todayBucket} day. Target ${money0(t)}.`)
  }
  L.push(bucketLine('Steady', p.steady, null))
  L.push(bucketLine('Push', p.push, p.nextPushStart))

  const rem = p.remaining.push + p.remaining.steady
  L.push(`${rem} working days left${absences ? `, ${absences} out` : ''}.`)
  return L.join('\n')
}

// Spoken form. Same two verdicts, rounded, full sentences, no headers.
export function speakPace(p, spokenMoney) {
  if (!p) return ''
  const parts = []
  const round = n => spokenMoney(Math.round(n / 100) * 100)
  if (p.steady.started) {
    parts.push(p.steady.onPlan
      ? `Steady days are on plan at ${round(p.steady.avg)} against ${round(p.steady.target)}.`
      : `Steady days are at ${round(p.steady.avg)} against ${round(p.steady.target)}.`)
  }
  if (p.push.started) {
    parts.push(p.push.onPlan
      ? `Push days are on plan at ${round(p.push.avg)} against ${round(p.push.target)}.`
      : `Push days are at ${round(p.push.avg)} against ${round(p.push.target)}.`)
  } else if (p.nextPushStart) {
    parts.push(`Push week starts the ${ordinal(Number(p.nextPushStart.slice(-2)))}, at ${round(p.push.target)} a day.`)
  }
  return parts.join(' ')
}
