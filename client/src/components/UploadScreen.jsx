import { API_BASE, apiFetch } from '../utils/api.js'
import { useState, useRef } from 'react'
import Navbar from './Navbar'

const ORANGE = '#CD4419'

export default function UploadScreen({ onExtracted, onAudit, onManual, onHistory, onJobBoard, user, onLogout, currentScreen, onNavigate }) {
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
      const res = await apiFetch(`${API_BASE}/api/extract`, { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Server error ${res.status}`)
      }
      const data = await res.json()
      onExtracted(data, file)
    } catch (e) {
      const msg = e.message || ''
      const friendly = msg.includes('rate limit') || msg.includes('Too many')
        ? 'Too many requests — wait a few minutes and try again.'
        : msg.includes('credit') || msg.includes('billing')
          ? 'AI credits exhausted. Check console.anthropic.com → Billing.'
          : msg.includes('PDF') || msg.includes('pdf') || msg.includes('empty')
            ? msg
            : msg || 'Extraction failed. Check that the file is a valid calibration report PDF and try again.'
      setError(friendly)
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

      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

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
                  Usually 10–30 seconds depending on report length
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
