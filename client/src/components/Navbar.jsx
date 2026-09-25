import { useState, useRef, useEffect } from 'react'
import { isOwnerUser, isMarkUser } from '../utils/identity.js'
import FeedbackModal from './FeedbackModal'

const ORANGE = '#CD4419'

// Primary nav — everyday workflow, 6 items max
const PRIMARY_LINKS = [
  // `icon` and `mobileLabel` are for the phone sheet (Mark 2026-09-24: the
  // menu was hard to find things in and hard to press).
  { id: 'live',    label: 'Live', mobileLabel: 'Live Day', icon: '⚡' },   // techs land here at sign-in — it has to be in their menu too (Mark 2026-09-24)
  { id: 'schedule', label: 'Schedule', icon: '🗓', adminOnly: true },
  { id: 'today',   label: 'Today', icon: '☀️' },
  { id: 'kanban',  label: 'Jobs', icon: '🗂' },
  { id: 'dispatch-map', label: 'Map', icon: '🗺', adminOnly: true },
  { id: 'crm',     label: 'CRM', icon: '🏢', adminOnly: true },
  { id: 'sms',     label: 'Phone', icon: '💬', adminOnly: true },
  { id: 'books',   label: 'Books', icon: '📗', adminOnly: true },
  { id: 'payroll', label: 'Payroll', icon: '💵', ownerOnly: true },   // Mark 2026-09-16: one click to the Hours tab (Mark + Kat)
]

// Secondary nav — grouped by category in a spacious dropdown
const MORE_GROUPS = [
  { label: 'Finance', links: [
    { id: 'quotes',    label: 'Quotes', adminOnly: true , icon: '📝' },
    { id: 'disputes',  label: 'Disputes', adminOnly: true , icon: '⚖️' },
    { id: 'manual',    label: 'Manual Invoice', adminOnly: true , icon: '🧾' },
    { id: 'estimator', label: 'Estimator', adminOnly: true , icon: '🔧' },
  ]},
  { label: 'People & Time', links: [
    { id: 'timeclock', label: 'Time Clock' , icon: '⏱' },
    { id: 'pto',       label: 'Time Off' , icon: '🏖' },
    { id: 'hr-policy', label: 'HR Policy' , icon: '📋' },
    { id: 'mileage',   label: 'Mileage' , icon: '🚐' },
    { id: 'payroll',   label: 'Payroll', ownerOnly: true , icon: '💵' },
    { id: 'team',      label: 'Directory & Org' , icon: '👥' },
    { id: 'recruit',   label: 'Recruiting', adminOnly: true , icon: '🧑‍🔧' },
  ]},
  { label: 'Intelligence', links: [
    { id: 'daily-review', label: 'Daily Review', ownerOnly: true , icon: '📈' },
    { id: 'intel',        label: 'Business Intelligence', ownerOnly: true , icon: '🧠' },
    { id: 'cx',           label: 'Customer Experience', ownerOnly: true , icon: '⭐' },
    { id: 'history',      label: 'History' , icon: '📚' },
  ]},
  { label: 'Tools', links: [
    { id: 'upload',    label: 'Upload PDF' , icon: '📄' },
    { id: 'planner',   label: 'My Day Planner' , icon: '🗒' },
    { id: 'projects',  label: 'Projects' , icon: '📌' },
    { id: 'tips',      label: 'TSB Tips' , icon: '📖' },
    { id: 'rules',     label: 'Calibration Rules' , icon: '⚙️' },
    { id: 'item-map',  label: 'Item Mapping', adminOnly: true , icon: '🔗' },
    { id: 'wd-cleanup', label: 'WorkDrive Cleanup', ownerOnly: true , icon: '🧹' },
    { id: 'messages',  label: 'Messages' , icon: '✉️' },
  ]},
  { label: 'Admin', links: [
    { id: 'ops',         label: 'Ops', ownerOnly: true , icon: '🛠' },
    { id: 'scaling',     label: 'Scaling', ownerOnly: true , icon: '📊' },
    { id: 'branding',    label: 'Branding', ownerOnly: true , icon: '🎨' },
    { id: 'zoho-import', label: 'Import from Zoho', ownerOnly: true , icon: '⬇️' },
  ]},
]

const MORE_LINKS = MORE_GROUPS.flatMap(g => g.links)
const ALL_LINKS = [...PRIMARY_LINKS, ...MORE_LINKS]

export default function Navbar({ user, onLogout, currentScreen, onNavigate }) {
  const [showFeedback,   setShowFeedback]   = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [showAllForTech, setShowAllForTech] = useState(false)
  const [showMore,       setShowMore]       = useState(false)
  const [showNotifs,     setShowNotifs]     = useState(false)
  const [notifs, setNotifs]                 = useState([])
  const [unreadCount, setUnreadCount]       = useState(0)
  const moreRef = useRef(null)
  const notifRef = useRef(null)
  const isAdmin = user?.role !== 'technician'
  // Roles (Mark 2026-08-30): owner = Mark (everything), dispatcher = Kat
  // (all operations incl. invoicing), technician = field essentials.
  // Legacy 'admin' tokens behave as dispatcher until next login.
  const isOwner = isOwnerUser(user)
  const canSee = l => (l.ownerOnly ? isOwner : l.adminOnly ? isAdmin : true)
  // 👷 A technician sees fifteen links and uses five. The rest stay one tap
  // away behind "Everything else" (Mark 2026-09-25).
  const TECH_EVERYDAY = ['live', 'kanban', 'timeclock', 'tips', 'mileage']
  const isTech = user?.role === 'technician'
  const visiblePrimary = PRIMARY_LINKS.filter(canSee)
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
                  const visibleLinks = group.links.filter(canSee)
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

        {/* Reference-tool shortcuts — same four links as the Live Day
            header, one click from anywhere (Mark 2026-07-11). Desktop
            only; wide screens (lg) so the primary nav never crowds. */}
        <div className="hidden lg:flex items-center gap-1 flex-shrink-0">
          <a href="https://my.alldata.com/migrate/#/home" target="_blank" rel="noopener noreferrer"
            className="text-[11px] px-2 py-1 rounded-md font-semibold"
            style={{ backgroundColor: '#1e40af', color: 'white' }}
            title="Open AllData">AllData</a>
          <a href="https://ops.kinetic.auto/id/" target="_blank" rel="noopener noreferrer"
            className="text-[11px] px-2 py-1 rounded-md font-semibold"
            style={{ backgroundColor: '#0e7490', color: 'white' }}
            title="Open Kinetic">Kinetic</a>
          <a href="https://dh.identifix.com/Default/LogOnIdentifix?sessionTerminated=True" target="_blank" rel="noopener noreferrer"
            className="text-[11px] px-2 py-1 rounded-md font-semibold"
            style={{ backgroundColor: '#7c2d12', color: 'white' }}
            title="Open Identifix">Identifix</a>
          <a href="https://opusccp.com/" target="_blank" rel="noopener noreferrer"
            className="text-[11px] px-2 py-1 rounded-md font-semibold"
            style={{ backgroundColor: '#4c1d95', color: 'white' }}
            title="Open Opus CCP">Opus CCP</a>
        </div>

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
                className="md:hidden flex flex-col items-center justify-center gap-1.5 rounded-xl"
                style={{ width: 44, height: 44, backgroundColor: showMobileMenu ? '#f5f3f0' : '#fff7f5', border: `1px solid ${showMobileMenu ? '#e0dbd6' : '#fcd5c5'}` }}
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

      {/* Mobile menu — a full-height sheet (Mark 2026-09-24). It used to be an
          inline dropdown inside the header: 14px rows, no scroll, so with
          thirty-odd links the bottom ran off the screen and nothing was easy
          to hit. Now it scrolls, the rows are 56px, and every one has an icon. */}
      {showMobileMenu && (
        <div className="md:hidden fixed inset-0 z-[80]" style={{ backgroundColor: 'rgba(20,16,14,.45)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowMobileMenu(false) }}>
          <div className="absolute inset-x-0 bottom-0 top-14 flex flex-col rounded-t-2xl overflow-hidden"
            style={{ backgroundColor: '#faf9f7', boxShadow: '0 -8px 32px rgba(0,0,0,.18)' }}>
            <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
              style={{ backgroundColor: 'white', borderBottom: '1px solid #efeae6' }}>
              <span className="text-base font-extrabold" style={{ color: '#1a1a1a' }}>Menu</span>
              <button onClick={() => setShowMobileMenu(false)} className="rounded-xl font-bold"
                style={{ width: 44, height: 44, backgroundColor: '#f5f3f0', color: '#555', fontSize: 22, lineHeight: '44px' }}
                aria-label="Close menu">×</button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-3" style={{ WebkitOverflowScrolling: 'touch' }}>
              <p className="text-[11px] font-bold uppercase px-2 pb-2" style={{ color: '#a8a29e', letterSpacing: '0.09em' }}>{isTech ? 'Your day' : 'Daily'}</p>
              <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'white', border: '1px solid #efeae6' }}>
                {(isTech ? [...visiblePrimary, ...MORE_GROUPS.flatMap(g => g.links)].filter(l => TECH_EVERYDAY.includes(l.id) && canSee(l)).sort((a, b) => TECH_EVERYDAY.indexOf(a.id) - TECH_EVERYDAY.indexOf(b.id)) : visiblePrimary).map((link, i) => {
                  const isActive = currentScreen === link.id
                  return (
                    <button key={link.id} onClick={() => navigate(link.id)}
                      className="w-full flex items-center gap-3 px-4 text-left"
                      style={{ minHeight: 56, borderTop: i ? '1px solid #f5f2ef' : 'none', backgroundColor: isActive ? '#fff7f5' : 'white' }}>
                      <span style={{ fontSize: 20, width: 26, textAlign: 'center' }}>{link.icon || '•'}</span>
                      <span className="flex-1 font-semibold" style={{ fontSize: 17, color: isActive ? ORANGE : '#1a1a1a' }}>{link.mobileLabel || link.label}</span>
                      {isActive && <span className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ backgroundColor: ORANGE, color: 'white' }}>HERE</span>}
                    </button>
                  )
                })}
              </div>

              {isTech && !showAllForTech && (
                <button type="button" onClick={() => setShowAllForTech(true)}
                  className="w-full mt-4 rounded-2xl font-bold"
                  style={{ minHeight: 52, fontSize: 15, backgroundColor: 'white', border: '1px solid #efeae6', color: '#78716c' }}>
                  Everything else ›
                </button>
              )}
              {(!isTech || showAllForTech) && MORE_GROUPS.map(group => {
                const visibleLinks = group.links.filter(canSee).filter(l => !isTech || !TECH_EVERYDAY.includes(l.id))
                if (!visibleLinks.length) return null
                return (
                  <div key={group.label} className="mt-4">
                    <p className="text-[11px] font-bold uppercase px-2 pb-2" style={{ color: '#a8a29e', letterSpacing: '0.09em' }}>{group.label}</p>
                    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'white', border: '1px solid #efeae6' }}>
                      {visibleLinks.map((link, i) => {
                        const isActive = currentScreen === link.id
                        return (
                          <button key={link.id} onClick={() => navigate(link.id)}
                            className="w-full flex items-center gap-3 px-4 text-left"
                            style={{ minHeight: 52, borderTop: i ? '1px solid #f5f2ef' : 'none', backgroundColor: isActive ? '#fff7f5' : 'white' }}>
                            <span style={{ fontSize: 18, width: 26, textAlign: 'center' }}>{link.icon || '•'}</span>
                            <span className="flex-1 font-medium" style={{ fontSize: 16, color: isActive ? ORANGE : '#33302e' }}>{link.mobileLabel || link.label}</span>
                            {isActive && <span className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ backgroundColor: ORANGE, color: 'white' }}>HERE</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              <div style={{ height: 12 }} />
            </nav>

            <div className="flex gap-2 px-3 py-3 flex-shrink-0"
              style={{ backgroundColor: 'white', borderTop: '1px solid #efeae6', paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
              {isAdmin && (
                <button onClick={() => navigate('settings')} className="flex-1 rounded-xl font-bold"
                  style={{ minHeight: 48, fontSize: 15, backgroundColor: currentScreen === 'settings' ? '#fff7f5' : '#f5f3f0', color: currentScreen === 'settings' ? ORANGE : '#555' }}>Settings</button>
              )}
              <button onClick={() => { setShowFeedback(true); setShowMobileMenu(false) }} className="flex-1 rounded-xl font-bold"
                style={{ minHeight: 48, fontSize: 15, backgroundColor: '#fff7f5', color: ORANGE, border: '1px solid #fcd5c5' }}>Feedback</button>
              <button onClick={onLogout} className="flex-1 rounded-xl font-bold"
                style={{ minHeight: 48, fontSize: 15, backgroundColor: '#f5f3f0', color: '#777' }}>Sign out</button>
            </div>
          </div>
        </div>
      )}
    </header>

    {showFeedback && (
      <FeedbackModal user={user} onClose={() => setShowFeedback(false)} />
    )}
  </>
  )
}
