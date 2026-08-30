import { useState, useEffect, useCallback } from 'react'
import Navbar from './Navbar'
import { API_BASE, apiFetch, ORANGE, fmt } from './books/shared'

function formatMinutes(mins) {
  if (!mins) return '0h 0m'
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return `${h}h ${m}m`
}

function formatElapsed(startISO) {
  const mins = Math.floor((Date.now() - new Date(startISO).getTime()) / 60000)
  return formatMinutes(mins)
}

function getLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, address: '' }),
      () => resolve(null),
      { timeout: 5000, enableHighAccuracy: false }
    )
  })
}

export default function TimeClockScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [current, setCurrent] = useState(null)
  const [timesheet, setTimesheet] = useState(null)
  const [myEntries, setMyEntries] = useState([])
  const [pendingEdits, setPendingEdits] = useState([])
  const [fixing, setFixing] = useState(null)      // entry being edited
  const [fixBusy, setFixBusy] = useState(false)
  const isMark = String(user?.email || '').toLowerCase().startsWith('mark@')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState('')
  const [tick, setTick] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [currRes, tsRes] = await Promise.all([
        apiFetch(`${API_BASE}/api/timeclock/current`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/timeclock/timesheet`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/timeclock/entries`).then(r => r.json()).then(es => {
          if (Array.isArray(es)) setMyEntries(es.filter(e => e.clock_out).slice(0, 10))
        }).catch(() => {}),
        apiFetch(`${API_BASE}/api/timeclock/pending-edits`).then(r => r.json()).then(pe => {
          if (Array.isArray(pe)) setPendingEdits(pe)
        }).catch(() => {}),
      ])
      setCurrent(currRes)
      setTimesheet(tsRes)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Tick every 30s to keep elapsed time fresh
  useEffect(() => {
    if (!current) return
    const t = setInterval(() => setTick(x => x + 1), 30000)
    return () => clearInterval(t)
  }, [current])

  const activeBreak = current?.breaks?.find(b => !b.end)
  const isClockedIn = !!current
  const isOnBreak = !!activeBreak

  async function handleClockIn() {
    setBusy(true)
    try {
      const location = await getLocation()
      const r = await apiFetch(`${API_BASE}/api/timeclock/clock-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location }),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      await load()
    } catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  async function handleClockOut() {
    setBusy(true)
    try {
      const location = await getLocation()
      const r = await apiFetch(`${API_BASE}/api/timeclock/clock-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location, notes }),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      setNotes('')
      await load()
    } catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  async function handleBreakStart(type = 'short') {
    setBusy(true)
    try {
      await apiFetch(`${API_BASE}/api/timeclock/break/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      await load()
    } catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  async function handleBreakEnd() {
    setBusy(true)
    try {
      await apiFetch(`${API_BASE}/api/timeclock/break/end`, { method: 'POST' })
      await load()
    } catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  const totals = timesheet?.totals || { regular: 0, overtime: 0, total: 0 }

  const toLocalInput = iso => {
    const d = new Date(iso)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const fmtT = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const fmtD = iso => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  async function submitFix(e) {
    e.preventDefault()
    const form = new FormData(e.target)
    setFixBusy(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/timeclock/entries/${fixing.id}/edit-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clock_in: new Date(form.get('in')).toISOString(),
          clock_out: new Date(form.get('out')).toISOString(),
          note: form.get('note') || '',
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`)
      window.alert('Fix requested — Mark will review it. Your card stays as-is until he approves.')
      setFixing(null)
      load()
    } catch (err) { window.alert(err.message) }
    finally { setFixBusy(false) }
  }

  async function decideEdit(entry, approve) {
    setFixBusy(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/timeclock/entries/${entry.id}/edit-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`)
      load()
    } catch (err) { window.alert(err.message) }
    finally { setFixBusy(false) }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Time Clock</h1>
          <p className="text-sm text-gray-500 mt-0.5">Punch in and out for payroll</p>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : (
          <>
            {/* Status card */}
            <div className="rounded-xl p-6 shadow-sm mb-4 text-center"
              style={{ backgroundColor: isClockedIn ? '#f0fdf4' : '#fafafa', border: `1px solid ${isClockedIn ? '#bbf7d0' : '#f0ece8'}` }}>
              {isClockedIn ? (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#16a34a' }}>
                    {isOnBreak ? '☕ On Break' : '🟢 Clocked In'}
                  </p>
                  <p className="text-3xl font-bold mt-1" style={{ color: '#15803d' }}>
                    {formatElapsed(current.clock_in)}
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    Since {new Date(current.clock_in).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Not Clocked In</p>
                  <p className="text-3xl font-bold mt-1" style={{ color: '#1a1a1a' }}>Ready to Start</p>
                </>
              )}
            </div>

            {/* Main action button */}
            {!isClockedIn ? (
              <button onClick={handleClockIn} disabled={busy}
                className="w-full py-5 rounded-xl text-xl font-bold text-white shadow-sm mb-4"
                style={{ backgroundColor: '#16a34a', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Clocking in…' : '🟢 Clock In'}
              </button>
            ) : (
              <>
                {/* Break controls */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {isOnBreak ? (
                    <button onClick={handleBreakEnd} disabled={busy}
                      className="col-span-2 py-3 rounded-xl text-base font-semibold"
                      style={{ backgroundColor: '#fef3c7', color: '#b45309' }}>
                      ☕ End Break
                    </button>
                  ) : (
                    <>
                      <button onClick={() => handleBreakStart('lunch')} disabled={busy}
                        className="py-3 rounded-xl text-sm font-semibold"
                        style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
                        🍔 Lunch Break
                      </button>
                      <button onClick={() => handleBreakStart('short')} disabled={busy}
                        className="py-3 rounded-xl text-sm font-semibold"
                        style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
                        ☕ Short Break
                      </button>
                    </>
                  )}
                </div>

                {/* Notes */}
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Optional notes for this shift…"
                  className="w-full border rounded-xl p-3 text-sm mb-3 resize-none"
                  style={{ borderColor: '#e5e7eb' }}
                  rows="2" />

                {/* Clock out */}
                <button onClick={handleClockOut} disabled={busy || isOnBreak}
                  className="w-full py-5 rounded-xl text-xl font-bold text-white shadow-sm mb-4"
                  style={{ backgroundColor: ORANGE, opacity: (busy || isOnBreak) ? 0.6 : 1 }}>
                  {busy ? 'Clocking out…' : isOnBreak ? 'End break first' : '🔴 Clock Out'}
                </button>
              </>
            )}

            {/* This week */}
            <div className="rounded-xl border shadow-sm" style={{ borderColor: '#f0ece8' }}>
              <div className="px-5 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
                <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>This Week</h3>
              </div>
              <div className="grid grid-cols-3 divide-x" style={{ borderColor: '#f0ece8' }}>
                <div className="px-4 py-4 text-center">
                  <p className="text-xs text-gray-500">Regular</p>
                  <p className="text-lg font-bold" style={{ color: '#1a1a1a' }}>{formatMinutes(totals.regular)}</p>
                </div>
                <div className="px-4 py-4 text-center">
                  <p className="text-xs text-gray-500">Overtime</p>
                  <p className="text-lg font-bold" style={{ color: totals.overtime > 0 ? ORANGE : '#ccc' }}>
                    {formatMinutes(totals.overtime)}
                  </p>
                </div>
                <div className="px-4 py-4 text-center">
                  <p className="text-xs text-gray-500">Total</p>
                  <p className="text-lg font-bold" style={{ color: '#16a34a' }}>{formatMinutes(totals.total)}</p>
                </div>
              </div>
            </div>

            {/* Mark's approval queue (Mark 2026-08-30: edits need his OK) */}
            {isMark && pendingEdits.length > 0 && (
              <div className="mt-4 rounded-xl border shadow-sm" style={{ borderColor: '#fde68a', backgroundColor: '#fffbeb' }}>
                <div className="px-5 py-3 border-b" style={{ borderColor: '#fde68a' }}>
                  <h3 className="text-sm font-bold" style={{ color: '#92400e' }}>✏️ Time card fixes waiting on you ({pendingEdits.length})</h3>
                </div>
                {pendingEdits.map(pe => (
                  <div key={pe.id} className="px-5 py-3 border-b" style={{ borderColor: '#fef3c7' }}>
                    <p className="text-sm font-bold" style={{ color: '#1a1a1a' }}>{pe.user_name} · {fmtD(pe.clock_in)}</p>
                    <p className="text-xs mt-0.5" style={{ color: '#666' }}>
                      Current: {fmtT(pe.clock_in)} → {pe.clock_out ? fmtT(pe.clock_out) : 'open'}
                    </p>
                    <p className="text-xs font-semibold" style={{ color: '#92400e' }}>
                      Requested: {fmtT(pe.pending_edit.clock_in)} → {fmtT(pe.pending_edit.clock_out)}
                    </p>
                    {pe.pending_edit.note && <p className="text-xs italic mt-0.5" style={{ color: '#888' }}>"{pe.pending_edit.note}"</p>}
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => decideEdit(pe, true)} disabled={fixBusy}
                        className="flex-1 text-xs font-bold py-2 rounded-lg text-white" style={{ backgroundColor: '#16a34a' }}>✅ Approve</button>
                      <button onClick={() => decideEdit(pe, false)} disabled={fixBusy}
                        className="flex-1 text-xs font-bold py-2 rounded-lg" style={{ backgroundColor: '#fee2e2', color: '#b91c1c' }}>Deny</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent shifts — request a fix (nothing changes until Mark approves) */}
            {myEntries.length > 0 && (
              <div className="mt-4 rounded-xl border shadow-sm" style={{ borderColor: '#f0ece8' }}>
                <div className="px-5 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
                  <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>Recent Shifts</h3>
                  <p className="text-[11px] mt-0.5" style={{ color: '#999' }}>Wrong times? Request a fix — Mark approves before anything changes.</p>
                </div>
                {myEntries.map(en => (
                  <div key={en.id} className="px-5 py-2.5 border-b" style={{ borderColor: '#f7f4f1' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm" style={{ color: '#444' }}>
                        {fmtD(en.clock_in)} · {fmtT(en.clock_in)} → {fmtT(en.clock_out)}
                        {en.pending_edit && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>FIX PENDING</span>}
                      </span>
                      {!en.pending_edit && (
                        <button onClick={() => setFixing(en)}
                          className="text-xs font-bold px-2.5 py-1 rounded-lg flex-shrink-0"
                          style={{ backgroundColor: '#f5f3f0', color: '#666' }}>✎ Request fix</button>
                      )}
                    </div>
                    {fixing?.id === en.id && (
                      <form onSubmit={submitFix} className="mt-2 p-3 rounded-xl" style={{ backgroundColor: '#f8f7f5' }}>
                        <label className="block text-[10px] font-bold mb-1" style={{ color: '#888' }}>CLOCK IN</label>
                        <input name="in" type="datetime-local" defaultValue={toLocalInput(en.clock_in)} required
                          className="w-full text-sm px-2 py-1.5 rounded-lg mb-2" style={{ border: '1px solid #ddd' }} />
                        <label className="block text-[10px] font-bold mb-1" style={{ color: '#888' }}>CLOCK OUT</label>
                        <input name="out" type="datetime-local" defaultValue={toLocalInput(en.clock_out)} required
                          className="w-full text-sm px-2 py-1.5 rounded-lg mb-2" style={{ border: '1px solid #ddd' }} />
                        <input name="note" placeholder="Why? (e.g. forgot to clock out at lunch)"
                          className="w-full text-sm px-2 py-1.5 rounded-lg mb-2" style={{ border: '1px solid #ddd' }} />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setFixing(null)}
                            className="flex-1 text-xs font-semibold py-2 rounded-lg" style={{ backgroundColor: '#eee', color: '#666' }}>Cancel</button>
                          <button type="submit" disabled={fixBusy}
                            className="flex-1 text-xs font-bold py-2 rounded-lg text-white" style={{ backgroundColor: ORANGE }}>
                            {fixBusy ? 'Sending…' : 'Send to Mark'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Daily breakdown */}
            {timesheet?.days && (
              <div className="mt-4 rounded-xl border shadow-sm" style={{ borderColor: '#f0ece8' }}>
                <div className="px-5 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
                  <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>Daily Breakdown</h3>
                </div>
                <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
                  {timesheet.days.map(d => (
                    <div key={d.date} className="px-5 py-2 flex items-center justify-between">
                      <span className="text-sm text-gray-600">
                        {new Date(d.date + 'T00:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                      <span className="text-sm font-medium" style={{ color: d.regular + d.overtime > 0 ? '#1a1a1a' : '#ccc' }}>
                        {formatMinutes(d.regular + d.overtime)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
