// Portal-specific auth utilities (separate from main app auth)

export const API_BASE = import.meta.env.VITE_API_BASE || '/server/adasiq-api'

const TOKEN_KEY = 'adasiq_portal_token'
const SHOP_KEY = 'adasiq_portal_shop'

export function getPortalToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function setPortalSession(token, shop) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token)
    sessionStorage.setItem(SHOP_KEY, JSON.stringify(shop))
  } catch {}
}

export function getPortalShop() {
  try {
    const raw = sessionStorage.getItem(SHOP_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function clearPortalSession() {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(SHOP_KEY)
  } catch {}
}

export function portalFetch(url, options = {}) {
  const token = getPortalToken()
  const headers = { ...(options.headers || {}) }
  if (token) headers['X-Portal-Token'] = token
  return fetch(url, { ...options, headers })
}

// Detect whether we're on the portal URL
export function isPortalRoute() {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname || ''
  const search = window.location.search || ''
  return path.includes('/portal') || search.includes('token=') && path.includes('/app/portal')
}

// Parse a magic-link token from the URL (?token=xxx)
export function getMagicTokenFromUrl() {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get('token')
}
