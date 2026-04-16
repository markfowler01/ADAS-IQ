import { useState, useEffect, useCallback } from 'react'
import { API_BASE, portalFetch, getPortalToken } from '../utils/portal'

const ORANGE = '#CD4419'

function fmt(n) { return `$${Number(n || 0).toFixed(2)}` }

const STATUS_BADGES = {
  draft:    { bg: '#e5e7eb', color: '#374151', label: 'Draft' },
  sent:     { bg: '#dbeafe', color: '#1d4ed8', label: 'Awaiting Payment' },
  paid:     { bg: '#dcfce7', color: '#15803d', label: 'Paid ✓' },
  overdue:  { bg: '#fee2e2', color: '#b91c1c', label: 'Overdue' },
  void:     { bg: '#e5e7eb', color: '#6b7280', label: 'Void' },
}

const TYPE_BADGES = {
  insurance: { bg: '#dbeafe', color: '#1d4ed8', label: '📋 Insurance' },
  shop:      { bg: '#ede9fe', color: '#7c3aed', label: '🏪 Shop' },
  standard:  { bg: '#f5f3f0', color: '#555555', label: '📄 Invoice' },
}

export default function PortalScreen({ shop, onLogout }) {
  const [tab, setTab] = useState('all')
  const [invoices, setInvoices] = useState([])
  const [myJobs, setMyJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [payModal, setPayModal] = useState(null)
  const [submitJobOpen, setSubmitJobOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [inv, jobs] = await Promise.all([
        portalFetch(`${API_BASE}/api/portal/invoices`).then(r => r.json()),
        portalFetch(`${API_BASE}/api/portal/my-jobs`).then(r => r.json()).catch(() => []),
      ])
      setInvoices(Array.isArray(inv) ? inv : [])
      setMyJobs(Array.isArray(jobs) ? jobs : [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function downloadPdf(inv) {
    const token = getPortalToken()
    window.open(`${API_BASE}/api/portal/invoices/${inv.id}/pdf?portal_token=${encodeURIComponent(token)}`, '_blank')
  }

  // Group + filter
  const unpaid = invoices.filter(i => ['sent', 'overdue'].includes(i.status) && (i.balance_due || i.total) > 0)
  const paid = invoices.filter(i => i.status === 'paid')
  const insurance = invoices.filter(i => i.invoice_type === 'insurance')
  const shopInv = invoices.filter(i => i.invoice_type === 'shop')

  const shown = tab === 'unpaid' ? unpaid
    : tab === 'paid' ? paid
    : tab === 'insurance' ? insurance
    : tab === 'shop' ? shopInv
    : invoices

  const totalOutstanding = unpaid.reduce((s, i) => s + Number(i.balance_due || i.total || 0), 0)

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#fafafa' }}>
      {/* Header */}
      <header className="bg-white border-b" style={{ borderColor: '#f0ece8' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 px-3 py-1.5 rounded-lg" style={{ backgroundColor: ORANGE }}>
              <span className="text-white font-bold text-sm">ABSOLUTE ADAS</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: '#1a1a1a' }}>
                {shop.shop_name}
              </p>
              <p className="text-xs text-gray-500 truncate">{shop.email || ''}</p>
            </div>
          </div>
          <button onClick={onLogout}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold flex-shrink-0"
            style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
            Log Out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Outstanding summary */}
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl p-5 shadow-sm" style={{ backgroundColor: unpaid.length > 0 ? '#fff7f5' : '#f0fdf4' }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: unpaid.length > 0 ? ORANGE : '#16a34a' }}>
              Outstanding Balance
            </p>
            <p className="text-3xl font-bold mt-1" style={{ color: unpaid.length > 0 ? ORANGE : '#16a34a' }}>
              {fmt(totalOutstanding)}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {unpaid.length} unpaid invoice{unpaid.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="rounded-xl p-5 shadow-sm bg-white" style={{ border: '1px solid #f0ece8' }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Paid Invoices</p>
            <p className="text-3xl font-bold mt-1" style={{ color: '#1a1a1a' }}>{paid.length}</p>
            <p className="text-xs text-gray-500 mt-1">
              {fmt(paid.reduce((s, i) => s + Number(i.total || 0), 0))} lifetime
            </p>
          </div>
          <div className="rounded-xl p-5 shadow-sm bg-white" style={{ border: '1px solid #f0ece8' }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Invoices</p>
            <p className="text-3xl font-bold mt-1" style={{ color: '#1a1a1a' }}>{invoices.length}</p>
            <p className="text-xs text-gray-500 mt-1">
              {insurance.length} insurance · {shopInv.length} shop
            </p>
          </div>
        </div>

        {/* Submit new job CTA */}
        <div className="rounded-xl p-4 mb-6 flex items-center justify-between gap-3 flex-wrap"
          style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: '#15803d' }}>
              🚗 Need a calibration?
            </p>
            <p className="text-xs text-gray-600 mt-0.5">
              Submit a job request directly — we'll dispatch and confirm the schedule.
            </p>
          </div>
          <button onClick={() => setSubmitJobOpen(true)}
            className="text-xs px-4 py-2 rounded-lg font-semibold text-white flex-shrink-0"
            style={{ backgroundColor: '#16a34a' }}>
            + Request Job
          </button>
        </div>

        {/* Quick pay all */}
        {unpaid.length > 0 && (
          <div className="rounded-xl p-4 mb-6 flex items-center justify-between gap-3 flex-wrap"
            style={{ backgroundColor: '#fff7f5', border: `1px solid #fcd5c5` }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: ORANGE }}>
                💳 Ready to pay?
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                Click any invoice below to pay it individually, or download a PDF.
              </p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1.5 flex-wrap mb-4">
          {[
            { id: 'all', label: `All (${invoices.length})` },
            { id: 'unpaid', label: `Unpaid (${unpaid.length})` },
            { id: 'paid', label: `Paid (${paid.length})` },
            { id: 'insurance', label: `Insurance (${insurance.length})` },
            { id: 'shop', label: `Shop (${shopInv.length})` },
            { id: 'jobs', label: `My Jobs (${myJobs.length})` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="text-xs px-3 py-1.5 rounded-full font-semibold"
              style={{
                backgroundColor: tab === t.id ? ORANGE : '#f5f3f0',
                color: tab === t.id ? 'white' : '#555',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Jobs tab */}
        {tab === 'jobs' && !loading && (
          <MyJobsList jobs={myJobs} />
        )}

        {/* Invoice list */}
        {tab !== 'jobs' && (loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-5xl mb-2">📄</p>
            <p className="text-gray-400 text-sm">No invoices in this view.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {shown.map(inv => {
              const status = STATUS_BADGES[inv.status] || STATUS_BADGES.draft
              const type = TYPE_BADGES[inv.invoice_type] || TYPE_BADGES.standard
              const balance = Number(inv.balance_due ?? inv.total) || 0
              const canPay = ['sent', 'overdue', 'draft'].includes(inv.status) && balance > 0
              return (
                <div key={inv.id} className="rounded-xl bg-white border shadow-sm p-4"
                  style={{ borderColor: inv.status === 'overdue' ? '#fecaca' : '#f0ece8' }}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-bold" style={{ color: ORANGE }}>
                          {inv.invoice_number}
                        </span>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: type.bg, color: type.color }}>
                          {type.label}
                        </span>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: status.bg, color: status.color }}>
                          {status.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        Date: {inv.date || '—'}
                        {inv.due_date && ` · Due: ${inv.due_date}`}
                        {inv.po_number && ` · PO# ${inv.po_number}`}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {(inv.line_items || []).length} line item{(inv.line_items || []).length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-lg font-bold" style={{ color: '#1a1a1a' }}>{fmt(inv.total)}</p>
                      {inv.amount_paid > 0 && (
                        <p className="text-xs text-gray-500">
                          Paid: <span style={{ color: '#16a34a' }}>{fmt(inv.amount_paid)}</span>
                        </p>
                      )}
                      {balance > 0 && inv.status !== 'paid' && (
                        <p className="text-xs font-semibold" style={{ color: ORANGE }}>
                          Balance: {fmt(balance)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3 pt-3 border-t flex-wrap" style={{ borderColor: '#f7f4f1' }}>
                    <button onClick={() => downloadPdf(inv)}
                      className="text-xs px-3 py-1.5 rounded-md font-semibold"
                      style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
                      📄 Download PDF
                    </button>
                    {canPay && (
                      <button onClick={() => setPayModal(inv)}
                        className="text-xs px-3 py-1.5 rounded-md font-semibold text-white ml-auto"
                        style={{ backgroundColor: ORANGE }}>
                        💳 Pay {fmt(balance)}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </main>

      {payModal && (
        <PayInvoiceModal invoice={payModal}
          onClose={() => setPayModal(null)}
          onPaid={() => { setPayModal(null); load() }} />
      )}
      {submitJobOpen && (
        <SubmitJobModal shop={shop}
          onClose={() => setSubmitJobOpen(false)}
          onSubmitted={() => { setSubmitJobOpen(false); load() }} />
      )}
    </div>
  )
}

function PayInvoiceModal({ invoice, onClose, onPaid }) {
  const balance = Number(invoice.balance_due ?? invoice.total) || 0
  const [method, setMethod] = useState('ACH / Bank Transfer')
  const [amount, setAmount] = useState(String(balance))
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [stripeOn, setStripeOn] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/portal/stripe/status`)
      .then(r => r.json())
      .then(d => setStripeOn(!!d.configured))
      .catch(() => {})
  }, [])

  async function startStripe(payMethod) {
    setSaving(true)
    setError('')
    try {
      const r = await portalFetch(`${API_BASE}/api/portal/invoices/${invoice.id}/stripe-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: payMethod }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed')
      window.location.href = data.url
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return }
    setSaving(true)
    setError('')
    try {
      const r = await portalFetch(`${API_BASE}/api/portal/invoices/${invoice.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, method, reference, note }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed')
      onPaid()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <div className="px-5 py-4 border-b" style={{ borderColor: '#f0ece8' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold" style={{ color: '#1a1a1a' }}>
              Pay {invoice.invoice_number}
            </h2>
            <button onClick={onClose} className="text-gray-400">×</button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Balance due: <strong style={{ color: ORANGE }}>{fmt(balance)}</strong>
          </p>
        </div>
        {stripeOn && (
          <div className="p-5 space-y-2 border-b" style={{ borderColor: '#f0ece8' }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Pay Online — Instant
            </p>
            <button onClick={() => startStripe('ach')} disabled={saving}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2"
              style={{ backgroundColor: '#16a34a' }}>
              🏦 Pay by Bank (ACH) · {fmt(balance)}
              <span className="text-xs font-normal opacity-75">· Save ~2%</span>
            </button>
            <button onClick={() => startStripe('card')} disabled={saving}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: '#2563eb' }}>
              💳 Pay by Credit Card · {fmt(balance)}
            </button>
            <p className="text-xs text-gray-500 text-center">
              Secure payment by Stripe
            </p>
          </div>
        )}

        <form onSubmit={submit} className="p-5 space-y-3">
          {stripeOn && (
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 -mb-1">
              Or Record a Check/Zelle/Other
            </p>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}>
              <option>ACH / Bank Transfer</option>
              <option>Check</option>
              <option>Zelle</option>
              <option>Credit Card</option>
              <option>Cash</option>
              <option>Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
            <input type="number" step="0.01" min="0.01" value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Reference (Check # / Confirmation #)
            </label>
            <input value={reference} onChange={e => setReference(e.target.value)}
              placeholder="Optional"
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Note</label>
            <input value={note} onChange={e => setNote(e.target.value)}
              placeholder="Optional"
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          {method === 'Credit Card' && (
            <div className="rounded-lg p-3" style={{ backgroundColor: '#fff7f5', border: `1px solid #fcd5c5` }}>
              <p className="text-xs" style={{ color: ORANGE }}>
                💡 Online card payments are being set up. For now, please select another method
                and contact us for card processing.
              </p>
            </div>
          )}
          {error && <p className="text-sm" style={{ color: '#dc2626' }}>{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: '#e5e7eb' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: ORANGE, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Recording…' : `Record ${fmt(Number(amount) || 0)} Payment`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function MyJobsList({ jobs }) {
  if (jobs.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-5xl mb-2">🚗</p>
        <p className="text-gray-400 text-sm">No job requests yet. Click "Request Job" to submit one.</p>
      </div>
    )
  }
  const statusMap = {
    needs_dispatch: { bg: '#fef3c7', color: '#b45309', label: 'Pending Dispatch' },
    dispatched: { bg: '#dbeafe', color: '#1d4ed8', label: 'Dispatched' },
    in_progress: { bg: '#e0f2fe', color: '#0369a1', label: 'In Progress' },
    on_hold: { bg: '#f5f3f0', color: '#6b7280', label: 'On Hold' },
    complete: { bg: '#dcfce7', color: '#15803d', label: 'Complete ✓' },
    cancelled: { bg: '#fee2e2', color: '#b91c1c', label: 'Cancelled' },
  }
  return (
    <div className="space-y-2">
      {jobs.map(j => {
        const st = statusMap[j.status] || statusMap.needs_dispatch
        return (
          <div key={j.id} className="rounded-xl bg-white border shadow-sm p-4"
            style={{ borderColor: '#f0ece8' }}>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold" style={{ color: ORANGE }}>
                  {j.ro_number ? `RO# ${j.ro_number}` : j.id.slice(-8)}
                </span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: st.bg, color: st.color }}>
                  {st.label}
                </span>
                {j.submitted_via_portal && (
                  <span className="text-xs text-gray-400">📱 self-submitted</span>
                )}
              </div>
              <span className="text-xs text-gray-400">
                {new Date(j.created_at).toLocaleDateString()}
              </span>
            </div>
            <p className="text-sm text-gray-700">
              {[j.vehicle?.year, j.vehicle?.make, j.vehicle?.model].filter(Boolean).join(' ') || '—'}
            </p>
            {Array.isArray(j.calibrations) && j.calibrations.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {j.calibrations.map(c => typeof c === 'string' ? c : c.name).join(', ')}
              </p>
            )}
            {j.technician && (
              <p className="text-xs text-gray-500 mt-1">Tech: {j.technician}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SubmitJobModal({ shop, onClose, onSubmitted }) {
  const [form, setForm] = useState({
    year: '', make: '', model: '', vin: '',
    ro_number: '', insurer: '',
    calibrations: '',
    damage_points: '',
    requested_date: '',
    requested_by_name: '',
    requested_by_phone: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!form.year && !form.make && !form.model && !form.vin) {
      setError('Please enter at least vehicle info or VIN')
      return
    }
    setSaving(true)
    setError('')
    try {
      const r = await portalFetch(`${API_BASE}/api/portal/submit-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          calibrations: form.calibrations.split(',').map(s => s.trim()).filter(Boolean),
          damage_points: form.damage_points.split(',').map(s => s.trim()).filter(Boolean),
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed')
      onSubmitted()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b sticky top-0 bg-white flex justify-between items-center"
          style={{ borderColor: '#f0ece8' }}>
          <div>
            <h2 className="text-lg font-bold">Request a Calibration</h2>
            <p className="text-xs text-gray-500">From: {shop.shop_name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400">×</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Vehicle</label>
            <div className="grid grid-cols-3 gap-2">
              <input placeholder="Year" value={form.year}
                onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              <input placeholder="Make" value={form.make}
                onChange={e => setForm(f => ({ ...f, make: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              <input placeholder="Model" value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">VIN</label>
            <input value={form.vin} onChange={e => setForm(f => ({ ...f, vin: e.target.value.toUpperCase() }))}
              placeholder="17-character VIN" maxLength="17"
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">RO # (your job number)</label>
              <input value={form.ro_number}
                onChange={e => setForm(f => ({ ...f, ro_number: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Insurance Carrier</label>
              <input value={form.insurer} placeholder="e.g. State Farm"
                onChange={e => setForm(f => ({ ...f, insurer: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Calibrations needed <span className="text-gray-400">(comma-separated, or leave blank)</span>
            </label>
            <input value={form.calibrations}
              onChange={e => setForm(f => ({ ...f, calibrations: e.target.value }))}
              placeholder="e.g. Front Camera, Blind Spot, Lane Keep"
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Damage points <span className="text-gray-400">(comma-separated)</span>
            </label>
            <input value={form.damage_points}
              onChange={e => setForm(f => ({ ...f, damage_points: e.target.value }))}
              placeholder="e.g. front bumper, windshield"
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Preferred date</label>
            <input type="date" value={form.requested_date}
              onChange={e => setForm(f => ({ ...f, requested_date: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Your Name</label>
              <input value={form.requested_by_name}
                onChange={e => setForm(f => ({ ...f, requested_by_name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Your Phone</label>
              <input value={form.requested_by_phone}
                onChange={e => setForm(f => ({ ...f, requested_by_phone: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea value={form.notes} rows="2"
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Anything we should know (special instructions, access, etc.)"
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: '#e5e7eb' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: '#16a34a', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
