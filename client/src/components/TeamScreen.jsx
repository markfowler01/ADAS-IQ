import { useState, useEffect, useCallback } from 'react'
import Navbar from './Navbar'
import { API_BASE, apiFetch, ORANGE } from './books/shared'

const ROLES = ['owner', 'admin', 'manager', 'technician', 'office', 'contractor']
const ROLE_COLORS = {
  owner:      { bg: '#fef3c7', color: '#b45309', label: 'Owner' },
  admin:      { bg: '#fff7f5', color: '#CD4419', label: 'Admin' },
  manager:    { bg: '#ede9fe', color: '#7c3aed', label: 'Manager' },
  technician: { bg: '#eff6ff', color: '#2563eb', label: 'Technician' },
  office:     { bg: '#f0fdf4', color: '#15803d', label: 'Office' },
  contractor: { bg: '#f5f3f0', color: '#6b7280', label: 'Contractor' },
}

const AVATAR_COLORS = ['#CD4419', '#2563eb', '#16a34a', '#7c3aed', '#b45309', '#0e7490', '#db2777', '#0891b2']

export default function TeamScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [tab, setTab] = useState('members')
  const [members, setMembers] = useState([])
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)  // null=closed, false=new, object=edit
  const [editingAnn, setEditingAnn] = useState(null)

  const isAdmin = user?.role !== 'technician'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [m, a] = await Promise.all([
        apiFetch(`${API_BASE}/api/team/members`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/team/announcements`).then(r => r.json()),
      ])
      setMembers(Array.isArray(m) ? m : [])
      setAnnouncements(Array.isArray(a) ? a : [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function deleteMember(id) {
    if (!confirm('Remove this team member?')) return
    try {
      await apiFetch(`${API_BASE}/api/team/members/${id}`, { method: 'DELETE' })
      load()
    } catch (e) { alert(e.message) }
  }

  async function deleteAnnouncement(id) {
    if (!confirm('Delete this announcement?')) return
    try {
      await apiFetch(`${API_BASE}/api/team/announcements/${id}`, { method: 'DELETE' })
      load()
    } catch (e) { alert(e.message) }
  }

  const tabs = [
    { id: 'members', label: `Team (${members.length})` },
    { id: 'announcements', label: `Announcements (${announcements.length})` },
  ]

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Team</h1>
            <p className="text-sm text-gray-500 mt-0.5">Manage team members and announcements</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => tab === 'members' ? setEditing(false) : setEditingAnn(false)}
              className="text-sm px-4 py-2 rounded-lg font-semibold text-white"
              style={{ backgroundColor: ORANGE }}>
              {tab === 'members' ? '+ Add Member' : '+ New Announcement'}
            </button>
          )}
        </div>

        <div className="flex gap-0 mb-6 border-b" style={{ borderColor: '#ebebeb' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="text-sm px-4 py-2.5 font-medium transition-colors"
              style={{
                color: tab === t.id ? ORANGE : '#666',
                borderBottom: tab === t.id ? `2px solid ${ORANGE}` : '2px solid transparent',
                marginBottom: '-1px',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : tab === 'members' ? (
          <MembersTab members={members} isAdmin={isAdmin}
            onEdit={setEditing} onDelete={deleteMember} currentUserId={user?.email} />
        ) : (
          <AnnouncementsTab announcements={announcements} isAdmin={isAdmin}
            currentUserId={user?.email}
            onEdit={setEditingAnn} onDelete={deleteAnnouncement} onReload={load} />
        )}

        {editing !== null && (
          <MemberFormModal member={editing || null} onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); load() }} />
        )}
        {editingAnn !== null && (
          <AnnouncementFormModal announcement={editingAnn || null}
            onClose={() => setEditingAnn(null)}
            onSaved={() => { setEditingAnn(null); load() }} />
        )}
      </div>
    </div>
  )
}

function Avatar({ name, color }) {
  const initials = (name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
      style={{ backgroundColor: color || ORANGE }}>
      {initials}
    </div>
  )
}

function MembersTab({ members, isAdmin, onEdit, onDelete, currentUserId }) {
  if (members.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-gray-400 text-sm">No team members yet.</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {members.map(m => {
        const role = ROLE_COLORS[m.role] || ROLE_COLORS.technician
        const isMe = m.email === currentUserId || m.user_id === currentUserId
        return (
          <div key={m.id} className="rounded-xl border p-4 shadow-sm bg-white"
            style={{ borderColor: '#f0ece8', opacity: m.active === false ? 0.5 : 1 }}>
            <div className="flex items-start gap-3 mb-3">
              <Avatar name={m.name} color={m.avatar_color} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate" style={{ color: '#1a1a1a' }}>
                  {m.name} {isMe && <span className="text-xs text-gray-400">(you)</span>}
                </p>
                <p className="text-xs text-gray-500 truncate">{m.title || m.email}</p>
                <span className="inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: role.bg, color: role.color }}>
                  {role.label}
                </span>
              </div>
            </div>
            {(m.phone || m.email) && (
              <div className="space-y-1 text-xs text-gray-500 mb-3">
                {m.email && <p>📧 {m.email}</p>}
                {m.phone && <p>📞 {m.phone}</p>}
                {m.region && <p>📍 {m.region}</p>}
              </div>
            )}
            {(isAdmin || isMe) && (
              <div className="flex gap-2 pt-2 border-t" style={{ borderColor: '#f7f4f1' }}>
                <button onClick={() => onEdit(m)}
                  className="text-xs px-2 py-1 rounded-md font-medium"
                  style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
                  Edit
                </button>
                {isAdmin && !isMe && (
                  <button onClick={() => onDelete(m.id)}
                    className="text-xs px-2 py-1 rounded-md font-medium ml-auto"
                    style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AnnouncementsTab({ announcements, isAdmin, currentUserId, onEdit, onDelete, onReload }) {
  async function markRead(id) {
    try {
      await apiFetch(`${API_BASE}/api/team/announcements/${id}/read`, { method: 'POST' })
      onReload()
    } catch { /* ignore */ }
  }

  if (announcements.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-gray-400 text-sm">No announcements yet.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {announcements.map(a => {
        const priorityStyle = a.priority === 'urgent' ? { bg: '#fef2f2', color: '#b91c1c' }
          : a.priority === 'high' ? { bg: '#fff7f5', color: ORANGE }
          : { bg: '#eff6ff', color: '#2563eb' }
        const isRead = (a.reads || []).includes(currentUserId)
        return (
          <div key={a.id} className="rounded-xl border p-5 shadow-sm bg-white"
            style={{ borderColor: a.pinned ? ORANGE : '#f0ece8' }}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                {a.pinned && <span className="text-xs">📌</span>}
                <h3 className="font-semibold" style={{ color: '#1a1a1a' }}>{a.title}</h3>
                {a.priority !== 'normal' && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: priorityStyle.bg, color: priorityStyle.color }}>
                    {a.priority.toUpperCase()}
                  </span>
                )}
                {!isRead && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: '#fff7f5', color: ORANGE }}>
                    NEW
                  </span>
                )}
              </div>
              {isAdmin && (
                <div className="flex gap-1">
                  <button onClick={() => onEdit(a)}
                    className="text-xs px-2 py-1 rounded-md"
                    style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Edit</button>
                  <button onClick={() => onDelete(a.id)}
                    className="text-xs px-2 py-1 rounded-md"
                    style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>×</button>
                </div>
              )}
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{a.body}</p>
            <div className="flex items-center justify-between mt-3 pt-3 border-t"
              style={{ borderColor: '#f7f4f1' }}>
              <span className="text-xs text-gray-400">
                {a.author_name} · {new Date(a.created_at).toLocaleDateString()}
                {a.audience !== 'all' && ` · ${a.audience}`}
              </span>
              {!isRead && (
                <button onClick={() => markRead(a.id)}
                  className="text-xs font-semibold" style={{ color: ORANGE }}>
                  Mark as read
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MemberFormModal({ member, onClose, onSaved }) {
  const [form, setForm] = useState(member || {
    user_id: '', name: '', email: '', phone: '', role: 'technician',
    title: '', department: '', hire_date: '', region: '',
    hourly_rate: 0, active: true,
    avatar_color: AVATAR_COLORS[0],
    emergency_contact: { name: '', phone: '', relationship: '' },
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const url = member
        ? `${API_BASE}/api/team/members/${member.id}`
        : `${API_BASE}/api/team/members`
      const method = member ? 'PUT' : 'POST'
      const r = await apiFetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      onSaved()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b flex items-center justify-between sticky top-0 bg-white"
          style={{ borderColor: '#f0ece8' }}>
          <h2 className="text-lg font-bold">{member ? 'Edit Member' : 'Add Team Member'}</h2>
          <button onClick={onClose} className="text-gray-400">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </Field>
            <Field label="Role">
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}>
                {ROLES.map(r => <option key={r}>{r}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Email (used for login)">
            <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value, user_id: e.target.value }))}
              type="email"
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </Field>
            <Field label="Title">
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Lead Technician"
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Region">
              <input value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
                placeholder="e.g. Dallas"
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </Field>
            <Field label="Hourly Rate ($)">
              <input value={form.hourly_rate} type="number"
                onChange={e => setForm(f => ({ ...f, hourly_rate: Number(e.target.value) }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
            </Field>
          </div>
          <Field label="Hire Date">
            <input value={form.hire_date} type="date"
              onChange={e => setForm(f => ({ ...f, hire_date: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </Field>
          <Field label="Avatar Color">
            <div className="flex gap-2 flex-wrap">
              {AVATAR_COLORS.map(c => (
                <button key={c} onClick={() => setForm(f => ({ ...f, avatar_color: c }))}
                  className="w-8 h-8 rounded-full"
                  style={{ backgroundColor: c, border: form.avatar_color === c ? '3px solid #1a1a1a' : 'none' }} />
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.active}
              onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
            Active (appears in lists)
          </label>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2 sticky bottom-0 bg-white"
          style={{ borderColor: '#f0ece8' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: '#e5e7eb' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: ORANGE, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AnnouncementFormModal({ announcement, onClose, onSaved }) {
  const [form, setForm] = useState(announcement || {
    title: '', body: '', priority: 'normal', audience: 'all',
    pinned: false, expires_at: '',
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const url = announcement
        ? `${API_BASE}/api/team/announcements/${announcement.id}`
        : `${API_BASE}/api/team/announcements`
      const method = announcement ? 'PUT' : 'POST'
      const r = await apiFetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      onSaved()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: '#f0ece8' }}>
          <h2 className="text-lg font-bold">{announcement ? 'Edit Announcement' : 'New Announcement'}</h2>
          <button onClick={onClose} className="text-gray-400">×</button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Title">
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              autoFocus
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </Field>
          <Field label="Message">
            <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              rows="5"
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <select value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </Field>
            <Field label="Audience">
              <select value={form.audience}
                onChange={e => setForm(f => ({ ...f, audience: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}>
                <option value="all">Everyone</option>
                <option value="technicians">Technicians</option>
                <option value="admins">Admins</option>
                <option value="office">Office</option>
              </select>
            </Field>
          </div>
          <Field label="Expires (optional)">
            <input type="date" value={form.expires_at?.slice(0, 10) || ''}
              onChange={e => setForm(f => ({ ...f, expires_at: e.target.value ? e.target.value + 'T23:59:59Z' : '' }))}
              className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.pinned}
              onChange={e => setForm(f => ({ ...f, pinned: e.target.checked }))} />
            📌 Pin to top
          </label>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: '#f0ece8' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: '#e5e7eb' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving || !form.title.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: ORANGE, opacity: (saving || !form.title.trim()) ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-600 block mb-1">{label}</label>
      {children}
    </div>
  )
}
