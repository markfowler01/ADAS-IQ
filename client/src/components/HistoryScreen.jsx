import { API_BASE, apiFetch } from '../utils/api.js'
import { useState, useEffect } from 'react'
import Navbar from './Navbar'

const ORANGE = '#CD4419'
const MUTED  = '#888'

export default function HistoryScreen({ onBack, user, onLogout, currentScreen, onNavigate }) {
  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [search,   setSearch]   = useState('')

  useEffect(() => {
    apiFetch(`${API_BASE}/api/history`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error)
        setEntries(data)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function formatDate(val) {
    if (!val) return '—'
    try {
      const d = typeof val === 'string' ? new Date(val) : new Date(Number(val))
      if (isNaN(d)) return '—'
      return d.toLocaleDateString('en-US', {
        weekday: 'short', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    } catch { return '—' }
  }

  const filtered = entries.filter((e) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (e.vehicle   || '').toLowerCase().includes(q) ||
      (e.roNumber  || '').toLowerCase().includes(q) ||
      (e.shop      || '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'white' }}>

      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">

        {/* ── Page heading + search ── */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Job History</h1>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vehicle, RO#, shop…"
            className="px-4 py-2 rounded-lg text-sm outline-none"
            style={{
              border: '1px solid #e0dbd6',
              backgroundColor: 'white',
              width: '240px',
              color: '#1a1a1a',
            }}
            onFocus={(e) => (e.target.style.borderColor = ORANGE)}
            onBlur={(e)  => (e.target.style.borderColor = '#e0dbd6')}
          />
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center gap-3 py-16 justify-center">
            <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#e0dbd6" strokeWidth="3"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke={ORANGE} strokeWidth="3" strokeLinecap="round"/>
            </svg>
            <span className="text-sm" style={{ color: MUTED }}>Loading history…</span>
          </div>
        )}

        {/* ── Error ── */}
        {!loading && error && (
          <div className="px-4 py-3 rounded-xl text-sm"
            style={{ backgroundColor: '#fff0ed', border: '1px solid #e8c5b0', color: ORANGE }}>
            <strong>Could not load history:</strong> {error}
            <p className="mt-1 text-xs" style={{ color: '#a33510' }}>
              History will populate automatically after your next estimate is created.
            </p>
          </div>
        )}

        {/* ── Table ── */}
        {!loading && !error && (
          <>
            {/* Column headers */}
            <div className="grid gap-4 px-4 pb-2 text-xs font-semibold uppercase tracking-wider"
              style={{
                color: MUTED,
                gridTemplateColumns: '2fr 1fr 2fr 1fr 2fr 24px',
                borderBottom: '1px solid #ebebeb',
              }}>
              <span>Vehicle</span>
              <span>RO #</span>
              <span>Shop</span>
              <span>Tech</span>
              <span>Date</span>
              <span />
            </div>

            {/* Empty */}
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 gap-2">
                <span className="text-2xl">📂</span>
                <p className="text-sm font-medium" style={{ color: '#333' }}>
                  {search ? 'No results found' : 'No job folders yet'}
                </p>
              </div>
            )}

            {/* Rows */}
            {filtered.map((entry, i) => (
              <a
                key={i}
                href={entry.estimateUrl || entry.pdfUrl || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="grid gap-4 px-4 py-4 items-center transition-colors"
                style={{
                  gridTemplateColumns: '2fr 1fr 2fr 1fr 2fr 24px',
                  borderBottom: '1px solid #f0eeec',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#fafafa')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}>

                {/* Vehicle */}
                <span className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>
                  {entry.vehicle || entry.name || '—'}
                </span>

                {/* RO # */}
                <span className="text-sm" style={{ color: '#444' }}>
                  {entry.roNumber || '—'}
                </span>

                {/* Shop */}
                <span className="text-sm" style={{ color: '#444' }}>
                  {entry.shop || '—'}
                </span>

                {/* Tech */}
                <span className="text-sm" style={{ color: '#444' }}>
                  {entry.technician || '—'}
                </span>

                {/* Date */}
                <span className="text-sm" style={{ color: MUTED }}>
                  {formatDate(entry.createdAt)}
                </span>

                {/* Arrow */}
                <span className="text-base font-semibold" style={{ color: ORANGE }}>→</span>
              </a>
            ))}
          </>
        )}
      </main>
    </div>
  )
}
