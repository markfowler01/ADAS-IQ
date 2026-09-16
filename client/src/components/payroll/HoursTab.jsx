// Payroll → Hours (Mark 2026-09-16): "every payday I need to login and see
// how many hours people have worked… one click". Opens on the period
// being paid, one row per person, the number to pay in big type, problems
// as red chips, day-by-day underneath, Copy for Zoho Payroll, CSV, and a
// button that drops the same report in Mark's Cliq. Owner only (Mark + Kat).
import { useEffect, useState } from 'react'
import { isOwnerUser, isMarkUser } from '../utils/identity.js'
import { API_BASE, apiFetch, COLORS, Card, Button } from '../books/shared'

const h = n => `${Number(n || 0).toFixed(2)}h`
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
function periodOf(y, m, half) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  const mon = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  return { start: `${y}-${mm}-${half ? '16' : '01'}`, end: `${y}-${mm}-${half ? String(last) : '15'}`, label: `${mon} ${half ? 16 : 1}–${half ? last : 15} ${y}` }
}
function lastPeriods(n = 10) {
  const out = []; const now = new Date(); let y = now.getFullYear(), m = now.getMonth() + 1, half = now.getDate() >= 16 ? 1 : 0
  for (let i = 0; i < n; i++) { out.push(periodOf(y, m, half)); if (half) half = 0; else { half = 1; m -= 1; if (m === 0) { m = 12; y -= 1 } } }
  return out
}
const fmtDay = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })
const fmtTime = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })

export default function HoursTab({ user }) {
  const isOwner = isOwnerUser(user)
  const day = new Date().getDate()
  const payday = day <= 5 || (day >= 16 && day <= 20)          // just past a period close → you're paying the last one
  const [which, setWhich] = useState(payday ? 'previous' : 'current')
  const [custom, setCustom] = useState(null)                     // { start, end, label } from the older-periods picker
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState({})
  const [msg, setMsg] = useState('')
  const [adding, setAdding] = useState(null)                     // person key being keyed in
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), hours: '8', note: '' })
  const [busy, setBusy] = useState('')

  const qs = custom ? `start=${custom.start}&end=${custom.end}` : `which=${which}`
  async function load() {
    setLoading(true); setErr('')
    try { setData(await j(`/api/timeclock/period-hours?${qs}`)) } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { if (isOwner) load() }, [qs, isOwner]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOwner) return <Card><div className="text-sm" style={{ color: COLORS.textMuted }}>Only Mark and Kat can see payroll hours.</div></Card>

  const people = data?.people || []
  const period = data?.period
  const locked = data?.locked_through && period && data.locked_through >= period.end
  const flagsOf = p => {
    const f = p.flags || {}; const out = []
    if (f.open) out.push({ t: `⏱ still clocked in (${f.open})`, tone: 'red' })
    if (f.pending_edits) out.push({ t: `✏️ ${f.pending_edits} edit waiting on Mark`, tone: 'red' })
    if (f.long_days?.length) out.push({ t: `⚠️ ${f.long_days.length} day${f.long_days.length > 1 ? 's' : ''} over 12h`, tone: 'amber' })
    if (f.manual_min) out.push({ t: `⌨️ ${h(f.manual_min / 60)} keyed in`, tone: 'blue' })
    if (p.late) out.push({ t: `late adj. ${h(p.late)}`, tone: 'amber' })
    const rv = data?.reviews?.[p.user_id]
    if (rv) out.push({ t: `✅ approved by ${p.name.split(' ')[0]} ${new Date(rv.at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}`, tone: 'green' })
    else if (p.user_id !== 'joyce@absoluteadas.com' && (data?.today || '') >= (period?.end || '')) out.push({ t: '⏳ not reviewed yet', tone: 'amber' })
    return out
  }
  async function copyForZoho() {
    const lines = people.map(p => p.type === 'employee'
      ? `${p.name}: ${p.payable}h regular${p.ot ? ` + ${p.ot}h OT (1.5x)` : ''}${p.sick ? ` · sick ${p.sick}h` : ''}${p.vacation ? ` · vacation ${p.vacation}h` : ''}${p.holiday ? ` · holiday ${p.holiday}h` : ''}`
      : `${p.name}: ${p.worked}h (contract)`)
    const text = `Hours · ${period?.label || ''} (${period?.start} → ${period?.end})\n` + lines.join('\n')
    try { await navigator.clipboard.writeText(text); setMsg('✓ Copied — paste into Zoho Payroll') } catch { window.prompt('Copy this:', text) }
    setTimeout(() => setMsg(''), 3000)
  }
  function downloadCsv() {
    const blob = new Blob([data.csv || ''], { type: 'text/csv' }); const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `hours-${period.start}-to-${period.end}.csv`; document.body.appendChild(a); a.click(); a.remove()
  }
  async function sendCliq() {
    setBusy('cliq'); try { await j(`/api/timeclock/period-hours/send?${qs}`, { method: 'POST' }); setMsg('✓ Sent to your alerts chat') } catch (e) { setMsg(`✗ ${e.message}`) } finally { setBusy(''); setTimeout(() => setMsg(''), 4000) }
  }
  async function addHours(p) {
    setBusy('add')
    try {
      await j('/api/timeclock/entries/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: p.user_id, user_name: p.name, date: form.date, hours: Number(form.hours), note: form.note }) })
      setAdding(null); setMsg(`✓ ${form.hours}h added for ${p.name} on ${form.date}`); load()
    } catch (e) { setMsg(`✗ ${e.message}`) } finally { setBusy(''); setTimeout(() => setMsg(''), 4000) }
  }
  const chip = (on, label, onClick) => (
    <button key={label} onClick={onClick} className="text-sm font-bold rounded-full px-3.5 py-1.5"
      style={on ? { backgroundColor: COLORS.primary, color: 'white' } : { backgroundColor: 'white', color: COLORS.text, border: `1px solid ${COLORS.borderStrong}` }}>{label}</button>
  )
  const P = data?.periods

  return (
    <div>
      {/* Which period */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {P && chip(!custom && which === 'previous', `${P.previous.label}${payday ? ' · pay now' : ''}`, () => { setCustom(null); setWhich('previous') })}
        {P && chip(!custom && which === 'current', `${P.current.label} · in progress`, () => { setCustom(null); setWhich('current') })}
        <select value={custom ? custom.start : ''} onChange={e => { const p = lastPeriods(12).find(x => x.start === e.target.value); setCustom(p || null) }}
          className="text-sm rounded-full px-3 py-1.5" style={{ border: `1px solid ${COLORS.borderStrong}`, backgroundColor: 'white', color: custom ? COLORS.primary : COLORS.textMuted, fontWeight: custom ? 700 : 500 }}>
          <option value="">Older period…</option>
          {lastPeriods(12).slice(2).map(p => <option key={p.start} value={p.start}>{p.label}</option>)}
        </select>
        <span className="text-xs" style={{ color: COLORS.textMuted }}>1st–15th · 16th–end of month</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Button variant="primary" onClick={copyForZoho} disabled={!people.length}>📋 Copy for Zoho Payroll</Button>
        <Button variant="secondary" onClick={downloadCsv} disabled={!data?.csv}>⬇ CSV for Joyce</Button>
        <Button variant="secondary" onClick={sendCliq} disabled={busy === 'cliq' || !people.length}>{busy === 'cliq' ? 'Sending…' : '💬 Send to my Cliq'}</Button>
        {locked && <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: COLORS.successSoft, color: COLORS.success }}>🔒 Reported + locked through {data.locked_through}</span>}
        {msg && <span className="text-sm font-semibold" style={{ color: msg.startsWith('✓') ? COLORS.success : COLORS.danger }}>{msg}</span>}
      </div>

      {err && <Card><div className="text-sm" style={{ color: COLORS.danger }}>{err}</div></Card>}
      {loading && !data && <div className="text-sm py-8 text-center" style={{ color: COLORS.textMuted }}>Adding up the clock…</div>}

      {period && (
        <div className="text-xs mb-2" style={{ color: COLORS.textMuted }}>
          {period.label} · {period.start} → {period.end}{data.holidays?.length ? ` · paid holiday: ${data.holidays.map(x => x.name).join(', ')}` : ''}{loading ? ' · refreshing…' : ''}
        </div>
      )}

      {/* One row per person */}
      <div className="space-y-3">
        {people.map(p => {
          const flags = flagsOf(p)
          const isOpen = !!open[p.key]
          const none = !p.shifts
          return (
            <Card key={p.key} padded={false}>
              <button onClick={() => setOpen(o => ({ ...o, [p.key]: !o[p.key] }))} className="w-full text-left px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[160px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-base" style={{ color: COLORS.text }}>{p.name}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={p.type === 'employee' ? { backgroundColor: COLORS.infoSoft, color: COLORS.info } : { backgroundColor: COLORS.successSoft, color: COLORS.success }}>{p.type === 'employee' ? 'W-2' : 'Contract'}</span>
                    {flags.map(f => <span key={f.t} className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={f.tone === 'red' ? { backgroundColor: COLORS.dangerSoft, color: COLORS.danger } : f.tone === 'blue' ? { backgroundColor: COLORS.infoSoft, color: COLORS.info } : f.tone === 'green' ? { backgroundColor: COLORS.successSoft, color: COLORS.success } : { backgroundColor: COLORS.warningSoft, color: COLORS.warning }}>{f.t}</span>)}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: COLORS.textMuted }}>
                    {none ? 'No clock-ins this period' : p.type === 'employee'
                      ? `Worked ${h(p.worked)} in ${p.shifts} shifts · ${p.days.length} days · regular ${h(p.regular)}${p.ot ? ` · OT ${h(p.ot)}` : ''}${p.sick ? ` · sick paid ${h(p.sick)}` : ''}${p.vacation ? ` · vacation ${h(p.vacation)}` : ''}${p.holiday ? ` · holiday ${h(p.holiday)}` : ''}${p.unpaid ? ` · unpaid ${h(p.unpaid)}` : ''}`
                      : `Worked ${h(p.worked)} in ${p.shifts} shifts · ${p.days.length} days`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: COLORS.textMuted, fontFamily: 'IBM Plex Mono, monospace' }}>{p.type === 'employee' ? 'Pay at regular rate' : 'Pay at contract rate'}</div>
                  <div className="text-2xl font-extrabold tabular-nums" style={{ color: none ? COLORS.textLight : COLORS.text }}>{h(p.payable)}</div>
                  {p.ot > 0 && <div className="text-sm font-bold tabular-nums" style={{ color: COLORS.warning }}>+ {h(p.ot)} at 1.5×</div>}
                </div>
                <span style={{ color: COLORS.textLight }}>{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div className="px-4 pb-3" style={{ borderTop: `1px solid ${COLORS.border || '#ebebeb'}` }}>
                  {p.days.length === 0 && <div className="text-xs py-2" style={{ color: COLORS.textMuted }}>Nothing on the clock for {p.name} in this period.</div>}
                  {p.days.map(d => (
                    <div key={d.date} className="flex items-start justify-between gap-3 py-1.5 text-sm" style={{ borderBottom: '1px solid #f3f3f3' }}>
                      <div className="w-24 flex-shrink-0 font-semibold" style={{ color: COLORS.text }}>{fmtDay(d.date)}</div>
                      <div className="flex-1 text-xs" style={{ color: COLORS.textMuted }}>
                        {d.shifts.map(s => <span key={s.id} className="mr-3">{fmtTime(s.in)}–{s.out ? fmtTime(s.out) : 'open'}{s.manual ? ' ⌨️' : ''}{s.pending_edit ? ' ✏️' : ''}{s.note ? ` · ${s.note}` : ''}</span>)}
                      </div>
                      <div className="font-bold tabular-nums" style={{ color: d.minutes > 720 ? COLORS.warning : COLORS.text }}>{h(d.minutes / 60)}</div>
                    </div>
                  ))}
                  {p.sick_balance != null && <div className="text-xs mt-2" style={{ color: COLORS.textMuted }}>Sick balance after this period: {h(p.sick_balance)}</div>}
                  <div className="mt-3">
                    {adding === p.key ? (
                      <div className="flex items-end gap-2 flex-wrap rounded-lg p-3" style={{ backgroundColor: COLORS.surfaceSoft }}>
                        <label className="text-xs font-semibold" style={{ color: COLORS.textMuted }}>Date<br /><input type="date" value={form.date} min={period.start} max={period.end} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="text-sm rounded-md px-2 py-1.5" style={{ border: `1px solid ${COLORS.borderStrong}` }} /></label>
                        <label className="text-xs font-semibold" style={{ color: COLORS.textMuted }}>Hours<br /><input type="number" step="0.25" min="0.25" max="16" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} className="text-sm rounded-md px-2 py-1.5 w-20" style={{ border: `1px solid ${COLORS.borderStrong}` }} /></label>
                        <label className="text-xs font-semibold flex-1 min-w-[160px]" style={{ color: COLORS.textMuted }}>Note<br /><input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="e.g. from her Zoho timesheet" className="text-sm rounded-md px-2 py-1.5 w-full" style={{ border: `1px solid ${COLORS.borderStrong}` }} /></label>
                        <Button variant="success" size="sm" disabled={busy === 'add'} onClick={() => addHours(p)}>{busy === 'add' ? 'Saving…' : 'Add'}</Button>
                        <Button variant="ghost" size="sm" onClick={() => setAdding(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => { setForm({ date: period.end <= new Date().toISOString().slice(0, 10) ? period.end : new Date().toISOString().slice(0, 10), hours: '8', note: '' }); setAdding(p.key) }}>⌨️ Key in hours for {p.name.split(' ')[0]}</Button>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      <div className="text-xs mt-4" style={{ color: COLORS.textMuted }}>
        Totals come straight from the app time clock (Pacific time). Employees: overtime is anything past 40h in a Mon–Sun week, paid at 1.5×; holidays are 8h. Contractors: worked hours only. Joyce isn't on the clock, so key her hours in on her row.
        The same report lands in Mark's Cliq at 7am on the 1st and the 16th.
      </div>
    </div>
  )
}
