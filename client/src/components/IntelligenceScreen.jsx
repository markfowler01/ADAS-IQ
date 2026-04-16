import { useState, useEffect, useCallback } from 'react'
import Navbar from './Navbar'
import { API_BASE, apiFetch, ORANGE, fmt } from './books/shared'

export default function IntelligenceScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [tab, setTab] = useState('forecast')
  const [forecast, setForecast] = useState(null)
  const [rebookAlerts, setRebookAlerts] = useState(null)
  const [marginMix, setMarginMix] = useState(null)
  const [competitors, setCompetitors] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [f, r, m, c] = await Promise.all([
        apiFetch(`${API_BASE}/api/intelligence/forecast`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/intelligence/rebook-alerts`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/intelligence/shop-margin-mix?period=ytd`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/intelligence/competitors`).then(r => r.json()),
      ])
      setForecast(f); setRebookAlerts(r); setMarginMix(m); setCompetitors(c)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const tabs = [
    { id: 'forecast',    label: '📈 Forecast' },
    { id: 'margin',      label: '💰 Margin Mix' },
    { id: 'rebook',      label: `🔄 Rebooks${rebookAlerts?.total_alerts ? ` (${rebookAlerts.total_alerts})` : ''}` },
    { id: 'competitors', label: '🥊 Competitors' },
  ]

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Business Intelligence</h1>
          <p className="text-sm text-gray-500 mt-0.5">Forecasting, margin analysis, rebook alerts, competitor intel</p>
        </div>

        <div className="flex gap-0 mb-6 border-b overflow-x-auto" style={{ borderColor: '#ebebeb' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="text-sm px-4 py-2.5 font-medium transition-colors whitespace-nowrap"
              style={{
                color: tab === t.id ? ORANGE : '#666',
                borderBottom: tab === t.id ? `2px solid ${ORANGE}` : '2px solid transparent',
                marginBottom: '-1px',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : (
          <>
            {tab === 'forecast' && forecast && <ForecastView forecast={forecast} />}
            {tab === 'margin' && marginMix && <MarginMixView data={marginMix} />}
            {tab === 'rebook' && rebookAlerts && <RebookView alerts={rebookAlerts} />}
            {tab === 'competitors' && competitors && <CompetitorsView data={competitors} />}
          </>
        )}
      </div>
    </div>
  )
}

function ForecastView({ forecast }) {
  const pacePct = forecast.avg_monthly_revenue > 0
    ? Math.round((forecast.pace_projection / forecast.avg_monthly_revenue) * 100)
    : 0

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label="MTD Revenue" value={fmt(forecast.mtd_revenue)} bg="#f0fdf4" color="#15803d" />
        <Card label="Pace Projection" value={fmt(forecast.pace_projection)} bg="#eff6ff" color="#2563eb"
          note={`${pacePct}% of avg month`} />
        <Card label="Composite Forecast" value={fmt(forecast.composite_forecast)} bg="#fff7f5" color={ORANGE}
          note="blended pace + pipeline" />
        <Card label="Open Pipeline" value={forecast.open_pipeline_count} bg="#fef3c7" color="#b45309"
          note={`${fmt(forecast.pipeline_value_estimated)} est.`} />
      </div>

      <div className="rounded-xl border p-5 shadow-sm" style={{ borderColor: '#f0ece8' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: '#1a1a1a' }}>Month Progress</h3>
        <div className="h-6 rounded-full bg-gray-100 mb-2 overflow-hidden">
          <div className="h-full" style={{
            width: `${forecast.month_fraction_complete}%`,
            backgroundColor: ORANGE,
          }} />
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>Day {forecast.day_of_month} of {forecast.days_in_month}</span>
          <span>{forecast.days_remaining} days left</span>
        </div>
      </div>

      <div className="rounded-xl border p-5 shadow-sm" style={{ borderColor: '#f0ece8' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: '#1a1a1a' }}>Trailing 6 Months</h3>
        <TrendBars values={forecast.trailing_6_months} />
      </div>
    </div>
  )
}

function TrendBars({ values }) {
  if (!values?.length) return null
  const max = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-2 h-32">
      {[...values].reverse().map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center">
          <div className="text-xs text-gray-400 mb-1">${Math.round(v / 1000)}k</div>
          <div className="w-full rounded-t"
            style={{ height: `${(v / max) * 100}%`, backgroundColor: ORANGE, opacity: 0.7 }} />
          <div className="text-xs text-gray-500 mt-1">M-{i + 1}</div>
        </div>
      ))}
    </div>
  )
}

function MarginMixView({ data }) {
  if (!data.shops?.length) {
    return (
      <div className="py-10 text-center text-gray-400 text-sm">
        No paid invoices yet. Add cost-of-goods values in Services to see true margins.
      </div>
    )
  }
  return (
    <div className="rounded-xl border shadow-sm overflow-hidden" style={{ borderColor: '#f0ece8' }}>
      <table className="w-full text-sm">
        <thead style={{ backgroundColor: '#fafafa' }}>
          <tr className="text-xs text-gray-400 border-b" style={{ borderColor: '#f0ece8' }}>
            <th className="text-left px-4 py-2 font-medium">Shop</th>
            <th className="text-right px-4 py-2 font-medium">Invoices</th>
            <th className="text-right px-4 py-2 font-medium">Revenue</th>
            <th className="text-right px-4 py-2 font-medium">COGS</th>
            <th className="text-right px-4 py-2 font-medium">Gross Profit</th>
            <th className="text-right px-4 py-2 font-medium">Margin %</th>
            <th className="text-right px-4 py-2 font-medium">Avg Invoice</th>
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: '#f7f4f1' }}>
          {data.shops.map(s => (
            <tr key={s.shop}>
              <td className="px-4 py-2 text-gray-700">{s.shop}</td>
              <td className="px-4 py-2 text-right text-gray-500">{s.invoice_count}</td>
              <td className="px-4 py-2 text-right font-medium">{fmt(s.revenue)}</td>
              <td className="px-4 py-2 text-right text-gray-500">{fmt(s.cogs)}</td>
              <td className="px-4 py-2 text-right font-semibold" style={{ color: '#15803d' }}>
                {fmt(s.gross_profit)}
              </td>
              <td className="px-4 py-2 text-right font-semibold"
                style={{ color: s.margin_percent >= 70 ? '#15803d' : s.margin_percent >= 40 ? '#b45309' : '#dc2626' }}>
                {s.margin_percent}%
              </td>
              <td className="px-4 py-2 text-right text-gray-500">{fmt(s.avg_invoice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RebookView({ alerts }) {
  if (alerts.alerts.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-5xl mb-2">✨</p>
        <p className="text-gray-400 text-sm">No rebook alerts — every VIN we've calibrated has stayed calibrated.</p>
      </div>
    )
  }
  return (
    <div>
      <p className="text-sm text-gray-600 mb-4">
        Vehicles that returned for calibration within 90 days of our last job. Possible rework, new collision, or training issue.
      </p>
      <div className="space-y-2">
        {alerts.alerts.map(a => (
          <div key={a.current_job_id} className="rounded-xl border p-4 shadow-sm"
            style={{ borderColor: a.severity === 'high' ? '#fecaca' : '#f0ece8' }}>
            <div className="flex justify-between items-start mb-2 flex-wrap gap-2">
              <div>
                <p className="text-sm font-bold">{a.vehicle} · VIN {a.vin.slice(-8)}</p>
                <p className="text-xs text-gray-500">{a.shop_name}</p>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: a.severity === 'high' ? '#fef2f2' : a.severity === 'medium' ? '#fef3c7' : '#f5f3f0',
                  color: a.severity === 'high' ? '#b91c1c' : a.severity === 'medium' ? '#b45309' : '#6b7280',
                }}>
                {a.days_between} days between
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg p-2" style={{ backgroundColor: '#fafafa' }}>
                <p className="text-gray-400 mb-1">Previous ({new Date(a.previous_job_date).toLocaleDateString()})</p>
                <p className="text-gray-700">Tech: {a.previous_technician || '—'}</p>
                <p className="text-gray-500 mt-1">{a.previous_calibrations.join(', ')}</p>
              </div>
              <div className="rounded-lg p-2" style={{ backgroundColor: '#fafafa' }}>
                <p className="text-gray-400 mb-1">Current ({new Date(a.current_job_date).toLocaleDateString()})</p>
                <p className="text-gray-700">Tech: {a.current_technician || '—'}</p>
                <p className="text-gray-500 mt-1">{a.current_calibrations.join(', ')}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CompetitorsView({ data }) {
  if (data.competitors.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-5xl mb-2">🥊</p>
        <p className="text-gray-400 text-sm">No competitor data yet. Add competitors in CRM shop details.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {data.competitors.map(c => (
        <div key={c.competitor} className="rounded-xl border p-4 shadow-sm bg-white"
          style={{ borderColor: '#f0ece8' }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm" style={{ color: '#1a1a1a' }}>{c.competitor}</h3>
            <div className="flex gap-2 text-xs">
              <span style={{ color: '#15803d' }}>✓ {c.won_against} won</span>
              <span style={{ color: '#b91c1c' }}>✗ {c.lost_to} lost</span>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Mentioned at {c.shops_mentioning.length} shop{c.shops_mentioning.length !== 1 ? 's' : ''}: {' '}
            {c.shops_mentioning.slice(0, 5).map(s => s.shop_name).join(', ')}
            {c.shops_mentioning.length > 5 && `, +${c.shops_mentioning.length - 5} more`}
          </p>
        </div>
      ))}
    </div>
  )
}

function Card({ label, value, bg, color, note }) {
  return (
    <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: bg }}>
      <p className="text-xs font-medium" style={{ color }}>{label}</p>
      <p className="text-xl lg:text-2xl font-bold mt-1" style={{ color }}>{value}</p>
      {note && <p className="text-xs text-gray-500 mt-1">{note}</p>}
    </div>
  )
}
