import { API_BASE, apiFetch } from '../utils/api.js'
import { useState, useRef } from 'react'
import Navbar from './Navbar'

const ORANGE = '#CD4419'

export default function AuditScreen({ onBack, user, onLogout, currentScreen, onNavigate }) {
  const [files, setFiles] = useState([])
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  function addFiles(newFiles) {
    const pdfs = [...newFiles].filter((f) => f.type === 'application/pdf')
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name))
      return [...prev, ...pdfs.filter((f) => !names.has(f.name))]
    })
  }

  function removeFile(name) {
    setFiles((prev) => prev.filter((f) => f.name !== name))
  }

  async function runAudit() {
    if (files.length === 0) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const form = new FormData()
      files.forEach((f) => form.append('pdfs', f))
      const res = await apiFetch(`${API_BASE}/api/audit`, { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const unmatched = result?.rows.filter((r) => r.status === 'unmatched') || []
  const fuzzy = result?.rows.filter((r) => r.status === 'fuzzy') || []
  const exact = result?.rows.filter((r) => r.status === 'exact') || []

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

      <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-5">

        {/* Explainer */}
        <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: 'white', border: '1.5px solid #e8e4e0', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <p className="font-semibold mb-1" style={{ color: '#1a1a1a' }}>What this does</p>
          <p style={{ color: '#666' }}>
            Upload multiple Kinetic PDFs. Claude reads every calibration name across all of them, then cross-references
            your Zoho Books item catalog. You'll see exactly what matches, what fuzzy-matches, and what's missing — so
            you know what to add or rename in Zoho.
          </p>
        </div>

        {/* Upload zone */}
        <div
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onClick={() => inputRef.current.click()}
          style={{
            border: `2px dashed ${dragging ? ORANGE : '#d1ccc7'}`,
            borderRadius: '14px',
            backgroundColor: dragging ? '#fdf3ef' : 'white',
            padding: '28px 24px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            textAlign: 'center',
          }}
        >
          <input ref={inputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          <p className="text-sm font-semibold" style={{ color: '#2a2a2a' }}>Drop Kinetic PDFs here or <span style={{ color: ORANGE }}>browse</span></p>
          <p className="text-xs mt-1" style={{ color: '#aaa' }}>Select as many as you want — up to 20 at once</p>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="flex flex-col gap-2">
            {files.map((f) => (
              <div key={f.name} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ backgroundColor: 'white', border: '1px solid #ece8e4' }}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base">📄</span>
                  <span className="text-sm truncate" style={{ color: '#2a2a2a' }}>{f.name}</span>
                </div>
                <button onClick={() => removeFile(f.name)} className="text-xs ml-3 flex-shrink-0" style={{ color: '#bbb' }}>✕</button>
              </div>
            ))}

            <button
              onClick={runAudit}
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-bold text-white mt-1"
              style={{ backgroundColor: ORANGE, opacity: loading ? 0.6 : 1, cursor: loading ? 'wait' : 'pointer' }}
            >
              {loading
                ? `Claude is reading ${files.length} PDF${files.length > 1 ? 's' : ''}...`
                : `Run Catalog Audit on ${files.length} PDF${files.length > 1 ? 's' : ''}`}
            </button>
          </div>
        )}

        {error && (
          <div className="px-4 py-3 rounded-xl text-sm" style={{ backgroundColor: '#fff0ed', border: `1px solid ${ORANGE}`, color: ORANGE }}>
            {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="flex flex-col gap-4">
            {/* Summary pills */}
            <div className="flex items-center gap-3 flex-wrap">
              <Pill label="PDFs processed" value={result.pdfs_processed} color="#555" bg="#f0ece8" />
              <Pill label="Unique calibrations" value={result.total_unique} color="#555" bg="#f0ece8" />
              <Pill label="Exact match" value={exact.length} color="#1a6b3a" bg="#f0faf4" />
              <Pill label="Fuzzy match" value={fuzzy.length} color="#7a5e00" bg="#fff8e6" />
              <Pill label="No match" value={unmatched.length} color={ORANGE} bg="#fff0ed" />
            </div>

            {/* Unmatched — action required */}
            {unmatched.length > 0 && (
              <Section title="❌ No Match — Add or Rename in Zoho" accent={ORANGE} bg="#fff0ed" border="#f5c7b4">
                <p className="text-xs mb-3" style={{ color: '#7a2b0e' }}>
                  These calibration names don't exist in your Zoho Books item catalog. Add them or rename existing items to match.
                </p>
                {unmatched.map((row) => (
                  <MatchRow key={row.calibration_name} row={row} />
                ))}
              </Section>
            )}

            {/* Fuzzy — review recommended */}
            {fuzzy.length > 0 && (
              <Section title="⚠️ Fuzzy Match — Review Recommended" accent="#7a5e00" bg="#fff8e6" border="#f5d97a">
                <p className="text-xs mb-3" style={{ color: '#7a5e00' }}>
                  These matched an existing item but not exactly. Check that the Zoho item is the right one.
                </p>
                {fuzzy.map((row) => (
                  <MatchRow key={row.calibration_name} row={row} />
                ))}
              </Section>
            )}

            {/* Exact — all good */}
            {exact.length > 0 && (
              <Section title="✅ Exact Match" accent="#1a6b3a" bg="#f0faf4" border="#b7e4c7">
                {exact.map((row) => (
                  <MatchRow key={row.calibration_name} row={row} />
                ))}
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Pill({ label, value, color, bg }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ backgroundColor: bg, color }}>
      <span className="text-base font-bold">{value}</span>
      <span className="font-normal">{label}</span>
    </div>
  )
}

function Section({ title, accent, bg, border, children }) {
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: bg, border: `1.5px solid ${border}` }}>
      <p className="text-sm font-bold mb-3" style={{ color: accent }}>{title}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

function MatchRow({ row }) {
  return (
    <div className="rounded-lg px-3 py-2.5 flex flex-col gap-1" style={{ backgroundColor: 'white', border: '1px solid #ece8e4' }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>{row.calibration_name}</p>
        {row.score > 0 && (
          <span className="text-xs flex-shrink-0 px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f0ece8', color: '#888', fontFamily: "'IBM Plex Mono', monospace" }}>
            {row.score}%
          </span>
        )}
      </div>
      {row.matched_item && (
        <p className="text-xs" style={{ color: '#666' }}>
          → <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{row.matched_item}</span>
        </p>
      )}
      {row.source_files.length > 0 && (
        <p className="text-xs" style={{ color: '#bbb' }}>
          Found in: {row.source_files.join(', ')}
        </p>
      )}
    </div>
  )
}
