// 🔧 Build job — no report (single-invoice billing Phase C, Mark 2026-09-22).
// Kat turns a tech's request into a job without a Kinetic PDF: the
// customer is already on the request, she adds the work (programming by
// make, a calibration off the list, diagnostic time), tech, date. The
// card converts in place — photos, tires, notes stay — and the WorkDrive
// folder is made by RO. No Books document yet; Bill it makes the one
// invoice at Ready to Invoice.
import { useEffect, useMemo, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import { useBig3Map } from './books/Big3Rules.jsx'

const ORANGE = '#CD4419', GREEN = '#15803d', RED = '#b91c1c'
const fmt = n => `$${Number(n || 0).toFixed(2)}`
const KEY_STUFF = /\bkeys?\b|fob|transponder|remote|blade|prox|smart key|key ?less|immobil/i
const CAL_WORDS = /calibrat|scan|radar|camera|sensor|blind|adas|lidar|aim|static|dynamic|inspection|snapshot|steering|seat weight|park|occupant|\bsas\b|\bsws\b|headlamp|night vision|mirror|windshield|360|surround|lane|cruise|collision|alignment/i
const inp = { border: '1.5px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }

export default function BuildJobModal({ job, user, onClose, onBuilt }) {
  const [catalog, setCatalog] = useState([])
  const [lines, setLines] = useState([])
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('programming')   // programming | calibration | diagnostic
  const [tech, setTech] = useState(job.technician || '')
  const [date, setDate] = useState(job.scheduled_date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { apiFetch(`${API_BASE}/api/jobs/catalog`).then(r => r.json()).then(d => setCatalog(d.items || [])).catch(() => {}) }, [])
  const byName = useMemo(() => new Map(catalog.map(i => [i.name.toLowerCase(), i])), [catalog])
  const modItems = useMemo(() => catalog.filter(i => /^module programming and reflash - /i.test(i.name)).map(i => ({ ...i, make: i.name.replace(/^module programming and reflash - /i, '') })).sort((a, b) => a.make.localeCompare(b.make)), [catalog])
  const fees = useMemo(() => ['Security Access and Authorization Fee', 'Gateway Access Fee'].map(n => byName.get(n.toLowerCase())).filter(Boolean), [byName])
  const jobMake = String(job.make || '').toLowerCase()
  const suggested = modItems.find(i => jobMake && (i.make.toLowerCase() === jobMake || jobMake.includes(i.make.toLowerCase())))
  const booksHits = q.trim().length >= 2 ? catalog.filter(i => i.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 14) : []
  const calHits = q.trim().length >= 2 ? catalog.filter(i => !KEY_STUFF.test(i.name) && CAL_WORDS.test(i.name) && i.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 10) : []
  const diag = byName.get('diagnostic 1') || catalog.find(i => /^diagnostic/i.test(i.name))
  function add(it, extra = {}) { setLines(ls => { const i = ls.findIndex(l => l.item_id === it.item_id && !extra.description); if (i >= 0 && !extra.description) return ls.map((l, n) => n === i ? { ...l, quantity: l.quantity + 1 } : l); return [...ls, { item_id: it.item_id, name: it.name, rate: Number(it.rate) || 0, quantity: 1, description: '', ...extra }] }); setQ('') }
  const total = lines.reduce((s, l) => s + l.rate * l.quantity, 0)
  const custType = job.customer?.kind === 'retail' ? 'Retail person' : ''
  const b3map = useBig3Map()
  const shopBilling = b3map[String(job.shop_name || '').toLowerCase().replace(/[^a-z0-9]/g, '')]?.billing
  const repairish = ['repair_shop', 'dealer'].includes(shopBilling?.customer_type) || job.customer?.kind === 'retail'
  // Mark 2026-09-22: "the majority of what we're doing for automotive repair
  // shops is programming, diagnostic, and then calibration" — one tap starts there.
  function addUsual() { if (suggested) add(suggested); if (diag) add(diag, { description: '' }) }
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
        {repairish && (suggested || diag) && !lines.length && (
          <button onClick={addUsual} className="w-full text-left rounded-xl px-3 py-2.5 mb-3" style={{ backgroundColor: '#fff5f0', border: `1.5px solid ${ORANGE}` }}>
            <div className="text-sm font-bold" style={{ color: ORANGE }}>⚡ The usual for a repair shop{suggested ? ` — ${suggested.make} programming` : ''}{diag ? ' + diagnostic' : ''}</div>
            <div className="text-[11px]" style={{ color: '#666' }}>Programming, diagnostic, then a calibration if it needs one. Adjust anything after.</div>
          </button>
        )}
        <div className="flex gap-1 mb-3">
          {[['programming', '🔌 Programming'], ['diagnostic', '🔍 Diagnostic'], ['calibration', '🎯 Calibration'], ['books', '📚 Zoho Books — any item']].map(([k, l]) => <button key={k} onClick={() => setTab(k)} className="text-xs font-bold rounded-full px-3 py-1.5" style={tab === k ? { backgroundColor: '#1a1a1a', color: 'white' } : { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>{l}</button>)}
        </div>
        {tab === 'programming' && (
          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#faf9f7', border: '1px solid #e8e4e0' }}>
            <div className="text-[11px] mb-1.5" style={{ color: '#666' }}>Priced <b>per module</b> — tap the make once per module flashed.</div>
            {suggested && <button onClick={() => add(suggested)} className="text-sm font-bold rounded-xl px-3 py-2 mb-2 text-white" style={{ backgroundColor: ORANGE }}>＋ {suggested.make} module · {fmt(suggested.rate)}</button>}
            <div className="flex gap-1.5 flex-wrap mb-2">{modItems.map(i => <button key={i.item_id} onClick={() => add(i)} className="text-xs font-semibold rounded-full px-2.5 py-1" style={{ backgroundColor: 'white', color: '#1a1a1a', border: '1px solid #e0dbd6' }}>{i.make} <span style={{ color: '#888' }}>{fmt(i.rate)}</span></button>)}</div>
            <div className="flex gap-1.5 flex-wrap">{fees.map(f => <button key={f.item_id} onClick={() => add(f)} className="text-xs font-semibold rounded-full px-2.5 py-1" style={{ backgroundColor: '#fff7ed', color: '#b45309', border: '1px solid #fdba74' }}>＋ {f.name} {fmt(f.rate)}</button>)}</div>
          </div>
        )}
        {tab === 'books' && (
          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#faf9f7', border: '1px solid #e8e4e0' }}>
            <div className="text-[11px] mb-1.5" style={{ color: '#666' }}>The whole Zoho Books menu — programming, diagnostics, labor, parts, anything. Tap to add a line; tap again for another.</div>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search every Books item…" className="w-full text-sm rounded-lg px-3 py-2 mb-2" style={inp} onKeyDown={e => { if (e.key === 'Enter' && booksHits[0]) add(booksHits[0]) }} />
            {booksHits.map(it => <button key={it.item_id} onClick={() => add(it)} className="w-full text-left flex justify-between px-3 py-2 text-sm rounded-lg" style={{ backgroundColor: 'white', border: '1px solid #eee', marginBottom: 4 }}><span>{it.name}{it.type === 'goods' ? <span className="text-xs" style={{ color: '#888' }}> · part</span> : null}</span><span className="font-bold" style={{ color: GREEN }}>{fmt(it.rate)}</span></button>)}
            {q.trim().length >= 2 && !booksHits.length && <div className="text-xs" style={{ color: '#888' }}>Nothing in Books matches "{q.trim()}".</div>}
            {q.trim().length < 2 && <div className="text-xs" style={{ color: '#aaa' }}>{catalog.length ? `${catalog.length} items in Books.` : 'Loading Books…'}</div>}
          </div>
        )}
        {tab === 'calibration' && (
          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#faf9f7', border: '1px solid #e8e4e0' }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search the price list… blind spot, front radar, windshield" className="w-full text-sm rounded-lg px-3 py-2 mb-2" style={inp} onKeyDown={e => { if (e.key === 'Enter' && calHits[0]) add(calHits[0]) }} />
            {calHits.map(it => <button key={it.item_id} onClick={() => add(it)} className="w-full text-left flex justify-between px-3 py-2 text-sm rounded-lg" style={{ backgroundColor: 'white', border: '1px solid #eee', marginBottom: 4 }}><span>{it.name}</span><span className="font-bold" style={{ color: GREEN }}>{fmt(it.rate)}</span></button>)}
            {q.trim().length >= 2 && !calHits.length && <div className="text-xs" style={{ color: '#888' }}>Nothing on the list matches.</div>}
          </div>
        )}
        {tab === 'diagnostic' && (
          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#faf9f7', border: '1px solid #e8e4e0' }}>
            {diag ? <button onClick={() => add(diag, { description: '' })} className="text-sm font-bold rounded-xl px-3 py-2 text-white" style={{ backgroundColor: ORANGE }}>＋ {diag.name} · {fmt(diag.rate)}</button> : <div className="text-xs" style={{ color: '#888' }}>No "Diagnostic 1" item in Books.</div>}
            <div className="text-[11px] mt-1.5" style={{ color: '#666' }}>Write what was diagnosed on the line after adding it.</div>
          </div>
        )}
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
          <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: '1px solid #f1f5f9', backgroundColor: '#f8fafc' }}><button onClick={() => { setTab('books'); setQ('') }} className="text-xs font-bold rounded-full px-3 py-1" style={{ backgroundColor: 'white', color: ORANGE, border: `1px dashed ${ORANGE}` }}>＋ Add another line from Books</button><span className="text-[11px]" style={{ color: '#888' }}>{lines.length} line{lines.length === 1 ? '' : 's'}</span></div>
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
