// Authorization capture (RCW 46.71 / spec §5): opens when a job goes to
// Approved. Date+time, amount, who authorized, method, who took it — all
// five required for oral authorization.
import { useState } from 'react'
import { Eyebrow, Pill, PrimaryButton, SecondaryButton, ORANGE, GREEN } from '../ui/ReviewKit.jsx'
import { AUTH_METHODS, fmtCents, fromCents, toCents } from '../../lib/estimatorCalc.js'

const METHOD_LABEL = { oral: '📞 Oral', written: '✍️ Written', email: '✉️ Email', text: '💬 Text', portal: '🔗 Portal' }
const localNow = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }

export default function AuthorizeModal({ job, user, onConfirm, onCancel }) {
  const [amount, setAmount] = useState(fromCents(job.total_cents))
  const [name, setName] = useState('')
  const [method, setMethod] = useState('oral')
  const [employee, setEmployee] = useState(user?.name || user?.email || '')
  const [when, setWhen] = useState(localNow())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ok = toCents(amount) > 0 && name.trim() && employee.trim() && when
  const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }

  async function go() {
    setBusy(true); setErr('')
    try { await onConfirm({ authorized_amount_cents: toCents(amount), authorized_by_name: name.trim(), authorized_method: method, authorized_by_employee: employee.trim(), authorized_at: new Date(when).toISOString() }) }
    catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.55)' }} onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden">
        <div className="px-5 py-3" style={{ backgroundColor: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
          <Eyebrow>✅ Approve job · authorization on file</Eyebrow>
          <div className="font-bold text-base" style={{ color: '#1a1a1a' }}>{job.name}</div>
          <div className="text-xs" style={{ color: '#666' }}>Job total {fmtCents(job.total_cents)} · Washington needs who, when, how, and how much.</div>
        </div>
        <div className="px-5 py-4 space-y-3">
          {err && <div className="text-sm px-3 py-2 rounded-lg" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><Eyebrow>Amount authorized</Eyebrow><input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className="w-full rounded-lg px-3 py-2 text-base font-bold tabular-nums" style={inp} /></div>
            <div><Eyebrow>Date &amp; time</Eyebrow><input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} className="w-full rounded-lg px-2 py-2 text-sm" style={inp} /></div>
          </div>
          <div><Eyebrow>Who authorized it</Eyebrow><input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Name at the shop / vehicle owner" className="w-full rounded-lg px-3 py-2 text-base" style={inp} /></div>
          <div>
            <Eyebrow>How</Eyebrow>
            <div className="flex flex-wrap gap-1.5 mt-1">{AUTH_METHODS.map(m => <Pill key={m} size="sm" on={method === m} onClick={() => setMethod(m)}>{METHOD_LABEL[m]}</Pill>)}</div>
          </div>
          <div><Eyebrow>Taken by (Absolute ADAS)</Eyebrow><input value={employee} onChange={e => setEmployee(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm" style={inp} /></div>
        </div>
        <div className="px-5 py-3 flex gap-2" style={{ borderTop: '1px solid #ebebeb' }}>
          <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
          <PrimaryButton onClick={go} disabled={!ok || busy} tone="green">{busy ? 'Saving…' : `✅ Approved · ${fmtCents(toCents(amount))}`}</PrimaryButton>
        </div>
      </div>
    </div>
  )
}
