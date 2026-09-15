import { useState, useEffect, useCallback } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import { STAGES, REGIONS, ZONES, IN_PLAY_STAGES, IN_PLAY_CAP, TEAM_MEMBERS, zoneLabel } from './crmConstants.js'
import { InPlayBar, TerritoryGrid, SetupBanner, NextActionModal, MondayModal, DiscoverModal, staleDays, zoneOf, ownerOf, inPlayCount } from './crm/PipelineTools.jsx'
import Navbar from './Navbar'
import RepairCustomers from './crm/RepairCustomers.jsx'  // repair customers, kept separate from shops (2026-09-14)
import CRMImportModal from './CRMImportModal'
import GooglePlacesModal from './GooglePlacesModal'
import CRMBroadcastModal from './CRMBroadcastModal'
import ShopDetailPanel from './ShopDetailPanel'
import VanContactModal from './VanContactModal'
import NewCustomerModal from './NewCustomerModal.jsx'

const ORANGE = '#CD4419'

const EMPTY_SHOP = {
  shop_name: '', phone: '', email: '', address: '',
  pipeline_stage: 'target', notes: '', last_contact: '',
  next_followup: '', estimated_monthly: '', region: '',
  assigned_to: '', volume_potential: '', referral_source: '',
  shop_rate: '', insurance_rate: '', lost_reason: '',
  people: [], activities: [],
}

// ─── Overdue helpers ──────────────────────────────────────────────────────────
function isOverdue(shop) {
  if (!shop.next_followup) return false
  return new Date(shop.next_followup + 'T00:00:00') < new Date(new Date().toDateString())
}
function isDueToday(shop) {
  if (!shop.next_followup) return false
  const today = new Date().toLocaleDateString('en-CA')
  return shop.next_followup === today
}

// ─── CSV Export ───────────────────────────────────────────────────────────────
function exportToCSV(shops) {
  const headers = [
    'shop_name','phone','email','address','region','pipeline_stage',
    'assigned_to','estimated_monthly','volume_potential','referral_source',
    'shop_rate','insurance_rate','lost_reason','next_followup','last_contact','notes',
    'contact_name','contact_phone','contact_email',
  ]
  function esc(v) {
    if (v === null || v === undefined) return ''
    const s = String(v).replace(/"/g, '""')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s
  }
  const rows = shops.map(s => {
    const p = s.people?.[0] || {}
    return headers.map(h => {
      if (h === 'contact_name')  return esc(p.name  || s.contact_name || '')
      if (h === 'contact_phone') return esc(p.phone || '')
      if (h === 'contact_email') return esc(p.email || '')
      return esc(s[h] || '')
    }).join(',')
  })
  const csv  = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `pipeline_${new Date().toLocaleDateString('en-CA')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Quick Add Modal ──────────────────────────────────────────────────────────
function QuickAddModal({ defaultStage, onClose, onSave }) {
  const [form,   setForm]   = useState({ ...EMPTY_SHOP, pipeline_stage: defaultStage || 'target' })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (!form.shop_name.trim()) { setError('Shop name is required'); return }
    setSaving(true); setError(null)
    try { await onSave(form) } catch (e) { setError(e.message); setSaving(false) }
  }

  const activeStages = STAGES.filter(s => s.id !== 'lost')

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full sm:max-w-md bg-white overflow-hidden shadow-2xl"
        style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column', borderRadius: '20px 20px 0 0' }}>
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full" style={{ backgroundColor: '#ddd' }} />
        </div>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #ebebeb' }}>
          <h2 className="text-base font-bold" style={{ color: '#1a1a1a' }}>Add Shop</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: '#f5f3f0', color: '#888' }}>✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Stage</label>
            <div className="flex flex-wrap gap-2">
              {activeStages.map(s => (
                <button key={s.id} onClick={() => setField('pipeline_stage', s.id)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full border"
                  style={form.pipeline_stage === s.id
                    ? { backgroundColor: s.bg, color: s.color, borderColor: s.color }
                    : { backgroundColor: 'transparent', color: '#888', borderColor: '#ddd' }}>
                  {s.emoji} {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Shop Name *</label>
            <input autoFocus className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
              style={{ borderColor: '#e0dbd6' }}
              value={form.shop_name} onChange={e => setField('shop_name', e.target.value)}
              placeholder="Prestige Auto Body"
              onKeyDown={e => e.key === 'Enter' && handleSave()} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Phone</label>
              <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                style={{ borderColor: '#e0dbd6' }} type="tel"
                value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="(555) 555-5555" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Region</label>
              <select className="w-full border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none"
                style={{ borderColor: '#e0dbd6' }}
                value={form.region} onChange={e => setField('region', e.target.value)}>
                <option value="">— Select —</option>
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Address</label>
            <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
              style={{ borderColor: '#e0dbd6' }}
              value={form.address} onChange={e => setField('address', e.target.value)}
              placeholder="123 Main St, Dallas TX" />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid #ebebeb' }}>
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-xl font-medium"
            style={{ color: '#555', backgroundColor: '#f5f3f0' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="text-sm px-4 py-2 rounded-xl font-medium text-white"
            style={{ backgroundColor: ORANGE, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Adding…' : 'Add Shop'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Shop Card ────────────────────────────────────────────────────────────────
function ShopCard({ shop, onOpen, onStageChange, onDragStart, calCount }) {
  // Mark 2026-09-15: "clearly read the shop's name, a call button and a directions
  // button right here, and any other info we have on them right in the card."
  const stage    = STAGES.find(s => s.id === shop.pipeline_stage) || STAGES[0]
  const stageIdx = STAGES.findIndex(s => s.id === shop.pipeline_stage)
  const nextStage = (shop.pipeline_stage === 'active') ? null : STAGES.slice(stageIdx + 1).find(s => s.id !== 'lost' && s.id !== 'denied') || null
  const people   = Array.isArray(shop.people) ? shop.people : []
  const overdue  = isOverdue(shop)
  const dueToday = isDueToday(shop)
  const lastAct  = Array.isArray(shop.activities) && shop.activities.length > 0 ? shop.activities.slice().sort((a, b) => new Date(b.date || b.at) - new Date(a.date || a.at))[0] : null
  const stop = e => e.stopPropagation()

  function formatFollowup(d) {
    if (!d) return null
    try {
      const date = new Date(d + 'T00:00:00'); const today = new Date(new Date().toDateString()); const diff = Math.round((date - today) / 86400000)
      if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, urgent: true }
      if (diff === 0) return { label: 'Due today', urgent: true }
      if (diff === 1) return { label: 'Tomorrow', urgent: false }
      if (diff < 7) return { label: `In ${diff} days`, urgent: false }
      return { label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), urgent: false }
    } catch { return null }
  }
  const followupInfo = formatFollowup(shop.next_followup)

  // What we know, pulled apart from the notes: rating, website, maps link, and the human notes
  const notes = String(shop.notes || '')
  const rating = (notes.match(/(\d(?:\.\d)?)★\s*\((\d+)\)/) || [])
  const website = (notes.match(/https?:\/\/(?!maps\.|www\.google\.)[^\s·]+/i) || [])[0] || ''
  const mapsUrl = (notes.match(/https?:\/\/(?:maps\.google\.com|www\.google\.com\/maps|maps\.app\.goo\.gl)[^\s·]*/i) || [])[0] || ''
  const humanNotes = notes.split('\n').map(l => l.trim()).filter(l => l && !/^Found by territory discovery/.test(l)).slice(0, 2)
  const directions = mapsUrl || (shop.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(shop.address)}` : '')
  const phone = shop.phone || people.find(p => p.phone)?.phone || ''
  const primary = people[0]
  const drps = Array.isArray(shop.drps) ? shop.drps : []
  const sd = staleDays(shop)
  const lastTouchTxt = lastAct ? `${lastAct.type || 'touch'} ${String(lastAct.date || lastAct.at || '').slice(0, 10)}${lastAct.note ? ` — ${lastAct.note}` : ''}` : (shop.last_contact ? `contact ${String(shop.last_contact).slice(0, 10)}` : '')
  const Btn = ({ href, bg, fg, children, title }) => (
    <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" onClick={stop} title={title}
      className="flex-1 min-w-[72px] flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-bold" style={{ backgroundColor: bg, color: fg }}>{children}</a>
  )

  return (
    <div draggable onDragStart={e => onDragStart(e, shop)} onClick={() => onOpen(shop)}
      className="bg-white rounded-xl shadow-sm cursor-pointer select-none transition-shadow hover:shadow-md active:opacity-75"
      style={{ border: `1px solid ${overdue ? '#fca5a5' : '#ebebeb'}` }}>

      {/* Header: the whole name, then the chips on their own line */}
      <div className="px-3 py-2 rounded-t-xl" style={{ backgroundColor: ORANGE }}>
        <p className="text-sm font-bold text-white leading-snug" style={{ wordBreak: 'break-word' }}>{shop.shop_name}</p>
        <div className="flex items-center gap-1 flex-wrap mt-1">
          {shop.region && <span className="text-[10px] px-1.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.95)' }}>📍 {zoneLabel(shop.region)}</span>}
          {shop.assigned_to && <span className="text-[10px] px-1.5 rounded-full font-semibold" style={{ backgroundColor: 'rgba(255,255,255,0.25)', color: 'white' }}>👤 {shop.assigned_to}</span>}
          {rating[1] && <span className="text-[10px] px-1.5 rounded-full font-semibold" style={{ backgroundColor: 'rgba(255,255,255,0.25)', color: 'white' }}>★ {rating[1]} ({rating[2]})</span>}
          {shop.fit_score != null && shop.fit_score !== '' && <span className="text-[10px] px-1.5 rounded-full font-semibold" style={{ backgroundColor: 'rgba(255,255,255,0.25)', color: 'white' }}>fit {shop.fit_score}</span>}
          {sd > 0 && shop.pipeline_stage !== 'target' && <span className="text-[10px] font-bold px-1.5 rounded-full" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>⏰ {sd}d past the clock</span>}
          {(overdue || dueToday) && <span className="text-xs font-bold text-white">{overdue ? '⚠️' : '📅'}</span>}
        </div>
      </div>

      <div className="p-3">
        {shop.address && <p className="text-xs mb-2 leading-snug" style={{ color: '#666' }}>{shop.address.replace(/, USA$/, '')}</p>}

        {/* Action row: call · text · directions · website */}
        <div className="flex gap-1.5 mb-2 flex-wrap">
          {phone && <Btn href={`tel:${phone}`} bg="#dcfce7" fg="#15803d" title={phone}>📞 Call</Btn>}
          {phone && <Btn href={`sms:${phone}`} bg="#e8f0fe" fg="#1d4ed8" title={phone}>💬 Text</Btn>}
          {directions && <Btn href={directions} bg="#fff7ed" fg="#c2410c" title="Open in Google Maps">🧭 Directions</Btn>}
          {website && <Btn href={website} bg="#f3e8ff" fg="#7c3aed" title={website}>🌐 Site</Btn>}
          {!phone && !directions && <span className="text-xs" style={{ color: '#bbb' }}>No phone or address yet</span>}
        </div>
        {phone && <p className="text-xs mb-1.5 font-medium" style={{ color: '#15803d' }}>{phone}</p>}

        {/* People we know there */}
        {people.slice(0, 2).map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-2 mb-1 px-2 py-1 rounded-lg" style={{ backgroundColor: '#f5f3f0' }}>
            <span className="text-xs min-w-0 truncate"><b style={{ color: '#1a1a1a' }}>{p.name || 'Contact'}</b>{p.title ? <span style={{ color: '#888' }}> · {p.title}</span> : null}{p.phone ? <span style={{ color: '#888' }}> · {p.phone}</span> : null}</span>
            <span className="flex gap-1 flex-shrink-0">
              {p.phone && <a href={`tel:${p.phone}`} onClick={stop} className="text-[11px] font-bold px-1.5 rounded" style={{ backgroundColor: '#dcfce7', color: '#15803d' }}>📞</a>}
              {p.email && <a href={`mailto:${p.email}`} onClick={stop} className="text-[11px] font-bold px-1.5 rounded" style={{ backgroundColor: '#ede9fe', color: '#7c3aed' }}>✉️</a>}
            </span>
          </div>
        ))}
        {people.length > 2 && <p className="text-xs mb-1" style={{ color: '#bbb' }}>+{people.length - 2} more contact{people.length - 2 !== 1 ? 's' : ''}</p>}

        {/* Facts */}
        <div className="flex flex-wrap gap-1 mb-1.5">
          {shop.estimated_monthly && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#dcfce7', color: '#15803d' }}>~${shop.estimated_monthly}/mo</span>}
          {shop.volume_potential && <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#f5f3f0', color: '#666' }}>volume {shop.volume_potential}</span>}
          {drps.slice(0, 4).map(d => <span key={d} className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#eff6ff', color: '#1d4ed8' }}>DRP {d}</span>)}
          {shop.referral_source && <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#f5f3f0', color: '#888' }}>via {shop.referral_source}</span>}
          {calCount > 0 && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#fff7ed', color: '#c2410c' }}>🔧 {calCount} cal{calCount !== 1 ? 's' : ''}</span>}
          {shop.kinetic_in_bed && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#f3e8ff', color: '#7c3aed' }}>🛻 Kinetic in Bed</span>}
          {shop.pipeline_stage === 'active' && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#dcfce7', color: '#15803d' }}>✅ Active customer</span>}
        </div>

        {/* Where things stand */}
        {(shop.next_action || followupInfo) && (
          <div className="text-xs mb-1.5 px-2 py-1.5 rounded-lg" style={{ backgroundColor: followupInfo?.urgent ? '#fee2e2' : '#eff6ff', color: followupInfo?.urgent ? '#b91c1c' : '#1d4ed8' }}>
            {followupInfo && <b>📅 {followupInfo.label}</b>}{followupInfo && shop.next_action ? ' · ' : ''}{shop.next_action ? `→ ${shop.next_action}` : ''}
          </div>
        )}
        {lastTouchTxt && <p className="text-xs mb-1.5" style={{ color: '#999', fontStyle: 'italic' }}>Last: {lastTouchTxt}</p>}
        {humanNotes.map((line, i) => <p key={i} className="text-xs mb-0.5" style={{ color: '#666' }}>· {line}</p>)}

        {(shop.pipeline_stage === 'denied' || shop.pipeline_stage === 'active2') && (() => {
          const reasons = shop.pipeline_stage === 'denied' ? (Array.isArray(shop.denied_reasons) ? shop.denied_reasons : shop.denied_reason ? [shop.denied_reason] : []) : []
          return (
            <div className="flex flex-wrap items-center gap-1.5 mt-1 mb-1">
              {reasons.map(r => <span key={r} className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' }}>{r}</span>)}
              {reasons.length === 0 && shop.pipeline_stage === 'denied' && <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fee2e2', color: '#b91c1c' }}>🚫 Not interested right now</span>}
              {shop.pipeline_stage === 'active2' && !shop.denied_to && <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#e0f2fe', color: '#0369a1' }}>🔄 Backup · tag their primary</span>}
              {shop.denied_to && <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#f9f8f7', color: '#444', border: '1px solid #e0dbd6' }}>🏢 Uses {shop.denied_to}</span>}
            </div>
          )
        })()}

        {nextStage && (
          <button onClick={e => { e.stopPropagation(); onStageChange(shop, nextStage.id) }}
            className="w-full mt-2 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold"
            style={{ backgroundColor: nextStage.bg, color: nextStage.color, border: `1px solid ${nextStage.color}22` }}>
            Move to {nextStage.label} {nextStage.emoji}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────
function StatsBar({ shops }) {
  // Active customers = Active + Second Active
  const activeShops   = shops.filter(s => s.id === 'active' || s.pipeline_stage === 'active' || s.pipeline_stage === 'active2')
  const activeCount   = activeShops.length
  const activeRevenue = activeShops
    .filter(s => s.estimated_monthly)
    .reduce((sum, s) => sum + parseFloat(String(s.estimated_monthly).replace(/,/g, '') || 0), 0)

  // Pipeline = everyone being worked on but not yet active (excludes active, denied, lost)
  const pipelineStages = ['target', 'contacted', 'interested', 'proposal']
  const pipeline       = shops.filter(s => pipelineStages.includes(s.pipeline_stage))
  const pipelineVal    = pipeline
    .filter(s => s.estimated_monthly)
    .reduce((sum, s) => sum + parseFloat(String(s.estimated_monthly).replace(/,/g, '') || 0), 0)

  const overdueCount = shops.filter(isOverdue).length
  const todayCount   = shops.filter(isDueToday).length

  if (shops.length === 0) return null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {/* Active customers — show revenue if any, otherwise count */}
      <div className="p-3 rounded-xl" style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
        <p className="text-lg font-bold" style={{ color: '#15803d' }}>
          {activeRevenue > 0 ? `$${activeRevenue.toLocaleString()}/mo` : activeCount}
        </p>
        <p className="text-xs" style={{ color: '#888' }}>
          {activeRevenue > 0 ? `${activeCount} Active Customers` : 'Active Customers'}
        </p>
      </div>

      {/* Pipeline — everyone being pursued (Target → Proposal) */}
      <div className="p-3 rounded-xl" style={{ backgroundColor: '#fff7ed', border: '1px solid #fed7aa' }}>
        <p className="text-lg font-bold" style={{ color: ORANGE }}>
          {pipelineVal > 0 ? `$${pipelineVal.toLocaleString()}/mo` : pipeline.length}
        </p>
        <p className="text-xs" style={{ color: '#888' }}>
          {pipelineVal > 0 ? `${pipeline.length} In Pipeline` : 'In Pipeline'}
        </p>
      </div>

      {/* Overdue follow-ups */}
      <div className="p-3 rounded-xl"
        style={{ backgroundColor: overdueCount > 0 ? '#fee2e2' : '#f9f8f7', border: `1px solid ${overdueCount > 0 ? '#fca5a5' : '#ebebeb'}` }}>
        <p className="text-lg font-bold" style={{ color: overdueCount > 0 ? '#dc2626' : '#888' }}>{overdueCount}</p>
        <p className="text-xs" style={{ color: '#888' }}>Overdue Follow-ups</p>
      </div>

      {/* Due today */}
      <div className="p-3 rounded-xl"
        style={{ backgroundColor: todayCount > 0 ? '#fef3c7' : '#f9f8f7', border: `1px solid ${todayCount > 0 ? '#fde68a' : '#ebebeb'}` }}>
        <p className="text-lg font-bold" style={{ color: todayCount > 0 ? '#b45309' : '#888' }}>{todayCount}</p>
        <p className="text-xs" style={{ color: '#888' }}>Due Today</p>
      </div>
    </div>
  )
}

// ─── Main CRM Screen ──────────────────────────────────────────────────────────
export default function CRMScreen({ user, onLogout, currentScreen, onNavigate }) {
  // Mark 2026-09-14: repair customers live in the CRM too, but SEPARATE from
  // body shops — own table, own tab, never in the pipeline / marketing lists.
  const [crmMode, setCrmModeState] = useState(() => { try { return localStorage.getItem('adas_crm_mode') || 'shops' } catch { return 'shops' } })
  const setCrmMode = m => { setCrmModeState(m); try { localStorage.setItem('adas_crm_mode', m) } catch {} }
  const modeToggle = (
    <div className="inline-flex rounded-full p-0.5" style={{ backgroundColor: '#f5f3f0', border: '1px solid #e0dbd6' }}>
      {[['shops', '🏪 Body shops'], ['repair', '🙂 Repair customers']].map(([m, l]) => (
        <button key={m} onClick={() => setCrmMode(m)} className="text-xs font-bold rounded-full px-3 py-1" style={{ backgroundColor: crmMode === m ? ORANGE : 'transparent', color: crmMode === m ? 'white' : '#666' }}>{l}</button>
      ))}
    </div>
  )
  const [shops,         setShops]         = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  const [detailShop,    setDetailShop]    = useState(null)
  const [addingStage,   setAddingStage]   = useState(null)
  const [toast,         setToast]         = useState(null)
  const [search,        setSearch]        = useState('')
  const [stageFilter,   setStageFilter]   = useState('')
  const [big3Missing,   setBig3Missing]   = useState([])     // active shops with no Big 3 rule
  const [big3Only,      setBig3Only]      = useState(false)
  useEffect(() => {
    apiFetch(`${API_BASE}/api/shops/big3-map`).then(r => r.json()).then(d => { if (d.ok) setBig3Missing(d.missing || []) }).catch(() => {})
  }, [shops.length])
  const [regionFilter,  setRegionFilter]  = useState('')
  const [ownerFilter,   setOwnerFilter]   = useState('')
  const [staleOnly,     setStaleOnly]     = useState(false)
  const [gridOpen,      setGridOpen]      = useState(false)
  const [mondayOpen,    setMondayOpen]    = useState(false)
  const [discoverOpen,  setDiscoverOpen]  = useState(false)
  const [compFilter,    setCompFilter]    = useState('')
  const [nextPrompt,    setNextPrompt]    = useState(null)   // { shop, stage } waiting for a next action
  const [showOverdue,   setShowOverdue]   = useState(false)
  const [dragShop,      setDragShop]      = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)
  const [showImport,    setShowImport]    = useState(false)
  const [showFindShops, setShowFindShops] = useState(false)
  const [crmSyncing, setCrmSyncing] = useState(false)
  const [showBroadcast, setShowBroadcast] = useState(false)
  const [showVanContact, setShowVanContact] = useState(false)
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [syncing,       setSyncing]       = useState(false)
  const [calCounts,     setCalCounts]     = useState({})

  function showToast(msg, ok = false) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchShops = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/shops`)
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json()
      setShops(Array.isArray(data) ? data : [])
      setError(null)
    } catch (e) { setError(e.message) }
    finally    { setLoading(false)  }
  }, [])

  useEffect(() => { fetchShops() }, [fetchShops])

  // Fetch cal counts once on mount (job history is slow-changing, no need to reload)
  useEffect(() => {
    apiFetch(`${API_BASE}/api/shops/cal-counts`)
      .then(r => r.ok ? r.json() : {})
      .then(data => setCalCounts(data || {}))
      .catch(() => {})
  }, [])

  async function handleSave(form, originalShop) {
    const method = originalShop?.id ? 'PUT' : 'POST'
    const url    = originalShop?.id ? `${API_BASE}/api/shops/${originalShop.id}` : `${API_BASE}/api/shops`
    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Save failed') }
    await fetchShops()
    if (!originalShop?.id) { setAddingStage(null); showToast('Shop added!', true) }
    else showToast('Saved', true)
  }

  async function handleDelete(shop) {
    const res = await apiFetch(`${API_BASE}/api/shops/${shop.id}`, { method: 'DELETE' })
    if (!res.ok) { showToast('Delete failed'); return }
    setDetailShop(null)
    await fetchShops()
    showToast('Shop removed')
  }

  async function handleStageChange(shop, newStage, extra = null) {
    // Territory rules (2026-09-15): moving into an in-play stage needs a next follow-up + action;
    // the owner's in-play cap is a warning, not a wall.
    if (IN_PLAY_STAGES.includes(newStage) && !extra && !shop.next_followup) { setNextPrompt({ shop, stage: newStage }); return }
    if (IN_PLAY_STAGES.includes(newStage) && !IN_PLAY_STAGES.includes(shop.pipeline_stage)) { const o = ownerOf(shop); if (o && inPlayCount(shops, o) >= IN_PLAY_CAP) setToast(`⚠ ${o} already has ${IN_PLAY_CAP} in play — park something before adding more`) }
    setShops(prev => prev.map(s => s.id === shop.id ? { ...s, pipeline_stage: newStage, ...(extra || {}) } : s))
    try {
      const res = await apiFetch(`${API_BASE}/api/shops/${shop.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline_stage: newStage, ...(extra || {}) }),
      })
      if (!res.ok) throw new Error('Move failed')
      if (detailShop?.id === shop.id) setDetailShop(s => ({ ...s, pipeline_stage: newStage }))
    } catch (e) {
      setShops(prev => prev.map(s => s.id === shop.id ? shop : s))
      showToast(e.message)
    }
  }

  function onDragStart(e, shop)    { setDragShop(shop); e.dataTransfer.effectAllowed = 'move' }
  function onDragOver(e, stageId)  { e.preventDefault(); setDragOverStage(stageId) }
  async function onDrop(e, stageId) {
    e.preventDefault(); setDragOverStage(null)
    if (!dragShop || dragShop.pipeline_stage === stageId) { setDragShop(null); return }
    await handleStageChange(dragShop, stageId)
    setDragShop(null)
  }

  const overdueCount = shops.filter(isOverdue).length

  // Available regions from current shops
  const usedRegions = [...new Set(shops.map(s => s.region).filter(Boolean))].sort()

  const isTech = user?.role === 'technician'

  const filtered = shops.filter(s => {
    // Technicians only see shops assigned to them
    if (isTech && s.assigned_to !== user.techName) return false
    if (showOverdue && !isOverdue(s) && !isDueToday(s)) return false
    if (stageFilter  && s.pipeline_stage !== stageFilter)  return false
    if (big3Only && !big3Missing.some(m => m.id === s.id)) return false
    if (regionFilter && (regionFilter === 'unzoned' ? !!zoneOf(s) : zoneOf(s) !== regionFilter)) return false
    if (ownerFilter && ownerOf(s) !== ownerFilter)          return false
    if (compFilter && (s.denied_to || s.lost_to || '') !== compFilter) return false
    if (staleOnly && !((staleDays(s) || 0) > 0 && s.pipeline_stage !== 'target')) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const peopleMatch = (s.people || []).some(p =>
        (p.name || '').toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q))
      return (s.shop_name || '').toLowerCase().includes(q) ||
        (s.address || '').toLowerCase().includes(q) ||
        (s.notes || '').toLowerCase().includes(q) || peopleMatch
    }
    return true
  })

  const byStage = STAGES.reduce((acc, s) => {
    acc[s.id] = filtered.filter(sh => sh.pipeline_stage === s.id)
    return acc
  }, {})

  // Kanban only shows non-lost stages; Lost appears in mobile list + filter pill
  const kanbanStages = STAGES.filter(s => s.id !== 'lost')

  if (crmMode === 'repair') return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <RepairCustomers user={user} onNavigate={onNavigate} modeToggle={modeToggle} />
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'white' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

      <main className="flex-1 flex flex-col" style={{ padding: '1.25rem 1.25rem 0', minHeight: 0 }}>

        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap"><h1 className="text-xl font-bold" style={{ color: '#1a1a1a' }}>Sales Pipeline</h1>{modeToggle}</div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="8" stroke="#aaa" strokeWidth="2"/>
                <path d="M21 21l-4.35-4.35" stroke="#aaa" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search shops, people…"
                className="pl-8 pr-3 py-2 rounded-xl text-sm outline-none"
                style={{ border: '1px solid #e0dbd6', backgroundColor: 'white', width: '180px' }}
                onFocus={e => e.target.style.borderColor = ORANGE}
                onBlur={e => e.target.style.borderColor = '#e0dbd6'} />
            </div>

            {/* ➕ New Customer — shop, people, DRPs, Big 3 in one go (Mark 2026-09-10) */}
            <button onClick={() => setShowNewCustomer(true)}
              className="text-sm font-semibold px-4 py-2 rounded-xl flex items-center gap-1.5 text-white"
              style={{ backgroundColor: '#15803d' }}
              title="Add a new customer with contacts, DRPs and the Big 3 rule">
              ➕<span className="hidden sm:inline">New Customer</span>
            </button>

            {/* 🧾 Active shops with no Big 3 rule (Mark 2026-09-10) */}
            {big3Missing.length > 0 && (
              <button onClick={() => setBig3Only(v => !v)}
                className="text-sm font-semibold px-4 py-2 rounded-xl flex items-center gap-1.5"
                style={big3Only ? { backgroundColor: '#92400e', color: 'white' } : { backgroundColor: '#fef3c7', color: '#92400e', border: '1.5px solid #fde68a' }}
                title="Active customers whose Cal ID / PCSI / Post-Scan rule isn't set yet">
                🧾 {big3Missing.length} without Big 3 rule
              </button>
            )}

            {/* Van Contact — one-tap: adds to CRM shop record AND enrolls in Van newsletter */}
            <button onClick={() => setShowVanContact(true)}
              className="text-sm font-semibold px-4 py-2 rounded-xl flex items-center gap-1.5 text-white"
              style={{ backgroundColor: ORANGE }}
              title="Add a shop contact to CRM + Van newsletter">
              📨<span className="hidden sm:inline">Van Contact</span>
            </button>

            {/* Broadcast */}
            <button onClick={() => setShowBroadcast(true)}
              className="text-sm font-semibold px-4 py-2 rounded-xl flex items-center gap-1.5"
              style={{ border: `1.5px solid ${ORANGE}`, color: ORANGE, backgroundColor: 'white' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
              <span className="hidden sm:inline">Broadcast</span>
            </button>

            {/* Export */}
            <button onClick={() => exportToCSV(filtered)}
              className="text-sm font-semibold px-4 py-2 rounded-xl"
              style={{ border: '1.5px solid #e0dbd6', color: '#555', backgroundColor: 'white' }}>
              ↓ Export
            </button>

            {/* Sync from Zoho */}
            <button
              onClick={async () => {
                if (syncing) return
                setSyncing(true)
                try {
                  const res = await apiFetch(`${API_BASE}/api/shops/sync-customers`, { method: 'POST' })
                  const data = await res.json()
                  if (!res.ok) throw new Error(data.error || 'Sync failed')
                  await fetchShops()
                  showToast(`✅ Synced ${data.added} new shops (${data.skipped} already existed)`, true)
                } catch (e) {
                  showToast(`Sync error: ${e.message}`)
                } finally {
                  setSyncing(false)
                }
              }}
              disabled={syncing}
              className="text-sm font-semibold px-4 py-2 rounded-xl"
              style={{ border: '1.5px solid #e0dbd6', color: syncing ? '#bbb' : '#555', backgroundColor: 'white' }}>
              {syncing ? '⏳ Syncing…' : '⟳ Sync Zoho'}
            </button>

            {/* Sync to Zoho CRM */}
            <button onClick={async () => {
              setCrmSyncing(true)
              try {
                const res = await apiFetch(`${API_BASE}/api/crm-sync/run`, { method: 'POST' })
                const data = await res.json()
                if (data.ok) showToast(`Synced to Zoho CRM: ${data.created} created, ${data.updated} updated, ${data.converted} converted`, true)
                else showToast(data.error || 'Sync failed')
              } catch (e) { showToast(e.message || 'Sync failed') }
              setCrmSyncing(false)
            }}
              disabled={crmSyncing}
              className="text-sm font-semibold px-4 py-2 rounded-xl"
              style={{ border: `1.5px solid ${ORANGE}`, color: ORANGE, backgroundColor: 'white', opacity: crmSyncing ? 0.5 : 1 }}>
              {crmSyncing ? 'Syncing...' : 'Sync to Zoho'}
            </button>

            {/* Find Shops (Google Places) */}
            <button onClick={() => setShowFindShops(true)}
              className="text-sm font-semibold px-4 py-2 rounded-xl text-white"
              style={{ backgroundColor: ORANGE }}>
              Find Shops
            </button>

            {/* Import */}
            <button onClick={() => setShowImport(true)}
              className="text-sm font-semibold px-4 py-2 rounded-xl"
              style={{ border: `1.5px solid #e0dbd6`, color: '#555', backgroundColor: 'white' }}>
              ↑ Import
            </button>

            {/* Add Shop */}
            <button onClick={() => setAddingStage('target')}
              className="text-sm font-semibold px-4 py-2 rounded-xl text-white"
              style={{ backgroundColor: ORANGE }}>
              + Add Shop
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {!loading && !error && <StatsBar shops={shops} />}
        {!loading && !error && <SetupBanner shops={shops} isOwner={String(user?.email || '').toLowerCase().startsWith('mark@') || user?.role === 'owner'} onApplied={n => { setToast(`🗺 Zones and owners set on ${n} shops`); fetchShops() }} />}
        {!loading && !error && <InPlayBar shops={shops} isOwner={String(user?.email || '').toLowerCase().startsWith('mark@') || user?.role === 'owner'} gridOpen={gridOpen} onToggleGrid={() => setGridOpen(o => !o)} onMonday={() => setMondayOpen(true)} onDiscover={() => setDiscoverOpen(true)} />}
        {!loading && !error && filtered.length === 0 && shops.length > 0 && (
          <div className="rounded-xl px-3 py-2 mb-3 text-sm flex items-center justify-between gap-2 flex-wrap" style={{ backgroundColor: '#fffbeb', border: '1.5px solid #fde68a', color: '#92400e' }}>
            <span>No shops match {[regionFilter && (regionFilter === 'unzoned' ? 'No zone' : zoneLabel(regionFilter)), ownerFilter, stageFilter && (STAGES.find(x => x.id === stageFilter)?.label), showOverdue && 'Overdue', staleOnly && 'Gone quiet', compFilter && `uses ${compFilter}`, big3Only && 'No Big 3 rule', search.trim() && `"${search.trim()}"`].filter(Boolean).join(' + ') || 'these filters'}.</span>
            <button onClick={() => { setStageFilter(''); setRegionFilter(''); setShowOverdue(false); setOwnerFilter(''); setStaleOnly(false); setBig3Only(false); setSearch('') }} className="text-xs font-bold px-3 py-1 rounded-full" style={{ backgroundColor: '#92400e', color: 'white' }}>Clear filters</button>
          </div>
        )}
        {!loading && !error && gridOpen && <TerritoryGrid shops={shops} onPick={(z, st) => { setRegionFilter(z || 'unzoned'); setStageFilter(st); setShowOverdue(false); setGridOpen(false) }} />}

        {/* Filter pills */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {/* All */}
          <button onClick={() => { setStageFilter(''); setRegionFilter(''); setShowOverdue(false); setOwnerFilter(''); setStaleOnly(false); setBig3Only(false); setCompFilter('') }}
            className="text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0"
            style={!stageFilter && !showOverdue && !regionFilter
              ? { backgroundColor: ORANGE, color: 'white' }
              : { backgroundColor: '#f5f3f0', color: '#888' }}>
            All ({shops.length})
          </button>

          {/* Overdue */}
          {overdueCount > 0 && (
            <button onClick={() => { setShowOverdue(v => !v); setStageFilter(''); setRegionFilter('') }}
              className="text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0"
              style={showOverdue
                ? { backgroundColor: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5' }
                : { backgroundColor: '#f5f3f0', color: '#888' }}>
              ⚠️ Overdue ({overdueCount})
            </button>
          )}

          {/* Stage filters */}
          {STAGES.map(s => {
            const cnt = shops.filter(sh => sh.pipeline_stage === s.id).length
            if (cnt === 0) return null
            return (
              <button key={s.id} onClick={() => { setStageFilter(stageFilter === s.id ? '' : s.id); setShowOverdue(false) }}
                className="text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0"
                style={stageFilter === s.id
                  ? { backgroundColor: s.bg, color: s.color, border: `1px solid ${s.color}` }
                  : { backgroundColor: '#f5f3f0', color: '#666' }}>
                {s.emoji} {s.label} ({cnt})
              </button>
            )
          })}

          {/* Zone + owner filters (2026-09-15) */}
          {ZONES.map(z => { const n = shops.filter(sh => zoneOf(sh) === z.id).length; return (
            <button key={z.id} onClick={() => { setRegionFilter(regionFilter === z.id ? '' : z.id); setStageFilter(''); setShowOverdue(false); setStaleOnly(false); setBig3Only(false) }}
              className="text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0"
              style={regionFilter === z.id ? { backgroundColor: '#e0e7ff', color: '#3730a3', border: '1px solid #a5b4fc' } : { backgroundColor: '#f5f3f0', color: '#888' }}>
              📍 {z.label} ({n})
            </button>) })}
          {shops.some(sh => !zoneOf(sh)) && <button onClick={() => { setRegionFilter(regionFilter === 'unzoned' ? '' : 'unzoned'); setStageFilter(''); setShowOverdue(false); setStaleOnly(false); setBig3Only(false) }} className="text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0" style={regionFilter === 'unzoned' ? { backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' } : { backgroundColor: '#f5f3f0', color: '#888' }}>📍 No zone ({shops.filter(sh => !zoneOf(sh)).length})</button>}
          {TEAM_MEMBERS.map(o => (
            <button key={o} onClick={() => { setOwnerFilter(ownerFilter === o ? '' : o); setStageFilter(''); setShowOverdue(false) }} className="text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0"
              style={ownerFilter === o ? { backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #86efac' } : { backgroundColor: '#f5f3f0', color: '#888' }}>👤 {o}</button>
          ))}
          {(() => { const counts = {}; for (const sh of shops) { const c = sh.denied_to || sh.lost_to; if (c) counts[c] = (counts[c] || 0) + 1 } return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
            <button key={c} onClick={() => { setCompFilter(compFilter === c ? '' : c); setStageFilter(''); setShowOverdue(false) }} className="text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0" style={compFilter === c ? { backgroundColor: '#1a1a1a', color: 'white' } : { backgroundColor: '#f5f3f0', color: '#888' }}>🏢 {c} ({n})</button>
          )) })()}
          <button onClick={() => setStaleOnly(v => !v)} className="text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0" style={staleOnly ? { backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' } : { backgroundColor: '#f5f3f0', color: '#888' }}>⏰ Gone quiet ({shops.filter(sh => (staleDays(sh) || 0) > 0 && sh.pipeline_stage !== 'target' && !['lost', 'denied'].includes(sh.pipeline_stage)).length})</button>
        </div>

        {loading && (
          <div className="flex items-center justify-center h-48 gap-3">
            <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#e0dbd6" strokeWidth="3"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke={ORANGE} strokeWidth="3" strokeLinecap="round"/>
            </svg>
            <span className="text-sm text-gray-400">Loading pipeline…</span>
          </div>
        )}
        {!loading && error && (
          <div className="px-4 py-3 rounded-xl text-sm mb-4"
            style={{ backgroundColor: '#fff0ed', border: '1px solid #e8c5b0', color: ORANGE }}>
            Could not load pipeline: {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Desktop Kanban (non-lost stages only) */}
            <div className="hidden md:flex flex-1 gap-4 overflow-x-auto pb-6" style={{ alignItems: 'flex-start' }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverStage(null) }}>
              {kanbanStages.map(stage => {
                const stageShops = byStage[stage.id] || []
                const isOver = dragOverStage === stage.id
                return (
                  <div key={stage.id} className="flex flex-col flex-shrink-0" style={{ width: '264px' }}
                    onDragOver={e => onDragOver(e, stage.id)} onDrop={e => onDrop(e, stage.id)}>
                    <div className="rounded-xl px-3 py-2.5 mb-3 flex items-center justify-between"
                      style={{ backgroundColor: stage.bg, border: `1px solid ${stage.color}33` }}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold" style={{ color: stage.color }}>{stage.emoji} {stage.label}</span>
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: `${stage.color}22`, color: stage.color }}>{stageShops.length}</span>
                      </div>
                      <button onClick={() => setAddingStage(stage.id)}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-lg font-bold hover:opacity-70"
                        style={{ color: stage.color, backgroundColor: `${stage.color}22` }}>+</button>
                    </div>
                    <div className="flex-1 rounded-xl p-2 space-y-2 min-h-24 transition-colors"
                      style={{ backgroundColor: isOver ? `${stage.color}11` : '#f9f8f7',
                        border: isOver ? `2px dashed ${stage.color}` : '2px dashed transparent' }}>
                      {stageShops.map(shop => (
                        <ShopCard key={shop.id} shop={shop} onOpen={setDetailShop}
                          onStageChange={handleStageChange} onDragStart={onDragStart}
                          calCount={calCounts[(shop.shop_name || '').toLowerCase()] || 0} />
                      ))}
                      {stageShops.length === 0 && (
                        <div className="flex items-center justify-center h-16">
                          <span className="text-xs text-gray-300">No shops</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Lost column on desktop — compact / collapsible */}
              {(() => {
                const lostShops = byStage['lost'] || []
                const lostStage = STAGES.find(s => s.id === 'lost')
                if (lostShops.length === 0 && !stageFilter) return null
                return (
                  <div className="flex flex-col flex-shrink-0" style={{ width: '200px', opacity: 0.7 }}
                    onDragOver={e => onDragOver(e, 'lost')} onDrop={e => onDrop(e, 'lost')}>
                    <div className="rounded-xl px-3 py-2.5 mb-3"
                      style={{ backgroundColor: lostStage.bg, border: `1px solid ${lostStage.color}33` }}>
                      <span className="text-sm font-bold" style={{ color: lostStage.color }}>
                        {lostStage.emoji} {lostStage.label} ({lostShops.length})
                      </span>
                    </div>
                    <div className="flex-1 rounded-xl p-2 space-y-2 min-h-16"
                      style={{ backgroundColor: dragOverStage === 'lost' ? '#f3f4f6' : '#fafafa',
                        border: dragOverStage === 'lost' ? '2px dashed #9ca3af' : '2px dashed transparent' }}>
                      {lostShops.slice(0, 5).map(shop => (
                        <div key={shop.id} onClick={() => setDetailShop(shop)}
                          className="p-2 rounded-lg cursor-pointer hover:bg-gray-50"
                          style={{ border: '1px solid #ebebeb', backgroundColor: 'white' }}>
                          <p className="text-xs font-medium truncate" style={{ color: '#888' }}>{shop.shop_name}</p>
                          {shop.lost_reason && <p className="text-xs truncate" style={{ color: '#bbb' }}>{shop.lost_reason}</p>}
                        </div>
                      ))}
                      {lostShops.length > 5 && (
                        <p className="text-xs text-center" style={{ color: '#bbb' }}>+{lostShops.length - 5} more</p>
                      )}
                      {lostShops.length === 0 && (
                        <div className="flex items-center justify-center h-10">
                          <span className="text-xs text-gray-300">Drop here</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* Mobile list */}
            <div className="md:hidden flex-1 overflow-y-auto pb-6">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-2">
                  <span className="text-3xl">🎯</span>
                  <p className="text-sm font-medium" style={{ color: '#333' }}>No shops</p>
                  <button onClick={() => setAddingStage('target')}
                    className="mt-2 text-sm font-semibold px-4 py-2 rounded-xl text-white"
                    style={{ backgroundColor: ORANGE }}>+ Add Shop</button>
                </div>
              ) : (
                STAGES.filter(s => !stageFilter || s.id === stageFilter).map(stage => {
                  const stageShops = byStage[stage.id] || []
                  if (stageShops.length === 0) return null
                  return (
                    <div key={stage.id} className="mb-5">
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: stage.color }}>
                          {stage.emoji} {stage.label}
                        </span>
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: stage.bg, color: stage.color }}>{stageShops.length}</span>
                      </div>
                      <div className="space-y-3">
                        {stageShops.map(shop => (
                          <ShopCard key={shop.id} shop={shop} onOpen={setDetailShop}
                            onStageChange={handleStageChange} onDragStart={onDragStart}
                            calCount={calCounts[(shop.shop_name || '').toLowerCase()] || 0} />
                        ))}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}
      </main>

      {/* Shop Detail Panel */}
      {detailShop && (
        <ShopDetailPanel
          shop={detailShop}
          user={user}
          onClose={() => setDetailShop(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}

      {/* Quick Add Modal */}
      {addingStage !== null && (
        <QuickAddModal
          defaultStage={addingStage}
          onClose={() => setAddingStage(null)}
          onSave={form => handleSave(form, {})}
        />
      )}

      {/* Import Modal */}
      {showImport && (
        <CRMImportModal
          existingShops={shops}
          onClose={() => setShowImport(false)}
          onImported={(count, dupes) => {
            fetchShops()
            showToast(dupes > 0
              ? `Imported ${count} shops (${dupes} duplicates skipped)`
              : `${count} shops imported!`, true)
          }} />
      )}

      {/* Find Shops (Google Places) Modal */}
      {showFindShops && (
        <GooglePlacesModal
          existingShops={shops}
          onImported={() => fetchShops()}
          onClose={() => setShowFindShops(false)} />
      )}

      {/* Broadcast Modal */}
      {showBroadcast && (
        <CRMBroadcastModal shops={shops} onClose={() => setShowBroadcast(false)} />
      )}

      {/* Van Contact Modal — CRM row + Van newsletter enrollment in one submit */}
      {showNewCustomer && (
        <NewCustomerModal
          onClose={() => setShowNewCustomer(false)}
          onCreated={() => fetchShops()}
        />
      )}

      {showVanContact && (
        <VanContactModal
          shops={shops}
          onClose={() => setShowVanContact(false)}
          onSaved={data => {
            const bits = [
              data.shop_created ? 'Shop added' : 'Shop updated',
              data.van_subscribed ? 'newsletter ✓' : (data.van_error ? 'newsletter skipped' : ''),
            ].filter(Boolean).join(' · ')
            showToast(`✅ ${data.shop_name} — ${bits}`, true)
            fetchShops()
          }}
        />
      )}

      {nextPrompt && <NextActionModal shop={nextPrompt.shop} stage={nextPrompt.stage} onCancel={() => setNextPrompt(null)} onConfirm={extra => { const p = nextPrompt; setNextPrompt(null); handleStageChange(p.shop, p.stage, extra) }} />}

      {discoverOpen && <DiscoverModal onClose={() => setDiscoverOpen(false)} onAdded={(n, d) => { setToast(`🔎 Added ${n} shops as Targets${d ? ` · ${d} already there` : ''}`); fetchShops() }} />}
        {mondayOpen && <MondayModal isOwner={String(user?.email || '').toLowerCase().startsWith('mark@') || user?.role === 'owner'} onClose={() => setMondayOpen(false)} onOpenShop={id => { const sh = shops.find(x => x.id === id); if (sh) { setMondayOpen(false); setDetailShop(sh) } }} />}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] px-4 py-2.5 rounded-2xl shadow-xl text-sm font-medium text-white"
          style={{ backgroundColor: toast.ok ? '#15803d' : '#1a1a1a', whiteSpace: 'nowrap' }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
