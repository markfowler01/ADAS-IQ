import { useState, useEffect } from 'react'
import PortalLoginScreen from './PortalLoginScreen'
import PortalScreen from './PortalScreen'
import {
  API_BASE, portalFetch, getPortalToken, setPortalSession,
  getPortalShop, clearPortalSession, getMagicTokenFromUrl
} from '../utils/portal'

export default function PortalApp() {
  const [shop, setShop] = useState(null)
  const [status, setStatus] = useState('loading')  // loading, login, authed, error

  // On mount: check URL for magic token, else check sessionStorage
  useEffect(() => {
    const magicToken = getMagicTokenFromUrl()
    if (magicToken) {
      exchangeMagicToken(magicToken)
    } else {
      const existing = getPortalToken()
      const cachedShop = getPortalShop()
      if (existing && cachedShop) {
        // Validate with the server
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
      // Clean the token out of the URL
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
    return <PortalScreen shop={shop} onLogout={handleLogout} />
  }

  return <PortalLoginScreen onLoggedIn={handleLoggedIn} />
}
