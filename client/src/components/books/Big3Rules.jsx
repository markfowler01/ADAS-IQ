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
// Two states (Mark 2026-09-10): all three are on every invoice —
// Charge = the paid item, Included = the "(included)" $0 item.
export const MODES = [
  { id: 'charge',   label: 'Charge',   color: '#15803d', bg: '#dcfce7' },
  { id: 'included', label: 'Included', color: '#1d4ed8', bg: '#dbeafe' },
]
const LEGACY = { bill: 'charge', shop: 'included' }
export const normalizeMode = m => LEGACY[m] || m
export function describeRules(rules) {
  if (!rules) return 'no rule yet'
  const charge = BIG3.filter(b => normalizeMode(rules[b.key]) === 'charge').map(b => b.label)
  const inc = BIG3.filter(b => normalizeMode(rules[b.key]) === 'included').map(b => b.label)
  return [charge.length ? `Charge: ${charge.join(', ')}` : null, inc.length ? `Included: ${inc.join(', ')}` : null].filter(Boolean).join(' · ') || 'no rule yet'
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
              const on = normalizeMode(r[b.key]) === m.id
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

// ── Rule map for card badges (one fetch per session, 5-min refresh) ─────
let _map = null, _mapAt = 0, _mapPromise = null
const shopKeyOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
export function useBig3Map() {
  const [map, setMap] = useState(_map || {})
  useEffect(() => {
    if (_map && Date.now() - _mapAt < 5 * 60 * 1000) { setMap(_map); return }
    if (!_mapPromise) {
      _mapPromise = apiFetch(`${API_BASE}/api/shops/big3-map`).then(r => r.json()).then(d => { _map = d.map || {}; _mapAt = Date.now(); _mapPromise = null; return _map }).catch(() => { _mapPromise = null; return _map || {} })
    }
    _mapPromise.then(m => setMap(m || {}))
  }, [])
  return map
}
export function invalidateBig3Map() { _map = null; _mapAt = 0 }

// "🧾 We bill: PCSI · Post-Scan" on a job card (visible-badge rule).
export function Big3Badge({ shopName, size = 'xs' }) {
  const map = useBig3Map()
  const entry = map[shopKeyOf(shopName)]
  if (!shopName) return null
  const cls = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
  if (!entry?.rules) {
    return <span className={`${cls} font-bold rounded inline-block`} style={{ backgroundColor: '#fef3c7', color: '#92400e' }} title="No Big 3 rule yet — default: Cal ID charged, PCSI + Post-Scan included. The first invoice will ask.">🧾 Big 3: default (no rule yet)</span>
  }
  const r = entry.rules
  const short = b => b.key === 'pcsi' ? 'PCSI' : b.key === 'post_scan' ? 'Post-Scan' : 'Cal ID'
  const charge = BIG3.filter(b => normalizeMode(r[b.key]) === 'charge').map(short)
  const text = charge.length ? `Charge: ${charge.join(' · ')}` : 'All 3 included'
  return <span className={`${cls} font-bold rounded inline-block`} style={{ backgroundColor: '#dcfce7', color: '#166534' }} title={describeRules(r)}>🧾 {text}</span>
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
  const [suggest, setSuggest] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  async function askHistory() {
    setSuggesting(true); setSuggest(null)
    try {
      const r = await apiFetch(`${API_BASE}/api/shops/${shop.id}/big3-suggest`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setSuggest(d)
    } catch (e) { setSuggest({ error: e.message }) } finally { setSuggesting(false) }
  }
  async function save() {
    setSaving(true); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/shops/${shop.id}/big3`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      invalidateBig3Map()
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
            {complete ? `Applied to every invoice · set by ${meta.set_by || '—'}${meta.set_at ? ` on ${String(meta.set_at).slice(0, 10)}` : ''}` : 'No rule yet — invoices use the default (Cal ID charged, PCSI + Post-Scan included) until you set it here or on the first invoice.'}
          </div>
        </div>
        <button type="button" onClick={save} disabled={!dirty || saving}
          className="text-xs font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: ORANGE, opacity: !dirty || saving ? .4 : 1 }}>
          {saving ? 'Saving…' : 'Save rule'}
        </button>
      </div>
      <Big3Picker rules={rules} onChange={r => { setRules(r); setDirty(true) }} />
      {msg && <div className="text-xs mt-2 font-semibold" style={{ color: msg.startsWith('✓') ? '#15803d' : '#b91c1c' }}>{msg}</div>}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <button type="button" onClick={askHistory} disabled={suggesting} className="text-[11px] font-bold rounded-full px-2.5 py-1" style={{ backgroundColor: 'white', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
          {suggesting ? 'Reading Books…' : '🔍 Suggest from invoice history'}
        </button>
        {suggest?.error && <span className="text-[11px]" style={{ color: '#b91c1c' }}>{suggest.error}</span>}
        {suggest && !suggest.error && (suggest.suggested
          ? <>
              <span className="text-[11px]" style={{ color: '#555' }}>Last {suggest.invoices} invoice{suggest.invoices === 1 ? '' : 's'} say: {describeRules(suggest.suggested)}</span>
              <button type="button" onClick={() => { setRules(suggest.suggested); setDirty(true) }} className="text-[11px] font-bold rounded-full px-2.5 py-1 text-white" style={{ backgroundColor: '#1d4ed8' }}>Use this</button>
            </>
          : <span className="text-[11px]" style={{ color: '#888' }}>No invoices found in Books for this exact name.</span>)}
      </div>
      {suggest?.evidence?.length > 0 && (
        <div className="mt-2 text-[10px] rounded-lg overflow-hidden" style={{ border: '1px solid #e5e7eb' }}>
          {suggest.evidence.map(e => (
            <div key={e.number} className="flex gap-2 px-2 py-1" style={{ borderTop: '1px solid #f1f5f9', color: '#555' }}>
              <span className="font-mono w-24 truncate">{e.number}</span><span className="w-20">{e.date}</span>
              <span>Cal ID {e.cal_id}</span><span>PCSI {e.pcsi}</span><span>Post-Scan {e.post_scan}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
