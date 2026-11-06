// Time card review at login (Mark 2026-09-16): on the 15th and the last
// day of the month (and the few days after, until it's done) everyone
// gets their own period laid out day by day — approve it in one tap, or
// tap "Fix this" on a shift to send Mark a correction. Nothing changes
// until Mark approves a fix.
// Hard gate (Mark 2026-10-15): no close, no "later", no once-a-day skip.
// The screen stays until this period is approved.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419', GREEN = '#15803d', RED = '#b91c1c'
const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const h = m => `${(Number(m || 0) / 60).toFixed(2)}h`
const fmtDay = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }) : 'open'
// <input type=datetime-local> value in PT for an ISO instant
function toLocalPT(iso) {
  if (!iso) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}
function fromLocalPT(v) {
  // Interpret the wall-clock value as Pacific time (DST-aware) → ISO
  if (!v) return ''
  for (const off of ['-07:00', '-08:00']) {
    const d = new Date(`${v}:00${off}`)
    if (toLocalPT(d.toISOString()) === v) return d.toISOString()
  }
  return new Date(`${v}:00-07:00`).toISOString()
}

export default function TimeClockReview({ user }) {
  const [data, setData] = useState(null)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [fix, setFix] = useState(null)   // { shiftId, in, out, note }

  useEffect(() => {
    // Mark 2026-11-06: opens 2 days before the period ends (Mon–Fri only) so
    // hours are done before payday; the server decides (reviewDue in hr.js).
    // Re-checked when the app comes back up, so a phone left open overnight
    // still asks first thing in the morning.
    const check = () => {
      const day = todayPT()
      const d = Number(day.slice(8, 10)), wd = new Date(day + 'T12:00:00Z').getUTCDay()
      const maybeDue = wd >= 1 && wd <= 5 && ((d >= 11 && d <= 19) || d >= 24 || d <= 4)
      if (!maybeDue) return
      apiFetch(`${API_BASE}/api/timeclock/period-review`).then(r => r.json()).then(j => {
        if (!j?.ok || !j.due || j.attested) return
        setData(j); setShow(true)
      }).catch(() => {})
    }
    check()
    const onVis = () => { if (!document.hidden) check() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    if (!show) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [show])

  if (!show || !data) return null
  const { period, days, total_minutes, open, pay } = data
  const hh = n => `${Number(n || 0).toFixed(2)}h`

  async function refresh() {
    const rr = await apiFetch(`${API_BASE}/api/timeclock/period-review`).then(x => x.json()).catch(() => null)
    if (rr?.ok) setData(rr)
  }
  async function clockOut() {
    setBusy('out'); setMsg('')
    try {
      let location = null
      if (user?.role === 'technician' && navigator.geolocation) {
        location = await new Promise(resolve => {
          navigator.geolocation.getCurrentPosition(
            pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
            () => resolve(null),
            { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 },
          )
        })
      }
      const r = await apiFetch(`${API_BASE}/api/timeclock/clock-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(location ? { location } : {}),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      await refresh()
      setMsg('Clocked out. Check the total, then approve.')
    } catch (e) { setMsg(`Couldn't clock out: ${e.message}`) } finally { setBusy('') }
  }
  async function approve() {
    setBusy('approve'); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/timeclock/period-review/attest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: period.start, end: period.end, total_minutes }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setMsg('✓ Approved — thanks. GET SOME!!!')
      setTimeout(() => setShow(false), 1500)
    } catch (e) { setMsg(`Couldn't save: ${e.message}`) } finally { setBusy('') }
  }
  async function sendFix() {
    setBusy('fix'); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/timeclock/entries/${fix.shiftId}/edit-request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clock_in: fromLocalPT(fix.in), clock_out: fromLocalPT(fix.out), note: fix.note }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setMsg('✓ Edit sent to Mark — approve the card to continue')
      setFix(null)
      await refresh()
    } catch (e) { setMsg(`Couldn't send: ${e.message}`) } finally { setBusy('') }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.72)' }} role="dialog" aria-modal="true">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[92vh] overflow-y-auto">
        <div className="mb-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Time card review · {period.label}</div>
          <div className="font-bold text-lg" style={{ color: '#1a1a1a' }}>{user?.name?.split(' ')[0] || 'Hey'}, approve your time card</div>
          {period.early && <div className="text-xs font-semibold mb-1 px-2 py-1 rounded-lg" style={{ backgroundColor: '#fff7ed', color: '#9a3412' }}>Pay period ends {fmtDay(period.end)}. Approve your hours so far now so payroll is on time. Keep clocking in and out as usual.</div>}
          <div className="text-xs" style={{ color: '#666' }}>This stays up until you approve. Tap ✏️ Edit on a shift that's off — Mark approves the change — then approve the card.</div>
        </div>

        <div className="rounded-2xl px-4 py-3 mb-3 flex items-center justify-between" style={{ backgroundColor: '#f5f3f0' }}>
          <div className="text-sm font-semibold" style={{ color: '#555' }}>{period.start} → {period.end} · {days.length} day{days.length === 1 ? '' : 's'}</div>
          <div className="text-2xl font-extrabold tabular-nums" style={{ color: '#1a1a1a' }}>{h(total_minutes)}</div>
        </div>
        {/* Your hours this period — worked + overtime + holiday + sick/vacation. Hours only (Mark: "keep it about time"). */}
        {pay && (
          <div className="rounded-xl px-4 py-3 mb-3" style={{ border: '1.5px solid #e0dbd6', backgroundColor: '#faf9f7' }}>
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>⏱ Your hours this period</div>
            <div className="text-sm space-y-0.5" style={{ color: '#1a1a1a' }}>
              <div className="flex justify-between"><span>Worked</span><b className="tabular-nums">{hh(pay.worked)}</b></div>
              {pay.ot > 0 && <div className="flex justify-between"><span>of which overtime (past 40h in a week)</span><b className="tabular-nums">{hh(pay.ot)}</b></div>}
              {pay.holiday > 0 && <div className="flex justify-between"><span>🎉 Holiday{pay.holidays?.length ? ` · ${pay.holidays.join(', ')}` : ''}</span><b className="tabular-nums">+{hh(pay.holiday)}</b></div>}
              {pay.sick > 0 && <div className="flex justify-between"><span>🤒 Sick leave</span><b className="tabular-nums">+{hh(pay.sick)}</b></div>}
              {pay.vacation > 0 && <div className="flex justify-between"><span>🏖 Vacation</span><b className="tabular-nums">+{hh(pay.vacation)}</b></div>}
              {pay.unpaid > 0 && <div className="flex justify-between" style={{ color: '#888' }}><span>Unpaid time off</span><span className="tabular-nums">{hh(pay.unpaid)}</span></div>}
              {pay.late > 0 && <div className="flex justify-between" style={{ color: '#888' }}><span>Includes time finished after last period closed</span><span className="tabular-nums">{hh(pay.late)}</span></div>}
              <div className="flex justify-between pt-1.5 mt-1 text-base font-extrabold" style={{ borderTop: '1px solid #e0dbd6', color: '#1a1a1a' }}><span>Total hours</span><span className="tabular-nums">{hh(pay.payable + (pay.ot || 0))}</span></div>
              {pay.sick_balance != null && <div className="text-[11px]" style={{ color: '#666' }}>Sick leave balance after this period: {hh(pay.sick_balance)}</div>}
            </div>
          </div>
        )}
        {open > 0 && (
          <div className="text-xs font-semibold mb-2 px-3 py-2 rounded-lg flex items-center justify-between gap-2" style={{ backgroundColor: '#fef2f2', color: RED }}>
            <span>⏱ You're still clocked in on {open} shift{open > 1 ? 's' : ''}. Clock out so the total is right, then approve.</span>
            <button type="button" onClick={clockOut} disabled={!!busy} className="flex-shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: RED, opacity: busy ? .5 : 1 }}>{busy === 'out' ? '…' : 'Clock out'}</button>
          </div>
        )}

        <div className="rounded-xl overflow-hidden mb-3" style={{ border: '1px solid #ebe7e3' }}>
          {days.length === 0 && <div className="px-3 py-3 text-sm" style={{ color: '#888' }}>No shifts on the clock this period.</div>}
          {days.map(d => (
            <div key={d.date} className="px-3 py-2" style={{ borderTop: '1px solid #f1f5f9' }}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold" style={{ color: '#1a1a1a' }}>{fmtDay(d.date)}</div>
                <div className="text-sm font-bold tabular-nums" style={{ color: d.minutes > 720 ? '#b45309' : '#1a1a1a' }}>{h(d.minutes)}</div>
              </div>
              {d.shifts.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-2 mt-1 text-xs" style={{ color: '#555' }}>
                  <span>{fmtTime(s.in)} – {fmtTime(s.out)}{s.auto ? <span className="ml-1 font-bold" style={{ color: '#b45309' }}>auto</span> : null}{s.manual ? ' ⌨️' : ''}{s.pending_edit ? <span className="ml-1 font-bold" style={{ color: '#0A0A0A' }}>✏️ edit sent</span> : null}</span>
                  {!s.pending_edit && s.out && (
                    <button type="button" onClick={() => setFix({ shiftId: s.id, in: toLocalPT(s.in), out: toLocalPT(s.out), note: '' })} className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>✏️ Edit</button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {fix && (
          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#fff5f0', border: `1.5px solid ${ORANGE}` }}>
            <div className="text-xs font-bold mb-2" style={{ color: '#1a1a1a' }}>What should it be? (Pacific time — Mark approves the change)</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <label className="text-[10px] font-bold" style={{ color: '#999' }}>IN<input type="datetime-local" value={fix.in} onChange={e => setFix(f => ({ ...f, in: e.target.value }))} className="w-full text-sm rounded-lg px-2 py-1.5 mt-0.5" style={{ border: '1px solid #ddd' }} /></label>
              <label className="text-[10px] font-bold" style={{ color: '#999' }}>OUT<input type="datetime-local" value={fix.out} onChange={e => setFix(f => ({ ...f, out: e.target.value }))} className="w-full text-sm rounded-lg px-2 py-1.5 mt-0.5" style={{ border: '1px solid #ddd' }} /></label>
            </div>
            <input value={fix.note} onChange={e => setFix(f => ({ ...f, note: e.target.value }))} placeholder="Why (e.g. forgot to clock out, was at Avon until 5:40)" className="w-full text-sm rounded-lg px-2 py-1.5 mb-2" style={{ border: '1px solid #ddd' }} />
            <div className="flex gap-2">
              <button type="button" onClick={sendFix} disabled={busy === 'fix'} className="flex-1 rounded-lg py-2 text-sm font-bold text-white" style={{ backgroundColor: ORANGE }}>{busy === 'fix' ? 'Sending…' : 'Send edit to Mark'}</button>
              <button type="button" onClick={() => setFix(null)} className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
            </div>
          </div>
        )}

        {msg && <div className="text-sm font-semibold mb-2" style={{ color: msg.startsWith('✓') ? GREEN : RED }}>{msg}</div>}
        <button type="button" onClick={approve} disabled={busy === 'approve' || open > 0} className="w-full rounded-2xl py-4 text-base font-extrabold text-white" style={{ backgroundColor: GREEN, opacity: busy === 'approve' || open > 0 ? .5 : 1 }}>
          {busy === 'approve' ? 'Saving…' : `✅ Looks right — approve${pay ? ` ${hh(pay.payable + (pay.ot || 0))}` : ` ${h(total_minutes)}`}`}
        </button>
        <div className="text-[11px] mt-2 text-center" style={{ color: '#888' }}>You can't leave this screen until the card is approved.</div>
      </div>
    </div>
  )
}
