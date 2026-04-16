import { useState, useEffect } from 'react'
import Navbar from './Navbar'
import { API_BASE, apiFetch, ORANGE } from './books/shared'

const COLOR_PRESETS = [
  { name: 'Absolute Orange', primary: '#CD4419', secondary: '#1a1a1a', accent: '#2563eb' },
  { name: 'Ocean Blue',      primary: '#2563eb', secondary: '#1a1a1a', accent: '#0891b2' },
  { name: 'Forest Green',    primary: '#16a34a', secondary: '#1a1a1a', accent: '#ca8a04' },
  { name: 'Royal Purple',    primary: '#7c3aed', secondary: '#1a1a1a', accent: '#db2777' },
  { name: 'Charcoal',        primary: '#1a1a1a', secondary: '#6b7280', accent: '#CD4419' },
]

const TERMS_OPTIONS = ['Due on Receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60']
const TIMEZONES = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago',
  'America/New_York', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
]

export default function BrandingScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    apiFetch(`${API_BASE}/api/branding`)
      .then(r => r.json())
      .then(data => { setForm(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const r = await apiFetch(`${API_BASE}/api/branding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  function applyPreset(p) {
    setForm(f => ({ ...f, primary_color: p.primary, secondary_color: p.secondary, accent_color: p.accent }))
  }

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  const isAdmin = user?.role !== 'technician'

  if (!isAdmin) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
        <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
        <div className="py-16 text-center text-gray-400 text-sm">Admin access required</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Branding & Configuration</h1>
          <p className="text-sm text-gray-500 mt-0.5">Customize your company identity across the app, invoices, and emails</p>
        </div>

        {loading || !form ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : (
          <div className="space-y-6">
            {/* Company info */}
            <Section title="Company Information" description="Displayed on invoices, emails, and PDFs">
              <Field label="Company Name">
                <input value={form.company_name} onChange={e => update('company_name', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              </Field>
              <Field label="Tagline">
                <input value={form.tagline} onChange={e => update('tagline', e.target.value)}
                  placeholder="e.g. Mobile ADAS Calibration Services"
                  className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Phone">
                  <input value={form.phone} onChange={e => update('phone', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
                </Field>
                <Field label="Email">
                  <input value={form.email} onChange={e => update('email', e.target.value)}
                    type="email"
                    className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
                </Field>
              </div>
              <Field label="Website">
                <input value={form.website} onChange={e => update('website', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              </Field>
              <Field label="Business Address">
                <textarea value={form.address} onChange={e => update('address', e.target.value)}
                  rows="2" className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              </Field>
            </Section>

            {/* Colors */}
            <Section title="Brand Colors" description="Used across UI, invoices, and emails">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-2">Quick Presets</label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
                  {COLOR_PRESETS.map(p => (
                    <button key={p.name} onClick={() => applyPreset(p)}
                      className="rounded-lg p-3 text-xs font-medium border transition-shadow hover:shadow-md"
                      style={{ borderColor: '#e5e7eb' }}>
                      <div className="flex gap-1 mb-2">
                        <div className="w-5 h-5 rounded" style={{ backgroundColor: p.primary }} />
                        <div className="w-5 h-5 rounded" style={{ backgroundColor: p.secondary }} />
                        <div className="w-5 h-5 rounded" style={{ backgroundColor: p.accent }} />
                      </div>
                      <span className="text-gray-600">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <ColorPicker label="Primary" value={form.primary_color}
                  onChange={v => update('primary_color', v)} />
                <ColorPicker label="Secondary" value={form.secondary_color}
                  onChange={v => update('secondary_color', v)} />
                <ColorPicker label="Accent" value={form.accent_color}
                  onChange={v => update('accent_color', v)} />
              </div>
              {/* Preview */}
              <div className="rounded-xl p-4" style={{ backgroundColor: '#fafafa', border: '1px solid #f0ece8' }}>
                <p className="text-xs text-gray-500 mb-3">Preview</p>
                <div className="flex items-center gap-2">
                  <button className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                    style={{ backgroundColor: form.primary_color }}>
                    Primary Button
                  </button>
                  <button className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                    style={{ backgroundColor: form.accent_color }}>
                    Accent
                  </button>
                  <span className="text-sm font-semibold" style={{ color: form.secondary_color }}>
                    {form.company_name || 'Company Name'}
                  </span>
                </div>
              </div>
            </Section>

            {/* Invoice settings */}
            <Section title="Invoice Defaults" description="Default settings for new invoices">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Invoice Number Prefix">
                  <input value={form.invoice_prefix} onChange={e => update('invoice_prefix', e.target.value)}
                    placeholder="INV"
                    className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
                </Field>
                <Field label="Default Terms">
                  <select value={form.default_terms || 'Net 30'}
                    onChange={e => update('default_terms', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}>
                    {TERMS_OPTIONS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Invoice Footer Text">
                <input value={form.invoice_footer} onChange={e => update('invoice_footer', e.target.value)}
                  placeholder="Thank you for your business!"
                  className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              </Field>
            </Section>

            {/* Communication */}
            <Section title="Communication" description="Email signature and timezone">
              <Field label="Email Signature">
                <textarea value={form.email_signature} onChange={e => update('email_signature', e.target.value)}
                  rows="4" placeholder="e.g. Best regards,&#10;The Absolute ADAS Team"
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                  style={{ borderColor: '#e5e7eb' }} />
              </Field>
              <Field label="Timezone">
                <select value={form.timezone}
                  onChange={e => update('timezone', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }}>
                  {TIMEZONES.map(t => <option key={t}>{t}</option>)}
                </select>
              </Field>
            </Section>

            {/* Logo URL */}
            <Section title="Logo" description="Optional logo URL for invoice headers">
              <Field label="Logo URL">
                <input value={form.logo_url} onChange={e => update('logo_url', e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} />
              </Field>
              {form.logo_url && (
                <img src={form.logo_url} alt="Logo preview"
                  className="max-h-20 rounded border" style={{ borderColor: '#e5e7eb' }}
                  onError={e => { e.target.style.display = 'none' }} />
              )}
            </Section>

            {/* Save */}
            <div className="sticky bottom-0 bg-white border-t pt-4 flex items-center justify-between"
              style={{ borderColor: '#f0ece8' }}>
              {saved && (
                <span className="text-sm font-semibold" style={{ color: '#16a34a' }}>
                  ✓ Saved — changes take effect on next page load
                </span>
              )}
              <button onClick={save} disabled={saving}
                className="ml-auto px-6 py-2.5 rounded-lg text-sm font-semibold text-white"
                style={{ backgroundColor: form.primary_color || ORANGE, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Save Branding'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, description, children }) {
  return (
    <div className="rounded-xl border shadow-sm p-5" style={{ borderColor: '#f0ece8' }}>
      <div className="mb-4">
        <h2 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>{title}</h2>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
      <div className="space-y-3">{children}</div>
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

function ColorPicker({ label, value, onChange }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-600 block mb-1">{label}</label>
      <div className="flex gap-2 items-center">
        <input type="color" value={value || '#000000'} onChange={e => onChange(e.target.value)}
          className="w-10 h-10 rounded cursor-pointer border" style={{ borderColor: '#e5e7eb' }} />
        <input value={value || ''} onChange={e => onChange(e.target.value)}
          className="flex-1 border rounded-lg px-2 py-1 text-sm font-mono"
          style={{ borderColor: '#e5e7eb' }} />
      </div>
    </div>
  )
}
