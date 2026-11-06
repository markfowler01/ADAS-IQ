import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { BRAND } from '../../lib/brandTokens.js'

const ORANGE = BRAND.orange

export default function PortalUsersTab({ shopId, shopName }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('estimator')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)

  async function load() {
    if (!shopId) return
    setLoading(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/shops/${shopId}/portal-users`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not load portal users')
      setUsers(d.users || [])
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [shopId])
  useEffect(() => {
    if (!loading && users.length === 0) setRole('owner')
  }, [loading, users.length])

  async function add(e) {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true); setErr(''); setCreated(null)
    try {
      const r = await apiFetch(`${API_BASE}/api/shops/${shopId}/portal-users`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), username: username.trim(), role }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not create login')
      setCreated(d)
      setName(''); setEmail(''); setUsername('')
      await load()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function act(uid, body) {
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API_BASE}/api/shops/${shopId}/portal-users/${uid}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Update failed')
      if (d.password) setCreated(d)
      await load()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function remove(uid) {
    if (!window.confirm('Turn off this login? They will not be able to sign in.')) return
    setBusy(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/shops/${shopId}/portal-users/${uid}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not remove')
      await load()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#888' }}>Shop portal logins</p>
        <p className="text-sm mt-1" style={{ color: '#555' }}>
          People at {shopName || 'this shop'} sign in at the customer portal with a username and password we create. They only see this shop. Everyone at the shop sees The Absolute Advantage.
        </p>
      </div>

      {created?.password && (
        <div className="rounded-xl p-3" style={{ backgroundColor: '#fff7f5', border: `1px solid ${ORANGE}` }}>
          <p className="text-xs font-bold" style={{ color: ORANGE }}>Give them this once — we cannot show it again</p>
          <p className="text-sm mt-1" style={{ color: '#1a1a1a' }}>
            <b>{created.user?.username}</b>
            <span className="mx-2" style={{ color: '#888' }}>/</span>
            <code className="font-mono font-bold">{created.password}</code>
          </p>
          <p className="text-[11px] mt-1" style={{ color: '#888' }}>They will be asked to change it on first login. Portal: /app/portal</p>
        </div>
      )}

      <form onSubmit={add} className="rounded-xl p-3 space-y-2" style={{ backgroundColor: '#fafafa', border: '1px solid #ebebeb' }}>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} required placeholder="Maria"
              className="w-full border rounded-lg px-2.5 py-2 text-sm bg-white" style={{ borderColor: '#e0dbd6' }} />
          </div>
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="optional"
              className="w-full border rounded-lg px-2.5 py-2 text-sm bg-white" style={{ borderColor: '#e0dbd6' }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">Username</label>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="maria.express"
              className="w-full border rounded-lg px-2.5 py-2 text-sm bg-white font-mono" style={{ borderColor: '#e0dbd6' }} />
          </div>
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">Role</label>
            <select value={role} onChange={e => setRole(e.target.value)}
              className="w-full border rounded-lg px-2.5 py-2 text-sm bg-white" style={{ borderColor: '#e0dbd6' }}>
              <option value="estimator">Estimator</option>
              <option value="owner">Owner</option>
            </select>
          </div>
        </div>
        <button type="submit" disabled={busy || !name.trim()}
          className="w-full rounded-xl py-2 text-sm font-bold text-white"
          style={{ backgroundColor: ORANGE, opacity: busy || !name.trim() ? 0.5 : 1 }}>
          {busy ? 'Creating…' : 'Create login'}
        </button>
      </form>

      {err && <p className="text-xs" style={{ color: '#b91c1c' }}>{err}</p>}
      {loading ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className="space-y-2">
          {users.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No portal logins yet.</p>}
          {users.map(u => (
            <div key={u.id} className="rounded-xl px-3 py-2.5 flex items-center gap-2" style={{ border: '1px solid #ebebeb' }}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: u.active ? '#1a1a1a' : '#999' }}>{u.name || u.username}</p>
                <p className="text-[11px] font-mono" style={{ color: '#888' }}>
                  {u.username} · {u.role === 'owner' ? 'owner' : 'estimator'}{u.active ? '' : ' · off'}
                </p>
              </div>
              <button type="button" disabled={busy}
                onClick={() => act(u.id, { role: u.role === 'owner' ? 'estimator' : 'owner' })}
                className="text-[11px] font-bold rounded-lg px-2 py-1.5" style={{ border: '1px solid #e0dbd6', color: '#555' }}>
                {u.role === 'owner' ? 'Make estimator' : 'Make owner'}
              </button>
              <button type="button" disabled={busy} onClick={() => act(u.id, { reset_password: true })}
                className="text-[11px] font-bold rounded-lg px-2 py-1.5" style={{ border: '1px solid #e0dbd6', color: '#555' }}>Reset</button>
              <button type="button" disabled={busy} onClick={() => act(u.id, { active: !u.active })}
                className="text-[11px] font-bold rounded-lg px-2 py-1.5" style={{ border: '1px solid #e0dbd6', color: '#555' }}>{u.active ? 'Off' : 'On'}</button>
              <button type="button" disabled={busy} onClick={() => remove(u.id)}
                className="text-[11px] font-bold rounded-lg px-2 py-1.5" style={{ color: '#b91c1c' }}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
