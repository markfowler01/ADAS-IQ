import { useState, useEffect, useRef } from 'react'

const API_BASE = ''
const ORANGE = '#CD4419'

function apiFetch(url, opts = {}) {
  const token = sessionStorage.getItem('auth_token') || ''
  return fetch(url, {
    ...opts,
    headers: { 'X-Auth-Token': token, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
}

function normalizeCal(c) {
  if (typeof c === 'string') return { name: c }
  return { ...c, name: c.name || c.calibration_name || '' }
}

/**
 * Mobile-first bottom-sheet modal for reviewing/editing calibrations
 * before moving a job to Ready to Invoice.
 *
 * Props:
 *   job          — the job being moved
 *   onConfirm(updatedCals) — called with the final calibration array
 *   onClose()    — called when dismissed without confirming
 */
export default function CalibrationReviewModal({ job, onConfirm, onClose }) {
  const [cals, setCals] = useState(() => {
    let c = []
    try { c = typeof job.calibrations === 'string' ? JSON.parse(job.calibrations) : (job.calibrations || []) } catch {}
    return c.map(normalizeCal)
  })
  const [topTen, setTopTen] = useState([])
  const [allRules, setAllRules] = useState([])
  const [showSearch, setShowSearch] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const searchRef = useRef(null)

  useEffect(() => {
    Promise.all([
      apiFetch(`${API_BASE}/api/jobs/top-calibrations`).then(r => r.json()).catch(() => ({ calibrations: [] })),
      apiFetch(`${API_BASE}/api/calibration-rules`).then(r => r.json()).catch(() => []),
    ]).then(([topData, rulesData]) => {
      setTopTen(topData.calibrations || [])
      setAllRules(Array.isArray(rulesData) ? rulesData : [])
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (showSearch && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 100)
    }
  }, [showSearch])

  const calNames = new Set(cals.map(c => c.name.toLowerCase()))

  function addCal(name, extraData = {}) {
    if (calNames.has(name.toLowerCase())) return
    setCals(prev => [...prev, { name, ...extraData }])
  }

  function removeCal(index) {
    setCals(prev => prev.filter((_, i) => i !== index))
  }

  const filteredRules = allRules.filter(r => {
    const rName = (r.calibration_name || '').toLowerCase()
    return rName.includes(searchText.toLowerCase()) && !calNames.has(rName)
  })

  async function handleConfirm() {
    setSaving(true)
    await onConfirm(cals)
    setSaving(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white flex flex-col"
        style={{ borderRadius: '20px 20px 0 0', maxHeight: '88vh' }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4" style={{ borderBottom: '1px solid #f0ece8' }}>
          <div>
            <h2 className="font-bold text-base" style={{ color: '#1a1a1a' }}>Review Calibrations</h2>
            <p className="text-xs mt-0.5" style={{ color: '#aaa' }}>
              {job.shop_name || 'Job'} · Add or remove before invoicing
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full text-lg"
            style={{ backgroundColor: '#f5f3f0', color: '#888' }}
          >
            ×
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Current calibrations */}
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#bbb' }}>
            On This Job ({cals.length})
          </p>

          {cals.length === 0 && (
            <p className="text-sm mb-4" style={{ color: '#aaa' }}>No calibrations yet — add from below.</p>
          )}

          <div className="flex flex-col gap-2 mb-5">
            {cals.map((c, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-2xl px-4"
                style={{
                  backgroundColor: '#fdf3ef',
                  border: '1.5px solid #f5d5c8',
                  minHeight: '52px',
                }}
              >
                <div className="flex-1 min-w-0 pr-3">
                  <span className="text-sm font-semibold" style={{ color: ORANGE }}>{c.name}</span>
                  {c.cal_type && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded-md" style={{ backgroundColor: '#fde8de', color: '#a33510' }}>
                      {c.cal_type}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => removeCal(i)}
                  className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full text-sm font-bold"
                  style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}
                  aria-label={`Remove ${c.name}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {/* PCSI + POST always-present note */}
          <div className="flex gap-2 mb-5">
            {['PCSI', 'POST'].map(tag => (
              <span
                key={tag}
                className="text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}
              >
                {tag} — always included
              </span>
            ))}
          </div>

          {/* Quick Add — top 10 */}
          {!loading && topTen.length > 0 && (
            <>
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#bbb' }}>Quick Add</p>
              <div className="grid grid-cols-2 gap-2 mb-5">
                {topTen.map(({ name }) => {
                  const already = calNames.has(name.toLowerCase())
                  return (
                    <button
                      key={name}
                      onClick={() => addCal(name)}
                      disabled={already}
                      className="text-left rounded-2xl px-4 transition-all"
                      style={{
                        backgroundColor: already ? '#f5f3f0' : '#f0fdf4',
                        border: `1.5px solid ${already ? '#e0dbd6' : '#bbf7d0'}`,
                        color: already ? '#aaa' : '#15803d',
                        minHeight: '52px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '13px',
                        fontWeight: 500,
                      }}
                    >
                      <span style={{ fontSize: '16px' }}>{already ? '✓' : '+'}</span>
                      {name}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {loading && (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-orange-300 border-t-orange-600 rounded-full animate-spin" />
            </div>
          )}

          {/* More — searchable */}
          <button
            onClick={() => setShowSearch(s => !s)}
            className="w-full flex items-center justify-between rounded-2xl px-4 mb-3"
            style={{
              backgroundColor: '#f5f3f0',
              border: '1.5px solid #e0dbd6',
              minHeight: '52px',
            }}
          >
            <span className="text-sm font-medium" style={{ color: '#555' }}>+ More calibrations</span>
            <span style={{ color: '#aaa', fontSize: '12px' }}>{showSearch ? '▲' : '▼'}</span>
          </button>

          {showSearch && (
            <div className="mb-4">
              <input
                ref={searchRef}
                type="text"
                placeholder="Search calibrations…"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                className="w-full rounded-2xl px-4 py-3 text-sm mb-3"
                style={{
                  border: '1.5px solid #e0dbd6',
                  backgroundColor: '#fafafa',
                  outline: 'none',
                  fontSize: '15px',
                }}
              />
              <div className="flex flex-col gap-2">
                {filteredRules.slice(0, 20).map(rule => (
                  <button
                    key={rule.id}
                    onClick={() => {
                      addCal(rule.calibration_name, {
                        cal_type: rule.cal_type || '',
                        rule_id: rule.id,
                      })
                      setSearchText('')
                    }}
                    className="flex items-center justify-between rounded-2xl px-4 text-left"
                    style={{
                      backgroundColor: '#f0fdf4',
                      border: '1.5px solid #bbf7d0',
                      minHeight: '52px',
                    }}
                  >
                    <span className="text-sm font-medium" style={{ color: '#15803d' }}>
                      + {rule.calibration_name}
                    </span>
                    {rule.cal_type && (
                      <span className="text-xs ml-2 flex-shrink-0 px-2 py-1 rounded-md" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
                        {rule.cal_type}
                      </span>
                    )}
                  </button>
                ))}
                {filteredRules.length === 0 && searchText && (
                  <p className="text-sm px-2 py-3" style={{ color: '#aaa' }}>No matches for "{searchText}"</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Sticky footer ── */}
        <div className="px-5 pb-8 pt-4" style={{ borderTop: '1px solid #f0ece8' }}>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="w-full rounded-2xl font-bold text-white transition-opacity"
            style={{
              backgroundColor: saving ? '#c4b5fd' : '#7e22ce',
              minHeight: '56px',
              fontSize: '15px',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Done — Move to Ready to Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}
