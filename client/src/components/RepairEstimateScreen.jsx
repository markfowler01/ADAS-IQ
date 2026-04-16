import { useState, useEffect, useCallback } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import CustomerPicker from './CustomerPicker'
import SalespersonPicker from './SalespersonPicker'
import Navbar from './Navbar'

const ORANGE       = '#CD4419'
const ORANGE_LIGHT = '#fdf3ef'
const ORANGE_BORDER = '#e8c5b0'
const BORDER       = '#e0dbd6'
const MUTED        = '#888'
const DARK         = '#1a1a1a'
const GREEN        = '#16a34a'
const GREEN_LIGHT  = '#f0fdf4'

const LABOR_RATE_KEY = 'adasiq_labor_rate'

// ── Markup tier logic ────────────────────────────────────────────────────────
function getAutoMultiplier(cost) {
  const c = parseFloat(cost) || 0
  if (c < 500)  return 1.8
  if (c < 1000) return 1.6
  return 1.4
}

// Parse override: < 10 = multiplier, >= 10 = percentage markup → multiplier
function parseMultiplierOverride(val) {
  const n = parseFloat(val)
  if (isNaN(n) || n <= 0) return null
  return n < 10 ? n : 1 + n / 100
}

function getEffectiveMultiplier(cost, override) {
  if (override !== '') {
    const m = parseMultiplierOverride(override)
    if (m !== null) return m
  }
  return getAutoMultiplier(cost)
}

function customerPrice(cost, override) {
  const c = parseFloat(cost) || 0
  const m = getEffectiveMultiplier(cost, override)
  return Math.round(c * m * 100) / 100
}

function fmt(n) {
  return (parseFloat(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

// ── Field components ─────────────────────────────────────────────────────────
function Label({ children }) {
  return (
    <span className="block text-xs font-semibold mb-1" style={{ color: MUTED, letterSpacing: '0.04em' }}>
      {children}
    </span>
  )
}

function Input({ value, onChange, placeholder, type = 'text', style }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all"
      style={{ border: `1px solid ${BORDER}`, backgroundColor: 'white', color: DARK, ...style }}
      onFocus={e  => (e.target.style.borderColor = ORANGE)}
      onBlur={e   => (e.target.style.borderColor = BORDER)}
    />
  )
}

function Section({ title, children }) {
  return (
    <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'white', border: `1px solid ${BORDER}` }}>
      <p className="text-xs font-bold mb-3 uppercase tracking-widest" style={{ color: MUTED }}>{title}</p>
      {children}
    </div>
  )
}

// ── Estimate list card ───────────────────────────────────────────────────────
function EstimateCard({ estimate, onEdit, onDelete }) {
  const parts       = estimate.parts        || []
  const laborLines  = estimate.labor_lines  || []
  const rate        = parseFloat(estimate.labor_rate) || 200
  const totalHours  = laborLines.reduce((sum, l) => sum + (parseFloat(l.hours) || 0), 0)
  const partsTotal  = parts.reduce((sum, p) => sum + (parseFloat(p.customerPrice) || 0), 0)
  const laborTotal  = totalHours * rate
  const grandTotal  = partsTotal + laborTotal

  const vehicle = [estimate.year, estimate.make, estimate.model].filter(Boolean).join(' ')
  const title   = estimate.customer_name
    ? `${estimate.customer_name}${vehicle ? ' — ' + vehicle : ''}`
    : vehicle || 'Untitled Estimate'

  const isSent = estimate.status === 'sent'

  return (
    <div
      className="bg-white rounded-xl p-4 flex items-center justify-between gap-4 cursor-pointer hover:shadow-md transition-shadow"
      style={{ border: `1px solid ${isSent ? '#bbf7d0' : BORDER}`, backgroundColor: isSent ? GREEN_LIGHT : 'white' }}
      onClick={() => onEdit(estimate)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold truncate" style={{ color: DARK }}>{title}</p>
          {isSent && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#dcfce7', color: GREEN }}>
              Sent to Zoho
            </span>
          )}
          {estimate.zoho_quote_number && (
            <span className="text-xs font-mono" style={{ color: MUTED }}>{estimate.zoho_quote_number}</span>
          )}
        </div>
        <div className="flex gap-3 mt-1 text-xs" style={{ color: MUTED }}>
          {estimate.ro_number && <span>RO# {estimate.ro_number}</span>}
          {parts.length > 0 && <span>{parts.length} part{parts.length !== 1 ? 's' : ''}</span>}
          {laborLines.length > 0 && <span>{laborLines.length} labor line{laborLines.length !== 1 ? 's' : ''}</span>}
          <span>{new Date(estimate.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <p className="text-base font-bold" style={{ color: grandTotal > 0 ? DARK : '#ccc' }}>
          {grandTotal > 0 ? fmt(grandTotal) : '—'}
        </p>
        <button
          onClick={e => { e.stopPropagation(); onDelete(estimate) }}
          className="w-7 h-7 rounded flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RepairEstimateScreen({ onBack, user, onLogout, currentScreen, onNavigate }) {
  // List view state
  const [estimates, setEstimates]   = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError]   = useState(null)

  // View: 'list' | 'edit'
  const [view, setView] = useState('list')
  const [editingId, setEditingId] = useState(null) // null = new

  // Form state
  const [customer,    setCustomer]    = useState(null)
  const [salesperson, setSalesperson] = useState(null)
  const [roNumber,    setRoNumber]    = useState('')
  const [insurer,     setInsurer]     = useState('')
  const [claim,       setClaim]       = useState('')
  const [year,        setYear]        = useState('')
  const [make,        setMake]        = useState('')
  const [model,       setModel]       = useState('')
  const [vin,         setVin]         = useState('')
  const [parts,       setParts]       = useState([])
  const [laborLines,  setLaborLines]  = useState([])
  const [laborRate,   setLaborRate]   = useState(() => localStorage.getItem(LABOR_RATE_KEY) || '200')
  const [notes,       setNotes]       = useState('')

  // Action states
  const [saving,        setSaving]        = useState(false)
  const [sendingToZoho, setSendingToZoho] = useState(false)
  const [formError,     setFormError]     = useState(null)
  const [zohoResult,    setZohoResult]    = useState(null) // success result

  // Persist labor rate to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(LABOR_RATE_KEY, laborRate)
  }, [laborRate])

  // Load estimates list
  const fetchEstimates = useCallback(async () => {
    try {
      setLoadingList(true)
      const res  = await apiFetch(`${API_BASE}/api/estimates`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setEstimates(data)
    } catch (e) {
      setListError(e.message)
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => { fetchEstimates() }, [fetchEstimates])

  // ── Labor line helpers ──────────────────────────────────────────────────────
  function addLaborLine() {
    setLaborLines(prev => [...prev, { id: Date.now(), description: '', hours: '' }])
  }

  function updateLaborLine(id, field, value) {
    setLaborLines(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l))
  }

  function removeLaborLine(id) {
    setLaborLines(prev => prev.filter(l => l.id !== id))
  }

  // ── Part helpers ────────────────────────────────────────────────────────────
  function addPart() {
    setParts(prev => [...prev, { id: Date.now(), name: '', cost: '', multiplierOverride: '', customerPrice: 0 }])
  }

  function updatePart(id, field, value) {
    setParts(prev => prev.map(p => {
      if (p.id !== id) return p
      const updated = { ...p, [field]: value }
      // Recompute customer price whenever cost or override changes
      updated.customerPrice = customerPrice(
        field === 'cost' ? value : updated.cost,
        field === 'multiplierOverride' ? value : updated.multiplierOverride
      )
      return updated
    }))
  }

  function removePart(id) {
    setParts(prev => prev.filter(p => p.id !== id))
  }

  // ── Computed totals ─────────────────────────────────────────────────────────
  const partsTotal = parts.reduce((sum, p) => sum + (parseFloat(p.customerPrice) || 0), 0)
  const laborTotal = laborLines.reduce((sum, l) => sum + (parseFloat(l.hours) || 0) * (parseFloat(laborRate) || 0), 0)
  const grandTotal = partsTotal + laborTotal

  // ── Open estimate for editing ───────────────────────────────────────────────
  function openNew() {
    setEditingId(null)
    setCustomer(null)
    setSalesperson(null)
    setRoNumber(''); setInsurer(''); setClaim('')
    setYear(''); setMake(''); setModel(''); setVin('')
    setParts([])
    setLaborLines([])
    setNotes('')
    setFormError(null)
    setZohoResult(null)
    setView('edit')
  }

  function openEdit(estimate) {
    setEditingId(estimate.id)
    setCustomer(estimate.customer_id ? { id: estimate.customer_id, name: estimate.customer_name } : null)
    setSalesperson(estimate.salesperson_id ? { id: estimate.salesperson_id, name: estimate.salesperson_name } : null)
    setRoNumber(estimate.ro_number   || '')
    setInsurer(estimate.insurer      || '')
    setClaim(estimate.claim          || '')
    setYear(estimate.year            || '')
    setMake(estimate.make            || '')
    setModel(estimate.model          || '')
    setVin(estimate.vin              || '')
    // Re-attach id field to each part for keying
    setParts((estimate.parts || []).map((p, i) => ({
      id: p.id || Date.now() + i,
      name: p.name || '',
      cost: String(p.cost || ''),
      multiplierOverride: String(p.multiplierOverride || ''),
      customerPrice: parseFloat(p.customerPrice) || 0,
    })))
    setLaborLines((estimate.labor_lines || []).map((l, i) => ({
      id: l.id || Date.now() + i + 1000,
      description: l.description || '',
      hours: String(l.hours || ''),
    })))
    setLaborRate(estimate.labor_rate || '200')
    setNotes(estimate.notes            || '')
    setFormError(null)
    setZohoResult(null)
    setView('edit')
  }

  async function handleDelete(estimate) {
    if (!window.confirm('Delete this estimate?')) return
    try {
      const res = await apiFetch(`${API_BASE}/api/estimates/${estimate.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setEstimates(prev => prev.filter(e => e.id !== estimate.id))
    } catch (e) {
      alert(e.message)
    }
  }

  // ── Build payload ───────────────────────────────────────────────────────────
  function buildPayload() {
    return {
      customer_id:      customer?.id   || '',
      customer_name:    customer?.name || '',
      salesperson_id:   salesperson?.id   || '',
      salesperson_name: salesperson?.name || '',
      ro_number: roNumber,
      insurer,
      claim,
      year, make, model, vin,
      parts: parts.map(p => ({
        name:               p.name,
        cost:               parseFloat(p.cost) || 0,
        multiplierOverride: p.multiplierOverride,
        multiplier:         getEffectiveMultiplier(p.cost, p.multiplierOverride),
        customerPrice:      parseFloat(p.customerPrice) || 0,
      })),
      labor_lines: laborLines.map(l => ({
        description: l.description,
        hours:       parseFloat(l.hours) || 0,
      })),
      labor_rate: laborRate,
      notes,
    }
  }

  // ── Save draft ──────────────────────────────────────────────────────────────
  async function handleSave() {
    setFormError(null)
    setSaving(true)
    try {
      const payload = buildPayload()
      const url     = editingId
        ? `${API_BASE}/api/estimates/${editingId}`
        : `${API_BASE}/api/estimates`
      const method  = editingId ? 'PUT' : 'POST'
      const res     = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      if (!editingId) setEditingId(data.id)
      await fetchEstimates()
      setFormError(null)
      // Brief success flash
      setFormError('__saved__')
      setTimeout(() => setFormError(null), 2000)
    } catch (e) {
      setFormError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Send to Zoho Books ──────────────────────────────────────────────────────
  async function handleSendToZoho() {
    setFormError(null)
    // Save first to make sure latest data is persisted
    setSendingToZoho(true)
    try {
      // Save current state first
      const payload = buildPayload()
      const saveUrl = editingId
        ? `${API_BASE}/api/estimates/${editingId}`
        : `${API_BASE}/api/estimates`
      const saveMethod = editingId ? 'PUT' : 'POST'
      const saveRes = await apiFetch(saveUrl, {
        method: saveMethod,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const saved = await saveRes.json()
      if (!saveRes.ok) throw new Error(saved.error || 'Save failed')
      const id = editingId || saved.id
      if (!editingId) setEditingId(id)

      // Now send to Zoho
      const res  = await apiFetch(`${API_BASE}/api/estimates/${id}/send-to-zoho`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Zoho Books error')
      setZohoResult(data)
      await fetchEstimates()
    } catch (e) {
      setFormError(e.message)
    } finally {
      setSendingToZoho(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  // ── LIST VIEW ───────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
        <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
        <div className="max-w-2xl mx-auto px-4 py-6">

          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-xl font-bold" style={{ color: DARK }}>Repair Estimates</h1>
              <p className="text-xs mt-0.5" style={{ color: MUTED }}>Parts markup + labor cost sheets</p>
            </div>
            <button
              onClick={openNew}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: ORANGE }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 5v14M5 12h14" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
              New Estimate
            </button>
          </div>

          {/* List */}
          {loadingList ? (
            <div className="flex flex-col gap-3">
              {[1,2,3].map(i => (
                <div key={i} className="h-16 rounded-xl animate-pulse" style={{ backgroundColor: '#e8e4e0' }} />
              ))}
            </div>
          ) : listError ? (
            <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: '#fff0ed', color: ORANGE, border: `1px solid ${ORANGE}` }}>
              {listError}
            </div>
          ) : estimates.length === 0 ? (
            <div className="rounded-xl p-12 text-center" style={{ backgroundColor: 'white', border: `1px solid ${BORDER}` }}>
              <p className="text-sm font-medium mb-1" style={{ color: '#bbb' }}>No estimates yet</p>
              <p className="text-xs" style={{ color: '#ccc' }}>Click "New Estimate" to get started</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {estimates.map(e => (
                <EstimateCard key={e.id} estimate={e} onEdit={openEdit} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── EDIT VIEW ────────────────────────────────────────────────────────────────
  const isSaved   = formError === '__saved__'
  const isLoading = saving || sendingToZoho

  // Zoho success screen
  if (zohoResult) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
        <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
        <div className="max-w-lg mx-auto px-4 py-12">
          <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: 'white', border: `1px solid ${BORDER}` }}>
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#edfaf3' }}>
              <span className="text-2xl">✓</span>
            </div>
            <h2 className="text-xl font-bold mb-1" style={{ color: DARK }}>Sent to Zoho Books!</h2>
            <p className="text-sm mb-6" style={{ color: MUTED }}>{zohoResult.quoteNumber}</p>
            <a
              href={zohoResult.quoteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-3 rounded-xl text-white text-sm font-semibold mb-3 text-center"
              style={{ backgroundColor: ORANGE }}
            >
              Open in Zoho Books →
            </a>
            <button
              onClick={() => { setZohoResult(null); setView('list') }}
              className="w-full py-3 rounded-xl text-sm font-semibold"
              style={{ backgroundColor: '#f0eeec', color: MUTED }}
            >
              ← Back to Estimates
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Back link */}
        <button
          onClick={() => setView('list')}
          className="flex items-center gap-1 text-sm mb-5 font-medium"
          style={{ color: MUTED }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back to Estimates
        </button>

        <h1 className="text-lg font-bold mb-4" style={{ color: DARK }}>
          {editingId ? 'Edit Estimate' : 'New Repair Estimate'}
        </h1>

        {/* Customer */}
        <Section title="Customer">
          <CustomerPicker
            shopName=""
            onSelect={c => setCustomer(c ? { id: c.id || c.contact_id, name: c.name || c.contact_name } : null)}
          />
        </Section>

        {/* Salesperson */}
        <Section title="Salesperson / Technician">
          <SalespersonPicker
            onSelect={s => setSalesperson(s ? { id: s.user_id, name: s.name } : null)}
          />
        </Section>

        {/* Job Info */}
        <Section title="Job Info">
          <div className="grid grid-cols-3 gap-3">
            <div><Label>RO NUMBER</Label><Input value={roNumber} onChange={setRoNumber} placeholder="e.g. 24249" /></div>
            <div><Label>INSURER</Label><Input value={insurer} onChange={setInsurer} placeholder="State Farm" /></div>
            <div><Label>CLAIM #</Label><Input value={claim} onChange={setClaim} placeholder="CLM-00001" /></div>
          </div>
        </Section>

        {/* Vehicle */}
        <Section title="Vehicle">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div><Label>YEAR</Label><Input value={year} onChange={setYear} placeholder="2022" /></div>
            <div><Label>MAKE</Label><Input value={make} onChange={setMake} placeholder="Toyota" /></div>
            <div><Label>MODEL</Label><Input value={model} onChange={setModel} placeholder="RAV4" /></div>
          </div>
          <div><Label>VIN</Label><Input value={vin} onChange={setVin} placeholder="1HGBH41JXMN109186" /></div>
        </Section>

        {/* Parts */}
        <Section title={`Parts${parts.length > 0 ? ` (${parts.length})` : ''}`}>
          {parts.length > 0 && (
            <div className="mb-3 overflow-x-auto">
              {/* Column headers */}
              <div className="grid gap-2 mb-1 px-1" style={{ gridTemplateColumns: '1fr 90px 70px 90px 28px' }}>
                <span className="text-xs font-semibold uppercase" style={{ color: MUTED }}>Part Name</span>
                <span className="text-xs font-semibold uppercase text-right" style={{ color: MUTED }}>Cost</span>
                <span className="text-xs font-semibold uppercase text-center" style={{ color: MUTED }}>Markup</span>
                <span className="text-xs font-semibold uppercase text-right" style={{ color: MUTED }}>Customer $</span>
                <span />
              </div>

              {/* Part rows */}
              <div className="flex flex-col gap-2">
                {parts.map(part => {
                  const mult = getEffectiveMultiplier(part.cost, part.multiplierOverride)
                  const autoMult = getAutoMultiplier(part.cost)
                  const isOverridden = part.multiplierOverride !== ''
                  const price = parseFloat(part.customerPrice) || 0

                  return (
                    <div
                      key={part.id}
                      className="grid gap-2 items-center px-2 py-2 rounded-lg"
                      style={{ gridTemplateColumns: '1fr 90px 70px 90px 28px', backgroundColor: '#fafaf9', border: `1px solid ${BORDER}` }}
                    >
                      {/* Name */}
                      <input
                        type="text"
                        value={part.name}
                        onChange={e => updatePart(part.id, 'name', e.target.value)}
                        placeholder="Part description"
                        className="text-sm px-2 py-1.5 rounded outline-none w-full"
                        style={{ border: `1px solid ${BORDER}`, color: DARK }}
                        onFocus={e => (e.target.style.borderColor = ORANGE)}
                        onBlur={e  => (e.target.style.borderColor = BORDER)}
                      />

                      {/* Cost */}
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: MUTED }}>$</span>
                        <input
                          type="number"
                          value={part.cost}
                          onChange={e => updatePart(part.id, 'cost', e.target.value)}
                          placeholder="0.00"
                          className="text-sm px-2 py-1.5 pl-5 rounded outline-none w-full text-right"
                          style={{ border: `1px solid ${BORDER}`, color: DARK }}
                          onFocus={e => (e.target.style.borderColor = ORANGE)}
                          onBlur={e  => (e.target.style.borderColor = BORDER)}
                        />
                      </div>

                      {/* Markup override */}
                      <div className="relative">
                        <input
                          type="text"
                          value={part.multiplierOverride}
                          onChange={e => updatePart(part.id, 'multiplierOverride', e.target.value)}
                          placeholder={`${autoMult}×`}
                          title="Enter a multiplier (1.4) or percentage (40). Leave blank for auto."
                          className="text-sm px-2 py-1.5 rounded outline-none w-full text-center"
                          style={{
                            border: `1px solid ${isOverridden ? ORANGE_BORDER : BORDER}`,
                            color: isOverridden ? ORANGE : '#555',
                            backgroundColor: isOverridden ? ORANGE_LIGHT : 'white',
                          }}
                          onFocus={e => (e.target.style.borderColor = ORANGE)}
                          onBlur={e  => (e.target.style.borderColor = isOverridden ? ORANGE_BORDER : BORDER)}
                        />
                        {!isOverridden && (
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#bbb' }}>×</span>
                        )}
                      </div>

                      {/* Customer price */}
                      <p className="text-sm font-semibold text-right" style={{ color: price > 0 ? GREEN : '#ccc' }}>
                        {price > 0 ? fmt(price) : '—'}
                      </p>

                      {/* Delete */}
                      <button
                        onClick={() => removePart(part.id)}
                        className="w-6 h-6 rounded flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </div>
                  )
                })}
              </div>

              {/* Parts subtotal */}
              {partsTotal > 0 && (
                <div className="flex justify-end mt-2 pr-9">
                  <span className="text-xs font-semibold" style={{ color: MUTED }}>
                    Parts subtotal: <span style={{ color: DARK }}>{fmt(partsTotal)}</span>
                  </span>
                </div>
              )}
            </div>
          )}

          <button
            onClick={addPart}
            className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg transition-colors"
            style={{ backgroundColor: ORANGE_LIGHT, color: ORANGE, border: `1px solid ${ORANGE_BORDER}` }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            Add Part
          </button>

          {parts.length === 0 && (
            <p className="text-xs mt-2" style={{ color: '#ccc' }}>
              Markup auto-applies: under $500 = 1.8×, $500–$999 = 1.6×, $1,000+ = 1.4×. Override per part by typing a multiplier (1.4) or percentage (40).
            </p>
          )}
        </Section>

        {/* Labor */}
        <Section title={`Labor${laborLines.length > 0 ? ` (${laborLines.length})` : ''}`}>
          {/* Global rate */}
          <div className="flex items-center gap-3 mb-4 pb-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <Label>RATE / HOUR</Label>
            <div className="relative w-32">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
              <input
                type="number"
                value={laborRate}
                onChange={e => setLaborRate(e.target.value)}
                placeholder="200"
                className="w-full pl-7 pr-3 py-2 rounded-lg text-sm outline-none"
                style={{ border: `1px solid ${BORDER}`, color: DARK }}
                onFocus={e => (e.target.style.borderColor = ORANGE)}
                onBlur={e  => (e.target.style.borderColor = BORDER)}
              />
            </div>
            <span className="text-xs" style={{ color: MUTED }}>applies to all labor lines</span>
          </div>

          {/* Labor lines */}
          {laborLines.length > 0 && (
            <div className="mb-3">
              {/* Headers */}
              <div className="grid gap-2 mb-1 px-1" style={{ gridTemplateColumns: '1fr 80px 90px 28px' }}>
                <span className="text-xs font-semibold uppercase" style={{ color: MUTED }}>Description</span>
                <span className="text-xs font-semibold uppercase text-center" style={{ color: MUTED }}>Hours</span>
                <span className="text-xs font-semibold uppercase text-right" style={{ color: MUTED }}>Total</span>
                <span />
              </div>
              <div className="flex flex-col gap-2">
                {laborLines.map(line => {
                  const hrs   = parseFloat(line.hours) || 0
                  const total = hrs * (parseFloat(laborRate) || 0)
                  return (
                    <div
                      key={line.id}
                      className="grid gap-2 items-center px-2 py-2 rounded-lg"
                      style={{ gridTemplateColumns: '1fr 80px 90px 28px', backgroundColor: '#fafaf9', border: `1px solid ${BORDER}` }}
                    >
                      <input
                        type="text"
                        value={line.description}
                        onChange={e => updateLaborLine(line.id, 'description', e.target.value)}
                        placeholder="e.g. Replace brakes"
                        className="text-sm px-2 py-1.5 rounded outline-none w-full"
                        style={{ border: `1px solid ${BORDER}`, color: DARK }}
                        onFocus={e => (e.target.style.borderColor = ORANGE)}
                        onBlur={e  => (e.target.style.borderColor = BORDER)}
                      />
                      <input
                        type="number"
                        value={line.hours}
                        onChange={e => updateLaborLine(line.id, 'hours', e.target.value)}
                        placeholder="0.0"
                        className="text-sm px-2 py-1.5 rounded outline-none w-full text-center"
                        style={{ border: `1px solid ${BORDER}`, color: DARK }}
                        onFocus={e => (e.target.style.borderColor = ORANGE)}
                        onBlur={e  => (e.target.style.borderColor = BORDER)}
                      />
                      <p className="text-sm font-semibold text-right" style={{ color: total > 0 ? GREEN : '#ccc' }}>
                        {total > 0 ? fmt(total) : '—'}
                      </p>
                      <button
                        onClick={() => removeLaborLine(line.id)}
                        className="w-6 h-6 rounded flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </div>
                  )
                })}
              </div>
              {laborTotal > 0 && (
                <div className="flex justify-end mt-2 pr-9">
                  <span className="text-xs font-semibold" style={{ color: MUTED }}>
                    Labor subtotal: <span style={{ color: DARK }}>{fmt(laborTotal)}</span>
                  </span>
                </div>
              )}
            </div>
          )}

          <button
            onClick={addLaborLine}
            className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg transition-colors"
            style={{ backgroundColor: ORANGE_LIGHT, color: ORANGE, border: `1px solid ${ORANGE_BORDER}` }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            Add Labor Line
          </button>
        </Section>

        {/* Totals */}
        {grandTotal > 0 && (
          <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: DARK }}>
            <div className="flex justify-between text-sm mb-2">
              <span style={{ color: '#aaa' }}>Parts Total</span>
              <span className="font-medium" style={{ color: 'white' }}>{fmt(partsTotal)}</span>
            </div>
            <div className="flex justify-between text-sm mb-3">
              <span style={{ color: '#aaa' }}>Labor Total</span>
              <span className="font-medium" style={{ color: 'white' }}>{fmt(laborTotal)}</span>
            </div>
            <div className="flex justify-between pt-3" style={{ borderTop: '1px solid #333' }}>
              <span className="font-bold text-base" style={{ color: 'white' }}>Grand Total</span>
              <span className="font-bold text-xl" style={{ color: ORANGE }}>{fmt(grandTotal)}</span>
            </div>
          </div>
        )}

        {/* Notes */}
        <Section title="Notes">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Job description, additional details…"
            rows={4}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y"
            style={{ border: `1px solid ${BORDER}`, backgroundColor: 'white', color: DARK }}
            onFocus={e => (e.target.style.borderColor = ORANGE)}
            onBlur={e  => (e.target.style.borderColor = BORDER)}
          />
        </Section>

        {/* Feedback */}
        {formError && !isSaved && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ backgroundColor: '#fff0ed', border: `1px solid ${ORANGE}`, color: ORANGE }}>
            {formError}
          </div>
        )}
        {isSaved && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm flex items-center gap-2" style={{ backgroundColor: GREEN_LIGHT, border: `1px solid #86efac`, color: GREEN }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Saved!
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 mb-8">
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="flex-1 py-3.5 rounded-xl text-sm font-semibold transition-colors"
            style={{
              backgroundColor: isSaved ? GREEN_LIGHT : '#f0eeec',
              color: isSaved ? GREEN : MUTED,
              border: isSaved ? `1px solid #86efac` : `1px solid ${BORDER}`,
              cursor: isLoading ? 'default' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : isSaved ? '✓ Saved' : 'Save Draft'}
          </button>
          <button
            onClick={handleSendToZoho}
            disabled={isLoading}
            className="flex-1 py-3.5 rounded-xl text-white text-sm font-semibold"
            style={{
              backgroundColor: sendingToZoho ? '#d4957a' : ORANGE,
              cursor: isLoading ? 'default' : 'pointer',
            }}
          >
            {sendingToZoho ? 'Sending…' : 'Send to Zoho Books →'}
          </button>
        </div>
      </div>
    </div>
  )
}
