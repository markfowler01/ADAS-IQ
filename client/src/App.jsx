import { useState, useEffect, useRef } from 'react'
import { API_BASE, apiFetch, setToken, getToken } from './utils/api.js'

function getTokenExpiry() {
  try {
    const token = getToken()
    if (!token) return null
    const payload = token.slice(0, token.lastIndexOf('.'))
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return data.exp || null
  } catch { return null }
}

// Keep API_BASE export for components that import it directly
export { API_BASE }

import LoginScreen from './components/LoginScreen'
import DemoLandingScreen from './components/DemoLandingScreen'
import BodyShopDemoScreen from './components/BodyShopDemoScreen'
import UploadScreen from './components/UploadScreen'
import ToggleBoard from './components/ToggleBoard'
import AuditScreen from './components/AuditScreen'
import ManualQuoteScreen from './components/ManualQuoteScreen'
import HistoryScreen from './components/HistoryScreen'
import KanbanBoard from './components/KanbanBoard'
import RepairEstimateScreen from './components/RepairEstimateScreen'
import CalibrationRulesScreen from './components/CalibrationRulesScreen'
import CRMScreen from './components/CRMScreen'
import BooksScreen from './components/BooksScreen'
import OpsHub from './components/OpsHub'
import MessageCenter from './components/MessageCenter'
import SettingsScreen from './components/SettingsScreen'
import PTOScreen from './components/PTOScreen'
import TimeClockScreen from './components/TimeClockScreen'
import TechPlannerScreen from './components/TechPlannerScreen'
import MileageScreen from './components/MileageScreen'
import DailyReviewScreen from './components/DailyReviewScreen'
import ProjectsScreen from './components/ProjectsScreen'
import BrandingScreen from './components/BrandingScreen'
import TeamScreen from './components/TeamScreen'
import ZohoImportScreen from './components/ZohoImportScreen'
import PortalApp from './components/PortalApp'
import PayInvoiceScreen from './components/PayInvoiceScreen'
import QuotesScreen from './components/QuotesScreen'
import QuoteApprovalScreen from './components/QuoteApprovalScreen'
import DisputesScreen from './components/DisputesScreen'
import CustomerExperienceScreen from './components/CustomerExperienceScreen'
import NPSScreen from './components/NPSScreen'
import IntelligenceScreen from './components/IntelligenceScreen'
import PayrollScreen from './components/PayrollScreen'
import TechToday from './pages/TechToday'
import DispatchMap from './pages/DispatchMap'
import LiveDay from './pages/LiveDay'

// Top-level route check: public pay page and customer portal bypass the main auth flow.
function getTopLevelRoute() {
  if (typeof window === 'undefined') return 'app'
  const path = window.location.pathname || ''
  if (path.endsWith('/pay') || path.includes('/app/pay')) return 'pay'
  if (path.endsWith('/portal') || path.includes('/app/portal')) return 'portal'
  if (path.endsWith('/quote') || path.includes('/app/quote')) return 'quote'
  if (path.endsWith('/nps') || path.includes('/app/nps')) return 'nps'
  return 'app'
}

export default function App() {
  const topRoute = getTopLevelRoute()
  if (topRoute === 'pay') return <PayInvoiceScreen />
  if (topRoute === 'portal') return <PortalApp />
  if (topRoute === 'quote') return <QuoteApprovalScreen />
  if (topRoute === 'nps') return <NPSScreen />
  return <MainApp />
}

function MainApp() {
  const [user, setUser]   = useState(null)   // null = loading, false = not logged in, object = logged in
  const [loading, setLoading] = useState(true)
  const [authErrMsg, setAuthErrMsg] = useState(null)
  const [screen,  setScreen]  = useState('kanban')
  const [jobData, setJobData] = useState(null)
  const [pdfFile, setPdfFile] = useState(null)

  const [sessionWarning, setSessionWarning] = useState(false) // < 15 min remaining
  const warningTimerRef = useRef(null)

  const authError = new URLSearchParams(window.location.search).get('auth_error') === '1'
  const isDemo = window.location.hostname.includes('demo.adas-iq') ||
                 new URLSearchParams(window.location.search).get('demo') === '1'

  // On mount, check for Zoho OAuth code OR existing session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')

    if (code) {
      window.history.replaceState({}, '', window.location.pathname)
      fetch(`${API_BASE}/auth/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state }),
      })
        .then(async r => {
          const data = await r.json().catch(() => ({}))
          if (r.ok && data.user) {
            if (data.token) setToken(data.token)
            setUser(data.user)
          } else {
            setAuthErrMsg(data?.error || `Auth failed (${r.status})`)
            setUser(false)
          }
          setLoading(false)
        })
        .catch(e => {
          setAuthErrMsg(e.message || 'Network error during login')
          setUser(false)
          setLoading(false)
        })
    } else {
      // Check existing token / session
      apiFetch(`${API_BASE}/auth/me`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          setUser(data || false)
          setLoading(false)
        })
        .catch(() => {
          setUser(false)
          setLoading(false)
        })
    }
  }, [])

  // Session expiry warning — check every minute, warn at < 15 min
  useEffect(() => {
    if (!user) return
    function checkExpiry() {
      const exp = getTokenExpiry()
      if (!exp) return
      const remaining = exp - Date.now()
      if (remaining > 0 && remaining < 15 * 60 * 1000) setSessionWarning(true)
      else if (remaining <= 0) { setToken(null); setUser(false) }
    }
    checkExpiry()
    warningTimerRef.current = setInterval(checkExpiry, 60 * 1000)
    return () => clearInterval(warningTimerRef.current)
  }, [user])

  async function handleLogout() {
    setToken(null)
    await apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' })
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
    setScreen('kanban')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f5f3f0' }}>
        <div className="flex flex-col items-center gap-3">
          <img src={import.meta.env.BASE_URL + 'logo.png'} alt="Absolute ADAS" className="w-14 h-14 object-contain" />
          <p className="text-gray-400 text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  if (!user) {
    if (isDemo) return <DemoLandingScreen onLogin={(u) => { setUser(u); setLoading(false) }} />
    return <LoginScreen authError={authError} authErrMsg={authErrMsg} />
  }

  // Body shop demo — simplified view
  if (user?.demoType === 'bodyshop') {
    return <BodyShopDemoScreen user={user} onLogout={() => { setToken(null); setUser(false) }} />
  }

  const navScreen = screen === 'review' ? 'upload' : screen

  function handleNavigate(id) {
    if (id === 'upload') handleReset()
    else setScreen(id)
  }

  const navProps = {
    user,
    onLogout: handleLogout,
    currentScreen: navScreen,
    onNavigate: handleNavigate,
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
      {/* Session expiry warning banner */}
      {sessionWarning && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 py-3 text-sm font-medium"
          style={{ backgroundColor: '#7a4400', color: 'white' }}>
          <span>⚠️ Your session expires in less than 15 minutes — save your work and sign in again.</span>
          <button
            onClick={handleLogout}
            className="ml-4 px-3 py-1 rounded-lg text-xs font-semibold"
            style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
            Sign in again
          </button>
        </div>
      )}
      {screen === 'upload' && (
        <UploadScreen
          user={user}
          onExtracted={handleExtracted}
          onAudit={() => setScreen('audit')}
          onManual={() => setScreen('manual')}
          onHistory={() => setScreen('history')}
          onJobBoard={() => setScreen('kanban')}
          onLogout={handleLogout}
          {...navProps}
        />
      )}
      {screen === 'review' && (
        <ToggleBoard jobData={jobData} pdfFile={pdfFile} onReset={handleReset} {...navProps} />
      )}
      {screen === 'audit' && (
        <AuditScreen onBack={() => setScreen('upload')} {...navProps} />
      )}
      {screen === 'manual' && (
        <ManualQuoteScreen onBack={() => setScreen('upload')} {...navProps} />
      )}
      {screen === 'history' && (
        <HistoryScreen onBack={() => setScreen('upload')} {...navProps} />
      )}
      {screen === 'kanban' && (
        <KanbanBoard
          user={user}
          onBack={() => setScreen('upload')}
          onLogout={handleLogout}
          onExtracted={handleExtracted}
          {...navProps}
        />
      )}
      {screen === 'today' && (
        <TechToday user={user} onLogout={handleLogout} {...navProps} />
      )}
      {screen === 'dispatch-map' && (
        <DispatchMap user={user} onLogout={handleLogout} {...navProps} />
      )}
      {screen === 'live' && (
        <LiveDay user={user} onLogout={handleLogout} {...navProps} />
      )}
      {screen === 'estimates' && (
        <RepairEstimateScreen onBack={() => setScreen('upload')} {...navProps} />
      )}
      {screen === 'rules' && (
        <CalibrationRulesScreen onBack={() => setScreen('upload')} {...navProps} />
      )}
      {screen === 'crm' && (
        <CRMScreen onBack={() => setScreen('upload')} {...navProps} />
      )}
      {screen === 'books' && (
        <BooksScreen onBack={() => setScreen('upload')} {...navProps} />
      )}
      {screen === 'ops' && (
        <OpsHub {...navProps} />
      )}
      {screen === 'messages' && (
        <MessageCenter {...navProps} />
      )}
      {screen === 'settings' && (
        <SettingsScreen {...navProps} />
      )}
      {screen === 'pto' && (
        <PTOScreen {...navProps} />
      )}
      {screen === 'timeclock' && (
        <TimeClockScreen {...navProps} />
      )}
      {screen === 'planner' && (
        <TechPlannerScreen {...navProps} />
      )}
      {screen === 'mileage' && (
        <MileageScreen {...navProps} />
      )}
      {screen === 'daily-review' && (
        <DailyReviewScreen {...navProps} />
      )}
      {screen === 'projects' && (
        <ProjectsScreen {...navProps} />
      )}
      {screen === 'branding' && (
        <BrandingScreen {...navProps} />
      )}
      {screen === 'team' && (
        <TeamScreen {...navProps} />
      )}
      {screen === 'zoho-import' && (
        <ZohoImportScreen {...navProps} />
      )}
      {screen === 'quotes' && (
        <QuotesScreen {...navProps} />
      )}
      {screen === 'disputes' && (
        <DisputesScreen {...navProps} />
      )}
      {screen === 'cx' && (
        <CustomerExperienceScreen {...navProps} />
      )}
      {screen === 'intel' && (
        <IntelligenceScreen {...navProps} />
      )}
      {screen === 'payroll' && (
        <PayrollScreen {...navProps} />
      )}
    </div>
  )
}
