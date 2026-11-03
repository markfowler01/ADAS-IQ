// ⏰ When the tech needs to be there (Mark 2026-11-03: "jobs that are scheduled in his live
// view need to be more obvious of like when he needs to be there … more than likely it'll be
// first thing in the morning, before lunch, after lunch, end of day").
//
// Stored on the job state (absolute_adas_job_state) as `arrive`: 'first' | 'am' | 'pm' | 'eod'.
// An exact time keeps living where it always has — the scheduled_date suffix ("…T09:30").
// Website bookings carry "🌐 Website booking · Before lunch" in the notes; that's the fallback.
// Same table lives in client/src/lib/arrive.js — keep the two in step.
export const ARRIVE = {
  first: { label: 'First thing', emoji: '🌅', by: 'be there by 8:30', start: 480, end: 540 },
  am:    { label: 'Before lunch', emoji: '☀️', by: 'before 12:00', start: 540, end: 720 },
  pm:    { label: 'After lunch', emoji: '🍔', by: '12:30 – 3:00', start: 750, end: 900 },
  eod:   { label: 'End of day', emoji: '🌇', by: 'after 3:00', start: 900, end: 1020 },
}
const MID_DAY = 700   // no window = sorts between before- and after-lunch, drive order breaks ties

export const cleanArrive = v => (ARRIVE[String(v || '').trim()] ? String(v).trim() : '')

/** Pull `arrive` off a job save body (it's not a Jobs column). undefined = not sent. */
export function takeArrive(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'arrive')) return undefined
  const v = cleanArrive(body.arrive)
  delete body.arrive
  return v
}

/** { kind, label, emoji, by, start, end, sort } or null. state = that job's job-state entry. */
export function arriveOf(job, state = {}) {
  const w = cleanArrive(state?.arrive)
  if (w) return { kind: w, ...ARRIVE[w], sort: ARRIVE[w].start }
  const t = String(job?.scheduled_date || '').match(/T(\d{1,2}):(\d{2})/)
  if (t) {
    const m = Number(t[1]) * 60 + Number(t[2]), h = Number(t[1]) % 12 || 12
    const label = `${h}:${t[2]} ${Number(t[1]) < 12 ? 'AM' : 'PM'}`
    return { kind: 'time', label, emoji: '⏰', by: `at ${label}`, start: m, end: m + 30, sort: m }
  }
  const web = String(job?.notes || '').match(/Website booking · (Before lunch|After lunch)/)
  if (web) { const k = web[1] === 'Before lunch' ? 'am' : 'pm'; return { kind: k, ...ARRIVE[k], sort: ARRIVE[k].start } }
  return null
}
export const arriveSort = a => (a ? a.sort : MID_DAY)
