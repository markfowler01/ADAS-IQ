import { useState, useEffect, useRef } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'

export default function JobRequestModal({ onClose, onSubmit }) {
  const [customers,    setCustomers]    = useState([])
  const [custLoading,  setCustLoading]  = useState(true)
  const [custSearch,   setCustSearch]   = useState('')
  const [custDropOpen, setCustDropOpen] = useState(false)
  const [selected,     setSelected]     = useState(null)

  const [technician,  setTechnician]  = useState('')
  const [roNumber,    setRoNumber]    = useState('')
  const [year,        setYear]        = useState('')
  const [make,        setMake]        = useState('')
  const [model,       setModel]       = useState('')
  const [lastFourVin, setLastFourVin] = useState('')
  const [notes,       setNotes]       = useState('')

  // Photo scanner state
  const [imagePreview, setImagePreview] = useState(null)
  const [scanning,     setScanning]     = useState(false)
  const [scanStatus,   setScanStatus]   = useState(null) // 'success' | 'partial' | 'error'

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const custRef    = useRef(null)
  const fileInputRef = useRef(null)

  // Fetch Zoho Books customers
  useEffect(() => {
    apiFetch(`${API_BASE}/api/customers`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setCustomers(data) })
      .catch(() => {})
      .finally(() => setCustLoading(false))
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e) {
      if (custRef.current && !custRef.current.contains(e.target)) setCustDropOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const filteredCustomers = customers
    .filter(c => !custSearch || c.contact_name.toLowerCase().includes(custSearch.toLowerCase()))
    .slice(0, 12)

  // ── Photo scan handler ──────────────────────────────────────────────────────
  async function handleImageChange(e) {
    const file = e.target.files[0]
    if (!file) return

    setImagePreview(URL.createObjectURL(file))
    setScanning(true)
    setScanStatus(null)

    try {
      const formData = new FormData()
      formData.append('image', file)

      const resp = await apiFetch(`${API_BASE}/api/extract-ro-image`, {
        method: 'POST',
        body: formData,
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Scan failed')

      let fieldsFound = 0

      if (data.ro_number) { setRoNumber(data.ro_number); fieldsFound++ }
      if (data.year)      { setYear(data.year);           fieldsFound++ }
      if (data.make)      { setMake(data.make);           fieldsFound++ }
      if (data.model)     { setModel(data.model);         fieldsFound++ }
      if (data.vin) {
        const v = String(data.vin).replace(/\s/g, '')
        setLastFourVin(v.slice(-4).toUpperCase())
        fieldsFound++
      }
      if (data.notes && !notes) { setNotes(data.notes); fieldsFound++ }

      // Try to match shop name to a customer in the dropdown
      if (data.shop_name && !selected) {
        const q = data.shop_name.toLowerCase()
        const match = customers.find(c =>
          c.contact_name.toLowerCase().includes(q) ||
          q.includes(c.contact_name.toLowerCase())
        )
        if (match) { setSelected(match); fieldsFound++ }
      }

      setScanStatus(fieldsFound > 0 ? 'success' : 'partial')
    } catch (e) {
      console.warn('[scan]', e.message)
      setScanStatus('error')
    } finally {
      setScanning(false)
      // Reset file input so the same file can be re-selected if needed
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function clearImage() {
    setImagePreview(null)
    setScanStatus(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!selected)                         { setError('Please select a customer.'); return }
    if (!year && !make && !model)          { setError('Enter at least Year, Make, or Model.'); return }
    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        shop_name:  selected.contact_name,
        ro_number:  roNumber.trim(),
        year:       year.trim(),
        make:       make.trim(),
        model:      model.trim(),
        vin:        lastFourVin ? `****${lastFourVin.toUpperCase()}` : '',
        technician: technician,
        notes:      notes.trim(),
        status:     'job_requested',
      })
      onClose()
    } catch (e) {
      setError(e.message || 'Failed to submit request.')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
        style={{ border: '1px solid #ebebeb', maxHeight: '92vh' }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid #ebebeb' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: '#1a1a1a' }}>Request a Job</h2>
            <p className="text-xs mt-0.5" style={{ color: '#aaa' }}>Kat will be notified automatically</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-4 overflow-y-auto">

          {/* ── Photo Scanner ────────────────────────────────────────────── */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              Scan Repair Order
            </label>

            {/* Hidden file input — accept images + camera on mobile */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageChange}
            />

            {!imagePreview ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-4 rounded-xl flex flex-col items-center gap-1.5 transition-colors"
                style={{ border: '2px dashed #e0dbd6', backgroundColor: '#fafaf9' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = ORANGE)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#e0dbd6')}
              >
                <span style={{ fontSize: '24px', lineHeight: 1 }}>📸</span>
                <span className="text-sm font-medium" style={{ color: '#666' }}>
                  Photograph or upload a repair order
                </span>
                <span className="text-xs" style={{ color: '#bbb' }}>
                  AI will auto-fill the form
                </span>
              </button>
            ) : (
              <div className="relative rounded-xl overflow-hidden" style={{ border: '1.5px solid #e0dbd6' }}>
                <img
                  src={imagePreview}
                  alt="Repair order"
                  className="w-full object-contain"
                  style={{ maxHeight: '160px', backgroundColor: '#f5f5f5' }}
                />

                {/* Scanning overlay */}
                {scanning && (
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ backgroundColor: 'rgba(255,255,255,0.85)' }}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="animate-spin rounded-full h-5 w-5 border-2"
                        style={{ borderColor: ORANGE, borderTopColor: 'transparent' }}
                      />
                      <span className="text-sm font-semibold" style={{ color: ORANGE }}>
                        Reading repair order…
                      </span>
                    </div>
                  </div>
                )}

                {/* Clear button */}
                {!scanning && (
                  <button
                    type="button"
                    onClick={clearImage}
                    className="absolute top-2 right-2 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold"
                    style={{ backgroundColor: 'rgba(0,0,0,0.55)', color: 'white' }}
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            {/* Scan result feedback */}
            {scanStatus === 'success' && !scanning && (
              <p className="text-xs mt-1.5 font-semibold" style={{ color: '#22a650' }}>
                ✓ Info extracted — review and adjust below
              </p>
            )}
            {scanStatus === 'partial' && !scanning && (
              <p className="text-xs mt-1.5" style={{ color: '#888' }}>
                Couldn't read all fields — fill in any missing info below
              </p>
            )}
            {scanStatus === 'error' && !scanning && (
              <p className="text-xs mt-1.5" style={{ color: '#aaa' }}>
                Couldn't read image — fill in the form manually
              </p>
            )}
          </div>

          {/* Customer dropdown */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              Customer
            </label>
            <div ref={custRef} className="relative">
              <button
                type="button"
                onClick={() => { setCustDropOpen(o => !o); setCustSearch('') }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left"
                style={{ border: `1.5px solid ${custDropOpen ? ORANGE : '#ddd'}`, backgroundColor: 'white', transition: 'border-color 0.15s' }}
              >
                <span style={{ color: selected ? '#1a1a1a' : '#aaa' }}>
                  {selected ? selected.contact_name : 'Select a customer…'}
                </span>
                <span style={{ color: '#bbb', fontSize: '10px' }}>{custDropOpen ? '▲' : '▼'}</span>
              </button>

              {selected && (
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="absolute right-8 top-2.5 text-xs px-1"
                  style={{ color: '#bbb' }}
                >✕</button>
              )}

              {custDropOpen && (
                <div
                  className="absolute z-30 w-full mt-1 rounded-xl overflow-hidden"
                  style={{ backgroundColor: 'white', border: '1.5px solid #e8e2dc', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: '220px', display: 'flex', flexDirection: 'column' }}
                >
                  <div className="p-2" style={{ borderBottom: '1px solid #f0ece8' }}>
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search customers…"
                      value={custSearch}
                      onChange={e => setCustSearch(e.target.value)}
                      className="w-full text-sm px-2 py-1.5 rounded-lg outline-none"
                      style={{ border: '1.5px solid #e0dbd6', backgroundColor: '#f9f7f5' }}
                    />
                  </div>
                  <div className="overflow-y-auto">
                    {custLoading ? (
                      <p className="text-sm px-4 py-3" style={{ color: '#bbb' }}>Loading…</p>
                    ) : filteredCustomers.length === 0 ? (
                      <p className="text-sm px-4 py-3" style={{ color: '#bbb' }}>No matches</p>
                    ) : filteredCustomers.map(c => (
                      <button
                        key={c.contact_id}
                        type="button"
                        onMouseDown={() => { setSelected(c); setCustDropOpen(false); setCustSearch('') }}
                        className="w-full text-left px-4 py-2.5 text-sm"
                        style={{
                          color:           selected?.contact_id === c.contact_id ? ORANGE : '#1a1a1a',
                          fontWeight:      selected?.contact_id === c.contact_id ? 600 : 400,
                          backgroundColor: selected?.contact_id === c.contact_id ? '#fdeee8' : 'transparent',
                        }}
                        onMouseEnter={e => { if (selected?.contact_id !== c.contact_id) e.currentTarget.style.backgroundColor = '#fafaf9' }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = selected?.contact_id === c.contact_id ? '#fdeee8' : 'transparent' }}
                      >
                        {c.contact_name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Technician */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Technician</label>
            <div className="flex gap-2">
              {['Mark', 'Jayden'].map(name => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setTechnician(t => t === name ? '' : name)}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
                  style={{
                    backgroundColor: technician === name ? ORANGE : '#f5f3f0',
                    color:           technician === name ? 'white' : '#555',
                    border:          `1.5px solid ${technician === name ? ORANGE : '#e0dbd6'}`,
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* RO Number */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">RO Number</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none"
              style={{ borderColor: '#ddd' }}
              value={roNumber}
              onChange={e => setRoNumber(e.target.value)}
              placeholder="e.g. 12345"
              onFocus={e => (e.target.style.borderColor = ORANGE)}
              onBlur={e  => (e.target.style.borderColor = '#ddd')}
            />
          </div>

          {/* Year / Make / Model */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Year</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#ddd' }}
                value={year}
                onChange={e => setYear(e.target.value)}
                placeholder="2022"
                onFocus={e => (e.target.style.borderColor = ORANGE)}
                onBlur={e  => (e.target.style.borderColor = '#ddd')}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Make</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#ddd' }}
                value={make}
                onChange={e => setMake(e.target.value)}
                placeholder="Toyota"
                onFocus={e => (e.target.style.borderColor = ORANGE)}
                onBlur={e  => (e.target.style.borderColor = '#ddd')}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Model</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#ddd' }}
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="RAV4"
                onFocus={e => (e.target.style.borderColor = ORANGE)}
                onBlur={e  => (e.target.style.borderColor = '#ddd')}
              />
            </div>
          </div>

          {/* Last 4 of VIN */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              Last 4 of VIN
            </label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none"
              style={{ borderColor: '#ddd' }}
              value={lastFourVin}
              onChange={e => setLastFourVin(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase())}
              placeholder="e.g. A1B2"
              maxLength={4}
              onFocus={e => (e.target.style.borderColor = ORANGE)}
              onBlur={e  => (e.target.style.borderColor = '#ddd')}
            />
          </div>

          {/* What's needed */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              What's Needed
            </label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
              style={{ borderColor: '#ddd' }}
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Describe the calibrations needed or any other details…"
              onFocus={e => (e.target.style.borderColor = ORANGE)}
              onBlur={e  => (e.target.style.borderColor = '#ddd')}
            />
          </div>

          {error && (
            <div className="px-4 py-3 rounded-xl text-sm" style={{ backgroundColor: '#fff0ed', color: ORANGE, border: '1px solid #e8c5b0' }}>
              {error}
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid #ebebeb' }}>
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg font-medium"
            style={{ color: '#555', backgroundColor: '#f5f3f0' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || scanning}
            className="text-sm px-4 py-2 rounded-lg font-medium text-white"
            style={{ backgroundColor: ORANGE, opacity: (saving || scanning) ? 0.7 : 1 }}
          >
            {saving ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  )
}
