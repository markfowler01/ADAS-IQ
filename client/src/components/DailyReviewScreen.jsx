import { useState, useEffect, useCallback } from 'react'
import Navbar from './Navbar'
import { API_BASE, apiFetch, ORANGE, fmt, COLORS, PageHeader, Card, SectionLabel, Button, StatCard, EmptyState } from './books/shared'

function deltaBadge(pct) {
  if (pct === null || pct === undefined) {
    return <span className="text-xs text-gray-400">—</span>
  }
  const positive = pct >= 0
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{
        backgroundColor: positive ? '#f0fdf4' : '#fef2f2',
        color: positive ? '#15803d' : '#b91c1c',
      }}>
      {positive ? '↑' : '↓'} {Math.abs(pct)}%
    </span>
  )
}

export default function DailyReviewScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [data, setData] = useState(null)
  const [trends, setTrends] = useState(null)
  const [declined, setDeclined] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [d, t, dc] = await Promise.all([
        apiFetch(`${API_BASE}/api/analytics/daily-review`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/analytics/trends?period=daily&count=14`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/declined/report?period=this_month`).then(r => r.json()).catch(() => null),
      ])
      setData(d)
      setTrends(t)
      setDeclined(dc)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
        <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
        <div className="py-16 text-center text-gray-400 text-sm">Loading daily review…</div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="min-h-screen" style={{ backgroundColor: COLORS.surfaceMuted }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <PageHeader
          title="Daily Review"
          subtitle={new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          actions={<Button variant="secondary" size="sm" onClick={load}>↻ Refresh</Button>} />

        {/* Sales snapshot */}
        <div className="mb-8">
          <SectionLabel>Sales</SectionLabel>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: COLORS.successSoft }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLORS.success }}>Today</p>
                {deltaBadge(data.sales.day_delta_pct)}
              </div>
              <p className="text-2xl lg:text-3xl font-bold mt-1.5" style={{ color: COLORS.success }}>{fmt(data.sales.today)}</p>
              <p className="text-xs mt-1" style={{ color: COLORS.textMuted }}>vs {fmt(data.sales.yesterday)} yesterday</p>
            </div>
            <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: COLORS.infoSoft }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLORS.info }}>This Week</p>
                {deltaBadge(data.sales.week_delta_pct)}
              </div>
              <p className="text-2xl lg:text-3xl font-bold mt-1.5" style={{ color: COLORS.info }}>{fmt(data.sales.week)}</p>
              <p className="text-xs mt-1" style={{ color: COLORS.textMuted }}>vs {fmt(data.sales.last_week)} last week</p>
            </div>
            <StatCard label="Month to Date" value={fmt(data.sales.mtd)} tone="primary"
              sublabel="Revenue this month" />
            <StatCard label="Net MTD" value={fmt(data.expenses.net_mtd)}
              tone={data.expenses.net_mtd >= 0 ? 'success' : 'danger'}
              sublabel={`After ${fmt(data.expenses.mtd)} expenses`} />
          </div>
        </div>

        {/* Action items */}
        <div className="mb-8">
          <SectionLabel>Needs Attention</SectionLabel>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard emoji="📋" label="Jobs Need Billing"
              value={data.jobs.needs_billing} tone="warning"
              onClick={() => onNavigate('books')} />
            <StatCard emoji="📧" label="Invoices Sent"
              value={data.invoices.sent_not_paid} tone="info"
              onClick={() => onNavigate('books')} />
            <StatCard emoji="🚨" label="Overdue"
              value={data.invoices.overdue_count} tone="danger"
              onClick={() => onNavigate('books')} />
            <StatCard emoji="💵" label="Outstanding"
              value={fmt(data.invoices.outstanding)} tone="primary"
              onClick={() => onNavigate('books')} />
          </div>
        </div>

        {/* Trend chart */}
        {trends?.buckets && (
          <div className="mb-6 rounded-xl border shadow-sm p-5" style={{ borderColor: '#f0ece8' }}>
            <h2 className="text-sm font-semibold mb-4" style={{ color: '#1a1a1a' }}>14-Day Revenue Trend</h2>
            <TrendChart buckets={trends.buckets} />
          </div>
        )}

        {/* Two columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
          {/* Top customers */}
          <div className="rounded-xl border shadow-sm" style={{ borderColor: '#f0ece8' }}>
            <div className="px-5 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
              <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>🏆 Top Customers (MTD)</h3>
            </div>
            {data.top_customers.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">No paid invoices yet this month</div>
            ) : (
              <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
                {data.top_customers.map((c, i) => (
                  <div key={c.name} className="px-5 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 font-mono w-5">{i + 1}.</span>
                      <span className="text-sm text-gray-700 truncate">{c.name}</span>
                    </div>
                    <span className="text-sm font-semibold" style={{ color: ORANGE }}>{fmt(c.revenue)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Busy customers */}
          <div className="rounded-xl border shadow-sm" style={{ borderColor: '#f0ece8' }}>
            <div className="px-5 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
              <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>🔥 Busiest Customers (MTD)</h3>
            </div>
            {data.busy_customers.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">No jobs this month</div>
            ) : (
              <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
                {data.busy_customers.map((c, i) => (
                  <div key={c.name} className="px-5 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 font-mono w-5">{i + 1}.</span>
                      <span className="text-sm text-gray-700 truncate">{c.name}</span>
                    </div>
                    <span className="text-sm font-semibold" style={{ color: '#2563eb' }}>
                      {c.job_count} job{c.job_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Declined / Lost Revenue */}
        {declined && declined.total_declines > 0 && (
          <div className="rounded-xl border p-5 shadow-sm mb-6" style={{ borderColor: '#f0ece8' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>
                💸 Lost Revenue (MTD)
              </h3>
              <span className="text-xs text-gray-500">{declined.total_declines} declined calibrations</span>
            </div>
            <p className="text-2xl font-bold mb-3" style={{ color: '#b91c1c' }}>
              {fmt(declined.total_lost_revenue)}
            </p>
            {declined.by_shop?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Top shops declining work</p>
                {declined.by_shop.slice(0, 3).map(s => (
                  <div key={s.shop} className="flex justify-between text-sm py-1">
                    <span className="text-gray-700">{s.shop}</span>
                    <span className="font-semibold" style={{ color: '#b91c1c' }}>{fmt(s.lost_revenue)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* KPIs */}
        <div className="rounded-xl border shadow-sm p-5" style={{ borderColor: '#f0ece8' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#1a1a1a' }}>Key Metrics</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiItem label="Avg Invoice" value={fmt(data.kpis.avg_invoice)} />
            <KpiItem label="Paid Invoices" value={data.kpis.paid_count_total} />
            <KpiItem label="Total Jobs" value={data.kpis.jobs_total} />
            <KpiItem label="Completion Rate" value={`${data.kpis.completion_rate}%`} />
          </div>
        </div>
      </div>
    </div>
  )
}

function ActionTile({ emoji, count, label, color, bg, onClick }) {
  return (
    <button onClick={onClick}
      className="rounded-xl p-4 shadow-sm text-left transition-transform hover:scale-[1.01]"
      style={{ backgroundColor: bg }}>
      <p className="text-xs font-medium" style={{ color }}>{emoji} {label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{count}</p>
    </button>
  )
}

function KpiItem({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold" style={{ color: '#1a1a1a' }}>{value}</p>
    </div>
  )
}

function TrendChart({ buckets }) {
  if (!buckets || buckets.length === 0) return null
  const max = Math.max(...buckets.map(b => b.revenue), 1)
  const H = 120
  const W = 800
  const barW = W / buckets.length - 4

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + 30}`} style={{ width: '100%', minWidth: 500 }}>
        {buckets.map((b, i) => {
          const barH = Math.max(2, (b.revenue / max) * H)
          const x = i * (W / buckets.length) + 2
          return (
            <g key={b.key}>
              <rect x={x} y={H - barH} width={barW} height={barH}
                fill={ORANGE} rx="2" opacity="0.85" />
              <text x={x + barW / 2} y={H + 12} textAnchor="middle" fontSize="9" fill="#888">
                {b.label}
              </text>
              {b.revenue > 0 && (
                <text x={x + barW / 2} y={H - barH - 4} textAnchor="middle" fontSize="8" fill="#555">
                  ${Math.round(b.revenue)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
