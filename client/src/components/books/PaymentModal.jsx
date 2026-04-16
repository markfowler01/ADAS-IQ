import { useState } from 'react'
import { API_BASE, apiFetch, ORANGE, fmt } from './shared'

export default function PaymentModal({ invoice, onClose, onSave }) {
  const [amount, setAmount] = useState(String(invoice.balance_due || 0))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const val = parseFloat(amount)
    if (!val || val <= 0) { setError('Enter a valid amount'); return }
    setLoading(true)
    setError(null)
    try {
      const r = await apiFetch(`${API_BASE}/api/books/invoices/${invoice.id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: val }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed')
      onSave(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-lg font-bold mb-1" style={{ color: '#1a1a1a' }}>Record Payment</h3>
        <p className="text-sm text-gray-500 mb-4">
          Invoice {invoice.invoice_number} — Balance due: <strong>{fmt(invoice.balance_due)}</strong>
        </p>
        <form onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount Received</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ borderColor: '#e5e7eb' }}
            autoFocus
          />
          {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border"
              style={{ borderColor: '#e5e7eb', color: '#555' }}>
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: ORANGE, opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Saving...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
