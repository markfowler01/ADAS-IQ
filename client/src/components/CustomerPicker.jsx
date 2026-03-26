import { API_BASE, apiFetch } from '../utils/api.js'
import { useState, useEffect, useRef } from 'react'

const ORANGE = '#CD4419'

// Strip punctuation, legal suffixes, and normalize whitespace for fuzzy matching
function normalizeName(str) {
  if (!str) return ''
  const SKIP = new Set(['inc', 'llc', 'corp', 'ltd', 'co', 'the', 'llp', 'dba'])
  return str
    .toLowerCase()
    .replace(/[,\.]/g, '')
    .split(/[\s\-]+/)
    .filter((w) => w.length > 0 && !SKIP.has(w))
    .join(' ')
    .trim()
}

function fuzzyMatch(shopName, customers) {
  if (!shopName || customers.length === 0) return null
  const needle = normalizeName(shopName)

  // 1. Exact normalized match
  const exact = customers.find((c) => normalizeName(c.contact_name) === needle)
  if (exact) return exact

  // 2. One contains the other
  const contains = customers.find(
    (c) =>
      normalizeName(c.contact_name).includes(needle) ||
      needle.includes(normalizeName(c.contact_name))
  )
  if (contains) return contains

  // 3. Word overlap — best scoring match above 50%
  const needleWords = new Set(needle.split(' ').filter((w) => w.length > 2))
  let best = null, bestScore = 0
  for (const c of customers) {
    const hayWords = normalizeName(c.contact_name).split(' ').filter((w) => w.length > 2)
    const hits = hayWords.filter((w) => needleWords.has(w)).length
    const score = hits / Math.max(needleWords.size, hayWords.length, 1)
    if (score > bestScore) { bestScore = score; best = c }
  }
  return bestScore >= 0.5 ? best : null
}

export default function CustomerPicker({ shopName, onSelect }) {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [selectedName, setSelectedName] = useState(null)
  const [autoMatched, setAutoMatched] = useState(false)
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    apiFetch(`${API_BASE}/api/customers`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setCustomers(data)
          const match = fuzzyMatch(shopName, data)
          if (match) {
            setSelectedId(match.contact_id)
            setSelectedName(match.contact_name)
            setAutoMatched(true)
            onSelect({ id: match.contact_id, name: match.contact_name })
          }
        } else {
          setError('Could not load customers')
        }
      })
      .catch(() => setError('Could not connect to Zoho'))
      .finally(() => setLoading(false))
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = customers.filter((c) =>
    c.contact_name.toLowerCase().includes(search.toLowerCase())
  )

  function handleSelect(customer) {
    setSelectedId(customer.contact_id)
    setSelectedName(customer.contact_name)
    setAutoMatched(false)
    onSelect({ id: customer.contact_id, name: customer.contact_name })
    setOpen(false)
    setSearch('')
  }

  function handleClear() {
    setSelectedId(null)
    setSelectedName(null)
    setAutoMatched(false)
    onSelect(null)
  }

  return (
    <div>
      <p
        className="text-xs font-semibold uppercase tracking-widest mb-2"
        style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#999' }}
      >
        Zoho Customer
      </p>

      <div
        className="bg-white rounded-xl p-4"
        style={{
          borderLeft: `3px solid ${ORANGE}`,
          boxShadow: '0 2px 10px 0 rgba(0,0,0,0.06)',
        }}
      >
        {loading ? (
          <div className="flex flex-col gap-2 animate-pulse">
            <div className="h-9 rounded-lg" style={{ backgroundColor: '#f0ece8' }} />
            <div className="h-3 w-1/3 rounded" style={{ backgroundColor: '#f0ece8' }} />
          </div>
        ) : error ? (
          <p className="text-sm" style={{ color: ORANGE }}>{error}</p>
        ) : (
          <div ref={dropdownRef} className="relative">
            {/* Selected display / trigger */}
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-left"
              style={{
                border: `1.5px solid ${open ? ORANGE : '#e0dbd6'}`,
                backgroundColor: '#fafafa',
                transition: 'border-color 0.15s',
              }}
            >
              <span className="flex items-center gap-2">
                <span style={{ color: selectedName ? '#1a1a1a' : '#aaa' }}>
                  {selectedName || 'Select a customer…'}
                </span>
                {autoMatched && selectedName && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: '#f0faf4', color: '#1a6b3a', fontFamily: "'IBM Plex Mono', monospace" }}>
                    auto
                  </span>
                )}
              </span>
              <span style={{ color: '#bbb', fontSize: '10px' }}>{open ? '▲' : '▼'}</span>
            </button>

            {/* Clear button */}
            {selectedName && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute right-8 top-2.5 text-xs px-1"
                style={{ color: '#bbb' }}
              >
                ✕
              </button>
            )}

            {/* Dropdown */}
            {open && (
              <div
                className="absolute z-20 w-full mt-1 rounded-xl overflow-hidden"
                style={{
                  backgroundColor: 'white',
                  border: '1.5px solid #e8e2dc',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  maxHeight: '260px',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {/* Search */}
                <div className="p-2" style={{ borderBottom: '1px solid #f0ece8' }}>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search customers…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full text-sm px-2 py-1.5 rounded-lg outline-none"
                    style={{
                      border: '1.5px solid #e0dbd6',
                      backgroundColor: '#f9f7f5',
                    }}
                  />
                </div>

                {/* List */}
                <div className="overflow-y-auto">
                  {/* No customer option */}
                  <button
                    type="button"
                    onClick={handleClear}
                    className="w-full text-left px-4 py-2.5 text-sm"
                    style={{
                      color: '#aaa',
                      borderBottom: '1px solid #f5f2ef',
                      backgroundColor: 'transparent',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#fafaf9')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    — No customer link
                  </button>

                  {filtered.length === 0 ? (
                    <p className="text-sm px-4 py-3" style={{ color: '#bbb' }}>
                      No matches found
                    </p>
                  ) : (
                    filtered.map((c) => (
                      <button
                        key={c.contact_id}
                        type="button"
                        onClick={() => handleSelect(c)}
                        className="w-full text-left px-4 py-2.5 text-sm"
                        style={{
                          color: c.contact_id === selectedId ? ORANGE : '#1a1a1a',
                          fontWeight: c.contact_id === selectedId ? 600 : 400,
                          backgroundColor:
                            c.contact_id === selectedId ? '#fdeee8' : 'transparent',
                          transition: 'background-color 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          if (c.contact_id !== selectedId)
                            e.currentTarget.style.backgroundColor = '#fafaf9'
                        }}
                        onMouseLeave={(e) => {
                          if (c.contact_id !== selectedId)
                            e.currentTarget.style.backgroundColor = 'transparent'
                          else e.currentTarget.style.backgroundColor = '#fdeee8'
                        }}
                      >
                        {c.contact_name}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
