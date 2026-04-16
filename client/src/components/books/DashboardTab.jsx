import { useState, useEffect } from 'react'
import { API_BASE, apiFetch, ORANGE, fmt, StatusBadge } from './shared'

export default function DashboardTab({ invoices, expenses, onNewInvoice }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch(`${API_BASE}/api/books/dashboard`)
      .then(r => r.json())
      .then(data => { setStats(data); setLoading(false) })
      .catch(err => { setError(err.message); setLoading(false) })
  }, [invoices])

  const now = new Date()
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const mtdExpenses = (expenses || [])
    .filter(e => (e.date || '').startsWith(monthStr))
    .reduce((s, e) => s + (e.amount || 0), 0)

  const recent = [...invoices]
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 5)

  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">Loading dashboard…</div>
  if (error) return <div className="py-8 text-center text-red-500 text-sm">{error}</div>

  const revMTD = stats?.revenue_mtd || 0
  const netMTD = revMTD - mtdExpenses

  const cards = [
    { label: 'Revenue MTD',   value: fmt(revMTD),              color: '#16a34a', bg: '#f0fdf4' },
    { label: 'Expenses MTD',  value: fmt(mtdExpenses),          color: '#dc2626', bg: '#fef2f2' },
    { label: 'Net Income MTD',value: fmt(netMTD),               color: netMTD >= 0 ? '#2563eb' : '#dc2626', bg: '#eff6ff' },
    { label: 'Outstanding',   value: fmt(stats?.outstanding),   color: ORANGE, bg: '#fff7f5' },
  ]

  const overdueCount = stats?.overdue_count || 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(card => (
          <div key={card.label} className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: card.bg }}>
            <p className="text-xs font-medium mb-1" style={{ color: card.color }}>{card.label}</p>
            <p className="text-2xl font-bold" style={{ color: card.color }}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Overdue alert */}
      {overdueCount > 0 && (
        <div className="rounded-xl px-5 py-3 flex items-center gap-3"
          style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca' }}>
          <span className="text-lg">⚠️</span>
          <p className="text-sm font-semibold" style={{ color: '#dc2626' }}>
            {overdueCount} overdue invoice{overdueCount !== 1 ? 's' : ''} — {fmt(stats?.outstanding)} outstanding
          </p>
        </div>
      )}

      <div className="rounded-xl border shadow-sm" style={{ borderColor: '#f0ece8' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
          <h3 className="font-semibold text-sm" style={{ color: '#1a1a1a' }}>Recent Invoices</h3>
          <button onClick={onNewInvoice}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
            style={{ backgroundColor: ORANGE }}>
            + New Invoice
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No invoices yet.</div>
        ) : (
          <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
            {recent.map(inv => (
              <div key={inv.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <span className="text-sm font-semibold" style={{ color: ORANGE }}>{inv.invoice_number}</span>
                  <span className="text-sm text-gray-600 ml-2">{inv.customer_name || '—'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{fmt(inv.total)}</span>
                  <StatusBadge status={inv.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
