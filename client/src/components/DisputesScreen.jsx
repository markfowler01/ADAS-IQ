import { useState, useEffect, useCallback } from 'react'
import Navbar from './Navbar'
import { API_BASE, apiFetch, ORANGE, fmt } from './books/shared'

const DENIAL_CODES = [
  { value: 'docs_missing',   label: 'Documentation Missing' },
  { value: 'insurer_denied', label: 'Insurer Denial' },
  { value: 'shop_disputes',  label: 'Shop Disputes Charges' },
  { value: 'auth_issue',     label: 'Authorization Issue' },
  { value: 'other',          label: 'Other' },
]

const STATUS_STYLE = {
  disputed:    { bg: '#fef3c7', color: '#b45309', label: 'Disputed' },
  denied:      { bg: '#fee2e2', color: '#b91c1c', label: 'Denied' },
  sent:        { bg: '#dbeafe', color: '#1d4ed8', label: 'Resubmitted' },
  paid:        { bg: '#dcfce7', color: '#15803d', label: 'Recovered ✓' },
  written_off: { bg: '#f5f3f0', color: '#6b7280', label: 'Written Off' },
}

export default function DisputesScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [invoices, setInvoices] = useState([])
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [invs, rep] = await Promise.all([
        apiFetch(`${API_BASE}/api/disputes/invoices`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/disputes/report`).then(r => r.json()),
      ])
      setInvoices(Array.isArray(invs) ? invs : [])
      setReport(rep)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Disputes & Denials</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track partial denials, dispute them, recover revenue</p>
        </div>

        {/* Summary cards */}
        {report && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Card label="Open" value={report.open_count} color="#b45309" bg="#fef3c7" />
            <Card label="Disputed" value={fmt(report.total_disputed_amount)} color="#b91c1c" bg="#fee2e2" />
            <Card label="Recovered" value={fmt(report.total_recovered)} color="#15803d" bg="#dcfce7" />
            <Card label="Recovery Rate" value={`${report.recovery_rate}%`} color={ORANGE} bg="#fff7f5" />
          </div>
        )}

        {/* Disputes list */}
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : invoices.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-5xl mb-2">🎉</p>
            <p className="text-gray-400 text-sm">No disputes — everything's paid smoothly.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {invoices.map(inv => {
              const st = STATUS_STYLE[inv.status] || STATUS_STYLE.disputed
              return (
                <div key={inv.id}
                  className="rounded-xl border shadow-sm bg-white p-4 cursor-pointer hover:shadow-md transition-shadow"
                  style={{ borderColor: '#f0ece8' }}
                  onClick={() => setSelected(inv)}>
                  <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold" style={{ color: ORANGE }}>
                        {inv.invoice_number}
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: st.bg, color: st.color }}>
                        {st.label}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Denied</p>
                      <p className="text-lg font-bold" style={{ color: '#b91c1c' }}>
                        {fmt(inv.denied_amount || inv.total)}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-700">{inv.customer_name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {inv.denial_reason || '(no reason recorded)'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {(inv.dispute_history || []).length} action{(inv.dispute_history || []).length !== 1 ? 's' : ''}
                    {inv.disputed_at && ` · opened ${new Date(inv.disputed_at).toLocaleDateString()}`}
                  </p>
                </div>
              )
            })}
          </div>
        )}

        {selected && (
          <DisputeModal invoice={selected}
            onClose={() => setSelected(null)}
            onChanged={() => { setSelected(null); load() }} />
        )}
      </div>
    </div>
  )
}

function Card({ label, value, color, bg }) {
  return (
    <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: bg }}>
      <p className="text-xs font-medium" style={{ color }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
    </div>
  )
}

function DisputeModal({ invoice, onClose, onChanged }) {
  const [action, setAction] = useState('note')
  const [note, setNote] = useState('')
  const [recoveredAmount, setRecoveredAmount] = useState('')
  const [writtenOffAmount, setWrittenOffAmount] = useState(String(invoice.balance_due || 0))
  const [saving, setSaving] = useState(false)

  async function submitAction() {
    setSaving(true)
    try {
      const body = { action, note }
      if (action === 'partial_recovery') body.recovered_amount = Number(recoveredAmount) || 0
      if (action === 'written_off') body.written_off_amount = Number(writtenOffAmount) || 0
      const r = await apiFetch(`${API_BASE}/api/disputes/invoices/${invoice.id}/dispute-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      onChanged()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  function downloadLetter() {
    window.open(`${API_BASE}/api/disputes/invoices/${invoice.id}/dispute-letter`)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b sticky top-0 bg-white flex justify-between items-center"
          style={{ borderColor: '#f0ece8' }}>
          <div>
            <h2 className="text-lg font-bold">Dispute: {invoice.invoice_number}</h2>
            <p className="text-xs text-gray-500">{invoice.customer_name} · {fmt(invoice.total)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Current denial */}
          <div className="rounded-lg p-3" style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#b91c1c' }}>
              Denial Reason
            </p>
            <p className="text-sm text-gray-700">{invoice.denial_reason || '—'}</p>
            {invoice.denied_amount > 0 && (
              <p className="text-sm mt-1">Denied amount: <strong>{fmt(invoice.denied_amount)}</strong></p>
            )}
          </div>

          {/* History */}
          {invoice.dispute_history?.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Action History</p>
              <div className="space-y-2">
                {invoice.dispute_history.map(h => (
                  <div key={h.id} className="rounded-lg p-3 border text-sm" style={{ borderColor: '#f0ece8' }}>
                    <div className="flex justify-between mb-1">
                      <strong>{h.action.replace(/_/g, ' ')}</strong>
                      <span className="text-xs text-gray-400">{new Date(h.at).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-gray-500">by {h.by}</p>
                    {h.note && <p className="text-sm text-gray-700 mt-1">{h.note}</p>}
                    {h.recovered_amount && (
                      <p className="text-xs mt-1" style={{ color: '#15803d' }}>
                        Recovered: {fmt(h.recovered_amount)}
                      </p>
                    )}
                    {h.written_off_amount && (
                      <p className="text-xs mt-1 text-gray-500">
                        Written off: {fmt(h.written_off_amount)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="rounded-lg p-4" style={{ backgroundColor: '#fafafa' }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Take Action</p>

            <label className="block text-xs font-medium text-gray-600 mb-1">Action Type</label>
            <select value={action} onChange={e => setAction(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3" style={{ borderColor: '#e5e7eb' }}>
              <option value="note">Add Note</option>
              <option value="resubmitted">Mark Resubmitted</option>
              <option value="partial_recovery">Record Recovery (partial payment)</option>
              <option value="written_off">Write Off</option>
            </select>

            {action === 'partial_recovery' && (
              <>
                <label className="block text-xs font-medium text-gray-600 mb-1">Recovered Amount</label>
                <input type="number" step="0.01" value={recoveredAmount}
                  onChange={e => setRecoveredAmount(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-3" style={{ borderColor: '#e5e7eb' }} />
              </>
            )}

            {action === 'written_off' && (
              <>
                <label className="block text-xs font-medium text-gray-600 mb-1">Write-Off Amount</label>
                <input type="number" step="0.01" value={writtenOffAmount}
                  onChange={e => setWrittenOffAmount(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-3" style={{ borderColor: '#e5e7eb' }} />
              </>
            )}

            <label className="block text-xs font-medium text-gray-600 mb-1">Note</label>
            <textarea value={note} rows="2"
              onChange={e => setNote(e.target.value)}
              placeholder="What happened, who you spoke with, what's next…"
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />

            <div className="flex gap-2 mt-3">
              <button onClick={downloadLetter}
                className="flex-1 py-2 rounded-lg text-sm font-semibold"
                style={{ backgroundColor: '#eff6ff', color: '#2563eb' }}>
                📄 Download Dispute Letter
              </button>
              <button onClick={submitAction} disabled={saving}
                className="flex-1 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ backgroundColor: ORANGE, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Log Action'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
