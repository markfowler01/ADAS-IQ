// One visual language for cards on the Jobs board AND the schedule
// (Mark 2026-09-08: "look similar as the card colors and id, and I want
// the real jobs to stand out from the job requested").
//
//   REAL JOB  → white, solid 2px orange border, job id in a SOLID orange pill
//   REQUEST   → light orange tint, dashed orange border, "REQUEST" pill,
//               id (if any) in a quiet outlined pill
//
// Use cardFrame(job) for the wrapper style and <JobIdPill job /> for the
// id row so every surface reads the same way.
const ORANGE = '#CD4419'

export const isRequestJob = job => (job?.status || '') === 'job_requested'
export const isQuoteRequest = job => isRequestJob(job) && String(job?.request_type || '').toLowerCase() === 'quote'
const BLUE = '#1d4ed8'

// 💵 Customer pay (Mark 2026-09-11): the whole card goes green once the tech
// picks cash at Ready to Invoice — darker green for $700, light green for
// $350 — a visual cue on top of the written badge.
export function cashFrame(job) {
  const q = String(job?.cash_quoted || '')
  if (q === '700') return { border: '2.5px solid #15803d', backgroundColor: '#86efac' }
  if (q === '350') return { border: '2.5px solid #4ade80', backgroundColor: '#dcfce7' }
  return null
}
export function cardFrame(job, { complete = false } = {}) {
  const cash = cashFrame(job)
  if (cash) return cash
  if (complete) return { border: '2px solid #a8d5b5', backgroundColor: '#f8fff9' }
  if (job?.status === 'quoted') return { border: '1px solid #ebebeb', backgroundColor: 'white' }
  if (isQuoteRequest(job)) return { border: '1.5px dashed #60a5fa', backgroundColor: '#eff6ff' }
  if (isRequestJob(job)) return { border: `1.5px dashed ${ORANGE}`, backgroundColor: '#fff5f0' }
  return { border: `2px solid ${ORANGE}`, backgroundColor: 'white' }
}

export function jobIdOf(job) {
  return job?.invoice_number || job?.quote_number || job?.ro_number || ''
}

export default function JobIdPill({ job, size = 'sm' }) {
  const id = jobIdOf(job)
  const req = isRequestJob(job)
  const base = size === 'xs'
    ? 'text-[10px] font-extrabold rounded-full px-1.5 py-0.5 inline-block align-middle'
    : 'text-[11px] font-extrabold rounded-full px-2 py-0.5 inline-block align-middle'
  if (req) {
    const quote = isQuoteRequest(job)
    return (
      <span className="inline-flex items-center gap-1 flex-wrap">
        <span className={base} style={quote ? { backgroundColor: 'white', color: BLUE, border: '1.5px dashed #60a5fa' } : { backgroundColor: 'white', color: ORANGE, border: `1.5px dashed ${ORANGE}` }}>{quote ? 'QUOTE REQUEST' : 'REQUEST'}</span>
        {id && <span className={base} style={{ backgroundColor: 'white', color: '#8a8a8a', border: '1px solid #e0dbd6', fontFamily: "'IBM Plex Mono', monospace" }}>{id}</span>}
      </span>
    )
  }
  if (!id) return null
  return (
    <span className={base} style={{ backgroundColor: ORANGE, color: 'white', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.02em' }}>
      {id}
    </span>
  )
}
