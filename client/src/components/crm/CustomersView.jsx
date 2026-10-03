// ⭐ Customers (Mark 2026-10-03): current customers live here, out of the
// pipeline. One card per account: last job, this month vs their usual pace,
// what they owe, setup gaps, and what to pitch. Data from /api/shops/customers.
import { useEffect, useMemo, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { typeBadge } from './shopType.js'

const ORANGE = '#CD4419'
const fmt = n => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
const FLAG = {
  win_back:    { label: '🔁 Win back', bg: '#fee2e2', fg: '#b91c1c', why: d => `no job in ${d} days` },
  slipping:    { label: '📉 Slipping', bg: '#fef3c7', fg: '#92400e', why: () => 'well under their usual pace' },
  overdue:     { label: '💸 Overdue', bg: '#fee2e2', fg: '#b91c1c', why: () => 'past-due invoices' },
  no_invoices: { label: '🫥 No invoices yet', bg: '#f5f3f0', fg: '#666', why: () => 'nothing billed in 12 months' },
}

export default function CustomersView({ modeToggle, onOpenShop }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { apiFetch(`${API_BASE}/api/shops/customers`).then(r => r.json()).then(x => { if (x.error) setErr(x.error); else setD(x) }).catch(e => setErr(e.message)) }, [])
  const list = useMemo(() => {
    let rows = d?.customers || []
    if (filter) rows = rows.filter(r => r.flags.includes(filter))
    if (q.trim()) { const s = q.toLowerCase(); rows = rows.filter(r => r.name.toLowerCase().includes(s)) }
    return rows
  }, [d, filter, q])
  const all = d?.customers || []
  const count = f => all.filter(r => r.flags.includes(f)).length
  const totals = { month: all.reduce((t, r) => t + r.this_month.amount, 0), open: all.reduce((t, r) => t + r.ar.open, 0), overdue: all.reduce((t, r) => t + r.ar.overdue, 0) }

  return (
    <main className="flex-1 flex flex-col" style={{ padding: '1.25rem', minHeight: 0 }}>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <h1 className="text-xl font-bold" style={{ color: '#1a1a1a' }}>Customers</h1>{modeToggle}
      </div>
      {err && <p className="text-sm mb-3" style={{ color: '#b91c1c' }}>{err}</p>}
      {!d && !err && <p className="text-sm" style={{ color: '#888' }}>Reading every customer's invoices…</p>}
      {d && (<>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          {[['Customers', all.length, '#1a1a1a'], ['Billed this month', fmt(totals.month), '#15803d'], ['Open AR', fmt(totals.open), '#1d4ed8'], ['Overdue', fmt(totals.overdue), totals.overdue ? '#b91c1c' : '#888']].map(([l, v, c]) => (
            <div key={l} className="rounded-xl p-3" style={{ backgroundColor: '#f9f8f7', border: '1px solid #ebebeb' }}><p className="text-lg font-bold" style={{ color: c }}>{v}</p><p className="text-xs" style={{ color: '#888' }}>{l}</p></div>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search customers…" className="rounded-lg px-3 py-2 text-sm" style={{ border: '1.5px solid #ddd', outline: 'none', minWidth: 200 }} />
          <button onClick={() => setFilter('')} className="text-xs font-semibold px-3 py-1.5 rounded-full" style={!filter ? { backgroundColor: ORANGE, color: 'white' } : { backgroundColor: '#f5f3f0', color: '#666' }}>All ({all.length})</button>
          {Object.entries(FLAG).map(([k, f]) => count(k) > 0 && (
            <button key={k} onClick={() => setFilter(filter === k ? '' : k)} className="text-xs font-semibold px-3 py-1.5 rounded-full" style={filter === k ? { backgroundColor: f.fg, color: 'white' } : { backgroundColor: f.bg, color: f.fg }}>{f.label} ({count(k)})</button>
          ))}
          <span className="text-[11px] ml-auto" style={{ color: '#aaa' }}>as of {d.as_of} · {d.invoices_read} invoices read · win back after {d.win_back_days} quiet days</span>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {list.map(r => <CustomerCard key={r.id} r={r} winBackDays={d.win_back_days} onOpen={() => onOpenShop(r.id)} />)}
          {!list.length && <p className="text-sm" style={{ color: '#888' }}>Nothing here.</p>}
        </div>
      </>)}
    </main>
  )
}

function CustomerCard({ r, winBackDays, onOpen }) {
  const tb = typeBadge(r.type)
  const paceTxt = r.pace == null ? null : r.pace >= 1 ? `${Math.round(r.pace * 100)}% of usual · ahead` : `${Math.round(r.pace * 100)}% of usual`
  const paceColor = r.pace == null ? '#888' : r.pace < 0.6 ? '#b91c1c' : r.pace < 0.9 ? '#92400e' : '#15803d'
  const main = r.flags.find(f => FLAG[f])
  return (
    <div onClick={onOpen} className="bg-white rounded-xl shadow-sm cursor-pointer hover:shadow-md" style={{ border: `1px solid ${main === 'win_back' || main === 'overdue' ? '#fca5a5' : main === 'slipping' ? '#fcd34d' : '#ebebeb'}`, borderLeft: `5px solid ${tb.color}` }}>
      <div className="px-3 py-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold leading-snug" style={{ color: '#1a1a1a', wordBreak: 'break-word' }}>{r.name}</p>
          <div className="flex items-center gap-1 flex-wrap mt-1">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: tb.bg, color: tb.color }}>{tb.label}</span>
            {r.stage === 'active2' && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#e0f2fe', color: '#0369a1' }}>🔄 backup</span>}
            {r.flags.filter(f => FLAG[f]).map(f => <span key={f} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: FLAG[f].bg, color: FLAG[f].fg }} title={FLAG[f].why(winBackDays)}>{FLAG[f].label}</span>)}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-base font-extrabold tabular-nums" style={{ color: '#1a1a1a' }}>{fmt(r.year.amount)}</p>
          <p className="text-[10px]" style={{ color: '#888' }}>{r.year.count} jobs · 12 mo</p>
        </div>
      </div>
      <div className="px-3 pb-2 grid grid-cols-3 gap-2 text-xs">
        <div><p style={{ color: '#888' }}>Last job</p><p className="font-semibold" style={{ color: r.days_since == null ? '#888' : r.days_since > winBackDays ? '#b91c1c' : '#1a1a1a' }}>{r.last_invoice ? `${r.days_since}d ago` : '—'}</p></div>
        <div><p style={{ color: '#888' }}>This month</p><p className="font-semibold" style={{ color: '#1a1a1a' }}>{r.this_month.count} · {fmt(r.this_month.amount)}</p>{paceTxt && <p className="text-[10px] font-semibold" style={{ color: paceColor }}>{paceTxt}</p>}{!paceTxt && r.usual.count > 0 && <p className="text-[10px]" style={{ color: '#888' }}>usual {r.usual.count}/mo</p>}</div>
        <div><p style={{ color: '#888' }}>Owes us</p><p className="font-semibold" style={{ color: r.ar.overdue ? '#b91c1c' : r.ar.open ? '#1d4ed8' : '#15803d' }}>{r.ar.open ? fmt(r.ar.open) : 'paid up'}</p>{r.ar.overdue > 0 && <p className="text-[10px] font-semibold" style={{ color: '#b91c1c' }}>{fmt(r.ar.overdue)} overdue</p>}</div>
      </div>
      {(r.setup.length > 0 || r.upsell.length > 0) && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {r.setup.map(s => <span key={s} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>⚠ {s}</span>)}
          {r.upsell.map(s => <span key={s} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#dcfce7', color: '#15803d' }}>💰 {s}</span>)}
        </div>
      )}
      {r.people.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {r.people.map((p, i) => (
            <span key={i} className="text-[11px] px-2 py-0.5 rounded-lg flex items-center gap-1" style={{ backgroundColor: '#f5f3f0', color: '#444' }}>
              <b>{p.name || 'Contact'}</b>{p.title ? <span style={{ color: '#888' }}>· {p.title}</span> : null}
              {p.phone && <a href={`tel:${p.phone}`} onClick={e => e.stopPropagation()} style={{ color: '#15803d' }}>📞</a>}
              {p.phone && <a href={`sms:${p.phone}`} onClick={e => e.stopPropagation()} style={{ color: '#1d4ed8' }}>💬</a>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
