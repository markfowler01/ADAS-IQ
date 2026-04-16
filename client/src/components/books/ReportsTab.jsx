import { useState, useEffect } from 'react'
import { API_BASE, apiFetch, ORANGE, fmt } from './shared'
import BarChart from './BarChart'

export default function ReportsTab() {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [period, setPeriod] = useState('year')

  useEffect(() => {
    setLoading(true)
    apiFetch(`${API_BASE}/api/books/report?period=${period}`)
      .then(r => r.json())
      .then(d => { setReport(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [period])

  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">Loading report…</div>
  if (error)   return <div className="py-8 text-center text-red-500 text-sm">{error}</div>
  if (!report) return null

  const t = report.totals || {}
  const periodLabels = { month: 'This Month', quarter: 'This Quarter', year: 'Year to Date', all: 'All Time' }

  const plCards = [
    { label: 'Revenue',    value: fmt(period === 'month' ? t.mtd_revenue  : period === 'all' ? t.all_time_revenue  : t.ytd_revenue),  bg: '#f0fdf4', color: '#16a34a' },
    { label: 'Expenses',   value: fmt(period === 'month' ? t.mtd_expenses : period === 'all' ? t.all_time_expenses : t.ytd_expenses), bg: '#fef2f2', color: '#dc2626' },
    { label: 'Net Income', value: fmt(period === 'month' ? t.mtd_net      : period === 'all' ? t.all_time_net      : t.ytd_net),      bg: '#eff6ff', color: '#2563eb' },
    { label: 'Outstanding', value: fmt(t.outstanding), bg: '#fff7f5', color: ORANGE },
  ]

  return (
    <div className="space-y-7">

      {/* Period selector */}
      <div className="flex gap-1.5 flex-wrap">
        {[['month','This Month'],['quarter','This Quarter'],['year','Year to Date'],['all','All Time']].map(([k, l]) => (
          <button key={k} onClick={() => setPeriod(k)}
            className="text-xs px-3 py-1.5 rounded-full font-semibold transition-colors"
            style={{ backgroundColor: period === k ? ORANGE : '#f5f3f0', color: period === k ? 'white' : '#555' }}>
            {l}
          </button>
        ))}
      </div>

      {/* P&L Summary */}
      <div>
        <h2 className="text-sm font-semibold mb-3" style={{ color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Profit & Loss — {periodLabels[period]}
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {plCards.map(c => (
            <div key={c.label} className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: c.bg }}>
              <p className="text-xs font-medium mb-1" style={{ color: c.color }}>{c.label}</p>
              <p className="text-xl font-bold" style={{ color: c.color }}>{c.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Monthly Chart */}
      <div className="rounded-xl border p-5 shadow-sm" style={{ borderColor: '#f0ece8' }}>
        <h3 className="text-sm font-semibold mb-4" style={{ color: '#1a1a1a' }}>Revenue vs Expenses (Last 12 Months)</h3>
        <BarChart months={report.months || []} />
      </div>

      {/* Two-column: Aging + Revenue by Type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Aging Report */}
        <div className="rounded-xl border p-5 shadow-sm" style={{ borderColor: '#f0ece8' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#1a1a1a' }}>Accounts Receivable Aging</h3>
          {Object.values(report.aging || {}).every(v => v === 0) ? (
            <p className="text-sm text-gray-400 py-4 text-center">No outstanding invoices 🎉</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b" style={{ borderColor: '#f0ece8' }}>
                  <th className="text-left pb-2 font-medium">Bucket</th>
                  <th className="text-right pb-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: '#f7f4f1' }}>
                {[
                  ['Current (not yet due)', report.aging?.current],
                  ['1–30 days past due',    report.aging?.days_1_30],
                  ['31–60 days',            report.aging?.days_31_60],
                  ['61–90 days',            report.aging?.days_61_90],
                  ['Over 90 days',          report.aging?.over_90],
                ].map(([label, val]) => (
                  <tr key={label}>
                    <td className="py-2 text-gray-600">{label}</td>
                    <td className={`py-2 text-right font-semibold ${val > 0 ? '' : 'text-gray-300'}`}
                      style={{ color: val > 0 ? (label.includes('Over') || label.includes('61') ? '#dc2626' : '#1a1a1a') : undefined }}>
                      {fmt(val)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Revenue by Type */}
        <div className="rounded-xl border p-5 shadow-sm" style={{ borderColor: '#f0ece8' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#1a1a1a' }}>Revenue by Invoice Type</h3>
          {report.by_type?.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No paid invoices yet</p>
          ) : (
            <div className="space-y-3">
              {(report.by_type || []).map(t => {
                const totalRev = (report.by_type || []).reduce((s, x) => s + x.revenue, 0) || 1
                const pct = Math.round((t.revenue / totalRev) * 100)
                const typeLabels = { insurance: 'Insurance', shop: 'Shop (discounted)', standard: 'Standard B2B', personal: 'Personal' }
                const typeColors = { insurance: '#2563eb', shop: '#7c3aed', standard: ORANGE, personal: '#16a34a' }
                return (
                  <div key={t.type}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-gray-700">{typeLabels[t.type] || t.type}</span>
                      <span className="font-semibold" style={{ color: typeColors[t.type] || ORANGE }}>{fmt(t.revenue)} ({pct}%)</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100">
                      <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: typeColors[t.type] || ORANGE }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Top Customers + Top Services */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Top Customers */}
        <div className="rounded-xl border p-5 shadow-sm" style={{ borderColor: '#f0ece8' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#1a1a1a' }}>Top Customers (All Time)</h3>
          {report.by_customer?.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No paid invoices yet</p>
          ) : (
            <div className="space-y-2">
              {(report.by_customer || []).slice(0, 8).map((c, i) => (
                <div key={c.name} className="flex items-center justify-between text-sm py-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 text-xs text-gray-400 font-mono flex-shrink-0">{i + 1}.</span>
                    <span className="truncate text-gray-700">{c.name}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{c.invoice_count} inv</span>
                  </div>
                  <span className="font-semibold flex-shrink-0 ml-2" style={{ color: ORANGE }}>{fmt(c.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Services */}
        <div className="rounded-xl border p-5 shadow-sm" style={{ borderColor: '#f0ece8' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#1a1a1a' }}>Top Services (All Time)</h3>
          {report.top_services?.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No paid invoices yet</p>
          ) : (
            <div className="space-y-2">
              {(report.top_services || []).slice(0, 8).map((s, i) => (
                <div key={s.description} className="flex items-center justify-between text-sm py-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 text-xs text-gray-400 font-mono flex-shrink-0">{i + 1}.</span>
                    <span className="truncate text-gray-700">{s.description}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">×{s.qty}</span>
                  </div>
                  <span className="font-semibold flex-shrink-0 ml-2" style={{ color: ORANGE }}>{fmt(s.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Expenses by Category */}
      {report.by_expense_category?.length > 0 && (
        <div className="rounded-xl border p-5 shadow-sm" style={{ borderColor: '#f0ece8' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#1a1a1a' }}>Expenses by Category ({periodLabels[period]})</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {report.by_expense_category.map(c => (
              <div key={c.category} className="rounded-lg p-3" style={{ backgroundColor: '#fafafa', border: '1px solid #f0ece8' }}>
                <p className="text-xs text-gray-500 mb-0.5">{c.category}</p>
                <p className="text-base font-bold" style={{ color: '#1a1a1a' }}>{fmt(c.total)}</p>
                <p className="text-xs text-gray-400">{c.count} item{c.count !== 1 ? 's' : ''}</p>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
