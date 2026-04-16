import { useState, useMemo } from 'react'

const ORANGE = '#CD4419'

// Deterministic color-per-user palette
const USER_COLORS = [
  { bg: '#fdeee8', color: '#CD4419', border: '#f5c4b0' }, // orange
  { bg: '#dbeafe', color: '#1e40af', border: '#bfdbfe' }, // blue
  { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' }, // green
  { bg: '#fef3c7', color: '#92400e', border: '#fde68a' }, // amber
  { bg: '#f3e8ff', color: '#7e22ce', border: '#e9d5ff' }, // purple
  { bg: '#fce7f3', color: '#be185d', border: '#fbcfe8' }, // pink
  { bg: '#ccfbf1', color: '#0f766e', border: '#99f6e4' }, // teal
]

function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function colorForUser(userId) {
  return USER_COLORS[hashStr(userId || '') % USER_COLORS.length]
}

function ymd(d) {
  return d.toISOString().slice(0, 10)
}

function monthLabel(d) {
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

// Build a 6-week grid for the given month
function buildGrid(monthStart) {
  const firstDay = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1)
  const start = new Date(firstDay)
  start.setDate(start.getDate() - start.getDay()) // back to Sunday
  const days = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    days.push(d)
  }
  return days
}

function datesInRange(startStr, endStr) {
  const out = []
  const s = new Date(startStr + 'T00:00:00')
  const e = new Date(endStr + 'T00:00:00')
  const d = new Date(s)
  while (d <= e) {
    out.push(ymd(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

export default function PTOCalendar({ requests = [], currentMonth, onMonthChange }) {
  const month = currentMonth || new Date()
  const [selectedDate, setSelectedDate] = useState(null)

  // Map date -> array of requests that fall on that day
  const byDate = useMemo(() => {
    const map = {}
    for (const r of requests) {
      const days = datesInRange(r.start_date, r.end_date)
      for (const d of days) {
        if (!map[d]) map[d] = []
        map[d].push(r)
      }
    }
    return map
  }, [requests])

  const grid = useMemo(() => buildGrid(month), [month])

  function shiftMonth(delta) {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1)
    onMonthChange && onMonthChange(next)
    setSelectedDate(null)
  }

  const selectedDayRequests = selectedDate ? (byDate[selectedDate] || []) : []

  return (
    <div className="rounded-2xl bg-white" style={{ border: '1px solid #ebebeb' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid #ebebeb' }}>
        <button onClick={() => shiftMonth(-1)}
          className="px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
          ← Prev
        </button>
        <h3 className="text-base font-semibold" style={{ color: '#1a1a1a' }}>
          {monthLabel(month)}
        </h3>
        <button onClick={() => shiftMonth(1)}
          className="px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
          Next →
        </button>
      </div>

      {/* Weekday labels */}
      <div className="grid grid-cols-7 text-xs font-semibold text-center px-2 pt-3"
        style={{ color: '#888' }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-1 p-2">
        {grid.map((d, i) => {
          const key = ymd(d)
          const inMonth = d.getMonth() === month.getMonth()
          const isToday = key === ymd(new Date())
          const dayRequests = byDate[key] || []
          const isSelected = selectedDate === key
          return (
            <button
              key={i}
              onClick={() => setSelectedDate(isSelected ? null : key)}
              className="text-left rounded-lg p-1.5 min-h-[70px] transition-colors"
              style={{
                backgroundColor: isSelected ? '#fdeee8' : (inMonth ? 'white' : '#fafafa'),
                border: `1px solid ${isSelected ? ORANGE : '#ebebeb'}`,
                opacity: inMonth ? 1 : 0.5,
              }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold"
                  style={{
                    color: isToday ? ORANGE : (inMonth ? '#1a1a1a' : '#888'),
                  }}>
                  {d.getDate()}
                </span>
                {isToday && (
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ORANGE }}/>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                {dayRequests.slice(0, 3).map(r => {
                  const c = colorForUser(r.user_id)
                  return (
                    <span key={r.id}
                      className="text-[10px] font-medium rounded px-1 py-0.5 truncate"
                      style={{ backgroundColor: c.bg, color: c.color, border: `1px solid ${c.border}` }}
                      title={`${r.user_name} — ${r.type}${r.half_day ? ' (½)' : ''}`}>
                      {r.user_name?.split(' ')[0] || '?'}
                    </span>
                  )
                })}
                {dayRequests.length > 3 && (
                  <span className="text-[10px]" style={{ color: '#888' }}>
                    +{dayRequests.length - 3} more
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Selected day detail */}
      {selectedDate && (
        <div className="px-5 py-4" style={{ borderTop: '1px solid #ebebeb' }}>
          <div className="text-xs font-semibold mb-2" style={{ color: '#555' }}>
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
            })}
          </div>
          {selectedDayRequests.length === 0 ? (
            <div className="text-sm" style={{ color: '#888' }}>No one out this day.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedDayRequests.map(r => {
                const c = colorForUser(r.user_id)
                return (
                  <div key={r.id}
                    className="text-xs font-medium rounded-lg px-2.5 py-1"
                    style={{ backgroundColor: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
                    {r.user_name} · {r.type}{r.half_day ? ' (½ day)' : ''}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
