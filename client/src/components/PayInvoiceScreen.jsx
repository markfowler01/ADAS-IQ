import { useState, useEffect } from 'react'
import { API_BASE } from '../utils/portal'
// eslint-disable-next-line no-unused-vars

const ORANGE = '#CD4419'

function fmt(n) { return `$${Number(n || 0).toFixed(2)}` }

export default function PayInvoiceScreen() {
  const [invoice, setInvoice] = useState(null)
  const [status, setStatus] = useState('loading')  // loading, ready, paying, paid, error
  const [error, setError] = useState('')

  // Read invoice id + token from URL: ?i=inv_xxx&t=tokenValue
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const invoiceId = params?.get('i') || ''
  const token = params?.get('t') || ''

  useEffect(() => {
    if (!invoiceId || !token) {
      setStatus('error')
      setError('Missing invoice reference or token.')
      return
    }
    fetch(`${API_BASE}/api/portal/pay/${encodeURIComponent(invoiceId)}/info?t=${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.error))))
      .then(inv => {
        setInvoice(inv)
        if (inv.status === 'paid') setStatus('paid')
        else setStatus('ready')
      })
      .catch(e => { setError(e.message || 'Failed to load invoice'); setStatus('error') })
  }, [invoiceId, token])

  if (status === 'loading') {
    return <Center>Loading invoice…</Center>
  }
  if (status === 'error') {
    return (
      <Center>
        <div className="text-center">
          <p className="text-5xl mb-3">⚠️</p>
          <p className="text-lg font-semibold mb-2">{error}</p>
          <p className="text-sm text-gray-500">
            Please contact Absolute ADAS if you need a new payment link.
          </p>
        </div>
      </Center>
    )
  }
  if (status === 'paid' || invoice?.status === 'paid') {
    return (
      <Center>
        <div className="text-center max-w-sm">
          <p className="text-6xl mb-3">✅</p>
          <p className="text-2xl font-bold mb-2" style={{ color: '#16a34a' }}>
            Invoice Already Paid
          </p>
          <p className="text-sm text-gray-500 mb-4">
            Invoice {invoice.invoice_number} was paid in full.
          </p>
          <p className="text-xs text-gray-400">Thank you for your business!</p>
        </div>
      </Center>
    )
  }

  return <PayForm invoice={invoice} token={token} onPaid={setStatus} setInvoice={setInvoice} />
}

function PayForm({ invoice, token, onPaid, setInvoice }) {
  const balance = Number(invoice.balance_due ?? invoice.total) || 0
  const [amount, setAmount] = useState(String(balance))
  const [method, setMethod] = useState('ACH / Bank Transfer')
  const [reference, setReference] = useState('')
  const [payerName, setPayerName] = useState('')
  const [payerEmail, setPayerEmail] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)
  const [stripeOn, setStripeOn] = useState(false)
  const [mode, setMode] = useState('choose')  // choose, stripe_loading, manual

  // Check Stripe availability + handle return from Stripe
  useEffect(() => {
    fetch(`${API_BASE}/api/portal/stripe/status`)
      .then(r => r.json())
      .then(d => setStripeOn(!!d.configured))
      .catch(() => {})

    // Handle return-from-Stripe query params
    const params = new URLSearchParams(window.location.search)
    const stripeStatus = params.get('stripe_status')
    if (stripeStatus === 'success') {
      setSuccess({
        invoice_number: invoice.invoice_number,
        paid_amount: balance,
        new_balance: 0,
        via_stripe: true,
      })
    } else if (stripeStatus === 'cancelled') {
      setError('Payment was cancelled. No charge was made.')
    }
  }, [])

  async function startStripe(payMethod) {
    setSaving(true)
    setError('')
    setMode('stripe_loading')
    try {
      const r = await fetch(`${API_BASE}/api/portal/pay/${encodeURIComponent(invoice.id)}/stripe-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, method: payMethod, payer_email: payerEmail }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed to start checkout')
      window.location.href = data.url
    } catch (err) {
      setError(err.message)
      setMode('choose')
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
      const r = await fetch(`${API_BASE}/api/portal/pay/${encodeURIComponent(invoice.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token, amount: amt, method, reference, note,
          payer_name: payerName, payer_email: payerEmail,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed')
      setSuccess(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (success) {
    return (
      <Center>
        <div className="text-center max-w-sm">
          <p className="text-6xl mb-3">🎉</p>
          <p className="text-2xl font-bold mb-2" style={{ color: '#16a34a' }}>
            {success.via_stripe ? 'Payment Processing' : 'Payment Received!'}
          </p>
          <p className="text-sm text-gray-500 mb-4">
            {fmt(success.paid_amount)} {success.via_stripe ? 'submitted for' : 'recorded for'} invoice {success.invoice_number}.
          </p>
          {success.via_stripe && (
            <p className="text-xs text-gray-500 mb-3">
              Card payments confirm instantly. ACH payments take 1–3 business days to clear.
              You'll receive a receipt from Stripe shortly.
            </p>
          )}
          {success.new_balance > 0 ? (
            <p className="text-sm" style={{ color: ORANGE }}>
              Remaining balance: <strong>{fmt(success.new_balance)}</strong>
            </p>
          ) : (
            <p className="text-sm font-semibold" style={{ color: '#16a34a' }}>
              Invoice is paid in full. Thank you!
            </p>
          )}
          <p className="text-xs text-gray-400 mt-6">
            You can close this window.
          </p>
        </div>
      </Center>
    )
  }

  if (mode === 'stripe_loading') {
    return <Center><p className="text-sm text-gray-500">Redirecting to secure payment…</p></Center>
  }

  return (
    <div className="min-h-screen px-4 py-6" style={{ backgroundColor: '#fafafa' }}>
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-5">
          <div className="inline-block px-4 py-2 rounded-xl mb-3"
            style={{ backgroundColor: ORANGE }}>
            <span className="text-white font-bold text-lg">ABSOLUTE ADAS</span>
          </div>
          <h1 className="text-xl font-bold" style={{ color: '#1a1a1a' }}>Pay Invoice</h1>
        </div>

        {/* Invoice summary */}
        <div className="rounded-xl bg-white p-5 shadow-sm mb-4" style={{ border: '1px solid #f0ece8' }}>
          <div className="flex items-center justify-between mb-3 pb-3 border-b"
            style={{ borderColor: '#f7f4f1' }}>
            <div>
              <p className="text-xs text-gray-500">Invoice</p>
              <p className="text-base font-bold" style={{ color: ORANGE }}>
                {invoice.invoice_number}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Balance Due</p>
              <p className="text-2xl font-bold" style={{ color: ORANGE }}>{fmt(balance)}</p>
            </div>
          </div>
          <div className="text-sm">
            <p className="text-gray-600"><strong>Bill To:</strong> {invoice.customer_name}</p>
            <p className="text-gray-500 text-xs mt-1">
              Date: {invoice.date || '—'}
              {invoice.due_date && ` · Due: ${invoice.due_date}`}
            </p>
          </div>
          {invoice.line_items && invoice.line_items.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs font-semibold cursor-pointer"
                style={{ color: ORANGE }}>
                View line items ({invoice.line_items.length})
              </summary>
              <div className="mt-2 space-y-1 text-xs">
                {invoice.line_items.map((li, i) => (
                  <div key={i} className="flex justify-between text-gray-600">
                    <span className="truncate mr-2">{li.qty}× {li.description}</span>
                    <span>{fmt(li.amount)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Stripe pay buttons */}
        {stripeOn && (
          <div className="rounded-xl bg-white p-5 shadow-sm mb-4 space-y-3"
            style={{ border: '1px solid #f0ece8' }}>
            <h2 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>
              Pay Online — Instant
            </h2>
            <button onClick={() => startStripe('ach')} disabled={saving}
              className="w-full py-3 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2"
              style={{ backgroundColor: '#16a34a' }}>
              🏦 Pay by Bank (ACH) — {fmt(balance)}
              <span className="text-xs font-normal opacity-75">· Save ~2%</span>
            </button>
            <button onClick={() => startStripe('card')} disabled={saving}
              className="w-full py-3 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: '#2563eb' }}>
              💳 Pay by Credit Card — {fmt(balance)}
            </button>
            <p className="text-xs text-gray-500 text-center">
              Secure payment by Stripe · Your payment info never touches our servers
            </p>
          </div>
        )}

        {stripeOn && (
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px" style={{ backgroundColor: '#e5e7eb' }} />
            <span className="text-xs text-gray-400">OR RECORD MANUALLY</span>
            <div className="flex-1 h-px" style={{ backgroundColor: '#e5e7eb' }} />
          </div>
        )}

        {/* Pay form */}
        <form onSubmit={submit} className="rounded-xl bg-white p-5 shadow-sm space-y-3"
          style={{ border: '1px solid #f0ece8' }}>
          <h2 className="text-sm font-semibold mb-2" style={{ color: '#1a1a1a' }}>
            {stripeOn ? 'Record a Check/Zelle/Other Payment' : 'Payment Details'}
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
              <input type="number" step="0.01" min="0.01" value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                style={{ borderColor: '#e5e7eb' }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
              <select value={method} onChange={e => setMethod(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                style={{ borderColor: '#e5e7eb' }}>
                <option>ACH / Bank Transfer</option>
                <option>Check</option>
                <option>Zelle</option>
                <option>Credit Card</option>
                <option>Cash</option>
                <option>Other</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Your Name</label>
            <input value={payerName} onChange={e => setPayerName(e.target.value)}
              placeholder="Name of person paying"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: '#e5e7eb' }} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Email <span className="font-normal text-gray-400">(for receipt)</span>
            </label>
            <input type="email" value={payerEmail} onChange={e => setPayerEmail(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: '#e5e7eb' }} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Reference <span className="font-normal text-gray-400">(Check # / Confirmation #)</span>
            </label>
            <input value={reference} onChange={e => setReference(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: '#e5e7eb' }} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Note</label>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              rows="2" placeholder="Optional"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: '#e5e7eb' }} />
          </div>

          {method === 'Credit Card' && !stripeOn && (
            <div className="rounded-lg p-3" style={{ backgroundColor: '#fff7f5', border: `1px solid #fcd5c5` }}>
              <p className="text-xs" style={{ color: ORANGE }}>
                💡 Online card processing is being set up. Please use ACH, Check, or Zelle for now,
                or contact us for card payment.
              </p>
            </div>
          )}
          {method === 'Credit Card' && stripeOn && (
            <div className="rounded-lg p-3" style={{ backgroundColor: '#eff6ff', border: `1px solid #bfdbfe` }}>
              <p className="text-xs" style={{ color: '#2563eb' }}>
                💡 For instant card payments, use the "Pay by Credit Card" button above. This form
                only records card payments that happened offline (phone, in-person, etc.).
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-center" style={{ color: '#dc2626' }}>{error}</p>
          )}

          <button type="submit" disabled={saving}
            className="w-full py-3 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: ORANGE, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Processing…' : `Record ${fmt(Number(amount) || 0)} Payment`}
          </button>

          <p className="text-xs text-gray-400 text-center">
            Secured by Absolute ADAS · Payment will be recorded in our books immediately
          </p>
        </form>
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
