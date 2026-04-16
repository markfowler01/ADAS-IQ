import { useState } from 'react'
import { API_BASE } from '../utils/portal'

const ORANGE = '#CD4419'

export default function PortalLoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle')  // idle, sending, sent, error
  const [message, setMessage] = useState('')
  const [devLink, setDevLink] = useState('')

  async function requestLink(e) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('sending')
    setMessage('')
    setDevLink('')
    try {
      const r = await fetch(`${API_BASE}/api/portal/request-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed')
      setStatus('sent')
      setMessage(data.message || 'Check your email for a login link.')
      if (data.dev_link) setDevLink(data.dev_link)
    } catch (err) {
      setStatus('error')
      setMessage(err.message)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{
        background: `linear-gradient(135deg, #fff7f5 0%, #fafafa 50%, #ffffff 100%)`,
      }}>
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-white p-8"
          style={{
            border: '1px solid #f0ece8',
            boxShadow: '0 10px 40px -10px rgba(205, 68, 25, 0.15), 0 4px 20px -8px rgba(0,0,0,0.1)',
          }}>
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl mb-4"
              style={{ backgroundColor: ORANGE }}>
              <span className="w-5 h-5 rounded flex items-center justify-center text-white text-[10px] font-bold"
                style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>IQ</span>
              <span className="text-white font-bold text-sm tracking-wide">ABSOLUTE ADAS</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#1a1a1a' }}>Customer Portal</h1>
            <p className="text-sm text-gray-500 mt-1.5">View invoices, make payments, download PDFs</p>
          </div>

          {status === 'sent' ? (
            <div className="text-center">
              <div className="text-5xl mb-3">📧</div>
              <p className="text-sm font-semibold mb-2" style={{ color: '#16a34a' }}>
                {message}
              </p>
              <p className="text-xs text-gray-500 mb-4">
                The link expires in 15 minutes. Check your spam folder if you don't see it.
              </p>
              {devLink && (
                <div className="rounded-lg p-3 mb-4" style={{ backgroundColor: '#fff7f5', border: `1px solid #fcd5c5` }}>
                  <p className="text-xs font-semibold mb-1" style={{ color: ORANGE }}>
                    Dev mode — click to log in:
                  </p>
                  <a href={devLink}
                    className="text-xs break-all underline" style={{ color: ORANGE }}>
                    {devLink}
                  </a>
                </div>
              )}
              <button onClick={() => { setStatus('idle'); setEmail('') }}
                className="text-sm font-medium" style={{ color: ORANGE }}>
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={requestLink} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Your Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  autoFocus required placeholder="you@yourshop.com"
                  className="w-full border rounded-lg px-4 py-3 text-sm"
                  style={{ borderColor: '#e5e7eb' }} />
              </div>
              {status === 'error' && message && (
                <p className="text-sm text-center" style={{ color: '#dc2626' }}>{message}</p>
              )}
              <button type="submit" disabled={status === 'sending' || !email.trim()}
                className="w-full py-3 rounded-lg text-sm font-semibold text-white"
                style={{ backgroundColor: ORANGE, opacity: (status === 'sending' || !email.trim()) ? 0.6 : 1 }}>
                {status === 'sending' ? 'Sending…' : 'Send Login Link'}
              </button>
              <p className="text-xs text-gray-400 text-center">
                We'll email you a secure login link. No password required.
              </p>
            </form>
          )}
        </div>
        <p className="text-center text-xs text-gray-400 mt-6">
          Are you a team member?{' '}
          <a href="/app/" className="font-medium" style={{ color: ORANGE }}>Staff login →</a>
        </p>
      </div>
    </div>
  )
}
