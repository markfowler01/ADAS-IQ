import { useState, useRef } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'

const SHOP_FIELDS = [
  { key: 'shop_name',    label: 'Shop Name *' },
  { key: 'contact_name', label: 'Contact Name' },
  { key: 'phone',        label: 'Phone' },
  { key: 'email',        label: 'Email' },
  { key: 'address',      label: 'Address' },
  { key: 'region',       label: 'Region' },
  { key: 'notes',        label: 'Notes' },
  { key: '_skip',        label: '— Skip this column —' },
]

const DETECT_RULES = [
  { keys: ['shop_name','shop name','business','business name','company','name','title','store'],  field: 'shop_name' },
  { keys: ['contact','contact name','contact_name','owner','manager','person','rep'],              field: 'contact_name' },
  { keys: ['phone','phone number','phone_number','telephone','tel','mobile','cell'],               field: 'phone' },
  { keys: ['email','email address','email_address','e-mail'],                                      field: 'email' },
  { keys: ['address','full_address','full address','location','street','addr'],                   field: 'address' },
  { keys: ['region','territory','area','city','market'],                                          field: 'region' },
  { keys: ['notes','description','comments','note','website','web','url','site'],                 field: 'notes' },
]

function autoDetect(header) {
  const h = header.toLowerCase().trim()
  for (const rule of DETECT_RULES) {
    if (rule.keys.some(k => h === k || h.includes(k))) return rule.field
  }
  return '_skip'
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const rows  = []
  for (const line of lines) {
    if (!line.trim()) continue
    const cols = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    cols.push(cur.trim())
    rows.push(cols)
  }
  return rows
}

export default function CRMImportModal({ existingShops = [], onClose, onImported }) {
  const [step,     setStep]     = useState('upload')
  const [headers,  setHeaders]  = useState([])
  const [rows,     setRows]     = useState([])
  const [mapping,  setMapping]  = useState({})
  const [importing,setImporting]= useState(false)
  const [result,   setResult]   = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef()

  const existingNames = new Set((existingShops || []).map(s => (s.shop_name || '').toLowerCase().trim()))

  function handleFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => {
      const parsed = parseCSV(e.target.result)
      if (parsed.length < 2) { alert('CSV appears empty or has no data rows.'); return }
      const hdrs    = parsed[0]
      const dataRows = parsed.slice(1).filter(r => r.some(c => c.trim()))
      const autoMap  = {}
      hdrs.forEach((h, i) => { autoMap[i] = autoDetect(h) })
      setHeaders(hdrs)
      setRows(dataRows)
      setMapping(autoMap)
      setStep('map')
    }
    reader.readAsText(file)
  }

  function onFileInput(e)  { handleFile(e.target.files[0]) }
  function onDrop(e)       { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }
  function onDragOver(e)   { e.preventDefault(); setDragOver(true) }
  function onDragLeave()   { setDragOver(false) }
  function setCol(idx, field) { setMapping(m => ({ ...m, [idx]: field })) }

  function buildShops() {
    return rows.map(row => {
      const shop = {}
      headers.forEach((_, i) => {
        const field = mapping[i]
        if (!field || field === '_skip') return
        const val = (row[i] || '').trim()
        if (!val) return
        if (shop[field]) shop[field] += ' ' + val
        else shop[field] = val
      })
      return shop
    }).filter(s => s.shop_name?.trim())
  }

  const allPreview = buildShops()
  // Split into new vs duplicate
  const newShops   = allPreview.filter(s => !existingNames.has((s.shop_name || '').toLowerCase().trim()))
  const dupeShops  = allPreview.filter(s =>  existingNames.has((s.shop_name || '').toLowerCase().trim()))

  async function handleImport() {
    if (newShops.length === 0) { alert('No new shops to import. All shops already exist in your pipeline.'); return }
    setImporting(true)
    try {
      const res = await apiFetch(`${API_BASE}/api/shops/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newShops.map(s => ({ ...s, pipeline_stage: 'target' }))),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setResult({ imported: data.imported, duplicates: dupeShops.length })
      setStep('done')
      onImported(data.imported, dupeShops.length)
    } catch (e) {
      alert('Import failed: ' + e.message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full sm:max-w-2xl bg-white overflow-hidden shadow-2xl"
        style={{ maxHeight: '92vh', display: 'flex', flexDirection: 'column',
          borderRadius: '20px 20px 0 0', ...(window.innerWidth >= 640 ? { borderRadius: '20px' } : {}) }}>

        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full" style={{ backgroundColor: '#ddd' }} />
        </div>

        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #ebebeb' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: '#1a1a1a' }}>Import from Google Sheets</h2>
            <p className="text-xs mt-0.5" style={{ color: '#888' }}>
              In Google Sheets → File → Download → CSV, then upload here
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#f5f3f0', color: '#888' }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* ── Step 1: Upload ── */}
          {step === 'upload' && (
            <div>
              <div
                className="rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors"
                style={{
                  border: `2px dashed ${dragOver ? ORANGE : '#ddd'}`,
                  backgroundColor: dragOver ? '#fff4f0' : '#fafafa',
                  minHeight: '200px', padding: '2rem',
                }}
                onClick={() => fileRef.current.click()}
                onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
                  style={{ backgroundColor: '#fff4f0' }}>📊</div>
                <p className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>Drop your CSV file here</p>
                <p className="text-xs" style={{ color: '#888' }}>or tap to browse</p>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFileInput} />
              </div>
              <div className="mt-4 p-4 rounded-xl" style={{ backgroundColor: '#f9f8f7', border: '1px solid #ebebeb' }}>
                <p className="text-xs font-semibold mb-2" style={{ color: '#555' }}>How to export from Google Sheets:</p>
                <ol className="text-xs space-y-1" style={{ color: '#777' }}>
                  <li>1. Open your Google Sheet with body shop leads</li>
                  <li>2. Click <strong>File</strong> → <strong>Download</strong> → <strong>Comma Separated Values (.csv)</strong></li>
                  <li>3. Upload that file here — we'll match the columns automatically</li>
                </ol>
              </div>
            </div>
          )}

          {/* ── Step 2: Map columns ── */}
          {step === 'map' && (
            <div>
              <p className="text-sm mb-4" style={{ color: '#555' }}>
                We found <strong>{rows.length} shops</strong> and <strong>{headers.length} columns</strong>.
                Confirm the field mapping below:
              </p>
              <div className="space-y-2 mb-4">
                {headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl"
                    style={{ backgroundColor: '#f9f8f7', border: '1px solid #ebebeb' }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: '#1a1a1a' }}>{h}</p>
                      <p className="text-xs truncate mt-0.5" style={{ color: '#aaa' }}>
                        e.g. {rows[0]?.[i] || '—'}
                      </p>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2"
                      className="flex-shrink-0"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    <select
                      value={mapping[i] || '_skip'}
                      onChange={e => setCol(i, e.target.value)}
                      className="text-xs rounded-lg px-2 py-2 outline-none flex-shrink-0"
                      style={{ border: `1px solid ${mapping[i] && mapping[i] !== '_skip' ? ORANGE : '#ddd'}`,
                        color: mapping[i] && mapping[i] !== '_skip' ? ORANGE : '#888',
                        backgroundColor: 'white', maxWidth: '160px' }}>
                      {SHOP_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              {/* Duplicate warning */}
              {dupeShops.length > 0 && allPreview.length > 0 && (
                <div className="mb-3 p-3 rounded-xl" style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a' }}>
                  <p className="text-xs font-semibold mb-1" style={{ color: '#b45309' }}>
                    ⚠️ {dupeShops.length} duplicate{dupeShops.length !== 1 ? 's' : ''} found — will be skipped
                  </p>
                  <p className="text-xs" style={{ color: '#888' }}>
                    {dupeShops.slice(0, 5).map(s => s.shop_name).join(', ')}
                    {dupeShops.length > 5 ? ` +${dupeShops.length - 5} more` : ''}
                  </p>
                </div>
              )}

              {newShops.length === 0 && allPreview.length > 0 && (
                <div className="px-4 py-3 rounded-xl text-xs" style={{ backgroundColor: '#fff0ed', color: ORANGE }}>
                  ⚠️ All {dupeShops.length} shops already exist in your pipeline. Nothing new to import.
                </div>
              )}

              {newShops.length === 0 && allPreview.length === 0 && (
                <div className="px-4 py-3 rounded-xl text-xs" style={{ backgroundColor: '#fff0ed', color: ORANGE }}>
                  ⚠️ Map at least one column to <strong>Shop Name</strong> to enable import.
                </div>
              )}

              {newShops.length > 0 && (
                <div className="p-3 rounded-xl" style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                  <p className="text-xs font-semibold" style={{ color: '#15803d' }}>
                    ✓ Ready to import {newShops.length} new shop{newShops.length !== 1 ? 's' : ''} as Targets
                    {dupeShops.length > 0 ? ` (${dupeShops.length} duplicates skipped)` : ''}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Done ── */}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
                style={{ backgroundColor: '#f0fdf4' }}>✅</div>
              <p className="text-lg font-bold" style={{ color: '#1a1a1a' }}>
                {result?.imported} shop{result?.imported !== 1 ? 's' : ''} imported!
              </p>
              {result?.duplicates > 0 && (
                <p className="text-sm text-center" style={{ color: '#888' }}>
                  {result.duplicates} duplicate{result.duplicates !== 1 ? 's' : ''} were skipped
                </p>
              )}
              <p className="text-sm text-center" style={{ color: '#888' }}>
                All added to the <strong>Targets</strong> stage. Start working through them on your sales push.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4" style={{ borderTop: '1px solid #ebebeb' }}>
          {step === 'map' ? (
            <button onClick={() => setStep('upload')}
              className="text-sm px-4 py-2 rounded-xl font-medium"
              style={{ color: '#888', backgroundColor: '#f5f3f0' }}>
              ← Back
            </button>
          ) : <span />}

          <div className="flex gap-2">
            {step === 'done' ? (
              <button onClick={onClose}
                className="text-sm px-5 py-2 rounded-xl font-medium text-white"
                style={{ backgroundColor: ORANGE }}>
                Done
              </button>
            ) : step === 'map' ? (
              <button onClick={handleImport} disabled={importing || newShops.length === 0}
                className="text-sm px-5 py-2 rounded-xl font-medium text-white transition-opacity"
                style={{ backgroundColor: ORANGE, opacity: importing || newShops.length === 0 ? 0.5 : 1 }}>
                {importing ? 'Importing…' : `Import ${newShops.length} Shops`}
              </button>
            ) : (
              <button onClick={onClose}
                className="text-sm px-4 py-2 rounded-xl font-medium"
                style={{ color: '#888', backgroundColor: '#f5f3f0' }}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
