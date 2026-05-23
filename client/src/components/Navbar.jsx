import { useState, useRef, useEffect } from 'react'
import FeedbackModal from './FeedbackModal'

const ORANGE = '#CD4419'

// Primary nav — everyday workflow, 6 items max
const PRIMARY_LINKS = [
  { id: 'today',   label: 'Today' },
  { id: 'kanban',  label: 'Jobs' },
  { id: 'dispatch-map', label: 'Map', adminOnly: true },
  { id: 'crm',     label: 'CRM' },
  { id: 'books',   label: 'Books' },
  { id: 'ops',     label: 'Ops', adminOnly: true },
]

// Secondary nav — grouped by category in a spacious dropdown
const MORE_GROUPS = [
  { label: 'Finance', links: [
    { id: 'quotes',    label: 'Quotes' },
    { id: 'disputes',  label: 'Disputes', adminOnly: true },
    { id: 'manual',    label: 'Manual Invoice' },
    { id: 'estimates', label: 'Repair Estimates' },
  ]},
  { label: 'People & Time', links: [
    { id: 'timeclock', label: 'Time Clock' },
    { id: 'pto',       label: 'Time Off' },
    { id: 'mileage',   label: 'Mileage' },
    { id: 'payroll',   label: 'Payroll', adminOnly: true },
    { id: 'team',      label: 'Team' },
  ]},
  { label: 'Intelligence', links: [
    { id: 'daily-review', label: 'Daily Review', adminOnly: true },
    { id: 'intel',        label: 'Business Intelligence', adminOnly: true },
    { id: 'cx',           label: 'Customer Experience', adminOnly: true },
    { id: 'history',      label: 'History' },
  ]},
  { label: 'Tools', links: [
    { id: 'upload',    label: 'Upload PDF' },
    { id: 'planner',   label: 'My Day Planner' },
    { id: 'projects',  label: 'Projects' },
    { id: 'rules',     label: 'Calibration Rules' },
    { id: 'messages',  label: 'Messages' },
  ]},
  { label: 'Admin', links: [
    { id: 'branding',    label: 'Branding', adminOnly: true },
    { id: 'zoho-import', label: 'Import from Zoho', adminOnly: true },
  ]},
]

const MORE_LINKS = MORE_GROUPS.flatMap(g => g.links)
const ALL_LINKS = [...PRIMARY_LINKS, ...MORE_LINKS]

export default function Navbar({ user, onLogout, currentScreen, onNavigate }) {
  const [showFeedback,   setShowFeedback]   = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [showMore,       setShowMore]       = useState(false)
  const [showNotifs,     setShowNotifs]     = useState(false)
  const [notifs, setNotifs]                 = useState([])
  const [unreadCount, setUnreadCount]       = useState(0)
  const moreRef = useRef(null)
  const notifRef = useRef(null)
  const isAdmin = user?.role !== 'technician'
  const visiblePrimary = PRIMARY_LINKS.filter(l => !l.adminOnly || isAdmin)
  const visibleAll = [...visiblePrimary, ...MORE_LINKS]

  // Fetch notifications on mount + every 30s
  useEffect(() => {
    if (!user?.name) return
    const fetchNotifs = async () => {
      try {
        const token = sessionStorage.getItem('adasiq_token')
        const name = user.techName || user.name?.split(' ')[0] || ''
        const role = user.role || 'admin'
        const res = await fetch(`/server/adasiq-api/api/notifications?user=${encodeURIComponent(name)}&role=${role}`, {
          headers: { 'x-auth-token': token },
        })
        const data = await res.json()
        if (data.ok) { setNotifs(data.notifications || []); setUnreadCount(data.unread || 0) }
      } catch {}
    }
    fetchNotifs()
    const interval = setInterval(fetchNotifs, 30000)
    return () => clearInterval(interval)
  }, [user?.name, user?.techName, user?.role])

  async function markAllRead() {
    try {
      const token = sessionStorage.getItem('adasiq_token')
      const name = user.techName || user.name?.split(' ')[0] || ''
      await fetch('/server/adasiq-api/api/notifications/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
        body: JSON.stringify({ ids: 'all', user: name }),
      })
      setNotifs(prev => prev.map(n => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch {}
  }

  // Close More dropdown when clicking outside
  useEffect(() => {
    function handler(e) {
      if (moreRef.current && !moreRef.current.contains(e.target)) setShowMore(false)
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifs(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function navigate(id) {
    onNavigate && onNavigate(id)
    setShowMobileMenu(false)
    setShowMore(false)
  }

  const moreActive = MORE_LINKS.some(l => l.id === currentScreen)

  return (
    <>
    {user?.demo && (
      <div className="flex items-center justify-center gap-3 px-4 py-2 text-xs font-medium"
        style={{ backgroundColor: '#92400e', color: '#fef3c7' }}>
        <span>⚡ You are viewing a live demo — all job and invoice data is sample data only.</span>
        <a href="mailto:mark@absoluteadas.com" style={{ color: '#fde68a', textDecoration: 'underline' }}>
          Contact us to get started
        </a>
      </div>
    )}
    <header style={{ backgroundColor: 'white', borderBottom: '1px solid #ebebeb' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">

        {/* Left: Logo */}
        <div className="flex items-center gap-2.5 cursor-pointer flex-shrink-0" onClick={() => navigate('upload')}>
          <img src={import.meta.env.BASE_URL + 'logo.png'} alt="Absolute ADAS" className="w-8 h-8 object-contain" />
          <span className="text-base font-extrabold tracking-tight" style={{ color: '#1a1a1a' }}>
            Absolute <span style={{ color: ORANGE }}>ADAS</span>
          </span>
        </div>

        {/* Center: Primary nav + More dropdown — desktop only */}
        <nav className="hidden md:flex items-center gap-0.5">
          {visiblePrimary.map(link => {
            const isActive = currentScreen === link.id
            return (
              <button key={link.id} onClick={() => navigate(link.id)}
                className="text-sm px-3 py-2 font-medium transition-colors"
                style={{
                  color: isActive ? ORANGE : '#555',
                  borderBottom: isActive ? `2px solid ${ORANGE}` : '2px solid transparent',
                  borderRadius: 0,
                }}>
                {link.label}
              </button>
            )
          })}

          {/* More dropdown */}
          <div className="relative" ref={moreRef}>
            <button
              onClick={() => setShowMore(v => !v)}
              className="flex items-center gap-1 text-sm px-3 py-2 font-medium transition-colors"
              style={{
                color: moreActive ? ORANGE : '#555',
                borderBottom: moreActive ? `2px solid ${ORANGE}` : '2px solid transparent',
                borderRadius: 0,
              }}>
              More
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: showMore ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {showMore && (
              <div className="absolute top-full left-0 mt-2 py-2 rounded-xl shadow-xl z-50 grid grid-cols-2 gap-1"
                style={{ backgroundColor: 'white', border: '1px solid #ebebeb', minWidth: 420, maxWidth: 560 }}>
                {MORE_GROUPS.map(group => {
                  const visibleLinks = group.links.filter(l => !l.adminOnly || isAdmin)
                  if (visibleLinks.length === 0) return null
                  return (
                    <div key={group.label} className="py-1 px-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider px-2 py-1.5"
                        style={{ color: '#b8b8b8', letterSpacing: '0.1em' }}>
                        {group.label}
                      </p>
                      {visibleLinks.map(link => {
                        const isActive = currentScreen === link.id
                        return (
                          <button key={link.id} onClick={() => navigate(link.id)}
                            className="w-full text-left text-sm px-2 py-2 rounded-md font-medium transition-colors"
                            style={{
                              color: isActive ? ORANGE : '#1a1a1a',
                              backgroundColor: isActive ? '#fff7f5' : 'transparent',
                            }}
                            onMouseEnter={e => {
                              if (!isActive) e.currentTarget.style.backgroundColor = '#fafafa'
                            }}
                            onMouseLeave={e => {
                              if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'
                            }}>
                            {link.label}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </nav>

        {/* Right: Avatar + actions + mobile hamburger */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {user && (
            <>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: ORANGE }}>
                {user.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <span className="text-sm text-gray-600 hidden sm:block">{user.name?.split(' ')[0]}</span>

              {/* Notification bell */}
              <div className="relative" ref={notifRef}>
                <button onClick={() => setShowNotifs(v => !v)}
                  className="relative w-8 h-8 flex items-center justify-center rounded-md"
                  style={{ backgroundColor: showNotifs ? '#f5f3f0' : 'transparent' }}
                  aria-label="Notifications">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={unreadCount > 0 ? ORANGE : '#888'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full text-white text-[10px] font-bold px-1"
                      style={{ backgroundColor: ORANGE }}>
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>
                {showNotifs && (
                  <div className="absolute top-full right-0 mt-1 rounded-xl shadow-lg z-50"
                    style={{ backgroundColor: 'white', border: '1px solid #ebebeb', width: 320, maxHeight: 400, overflowY: 'auto' }}>
                    <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid #ebebeb' }}>
                      <span className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>Notifications</span>
                      {unreadCount > 0 && (
                        <button onClick={markAllRead} className="text-xs font-medium" style={{ color: ORANGE }}>Mark all read</button>
                      )}
                    </div>
                    {notifs.length === 0 && (
                      <div className="px-4 py-6 text-center text-sm" style={{ color: '#888' }}>No notifications yet</div>
                    )}
                    {notifs.slice(0, 5).map(n => (
                      <div key={n.id}
                        onClick={() => { if (n.jobId) navigate('kanban'); setShowNotifs(false) }}
                        className="px-4 py-3 cursor-pointer"
                        style={{ backgroundColor: n.read ? 'white' : '#fff8f5', borderBottom: '1px solid #f5f3f0' }}>
                        <div className="flex items-start gap-2">
                          {!n.read && <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: ORANGE }} />}
                          <div style={{ flex: 1 }}>
                            <div className="text-sm font-medium" style={{ color: '#1a1a1a' }}>{n.title}</div>
                            <div className="text-xs mt-0.5" style={{ color: '#888' }}>{n.body}</div>
                            <div className="text-[10px] mt-1" style={{ color: '#bbb' }}>
                              {n.created_at ? new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="px-4 py-2.5 text-center" style={{ borderTop: '1px solid #ebebeb' }}>
                      <button onClick={() => { navigate('messages'); setShowNotifs(false) }}
                        className="text-xs font-semibold" style={{ color: ORANGE, background: 'none', border: 'none', cursor: 'pointer' }}>
                        View all messages →
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Settings gear — admin only */}
              {isAdmin && (
                <button onClick={() => navigate('settings')}
                  className="hidden md:flex w-8 h-8 items-center justify-center rounded-md"
                  style={{ backgroundColor: currentScreen === 'settings' ? '#f5f3f0' : 'transparent' }}
                  aria-label="Settings">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={currentScreen === 'settings' ? ORANGE : '#888'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                </button>
              )}

              <button onClick={() => setShowFeedback(true)}
                className="hidden md:block text-xs px-2.5 py-1.5 rounded-md font-medium"
                style={{ backgroundColor: '#f5f3f0', color: ORANGE, border: `1px solid #e8d5ce` }}>
                Feedback
              </button>
              <button onClick={onLogout}
                className="hidden md:block text-xs px-2 py-1 rounded-md text-gray-400 hover:text-gray-600 transition-colors">
                Sign out
              </button>
              {/* Mobile hamburger */}
              <button onClick={() => setShowMobileMenu(v => !v)}
                className="md:hidden flex flex-col items-center justify-center w-8 h-8 gap-1.5 rounded-md"
                style={{ backgroundColor: showMobileMenu ? '#f5f3f0' : 'transparent' }}
                aria-label="Menu">
                {showMobileMenu ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                ) : (
                  <>
                    <span className="w-5 h-0.5 rounded-full" style={{ backgroundColor: '#555' }} />
                    <span className="w-5 h-0.5 rounded-full" style={{ backgroundColor: '#555' }} />
                    <span className="w-5 h-0.5 rounded-full" style={{ backgroundColor: '#555' }} />
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Mobile menu dropdown — grouped just like the desktop More dropdown */}
      {showMobileMenu && (
        <div className="md:hidden" style={{ borderTop: '1px solid #ebebeb', backgroundColor: 'white' }}>
          <nav className="px-4 py-3 flex flex-col gap-0.5">
            {/* Primary links — styled as featured */}
            <p className="text-[10px] font-bold uppercase tracking-wider px-1 pt-1 pb-2"
              style={{ color: '#b8b8b8', letterSpacing: '0.1em' }}>Daily</p>
            {visiblePrimary.map(link => {
              const isActive = currentScreen === link.id
              return (
                <button key={link.id} onClick={() => navigate(link.id)}
                  className="text-sm px-3 py-2.5 font-medium text-left rounded-lg transition-colors"
                  style={{ color: isActive ? ORANGE : '#1a1a1a', backgroundColor: isActive ? '#fff7f5' : 'transparent' }}>
                  {link.label}
                </button>
              )
            })}
            {MORE_GROUPS.map(group => {
              const visibleLinks = group.links.filter(l => !l.adminOnly || isAdmin)
              if (visibleLinks.length === 0) return null
              return (
                <div key={group.label}>
                  <p className="text-[10px] font-bold uppercase tracking-wider px-1 pt-3 pb-2"
                    style={{ color: '#b8b8b8', letterSpacing: '0.1em' }}>{group.label}</p>
                  {visibleLinks.map(link => {
                    const isActive = currentScreen === link.id
                    return (
                      <button key={link.id} onClick={() => navigate(link.id)}
                        className="text-sm px-3 py-2.5 font-medium text-left rounded-lg transition-colors w-full"
                        style={{ color: isActive ? ORANGE : '#1a1a1a', backgroundColor: isActive ? '#fff7f5' : 'transparent' }}>
                        {link.label}
                      </button>
                    )
                  })}
                </div>
              )
            })}
            <div className="flex gap-2 mt-4 pt-4 flex-wrap" style={{ borderTop: '1px solid #f0ece8' }}>
              {isAdmin && (
                <button onClick={() => navigate('settings')}
                  className="text-xs px-3 py-2 rounded-lg font-medium flex-1"
                  style={{ backgroundColor: currentScreen === 'settings' ? '#fff7f5' : '#f5f3f0', color: currentScreen === 'settings' ? ORANGE : '#555' }}>
                  Settings
                </button>
              )}
              <button onClick={() => { setShowFeedback(true); setShowMobileMenu(false) }}
                className="text-xs px-3 py-2 rounded-lg font-medium flex-1"
                style={{ backgroundColor: '#fff7f5', color: ORANGE, border: `1px solid #fcd5c5` }}>
                Feedback
              </button>
              <button onClick={onLogout}
                className="text-xs px-3 py-2 rounded-lg text-gray-500 font-medium flex-1"
                style={{ backgroundColor: '#f5f3f0' }}>
                Sign out
              </button>
            </div>
          </nav>
        </div>
      )}
    </header>

    {showFeedback && (
      <FeedbackModal user={user} onClose={() => setShowFeedback(false)} />
    )}
  </>
  )
}
