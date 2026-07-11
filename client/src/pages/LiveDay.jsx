// Live Day mobile command center.
//
// Two tech cards (Mark + Jayden) showing real-time-derived state, capacity,
// current job, next ETA, and end-of-day projection. Unassigned section at
// the bottom with "Suggest slot" for each new job. Designed for the phone:
// you open this when a new quote hits in the middle of a busy day.

import { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import Navbar from '../components/Navbar.jsx'
import MobileJobCard from '../components/MobileJobCard.jsx'
import JobRequestModal from '../components/JobRequestModal.jsx'
import QuoteRequestModal from '../components/QuoteRequestModal.jsx'

const ORANGE = '#CD4419'
const TECH_COLOR = { Mark: '#CD4419', Jayden: '#1F8B8B' }

function fmtElapsed(min) {
  if (min == null) return ''
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  return `${h}h ${min - h * 60}m`
}

// On-site projected complete time: started_at + 90 min (baseline duration).
// Returns HH:MM string for display next to the current job.
function projectedDoneBy(startedAtIso, durationMin = 90) {
  try {
    const t = new Date(new Date(startedAtIso).getTime() + durationMin * 60 * 1000)
    return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  } catch { return '' }
}

function parseRO(notes) {
  return (notes || '').match(/RO#[:\s]*([^\s|,]+)/i)?.[1] || ''
}

function parseCals(c) {
  if (!c) return []
  try { return typeof c === 'string' ? JSON.parse(c) : (Array.isArray(c) ? c : []) }
  catch { return [] }
}

function StatusPill({ tech }) {
  const labels = {
    'on-site':  { label: 'On Site',  bg: '#fff3b3', fg: '#7a5e00' },
    'en-route': { label: 'En Route', bg: '#fef3c7', fg: '#b45309' },
    'idle':     { label: 'Idle',     bg: '#e8e4e0', fg: '#555' },
    'done':     { label: 'Done',     bg: '#dcfce7', fg: '#15803d' },
  }
  const s = labels[tech.status] || labels.idle
  return (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: s.bg, color: s.fg }}>
      {tech.status === 'en-route' && <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 animate-pulse" style={{ backgroundColor: s.fg }} />}
      {s.label}
      {tech.status === 'on-site' && tech.current_elapsed_min != null && (
        <span className="ml-1 opacity-70">· {fmtElapsed(tech.current_elapsed_min)}</span>
      )}
    </span>
  )
}

// GET SOME!!! target — 4 jobs a day fires the money-rain celebration
// (used to trigger via /api/tech-stats but that endpoint isn't in this
// repo yet — treat as a client-side target only for now).
const GOAL_TARGET = 4

// Monthly bonus goal per tech — editable inline on the scoreboard. Stored
// in localStorage until the appConfig service is restored on the backend.
// Read/write helpers keyed by tech name.
function getStoredGoal(techName) {
  try {
    const raw = localStorage.getItem(`aa_bonus_goal_${String(techName).toLowerCase()}`)
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 20000
  } catch { return 20000 }
}
function setStoredGoal(techName, val) {
  try { localStorage.setItem(`aa_bonus_goal_${String(techName).toLowerCase()}`, String(val)) } catch {}
}

// Scoreboard — MTD sales toward the monthly bonus goal, plus today's sales,
// plus jobs-today progress toward the GET SOME target. MTD/today $ come
// from GET /api/tech-stats (Zoho Books invoices summed by salesperson,
// drafts excluded, 5-min server-side cache). Auto-refresh every 60s so
// numbers move as Kat marks invoices sent.
function TechScoreboard({ tech, viewerRole }) {
  const [goal, setGoal] = useState(() => getStoredGoal(tech.name))
  const [stats, setStats] = useState(null)
  const [statsErr, setStatsErr] = useState(false)
  const canEdit = viewerRole !== 'technician'
  const jobsToday = tech.used || 0
  const hitTarget = jobsToday >= GOAL_TARGET
  const bonus = Math.max(0, jobsToday - GOAL_TARGET)
  const targetLabel = hitTarget
    ? (bonus > 0 ? `🎯 GET SOME!!! +${bonus} BONUS` : '🎯 GET SOME!!!')
    : `${GOAL_TARGET - jobsToday} TO GET SOME!!!`

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/api/tech-stats?tech=${encodeURIComponent(tech.name)}`)
      if (!r.ok) { setStatsErr(true); return }
      const j = await r.json()
      setStats(j)
      setStatsErr(false)
    } catch { setStatsErr(true) }
  }, [tech.name])

  useEffect(() => {
    let cancelled = false
    const guarded = async () => { if (!cancelled) await load() }
    guarded()
    const id = setInterval(guarded, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [load])

  function editGoal() {
    const raw = window.prompt(`Set ${tech.name}'s monthly bonus goal ($):`, String(goal))
    if (raw == null) return
    const clean = String(raw).replace(/[^0-9]/g, '')
    const val = Number(clean)
    if (!clean || !Number.isFinite(val) || val <= 0) {
      alert('Enter a positive whole-dollar amount (e.g. 20000)')
      return
    }
    setStoredGoal(tech.name, val)
    setGoal(val)
  }

  const color = TECH_COLOR[tech.name] || '#999'
  const fmt$ = n => `$${Math.round(n || 0).toLocaleString('en-US')}`
  const mtd = stats?.mtd_sales ?? 0
  const todaySales = stats?.today_sales ?? 0
  const pct = Math.min(100, Math.round((mtd / Math.max(1, goal)) * 100))

  return (
    <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#fafaf9', border: `1px solid #ebebeb` }}>
      {/* Top row: MTD total vs. editable goal */}
      <div className="flex items-baseline justify-between mb-1">
        <div className="font-bold text-lg" style={{ color: '#1a1a1a' }}>
          {stats ? fmt$(mtd) : (statsErr ? '$ —' : '…')}
        </div>
        <div className="text-xs flex items-center gap-1" style={{ color: '#888' }}>
          of{' '}
          {canEdit ? (
            <button
              onClick={editGoal}
              className="underline decoration-dotted underline-offset-2"
              style={{ color: '#1a1a1a', fontWeight: 600 }}
              title="Tap to change the monthly goal"
            >{fmt$(goal)} ✏️</button>
          ) : (
            <span style={{ color: '#1a1a1a', fontWeight: 600 }}>{fmt$(goal)}</span>
          )}
          {' '}· {pct}%
        </div>
      </div>
      {/* Progress bar toward monthly goal */}
      <div className="w-full rounded-full overflow-hidden" style={{ backgroundColor: '#eee', height: 8 }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          backgroundColor: pct >= 100 ? '#15803d' : color,
          transition: 'width 0.6s ease-out',
        }} />
      </div>
      {/* Bottom row: today's sales + job progress toward GET SOME */}
      <div className="flex items-center justify-between text-xs mt-2">
        <div style={{ color: '#1a1a1a' }}>
          Today: <b>{stats ? fmt$(todaySales) : (statsErr ? '$ —' : '…')}</b>
          <span style={{ color: '#888' }}> · {jobsToday} {jobsToday === 1 ? 'job' : 'jobs'}</span>
        </div>
        <div className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: hitTarget ? '#15803d' : color, fontFamily: 'IBM Plex Mono, monospace' }}>
          {targetLabel}
        </div>
      </div>
      {statsErr && (
        <div className="text-[10px] mt-1" style={{ color: '#b45309' }}>
          Zoho stats unavailable — showing job count only
        </div>
      )}
    </div>
  )
}

function CapacityBar({ tech }) {
  // Progress toward the GET SOME!!! target, not a hard cap. 4 base slots
  // fill with the tech's color; extra jobs get green bonus slots.
  const color = TECH_COLOR[tech.name] || '#999'
  const used = tech.used || 0
  const slots = []
  for (let i = 0; i < GOAL_TARGET; i++) {
    const filled = i < used
    slots.push(
      <div key={i} className="flex-1 h-2 rounded-full"
        style={{ backgroundColor: filled ? color : '#e8e4e0' }} />
    )
  }
  for (let i = GOAL_TARGET; i < used; i++) {
    slots.push(
      <div key={'bonus' + i} className="flex-1 h-2 rounded-full"
        style={{ backgroundColor: '#15803d' }} />
    )
  }
  return (
    <div className="flex gap-1 items-center">
      {slots}
    </div>
  )
}

function TechCard({ tech, viewerRole, onReadyToInvoice, onReassign, techList }) {
  const color = TECH_COLOR[tech.name] || '#999'
  // Every tech on the board except this card's owner — reassign targets.
  const otherTechs = (techList || []).filter(n => n && n !== tech.name)
  const jobsToday = tech.used || 0
  const hitTarget = jobsToday >= GOAL_TARGET
  const bonus = Math.max(0, jobsToday - GOAL_TARGET)
  const capLabel = hitTarget
    ? (bonus > 0 ? `🎯 GET SOME!!! +${bonus} BONUS` : '🎯 GET SOME!!!')
    : `${GOAL_TARGET - jobsToday} TO GET SOME!!!`
  const capColor = hitTarget ? '#15803d' : color
  const current = tech.current_job
  const next = tech.next_job

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm"
      style={{ border: `1px solid #ebebeb`, borderTop: `4px solid ${color}` }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
          <span className="font-bold text-base" style={{ color: '#1a1a1a' }}>{tech.name}</span>
          <span className="text-xs" style={{ color: '#888' }}>
            {jobsToday} {jobsToday === 1 ? 'job' : 'jobs'} today
          </span>
        </div>
        <StatusPill tech={tech} />
      </div>

      {/* Monthly bonus goal + jobs-today scoreboard */}
      <TechScoreboard tech={tech} viewerRole={viewerRole} />

      {/* Capacity bar — progress toward the GET SOME!!! target */}
      <div className="mb-3">
        <CapacityBar tech={tech} />
        <div className="flex items-center justify-between text-[10px] mt-1.5 uppercase tracking-wider font-semibold"
          style={{ fontFamily: 'IBM Plex Mono, monospace', color: capColor }}>
          <span>{capLabel}</span>
          {tech.eod_projected && (
            <span style={{ color: '#888' }}>EOD ~{tech.eod_projected}</span>
          )}
        </div>
      </div>

      {/* Current job */}
      {current ? (
        <div className="rounded-xl p-3 mb-2" style={{ backgroundColor: '#fafaf9', borderLeft: `3px solid ${color}` }}>
          <div className="text-[10px] uppercase tracking-wider font-semibold mb-0.5"
            style={{ color, fontFamily: 'IBM Plex Mono, monospace' }}>
            Current
          </div>
          <div className="font-bold text-sm truncate" style={{ color: '#1a1a1a' }}>
            {current.shop_name || 'Unknown'}
          </div>
          <div className="text-xs mt-0.5 mb-2" style={{ color: '#555' }}>
            {current.vehicle || ''}
            {current.started_at
              ? ` · ✓ Done by ${projectedDoneBy(current.started_at)}`
              : current.time_window_start ? ` · ETA ${current.time_window_start}` : ''}
          </div>
          {/* Ready to Invoice — flips job status, which moves it to the
              Ready to Invoice column on the Kanban and posts to #aajobs +
              #Dispatch (Cliq fan-out lives in routes/jobs.js). */}
          <button
            onClick={() => onReadyToInvoice && onReadyToInvoice(current)}
            className="w-full text-sm font-bold rounded-lg py-2 text-white"
            style={{ backgroundColor: '#7e22ce' }}
          >
            🟢 Ready to Invoice
          </button>
          {onReassign && otherTechs.map(n => (
            <button
              key={n}
              onClick={() => onReassign(current, n)}
              className="w-full text-xs font-semibold rounded-lg py-1.5 mt-1.5"
              style={{ color: '#555', border: '1px solid #ddd', backgroundColor: 'white' }}
            >
              🔁 Reassign to {n}
            </button>
          ))}
        </div>
      ) : tech.status === 'done' ? (
        <div className="text-sm py-2 text-center" style={{ color: '#15803d' }}>
          ✓ Day complete.
        </div>
      ) : tech.status === 'idle' ? (
        <div className="text-sm py-2 text-center" style={{ color: '#888' }}>
          Waiting on first stop.
        </div>
      ) : null}

      {/* Next job — same Kanban-card layout used on the board */}
      {next && (
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold mb-1"
            style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>
            Next{next.time_window_start ? ` · ETA ${next.time_window_start}` : ''}
          </div>
          <MobileJobCard job={next} onMoveToReadyInvoice={onReadyToInvoice} />
          {onReassign && otherTechs.map(n => (
            <button
              key={n}
              onClick={() => onReassign(next, n)}
              className="w-full text-xs font-semibold rounded-lg py-1.5 mt-1.5"
              style={{ color: '#555', border: '1px solid #ddd', backgroundColor: 'white' }}
            >
              🔁 Reassign to {n}
            </button>
          ))}
        </div>
      )}

      {/* Remaining slots count */}
      {(tech.jobs?.length || 0) > 2 && (
        <div className="text-[11px] mt-2 text-center" style={{ color: '#999' }}>
          + {tech.jobs.length - 2} more on the schedule
        </div>
      )}
    </div>
  )
}

function ReadyToInvoiceModal({ job, onSubmit, onClose }) {
  const [text, setText] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl bg-white w-full max-w-md p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>
              Ready to Invoice
            </div>
            <div className="font-bold text-base mt-0.5" style={{ color: '#1a1a1a' }}>
              {job.shop_name || 'Job'}
            </div>
            <div className="text-xs" style={{ color: '#666' }}>
              {job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ') || ''}
            </div>
          </div>
          <button onClick={onClose} className="text-xl px-1" style={{ color: '#888' }}>×</button>
        </div>

        <div className="text-sm mb-2" style={{ color: '#1a1a1a' }}>
          Any other services to add? Kat will pull these into the invoice.
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          autoFocus
          placeholder="e.g. Programmed new key fob, replaced windshield trim, extra travel mileage…"
          className="w-full rounded-xl p-3 text-sm"
          style={{ border: '1px solid #e0dbd6', outline: 'none', resize: 'vertical' }}
        />

        <div className="flex gap-2 mt-3">
          <button
            onClick={() => onSubmit('')}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
            style={{ backgroundColor: 'white', color: '#666', border: '1px solid #e0dbd6' }}
          >Skip · No extras</button>
          <button
            onClick={() => onSubmit(text)}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white"
            style={{ backgroundColor: '#7e22ce' }}
          >{text.trim() ? '🚩 Send to Kat' : '🟢 Ready to Invoice'}</button>
        </div>
      </div>
    </div>
  )
}

function InsertJobDialog({ job, suggestions, onAssign, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl bg-white w-full max-w-md p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>
              Insert job
            </div>
            <div className="font-bold text-base mt-0.5" style={{ color: '#1a1a1a' }}>
              {job.shop_name}
            </div>
            <div className="text-xs" style={{ color: '#666' }}>
              {job.vehicle || ''}
            </div>
          </div>
          <button onClick={onClose} className="text-xl px-1" style={{ color: '#888' }}>×</button>
        </div>

        {!suggestions && (
          <div className="text-sm py-4 text-center" style={{ color: '#888' }}>
            Computing best slot…
          </div>
        )}

        {suggestions?.recommend_tomorrow && (
          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
            ⚠ Both techs are at cap today. Consider scheduling for tomorrow morning.
          </div>
        )}

        {suggestions?.suggestions?.map(s => (
          <button
            key={s.tech}
            onClick={() => {
              if (!s.recommend) {
                if (!confirm(`${s.tech} is already at ${s.used} / ${s.cap}. Assign anyway and overbook?`)) return
              }
              onAssign(job.id, s.tech)
            }}
            className="w-full text-left rounded-xl p-3 mb-2"
            style={{
              backgroundColor: s.recommend ? '#fafaf9' : '#f5f3f0',
              border: `1.5px solid ${s.recommend ? (TECH_COLOR[s.tech] || '#ccc') : '#e0e0e0'}`,
              opacity: s.recommend ? 1 : 0.7,
              cursor: 'pointer',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-sm" style={{ color: '#1a1a1a' }}>{s.tech}</div>
                <div className="text-xs" style={{ color: '#666' }}>
                  {s.recommend
                    ? `Slot in at position ${s.suggest_insert_at} · ${s.used + 1} / ${s.cap} after`
                    : `Already ${s.used} / ${s.cap}, at cap. Tap to overbook.`}
                </div>
              </div>
              <div className="text-right text-[11px]" style={{ color: '#888' }}>
                {s.extra_miles ? `+${s.extra_miles} mi` : ''}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function LiveDay({ user, onLogout, currentScreen, onNavigate }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [insertJob, setInsertJob] = useState(null)
  const [suggestions, setSuggestions] = useState(null)
  const [toast, setToast] = useState('')
  const [jobRequestOpen,   setJobRequestOpen]   = useState(false)
  const [quoteRequestOpen, setQuoteRequestOpen] = useState(false)
  const [readyInvoiceJob,  setReadyInvoiceJob]  = useState(null)
  const refreshTimerRef = useRef(null)

  const load = useCallback(async () => {
    try {
      setErr('')
      const res = await apiFetch(`${API_BASE}/api/dispatch/live`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setData(json)
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 60s while this view is open
  useEffect(() => {
    refreshTimerRef.current = setInterval(load, 60000)
    return () => clearInterval(refreshTimerRef.current)
  }, [load])

  function showToast(m) {
    setToast(m)
    setTimeout(() => setToast(''), 3500)
  }

  async function openInsertFor(job) {
    setInsertJob(job)
    setSuggestions(null)
    try {
      const res = await apiFetch(`${API_BASE}/api/dispatch/suggest-slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_name: job.shop_name }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setSuggestions(json)
    } catch (e) {
      showToast(`Suggestions failed: ${e.message}`)
    }
  }

  // Live Day "Request a Job" — posts to /api/jobs with via_request:true so
  // the backend routes it to #aajobs and drops it into Kat's inbox.
  async function handleJobRequest(formData) {
    const notes = [
      formData.ro_number ? `RO# ${formData.ro_number}` : '',
      formData.notes || '',
    ].filter(Boolean).join('\n')
    const payload = {
      shop_name:    formData.shop_name    || '',
      year:         formData.year         || '',
      make:         formData.make         || '',
      model:        formData.model        || '',
      vehicle:      [formData.year, formData.make, formData.model].filter(Boolean).join(' '),
      vin:          formData.vin          || formData.last_four_vin || '',
      technician:   formData.technician   || '',
      notes,
      quote_number: formData.ro_number    || '',
      status:       'job_requested',
      calibrations: '[]',
      via_request:  true,
      request_type: 'job',
    }
    const res = await apiFetch(`${API_BASE}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || 'Failed to create job request')
    }
    showToast('✅ Job requested — Kat has been notified in #aajobs')
    await load()
  }

  // Live Day "Request a Quote" — same endpoint, different tag. Backend
  // uses request_type:'quote' to prefix the Cliq post with 📝 Quote
  // Requested so it's clear the ask is for a price, not to schedule.
  async function handleQuoteRequest(formData) {
    const payload = {
      shop_name:    formData.shop_name    || '',
      year:         formData.year         || '',
      make:         formData.make         || '',
      model:        formData.model        || '',
      vehicle:      [formData.year, formData.make, formData.model].filter(Boolean).join(' '),
      vin:          formData.vin          || '',
      insurer:      formData.insurer      || '',
      notes:        formData.notes        || '',
      status:       'job_requested',
      calibrations: '[]',
      via_request:  true,
      request_type: 'quote',
    }
    const res = await apiFetch(`${API_BASE}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || 'Failed to submit quote request')
    }
    showToast('✅ Quote request sent — Kat will draft from #aajobs')
    await load()
  }

  // Opens the Ready-to-Invoice modal so the tech can jot any extra
  // services before the job flips. Actual PATCH happens in the modal's
  // Submit / Skip handlers below.
  function handleReadyToInvoice(job) {
    if (!job?.id) return
    setReadyInvoiceJob(job)
  }

  // Called by the modal — flips the job to ready_invoice, optionally
  // attaching extra_services text that surfaces on the Kanban card + in
  // the Cliq #Dispatch alert so Kat can pull them into the invoice.
  async function submitReadyToInvoice(extraServices) {
    const job = readyInvoiceJob
    if (!job?.id) return
    setReadyInvoiceJob(null)
    try {
      const body = { status: 'ready_invoice' }
      if (extraServices && extraServices.trim()) body.extra_services = extraServices.trim()
      const res = await apiFetch(`${API_BASE}/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      showToast(`🟢 ${job.shop_name || 'Job'} → Ready to Invoice`)
      await load()
    } catch (e) {
      showToast(`Failed: ${e.message}`)
    }
  }

  // Reassign a job to a different tech straight from Live Day (Mark
  // 2026-07-09: "sometimes they get mis-assigned, or Jayden will take
  // a job over that I was going to do"). Keeps the Kanban column in
  // sync — a dispatched_* job moves to the new tech's column. Backend
  // fires the tech-change Cliq DM + pushes salesperson to Zoho.
  async function handleReassign(job, newTech) {
    if (!job?.id || !newTech) return
    if (!confirm(`Reassign ${job.shop_name || 'this job'} to ${newTech}?`)) return
    try {
      const body = { technician: newTech }
      if (String(job.status || '').startsWith('dispatched_')) {
        body.status = newTech.toLowerCase().startsWith('jay') ? 'dispatched_jaden' : 'dispatched_mark'
      }
      const res = await apiFetch(`${API_BASE}/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      showToast(`🔁 ${job.shop_name || 'Job'} → ${newTech}`)
      await load()
    } catch (e) {
      showToast(`Reassign failed: ${e.message}`)
    }
  }

  async function handleAssign(jobId, tech) {
    try {
      const res = await apiFetch(`${API_BASE}/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ technician: tech }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setInsertJob(null)
      setSuggestions(null)
      showToast(`✓ Assigned to ${tech}`)
      await load()
    } catch (e) {
      showToast(`Assign failed: ${e.message}`)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f5f3f0' }}>
        <p className="text-gray-400 text-sm">Loading live day…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

      <div className="sticky top-0 z-10 px-4 py-3"
        style={{ backgroundColor: '#f5f3f0', borderBottom: '1px solid #e8e4e0' }}>
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider"
              style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>
              Live Day
            </div>
            <div className="text-base font-bold truncate" style={{ color: '#1a1a1a' }}>
              {data?.date
                ? new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
                : ''}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
            {/* Reference-tool shortcuts — one tap from the tech's Live Day
                straight into AllData / Kinetic in a new tab. Kept compact
                as pill buttons so they don't eat header real estate. */}
            <a
              href="https://my.alldata.com/migrate/#/home"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] px-2.5 py-1.5 rounded-lg font-semibold"
              style={{ backgroundColor: '#1e40af', color: 'white' }}
              title="Open AllData"
            >AllData</a>
            <a
              href="https://ops.kinetic.auto/id/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] px-2.5 py-1.5 rounded-lg font-semibold"
              style={{ backgroundColor: '#0e7490', color: 'white' }}
              title="Open Kinetic"
            >Kinetic</a>
            <a
              href="https://dh.identifix.com/Default/LogOnIdentifix?sessionTerminated=True"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] px-2.5 py-1.5 rounded-lg font-semibold"
              style={{ backgroundColor: '#7c2d12', color: 'white' }}
              title="Open Identifix"
            >Identifix</a>
            <a
              href="https://opusccp.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] px-2.5 py-1.5 rounded-lg font-semibold"
              style={{ backgroundColor: '#4c1d95', color: 'white' }}
              title="Open Opus CCP"
            >Opus CCP</a>
            <button
              onClick={load}
              className="text-xs px-2.5 py-1.5 rounded-lg font-semibold"
              style={{ backgroundColor: 'white', border: '1px solid #ddd', color: '#555' }}
            >↻</button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 space-y-3">
        {err && (
          <div className="rounded-xl p-3 text-sm"
            style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
            {err}
          </div>
        )}

        {/* Request buttons — Live Day companions for a tech in the field.
            Both submit to #aajobs; Kat picks up either from Cliq. Stacked
            on mobile, side-by-side on tablet+. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          <button
            onClick={() => setJobRequestOpen(true)}
            className="text-sm font-bold rounded-2xl px-4 py-3 text-white"
            style={{ backgroundColor: ORANGE }}
          >
            📥 Request a Job
          </button>
          <button
            onClick={() => setQuoteRequestOpen(true)}
            className="text-sm font-bold rounded-2xl px-4 py-3"
            style={{ backgroundColor: 'white', color: ORANGE, border: `1.5px solid ${ORANGE}` }}
          >
            📝 Request a Quote
          </button>
        </div>

        {/* Needs-Dispatch alert — moved to TOP + red styled 2026-07-09
            per Mark: "jobs that need to be dispatched, I want them at
            the top and red." Hidden entirely when empty so it doesn't
            waste header space. */}
        {(data?.unassigned_today || []).length > 0 && (
          <div className="rounded-2xl p-4"
            style={{ backgroundColor: '#fef2f2', border: '2px solid #dc2626' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wider font-bold flex items-center gap-2"
                style={{ color: '#dc2626', fontFamily: 'IBM Plex Mono, monospace' }}>
                🚨 Needs Dispatch ({data.unassigned_today.length})
              </div>
            </div>
            <ul className="space-y-2">
              {data.unassigned_today.map(j => {
                const ro = parseRO(j.notes)
                const cals = parseCals(j.calibrations)
                return (
                  <li key={j.id} className="flex items-center justify-between gap-2 rounded-lg p-2"
                    style={{ backgroundColor: '#ffffff', border: '1px solid #fca5a5' }}>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm truncate" style={{ color: '#7f1d1d' }}>
                        {j.shop_name}
                      </div>
                      <div className="text-xs truncate" style={{ color: '#991b1b' }}>
                        {j.vehicle || ''}
                        {ro && ` · RO# ${ro}`}
                        {cals.length > 0 && ` · 🔧 ${cals.length}`}
                      </div>
                    </div>
                    <button
                      onClick={() => openInsertFor(j)}
                      className="text-xs font-bold rounded-lg px-3 py-2 text-white flex-shrink-0"
                      style={{ backgroundColor: '#dc2626' }}
                    >Assign →</button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* Tech cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(data?.techs || []).map(t => (
            <TechCard
              key={t.name}
              tech={t}
              viewerRole={data?.viewer_role}
              onReadyToInvoice={handleReadyToInvoice}
              onReassign={handleReassign}
              techList={(data?.techs || []).map(x => x.name)}
            />
          ))}
        </div>
      </div>

      {insertJob && (
        <InsertJobDialog
          job={insertJob}
          suggestions={suggestions}
          onAssign={handleAssign}
          onClose={() => { setInsertJob(null); setSuggestions(null) }}
        />
      )}

      {readyInvoiceJob && (
        <ReadyToInvoiceModal
          job={readyInvoiceJob}
          onSubmit={submitReadyToInvoice}
          onClose={() => setReadyInvoiceJob(null)}
        />
      )}

      {jobRequestOpen && (
        <JobRequestModal
          onClose={() => setJobRequestOpen(false)}
          onSubmit={handleJobRequest}
        />
      )}

      {quoteRequestOpen && (
        <QuoteRequestModal
          onClose={() => setQuoteRequestOpen(false)}
          onSubmit={handleQuoteRequest}
        />
      )}

      {toast && (
        <div className="fixed left-4 right-4 z-50 rounded-xl px-4 py-3 text-sm shadow-lg"
          style={{ bottom: 24, backgroundColor: '#1a1a1a', color: 'white', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
