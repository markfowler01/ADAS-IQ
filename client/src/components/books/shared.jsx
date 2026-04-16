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

// ── Design tokens ────────────────────────────────────────────────────────────
// Semantic color + spacing tokens — used everywhere so the whole app breathes together.

export const COLORS = {
  // Brand
  primary: '#CD4419',
  primarySoft: '#fff7f5',
  primaryBorder: '#fcd5c5',

  // Semantic
  success: '#16a34a',
  successSoft: '#f0fdf4',
  warning: '#b45309',
  warningSoft: '#fef3c7',
  danger: '#b91c1c',
  dangerSoft: '#fef2f2',
  info: '#2563eb',
  infoSoft: '#eff6ff',

  // Neutrals
  text: '#1a1a1a',
  textMuted: '#6b7280',
  textLight: '#9ca3af',
  border: '#f0ece8',       // warm card border
  borderStrong: '#e5e7eb', // form input border
  surface: '#ffffff',
  surfaceMuted: '#fafafa', // subtle page/card alt background
  surfaceSoft: '#f5f3f0',  // pill/tag background
}

// ── Reusable UI primitives ──────────────────────────────────────────────────

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: COLORS.text }}>{title}</h1>
        {subtitle && (
          <p className="text-sm mt-1" style={{ color: COLORS.textMuted }}>{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}

export function SectionLabel({ children, className = '' }) {
  return (
    <p className={`text-[11px] font-bold uppercase tracking-wider mb-3 ${className}`}
      style={{ color: '#9ca3af', letterSpacing: '0.1em' }}>
      {children}
    </p>
  )
}

export function Card({ children, className = '', padded = true, style = {}, ...props }) {
  return (
    <div
      className={`rounded-xl bg-white shadow-sm ${padded ? 'p-5' : ''} ${className}`}
      style={{ border: `1px solid ${COLORS.border}`, ...style }}
      {...props}>
      {children}
    </div>
  )
}

export function Button({ children, variant = 'primary', size = 'md', className = '', style = {}, ...props }) {
  const variants = {
    primary: { backgroundColor: COLORS.primary, color: 'white' },
    secondary: { backgroundColor: COLORS.surfaceSoft, color: COLORS.text },
    success: { backgroundColor: COLORS.success, color: 'white' },
    danger: { backgroundColor: COLORS.dangerSoft, color: COLORS.danger },
    ghost: { backgroundColor: 'transparent', color: COLORS.textMuted, border: `1px solid ${COLORS.borderStrong}` },
    info: { backgroundColor: COLORS.infoSoft, color: COLORS.info },
  }
  const sizes = {
    sm: 'text-xs px-2.5 py-1.5',
    md: 'text-sm px-4 py-2',
    lg: 'text-base px-6 py-2.5',
  }
  const disabledStyle = props.disabled ? { opacity: 0.55, cursor: 'not-allowed' } : {}
  return (
    <button
      className={`rounded-lg font-semibold transition-all ${sizes[size]} ${className}`}
      style={{ ...variants[variant], ...disabledStyle, ...style }}
      {...props}>
      {children}
    </button>
  )
}

export function StatCard({ label, value, sublabel, tone = 'neutral', emoji, onClick }) {
  const tones = {
    neutral:  { bg: COLORS.surfaceMuted, color: COLORS.text },
    primary:  { bg: COLORS.primarySoft,  color: COLORS.primary },
    success:  { bg: COLORS.successSoft,  color: COLORS.success },
    warning:  { bg: COLORS.warningSoft,  color: COLORS.warning },
    danger:   { bg: COLORS.dangerSoft,   color: COLORS.danger },
    info:     { bg: COLORS.infoSoft,     color: COLORS.info },
  }
  const t = tones[tone] || tones.neutral
  const Element = onClick ? 'button' : 'div'
  return (
    <Element
      onClick={onClick}
      className={`rounded-xl p-4 shadow-sm text-left w-full transition-transform ${onClick ? 'hover:scale-[1.01] cursor-pointer' : ''}`}
      style={{ backgroundColor: t.bg }}>
      <p className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: t.color }}>
        {emoji && <span>{emoji}</span>}
        <span>{label}</span>
      </p>
      <p className="text-2xl lg:text-3xl font-bold mt-1.5" style={{ color: t.color }}>{value}</p>
      {sublabel && <p className="text-xs mt-1" style={{ color: COLORS.textMuted }}>{sublabel}</p>}
    </Element>
  )
}

export function EmptyState({ emoji = '✨', title, subtitle, action }) {
  return (
    <div className="py-16 px-6 text-center">
      <p className="text-5xl mb-3">{emoji}</p>
      {title && <p className="text-sm font-semibold mb-1" style={{ color: COLORS.text }}>{title}</p>}
      {subtitle && <p className="text-sm" style={{ color: COLORS.textMuted }}>{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Tabs({ tabs, active, onChange, className = '' }) {
  return (
    <div className={`flex gap-0 border-b overflow-x-auto ${className}`}
      style={{ borderColor: '#ebebeb' }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className="text-sm px-4 py-2.5 font-medium transition-colors whitespace-nowrap flex-shrink-0"
          style={{
            color: active === t.id ? COLORS.primary : COLORS.textMuted,
            borderBottom: active === t.id ? `2px solid ${COLORS.primary}` : '2px solid transparent',
            marginBottom: '-1px',
          }}>
          {t.label}
          {t.count != null && (
            <span className="ml-1.5 text-xs font-normal" style={{ color: active === t.id ? COLORS.primary : COLORS.textLight }}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">
          {label}
          {hint && <span className="ml-1.5 font-normal" style={{ color: COLORS.textLight }}>{hint}</span>}
        </label>
      )}
      {children}
    </div>
  )
}

export function Input({ className = '', ...props }) {
  return (
    <input
      className={`w-full rounded-lg px-3 py-2 text-sm transition-colors focus:outline-none ${className}`}
      style={{ border: `1px solid ${COLORS.borderStrong}` }}
      onFocus={e => e.target.style.borderColor = COLORS.primary}
      onBlur={e => e.target.style.borderColor = COLORS.borderStrong}
      {...props}
    />
  )
}

