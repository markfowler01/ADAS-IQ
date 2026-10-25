// ⭐ Customers (Mark 2026-10-03): current customers live here, out of the
// pipeline. One card per account: a health strip, one plain status line, the
// 12-month total, a 6-month bar chart of their jobs, and five numbers that
// matter (last job · this month · owes us · average month · average invoice). Grouped Needs attention / Owes us /
// Healthy. Data from /api/shops/customers.
//
// Calmed down 2026-10-09 (Mark: "I don't like looking at this"). Same data,
// one color signal per card: the status dot + line carries the health, every
// dollar figure is ink, red is reserved for money that's actually overdue.
import { useEffect, useMemo, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { typeBadge } from './shopType.js'
import { WifiCopy, normShopName } from '../MobileJobCard.jsx'

const ORANGE = '#CD4419', INK = '#0A0A0A', MUTED = '#8a847e', LINE = '#ebe7e2', CREAM = '#f5f3f0'
const RED = '#b91c1c', AMBER = '#b45309', GREEN = '#15803d'
const fmt = n => `$${Math.round(Number(n || 0)).toLocaleString()}`
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// Type badge without its emoji — the emoji is for the pipeline cards; here it's noise.
const plainType = t => String(t || '').replace(/^[^\w]+/, '').trim()

// Health = the one thing to know about this customer right now.
function healthOf(r, winBackDays) {
  if (r.flags.includes('no_crm')) return { key: 'fix', color: ORANGE, text: 'Invoiced in Books, not in the CRM yet', group: 'Not in the CRM' }
  if (r.flags.includes('not_marked')) return { key: 'fix', color: ORANGE, text: `Sends us cars but is "${r.stage}" in the CRM`, group: 'Not marked as a customer' }
  if (r.flags.includes('win_back')) return { key: 'attention', color: AMBER, text: `No job in ${r.days_since} days`, group: 'Needs attention' }
  if (r.flags.includes('slipping')) {
    const pct = Math.round((r.pace || 0) * 100)
    return { key: 'attention', color: AMBER, text: pct > 0 ? `Slipping · ${pct}% of their usual pace` : 'Slipping · nothing lately', group: 'Needs attention' }
  }
  if (r.flags.includes('overdue')) return { key: 'owes', color: RED, text: `${fmt(r.ar.overdue)} overdue since ${r.ar.oldest_due}`, group: 'Owes us' }
  if (r.flags.includes('no_invoices')) return { key: 'attention', color: MUTED, text: 'Nothing billed in 12 months', group: 'Needs attention' }
  return { key: 'healthy', color: GREEN, text: r.pace != null && r.pace >= 1 ? 'On pace or ahead' : 'Healthy', group: 'Healthy' }
}

const GROUP_NOTE = {
  'Not marked as a customer': 'They invoice regularly — one tap moves them out of the pipeline',
  'Needs attention': 'Quiet or slowing down — worth a call',
  'Owes us': 'Overdue invoices',
}

export default function CustomersView({ modeToggle, onOpenShop, onMarkCustomer, shopWifi = {} }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [only, setOnly] = useState('')
  // 📅 Usually calls (Mark 2026-10-24) — one fetch for every card.
  const [rhythm, setRhythm] = useState(null)
  useEffect(() => { apiFetch(`${API_BASE}/api/shop-rhythm/all`).then(r => r.ok ? r.json() : null).then(x => setRhythm(x?.ready ? x : null)).catch(() => {}) }, [])
  const rhythmFor = r => { if (!rhythm) return null; const id = rhythm.shops[r.id] ? r.id : rhythm.byName[String(r.name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')]; const x = id && rhythm.shops[id]; if (!x) return null; return x.n >= (rhythm.minJobs || 8) && x.top?.length ? x : (x.pay?.median != null ? { ...x, top: null } : null) }
  useEffect(() => { apiFetch(`${API_BASE}/api/shops/customers`).then(r => r.json()).then(x => { if (x.error) setErr(x.error); else setD(x) }).catch(e => setErr(e.message)) }, [])
  const all = d?.customers || []
  const rows = useMemo(() => {
    let r = all.map(c => ({ ...c, health: healthOf(c, d?.win_back_days || 60) }))
    if (q.trim()) { const s = q.toLowerCase(); r = r.filter(c => c.name.toLowerCase().includes(s)) }
    if (only) r = r.filter(c => c.health.group === only)
    return r
  }, [all, q, only, d])
  const byRevenue = (a, b) => (b.year.amount - a.year.amount) || (b.year.count - a.year.count)
  // Biggest 12-month accounts lead the page. They stay out of the health
  // groups below so a top shop isn't listed twice.
  const topRows = only ? [] : [...rows].sort(byRevenue).filter(c => c.year.amount > 0).slice(0, 8)
  const topIds = new Set(topRows.map(c => c.id))
  const groups = ['Not marked as a customer', 'Not in the CRM', 'Needs attention', 'Owes us', 'Healthy'].map(g => ({ name: g, rows: rows.filter(c => c.health.group === g && !topIds.has(c.id)).sort(byRevenue) })).filter(g => g.rows.length)
  const totals = { month: all.reduce((t, r) => t + r.this_month.amount, 0), open: all.reduce((t, r) => t + r.ar.open, 0), overdue: all.reduce((t, r) => t + r.ar.overdue, 0) }
  const countOf = g => all.filter(c => healthOf(c, d?.win_back_days || 60).group === g).length
  const renderCard = r => (
    <CustomerCard key={r.id} r={r} rhythm={rhythmFor(r)} wifi={shopWifi[normShopName(r.name)]} onOpen={() => r.flags.includes('no_crm') ? null : onOpenShop(r.id)} onMark={r.flags.includes('not_marked') && onMarkCustomer ? async () => { await onMarkCustomer(r.id); setD(x => ({ ...x, customers: x.customers.map(c => c.id === r.id ? { ...c, marked: true, stage: 'active', flags: c.flags.filter(f => f !== 'not_marked') } : c) })) } : null} />
  )

  return (
    <main className="flex-1 flex flex-col" style={{ padding: '1.25rem', minHeight: 0 }}>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <h1 className="text-xl font-bold" style={{ color: INK }}>Customers</h1>{modeToggle}
      </div>
      {err && <p className="text-sm mb-3" style={{ color: RED }}>{err}</p>}
      {!d && !err && <p className="text-sm" style={{ color: MUTED }}>Reading every customer's invoices…</p>}
      {d && (<>
        {/* Four numbers, all ink — only overdue money gets a color */}
        <div className="flex flex-wrap gap-x-10 gap-y-3 mb-5 pb-5" style={{ borderBottom: `1px solid ${LINE}` }}>
          {[['Customers', all.length, INK], ['Billed this month', fmt(totals.month), INK], ['Open AR', fmt(totals.open), INK], ['Overdue', fmt(totals.overdue), totals.overdue ? RED : MUTED]].map(([l, v, c]) => (
            <div key={l}><div className="text-2xl font-extrabold tabular-nums leading-none" style={{ color: c }}>{v}</div><div className="text-[11px] uppercase tracking-wider mt-1.5" style={{ color: MUTED }}>{l}</div></div>
          ))}
          {rhythm?.company?.top?.length > 0 && (
            <div title={`Last 12 months · ${fmt(rhythm.company.total)} across ${rhythm.company.cars} cars, by the day the job came in`}>
              <div className="text-2xl font-extrabold leading-none flex gap-3" style={{ color: '#3730a3' }}>
                {rhythm.company.top.map(t => <span key={t.day}>{t.day} <span className="tabular-nums">{t.pct}%</span></span>)}
              </div>
              <div className="text-[11px] uppercase tracking-wider mt-1.5" style={{ color: MUTED }}>📅 Busiest call days · share of sales · {rhythm.company.top.map(t => `${t.day} ${fmt(t.dollars)}`).join(' · ')}</div>
            </div>
          )}
        </div>
        {rhythm && ((rhythm.quiet || []).length > 0 || rhythm.company?.cash) && (
          <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            {(rhythm.quiet || []).length > 0 && (
              <div className="rounded-xl p-3" style={{ backgroundColor: '#fff7ed', border: '1px solid #fed7aa' }}>
                <p className="text-xs font-extrabold mb-1.5" style={{ color: '#9a3412' }}>📞 CALL THESE · went quiet on their usual days</p>
                {rhythm.quiet.slice(0, 6).map(x => (
                  <button key={x.id} onClick={() => onOpenShop(x.id)} className="w-full text-left text-[12px] py-1 flex justify-between gap-2" style={{ borderTop: '1px solid #fde4cf', color: INK }}>
                    <span className="truncate"><b>{x.name}</b> · {x.days}d quiet · usually {x.usual.join('/')}</span>
                    <span className="flex-shrink-0 font-bold" style={{ color: '#9a3412' }}>~{fmt(x.worth)}</span>
                  </button>
                ))}
              </div>
            )}
            {rhythm.company?.cash && (
              <div className="rounded-xl p-3" style={{ backgroundColor: '#f0fdfa', border: '1px solid #99f6e4' }}>
                <p className="text-xs font-extrabold mb-1" style={{ color: '#0f766e' }}>💳 CASH LIKELY THIS WEEK · <span className="text-base">{fmt(rhythm.company.cash.thisWeek)}</span></p>
                <p className="text-[11px] mb-1.5" style={{ color: MUTED }}>Open invoices due by each shop's own pay habit</p>
                {rhythm.company.cash.late.slice(0, 5).map(x => (
                  <button key={x.id} onClick={() => onOpenShop(x.id)} className="w-full text-left text-[12px] py-1 flex justify-between gap-2" style={{ borderTop: '1px solid #ccfbf1', color: INK }}>
                    <span className="truncate">⏰ <b>{x.name}</b> · {x.daysLate}d past their usual {x.median}d</span>
                    <span className="flex-shrink-0 font-bold" style={{ color: RED }}>{fmt(x.amount)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap mb-5">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search customers…" className="rounded-lg px-3 py-2 text-sm" style={{ border: `1.5px solid ${LINE}`, outline: 'none', minWidth: 220, backgroundColor: 'white' }} />
          {[['', 'All', all.length], ['Not marked as a customer', 'Not marked', countOf('Not marked as a customer') + countOf('Not in the CRM')], ['Needs attention', 'Needs attention', countOf('Needs attention')], ['Owes us', 'Owes us', countOf('Owes us')], ['Healthy', 'Healthy', countOf('Healthy')]].map(([k, l, n]) => (
            <button key={k} onClick={() => setOnly(k)} className="text-xs font-semibold px-3 py-1.5 rounded-full" style={only === k ? { backgroundColor: INK, color: 'white' } : { backgroundColor: 'white', color: '#555', border: `1px solid ${LINE}` }}>{l} <span style={{ opacity: .6 }}>{n}</span></button>
          ))}
          <span className="text-[11px] ml-auto" style={{ color: '#b5afa9' }}>as of {d.as_of} · {d.invoices_read} invoices · win back after {d.win_back_days} quiet days</span>
        </div>
        {topRows.length > 0 && (
          <section className="mb-7">
            <div className="flex items-baseline gap-2 mb-2.5">
              <h2 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: INK }}>Top customers <span style={{ color: MUTED, fontWeight: 600 }}>{topRows.length}</span></h2>
              <span className="text-[11px]" style={{ color: MUTED }}>— Highest billed, last 12 months</span>
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
              {topRows.map(renderCard)}
            </div>
          </section>
        )}
        {groups.map(g => (
          <section key={g.name} className="mb-7">
            <div className="flex items-baseline gap-2 mb-2.5">
              <h2 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: INK }}>{g.name} <span style={{ color: MUTED, fontWeight: 600 }}>{g.rows.length}</span></h2>
              {GROUP_NOTE[g.name] && <span className="text-[11px]" style={{ color: MUTED }}>— {GROUP_NOTE[g.name]}</span>}
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
              {g.rows.map(renderCard)}
            </div>
          </section>
        ))}
        {!rows.length && <p className="text-sm" style={{ color: MUTED }}>Nothing here.</p>}
      </>)}
    </main>
  )
}

// Six months of jobs. No letters under the bars — the hover tooltip has the
// month-by-month detail; the shape is what you read at a glance.
function Bars({ series, color = ORANGE }) {
  const max = Math.max(1, ...series.map(m => m.count))
  return (
    <div className="flex flex-col gap-1" title={series.map(m => `${MON[Number(m.ym.slice(5)) - 1]}: ${m.count} job${m.count === 1 ? '' : 's'} · ${fmt(m.amount)}`).join('\n')}>
      <div className="flex items-end gap-1" style={{ height: 26 }}>
        {series.map((m, i) => {
          const last = i === series.length - 1
          return <div key={m.ym} style={{ width: 10, height: Math.max(3, Math.round((m.count / max) * 26)), borderRadius: 2, backgroundColor: m.count ? (last ? color : '#d9cfc7') : '#efebe7' }} />
        })}
      </div>
      <div className="text-[10px]" style={{ color: '#b5afa9' }}>last 6 mo</div>
    </div>
  )
}

function Stat({ label, value, color = INK, title }) {
  return (
    <div className="text-right" title={title}>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: MUTED }}>{label}</div>
      <div className="text-sm font-bold tabular-nums leading-tight mt-0.5" style={{ color }}>{value}</div>
    </div>
  )
}

// The card's headline is the last 12 months billed. Average month spreads that
// across the year. Average ticket is that total divided by the invoices.
function averages(r) {
  const count = Number(r.year?.count || 0)
  const amount = Number(r.year?.amount || 0)
  if (!count || !amount) return { month: null, ticket: null }
  return { month: amount / 12, ticket: amount / count }
}

function CustomerCard({ r, onOpen, onMark, wifi, rhythm }) {
  const tb = typeBadge(r.type), h = r.health
  // Plain words, no emoji: "Needs Books link", "Full Service is OFF", "No pre-scans"
  const notes = [...r.setup.map(s => `Needs ${s}`), ...r.upsell.map(s => s.replace(/\s+—\s+.*$/, ''))]
  const who = r.people[0]
  const overdue = r.ar.overdue > 0
  const avg = averages(r)
  return (
    <div onClick={onOpen} className="rounded-xl cursor-pointer overflow-hidden transition-shadow hover:shadow-md" style={{ backgroundColor: CREAM, border: `1px solid ${LINE}`, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
      <div className="px-4 py-2.5 flex items-start justify-between gap-3" style={{ backgroundColor: tb.color }}>
        <div className="min-w-0">
          <p className="text-[15px] font-bold leading-tight truncate text-white">{r.name}</p>
          <p className="text-[10px] mt-1 font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,.9)' }}>{plainType(tb.label)}{r.stage === 'active2' && <span className="normal-case tracking-normal font-semibold"> · backup</span>}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-base font-extrabold tabular-nums leading-none text-white" style={overdue ? { textDecoration: 'underline', textDecorationColor: '#fff', textDecorationThickness: '2px', textUnderlineOffset: '3px' } : undefined}>{fmt(r.year.amount)}</p>
          <p className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,.8)' }}>{r.year.count} jobs · 12 mo</p>
        </div>
      </div>

      <div style={{ padding: '12px 16px 12px' }}>
      {(wifi?.name || wifi?.password) && <div className="mb-2"><WifiCopy wifi={wifi} bg="#fff" /></div>}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold flex items-center gap-2 min-w-0" style={{ color: h.key === 'healthy' || h.key === 'owes' || h.key === 'fix' ? h.color : INK }}>
          <span className="inline-block rounded-full flex-shrink-0" style={{ width: 8, height: 8, backgroundColor: h.color }} />
          <span className="truncate">{h.text}</span>
        </p>
        {onMark && <button onClick={e => { e.stopPropagation(); onMark() }} className="text-[11px] font-bold rounded-lg px-2.5 py-1 text-white flex-shrink-0" style={{ backgroundColor: ORANGE }}>Mark as customer</button>}
      </div>

      {rhythm?.top && <p className="text-[11px] mt-1.5 font-semibold" style={{ color: '#3730a3' }} title={`Based on ${rhythm.n} jobs in the last 12 months`}>📅 Usually calls: {rhythm.top.map(t => `${t.day} ${t.pct}%`).join(' · ')}</p>}
      {rhythm?.pay?.median != null && <p className="text-[11px] mt-0.5 font-semibold" style={{ color: rhythm.pay.late ? RED : '#0f766e' }} title={`Median days from invoice to paid, ${rhythm.pay.paid} paid invoices in 12 months`}>💳 Usually pays in {rhythm.pay.median} days{rhythm.pay.late ? ` · ${fmt(rhythm.pay.late)} late for them` : rhythm.pay.week ? ` · ${fmt(rhythm.pay.week)} likely this week` : ''}</p>}
      <div className="flex items-end justify-between gap-4 mt-3">
        <Bars series={r.series || []} color={tb.color} />
        <div className="flex gap-5">
          <Stat label="Last job" value={r.days_since == null ? '—' : `${r.days_since}d`} />
          <Stat label="This mo" value={r.this_month.count} />
          <Stat label="Owes" value={r.ar.open ? fmt(r.ar.open) : '—'} color={overdue ? RED : INK} />
        </div>
      </div>
      <div className="flex justify-end gap-5 mt-2">
        <Stat label="Avg / mo" value={avg.month == null ? '—' : fmt(avg.month)} title="Last 12 months billed, divided by 12" />
        <Stat label="Avg ticket" value={avg.ticket == null ? '—' : fmt(avg.ticket)} title="Average invoice over the last 12 months" />
      </div>

      {(notes.length > 0 || who) && (
        <div className="flex items-center justify-between gap-2 mt-3 pt-2.5" style={{ borderTop: `1px solid ${LINE}` }}>
          <div className="flex gap-1 flex-wrap min-w-0" title={notes.join(' · ')}>
            {notes.slice(0, 2).map(n => <span key={n} className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: '#fff', color: '#6b645e' }}>{n}</span>)}
            {notes.length > 2 && <span className="text-[10px] px-1 py-0.5" style={{ color: MUTED }}>+{notes.length - 2}</span>}
          </div>
          {who && (
            <span className="flex items-center gap-1.5 flex-shrink-0 text-[11px]" style={{ color: '#555' }}>
              <span className="truncate" style={{ maxWidth: 110 }}>{who.name || 'Contact'}</span>
              {who.phone && <a href={`tel:${who.phone}`} onClick={e => e.stopPropagation()} className="rounded-full px-1.5 py-0.5 font-bold" style={{ backgroundColor: '#fff', color: INK }}>Call</a>}
              {who.phone && <a href={`sms:${who.phone}`} onClick={e => e.stopPropagation()} className="rounded-full px-1.5 py-0.5 font-bold" style={{ backgroundColor: '#fff', color: INK }}>Text</a>}
            </span>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
