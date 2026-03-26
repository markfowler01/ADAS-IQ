import { useState } from 'react'
import FeedbackModal from './FeedbackModal'

const ORANGE = '#CD4419'

const NAV_LINKS = [
  { id: 'upload',  label: 'Upload' },
  { id: 'kanban',  label: 'Job Board' },
  { id: 'manual',  label: 'Manual Invoice' },
  { id: 'history', label: 'History' },
]

export default function Navbar({ user, onLogout, currentScreen, onNavigate }) {
  const [showFeedback, setShowFeedback] = useState(false)

  return (
    <>
    <header style={{ backgroundColor: 'white', borderBottom: '1px solid #ebebeb' }}>
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">

        {/* Left: Logo */}
        <div
          className="flex items-center gap-2.5 cursor-pointer flex-shrink-0"
          onClick={() => onNavigate && onNavigate('upload')}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: ORANGE }}
          >
            <span
              className="text-white text-xs font-bold"
              style={{ fontFamily: "'IBM Plex Mono', monospace" }}
            >
              IQ
            </span>
          </div>
          <span className="text-base font-bold tracking-tight" style={{ color: '#1a1a1a' }}>
            ADAS IQ
          </span>
        </div>

        {/* Center: Nav links */}
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const isActive = currentScreen === link.id
            return (
              <button
                key={link.id}
                onClick={() => onNavigate && onNavigate(link.id)}
                className="text-sm px-3 py-2 font-medium transition-colors relative"
                style={{
                  color: isActive ? ORANGE : '#555',
                  backgroundColor: 'transparent',
                  borderBottom: isActive ? `2px solid ${ORANGE}` : '2px solid transparent',
                  borderRadius: 0,
                }}
              >
                {link.label}
              </button>
            )
          })}
        </nav>

        {/* Right: Avatar + Sign out */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {user && (
            <>
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: ORANGE }}
              >
                {user.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <span className="text-sm text-gray-600 hidden sm:block">
                {user.name?.split(' ')[0]}
              </span>
              <button
                onClick={() => setShowFeedback(true)}
                title="Report a bug or suggest an improvement"
                className="text-xs px-2.5 py-1.5 rounded-md font-medium transition-colors"
                style={{ backgroundColor: '#f5f3f0', color: ORANGE, border: `1px solid #e8d5ce` }}
              >
                Feedback
              </button>
              <button
                onClick={onLogout}
                className="text-xs px-2 py-1 rounded-md text-gray-400 hover:text-gray-600 transition-colors"
              >
                Sign out
              </button>
            </>
          )}
        </div>

      </div>
    </header>

    {showFeedback && (
      <FeedbackModal user={user} onClose={() => setShowFeedback(false)} />
    )}
  </>
  )
}
