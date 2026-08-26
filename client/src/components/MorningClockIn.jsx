// Morning clock-in prompt (Mark 2026-08-15): first app open of the day
// asks the user to clock in. Once per PT day per device; skipped if
// already clocked in. 4am-noon PT window so an evening check-in doesn't
// nag.

import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'

function todayPT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
function hourPT() {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false,
  }).format(new Date()))
}

export default function MorningClockIn({ user }) {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  useEffect(() => {
    const day = todayPT()
    const key = `aa_clockin_prompt_${day}`
    try { if (localStorage.getItem(key)) return } catch {}
    const h = hourPT()
    if (h < 4 || h >= 12) return
    apiFetch(`${API_BASE}/api/timeclock/current`)
      .then(r => r.json())
      .then(j => {
        // /current returns the open entry object, or null when clocked out
        if (!j || !j.clock_in) setShow(true)
        try { localStorage.setItem(key, '1') } catch {}
      })
      .catch(() => {})
  }, [])

  async function clockIn() {
    setBusy(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/timeclock/clock-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (r.status === 409) { setDone('Already clocked in 👍') }
      else if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`) }
      else setDone('Clocked in — have a good one 🔧')
      setTimeout(() => setShow(false), 1600)
    } catch (e) {
      setDone(`Failed: ${e.message} — use the Time Clock page`)
      setTimeout(() => setShow(false), 3000)
    } finally { setBusy(false) }
  }

  if (!show) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
        {done ? (
          <div className="text-sm font-semibold py-4" style={{ color: '#15803d' }}>{done}</div>
        ) : (
          <>
            <div className="text-3xl mb-2">☀️</div>
            <h2 className="text-base font-bold mb-1" style={{ color: '#1a1a1a' }}>
              Morning{user?.name ? `, ${String(user.name).split(' ')[0]}` : ''} — clock in?
            </h2>
            <p className="text-xs mb-5" style={{ color: '#888' }}>
              You're not on the clock yet. Hours drive payroll and sick-leave accrual.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setShow(false)}
                className="flex-1 text-sm font-semibold rounded-xl px-4 py-2.5"
                style={{ color: '#666', backgroundColor: '#f5f3f0' }}>Not yet</button>
              <button onClick={clockIn} disabled={busy}
                className="flex-1 text-sm font-bold rounded-xl px-4 py-2.5 text-white"
                style={{ backgroundColor: busy ? '#e5e7eb' : ORANGE }}>{busy ? '…' : '⏱ Clock in'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
