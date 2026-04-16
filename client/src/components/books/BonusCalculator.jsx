import { useState, useEffect } from 'react'
import { API_BASE, apiFetch, ORANGE, fmt } from './shared'

const PERIODS = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_quarter', label: 'This Quarter' },
  { key: 'ytd', label: 'Year to Date' },
]

export default function BonusCalculator({ user, isAdmin }) {
  const [period, setPeriod] = useState('this_month')
  const [data, setData] = useState(null)
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showConfig, setShowConfig] = useState(false)
  const [allTechs, setAllTechs] = useState(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      apiFetch(`${API_BASE}/api/bonuses/calculate?period=${period}`).then(r => r.json()),
      apiFetch(`${API_BASE}/api/bonuses/config`).then(r => r.json()),
    ])
      .then(([d, c]) => { setData(d); setConfig(c); setLoading(false) })
      .catch(e => { console.error(e); setLoading(false) })
  }, [period])

  useEffect(() => {
    if (!isAdmin) return
    apiFetch(`${API_BASE}/api/bonuses/all?period=${period}`)
      .then(r => r.json())
      .then(setAllTechs)
      .catch(() => {})
  }, [period, isAdmin])

  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">Loading bonus data…</div>
  if (!data) return <div className="py-8 text-center text-red-500 text-sm">Failed to load bonus data</div>

  const next = data.next_tier
  const currentTier = config?.tiers?.filter(t => t.threshold <= data.total_revenue).pop()
  const pctToNext = next ? Math.min(100, (data.total_revenue - (currentTier?.threshold || 0)) / (next.threshold - (currentTier?.threshold || 0)) * 100) : 100

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex gap-1.5 flex-wrap">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className="text-xs px-3 py-1.5 rounded-full font-semibold transition-colors"
            style={{ backgroundColor: period === p.key ? ORANGE : '#f5f3f0', color: period === p.key ? 'white' : '#555' }}>
            {p.label}
          </button>
        ))}
        {isAdmin && (
          <button onClick={() => setShowConfig(true)}
            className="text-xs px-3 py-1.5 rounded-full font-semibold ml-auto"
            style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
            ⚙ Edit Tiers
          </button>
        )}
      </div>

      {/* Headline cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="rounded-xl p-5 shadow-sm" style={{ backgroundColor: '#f0fdf4' }}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#16a34a' }}>Revenue Generated</p>
          <p className="text-3xl font-bold mt-1" style={{ color: '#15803d' }}>{fmt(data.total_revenue)}</p>
          <p className="text-xs text-gray-500 mt-1">{data.invoice_count} invoice{data.invoice_count !== 1 ? 's' : ''}</p>
        </div>
        <div className="rounded-xl p-5 shadow-sm" style={{ backgroundColor: '#fff7f5' }}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: ORANGE }}>Bonus Earned</p>
          <p className="text-3xl font-bold mt-1" style={{ color: ORANGE }}>{fmt(data.bonus_amount)}</p>
          <p className="text-xs text-gray-500 mt-1">At current tier rates</p>
        </div>
        {next && (
          <div className="rounded-xl p-5 shadow-sm col-span-2 lg:col-span-1" style={{ backgroundColor: '#eff6ff' }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#2563eb' }}>Next Tier</p>
            <p className="text-lg font-bold mt-1" style={{ color: '#1d4ed8' }}>
              {fmt(next.revenue_to_next)} to go
            </p>
            <p className="text-xs text-gray-500 mt-1">Unlock {(next.rate * 100).toFixed(1)}% rate at {fmt(next.threshold)}</p>
            <div className="h-1.5 rounded-full bg-white mt-3">
              <div className="h-1.5 rounded-full" style={{ width: `${pctToNext}%`, backgroundColor: '#2563eb' }} />
            </div>
          </div>
        )}
      </div>

      {/* Breakdown */}
      {data.breakdown?.length > 0 && (
        <div className="rounded-xl border shadow-sm" style={{ borderColor: '#f0ece8' }}>
          <div className="px-5 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
            <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>Tier Breakdown</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b" style={{ borderColor: '#f0ece8' }}>
                <th className="text-left px-5 py-2 font-medium">Tier</th>
                <th className="text-right px-5 py-2 font-medium">Revenue in Tier</th>
                <th className="text-right px-5 py-2 font-medium">Rate</th>
                <th className="text-right px-5 py-2 font-medium">Bonus</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: '#f7f4f1' }}>
              {data.breakdown.map((b, i) => (
                <tr key={i}>
                  <td className="px-5 py-2 text-gray-600">{b.tier.label}</td>
                  <td className="px-5 py-2 text-right">{fmt(b.revenue_in_tier)}</td>
                  <td className="px-5 py-2 text-right text-gray-500">{(b.tier.rate * 100).toFixed(1)}%</td>
                  <td className="px-5 py-2 text-right font-semibold" style={{ color: ORANGE }}>{fmt(b.bonus_in_tier)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* All techs (admin) */}
      {isAdmin && allTechs?.results?.length > 0 && (
        <div className="rounded-xl border shadow-sm" style={{ borderColor: '#f0ece8' }}>
          <div className="px-5 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
            <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>All Technicians — {PERIODS.find(p => p.key === period)?.label}</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b" style={{ borderColor: '#f0ece8' }}>
                <th className="text-left px-5 py-2 font-medium">Tech</th>
                <th className="text-right px-5 py-2 font-medium">Revenue</th>
                <th className="text-right px-5 py-2 font-medium">Invoices</th>
                <th className="text-right px-5 py-2 font-medium">Bonus</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: '#f7f4f1' }}>
              {allTechs.results.map(r => (
                <tr key={r.user_id}>
                  <td className="px-5 py-2 text-gray-700">{r.user_id}</td>
                  <td className="px-5 py-2 text-right">{fmt(r.total_revenue)}</td>
                  <td className="px-5 py-2 text-right text-gray-500">{r.invoice_count}</td>
                  <td className="px-5 py-2 text-right font-semibold" style={{ color: ORANGE }}>{fmt(r.bonus_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Config editor */}
      {showConfig && isAdmin && config && (
        <BonusConfigEditor config={config} onClose={() => setShowConfig(false)}
          onSaved={(c) => { setConfig(c); setShowConfig(false) }} />
      )}
    </div>
  )
}

function BonusConfigEditor({ config, onClose, onSaved }) {
  const [tiers, setTiers] = useState(config.tiers)
  const [period, setPeriod] = useState(config.period)
  const [includeIns, setIncludeIns] = useState(config.include_insurance_invoices)
  const [includeShop, setIncludeShop] = useState(config.include_shop_invoices)
  const [saving, setSaving] = useState(false)

  function updateTier(i, field, value) {
    const copy = [...tiers]
    copy[i] = { ...copy[i], [field]: field === 'threshold' || field === 'rate' ? Number(value) : value }
    setTiers(copy)
  }
  function addTier() {
    const last = tiers[tiers.length - 1]
    setTiers([...tiers, { threshold: (last?.threshold || 0) + 20000, rate: 0.01, label: 'New tier' }])
  }
  function removeTier(i) {
    setTiers(tiers.filter((_, idx) => idx !== i))
  }

  async function save() {
    setSaving(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/bonuses/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tiers, period,
          include_insurance_invoices: includeIns,
          include_shop_invoices: includeShop,
          active: true,
        }),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      onSaved(await r.json())
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b sticky top-0 bg-white" style={{ borderColor: '#f0ece8' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold" style={{ color: '#1a1a1a' }}>Bonus Tier Configuration</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">×</button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Period (threshold resets)</label>
            <select value={period} onChange={e => setPeriod(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Tiers</label>
              <button onClick={addTier} className="text-xs px-2 py-1 rounded" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
                + Add Tier
              </button>
            </div>
            <div className="space-y-2">
              {tiers.map((t, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-3">
                    <input type="number" value={t.threshold} onChange={e => updateTier(i, 'threshold', e.target.value)}
                      placeholder="Threshold $" className="w-full border rounded px-2 py-1 text-sm" style={{ borderColor: '#e5e7eb' }} />
                  </div>
                  <div className="col-span-2">
                    <input type="number" step="0.001" value={t.rate} onChange={e => updateTier(i, 'rate', e.target.value)}
                      placeholder="Rate" className="w-full border rounded px-2 py-1 text-sm" style={{ borderColor: '#e5e7eb' }} />
                  </div>
                  <div className="col-span-6">
                    <input value={t.label} onChange={e => updateTier(i, 'label', e.target.value)}
                      placeholder="Label" className="w-full border rounded px-2 py-1 text-sm" style={{ borderColor: '#e5e7eb' }} />
                  </div>
                  <button onClick={() => removeTier(i)} className="col-span-1 text-red-500 text-xs">✕</button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeIns} onChange={e => setIncludeIns(e.target.checked)} />
              Include insurance invoices
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeShop} onChange={e => setIncludeShop(e.target.checked)} />
              Include shop invoices
            </label>
          </div>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2 sticky bottom-0 bg-white" style={{ borderColor: '#f0ece8' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: '#e5e7eb' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: ORANGE, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
