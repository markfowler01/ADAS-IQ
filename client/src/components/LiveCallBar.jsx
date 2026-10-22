// 📞 Live-call bar (Mark 2026-10-05: "with Grasshopper I used to hit ## and an
// extension and it used to transfer it"). While someone is on an 844 call the
// server knows it (Twilio leg callbacks); this bar shows that person — and Mark —
// who is on the line and one-tap Transfer → Mark · Jayden · Kat · Desk · Voicemail.
// Polls /api/voice/live every 4s while the tab is visible; the push notification
// ("On a call — …") opens the app with ?live=1 so the bar is the first thing seen.
import { useEffect, useState, useCallback, useRef } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import CallerDrawer from './CallerDrawer.jsx'

const TARGETS = [
  { key: 'mark', label: 'Mark' },
  { key: 'jayden', label: 'Jayden' },
  { key: 'kat', label: 'Kat' },
  { key: 'desk', label: 'Desk' },
  { key: 'voicemail', label: 'Voicemail' },
]
const GREEN = '#15803d'

export default function LiveCallBar({ user, onNavigate }) {
  const [drawer, setDrawer] = useState(() => { try { const p = sessionStorage.getItem('adas_open_caller'); if (p) { sessionStorage.removeItem('adas_open_caller'); return { phone: p, context: 'Incoming call' } } } catch {} return null })
  const seen = useRef(new Set())
  const [calls, setCalls] = useState([])
  const [me, setMe] = useState('')
  const [busy, setBusy] = useState('')      // `${sid}:${to}` while a transfer is in flight
  const [msg, setMsg] = useState('')
  const [warm, setWarm] = useState(() => { try { return localStorage.getItem('adas_xfer_warm') === '1' } catch { return false } })   // 🤝 talk to them first
  const timer = useRef(null)
  const [sheetOff, setSheetOff] = useState(() => new Set())   // calls where 'Stay on the call' was tapped
  // 📞 Calls this phone already handed off (Mark 2026-10-22: a second tap on the sender's
  // phone was sending calls back to Kat). Once sent, no more buttons for that call here.
  const [sent, setSent] = useState(() => ({}))
  const markSent = (sid, name) => { setSent(m => ({ ...m, [sid]: name })); setSheetOff(x => new Set([...x, sid])) }
  const holdTimer = useRef(null)

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/api/voice/live`)
      if (!r.ok) return
      const j = await r.json()
      const list = Array.isArray(j.calls) ? j.calls : []
      setCalls(list)
      setMe(j.me || '')
      // Pop the caller card once per call for the person it concerns (ringing → anyone
      // who is not a tech; answered → the one on it, and Mark). Techs only for their own.
      for (const c of list) {
        if (seen.current.has(c.sid)) continue
        seen.current.add(c.sid)
        const me = j.me || ''
        const mine = c.who === me || (c.status === 'ringing' && user?.role !== 'technician') || me === 'mark'
        // On a phone, your own answered call gets the big transfer sheet instead — the caller card
        // used to cover the transfer buttons (Kat 2026-10-13, call dropped before she found them).
        const ownLive = c.who === me && c.status !== 'ringing' && window.innerWidth < 768
        if (mine && !ownLive && c.from && document.visibilityState === 'visible') setDrawer(d => d || { phone: c.from, context: c.status === 'ringing' ? 'Ringing' : 'On a call' })
      }
    } catch { /* keep the last state */ }
  }, [])

  useEffect(() => {
    let alive = true
    const tick = async () => { if (!alive) return; if (document.visibilityState === 'visible') await load(); timer.current = setTimeout(tick, calls.length ? 3000 : 5000) }
    tick()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVis) }
  }, [load, calls.length])

  async function transfer(call, to) {
    const name = TARGETS.find(t => t.key === to)?.label || to
    const isWarm = warm && to !== 'voicemail' && call.status !== 'ringing'
    setBusy(`${call.sid}:${to}`); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/voice/transfer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: call.sid, to, mode: isWarm ? 'warm' : 'cold' }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setMsg(isWarm ? `🤝 Caller on hold — your phone is ringing with ${name}…` : `↪️ Transferring to ${name}…`)
      if (!isWarm) markSent(call.sid, name)
      setCalls(prev => prev.map(c => c.sid === call.sid ? { ...c, transferring_to: to, status: isWarm ? 'consulting' : c.status } : c))
      setTimeout(load, 2500)
    } catch (e) { setMsg(`⚠ ${e.message}`) }
    finally { setBusy('') }
  }
  async function warmAction(call, action) {   // 'complete' | 'cancel'
    setBusy(`${call.sid}:${action}`); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/voice/transfer/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: call.sid }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setMsg(action === 'complete' ? '✅ Handed off — you can hang up.' : '↩️ Taking the caller back…')
      setTimeout(load, 2000)
    } catch (e) { setMsg(`⚠ ${e.message}`) }
    finally { setBusy('') }
  }

  if (!calls.length && !drawer) return null
  const elapsed = iso => { const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

  // 📱 One-tap transfer sheet (Mark 2026-10-13): on a phone, your own live call opens full screen with
  // one giant "Transfer to Mark" button (cold, instant). Opened by the "On a call" notification too.
  const sheetCall = !(drawer && drawer.fromSheet) && typeof window !== 'undefined' && window.innerWidth < 768
    ? calls.find(c => c.who === me && me && c.status !== 'ringing' && c.status !== 'consulting' && !c.transferring_to && !sheetOff.has(c.sid))
    : null
  const primary = sheetCall ? (sheetCall.who === 'mark' ? 'kat' : 'mark') : ''
  const primaryLabel = TARGETS.find(t => t.key === primary)?.label || ''
  const coldTransfer = (c, to) => { setWarm(false); try { localStorage.setItem('adas_xfer_warm', '0') } catch {} ; const name = TARGETS.find(t => t.key === to)?.label || to; setBusy(`${c.sid}:${to}`); setMsg('')
    apiFetch(`${API_BASE}/api/voice/transfer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: c.sid, to, mode: 'cold' }) })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); setMsg(`↪️ Transferring to ${name}… you can hang up.`); markSent(c.sid, name); setCalls(prev => prev.map(x => x.sid === c.sid ? { ...x, transferring_to: to } : x)); setTimeout(load, 2500) })
      .catch(e => setMsg(`⚠ Transfer failed: ${e.message}`)).finally(() => setBusy('')) }

  return (<>
    {sheetCall && (() => { const c = sheetCall; const label = [c.caller_name, c.shop_name].filter(Boolean).join(' · ') || c.from_pretty || 'Caller'
      return (
        <div className="fixed inset-0 z-[70] flex flex-col p-5 text-white" style={{ backgroundColor: '#0f3d22' }}>
          <div className="text-xs font-bold uppercase tracking-widest opacity-80">📞 You're on a call · {elapsed(c.answered_at)}</div>
          <div className="text-2xl font-extrabold mt-1 leading-tight">{label}</div>
          {c.from_pretty && label !== c.from_pretty && <div className="text-sm opacity-80">{c.from_pretty}</div>}
          <div className="flex-1 flex flex-col justify-center gap-3">
            <button disabled={!!busy || !!sent[c.sid]}
              // Mark's phone is at his ear: hold ~1s so a cheek can't send the call to Kat.
              onClick={() => { if (me !== 'mark') coldTransfer(c, primary) }}
              onPointerDown={() => { if (me !== 'mark') return; clearTimeout(holdTimer.current); holdTimer.current = setTimeout(() => coldTransfer(c, primary), 900) }}
              onPointerUp={() => clearTimeout(holdTimer.current)} onPointerLeave={() => clearTimeout(holdTimer.current)} onPointerCancel={() => clearTimeout(holdTimer.current)}
              className="w-full rounded-3xl font-extrabold text-white active:scale-[0.98] transition"
              style={{ backgroundColor: '#16a34a', fontSize: 30, padding: '34px 16px', boxShadow: '0 14px 40px rgba(22,163,74,0.45)' }}>
              {busy === `${c.sid}:${primary}` ? 'Transferring…' : me === 'mark' ? `✋ Hold to transfer to ${primaryLabel}` : `➡️ Transfer to ${primaryLabel}`}
            </button>
            <div className="grid grid-cols-3 gap-2">
              {TARGETS.filter(t => t.key !== c.who && t.key !== primary).map(t => (
                <button key={t.key} disabled={!!busy} onClick={() => coldTransfer(c, t.key)} className="rounded-2xl font-bold py-4 text-base" style={{ backgroundColor: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.25)' }}>{busy === `${c.sid}:${t.key}` ? '…' : t.label}</button>
              ))}
            </div>
            {msg && <div className="text-center text-base font-semibold mt-1">{msg}</div>}
            <div className="text-center text-xs opacity-70">The caller goes straight to them. You can hang up once it says transferring.</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setDrawer({ phone: c.from, context: 'On a call', fromSheet: true })} className="rounded-2xl font-bold py-3" style={{ backgroundColor: 'rgba(255,255,255,0.14)' }}>📇 Caller card</button>
            <button onClick={() => setSheetOff(s => new Set([...s, c.sid]))} className="rounded-2xl font-bold py-3" style={{ backgroundColor: 'rgba(255,255,255,0.14)' }}>Stay on the call</button>
          </div>
        </div>) })()}
    {drawer && !(sheetCall && !drawer.fromSheet) && <CallerDrawer phone={drawer.phone} user={user} context={drawer.context} onNavigate={onNavigate} onClose={() => setDrawer(null)} />}
    {calls.length > 0 && <div className="sticky top-0 z-50 px-3 py-2 text-white" style={{ backgroundColor: GREEN, boxShadow: '0 2px 8px rgba(0,0,0,0.25)' }}>
      {calls.map(c => {
        const label = [c.caller_name, c.shop_name].filter(Boolean).join(' · ') || 'Unknown caller'
        const onWith = c.who === me ? 'you' : c.who_name
        const ringing = c.status === 'ringing' || !c.who
        const consulting = c.status === 'consulting'
        const xfer = c.transferring_to ? TARGETS.find(t => t.key === c.transferring_to)?.label || c.transferring_to : ''
        return (
          <div key={c.sid} className="flex items-center gap-2 flex-wrap">
            <span className="text-base">{ringing ? '🔔' : '📞'}</span>
            <button onClick={() => setDrawer({ phone: c.from, context: ringing ? 'Ringing' : 'On a call' })} className="flex-1 min-w-0 text-left" title="Open the caller card">
              <div className="font-bold text-sm truncate underline decoration-dotted underline-offset-2">{label}{c.from_pretty ? <span className="font-normal opacity-90 no-underline"> · {c.from_pretty}</span> : null}</div>
              <div className="text-[11px] opacity-90">{consulting ? `🤝 Caller on hold · ${c.target_answered ? `you're talking to ${xfer}` : `calling ${xfer}…`}` : xfer ? `Transferring to ${xfer}…` : ringing ? `Ringing the 844 · ${elapsed(c.answered_at)} · tap for the caller card` : `On a call with ${onWith}${c.transferred_from ? ` (from ${c.transferred_from})` : ''} · ${elapsed(c.answered_at)}`}</div>
            </button>
            {consulting && (c.who === me || me === 'mark') && (
              <div className="flex items-center gap-1 flex-wrap">
                <button disabled={!!busy || !c.target_answered} onClick={() => warmAction(c, 'complete')} className="text-xs font-bold px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: 'white', color: GREEN, opacity: c.target_answered ? 1 : 0.5 }} title={c.target_answered ? 'Hand the caller to them and drop off' : 'Waiting for them to answer'}>{busy === `${c.sid}:complete` ? '…' : '✅ Complete transfer'}</button>
                <button disabled={!!busy} onClick={() => warmAction(c, 'cancel')} className="text-xs font-bold px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.18)', color: 'white' }}>{busy === `${c.sid}:cancel` ? '…' : '↩️ Take caller back'}</button>
              </div>
            )}
            {sent[c.sid] && !consulting && <span className="text-xs font-bold px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: 'white', color: GREEN }}>✅ Sent to {sent[c.sid]} — you can hang up</span>}
            {!xfer && !consulting && !sent[c.sid] && (ringing || c.who === me || me === 'mark') && (
              <div className="flex items-center gap-1 flex-wrap">
                {!ringing && (
                  <button onClick={() => setWarm(w => { try { localStorage.setItem('adas_xfer_warm', w ? '0' : '1') } catch {} ; return !w })}
                    className="text-[11px] font-bold px-2 py-1 rounded-lg mr-1" title={warm ? 'Warm: you talk to them first, then hand off' : 'Cold: the caller goes straight to them'}
                    style={{ backgroundColor: warm ? 'white' : 'rgba(255,255,255,0.18)', color: warm ? GREEN : 'white' }}>{warm ? '🤝 Warm' : '⚡ Cold'}</button>
                )}
                <span className="text-[11px] font-bold uppercase tracking-wider opacity-90 mr-1">{ringing ? 'Send to →' : 'Transfer →'}</span>
                {TARGETS.filter(t => t.key !== c.who).map(t => (
                  <button key={t.key} disabled={!!busy} onClick={() => transfer(c, t.key)}
                    className="text-xs font-bold px-2.5 py-1.5 rounded-lg"
                    style={{ backgroundColor: t.key === 'voicemail' ? 'rgba(255,255,255,0.18)' : 'white', color: t.key === 'voicemail' ? 'white' : GREEN, opacity: busy && busy !== `${c.sid}:${t.key}` ? 0.6 : 1 }}>
                    {busy === `${c.sid}:${t.key}` ? '…' : t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {msg && <div className="text-xs mt-1 opacity-95">{msg}</div>}
    </div>}
  </>)
}
