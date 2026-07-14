// Daily digest of From the Van + Magic Lantern activity, sent as SMS to
// Mark's cell at 8pm PT. Format is tight — SMS-optimized under 500 chars.
//
// The comparison-to-yesterday model: we snapshot the current stats to a
// cache key each night after sending. Tomorrow's digest compares current
// stats to that snapshot to compute "today's activity." The very first
// digest has no snapshot to compare against, so it just reports current
// state.
//
// Snapshot storage: `van_stats_snapshot` in Catalyst cache. TTL 7 days so
// we keep a week of rolling history in case we want week-over-week later.

const SNAPSHOT_KEY = 'van_stats_snapshot'
const SNAPSHOT_TTL_HOURS = 168  // 7 days

/**
 * Compute the current Van audience + Magic Lantern state.
 * @param {Array} enrollments - result of readVanEnrollments()
 * @param {number} audienceCount - result of listVanSubscribers().count
 * @param {Array} caseNotes - result of readCaseNotes()
 * @param {Object|null} pendingDraft - result of readPendingDraft()
 * @returns {Object} stats object safe to snapshot
 */
export function computeCurrentStats({ enrollments, audienceCount, caseNotes, pendingDraft }) {
  const sentByDay = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 }
  let doneAll = 0
  let unsubCount = 0
  let neverSent = 0
  let goodbyeSent = 0
  let adminRemoved = 0

  for (const e of enrollments || []) {
    if (e.unsubscribed_at) unsubCount++
    if (e.admin_removed) adminRemoved++
    if (e.goodbye_sent) goodbyeSent++
    const sent = Array.isArray(e.nurture_sent) ? e.nurture_sent : []
    if (sent.length === 0 && !e.unsubscribed_at) neverSent++
    for (const day of sent) {
      if (day >= 1 && day <= 7) sentByDay[day]++
    }
    if (sent.length === 7) doneAll++
  }

  const totalSends = Object.values(sentByDay).reduce((a, b) => a + b, 0)

  const unusedCaseNotes = (caseNotes || []).filter(n => !n.used).length
  const totalCaseNotes = (caseNotes || []).length

  return {
    date: new Date().toISOString().slice(0, 10),  // YYYY-MM-DD
    audience_count: audienceCount || 0,
    enrollment_count: (enrollments || []).length,
    total_sends: totalSends,           // sum across all days
    sent_by_day: sentByDay,             // {1: N, 2: N, ...}
    unsub_count: unsubCount,
    goodbye_sent_count: goodbyeSent,
    admin_removed_count: adminRemoved,
    never_sent: neverSent,             // still eligible for Day 1
    done_all_seven: doneAll,           // finished the whole sequence
    unused_case_notes: unusedCaseNotes,
    total_case_notes: totalCaseNotes,
    pending_weekly_draft: pendingDraft ? {
      issue_number: pendingDraft.issue_number,
      subject: pendingDraft.subject,
      status: pendingDraft.status,
      scheduled_for: pendingDraft.scheduled_for,
    } : null,
  }
}

/**
 * Read yesterday's snapshot from cache. Returns null on first run or expiry.
 */
export async function readVanStatsSnapshot(segment) {
  try {
    const v = await segment.getValue(SNAPSHOT_KEY)
    if (v) return JSON.parse(v)
  } catch (e) {
    if (!(e?.statusCode === 404 || e?.errorInfo?.statusCode === 404)) {
      console.warn('[vanDailyDigest] snapshot read error:', e.message)
    }
  }
  return null
}

/**
 * Save today's stats as the snapshot for tomorrow's digest.
 * Uses try-update, catch-put-with-TTL per Catalyst cache convention
 * (segment.put requires a TTL hours arg or the first write silently fails
 * — see the Cache Quirks note in adas-iq/CLAUDE.md).
 */
export async function writeVanStatsSnapshot(segment, stats) {
  const body = JSON.stringify(stats)
  try { await segment.update(SNAPSHOT_KEY, body) }
  catch { await segment.put(SNAPSHOT_KEY, body, SNAPSHOT_TTL_HOURS) }
}

/**
 * Build the SMS body from current stats + yesterday's snapshot.
 * Multi-segment SMS supported; target is <450 chars for good UX.
 */
export function buildDigestSMS(current, yesterday) {
  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })
  const delta = (curr, prev) => {
    if (prev === undefined || prev === null) return `${curr}`
    const d = curr - prev
    if (d === 0) return `${curr}`
    return `${curr} (${d > 0 ? '+' : ''}${d})`
  }
  const lines = [
    `📮 Van digest ${today}`,
    ``,
  ]
  // If we have a yesterday snapshot, lead with the delta headlines
  if (yesterday) {
    const sendsToday = current.total_sends - (yesterday.total_sends || 0)
    const unsubsToday = current.unsub_count - (yesterday.unsub_count || 0)
    const audienceDelta = current.audience_count - (yesterday.audience_count || 0)
    lines.push(`Magic Lantern: ${sendsToday} sent today`)
    if (unsubsToday > 0) lines.push(`Unsubs today: ${unsubsToday}`)
    if (audienceDelta !== 0) lines.push(`Audience: ${current.audience_count} (${audienceDelta > 0 ? '+' : ''}${audienceDelta})`)
    else lines.push(`Audience: ${current.audience_count}`)
  } else {
    // First run — just report state
    lines.push(`Magic Lantern total sends: ${current.total_sends}`)
    lines.push(`Audience: ${current.audience_count}`)
    lines.push(`Unsubs (all-time): ${current.unsub_count}`)
  }
  // Day breakdown — only show non-zero days to save space
  const dayBits = Object.entries(current.sent_by_day)
    .filter(([, n]) => n > 0)
    .map(([day, n]) => `D${day}:${n}`)
    .join(' ')
  if (dayBits) lines.push(`Sent by day → ${dayBits}`)
  if (current.done_all_seven > 0) lines.push(`Finished 7-day: ${current.done_all_seven}`)
  if (current.never_sent > 0) lines.push(`Still waiting on D1: ${current.never_sent}`)

  lines.push(``)
  // Weekly newsletter
  if (current.pending_weekly_draft) {
    const p = current.pending_weekly_draft
    const when = p.scheduled_for ? new Date(p.scheduled_for).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'unscheduled'
    lines.push(`Weekly #${p.issue_number}: ${p.status} · ${when}`)
  } else {
    lines.push(`Weekly: no pending draft`)
  }
  lines.push(`Case notes queued: ${current.unused_case_notes}`)

  return lines.join('\n').slice(0, 1400)  // hard cap so we never blow past a reasonable SMS length
}
