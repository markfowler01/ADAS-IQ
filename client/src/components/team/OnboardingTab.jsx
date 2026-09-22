// Every hire in flight, one page (Mark 2026-09-22: "next year we're gonna
// be hiring several people"). Tap a card → the Launch view. Owners also set
// the welcome video + first-day plan the portal shows every new hire.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch, ORANGE } from '../books/shared'
import { Avatar } from './Directory.jsx'
import OnboardingLaunch from './OnboardingLaunch.jsx'

const GREEN = '#15803d', RED = '#b91c1c'
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
const fmt = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''
const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }

export default function OnboardingTab({ onOpenProfile, launchId, onLaunchClose }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(launchId || null)
  const [edit, setEdit] = useState(false)
  const [w, setW] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => j('/api/people/onboarding').then(x => { setD(x); setW(x.welcome) }).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  useEffect(() => { if (launchId) setOpen(launchId) }, [launchId])
  async function saveWelcome() { setBusy(true); try { await j('/api/people/onboarding/welcome', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(w) }); setEdit(false); await load() } catch (e) { alert(e.message) } finally { setBusy(false) } }
  if (err) return <div className="text-sm" style={{ color: RED }}>{err}</div>
  if (!d) return <div className="text-sm py-6 text-center" style={{ color: '#888' }}>Loading…</div>
  const inflight = d.hires.filter(h => !h.completed_at), recent = d.hires.filter(h => h.completed_at)
  const Card = ({ h }) => {
    const blockers = h.ours.overdue.length, today = h.ours.due_today.length
    return (
      <button onClick={() => setOpen(h.id)} className="text-left rounded-2xl p-4 bg-white w-full" style={{ border: `1.5px solid ${blockers ? '#fecaca' : '#e8e4e0'}` }}>
        <div className="flex items-center gap-3">
          <Avatar m={h} size={48} />
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-base leading-tight" style={{ color: '#1a1a1a' }}>{h.preferred_name ? `${h.preferred_name} ${h.name.split(' ').slice(1).join(' ')}` : h.name}</div>
            <div className="text-xs" style={{ color: '#666' }}>{h.title} · {h.track}{h.hire_date ? ` · ${h.days_to_start > 0 ? `starts ${fmt(h.hire_date)} (${h.days_to_start}d)` : h.days_to_start === 0 ? 'starts TODAY' : `day ${-h.days_to_start + 1}`}` : ' · no start date'}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-xl font-extrabold" style={{ color: h.portal_pct === 100 ? GREEN : ORANGE }}>{h.portal_pct}%</div>
            <div className="text-[10px]" style={{ color: '#888' }}>their side</div>
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap mt-3 text-[11px] font-bold">
          <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#fff7ed', color: '#b45309' }}>ours {h.ours.done}/{h.ours.total}</span>
          {blockers > 0 && <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#fef2f2', color: RED }}>⚠ {blockers} overdue</span>}
          {today > 0 && <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#fffbeb', color: '#b45309' }}>{today} due today</span>}
          {!h.invited_at && <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#fef2f2', color: RED }}>link not sent</span>}
          {h.access !== 'none' && h.access && <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#dcfce7', color: GREEN }}>🔓 login on</span>}
          {h.ours.next && !blockers && !today && <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#f5f3f0', color: '#666' }}>next: {h.ours.next.label.split(' — ')[0].slice(0, 40)}{h.ours.next.due_date ? ` · ${fmt(h.ours.next.due_date)}` : ''}</span>}
        </div>
      </button>
    )
  }
  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div className="text-sm" style={{ color: '#555' }}>{inflight.length ? `${inflight.length} hire${inflight.length === 1 ? '' : 's'} in flight.` : 'Nobody onboarding right now.'} Press <b>Hired</b> on a candidate in Recruiting and they show up here.</div>
        <button onClick={() => { setEdit(e => !e) }} className="text-xs font-bold rounded-full px-3 py-1.5" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>🎬 {edit ? 'Close' : 'Welcome video + first day'}</button>
      </div>
      {edit && w && (
        <div className="rounded-2xl p-4 mb-4" style={{ backgroundColor: '#fff5f0', border: `1.5px solid ${ORANGE}` }}>
          <div className="text-xs font-bold mb-2" style={{ color: '#1a1a1a' }}>What every new hire sees first on their portal — before any paperwork.</div>
          <label className="block text-[11px] font-bold mb-2" style={{ color: '#888' }}>Kinetic support email (for the one-tap "add this tech" request)<input value={w.kinetic_email || ''} onChange={e => setW(x => ({ ...x, kinetic_email: e.target.value }))} placeholder="support@kinetic…" className="w-full text-sm rounded-lg px-3 py-2 mt-0.5 font-normal" style={inp} /></label>
          <label className="block text-[11px] font-bold mb-2" style={{ color: '#888' }}>Welcome video (YouTube or WorkDrive link — record it once on your phone, 60 seconds)<input value={w.video_url} onChange={e => setW(x => ({ ...x, video_url: e.target.value }))} placeholder="https://youtu.be/…" className="w-full text-sm rounded-lg px-3 py-2 mt-0.5 font-normal" style={inp} /></label>
          <label className="block text-[11px] font-bold mb-2" style={{ color: '#888' }}>A note from you<textarea value={w.note} onChange={e => setW(x => ({ ...x, note: e.target.value }))} rows={3} className="w-full text-sm rounded-lg px-3 py-2 mt-0.5 font-normal" style={inp} /></label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
            <label className="block text-[11px] font-bold" style={{ color: '#888' }}>Day one — time<input value={w.first_day.time} onChange={e => setW(x => ({ ...x, first_day: { ...x.first_day, time: e.target.value } }))} className="w-full text-sm rounded-lg px-3 py-2 mt-0.5 font-normal" style={inp} /></label>
            <label className="block text-[11px] font-bold sm:col-span-2" style={{ color: '#888' }}>Where / who to meet<input value={w.first_day.where} onChange={e => setW(x => ({ ...x, first_day: { ...x.first_day, where: e.target.value } }))} className="w-full text-sm rounded-lg px-3 py-2 mt-0.5 font-normal" style={inp} /></label>
          </div>
          <label className="block text-[11px] font-bold mb-3" style={{ color: '#888' }}>What to bring<input value={w.first_day.bring} onChange={e => setW(x => ({ ...x, first_day: { ...x.first_day, bring: e.target.value } }))} className="w-full text-sm rounded-lg px-3 py-2 mt-0.5 font-normal" style={inp} /></label>
          <div className="text-[11px] mb-2" style={{ color: '#888' }}>The same time / where / bring goes out as a text at 7am on their first morning.</div>
          <button onClick={saveWelcome} disabled={busy} className="text-sm font-bold rounded-xl px-4 py-2 text-white" style={{ backgroundColor: GREEN }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{inflight.map(h => <Card key={h.id} h={h} />)}</div>
      {recent.length > 0 && <><div className="text-[10px] uppercase tracking-wider font-semibold mt-6 mb-2" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Finished in the last two weeks</div><div className="grid grid-cols-1 md:grid-cols-2 gap-3">{recent.map(h => <Card key={h.id} h={h} />)}</div></>}
      {open && <OnboardingLaunch memberId={open} onClose={() => { setOpen(null); onLaunchClose && onLaunchClose(); load() }} onOpenProfile={id => { setOpen(null); onOpenProfile && onOpenProfile(id) }} />}
    </div>
  )
}
