import { useState, useEffect, useCallback } from 'react'
import Navbar from './Navbar'
import { API_BASE, apiFetch, ORANGE, fmt } from './books/shared'

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
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [d, t] = await Promise.all([
        apiFetch(`${API_BASE}/api/analytics/daily-review`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/analytics/trends?period=daily&count=14`).then(r => r.json()),
      ])
      setData(d)
      setTrends(t)
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
    <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Daily Review</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <button onClick={load}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold"
            style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
            ↻ Refresh
          </button>
        </div>

        {/* Sales snapshot */}
        <div className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Sales</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: '#f0fdf4' }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium" style={{ color: '#16a34a' }}>Today</p>
                {deltaBadge(data.sales.day_delta_pct)}
              </div>
              <p className="text-2xl font-bold mt-1" style={{ color: '#15803d' }}>{fmt(data.sales.today)}</p>
              <p className="text-xs text-gray-500 mt-1">vs {fmt(data.sales.yesterday)} yesterday</p>
            </div>
            <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: '#eff6ff' }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium" style={{ color: '#2563eb' }}>This Week</p>
                {deltaBadge(data.sales.week_delta_pct)}
              </div>
              <p className="text-2xl font-bold mt-1" style={{ color: '#1d4ed8' }}>{fmt(data.sales.week)}</p>
              <p className="text-xs text-gray-500 mt-1">vs {fmt(data.sales.last_week)} last week</p>
            </div>
            <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: '#fff7f5' }}>
              <p className="text-xs font-medium" style={{ color: ORANGE }}>Month to Date</p>
              <p className="text-2xl font-bold mt-1" style={{ color: ORANGE }}>{fmt(data.sales.mtd)}</p>
              <p className="text-xs text-gray-500 mt-1">Revenue this month</p>
            </div>
            <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: data.expenses.net_mtd >= 0 ? '#f0fdf4' : '#fef2f2' }}>
              <p className="text-xs font-medium" style={{ color: data.expenses.net_mtd >= 0 ? '#15803d' : '#b91c1c' }}>Net MTD</p>
              <p className="text-2xl font-bold mt-1" style={{ color: data.expenses.net_mtd >= 0 ? '#15803d' : '#b91c1c' }}>
                {fmt(data.expenses.net_mtd)}
              </p>
              <p className="text-xs text-gray-500 mt-1">After {fmt(data.expenses.mtd)} expenses</p>
            </div>
          </div>
        </div>

        {/* Action items */}
        <div className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Needs Attention</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <ActionTile emoji="📋" count={data.jobs.needs_billing} label="Jobs Need Billing" color="#b45309" bg="#fef3c7"
              onClick={() => onNavigate('books')} />
            <ActionTile emoji="📧" count={data.invoices.sent_not_paid} label="Invoices Sent" color="#2563eb" bg="#dbeafe"
              onClick={() => onNavigate('books')} />
            <ActionTile emoji="🚨" count={data.invoices.overdue_count} label="Overdue" color="#dc2626" bg="#fee2e2"
              onClick={() => onNavigate('books')} />
            <ActionTile emoji="💵" count={fmt(data.invoices.outstanding)} label="Outstanding" color={ORANGE} bg="#fff7f5"
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
