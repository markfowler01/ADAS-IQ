import { useState, useEffect } from 'react'
import LoginScreen from './components/LoginScreen'
import UploadScreen from './components/UploadScreen'
import ToggleBoard from './components/ToggleBoard'
import AuditScreen from './components/AuditScreen'
import ManualQuoteScreen from './components/ManualQuoteScreen'
import HistoryScreen from './components/HistoryScreen'

export default function App() {
  const [user, setUser]   = useState(null)   // null = loading, false = not logged in, object = logged in
  const [loading, setLoading] = useState(true)
  const [screen,  setScreen]  = useState('upload')
  const [jobData, setJobData] = useState(null)
  const [pdfFile, setPdfFile] = useState(null)

  // Check for auth_error in URL (from failed Zoho callback)
  const authError = new URLSearchParams(window.location.search).get('auth_error') === '1'

  // On mount, check if we have a session
  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setUser(data || false)
        setLoading(false)
      })
      .catch(() => {
        setUser(false)
        setLoading(false)
      })
  }, [])

  async function handleLogout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
    setUser(false)
  }

  function handleExtracted(data, file) {
    setJobData(data)
    setPdfFile(file || null)
    setScreen('review')
  }

  function handleReset() {
    setJobData(null)
    setPdfFile(null)
    setScreen('upload')
  }

  // Still checking session
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f5f3f0' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#CD4419' }}>
            <span className="text-white font-bold text-lg" style={{ fontFamily: 'IBM Plex Mono, monospace' }}>IQ</span>
          </div>
          <p className="text-gray-400 text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  // Not logged in
  if (!user) {
    return <LoginScreen authError={authError} />
  }

  // Logged in — show the app
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
      {screen === 'upload' && (
        <UploadScreen
          user={user}
          onExtracted={handleExtracted}
          onAudit={() => setScreen('audit')}
          onManual={() => setScreen('manual')}
          onHistory={() => setScreen('history')}
          onLogout={handleLogout}
        />
      )}
      {screen === 'review' && (
        <ToggleBoard jobData={jobData} pdfFile={pdfFile} onReset={handleReset} />
      )}
      {screen === 'audit' && (
        <AuditScreen onBack={() => setScreen('upload')} />
      )}
      {screen === 'manual' && (
        <ManualQuoteScreen onBack={() => setScreen('upload')} />
      )}
      {screen === 'history' && (
        <HistoryScreen onBack={() => setScreen('upload')} />
      )}
    </div>
  )
}
