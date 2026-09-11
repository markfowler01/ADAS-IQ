import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { API_BASE, getToken } from './utils/api.js'

// After every client deploy the old tab still points at chunk files that no
// longer exist; the next lazy screen (Jobs board, Books…) then fails to load
// and the app goes blank (Mark 2026-09-11: "the current screen changes to
// blank"). Vite fires this event on that failure — reload once, fresh index.
// White-page forensics (Mark 2026-09-11: "it's a blank page that is white"):
// report uncaught errors, unhandled rejections and page unloads (with the
// last thing that was clicked) to /api/client-error so the cause shows up
// in the function log even when React's error boundary never sees it.
let __lastClick = ''
document.addEventListener('click', (e) => {
  const el = e.target?.closest?.('button, a, [role=button]') || e.target
  __lastClick = `${new Date().toISOString().slice(11, 19)} ${el?.tagName || '?'}: ${String(el?.innerText || el?.getAttribute?.('aria-label') || '').trim().slice(0, 60)}`
}, true)
function report(message, extra = {}) {
  try {
    const token = getToken()
    fetch(`${API_BASE}/api/client-error`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Auth-Token': token } : {}) },
      body: JSON.stringify({ screen: 'global', message, url: window.location.href, ua: navigator.userAgent, component: `last click → ${__lastClick}`, ...extra }),
    }).catch(() => {})
  } catch { /* never throw from the reporter */ }
}
window.addEventListener('error', (e) => report(`window.error: ${e.message}`, { stack: String(e.error?.stack || '').slice(0, 1500) }))
window.addEventListener('unhandledrejection', (e) => report(`unhandledrejection: ${String(e.reason?.message || e.reason || '').slice(0, 300)}`, { stack: String(e.reason?.stack || '').slice(0, 1500) }))
window.addEventListener('pagehide', () => report('pagehide (tab navigated, reloaded or closed)'))

window.addEventListener('vite:preloadError', (e) => {
  report(`vite:preloadError: ${String(e.payload?.message || '').slice(0, 300)}`)
  e.preventDefault()
  const key = 'adas_chunk_reload_at'
  const last = Number(sessionStorage.getItem(key) || 0)
  // Cache-busting navigation (a plain reload can hand back the same stale index.html).
  if (Date.now() - last > 15000) { sessionStorage.setItem(key, String(Date.now())); window.location.replace(window.location.pathname + '?v=' + Date.now()) }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
