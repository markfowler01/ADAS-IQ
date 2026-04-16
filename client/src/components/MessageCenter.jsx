import { useState, useEffect } from 'react'
import Navbar from './Navbar'

const ORANGE = '#CD4419'

const TYPE_ICONS = {
  job_assigned: { icon: '📋', label: 'Job Assigned', bg: '#fff7ed', color: '#c2410c' },
  job_updated:  { icon: '🔄', label: 'Job Updated',  bg: '#eff6ff', color: '#1d4ed8' },
  job_status:   { icon: '✅', label: 'Status Change', bg: '#f0fdf4', color: '#16a34a' },
  default:      { icon: '🔔', label: 'Notification',  bg: '#f5f3f0', color: '#555' },
}

export default function MessageCenter({ user, onLogout, currentScreen, onNavigate }) {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // all, unread

  const techName = user?.techName || user?.name?.split(' ')[0] || ''
  const role = user?.role || 'admin'

  async function fetchNotifications() {
    try {
      const token = sessionStorage.getItem('adasiq_token')
      const res = await fetch(
        `/server/adasiq-api/api/notifications?user=${encodeURIComponent(techName)}&role=${role}`,
        { headers: { 'x-auth-token': token } }
      )
      const data = await res.json()
      if (data.ok) {
        setNotifications(data.notifications || [])
        setUnreadCount(data.unread || 0)
      }
    } catch (e) {
      console.error('Failed to fetch notifications:', e)
    }
    setLoading(false)
  }

  useEffect(() => { fetchNotifications() }, [])

  async function markAllRead() {
    try {
      const token = sessionStorage.getItem('adasiq_token')
      await fetch('/server/adasiq-api/api/notifications/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
        body: JSON.stringify({ ids: 'all', user: techName }),
      })
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch {}
  }

  async function markOneRead(id) {
    try {
      const token = sessionStorage.getItem('adasiq_token')
      await fetch('/server/adasiq-api/api/notifications/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
        body: JSON.stringify({ ids: [id], user: techName }),
      })
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch {}
  }

  const filtered = filter === 'unread'
    ? notifications.filter(n => !n.read)
    : notifications

  // Group by date
  const grouped = {}
  for (const n of filtered) {
    const d = n.created_at ? new Date(n.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : 'Unknown'
    if (!grouped[d]) grouped[d] = []
    grouped[d].push(n)
  }

  return (
    <div style={{ background: 'white', minHeight: '100vh' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: '#1a1a1a', margin: 0 }}>Message Center</h1>
            <p style={{ fontSize: 13, color: '#888', margin: '4px 0 0' }}>
              {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'All caught up'}
            </p>
          </div>
          {unreadCount > 0 && (
            <button onClick={markAllRead} style={{
              background: 'transparent', border: `1px solid ${ORANGE}`, color: ORANGE,
              borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
              Mark all read
            </button>
          )}
        </div>

        {/* Filter pills */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
          {['all', 'unread'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              background: filter === f ? ORANGE : 'transparent',
              color: filter === f ? 'white' : '#666',
              border: `1px solid ${filter === f ? ORANGE : '#ddd'}`,
              borderRadius: 999, padding: '5px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 500,
            }}>
              {f === 'all' ? `All (${notifications.length})` : `Unread (${unreadCount})`}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#888', fontSize: 14 }}>Loading notifications...</div>
        )}

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔔</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a', marginBottom: 4 }}>
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </div>
            <div style={{ fontSize: 13, color: '#888' }}>
              {filter === 'unread' ? 'Switch to "All" to see your history' : "You'll be notified here when jobs are assigned to you"}
            </div>
          </div>
        )}

        {/* Notification list grouped by date */}
        {Object.entries(grouped).map(([date, items]) => (
          <div key={date} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#aaa', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #f0eeeb' }}>
              {date}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map(n => {
                const t = TYPE_ICONS[n.type] || TYPE_ICONS.default
                return (
                  <div key={n.id}
                    onClick={() => { if (!n.read) markOneRead(n.id); if (n.jobId) onNavigate('kanban') }}
                    style={{
                      display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                      background: n.read ? 'white' : '#fff8f5',
                      border: `1px solid ${n.read ? '#ebebeb' : '#fde0d0'}`,
                    }}>
                    {/* Icon */}
                    <div style={{
                      width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: t.bg, fontSize: 18, flexShrink: 0,
                    }}>
                      {t.icon}
                    </div>
                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        {!n.read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: ORANGE, flexShrink: 0 }} />}
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{n.title}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#666', lineHeight: 1.4 }}>{n.body}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: '#bbb' }}>
                          {n.created_at ? new Date(n.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: t.bg, color: t.color }}>
                          {t.label}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
