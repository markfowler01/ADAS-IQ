import { useState, useEffect, useCallback } from 'react'
import Navbar from './Navbar'
import { API_BASE, apiFetch, ORANGE, fmt } from './books/shared'

const TYPE_COLORS = {
  business: { bg: '#f0fdf4', color: '#16a34a', label: 'Business' },
  personal: { bg: '#f5f3f0', color: '#6b7280', label: 'Personal' },
  commute: { bg: '#eff6ff', color: '#2563eb', label: 'Commute' },
  unclassified: { bg: '#fef3c7', color: '#b45309', label: 'Unclassified' },
}

export default function MileageScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [tab, setTab] = useState('trips')
  const [trips, setTrips] = useState([])
  const [settings, setSettings] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, s, sm] = await Promise.all([
        apiFetch(`${API_BASE}/api/mileage/trips`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/mileage/settings`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/mileage/summary?period=${new Date().toISOString().slice(0,7)}`).then(r => r.json()),
      ])
      setTrips(Array.isArray(t) ? t : [])
      setSettings(s)
      setSummary(sm)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function reclassify(trip, newType) {
    try {
      await apiFetch(`${API_BASE}/api/mileage/trips/${trip.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_type: newType }),
      })
      load()
    } catch (e) { alert(e.message) }
  }

  async function deleteTrip(id) {
    if (!confirm('Delete this trip?')) return
    try {
      await apiFetch(`${API_BASE}/api/mileage/trips/${id}`, { method: 'DELETE' })
      load()
    } catch (e) { alert(e.message) }
  }

  async function saveSettings(patch) {
    try {
      const r = await apiFetch(`${API_BASE}/api/mileage/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      setSettings(await r.json())
    } catch (e) { alert(e.message) }
  }

  const tabs = [
    { id: 'trips', label: 'My Trips' },
    { id: 'summary', label: 'Summary' },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Mileage Tracker</h1>
          <p className="text-sm text-gray-500 mt-0.5">GPS-based business mileage for reimbursement & taxes</p>
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
            {tab === 'trips' && <TripsTab trips={trips} onReclassify={reclassify} onDelete={deleteTrip} />}
            {tab === 'summary' && <SummaryTab summary={summary} trips={trips} />}
            {tab === 'settings' && <SettingsTab settings={settings} onSave={saveSettings} />}
          </>
        )}
      </div>
    </div>
  )
}

function TripsTab({ trips, onReclassify, onDelete }) {
  if (trips.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-gray-400 text-sm">No trips recorded yet.</p>
        <p className="text-xs text-gray-400 mt-2">Enable GPS tracking in Settings to start logging trips automatically.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {trips.map(t => {
        const c = TYPE_COLORS[t.trip_type] || TYPE_COLORS.unclassified
        return (
          <div key={t.id} className="rounded-xl border p-4 shadow-sm bg-white flex items-center justify-between gap-3 flex-wrap"
            style={{ borderColor: '#f0ece8' }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: c.bg, color: c.color }}>
                  {c.label}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(t.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-sm text-gray-700 truncate">
                {t.start_location?.address || `${t.start_location?.lat?.toFixed(3)},${t.start_location?.lng?.toFixed(3)}`}
                {' → '}
                {t.end_location?.address || `${t.end_location?.lat?.toFixed(3)},${t.end_location?.lng?.toFixed(3)}`}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {t.distance_miles?.toFixed(1)} mi · {t.duration_minutes}m · Reimbursement: <strong>{fmt(t.reimbursement_amount)}</strong>
              </p>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <select value={t.trip_type} onChange={e => onReclassify(t, e.target.value)}
                className="text-xs border rounded px-2 py-1"
                style={{ borderColor: '#e5e7eb' }}>
                <option value="business">Business</option>
                <option value="personal">Personal</option>
                <option value="commute">Commute</option>
                <option value="unclassified">Unclassified</option>
              </select>
              <button onClick={() => onDelete(t.id)}
                className="text-xs px-2 py-1 rounded"
                style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
                ×
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SummaryTab({ summary, trips }) {
  if (!summary) return null
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label="Total Miles" value={summary.total_miles?.toFixed(1) || '0'} bg="#fafafa" color="#1a1a1a" />
        <Card label="Business Miles" value={summary.business_miles?.toFixed(1) || '0'} bg="#f0fdf4" color="#16a34a" />
        <Card label="Personal Miles" value={summary.personal_miles?.toFixed(1) || '0'} bg="#f5f3f0" color="#6b7280" />
        <Card label="Reimbursement" value={fmt(summary.reimbursement_total || 0)} bg="#fff7f5" color={ORANGE} />
      </div>

      <div className="rounded-xl border shadow-sm p-5" style={{ borderColor: '#f0ece8' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: '#1a1a1a' }}>This Month Breakdown</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-gray-600">Trips recorded</span><strong>{summary.trip_count}</strong></div>
          <div className="flex justify-between"><span className="text-gray-600">Business %</span>
            <strong>{summary.total_miles ? Math.round((summary.business_miles / summary.total_miles) * 100) : 0}%</strong></div>
          <div className="flex justify-between"><span className="text-gray-600">Commute miles</span>
            <strong>{summary.commute_miles?.toFixed(1) || '0'}</strong></div>
        </div>
      </div>
    </div>
  )
}

function Card({ label, value, bg, color }) {
  return (
    <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: bg }}>
      <p className="text-xs font-medium" style={{ color }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
    </div>
  )
}

function SettingsTab({ settings, onSave }) {
  const [form, setForm] = useState(settings)
  useEffect(() => setForm(settings), [settings])
  if (!form) return null

  const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  function toggleDay(d) {
    const days = form.tracking_hours?.days || []
    const newDays = days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort()
    setForm(f => ({ ...f, tracking_hours: { ...f.tracking_hours, days: newDays } }))
  }

  return (
    <div className="space-y-5 max-w-xl">
      <div className="rounded-xl p-4" style={{ backgroundColor: '#fff7f5', border: `1px solid #fcd5c5` }}>
        <p className="text-sm font-semibold mb-1" style={{ color: ORANGE }}>🔒 Privacy Notice</p>
        <p className="text-xs text-gray-700">
          Your location is only tracked during your configured work hours and used for mileage reimbursement.
          You can disable this at any time. Trip data is visible only to you and admins.
        </p>
      </div>

      {/* Main toggle */}
      <label className="rounded-xl border shadow-sm p-5 flex items-center justify-between cursor-pointer"
        style={{ borderColor: '#f0ece8' }}>
        <div>
          <p className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>Enable GPS Tracking</p>
          <p className="text-xs text-gray-500 mt-0.5">Automatically log trips during work hours</p>
        </div>
        <input type="checkbox" checked={!!form.tracking_enabled}
          onChange={e => setForm(f => ({ ...f, tracking_enabled: e.target.checked }))}
          className="w-5 h-5" />
      </label>

      {/* Hours */}
      <div className="rounded-xl border shadow-sm p-5" style={{ borderColor: '#f0ece8' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: '#1a1a1a' }}>Tracking Hours</h3>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Start</label>
            <input type="time" value={form.tracking_hours?.start || '07:00'}
              onChange={e => setForm(f => ({ ...f, tracking_hours: { ...f.tracking_hours, start: e.target.value } }))}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">End</label>
            <input type="time" value={form.tracking_hours?.end || '18:00'}
              onChange={e => setForm(f => ({ ...f, tracking_hours: { ...f.tracking_hours, end: e.target.value } }))}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
        </div>
        <div className="flex gap-1">
          {DAYS.map((d, i) => (
            <button key={i} onClick={() => toggleDay(i)}
              className="flex-1 py-2 rounded-lg text-xs font-semibold"
              style={{
                backgroundColor: (form.tracking_hours?.days || []).includes(i) ? ORANGE : '#f5f3f0',
                color: (form.tracking_hours?.days || []).includes(i) ? 'white' : '#555',
              }}>
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Auto classify */}
      <div className="rounded-xl border shadow-sm p-5 space-y-3" style={{ borderColor: '#f0ece8' }}>
        <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>Classification</h3>
        <label className="flex items-center justify-between text-sm">
          <span className="text-gray-700">Auto-classify trips during work hours</span>
          <input type="checkbox" checked={!!form.auto_classify}
            onChange={e => setForm(f => ({ ...f, auto_classify: e.target.checked }))} />
        </label>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Default type during work hours</label>
          <select value={form.default_type || 'business'}
            onChange={e => setForm(f => ({ ...f, default_type: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}>
            <option value="business">Business</option>
            <option value="commute">Commute</option>
            <option value="unclassified">Unclassified (review later)</option>
          </select>
        </div>
      </div>

      <button onClick={() => onSave(form)}
        className="w-full py-3 rounded-xl text-sm font-semibold text-white"
        style={{ backgroundColor: ORANGE }}>
        Save Settings
      </button>
    </div>
  )
}
