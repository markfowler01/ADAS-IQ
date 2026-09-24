// Big 3 rule per shop (Mark 2026-09-10): Cal ID report, Post Collision
// Safety Inspection, Post-Scan — We bill it / We do it, no charge / Shop
// handles it. Lives on the CRM shop; the invoice applies it automatically.
// Used in the CRM Billing tab and (as Big3Picker) inside the invoice
// review modal.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'

const ORANGE = '#CD4419'
export const BIG3 = [
  { key: 'cal_id',    label: 'Cal ID report', modes: ['charge', 'included', 'off'] },
  { key: 'pcsi',      label: 'Post Collision Safety Inspection' },
  { key: 'post_scan', label: 'Post-Scan' },
  // Big FOUR (Mark 2026-09-10): Snapshot replaces Post-Scan when charged —
  // the shop does its own post-scan but lets us do a snapshot.
  { key: 'snapshot',  label: 'Calibration Snapshot', modes: ['charge', 'off'], hint: 'Charge = replaces Post-Scan' },
]
// Two states (Mark 2026-09-10): all three are on every invoice —
// Charge = the paid item, Included = the "(included)" $0 item.
export const MODES = [
  { id: 'charge',   label: 'Charge',   color: '#15803d', bg: '#dcfce7' },
  { id: 'included', label: 'Included', color: '#1d4ed8', bg: '#dbeafe' },
  { id: 'off',      label: 'Off',      color: '#6b7280', bg: '#f3f4f6' },
]
const LEGACY = { bill: 'charge', shop: 'included' }
export const normalizeMode = m => LEGACY[m] || m
export function describeRules(rules) {
  if (!rules) return 'no rule yet'
  const snap = normalizeMode(rules.snapshot) === 'charge'
  const charge = BIG3.filter(b => normalizeMode(rules[b.key]) === 'charge' && !(b.key === 'post_scan' && snap)).map(b => b.label)
  const inc = BIG3.filter(b => normalizeMode(rules[b.key]) === 'included' && !(b.key === 'post_scan' && snap)).map(b => b.label)
  const offs = BIG3.filter(b => b.key !== 'snapshot' && normalizeMode(rules[b.key]) === 'off').map(b => b.label)
  return [charge.length ? `Charge: ${charge.join(', ')}` : null, inc.length ? `Included: ${inc.join(', ')}` : null, offs.length ? `Off: ${offs.join(', ')}` : null, snap ? 'Post-Scan off (snapshot instead)' : null].filter(Boolean).join(' · ') || 'no rule yet'
}

// The three rows of chips. rules = { cal_id, pcsi, post_scan } (any may be unset).
export function Big3Picker({ rules, onChange, disabled = false, compact = false }) {
  const r = rules || {}
  return (
    <div className="flex flex-col gap-1.5">
      {BIG3.map(b => (
        <div key={b.key} className={`flex items-center gap-2 ${compact ? '' : 'py-0.5'}`}>
          <span className={`${compact ? 'text-[11px]' : 'text-xs'} font-semibold flex-1 min-w-0 truncate`} style={{ color: '#1a1a1a' }} title={b.hint || ''}>{b.label}{b.hint && !compact ? <span className="font-normal" style={{ color: '#888' }}> · {b.hint}</span> : null}</span>
          <div className="flex gap-1">
            {MODES.filter(m => (b.modes || ['charge', 'included']).includes(m.id)).map(m => {
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

// ── DRPs (Mark 2026-09-10): which insurers the shop is direct-repair for ──
export const DRP_OPTIONS = ['State Farm', 'Allstate', 'GEICO', 'Progressive', 'USAA', 'Farmers', 'Liberty Mutual', 'Nationwide', 'American Family', 'Safeco', 'PEMCO', 'Travelers', 'Hartford', 'Mutual of Enumclaw']
export function DrpChips({ value = [], onChange, compact = false }) {
  const [custom, setCustom] = useState('')
  const has = v => value.some(x => x.toLowerCase() === v.toLowerCase())
  const toggle = v => onChange(has(v) ? value.filter(x => x.toLowerCase() !== v.toLowerCase()) : [...value, v])
  const extras = value.filter(v => !DRP_OPTIONS.some(o => o.toLowerCase() === v.toLowerCase()))
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {[...DRP_OPTIONS, ...extras].map(o => (
          <button key={o} type="button" onClick={() => toggle(o)}
            className={`${compact ? 'text-[10px] px-2 py-0.5' : 'text-[11px] px-2.5 py-1'} font-bold rounded-full`}
            style={has(o) ? { backgroundColor: '#1d4ed8', color: 'white' } : { backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
            {o}
          </button>
        ))}
      </div>
      <div className="flex gap-1 mt-1.5">
        <input value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) { toggle(custom.trim()); setCustom('') } }}
          placeholder="Other insurer + Enter" className="text-xs rounded-md px-2 py-1 flex-1" style={{ border: '1px solid #e0dbd6' }} />
        <button type="button" onClick={() => { if (custom.trim()) { toggle(custom.trim()); setCustom('') } }} className="text-[11px] font-bold rounded-md px-2" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Add</button>
      </div>
    </div>
  )
}
// CRM Billing-tab block for DRPs.
export function DrpRules({ shop }) {
  const [drps, setDrps] = useState(Array.isArray(shop?.drps) ? shop.drps : [])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { setDrps(Array.isArray(shop?.drps) ? shop.drps : []); setDirty(false) }, [shop?.id])
  async function save() {
    setSaving(true); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/shops/${shop.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ drps }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      invalidateBig3Map(); setDirty(false); setMsg('✓ Saved')
    } catch (e) { setMsg(`Couldn't save: ${e.message}`) } finally { setSaving(false) }
  }
  return (
    <div className="rounded-xl p-4 mb-4" style={{ border: '1.5px solid #bfdbfe', backgroundColor: '#eff6ff' }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>🏦 DRPs</div>
          <div className="text-xs" style={{ color: '#666' }}>Insurers this shop is direct-repair for — shows on their job cards</div>
        </div>
        <button type="button" onClick={save} disabled={!dirty || saving} className="text-xs font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: '#1d4ed8', opacity: !dirty || saving ? .4 : 1 }}>{saving ? 'Saving…' : 'Save DRPs'}</button>
      </div>
      <DrpChips value={drps} onChange={v => { setDrps(v); setDirty(true) }} />
      {msg && <div className="text-xs mt-2 font-semibold" style={{ color: msg.startsWith('✓') ? '#15803d' : '#b91c1c' }}>{msg}</div>}
    </div>
  )
}
export function DrpBadge({ shopName, size = 'xs' }) {
  const map = useBig3Map()
  const entry = map[shopKeyOf(shopName)]
  if (!entry?.drps?.length) return null
  const cls = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
  return <span className={`${cls} font-bold rounded inline-block`} style={{ backgroundColor: '#dbeafe', color: '#1e40af' }} title="Direct-repair programs">🏦 DRP: {entry.drps.join(' · ')}</span>
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
  const short = b => b.key === 'pcsi' ? 'PCSI' : b.key === 'post_scan' ? 'Post-Scan' : b.key === 'snapshot' ? 'Snapshot' : 'Cal ID'
  const snapOn = normalizeMode(r.snapshot) === 'charge'
  const charge = BIG3.filter(b => normalizeMode(r[b.key]) === 'charge' && !(b.key === 'post_scan' && snapOn)).map(short)
  const text = charge.length ? `Charge: ${charge.join(' · ')}` : 'All 3 included'
  return <span className={`${cls} font-bold rounded inline-block`} style={{ backgroundColor: '#dcfce7', color: '#166534' }} title={describeRules(r)}>🧾 {text}</span>
}

// "🏢 Dealer · 10% · pays on site" on job + shop cards (Mark 2026-09-22).
const TYPE_SHORT = { body_shop: 'Collision', repair_shop: 'Repair shop', dealer: 'Dealer', retail: 'Retail' }
const PAY_SHORT = { on_site: 'pays on site', net_terms: 'net terms', either: 'on site or terms' }
export function BillingPill({ shopName, size = 'xs' }) {
  const map = useBig3Map()
  const entry = map[shopKeyOf(shopName)]
  if (!shopName) return null
  const cls = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
  const b = entry?.billing
  if (!b) return <span className={`${cls} font-bold rounded inline-block`} style={{ backgroundColor: '#fef3c7', color: '#92400e' }} title="No customer type yet — the first Bill it will ask (collision / repair shop / dealer / retail).">🏢 type? (asks at Bill it)</span>
  const single = b.mode === 'single'
  return <span className={`${cls} font-bold rounded inline-block`} style={{ backgroundColor: single ? '#e0f2fe' : '#ede9fe', color: single ? '#0369a1' : '#5b21b6' }} title={single ? 'One invoice, straight from the job' : 'Insurance invoice + cost invoice'}>🏢 {TYPE_SHORT[b.customer_type] || b.customer_type}{b.discount_pct != null ? ` · ${b.discount_pct}%` : ''}{b.customer_type === 'retail' ? ' · +10.1% tax' : ''} · {PAY_SHORT[b.pay_mode] || b.pay_mode || ''}</span>
}

// The three billing questions on the CRM card (Mark 2026-09-22).
export function BillingQuestions({ shop }) {
  const [d, setD] = useState(null)
  const [f, setF] = useState({ customer_type: '', discount_pct: '', pay_mode: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const load = () => apiFetch(`${API_BASE}/api/shops/${shop.id}/big3`).then(r => r.json()).then(x => { if (x.ok) { setD(x); setF({ customer_type: x.customer_type || '', discount_pct: x.discount_pct ?? '', pay_mode: x.pay_mode || '' }) } }).catch(() => {})
  useEffect(() => { if (shop?.id) load() }, [shop?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null
  const types = d.types || {}, pays = d.pay_modes || {}
  const pick = k => { const t = types[k]; setF(x => ({ customer_type: k, discount_pct: x.discount_pct === '' || x.discount_pct == null ? (t?.discount ?? 0) : x.discount_pct, pay_mode: x.pay_mode || t?.pay || '' })) }
  async function save() {
    setSaving(true); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/shops/${shop.id}/billing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      const x = await r.json(); if (!r.ok) throw new Error(x.error || `HTTP ${r.status}`)
      invalidateBig3Map(); setMsg('✓ Saved — Bill it reads this on every invoice for this shop'); await load()
    } catch (e) { setMsg(`✗ ${e.message}`) } finally { setSaving(false) }
  }
  const complete = !!f.customer_type
  return (
    <div className="rounded-xl p-4 mb-4" style={{ border: `1.5px solid ${complete ? '#bae6fd' : '#fde68a'}`, backgroundColor: complete ? '#f0f9ff' : '#fffbeb' }}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>🏢 How we bill them</div>
          <div className="text-xs" style={{ color: '#666' }}>{complete ? `${types[f.customer_type]?.label || f.customer_type} · ${types[f.customer_type]?.mode === 'dual' ? 'insurance + cost invoice' : 'one invoice'}` : 'Not set — the first Bill it will ask. Answer here and it never asks.'}</div>
        </div>
        <button type="button" onClick={save} disabled={saving || !f.customer_type} className="text-xs font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: '#0e7490', opacity: saving || !f.customer_type ? .4 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      <div className="text-[11px] font-bold mb-1" style={{ color: '#555' }}>1 · What kind of customer?</div>
      <div className="flex gap-1.5 flex-wrap mb-3">{Object.entries(types).map(([k, t]) => <button key={k} type="button" onClick={() => pick(k)} className="text-xs font-bold rounded-full px-3 py-1.5" style={f.customer_type === k ? { backgroundColor: '#1a1a1a', color: 'white' } : { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>{t.label}</button>)}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] font-bold mb-1" style={{ color: '#555' }}>2 · Discount shown on their invoice</div>
          <div className="flex items-center gap-2"><input type="number" min="0" max="60" value={f.discount_pct} onChange={e => setF(x => ({ ...x, discount_pct: e.target.value }))} className="w-20 text-base font-bold rounded-md px-2 py-1 text-right" style={{ border: '1.5px solid #e0dbd6' }} /><span className="text-sm" style={{ color: '#555' }}>% off list · 0 = list price</span></div>
          {f.customer_type === 'retail' && <div className="text-[11px] mt-1" style={{ color: '#0369a1' }}>Retail always adds 10.1% sales tax.</div>}
        </div>
        <div>
          <div className="text-[11px] font-bold mb-1" style={{ color: '#555' }}>3 · How do they pay?</div>
          <div className="flex gap-1.5 flex-wrap">{Object.entries(pays).map(([k, l]) => <button key={k} type="button" onClick={() => setF(x => ({ ...x, pay_mode: k }))} className="text-xs font-bold rounded-full px-3 py-1.5" style={f.pay_mode === k ? { backgroundColor: '#0e7490', color: 'white' } : { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>{l.split(' — ')[0]}</button>)}</div>
        </div>
      </div>
      {msg && <div className="text-xs mt-2 font-semibold" style={{ color: msg.startsWith('✓') ? '#15803d' : '#b91c1c' }}>{msg}</div>}
      <WelcomeEmailBox shop={shop} />
      <NewShopChecklist shop={shop} />
    </div>
  )
}

// New-shop onboarding (Phase E, Mark 2026-09-22) — what Kat finishes after a
// tech adds a shop from the field. Lives on billing_rules.new_shop.
function NewShopChecklist({ shop }) {
  const [cl, setCl] = useState(shop?.billing_rules?.new_shop || null)
  const [busy, setBusy] = useState('')
  useEffect(() => { setCl(shop?.billing_rules?.new_shop || null) }, [shop?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  async function tick(key, action) {
    setBusy(key || action)
    try { const r = await apiFetch(`${API_BASE}/api/shops/${shop.id}/new-shop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action ? { action } : { key }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); setCl(d.new_shop) }
    catch (e) { alert(e.message) } finally { setBusy('') }
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  if (!cl) return <div className="mt-3 flex items-center gap-2 text-[11px]" style={{ color: '#888' }}>No new-shop checklist running. <button type="button" onClick={() => tick(null, 'start')} disabled={!!busy} className="font-bold rounded-full px-2.5 py-1" style={{ backgroundColor: 'white', color: '#0e7490', border: '1px solid #0e7490' }}>▶ Start new-shop onboarding</button></div>
  const done = cl.items.filter(i => i.done).length
  return (
    <div className="mt-3 rounded-lg p-3" style={{ backgroundColor: 'white', border: '1px solid #bae6fd' }}>
      <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: '#0369a1', fontFamily: 'IBM Plex Mono, monospace' }}>🆕 New-shop onboarding · {done}/{cl.items.length}{cl.completed_at ? ' · done' : ''}</div>
      {cl.items.map(it => {
        const late = !it.done && it.due_date && it.due_date < today
        return (
          <label key={it.key} className="flex items-start gap-2 py-1 text-sm cursor-pointer" style={{ borderBottom: '1px solid #f3f3f3' }}>
            <input type="checkbox" checked={!!it.done} disabled={busy === it.key} onChange={() => tick(it.key)} className="mt-1" />
            <span className="flex-1" style={{ color: it.done ? '#999' : '#1a1a1a', textDecoration: it.done ? 'line-through' : 'none' }}>{it.label}
              <span className="text-[10px] ml-1.5 font-bold rounded-full px-1.5 py-0.5" style={{ backgroundColor: it.owner === 'kat' ? '#faf5ff' : '#fff7ed', color: it.owner === 'kat' ? '#7e22ce' : '#b45309' }}>{it.owner === 'kat' ? 'Kat' : 'Mark'}</span>
              {it.due_date && !it.done && <span className="text-[10px] ml-1" style={{ color: late ? '#b91c1c' : '#888' }}>{late ? `⚠ was due ${it.due_date}` : `by ${it.due_date}`}</span>}
            </span>
          </label>
        )
      })}
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
  const complete = rules && BIG3.filter(b => b.key !== 'snapshot').every(b => rules[b.key])
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
      try { window.dispatchEvent(new CustomEvent('adas:big3-saved', { detail: { shop_id: shop.id, changed: !!d.changed } })) } catch {}
      setDirty(false)
      if (d.changed) {
        setMsg('✓ Saved — applies to every invoice for this shop · #dispatch + Mark pinged')
        setMeta({ set_by: d.set_by || 'you', set_at: new Date().toISOString() })
      } else {
        setMsg(`✓ Already set exactly like this${meta.set_by ? ` by ${meta.set_by}` : ''} — nothing changed, so no ping went out`)
      }
      // Read it back from the row so what you see is what's stored.
      apiFetch(`${API_BASE}/api/shops/${shop.id}/big3`).then(r => r.json()).then(x => { if (x.ok) { setRules(x.rules); setMeta({ set_by: x.set_by, set_at: x.set_at }) } }).catch(() => {})
    } catch (e) { setMsg(`✗ Not saved: ${e.message} — try again, and tell Mark if it keeps happening`) } finally { setSaving(false) }
  }
  return (<>
    <BillingQuestions shop={shop} />
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
  </>)
}


// 🧾 Zoho Books link for a CRM shop — shows the link, or creates/links the customer.
export function BooksLink({ shop }) {
  const [state, setState] = useState({ busy: false, msg: '', id: shop?.zoho_contact_id || '' })
  useEffect(() => { setState(s => ({ ...s, id: shop?.zoho_contact_id || '' })) }, [shop?.zoho_contact_id])
  async function create() {
    if (!shop?.id) return
    setState(s => ({ ...s, busy: true, msg: '' }))
    try {
      const r = await apiFetch(`${API_BASE}/api/shops/${shop.id}/books-customer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setState({ busy: false, id: d.contact_id, msg: d.created ? 'Created in Zoho Books ✓' : d.linked ? `Linked to existing Books customer "${d.contact_name}" ✓` : 'Already linked ✓' })
    } catch (e) { setState(s => ({ ...s, busy: false, msg: `Failed: ${e.message}` })) }
  }
  return (
    <div className="rounded-xl p-3 mb-3 flex items-center justify-between gap-2 flex-wrap" style={{ backgroundColor: state.id ? '#f0fdf4' : '#fffbeb', border: `1.5px solid ${state.id ? '#bbf7d0' : '#fde68a'}` }}>
      <div>
        <div className="text-sm font-bold" style={{ color: '#1a1a1a' }}>🧾 Zoho Books customer</div>
        <div className="text-xs" style={{ color: state.id ? '#166534' : '#92400e' }}>{state.msg || (state.id ? `Linked · id ${state.id}` : 'Not in Zoho Books yet — quotes and invoices need this.')}</div>
      </div>
      {!state.id && <button type="button" onClick={create} disabled={state.busy || !shop?.id} className="rounded-xl px-3 py-2 text-sm font-bold text-white" style={{ backgroundColor: '#15803d', opacity: state.busy ? .5 : 1 }}>{state.busy ? 'Working…' : 'Create in Zoho Books'}</button>}
    </div>
  )
}


// 📝 Estimate first (Mark 2026-09-23): shops whose cars always need an
// estimate sent before work. Bright pill on CRM + job cards; toggle on the
// Billing tab; text/email tickets carry it in their notes.
export function EstimateFirstPill({ shopName, size = 'xs' }) {
  const map = useBig3Map()
  const e = map[shopKeyOf(shopName)]
  if (!e?.estimate_first) return null
  const cls = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
  return <span className={`${cls} font-extrabold rounded inline-block`} style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }} title={`Every car at this shop needs an estimate sent before work${e.estimate_first_note ? ` · ${e.estimate_first_note}` : ''}`}>📝 ESTIMATE FIRST</span>
}
export function EstimateFirstToggle({ shop }) {
  const map = useBig3Map()
  const cur = map[shopKeyOf(shop?.shop_name)]
  const [on, setOn] = useState(!!cur?.estimate_first)
  const [note, setNote] = useState(cur?.estimate_first_note || '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setOn(!!cur?.estimate_first); setNote(cur?.estimate_first_note || '') }, [cur?.estimate_first, cur?.estimate_first_note])
  if (!shop?.id) return null
  async function save(next) {
    setBusy(true)
    try { const r = await apiFetch(`${API_BASE}/api/shops/${shop.id}/estimate-first`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: next, note }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); setOn(!!d.estimate_first); invalidateBig3Map() }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-xl p-3 mb-3 flex items-center justify-between gap-2 flex-wrap" style={{ backgroundColor: on ? '#fffbeb' : 'white', border: `1.5px solid ${on ? '#fcd34d' : '#e8e4e0'}` }}>
      <div className="min-w-0">
        <div className="text-sm font-bold" style={{ color: '#1a1a1a' }}>📝 Estimate first{on ? ' — ON' : ''}</div>
        <div className="text-[11px]" style={{ color: '#666' }}>Every car at this shop needs an estimate sent (and approved) before work. Shows on the CRM card, every job and request card, and tickets that come in by text or email.</div>
        {on && <input value={note} onChange={e => setNote(e.target.value)} onBlur={() => save(true)} placeholder="Note for the team (optional) — e.g. send to Dave, wait for his OK" className="mt-1.5 w-full text-xs rounded-lg px-2 py-1.5" style={{ border: '1px solid #fcd34d', backgroundColor: 'white' }} />}
      </div>
      <button disabled={busy} onClick={() => save(!on)} className="text-xs font-bold rounded-lg px-3 py-2" style={on ? { backgroundColor: 'white', color: '#92400e', border: '1px solid #fcd34d' } : { backgroundColor: '#b45309', color: 'white' }}>{busy ? '…' : on ? 'Turn off' : 'Require an estimate first'}</button>
    </div>
  )
}


// 📨 Welcome email (Mark 2026-09-24): goes out on its own when a shop goes
// Active; this is the by-hand send / resend, with the last send shown.
export function WelcomeEmailBox({ shop }) {
  const [w, setW] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { if (!shop?.id) return; apiFetch(`${API_BASE}/api/shops/${shop.id}/welcome`).then(r => r.json()).then(d => setW(d.welcome || null)).catch(() => {}) }, [shop?.id])
  if (!shop?.id) return null
  async function send(force) {
    if (force && !window.confirm(`Send the welcome email to ${shop.shop_name} again?`)) return
    setBusy(true); setMsg('')
    try { const r = await apiFetch(`${API_BASE}/api/shops/${shop.id}/welcome${force ? '?force=1' : ''}`, { method: 'POST' }); const d = await r.json(); if (!r.ok) throw new Error(d.why || d.error || `HTTP ${r.status}`); setW({ sent_at: new Date().toISOString(), to: d.to }); setMsg(`✓ Sent to ${d.to}`) }
    catch (e) { setMsg(`✗ ${e.message}`) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-xl p-3 mb-3 flex items-center justify-between gap-2 flex-wrap" style={{ backgroundColor: w ? '#f0fdf4' : '#fff7ed', border: `1.5px solid ${w ? '#86efac' : '#fdba74'}` }}>
      <div className="min-w-0">
        <div className="text-sm font-bold" style={{ color: '#1a1a1a' }}>📨 Welcome email</div>
        <div className="text-[11px]" style={{ color: '#666' }}>{w ? `Sent ${new Date(w.sent_at).toLocaleDateString()} to ${w.to}` : 'Not sent yet — goes out on its own when the shop goes Active (needs an email on the card).'} · Absolute Promise, first-job offer, pricing sheet, Van invite.</div>
        {msg && <div className="text-[11px] mt-0.5" style={{ color: msg.startsWith('✓') ? '#15803d' : '#b91c1c' }}>{msg}</div>}
      </div>
      <button disabled={busy} onClick={() => send(!!w)} className="text-xs font-bold rounded-lg px-3 py-2" style={w ? { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' } : { backgroundColor: '#CD4419', color: 'white' }}>{busy ? '…' : w ? 'Resend' : 'Send now'}</button>
    </div>
  )
}
