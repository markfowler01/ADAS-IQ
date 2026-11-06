import { useState, useEffect } from 'react'
import PortalLoginScreen from './PortalLoginScreen'
import PortalScreen from './PortalScreen'
import { BRAND, BrandBar, PublicFooter } from '../lib/brand.jsx'
import {
  API_BASE, portalFetch, getPortalToken, setPortalSession,
  getPortalShop, clearPortalSession, getMagicTokenFromUrl
} from '../utils/portal'

function MustChangePassword({ shop, onDone, onLogout }) {
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')

  async function save(e) {
    e.preventDefault()
    if (next.length < 8) { setMessage('Use at least 8 characters'); return }
    if (next !== again) { setMessage('Those two passwords do not match'); return }
    setStatus('saving'); setMessage('')
    try {
      const r = await portalFetch(`${API_BASE}/api/portal/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Could not change password')
      onDone(data.token, { ...shop, user: data.user })
    } catch (err) {
      setStatus('idle')
      setMessage(err.message)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: BRAND.cream }}>
      <BrandBar />
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-2xl bg-white p-8" style={{ border: `1px solid ${BRAND.line}` }}>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: BRAND.ink }}>Set your password</h1>
          <p className="text-sm text-gray-500 mt-1.5 mb-6">
            First login for {shop?.user?.username || 'this account'}. Pick a password only you know.
          </p>
          <form onSubmit={save} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">New password</label>
              <input type="password" value={next} onChange={e => setNext(e.target.value)} autoFocus required
                autoComplete="new-password" minLength={8}
                className="w-full border rounded-lg px-4 py-3 text-sm" style={{ borderColor: BRAND.line }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Again</label>
              <input type="password" value={again} onChange={e => setAgain(e.target.value)} required
                autoComplete="new-password" minLength={8}
                className="w-full border rounded-lg px-4 py-3 text-sm" style={{ borderColor: BRAND.line }} />
            </div>
            {message && <p className="text-sm" style={{ color: BRAND.red }}>{message}</p>}
            <button type="submit" disabled={status === 'saving' || next.length < 8}
              className="w-full py-3 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: BRAND.orange, opacity: (status === 'saving' || next.length < 8) ? 0.6 : 1 }}>
              {status === 'saving' ? 'Saving…' : 'Save password'}
            </button>
            <button type="button" onClick={onLogout} className="w-full text-xs font-semibold" style={{ color: '#888' }}>
              Log out
            </button>
          </form>
        </div>
      </div>
      <PublicFooter />
    </div>
  )
}

export default function PortalApp() {
  const [shop, setShop] = useState(null)
  const [status, setStatus] = useState('loading')  // loading, login, authed, error

  useEffect(() => {
    const magicToken = getMagicTokenFromUrl()
    if (magicToken) {
      exchangeMagicToken(magicToken)
    } else {
      const existing = getPortalToken()
      const cachedShop = getPortalShop()
      if (existing && cachedShop) {
        portalFetch(`${API_BASE}/api/portal/me`)
          .then(r => r.ok ? r.json() : Promise.reject(new Error('Expired')))
          .then(s => { setShop(s); setStatus('authed') })
          .catch(() => { clearPortalSession(); setStatus('login') })
      } else {
        setStatus('login')
      }
    }
  }, [])

  async function exchangeMagicToken(token) {
    try {
      const r = await fetch(`${API_BASE}/api/portal/verify-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Invalid or expired link')
      setPortalSession(data.token, data.shop)
      setShop(data.shop)
      setStatus('authed')
      const cleanUrl = window.location.pathname
      window.history.replaceState({}, '', cleanUrl)
    } catch (e) {
      setStatus('login')
      alert(e.message)
    }
  }

  function handleLoggedIn(token, shopData) {
    setPortalSession(token, shopData)
    setShop(shopData)
    setStatus('authed')
  }

  function handleLogout() {
    clearPortalSession()
    setShop(null)
    setStatus('login')
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#fafafa' }}>
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  if (status === 'authed' && shop) {
    if (shop.user?.must_change) {
      return <MustChangePassword shop={shop} onDone={handleLoggedIn} onLogout={handleLogout} />
    }
    return <PortalScreen shop={shop} onLogout={handleLogout} />
  }

  return <PortalLoginScreen onLoggedIn={handleLoggedIn} />
}
