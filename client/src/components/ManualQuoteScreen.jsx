import { useState } from 'react'
import CustomerPicker from './CustomerPicker'
import SalespersonPicker from './SalespersonPicker'

const ORANGE = '#CD4419'
const ORANGE_LIGHT = '#fdf3ef'
const ORANGE_BORDER = '#e8c5b0'
const BORDER = '#e0dbd6'
const MUTED = '#888'
const DARK = '#1a1a1a'

// ── Reusable field components ─────────────────────────────────────────────────

function Label({ children }) {
  return (
    <span className="block text-xs font-semibold mb-1" style={{ color: MUTED, letterSpacing: '0.04em' }}>
      {children}
    </span>
  )
}

function Input({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all"
      style={{ border: `1px solid ${BORDER}`, backgroundColor: 'white', color: DARK }}
      onFocus={(e) => (e.target.style.borderColor = ORANGE)}
      onBlur={(e)  => (e.target.style.borderColor = BORDER)}
    />
  )
}

function Section({ title, children }) {
  return (
    <div className="rounded-xl p-4 mb-4"
      style={{ backgroundColor: 'white', border: `1px solid ${BORDER}` }}>
      <p className="text-xs font-bold mb-3 uppercase tracking-widest" style={{ color: MUTED }}>
        {title}
      </p>
      {children}
    </div>
  )
}

// ── Item list (reused for both Diagnostic and Mechanical) ─────────────────────

function ItemList({ items, onAdd, onRemove, onToggle, inputValue, onInputChange, placeholder }) {
  return (
    <>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAdd()}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
          style={{ border: `1px solid ${BORDER}`, color: DARK }}
          onFocus={(e) => (e.target.style.borderColor = ORANGE)}
          onBlur={(e)  => (e.target.style.borderColor = BORDER)}
        />
        <button onClick={onAdd}
          className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: ORANGE, color: 'white' }}>
          Add
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-center py-3" style={{ color: '#ccc' }}>No items added yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div key={item._id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
              style={{
                backgroundColor: item.enabled ? ORANGE_LIGHT : '#f4f2f0',
                border: `1px solid ${item.enabled ? ORANGE_BORDER : BORDER}`,
              }}>
              {/* Toggle */}
              <button onClick={() => onToggle(item._id)}
                className="flex-shrink-0 w-10 h-5 rounded-full relative transition-colors"
                style={{ backgroundColor: item.enabled ? ORANGE : '#ccc' }}>
                <span className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all"
                  style={{ left: item.enabled ? '22px' : '2px' }} />
              </button>
              <span className="flex-1 text-sm font-medium"
                style={{ color: item.enabled ? DARK : '#aaa' }}>
                {item.calibration_name}
              </span>
              <button onClick={() => onRemove(item._id)}
                className="text-xs px-2 py-1 rounded"
                style={{ color: '#bbb' }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ManualQuoteScreen({ onBack }) {
  // Job fields
  const [roNumber, setRoNumber] = useState('')
  const [insurer,  setInsurer]  = useState('')
  const [claim,    setClaim]    = useState('')

  // Vehicle fields
  const [year,  setYear]  = useState('')
  const [make,  setMake]  = useState('')
  const [model, setModel] = useState('')
  const [vin,   setVin]   = useState('')

  // Zoho pickers
  const [selectedCustomer,    setSelectedCustomer]    = useState(null)
  const [selectedSalesperson, setSelectedSalesperson] = useState(null)

  // Diagnostic items
  const [diagnosticItems, setDiagnosticItems] = useState([])
  const [diagInput,       setDiagInput]       = useState('')

  // Mechanical items
  const [mechanicalItems, setMechanicalItems] = useState([])
  const [mechInput,       setMechInput]       = useState('')

  // Submit state
  const [submitting,   setSubmitting]   = useState(false)
  const [submitError,  setSubmitError]  = useState(null)
  const [submitResult, setSubmitResult] = useState(null)

  // ── Helpers ───────────────────────────────────────────────────────────────

  function makeAdder(setItems, setInput, input) {
    return () => {
      const name = input.trim()
      if (!name) return
      setItems((prev) => [...prev, { _id: Date.now(), calibration_name: name, enabled: true }])
      setInput('')
    }
  }

  function makeRemover(setItems) {
    return (id) => setItems((prev) => prev.filter((i) => i._id !== id))
  }

  function makeToggler(setItems) {
    return (id) => setItems((prev) =>
      prev.map((i) => (i._id === id ? { ...i, enabled: !i.enabled } : i))
    )
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!selectedCustomer) {
      setSubmitError('Please select a customer.')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      // Combine all items — backend treats them as line items regardless of category
      const allItems = [
        ...diagnosticItems,
        ...mechanicalItems,
      ].map(({ _id, ...rest }) => rest)

      const payload = {
        customerId:      selectedCustomer?.id   || null,
        customerName:    selectedCustomer?.name || null,
        salespersonId:   selectedSalesperson?.id   || null,
        salespersonName: selectedSalesperson?.name || null,
        shop:            selectedCustomer?.name || null,
        ro_number:       roNumber || null,
        insurer:         insurer  || null,
        claim:           claim    || null,
        vin:             vin      || null,
        year:            year     || null,
        make:            make     || null,
        model:           model    || null,
        vehicle:         [year, make, model].filter(Boolean).join(' ') || null,
        calibrations:    allItems,
        pdfBase64:       null,
        pdfFilename:     null,
      }

      const res = await fetch('/api/create-invoice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
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
          vehicle:     [year, make, model].filter(Boolean).join(' '),
          shop:        selectedCustomer?.name || null,
          createdAt:   new Date().toISOString(),
        })
        localStorage.setItem('adasiq_history', JSON.stringify(hist.slice(0, 50)))
      } catch { /* ignore */ }
      setSubmitResult(data)
    } catch (e) {
      setSubmitError(e.message || 'Failed to create quote.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Success screen ────────────────────────────────────────────────────────

  if (submitResult) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
        style={{ backgroundColor: '#f5f3f0' }}>
        <div className="w-full max-w-lg rounded-2xl p-8 text-center"
          style={{ backgroundColor: 'white', border: `1px solid ${BORDER}` }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: '#edfaf3' }}>
            <span className="text-2xl">✓</span>
          </div>
          <h2 className="text-xl font-bold mb-1" style={{ color: DARK }}>Quote Created!</h2>
          <p className="text-sm mb-6" style={{ color: MUTED }}>{submitResult.quoteNumber}</p>

          <a href={submitResult.quoteUrl} target="_blank" rel="noopener noreferrer"
            className="block w-full py-3 rounded-xl text-white text-sm font-semibold mb-3 text-center"
            style={{ backgroundColor: ORANGE }}>
            Open in Zoho Books →
          </a>

          {submitResult.folderUrl && (
            <a href={submitResult.folderUrl} target="_blank" rel="noopener noreferrer"
              className="block w-full py-3 rounded-xl text-sm font-semibold mb-3 text-center"
              style={{ backgroundColor: ORANGE_LIGHT, color: ORANGE, border: `1px solid ${ORANGE_BORDER}` }}>
              Open WorkDrive Folder →
            </a>
          )}

          <button onClick={onBack}
            className="w-full py-3 rounded-xl text-sm font-semibold"
            style={{ backgroundColor: '#f0eeec', color: MUTED }}>
            ← Back to Home
          </button>
        </div>
      </div>
    )
  }

  // ── Form ──────────────────────────────────────────────────────────────────

  const totalItems = diagnosticItems.length + mechanicalItems.length

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      {/* Header */}
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{ backgroundColor: 'white', borderBottom: `1px solid ${BORDER}`, boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: ORANGE }}>
            <span className="text-white text-sm font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>IQ</span>
          </div>
          <span className="text-base font-bold" style={{ color: DARK }}>Manual Quote</span>
        </div>
        <button onClick={onBack} className="text-sm px-3 py-1.5 rounded-lg"
          style={{ color: MUTED, backgroundColor: '#f0eeec' }}>
          ← Back
        </button>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Customer */}
        <Section title="Customer">
          <CustomerPicker
            shopName=""
            onSelect={(c) => setSelectedCustomer(c ? { id: c.contact_id, name: c.contact_name } : null)}
          />
        </Section>

        {/* Salesperson */}
        <Section title="Salesperson">
          <SalespersonPicker
            onSelect={(s) => setSelectedSalesperson(s ? { id: s.user_id, name: s.name } : null)}
          />
        </Section>

        {/* Job Info */}
        <Section title="Job Info">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>RO NUMBER</Label>
              <Input value={roNumber} onChange={setRoNumber} placeholder="e.g. 24249" />
            </div>
            <div>
              <Label>INSURER</Label>
              <Input value={insurer} onChange={setInsurer} placeholder="State Farm" />
            </div>
            <div>
              <Label>CLAIM #</Label>
              <Input value={claim} onChange={setClaim} placeholder="CLM-00001" />
            </div>
          </div>
        </Section>

        {/* Vehicle */}
        <Section title="Vehicle">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <Label>YEAR</Label>
              <Input value={year} onChange={setYear} placeholder="2022" />
            </div>
            <div>
              <Label>MAKE</Label>
              <Input value={make} onChange={setMake} placeholder="Toyota" />
            </div>
            <div>
              <Label>MODEL</Label>
              <Input value={model} onChange={setModel} placeholder="RAV4" />
            </div>
          </div>
          <div>
            <Label>VIN</Label>
            <Input value={vin} onChange={setVin} placeholder="1HGBH41JXMN109186" />
          </div>
        </Section>

        {/* Diagnostic */}
        <Section title={`Diagnostic${diagnosticItems.length > 0 ? ` (${diagnosticItems.length})` : ''}`}>
          <ItemList
            items={diagnosticItems}
            inputValue={diagInput}
            onInputChange={setDiagInput}
            onAdd={makeAdder(setDiagnosticItems, setDiagInput, diagInput)}
            onRemove={makeRemover(setDiagnosticItems)}
            onToggle={makeToggler(setDiagnosticItems)}
            placeholder="e.g. Diagnostic 1, Scan Report..."
          />
        </Section>

        {/* Mechanical */}
        <Section title={`Mechanical${mechanicalItems.length > 0 ? ` (${mechanicalItems.length})` : ''}`}>
          <ItemList
            items={mechanicalItems}
            inputValue={mechInput}
            onInputChange={setMechInput}
            onAdd={makeAdder(setMechanicalItems, setMechInput, mechInput)}
            onRemove={makeRemover(setMechanicalItems)}
            onToggle={makeToggler(setMechanicalItems)}
            placeholder="e.g. TCM Reprogram, Module Programming..."
          />
        </Section>

        {totalItems === 0 && (
          <p className="text-xs text-center mb-4" style={{ color: '#bbb' }}>
            No items added — the 3 fixed line items will still be included on the quote.
          </p>
        )}

        {/* Error */}
        {submitError && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm"
            style={{ backgroundColor: '#fff0ed', border: `1px solid ${ORANGE}`, color: ORANGE }}>
            {submitError}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-4 rounded-xl text-white font-bold text-base mb-8"
          style={{ backgroundColor: submitting ? '#d4957a' : ORANGE, cursor: submitting ? 'default' : 'pointer' }}>
          {submitting ? 'Creating Quote…' : 'Create Zoho Books Quote'}
        </button>

      </div>
    </div>
  )
}
