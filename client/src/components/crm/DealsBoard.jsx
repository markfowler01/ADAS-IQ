// 💼 Deals board (Mark's spec 2026-10-07): kanban by stage, drag to move (the server's
// gates decide; a blocked move shows the exact reason), card = shop, priority, days in
// stage, next step + date, red badge when the next step is past or missing.
// Also the Sales Scorecard (phase 4) in a side panel.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import DealCard from './DealCard.jsx'
import SalesMode from './SalesMode.jsx'

const ORANGE = '#CD4419', INK = '#1a1a1a'
const STAGE_COLOR = { Qualified: '#CD4419', Prospecting: '#b45309', Connected: '#1F8B8B', Discovery: '#0A0A0A', Bridged: '#B33A15', 'Next Step Asked': '#CD4419', Stalled: '#6b7280', Implementing: '#15803d', Won: '#166534', Lost: '#991b1b' }
const PRI = { HPP: { bg: '#fef3c7', fg: '#92400e' }, MPP: { bg: '#e6f4f4', fg: '#1F8B8B' }, LPP: { bg: '#f5f3f0', fg: '#6b7280' } }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

export default function DealsBoard({ user, modeToggle, shops = [] }) {
  const [meta, setMeta] = useState(null)
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)           // deal id
  const [sales, setSales] = useState(false)
  const [score, setScore] = useState(null)
  const [toast, setToast] = useState('')
  const [drag, setDrag] = useState(null)
  const [newFor, setNewFor] = useState('')         // shop picker text
  const load = async () => { setLoading(true); try { const r = await apiFetch(`${API_BASE}/api/deals`); const d = await r.json(); setDeals(d.deals || []) } catch { /* keep */ } finally { setLoading(false) } }
  useEffect(() => { apiFetch(`${API_BASE}/api/deals/meta`).then(r => r.json()).then(setMeta).catch(() => {}); load() }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 5000); return () => clearTimeout(t) }, [toast])
  const stages = meta?.stages || []
  const byStage = stages.reduce((m, s) => { m[s] = deals.filter(d => d.stage === s); return m }, {})

  const move = async (deal, stage) => {
    if (deal.stage === stage) return
    const r = await apiFetch(`${API_BASE}/api/deals/${deal.id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setToast(`🚫 ${d.error || 'Blocked'}`); return }
    setDeals(ds => ds.map(x => x.id === deal.id ? d.deal : x)); setToast(`→ ${stage}`)
  }
  const create = async shop => {
    const r = await apiFetch(`${API_BASE}/api/deals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: shop.id }) })
    const d = await r.json().catch(() => ({})); if (!r.ok) { setToast(`⚠ ${d.error}`); return }
    setNewFor(''); await load(); setOpen(d.deal.id); if (d.existed) setToast('That shop already has an open deal — opened it.')
  }
  const candidates = newFor.trim().length >= 2 ? shops.filter(s => String(s.shop_name || '').toLowerCase().includes(newFor.toLowerCase()) && !deals.some(d => d.shop_id === String(s.id) && (meta?.open_stages || []).includes(d.stage))).slice(0, 8) : []

  return (
    <div className="px-3 sm:px-6 py-4">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {modeToggle}
        <button onClick={() => setSales(true)} className="text-sm font-extrabold rounded-xl px-4 py-2 text-white" style={{ backgroundColor: ORANGE }}>💼 Sales mode</button>
        <button onClick={async () => { const r = await apiFetch(`${API_BASE}/api/deals/scorecard`); setScore(await r.json().catch(() => null)) }} className="text-sm font-bold rounded-xl px-3 py-2" style={{ backgroundColor: '#fff', color: INK, border: '1px solid #e0dbd6' }}>📊 Scorecard</button>
        <div className="relative">
          <input value={newFor} onChange={e => setNewFor(e.target.value)} placeholder="+ New deal: type a shop…" className="rounded-xl px-3 py-2 text-sm" style={{ border: '1px solid #e0dbd6', width: 220 }} />
          {candidates.length > 0 && <div className="absolute z-30 mt-1 rounded-xl shadow-lg" style={{ backgroundColor: '#fff', border: '1px solid #e0dbd6', minWidth: 260 }}>{candidates.map(s => <button key={s.id} onClick={() => create(s)} className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50" style={{ color: INK }}>{s.shop_name}<span className="text-xs" style={{ color: '#888' }}> · {s.pipeline_stage}{s.fit_score ? ` · fit ${s.fit_score}` : ''}</span></button>)}</div>}
        </div>
        <span className="text-xs" style={{ color: '#888' }}>{deals.filter(d => (meta?.open_stages || []).includes(d.stage)).length} open · {deals.filter(d => d.priority === 'HPP' && (meta?.open_stages || []).includes(d.stage)).length} HPP</span>
      </div>
      {toast && <div className="rounded-xl px-3 py-2 mb-3 text-sm font-semibold" style={{ backgroundColor: toast.startsWith('🚫') || toast.startsWith('⚠') ? '#fee2e2' : '#dcfce7', color: toast.startsWith('🚫') || toast.startsWith('⚠') ? '#991b1b' : '#166534' }}>{toast}</div>}
      {loading && <div className="text-sm" style={{ color: '#888' }}>Loading deals…</div>}
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ alignItems: 'flex-start' }}>
        {stages.map(stage => (
          <div key={stage} className="flex-shrink-0" style={{ width: 230 }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (drag) move(drag, stage); setDrag(null) }}>
            <div className="rounded-xl px-3 py-2 mb-2 flex items-center justify-between" style={{ backgroundColor: STAGE_COLOR[stage] || '#444', color: '#fff' }}>
              <span className="text-xs font-extrabold tracking-wide">{stage.toUpperCase()}</span><span className="text-xs font-bold opacity-80">{(byStage[stage] || []).length}</span>
            </div>
            <div className="flex flex-col gap-2 min-h-[60px]">
              {(byStage[stage] || []).map(d => <Card key={d.id} d={d} onOpen={() => setOpen(d.id)} onDragStart={() => setDrag(d)} />)}
            </div>
          </div>
        ))}
      </div>
      {open && <DealCard id={open} user={user} meta={meta} onClose={() => setOpen(null)} onChanged={load} />}
      {sales && <SalesMode user={user} onClose={() => { setSales(false); load() }} onOpenDeal={id => setOpen(id)} />}
      {score && <Scorecard s={score} onClose={() => setScore(null)} />}
    </div>
  )
}

function Card({ d, onOpen, onDragStart }) {
  const late = d.next_step_date && d.next_step_date < today()
  const missing = !d.next_step_date && !['Won', 'Lost', 'Qualified'].includes(d.stage)
  const p = PRI[d.priority]
  return (
    <button draggable onDragStart={onDragStart} onClick={onOpen} className="text-left rounded-xl p-2.5" style={{ backgroundColor: '#fff', border: `1px solid ${late ? '#fca5a5' : '#e5e5e5'}`, borderLeft: `4px solid ${p ? p.fg : '#ddd'}` }}>
      <div className="flex items-start justify-between gap-1">
        <div className="text-sm font-bold leading-snug" style={{ color: INK }}>{d.shop_name}</div>
        {d.priority && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: p?.bg, color: p?.fg }}>{d.priority}</span>}
      </div>
      <div className="text-[11px] mt-1" style={{ color: '#888' }}>{d.days_in_stage}d in stage{d.owner ? ` · ${d.owner}` : ''}{d.deal_type === 'Reactivation' ? ' · 🔁' : ''}</div>
      {(late || missing) ? <div className="text-[11px] font-bold mt-1 px-1.5 py-0.5 rounded inline-block" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>{late ? `⏰ ${d.next_step || 'next step'} · was ${d.next_step_date}` : '⚠ no next step'}</div>
        : d.next_step ? <div className="text-[11px] mt-1" style={{ color: '#444' }}>→ {d.next_step}{d.next_step_date ? <span style={{ color: '#888' }}> · {d.next_step_date}</span> : null}</div> : null}
    </button>
  )
}

function Scorecard({ s, onClose }) {
  const row = (k, v) => <div className="flex justify-between text-sm py-1" style={{ borderBottom: '1px solid #f0f0f0' }}><span style={{ color: '#555' }}>{k}</span><b style={{ color: INK }}>{v}</b></div>
  const obj = o => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'
  return (
    <div className="fixed inset-0 z-[60]" onClick={onClose}><div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,.35)' }} />
      <div onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full sm:w-[440px] bg-white shadow-2xl overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-3"><div className="font-extrabold text-lg" style={{ color: INK }}>📊 Sales scorecard</div><button onClick={onClose} className="text-xl" style={{ color: '#888' }}>✕</button></div>
        {row('Open deals', s.open)}{row('By priority', obj(s.by_priority))}{row('By stage', obj(s.by_stage))}
        {row('Touches this week', `${s.touches_week} (${obj(s.touches_by_type)})`)}{row('By person', obj(s.touches_by_person))}{row('Stage moves this week', s.stage_moves_week)}
        {row('Next steps', `${s.next_steps?.due_today} due today · ${s.next_steps?.overdue} overdue · ${s.next_steps?.missing} missing`)}
        {row('Wins this month', (s.wins_month || []).join(', ') || '—')}{row('Lost reasons', obj(s.lost_reasons))}{row('Top objections', obj(s.top_objections))}
        <div className="text-xs font-bold mt-3 mb-1" style={{ color: '#888' }}>CONVERSION (reached stage → moved further)</div>
        {Object.entries(s.conversion || {}).map(([k, v]) => row(k, v == null ? '—' : `${v}%`))}
        <div className="text-xs font-bold mt-3 mb-1" style={{ color: '#888' }}>AVERAGE DAYS IN STAGE</div>
        {Object.entries(s.avg_days_per_stage || {}).map(([k, v]) => row(k, v == null ? '—' : `${v}d`))}
        <div className="text-xs font-bold mt-3 mb-1" style={{ color: '#888' }}>HPP SHOPS WITH NO DEAL</div>
        <div className="text-sm" style={{ color: INK }}>{(s.hpp_no_deal || []).join(', ') || 'none'}</div>
      </div>
    </div>
  )
}
