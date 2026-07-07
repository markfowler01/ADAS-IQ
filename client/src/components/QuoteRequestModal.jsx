// Quote Request Modal — Live Day companion to JobRequestModal.
//
// A tech in the field taps "Request a Quote" when the shop is asking
// for a price before scheduling. The form is intentionally lighter than
// JobRequestModal: no RO# yet (there might not be one at this stage),
// no photo scanner, no calibration list. Kat picks up the request from
// the #aajobs Cliq channel and drafts a Zoho estimate.
//
// Fields:
//   • Shop / customer name  (free-text; may be a walk-in name, not a CRM shop)
//   • Year / Make / Model    (whatever the tech has)
//   • VIN (optional)
//   • Insurer (optional — blank / "cash" is fine)
//   • Notes                  (calibrations they're expecting, damage summary, etc.)
//
// On submit → POST /api/jobs with via_request:true + request_type:'quote'.
// The backend routes that to #aajobs with a distinct "Quote Requested" tag
// so it's clear the ask is for a price, not to schedule work.

import { useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'

export default function QuoteRequestModal({ onClose, onSubmit }) {
  const [shopName,    setShopName]    = useState('')
  const [year,        setYear]        = useState('')
  const [make,        setMake]        = useState('')
  const [model,       setModel]       = useState('')
  const [vin,         setVin]         = useState('')
  const [insurer,     setInsurer]     = useState('')
  const [notes,       setNotes]       = useState('')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState(null)

  const canSubmit = shopName.trim().length > 0 && !saving

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        shop_name: shopName.trim(),
        year: year.trim(),
        make: make.trim(),
        model: model.trim(),
        vin: vin.trim(),
        insurer: insurer.trim(),
        notes: notes.trim(),
      })
      onClose()
    } catch (e) {
      setError(e.message || 'Failed to submit quote request')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#f0ece8' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: '#1a1a1a' }}>Request a Quote</h2>
            <p className="text-xs text-gray-400 mt-0.5">Kat will draft an estimate from #aajobs.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none" aria-label="Close">×</button>
        </div>

        <div className="p-5 space-y-3">
          {/* Shop / customer name */}
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>
              Shop or Customer *
            </label>
            <input
              value={shopName}
              onChange={e => setShopName(e.target.value)}
              placeholder="e.g. Sam's Body Shop, or walk-in name"
              className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm"
              style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
              autoFocus
            />
          </div>

          {/* Vehicle row — YMM */}
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>
              Vehicle
            </label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <input
                value={year} onChange={e => setYear(e.target.value)}
                placeholder="Year"
                className="px-3 py-2.5 rounded-lg text-sm"
                style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
                inputMode="numeric" maxLength={4}
              />
              <input
                value={make} onChange={e => setMake(e.target.value)}
                placeholder="Make"
                className="px-3 py-2.5 rounded-lg text-sm"
                style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
              />
              <input
                value={model} onChange={e => setModel(e.target.value)}
                placeholder="Model"
                className="px-3 py-2.5 rounded-lg text-sm"
                style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
              />
            </div>
          </div>

          {/* VIN + Insurer row */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>
                VIN (optional)
              </label>
              <input
                value={vin} onChange={e => setVin(e.target.value.toUpperCase())}
                placeholder="17-char VIN"
                className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm font-mono"
                style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
                maxLength={17}
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>
                Insurer / Cash
              </label>
              <input
                value={insurer} onChange={e => setInsurer(e.target.value)}
                placeholder="Blank = cash"
                className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm"
                style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>
              Notes — calibrations, damage, questions
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={"e.g. Front bumper hit, need FCW + Radar target price"}
              rows={3}
              className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm"
              style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
            />
          </div>

          {error && (
            <div className="text-xs rounded-lg p-2" style={{ backgroundColor: '#fef2f2', color: '#991b1b' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 p-4 border-t" style={{ borderColor: '#f0ece8' }}>
          <button
            onClick={onClose}
            className="text-sm font-semibold rounded-lg px-4 py-2.5"
            style={{ color: '#666', backgroundColor: '#f5f3f0' }}
          >Cancel</button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="text-sm font-bold rounded-lg px-4 py-2.5 text-white"
            style={{ backgroundColor: canSubmit ? ORANGE : '#e5e7eb' }}
          >
            {saving ? 'Sending…' : '📝 Send to Kat'}
          </button>
        </div>
      </div>
    </div>
  )
}
