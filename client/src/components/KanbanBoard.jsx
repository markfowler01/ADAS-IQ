import { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import Navbar from './Navbar'
import CreateInvoicesModal from './CreateInvoicesModal.jsx'
import JobRequestModal from './JobRequestModal.jsx'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

const ORANGE = '#CD4419'

const COLUMNS = [
  { id: 'job_requested',    label: 'Job Requested' },
  { id: 'need_dispatch',    label: 'Need to Dispatch' },
  { id: 'dispatched_jaden', label: 'Dispatched to Jaden' },
  { id: 'dispatched_mark',  label: 'Dispatched to Mark' },
  { id: 'pending_parts',    label: 'Pending / Waiting on Parts' },
  { id: 'ready_invoice',    label: 'Ready to Invoice' },
  { id: 'complete',         label: 'Completed' },
]

// Status badge colors for mobile card list
const STATUS_INFO = {
  job_requested:    { color: '#0369a1', bg: '#e0f2fe' },
  need_dispatch:    { color: '#b45309', bg: '#fef3c7' },
  dispatched_jaden: { color: '#1d4ed8', bg: '#dbeafe' },
  dispatched_mark:  { color: '#7c3aed', bg: '#ede9fe' },
  pending_parts:    { color: '#c2410c', bg: '#fff7ed' },
  ready_invoice:    { color: '#0e7490', bg: '#cffafe' },
  complete:         { color: '#15803d', bg: '#dcfce7' },
}

const CALIBRATION_TYPES = [
  'Front Radar',
  'Front Camera',
  'Rear Camera',
  'Blind Spot / Rear Radar',
  'Lane Keep / Side Camera',
  'Cross Traffic',
  '360 / Surround View',
  'Parking Sensors',
  'Night Vision',
  'Head-Up Display',
  'Adaptive Headlights',
]

const EMPTY_JOB = {
  shop_name: '',
  ro_number: '',
  year: '',
  make: '',
  model: '',
  vin: '',
  insurer: '',
  technician: '',
  region: '',
  scheduled_date: '',
  calibrations: [],
  notes: '',
  report_url: '',
  status: 'need_dispatch',
  invoiced: false,
}

function jobToForm(job) {
  let calArr = []
  if (job.calibrations) {
    if (typeof job.calibrations === 'string') {
      try {
        const parsed = JSON.parse(job.calibrations)
        calArr = Array.isArray(parsed) ? parsed : []
      } catch { calArr = [] }
    } else if (Array.isArray(job.calibrations)) {
      calArr = job.calibrations
    }
  }

  // vehicle field may be "year make model" combined or separate
  let year = job.year || ''
  let make = job.make || ''
  let model = job.model || ''
  if (!year && !make && !model && job.vehicle) {
    const parts = job.vehicle.split(' ')
    year = parts[0] || ''
    make = parts[1] || ''
    model = parts.slice(2).join(' ') || ''
  }

  return {
    shop_name: job.shop_name || '',
    ro_number: job.ro_number || '',
    year,
    make,
    model,
    vin: job.vin || '',
    insurer: job.insurer || '',
    technician: job.technician || '',
    region: job.region || '',
    scheduled_date: job.scheduled_date || '',
    calibrations: calArr,
    notes: job.notes || '',
    report_url: job.report_url || '',
    status: job.status || 'need_dispatch',
    invoiced: job.invoiced || false,
  }
}

function formToJobData(form) {
  return {
    shop_name: form.shop_name,
    ro_number: form.ro_number || '',
    vehicle: [form.year, form.make, form.model].filter(Boolean).join(' '),
    year: form.year,
    make: form.make,
    model: form.model,
    vin: form.vin,
    insurer: form.insurer,
    technician: form.technician,
    region: form.region || '',
    scheduled_date: form.scheduled_date,
    calibrations: JSON.stringify(form.calibrations),
    notes: form.notes,
    report_url: form.report_url,
    status: form.status,
    invoiced: form.invoiced || false,
  }
}

// Full job → API payload without lossy form round-trip
function jobToPayload(job) {
  return {
    shop_name:        job.shop_name        || '',
    ro_number:        job.ro_number        || '',
    vehicle:          job.vehicle          || [job.year, job.make, job.model].filter(Boolean).join(' '),
    year:             job.year             || '',
    make:             job.make             || '',
    model:            job.model            || '',
    vin:              job.vin              || '',
    insurer:          job.insurer          || '',
    technician:       job.technician       || '',
    region:           job.region           || '',
    scheduled_date:   job.scheduled_date   || '',
    calibrations:     typeof job.calibrations === 'string' ? job.calibrations : JSON.stringify(job.calibrations || []),
    notes:            job.notes            || '',
    report_url:       job.report_url       || '',
    status:           job.status           || 'need_dispatch',
    invoiced:         job.invoiced         || false,
    zoho_estimate_id: job.zoho_estimate_id || '',
    quote_number:     job.quote_number     || '',
    quote_url:        job.quote_url        || '',
    folder_url:       job.folder_url       || '',
    invoice_number:   job.invoice_number   || '',
    invoice_status:   job.invoice_status   || '',
    created_at:       job.created_at       || '',
  }
}

async function triggerConfetti() {
  try {
    const confetti = (await import('https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.module.mjs')).default
    const end = Date.now() + 2500
    const colors = [ORANGE, '#f5a623', '#fff', '#1a1a1a', '#e8c5b0']
    ;(function frame() {
      confetti({
        particleCount: 6,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors,
      })
      confetti({
        particleCount: 6,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors,
      })
      if (Date.now() < end) requestAnimationFrame(frame)
    })()
  } catch (e) {
    console.warn('Confetti failed:', e)
  }
}

// ─── Job Modal ────────────────────────────────────────────────────────────────
const DISPATCH_TECH = { dispatched_jaden: 'Jaden', dispatched_mark: 'Mark' }

function JobModal({ job, onClose, onSave, onDelete, allJobs }) {
  const isNew = !job.id
  const [form, setForm] = useState(() => {
    if (isNew) {
      const defaultStatus = job.defaultStatus || 'need_dispatch'
      return { ...EMPTY_JOB, status: defaultStatus, technician: DISPATCH_TECH[defaultStatus] || '' }
    }
    return jobToForm(job)
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)

  function setField(key, val) {
    if (key === 'status') {
      const autoTech = DISPATCH_TECH[val]
      if (autoTech && !form.technician) {
        setForm(f => ({ ...f, status: val, technician: autoTech }))
        return
      }
    }
    setForm(f => ({ ...f, [key]: val }))
  }

  function toggleCalibration(name) {
    setForm(f => {
      const exists = f.calibrations.find(c => c.name === name)
      if (exists) {
        return { ...f, calibrations: f.calibrations.filter(c => c.name !== name) }
      } else {
        return { ...f, calibrations: [...f.calibrations, { name, mode: 'Static' }] }
      }
    })
  }

  function setCalMode(name, mode) {
    setForm(f => ({
      ...f,
      calibrations: f.calibrations.map(c => c.name === name ? { ...c, mode } : c),
    }))
  }

  async function handleSave() {
    if (!form.shop_name.trim()) {
      setError('Shop name is required.')
      return
    }
    if (!form.year.trim() && !form.make.trim() && !form.model.trim()) {
      setError('At least one of Year, Make, or Model is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(form, job)
      onClose()
    } catch (e) {
      setError(e.message || 'Save failed')
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this job?')) return
    setDeleting(true)
    setError(null)
    try {
      await onDelete(job)
      onClose()
    } catch (e) {
      setError(e.message || 'Delete failed')
      setDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        style={{ border: '1px solid #ebebeb' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #ebebeb' }}>
          <h2 className="text-base font-bold" style={{ color: '#1a1a1a' }}>
            {isNew ? 'New Job' : 'Edit Job'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">

          {/* Shop name + RO# */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Shop Name</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#ddd' }}
                value={form.shop_name}
                onChange={e => setField('shop_name', e.target.value)}
                placeholder="e.g. Smith Auto Body"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
                RO # <span className="text-gray-300 font-normal">(Repair Order)</span>
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none"
                style={{ borderColor: '#ddd' }}
                value={form.ro_number}
                onChange={e => setField('ro_number', e.target.value)}
                placeholder="e.g. 12345"
              />
            </div>
          </div>

          {/* Vehicle */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Vehicle</label>
            <div className="flex gap-2">
              <input
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none w-24"
                style={{ borderColor: '#ddd' }}
                value={form.year}
                onChange={e => setField('year', e.target.value)}
                placeholder="Year"
              />
              <input
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none flex-1"
                style={{ borderColor: '#ddd' }}
                value={form.make}
                onChange={e => setField('make', e.target.value)}
                placeholder="Make"
              />
              <input
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none flex-1"
                style={{ borderColor: '#ddd' }}
                value={form.model}
                onChange={e => setField('model', e.target.value)}
                placeholder="Model"
              />
            </div>
          </div>

          {/* VIN */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">VIN <span className="text-gray-300 font-normal">(optional)</span></label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none"
              style={{ borderColor: '#ddd' }}
              value={form.vin}
              onChange={e => setField('vin', e.target.value)}
              placeholder="17-character VIN"
            />
          </div>

          {/* Insurer */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Insurance Company <span className="text-gray-300 font-normal">(optional)</span></label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#ddd' }}
              value={form.insurer}
              onChange={e => setField('insurer', e.target.value)}
              placeholder="e.g. State Farm"
            />
          </div>

          {/* Technician */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Technician</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#ddd' }}
              value={form.technician}
              onChange={e => setField('technician', e.target.value)}
              placeholder="Tech name"
            />
          </div>

          {/* Region */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Region <span className="text-gray-300 font-normal">(optional)</span></label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#ddd' }}
              value={form.region}
              onChange={e => setField('region', e.target.value)}
              placeholder="e.g. North, South, Atlanta"
            />
          </div>

          {/* Scheduled date */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Scheduled Date & Time</label>
            <input
              type="datetime-local"
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#ddd' }}
              value={form.scheduled_date}
              onChange={e => setField('scheduled_date', e.target.value)}
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Status</label>
            <select
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#ddd' }}
              value={form.status}
              onChange={e => setField('status', e.target.value)}
            >
              {COLUMNS.map(col => (
                <option key={col.id} value={col.id}>{col.label}</option>
              ))}
            </select>
          </div>

          {/* Calibrations */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Calibrations</label>
            <div className="space-y-2">
              {CALIBRATION_TYPES.map(name => {
                const checked = form.calibrations.find(c => c.name === name)
                return (
                  <div key={name} className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={!!checked}
                        onChange={() => toggleCalibration(name)}
                        className="rounded"
                        style={{ accentColor: ORANGE }}
                      />
                      <span className="text-sm text-gray-700">{name}</span>
                    </label>
                    {checked && (
                      <div className="flex rounded-lg overflow-hidden border text-xs" style={{ borderColor: '#ddd' }}>
                        {['Static', 'Dynamic'].map(mode => (
                          <button
                            key={mode}
                            onClick={() => setCalMode(name, mode)}
                            className="px-2 py-1 font-medium transition-colors"
                            style={{
                              backgroundColor: checked.mode === mode ? ORANGE : '#f5f3f0',
                              color: checked.mode === mode ? 'white' : '#555',
                            }}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Notes</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
              style={{ borderColor: '#ddd' }}
              rows={3}
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
              placeholder="Any notes about this job..."
            />
          </div>

          {/* Report URL */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Report URL</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#ddd' }}
              value={form.report_url}
              onChange={e => setField('report_url', e.target.value)}
              placeholder="https://..."
            />
          </div>

          {error && (
            <div className="px-4 py-3 rounded-xl text-sm" style={{ backgroundColor: '#fff0ed', color: ORANGE, border: `1px solid #e8c5b0` }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: '1px solid #ebebeb' }}>
          <div>
            {!isNew && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-sm px-4 py-2 rounded-lg font-medium text-red-500 hover:bg-red-50 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-sm px-4 py-2 rounded-lg font-medium"
              style={{ color: '#555', backgroundColor: '#f5f3f0' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm px-4 py-2 rounded-lg font-medium text-white transition-opacity"
              style={{ backgroundColor: ORANGE, opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving…' : (isNew ? 'Create Job' : 'Save Changes')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Kanban Card ──────────────────────────────────────────────────────────────
function KanbanCard({ job, onEdit, onDragStart, onComplete, onToggleInvoiced, onDelete, onOpenWorkDrive, onRefreshShareLink, onCreateInvoices }) {
  const [finding, setFinding] = useState(false)

  async function handleOpenWorkDrive(e) {
    e.stopPropagation()
    // Already a public link — open immediately
    if (job.folder_url && job.folder_url.includes('zohoexternal.com')) {
      window.open(job.folder_url, '_blank', 'noopener,noreferrer')
      return
    }
    setFinding(true)
    if (job.folder_url) {
      // Internal Zoho URL — silently convert to public share link, then open
      await onRefreshShareLink(job)
    } else {
      // No URL yet — find/create the folder
      await onOpenWorkDrive(job)
    }
    setFinding(false)
  }
  let calArr = []
  if (job.calibrations) {
    if (typeof job.calibrations === 'string') {
      try {
        const parsed = JSON.parse(job.calibrations)
        calArr = Array.isArray(parsed) ? parsed : []
      } catch { calArr = [] }
    } else if (Array.isArray(job.calibrations)) {
      calArr = job.calibrations
    }
  }

  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  const isComplete = job.status === 'complete'

  const dateStr = job.scheduled_date
    ? (() => {
        try {
          const d = new Date(job.scheduled_date)
          if (isNaN(d)) return job.scheduled_date
          const hasTime = job.scheduled_date.includes('T') && !job.scheduled_date.endsWith('T00:00')
          return hasTime
            ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
            : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        } catch { return job.scheduled_date }
      })()
    : null

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, job)}
      onClick={() => onEdit(job)}
      className="bg-white rounded-xl shadow-sm p-3 cursor-pointer select-none transition-shadow hover:shadow-md active:opacity-75"
      style={{ border: `1px solid ${isComplete ? '#d4edda' : '#ebebeb'}`, backgroundColor: isComplete ? '#f8fff9' : 'white' }}
    >
      {/* Top row: shop name + complete toggle */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          {job.shop_name && (
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: ORANGE }}>
              {job.shop_name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Delete button */}
          <button
            onClick={(e) => { e.stopPropagation(); if (window.confirm('Delete this job?')) onDelete(job) }}
            title="Delete job"
            className="w-6 h-6 rounded flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {/* Complete toggle button */}
          <button
            onClick={(e) => { e.stopPropagation(); onComplete(job) }}
            title={isComplete ? 'Mark as Scheduled' : 'Mark Complete'}
            className="flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all hover:scale-110"
            style={{
              borderColor: isComplete ? '#28a745' : '#ccc',
              backgroundColor: isComplete ? '#28a745' : 'transparent',
            }}
          >
            {isComplete && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Year / Make / Model */}
      {vehicle && (
        <p className="text-sm font-semibold text-gray-800 leading-snug mb-0.5">{vehicle}</p>
      )}

      {/* VIN */}
      {job.vin && (
        <p className="text-xs mb-1 font-mono" style={{ color: '#888' }}>
          VIN: {job.vin}
        </p>
      )}

      {/* RO # */}
      {job.ro_number && (
        <p className="text-xs font-bold mb-1 font-mono" style={{ color: '#1a1a1a' }}>
          <span className="font-normal" style={{ color: '#999' }}>RO# </span>{job.ro_number}
        </p>
      )}

      {/* Job number (Zoho) */}
      {(job.invoice_number || job.quote_number) && (
        <p className="text-xs font-medium mb-1" style={{ color: '#6b7280' }}>
          <span style={{ color: '#999', fontWeight: 400 }}>Job: </span>
          {job.invoice_number || job.quote_number}
        </p>
      )}

      {/* Insurer */}
      {job.insurer && (
        <p className="text-xs font-medium mb-1 truncate" style={{ color: '#2563eb' }}>
          <span style={{ color: '#999', fontWeight: 400 }}>Insurer: </span>{job.insurer}
        </p>
      )}

      {/* Technician */}
      {job.technician && (
        <div className="flex items-center gap-1 mb-2">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
            <circle cx="12" cy="8" r="4" stroke="#999" strokeWidth="2"/>
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#999" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <p className="text-xs text-gray-500 font-medium">{job.technician}</p>
        </div>
      )}

      {/* Calibrations chips + fixed PCSI & POST */}
      <div className="flex flex-wrap gap-1 mb-2">
        {calArr.map((c, i) => {
          const label = c.name || c.type || ''
          const modeLabel = c.mode && c.mode.toLowerCase() !== 'static' ? ` (${c.mode})` : ''
          if (!label) return null
          return (
            <span
              key={i}
              className="text-xs px-1.5 py-0.5 rounded-md font-medium"
              style={{ backgroundColor: '#fdf3ef', color: ORANGE }}
            >
              {label}{modeLabel}
            </span>
          )
        })}
        <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}>PCSI</span>
        <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}>POST</span>
      </div>


      {/* Footer row */}
      <div className="flex items-center justify-between mt-1 mb-2">
        {dateStr ? (
          <span className="text-xs text-gray-400">{dateStr}</span>
        ) : <span />}
        <div className="flex items-center gap-2">
          {/* Invoiced badge/button */}
          <button
            onClick={e => { e.stopPropagation(); onToggleInvoiced(job) }}
            title={job.invoiced ? 'Mark as not invoiced' : 'Mark as invoiced'}
            className="text-xs font-semibold px-2 py-0.5 rounded-full border transition-all"
            style={job.invoiced
              ? { backgroundColor: '#e6f4ea', color: '#1e8a3c', borderColor: '#a8d5b5' }
              : { backgroundColor: 'transparent', color: '#aaa', borderColor: '#ddd' }
            }
          >
            {job.invoiced ? '✓ Invoiced' : 'Invoice'}
          </button>
          <UploadButton job={job} />
        </div>
      </div>

      {/* WorkDrive button — full-width iOS-style */}
      <button
        onClick={e => { e.stopPropagation(); handleOpenWorkDrive(e) }}
        disabled={finding}
        className="w-full flex items-center justify-center gap-2 rounded-xl transition-all"
        style={{
          backgroundColor: finding ? '#f5f5f7' : '#fff4f0',
          border: `1.5px solid ${finding ? '#e8e8ed' : '#f5cfc3'}`,
          padding: '10px 0',
          minHeight: '44px',
          opacity: finding ? 0.6 : 1,
        }}
      >
        {finding ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ animation: 'spin 1s linear infinite' }}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        )}
        <span className="text-sm font-semibold" style={{ color: finding ? '#aaa' : ORANGE }}>
          {finding
            ? (job.folder_url && !job.folder_url.includes('zohoexternal.com') ? 'Getting public link…' : 'Finding folder…')
            : 'Open in WorkDrive'}
        </span>
      </button>

      {/* Create Invoices button — only on ready_invoice or complete */}
      {job.invoiced ? (
        <div className="w-full flex items-center justify-center gap-2 rounded-xl mt-2"
          style={{ backgroundColor: '#f0fdf4', border: '1.5px solid #bbf7d0', padding: '10px 0', minHeight: '44px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="text-sm font-semibold" style={{ color: '#16a34a' }}>Invoiced</span>
        </div>
      ) : (job.status === 'ready_invoice' || job.status === 'complete') ? (
        <button
          onClick={e => { e.stopPropagation(); onCreateInvoices && onCreateInvoices(job) }}
          className="w-full flex items-center justify-center gap-2 rounded-xl transition-all mt-2"
          style={{ backgroundColor: '#f0fdf4', border: '1.5px solid #bbf7d0', padding: '10px 0', minHeight: '44px' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="14 2 14 8 20 8" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="text-sm font-semibold" style={{ color: '#16a34a' }}>Create Invoices</span>
        </button>
      ) : (
        <div className="w-full flex items-center justify-center gap-2 rounded-xl mt-2"
          style={{ backgroundColor: '#fafafa', border: '1.5px solid #e5e7eb', padding: '10px 0', minHeight: '44px', opacity: 0.5 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke="#aaa" strokeWidth="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#aaa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="text-xs font-medium text-gray-400">Move to Ready to Invoice first</span>
        </div>
      )}
    </div>
  )
}

// ─── Kanban Column ────────────────────────────────────────────────────────────
function KanbanColumn({ column, jobs, onEdit, onNewJob, onDragStart, onDragOver, onDrop, onComplete, onToggleInvoiced, onDelete, onOpenWorkDrive, onRefreshShareLink, onCreateInvoices, dragOverCol }) {
  const isOver = dragOverCol === column.id

  return (
    <div
      className="flex flex-col flex-shrink-0"
      style={{ width: '280px' }}
      onDragOver={(e) => onDragOver(e, column.id)}
      onDrop={(e) => onDrop(e, column.id)}
    >
      {/* Column header */}
      <div
        className="rounded-xl px-3 py-2.5 mb-3 flex items-center justify-between"
        style={{ backgroundColor: ORANGE }}
      >
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-bold">{column.label}</span>
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(255,255,255,0.25)', color: 'white' }}
          >
            {jobs.length}
          </span>
        </div>
        <button
          onClick={() => onNewJob(column.id)}
          className="w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-lg leading-none transition-opacity hover:opacity-80"
          style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
          title="New Job"
        >
          +
        </button>
      </div>

      {/* "Request Job" button pinned at top of the Job Requested column */}
      {column.id === 'job_requested' && (
        <button
          onClick={() => onNewJob(column.id)}
          className="w-full mb-2 py-3 rounded-xl font-bold text-white text-sm tracking-wide transition-opacity hover:opacity-90 active:opacity-80"
          style={{ backgroundColor: '#CD4419' }}
        >
          + Request Job
        </button>
      )}

      {/* Cards drop zone */}
      <div
        className="flex-1 rounded-xl p-2 space-y-2 transition-colors min-h-32"
        style={{
          backgroundColor: isOver ? '#fdf3ef' : '#f9f8f7',
          border: isOver ? `2px dashed ${ORANGE}` : '2px dashed transparent',
        }}
      >
        {jobs.map(job => (
          <KanbanCard
            key={job.id}
            job={job}
            onEdit={onEdit}
            onDragStart={onDragStart}
            onComplete={onComplete}
            onToggleInvoiced={onToggleInvoiced}
            onDelete={onDelete}
            onOpenWorkDrive={onOpenWorkDrive}
            onRefreshShareLink={onRefreshShareLink}
            onCreateInvoices={onCreateInvoices}
          />
        ))}
        {jobs.length === 0 && !isOver && (
          <div className="flex items-center justify-center h-20">
            <span className="text-xs text-gray-300 font-medium">No jobs</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Kanban Board ─────────────────────────────────────────────────────────
export default function KanbanBoard({ user, onBack, onLogout, currentScreen, onNavigate, onExtracted }) {
  const isMobile = useIsMobile()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalJob, setModalJob] = useState(null) // null = closed, {} = new, job = edit
  const [dragJob, setDragJob] = useState(null)
  const [dragOverCol, setDragOverCol] = useState(null)
  const [toast, setToast] = useState(null)
  const [invoicingJob, setInvoicingJob] = useState(null)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [techFilter, setTechFilter] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [completions, setCompletions] = useState([])
  const [getSome, setGetSome] = useState(false)
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadInputRef = useRef(null)

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  const fetchJobs = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/jobs`)
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json()
      setJobs(Array.isArray(data) ? data : [])
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  useEffect(() => {
    apiFetch(`${API_BASE}/api/jobs/completions`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setCompletions(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  // Save (create or update)
  async function handleSave(form, originalJob) {
    const basePayload = formToJobData(form)
    // Preserve Zoho/system fields that aren't editable in the form
    const payload = originalJob.id ? {
      ...basePayload,
      zoho_estimate_id: originalJob.zoho_estimate_id || '',
      quote_number:     originalJob.quote_number     || '',
      quote_url:        originalJob.quote_url        || '',
      folder_url:       originalJob.folder_url       || '',
      invoice_number:   originalJob.invoice_number   || '',
      invoice_status:   originalJob.invoice_status   || '',
      created_at:       originalJob.created_at       || '',
    } : basePayload
    if (originalJob.id) {
      // update
      const res = await apiFetch(`${API_BASE}/api/jobs/${originalJob.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Save failed (${res.status})`)
      }

      // Confetti if moved to complete
      if (payload.status === 'complete' && originalJob.status !== 'complete') {
        checkConfetti(payload.technician, jobs, originalJob.id)
      }
    } else {
      // create
      const res = await apiFetch(`${API_BASE}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Create failed (${res.status})`)
      }
    }
    await fetchJobs()
  }

  // Delete
  async function handleDelete(job) {
    const res = await apiFetch(`${API_BASE}/api/jobs/${job.id}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Delete failed (${res.status})`)
    }
    await fetchJobs()
  }

  function checkConfetti(techName, currentJobs, updatedRowId) {
    // Count completions — by technician if assigned, otherwise count all completions
    const completed = currentJobs.filter(j =>
      j.status === 'complete' &&
      j.id !== updatedRowId &&
      (techName ? j.technician === techName : true)
    ).length + 1 // +1 for this new one

    if (completed > 0 && completed % 4 === 0) {
      triggerConfetti()
    }
  }

  // Drag & drop
  function onDragStart(e, job) {
    setDragJob(job)
    e.dataTransfer.effectAllowed = 'move'
  }

  function onDragOver(e, colId) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverCol(colId)
  }

  async function onDrop(e, colId) {
    e.preventDefault()
    setDragOverCol(null)
    if (!dragJob) return
    if (dragJob.status === colId) { setDragJob(null); return }

    const previousStatus = dragJob.status
    // Auto-assign technician when dropped into a dispatch column
    const autoTech = DISPATCH_TECH[colId]
    const updatedJob = { ...dragJob, status: colId, ...(autoTech ? { technician: autoTech } : {}) }

    // Optimistic update
    setJobs(prev => prev.map(j => j.id === dragJob.id ? updatedJob : j))

    try {
      const payload = jobToPayload(updatedJob)
      const res = await apiFetch(`${API_BASE}/api/jobs/${dragJob.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Update failed (${res.status})`)
      }

      if (colId === 'complete' && previousStatus !== 'complete') {
        checkConfetti(dragJob.technician, jobs, dragJob.id)
        setGetSome(true); setTimeout(() => setGetSome(false), 3000)
        apiFetch(`${API_BASE}/api/jobs/completions`).then(r => r.ok ? r.json() : null).then(d => d && setCompletions(d)).catch(() => {})
      }
      await fetchJobs()
    } catch (e) {
      setJobs(prev => prev.map(j => j.id === dragJob.id ? dragJob : j))
      showToast(e.message || 'Failed to move job. Changes reverted.')
    }
    setDragJob(null)
  }

  // Quick complete toggle — marks complete or reverts to need_dispatch
  async function handleComplete(job) {
    const newStatus = job.status === 'complete' ? 'need_dispatch' : 'complete'
    const updatedJob = { ...job, status: newStatus }

    // Optimistic update
    setJobs(prev => prev.map(j => j.id === job.id ? updatedJob : j))

    try {
      const res = await apiFetch(`${API_BASE}/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Update failed')
      }
      if (newStatus === 'complete') {
        checkConfetti(job.technician, jobs, job.id)
        setGetSome(true); setTimeout(() => setGetSome(false), 3000)
        // Refresh completion stats
        apiFetch(`${API_BASE}/api/jobs/completions`).then(r => r.ok ? r.json() : null).then(d => d && setCompletions(d)).catch(() => {})
      }
    } catch (e) {
      setJobs(prev => prev.map(j => j.id === job.id ? job : j))
      showToast(e.message || 'Failed to update status. Changes reverted.')
    }
  }

  // Toggle invoiced flag
  async function handleToggleInvoiced(job) {
    const updatedJob = { ...job, invoiced: !job.invoiced }
    setJobs(prev => prev.map(j => j.id === job.id ? updatedJob : j))
    try {
      const res = await apiFetch(`${API_BASE}/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiced: updatedJob.invoiced }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Update failed')
      }
    } catch (e) {
      setJobs(prev => prev.map(j => j.id === job.id ? job : j))
      showToast(e.message || 'Failed to update invoice status. Changes reverted.')
    }
  }

  async function handleOpenWorkDrive(job) {
    // Public link — open immediately
    if (job.folder_url && job.folder_url.includes('zohoexternal.com')) {
      window.open(job.folder_url, '_blank', 'noopener,noreferrer')
      return
    }
    // Internal URL — silently convert to public, then open
    if (job.folder_url) {
      await handleRefreshShareLink(job)
      return
    }
    // No URL at all — find/create the folder via API
    try {
      const res = await apiFetch(`${API_BASE}/api/jobs/${job.id}/workdrive-folder`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Folder not found')
      window.open(data.folderUrl, '_blank', 'noopener,noreferrer')
    } catch (e) {
      showToast('WorkDrive: ' + e.message)
    }
  }

  async function handleRefreshShareLink(job) {
    try {
      const res = await apiFetch(`${API_BASE}/api/jobs/${job.id}/refresh-share-link`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Refresh failed')
      // Update the job in local state with the new public URL
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, folder_url: data.shareLink } : j))
      showToast('✅ WorkDrive link fixed! Opening folder…')
      window.open(data.shareLink, '_blank', 'noopener,noreferrer')
    } catch (e) {
      showToast('Fix link failed: ' + e.message)
    }
  }

  async function handleUploadReport(file) {
    if (!file || file.type !== 'application/pdf') {
      showToast('Please choose a PDF file.')
      return
    }
    if (!onExtracted) { showToast('Upload not available here.'); return }
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('pdf', file)
      const res = await apiFetch(`${API_BASE}/api/extract`, { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const msg = err.error || `Server error ${res.status}`
        const friendly = msg.includes('rate limit') || msg.includes('Too many')
          ? 'Too many requests — wait a few minutes and try again.'
          : msg.includes('credit') || msg.includes('billing')
            ? 'AI credits exhausted. Check console.anthropic.com → Billing.'
            : msg || 'Extraction failed.'
        showToast(friendly)
        return
      }
      const data = await res.json()
      onExtracted(data, file)
    } catch (e) {
      showToast(e.message || 'Upload failed — check your connection and try again.')
    } finally {
      setUploading(false)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  function openNewJob(defaultStatus) {
    if (defaultStatus === 'need_dispatch' || defaultStatus === 'job_requested') {
      setShowRequestModal(true)
    } else {
      setModalJob({ defaultStatus })
    }
  }

  // Handle job request modal submission
  async function handleJobRequest(data) {
    const notes = [data.ro_number ? `RO# ${data.ro_number}` : '', data.notes].filter(Boolean).join('\n')
    const payload = {
      shop_name:    data.shop_name   || '',
      year:         data.year        || '',
      make:         data.make        || '',
      model:        data.model       || '',
      vehicle:      [data.year, data.make, data.model].filter(Boolean).join(' '),
      vin:          data.vin         || '',
      technician:   data.technician  || '',
      notes,
      quote_number: data.ro_number   || '',
      status:       'job_requested',
      calibrations: '[]',
      via_request:  true,
    }
    const res = await apiFetch(`${API_BASE}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || 'Failed to create job')
    }
    await fetchJobs()
    showToast('✅ Job requested — Kat has been notified!')
  }

  function openEdit(job) {
    setModalJob(job)
  }

  // Role-based auto-filter: technicians only see their own jobs
  const isTechnician = user?.role === 'technician'
  const myTechName   = user?.techName || ''

  // Derive unique region and technician lists for filter dropdowns
  const allRegions = [...new Set(jobs.map(j => j.region).filter(Boolean))].sort()
  const allTechs   = [...new Set(jobs.map(j => j.technician).filter(Boolean))].sort()

  const visibleJobs = jobs.filter(j => {
    // Technicians are locked to their own jobs regardless of other filters
    if (isTechnician && (j.technician || '').toLowerCase() !== myTechName.toLowerCase()) return false
    if (!isTechnician && regionFilter && j.region !== regionFilter) return false
    if (!isTechnician && techFilter && j.technician !== techFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const vehicle = j.vehicle || [j.year, j.make, j.model].filter(Boolean).join(' ')
      return (
        vehicle.toLowerCase().includes(q) ||
        (j.shop_name || '').toLowerCase().includes(q) ||
        (j.technician || '').toLowerCase().includes(q) ||
        (j.vin || '').toLowerCase().includes(q) ||
        (j.insurer || '').toLowerCase().includes(q) ||
        (j.notes || '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const jobsByStatus = COLUMNS.reduce((acc, col) => {
    acc[col.id] = visibleJobs.filter(j => j.status === col.id)
    return acc
  }, {})

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'white' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

      {/* Board */}
      <main className="flex-1 flex flex-col overflow-hidden mx-auto w-full" style={{ padding: isMobile ? '1rem' : '1.5rem 2.5rem', maxWidth: '1440px', margin: isMobile ? '0 auto' : '16px auto' }}>
        {/* Toolbar — always visible after initial load */}
        {!loading && (
          <div className="mb-4" style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                {/* Hidden file input for PDF upload */}
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="application/pdf"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadReport(f) }}
                />
                {/* Upload Report button — left side of toolbar */}
                {onExtracted && (
                  <button
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={uploading}
                    className="flex text-xs font-medium px-3 py-1.5 rounded-lg items-center gap-1.5"
                    style={{ color: uploading ? '#aaa' : 'white', border: `1px solid ${uploading ? '#e0dbd6' : ORANGE}`, backgroundColor: uploading ? '#f5f3f0' : ORANGE, flexShrink: 0 }}
                    title="Upload a calibration report PDF"
                  >
                    {uploading ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ animation: 'spin 1s linear infinite' }}>
                        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                    )}
                    {uploading ? 'Extracting…' : 'Upload Report'}
                  </button>
                )}
                {!error && (
                  <div className="relative" style={{ width: isMobile ? '100%' : '220px' }}>
                    <svg
                      className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      width="14" height="14" viewBox="0 0 24 24" fill="none"
                    >
                      <circle cx="11" cy="11" r="8" stroke="#aaa" strokeWidth="2"/>
                      <path d="M21 21l-4.35-4.35" stroke="#aaa" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <input
                      type="text"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search shop, vehicle, tech…"
                      className="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none"
                      style={{ border: '1px solid #e0dbd6', backgroundColor: 'white', color: '#1a1a1a' }}
                      onFocus={e => (e.target.style.borderColor = ORANGE)}
                      onBlur={e => (e.target.style.borderColor = '#e0dbd6')}
                    />
                  </div>
                )}
                {allRegions.length > 0 && (
                  <select
                    value={regionFilter}
                    onChange={e => setRegionFilter(e.target.value)}
                    className="text-sm rounded-lg px-2 py-2 outline-none"
                    style={{ border: `1px solid ${regionFilter ? ORANGE : '#e0dbd6'}`, color: regionFilter ? ORANGE : '#888', backgroundColor: 'white' }}
                  >
                    <option value="">All Regions</option>
                    {allRegions.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
                {allTechs.length > 0 && !isTechnician && (
                  <select
                    value={techFilter}
                    onChange={e => setTechFilter(e.target.value)}
                    className="text-sm rounded-lg px-2 py-2 outline-none"
                    style={{ border: `1px solid ${techFilter ? ORANGE : '#e0dbd6'}`, color: techFilter ? '#1a1a1a' : '#888', backgroundColor: 'white' }}
                  >
                    <option value="">All Techs</option>
                    {allTechs.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
                {(search || regionFilter || techFilter) && (
                  <button
                    onClick={() => { setSearch(''); setRegionFilter(''); if (!isTechnician) setTechFilter('') }}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg"
                    style={{ color: '#888', backgroundColor: '#f0eeec' }}
                  >
                    Clear
                  </button>
                )}
                {(search || regionFilter || techFilter || isTechnician) && (
                  <span className="text-xs" style={{ color: '#aaa' }}>
                    {visibleJobs.length} of {jobs.length} jobs
                  </span>
                )}
              </div>
              {/* ── Right-side toolbar buttons ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <button
                  onClick={async () => {
                    setSyncing(true)
                    try {
                      const res = await apiFetch(`${API_BASE}/api/jobs/sync-quotes`, { method: 'POST' })
                      const data = await res.json()
                      if (!res.ok) throw new Error(data.error || 'Sync failed')
                      await fetchJobs()
                      showToast(`Sync complete — ${data.created} added, ${data.removed} removed`)
                    } catch (e) {
                      showToast('Sync failed: ' + e.message)
                    } finally {
                      setSyncing(false)
                    }
                  }}
                  disabled={syncing}
                  className="hidden md:flex text-xs font-medium px-3 py-1.5 rounded-lg items-center gap-1.5"
                  style={{ color: syncing ? '#aaa' : ORANGE, border: `1px solid ${syncing ? '#e0dbd6' : ORANGE}`, backgroundColor: 'white', flexShrink: 0 }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }}>
                    <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
                    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                  </svg>
                  {syncing ? 'Syncing…' : 'Sync Invoice Drafts'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Tech Completion Stats ── */}
        {(() => {
          const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time
          const last7 = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(); d.setDate(d.getDate() - i)
            return d.toLocaleDateString('en-CA')
          })
          // Group by tech + date
          const byTechDate = {}
          for (const c of completions) {
            const date = new Date(c.completedAt).toLocaleDateString('en-CA')
            if (!last7.includes(date)) continue
            const tech = c.tech || 'Unknown'
            if (!byTechDate[tech]) byTechDate[tech] = {}
            byTechDate[tech][date] = (byTechDate[tech][date] || 0) + 1
          }
          const techs = Object.keys(byTechDate).sort()
          if (techs.length === 0) return null
          return (
            <div className="mb-3 flex flex-wrap gap-3">
              {techs.map(tech => {
                const todayCount = byTechDate[tech][today] || 0
                const weekTotal  = Object.values(byTechDate[tech]).reduce((a, b) => a + b, 0)
                return (
                  <div
                    key={tech}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm"
                    style={{ backgroundColor: '#f9f8f7', border: '1px solid #ebebeb' }}
                  >
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      style={{ backgroundColor: ORANGE }}>
                      {tech.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-semibold" style={{ color: '#1a1a1a' }}>{tech}</span>
                    <span className="font-bold text-base" style={{ color: ORANGE }}>{todayCount}</span>
                    <span className="text-xs" style={{ color: '#aaa' }}>today</span>
                    {weekTotal > todayCount && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#f0ece8', color: '#888' }}>
                        {weekTotal} this week
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3">
              <BoardSpinner />
              <p className="text-sm text-gray-400">Loading jobs…</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <p className="text-sm text-red-500 mb-3">{error}</p>
              <button
                onClick={fetchJobs}
                className="text-sm px-4 py-2 rounded-lg font-medium text-white"
                style={{ backgroundColor: ORANGE }}
              >
                Retry
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ── Mobile: flat scrollable card list ── */}
            <div className="md:hidden flex-1 overflow-y-auto">
              {/* Big "Request a Job" button — sticky at top on mobile */}
              <div className="sticky top-0 z-10 pb-2" style={{ backgroundColor: 'white' }}>
                <button
                  onClick={() => setShowRequestModal(true)}
                  className="w-full py-4 rounded-2xl font-extrabold text-white text-base tracking-wide shadow-md transition-opacity hover:opacity-90 active:opacity-80"
                  style={{ backgroundColor: '#CD4419', letterSpacing: '0.04em' }}
                >
                  📋 Request a Job
                </button>
              </div>

              <div className="flex flex-col gap-3 pb-6">
                {visibleJobs.length === 0 ? (
                  <p className="text-center text-sm py-12" style={{ color: '#aaa' }}>No jobs found</p>
                ) : (
                  visibleJobs.map(job => (
                    <MobileJobCard key={job.ROWID || job.id} job={job} onEdit={openEdit} />
                  ))
                )}
              </div>
            </div>

            {/* ── Desktop: horizontal Kanban columns ── */}
            <div className="hidden md:flex flex-1 overflow-x-auto pb-4" onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCol(null)
              }}>
            <div
              className="flex gap-4"
              style={{ alignItems: 'flex-start', minHeight: '100%' }}
            >
              {COLUMNS.map(col => (
                <KanbanColumn
                  key={col.id}
                  column={col}
                  jobs={jobsByStatus[col.id] || []}
                  onEdit={openEdit}
                  onNewJob={openNewJob}
                  onDragStart={onDragStart}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                  onComplete={handleComplete}
                  onToggleInvoiced={handleToggleInvoiced}
                  onDelete={handleDelete}
                  onOpenWorkDrive={handleOpenWorkDrive}
                  onRefreshShareLink={handleRefreshShareLink}
                  onCreateInvoices={setInvoicingJob}
                  dragOverCol={dragOverCol}
                />
              ))}
            </div>
            </div>
          </>
        )}
      </main>

      {/* Job Request Modal — opened via "+" on the Need to Dispatch column */}
      {showRequestModal && (
        <JobRequestModal
          onClose={() => setShowRequestModal(false)}
          onSubmit={handleJobRequest}
        />
      )}

      {/* Modal */}
      {modalJob !== null && (
        <JobModal
          job={modalJob}
          onClose={() => setModalJob(null)}
          onSave={handleSave}
          onDelete={handleDelete}
          allJobs={jobs}
        />
      )}

      {/* Create Invoices Modal */}
      {invoicingJob && (
        <CreateInvoicesModal
          job={invoicingJob}
          onClose={() => setInvoicingJob(null)}
          onCreated={async (invoiceNums) => {
            // Auto-mark the job as invoiced + complete
            try {
              const patch = { invoiced: true, status: 'complete' }
              if (invoiceNums) {
                // Store the generated invoice numbers on the job for reference
                const nums = [invoiceNums.insurance, invoiceNums.shop].filter(Boolean).join(', ')
                if (nums) patch.invoice_number = nums
              }
              await apiFetch(`${API_BASE}/api/jobs/${invoicingJob.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
              })
            } catch (e) {
              console.warn('Could not auto-mark job invoiced:', e.message)
            }
            setInvoicingJob(null)
            showToast('✅ Invoices created — job marked complete & invoiced!')
            fetchJobs()
          }}
        />
      )}

      {/* "Get some!" celebration pop */}
      {getSome && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl"
          style={{ backgroundColor: '#1a1a1a', border: `2px solid ${ORANGE}`, animation: 'fadeInUp 0.3s ease' }}
        >
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
            style={{ backgroundColor: ORANGE }}>M</div>
          <span className="text-white font-bold text-base">Get some!</span>
          <span className="text-2xl">💪</span>
        </div>
      )}

      {/* Error toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white"
          style={{ backgroundColor: '#b91c1c', maxWidth: '420px', textAlign: 'center' }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}

function UploadButton({ job }) {
  const [uploading, setUploading] = useState(false)
  const [done, setDone] = useState(false)
  const inputRef = useRef(null)

  async function handleFiles(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    try {
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        const jobId = String(job.ROWID || job.id || '')
        const res = await apiFetch(`${API_BASE}/api/jobs/${jobId}/upload-photo`, {
          method: 'POST',
          body: formData,
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || 'Upload failed')
        }
      }
      setDone(true)
      setTimeout(() => setDone(false), 3000)
    } catch (err) {
      alert('Upload failed: ' + err.message)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={handleFiles}
      />
      <button
        onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
        disabled={uploading}
        className="text-xs font-medium px-2 py-1 rounded-md flex items-center gap-1"
        style={{
          backgroundColor: done ? '#edfaf3' : '#f5f3f0',
          color: done ? '#166534' : '#CD4419',
          border: `1px solid ${done ? '#bbf7d0' : '#e8d5ce'}`,
          opacity: uploading ? 0.6 : 1,
        }}
        title="Upload photos or files to WorkDrive"
      >
        {uploading ? '⏳' : done ? '✓' : '📷'} {uploading ? 'Uploading…' : done ? 'Uploaded!' : 'Upload'}
      </button>
    </>
  )
}

function MobileJobCard({ job, onEdit }) {
  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  const statusLabel = COLUMNS.find(c => c.id === job.status)?.label || job.status

  const statusColors = {
    need_dispatch:    { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
    dispatched_jaden: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
    dispatched_mark:  { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
    pending_parts:    { bg: '#fefce8', color: '#a16207', border: '#fde68a' },
    ready_invoice:    { bg: '#fdf4ff', color: '#7e22ce', border: '#e9d5ff' },
    complete:         { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
  }
  const sc = statusColors[job.status] || { bg: '#f5f3f0', color: '#555', border: '#e0dbd6' }

  let cals = []
  if (job.calibrations) {
    try {
      cals = typeof job.calibrations === 'string' ? JSON.parse(job.calibrations) : job.calibrations
    } catch { cals = [] }
  }

  return (
    <div
      onClick={() => onEdit(job)}
      className="rounded-xl p-4 active:opacity-80"
      style={{ backgroundColor: 'white', border: '1px solid #e8e4e0', cursor: 'pointer' }}
    >
      {/* Top row: shop + status badge */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="font-semibold text-sm" style={{ color: '#1a1a1a' }}>{job.shop_name || 'No shop'}</span>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
          {statusLabel}
        </span>
      </div>

      {/* Vehicle */}
      <p className="text-sm mb-1" style={{ color: '#555' }}>{vehicle || 'Unknown vehicle'}</p>

      {/* Technician + date row */}
      <div className="flex items-center gap-3 text-xs mb-2" style={{ color: '#aaa' }}>
        {job.technician && <span>👤 {job.technician}</span>}
        {job.scheduled_date && <span>📅 {job.scheduled_date}</span>}
        {job.insurer && <span>🏢 {job.insurer}</span>}
      </div>

      {/* Calibrations + fixed items (PCSI & POST always show) */}
      <div className="flex flex-wrap gap-1">
        {cals.slice(0, 4).map((c, i) => (
          <span key={i} className="text-xs px-1.5 py-0.5 rounded-md"
            style={{ backgroundColor: '#f5f3f0', color: '#888' }}>
            {c.name || c.calibration_name || c}
          </span>
        ))}
        {cals.length > 4 && (
          <span className="text-xs px-1.5 py-0.5 rounded-md" style={{ backgroundColor: '#f5f3f0', color: '#aaa' }}>
            +{cals.length - 4} more
          </span>
        )}
        <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}>PCSI</span>
        <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}>POST</span>
      </div>
    </div>
  )
}

function BoardSpinner() {
  return (
    <svg className="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="#e8d5ce" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke={ORANGE} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
