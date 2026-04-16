import { useState, useEffect, useCallback } from 'react'
import Navbar from './Navbar'
import { API_BASE, apiFetch, ORANGE, fmt } from './books/shared'

const STATUS = {
  draft:     { bg: '#e5e7eb', color: '#374151', label: 'Draft' },
  sent:      { bg: '#dbeafe', color: '#1d4ed8', label: 'Sent' },
  approved:  { bg: '#dcfce7', color: '#15803d', label: 'Approved ✓' },
  declined:  { bg: '#fee2e2', color: '#b91c1c', label: 'Declined' },
  expired:   { bg: '#f5f3f0', color: '#6b7280', label: 'Expired' },
  converted: { bg: '#ede9fe', color: '#7c3aed', label: 'Invoiced' },
}

export default function QuotesScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [quotes, setQuotes] = useState([])
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)  // null=closed, false=new, object=edit
  const [filter, setFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [q, s] = await Promise.all([
        apiFetch(`${API_BASE}/api/quotes`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/books/services`).then(r => r.json()),
      ])
      setQuotes(Array.isArray(q) ? q : [])
      setServices(Array.isArray(s) ? s : [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function sendQuote(q) {
    try {
      const r = await apiFetch(`${API_BASE}/api/quotes/${q.id}/send`, { method: 'POST' }).then(r => r.json())
      if (r.error) throw new Error(r.error)
      await navigator.clipboard.writeText(r.approval_url)
      alert(`Approval link copied to clipboard:\n\n${r.approval_url}`)
      load()
    } catch (e) { alert(e.message) }
  }

  async function copyLink(q) {
    try {
      const r = await apiFetch(`${API_BASE}/api/quotes/${q.id}/approval-url`).then(r => r.json())
      if (r.error) throw new Error(r.error)
      await navigator.clipboard.writeText(r.url)
      alert(`Link copied:\n\n${r.url}`)
    } catch (e) { alert(e.message) }
  }

  async function convertToInvoice(q) {
    if (!confirm(`Convert ${q.quote_number} into an invoice?`)) return
    try {
      const r = await apiFetch(`${API_BASE}/api/quotes/${q.id}/convert-to-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_type: 'standard' }),
      }).then(r => r.json())
      if (r.error) throw new Error(r.error)
      load()
      alert(`Invoice ${r.invoice.invoice_number} created from quote.`)
    } catch (e) { alert(e.message) }
  }

  async function deleteQuote(q) {
    if (!confirm(`Delete ${q.quote_number}?`)) return
    try {
      await apiFetch(`${API_BASE}/api/quotes/${q.id}`, { method: 'DELETE' })
      load()
    } catch (e) { alert(e.message) }
  }

  const filtered = filter === 'all' ? quotes : quotes.filter(q => q.status === filter)
  const counts = { all: quotes.length }
  for (const q of quotes) counts[q.status] = (counts[q.status] || 0) + 1

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Quotes</h1>
            <p className="text-sm text-gray-500 mt-0.5">Scope + price + shop approval before you dispatch</p>
          </div>
          <button onClick={() => setEditing(false)}
            className="text-sm px-4 py-2 rounded-lg font-semibold text-white"
            style={{ backgroundColor: ORANGE }}>
            + New Quote
          </button>
        </div>

        {/* Filter pills */}
        <div className="flex gap-1.5 flex-wrap mb-4">
          {[['all', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['approved', 'Approved'],
            ['declined', 'Declined'], ['converted', 'Invoiced']].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)}
              className="text-xs px-3 py-1.5 rounded-full font-semibold"
              style={{
                backgroundColor: filter === k ? ORANGE : '#f5f3f0',
                color: filter === k ? 'white' : '#555',
              }}>
              {l}{counts[k] ? ` (${counts[k]})` : ''}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-5xl mb-2">📝</p>
            <p className="text-gray-400 text-sm">No quotes in this view.</p>
          </div>
        ) : (
          <div className="rounded-xl border shadow-sm overflow-hidden" style={{ borderColor: '#f0ece8' }}>
            <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2 text-xs font-semibold text-gray-400 border-b"
              style={{ borderColor: '#f0ece8', backgroundColor: '#fafafa' }}>
              <div className="col-span-2">Quote #</div>
              <div className="col-span-3">Customer</div>
              <div className="col-span-2">Vehicle</div>
              <div className="col-span-1">Date</div>
              <div className="col-span-1 text-right">Total</div>
              <div className="col-span-1 text-center">Status</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
            <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
              {filtered.map(q => {
                const st = STATUS[q.status] || STATUS.draft
                return (
                  <div key={q.id} className="sm:grid sm:grid-cols-12 sm:gap-2 px-4 py-3 flex flex-col gap-1 hover:bg-gray-50">
                    <div className="sm:col-span-2 text-sm font-semibold" style={{ color: ORANGE }}>{q.quote_number}</div>
                    <div className="sm:col-span-3 text-sm text-gray-700 truncate">{q.customer_name || '—'}</div>
                    <div className="sm:col-span-2 text-xs text-gray-500 truncate">
                      {[q.vehicle?.year, q.vehicle?.make, q.vehicle?.model].filter(Boolean).join(' ') || '—'}
                    </div>
                    <div className="sm:col-span-1 text-xs text-gray-400">{q.date}</div>
                    <div className="sm:col-span-1 text-sm font-medium text-right">{fmt(q.total)}</div>
                    <div className="sm:col-span-1 flex sm:justify-center">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: st.bg, color: st.color }}>{st.label}</span>
                    </div>
                    <div className="sm:col-span-2 flex items-center justify-end gap-1 flex-wrap">
                      <button onClick={() => setEditing(q)}
                        className="text-xs px-2 py-1 rounded-md font-medium"
                        style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
                        Edit
                      </button>
                      {q.status === 'draft' && (
                        <button onClick={() => sendQuote(q)}
                          className="text-xs px-2 py-1 rounded-md font-medium text-white"
                          style={{ backgroundColor: ORANGE }}>
                          📧 Send
                        </button>
                      )}
                      {['sent', 'approved', 'declined'].includes(q.status) && (
                        <button onClick={() => copyLink(q)}
                          className="text-xs px-2 py-1 rounded-md font-medium"
                          style={{ backgroundColor: '#eff6ff', color: '#2563eb' }}>
                          🔗 Link
                        </button>
                      )}
                      {q.status === 'approved' && (
                        <button onClick={() => convertToInvoice(q)}
                          className="text-xs px-2 py-1 rounded-md font-medium text-white"
                          style={{ backgroundColor: '#16a34a' }}>
                          → Invoice
                        </button>
                      )}
                      {q.status !== 'converted' && (
                        <button onClick={() => deleteQuote(q)}
                          className="text-xs px-2 py-1 rounded-md font-medium"
                          style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>×</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {editing !== null && (
          <QuoteEditorModal
            quote={editing || null}
            services={services}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); load() }}
          />
        )}
      </div>
    </div>
  )
}

function QuoteEditorModal({ quote, services, onClose, onSaved }) {
  const [form, setForm] = useState(quote || {
    customer_name: '', customer_email: '', customer_phone: '', customer_contact: '',
    po_number: '', ro_number: '',
    vehicle: { year: '', make: '', model: '', vin: '' },
    date: new Date().toISOString().slice(0, 10),
    valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    line_items: [],
    tax_rate: 0, discount: 0,
    notes: '', terms: 'Net 30',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function updateLI(i, field, value) {
    const items = [...form.line_items]
    items[i] = { ...items[i], [field]: field === 'qty' || field === 'rate' ? Number(value) : value }
    setForm(f => ({ ...f, line_items: items }))
  }
  function addLI(svc) {
    setForm(f => ({ ...f, line_items: [...f.line_items, {
      description: svc?.name || 'New line item',
      qty: 1,
      rate: svc?.unit_price || 0,
    }] }))
  }
  function removeLI(i) {
    setForm(f => ({ ...f, line_items: f.line_items.filter((_, idx) => idx !== i) }))
  }

  const subtotal = form.line_items.reduce((s, li) => s + (Number(li.qty) || 0) * (Number(li.rate) || 0), 0)
  const tax = Math.max(0, (subtotal - (Number(form.discount) || 0)) * (Number(form.tax_rate) || 0) / 100)
  const total = Math.max(0, subtotal - (Number(form.discount) || 0) + tax)

  async function save() {
    if (!form.customer_name.trim()) { setError('Customer name required'); return }
    setSaving(true)
    setError('')
    try {
      const url = quote ? `${API_BASE}/api/quotes/${quote.id}` : `${API_BASE}/api/quotes`
      const method = quote ? 'PUT' : 'POST'
      const r = await apiFetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      onSaved()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b sticky top-0 bg-white flex justify-between items-center"
          style={{ borderColor: '#f0ece8' }}>
          <h2 className="text-lg font-bold">{quote ? `Edit ${quote.quote_number}` : 'New Quote'}</h2>
          <button onClick={onClose} className="text-gray-400">×</button>
        </div>
        <div className="p-5 space-y-4">
          {/* Customer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer Name *">
              <input value={form.customer_name}
                onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </Field>
            <Field label="Contact">
              <input value={form.customer_contact}
                onChange={e => setForm(f => ({ ...f, customer_contact: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </Field>
            <Field label="Email">
              <input value={form.customer_email} type="email"
                onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </Field>
            <Field label="Phone">
              <input value={form.customer_phone}
                onChange={e => setForm(f => ({ ...f, customer_phone: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </Field>
          </div>

          {/* Vehicle */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Vehicle</p>
            <div className="grid grid-cols-4 gap-2">
              <input placeholder="Year" value={form.vehicle?.year || ''}
                onChange={e => setForm(f => ({ ...f, vehicle: { ...f.vehicle, year: e.target.value } }))}
                className="border rounded-lg px-2 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              <input placeholder="Make" value={form.vehicle?.make || ''}
                onChange={e => setForm(f => ({ ...f, vehicle: { ...f.vehicle, make: e.target.value } }))}
                className="border rounded-lg px-2 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              <input placeholder="Model" value={form.vehicle?.model || ''}
                onChange={e => setForm(f => ({ ...f, vehicle: { ...f.vehicle, model: e.target.value } }))}
                className="border rounded-lg px-2 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              <input placeholder="VIN" value={form.vehicle?.vin || ''}
                onChange={e => setForm(f => ({ ...f, vehicle: { ...f.vehicle, vin: e.target.value } }))}
                className="border rounded-lg px-2 py-2 text-sm font-mono" style={{ borderColor: '#e5e7eb' }} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input placeholder="RO #" value={form.ro_number}
                onChange={e => setForm(f => ({ ...f, ro_number: e.target.value }))}
                className="border rounded-lg px-2 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              <input placeholder="PO #" value={form.po_number}
                onChange={e => setForm(f => ({ ...f, po_number: e.target.value }))}
                className="border rounded-lg px-2 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Line Items</p>
              <select onChange={e => {
                if (!e.target.value) return
                const svc = services.find(s => s.id === e.target.value)
                if (svc) addLI(svc)
                e.target.value = ''
              }} className="text-xs border rounded px-2 py-1" style={{ borderColor: '#e5e7eb' }}>
                <option value="">+ Add from catalog</option>
                {services.filter(s => s.active).map(s =>
                  <option key={s.id} value={s.id}>{s.name} — ${s.unit_price}</option>
                )}
              </select>
            </div>
            <div className="space-y-1">
              {form.line_items.map((li, i) => (
                <div key={i} className="grid grid-cols-12 gap-1 items-center">
                  <input placeholder="Description" value={li.description}
                    onChange={e => updateLI(i, 'description', e.target.value)}
                    className="col-span-6 border rounded-lg px-2 py-1.5 text-sm" style={{ borderColor: '#e5e7eb' }} />
                  <input placeholder="Qty" type="number" value={li.qty}
                    onChange={e => updateLI(i, 'qty', e.target.value)}
                    className="col-span-2 border rounded-lg px-2 py-1.5 text-sm text-right" style={{ borderColor: '#e5e7eb' }} />
                  <input placeholder="Rate" type="number" step="0.01" value={li.rate}
                    onChange={e => updateLI(i, 'rate', e.target.value)}
                    className="col-span-2 border rounded-lg px-2 py-1.5 text-sm text-right" style={{ borderColor: '#e5e7eb' }} />
                  <div className="col-span-1 text-right text-sm font-medium">
                    {fmt((Number(li.qty) || 0) * (Number(li.rate) || 0))}
                  </div>
                  <button onClick={() => removeLI(i)} className="col-span-1 text-red-500 text-xs">×</button>
                </div>
              ))}
              <button onClick={() => addLI()}
                className="w-full py-2 text-xs text-gray-500 border-2 border-dashed rounded-lg"
                style={{ borderColor: '#f0ece8' }}>
                + Add custom line item
              </button>
            </div>
          </div>

          {/* Totals */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Field label="Valid Until">
                <input type="date" value={form.valid_until}
                  onChange={e => setForm(f => ({ ...f, valid_until: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              </Field>
              <Field label="Terms">
                <select value={form.terms}
                  onChange={e => setForm(f => ({ ...f, terms: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}>
                  <option>Due on Receipt</option>
                  <option>Net 7</option>
                  <option>Net 14</option>
                  <option>Net 30</option>
                  <option>Net 45</option>
                  <option>Net 60</option>
                </select>
              </Field>
            </div>
            <div className="rounded-lg p-3" style={{ backgroundColor: '#fafafa' }}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">Subtotal</span><span>{fmt(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm mb-1 items-center">
                <span className="text-gray-500">Discount $</span>
                <input type="number" step="0.01" value={form.discount}
                  onChange={e => setForm(f => ({ ...f, discount: Number(e.target.value) }))}
                  className="w-20 border rounded px-2 py-0.5 text-sm text-right" style={{ borderColor: '#e5e7eb' }} />
              </div>
              <div className="flex justify-between text-sm mb-1 items-center">
                <span className="text-gray-500">Tax %</span>
                <input type="number" step="0.01" value={form.tax_rate}
                  onChange={e => setForm(f => ({ ...f, tax_rate: Number(e.target.value) }))}
                  className="w-20 border rounded px-2 py-0.5 text-sm text-right" style={{ borderColor: '#e5e7eb' }} />
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">Tax</span><span>{fmt(tax)}</span>
              </div>
              <div className="border-t pt-1 mt-1 flex justify-between font-bold" style={{ borderColor: '#e5e7eb' }}>
                <span>Total</span>
                <span style={{ color: ORANGE }}>{fmt(total)}</span>
              </div>
            </div>
          </div>

          <Field label="Notes / Scope of Work">
            <textarea value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows="3"
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2 sticky bottom-0 bg-white" style={{ borderColor: '#f0ece8' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: '#e5e7eb' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: ORANGE, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Quote'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}
