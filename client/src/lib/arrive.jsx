// ⏰ When the tech needs to be there (Mark 2026-11-03). Mirrors
// functions/adasiq-api/services/arrive.js — keep the two tables in step.
// Stored on the job as `arrive` ('first' | 'am' | 'pm' | 'eod'); an exact time
// stays on scheduled_date ("…T09:30"), the way the board form already saves it.
export const ARRIVE = {
  first: { label: 'First thing', emoji: '🌅', by: 'be there by 8:30', end: 540, bg: '#fef3c7', fg: '#92400e' },
  am:    { label: 'Before lunch', emoji: '☀️', by: 'before 12:00', end: 720, bg: '#ffedd5', fg: '#9a3412' },
  pm:    { label: 'After lunch', emoji: '🍔', by: '12:30 – 3:00', end: 900, bg: '#dbeafe', fg: '#1e40af' },
  eod:   { label: 'End of day', emoji: '🌇', by: 'after 3:00', end: 1020, bg: '#ede9fe', fg: '#5b21b6' },
}

/** Same answer the server gives in arrive_info, for screens that only have the job. */
export function arriveOf(job) {
  if (job?.arrive_info) return job.arrive_info
  const w = job?.arrive
  if (ARRIVE[w]) return { kind: w, ...ARRIVE[w] }
  const t = String(job?.scheduled_date || '').match(/T(\d{1,2}):(\d{2})/)
  if (t) {
    const m = Number(t[1]) * 60 + Number(t[2]), h = Number(t[1]) % 12 || 12
    const label = `${h}:${t[2]} ${Number(t[1]) < 12 ? 'AM' : 'PM'}`
    return { kind: 'time', label, emoji: '⏰', by: `at ${label}`, end: m + 30 }
  }
  return null
}
const colorsOf = a => ARRIVE[a?.kind] || { bg: '#fee2e2', fg: '#991b1b' }

function nowMinutesPT() {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date())
  const g = k => Number(p.find(x => x.type === k)?.value || 0)
  return (g('hour') % 24) * 60 + g('minute')
}

/** Big bar across the top of a Live card: "🌅 FIRST THING · be there by 8:30". Red when the window is passing and he hasn't started. */
export function ArriveBar({ job, today }) {
  const a = arriveOf(job)
  if (!a) return null
  const dueToday = !job.scheduled_date || String(job.scheduled_date).slice(0, 10) <= today
  const late = dueToday && !job.started_at && !job.completed_at && nowMinutesPT() > a.end - 15
  const c = late ? { bg: '#dc2626', fg: '#fff' } : colorsOf(a)
  return (
    <div className="rounded-lg px-3 py-2 mb-2 font-extrabold text-sm tracking-wide flex items-center justify-between"
      style={{ backgroundColor: c.bg, color: c.fg }}>
      <span>{a.emoji} {a.label.toUpperCase()}</span>
      <span className="text-xs font-bold">{late ? `⚠️ LATE · ${a.by}` : a.by}</span>
    </div>
  )
}

/** Small pill for calendar chips and lists. */
export function ArrivePill({ job }) {
  const a = arriveOf(job)
  if (!a) return null
  const c = colorsOf(a)
  return <span className="inline-block text-[9.5px] font-extrabold rounded-full px-1.5 py-[1px] ml-1 align-middle"
    style={{ backgroundColor: c.bg, color: c.fg }}>{a.emoji} {a.kind === 'time' ? a.label : a.label}</span>
}

/**
 * "When" picker. value = { arrive, time } where time is 'HH:MM' or ''.
 * Exact time and a window are exclusive: picking one clears the other.
 */
export function ArrivePicker({ arrive, time, onChange, compact = false }) {
  const opts = [...Object.entries(ARRIVE).map(([k, v]) => [k, `${v.emoji} ${v.label}`]), ['time', '⏰ Exact time']]
  const sel = time ? 'time' : (arrive || '')
  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? '' : 'mt-1'}`}>
      {opts.map(([k, label]) => {
        const on = sel === k, c = ARRIVE[k] || { bg: '#f3f4f6', fg: '#111827' }
        return (
          <button key={k} type="button"
            onClick={() => onChange(k === 'time' ? { arrive: '', time: time || '09:00' } : (on ? { arrive: '', time: '' } : { arrive: k, time: '' }))}
            className="text-xs font-bold rounded-full px-2.5 py-1"
            style={{ backgroundColor: on ? c.bg : '#fff', color: on ? c.fg : '#6b7280', border: `1.5px solid ${on ? c.fg : '#e5e7eb'}` }}>
            {label}
          </button>
        )
      })}
      {sel === 'time' && (
        <input type="time" value={time} onChange={e => onChange({ arrive: '', time: e.target.value })}
          className="border rounded-lg px-2 py-0.5 text-xs" style={{ borderColor: '#ddd' }} />
      )}
    </div>
  )
}
