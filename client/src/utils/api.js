// Shared API fetch utility — sends auth token via X-Auth-Token header

export const API_BASE = import.meta.env.VITE_API_BASE || '/server/adasiq-api'

export function getToken() { return sessionStorage.getItem('adasiq_token') || '' }
export function setToken(token) {
  if (token) sessionStorage.setItem('adasiq_token', token)
  else sessionStorage.removeItem('adasiq_token')
}

export function apiFetch(url, options = {}) {
  const token = getToken()
  const headers = { ...(options.headers || {}) }
  if (token) headers['X-Auth-Token'] = token
  const { credentials, ...rest } = options
  return fetch(url, { ...rest, headers })
}
