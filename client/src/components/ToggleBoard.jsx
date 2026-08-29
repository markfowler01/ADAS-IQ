import { API_BASE, apiFetch } from '../utils/api.js'
import { useState } from 'react'
import JobCard from './JobCard'
import CalibrationRow from './CalibrationRow'
import ManualAddForm from './ManualAddForm'
import SummaryBar from './SummaryBar'
import CustomerPicker from './CustomerPicker'
import SalespersonPicker from './SalespersonPicker'
import Navbar from './Navbar'
import LoadingSplash from './LoadingSplash.jsx'

const ORANGE = '#CD4419'

export default function ToggleBoard({ jobData, pdfFile, onReset, user, onLogout, currentScreen, onNavigate }) {
  const [calibrations, setCalibrations] = useState(() => {
    const extracted = jobData.calibrations.map((c, i) => ({ ...c, _id: i }))
    const nextId = extracted.length
    return [
      ...extracted,
      { _id: nextId,     calibration_name: 'Diagnostic 1', enabled: false, quantity: 1, description: '' },
      { _id: nextId + 1, calibration_name: 'Mechanical',   enabled: false, quantity: 1, description: '' },
    ]
  })
  const [showManualForm, setShowManualForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [pricePreview, setPricePreview] = useState(null)   // review-before-create modal
  const [previewBusy, setPreviewBusy] = useState(false)
  const [poolOverride, setPoolOverride] = useState(null)    // review-modal schedule pick
  const [creatingJob, setCreatingJob] = useState(false)
  const [invoiceResult, setInvoiceResult] = useState(null)
  const [jobResult, setJobResult] = useState(null)
  const [invoiceError, setInvoiceError] = useState(null)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [selectedSalesperson, setSelectedSalesperson] = useState(null)
  const [kanbanWarning, setKanbanWarning] = useState(null)
  // One WorkDrive folder per job (Mark 2026-07-29): whichever button
  // runs first records the folder here; the other button reuses it.
  const [sharedFolder, setSharedFolder] = useState(null)

  const selected = calibrations.filter((c) => c.enabled)
  const removed = calibrations.filter((c) => !c.enabled)

  async function handleDownloadPDF() {
    try {
      const payload = {
        shop: jobData.shop,
        ro_number: jobData.ro_number,
        insurer: jobData.insurer,
        vin: jobData.vin,
        vehicle: jobData.vehicle,
        year: jobData.year,
        make: jobData.make,
        model: jobData.model,
        claim: jobData.claim,
        calibrations: calibrations.map(({ _id, ...rest }) => rest),
        document_links: jobData.document_links || [],
      }
      const res = await apiFetch(`${API_BASE}/api/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ADAS-IQ-${jobData.ro_number || 'report'}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      console.error('PDF download failed:', e)
      alert('PDF download failed. Please try again.')
    }
  }

  function toggleCal(id) {
    setCalibrations((prev) =>
      prev.map((c) => (c._id === id ? { ...c, enabled: !c.enabled } : c))
    )
  }

  function updateCalField(id, field, value) {
    setCalibrations(prev => prev.map(c => c._id === id ? { ...c, [field]: value } : c))
  }

  function addManual(cal) {
    setCalibrations((prev) => [...prev, { ...cal, _id: Date.now() }])
    setShowManualForm(false)
  }

  // Step 1 (Mark 2026-08-29): price the lines BEFORE anything is created
  // in Books — same review pattern as sending a quote.
  async function openPriceReview(pool = poolOverride) {
    if (selected.length === 0) return
    setPreviewBusy(true)
    setInvoiceError(null)
    try {
      const r = await apiFetch(`${API_BASE}/api/create-invoice/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          insurer: jobData.insurer || '',
          make: jobData.make || '',
          pool_override: pool || null,
          calibrations: selected.map(({ _id, ...rest }) => rest),
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `Server error ${r.status}`)
      setPricePreview(d)
    } catch (e) {
      setInvoiceError(e.message)
    } finally { setPreviewBusy(false) }
  }

  function changePool(pool) {
    setPoolOverride(pool)
    openPriceReview(pool)
  }

  async function handleApprove(fixedOverrides = null, fixedZero = null, lineOverrides = null, lineEdits = null, addedItems = null) {
    if (selected.length === 0) return
    setPricePreview(null)
    setSubmitting(true)
    setInvoiceError(null)
    try {
      // Convert PDF file to base64 if available
      let pdfBase64 = null
      let pdfFilename = null
      if (pdfFile) {
        pdfBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const result = reader.result || ''
            const base64 = result.includes(',') ? result.split(',')[1] : result
            if (!base64) { reject(new Error('Could not read PDF file — empty result')); return }
            resolve(base64)
          }
          reader.onerror = reject
          reader.readAsDataURL(pdfFile)
        })
        pdfFilename = pdfFile.name
      }

      const payload = {
        customerId: selectedCustomer?.id || null,
        customerName: selectedCustomer?.name || null,
        salespersonId: selectedSalesperson?.id || null,
        salespersonName: selectedSalesperson?.name || null,
        shop: jobData.shop,
        ro_number: jobData.ro_number,
        insurer: jobData.insurer,
        vin: jobData.vin,
        vehicle: jobData.vehicle,
        year: jobData.year,
        make: jobData.make,
        model: jobData.model,
        claim: jobData.claim,
        calibrations: selected.map(({ _id, ...rest }) => rest),
        // Sensors Kinetic checked and ruled OUT — the report's rule-out
        // matrix is proof of a full inspection (Diagnostic/Mechanical are
        // UI add-on rows, not real sensors).
        ruled_out: calibrations
          .filter(c => !c.enabled && !['Diagnostic 1', 'Mechanical'].includes(c.calibration_name))
          .map(({ _id, ...rest }) => rest),
        pdfBase64,
        pdfFilename,
        known_folder_id: sharedFolder?.id || null,
        known_folder_url: sharedFolder?.url || null,
        fixed_overrides: fixedOverrides && Object.keys(fixedOverrides).length ? fixedOverrides : null,
        fixed_zero: fixedZero && fixedZero.length ? fixedZero : null,
        line_overrides: lineOverrides && Object.keys(lineOverrides).length ? lineOverrides : null,
        line_edits: lineEdits && Object.keys(lineEdits).length ? lineEdits : null,
        added_items: addedItems && addedItems.length ? addedItems : null,
        pool_override: poolOverride || null,
      }
      const res = await apiFetch(`${API_BASE}/api/create-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      setInvoiceResult(data)
      if (data.folderId || data.shareLink || data.folderUrl) {
        setSharedFolder({ id: data.folderId || null, url: data.shareLink || data.folderUrl || '' })
      }

      // Save to server history (fire-and-forget)
      try {
        await apiFetch(`${API_BASE}/api/history`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop:        selectedCustomer?.name || jobData.shop || '',
            vehicle:     [jobData.year, jobData.make, jobData.model].filter(Boolean).join(' '),
            roNumber:    jobData.ro_number || '',
            vin:         jobData.vin || '',
            calibrations: selected.map(c =>
              c.calibration_name || c.name || c.description || c.item_name || c.trigger || ''
            ).filter(Boolean),
            estimateUrl: data.quoteUrl || '',
            pdfUrl:      data.shareLink || data.folderUrl || '',
            technician:  selectedSalesperson?.name || '',
          }),
        })
      } catch (histErr) {
        console.warn('[history] Failed to save history entry:', histErr.message)
      }

      // Auto-create Kanban board ticket
      try {
        const calList = selected.map((cal, i) => ({
          name: cal.calibration_name || cal.name || cal.description || cal.item_name || cal.trigger || `Calibration ${i + 1}`,
          mode: cal.cal_type || cal.mode || 'Static',
        }))
        const jobRes = await apiFetch(`${API_BASE}/api/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            zoho_estimate_id: data.quoteId || '',
            shop_name: selectedCustomer?.name || jobData.shop || '',
            vehicle: [jobData.year, jobData.make, jobData.model].filter(Boolean).join(' '),
            year: jobData.year || '',
            make: jobData.make || '',
            model: jobData.model || '',
            vin: jobData.vin || '',
            insurer: jobData.insurer || '',
            technician: selectedSalesperson?.name || '',
            scheduled_date: new Date().toISOString().split('T')[0],
            calibrations: JSON.stringify(calList),
            notes: `RO#: ${jobData.ro_number || ''} | Quote: ${data.quoteNumber || ''}`,
            report_url: data.quoteUrl || data.folderUrl || '',
            quote_number: data.quoteNumber || '',
            quote_url: data.quoteUrl || '',
            folder_url: data.shareLink || data.folderUrl || '',
            status: 'need_dispatch',
          }),
        })
        // apiFetch resolves even on 4xx/5xx — must check res.ok explicitly
        if (!jobRes.ok) {
          let serverMsg = `HTTP ${jobRes.status}`
          try { const j = await jobRes.json(); serverMsg = j.error || serverMsg } catch {}
          throw new Error(serverMsg)
        }
        console.log('[kanban] Auto-ticket created OK')
      } catch (autoErr) {
        console.error('[kanban] Auto-ticket failed:', autoErr.message)
        setKanbanWarning(`⚠️ Zoho quote saved, but the Kanban card was NOT created. Reason: ${autoErr.message}. Add it manually on the Job Board.`)
      }
    } catch (e) {
      setInvoiceError(e.message || 'Failed to create invoice. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Create a Job — writes to Absolute ADAS Books (separate from Zoho flow) ─────
  async function handleCreateJob() {
    if (selected.length === 0) return
    setCreatingJob(true)
    setInvoiceError(null)
    try {
      // Carry the Kinetic source PDF along (Mark 2026-07-27) so the
      // server can drop it in the job's WorkDrive folder next to the
      // Absolute ADAS report — this path used to lose it.
      let pdfBase64 = null
      let pdfFilename = null
      if (pdfFile) {
        try {
          pdfBase64 = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
              const result = reader.result || ''
              const base64 = result.includes(',') ? result.split(',')[1] : result
              base64 ? resolve(base64) : reject(new Error('empty PDF read'))
            }
            reader.onerror = reject
            reader.readAsDataURL(pdfFile)
          })
          pdfFilename = pdfFile.name
        } catch (e) {
          console.warn('PDF read failed — creating job without Kinetic upload:', e.message)
        }
      }

      const payload = {
        customerName: selectedCustomer?.name || null,
        shop: jobData.shop,
        ro_number: jobData.ro_number,
        insurer: jobData.insurer,
        vin: jobData.vin,
        vehicle: jobData.vehicle,
        year: jobData.year,
        make: jobData.make,
        model: jobData.model,
        calibrations: selected.map(({ _id, ...rest }) => rest),
        // Sensors Kinetic checked and ruled OUT — the report's rule-out
        // matrix is proof of a full inspection (Diagnostic/Mechanical are
        // UI add-on rows, not real sensors).
        ruled_out: calibrations
          .filter(c => !c.enabled && !['Diagnostic 1', 'Mechanical'].includes(c.calibration_name))
          .map(({ _id, ...rest }) => rest),
        pdfBase64,
        pdfFilename,
        folder_id: sharedFolder?.id || null,
        folder_url: sharedFolder?.url || null,
      }
      const res = await apiFetch(`${API_BASE}/api/books/from-extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      setJobResult(data)
      if (data.folder_id || data.folder_url) {
        setSharedFolder(prev => ({ id: data.folder_id || prev?.id || null, url: data.folder_url || prev?.url || '' }))
      }

      // Also auto-create a Kanban ticket so the job flows like any other
      try {
        const calList = selected.map((cal, i) => ({
          name: cal.calibration_name || cal.name || cal.description || cal.item_name || cal.trigger || `Calibration ${i + 1}`,
          mode: cal.cal_type || cal.mode || 'Static',
        }))
        const jobRes = await apiFetch(`${API_BASE}/api/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop_name: selectedCustomer?.name || jobData.shop || '',
            vehicle: [jobData.year, jobData.make, jobData.model].filter(Boolean).join(' '),
            year: jobData.year || '', make: jobData.make || '', model: jobData.model || '',
            vin: jobData.vin || '', insurer: jobData.insurer || '',
            technician: selectedSalesperson?.name || '',
            scheduled_date: new Date().toISOString().split('T')[0],
            calibrations: JSON.stringify(calList),
            notes: `RO#: ${jobData.ro_number || ''} | Absolute ADAS Invoice: ${data.invoice?.invoice_number || ''}`,
            // Reuse the EXACT folder the reports just landed in (Mark
            // 2026-07-27) — public zohoexternal link, so the card's
            // WorkDrive button never hunts for (or creates) a second
            // folder and outside users can open it.
            folder_url: data.folder_url || sharedFolder?.url || '',
            quote_number: jobData.ro_number || '',
            status: 'need_dispatch',
          }),
        })
        if (!jobRes.ok) {
          let serverMsg = `HTTP ${jobRes.status}`
          try { const j = await jobRes.json(); serverMsg = j.error || serverMsg } catch {}
          throw new Error(serverMsg)
        }
        console.log('[kanban] Auto-ticket from Create-a-Job created OK')
      } catch (autoErr) {
        console.error('[kanban] Auto-ticket from Create-a-Job failed:', autoErr.message)
        setKanbanWarning(`⚠️ Absolute ADAS Books job saved, but the Kanban card was NOT created. Reason: ${autoErr.message}.`)
      }
    } catch (e) {
      setInvoiceError(e.message || 'Failed to create job in Books.')
    } finally {
      setCreatingJob(false)
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      {submitting && <LoadingSplash overlay label="Creating invoice" />}
      {creatingJob && <LoadingSplash overlay label="Creating job" />}

      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-5">

        {/* Demo banner */}
        {jobData._demo && (
          <div
            className="flex items-start gap-2 px-4 py-3 rounded-xl text-sm"
            style={{ backgroundColor: '#fef9e7', border: '1.5px dashed #f5c518', color: '#7a6000' }}
          >
            <span className="mt-0.5">🧪</span>
            <span>
              <strong>Demo mode</strong> —{' '}
              {jobData._demoReason === 'billing'
                ? 'Anthropic API credits not found on this key. Check console.anthropic.com → Billing.'
                : 'Sample data. Add Anthropic API credits to process real Kinetic reports.'}
            </span>
          </div>
        )}

        {/* Job card */}
        <JobCard job={jobData} />

        {/* Customer + Salesperson pickers */}
        <CustomerPicker
          shopName={jobData.shop}
          onSelect={setSelectedCustomer}
        />
        <SalespersonPicker
          onSelect={setSelectedSalesperson}
        />

        {/* Calibration banner */}
        <div
          className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm"
          style={{ backgroundColor: '#fdeee8', border: '1px solid #f5c7b4', color: '#7a2b0e' }}
        >
          <span className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: ORANGE }} />
          Required calibrations are toggled ON. Not Required are toggled OFF — toggle any on to include them in the invoice.
        </div>

        {/* Calibration list */}
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#999' }}
          >
            Calibration Systems
          </p>

          {/* Service add-ons label */}
          <p className="text-xs mb-2" style={{ color: '#aaa' }}>
            Diagnostic 1 and Mechanical appear at the bottom — toggle on if needed.
          </p>

          <div className="flex flex-col gap-3">
            {calibrations.map((cal) => {
              const isService = cal.calibration_name === 'Diagnostic 1' || cal.calibration_name === 'Mechanical'
              if (isService) {
                return (
                  <div key={cal._id}
                    style={{
                      backgroundColor: 'white',
                      border: `1.5px solid ${cal.enabled ? '#e8d5ce' : '#d0d0d0'}`,
                      borderRadius: '12px',
                      padding: '16px',
                      opacity: cal.enabled ? 1 : 0.85,
                      transition: 'all 0.18s ease',
                    }}
                  >
                    {/* Header row: toggle + name + quantity */}
                    <div className="flex items-center gap-3 mb-3">
                      <button
                        onClick={() => toggleCal(cal._id)}
                        style={{
                          flexShrink: 0, width: '40px', height: '22px', borderRadius: '11px',
                          backgroundColor: cal.enabled ? ORANGE : '#d4d4d4', position: 'relative', transition: 'background-color 0.18s',
                        }}
                      >
                        <div style={{
                          position: 'absolute', top: '3px', left: cal.enabled ? '21px' : '3px',
                          width: '16px', height: '16px', borderRadius: '50%', backgroundColor: 'white',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.18s',
                        }} />
                      </button>
                      <span className="flex-1 text-sm font-semibold" style={{ color: '#1a1a1a' }}>
                        {cal.calibration_name}
                      </span>
                      {/* Quantity */}
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-medium" style={{ color: '#888' }}>Qty</span>
                        <button
                          onClick={() => updateCalField(cal._id, 'quantity', Math.max(1, (cal.quantity || 1) - 1))}
                          className="w-6 h-6 rounded flex items-center justify-center text-sm font-bold"
                          style={{ backgroundColor: '#f0eeec', color: '#555' }}
                        >−</button>
                        <span className="w-6 text-center text-sm font-semibold" style={{ color: '#1a1a1a' }}>
                          {cal.quantity || 1}
                        </span>
                        <button
                          onClick={() => updateCalField(cal._id, 'quantity', Math.min(99, (cal.quantity || 1) + 1))}
                          className="w-6 h-6 rounded flex items-center justify-center text-sm font-bold"
                          style={{ backgroundColor: '#f0eeec', color: '#555' }}
                        >+</button>
                      </div>
                    </div>
                    {/* Notes textarea */}
                    <textarea
                      value={cal.description || ''}
                      onChange={e => updateCalField(cal._id, 'description', e.target.value)}
                      onClick={e => e.stopPropagation()}
                      placeholder={
                        cal.calibration_name === 'Diagnostic 1'
                          ? 'What was diagnosed…'
                          : 'What was done / replaced…'
                      }
                      rows={3}
                      style={{
                        width: '100%', padding: '8px 10px', borderRadius: '8px', fontSize: '13px',
                        border: '1px solid #e0dbd6', backgroundColor: '#fafafa', color: '#1a1a1a',
                        resize: 'vertical', outline: 'none', minHeight: '72px',
                      }}
                      onFocus={e => (e.target.style.borderColor = ORANGE)}
                      onBlur={e  => (e.target.style.borderColor = '#e0dbd6')}
                    />
                  </div>
                )
              }
              return <CalibrationRow key={cal._id} cal={cal} onToggle={() => toggleCal(cal._id)} />
            })}

            {showManualForm ? (
              <ManualAddForm onAdd={addManual} onCancel={() => setShowManualForm(false)} />
            ) : (
              <button
                onClick={() => setShowManualForm(true)}
                className="flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-semibold w-full"
                style={{ border: `2px dashed ${ORANGE}`, color: ORANGE, backgroundColor: 'transparent' }}
              >
                <span className="text-lg leading-none">+</span>
                Add missed calibration manually
              </button>
            )}
          </div>
        </div>

        {/* Summary + Approve */}
        <div className="flex flex-col gap-3 pb-8">
          <SummaryBar selected={selected.length} removed={removed.length} />

          {invoiceError && (
            <div
              className="text-sm px-4 py-3 rounded-xl"
              style={{ backgroundColor: '#fff0ed', border: `1px solid ${ORANGE}`, color: ORANGE }}
            >
              {invoiceError}
            </div>
          )}

          {kanbanWarning && (
            <div className="text-sm px-4 py-3 rounded-xl" style={{ backgroundColor: '#fffbeb', border: '1px solid #f5c518', color: '#7a6000' }}>
              ⚠️ {kanbanWarning}
            </div>
          )}

          {pricePreview && (
        <PriceReviewModal
          preview={pricePreview}
          insurer={jobData.insurer}
          poolOverride={poolOverride}
          onPool={changePool}
          onClose={() => setPricePreview(null)}
          onConfirm={handleApprove}
          busy={submitting || previewBusy}
        />
      )}
      {invoiceResult ? (
            <SuccessCard result={invoiceResult} job={jobData} lineCount={selected.length} selectedCustomer={selectedCustomer} onNavigate={onNavigate} />
          ) : jobResult ? (
            <JobSuccessCard result={jobResult} onNavigate={onNavigate} />
          ) : (
            <div className="flex flex-col gap-3">
              {/* Primary: existing Zoho flow — unchanged */}
              <button
                onClick={openPriceReview}
                disabled={selected.length === 0 || submitting || creatingJob || previewBusy}
                className="w-full py-4 rounded-xl text-base font-bold text-white"
                style={{
                  backgroundColor: ORANGE,
                  opacity: selected.length === 0 || submitting || creatingJob || previewBusy ? 0.5 : 1,
                  cursor: selected.length === 0 || submitting || creatingJob || previewBusy ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'Creating Invoice...' : previewBusy ? 'Pricing lines…' : 'Create Zoho Books Invoice'}
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ backgroundColor: '#e5e7eb' }} />
                <span className="text-xs font-medium" style={{ color: '#9ca3af' }}>OR — TEST THE NEW SYSTEM</span>
                <div className="flex-1 h-px" style={{ backgroundColor: '#e5e7eb' }} />
              </div>

              {/* Secondary: Absolute ADAS Books test flow */}
              <button
                onClick={handleCreateJob}
                disabled={selected.length === 0 || submitting || creatingJob}
                className="w-full py-3 rounded-xl text-sm font-semibold transition-colors"
                style={{
                  backgroundColor: '#eff6ff',
                  color: '#2563eb',
                  border: '1.5px solid #bfdbfe',
                  opacity: selected.length === 0 || submitting || creatingJob ? 0.5 : 1,
                  cursor: selected.length === 0 || submitting || creatingJob ? 'not-allowed' : 'pointer',
                }}
              >
                {creatingJob ? 'Creating Job in Absolute ADAS...' : '🧪 Create a Job (Absolute ADAS Books)'}
              </button>
              <p className="text-xs text-center" style={{ color: '#9ca3af' }}>
                Safe to test — creates a draft in Absolute ADAS Books only. No Zoho side effects.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Review-before-create (Mark 2026-08-29): every line the invoice will
// carry, priced by the real matcher, fully editable before anything
// exists in Books — schedule picker, tier swaps, included/paid toggles,
// inline rate edit, quantity stepper, add + remove lines.
function PriceReviewModal({ preview, insurer, poolOverride, onPool, onClose, onConfirm, busy }) {
  const [picks, setPicks] = useState({})       // fixed toggle: name → 'paid' | 'included'
  const [swaps, setSwaps] = useState({})       // name → catalog item pick
  const [swapOpen, setSwapOpen] = useState(null)
  const [swapSearch, setSwapSearch] = useState('')
  const [rateEdits, setRateEdits] = useState({})   // _key → custom rate
  const [qtyEdits, setQtyEdits] = useState({})     // _key → custom qty
  const [removed, setRemoved] = useState({})       // _key → true
  const [added, setAdded] = useState([])           // [{id, name, rate, quantity}]
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(null)   // _key with the editor row open

  const poolByName = Object.fromEntries((preview.pool_items || []).map(it => [it.name, it]))
  const stateOf = li => picks[li.requested] ?? (li.zero_option ? 'paid' : 'included')
  const searchFilter = (items, q) => {
    if (!q) return items.filter(it => it.in_pool !== false)
    const qq = q.toLowerCase()
      .replace('state farm', 'sf').replace('allstate', 'as')
      .replace('american family', 'amfam').replace('cash', 'cp')
    return items.filter(it => it.name.toLowerCase().includes(qq))
  }

  const baseLines = preview.lines.map(li => {
    const swap = swaps[li.requested] && poolByName[swaps[li.requested]]
    let out
    if (swap) out = { ...li, name: swap.name, rate: swap.rate, needs_price: false, included: false, _swapped: true, _toggle: false }
    else if (li.paid_option && stateOf(li) === 'paid') out = { ...li, name: li.paid_option.name, rate: li.paid_option.rate, included: false, _state: 'paid', _toggle: true }
    else if (li.zero_option && stateOf(li) === 'included') out = { ...li, rate: 0, included: true, _state: 'included', _toggle: true }
    else out = { ...li, _state: stateOf(li), _toggle: !!(li.paid_option || li.zero_option) }
    return { ...out, _key: li.requested, _added: false, _editable: !!li.swappable }
  })
  const addedLines = added.map(a => ({
    name: a.name, requested: a.name, rate: a.rate, quantity: a.quantity,
    needs_price: false, included: false, swappable: false,
    _key: a.id, _added: true, _editable: true, _toggle: false,
  }))
  const effective = [...baseLines, ...addedLines]
    .filter(li => !removed[li._key])
    .map(li => {
      const rate = rateEdits[li._key] != null ? rateEdits[li._key] : li.rate
      const quantity = qtyEdits[li._key] != null ? qtyEdits[li._key] : (li.quantity || 1)
      return {
        ...li, rate, quantity,
        amount: Math.round(rate * quantity * 100) / 100,
        included: li.included && rateEdits[li._key] == null,
        _edited: rateEdits[li._key] != null || qtyEdits[li._key] != null,
      }
    })
  const total = Math.round(effective.reduce((sum, l) => sum + l.amount, 0) * 100) / 100
  const flagged = effective.filter(l => l.needs_price)

  function confirm() {
    const overrides = {}
    const zeros = []
    const lineOverrides = {}
    const lineEdits = {}
    for (const li of preview.lines) {
      const key = li.requested
      if (li.swappable && removed[key]) { lineEdits[key] = { remove: true }; continue }
      if (swaps[key] && poolByName[swaps[key]]) lineOverrides[key] = swaps[key]
      else {
        if (li.paid_option && stateOf(li) === 'paid') overrides[key] = li.paid_option.name
        if (li.zero_option && stateOf(li) === 'included') zeros.push(key)
      }
      if (li.swappable) {
        const e = lineEdits[key] || {}
        if (rateEdits[key] != null) e.rate = rateEdits[key]
        if (qtyEdits[key] != null) e.quantity = qtyEdits[key]
        if (Object.keys(e).length) lineEdits[key] = e
      }
    }
    const addedItems = addedLines
      .filter(li => !removed[li._key])
      .map(li => ({
        name: li.name,
        rate: rateEdits[li._key] != null ? rateEdits[li._key] : li.rate,
        quantity: qtyEdits[li._key] != null ? qtyEdits[li._key] : li.quantity,
      }))
    onConfirm(overrides, zeros, lineOverrides, lineEdits, addedItems)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <div className="rounded-2xl p-5 w-full max-w-md max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: 'white' }} onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-base mb-0.5" style={{ color: '#1a1a1a' }}>
          Review pricing before creating
        </h3>
        <p className="text-xs mb-2" style={{ color: '#888' }}>
          {insurer ? `${insurer} — ` : ''}priced on the {preview.insurer_pool === 'standard' ? 'standard' : preview.insurer_pool.toUpperCase()} schedule
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {[
            { id: null,    label: 'Auto' },
            { id: 'STD',   label: 'Standard' },
            { id: 'CP',    label: '💵 Cash' },
            { id: 'SF',    label: 'State Farm' },
            { id: 'AS',    label: 'Allstate' },
            { id: 'AMFAM', label: 'AmFam' },
          ].map(pl => (
            <button key={pl.label} disabled={busy} onClick={() => onPool(pl.id)}
              className="text-[10px] font-bold px-2 py-1 rounded-lg"
              style={poolOverride === pl.id
                ? { backgroundColor: '#1a1a1a', color: 'white' }
                : { backgroundColor: '#f5f3f0', color: '#888' }}>
              {pl.label}
            </button>
          ))}
        </div>
        <div className="rounded-xl overflow-hidden mb-2" style={{ border: '1px solid #eee' }}>
          {effective.map((li, i) => (
            <div key={li._key} className="px-3 py-2 text-sm"
              style={{ borderTop: i ? '1px solid #f0f0f0' : 'none', backgroundColor: li.needs_price ? '#fef2f2' : 'white' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate" style={{ color: li.needs_price ? '#b91c1c' : '#1a1a1a' }}>
                    {li.name}{li._edited ? ' ✎' : ''}
                  </div>
                  {li.quantity > 1 && <div className="text-xs" style={{ color: '#888' }}>× {li.quantity}</div>}
                </div>
                <button onClick={() => li._editable && setEditOpen(editOpen === li._key ? null : li._key)}
                  className="font-bold whitespace-nowrap"
                  style={{ color: li.needs_price ? '#b91c1c' : (li.rate ? '#1a1a1a' : '#9ca3af'), textDecoration: li._editable ? 'underline dotted' : 'none' }}>
                  {li.rate ? '$' + Number(li.amount).toFixed(2) : (li.needs_price ? '$0.00' : 'included')}
                </button>
              </div>
              {editOpen === li._key && li._editable && (
                <div className="flex items-center gap-2 mt-1.5 p-2 rounded-lg" style={{ backgroundColor: '#f8f7f5' }}
                  onClick={e => e.stopPropagation()}>
                  <span className="text-[10px] font-bold" style={{ color: '#888' }}>$</span>
                  <input type="number" step="0.01" min="0" defaultValue={li.rate}
                    onChange={e => { const v = parseFloat(e.target.value); setRateEdits(prev => ({ ...prev, [li._key]: Number.isFinite(v) ? v : 0 })) }}
                    className="w-20 px-2 py-1 rounded text-xs font-bold focus:outline-none"
                    style={{ border: '1px solid #ddd' }} />
                  <div className="flex items-center gap-1 ml-1">
                    <button onClick={() => setQtyEdits(prev => ({ ...prev, [li._key]: Math.max(1, (prev[li._key] ?? li.quantity) - 1) }))}
                      className="w-6 h-6 rounded font-bold text-xs" style={{ backgroundColor: '#eee' }}>−</button>
                    <span className="text-xs font-bold w-5 text-center">{li.quantity}</span>
                    <button onClick={() => setQtyEdits(prev => ({ ...prev, [li._key]: (prev[li._key] ?? li.quantity) + 1 }))}
                      className="w-6 h-6 rounded font-bold text-xs" style={{ backgroundColor: '#eee' }}>+</button>
                  </div>
                  <button onClick={() => { setRemoved(prev => ({ ...prev, [li._key]: true })); setEditOpen(null) }}
                    className="ml-auto text-[10px] font-bold px-2 py-1 rounded-lg"
                    style={{ backgroundColor: '#fee2e2', color: '#b91c1c' }}>✕ Remove</button>
                </div>
              )}
              {li.swappable && (preview.pool_items || []).length > 0 && (
                <div className="mt-1.5">
                  <button onClick={() => { setSwapOpen(swapOpen === li.requested ? null : li.requested); setSwapSearch('') }}
                    className="text-[10px] font-bold px-2 py-1 rounded-lg"
                    style={{ backgroundColor: li._swapped ? '#1d4ed8' : '#f5f3f0', color: li._swapped ? 'white' : '#666' }}>
                    {li._swapped ? '✓ item set — change' : (li.learned_tier ? '✓ learned tier — change' : 'change tier / item')}
                  </button>
                  {swapOpen === li.requested && (
                    <div className="mt-1.5 rounded-lg overflow-hidden" style={{ border: '1px solid #e5e7eb' }}>
                      {(preview.pool_items || []).length > 12 && (
                        <input autoFocus value={swapSearch} onChange={e => setSwapSearch(e.target.value)}
                          placeholder="Search items…"
                          className="w-full px-2.5 py-1.5 text-xs focus:outline-none"
                          style={{ borderBottom: '1px solid #e5e7eb' }} />
                      )}
                      {searchFilter(preview.pool_items || [], swapSearch).slice(0, 30).map(it => (
                        <button key={it.name}
                          onClick={() => { setSwaps(prev => ({ ...prev, [li.requested]: it.name })); setSwapOpen(null); setSwapSearch('') }}
                          className="w-full flex justify-between px-2.5 py-1.5 text-xs font-semibold"
                          style={{ backgroundColor: 'white', color: '#333', borderTop: '1px solid #f3f4f6' }}>
                          <span className="truncate">{it.name}</span>
                          <span style={{ color: '#888' }}>${Number(it.rate).toFixed(0)}</span>
                        </button>
                      ))}
                      {swaps[li.requested] && (
                        <button onClick={() => { setSwaps(prev => { const n = { ...prev }; delete n[li.requested]; return n }); setSwapOpen(null) }}
                          className="w-full px-2.5 py-1.5 text-xs font-semibold"
                          style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>
                          Reset to auto-match
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {li._toggle && (
                <div className="flex gap-1.5 mt-1.5">
                  <button onClick={() => setPicks(prev => ({ ...prev, [li.requested]: 'included' }))}
                    className="text-[10px] font-bold px-2 py-1 rounded-lg"
                    style={li._state === 'included' ? { backgroundColor: '#1a1a1a', color: 'white' } : { backgroundColor: '#f5f3f0', color: '#888' }}>
                    Included $0
                  </button>
                  <button onClick={() => setPicks(prev => ({ ...prev, [li.requested]: 'paid' }))}
                    className="text-[10px] font-bold px-2 py-1 rounded-lg"
                    style={li._state === 'paid' ? { backgroundColor: ORANGE, color: 'white' } : { backgroundColor: '#f5f3f0', color: '#888' }}>
                    Paid ${Number((li.paid_option ? li.paid_option.rate : li.rate) || 0).toFixed(0)}
                  </button>
                </div>
              )}
            </div>
          ))}
          <div className="flex justify-between px-3 py-2.5 text-sm font-extrabold"
            style={{ borderTop: '2px solid #e5e5e5', backgroundColor: '#fafaf9' }}>
            <span>TOTAL</span><span>${Number(total).toFixed(2)}</span>
          </div>
        </div>
        <div className="mb-3">
          <button onClick={() => { setAddOpen(o => !o); setSwapSearch('') }}
            className="text-xs font-bold px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: '#eff6ff', color: '#1d4ed8' }}>
            + Add item
          </button>
          {addOpen && (
            <div className="mt-1.5 rounded-lg overflow-hidden" style={{ border: '1px solid #e5e7eb' }}>
              <input autoFocus value={swapSearch} onChange={e => setSwapSearch(e.target.value)}
                placeholder="Search catalog…"
                className="w-full px-2.5 py-1.5 text-xs focus:outline-none"
                style={{ borderBottom: '1px solid #e5e7eb' }} />
              {searchFilter(preview.pool_items || [], swapSearch).slice(0, 30).map(it => (
                <button key={it.name}
                  onClick={() => {
                    setAdded(prev => [...prev, { id: `add_${prev.length}_${it.name}`, name: it.name, rate: it.rate, quantity: 1 }])
                    setAddOpen(false); setSwapSearch('')
                  }}
                  className="w-full flex justify-between px-2.5 py-1.5 text-xs font-semibold"
                  style={{ backgroundColor: 'white', color: '#333', borderTop: '1px solid #f3f4f6' }}>
                  <span className="truncate">{it.name}</span>
                  <span style={{ color: '#888' }}>${Number(it.rate).toFixed(0)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {flagged.length > 0 && (
          <p className="text-xs font-semibold rounded-lg px-3 py-2 mb-3"
            style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>
            ⚠ {flagged.length} unmatched line{flagged.length > 1 ? 's' : ''} — no price found. It will land on the invoice at $0 flagged for pricing.
          </p>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ backgroundColor: '#f5f3f0', color: '#666' }}>Cancel</button>
          <button onClick={confirm} disabled={busy}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: ORANGE }}>
            {busy ? 'Creating…' : `Create invoice — $${Number(total).toFixed(2)} →`}
          </button>
        </div>
      </div>
    </div>
  )
}

function SendQuoteButton({ result, job, lineCount, selectedCustomer }) {
  const [phase, setPhase] = useState('idle')  // idle | loading | review | sending | sent | error
  const [preview, setPreview] = useState(null)
  const [msg, setMsg] = useState('')
  if (!result.quoteId) return null

  // Step 1: fetch every line the shop will see (Mark: "i need to know
  // every line on the estimate before the quote is sent").
  async function openReview() {
    setPhase('loading')
    try {
      const r = await apiFetch(`${API_BASE}/api/shop-quotes/preview?estimate_id=${encodeURIComponent(result.quoteId)}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`)
      setPreview(d)
      setPhase('review')
    } catch (e) { setMsg(e.message); setPhase('error') }
  }

  // Step 2: only after Mark has seen the lines does anything send.
  async function send() {
    setPhase('sending')
    try {
      const r = await apiFetch(`${API_BASE}/api/shop-quotes/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estimate_id: result.quoteId,
          meta: {
            shop: selectedCustomer?.name || job.shop || '',
            vehicle: [job.year, job.make, job.model].filter(Boolean).join(' '),
            vin: job.vin || '', ro_number: job.ro_number || '', claim: job.claim || '',
            insurer: job.insurer || '', cal_count: lineCount,
          },
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`)
      setMsg(`Sent to ${(d.sent_to || []).join(', ')}`)
      setPhase('sent')
    } catch (e) { setMsg(e.message); setPhase('error') }
  }

  if (phase === 'sent') return (
    <div className="text-sm font-semibold rounded-xl px-4 py-2.5 text-center"
      style={{ backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1.5px solid #bfdbfe' }}>
      📤 Quote emailed — {msg}. It's on the Jobs board under Quotes Out.
    </div>
  )

  const zeroLines = (preview?.line_items || []).filter(li => li.needs_price)
  return (
    <div className="flex flex-col gap-1.5">
      <button onClick={openReview} disabled={phase === 'loading' || phase === 'sending'}
        className="w-full py-3 rounded-xl font-bold text-white text-sm tracking-wide transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ backgroundColor: '#1d4ed8' }}>
        {phase === 'loading' ? 'Loading lines…' : '📤 Send Quote to Shop'}
      </button>
      {phase === 'error' && (
        <p className="text-xs font-semibold text-center" style={{ color: '#b91c1c' }}>{msg} — tap to retry</p>
      )}
      {phase !== 'idle' && phase !== 'error' && preview && (phase === 'review' || phase === 'sending') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} onClick={() => setPhase('idle')}>
          <div className="rounded-2xl p-5 w-full max-w-md max-h-[85vh] overflow-y-auto"
            style={{ backgroundColor: 'white' }} onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-base mb-0.5" style={{ color: '#1a1a1a' }}>
              Quote {preview.estimate_number} — review before sending
            </h3>
            <p className="text-xs mb-3" style={{ color: '#888' }}>
              To: {preview.sent_to?.length ? preview.sent_to.join(', ') : '⚠ no email on file'}
            </p>
            <div className="rounded-xl overflow-hidden mb-3" style={{ border: '1px solid #eee' }}>
              {preview.line_items.map((li, i) => (
                <div key={i} className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
                  style={{ borderTop: i ? '1px solid #f0f0f0' : 'none', backgroundColor: li.needs_price ? '#fef2f2' : 'white' }}>
                  <div className="min-w-0">
                    <div className="font-semibold truncate" style={{ color: li.needs_price ? '#b91c1c' : '#1a1a1a' }}>
                      {li.name}
                    </div>
                    {li.quantity > 1 && <div className="text-xs" style={{ color: '#888' }}>× {li.quantity}</div>}
                  </div>
                  <div className="font-bold whitespace-nowrap" style={{ color: li.needs_price ? '#b91c1c' : (li.rate ? '#1a1a1a' : '#9ca3af') }}>
                    {li.rate ? '$' + Number(li.amount).toFixed(2) : (li.needs_price ? '$0.00' : 'included')}
                  </div>
                </div>
              ))}
              <div className="flex justify-between px-3 py-2.5 text-sm font-extrabold"
                style={{ borderTop: '2px solid #e5e5e5', backgroundColor: '#fafaf9' }}>
                <span>TOTAL</span><span>${Number(preview.total).toFixed(2)}</span>
              </div>
            </div>
            {zeroLines.length > 0 && (
              <p className="text-xs font-semibold rounded-lg px-3 py-2 mb-3"
                style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>
                ⚠ {zeroLines.length} unmatched line{zeroLines.length > 1 ? 's' : ''} — no price found in Books. Fix before sending or the shop sees $0.
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={() => setPhase('idle')} disabled={phase === 'sending'}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ backgroundColor: '#f5f3f0', color: '#666' }}>Cancel</button>
              <button onClick={send} disabled={phase === 'sending' || !preview.sent_to?.length}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60"
                style={{ backgroundColor: '#1d4ed8' }}>
                {phase === 'sending' ? 'Sending…' : `Send ${preview.line_items.length} lines →`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SuccessCard({ result, job, lineCount, selectedCustomer, onNavigate }) {
  return (
    <div className="rounded-xl px-5 py-4 flex flex-col gap-3" style={{ backgroundColor: '#f0faf4', border: '1.5px solid #6fcf97' }}>
      <div className="flex items-center gap-2">
        <span className="text-lg">✓</span>
        <span className="font-semibold text-sm" style={{ color: '#1a6b3a' }}>Zoho Books Invoice Created</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <SuccessField label="RO Number" value={job.ro_number} />
        <SuccessField label="Shop" value={selectedCustomer?.name || job.shop} />
        <SuccessField label="Line Items" value={lineCount} />
        {result.quoteNumber && <SuccessField label="Invoice #" value={result.quoteNumber} />}
      </div>

      <SendQuoteButton result={result} job={job} lineCount={lineCount} selectedCustomer={selectedCustomer} />

      {/* Links row */}
      <div className="flex flex-col gap-2 pt-1" style={{ borderTop: '1px solid #b7e4c7' }}>
        {result.quoteUrl && (
          <a
            href={result.quoteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm font-semibold"
            style={{ color: '#1a6b3a' }}
          >
            <span>📄</span> Open in Zoho Books →
          </a>
        )}
        {result.shareLink ? (
          <a
            href={result.shareLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm font-semibold"
            style={{ color: '#1a6b3a' }}
          >
            <span>📁</span> Open WorkDrive Folder →
          </a>
        ) : (
          <p className="text-xs" style={{ color: '#888' }}>
            WorkDrive folder not created — check WorkDrive scopes in your token.
          </p>
        )}
      </div>

      {/* Unmatched items warning */}
      {result.unmatchedItems && (
        <div
          className="rounded-lg px-3 py-2.5 text-xs"
          style={{ backgroundColor: '#fff8e6', border: '1px solid #f5d97a', color: '#7a5e00' }}
        >
          <p className="font-semibold mb-1">⚠️ These items weren't found in your Zoho catalog:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {result.unmatchedItems.map((name) => (
              <li key={name} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{name}</li>
            ))}
          </ul>
          <p className="mt-1.5">New items may have been created. Add them to your Zoho Books item catalog so they match next time.</p>
        </div>
      )}

      {/* Navigation button */}
      <button
        onClick={() => onNavigate && onNavigate('kanban')}
        className="w-full py-3 rounded-xl text-sm font-semibold mt-1"
        style={{ backgroundColor: '#1a6b3a', color: 'white' }}
      >
        🗂 View Job Board
      </button>
    </div>
  )
}

function SuccessField({ label, value }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider" style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#888' }}>{label}</p>
      <p className="font-medium" style={{ color: '#1a1a1a' }}>{value || '—'}</p>
    </div>
  )
}

function JobSuccessCard({ result, onNavigate }) {
  const inv = result.invoice
  const shop = result.matched_shop
  const unmatched = result.unmatched_calibrations || []
  return (
    <div className="rounded-xl px-5 py-4 flex flex-col gap-3"
      style={{ backgroundColor: '#eff6ff', border: '1.5px solid #93c5fd' }}>
      <div className="flex items-center gap-2">
        <span className="text-lg">✓</span>
        <h3 className="font-bold" style={{ color: '#1d4ed8' }}>
          Job Drafted in Absolute ADAS Books
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <SuccessField label="Invoice #" value={inv.invoice_number} />
        <SuccessField label="Total" value={`$${Number(inv.total).toFixed(2)}`} />
        <SuccessField label="Customer" value={inv.customer_name} />
        <SuccessField label="Status" value="Draft (not sent)" />
      </div>
      {shop && result.applied_billing_rules && (
        <p className="text-xs" style={{ color: '#1d4ed8' }}>
          ✓ Matched CRM shop "{shop.shop_name}" — billing rules applied
          {inv.discount > 0 && ` · ${inv.discount_pct || ''}% discount = $${inv.discount.toFixed(2)}`}
        </p>
      )}
      {shop && !result.applied_billing_rules && (
        <p className="text-xs" style={{ color: '#6b7280' }}>
          Matched CRM shop "{shop.shop_name}" · no billing rules configured yet
        </p>
      )}
      {!shop && (
        <p className="text-xs" style={{ color: '#b45309' }}>
          ⚠ No CRM shop match — invoice created without billing rules. Add this customer to CRM for auto-discount on next job.
        </p>
      )}
      {unmatched.length > 0 && (
        <div className="text-xs rounded-lg p-2.5"
          style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
          <strong>Unmatched calibrations (priced at $0):</strong>
          <ul className="mt-1 ml-4 list-disc">
            {unmatched.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
          <p className="mt-1.5">Add these to your Services catalog in Books so they price correctly next time.</p>
        </div>
      )}
      <div className="flex gap-2 pt-2" style={{ borderTop: '1px solid #bfdbfe' }}>
        <button
          onClick={() => onNavigate && onNavigate('books')}
          className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white"
          style={{ backgroundColor: '#2563eb' }}>
          Review in Books →
        </button>
        <button
          onClick={() => onNavigate && onNavigate('kanban')}
          className="flex-1 py-2.5 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: 'white', color: '#2563eb', border: '1.5px solid #bfdbfe' }}>
          View Job Board
        </button>
      </div>
    </div>
  )
}
