// 🔧 Build job — no report (single-invoice billing Phase C, Mark 2026-09-22).
// Kat turns a tech's request into a job without a Kinetic PDF: the
// customer is already on the request, she adds the work (programming by
// make, a calibration off the list, diagnostic time), tech, date. The
// card converts in place — photos, tires, notes stay — and the WorkDrive
// folder is made by RO. No Books document yet; Bill it makes the one
// invoice at Ready to Invoice.
import { useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import { useBig3Map } from './books/Big3Rules.jsx'
import LinePicker from './upload/LinePicker.jsx'

const ORANGE = '#CD4419', GREEN = '#15803d', RED = '#b91c1c'
const fmt = n => `$${Number(n || 0).toFixed(2)}`
const inp = { border: '1.5px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }

export default function BuildJobModal({ job, user, onClose, onBuilt }) {
  const [lines, setLines] = useState([])
  const [tech, setTech] = useState(job.technician || '')
  const [date, setDate] = useState(job.scheduled_date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  function add(it, extra = {}) { setLines(ls => { const i = ls.findIndex(l => l.item_id === it.item_id && !extra.description); if (i >= 0 && !extra.description) return ls.map((l, n) => n === i ? { ...l, quantity: l.quantity + 1 } : l); return [...ls, { item_id: it.item_id, name: it.name, rate: Number(it.rate) || 0, quantity: 1, description: '', ...extra }] }) }
  const total = lines.reduce((s, l) => s + l.rate * l.quantity, 0)
  const custType = job.customer?.kind === 'retail' ? 'Retail person' : ''
  const b3map = useBig3Map()
  const shopBilling = b3map[String(job.shop_name || '').toLowerCase().replace(/[^a-z0-9]/g, '')]?.billing
  const repairish = ['repair_shop', 'dealer'].includes(shopBilling?.customer_type) || job.customer?.kind === 'retail'
  // Mark 2026-09-22: "the majority of what we're doing for automotive repair
  // shops is programming, diagnostic, and then calibration" — one tap starts there.
  async function build() {
    if (!lines.length) { setErr('Add the work first.'); return }
    setBusy(true); setErr('')
    try {
      const calibrations = lines.map(l => ({ calibration_name: l.name, item_id: l.item_id, rate: l.rate, quantity: l.quantity, description: l.description || '', enabled: true, cal_type: '', trigger: 'Built by Kat — no report', justification: l.description || '' }))
      const status = tech === 'Jayden' ? 'dispatched_jaden' : tech === 'Mark' ? 'dispatched_mark' : 'need_dispatch'
      const body = { status, technician: tech || '', scheduled_date: date || '', calibrations: JSON.stringify(calibrations), request_type: '', notes: `${job.notes ? job.notes + '\n' : ''}${note ? '🔧 ' + note : ''}`.trim() }
      const r = await apiFetch(`${API_BASE}/api/jobs/${job.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      // Folder by RO — the same one photos and the post-scan will use.
      apiFetch(`${API_BASE}/api/jobs/${job.id}/workdrive-folder`).catch(() => {})
      try { window.dispatchEvent(new CustomEvent('adas:jobs-refresh')) } catch {}
      onBuilt && onBuilt(d)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.55)' }} onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl p-4 sm:p-5 max-h-[94vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: ORANGE, fontFamily: 'IBM Plex Mono, monospace' }}>🔧 Build job — no report</div>
            <div className="font-extrabold text-lg leading-tight" style={{ color: '#1a1a1a' }}>{job.shop_name || 'Job'}{custType ? <span className="text-xs font-bold ml-2 rounded-full px-2 py-0.5" style={{ backgroundColor: '#e0f2fe', color: '#0369a1' }}>{custType} · one invoice + tax</span> : null}</div>
            <div className="text-xs" style={{ color: '#666' }}>{job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')}{job.quote_number ? ` · RO ${job.quote_number}` : ''}{job.customer?.zoho_contact_id ? ' · Books customer linked' : ''}</div>
          </div>
          <button onClick={onClose} className="text-2xl leading-none px-1" style={{ color: '#888' }}>×</button>
        </div>
        <LinePicker onAdd={(it, extra) => add(it, extra)} jobMake={job.make || ''} existingNames={lines.map(l => l.name)} usual={repairish && !lines.length} />
        <div style={{ height: 12 }} />
        <div className="rounded-xl overflow-hidden mb-3" style={{ border: '1.5px solid #bbf7d0' }}>
          {!lines.length && <div className="px-3 py-3 text-sm" style={{ color: '#888' }}>No work added yet.</div>}
          {lines.map((l, i) => (
            <div key={i} className="px-3 py-2" style={{ borderTop: i ? '1px solid #f1f5f9' : 'none' }}>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm font-semibold" style={{ color: '#1a1a1a' }}>{l.name}</span>
                <input type="number" min="1" value={l.quantity} onChange={e => setLines(ls => ls.map((x, n) => n === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x))} className="w-14 text-sm rounded-md px-2 py-1 text-right" style={inp} />
                <span className="tabular-nums text-sm w-20 text-right" style={{ color: '#555' }}>{fmt(l.rate * l.quantity)}</span>
                <button onClick={() => setLines(ls => ls.filter((_, n) => n !== i))} className="w-7 h-7 rounded-full font-bold" style={{ backgroundColor: '#fef2f2', color: RED }}>×</button>
              </div>
              {/diagnos|mechanical/i.test(l.name) && <input value={l.description} onChange={e => setLines(ls => ls.map((x, n) => n === i ? { ...x, description: e.target.value } : x))} placeholder="What was diagnosed / done" className="w-full text-xs rounded-lg px-2 py-1.5 mt-1" style={inp} />}
            </div>
          ))}
          <div className="flex items-center justify-end px-3 py-1.5" style={{ borderTop: '1px solid #f1f5f9', backgroundColor: '#f8fafc' }}><span className="text-[11px]" style={{ color: '#888' }}>{lines.length} line{lines.length === 1 ? '' : 's'} · add more above</span></div>
          <div className="flex justify-between px-3 py-2 text-base font-extrabold" style={{ borderTop: '2px solid #dcfce7', color: GREEN }}><span>List total (before any discount / tax)</span><span className="tabular-nums">{fmt(total)}</span></div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div><div className="text-[11px] font-bold mb-1" style={{ color: '#888' }}>Technician</div><div className="flex gap-1">{['Mark', 'Jayden'].map(n => <button key={n} onClick={() => setTech(tech === n ? '' : n)} className="flex-1 text-xs font-bold rounded-lg py-2" style={tech === n ? { backgroundColor: ORANGE, color: 'white' } : { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>{n}</button>)}</div></div>
          <div><div className="text-[11px] font-bold mb-1" style={{ color: '#888' }}>Date</div><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full text-sm rounded-lg px-2 py-1.5" style={inp} /></div>
        </div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note for the tech (optional)" className="w-full text-sm rounded-lg px-3 py-2 mb-3" style={inp} />
        {err && <div className="text-sm mb-2 font-semibold" style={{ color: RED }}>{err}</div>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl py-3 text-sm font-semibold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
          <button onClick={build} disabled={busy || !lines.length} className="flex-[2] rounded-xl py-3 text-base font-bold text-white" style={{ backgroundColor: GREEN, opacity: busy || !lines.length ? .5 : 1 }}>{busy ? 'Building…' : `🔧 Build → ${tech ? `Dispatched to ${tech}` : 'Needs Dispatch'}`}</button>
        </div>
        <div className="text-[11px] mt-2" style={{ color: '#888' }}>Folder made by RO. Photos, tires and notes already on the request stay. One invoice at Ready to Invoice — no calibration review.</div>
      </div>
    </div>
  )
}
