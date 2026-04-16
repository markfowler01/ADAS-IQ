import { useState, useEffect, useMemo } from 'react'
import Navbar from './Navbar'
import PTORequestModal from './pto/PTORequestModal'
import PTOCalendar from './pto/PTOCalendar'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'

const TYPE_LABELS = {
  vacation: 'Vacation', sick: 'Sick', personal: 'Personal',
  unpaid: 'Unpaid', bereavement: 'Bereavement', jury_duty: 'Jury Duty',
}

const STATUS_STYLES = {
  pending:   { bg: '#fef3c7', color: '#92400e', border: '#fde68a', label: 'Pending' },
  approved:  { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0', label: 'Approved' },
  denied:    { bg: '#fee2e2', color: '#b91c1c', border: '#fecaca', label: 'Denied' },
  cancelled: { bg: '#e5e7eb', color: '#6b7280', border: '#d1d5db', label: 'Cancelled' },
}

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.pending
  return (
    <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {s.label}
    </span>
  )
}

function fmtDate(d) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtRange(s, e) {
  if (!s) return ''
  if (!e || s === e) return fmtDate(s)
  return `${fmtDate(s)} — ${fmtDate(e)}`
}

export default function PTOScreen({ user, onLogout, currentScreen, onNavigate }) {
  const isAdmin = user?.role !== 'technician'
  const [tab, setTab] = useState('mine')
  const [requests, setRequests] = useState([])
  const [calendarRequests, setCalendarRequests] = useState([])
  const [balance, setBalance] = useState(null)
  const [allBalances, setAllBalances] = useState({})
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingRequest, setEditingRequest] = useState(null)
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [error, setError] = useState('')
  const [denyingId, setDenyingId] = useState(null)
  const [denyReason, setDenyReason] = useState('')
  const [editBalanceUser, setEditBalanceUser] = useState(null)
  const [editBalanceForm, setEditBalanceForm] = useState({})

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      // Fetch own or all requests (role-filtered on the server)
      const [reqRes, balRes, calRes] = await Promise.all([
        apiFetch(`${API_BASE}/api/pto/requests`),
        apiFetch(`${API_BASE}/api/pto/balance`),
        apiFetch(`${API_BASE}/api/pto/calendar`),
      ])
      const reqData = await reqRes.json().catch(() => ({}))
      const balData = await balRes.json().catch(() => ({}))
      const calData = await calRes.json().catch(() => ({}))
      if (reqData.ok) setRequests(reqData.requests || [])
      if (balData.ok) setBalance(balData.balance || null)
      if (calData.ok) setCalendarRequests(calData.requests || [])

      if (isAdmin) {
        const balsRes = await apiFetch(`${API_BASE}/api/pto/balances`)
        const balsData = await balsRes.json().catch(() => ({}))
        if (balsData.ok) setAllBalances(balsData.balances || {})
      }
    } catch (e) {
      setError(e.message || 'Failed to load PTO data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  async function approveRequest(id) {
    try {
      const res = await apiFetch(`${API_BASE}/api/pto/requests/${id}/approve`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to approve')
      await loadAll()
    } catch (e) { alert(e.message) }
  }

  async function denyRequest(id) {
    if (!denyReason.trim()) { alert('Please provide a denial reason.'); return }
    try {
      const res = await apiFetch(`${API_BASE}/api/pto/requests/${id}/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: denyReason.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to deny')
      setDenyingId(null)
      setDenyReason('')
      await loadAll()
    } catch (e) { alert(e.message) }
  }

  async function cancelRequest(id) {
    if (!confirm('Cancel this request?')) return
    try {
      const res = await apiFetch(`${API_BASE}/api/pto/requests/${id}/cancel`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to cancel')
      await loadAll()
    } catch (e) { alert(e.message) }
  }

  async function saveBalance(userId) {
    try {
      const body = {}
      for (const k of ['balance_vacation', 'balance_sick', 'balance_personal',
                       'accrual_rate', 'carryover_max', 'year_start_balance', 'taken_ytd']) {
        if (editBalanceForm[k] !== undefined && editBalanceForm[k] !== '') body[k] = Number(editBalanceForm[k])
      }
      const res = await apiFetch(`${API_BASE}/api/pto/balances/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save')
      setEditBalanceUser(null)
      setEditBalanceForm({})
      await loadAll()
    } catch (e) { alert(e.message) }
  }

  const myRequests = useMemo(() => {
    const meId = user?.email || user?.id || user?.name
    return requests.filter(r => r.user_id === meId)
  }, [requests, user])

  const pendingRequests = useMemo(
    () => requests.filter(r => r.status === 'pending'),
    [requests]
  )

  const TABS = [
    { id: 'mine',      label: 'My Requests' },
    { id: 'calendar',  label: 'Team Calendar' },
    ...(isAdmin ? [
      { id: 'approvals', label: `Approvals${pendingRequests.length ? ` (${pendingRequests.length})` : ''}` },
      { id: 'balances',  label: 'Balances' },
    ] : []),
  ]

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#fafafa' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate}/>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Time Off</h1>
            <p className="text-sm mt-0.5" style={{ color: '#888' }}>
              Request, approve, and track paid time off.
            </p>
          </div>
          <button onClick={() => { setEditingRequest(null); setShowModal(true) }}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: ORANGE }}>
            + Request Time Off
          </button>
        </div>

        {/* Balance summary */}
        {balance && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <BalanceCard title="Vacation" value={balance.balance_vacation}
              max={balance.year_start_balance || 80} color={ORANGE}/>
            <BalanceCard title="Sick" value={balance.balance_sick} max={40} color="#1e40af"/>
            <BalanceCard title="Personal" value={balance.balance_personal} max={16} color="#15803d"/>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4"
          style={{ borderBottom: '1px solid #ebebeb' }}>
          {TABS.map(t => {
            const active = tab === t.id
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="px-4 py-2.5 text-sm font-medium transition-colors"
                style={{
                  color: active ? ORANGE : '#555',
                  borderBottom: active ? `2px solid ${ORANGE}` : '2px solid transparent',
                  marginBottom: -1,
                }}>
                {t.label}
              </button>
            )
          })}
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg text-sm"
            style={{ backgroundColor: '#fee2e2', color: '#b91c1c' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-10 text-sm" style={{ color: '#888' }}>Loading…</div>
        ) : (
          <>
            {tab === 'mine' && (
              <MyRequests requests={myRequests}
                onEdit={(r) => { setEditingRequest(r); setShowModal(true) }}
                onCancel={cancelRequest}/>
            )}
            {tab === 'calendar' && (
              <PTOCalendar requests={calendarRequests} currentMonth={month} onMonthChange={setMonth}/>
            )}
            {tab === 'approvals' && isAdmin && (
              <Approvals
                requests={pendingRequests}
                onApprove={approveRequest}
                denyingId={denyingId}
                denyReason={denyReason}
                setDenyingId={setDenyingId}
                setDenyReason={setDenyReason}
                onDeny={denyRequest}/>
            )}
            {tab === 'balances' && isAdmin && (
              <Balances
                balances={allBalances}
                editingUser={editBalanceUser}
                editForm={editBalanceForm}
                onStartEdit={(uid) => {
                  setEditBalanceUser(uid)
                  setEditBalanceForm({ ...(allBalances[uid] || {}) })
                }}
                onCancelEdit={() => { setEditBalanceUser(null); setEditBalanceForm({}) }}
                onChange={(k, v) => setEditBalanceForm(f => ({ ...f, [k]: v }))}
                onSave={saveBalance}/>
            )}
          </>
        )}
      </div>

      {showModal && (
        <PTORequestModal
          existingRequest={editingRequest}
          onClose={() => { setShowModal(false); setEditingRequest(null) }}
          onSaved={() => loadAll()}/>
      )}
    </div>
  )
}

// ── Balance summary card ───────────────────────────────────────────────────
function BalanceCard({ title, value, max, color }) {
  const v = Number(value || 0)
  const m = Math.max(1, Number(max || 0))
  const pct = Math.min(100, Math.max(0, (v / m) * 100))
  return (
    <div className="bg-white rounded-2xl p-4" style={{ border: '1px solid #ebebeb' }}>
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#888' }}>{title}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold" style={{ color: '#1a1a1a' }}>{v.toFixed(1)}</span>
        <span className="text-sm" style={{ color: '#888' }}>hours</span>
      </div>
      <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#f5f3f0' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }}/>
      </div>
      <div className="mt-1.5 text-[11px]" style={{ color: '#aaa' }}>{v.toFixed(1)} of {m} hrs remaining</div>
    </div>
  )
}

// ── Request row ────────────────────────────────────────────────────────────
function RequestCard({ r, showUser, actions }) {
  return (
    <div className="bg-white rounded-2xl p-4" style={{ border: '1px solid #ebebeb' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>
              {TYPE_LABELS[r.type] || r.type}
            </span>
            <StatusBadge status={r.status}/>
            {r.half_day && (
              <span className="text-[11px] px-1.5 py-0.5 rounded"
                style={{ backgroundColor: '#f5f3f0', color: '#555' }}>½ day</span>
            )}
          </div>
          {showUser && (
            <div className="text-xs font-medium mt-0.5" style={{ color: ORANGE }}>{r.user_name}</div>
          )}
          <div className="text-sm mt-1" style={{ color: '#555' }}>
            {fmtRange(r.start_date, r.end_date)} · {r.hours_requested}h
          </div>
          {r.reason && (
            <div className="text-xs mt-1.5" style={{ color: '#888' }}>{r.reason}</div>
          )}
          {r.denied_reason && (
            <div className="text-xs mt-1.5 px-2 py-1 rounded"
              style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>
              Denied: {r.denied_reason}
            </div>
          )}
          <div className="text-[11px] mt-2" style={{ color: '#bbb' }}>
            Submitted {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
        </div>
        {actions}
      </div>
    </div>
  )
}

// ── My Requests tab ──────────────────────────────────────────────────────
function MyRequests({ requests, onEdit, onCancel }) {
  if (!requests.length) {
    return (
      <div className="bg-white rounded-2xl p-10 text-center"
        style={{ border: '1px solid #ebebeb' }}>
        <p className="text-sm" style={{ color: '#888' }}>
          You haven't submitted any time off requests yet.
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {requests.map(r => (
        <RequestCard key={r.id} r={r}
          actions={
            r.status === 'pending' && (
              <div className="flex gap-1.5 flex-shrink-0">
                <button onClick={() => onEdit(r)}
                  className="text-xs px-2.5 py-1.5 rounded-lg font-medium"
                  style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Edit</button>
                <button onClick={() => onCancel(r.id)}
                  className="text-xs px-2.5 py-1.5 rounded-lg font-medium"
                  style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>Cancel</button>
              </div>
            )
          }/>
      ))}
    </div>
  )
}

// ── Approvals tab ────────────────────────────────────────────────────────
function Approvals({ requests, onApprove, denyingId, denyReason, setDenyingId, setDenyReason, onDeny }) {
  if (!requests.length) {
    return (
      <div className="bg-white rounded-2xl p-10 text-center"
        style={{ border: '1px solid #ebebeb' }}>
        <p className="text-sm" style={{ color: '#888' }}>No pending requests. All caught up!</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {requests.map(r => (
        <div key={r.id}>
          <RequestCard r={r} showUser
            actions={
              denyingId !== r.id && (
                <div className="flex gap-1.5 flex-shrink-0">
                  <button onClick={() => onApprove(r.id)}
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
                    style={{ backgroundColor: '#15803d' }}>Approve</button>
                  <button onClick={() => { setDenyingId(r.id); setDenyReason('') }}
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                    style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>Deny</button>
                </div>
              )
            }/>
          {denyingId === r.id && (
            <div className="mt-2 bg-white rounded-2xl p-3"
              style={{ border: `1px solid ${ORANGE}`, borderTop: 'none', marginTop: -8 }}>
              <label className="block text-xs font-semibold mb-1" style={{ color: '#555' }}>Reason for denial</label>
              <textarea value={denyReason} onChange={e => setDenyReason(e.target.value)}
                rows={2} placeholder="Explain why this request is denied…"
                className="w-full px-2.5 py-1.5 rounded-lg text-sm resize-none"
                style={{ border: '1px solid #ebebeb' }}/>
              <div className="flex gap-1.5 mt-2 justify-end">
                <button onClick={() => { setDenyingId(null); setDenyReason('') }}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium"
                  style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
                <button onClick={() => onDeny(r.id)}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
                  style={{ backgroundColor: '#b91c1c' }}>Confirm deny</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Balances tab ─────────────────────────────────────────────────────────
function Balances({ balances, editingUser, editForm, onStartEdit, onCancelEdit, onChange, onSave }) {
  const entries = Object.entries(balances || {})
  if (!entries.length) {
    return (
      <div className="bg-white rounded-2xl p-10 text-center"
        style={{ border: '1px solid #ebebeb' }}>
        <p className="text-sm" style={{ color: '#888' }}>
          No balances set up yet. Balances are created automatically when a user first checks or requests PTO.
        </p>
      </div>
    )
  }
  return (
    <div className="bg-white rounded-2xl overflow-x-auto" style={{ border: '1px solid #ebebeb' }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid #ebebeb' }}>
            <th className="text-left px-4 py-3 font-semibold" style={{ color: '#555' }}>User</th>
            <th className="text-right px-3 py-3 font-semibold" style={{ color: '#555' }}>Vacation</th>
            <th className="text-right px-3 py-3 font-semibold" style={{ color: '#555' }}>Sick</th>
            <th className="text-right px-3 py-3 font-semibold" style={{ color: '#555' }}>Personal</th>
            <th className="text-right px-3 py-3 font-semibold" style={{ color: '#555' }}>Taken YTD</th>
            <th className="text-right px-3 py-3 font-semibold" style={{ color: '#555' }}>Accrual/PP</th>
            <th className="px-3 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([uid, b]) => {
            const editing = editingUser === uid
            return (
              <tr key={uid} style={{ borderBottom: '1px solid #f5f3f0' }}>
                <td className="px-4 py-2.5" style={{ color: '#1a1a1a' }}>{uid}</td>
                {['balance_vacation', 'balance_sick', 'balance_personal', 'taken_ytd', 'accrual_rate'].map(k => (
                  <td key={k} className="px-3 py-2.5 text-right" style={{ color: '#555' }}>
                    {editing ? (
                      <input type="number" step="0.1"
                        value={editForm[k] ?? ''}
                        onChange={e => onChange(k, e.target.value)}
                        className="w-20 px-2 py-1 rounded text-right text-sm"
                        style={{ border: '1px solid #ebebeb' }}/>
                    ) : (
                      Number(b[k] || 0).toFixed(k === 'accrual_rate' ? 2 : 1)
                    )}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-right">
                  {editing ? (
                    <div className="flex gap-1 justify-end">
                      <button onClick={onCancelEdit}
                        className="text-xs px-2 py-1 rounded font-medium"
                        style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
                      <button onClick={() => onSave(uid)}
                        className="text-xs px-2 py-1 rounded font-semibold text-white"
                        style={{ backgroundColor: ORANGE }}>Save</button>
                    </div>
                  ) : (
                    <button onClick={() => onStartEdit(uid)}
                      className="text-xs px-2 py-1 rounded font-medium"
                      style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Edit</button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
