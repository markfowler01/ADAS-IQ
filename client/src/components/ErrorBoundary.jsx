// App-wide error boundary (scan report F-01, Mark 2026-09-07: "lets fix
// it"). Before this, ANY component throw blanked the whole PWA — white
// page, no nav, no way back (the Jobs screen did exactly that twice).
// Now a throw shows a recovery card, keeps the app alive, and pings
// Mark's alerts channel with the stack so it gets fixed.
//
// Mounted with key={screen} in App.jsx so navigating to another screen
// remounts the boundary and clears the error automatically.
import { Component } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
    // Best-effort report — never let the reporter itself throw.
    try {
      apiFetch(`${API_BASE}/api/client-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screen: this.props.screen || '',
          message: String(error?.message || error || 'unknown'),
          stack: String(error?.stack || '').slice(0, 1500),
          component: String(info?.componentStack || '').slice(0, 800),
          url: window.location.href,
          ua: navigator.userAgent,
        }),
      }).catch(() => {})
    } catch { /* nothing */ }
  }

  render() {
    if (!this.state.error) return this.props.children
    const msg = String(this.state.error?.message || this.state.error || 'Unknown error')
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: '#f5f3f0' }}>
        <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-6" style={{ border: `2px solid ${ORANGE}` }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: ORANGE, fontFamily: "'IBM Plex Mono', monospace" }}>
            Something broke on this screen
          </p>
          <h1 className="text-lg font-extrabold mb-2" style={{ color: '#1a1a1a' }}>
            The app hit an error, but it's still running.
          </h1>
          <p className="text-sm mb-4" style={{ color: '#666' }}>
            Mark's been pinged with the details automatically. Jump back to Live or reload — nothing you entered elsewhere is lost.
          </p>
          <div className="text-[11px] rounded-lg px-3 py-2 mb-4 font-mono break-words" style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
            {msg}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { this.setState({ error: null }); this.props.onReset && this.props.onReset() }}
              className="flex-1 py-3 rounded-xl font-bold text-white text-sm"
              style={{ backgroundColor: ORANGE }}
            >← Back to Live</button>
            <button
              onClick={() => window.location.reload()}
              className="flex-1 py-3 rounded-xl font-bold text-sm"
              style={{ backgroundColor: '#f5f3f0', color: '#444', border: '1px solid #e0dbd6' }}
            >↻ Reload app</button>
          </div>
        </div>
      </div>
    )
  }
}
