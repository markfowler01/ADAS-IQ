import { useState, useRef } from 'react'

const ORANGE = '#CD4419'

export default function UploadScreen({ onExtracted, onAudit, onManual, onHistory, user, onLogout }) {
  const [dragging, setDragging]   = useState(false)
  const [loading,  setLoading]    = useState(false)
  const [error,    setError]      = useState(null)
  const inputRef = useRef(null)

  async function handleFile(file) {
    if (!file || file.type !== 'application/pdf') {
      setError('Please upload a PDF file.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('pdf', file)
      const res = await fetch('/api/extract', { method: 'POST', body: formData, credentials: 'include' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Server error ${res.status}`)
      }
      const data = await res.json()
      onExtracted(data, file)
    } catch (e) {
      setError(e.message || 'Extraction failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'white' }}>

      {/* ── Navbar ── */}
      <header style={{ borderBottom: '1px solid #ebebeb' }}>
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: ORANGE }}>
              <span className="text-white text-xs font-bold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>IQ</span>
            </div>
            <span className="text-base font-bold tracking-tight" style={{ color: '#1a1a1a' }}>
              ADAS IQ
            </span>
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-2">
            {/* User avatar + logout */}
            {user && (
              <div className="flex items-center gap-2 mr-1">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: ORANGE }}>
                  {user.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <span className="text-sm text-gray-600 hidden sm:block">{user.name?.split(' ')[0]}</span>
                <button onClick={onLogout}
                  className="text-xs px-2 py-1 rounded-md text-gray-400 hover:text-gray-600 transition-colors">
                  Sign out
                </button>
              </div>
            )}
            <button onClick={onHistory}
              className="text-sm px-3 py-1.5 rounded-lg font-medium transition-colors"
              style={{ color: '#555', backgroundColor: '#f5f3f0' }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#ebe8e4'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f5f3f0'}>
              History
            </button>
            <button onClick={onManual}
              className="text-sm px-3 py-1.5 rounded-lg font-medium transition-colors"
              style={{ color: ORANGE, backgroundColor: '#fdf3ef', border: `1px solid #e8c5b0` }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#fae8df'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#fdf3ef'}>
              ✏️ Manual Quote
            </button>
            <button onClick={onAudit}
              className="text-sm px-3 py-1.5 rounded-lg font-medium"
              style={{ color: '#555', backgroundColor: '#f5f3f0' }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#ebe8e4'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#f5f3f0'}>
              🔍 Catalog Audit
            </button>
          </div>
        </div>
      </header>

      {/* ── Upload area ── */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-xl">

          {/* Upload card */}
          <div
            onClick={() => !loading && inputRef.current.click()}
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            className="flex flex-col items-center justify-center rounded-2xl transition-all"
            style={{
              border: `1.5px dashed ${dragging ? ORANGE : '#d4d0cb'}`,
              backgroundColor: dragging ? '#fdf3ef' : '#fafafa',
              cursor: loading ? 'default' : 'pointer',
              minHeight: '280px',
              padding: '48px 32px',
            }}>

            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => handleFile(e.target.files[0])}
              disabled={loading}
            />

            {loading ? (
              <div className="flex flex-col items-center gap-4">
                <Spinner />
                <p className="text-base font-semibold text-center" style={{ color: ORANGE }}>
                  Claude is reading your Kinetic report…
                </p>
                <p className="text-sm text-center" style={{ color: '#aaa' }}>
                  This usually takes 10–20 seconds
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 text-center">
                {/* Upload circle button */}
                <div className="w-16 h-16 rounded-full flex items-center justify-center shadow-sm"
                  style={{ backgroundColor: ORANGE }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <polyline points="17 8 12 3 7 8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <line x1="12" y1="3" x2="12" y2="15" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </div>

                <div>
                  <p className="text-lg font-semibold mb-1" style={{ color: '#1a1a1a' }}>
                    {dragging ? 'Drop your PDF here' : 'Upload Calibration Report'}
                  </p>
                  <p className="text-sm" style={{ color: '#888' }}>
                    Drag & drop a PDF estimate, or click to choose
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 px-4 py-3 rounded-xl text-sm"
              style={{ backgroundColor: '#fff0ed', border: `1px solid #e8c5b0`, color: ORANGE }}>
              {error}
            </div>
          )}

          {/* Footer note */}
          <p className="text-xs text-center mt-5" style={{ color: '#bbb' }}>
            PDF files only · Data is never stored · Powered by Claude AI
          </p>
        </div>
      </main>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin" width="36" height="36" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="#e8d5ce" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke={ORANGE} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
