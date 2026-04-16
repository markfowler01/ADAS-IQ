import { useState, useEffect } from 'react'
import Navbar from './Navbar'

const ORANGE = '#CD4419'
const API_BASE = '/server/adasiq-api'

function apiFetch(url, opts = {}) {
  const token = sessionStorage.getItem('adasiq_token')
  return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'x-auth-token': token, ...opts.headers } })
}

export default function SettingsScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [settings, setSettings] = useState(null)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    apiFetch(`${API_BASE}/api/settings`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          // Ensure dispatch_contacts exists with defaults
          const s = data.settings || {}
          if (!s.dispatch_contacts || s.dispatch_contacts.length === 0) {
            s.dispatch_contacts = [
              { name: 'Mark', email: 'mf@absoluteadas.com', phone: '' },
              { name: 'Jaden', email: 'jaden@absoluteadas.com', phone: '' },
              { name: 'Kath', email: 'k.belmonte@absoluteadas.com', phone: '', role: 'Invoicing' },
            ]
          }
          setSettings(s)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true); setSaved(false)
    try {
      const res = await apiFetch(`${API_BASE}/api/settings`, {
        method: 'PUT',
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (data.ok) setSaved(true)
    } catch {}
    setSaving(false)
    setTimeout(() => setSaved(false), 3000)
  }

  function updateContact(i, field, value) {
    setSettings(prev => ({
      ...prev,
      dispatch_contacts: prev.dispatch_contacts.map((c, j) => j === i ? { ...c, [field]: value } : c),
    }))
  }

  function addContact() {
    setSettings(prev => ({
      ...prev,
      dispatch_contacts: [...(prev.dispatch_contacts || []), { name: '', email: '', phone: '' }],
    }))
  }

  function removeContact(i) {
    if (!confirm('Remove this contact?')) return
    setSettings(prev => ({
      ...prev,
      dispatch_contacts: prev.dispatch_contacts.filter((_, j) => j !== i),
    }))
  }

  if (loading) return (
    <div style={{ background: 'white', minHeight: '100vh' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div style={{ textAlign: 'center', padding: '4rem', color: '#888' }}>Loading settings...</div>
    </div>
  )

  const contacts = settings?.dispatch_contacts || []

  return (
    <div style={{ background: 'white', minHeight: '100vh' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: '#f5f3f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: '#1a1a1a', margin: 0 }}>Settings</h1>
            <p style={{ fontSize: 13, color: '#888', margin: 0 }}>Manage dispatch contacts and app configuration</p>
          </div>
        </div>

        {/* Dispatch Contacts */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>Dispatch Contacts</div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>Map technician names to their email addresses. When a job is assigned on the board, the tech receives an email notification.</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contacts.map((c, i) => (
              <div key={i} style={{ border: '1px solid #ebebeb', borderRadius: 10, padding: '14px 16px', background: 'white' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr auto', gap: 10, alignItems: 'end' }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>Name</div>
                    <input
                      value={c.name} onChange={e => updateContact(i, 'name', e.target.value)}
                      placeholder="Jaden"
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e0ddd8', fontSize: 13, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>Email</div>
                    <input
                      type="email" value={c.email} onChange={e => updateContact(i, 'email', e.target.value)}
                      placeholder="jaden@absoluteadas.com"
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e0ddd8', fontSize: 13, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>Phone</div>
                    <input
                      type="tel" value={c.phone || ''} onChange={e => updateContact(i, 'phone', e.target.value)}
                      placeholder="(optional)"
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e0ddd8', fontSize: 13, boxSizing: 'border-box' }}
                    />
                  </div>
                  <button onClick={() => removeContact(i)} style={{
                    background: '#fde8e8', border: '1px solid #fca5a5', borderRadius: 7,
                    padding: '7px 10px', cursor: 'pointer', color: '#9b1c1c', fontSize: 14, fontWeight: 600,
                  }}>×</button>
                </div>
              </div>
            ))}
          </div>

          <button onClick={addContact} style={{
            marginTop: 10, background: 'transparent', border: '1px dashed #ccc',
            borderRadius: 10, padding: '10px 16px', width: '100%', cursor: 'pointer',
            fontSize: 13, fontWeight: 500, color: '#888',
          }}>
            + Add contact
          </button>
        </div>

        {/* Save */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={save} disabled={saving} style={{
            background: ORANGE, color: 'white', border: 'none', borderRadius: 8,
            padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {saved && (
            <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 500 }}>Settings saved</span>
          )}
        </div>
      </div>
    </div>
  )
}
