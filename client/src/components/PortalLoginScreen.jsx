import { useState } from 'react'
import { API_BASE } from '../utils/portal'
import { BRAND, BrandBar, PublicFooter } from '../lib/brand.jsx'

export default function PortalLoginScreen({ onLoggedIn }) {
  const [mode, setMode] = useState('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [devLink, setDevLink] = useState('')

  async function login(e) {
    e.preventDefault()
    if (!username.trim() || !password) return
    setStatus('sending'); setMessage('')
    try {
      const r = await fetch(`${API_BASE}/api/portal/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      let data = {}
      try { data = await r.json() } catch { throw new Error('Could not reach the portal. Try again.') }
      if (!r.ok) throw new Error(data.error || 'Login failed')
      onLoggedIn(data.token, { ...data.shop, user: data.user })
    } catch (err) {
      setStatus('error')
      setMessage(err.message)
    }
  }

  async function requestLink(e) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('sending'); setMessage(''); setDevLink('')
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
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: BRAND.cream }}>
      <BrandBar />
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="rounded-2xl bg-white p-8" style={{ border: `1px solid ${BRAND.line}` }}>
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: BRAND.ink }}>Shop portal</h1>
              <p className="text-sm text-gray-500 mt-1.5">Your shop’s calibrations, quotes, and invoices</p>
            </div>

            {mode === 'password' ? (
              <form onSubmit={login} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Username</label>
                  <input value={username} onChange={e => setUsername(e.target.value)} autoFocus required
                    autoComplete="username" placeholder="maria.express"
                    className="w-full border rounded-lg px-4 py-3 text-sm" style={{ borderColor: BRAND.line }} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                    autoComplete="current-password"
                    className="w-full border rounded-lg px-4 py-3 text-sm" style={{ borderColor: BRAND.line }} />
                </div>
                {status === 'error' && message && (
                  <p className="text-sm text-center" style={{ color: BRAND.red }}>{message}</p>
                )}
                <button type="submit" disabled={status === 'sending' || !username.trim() || !password}
                  className="w-full py-3 rounded-lg text-sm font-semibold text-white"
                  style={{ backgroundColor: BRAND.orange, opacity: (status === 'sending' || !username.trim() || !password) ? 0.6 : 1 }}>
                  {status === 'sending' ? 'Signing in…' : 'Sign in'}
                </button>
                <button type="button" onClick={() => { setMode('link'); setStatus('idle'); setMessage('') }}
                  className="w-full text-xs font-semibold" style={{ color: '#888' }}>
                  Forgot? Email a one-time link
                </button>
              </form>
            ) : status === 'sent' ? (
              <div className="text-center">
                <p className="text-sm font-semibold mb-2" style={{ color: BRAND.green }}>{message}</p>
                <p className="text-xs text-gray-500 mb-4">The link expires in 15 minutes.</p>
                {devLink && (
                  <div className="rounded-lg p-3 mb-4" style={{ backgroundColor: BRAND.orangeSoft, border: '1px solid #fcd5c5' }}>
                    <a href={devLink} className="text-xs break-all underline" style={{ color: BRAND.orange }}>{devLink}</a>
                  </div>
                )}
                <button onClick={() => { setMode('password'); setStatus('idle') }} className="text-sm font-medium" style={{ color: BRAND.orange }}>Back to sign in</button>
              </div>
            ) : (
              <form onSubmit={requestLink} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email on file</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                    className="w-full border rounded-lg px-4 py-3 text-sm" style={{ borderColor: BRAND.line }} />
                </div>
                {status === 'error' && message && (
                  <p className="text-sm text-center" style={{ color: BRAND.red }}>{message}</p>
                )}
                <button type="submit" disabled={status === 'sending' || !email.trim()}
                  className="w-full py-3 rounded-lg text-sm font-semibold text-white"
                  style={{ backgroundColor: BRAND.orange, opacity: (status === 'sending' || !email.trim()) ? 0.6 : 1 }}>
                  {status === 'sending' ? 'Sending…' : 'Send login link'}
                </button>
                <button type="button" onClick={() => { setMode('password'); setStatus('idle'); setMessage('') }}
                  className="w-full text-xs font-semibold" style={{ color: '#888' }}>Back to username and password</button>
              </form>
            )}
          </div>
          <p className="text-center text-xs text-gray-400 mt-6">
            Absolute ADAS staff?{' '}
            <a href="/app/" className="font-medium" style={{ color: BRAND.orange }}>Staff login</a>
          </p>
        </div>
      </div>
      <PublicFooter />
    </div>
  )
}
