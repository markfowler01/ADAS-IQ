import { useState } from 'react'
import { API_BASE, apiFetch, ORANGE, fmt, DEPOSIT_METHODS } from './shared'

export default function DepositsTab({ deposits, invoices, onRefresh }) {
  const today = new Date().toISOString().slice(0, 10)
  const blankForm = { date: today, amount: '', from: '', memo: '', method: 'Check', invoice_id: '', invoice_number: '' }
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState(blankForm)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)
  const [deleting, setDeleting]   = useState(null)
  const [invSearch, setInvSearch] = useState('')

  function openNew() { setForm(blankForm); setInvSearch(''); setError(null); setShowForm(true) }
  function closeForm() { setShowForm(false); setError(null) }
  function linkInvoice(inv) {
    setForm(f => ({ ...f, invoice_id: inv.id, invoice_number: inv.invoice_number, from: f.from || inv.customer_name || '', amount: f.amount || String(inv.balance_due || '') }))
    setInvSearch(inv.invoice_number)
  }

  async function saveDeposit(ev) {
    ev.preventDefault()
    const amt = parseFloat(form.amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return }
    setSaving(true); setError(null)
    try {
      const r = await apiFetch(`${API_BASE}/api/books/deposits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: amt }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Save failed')
      onRefresh(); closeForm()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function deleteDeposit(id) {
    if (!confirm('Delete this deposit record?')) return
    setDeleting(id)
    try {
      await apiFetch(`${API_BASE}/api/books/deposits/${id}`, { method: 'DELETE' })
      onRefresh()
    } catch { alert('Delete failed') }
    finally { setDeleting(null) }
  }

  const unpaidInvoices = invoices.filter(i => (i.status === 'sent' || i.status === 'overdue') && (i.balance_due || 0) > 0)
  const matchedInvoices = invSearch.length > 1
    ? unpaidInvoices.filter(i => i.invoice_number.toLowerCase().includes(invSearch.toLowerCase()) || (i.customer_name || '').toLowerCase().includes(invSearch.toLowerCase()))
    : []

  const totalDeposited = deposits.reduce((s, d) => s + (d.amount || 0), 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs text-gray-500">Track checks and payments received</p>
        </div>
        <button onClick={openNew}
          className="text-sm px-4 py-2 rounded-lg font-semibold text-white flex-shrink-0"
          style={{ backgroundColor: ORANGE }}>
          + Record Deposit
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-xl border shadow-sm p-5 mb-5" style={{ borderColor: '#f0ece8' }}>
          <h3 className="font-semibold text-sm mb-4" style={{ color: ORANGE }}>Record Deposit</h3>
          <form onSubmit={saveDeposit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                <input type="date" value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount ($)</label>
                <input type="number" min="0.01" step="0.01" placeholder="0.00" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
                <select value={form.method}
                  onChange={e => setForm(f => ({ ...f, method: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }}>
                  {DEPOSIT_METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                <input placeholder="Shop / customer name" value={form.from}
                  onChange={e => setForm(f => ({ ...f, from: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Memo / Check #</label>
                <input placeholder="Check #12345 or memo" value={form.memo}
                  onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }} />
              </div>
              {/* Link to invoice */}
              <div className="relative">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Link Invoice <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input placeholder="Search invoice # or shop…" value={invSearch}
                  onChange={e => { setInvSearch(e.target.value); if (!e.target.value) setForm(f => ({ ...f, invoice_id: '', invoice_number: '' })) }}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: form.invoice_id ? ORANGE : '#e5e7eb' }} />
                {matchedInvoices.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-40 overflow-y-auto" style={{ borderColor: '#e5e7eb' }}>
                    {matchedInvoices.map(inv => (
                      <button key={inv.id} type="button" onClick={() => linkInvoice(inv)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b last:border-0"
                        style={{ borderColor: '#f5f3f0' }}>
                        <span className="font-medium" style={{ color: ORANGE }}>{inv.invoice_number}</span>
                        <span className="text-gray-600 ml-2">{inv.customer_name}</span>
                        <span className="text-gray-400 ml-2">{fmt(inv.balance_due)} due</span>
                      </button>
                    ))}
                  </div>
                )}
                {form.invoice_id && (
                  <p className="text-xs mt-1" style={{ color: '#16a34a' }}>✓ Linked to {form.invoice_number}</p>
                )}
              </div>
            </div>
            {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={closeForm}
                className="px-4 py-2 rounded-lg text-sm font-medium border"
                style={{ borderColor: '#e5e7eb', color: '#555' }}>
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ backgroundColor: ORANGE, opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving…' : 'Record Deposit'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Unpaid invoices reminder */}
      {unpaidInvoices.length > 0 && !showForm && (
        <div className="rounded-xl p-4 mb-4 flex items-center justify-between gap-3"
          style={{ backgroundColor: '#fff7f5', border: `1px solid #fcd5c5` }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: ORANGE }}>
              {unpaidInvoices.length} outstanding invoice{unpaidInvoices.length !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Total due: <strong>{fmt(unpaidInvoices.reduce((s, i) => s + (i.balance_due || 0), 0))}</strong>
            </p>
          </div>
          <button onClick={openNew}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white flex-shrink-0"
            style={{ backgroundColor: ORANGE }}>
            Record payment
          </button>
        </div>
      )}

      {/* Total */}
      {deposits.length > 0 && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-500">{deposits.length} deposit{deposits.length !== 1 ? 's' : ''}</span>
          <span className="text-sm font-bold" style={{ color: '#16a34a' }}>Total: {fmt(totalDeposited)}</span>
        </div>
      )}

      {/* List */}
      {deposits.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-gray-400 text-sm">No deposits recorded yet.</p>
          <button onClick={openNew}
            className="mt-3 text-sm px-4 py-2 rounded-lg font-semibold text-white"
            style={{ backgroundColor: ORANGE }}>
            Record your first deposit
          </button>
        </div>
      ) : (
        <div className="rounded-xl border shadow-sm overflow-hidden" style={{ borderColor: '#f0ece8' }}>
          <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2 text-xs font-semibold text-gray-400 border-b"
            style={{ borderColor: '#f0ece8', backgroundColor: '#fafafa' }}>
            <div className="col-span-2">Date</div>
            <div className="col-span-2">Method</div>
            <div className="col-span-3">From</div>
            <div className="col-span-2">Memo</div>
            <div className="col-span-2">Invoice</div>
            <div className="col-span-1 text-right">Amount</div>
          </div>
          <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
            {deposits.map(d => (
              <div key={d.id}
                className="sm:grid sm:grid-cols-12 sm:gap-2 px-4 py-3 flex flex-col gap-1 hover:bg-gray-50">
                <div className="sm:col-span-2 text-xs text-gray-400">{d.date}</div>
                <div className="sm:col-span-2">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: '#e0f2fe', color: '#0369a1' }}>{d.method}</span>
                </div>
                <div className="sm:col-span-3 text-sm text-gray-700 truncate">{d.from || '—'}</div>
                <div className="sm:col-span-2 text-sm text-gray-500 truncate">{d.memo || '—'}</div>
                <div className="sm:col-span-2 text-xs" style={{ color: d.invoice_number ? ORANGE : '#ccc' }}>
                  {d.invoice_number || '—'}
                </div>
                <div className="sm:col-span-1 flex items-center justify-end gap-1">
                  <span className="text-sm font-semibold" style={{ color: '#16a34a' }}>{fmt(d.amount)}</span>
                  <button onClick={() => deleteDeposit(d.id)} disabled={deleting === d.id}
                    className="text-xs px-1.5 py-0.5 rounded ml-1" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
                    {deleting === d.id ? '…' : '×'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
