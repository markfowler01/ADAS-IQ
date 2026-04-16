import { useState, useEffect, useMemo } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'

const ORANGE = '#CD4419'

const TYPES = [
  { value: 'vacation',    label: 'Vacation' },
  { value: 'sick',        label: 'Sick' },
  { value: 'personal',    label: 'Personal' },
  { value: 'unpaid',      label: 'Unpaid' },
  { value: 'bereavement', label: 'Bereavement' },
  { value: 'jury_duty',   label: 'Jury Duty' },
]

function today() { return new Date().toISOString().slice(0, 10) }

function businessDaysBetween(start, end) {
  if (!start || !end || end < start) return 0
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  let count = 0
  const d = new Date(s)
  while (d <= e) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

export default function PTORequestModal({ onClose, onSaved, existingRequest }) {
  const initial = existingRequest || {}
  const [type, setType] = useState(initial.type || 'vacation')
  const [startDate, setStartDate] = useState(initial.start_date || today())
  const [endDate, setEndDate] = useState(initial.end_date || today())
  const [halfDay, setHalfDay] = useState(!!initial.half_day)
  const [hoursOverride, setHoursOverride] = useState(
    initial.hours_requested != null ? String(initial.hours_requested) : ''
  )
  const [reason, setReason] = useState(initial.reason || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Auto-calculate hours when dates/half-day change
  const calculatedHours = useMemo(() => {
    if (halfDay) return 4
    const days = businessDaysBetween(startDate, endDate)
    return days * 8
  }, [startDate, endDate, halfDay])

  // If the user hasn't overridden, keep the calculated value in the override field visually
  const hoursValue = hoursOverride === '' ? String(calculatedHours) : hoursOverride

  async function submit() {
    setError('')
    if (!startDate || !endDate) { setError('Start and end dates are required.'); return }
    if (endDate < startDate) { setError('End date must be on or after start date.'); return }
    const hours = Number(hoursValue)
    if (!Number.isFinite(hours) || hours <= 0) { setError('Hours must be a positive number.'); return }

    setSaving(true)
    try {
      const body = {
        type,
        start_date: startDate,
        end_date: halfDay ? startDate : endDate,
        hours_requested: hours,
        half_day: halfDay,
        reason: reason.trim(),
      }
      const url = existingRequest?.id
        ? `${API_BASE}/api/pto/requests/${existingRequest.id}`
        : `${API_BASE}/api/pto/requests`
      const method = existingRequest?.id ? 'PUT' : 'POST'
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`)
      onSaved && onSaved(data.request)
      onClose && onClose()
    } catch (e) {
      setError(e.message || 'Failed to submit request')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl"
        onClick={e => e.stopPropagation()}
        style={{ border: '1px solid #ebebeb' }}>
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid #ebebeb' }}>
          <h3 className="text-base font-semibold" style={{ color: '#1a1a1a' }}>
            {existingRequest?.id ? 'Edit Time Off Request' : 'Request Time Off'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"
            aria-label="Close" style={{ fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Type */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: '#555' }}>Type</label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ border: '1px solid #ebebeb', backgroundColor: 'white' }}>
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: '#555' }}>Start date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ border: '1px solid #ebebeb' }}/>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: '#555' }}>End date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                disabled={halfDay}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ border: '1px solid #ebebeb', backgroundColor: halfDay ? '#f5f3f0' : 'white' }}/>
            </div>
          </div>

          {/* Half-day */}
          <label className="flex items-center gap-2 text-sm" style={{ color: '#333' }}>
            <input type="checkbox" checked={halfDay}
              onChange={e => {
                const c = e.target.checked
                setHalfDay(c)
                if (c) setEndDate(startDate)
                setHoursOverride('')
              }}
              className="w-4 h-4" style={{ accentColor: ORANGE }}/>
            Half-day request
          </label>

          {/* Hours */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: '#555' }}>
              Hours {hoursOverride === '' && (
                <span className="font-normal" style={{ color: '#888' }}>— auto-calculated from dates</span>
              )}
            </label>
            <input type="number" min="0" step="0.5"
              value={hoursValue}
              onChange={e => setHoursOverride(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ border: '1px solid #ebebeb' }}/>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: '#555' }}>Reason (optional)</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Family event, medical appointment…"
              className="w-full px-3 py-2 rounded-lg text-sm resize-none"
              style={{ border: '1px solid #ebebeb' }}/>
          </div>

          {error && (
            <div className="text-xs px-3 py-2 rounded-lg"
              style={{ backgroundColor: '#fee2e2', color: '#b91c1c' }}>
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: '1px solid #ebebeb', backgroundColor: '#fafafa', borderRadius: '0 0 1rem 1rem' }}>
          <button onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
            Cancel
          </button>
          <button onClick={submit}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: ORANGE, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Submitting…' : existingRequest?.id ? 'Save changes' : 'Submit request'}
          </button>
        </div>
      </div>
    </div>
  )
}
