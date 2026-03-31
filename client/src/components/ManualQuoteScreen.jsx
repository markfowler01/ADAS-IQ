import { API_BASE, apiFetch } from '../utils/api.js'
import { useState } from 'react'
import CustomerPicker from './CustomerPicker'
import SalespersonPicker from './SalespersonPicker'
import Navbar from './Navbar'

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

// ── Standard calibrations pre-populated in Manual Invoice ─────────────────────
const STANDARD_CALS = [
  'Front Camera',
  'Rear Camera',
  'Blind Spot / Rear Radar',
  'Steering Angle Sensor',
  'Lane Keep Assist',
  'Front Radar',
  'Cross Traffic',
  '360 / Surround View',
  'Parking Sensors',
  'Night Vision',
  'Head-Up Display',
  'Adaptive Headlights',
  'Adaptive Cruise Control',
  'Diagnostic 1',
  'Mechanical',
]

// ── Main component ────────────────────────────────────────────────────────────

export default function ManualQuoteScreen({ onBack, user, onLogout, currentScreen, onNavigate }) {
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

  // Calibrations — pre-populated, all off
  const [calibrations, setCalibrations] = useState(
    STANDARD_CALS.map((name, i) => ({ _id: i, calibration_name: name, enabled: false, quantity: 1, description: '' }))
  )
  const [customInput, setCustomInput] = useState('')

  // Notes / story field
  const [notes, setNotes] = useState('')

  // Submit state
  const [submitting,   setSubmitting]   = useState(false)
  const [submitError,  setSubmitError]  = useState(null)
  const [submitResult, setSubmitResult] = useState(null)

  // ── Helpers ───────────────────────────────────────────────────────────────

  function toggleCal(id) {
    setCalibrations(prev => prev.map(c => c._id === id ? { ...c, enabled: !c.enabled } : c))
  }

  function removeCal(id) {
    setCalibrations(prev => prev.filter(c => c._id !== id))
  }

  function updateCalField(id, field, value) {
    setCalibrations(prev => prev.map(c => c._id === id ? { ...c, [field]: value } : c))
  }

  function addCustomCal() {
    const name = customInput.trim()
    if (!name) return
    setCalibrations(prev => [...prev, { _id: Date.now(), calibration_name: name, enabled: true, quantity: 1, description: '' }])
    setCustomInput('')
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
      const enabledItems = calibrations
        .filter(c => c.enabled)
        .map(({ _id, ...rest }) => rest)

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
        calibrations:    enabledItems,
        notes:           notes.trim() || null,
        pdfBase64:       null,
        pdfFilename:     null,
      }

      const res = await apiFetch(`${API_BASE}/api/create-invoice`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      setSubmitResult(data)

      // Save to server history (fire-and-forget)
      try {
        await apiFetch(`${API_BASE}/api/history`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop:        selectedCustomer?.name || '',
            vehicle:     [year, make, model].filter(Boolean).join(' '),
            roNumber:    roNumber || '',
            vin:         vin || '',
            calibrations: calibrations
              .filter(i => i.enabled)
              .map(i => i.calibration_name)
              .filter(Boolean),
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
        const enabledCals = calibrations.filter(c => c.enabled)
        const calList = enabledCals.map((cal, i) => ({
          name: cal.calibration_name || `Calibration ${i + 1}`,
          mode: 'Static',
        }))
        await apiFetch(`${API_BASE}/api/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            zoho_estimate_id: data.quoteId || '',
            shop_name:      selectedCustomer?.name || '',
            vehicle:        [year, make, model].filter(Boolean).join(' '),
            year:           year || '',
            make:           make || '',
            model:          model || '',
            vin:            vin || '',
            insurer:        insurer || '',
            technician:     selectedSalesperson?.name || '',
            scheduled_date: new Date().toISOString().split('T')[0],
            calibrations:   JSON.stringify(calList),
            notes:          `RO#: ${roNumber || ''} | Quote: ${data.quoteNumber || ''}`,
            report_url:     data.quoteUrl || '',
            status:         'need_dispatch',
          }),
        })
      } catch (kanbanErr) {
        console.warn('[kanban] Manual invoice auto-ticket failed:', kanbanErr.message)
      }
    } catch (e) {
      setSubmitError(e.message || 'Failed to create invoice.')
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
          <h2 className="text-xl font-bold mb-1" style={{ color: DARK }}>Invoice Created!</h2>
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

  const enabledCount = calibrations.filter(c => c.enabled).length

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

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

        {/* Calibrations */}
        <Section title={enabledCount > 0 ? `Line Items (${enabledCount} selected)` : 'Line Items — toggle on what you need'}>
          <div className="flex flex-col gap-2 mb-3">
            {calibrations.map((item) => (
              <div key={item._id}
                style={{
                  backgroundColor: item.enabled ? ORANGE_LIGHT : '#f4f2f0',
                  border: `1px solid ${item.enabled ? ORANGE_BORDER : BORDER}`,
                  borderRadius: '10px',
                  padding: '10px 12px',
                  opacity: item.enabled ? 1 : 0.65,
                  transition: 'all 0.15s ease',
                }}
              >
                {/* Row 1: toggle + name + qty + remove */}
                <div className="flex items-center gap-3 mb-2">
                  <button
                    className="flex-shrink-0 w-10 h-5 rounded-full relative transition-colors"
                    style={{ backgroundColor: item.enabled ? ORANGE : '#ccc' }}
                    onClick={() => toggleCal(item._id)}
                  >
                    <span className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all"
                      style={{ left: item.enabled ? '22px' : '2px' }} />
                  </button>
                  <span className="flex-1 text-sm font-medium" style={{ color: item.enabled ? DARK : '#888' }}>
                    {item.calibration_name}
                  </span>
                  {/* Quantity */}
                  <div className="flex items-center gap-1">
                    <span className="text-xs" style={{ color: '#999' }}>Qty</span>
                    <button onClick={() => updateCalField(item._id, 'quantity', Math.max(1, (item.quantity || 1) - 1))}
                      className="w-6 h-6 rounded flex items-center justify-center text-sm font-bold"
                      style={{ backgroundColor: '#e8e4e0', color: '#555' }}>−</button>
                    <span className="w-5 text-center text-sm font-semibold" style={{ color: DARK }}>
                      {item.quantity || 1}
                    </span>
                    <button onClick={() => updateCalField(item._id, 'quantity', Math.min(99, (item.quantity || 1) + 1))}
                      className="w-6 h-6 rounded flex items-center justify-center text-sm font-bold"
                      style={{ backgroundColor: '#e8e4e0', color: '#555' }}>+</button>
                  </div>
                  {item._id >= STANDARD_CALS.length && (
                    <button onClick={() => removeCal(item._id)}
                      className="text-xs px-1.5 py-1 rounded" style={{ color: '#bbb' }}>✕</button>
                  )}
                </div>
                {/* Row 2: description textarea */}
                <textarea
                  value={item.description || ''}
                  onChange={e => updateCalField(item._id, 'description', e.target.value)}
                  placeholder="Why this was performed / what was found…"
                  rows={2}
                  style={{
                    width: '100%', padding: '6px 10px', borderRadius: '6px', fontSize: '12px',
                    border: `1px solid ${BORDER}`, backgroundColor: 'white', color: DARK,
                    resize: 'vertical', outline: 'none',
                  }}
                  onFocus={e => (e.target.style.borderColor = ORANGE)}
                  onBlur={e  => (e.target.style.borderColor = BORDER)}
                />
              </div>
            ))}
          </div>

          {/* Add custom item */}
          <div className="flex gap-2 mt-1">
            <input
              type="text"
              value={customInput}
              onChange={e => setCustomInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCustomCal()}
              placeholder="Add custom line item…"
              className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
              style={{ border: `1px solid ${BORDER}`, color: DARK }}
              onFocus={e => (e.target.style.borderColor = ORANGE)}
              onBlur={e  => (e.target.style.borderColor = BORDER)}
            />
            <button onClick={addCustomCal}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: ORANGE, color: 'white' }}>
              Add
            </button>
          </div>
        </Section>

        {/* Notes / Story */}
        <Section title="Notes / Job Description">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Describe the job, claim details, or any relevant information for this invoice…"
            rows={5}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y"
            style={{ border: `1px solid ${BORDER}`, backgroundColor: 'white', color: DARK, minHeight: '100px' }}
            onFocus={e => (e.target.style.borderColor = ORANGE)}
            onBlur={e  => (e.target.style.borderColor = BORDER)}
          />
        </Section>

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
          {submitting ? 'Creating Invoice…' : 'Create Zoho Books Invoice'}
        </button>

      </div>
    </div>
  )
}
