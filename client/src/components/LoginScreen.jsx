import { API_BASE } from '../App.jsx'

export default function LoginScreen({ authError, authErrMsg }) {
  function handleLogin() {
    window.location.href = `${API_BASE}/auth/zoho`
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4"
         style={{ backgroundColor: '#f5f3f0' }}>

      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center shadow-lg bg-white">
          <img src="/logo.png" alt="Absolute ADAS" className="w-14 h-14 object-contain" />
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-bold" style={{ color: '#1a1a1a', fontFamily: 'IBM Plex Sans, sans-serif' }}>
            Absolute <span style={{ color: '#CD4419' }}>ADAS</span>
          </h1>
          <p className="text-gray-500 text-sm mt-1" style={{ fontFamily: 'IBM Plex Mono, monospace' }}>
            Powered by Claude AI
          </p>
        </div>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-sm flex flex-col items-center gap-6">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-1">Welcome back</h2>
          <p className="text-gray-500 text-sm">Sign in with your Zoho account to continue</p>
        </div>

        {(authError || authErrMsg) && (
          <div className="w-full bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm text-center">
            {authErrMsg || 'Login failed — please try again'}
          </div>
        )}

        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-3 py-3 px-6 rounded-xl font-semibold text-white transition-all hover:opacity-90 active:scale-95 shadow"
          style={{ backgroundColor: '#CD4419', fontFamily: 'IBM Plex Sans, sans-serif' }}
        >
          {/* Zoho-style icon */}
          <svg width="22" height="22" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="40" height="40" rx="8" fill="white" fillOpacity="0.25"/>
            <text x="50%" y="56%" dominantBaseline="middle" textAnchor="middle" fontSize="18" fontWeight="bold" fill="white">Z</text>
          </svg>
          Sign in with Zoho
        </button>

        <p className="text-xs text-gray-400 text-center">
          Only Absolute ADAS team members can access this app
        </p>
      </div>

      <p className="mt-8 text-xs text-gray-400">© {new Date().getFullYear()} Absolute ADAS · adas-iq.com</p>
    </div>
  )
}
