import { useState } from 'react'
import { API_BASE, apiFetch, ORANGE, fmt } from './shared'

export default function ServicesTab({ services, onRefresh }) {
  const [editSvc, setEditSvc] = useState(null)   // null=none, false=new, object=edit
  const [form, setForm] = useState({ name: '', category: 'Calibration', unit_price: 0, cost_of_goods: 0, active: true })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  function openNew() {
    setForm({ name: '', category: 'Calibration', unit_price: 0, cost_of_goods: 0, active: true })
    setEditSvc(false)
  }

  function openEdit(svc) {
    setForm({ ...svc })
    setEditSvc(svc)
  }

  function closeForm() {
    setEditSvc(null)
    setError(null)
  }

  async function saveService(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    setLoading(true)
    setError(null)
    try {
      let r
      if (editSvc === false) {
        r = await apiFetch(`${API_BASE}/api/books/services`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      } else {
        r = await apiFetch(`${API_BASE}/api/books/services/${editSvc.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      }
      if (!r.ok) {
        const d = await r.json()
        throw new Error(d.error || 'Save failed')
      }
      onRefresh()
      closeForm()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function deleteService(svc) {
    if (!confirm(`Delete "${svc.name}"?`)) return
    try {
      await apiFetch(`${API_BASE}/api/books/services/${svc.id}`, { method: 'DELETE' })
      onRefresh()
    } catch (err) {
      alert('Delete failed: ' + err.message)
    }
  }

  const categoryColors = {
    Calibration: { bg: '#eff6ff', color: '#2563eb' },
    Labor: { bg: '#f0fdf4', color: '#16a34a' },
    Other: { bg: '#f5f3f0', color: '#6b7280' },
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={openNew}
          className="text-sm px-4 py-2 rounded-lg font-semibold text-white"
          style={{ backgroundColor: ORANGE }}>
          + New Service
        </button>
      </div>

      {/* Inline form */}
      {editSvc !== null && (
        <div className="rounded-xl border shadow-sm p-5 mb-5" style={{ borderColor: '#f0ece8' }}>
          <h3 className="font-semibold text-sm mb-4" style={{ color: ORANGE }}>
            {editSvc === false ? 'New Service' : `Edit: ${editSvc.name}`}
          </h3>
          <form onSubmit={saveService}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Service Name</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }}
                  value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }}
                  value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  <option>Calibration</option>
                  <option>Labor</option>
                  <option>Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Unit Price ($)</label>
                <input type="number" min="0" step="0.01"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }}
                  value={form.unit_price} onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Cost of Goods ($) <span className="font-normal text-gray-400">— consumables, tool wear per calibration</span>
                </label>
                <input type="number" min="0" step="0.01"
                  placeholder="e.g. 15"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }}
                  value={form.cost_of_goods || 0}
                  onChange={e => setForm(f => ({ ...f, cost_of_goods: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <input type="checkbox" id="svc-active" checked={!!form.active}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                className="rounded" />
              <label htmlFor="svc-active" className="text-sm text-gray-600">Active (available in invoice catalog)</label>
            </div>
            {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={closeForm}
                className="px-4 py-2 rounded-lg text-sm font-medium border"
                style={{ borderColor: '#e5e7eb', color: '#555' }}>
                Cancel
              </button>
              <button type="submit" disabled={loading}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ backgroundColor: ORANGE, opacity: loading ? 0.7 : 1 }}>
                {loading ? 'Saving…' : 'Save Service'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Service grid */}
      {services.length === 0 ? (
        <div className="py-12 text-center text-gray-400 text-sm">No services yet.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map(svc => {
            const cat = categoryColors[svc.category] || categoryColors.Other
            return (
              <div key={svc.id}
                className="rounded-xl border p-4 shadow-sm flex flex-col gap-2 bg-white"
                style={{ borderColor: '#f0ece8', opacity: svc.active ? 1 : 0.5 }}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold flex-1" style={{ color: '#1a1a1a' }}>{svc.name}</p>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: cat.bg, color: cat.color }}>
                    {svc.category}
                  </span>
                </div>
                <p className="text-xl font-bold" style={{ color: ORANGE }}>{fmt(svc.unit_price)}</p>
                {!svc.active && (
                  <span className="text-xs text-gray-400 italic">Inactive</span>
                )}
                <div className="flex gap-2 mt-1">
                  <button onClick={() => openEdit(svc)}
                    className="text-xs px-3 py-1 rounded-md font-medium transition-colors"
                    style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
                    Edit
                  </button>
                  <button onClick={() => deleteService(svc)}
                    className="text-xs px-3 py-1 rounded-md font-medium transition-colors"
                    style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
