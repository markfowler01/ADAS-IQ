// ⭐ Customers (Mark 2026-10-03): current customers live here, out of the
// pipeline. One card per account: a health strip, one plain status line, the
// 12-month total, a 6-month bar chart of their jobs, and three numbers that
// matter (last job · this month · owes us). Grouped Needs attention / Owes us /
// Healthy. Data from /api/shops/customers.
import { useEffect, useMemo, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { typeBadge } from './shopType.js'

const ORANGE = '#CD4419', INK = '#1a1a1a', MUTED = '#8a847e', LINE = '#ebe7e2'
const RED = '#b91c1c', AMBER = '#b45309', GREEN = '#15803d', BLUE = '#1d4ed8'
const fmt = n => `$${Math.round(Number(n || 0)).toLocaleString()}`
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Health = the one thing to know about this customer right now.
function healthOf(r, winBackDays) {
  if (r.flags.includes('win_back')) return { key: 'attention', color: RED, text: `No job in ${r.days_since} days`, group: 'Needs attention' }
  if (r.flags.includes('slipping')) return { key: 'attention', color: AMBER, text: `Slipping — ${Math.round((r.pace || 0) * 100)}% of their usual pace`, group: 'Needs attention' }
  if (r.flags.includes('overdue')) return { key: 'owes', color: AMBER, text: `${fmt(r.ar.overdue)} overdue since ${r.ar.oldest_due}`, group: 'Owes us' }
  if (r.flags.includes('no_invoices')) return { key: 'attention', color: MUTED, text: 'Nothing billed in 12 months', group: 'Needs attention' }
  return { key: 'healthy', color: GREEN, text: r.pace != null && r.pace >= 1 ? 'On pace or ahead' : 'Healthy', group: 'Healthy' }
}

export default function CustomersView({ modeToggle, onOpenShop }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [only, setOnly] = useState('')
  useEffect(() => { apiFetch(`${API_BASE}/api/shops/customers`).then(r => r.json()).then(x => { if (x.error) setErr(x.error); else setD(x) }).catch(e => setErr(e.message)) }, [])
  const all = d?.customers || []
  const rows = useMemo(() => {
    let r = all.map(c => ({ ...c, health: healthOf(c, d?.win_back_days || 60) }))
    if (q.trim()) { const s = q.toLowerCase(); r = r.filter(c => c.name.toLowerCase().includes(s)) }
    if (only) r = r.filter(c => c.health.group === only)
    return r
  }, [all, q, only, d])
  const groups = ['Needs attention', 'Owes us', 'Healthy'].map(g => ({ name: g, rows: rows.filter(c => c.health.group === g).sort((a, b) => b.year.amount - a.year.amount) })).filter(g => g.rows.length)
  const totals = { month: all.reduce((t, r) => t + r.this_month.amount, 0), open: all.reduce((t, r) => t + r.ar.open, 0), overdue: all.reduce((t, r) => t + r.ar.overdue, 0) }
  const countOf = g => all.filter(c => healthOf(c, d?.win_back_days || 60).group === g).length

  return (
    <main className="flex-1 flex flex-col" style={{ padding: '1.25rem', minHeight: 0 }}>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <h1 className="text-xl font-bold" style={{ color: INK }}>Customers</h1>{modeToggle}
      </div>
      {err && <p className="text-sm mb-3" style={{ color: RED }}>{err}</p>}
      {!d && !err && <p className="text-sm" style={{ color: MUTED }}>Reading every customer's invoices…</p>}
      {d && (<>
        {/* Four numbers, quiet */}
        <div className="flex flex-wrap gap-x-8 gap-y-2 mb-4 pb-4" style={{ borderBottom: `1px solid ${LINE}` }}>
          {[['Customers', all.length, INK], ['Billed this month', fmt(totals.month), GREEN], ['Open AR', fmt(totals.open), BLUE], ['Overdue', fmt(totals.overdue), totals.overdue ? RED : MUTED]].map(([l, v, c]) => (
            <div key={l}><div className="text-2xl font-extrabold tabular-nums leading-none" style={{ color: c }}>{v}</div><div className="text-[11px] uppercase tracking-wider mt-1" style={{ color: MUTED }}>{l}</div></div>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search customers…" className="rounded-lg px-3 py-2 text-sm" style={{ border: `1.5px solid ${LINE}`, outline: 'none', minWidth: 220, backgroundColor: 'white' }} />
          {[['', 'All', all.length], ['Needs attention', '🔴 Needs attention', countOf('Needs attention')], ['Owes us', '🟠 Owes us', countOf('Owes us')], ['Healthy', '🟢 Healthy', countOf('Healthy')]].map(([k, l, n]) => (
            <button key={k} onClick={() => setOnly(k)} className="text-xs font-semibold px-3 py-1.5 rounded-full" style={only === k ? { backgroundColor: INK, color: 'white' } : { backgroundColor: 'white', color: '#555', border: `1px solid ${LINE}` }}>{l} · {n}</button>
          ))}
          <span className="text-[11px] ml-auto" style={{ color: '#b5afa9' }}>as of {d.as_of} · {d.invoices_read} invoices · win back after {d.win_back_days} quiet days</span>
        </div>
        {groups.map(g => (
          <section key={g.name} className="mb-6">
            <h2 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: MUTED }}>{g.name} · {g.rows.length}</h2>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {g.rows.map(r => <CustomerCard key={r.id} r={r} onOpen={() => onOpenShop(r.id)} />)}
            </div>
          </section>
        ))}
        {!rows.length && <p className="text-sm" style={{ color: MUTED }}>Nothing here.</p>}
      </>)}
    </main>
  )
}

function Bars({ series }) {
  const max = Math.max(1, ...series.map(m => m.count))
  return (
    <div className="flex items-end gap-1" style={{ height: 34 }} title={series.map(m => `${MON[Number(m.ym.slice(5)) - 1]}: ${m.count} job${m.count === 1 ? '' : 's'} · ${fmt(m.amount)}`).join('\n')}>
      {series.map((m, i) => {
        const last = i === series.length - 1
        return (
          <div key={m.ym} className="flex flex-col items-center" style={{ width: 16 }}>
            <div style={{ width: 12, height: Math.max(2, Math.round((m.count / max) * 24)), borderRadius: 2, backgroundColor: m.count ? (last ? ORANGE : '#d9cfc7') : LINE }} />
            <div className="text-[9px] mt-0.5" style={{ color: last ? ORANGE : '#b5afa9' }}>{MON[Number(m.ym.slice(5)) - 1][0]}</div>
          </div>
        )
      })}
    </div>
  )
}

function CustomerCard({ r, onOpen }) {
  const tb = typeBadge(r.type), h = r.health
  const notes = [...r.setup.map(s => `⚠ Needs ${s}`), ...r.upsell.map(s => `💰 ${s.replace(' — pitch it', ': pitch it').replace(' — offer them', ': offer them')}`)]
  const who = r.people[0]
  return (
    <div onClick={onOpen} className="bg-white rounded-xl cursor-pointer transition-shadow hover:shadow-md" style={{ border: `1px solid ${LINE}`, boxShadow: '0 1px 2px rgba(0,0,0,.04)', overflow: 'hidden' }}>
      <div style={{ height: 4, backgroundColor: h.color }} />
      <div className="px-3.5 pt-2.5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-bold leading-tight truncate" style={{ color: INK }}>{r.name}</p>
            <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: tb.color }}><span className="font-bold">{tb.label}</span>{r.stage === 'active2' && <span style={{ color: MUTED }}>· backup</span>}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-lg font-extrabold tabular-nums leading-none" style={{ color: INK }}>{fmt(r.year.amount)}</p>
            <p className="text-[10px] mt-1" style={{ color: MUTED }}>{r.year.count} jobs · 12 mo</p>
          </div>
        </div>
        <p className="text-xs font-semibold mt-2" style={{ color: h.color }}>{h.text}</p>
        <div className="flex items-end justify-between gap-3 mt-2.5">
          <Bars series={r.series || []} />
          <div className="flex gap-4 text-right">
            <div><div className="text-[10px] uppercase tracking-wider" style={{ color: MUTED }}>Last job</div><div className="text-sm font-bold tabular-nums" style={{ color: h.key === 'attention' && r.days_since != null ? RED : INK }}>{r.days_since == null ? '—' : `${r.days_since}d`}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider" style={{ color: MUTED }}>Month</div><div className="text-sm font-bold tabular-nums" style={{ color: INK }}>{r.this_month.count}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider" style={{ color: MUTED }}>Owes</div><div className="text-sm font-bold tabular-nums" style={{ color: r.ar.overdue ? RED : r.ar.open ? BLUE : GREEN }}>{r.ar.open ? fmt(r.ar.open) : '$0'}</div></div>
          </div>
        </div>
        {(notes.length > 0 || who) && (
          <div className="flex items-center justify-between gap-2 mt-2.5 pt-2" style={{ borderTop: `1px solid ${LINE}` }}>
            <p className="text-[11px] truncate" style={{ color: MUTED }} title={notes.join(' · ')}>{notes.join(' · ')}</p>
            {who && (
              <span className="flex items-center gap-1.5 flex-shrink-0 text-[11px]" style={{ color: '#555' }}>
                <span className="truncate" style={{ maxWidth: 110 }}>{who.name || 'Contact'}</span>
                {who.phone && <a href={`tel:${who.phone}`} onClick={e => e.stopPropagation()} className="rounded-full px-1.5" style={{ backgroundColor: '#dcfce7', color: GREEN }}>📞</a>}
                {who.phone && <a href={`sms:${who.phone}`} onClick={e => e.stopPropagation()} className="rounded-full px-1.5" style={{ backgroundColor: '#e8f0fe', color: BLUE }}>💬</a>}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
