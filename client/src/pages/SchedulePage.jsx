// Schedule — the Request Calendar (Mark 2026-08-10). Dispatch-only.
//
// Two-week grid where REQUESTS (status job_requested) are the loud
// primary objects and jobs render as quiet capacity context. A day with
// zero orange is fully dispatched — this is Kat's work queue, not a
// schedule display. Unscheduled lane holds date-less requests; drag one
// onto a day (desktop) or tap card → tap day (phone) to schedule it.
// Left map panel (collapsible) shows where the visible requests live,
// reusing the dispatch geocache through /api/schedule/board.
//
// Future-dated JOBS are parked here too: dispatch.js keeps them off the
// Live view until their morning, so scheduling ahead is just "pick the
// date" — no extra cron, the day arrives and the job appears.

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { API_BASE, apiFetch } from '../utils/api.js'
import Navbar from '../components/Navbar.jsx'
import JobRequestModal from '../components/JobRequestModal.jsx'

const ORANGE = '#CD4419'
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN

// Count-based capacity until we book clock times: 3 = amber, 4+ = full.
const FULL_PER_TECH = 4

const REQ = 'job_requested'
const isActiveJob = s => /^dispatched_|^need_dispatch$|^pending_parts$/.test(s || '')

function todayPT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00Z')
  return addDays(iso, -((d.getUTCDay() + 6) % 7))
}
function dowShort(iso) {
  return ['SUN','MON','TUE','WED','THU','FRI','SAT'][new Date(iso + 'T12:00:00Z').getUTCDay()]
}
function isWeekend(iso) {
  const d = new Date(iso + 'T12:00:00Z').getUTCDay()
  return d === 0 || d === 6
}
function fmtRange(a, b) {
  const f = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${f(a)} – ${f(b)}`
}
function fmtShort(iso) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}
// scheduled_date can carry a time suffix ("2026-08-05T08:00") — compare
// on the date part only.
function dateOf(j) { return String(j.scheduled_date || '').slice(0, 10) }
function vehicleOf(j) {
  return j.vehicle || [j.year, j.make, j.model].filter(Boolean).join(' ')
}
function calsOf(j) {
  let arr = []
  if (typeof j.calibrations === 'string') {
    try { const p = JSON.parse(j.calibrations); arr = Array.isArray(p) ? p : [] } catch { arr = [] }
  } else if (Array.isArray(j.calibrations)) arr = j.calibrations
  return arr.map(c => (typeof c === 'string' ? c : (c?.name || c?.type || ''))).filter(Boolean)
}
function techShort(t) {
  const s = String(t || '')
  if (/jay/i.test(s)) return 'Jaden'
  if (/mark/i.test(s)) return 'Mark'
  if (/kat/i.test(s)) return 'Kat'
  return s
}
function normShop(s) { return String(s || '').trim().toLowerCase() }

export default function SchedulePage({ user, onLogout, currentScreen, onNavigate }) {
  const [board, setBoard] = useState({ jobs: [], meta: {}, shops: {} })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [weekOffset, setWeekOffset] = useState(0)
  const [dayOpen, setDayOpen] = useState(null)      // ISO date of open day panel
  const [armedId, setArmedId] = useState(null)      // tap-to-schedule request id
  const [movingId, setMovingId] = useState(null)    // request id awaiting new date
  const [toast, setToast] = useState('')
  // "+ New" scheduled request straight from the calendar (Mark
  // 2026-08-13). Holds the prefill date ('' = no date → Unscheduled).
  const [requestFor, setRequestFor] = useState(null)
  const [mapOpen, setMapOpen] = useState(() => {
    try { return localStorage.getItem('aa_sched_map') !== '0' } catch { return true }
  })
  useEffect(() => { try { localStorage.setItem('aa_sched_map', mapOpen ? '1' : '0') } catch {} }, [mapOpen])

  const today = todayPT()
  const anchor = addDays(mondayOf(today), weekOffset * 7)
  const week1 = Array.from({ length: 7 }, (_, i) => addDays(anchor, i))
  const week2 = Array.from({ length: 7 }, (_, i) => addDays(anchor, 7 + i))

  const toastTimer = useRef(null)
  const showToast = useCallback(m => {
    setToast(m)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3000)
  }, [])

  const loadBoard = useCallback(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/api/schedule/board?_=${Date.now()}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setBoard({ jobs: j.jobs || [], meta: j.meta || {}, shops: j.shops || {} })
      setErr('')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { loadBoard() }, [loadBoard])
  useEffect(() => {
    const t = setInterval(loadBoard, 60_000)
    return () => clearInterval(t)
  }, [loadBoard])

  const requests = useMemo(() => board.jobs.filter(j => j.status === REQ), [board.jobs])
  const jobs     = useMemo(() => board.jobs.filter(j => isActiveJob(j.status)), [board.jobs])
  const unscheduled = useMemo(() => requests.filter(j => !dateOf(j)), [requests])
  const overdue = useMemo(() => requests.filter(j => dateOf(j) && dateOf(j) < today), [requests, today])
  const unconfirmedCount = useMemo(() =>
    requests.filter(j => dateOf(j) && dateOf(j) >= today && !board.meta[j.id]?.confirmed).length,
  [requests, board.meta, today])

  const cityOf = useCallback(j => board.shops[normShop(j.shop_name)]?.city || '', [board.shops])
  const confirmedOf = useCallback(j => !!board.meta[j.id]?.confirmed, [board.meta])

  async function scheduleRequest(id, date) {
    const req = requests.find(r => r.id === id)
    setBoard(prev => ({ ...prev, jobs: prev.jobs.map(j => j.id === id ? { ...j, scheduled_date: date } : j) }))
    try {
      const r = await apiFetch(`${API_BASE}/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_date: date }),
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`) }
      showToast(`📅 ${req?.shop_name || 'Request'} → ${dowShort(date)} ${fmtShort(date)}`)
    } catch (e) {
      showToast(`Save failed: ${e.message}`)
      loadBoard()
    }
  }

  async function toggleConfirmed(j) {
    const next = !confirmedOf(j)
    setBoard(prev => ({ ...prev, meta: { ...prev.meta, [j.id]: { confirmed: next } } }))
    try {
      const r = await apiFetch(`${API_BASE}/api/schedule/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: j.id, confirmed: next }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    } catch (e) { showToast(`Save failed: ${e.message}`); loadBoard() }
  }

  async function submitRequest(formData) {
    const notes = [formData.ro_number ? `RO# ${formData.ro_number}` : '', formData.notes || ''].filter(Boolean).join('\n')
    const payload = {
      shop_name:    formData.shop_name || '',
      year:         formData.year  || '',
      make:         formData.make  || '',
      model:        formData.model || '',
      vehicle:      [formData.year, formData.make, formData.model].filter(Boolean).join(' '),
      vin:          formData.vin || '',
      technician:   formData.technician || '',
      notes,
      quote_number: formData.ro_number || '',
      scheduled_date: formData.scheduled_date || '',
      status:       'job_requested',
      calibrations: '[]',
      via_request:  true,
      request_type: 'job',
    }
    const r = await apiFetch(`${API_BASE}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      throw new Error(d.error || 'Failed to create request')
    }
    showToast(formData.scheduled_date
      ? `📅 ${payload.shop_name} booked for ${fmtShort(formData.scheduled_date)}`
      : `📥 ${payload.shop_name} added to Unscheduled`)
    await loadBoard()
  }

  // ── Drag & drop ──
  const dragIdRef = useRef(null)
  function onDragStartReq(e, id) {
    dragIdRef.current = id
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', id) } catch {}
  }
  function onDropDay(e, date) {
    e.preventDefault()
    e.currentTarget.classList.remove('sched-dragover')
    const id = dragIdRef.current
    dragIdRef.current = null
    if (id) scheduleRequest(id, date)
  }

  function tapDay(date) {
    if (armedId) {
      scheduleRequest(armedId, date)
      setArmedId(null)
      return
    }
    if (movingId) {
      scheduleRequest(movingId, date)
      setMovingId(null)
      setDayOpen(null)
      return
    }
    setDayOpen(date)
  }

  // ── Map ──
  const mapDiv = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const visibleRequests = useMemo(() => {
    const days = new Set([...week1, ...week2])
    return requests.filter(j => !dateOf(j) || days.has(dateOf(j)))
  }, [requests, week1, week2])

  useEffect(() => {
    if (!mapOpen || !MAPBOX_TOKEN || !mapDiv.current) return
    if (!mapRef.current) {
      mapboxgl.accessToken = MAPBOX_TOKEN
      mapRef.current = new mapboxgl.Map({
        container: mapDiv.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [-122.2, 47.95],
        zoom: 8.4,
        attributionControl: false,
      })
    }
    const map = mapRef.current
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    const bounds = new mapboxgl.LngLatBounds()
    let count = 0
    for (const j of visibleRequests) {
      const geo = board.shops[normShop(j.shop_name)]
      if (!geo || geo.lat == null) continue
      const el = document.createElement('div')
      const overdueP = dateOf(j) && dateOf(j) < today
      const unsched = !dateOf(j)
      el.style.cssText = `width:16px;height:16px;border-radius:50%;border:3px solid ${overdueP ? '#dc2626' : ORANGE};background:${unsched ? 'white' : (overdueP ? '#dc2626' : ORANGE)};box-shadow:0 1px 5px rgba(0,0,0,.3);cursor:pointer;`
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([geo.lng, geo.lat])
        .setPopup(new mapboxgl.Popup({ offset: 12, closeButton: false }).setHTML(
          `<div style="font:600 12px 'IBM Plex Sans',sans-serif">${j.shop_name}<br>` +
          `<span style="font-weight:400;color:#666">${vehicleOf(j)}${dateOf(j) ? ' · ' + fmtShort(dateOf(j)) : ' · unscheduled'}</span></div>`))
        .addTo(map)
      markersRef.current.push(marker)
      bounds.extend([geo.lng, geo.lat])
      count++
    }
    if (count > 0) map.fitBounds(bounds, { padding: 46, maxZoom: 11, duration: 400 })
  }, [mapOpen, visibleRequests, board.shops, today])

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null }, [])

  // ── Cell renderer ──
  function renderCell(date) {
    const isToday = date === today
    const past = date < today
    const wkend = isWeekend(date)
    const dayReqs = requests.filter(j => dateOf(j) === date)
    const dayJobs = jobs.filter(j => dateOf(j) === date)
    const empty = dayReqs.length === 0 && dayJobs.length === 0
    const perTech = {}
    for (const j of [...dayReqs, ...dayJobs]) {
      const t = techShort(j.technician)
      if (t) perTech[t] = (perTech[t] || 0) + 1
    }
    const techBits = Object.entries(perTech).map(([t, n]) => `${t[0]} ${n}`).join(' / ')
    const maxLoad = Math.max(0, ...Object.values(perTech))
    const loadClass = maxLoad >= FULL_PER_TECH ? 'full' : (maxLoad >= FULL_PER_TECH - 1 ? 'amber' : '')

    return (
      <div key={date}
        onClick={() => tapDay(date)}
        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('sched-dragover') }}
        onDragLeave={e => e.currentTarget.classList.remove('sched-dragover')}
        onDrop={e => onDropDay(e, date)}
        className={`sched-cell ${wkend ? (empty ? 'weekend empty' : 'weekend has') : ''} ${isToday ? 'is-today' : ''} ${past && !isToday ? 'past' : ''} ${(armedId || movingId) && !past ? 'droptarget' : ''}`}
      >
        <div className="sched-dhead">
          <span className="sched-dnum">{Number(date.slice(8))}</span>
          <span className="sched-dow">{isToday ? 'TODAY' : dowShort(date)}</span>
        </div>
        {dayReqs.map(j => {
          const overdueP = date < today
          const unconf = !confirmedOf(j)
          return (
            <div key={j.id}
              draggable
              onDragStart={e => { e.stopPropagation(); onDragStartReq(e, j.id) }}
              className={`sched-chip ${overdueP ? 'overdue' : (unconf ? 'unconf' : '')}`}
            >
              {j.shop_name || 'Unknown shop'}{!overdueP && unconf ? ' ⏳' : ''}
              <span className="veh">{vehicleOf(j) || 'Vehicle TBD'}{calsOf(j).length ? ` · ${calsOf(j).slice(0, 2).join(', ')}` : ''}</span>
              <span className="loc">
                {cityOf(j) ? `📍 ${cityOf(j)}` : ''}
                {techShort(j.technician) ? `${cityOf(j) ? ' · ' : ''}${techShort(j.technician)}` : ''}
                {overdueP ? `${cityOf(j) || techShort(j.technician) ? ' · ' : ''}OVERDUE` : (unconf ? ' · unconfirmed' : '')}
              </span>
            </div>
          )
        })}
        {dayJobs.length > 0 && (
          <div className="sched-jobsline">
            {dayJobs.length} job{dayJobs.length === 1 ? '' : 's'}{techBits ? ` · ${techBits}` : ''}
            <span className={`sched-load ${loadClass}`}>
              {Array.from({ length: FULL_PER_TECH }, (_, i) => <i key={i} className={i < maxLoad ? 'f' : ''} />)}
            </span>
          </div>
        )}
      </div>
    )
  }

  // ── Day panel ──
  const panelReqs = dayOpen ? requests.filter(j => dateOf(j) === dayOpen) : []
  const panelJobs = dayOpen ? jobs.filter(j => dateOf(j) === dayOpen) : []

  function checklist(j) {
    const missing = []
    if (!(j.year && j.make && j.model) && !j.vehicle) missing.push('year/make/model')
    if (!j.vin) missing.push('VIN')
    if (calsOf(j).length === 0) missing.push('calibrations')
    return missing
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f5f3f0' }}>
      <style>{`
        .sched-cell { background:white; border:1px solid #ebebeb; border-radius:14px; padding:10px; min-height:132px; cursor:pointer; display:flex; flex-direction:column; gap:6px; transition:box-shadow .12s; }
        .sched-cell:hover { box-shadow:0 3px 14px rgba(0,0,0,.09); }
        .sched-cell.is-today { border:2px solid ${ORANGE}; }
        .sched-cell.past { opacity:.55; }
        .sched-cell.weekend.empty { background:transparent; border:1px dashed #d8d3cd; min-height:70px; }
        .sched-cell.sched-dragover, .sched-cell.droptarget:hover { background:#fff5f0; border:2px dashed ${ORANGE}; }
        .sched-dhead { display:flex; align-items:baseline; justify-content:space-between; }
        .sched-dnum { font-size:16px; font-weight:700; }
        .sched-dow { font-size:10px; font-weight:700; color:#8a8a8a; letter-spacing:1px; }
        .is-today .sched-dow { color:${ORANGE}; }
        .sched-chip { font-size:12px; font-weight:600; border-radius:8px; padding:4px 7px; line-height:1.3; cursor:grab; background:${ORANGE}; color:white; }
        .sched-chip.unconf { background:#fff5f0; color:${ORANGE}; border:1.5px dashed ${ORANGE}; }
        .sched-chip.overdue { background:#dc2626; }
        .sched-chip .veh { display:block; font-weight:400; font-size:11px; opacity:.9; }
        .sched-chip .loc { display:block; font-weight:700; font-size:11px; }
        .sched-jobsline { margin-top:auto; font-size:10.5px; color:#9c9c9c; display:flex; align-items:center; gap:5px; padding-top:4px; border-top:1px solid #f4f1ee; }
        .sched-load { display:inline-flex; gap:2px; }
        .sched-load i { width:5px; height:9px; border-radius:2px; background:#e5e0da; display:inline-block; }
        .sched-load i.f { background:#b9b2aa; }
        .sched-load.amber i.f { background:#d9a406; }
        .sched-load.full i.f { background:#d97706; }
        .sched-grid { display:grid; grid-template-columns:repeat(5,1fr) 0.55fr 0.55fr; gap:8px; }
        @media (max-width:700px){ .sched-grid { grid-template-columns:1fr; } .sched-grid .sched-cell.weekend.empty { display:none; } }
        /* Phone: everything stacks, Unscheduled lane rides on top so the
           tap-card-then-tap-day flow doesn't need scrolling round-trips.
           Desktop: map | grid | lane. */
        .sched-layout { display:grid; gap:16px; align-items:start; grid-template-columns:1fr; }
        .sched-lane { order:-1; }
        .sched-maparea { display:none; }
        @media (min-width:1024px){
          .sched-layout.with-map { grid-template-columns:minmax(220px,260px) 1fr minmax(200px,240px); }
          .sched-layout.no-map { grid-template-columns:1fr minmax(200px,240px); }
          .sched-lane { order:0; position:sticky; top:12px; }
          .sched-maparea { display:block; position:sticky; top:12px; }
        }
      `}</style>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

      <div className="max-w-7xl w-full mx-auto px-4 py-4 flex-1">
        {/* Header */}
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-widest" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Dispatch</div>
            <h1 className="text-xl font-bold" style={{ color: '#1a1a1a' }}>Schedule</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setRequestFor('')}
              className="text-xs font-bold rounded-lg px-3.5 py-2 text-white"
              style={{ backgroundColor: ORANGE }}
            >+ New</button>
            <button onClick={() => setMapOpen(v => !v)}
              className="text-xs font-semibold rounded-lg px-3 py-2"
              style={{ color: mapOpen ? 'white' : '#666', backgroundColor: mapOpen ? '#0e7490' : 'white', border: '1px solid #e0dbd6' }}
            >🗺 Map</button>
            <button onClick={() => setWeekOffset(o => o - 1)} className="w-9 h-9 rounded-lg bg-white" style={{ border: '1px solid #ebebeb' }}>‹</button>
            <div className="text-sm font-semibold text-center" style={{ minWidth: 130, color: '#444' }}>{fmtRange(week1[0], week2[6])}</div>
            <button onClick={() => setWeekOffset(o => o + 1)} className="w-9 h-9 rounded-lg bg-white" style={{ border: '1px solid #ebebeb' }}>›</button>
            {weekOffset !== 0 && (
              <button onClick={() => setWeekOffset(0)} className="text-xs font-semibold rounded-lg px-2.5 py-2 bg-white" style={{ border: '1px solid #e0dbd6', color: '#666' }}>Today</button>
            )}
          </div>
        </div>

        {/* Status pills */}
        <div className="flex gap-2 flex-wrap mt-3 mb-4">
          <span className="text-xs font-bold rounded-full px-3 py-1.5 text-white" style={{ backgroundColor: ORANGE }}>
            🟠 {requests.length} open request{requests.length === 1 ? '' : 's'}
          </span>
          <span className="text-xs font-bold rounded-full px-3 py-1.5" style={{ color: ORANGE, border: `1.5px solid ${ORANGE}`, backgroundColor: 'white' }}>
            📥 {unscheduled.length} unscheduled
          </span>
          {unconfirmedCount > 0 && (
            <span className="text-xs font-bold rounded-full px-3 py-1.5" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
              ⏳ {unconfirmedCount} unconfirmed
            </span>
          )}
          {overdue.length > 0 && (
            <span className="text-xs font-bold rounded-full px-3 py-1.5 text-white" style={{ backgroundColor: '#dc2626' }}>
              🔴 {overdue.length} overdue
            </span>
          )}
          {loading && <span className="text-xs px-2 py-1.5" style={{ color: '#888' }}>Loading…</span>}
          {err && <span className="text-xs px-2 py-1.5" style={{ color: '#991b1b' }}>{err}</span>}
        </div>

        {(armedId || movingId) && (
          <div className="text-xs font-bold rounded-xl px-3 py-2 mb-3" style={{ backgroundColor: '#fff5f0', color: ORANGE, border: `1.5px dashed ${ORANGE}` }}>
            👆 Now tap the day you want — or tap here to cancel
            <button className="ml-2 underline" onClick={() => { setArmedId(null); setMovingId(null) }}>cancel</button>
          </div>
        )}

        {/* Layout: map | grid | lane (phone: lane on top, then days) */}
        <div className={`sched-layout ${mapOpen ? 'with-map' : 'no-map'}`}>
          {mapOpen && (
            <div className="sched-maparea rounded-2xl bg-white p-3" style={{ border: '1px solid #ebebeb' }}>
              <div className="text-xs font-bold uppercase tracking-wide mb-2">🗺 This window's ground</div>
              {MAPBOX_TOKEN ? (
                <div ref={mapDiv} style={{ height: 380, borderRadius: 10, overflow: 'hidden' }} />
              ) : (
                <div className="text-xs p-3" style={{ color: '#888' }}>Map unavailable (no Mapbox token in this build).</div>
              )}
              <div className="text-[10.5px] mt-2" style={{ color: '#888', lineHeight: 1.5 }}>
                <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 99, background: ORANGE, marginRight: 4 }} />scheduled&nbsp;&nbsp;
                <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 99, background: 'white', border: `2px solid ${ORANGE}`, marginRight: 4 }} />unscheduled&nbsp;&nbsp;
                <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 99, background: '#dc2626', marginRight: 4 }} />overdue
              </div>
            </div>
          )}

          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: '#8a8a8a' }}>{weekOffset === 0 ? 'This week' : fmtRange(week1[0], week1[6])}</div>
            <div className="sched-grid mb-5">{week1.map(renderCell)}</div>
            <div className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: '#8a8a8a' }}>{weekOffset === 0 ? 'Next week' : fmtRange(week2[0], week2[6])}</div>
            <div className="sched-grid">{week2.map(renderCell)}</div>
          </div>

          {/* Unscheduled lane */}
          <div className="sched-lane rounded-2xl bg-white p-4" style={{ border: '1px solid #ebebeb' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wide">📥 Unscheduled</span>
              <span className="text-[11px] font-bold text-white rounded-full px-2 py-0.5" style={{ backgroundColor: ORANGE }}>{unscheduled.length}</span>
            </div>
            {unscheduled.length === 0 ? (
              <div className="text-center text-xs font-semibold py-4" style={{ color: '#16a34a' }}>✓ Nothing unscheduled</div>
            ) : unscheduled.map(j => (
              <div key={j.id}
                draggable
                onDragStart={e => onDragStartReq(e, j.id)}
                onClick={() => setArmedId(armedId === j.id ? null : j.id)}
                className="rounded-xl p-2.5 mb-2 cursor-grab select-none"
                style={{
                  borderLeft: `3px solid ${ORANGE}`, backgroundColor: '#fff5f0',
                  outline: armedId === j.id ? `2px solid ${ORANGE}` : 'none',
                }}
              >
                <div className="text-[12.5px] font-bold" style={{ color: '#1a1a1a' }}>{j.shop_name || 'Unknown shop'}</div>
                {cityOf(j) && <div className="text-[11px] font-bold" style={{ color: ORANGE }}>📍 {cityOf(j)}</div>}
                <div className="text-[11px]" style={{ color: '#8a6a5c' }}>
                  {vehicleOf(j) || 'Vehicle TBD'}{calsOf(j).length ? ` · ${calsOf(j).slice(0, 2).join(', ')}` : ''}
                </div>
              </div>
            ))}
            <div className="text-[11px] mt-2" style={{ color: '#888', lineHeight: 1.5 }}>
              Drag onto a day — or tap a card, then tap the day. Goal every day: this box at zero.
            </div>
          </div>
        </div>
      </div>

      {/* Day panel */}
      {dayOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center" style={{ backgroundColor: 'rgba(0,0,0,.45)' }}
          onClick={e => e.target === e.currentTarget && setDayOpen(null)}>
          <div className="bg-white rounded-t-2xl w-full p-5" style={{ maxWidth: 600, maxHeight: '82vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold">
                {dayOpen === today ? 'Today · ' : ''}{dowShort(dayOpen)} {fmtShort(dayOpen)}
              </h2>
              <button onClick={() => setDayOpen(null)} className="w-9 h-9 rounded-full text-xl" style={{ backgroundColor: '#f5f3f0', color: '#888' }}>×</button>
            </div>
            <button onClick={() => { setRequestFor(dayOpen); setDayOpen(null) }}
              className="w-full text-xs font-bold rounded-xl px-3 py-2.5 mb-3"
              style={{ color: ORANGE, border: `1.5px dashed ${ORANGE}`, backgroundColor: '#fff5f0' }}
            >+ Add a job to this day</button>
            {panelReqs.length === 0 && panelJobs.length === 0 && (
              <div className="text-sm py-6 text-center" style={{ color: '#888' }}>Nothing scheduled this day.</div>
            )}
            {panelReqs.map(j => {
              const missing = checklist(j)
              const conf = confirmedOf(j)
              return (
                <div key={j.id} className="rounded-xl p-3 mb-2.5" style={{ borderLeft: `4px solid ${ORANGE}`, backgroundColor: '#fff5f0', border: '1px solid #ebebeb' }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13.5px] font-bold">{j.shop_name || 'Unknown shop'}</span>
                    <span className="text-[10px] font-extrabold rounded-full px-2 py-0.5 text-white" style={{ backgroundColor: ORANGE }}>REQUEST</span>
                    {missing.length === 0 && <span className="text-[10px] font-extrabold rounded-full px-2 py-0.5" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>✓ READY</span>}
                    {!conf && <span className="text-[10px] font-extrabold rounded-full px-2 py-0.5" style={{ backgroundColor: '#fde68a', color: '#92400e' }}>⏳ UNCONFIRMED</span>}
                    {cityOf(j) && <span className="text-[10px] font-extrabold rounded-full px-2 py-0.5" style={{ backgroundColor: '#e0f2fe', color: '#075985' }}>📍 {cityOf(j)}</span>}
                  </div>
                  <div className="text-xs mt-1" style={{ color: '#666' }}>
                    {vehicleOf(j) || 'Vehicle TBD'}{calsOf(j).length ? ` · ${calsOf(j).join(', ')}` : ''}{techShort(j.technician) ? ` · ${techShort(j.technician)}` : ''}
                  </div>
                  {missing.length > 0 && (
                    <div className="text-[11.5px] mt-1.5" style={{ color: '#555' }}>
                      Needs before it can become a job: <span className="font-bold" style={{ color: '#dc2626' }}>{missing.join(' · ')}</span>
                    </div>
                  )}
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <button onClick={() => { setDayOpen(null); onNavigate && onNavigate('kanban') }}
                      className="text-xs font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: ORANGE }}>Create Job →</button>
                    <button onClick={() => { setMovingId(j.id); setDayOpen(null) }}
                      className="text-xs font-bold rounded-lg px-3 py-2 bg-white" style={{ border: '1px solid #e0dbd6', color: '#555' }}>📅 Move date</button>
                    <button onClick={() => toggleConfirmed(j)}
                      className="text-xs font-bold rounded-lg px-3 py-2"
                      style={conf ? { backgroundColor: '#dcfce7', color: '#166534' } : { backgroundColor: 'white', border: '1px solid #e0dbd6', color: '#555' }}
                    >{conf ? '✓ Confirmed' : '✓ Shop confirmed?'}</button>
                  </div>
                </div>
              )
            })}
            {panelJobs.map(j => (
              <div key={j.id} className="rounded-xl p-3 mb-2" style={{ borderLeft: '4px solid #d1d5db', backgroundColor: '#fafaf9', border: '1px solid #ebebeb', color: '#777' }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-bold">{j.shop_name || 'Unknown shop'}</span>
                  <span className="text-[10px] font-extrabold rounded-full px-2 py-0.5" style={{ backgroundColor: '#e5e7eb', color: '#666' }}>JOB</span>
                  {cityOf(j) && <span className="text-[10px] font-extrabold rounded-full px-2 py-0.5" style={{ backgroundColor: '#e0f2fe', color: '#075985' }}>📍 {cityOf(j)}</span>}
                </div>
                <div className="text-xs mt-0.5">
                  {vehicleOf(j) || 'Vehicle TBD'}{techShort(j.technician) ? ` · ${techShort(j.technician)}` : ''}{j.quote_number ? ` · RO# ${j.quote_number}` : ''} · {String(j.status || '').replace(/_/g, ' ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {requestFor !== null && (
        <JobRequestModal
          defaultDate={requestFor || ''}
          onClose={() => setRequestFor(null)}
          onSubmit={submitRequest}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 text-white text-xs font-semibold rounded-full px-4 py-2 z-50" style={{ backgroundColor: '#1a1a1a' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
