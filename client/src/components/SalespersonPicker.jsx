import { useState, useEffect, useRef } from 'react'

const ORANGE = '#CD4419'

export default function SalespersonPicker({ onSelect }) {
  const [salespersons, setSalespersons] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [selectedName, setSelectedName] = useState(null)
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    fetch('/api/salespersons', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setSalespersons(data)
          // Auto-select Mark Fowler by default
          const mark = data.find((s) =>
            s.name.toLowerCase().includes('mark fowler')
          )
          if (mark) {
            setSelectedId(mark.user_id)
            setSelectedName(mark.name)
            onSelect({ id: mark.user_id, name: mark.name })
          }
        } else {
          setError(data.error || 'Could not load salespersons')
        }
      })
      .catch(() => setError('Could not connect to Zoho'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = salespersons.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  )

  function handleSelect(person) {
    setSelectedId(person.user_id)
    setSelectedName(person.name)
    onSelect({ id: person.user_id, name: person.name })
    setOpen(false)
    setSearch('')
  }

  function handleClear() {
    setSelectedId(null)
    setSelectedName(null)
    onSelect(null)
  }

  return (
    <div>
      <p
        className="text-xs font-semibold uppercase tracking-widest mb-2"
        style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#999' }}
      >
        Salesperson
      </p>

      <div
        className="bg-white rounded-xl p-4"
        style={{
          borderLeft: `3px solid ${ORANGE}`,
          boxShadow: '0 2px 10px 0 rgba(0,0,0,0.06)',
        }}
      >
        {loading ? (
          <p className="text-sm" style={{ color: '#aaa' }}>Loading salespersons...</p>
        ) : error ? (
          <p className="text-sm" style={{ color: ORANGE }}>{error}</p>
        ) : (
          <div ref={dropdownRef} className="relative">
            {/* Trigger */}
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
              <span style={{ color: selectedName ? '#1a1a1a' : '#aaa' }}>
                {selectedName || 'Select a salesperson…'}
              </span>
              <span style={{ color: '#bbb', fontSize: '10px' }}>{open ? '▲' : '▼'}</span>
            </button>

            {/* Clear */}
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
                    placeholder="Search salespersons…"
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
                    — No salesperson
                  </button>

                  {filtered.length === 0 ? (
                    <p className="text-sm px-4 py-3" style={{ color: '#bbb' }}>
                      No matches found
                    </p>
                  ) : (
                    filtered.map((s) => (
                      <button
                        key={s.user_id}
                        type="button"
                        onClick={() => handleSelect(s)}
                        className="w-full text-left px-4 py-2.5 text-sm"
                        style={{
                          color: s.user_id === selectedId ? ORANGE : '#1a1a1a',
                          fontWeight: s.user_id === selectedId ? 600 : 400,
                          backgroundColor: s.user_id === selectedId ? '#fdeee8' : 'transparent',
                          transition: 'background-color 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          if (s.user_id !== selectedId)
                            e.currentTarget.style.backgroundColor = '#fafaf9'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor =
                            s.user_id === selectedId ? '#fdeee8' : 'transparent'
                        }}
                      >
                        <span>{s.name}</span>
                        {s.email && (
                          <span className="ml-2 text-xs" style={{ color: '#aaa' }}>
                            {s.email}
                          </span>
                        )}
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
