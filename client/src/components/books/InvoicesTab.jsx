import { useState } from 'react'
import { API_BASE, apiFetch, ORANGE, fmt, StatusBadge } from './shared'
import InvoiceEditor from './InvoiceEditor'
import PaymentModal from './PaymentModal'

export default function InvoicesTab({ invoices, services, onRefresh, loading }) {
  const [filter, setFilter] = useState('all')
  const [editInvoice, setEditInvoice] = useState(null) // null=closed, false=new, object=edit
  const [payInvoice, setPayInvoice] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const counts = { all: invoices.length }
  for (const inv of invoices) {
    counts[inv.status] = (counts[inv.status] || 0) + 1
  }

  const filtered = filter === 'all' ? invoices : invoices.filter(i => i.status === filter)

  async function handleDelete(inv) {
    if (!confirm(`Delete ${inv.invoice_number}? This cannot be undone.`)) return
    setDeleting(inv.id)
    try {
      await apiFetch(`${API_BASE}/api/books/invoices/${inv.id}`, { method: 'DELETE' })
      onRefresh()
    } catch (err) {
      alert('Delete failed: ' + err.message)
    } finally {
      setDeleting(null)
    }
  }

  const filterBtns = [
    { key: 'all', label: 'All' },
    { key: 'draft', label: 'Draft' },
    { key: 'sent', label: 'Sent' },
    { key: 'paid', label: 'Paid' },
    { key: 'overdue', label: 'Overdue' },
  ]

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap gap-1">
          {filterBtns.map(btn => (
            <button key={btn.key} onClick={() => setFilter(btn.key)}
              className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
              style={{
                backgroundColor: filter === btn.key ? ORANGE : '#f5f3f0',
                color: filter === btn.key ? 'white' : '#555',
              }}>
              {btn.label}{counts[btn.key] ? ` (${counts[btn.key]})` : ''}
            </button>
          ))}
        </div>
        <button onClick={() => setEditInvoice(false)}
          className="text-sm px-4 py-2 rounded-lg font-semibold text-white"
          style={{ backgroundColor: ORANGE }}>
          + New Invoice
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading invoices…</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-gray-400 text-sm">No invoices found.</p>
          {filter === 'all' && (
            <button onClick={() => setEditInvoice(false)}
              className="mt-3 text-sm px-4 py-2 rounded-lg font-semibold text-white"
              style={{ backgroundColor: ORANGE }}>
              Create your first invoice
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border shadow-sm overflow-hidden" style={{ borderColor: '#f0ece8' }}>
          {/* Desktop header */}
          <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2 text-xs font-semibold text-gray-400 border-b"
            style={{ borderColor: '#f0ece8', backgroundColor: '#fafafa' }}>
            <div className="col-span-2">Invoice #</div>
            <div className="col-span-3">Customer</div>
            <div className="col-span-1">Date</div>
            <div className="col-span-2">Due</div>
            <div className="col-span-1 text-right">Amount</div>
            <div className="col-span-1 text-center">Status</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
            {filtered.map(inv => (
              <div key={inv.id}
                className="sm:grid sm:grid-cols-12 sm:gap-2 px-4 py-3 flex flex-col gap-1 hover:bg-gray-50 transition-colors">
                <div className="sm:col-span-2 text-sm font-semibold" style={{ color: ORANGE }}>
                  {inv.invoice_number}
                </div>
                <div className="sm:col-span-3 text-sm text-gray-700 truncate">
                  {inv.customer_name || <span className="text-gray-400 italic">No customer</span>}
                </div>
                <div className="sm:col-span-1 text-xs text-gray-400">{inv.date || '—'}</div>
                <div className="sm:col-span-2 text-xs text-gray-400">{inv.due_date || '—'}</div>
                <div className="sm:col-span-1 text-sm font-medium text-right">{fmt(inv.total)}</div>
                <div className="sm:col-span-1 flex sm:justify-center">
                  <StatusBadge status={inv.status} />
                </div>
                <div className="sm:col-span-2 flex items-center justify-end gap-1">
                  <button onClick={() => setEditInvoice(inv)}
                    className="text-xs px-2 py-1 rounded-md font-medium transition-colors"
                    style={{ color: '#555', backgroundColor: '#f5f3f0' }}>
                    Edit
                  </button>
                  <button
                    onClick={() => window.open(`${API_BASE}/api/books/invoices/${inv.id}/pdf`)}
                    className="text-xs px-2 py-1 rounded-md font-medium transition-colors"
                    style={{ color: ORANGE, backgroundColor: '#fff7f5', border: `1px solid #fcd5c5` }}>
                    PDF
                  </button>
                  {['sent', 'draft', 'overdue'].includes(inv.status) && (
                    <button
                      onClick={async () => {
                        try {
                          const r = await apiFetch(`${API_BASE}/api/books/invoices/${inv.id}/pay-link`)
                          const { url } = await r.json()
                          await navigator.clipboard.writeText(url)
                          alert('Pay link copied!\n\n' + url)
                        } catch (e) { alert('Failed: ' + e.message) }
                      }}
                      className="text-xs px-2 py-1 rounded-md font-medium transition-colors"
                      style={{ color: '#2563eb', backgroundColor: '#eff6ff' }}>
                      🔗 Pay
                    </button>
                  )}
                  <button onClick={() => handleDelete(inv)}
                    disabled={deleting === inv.id}
                    className="text-xs px-2 py-1 rounded-md font-medium transition-colors"
                    style={{ color: '#dc2626', backgroundColor: '#fef2f2' }}>
                    {deleting === inv.id ? '…' : 'Del'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invoice editor */}
      {editInvoice !== null && (
        <InvoiceEditor
          invoice={editInvoice || null}
          services={services}
          onClose={() => setEditInvoice(null)}
          onSaved={() => { setEditInvoice(null); onRefresh() }}
        />
      )}

      {/* Payment modal */}
      {payInvoice && (
        <PaymentModal
          invoice={payInvoice}
          onClose={() => setPayInvoice(null)}
          onSave={() => { setPayInvoice(null); onRefresh() }}
        />
      )}
    </div>
  )
}
