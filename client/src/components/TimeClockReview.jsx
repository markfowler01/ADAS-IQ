// Time card review at login (Mark 2026-09-16): on the 15th and the last
// day of the month (and the few days after, until it's done) everyone
// gets their own period laid out day by day — approve it in one tap, or
// tap "Fix this" on a shift to send Mark a correction. Nothing changes
// until Mark approves a fix. Once per PT day per device until approved.
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
    const day = todayPT()
    // Only bother the server on days a review could be due: the 15th, the 28th+, or the 1st–4th / 16th–19th.
    const d = Number(day.slice(8, 10))
    const maybeDue = d === 15 || d >= 28 || d <= 4 || (d >= 16 && d <= 19)
    if (!maybeDue) return
    apiFetch(`${API_BASE}/api/timeclock/period-review`).then(r => r.json()).then(j => {
      if (!j?.ok || !j.due || j.attested) return
      const key = `aa_tc_review_${j.period.start}_${day}`
      try { if (localStorage.getItem(key)) return } catch {}
      setData(j); setShow(true)
      try { localStorage.setItem(key, '1') } catch {}
    }).catch(() => {})
  }, [])

  if (!show || !data) return null
  const { period, days, total_minutes, open, pay } = data
  const hh = n => `${Number(n || 0).toFixed(2)}h`

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
      setMsg('✓ Edit sent to Mark — approve the rest when it looks right')
      setFix(null)
      // refresh so the shift shows ✏️ pending
      const rr = await apiFetch(`${API_BASE}/api/timeclock/period-review`).then(x => x.json()).catch(() => null)
      if (rr?.ok) setData(rr)
    } catch (e) { setMsg(`Couldn't send: ${e.message}`) } finally { setBusy('') }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Time card review · {period.label}</div>
            <div className="font-bold text-lg" style={{ color: '#1a1a1a' }}>{user?.name?.split(' ')[0] || 'Hey'}, does this look right?</div>
            <div className="text-xs" style={{ color: '#666' }}>Your time card for the period. Approve it, or tap ✏️ Edit on any shift that's off — Mark approves the change.</div>
          </div>
          <button onClick={() => setShow(false)} className="text-2xl px-1 leading-none" style={{ color: '#888' }} title="Later">×</button>
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
        {open > 0 && <div className="text-xs font-semibold mb-2 px-3 py-2 rounded-lg" style={{ backgroundColor: '#fef2f2', color: RED }}>⏱ You're still clocked in on {open} shift{open > 1 ? 's' : ''} — clock out first so the total is right.</div>}

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
                  <span>{fmtTime(s.in)} – {fmtTime(s.out)}{s.auto ? <span className="ml-1 font-bold" style={{ color: '#b45309' }}>auto</span> : null}{s.manual ? ' ⌨️' : ''}{s.pending_edit ? <span className="ml-1 font-bold" style={{ color: '#7c3aed' }}>✏️ edit sent</span> : null}</span>
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
        <div className="text-[11px] mt-2 text-center" style={{ color: '#888' }}>Sent an edit? Approve once Mark has it in. You'll be asked again tomorrow if you skip.</div>
      </div>
    </div>
  )
}
