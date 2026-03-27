import { API_BASE, apiFetch } from '../utils/api.js'
import { useState } from 'react'
import JobCard from './JobCard'
import CalibrationRow from './CalibrationRow'
import ManualAddForm from './ManualAddForm'
import SummaryBar from './SummaryBar'
import CustomerPicker from './CustomerPicker'
import SalespersonPicker from './SalespersonPicker'
import Navbar from './Navbar'

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
  const [invoiceResult, setInvoiceResult] = useState(null)
  const [invoiceError, setInvoiceError] = useState(null)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [selectedSalesperson, setSelectedSalesperson] = useState(null)
  const [kanbanWarning, setKanbanWarning] = useState(null)

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

  async function handleApprove() {
    if (selected.length === 0) return
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
        pdfBase64,
        pdfFilename,
      }
      const res = await apiFetch(`${API_BASE}/api/create-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      setInvoiceResult(data)

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
        await apiFetch(`${API_BASE}/api/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop_name: selectedCustomer?.name || jobData.shop || '',
            vehicle: [jobData.year, jobData.make, jobData.model].filter(Boolean).join(' '),
            vin: jobData.vin || '',
            insurer: jobData.insurer || '',
            technician: selectedSalesperson?.name || '',
            scheduled_date: new Date().toISOString().split('T')[0],
            calibrations: JSON.stringify(calList),
            notes: `RO#: ${jobData.ro_number || ''} | Quote: ${data.quoteNumber || ''}`,
            report_url: data.quoteUrl || data.folderUrl || '',
            status: 'need_dispatch',
          }),
        })
      } catch (autoErr) {
        // Fix #7 — surface the failure instead of silently ignoring it
        console.warn('[kanban] Auto-ticket failed:', autoErr.message)
        setKanbanWarning('Quote created, but the Kanban ticket could not be auto-created. Add it manually on the Job Board.')
      }
    } catch (e) {
      setInvoiceError(e.message || 'Failed to create invoice. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

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

          {invoiceResult ? (
            <SuccessCard result={invoiceResult} job={jobData} lineCount={selected.length} selectedCustomer={selectedCustomer} />

          ) : (
            <button
              onClick={handleApprove}
              disabled={selected.length === 0 || submitting}
              className="w-full py-4 rounded-xl text-base font-bold text-white"
              style={{
                backgroundColor: ORANGE,
                opacity: selected.length === 0 || submitting ? 0.5 : 1,
                cursor: selected.length === 0 || submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Creating Invoice...' : 'Create Zoho Books Invoice'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SuccessCard({ result, job, lineCount, selectedCustomer }) {
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
