// Big 3 rule per shop (Mark 2026-09-10): Cal ID report, Post Collision
// Safety Inspection, Post-Scan — We bill it / We do it, no charge / Shop
// handles it. Lives on the CRM shop; the invoice applies it automatically.
// Used in the CRM Billing tab and (as Big3Picker) inside the invoice
// review modal.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'

const ORANGE = '#CD4419'
export const BIG3 = [
  { key: 'cal_id',    label: 'Cal ID report' },
  { key: 'pcsi',      label: 'Post Collision Safety Inspection' },
  { key: 'post_scan', label: 'Post-Scan' },
]
export const MODES = [
  { id: 'bill',     label: 'We bill it',        color: '#15803d', bg: '#dcfce7' },
  { id: 'included', label: 'No charge',         color: '#1d4ed8', bg: '#dbeafe' },
  { id: 'shop',     label: 'Shop handles it',   color: '#6b7280', bg: '#f3f4f6' },
]
export function describeRules(rules) {
  if (!rules) return 'no rule yet'
  return BIG3.map(b => `${b.label}: ${MODES.find(m => m.id === rules[b.key])?.label?.toLowerCase() || 'default'}`).join(' · ')
}

// The three rows of chips. rules = { cal_id, pcsi, post_scan } (any may be unset).
export function Big3Picker({ rules, onChange, disabled = false, compact = false }) {
  const r = rules || {}
  return (
    <div className="flex flex-col gap-1.5">
      {BIG3.map(b => (
        <div key={b.key} className={`flex items-center gap-2 ${compact ? '' : 'py-0.5'}`}>
          <span className={`${compact ? 'text-[11px]' : 'text-xs'} font-semibold flex-1 min-w-0 truncate`} style={{ color: '#1a1a1a' }}>{b.label}</span>
          <div className="flex gap-1">
            {MODES.map(m => {
              const on = r[b.key] === m.id
              return (
                <button key={m.id} type="button" disabled={disabled} onClick={() => onChange({ ...r, [b.key]: m.id })}
                  className={`${compact ? 'text-[10px] px-2 py-1' : 'text-[11px] px-2.5 py-1.5'} font-bold rounded-full`}
                  style={on ? { backgroundColor: m.color, color: 'white' } : { backgroundColor: m.bg, color: m.color, opacity: .75 }}>
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// CRM Billing tab block — loads and saves the shop's rule.
export default function Big3Rules({ shop }) {
  const [rules, setRules] = useState(null)
  const [meta, setMeta] = useState({ set_by: '', set_at: '' })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!shop?.id) return
    let dead = false
    apiFetch(`${API_BASE}/api/shops/${shop.id}/big3`).then(r => r.json()).then(d => {
      if (dead || !d.ok) return
      setRules(d.rules); setMeta({ set_by: d.set_by, set_at: d.set_at })
    }).catch(() => {})
    return () => { dead = true }
  }, [shop?.id])
  const complete = rules && BIG3.every(b => rules[b.key])
  async function save() {
    setSaving(true); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/shops/${shop.id}/big3`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setDirty(false); setMsg(d.changed ? '✓ Saved — applies to every invoice for this shop' : '✓ No change')
      setMeta({ set_by: 'you', set_at: new Date().toISOString() })
    } catch (e) { setMsg(`Couldn't save: ${e.message}`) } finally { setSaving(false) }
  }
  return (
    <div className="rounded-xl p-4 mb-4" style={{ border: `1.5px solid ${complete ? '#bbf7d0' : '#fde68a'}`, backgroundColor: complete ? '#f0fdf4' : '#fffbeb' }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>🧾 Big 3 rule</div>
          <div className="text-xs" style={{ color: '#666' }}>
            {complete ? `Applied to every invoice · set by ${meta.set_by || '—'}${meta.set_at ? ` on ${String(meta.set_at).slice(0, 10)}` : ''}` : 'No rule yet — the first invoice will ask, or set it here.'}
          </div>
        </div>
        <button type="button" onClick={save} disabled={!dirty || saving}
          className="text-xs font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: ORANGE, opacity: !dirty || saving ? .4 : 1 }}>
          {saving ? 'Saving…' : 'Save rule'}
        </button>
      </div>
      <Big3Picker rules={rules} onChange={r => { setRules(r); setDirty(true) }} />
      {msg && <div className="text-xs mt-2 font-semibold" style={{ color: msg.startsWith('✓') ? '#15803d' : '#b91c1c' }}>{msg}</div>}
    </div>
  )
}
