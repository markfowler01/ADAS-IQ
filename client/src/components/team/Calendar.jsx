// Company calendar (phase 6): holidays, approved time off, birthdays,
// anniversaries, paydays, review days, expiries. List by month — reads
// well on a phone and prints clean.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch, ORANGE } from '../books/shared'

const j = async url => { const r = await apiFetch(`${API_BASE}${url}`); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
const TYPES = { holiday: ['🎉', 'Holidays', '#c2410c'], timeoff: ['🏖', 'Time off', '#0e7490'], birthday: ['🎂', 'Birthdays', '#db2777'], anniversary: ['🏅', 'Anniversaries', '#b45309'], payday: ['💵', 'Paydays', '#15803d'], review: ['⏱', 'Time card days', '#7c3aed'], expiry: ['📄', 'Expiries', '#b91c1c'], checkin: ['🗓', 'Check-ins', '#2563eb'] }
const iso = d => d.toISOString().slice(0, 10)
const monthLabel = ym => new Date(ym + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const dayLabel = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export default function CalendarTab() {
  const [start, setStart] = useState(() => { const d = new Date(); d.setDate(1); return iso(d) })
  const [data, setData] = useState(null)
  const [off, setOff] = useState({})   // type → hidden
  const [err, setErr] = useState('')
  const end = (() => { const d = new Date(start + 'T12:00:00'); d.setMonth(d.getMonth() + 3); d.setDate(0); return iso(d) })()
  useEffect(() => { setErr(''); j(`/api/people/calendar?from=${start}&to=${end}`).then(setData).catch(e => setErr(e.message)) }, [start]) // eslint-disable-line react-hooks/exhaustive-deps
  const shift = n => { const d = new Date(start + 'T12:00:00'); d.setMonth(d.getMonth() + n); d.setDate(1); setStart(iso(d)) }
  const today = iso(new Date())
  const events = (data?.events || []).filter(e => !off[e.type])
  const byMonth = {}
  for (const e of events) { const ym = e.date.slice(0, 7); (byMonth[ym] = byMonth[ym] || {}); (byMonth[ym][e.date] = byMonth[ym][e.date] || []).push(e) }
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <button onClick={() => shift(-3)} className="text-xs font-bold rounded-full px-3 py-1.5" style={{ backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>‹ earlier</button>
        <span className="text-sm font-bold" style={{ color: '#1a1a1a' }}>{monthLabel(start.slice(0, 7))} – {monthLabel(end.slice(0, 7))}</span>
        <button onClick={() => shift(3)} className="text-xs font-bold rounded-full px-3 py-1.5" style={{ backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>later ›</button>
        <button onClick={() => window.print()} className="text-xs font-bold rounded-full px-3 py-1.5" style={{ backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>🖨 Print</button>
      </div>
      <div className="flex gap-1.5 flex-wrap mb-4">
        {Object.entries(TYPES).map(([t, [em, label, color]]) => <button key={t} onClick={() => setOff(o => ({ ...o, [t]: !o[t] }))} className="text-[11px] font-bold rounded-full px-2.5 py-1" style={off[t] ? { backgroundColor: '#f5f3f0', color: '#aaa' } : { backgroundColor: 'white', color, border: `1px solid ${color}` }}>{em} {label}</button>)}
      </div>
      {err && <div className="text-sm" style={{ color: '#b91c1c' }}>{err}</div>}
      {!data && !err && <div className="text-sm py-6 text-center" style={{ color: '#888' }}>Loading…</div>}
      {Object.entries(byMonth).sort().map(([ym, days]) => (
        <div key={ym} className="mb-5">
          <div className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>{monthLabel(ym)}</div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e8e4e0', backgroundColor: 'white' }}>
            {Object.entries(days).sort().map(([d, evs]) => (
              <div key={d} className="flex gap-3 px-3 py-2" style={{ borderTop: '1px solid #f3f3f3', backgroundColor: d === today ? '#fff5f0' : 'white' }}>
                <div className="w-24 flex-shrink-0 text-sm font-bold" style={{ color: d === today ? ORANGE : '#1a1a1a' }}>{dayLabel(d)}{d === today ? ' · today' : ''}</div>
                <div className="flex-1 space-y-0.5">{evs.map((e, i) => <div key={i} className="text-sm" style={{ color: TYPES[e.type]?.[2] || '#333', fontWeight: e.mine ? 700 : 500 }}>{e.title}</div>)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {data && events.length === 0 && <div className="text-sm py-6 text-center" style={{ color: '#888' }}>Nothing in this window.</div>}
      <div className="text-xs mt-2" style={{ color: '#888' }}>Mark gets a Cliq note at 7am for birthdays, anniversaries, and anything expiring within 30 days.</div>
    </div>
  )
}
