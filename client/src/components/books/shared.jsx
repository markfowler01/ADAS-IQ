// ── Books Shared Utilities ───────────────────────────────────────────────────
// Shared constants, helpers, and small components used across all Books tabs.

import { useState, useEffect } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'

export { API_BASE, apiFetch }

export const ORANGE = '#CD4419'

// ── Branding hook ───────────────────────────────────────────────────────────

const BRANDING_DEFAULTS = {
  company_name: 'Absolute ADAS',
  tagline: 'Mobile ADAS Calibration Services',
  logo_url: '',
  primary_color: ORANGE,
  secondary_color: '#1a1a1a',
  accent_color: '#2563eb',
  phone: '',
  email: '',
  website: 'absoluteadas.com',
  address: '',
  invoice_prefix: 'INV',
  invoice_footer: 'Thank you for your business!',
  email_signature: '',
  timezone: 'America/Los_Angeles',
}

let _brandingCache = null

export function useBranding() {
  const [branding, setBranding] = useState(_brandingCache || BRANDING_DEFAULTS)

  useEffect(() => {
    if (_brandingCache) return
    apiFetch(`${API_BASE}/api/branding`)
      .then(r => r.json())
      .then(data => {
        _brandingCache = { ...BRANDING_DEFAULTS, ...data }
        setBranding(_brandingCache)
      })
      .catch(() => {}) // use defaults on error
  }, [])

  return branding
}

// ── Dollar formatter ─────────────────────────────────────────────────────────

export function fmt(n) {
  return `$${Number(n || 0).toFixed(2)}`
}

// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS_MAP = {
  draft:   { bg: '#e5e7eb', color: '#374151', label: 'Draft' },
  sent:    { bg: '#dbeafe', color: '#1d4ed8', label: 'Sent' },
  paid:    { bg: '#dcfce7', color: '#15803d', label: 'Paid' },
  overdue: { bg: '#fee2e2', color: '#b91c1c', label: 'Overdue' },
  void:    { bg: '#e5e7eb', color: '#6b7280', label: 'Void' },
}

export function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.draft
  return (
    <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

// ── Expense categories & payment methods ─────────────────────────────────────

export const EXPENSE_CATEGORIES = [
  'Fuel', 'Tools & Equipment', 'Software & Subscriptions', 'Marketing',
  'Office & Supplies', 'Vehicle', 'Insurance', 'Subcontractor',
  'Meals & Entertainment', 'Other',
]

export const PAYMENT_METHODS = [
  'Credit Card', 'Debit Card', 'Cash', 'Check', 'ACH / Bank Transfer', 'Other',
]

export const DEPOSIT_METHODS = [
  'Check', 'ACH / Bank Transfer', 'Credit Card', 'Cash', 'Zelle', 'Other',
]
