import { useState } from 'react'
import { API_BASE, setToken } from '../utils/api.js'

const ORANGE = '#CD4419'

export default function DemoLandingScreen({ onLogin }) {
  const [loading, setLoading] = useState(null) // 'calibration' | 'bodyshop' | null

  async function handleEnterDemo(type) {
    setLoading(type)
    try {
      const r = await fetch(`${API_BASE}/auth/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Demo login failed')
      if (data.token) setToken(data.token)
      onLogin(data.user)
    } catch (e) {
      alert('Demo login failed: ' + e.message)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f5f3f0' }}>

      {/* Header */}
      <header style={{ backgroundColor: 'white', borderBottom: '1px solid #ebebeb' }}>
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
          <img src={import.meta.env.BASE_URL + 'logo.png'} alt="Absolute ADAS" className="w-9 h-9 object-contain" />
          <div>
            <span className="text-lg font-bold tracking-tight" style={{ color: '#1a1a1a' }}>Absolute <span style={{ color: ORANGE }}>ADAS</span></span>
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fff3cd', color: '#92400e' }}>DEMO</span>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="max-w-3xl w-full text-center mb-12">
          <h1 className="text-4xl font-bold mb-4" style={{ color: '#1a1a1a' }}>
            Welcome to Absolute ADAS
          </h1>
          <p className="text-lg text-gray-500 max-w-xl mx-auto">
            The intelligent platform for ADAS calibration management. Choose your demo below to explore the full experience.
          </p>
        </div>

        {/* Two demo cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">

          {/* Calibration Company */}
          <div className="bg-white rounded-2xl p-8 flex flex-col" style={{ border: '1px solid #ebebeb', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ backgroundColor: '#fff3ee' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="text-xl font-bold mb-2" style={{ color: '#1a1a1a' }}>Calibration Company</h2>
            <p className="text-sm text-gray-500 mb-6 flex-1">
              Upload CCC or Kinetic PDF estimates, auto-detect required ADAS calibrations, generate Zoho Books invoices, manage your job board, and build your calibration rules library.
            </p>
            <ul className="space-y-2 mb-8">
              {[
                'PDF upload → auto-detect calibrations',
                'One-click Zoho Books invoice',
                'Job board & status tracking',
                'Repair estimate builder',
                'Calibration rules database',
              ].map(f => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                  <span style={{ color: ORANGE }}>✓</span> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => handleEnterDemo('calibration')}
              disabled={!!loading}
              className="w-full py-3 rounded-xl font-semibold text-white text-sm transition-all"
              style={{ backgroundColor: ORANGE, opacity: loading ? 0.7 : 1 }}
            >
              {loading === 'calibration' ? 'Entering demo…' : 'Enter Calibration Demo →'}
            </button>
          </div>

          {/* Body Shop */}
          <div className="bg-white rounded-2xl p-8 flex flex-col" style={{ border: '1px solid #ebebeb', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ backgroundColor: '#f0f9ff' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M19 17H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2z" stroke="#0369a1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3 7h18M8 17v4m8-4v4M7 21h10" stroke="#0369a1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="text-xl font-bold mb-2" style={{ color: '#1a1a1a' }}>Body Shop</h2>
            <p className="text-sm text-gray-500 mb-6 flex-1">
              Upload your CCC collision estimate and instantly see every ADAS calibration your customer's vehicle needs — before the car leaves your shop.
            </p>
            <ul className="space-y-2 mb-8">
              {[
                'Upload CCC estimate PDF',
                'Instant ADAS calibration report',
                'Vehicle equipment auto-detection',
                'OEM-backed justifications',
                'Request calibration service',
              ].map(f => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                  <span style={{ color: '#0369a1' }}>✓</span> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => handleEnterDemo('bodyshop')}
              disabled={!!loading}
              className="w-full py-3 rounded-xl font-semibold text-sm transition-all"
              style={{ backgroundColor: '#0369a1', color: 'white', opacity: loading ? 0.7 : 1 }}
            >
              {loading === 'bodyshop' ? 'Entering demo…' : 'Enter Body Shop Demo →'}
            </button>
          </div>
        </div>

        {/* Footer note */}
        <p className="text-xs text-gray-400 mt-10 text-center">
          This is a live demo environment. PDF uploads are real — all invoice and job data is sample data only.
          <br />Interested in Absolute ADAS for your business? Contact <a href="mailto:mark@absoluteadas.com" style={{ color: ORANGE }}>mark@absoluteadas.com</a>
        </p>
      </div>
    </div>
  )
}
