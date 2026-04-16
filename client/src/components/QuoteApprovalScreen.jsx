import { useState, useEffect } from 'react'
import { API_BASE } from '../utils/portal'

const ORANGE = '#CD4419'
function fmt(n) { return `$${Number(n || 0).toFixed(2)}` }

export default function QuoteApprovalScreen() {
  const [quote, setQuote] = useState(null)
  const [status, setStatus] = useState('loading')  // loading, ready, processing, decided, error
  const [error, setError] = useState('')
  const [approverName, setApproverName] = useState('')
  const [approverEmail, setApproverEmail] = useState('')
  const [declineReason, setDeclineReason] = useState('')
  const [mode, setMode] = useState('view')  // view, approving, declining

  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const quoteId = params?.get('q') || ''
  const token = params?.get('t') || ''

  useEffect(() => {
    if (!quoteId || !token) {
      setStatus('error')
      setError('Missing quote reference or token.')
      return
    }
    fetch(`${API_BASE}/api/quotes/public/${encodeURIComponent(quoteId)}?t=${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.error))))
      .then(q => {
        setQuote(q)
        setStatus(['approved', 'declined', 'converted', 'expired'].includes(q.status) ? 'decided' : 'ready')
      })
      .catch(e => { setError(e.message); setStatus('error') })
  }, [quoteId, token])

  async function approve() {
    if (!approverName.trim()) { setError('Please enter your name'); return }
    setStatus('processing')
    try {
      const r = await fetch(`${API_BASE}/api/quotes/public/${encodeURIComponent(quoteId)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: approverName, email: approverEmail }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      setQuote(q => ({ ...q, status: 'approved', approved_at: new Date().toISOString() }))
      setStatus('decided')
    } catch (e) {
      setError(e.message)
      setStatus('ready')
    }
  }

  async function decline() {
    setStatus('processing')
    try {
      const r = await fetch(`${API_BASE}/api/quotes/public/${encodeURIComponent(quoteId)}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, reason: declineReason }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      setQuote(q => ({ ...q, status: 'declined', declined_at: new Date().toISOString() }))
      setStatus('decided')
    } catch (e) {
      setError(e.message)
      setStatus('ready')
    }
  }

  if (status === 'loading') {
    return <Center>Loading quote…</Center>
  }

  if (status === 'error') {
    return (
      <Center>
        <p className="text-5xl mb-3">⚠️</p>
        <p className="text-lg font-semibold mb-2">{error}</p>
        <p className="text-sm text-gray-500">Please contact us if you need a new link.</p>
      </Center>
    )
  }

  if (status === 'decided' || quote?.status === 'approved' || quote?.status === 'declined') {
    const st = quote.status
    return (
      <Center>
        <div className="text-center max-w-sm">
          <p className="text-6xl mb-3">{st === 'approved' ? '✅' : st === 'declined' ? '❌' : '✓'}</p>
          <p className="text-2xl font-bold mb-2" style={{ color: st === 'approved' ? '#16a34a' : st === 'declined' ? '#dc2626' : '#555' }}>
            {st === 'approved' ? 'Quote Approved' : st === 'declined' ? 'Quote Declined' : 'Quote Status: ' + st}
          </p>
          <p className="text-sm text-gray-500 mb-4">
            Quote {quote.quote_number} · {fmt(quote.total)}
          </p>
          {st === 'approved' && (
            <p className="text-xs text-gray-500">
              Thanks! We'll schedule this work and invoice you upon completion.
              You'll receive a separate invoice email when the job is complete.
            </p>
          )}
        </div>
      </Center>
    )
  }

  return (
    <div className="min-h-screen px-4 py-6" style={{ backgroundColor: '#fafafa' }}>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-5">
          <div className="inline-block px-4 py-2 rounded-xl mb-3" style={{ backgroundColor: ORANGE }}>
            <span className="text-white font-bold text-lg">ABSOLUTE ADAS</span>
          </div>
          <h1 className="text-xl font-bold" style={{ color: '#1a1a1a' }}>Quote for Your Review</h1>
        </div>

        {/* Quote summary */}
        <div className="rounded-xl bg-white p-5 shadow-sm mb-4" style={{ border: '1px solid #f0ece8' }}>
          <div className="flex items-center justify-between mb-3 pb-3 border-b" style={{ borderColor: '#f7f4f1' }}>
            <div>
              <p className="text-xs text-gray-500">Quote</p>
              <p className="text-lg font-bold" style={{ color: ORANGE }}>{quote.quote_number}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Total</p>
              <p className="text-2xl font-bold" style={{ color: ORANGE }}>{fmt(quote.total)}</p>
            </div>
          </div>
          <div className="text-sm text-gray-600 space-y-0.5">
            <p><strong>For:</strong> {quote.customer_name}</p>
            {quote.vehicle?.year && (
              <p><strong>Vehicle:</strong> {[quote.vehicle.year, quote.vehicle.make, quote.vehicle.model].filter(Boolean).join(' ')}</p>
            )}
            {quote.vehicle?.vin && <p className="text-xs text-gray-400">VIN: {quote.vehicle.vin}</p>}
            {quote.ro_number && <p className="text-xs"><strong>RO#:</strong> {quote.ro_number}</p>}
            <p className="text-xs text-gray-400">Valid until {quote.valid_until}</p>
          </div>
        </div>

        {/* Line items */}
        <div className="rounded-xl bg-white p-5 shadow-sm mb-4" style={{ border: '1px solid #f0ece8' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Scope of Work</h2>
          <div className="space-y-2">
            {(quote.line_items || []).map((li, i) => {
              const amt = (Number(li.qty) || 0) * (Number(li.rate) || 0)
              return (
                <div key={i} className="flex justify-between text-sm py-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-800">{li.description}</p>
                    <p className="text-xs text-gray-400">{li.qty} × {fmt(li.rate)}</p>
                  </div>
                  <p className="font-medium flex-shrink-0 ml-2">{fmt(amt)}</p>
                </div>
              )
            })}
          </div>
          <div className="border-t mt-3 pt-3 space-y-1 text-sm" style={{ borderColor: '#f7f4f1' }}>
            <div className="flex justify-between text-gray-500">
              <span>Subtotal</span><span>{fmt(quote.subtotal)}</span>
            </div>
            {Number(quote.discount) > 0 && (
              <div className="flex justify-between text-gray-500">
                <span>Discount</span><span>-{fmt(quote.discount)}</span>
              </div>
            )}
            {Number(quote.tax_amount) > 0 && (
              <div className="flex justify-between text-gray-500">
                <span>Tax</span><span>{fmt(quote.tax_amount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg pt-2 border-t" style={{ borderColor: '#f7f4f1', color: ORANGE }}>
              <span>Total</span><span>{fmt(quote.total)}</span>
            </div>
          </div>
        </div>

        {quote.notes && (
          <div className="rounded-xl bg-white p-5 shadow-sm mb-4" style={{ border: '1px solid #f0ece8' }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Notes</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{quote.notes}</p>
          </div>
        )}

        {/* Action buttons */}
        {mode === 'view' && (
          <div className="rounded-xl bg-white p-5 shadow-sm" style={{ border: '1px solid #f0ece8' }}>
            <p className="text-sm text-center text-gray-500 mb-4">
              Please review the scope and pricing, then approve or decline.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMode('declining')} disabled={status === 'processing'}
                className="py-3 rounded-lg text-sm font-semibold"
                style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>
                Decline
              </button>
              <button onClick={() => setMode('approving')} disabled={status === 'processing'}
                className="py-3 rounded-lg text-sm font-semibold text-white"
                style={{ backgroundColor: '#16a34a' }}>
                ✓ Approve Quote
              </button>
            </div>
          </div>
        )}

        {mode === 'approving' && (
          <div className="rounded-xl bg-white p-5 shadow-sm" style={{ border: '1px solid #f0ece8' }}>
            <h2 className="text-sm font-semibold mb-3">Approve Quote</h2>
            <p className="text-xs text-gray-500 mb-3">
              Enter your name to confirm approval of this {fmt(quote.total)} quote.
            </p>
            <input value={approverName} onChange={e => setApproverName(e.target.value)}
              placeholder="Your full name"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-2" style={{ borderColor: '#e5e7eb' }} />
            <input value={approverEmail} onChange={e => setApproverEmail(e.target.value)}
              placeholder="Email (optional, for receipt)" type="email"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3" style={{ borderColor: '#e5e7eb' }} />
            {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setMode('view'); setError('') }}
                className="flex-1 py-2 rounded-lg text-sm border" style={{ borderColor: '#e5e7eb' }}>
                Back
              </button>
              <button onClick={approve} disabled={status === 'processing'}
                className="flex-1 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ backgroundColor: '#16a34a', opacity: status === 'processing' ? 0.6 : 1 }}>
                {status === 'processing' ? 'Approving…' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        )}

        {mode === 'declining' && (
          <div className="rounded-xl bg-white p-5 shadow-sm" style={{ border: '1px solid #f0ece8' }}>
            <h2 className="text-sm font-semibold mb-3">Decline Quote</h2>
            <p className="text-xs text-gray-500 mb-3">Let us know why so we can revise:</p>
            <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)}
              rows="3" placeholder="Price too high, scope needs adjusting, etc."
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3" style={{ borderColor: '#e5e7eb' }} />
            {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setMode('view'); setError('') }}
                className="flex-1 py-2 rounded-lg text-sm border" style={{ borderColor: '#e5e7eb' }}>
                Back
              </button>
              <button onClick={decline} disabled={status === 'processing'}
                className="flex-1 py-2 rounded-lg text-sm font-semibold"
                style={{ backgroundColor: '#fef2f2', color: '#b91c1c', opacity: status === 'processing' ? 0.6 : 1 }}>
                {status === 'processing' ? 'Declining…' : 'Submit Decline'}
              </button>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          Absolute ADAS · Questions? Contact us
        </p>
      </div>
    </div>
  )
}

function Center({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#fafafa' }}>
      <div className="max-w-md w-full text-center p-8 rounded-xl bg-white shadow-sm"
        style={{ border: '1px solid #f0ece8' }}>
        {children}
      </div>
    </div>
  )
}
