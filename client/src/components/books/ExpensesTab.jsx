import { useState } from 'react'
import { API_BASE, apiFetch, ORANGE, fmt, EXPENSE_CATEGORIES, PAYMENT_METHODS } from './shared'

export default function ExpensesTab({ expenses, onRefresh }) {
  const today = new Date().toISOString().slice(0, 10)
  const blankForm = { date: today, category: 'Fuel', vendor: '', description: '', amount: '', payment_method: 'Credit Card', receipt_note: '' }
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState(blankForm)
  const [editId, setEditId]     = useState(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const [filterCat, setFilterCat] = useState('all')
  const [deleting, setDeleting] = useState(null)

  function openNew() { setForm(blankForm); setEditId(null); setError(null); setShowForm(true) }
  function openEdit(e) {
    setForm({ date: e.date || today, category: e.category || 'Fuel', vendor: e.vendor || '',
      description: e.description || '', amount: String(e.amount || ''), payment_method: e.payment_method || 'Credit Card', receipt_note: e.receipt_note || '' })
    setEditId(e.id); setError(null); setShowForm(true)
  }
  function closeForm() { setShowForm(false); setEditId(null); setError(null) }

  async function saveExpense(ev) {
    ev.preventDefault()
    const amt = parseFloat(form.amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return }
    setSaving(true); setError(null)
    try {
      const url = editId ? `${API_BASE}/api/books/expenses/${editId}` : `${API_BASE}/api/books/expenses`
      const r = await apiFetch(url, {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: amt }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Save failed')
      onRefresh(); closeForm()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function deleteExpense(id) {
    if (!confirm('Delete this expense?')) return
    setDeleting(id)
    try {
      await apiFetch(`${API_BASE}/api/books/expenses/${id}`, { method: 'DELETE' })
      onRefresh()
    } catch { alert('Delete failed') }
    finally { setDeleting(null) }
  }

  const filtered = filterCat === 'all' ? expenses : expenses.filter(e => e.category === filterCat)
  const totalFiltered = filtered.reduce((s, e) => s + (e.amount || 0), 0)

  const catCounts = {}
  for (const e of expenses) catCounts[e.category] = (catCounts[e.category] || 0) + 1

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setFilterCat('all')}
            className="text-xs px-3 py-1.5 rounded-full font-medium"
            style={{ backgroundColor: filterCat === 'all' ? ORANGE : '#f5f3f0', color: filterCat === 'all' ? 'white' : '#555' }}>
            All ({expenses.length})
          </button>
          {EXPENSE_CATEGORIES.filter(c => catCounts[c]).map(c => (
            <button key={c} onClick={() => setFilterCat(c)}
              className="text-xs px-3 py-1.5 rounded-full font-medium"
              style={{ backgroundColor: filterCat === c ? ORANGE : '#f5f3f0', color: filterCat === c ? 'white' : '#555' }}>
              {c} ({catCounts[c]})
            </button>
          ))}
        </div>
        <button onClick={openNew}
          className="text-sm px-4 py-2 rounded-lg font-semibold text-white flex-shrink-0"
          style={{ backgroundColor: ORANGE }}>
          + Add Expense
        </button>
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="rounded-xl border shadow-sm p-5 mb-5" style={{ borderColor: '#f0ece8' }}>
          <h3 className="font-semibold text-sm mb-4" style={{ color: ORANGE }}>
            {editId ? 'Edit Expense' : 'New Expense'}
          </h3>
          <form onSubmit={saveExpense}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                <input type="date" value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }}>
                  {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount ($)</label>
                <input type="number" min="0.01" step="0.01" placeholder="0.00" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Vendor</label>
                <input placeholder="e.g. Shell, Amazon" value={form.vendor}
                  onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
                <select value={form.payment_method}
                  onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }}>
                  {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description / Notes</label>
                <input placeholder="What was it for?" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#e5e7eb' }} />
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
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Expense'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Total */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-500">{filtered.length} expense{filtered.length !== 1 ? 's' : ''}</span>
          <span className="text-sm font-bold" style={{ color: '#dc2626' }}>Total: {fmt(totalFiltered)}</span>
        </div>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-gray-400 text-sm">No expenses{filterCat !== 'all' ? ` in "${filterCat}"` : ''} yet.</p>
          {filterCat === 'all' && (
            <button onClick={openNew}
              className="mt-3 text-sm px-4 py-2 rounded-lg font-semibold text-white"
              style={{ backgroundColor: ORANGE }}>
              Record your first expense
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border shadow-sm overflow-hidden" style={{ borderColor: '#f0ece8' }}>
          <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2 text-xs font-semibold text-gray-400 border-b"
            style={{ borderColor: '#f0ece8', backgroundColor: '#fafafa' }}>
            <div className="col-span-2">Date</div>
            <div className="col-span-2">Category</div>
            <div className="col-span-2">Vendor</div>
            <div className="col-span-4">Description</div>
            <div className="col-span-1 text-right">Amount</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>
          <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
            {filtered.map(e => (
              <div key={e.id}
                className="sm:grid sm:grid-cols-12 sm:gap-2 px-4 py-3 flex flex-col gap-1 hover:bg-gray-50">
                <div className="sm:col-span-2 text-xs text-gray-400">{e.date}</div>
                <div className="sm:col-span-2">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: '#f5f3f0', color: '#555' }}>{e.category}</span>
                </div>
                <div className="sm:col-span-2 text-sm text-gray-600 truncate">{e.vendor || <span className="text-gray-300">—</span>}</div>
                <div className="sm:col-span-4 text-sm text-gray-600 truncate">{e.description || <span className="text-gray-300">—</span>}</div>
                <div className="sm:col-span-1 text-sm font-semibold text-right" style={{ color: '#dc2626' }}>{fmt(e.amount)}</div>
                <div className="sm:col-span-1 flex items-center justify-end gap-1">
                  <button onClick={() => openEdit(e)}
                    className="text-xs px-2 py-1 rounded-md" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
                    Edit
                  </button>
                  <button onClick={() => deleteExpense(e.id)} disabled={deleting === e.id}
                    className="text-xs px-2 py-1 rounded-md" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
                    {deleting === e.id ? '…' : 'Del'}
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
