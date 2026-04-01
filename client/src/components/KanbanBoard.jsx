import { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import Navbar from './Navbar'

const ORANGE = '#CD4419'

const COLUMNS = [
  { id: 'need_dispatch',    label: 'Need to Dispatch' },
  { id: 'dispatched_jaden', label: 'Dispatched to Jaden' },
  { id: 'dispatched_mark',  label: 'Dispatched to Mark' },
  { id: 'pending_parts',    label: 'Pending / Waiting on Parts' },
  { id: 'ready_invoice',    label: 'Ready to Invoice' },
  { id: 'complete',         label: 'Completed' },
]

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
  year: '',
  make: '',
  model: '',
  vin: '',
  insurer: '',
  technician: '',
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
    year,
    make,
    model,
    vin: job.vin || '',
    insurer: job.insurer || '',
    technician: job.technician || '',
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
    vehicle: [form.year, form.make, form.model].filter(Boolean).join(' '),
    year: form.year,
    make: form.make,
    model: form.model,
    vin: form.vin,
    insurer: form.insurer,
    technician: form.technician,
    scheduled_date: form.scheduled_date,
    calibrations: JSON.stringify(form.calibrations),
    notes: form.notes,
    report_url: form.report_url,
    status: form.status,
    invoiced: form.invoiced || false,
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

          {/* Shop name */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Shop Name</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#ddd', focusRingColor: ORANGE }}
              value={form.shop_name}
              onChange={e => setField('shop_name', e.target.value)}
              placeholder="e.g. Smith Auto Body"
            />
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
function KanbanCard({ job, onEdit, onDragStart, onComplete, onToggleInvoiced, onDelete }) {
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

      {/* Vehicle */}
      {vehicle && (
        <p className="text-sm font-semibold text-gray-800 leading-snug mb-1">{vehicle}</p>
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

      {/* Calibrations chips */}
      {calArr.length > 0 && (
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
        </div>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between mt-1">
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
          {job.report_url && (
            <a
              href={job.report_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-xs font-medium underline"
              style={{ color: ORANGE }}
            >
              Report
            </a>
          )}
          {/* Delete button */}
          <button
            onClick={e => { e.stopPropagation(); onDelete(job) }}
            title="Delete job"
            className="flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Kanban Column ────────────────────────────────────────────────────────────
function KanbanColumn({ column, jobs, onEdit, onNewJob, onDragStart, onDragOver, onDrop, onComplete, onToggleInvoiced, onDelete, dragOverCol }) {
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
export default function KanbanBoard({ user, onBack, onLogout, currentScreen, onNavigate }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalJob, setModalJob] = useState(null) // null = closed, {} = new, job = edit
  const [dragJob, setDragJob] = useState(null)
  const [dragOverCol, setDragOverCol] = useState(null)
  const [toast, setToast] = useState(null)
  const [search, setSearch] = useState('')
  const [syncing, setSyncing] = useState(false)

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

  // Save (create or update)
  async function handleSave(form, originalJob) {
    const payload = formToJobData(form)
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
      const payload = formToJobData(jobToForm(updatedJob))
      const res = await apiFetch(`${API_BASE}/api/jobs/${dragJob.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Update failed')

      if (colId === 'complete' && previousStatus !== 'complete') {
        checkConfetti(dragJob.technician, jobs, dragJob.id)
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
      const payload = formToJobData(jobToForm(updatedJob))
      const res = await apiFetch(`${API_BASE}/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Update failed')

      if (newStatus === 'complete') {
        checkConfetti(job.technician, jobs, job.id)
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
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formToJobData(jobToForm(updatedJob)), invoiced: updatedJob.invoiced }),
      })
      if (!res.ok) throw new Error('Update failed')
    } catch (e) {
      setJobs(prev => prev.map(j => j.id === job.id ? job : j))
      showToast(e.message || 'Failed to update invoice status. Changes reverted.')
    }
  }

  function openNewJob(defaultStatus) {
    setModalJob({ defaultStatus })
  }

  function openEdit(job) {
    setModalJob(job)
  }

  const visibleJobs = search.trim()
    ? jobs.filter(j => {
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
      })
    : jobs

  const jobsByStatus = COLUMNS.reduce((acc, col) => {
    acc[col.id] = visibleJobs.filter(j => j.status === col.id)
    return acc
  }, {})

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'white' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

      {/* Board */}
      <main className="flex-1 flex flex-col overflow-hidden" style={{ padding: '1.5rem 1.5rem 0' }}>
        {/* Toolbar — always visible after initial load */}
        {!loading && (
          <div className="mb-4" style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {!error && (
                  <div className="relative" style={{ width: '260px' }}>
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
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg"
                    style={{ color: '#888', backgroundColor: '#f0eeec' }}
                  >
                    Clear
                  </button>
                )}
                {search && (
                  <span className="text-xs" style={{ color: '#aaa' }}>
                    {visibleJobs.length} of {jobs.length} jobs
                  </span>
                )}
              </div>
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
                className="text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                style={{ color: syncing ? '#aaa' : ORANGE, border: `1px solid ${syncing ? '#e0dbd6' : ORANGE}`, backgroundColor: 'white', flexShrink: 0 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }}>
                  <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
                  <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                </svg>
                {syncing ? 'Syncing…' : 'Sync Quotes'}
              </button>
            </div>
          </div>
        )}

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
          <div className="flex-1 overflow-x-auto pb-4" onDragLeave={(e) => {
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
                dragOverCol={dragOverCol}
              />
            ))}
          </div>
          </div>
        )}
      </main>

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

function BoardSpinner() {
  return (
    <svg className="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="#e8d5ce" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke={ORANGE} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
