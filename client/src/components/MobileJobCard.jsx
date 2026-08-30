// Shared job card. Same visual as the desktop KanbanCard so a job on
// Live Day looks identical to the same job on the board (per Mark
// 2026-07-08). Handlers are all optional — pages pass only what they
// support.

import { useState, useRef, useEffect } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

// Estimate totals for card price tags (Mark 2026-08-30: totals on all
// kanban + live view cards). Module-cached: one fetch per session no
// matter how many cards render.
let _totalsCache = null
let _totalsPromise = null
export function useEstimateTotals() {
  const [totals, setTotals] = useState(_totalsCache || {})
  useEffect(() => {
    if (_totalsCache) return
    if (!_totalsPromise) {
      _totalsPromise = apiFetch(`${API_BASE}/api/shop-quotes/estimate-totals`)
        .then(r => r.json())
        .then(d => { if (d && typeof d === 'object' && !d.error) _totalsCache = d; return _totalsCache || {} })
        .catch(() => ({}))
    }
    _totalsPromise.then(d => setTotals(d || {}))
  }, [])
  return totals
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

// Cash detection — mirrors services/cashPricing.js. Blank insurer is
// NOT cash (fixed 2026-07-08 per Mark: "if there's an insurance company
// it's not cash").
export function isCashCustomerJob(job) {
  if (!job) return false
  const ins = String(job.insurer || '').trim()
  if (!ins) return false
  return /^(cash|customer pay|cp|self.?pay|owner.?pay|out of pocket|oop)$/i.test(ins)
}

// Tesla jobs bill on Tesla pricing (Mark 2026-07-10). Match make OR the
// combined vehicle string so imports that only fill `vehicle` still flag.
export function isTeslaJob(job) {
  if (!job) return false
  return /tesla/i.test(String(job.make || '')) || /tesla/i.test(String(job.vehicle || ''))
}

// Insurer pricing families (Mark 2026-08-13: "a pill on the kanban card
// to help us remember"). US General + Integon are National General
// companies, which Allstate owns — they bill on the AS- price list.
export function insurerPricingBadge(job) {
  const ins = String(job?.insurer || '').toLowerCase()
  if (!ins) return null
  if (/state\s*farm/.test(ins)) return { label: '🏦 STATE FARM PRICING', bg: '#b91c1c' }
  if (/allstate|u\.?s\.?\s*general|integon|national\s*general/.test(ins)) return { label: '🏦 ALLSTATE PRICING', bg: '#1d4ed8' }
  if (/american\s*family|amfam/.test(ins)) return { label: '🏦 AM FAM PRICING', bg: '#0e7490' }
  return null
}

// Shop-name normalizer for customer card notes — must mirror
// normShopName in routes/shops.js so lookups hit.
export function normShopName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[,.]?\s*(inc|llc|corp|co)\.?\s*$/i, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Customer notes are stored per shop as a JSON array of items (Mark
// 2026-07-14: "each shop has four or five specific things we need to
// note"). Older notes are plain text — treat newlines as items.
export function parseNoteItems(raw) {
  const s = String(raw || '').trim()
  if (!s) return []
  if (s.startsWith('[')) {
    try {
      const a = JSON.parse(s)
      if (Array.isArray(a)) return a.map(x => String(x).trim()).filter(Boolean)
    } catch { /* fall through to plain text */ }
  }
  return s.split('\n').map(x => x.trim()).filter(Boolean)
}

// Amber sticky-note block shared by every card variant.
export function CustomerNoteBox({ items }) {
  if (!items || items.length === 0) return null
  return (
    <div className="text-xs rounded-md px-2 py-1.5 mb-2"
      style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
      {items.map((it, i) => (
        <div key={i} className={i > 0 ? 'mt-1' : ''}>📌 {it}</div>
      ))}
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
      <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple
        style={{ display: 'none' }} onChange={handleFiles} />
      <button
        onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
        disabled={uploading}
        className="text-xs font-medium px-2 py-1 rounded-md flex items-center gap-1"
        style={{
          backgroundColor: done ? '#edfaf3' : '#f5f3f0',
          color: done ? '#166534' : ORANGE,
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

export default function MobileJobCard({
  job,
  onEdit,
  onMoveToReadyInvoice,
  onMoveToPendingParts,
  onCreateInvoices,
  onToggleInvoiced,
  onOpenWorkDrive,
  customerNotes,
  billableQuote,
  onBillFromQuote,
  estimateTotal,
}) {
  const [finding, setFinding] = useState(false)
  const totalsMap = useEstimateTotals()
  const cardTotal = estimateTotal ?? (job.zoho_estimate_id ? totalsMap[job.zoho_estimate_id] : null)
  const noteItems = parseNoteItems(customerNotes?.[normShopName(job.shop_name)])

  async function handleOpenWorkDrive(e) {
    e.stopPropagation()
    if (job.folder_url && job.folder_url.includes('zohoexternal.com')) {
      window.open(job.folder_url, '_blank', 'noopener,noreferrer')
      return
    }
    if (!onOpenWorkDrive) {
      if (job.folder_url) window.open(job.folder_url, '_blank', 'noopener,noreferrer')
      return
    }
    setFinding(true)
    try { await onOpenWorkDrive(job) } finally { setFinding(false) }
  }

  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  const isComplete = job.status === 'complete'

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

  const canInvoice = job.status === 'ready_invoice' || job.status === 'complete'
  const handleEdit = onEdit ? () => onEdit(job) : undefined

  return (
    <div
      onClick={handleEdit}
      className={`bg-white rounded-xl shadow-sm p-3 select-none transition-shadow ${handleEdit ? 'cursor-pointer hover:shadow-md active:opacity-75' : ''}`}
      style={{ border: `1px solid ${isComplete ? '#d4edda' : '#ebebeb'}`, backgroundColor: isComplete ? '#f8fff9' : 'white' }}
    >
      {cardTotal > 0 && (
        <div className="flex justify-end -mt-1 mb-1">
          <span className="text-sm font-extrabold" style={{ color: '#1a1a1a' }}>${Number(cardTotal).toFixed(2)}</span>
        </div>
      )}
      {/* Shop name in bold uppercase orange */}
      {job.shop_name && (
        <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: ORANGE }}>
          {job.shop_name}
        </p>
      )}

      {vehicle && (
        <p className="text-sm font-semibold leading-snug mb-0.5" style={{ color: '#1f2937' }}>{vehicle}</p>
      )}

      {job.vin && (
        <p className="text-xs mb-1 font-mono" style={{ color: '#888' }}>VIN: {job.vin}</p>
      )}

      {job.ro_number && (
        <p className="text-xs font-bold mb-1 font-mono" style={{ color: '#1a1a1a' }}>
          <span className="font-normal" style={{ color: '#999' }}>RO# </span>{job.ro_number}
        </p>
      )}

      {(job.invoice_number || job.quote_number) && (
        <p className="text-xs font-medium mb-1" style={{ color: '#6b7280' }}>
          <span style={{ color: '#999', fontWeight: 400 }}>Job: </span>
          {job.invoice_number || job.quote_number}
        </p>
      )}

      <CustomerNoteBox items={noteItems} />

      {insurerPricingBadge(job) && (
        <p className="mb-1">
          <span
            className="text-[10px] font-bold uppercase tracking-wider inline-block px-2 py-0.5 rounded"
            style={{ background: insurerPricingBadge(job).bg, color: '#fff', letterSpacing: '0.06em' }}
            title="This insurer bills on a special price list — use the matching prefixed items"
          >{insurerPricingBadge(job).label}</span>
        </p>
      )}
      {isTeslaJob(job) && (
        <p className="mb-1">
          <span
            className="text-[10px] font-bold uppercase tracking-wider inline-block px-2 py-0.5 rounded"
            style={{ background: '#E82127', color: '#fff', letterSpacing: '0.06em' }}
            title="Tesla — use Tesla pricing on this invoice"
          >⚡ TESLA · Tesla pricing</span>
        </p>
      )}

      {isCashCustomerJob(job) ? (
        <p className="mb-1">
          <span
            className="text-[10px] font-bold uppercase tracking-wider inline-block px-2 py-0.5 rounded"
            style={{ background: '#15803d', color: '#fff', letterSpacing: '0.06em' }}
            title="Cash customer — max $700 out of pocket"
          >💵 CASH · max $700</span>
        </p>
      ) : job.insurer && (
        <p className="text-xs font-medium mb-1 truncate" style={{ color: '#2563eb' }}>
          <span style={{ color: '#999', fontWeight: 400 }}>Insurer: </span>{job.insurer}
        </p>
      )}

      {job.technician && (
        <div className="flex items-center gap-1 mb-2">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
            <circle cx="12" cy="8" r="4" stroke="#999" strokeWidth="2"/>
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#999" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <p className="text-xs font-medium" style={{ color: '#6b7280' }}>{job.technician}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-1 mb-2">
        {calArr.map((c, i) => {
          const label = c.name || c.type || c.calibration_name || ''
          const modeLabel = c.mode && c.mode.toLowerCase() !== 'static' ? ` (${c.mode})` : ''
          if (!label) return null
          return (
            <span key={i} className="text-xs px-1.5 py-0.5 rounded-md font-medium"
              style={{ backgroundColor: '#fdf3ef', color: ORANGE }}>
              {label}{modeLabel}
            </span>
          )
        })}
        <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}>PCSI</span>
        <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}>POST</span>
      </div>

      {/* Extra services flag — tech typed extras in the Live Day
          Ready-to-Invoice modal. Bright red block so Kat can't miss it
          when scanning the Ready-to-Invoice column. */}
      {job.extra_services && String(job.extra_services).trim() && (
        <div className="rounded-lg p-2 mb-2"
          style={{ backgroundColor: '#fef2f2', border: '2px solid #dc2626' }}>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1"
            style={{ color: '#dc2626', fontFamily: 'IBM Plex Mono, monospace' }}>
            🚩 Extra Services to Add
          </div>
          <div className="text-xs whitespace-pre-wrap" style={{ color: '#991b1b' }}>
            {job.extra_services}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-1 mb-2">
        {dateStr ? <span className="text-xs" style={{ color: '#9ca3af' }}>{dateStr}</span> : <span />}
        <div className="flex items-center gap-2">
          {onToggleInvoiced && (
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
          )}
          <UploadButton job={job} />
        </div>
      </div>

      {job.status !== 'job_requested' && (<>
      <button
        onClick={handleOpenWorkDrive}
        disabled={finding}
        className="w-full flex items-center justify-center gap-2 rounded-xl transition-all"
        style={{
          backgroundColor: finding ? '#f5f5f7' : '#fff4f0',
          border: `1.5px solid ${finding ? '#e8e8ed' : '#f5cfc3'}`,
          padding: '10px 0', minHeight: '44px',
          opacity: finding ? 0.6 : 1,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={finding ? '#aaa' : ORANGE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        <span className="text-sm font-semibold" style={{ color: finding ? '#aaa' : ORANGE }}>
          {finding ? 'Finding folder…' : 'Open in WorkDrive'}
        </span>
      </button>

      {/* Waiting-on-Parts (Mark 2026-07-13): techs park a job on the
          Pending/Waiting-on-Parts column straight from the card. Only
          shows while the job is in a tech's hands. */}
      {onMoveToPendingParts && !job.invoiced && job.status !== 'pending_parts' && !canInvoice && (
        <button
          onClick={e => { e.stopPropagation(); onMoveToPendingParts(job) }}
          className="w-full flex items-center justify-center gap-2 rounded-xl mt-2 transition-all active:opacity-60"
          style={{ backgroundColor: '#fff7ed', border: '1.5px solid #fed7aa', padding: '10px 0', minHeight: '44px' }}
        >
          <span style={{ fontSize: '14px' }}>⏳</span>
          <span className="text-sm font-semibold" style={{ color: '#c2410c' }}>Waiting on Parts</span>
        </button>
      )}

      {!job.invoiced && (
        canInvoice && onCreateInvoices ? (
          <button
            onClick={e => { e.stopPropagation(); onCreateInvoices(job) }}
            className="w-full flex items-center justify-center gap-2 rounded-xl transition-all mt-2 active:opacity-60"
            style={{ backgroundColor: '#f0fdf4', border: '1.5px solid #bbf7d0', padding: '10px 0', minHeight: '44px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="14 2 14 8 20 8" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span className="text-sm font-semibold" style={{ color: '#16a34a' }}>Create Invoices</span>
          </button>
        ) : onMoveToReadyInvoice ? (
          <button
            onClick={e => { e.stopPropagation(); onMoveToReadyInvoice(job) }}
            className="w-full flex items-center justify-center gap-2 rounded-xl mt-2 transition-all active:opacity-60"
            style={{ backgroundColor: '#fdf4ff', border: '1.5px solid #e9d5ff', padding: '10px 0', minHeight: '44px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#7e22ce" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="14 2 14 8 20 8" stroke="#7e22ce" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span className="text-sm font-semibold" style={{ color: '#7e22ce' }}>Ready to Invoice</span>
          </button>
        ) : null
      )}

      </>)}

      {/* Bill from Quote (one-card flow): this job came from an approved
          quote — one tap sends the insurance invoice + discounted cost
          invoice built from it. */}
      {billableQuote && onBillFromQuote && (
        <button
          onClick={e => { e.stopPropagation(); onBillFromQuote(job) }}
          className="w-full flex items-center justify-center gap-2 rounded-xl mt-2 transition-all active:opacity-60"
          style={{ backgroundColor: '#eff6ff', border: '1.5px solid #bfdbfe', padding: '10px 0', minHeight: '44px' }}
        >
          <span className="text-sm font-semibold" style={{ color: '#1d4ed8' }}>🧾 Bill from Quote (${Number(billableQuote.total).toFixed(0)})</span>
        </button>
      )}
    </div>
  )
}
