import { useState } from 'react'
import JobCard from './JobCard'
import CalibrationRow from './CalibrationRow'
import ManualAddForm from './ManualAddForm'
import SummaryBar from './SummaryBar'
import CustomerPicker from './CustomerPicker'
import SalespersonPicker from './SalespersonPicker'

const ORANGE = '#CD4419'

export default function ToggleBoard({ jobData, pdfFile, onReset }) {
  const [calibrations, setCalibrations] = useState(
    jobData.calibrations.map((c, i) => ({ ...c, _id: i }))
  )
  const [showManualForm, setShowManualForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [invoiceResult, setInvoiceResult] = useState(null)
  const [invoiceError, setInvoiceError] = useState(null)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [selectedSalesperson, setSelectedSalesperson] = useState(null)

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
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
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
          reader.onload = () => resolve(reader.result.split(',')[1]) // strip data:...;base64,
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
      const res = await fetch('/api/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      // Save to localStorage history
      try {
        const hist = JSON.parse(localStorage.getItem('adasiq_history') || '[]')
        hist.unshift({
          quoteNumber: data.quoteNumber,
          quoteUrl:    data.quoteUrl,
          folderUrl:   data.folderUrl,
          vehicle:     [jobData.year, jobData.make, jobData.model].filter(Boolean).join(' '),
          shop:        selectedCustomer?.name || jobData.shop,
          createdAt:   new Date().toISOString(),
        })
        localStorage.setItem('adasiq_history', JSON.stringify(hist.slice(0, 50)))
      } catch { /* ignore */ }
      setInvoiceResult(data)
    } catch (e) {
      setInvoiceError(e.message || 'Failed to create invoice. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{
          backgroundColor: 'white',
          borderBottom: '1px solid #ece8e4',
          boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: ORANGE }}
          >
            <span className="text-white text-sm font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
              IQ
            </span>
          </div>
          <span className="text-base font-bold tracking-tight" style={{ color: '#1a1a1a' }}>
            ADAS IQ
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
            style={{ backgroundColor: '#fdeee8', color: ORANGE }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ORANGE }} />
            Review Required
          </div>
          <button
            onClick={handleDownloadPDF}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold"
            style={{ backgroundColor: '#f0ece8', color: '#555' }}
            title="Download ADAS IQ PDF Report"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            PDF
          </button>
          <button
            onClick={onReset}
            className="text-xs px-2 py-1 rounded-lg"
            style={{ color: '#aaa', backgroundColor: '#f5f3f0' }}
          >
            ← New
          </button>
        </div>
      </header>

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

          <div className="flex flex-col gap-3">
            {calibrations.map((cal) => (
              <CalibrationRow key={cal._id} cal={cal} onToggle={() => toggleCal(cal._id)} />
            ))}

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
              {submitting ? 'Creating Quote...' : 'Create Zoho Books Quote'}
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
        <span className="font-semibold text-sm" style={{ color: '#1a6b3a' }}>Zoho Books Quote Created</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <SuccessField label="RO Number" value={job.ro_number} />
        <SuccessField label="Shop" value={selectedCustomer?.name || job.shop} />
        <SuccessField label="Line Items" value={lineCount} />
        {result.quoteNumber && <SuccessField label="Quote #" value={result.quoteNumber} />}
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
