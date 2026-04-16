import { useState, useEffect, useCallback } from 'react'
import Navbar from './Navbar'
import { API_BASE, apiFetch, ORANGE, fmt } from './books/shared'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function daysSince(iso) {
  if (!iso) return Infinity
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
}

function firstName(user) {
  return (user?.name || user?.email || 'friend').split(' ')[0].split('@')[0]
}

export default function TechPlannerScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [jobs, setJobs] = useState([])
  const [shops, setShops] = useState([])
  const [clockStatus, setClockStatus] = useState(null)
  const [bonusData, setBonusData] = useState(null)
  const [mileageData, setMileageData] = useState(null)
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [j, s, c, b, m, a] = await Promise.allSettled([
        apiFetch(`${API_BASE}/api/jobs`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/shops`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/timeclock/current`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/bonuses/calculate?period=this_month`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/mileage/summary?period=${new Date().toISOString().slice(0,7)}`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/team/announcements`).then(r => r.json()),
      ])
      if (j.status === 'fulfilled' && Array.isArray(j.value)) setJobs(j.value)
      if (s.status === 'fulfilled' && Array.isArray(s.value)) setShops(s.value)
      if (c.status === 'fulfilled') setClockStatus(c.value)
      if (b.status === 'fulfilled') setBonusData(b.value)
      if (m.status === 'fulfilled') setMileageData(m.value)
      if (a.status === 'fulfilled' && Array.isArray(a.value)) setAnnouncements(a.value)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const name = firstName(user)
  const today = todayISO()
  const userName = user?.name || user?.email

  // Today's jobs assigned to me
  const myJobs = jobs.filter(j => {
    const tech = j.technician || j.assigned_to || ''
    const matchesMe = tech === userName || tech.toLowerCase() === (userName || '').toLowerCase() || tech === firstName({ name: userName })
    const notDone = j.status !== 'complete' && j.status !== 'cancelled'
    return matchesMe && notDone
  })

  const completedToday = jobs.filter(j => j.status === 'complete' && (j.completed_at || '').startsWith(today))
    .filter(j => {
      const tech = j.technician || j.assigned_to || ''
      return tech === userName || tech === firstName({ name: userName })
    }).length

  // Core shops (active pipeline stage)
  const activeShops = shops.filter(s => s.pipeline_stage === 'active' || s.pipeline_stage === 'active2')
  const staleShops = activeShops
    .map(s => ({ ...s, days: daysSince(s.last_contact) }))
    .filter(s => s.days > 14)
    .sort((a, b) => b.days - a.days)
    .slice(0, 4)

  async function logVisit(shop) {
    try {
      const activities = Array.isArray(shop.activities) ? shop.activities : []
      activities.push({
        type: 'visit',
        date: new Date().toISOString(),
        notes: `Quick visit logged from daily planner`,
        by: userName,
      })
      await apiFetch(`${API_BASE}/api/shops/${shop.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_contact: todayISO(), activities }),
      })
      load()
    } catch (e) { alert('Failed: ' + e.message) }
  }

  function openMaps(address) {
    if (!address) return
    window.open(`https://maps.apple.com/?q=${encodeURIComponent(address)}`, '_blank')
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#fafafa' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {/* Greeting */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold" style={{ color: '#1a1a1a' }}>
            {greeting()}, {name}! 👋
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {loading ? (
          <div className="py-12 text-center text-gray-400 text-sm">Loading your day…</div>
        ) : (
          <div className="space-y-5">

            {/* Quick status bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatusTile emoji="🕐" label={clockStatus ? 'Clocked In' : 'Clocked Out'}
                value={clockStatus ? new Date(clockStatus.clock_in).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
                color={clockStatus ? '#16a34a' : '#999'}
                bg={clockStatus ? '#f0fdf4' : '#fafafa'}
                onClick={() => onNavigate('timeclock')} />
              <StatusTile emoji="✅" label="Jobs Today"
                value={`${completedToday}/${myJobs.length + completedToday}`}
                color={ORANGE} bg="#fff7f5" />
              <StatusTile emoji="💰" label="Bonus MTD"
                value={fmt(bonusData?.bonus_amount || 0)}
                color="#16a34a" bg="#f0fdf4"
                onClick={() => onNavigate('books')} />
              <StatusTile emoji="🚗" label="Miles MTD"
                value={mileageData?.business_miles ? `${mileageData.business_miles.toFixed(0)}` : '—'}
                color="#2563eb" bg="#eff6ff"
                onClick={() => onNavigate('mileage')} />
            </div>

            {/* Today's jobs */}
            <div className="rounded-xl border shadow-sm bg-white" style={{ borderColor: '#f0ece8' }}>
              <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: '#f0ece8' }}>
                <h2 className="font-semibold text-sm" style={{ color: '#1a1a1a' }}>📋 Today's Schedule</h2>
                <button onClick={() => onNavigate('kanban')}
                  className="text-xs font-medium" style={{ color: ORANGE }}>
                  View Board →
                </button>
              </div>
              {myJobs.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-gray-400 text-sm">
                    {completedToday > 0 ? `🎉 Great work, ${name}! All ${completedToday} jobs done.` : 'No jobs assigned. Check with dispatch.'}
                  </p>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
                  {myJobs.slice(0, 6).map(j => (
                    <div key={j.id} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: '#1a1a1a' }}>
                            {j.shop_name || 'Unassigned shop'}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {[j.year, j.make, j.model].filter(Boolean).join(' ')}
                            {j.ro_number && ` • RO# ${j.ro_number}`}
                          </p>
                          {j.calibrations && (
                            <p className="text-xs text-gray-400 mt-1 truncate">
                              {Array.isArray(j.calibrations) ? j.calibrations.map(c => typeof c === 'string' ? c : c.name).join(', ') : j.calibrations}
                            </p>
                          )}
                        </div>
                        <div className="flex-shrink-0 flex flex-col gap-1">
                          {j.shop_address && (
                            <button onClick={() => openMaps(j.shop_address)}
                              className="text-xs px-3 py-1 rounded-md font-medium"
                              style={{ backgroundColor: '#eff6ff', color: '#2563eb' }}>
                              📍 Maps
                            </button>
                          )}
                          <span className="text-xs px-2 py-0.5 rounded-full text-center"
                            style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
                            {j.status?.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {myJobs.length > 6 && (
                    <div className="px-5 py-2 text-center">
                      <button onClick={() => onNavigate('kanban')}
                        className="text-xs font-medium" style={{ color: ORANGE }}>
                        + {myJobs.length - 6} more on the board
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Core shop reminders */}
            {staleShops.length > 0 && (
              <div className="rounded-xl border shadow-sm bg-white" style={{ borderColor: '#f0ece8' }}>
                <div className="px-5 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
                  <h2 className="font-semibold text-sm" style={{ color: '#1a1a1a' }}>☕ Core Shop Check-Ins</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Stop by these shops if you're nearby</p>
                </div>
                <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
                  {staleShops.map(s => (
                    <div key={s.id} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: '#1a1a1a' }}>{s.shop_name}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {s.address || 'No address'} · Last visit {s.days === Infinity ? 'never' : `${s.days}d ago`}
                        </p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        {s.address && (
                          <button onClick={() => openMaps(s.address)}
                            className="text-xs px-2 py-1 rounded-md font-medium"
                            style={{ backgroundColor: '#eff6ff', color: '#2563eb' }}>
                            📍
                          </button>
                        )}
                        <button onClick={() => logVisit(s)}
                          className="text-xs px-3 py-1 rounded-md font-medium text-white"
                          style={{ backgroundColor: ORANGE }}>
                          Log Visit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Announcements */}
            {announcements.length > 0 && (
              <div className="rounded-xl border shadow-sm bg-white" style={{ borderColor: '#f0ece8' }}>
                <div className="px-5 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
                  <h2 className="font-semibold text-sm" style={{ color: '#1a1a1a' }}>📢 Announcements</h2>
                </div>
                <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
                  {announcements.slice(0, 3).map(a => {
                    const unread = !(a.reads || []).includes(userName)
                    const urgent = a.priority === 'urgent'
                    return (
                      <div key={a.id} className="px-5 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {a.pinned && <span className="text-xs">📌</span>}
                              <p className="text-sm font-semibold" style={{ color: urgent ? '#b91c1c' : '#1a1a1a' }}>
                                {a.title}
                              </p>
                              {unread && (
                                <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                                  style={{ backgroundColor: '#fff7f5', color: ORANGE }}>NEW</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{a.body}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {announcements.length > 3 && (
                    <button onClick={() => onNavigate('team')}
                      className="w-full py-2 text-xs font-semibold text-center"
                      style={{ color: ORANGE }}>
                      See all {announcements.length} announcements →
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Weekly stats card */}
            <div className="rounded-xl border shadow-sm bg-white p-5" style={{ borderColor: '#f0ece8' }}>
              <h2 className="font-semibold text-sm mb-3" style={{ color: '#1a1a1a' }}>📊 Your Month</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-500">Revenue</p>
                  <p className="text-lg font-bold" style={{ color: '#16a34a' }}>{fmt(bonusData?.total_revenue || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Bonus</p>
                  <p className="text-lg font-bold" style={{ color: ORANGE }}>{fmt(bonusData?.bonus_amount || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Miles</p>
                  <p className="text-lg font-bold" style={{ color: '#2563eb' }}>
                    {mileageData?.business_miles ? mileageData.business_miles.toFixed(0) : '0'}
                  </p>
                </div>
              </div>
              {bonusData?.next_tier && (
                <p className="text-xs text-gray-500 mt-3">
                  💪 {fmt(bonusData.next_tier.revenue_to_next)} more in sales to hit {(bonusData.next_tier.rate * 100).toFixed(1)}% tier
                </p>
              )}
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <ActionButton emoji="🕐" label="Time Clock" onClick={() => onNavigate('timeclock')} />
              <ActionButton emoji="🏖️" label="Request PTO" onClick={() => onNavigate('pto')} />
              <ActionButton emoji="🚗" label="Mileage" onClick={() => onNavigate('mileage')} />
              <ActionButton emoji="📋" label="Job Board" onClick={() => onNavigate('kanban')} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusTile({ emoji, label, value, color, bg, onClick }) {
  return (
    <button onClick={onClick} disabled={!onClick}
      className="rounded-xl p-3 shadow-sm text-left transition-transform"
      style={{ backgroundColor: bg, cursor: onClick ? 'pointer' : 'default' }}>
      <p className="text-xs text-gray-500 flex items-center gap-1">
        <span>{emoji}</span> <span>{label}</span>
      </p>
      <p className="text-lg font-bold mt-1" style={{ color }}>{value}</p>
    </button>
  )
}

function ActionButton({ emoji, label, onClick }) {
  return (
    <button onClick={onClick}
      className="rounded-xl p-4 shadow-sm bg-white text-center hover:shadow-md transition-shadow"
      style={{ border: '1px solid #f0ece8' }}>
      <p className="text-2xl mb-1">{emoji}</p>
      <p className="text-xs font-medium text-gray-700">{label}</p>
    </button>
  )
}
