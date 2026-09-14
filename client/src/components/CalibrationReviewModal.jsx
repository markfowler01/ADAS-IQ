import { useState, useEffect, useRef } from 'react'
import { Panel, Chip, Eyebrow, PrimaryButton } from './ui/ReviewKit.jsx'
import ReadyChecks, { DEFAULT_CHECKS, readyChecksValid, readyChecksMissing, readyChecksToPatch, readyChecksNote } from './ReadyChecks.jsx'

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
export default function CalibrationReviewModal({ job, onConfirm, onClose, user = null }) {
  const [checks, setChecks] = useState({ ...DEFAULT_CHECKS })
  const checksOk = readyChecksValid(checks, job)
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
    if (!checksOk) return
    setSaving(true)
    const patch = readyChecksToPatch(checks, user?.techName || user?.name || user?.email || job.technician, job)
    const note = readyChecksNote(checks, job)
    if (note) patch.extra_services = note
    await onConfirm(cals, patch)
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
            <Eyebrow>🎯 Calibration review · before Ready to Invoice</Eyebrow>
            <h2 className="font-bold text-base" style={{ color: '#1a1a1a' }}>{job.shop_name || 'Job'}{(job.vehicle || job.make) ? ` · ${job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')}` : ''}</h2>
            <p className="text-xs" style={{ color: '#666' }}>Confirm what was actually calibrated — this is what gets billed.</p>
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
          <Panel tone="orange" title="🎯 Calibrations on this job" right={`${cals.length} line${cals.length === 1 ? '' : 's'}`} className="mb-3">
            {cals.length === 0 && <div className="px-3 py-3 text-sm" style={{ color: '#888' }}>No calibrations yet — add from below.</div>}
            {cals.map((c, i) => (
              <div key={i} className="flex items-center justify-between gap-2 px-3" style={{ borderTop: '1px solid #f1f5f9', minHeight: 40 }}>
                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>{c.name}</span>
                  {c.cal_type && <Chip>{c.cal_type}</Chip>}
                </div>
                <button onClick={() => removeCal(i)} className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }} aria-label={`Remove ${c.name}`}>×</button>
              </div>
            ))}
            <div className="px-3 py-2 flex gap-2 flex-wrap" style={{ borderTop: '1px solid #f1f5f9', backgroundColor: '#fafaf9' }}>
              <Chip tone="blue">PCSI · per shop rule</Chip><Chip tone="blue">Post-Scan · per shop rule</Chip><Chip tone="blue">Cal ID · per shop rule</Chip>
            </div>
          </Panel>

          {/* Quick Add — top 10 */}
          {!loading && topTen.length > 0 && (
            <>
              <Eyebrow style={{ marginBottom: 6 }}>Quick add · most common</Eyebrow>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {topTen.map(({ name }) => {
                  const already = calNames.has(name.toLowerCase())
                  return (
                    <button key={name} onClick={() => addCal(name)} disabled={already}
                      className="text-xs font-semibold rounded-full px-2.5 py-1.5"
                      style={{ backgroundColor: already ? '#f5f3f0' : 'white', color: already ? '#aaa' : '#15803d', border: `1.5px solid ${already ? '#e0dbd6' : '#bbf7d0'}` }}>
                      {already ? '✓ ' : '+ '}{name}
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
          <div className="mb-3"><ReadyChecks job={job} value={checks} onChange={setChecks} /></div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl py-3 text-sm font-semibold" style={{ backgroundColor: '#f5f3f0', color: '#555', border: '1px solid #e0dbd6' }}>Cancel</button>
            <PrimaryButton onClick={handleConfirm} disabled={saving || !checksOk} tone="green">
              {saving ? 'Saving…' : !checksOk ? `☐ ${readyChecksMissing(checks, job)[0]}` : '🟢 Done — Ready to Invoice'}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  )
}
