import { useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'

export default function GooglePlacesModal({ existingShops, onImported, onClose }) {
  const [step, setStep] = useState(1) // 1=search, 2=results, 3=done
  const [location, setLocation] = useState('')
  const [radius, setRadius] = useState('25')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [error, setError] = useState('')
  const [nextPage, setNextPage] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const existingNames = new Set((existingShops || []).map(s => (s.shop_name || '').toLowerCase().trim()))

  async function doSearch() {
    if (!location.trim()) return
    setSearching(true); setError('')
    try {
      const params = new URLSearchParams({ location: location.trim(), radius, query: 'auto body shop collision repair' })
      const res = await apiFetch(`${API_BASE}/api/shops/search-places?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Search failed')
      setResults(data.places || [])
      setNextPage(data.next_page_token || null)
      setStep(2)
      // Auto-select all non-duplicates
      const auto = new Set()
      for (const p of (data.places || [])) {
        if (!existingNames.has(p.name.toLowerCase().trim())) auto.add(p.place_id)
      }
      setSelected(auto)
    } catch (e) {
      setError(e.message)
    }
    setSearching(false)
  }

  async function loadMore() {
    if (!nextPage) return
    setLoadingMore(true)
    try {
      const res = await apiFetch(`${API_BASE}/api/shops/search-places/next?pagetoken=${nextPage}`)
      const data = await res.json()
      if (data.ok) {
        setResults(prev => [...prev, ...(data.places || [])])
        setNextPage(data.next_page_token || null)
        // Auto-select new non-duplicates
        for (const p of (data.places || [])) {
          if (!existingNames.has(p.name.toLowerCase().trim())) {
            setSelected(prev => new Set([...prev, p.place_id]))
          }
        }
      }
    } catch {}
    setLoadingMore(false)
  }

  function toggleSelect(placeId) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(placeId)) next.delete(placeId)
      else next.add(placeId)
      return next
    })
  }

  function selectAll() {
    const all = new Set()
    for (const p of results) {
      if (!existingNames.has(p.name.toLowerCase().trim())) all.add(p.place_id)
    }
    setSelected(all)
  }

  function selectNone() { setSelected(new Set()) }

  async function doImport() {
    const toImport = results.filter(p => selected.has(p.place_id))
    if (toImport.length === 0) return
    setImporting(true); setError('')
    try {
      const shops = toImport.map(p => ({
        shop_name: p.name,
        address: p.address,
        phone: p.phone,
        email: p.email || '',
        notes: [p.website, p.google_maps_url].filter(Boolean).join(' | '),
        pipeline_stage: 'target',
        referral_source: 'Google Places',
      }))
      const res = await apiFetch(`${API_BASE}/api/shops/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shops),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setImportResult(data)
      setStep(3)
      if (onImported) onImported()
    } catch (e) {
      setError(e.message)
    }
    setImporting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #ebebeb' }}>
          <div>
            <h2 className="text-lg font-bold" style={{ color: '#1a1a1a' }}>
              {step === 1 ? 'Find Body Shops' : step === 2 ? `${results.length} Shops Found` : 'Import Complete'}
            </h2>
            <p className="text-xs text-gray-400">
              {step === 1 ? 'Search Google for body shops in any area' : step === 2 ? `${selected.size} selected for import` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-light">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {/* Step 1: Search */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-600 block mb-1">City, State or Zip Code</label>
                <input value={location} onChange={e => setLocation(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doSearch()}
                  placeholder="e.g. Seattle, WA or 98101"
                  className="w-full text-sm bg-gray-50 rounded-lg border border-gray-200 px-4 py-3 focus:border-orange-300 focus:outline-none" autoFocus />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600 block mb-1">Search Radius (miles)</label>
                <div className="flex gap-2">
                  {['10', '25', '50', '100'].map(r => (
                    <button key={r} onClick={() => setRadius(r)}
                      className="px-4 py-2 rounded-lg text-sm font-medium border transition-all"
                      style={{
                        background: radius === r ? ORANGE : 'white',
                        color: radius === r ? 'white' : '#666',
                        borderColor: radius === r ? ORANGE : '#e5e7eb',
                      }}>
                      {r} mi
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-gray-400">
                Searches Google Places for "auto body shop" and "collision repair" in the area. Results include name, address, phone, website, and Google rating.
              </p>
            </div>
          )}

          {/* Step 2: Results */}
          {step === 2 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex gap-2">
                  <button onClick={selectAll} className="text-xs font-medium px-2 py-1 rounded" style={{ background: '#f5f3f0', color: '#666' }}>Select all</button>
                  <button onClick={selectNone} className="text-xs font-medium px-2 py-1 rounded" style={{ background: '#f5f3f0', color: '#666' }}>Deselect all</button>
                </div>
                <button onClick={() => setStep(1)} className="text-xs font-medium" style={{ color: ORANGE }}>← New search</button>
              </div>
              <div className="space-y-2">
                {results.map(p => {
                  const isDupe = existingNames.has(p.name.toLowerCase().trim())
                  const isSelected = selected.has(p.place_id)
                  return (
                    <div key={p.place_id}
                      onClick={() => !isDupe && toggleSelect(p.place_id)}
                      className="flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer"
                      style={{
                        borderColor: isDupe ? '#fca5a5' : isSelected ? ORANGE : '#e5e7eb',
                        background: isDupe ? '#fef2f2' : isSelected ? '#fff7ed' : 'white',
                        opacity: isDupe ? 0.6 : 1,
                      }}>
                      {/* Checkbox */}
                      <div className="mt-0.5 flex-shrink-0">
                        {isDupe ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#fee2e2', color: '#dc2626' }}>IN CRM</span>
                        ) : (
                          <div className="w-5 h-5 rounded border-2 flex items-center justify-center"
                            style={{ borderColor: isSelected ? ORANGE : '#d1d5db', background: isSelected ? ORANGE : 'white' }}>
                            {isSelected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                          </div>
                        )}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-semibold text-gray-800 truncate">{p.name}</span>
                          {p.rating > 0 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: '#fef3c7', color: '#92400e' }}>
                              ★ {p.rating} ({p.user_ratings_total})
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">{p.address}</div>
                        <div className="flex gap-3 mt-1 flex-wrap">
                          {p.phone && <span className="text-xs text-gray-600">{p.phone}</span>}
                          {p.email && <span className="text-xs text-gray-600">✉ {p.email}</span>}
                          {p.website && <a href={p.website} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-xs" style={{ color: ORANGE }}>Website ↗</a>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {nextPage && (
                <button onClick={loadMore} disabled={loadingMore}
                  className="w-full mt-3 py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:border-gray-300">
                  {loadingMore ? 'Loading more...' : 'Load more results'}
                </button>
              )}
            </div>
          )}

          {/* Step 3: Done */}
          {step === 3 && importResult && (
            <div className="text-center py-8">
              <div className="text-4xl mb-4">🎯</div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                {importResult.imported} shop{importResult.imported !== 1 ? 's' : ''} imported!
              </h3>
              <p className="text-sm text-gray-500 mb-1">Added to your Target pipeline.</p>
              {importResult.duplicates > 0 && (
                <p className="text-xs text-gray-400">{importResult.duplicates} duplicate{importResult.duplicates !== 1 ? 's' : ''} skipped</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderTop: '1px solid #ebebeb' }}>
          <button onClick={onClose} className="text-sm font-medium text-gray-500 hover:text-gray-700">
            {step === 3 ? 'Close' : 'Cancel'}
          </button>
          {step === 1 && (
            <button onClick={doSearch} disabled={searching || !location.trim()}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: ORANGE, opacity: searching || !location.trim() ? 0.5 : 1 }}>
              {searching ? 'Searching...' : 'Search Google Places'}
            </button>
          )}
          {step === 2 && (
            <button onClick={doImport} disabled={importing || selected.size === 0}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: ORANGE, opacity: importing || selected.size === 0 ? 0.5 : 1 }}>
              {importing ? 'Importing...' : `Import ${selected.size} Shop${selected.size !== 1 ? 's' : ''}`}
            </button>
          )}
          {step === 3 && (
            <button onClick={onClose}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: ORANGE }}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
