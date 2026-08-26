// Browser softphone — floating widget on every screen for admins.
// Twilio Voice SDK registers as client "aa-desk"; when On Duty, inbound
// 844 calls ring HERE first (voice.js cascade), then fall through to the
// cells. Off duty = exactly the old behavior.
//
// States: off → ready (registered, waiting) → incoming → in-call.
// Also a dialer: outbound calls go out from the 844 line via the
// client-outgoing TwiML app.

import { useEffect, useState, useRef, useCallback } from 'react'
import { Device } from '@twilio/voice-sdk'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'
const GREEN = '#15803d'
const RED = '#dc2626'

function fmtPhone(input) {
  const d = String(input || '').replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  return input || ''
}

// `showControls` — the on-duty pill + dialer render only on the SMS
// page (Mark 2026-08-12: "I want this on the same page as the SMS").
// The Device stays registered app-wide so an incoming call still pops
// its banner on ANY screen — only the idle controls are page-scoped.
export default function SoftphonePanel({ showControls = true }) {
  const [duty, setDuty] = useState(false)        // backend flag
  const [phase, setPhase] = useState('off')      // off|starting|ready|incoming|incall|error
  const [call, setCall] = useState(null)         // active/incoming Twilio Call
  const [callerLabel, setCallerLabel] = useState('')
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [open, setOpen] = useState(false)        // dialer popover
  const [dialTo, setDialTo] = useState('')
  const [err, setErr] = useState('')
  const deviceRef = useRef(null)
  const timerRef = useRef(null)
  const dutyRef = useRef(false)
  const phaseRef = useRef('off')
  // Audible ring — generated with WebAudio (no asset needed) so a call
  // is HEARD even when the app tab is buried behind other windows.
  const ringRef = useRef(null)

  function startRinging() {
    stopRinging()
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const ring = { ctx, timer: null, stopped: false }
      const burst = () => {
        if (ring.stopped) return
        // Classic dual-tone ring: 440+480 Hz, 1.2s on
        for (const freq of [440, 480]) {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.frequency.value = freq
          gain.gain.setValueAtTime(0.08, ctx.currentTime)
          gain.gain.setValueAtTime(0, ctx.currentTime + 1.2)
          osc.connect(gain).connect(ctx.destination)
          osc.start()
          osc.stop(ctx.currentTime + 1.25)
        }
      }
      burst()
      ring.timer = setInterval(burst, 3000)  // ring every 3s like a phone
      ringRef.current = ring
    } catch { /* no audio available — banner still shows */ }
  }
  function stopRinging() {
    const r = ringRef.current
    if (!r) return
    r.stopped = true
    clearInterval(r.timer)
    try { r.ctx.close() } catch {}
    ringRef.current = null
  }

  // Desktop notification — surfaces the call when the tab is buried.
  function notifyIncoming(label) {
    try {
      if (!('Notification' in window)) return
      const show = () => {
        const n = new Notification('📞 Incoming call — 844 line', {
          body: label || 'Unknown caller', tag: 'aa-incoming-call', requireInteraction: true,
        })
        n.onclick = () => { window.focus(); n.close() }
      }
      if (Notification.permission === 'granted') show()
      else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => p === 'granted' && show())
    } catch { /* banner still shows */ }
  }

  // Backend duty flag on load — resume registration if Kat was on duty.
  useEffect(() => {
    apiFetch(`${API_BASE}/api/softphone/status`)
      .then(r => r.json())
      .then(j => { if (j.on) { setDuty(true); startDevice() } })
      .catch(() => {})
    return () => stopDevice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wake recovery: laptop sleep / long background kills the connection.
  // On tab focus or network return, if we're supposed to be on duty but
  // the device is gone or unregistered, restart it with a fresh token.
  useEffect(() => {
    const revive = () => {
      const d = deviceRef.current
      const dead = !d || d.state === 'destroyed' || d.state === 'unregistered'
      if (dutyRef.current && dead && phaseRef.current !== 'starting') {
        try { d?.destroy() } catch {}
        deviceRef.current = null
        startDevice()
      }
    }
    const onVis = () => { if (document.visibilityState === 'visible') revive() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', revive)
    window.addEventListener('focus', revive)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', revive)
      window.removeEventListener('focus', revive)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startTimer() {
    setElapsed(0)
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
  }
  function stopTimer() { clearInterval(timerRef.current) }
  useEffect(() => { dutyRef.current = duty }, [duty])
  useEffect(() => { phaseRef.current = phase }, [phase])

  const wireCall = useCallback((c, direction) => {
    setCall(c)
    setMuted(false)
    if (direction === 'incoming') {
      setPhase('incoming')
      const from = c.parameters?.From || ''
      setCallerLabel(fmtPhone(from))
      startRinging()
      notifyIncoming(fmtPhone(from))
      apiFetch(`${API_BASE}/api/softphone/lookup?phone=${encodeURIComponent(from)}`)
        .then(r => r.json())
        .then(j => {
          const name = [j.contact_name, j.shop_name].filter(Boolean).join(' · ')
          if (name) setCallerLabel(`${name} — ${fmtPhone(from)}`)
        }).catch(() => {})
    }
    c.on('accept', () => { stopRinging(); setPhase('incall'); startTimer() })
    c.on('disconnect', () => { stopRinging(); setPhase('ready'); setCall(null); stopTimer() })
    c.on('cancel', () => { stopRinging(); setPhase('ready'); setCall(null); stopTimer() })
    c.on('reject', () => { stopRinging(); setPhase('ready'); setCall(null) })
    c.on('error', e => { console.warn('[softphone call]', e.message); stopRinging(); setPhase('ready'); setCall(null); stopTimer() })
  }, [])

  async function fetchToken() {
    const r = await apiFetch(`${API_BASE}/api/softphone/token`)
    const j = await r.json()
    if (!r.ok || !j.token) throw new Error(j.error || 'Could not get phone token')
    return j.token
  }

  async function startDevice() {
    if (deviceRef.current) return
    setPhase('starting')
    setErr('')
    try {
      const token = await fetchToken()
      // tokenRefreshMs: fire tokenWillExpire 10 MINUTES early — Chrome
      // throttles background-tab timers, so the 10s default misses and
      // the token dies (AccessTokenExpired 20104).
      const device = new Device(token, { logLevel: 'error', tokenRefreshMs: 600000 })
      deviceRef.current = device
      device.on('registered', () => setPhase('ready'))
      device.on('incoming', c => wireCall(c, 'incoming'))
      device.on('tokenWillExpire', async () => {
        try { device.updateToken(await fetchToken()) } catch (e) { console.warn('[softphone] token refresh:', e.message) }
      })
      device.on('error', e => {
        console.warn('[softphone device]', e.message)
        // Expired token (20104): self-heal with a fresh token instead of
        // stranding Kat on a dead "reset" state. Full restart (destroy +
        // register) because an expired device may not accept updateToken.
        if (e?.code === 20104) {
          try { deviceRef.current?.destroy() } catch {}
          deviceRef.current = null
          setPhase('starting')
          setTimeout(() => startDevice(), 1500)
          return
        }
        setErr(e.message)
        setPhase('error')
      })
      await device.register()
    } catch (e) {
      setErr(e.message)
      setPhase('error')
      deviceRef.current?.destroy()
      deviceRef.current = null
    }
  }

  function stopDevice() {
    stopTimer()
    stopRinging()
    try { deviceRef.current?.destroy() } catch {}
    deviceRef.current = null
    setCall(null)
    setPhase('off')
  }

  async function toggleDuty() {
    const next = !duty
    setDuty(next)
    try {
      await apiFetch(`${API_BASE}/api/softphone/duty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: next }),
      })
    } catch { /* backend flag is best-effort; device state is what rings */ }
    if (next) startDevice()
    else stopDevice()
  }

  async function dialOut() {
    const to = dialTo.replace(/[^\d+]/g, '')
    if (!to || !deviceRef.current) return
    try {
      const c = await deviceRef.current.connect({ params: { To: to } })
      setCallerLabel(fmtPhone(to))
      wireCall(c, 'outgoing')
      setPhase('incall')
      startTimer()
      setOpen(false)
    } catch (e) { setErr(e.message) }
  }

  async function transfer(who) {
    if (!call) return
    try {
      const sid = call.parameters?.CallSid
      const r = await apiFetch(`${API_BASE}/api/softphone/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_sid: sid, to: who }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      // Parent redirect drops our leg; the disconnect handler cleans up.
    } catch (e) { setErr(e.message) }
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2" style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Incoming call banner */}
      {phase === 'incoming' && call && (
        <div className="rounded-2xl p-4 shadow-2xl" style={{ backgroundColor: '#1a1a1a', color: 'white', minWidth: 280 }}>
          <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: '#9ca3af' }}>📞 Incoming — 844 line</div>
          <div className="text-sm font-bold mb-3">{callerLabel || 'Unknown caller'}</div>
          <div className="flex gap-2">
            <button onClick={() => call.accept()}
              className="flex-1 text-sm font-bold rounded-xl px-4 py-2.5 text-white" style={{ backgroundColor: GREEN }}>✓ Answer</button>
            <button onClick={() => call.reject()}
              className="flex-1 text-sm font-bold rounded-xl px-4 py-2.5 text-white" style={{ backgroundColor: RED }}>✕ Decline</button>
          </div>
          <div className="text-[10px] mt-2" style={{ color: '#9ca3af' }}>Declining sends it down the normal ring order.</div>
        </div>
      )}

      {/* Active call card */}
      {phase === 'incall' && call && (
        <div className="rounded-2xl p-4 shadow-2xl" style={{ backgroundColor: '#1a1a1a', color: 'white', minWidth: 280 }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold">{callerLabel || 'On call'}</span>
            <span className="text-xs font-mono" style={{ color: '#86efac' }}>{mm}:{ss}</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => { call.mute(!muted); setMuted(!muted) }}
              className="text-xs font-bold rounded-lg px-3 py-2"
              style={{ backgroundColor: muted ? '#f59e0b' : '#374151', color: 'white' }}>{muted ? '🔇 Muted' : '🎙 Mute'}</button>
            <button onClick={() => transfer('jayden')}
              className="text-xs font-bold rounded-lg px-3 py-2" style={{ backgroundColor: '#0e7490', color: 'white' }}>→ Jayden</button>
            <button onClick={() => transfer('mark')}
              className="text-xs font-bold rounded-lg px-3 py-2" style={{ backgroundColor: '#0e7490', color: 'white' }}>→ Mark</button>
            <button onClick={() => call.disconnect()}
              className="text-xs font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: RED }}>End</button>
          </div>
        </div>
      )}

      {/* Dialer popover */}
      {showControls && open && phase === 'ready' && (
        <div className="rounded-2xl p-3 shadow-2xl bg-white" style={{ border: '1px solid #ebebeb', minWidth: 240 }}>
          <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: '#888' }}>Call from 844 line</div>
          <div className="flex gap-2">
            <input value={dialTo} onChange={e => setDialTo(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && dialOut()}
              placeholder="(425) 555-1234" type="tel"
              className="flex-1 text-sm px-3 py-2 rounded-lg"
              style={{ border: '1px solid #e0dbd6', fontSize: 16 }} />
            <button onClick={dialOut} className="text-sm font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: GREEN }}>📞</button>
          </div>
        </div>
      )}

      {err && phase === 'error' && (
        <div className="rounded-xl px-3 py-2 text-xs shadow-lg" style={{ backgroundColor: '#fee2e2', color: '#991b1b', maxWidth: 280 }}>
          Phone error: {err} <button className="underline ml-1" onClick={() => { setErr(''); stopDevice(); }}>reset</button>
        </div>
      )}

      {/* Status pill — SMS page only */}
      {showControls && <div className="flex items-center gap-2">
        {(phase === 'ready') && (
          <button onClick={() => setOpen(o => !o)}
            className="w-10 h-10 rounded-full shadow-lg text-lg bg-white" style={{ border: '1px solid #ebebeb' }}
            title="Open dialer">☎️</button>
        )}
        <button onClick={toggleDuty}
          className="flex items-center gap-2 text-xs font-bold rounded-full px-4 py-2.5 shadow-lg"
          style={duty
            ? { backgroundColor: GREEN, color: 'white' }
            : { backgroundColor: 'white', color: '#666', border: '1px solid #e0dbd6' }}
          title="On duty = calls to 844 ring this browser first"
        >
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: duty ? '#86efac' : '#d1d5db' }} />
          {phase === 'starting' ? 'Connecting…' : duty ? 'On duty — desk rings first' : '📞 Desk phone off'}
        </button>
      </div>}
    </div>
  )
}
