// ── Billing Rules Editor ─────────────────────────────────────────────────────
// Per-customer billing configuration. Embeddable in ShopDetailPanel or Books settings.

import { useState, useEffect } from 'react'
import { ORANGE, fmt, API_BASE, apiFetch } from './shared'

const BORDER = '#f0ece8'
const TERMS_OPTIONS = ['Due on Receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60']
const INVOICE_TYPES = [
  { value: 'dual',           label: 'Dual (Insurance + Shop)' },
  { value: 'single',         label: 'Single Invoice' },
  { value: 'insurance_only', label: 'Insurance Only' },
]
const DISCOUNT_TYPES = [
  { value: 'percentage', label: 'Percentage (%)' },
  { value: 'flat',       label: 'Flat Dollar ($)' },
  { value: 'custom',     label: 'Custom Per-Service' },
]

const DEFAULT_RULES = {
  discount_type: 'percentage',
  discount_value: 0,
  custom_prices: {},
  default_terms: 'Net 14',
  requires_po: false,
  auto_invoice: false,           // default OFF — requires explicit opt-in per shop
  invoice_type: 'dual',
  include_photos: true,
  include_postscan: true,
  include_prescan: false,
  skip_postscan_charge: false,
  // Late fees — default OFF globally, can be opted into per shop
  late_fees_enabled: false,
  late_fee_percent: 1.5,          // % per month
  late_fee_grace_days: 30,        // days past due_date before fee starts accruing
  billing_contact_name: '',
  billing_contact_email: '',
  billing_contact_phone: '',
  billing_notes: '',
  special_instructions: '',
}

// ── Small reusable pieces ────────────────────────────────────────────────────

function SectionHeader({ children }) {
  return (
    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">{children}</h3>
  )
}

function FieldLabel({ children, hint }) {
  return (
    <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
      {children}
      {hint && <span className="normal-case font-normal ml-1" style={{ color: '#bbb' }}>{hint}</span>}
    </label>
  )
}

function Checkbox({ checked, onChange, label, hint }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl border transition-all"
      style={checked
        ? { backgroundColor: '#fff7f5', borderColor: ORANGE, color: '#1a1a1a' }
        : { backgroundColor: '#fff', borderColor: BORDER, color: '#888' }}>
      <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
        style={{ backgroundColor: checked ? ORANGE : '#e0dbd6' }}>
        {checked ? '\u2713' : ''}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium">{label}</span>
        {hint && <p className="text-xs mt-0.5" style={{ color: '#aaa' }}>{hint}</p>}
      </div>
    </button>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function BillingRulesEditor({ shop, onSave, onClose }) {
  const [rules, setRules] = useState({ ...DEFAULT_RULES })
  const [services, setServices] = useState([])
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  // Seed from shop's existing billing_rules
  useEffect(() => {
    if (shop?.billing_rules && typeof shop.billing_rules === 'object') {
      setRules(prev => ({ ...prev, ...shop.billing_rules }))
    } else if (shop?.shop_rate) {
      // Pre-fill from legacy shop_rate field
      setRules(prev => ({
        ...prev,
        discount_type: 'percentage',
        discount_value: parseFloat(shop.shop_rate) || 0,
      }))
    }
  }, [shop])

  // Load services catalog for custom pricing table
  useEffect(() => {
    apiFetch(`${API_BASE}/api/services`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setServices(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  function set(field, value) {
    setRules(prev => ({ ...prev, [field]: value }))
    setDirty(true)
    setSuccess(false)
  }

  function setCustomPrice(serviceId, price) {
    const cp = { ...rules.custom_prices }
    if (price === '' || price === null || price === undefined) {
      delete cp[serviceId]
    } else {
      cp[serviceId] = Number(price)
    }
    set('custom_prices', cp)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const resp = await apiFetch(`${API_BASE}/api/shops/${shop.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billing_rules: rules }),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save billing rules')
      }
      const updated = await resp.json()
      setDirty(false)
      setSuccess(true)
      if (onSave) onSave(updated)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">

      {/* ── Section 1: Pricing Rules ────────────────────────────────────────── */}
      <div className="p-4 rounded-xl" style={{ backgroundColor: '#fafafa', border: `1px solid ${BORDER}` }}>
        <SectionHeader>Pricing Rules</SectionHeader>

        <div className="space-y-3">
          <div>
            <FieldLabel>Discount Type</FieldLabel>
            <select className="w-full border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none"
              style={{ borderColor: BORDER }}
              value={rules.discount_type}
              onChange={e => set('discount_type', e.target.value)}>
              {DISCOUNT_TYPES.map(dt => (
                <option key={dt.value} value={dt.value}>{dt.label}</option>
              ))}
            </select>
          </div>

          {rules.discount_type !== 'custom' && (
            <div>
              <FieldLabel>{rules.discount_type === 'percentage' ? 'Discount %' : 'Flat Discount ($)'}</FieldLabel>
              <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: BORDER }}
                type="number" min="0" step={rules.discount_type === 'percentage' ? '1' : '0.01'}
                value={rules.discount_value || ''}
                onChange={e => set('discount_value', e.target.value ? Number(e.target.value) : 0)}
                placeholder={rules.discount_type === 'percentage' ? '20' : '25.00'} />
            </div>
          )}

          {rules.discount_type === 'custom' && services.length > 0 && (
            <div>
              <FieldLabel hint="override catalog price per service">Custom Prices</FieldLabel>
              <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: '#f5f3f0' }}>
                      <th className="text-left text-xs font-semibold text-gray-500 px-3 py-2">Service</th>
                      <th className="text-right text-xs font-semibold text-gray-500 px-3 py-2 w-24">Catalog</th>
                      <th className="text-right text-xs font-semibold text-gray-500 px-3 py-2 w-28">Custom</th>
                    </tr>
                  </thead>
                  <tbody>
                    {services.map(svc => {
                      const customVal = rules.custom_prices[svc.id]
                      const hasCustom = customVal !== undefined && customVal !== null
                      return (
                        <tr key={svc.id} className="border-t" style={{ borderColor: BORDER }}>
                          <td className="px-3 py-2 text-gray-700">{svc.name}</td>
                          <td className="px-3 py-2 text-right text-gray-400">{fmt(svc.unit_price)}</td>
                          <td className="px-3 py-2">
                            <input
                              className="w-full border rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none"
                              style={{ borderColor: hasCustom ? ORANGE : BORDER, backgroundColor: hasCustom ? '#fff7f5' : '#fff' }}
                              type="number" min="0" step="0.01"
                              value={hasCustom ? customVal : ''}
                              onChange={e => setCustomPrice(svc.id, e.target.value === '' ? '' : e.target.value)}
                              placeholder={fmt(svc.unit_price)} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {services.length === 0 && (
                <p className="text-xs text-gray-400 mt-2">No services in catalog. Add services in Books &gt; Services first.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Section 2: Invoice Preferences ──────────────────────────────────── */}
      <div className="p-4 rounded-xl" style={{ backgroundColor: '#fafafa', border: `1px solid ${BORDER}` }}>
        <SectionHeader>Invoice Preferences</SectionHeader>

        <div className="space-y-3">
          <div>
            <FieldLabel>Default Payment Terms</FieldLabel>
            <select className="w-full border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none"
              style={{ borderColor: BORDER }}
              value={rules.default_terms}
              onChange={e => set('default_terms', e.target.value)}>
              {TERMS_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <FieldLabel>Invoice Type</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {INVOICE_TYPES.map(it => (
                <button key={it.value} type="button"
                  onClick={() => set('invoice_type', it.value)}
                  className="text-xs font-semibold px-3 py-2 rounded-xl border transition-all"
                  style={rules.invoice_type === it.value
                    ? { backgroundColor: '#fff4f0', color: ORANGE, borderColor: ORANGE }
                    : { backgroundColor: '#fff', color: '#888', borderColor: BORDER }}>
                  {rules.invoice_type === it.value ? '\u2713 ' : ''}{it.label}
                </button>
              ))}
            </div>
          </div>

          <Checkbox
            checked={rules.requires_po}
            onChange={v => set('requires_po', v)}
            label="Require PO Number"
            hint="PO must be entered before invoicing" />

          <Checkbox
            checked={rules.auto_invoice}
            onChange={v => set('auto_invoice', v)}
            label="Auto-Invoice on Job Complete"
            hint="Automatically create invoice when job is marked done (default OFF)" />

          <Checkbox
            checked={rules.late_fees_enabled}
            onChange={v => set('late_fees_enabled', v)}
            label="Charge Late Fees on Overdue Invoices"
            hint="Applies monthly late fee after grace period (default OFF)" />

          {rules.late_fees_enabled && (
            <div className="grid grid-cols-2 gap-3 ml-2 pl-3 border-l-2" style={{ borderColor: ORANGE }}>
              <div>
                <FieldLabel hint="% per month">Late Fee Rate</FieldLabel>
                <div className="flex items-center gap-1">
                  <input type="number" step="0.1" min="0" max="20"
                    value={rules.late_fee_percent || 1.5}
                    onChange={e => set('late_fee_percent', Number(e.target.value))}
                    className="w-full border rounded-lg px-3 py-2 text-sm text-right"
                    style={{ borderColor: '#e5e7eb' }} />
                  <span className="text-sm text-gray-500">%/mo</span>
                </div>
              </div>
              <div>
                <FieldLabel hint="days past due">Grace Period</FieldLabel>
                <div className="flex items-center gap-1">
                  <input type="number" step="1" min="0" max="180"
                    value={rules.late_fee_grace_days ?? 30}
                    onChange={e => set('late_fee_grace_days', Number(e.target.value))}
                    className="w-full border rounded-lg px-3 py-2 text-sm text-right"
                    style={{ borderColor: '#e5e7eb' }} />
                  <span className="text-sm text-gray-500">days</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Section 3: Documentation ────────────────────────────────────────── */}
      <div className="p-4 rounded-xl" style={{ backgroundColor: '#fafafa', border: `1px solid ${BORDER}` }}>
        <SectionHeader>Documentation</SectionHeader>

        <div className="space-y-2">
          <Checkbox
            checked={rules.include_photos}
            onChange={v => set('include_photos', v)}
            label="Include Job Photos" />

          <Checkbox
            checked={rules.include_postscan}
            onChange={v => set('include_postscan', v)}
            label="Include Post-Scan PDF" />

          <Checkbox
            checked={rules.include_prescan}
            onChange={v => set('include_prescan', v)}
            label="Include Pre-Scan PDF" />

          <Checkbox
            checked={rules.skip_postscan_charge}
            onChange={v => set('skip_postscan_charge', v)}
            label="Skip Post-Scan Charge"
            hint="Do not add post-scan line item to invoice" />
        </div>
      </div>

      {/* ── Section 4: Billing Contact ──────────────────────────────────────── */}
      <div className="p-4 rounded-xl" style={{ backgroundColor: '#fafafa', border: `1px solid ${BORDER}` }}>
        <SectionHeader>Billing Contact</SectionHeader>
        <p className="text-xs text-gray-400 mb-3">
          If blank, falls back to shop's primary contact.
        </p>

        <div className="space-y-3">
          <div>
            <FieldLabel>Name</FieldLabel>
            <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
              style={{ borderColor: BORDER }}
              value={rules.billing_contact_name}
              onChange={e => set('billing_contact_name', e.target.value)}
              placeholder={shop?.people?.[0]?.name || shop?.contact_name || 'Billing contact name'} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Email</FieldLabel>
              <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: BORDER }}
                type="email"
                value={rules.billing_contact_email}
                onChange={e => set('billing_contact_email', e.target.value)}
                placeholder={shop?.email || 'billing@shop.com'} />
            </div>
            <div>
              <FieldLabel>Phone</FieldLabel>
              <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: BORDER }}
                type="tel"
                value={rules.billing_contact_phone}
                onChange={e => set('billing_contact_phone', e.target.value)}
                placeholder={shop?.phone || '(555) 555-5555'} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 5: Notes ────────────────────────────────────────────────── */}
      <div className="p-4 rounded-xl" style={{ backgroundColor: '#fafafa', border: `1px solid ${BORDER}` }}>
        <SectionHeader>Notes</SectionHeader>

        <div className="space-y-3">
          <div>
            <FieldLabel>Billing Notes</FieldLabel>
            <textarea className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none resize-none"
              style={{ borderColor: BORDER }}
              rows={3}
              value={rules.billing_notes}
              onChange={e => set('billing_notes', e.target.value)}
              placeholder="Internal notes about billing this customer..." />
          </div>
          <div>
            <FieldLabel hint="shown to technicians on job cards">Special Instructions</FieldLabel>
            <textarea className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none resize-none"
              style={{ borderColor: BORDER }}
              rows={3}
              value={rules.special_instructions}
              onChange={e => set('special_instructions', e.target.value)}
              placeholder="Require photos of VIN plate, always include post-scan..." />
          </div>
        </div>
      </div>

      {/* ── Save bar ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex-1">
          {error && <p className="text-xs text-red-500">{error}</p>}
          {success && <p className="text-xs font-medium" style={{ color: '#15803d' }}>Billing rules saved.</p>}
        </div>
        <div className="flex gap-2">
          {onClose && (
            <button type="button" onClick={onClose}
              className="text-sm px-4 py-2.5 rounded-xl font-medium"
              style={{ color: '#888', backgroundColor: '#f5f3f0' }}>
              Cancel
            </button>
          )}
          <button type="button" onClick={handleSave} disabled={saving || !dirty}
            className="text-sm px-5 py-2.5 rounded-xl font-semibold text-white transition-opacity"
            style={{ backgroundColor: ORANGE, opacity: saving || !dirty ? 0.4 : 1 }}>
            {saving ? 'Saving...' : 'Save Billing Rules'}
          </button>
        </div>
      </div>
    </div>
  )
}
