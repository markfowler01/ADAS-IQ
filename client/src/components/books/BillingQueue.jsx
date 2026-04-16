import { useState, useMemo } from 'react'
import { API_BASE, apiFetch, ORANGE, fmt, StatusBadge } from './shared'

// ── Billing queue columns ───────────────────────────────────────────────────

const BILLING_COLUMNS = [
  { id: 'job_complete',     label: 'Job Complete',      emoji: '\u2705', color: '#16a34a', bg: '#f0fdf4' },
  { id: 'invoice_needed',   label: 'Invoice Needed',    emoji: '\ud83d\udccb', color: '#b45309', bg: '#fef3c7' },
  { id: 'invoice_created',  label: 'Invoice Created',   emoji: '\ud83d\udcc4', color: '#7c3aed', bg: '#ede9fe' },
  { id: 'sent',             label: 'Sent to Customer',  emoji: '\ud83d\udce7', color: '#2563eb', bg: '#dbeafe' },
  { id: 'awaiting_payment', label: 'Awaiting Payment',  emoji: '\u23f3', color: '#0e7490', bg: '#cffafe' },
  { id: 'paid',             label: 'Paid',              emoji: '\ud83d\udcb0', color: '#15803d', bg: '#dcfce7' },
  { id: 'overdue',          label: 'Overdue',           emoji: '\ud83d\udea8', color: '#dc2626', bg: '#fee2e2' },
  { id: 'escalated',        label: 'Escalated',         emoji: '\u26a0\ufe0f', color: '#9f1239', bg: '#ffe4e6' },
]

const VALID_STATUSES = BILLING_COLUMNS.map(c => c.id)

// ── Helpers ─────────────────────────────────────────────────────────────────

function daysSince(dateStr) {
  if (!dateStr) return 0
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.max(0, Math.floor(diff / 86400000))
}

function ageColor(days) {
  if (days < 7)  return '#16a34a'  // green
  if (days < 14) return '#ca8a04'  // yellow
  if (days < 30) return '#ea580c'  // orange
  return '#dc2626'                 // red
}

function ageBg(days) {
  if (days < 7)  return '#f0fdf4'
  if (days < 14) return '#fefce8'
  if (days < 30) return '#fff7ed'
  return '#fef2f2'
}

// ── Map invoice status to billing column ────────────────────────────────────

function mapInvoiceToColumn(inv) {
  if (inv.status === 'void') return null
  if (inv.billing_status && VALID_STATUSES.includes(inv.billing_status)) return inv.billing_status
  if (inv.status === 'draft') return 'invoice_created'
  if (inv.status === 'paid') return 'paid'
  if (inv.status === 'overdue') return 'overdue'
  if (inv.status === 'sent') {
    // Check if overdue based on due_date
    if (inv.due_date) {
      const today = new Date().toISOString().slice(0, 10)
      if (inv.due_date < today) return 'overdue'
    }
    return 'sent'
  }
  return 'invoice_created'
}

// ── Component ───────────────────────────────────────────────────────────────

export default function BillingQueue({ invoices = [], jobs = [], onRefresh, onEditInvoice }) {
  const [updating, setUpdating] = useState(null) // id of item being updated

  // Build column data
  const columns = useMemo(() => {
    const colMap = {}
    for (const col of BILLING_COLUMNS) {
      colMap[col.id] = { ...col, items: [], totalAmount: 0 }
    }

    // Map jobs to job_complete / invoice_needed
    for (const job of jobs) {
      const hasInvoice = invoices.some(inv => inv.job_id === job.id)
      const colId = hasInvoice ? null : (job.status === 'complete' ? 'job_complete' : null)
      if (colId && colMap[colId]) {
        const item = {
          id: job.id,
          type: 'job',
          ref: job.ro_number || job.id,
          customer_name: job.shop_name || job.customer_name || '',
          amount: job.estimated_total || 0,
          created_at: job.completed_at || job.created_at || '',
          due_date: null,
          vehicle: job.vehicle || '',
          raw: job,
        }
        colMap[colId].items.push(item)
        colMap[colId].totalAmount += item.amount
      }
    }

    // Map invoices to columns
    for (const inv of invoices) {
      const colId = mapInvoiceToColumn(inv)
      if (!colId || !colMap[colId]) continue

      const item = {
        id: inv.id,
        type: 'invoice',
        ref: inv.invoice_number,
        customer_name: inv.customer_name || '',
        amount: inv.total || 0,
        balance_due: inv.balance_due || 0,
        created_at: inv.created_at || '',
        sent_at: inv.sent_at || '',
        due_date: inv.due_date || '',
        status: inv.status,
        billing_status: inv.billing_status,
        raw: inv,
      }
      colMap[colId].items.push(item)
      colMap[colId].totalAmount += (inv.balance_due || inv.total || 0)
    }

    return BILLING_COLUMNS.map(col => colMap[col.id])
  }, [invoices, jobs])

  // Summary stats
  const summary = useMemo(() => {
    const outstanding = invoices
      .filter(i => i.status === 'sent' || i.status === 'overdue')
      .reduce((s, i) => s + (i.balance_due || 0), 0)

    const overdue = invoices
      .filter(i => i.status === 'overdue')
      .reduce((s, i) => s + (i.balance_due || 0), 0)

    const paidInvoices = invoices.filter(i => i.status === 'paid' && i.sent_at && i.paid_at)
    let avgDaysToPay = 0
    if (paidInvoices.length > 0) {
      const totalDays = paidInvoices.reduce((s, i) => {
        const sent = new Date(i.sent_at || i.created_at)
        const paid = new Date(i.paid_at)
        return s + Math.max(0, Math.floor((paid - sent) / 86400000))
      }, 0)
      avgDaysToPay = Math.round(totalDays / paidInvoices.length)
    }

    return { outstanding, overdue, avgDaysToPay }
  }, [invoices])

  // Quick status change
  async function quickStatusChange(item, newStatus) {
    if (item.type !== 'invoice') return
    setUpdating(item.id)
    try {
      const body = { status: newStatus }
      if (newStatus === 'sent') body.sent_at = new Date().toISOString()
      if (newStatus === 'paid') body.paid_at = new Date().toISOString()

      await apiFetch(`${API_BASE}/api/books/invoices/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      onRefresh?.()
    } catch (err) {
      alert('Status update failed: ' + err.message)
    } finally {
      setUpdating(null)
    }
  }

  // Record full payment
  async function recordPayment(item) {
    if (item.type !== 'invoice') return
    const amount = item.balance_due || item.amount
    if (amount <= 0) return
    setUpdating(item.id)
    try {
      await apiFetch(`${API_BASE}/api/books/invoices/${item.id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      onRefresh?.()
    } catch (err) {
      alert('Payment failed: ' + err.message)
    } finally {
      setUpdating(null)
    }
  }

  // Escalate
  async function escalate(item) {
    if (item.type !== 'invoice') return
    setUpdating(item.id)
    try {
      await apiFetch(`${API_BASE}/api/books/invoices/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billing_status: 'escalated',
          escalated_at: new Date().toISOString(),
        }),
      })
      onRefresh?.()
    } catch (err) {
      alert('Escalation failed: ' + err.message)
    } finally {
      setUpdating(null)
    }
  }

  // Render quick action button for an item in a column
  function renderAction(item, colId) {
    const isUpdating = updating === item.id
    const btnStyle = {
      backgroundColor: ORANGE,
      color: 'white',
      fontSize: '11px',
      padding: '3px 8px',
      borderRadius: '6px',
      fontWeight: 600,
      opacity: isUpdating ? 0.6 : 1,
      cursor: isUpdating ? 'not-allowed' : 'pointer',
      border: 'none',
      whiteSpace: 'nowrap',
    }

    if (colId === 'job_complete' || colId === 'invoice_needed') {
      return (
        <button style={btnStyle} disabled={isUpdating}
          onClick={e => { e.stopPropagation(); onEditInvoice?.(null, item.raw) }}>
          {isUpdating ? '...' : 'Create Invoice'}
        </button>
      )
    }
    if (colId === 'invoice_created') {
      return (
        <button style={btnStyle} disabled={isUpdating}
          onClick={e => { e.stopPropagation(); quickStatusChange(item, 'sent') }}>
          {isUpdating ? '...' : 'Mark Sent'}
        </button>
      )
    }
    if (colId === 'sent' || colId === 'awaiting_payment') {
      return (
        <button style={btnStyle} disabled={isUpdating}
          onClick={e => { e.stopPropagation(); recordPayment(item) }}>
          {isUpdating ? '...' : 'Record Payment'}
        </button>
      )
    }
    if (colId === 'overdue') {
      return (
        <div className="flex gap-1">
          <button style={btnStyle} disabled={isUpdating}
            onClick={e => { e.stopPropagation(); recordPayment(item) }}>
            {isUpdating ? '...' : 'Pay'}
          </button>
          <button style={{ ...btnStyle, backgroundColor: '#9f1239' }} disabled={isUpdating}
            onClick={e => { e.stopPropagation(); escalate(item) }}>
            {isUpdating ? '...' : 'Escalate'}
          </button>
        </div>
      )
    }
    return null
  }

  return (
    <div>
      {/* Summary bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl border px-4 py-3" style={{ borderColor: '#f0ece8' }}>
          <div className="text-xs text-gray-400 font-medium">Total Outstanding</div>
          <div className="text-xl font-bold mt-0.5" style={{ color: '#1a1a1a' }}>{fmt(summary.outstanding)}</div>
        </div>
        <div className="rounded-xl border px-4 py-3" style={{ borderColor: '#f0ece8' }}>
          <div className="text-xs text-gray-400 font-medium">Total Overdue</div>
          <div className="text-xl font-bold mt-0.5" style={{ color: '#dc2626' }}>{fmt(summary.overdue)}</div>
        </div>
        <div className="rounded-xl border px-4 py-3" style={{ borderColor: '#f0ece8' }}>
          <div className="text-xs text-gray-400 font-medium">Avg Days to Pay</div>
          <div className="text-xl font-bold mt-0.5" style={{ color: '#1a1a1a' }}>
            {summary.avgDaysToPay > 0 ? `${summary.avgDaysToPay} days` : '--'}
          </div>
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '400px' }}>
        {columns.map(col => (
          <div key={col.id} className="flex-shrink-0 flex flex-col rounded-xl border"
            style={{
              width: '260px',
              minWidth: '220px',
              borderColor: '#f0ece8',
              backgroundColor: '#fafafa',
            }}>
            {/* Column header */}
            <div className="px-3 py-2.5 rounded-t-xl" style={{ backgroundColor: col.bg }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{col.emoji}</span>
                  <span className="text-xs font-semibold" style={{ color: col.color }}>
                    {col.label}
                  </span>
                </div>
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: col.color, color: 'white', minWidth: '20px', textAlign: 'center' }}>
                  {col.items.length}
                </span>
              </div>
              {col.totalAmount > 0 && (
                <div className="text-xs font-semibold mt-1" style={{ color: col.color }}>
                  {fmt(col.totalAmount)}
                </div>
              )}
            </div>

            {/* Cards */}
            <div className="flex-1 p-2 space-y-2 overflow-y-auto" style={{ maxHeight: '70vh' }}>
              {col.items.length === 0 && (
                <div className="text-xs text-gray-300 text-center py-6">No items</div>
              )}
              {col.items.map(item => {
                const days = daysSince(item.sent_at || item.created_at)
                const borderLeft = `3px solid ${ageColor(days)}`

                return (
                  <div key={item.id}
                    className="rounded-lg border bg-white shadow-sm transition-all hover:shadow-md"
                    style={{
                      borderColor: '#f0ece8',
                      borderLeft,
                      cursor: item.type === 'invoice' ? 'pointer' : 'default',
                    }}
                    onClick={() => {
                      if (item.type === 'invoice') onEditInvoice?.(item.raw)
                    }}>
                    <div className="px-3 py-2.5">
                      {/* Ref / invoice number */}
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold" style={{ color: ORANGE }}>
                          {item.ref}
                        </span>
                        {item.type === 'invoice' && <StatusBadge status={item.status} />}
                        {item.type === 'job' && (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: '#f0fdf4', color: '#16a34a' }}>
                            Job
                          </span>
                        )}
                      </div>

                      {/* Customer */}
                      <div className="text-sm text-gray-700 truncate mb-1">
                        {item.customer_name || <span className="text-gray-300 italic">No customer</span>}
                      </div>

                      {/* Vehicle (for jobs) */}
                      {item.vehicle && (
                        <div className="text-xs text-gray-400 truncate mb-1">{item.vehicle}</div>
                      )}

                      {/* Amount + age */}
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>
                          {fmt(item.amount)}
                        </span>
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: ageBg(days), color: ageColor(days) }}>
                          {days}d
                        </span>
                      </div>

                      {/* Due date */}
                      {item.due_date && (
                        <div className="text-xs text-gray-400 mt-1">
                          Due: {item.due_date}
                        </div>
                      )}

                      {/* Quick action */}
                      <div className="mt-2">
                        {renderAction(item, col.id)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
