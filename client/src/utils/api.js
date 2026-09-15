// Shared API fetch utility — sends auth token via X-Auth-Token header

export const API_BASE = import.meta.env.VITE_API_BASE || '/server/adasiq-api'

export function getToken() { return sessionStorage.getItem('adasiq_token') || '' }
export function setToken(token) {
  if (token) sessionStorage.setItem('adasiq_token', token)
  else sessionStorage.removeItem('adasiq_token')
}

export async function apiFetch(url, options = {}) {
  const token = getToken()
  const headers = { ...(options.headers || {}) }
  if (token) headers['X-Auth-Token'] = token
  const { credentials, ...rest } = options
  const res = await fetch(url, { ...rest, headers })
  // Expired / rejected sign-in (2026-09-15: Kat's 8h token ran out mid-day
  // and every save quietly failed while the page looked fine). Drop the
  // token and go back to the login screen with a note, instead of letting
  // the app limp along on stale state.
  if (res.status === 401 && token && !/\/auth\//.test(url)) {
    try { sessionStorage.setItem('adasiq_signin_note', 'Your sign-in expired — please sign in again.') } catch {}
    setToken(null)
    setTimeout(() => window.location.reload(), 50)
  }
  return res
}
