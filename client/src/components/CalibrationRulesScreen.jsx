import { useState, useEffect } from 'react'
import { apiFetch, API_BASE } from '../utils/api.js'
import Navbar from './Navbar'

const ORANGE = '#CD4419'

const CATEGORY_LABELS = {
  WINDSHIELD:      'Windshield / Glass',
  FRONT_BUMPER:    'Front Bumper / Grille',
  FRONT_SUSPENSION:'Front Suspension / Alignment',
  HEADLIGHTS:      'Headlights',
  REAR_BUMPER:     'Rear Bumper / Fascia',
  QUARTER_PANEL:   'Quarter Panel',
  MIRROR:          'Door Mirrors',
  REAR_CAMERA:     'Rear Camera',
  PARKING_SENSORS: 'Parking Sensors',
  SURROUND_VIEW:   'Surround View / 360',
  BATTERY:         'Battery Disconnect',
  AI_CONFIRMED:    'AI Confirmed (from Jobs)',
}

const SOURCE_COLORS = {
  UNIVERSAL:    { bg: '#eff6ff', text: '#1d4ed8', label: 'Universal' },
  AI_CONFIRMED: { bg: '#f0fdf4', text: '#15803d', label: 'AI Confirmed' },
  JOB_AID:      { bg: '#fdf4ff', text: '#7e22ce', label: 'Job Aid' },
  MANUAL:       { bg: '#fff7ed', text: '#c2410c', label: 'Manual' },
}

export default function CalibrationRulesScreen({ onBack, ...navProps }) {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [editingRule, setEditingRule] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)

  // Job Aid import state
  const [showImport, setShowImport] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importedRules, setImportedRules] = useState(null)
  const [selectedImport, setSelectedImport] = useState({})
  const [importSaving, setImportSaving] = useState(false)

  useEffect(() => { loadRules() }, [])

  async function loadRules() {
    setLoading(true)
    setError(null)
    try {
      const r = await apiFetch(`${API_BASE}/api/calibration-rules`)
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed to load rules')
      setRules(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const isNew = !editingRule.id
      const url = isNew
        ? `${API_BASE}/api/calibration-rules`
        : `${API_BASE}/api/calibration-rules/${editingRule.id}`
      const method = isNew ? 'POST' : 'PUT'
      const r = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingRule),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Save failed')
      setEditingRule(null)
      loadRules()
    } catch (e) {
      alert('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this rule?')) return
    setDeleting(id)
    try {
      const r = await apiFetch(`${API_BASE}/api/calibration-rules/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Delete failed')
      setRules(prev => prev.filter(r => r.id !== id))
    } catch (e) {
      alert('Delete failed: ' + e.message)
    } finally {
      setDeleting(null)
    }
  }

  function handleToggleEnabled(rule) {
    const updated = { ...rule, enabled: rule.enabled === 'true' ? 'false' : 'true' }
    apiFetch(`${API_BASE}/api/calibration-rules/${rule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).then(() => loadRules()).catch(e => alert('Update failed: ' + e.message))
  }

  const filtered = rules.filter(r => {
    const q = search.toLowerCase()
    if (q && !r.calibration_name.toLowerCase().includes(q) &&
        !r.trigger_keywords.toLowerCase().includes(q) &&
        !r.make.toLowerCase().includes(q) &&
        !r.model.toLowerCase().includes(q)) return false
    if (filterCategory && r.trigger_category !== filterCategory) return false
    if (filterSource && r.source !== filterSource) return false
    return true
  })

  async function handleImportUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') {
      alert('Please upload a PDF file. To import a webpage, use your browser\'s Print → Save as PDF first.')
      e.target.value = ''
      return
    }
    setImporting(true)
    setImportedRules(null)
    setSelectedImport({})
    try {
      const form = new FormData()
      form.append('pdf', file)
      const r = await apiFetch(`${API_BASE}/api/calibration-rules/import-job-aid`, { method: 'POST', body: form })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Import failed')
      setImportedRules(data.rules || [])
      // Pre-select all
      const sel = {}
      ;(data.rules || []).forEach((_, i) => { sel[i] = true })
      setSelectedImport(sel)
    } catch (e) {
      alert('Import failed: ' + (e.message || 'Unknown error — check that the file is a valid PDF'))
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  async function handleSaveImported() {
    const toSave = (importedRules || []).filter((_, i) => selectedImport[i])
    if (!toSave.length) return
    setImportSaving(true)
    try {
      for (const r of toSave) {
        await apiFetch(`${API_BASE}/api/calibration-rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...r, source: 'JOB_AID', enabled: 'true' }),
        })
      }
      setImportedRules(null)
      setSelectedImport({})
      setShowImport(false)
      loadRules()
    } catch (e) {
      alert('Save failed: ' + e.message)
    } finally {
      setImportSaving(false)
    }
  }

  const categories = [...new Set(rules.map(r => r.trigger_category))].filter(Boolean)
  const sources = [...new Set(rules.map(r => r.source))].filter(Boolean)

  const emptyRule = {
    make: '', model: '', year_start: '', year_end: '',
    trigger_category: 'WINDSHIELD', trigger_keywords: '',
    required_equipment: '', calibration_name: '', cal_type: 'Static',
    justification_template: '', source: 'UNIVERSAL', enabled: 'true', priority: '5', notes: '',
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar {...navProps} />

      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Calibration Rules</h1>
            <p className="text-sm text-gray-500 mt-0.5">{rules.length} rules in database — grows automatically as jobs are confirmed</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              style={{ backgroundColor: '#f5f3f0', color: ORANGE, border: `1px solid #e8d5ce` }}
            >
              Import Job Aid
            </button>
            <button
              onClick={() => setEditingRule({ ...emptyRule })}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
              style={{ backgroundColor: ORANGE }}
            >
              + Add Rule
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-5">
          <input
            type="text"
            placeholder="Search calibration, trigger, make..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
            style={{ borderColor: '#e5e7eb' }}
          />
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: '#e5e7eb' }}
          >
            <option value="">All Categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
            ))}
          </select>
          <select
            value={filterSource}
            onChange={e => setFilterSource(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: '#e5e7eb' }}
          >
            <option value="">All Sources</option>
            {sources.map(s => (
              <option key={s} value={s}>{SOURCE_COLORS[s]?.label || s}</option>
            ))}
          </select>
          {(search || filterCategory || filterSource) && (
            <button
              onClick={() => { setSearch(''); setFilterCategory(''); setFilterSource('') }}
              className="text-sm px-3 py-2 rounded-lg"
              style={{ color: ORANGE }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl p-4 mb-4 text-sm" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-16 text-gray-400">Loading rules…</div>
        )}

        {/* Rules list */}
        {!loading && (
          <div className="space-y-2">
            {filtered.length === 0 && (
              <div className="text-center py-16 text-gray-400">No rules match your search.</div>
            )}
            {filtered.map(rule => {
              const isExpanded = expandedId === rule.id
              const srcStyle = SOURCE_COLORS[rule.source] || { bg: '#f5f3f0', text: '#6b7280', label: rule.source }
              const isEnabled = rule.enabled === 'true'

              return (
                <div
                  key={rule.id}
                  className="rounded-xl overflow-hidden"
                  style={{ backgroundColor: 'white', border: '1px solid #ebebeb', opacity: isEnabled ? 1 : 0.55 }}
                >
                  {/* Row */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : rule.id)}
                  >
                    {/* Toggle enabled */}
                    <button
                      onClick={e => { e.stopPropagation(); handleToggleEnabled(rule) }}
                      className="flex-shrink-0 w-8 h-5 rounded-full transition-colors relative"
                      style={{ backgroundColor: isEnabled ? ORANGE : '#d1d5db' }}
                      title={isEnabled ? 'Disable rule' : 'Enable rule'}
                    >
                      <span
                        className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                        style={{ transform: isEnabled ? 'translateX(14px)' : 'translateX(2px)' }}
                      />
                    </button>

                    {/* Name + badges */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm" style={{ color: '#1a1a1a' }}>
                          {rule.calibration_name}
                        </span>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: srcStyle.bg, color: srcStyle.text }}
                        >
                          {srcStyle.label}
                        </span>
                        {rule.cal_type && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ backgroundColor: '#f5f3f0', color: '#6b7280' }}>
                            {rule.cal_type}
                          </span>
                        )}
                        {(rule.make || rule.model) && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ backgroundColor: '#fff7ed', color: '#c2410c' }}>
                            {[rule.make, rule.model, rule.year_start && `${rule.year_start}–${rule.year_end || 'present'}`].filter(Boolean).join(' ')}
                          </span>
                        )}
                        {!rule.make && !rule.model && (
                          <span className="text-xs text-gray-400">All vehicles</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">
                        {CATEGORY_LABELS[rule.trigger_category] || rule.trigger_category}
                        {rule.trigger_keywords && ` · ${rule.trigger_keywords.split(',').slice(0,3).join(', ')}`}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={e => { e.stopPropagation(); setEditingRule({ ...rule }) }}
                        className="w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                        title="Edit"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(rule.id) }}
                        disabled={deleting === rule.id}
                        className="w-7 h-7 rounded flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <span className="text-gray-300 ml-1">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <path d={isExpanded ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </span>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t" style={{ borderColor: '#f3f4f6' }}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Trigger Keywords</p>
                          <p className="text-sm text-gray-700">{rule.trigger_keywords || '—'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Required Equipment</p>
                          <p className="text-sm text-gray-700">{rule.required_equipment || 'Any / All vehicles'}</p>
                        </div>
                        <div className="md:col-span-2">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Justification Template</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{rule.justification_template || '—'}</p>
                        </div>
                        {rule.notes && (
                          <div className="md:col-span-2">
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Notes</p>
                            <p className="text-sm text-gray-500">{rule.notes}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Import Job Aid Modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: '#ebebeb' }}>
              <div>
                <h2 className="font-bold text-lg">Import Job Aid</h2>
                <p className="text-xs text-gray-400 mt-0.5">Upload any OEM position statement, I-CAR guide, or calibration reference PDF</p>
              </div>
              <button onClick={() => { setShowImport(false); setImportedRules(null) }} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="px-6 py-6">
              {/* Upload zone */}
              {!importedRules && (
                <label className="block cursor-pointer">
                  <div
                    className="border-2 border-dashed rounded-xl p-10 text-center transition-colors"
                    style={{ borderColor: importing ? ORANGE : '#e5e7eb', backgroundColor: importing ? '#fff7f5' : '#fafafa' }}
                  >
                    {importing ? (
                      <div>
                        <div className="text-2xl mb-2">⚙️</div>
                        <p className="font-semibold text-sm" style={{ color: ORANGE }}>Reading document and extracting rules…</p>
                        <p className="text-xs text-gray-400 mt-1">This may take 15–30 seconds</p>
                      </div>
                    ) : (
                      <div>
                        <div className="text-3xl mb-2">📄</div>
                        <p className="font-semibold text-sm text-gray-700">Drop a PDF here or click to browse</p>
                        <p className="text-xs text-gray-400 mt-1">OEM position statements, I-CAR guides, calibration procedures, service bulletins</p>
                      </div>
                    )}
                  </div>
                  <input type="file" accept="application/pdf" className="hidden" onChange={handleImportUpload} disabled={importing} />
                </label>
              )}

              {/* Extracted rules preview */}
              {importedRules && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-semibold text-sm text-gray-700">
                      Found <span style={{ color: ORANGE }}>{importedRules.length}</span> rules — select which to save:
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { const s = {}; importedRules.forEach((_, i) => { s[i] = true }); setSelectedImport(s) }}
                        className="text-xs px-2 py-1 rounded text-gray-500 hover:text-gray-700"
                      >Select all</button>
                      <button
                        onClick={() => setSelectedImport({})}
                        className="text-xs px-2 py-1 rounded text-gray-500 hover:text-gray-700"
                      >None</button>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {importedRules.map((rule, i) => (
                      <label key={i} className="flex items-start gap-3 p-3 rounded-xl cursor-pointer hover:bg-gray-50 border"
                        style={{ borderColor: selectedImport[i] ? ORANGE : '#e5e7eb', backgroundColor: selectedImport[i] ? '#fff7f5' : 'white' }}>
                        <input
                          type="checkbox"
                          checked={!!selectedImport[i]}
                          onChange={e => setSelectedImport(p => ({ ...p, [i]: e.target.checked }))}
                          className="mt-0.5 flex-shrink-0"
                          style={{ accentColor: ORANGE }}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>{rule.calibration_name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {CATEGORY_LABELS[rule.trigger_category] || rule.trigger_category}
                            {rule.cal_type && ` · ${rule.cal_type}`}
                            {(rule.make || rule.model) && ` · ${[rule.make, rule.model].filter(Boolean).join(' ')}`}
                          </p>
                          {rule.trigger_keywords && (
                            <p className="text-xs text-gray-400 mt-0.5">Triggers: {rule.trigger_keywords}</p>
                          )}
                          {rule.notes && (
                            <p className="text-xs italic text-gray-400 mt-0.5">{rule.notes}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>

                  {/* Upload another */}
                  <label className="block mt-3 cursor-pointer">
                    <span className="text-xs text-gray-400 hover:text-gray-600 underline">Upload a different PDF</span>
                    <input type="file" accept="application/pdf" className="hidden" onChange={handleImportUpload} disabled={importing} />
                  </label>
                </div>
              )}
            </div>

            {importedRules && (
              <div className="px-6 py-4 border-t flex justify-between items-center" style={{ borderColor: '#ebebeb' }}>
                <span className="text-sm text-gray-400">{Object.values(selectedImport).filter(Boolean).length} selected</span>
                <div className="flex gap-3">
                  <button onClick={() => { setShowImport(false); setImportedRules(null) }} className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100">
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveImported}
                    disabled={importSaving || !Object.values(selectedImport).some(Boolean)}
                    className="px-5 py-2 text-sm rounded-lg font-semibold text-white"
                    style={{ backgroundColor: ORANGE, opacity: importSaving ? 0.6 : 1 }}
                  >
                    {importSaving ? 'Saving…' : `Save ${Object.values(selectedImport).filter(Boolean).length} Rules`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit / Add Modal */}
      {editingRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: '#ebebeb' }}>
              <h2 className="font-bold text-lg">{editingRule.id ? 'Edit Rule' : 'Add Rule'}</h2>
              <button onClick={() => setEditingRule(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* Vehicle scope */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase">Make (blank = all)</span>
                  <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}
                    value={editingRule.make} onChange={e => setEditingRule(p => ({ ...p, make: e.target.value }))} />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase">Model (blank = all)</span>
                  <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}
                    value={editingRule.model} onChange={e => setEditingRule(p => ({ ...p, model: e.target.value }))} />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase">Year Start</span>
                  <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}
                    value={editingRule.year_start} onChange={e => setEditingRule(p => ({ ...p, year_start: e.target.value }))} placeholder="e.g. 2018" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase">Year End</span>
                  <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}
                    value={editingRule.year_end} onChange={e => setEditingRule(p => ({ ...p, year_end: e.target.value }))} placeholder="e.g. 2023" />
                </label>
              </div>

              {/* Category + Cal type */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase">Category</span>
                  <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}
                    value={editingRule.trigger_category} onChange={e => setEditingRule(p => ({ ...p, trigger_category: e.target.value }))}>
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase">Cal Type</span>
                  <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}
                    value={editingRule.cal_type} onChange={e => setEditingRule(p => ({ ...p, cal_type: e.target.value }))}>
                    <option value="Static">Static</option>
                    <option value="Dynamic">Dynamic</option>
                    <option value="Static/Dynamic">Static/Dynamic</option>
                  </select>
                </label>
              </div>

              {/* Calibration name */}
              <label className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase">Calibration Name</span>
                <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}
                  value={editingRule.calibration_name} onChange={e => setEditingRule(p => ({ ...p, calibration_name: e.target.value }))} />
              </label>

              {/* Trigger keywords */}
              <label className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase">Trigger Keywords (comma separated)</span>
                <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}
                  value={editingRule.trigger_keywords} onChange={e => setEditingRule(p => ({ ...p, trigger_keywords: e.target.value }))}
                  placeholder="e.g. windshield,front glass,w/s replace" />
              </label>

              {/* Required equipment */}
              <label className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase">Required Equipment (comma separated, blank = all vehicles)</span>
                <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}
                  value={editingRule.required_equipment} onChange={e => setEditingRule(p => ({ ...p, required_equipment: e.target.value }))}
                  placeholder="e.g. Forward Camera,LDW,PCS" />
              </label>

              {/* Justification template */}
              <label className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase">Justification Template (use &#123;make&#125; and &#123;model&#125;)</span>
                <textarea className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" rows={4} style={{ borderColor: '#e5e7eb' }}
                  value={editingRule.justification_template} onChange={e => setEditingRule(p => ({ ...p, justification_template: e.target.value }))} />
              </label>

              {/* Notes */}
              <label className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase">Notes</span>
                <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}
                  value={editingRule.notes} onChange={e => setEditingRule(p => ({ ...p, notes: e.target.value }))} />
              </label>

              {/* Source + Priority */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase">Source</span>
                  <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}
                    value={editingRule.source} onChange={e => setEditingRule(p => ({ ...p, source: e.target.value }))}>
                    <option value="UNIVERSAL">Universal</option>
                    <option value="AI_CONFIRMED">AI Confirmed</option>
                    <option value="MANUAL">Manual</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase">Priority (1–10)</span>
                  <input type="number" min="1" max="10"
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}
                    value={editingRule.priority} onChange={e => setEditingRule(p => ({ ...p, priority: e.target.value }))} />
                </label>
              </div>
            </div>

            <div className="px-6 py-4 border-t flex justify-end gap-3" style={{ borderColor: '#ebebeb' }}>
              <button onClick={() => setEditingRule(null)} className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editingRule.calibration_name}
                className="px-5 py-2 text-sm rounded-lg font-semibold text-white transition-colors"
                style={{ backgroundColor: ORANGE, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : 'Save Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
