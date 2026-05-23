// Live Day mobile command center.
//
// Two tech cards (Mark + Jayden) showing real-time-derived state, capacity,
// current job, next ETA, and end-of-day projection. Unassigned section at
// the bottom with "Suggest slot" for each new job. Designed for the phone:
// you open this when a new quote hits in the middle of a busy day.

import { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import Navbar from '../components/Navbar.jsx'

const ORANGE = '#CD4419'
const TECH_COLOR = { Mark: '#CD4419', Jayden: '#1F8B8B' }

function fmtElapsed(min) {
  if (min == null) return ''
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  return `${h}h ${min - h * 60}m`
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

function CapacityBar({ tech }) {
  // Render 4 slots (or whatever cap is) with filled/empty/over states
  const slots = []
  for (let i = 0; i < tech.cap; i++) {
    const filled = i < tech.used
    slots.push(
      <div key={i} className="flex-1 h-2 rounded-full"
        style={{ backgroundColor: filled ? (TECH_COLOR[tech.name] || '#999') : '#e8e4e0' }} />
    )
  }
  // Overflow slots (red)
  for (let i = tech.cap; i < tech.used; i++) {
    slots.push(
      <div key={'over' + i} className="flex-1 h-2 rounded-full"
        style={{ backgroundColor: '#dc2626' }} />
    )
  }
  return (
    <div className="flex gap-1 items-center">
      {slots}
    </div>
  )
}

function TechCard({ tech }) {
  const color = TECH_COLOR[tech.name] || '#999'
  const capLabel = tech.status === 'over' ? 'OVER CAP' : (tech.status === 'full' ? 'FULL' : `${tech.available} OPEN`)
  const capColor = tech.overCap ? '#dc2626' : (tech.atCap ? '#b45309' : '#15803d')
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
            {tech.used} / {tech.cap}
          </span>
        </div>
        <StatusPill tech={tech} />
      </div>

      {/* Capacity bar */}
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
          <div className="text-xs mt-0.5" style={{ color: '#555' }}>
            {current.vehicle || ''}
            {current.time_window_start && ` · ⏰ ${current.time_window_start}`}
          </div>
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

      {/* Next job */}
      {next && (
        <div className="rounded-xl p-3" style={{ backgroundColor: 'white', border: '1px dashed #ddd' }}>
          <div className="text-[10px] uppercase tracking-wider font-semibold mb-0.5"
            style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>
            Next
          </div>
          <div className="font-semibold text-sm truncate" style={{ color: '#1a1a1a' }}>
            {next.shop_name || 'Unknown'}
          </div>
          <div className="text-xs mt-0.5" style={{ color: '#666' }}>
            {next.vehicle || ''}
            {next.time_window_start && ` · ETA ${next.time_window_start}`}
          </div>
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
            onClick={() => onAssign(job.id, s.tech)}
            disabled={!s.recommend}
            className="w-full text-left rounded-xl p-3 mb-2"
            style={{
              backgroundColor: s.recommend ? '#fafaf9' : '#f5f3f0',
              border: `1.5px solid ${s.recommend ? (TECH_COLOR[s.tech] || '#ccc') : '#e0e0e0'}`,
              opacity: s.recommend ? 1 : 0.55,
              cursor: s.recommend ? 'pointer' : 'not-allowed',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-sm" style={{ color: '#1a1a1a' }}>{s.tech}</div>
                <div className="text-xs" style={{ color: '#666' }}>
                  {s.recommend
                    ? `Slot in at position ${s.suggest_insert_at} · ${s.used + 1} / ${s.cap} after`
                    : `Already ${s.used} / ${s.cap} — at cap`}
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
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider"
              style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>
              Live Day
            </div>
            <div className="text-base font-bold" style={{ color: '#1a1a1a' }}>
              {data?.date
                ? new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
                : ''}
            </div>
          </div>
          <button
            onClick={load}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold"
            style={{ backgroundColor: 'white', border: '1px solid #ddd', color: '#555' }}
          >↻ Refresh</button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 space-y-3">
        {err && (
          <div className="rounded-xl p-3 text-sm"
            style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
            {err}
          </div>
        )}

        {/* Tech cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(data?.techs || []).map(t => <TechCard key={t.name} tech={t} />)}
        </div>

        {/* Unassigned same-day jobs */}
        <div className="rounded-2xl bg-white p-4" style={{ border: '1px solid #ebebeb' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase tracking-wider font-semibold"
              style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>
              Unassigned today ({(data?.unassigned_today || []).length})
            </div>
          </div>
          {(data?.unassigned_today || []).length === 0 ? (
            <p className="text-sm py-1" style={{ color: '#bbb' }}>None.</p>
          ) : (
            <ul className="space-y-2">
              {data.unassigned_today.map(j => {
                const ro = parseRO(j.notes)
                const cals = parseCals(j.calibrations)
                return (
                  <li key={j.id} className="flex items-center justify-between gap-2 rounded-lg p-2"
                    style={{ backgroundColor: '#fafaf9', border: '1px solid #f0ece8' }}>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate" style={{ color: '#1a1a1a' }}>
                        {j.shop_name}
                      </div>
                      <div className="text-xs truncate" style={{ color: '#666' }}>
                        {j.vehicle || ''}
                        {ro && ` · RO# ${ro}`}
                        {cals.length > 0 && ` · 🔧 ${cals.length}`}
                      </div>
                    </div>
                    <button
                      onClick={() => openInsertFor(j)}
                      className="text-xs font-bold rounded-lg px-3 py-2 text-white flex-shrink-0"
                      style={{ backgroundColor: ORANGE }}
                    >Fit it in →</button>
                  </li>
                )
              })}
            </ul>
          )}
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

      {toast && (
        <div className="fixed left-4 right-4 z-50 rounded-xl px-4 py-3 text-sm shadow-lg"
          style={{ bottom: 24, backgroundColor: '#1a1a1a', color: 'white', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
