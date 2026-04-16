import { useState, useEffect } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import {
  STAGES, ACTIVITY_TYPES, TITLES,
  REFERRAL_SOURCES, LOST_REASONS, DENIED_REASONS, REGIONS, TEAM_MEMBERS, DEFAULT_COMPETITORS,
} from './crmConstants.js'
import CRMTemplatesModal from './CRMTemplatesModal.jsx'
import BillingRulesEditor from './books/BillingRulesEditor.jsx'

const ORANGE = '#CD4419'

function newPerson() {
  return { id: `p_${Date.now()}_${Math.random().toString(36).slice(2,5)}`, name: '', title: '', phone: '', email: '' }
}

function newActivity(type = 'call') {
  return { id: `act_${Date.now()}_${Math.random().toString(36).slice(2,5)}`, type, note: '', date: new Date().toISOString() }
}

function formatDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs  = now - d
    const diffMin = Math.floor(diffMs / 60000)
    const diffHr  = Math.floor(diffMs / 3600000)
    const diffDay = Math.floor(diffMs / 86400000)
    if (diffMin < 1)   return 'Just now'
    if (diffMin < 60)  return `${diffMin}m ago`
    if (diffHr  < 24)  return `${diffHr}h ago`
    if (diffDay < 7)   return `${diffDay}d ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: diffDay > 365 ? 'numeric' : undefined })
  } catch { return iso }
}

// ─── Lost Section ─────────────────────────────────────────────────────────────
// Shown inside InfoTab when stage = 'lost'. Tracks reason + which competitor has the shop.
function LostSection({ form, setField }) {
  const [newComp, setNewComp] = useState('')
  const [adding,  setAdding]  = useState(false)

  // competitors list = DEFAULT_COMPETITORS + any custom ones saved on the shop
  const customComps = Array.isArray(form.custom_competitors) ? form.custom_competitors : []
  const allComps    = [...DEFAULT_COMPETITORS, ...customComps]

  function selectCompetitor(name) {
    setField('lost_to', form.lost_to === name ? '' : name)
  }

  function addCustom() {
    const n = newComp.trim()
    if (!n || allComps.includes(n)) { setAdding(false); setNewComp(''); return }
    const updated = [...customComps, n]
    setField('custom_competitors', updated)
    setField('lost_to', n)
    setNewComp('')
    setAdding(false)
  }

  return (
    <div className="p-3 rounded-xl space-y-3" style={{ backgroundColor: '#f9f8f7', border: '1px solid #ebebeb' }}>
      {/* Lost reason */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Lost Reason</label>
        <select className="w-full border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none"
          style={{ borderColor: '#e0dbd6' }}
          value={form.lost_reason || ''}
          onChange={e => setField('lost_reason', e.target.value)}>
          <option value="">Select reason…</option>
          {LOST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Who has them */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
          Who Has Them?
          <span className="normal-case font-normal ml-1" style={{ color: '#bbb' }}>tap to tag competitor</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {allComps.map(name => (
            <button key={name} onClick={() => selectCompetitor(name)}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-all"
              style={form.lost_to === name
                ? { backgroundColor: '#fee2e2', color: '#dc2626', borderColor: '#fca5a5' }
                : { backgroundColor: 'white', color: '#555', borderColor: '#e0dbd6' }}>
              {form.lost_to === name ? '✓ ' : ''}{name}
            </button>
          ))}
          {!adding && (
            <button onClick={() => setAdding(true)}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-full border"
              style={{ backgroundColor: 'white', color: '#aaa', borderColor: '#e0dbd6', borderStyle: 'dashed' }}>
              + Add
            </button>
          )}
        </div>
        {adding && (
          <div className="flex gap-2 mt-2">
            <input autoFocus
              className="flex-1 border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none bg-white"
              style={{ borderColor: '#e0dbd6' }}
              value={newComp}
              onChange={e => setNewComp(e.target.value)}
              onKeyDown={e => e.key === 'Enter' ? addCustom() : e.key === 'Escape' && setAdding(false)}
              placeholder="Competitor name…" />
            <button onClick={addCustom}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
              style={{ backgroundColor: ORANGE }}>Add</button>
            <button onClick={() => { setAdding(false); setNewComp('') }}
              className="text-xs px-2 py-1.5 rounded-lg"
              style={{ color: '#888', backgroundColor: '#efefef' }}>✕</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Denied Section ────────────────────────────────────────────────────────────
// Shown inside InfoTab when stage = 'denied'. Tracks denial reason + who they currently use.
function DeniedSection({ form, setField }) {
  const [newComp, setNewComp] = useState('')
  const [adding,  setAdding]  = useState(false)

  const customComps = Array.isArray(form.custom_competitors) ? form.custom_competitors : []
  const allComps    = [...DEFAULT_COMPETITORS, ...customComps]

  function selectCompetitor(name) {
    setField('denied_to', form.denied_to === name ? '' : name)
  }

  function addCustom() {
    const n = newComp.trim()
    if (!n || allComps.includes(n)) { setAdding(false); setNewComp(''); return }
    const updated = [...customComps, n]
    setField('custom_competitors', updated)
    setField('denied_to', n)
    setNewComp('')
    setAdding(false)
  }

  const selectedReasons = Array.isArray(form.denied_reasons) ? form.denied_reasons : (form.denied_reason ? [form.denied_reason] : [])
  function toggleReason(r) {
    const next = selectedReasons.includes(r) ? selectedReasons.filter(x => x !== r) : [...selectedReasons, r]
    setField('denied_reasons', next)
  }

  return (
    <div className="p-3 rounded-xl space-y-3" style={{ backgroundColor: '#fff5f5', border: '1px solid #fecaca' }}>
      {/* Denied reasons — multi-select pills */}
      <div>
        <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color: '#b91c1c' }}>
          Denied Reason
          <span className="normal-case font-normal ml-1" style={{ color: '#bbb' }}>tap all that apply</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {DENIED_REASONS.map(r => (
            <button key={r} onClick={() => toggleReason(r)}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-all"
              style={selectedReasons.includes(r)
                ? { backgroundColor: '#fee2e2', color: '#b91c1c', borderColor: '#fca5a5' }
                : { backgroundColor: 'white', color: '#555', borderColor: '#e0dbd6' }}>
              {selectedReasons.includes(r) ? '✓ ' : ''}{r}
            </button>
          ))}
        </div>
      </div>

      {/* Who do they currently use */}
      <div>
        <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color: '#b91c1c' }}>
          Who Do They Currently Use?
          <span className="normal-case font-normal ml-1" style={{ color: '#bbb' }}>tap to tag</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {allComps.map(name => (
            <button key={name} onClick={() => selectCompetitor(name)}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-all"
              style={form.denied_to === name
                ? { backgroundColor: '#fee2e2', color: '#b91c1c', borderColor: '#fca5a5' }
                : { backgroundColor: 'white', color: '#555', borderColor: '#e0dbd6' }}>
              {form.denied_to === name ? '✓ ' : ''}{name}
            </button>
          ))}
          {!adding && (
            <button onClick={() => setAdding(true)}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-full border"
              style={{ backgroundColor: 'white', color: '#aaa', borderColor: '#e0dbd6', borderStyle: 'dashed' }}>
              + Add
            </button>
          )}
        </div>
        {adding && (
          <div className="flex gap-2 mt-2">
            <input autoFocus
              className="flex-1 border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none bg-white"
              style={{ borderColor: '#e0dbd6' }}
              value={newComp}
              onChange={e => setNewComp(e.target.value)}
              onKeyDown={e => e.key === 'Enter' ? addCustom() : e.key === 'Escape' && setAdding(false)}
              placeholder="Company name…" />
            <button onClick={addCustom}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
              style={{ backgroundColor: ORANGE }}>Add</button>
            <button onClick={() => { setAdding(false); setNewComp('') }}
              className="text-xs px-2 py-1.5 rounded-lg"
              style={{ color: '#888', backgroundColor: '#efefef' }}>✕</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Info Tab ─────────────────────────────────────────────────────────────────
function InfoTab({ form, setForm }) {
  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }
  const isLost   = form.pipeline_stage === 'lost'
  const isDenied = form.pipeline_stage === 'denied'

  return (
    <div className="space-y-4">

      {/* Stage */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Stage</label>
        <div className="flex flex-wrap gap-2">
          {STAGES.map(s => (
            <button key={s.id} onClick={() => setField('pipeline_stage', s.id)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full border transition-all"
              style={form.pipeline_stage === s.id
                ? { backgroundColor: s.bg, color: s.color, borderColor: s.color }
                : { backgroundColor: 'transparent', color: '#888', borderColor: '#ddd' }}>
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lost details — only when Lost is selected */}
      {isLost && (
        <LostSection form={form} setField={setField} />
      )}

      {/* Denied details — only when Denied is selected */}
      {isDenied && (
        <DeniedSection form={form} setField={setField} />
      )}

      {/* Shop Name */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Shop Name *</label>
        <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
          style={{ borderColor: '#e0dbd6' }}
          value={form.shop_name} onChange={e => setField('shop_name', e.target.value)}
          placeholder="Prestige Auto Body" />
      </div>

      {/* Phone + Email */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Phone</label>
          <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: '#e0dbd6' }}
            type="tel" value={form.phone || ''} onChange={e => setField('phone', e.target.value)}
            placeholder="(555) 555-5555" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Email</label>
          <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: '#e0dbd6' }}
            type="email" value={form.email || ''} onChange={e => setField('email', e.target.value)}
            placeholder="info@shop.com" />
        </div>
      </div>

      {/* Address */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Address</label>
        <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
          style={{ borderColor: '#e0dbd6' }}
          value={form.address || ''} onChange={e => setField('address', e.target.value)}
          placeholder="123 Main St, Dallas TX" />
      </div>

      {/* Region + Assigned To */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Region</label>
          <select className="w-full border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none"
            style={{ borderColor: '#e0dbd6' }}
            value={form.region || ''}
            onChange={e => setField('region', e.target.value)}>
            <option value="">— Select —</option>
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Assigned To</label>
          <select className="w-full border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none"
            style={{ borderColor: '#e0dbd6' }}
            value={form.assigned_to || ''}
            onChange={e => setField('assigned_to', e.target.value)}>
            <option value="">— Select —</option>
            {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Est. Monthly + Volume Potential */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Est. Monthly $</label>
          <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: '#e0dbd6' }}
            value={form.estimated_monthly || ''} onChange={e => setField('estimated_monthly', e.target.value)}
            placeholder="2,500" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Volume</label>
          <select className="w-full border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none"
            style={{ borderColor: '#e0dbd6' }}
            value={form.volume_potential || ''}
            onChange={e => setField('volume_potential', e.target.value)}>
            <option value="">— Select —</option>
            <option value="low">Low (1-5/mo)</option>
            <option value="medium">Medium (6-15/mo)</option>
            <option value="high">High (15+/mo)</option>
          </select>
        </div>
      </div>

      {/* Shop Discount % + Insurance Rate */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Shop Discount %</label>
          <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: '#e0dbd6' }}
            value={form.shop_rate || ''} onChange={e => setField('shop_rate', e.target.value)}
            placeholder="20" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Insurance Rate</label>
          <p className="text-xs text-gray-400 mb-1">(full retail — 0% discount)</p>
          <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: '#e0dbd6' }}
            value={form.insurance_rate || ''} onChange={e => setField('insurance_rate', e.target.value)}
            placeholder="0" />
        </div>
      </div>

      {/* Equipment Flags */}
      <div className="p-3 rounded-xl" style={{ backgroundColor: '#f9f8f7', border: '1px solid #ebebeb' }}>
        <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Equipment</label>
        <button
          type="button"
          onClick={() => setField('kinetic_in_bed', !form.kinetic_in_bed)}
          className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-xl border transition-all"
          style={form.kinetic_in_bed
            ? { backgroundColor: '#faf5ff', borderColor: '#7c3aed', color: '#7c3aed' }
            : { backgroundColor: '#fff', borderColor: '#e0dbd6', color: '#888' }}>
          <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
            style={{ backgroundColor: form.kinetic_in_bed ? '#7c3aed' : '#e0dbd6' }}>
            {form.kinetic_in_bed ? '✓' : ''}
          </div>
          <span className="text-sm font-medium">Kinetic in Bed</span>
          {form.kinetic_in_bed && (
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: '#f3e8ff', color: '#7c3aed' }}>YES</span>
          )}
        </button>
      </div>

      {/* Referral Source */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">How They Found Us</label>
        <select className="w-full border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none"
          style={{ borderColor: '#e0dbd6' }}
          value={form.referral_source || ''}
          onChange={e => setField('referral_source', e.target.value)}>
          <option value="">— Select —</option>
          {REFERRAL_SOURCES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Follow-up dates */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Last Contact</label>
          <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: '#e0dbd6' }}
            type="date" value={form.last_contact || ''} onChange={e => setField('last_contact', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Next Follow-Up</label>
          <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: '#e0dbd6' }}
            type="date" value={form.next_followup || ''} onChange={e => setField('next_followup', e.target.value)} />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Notes</label>
        <textarea className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none resize-none"
          style={{ borderColor: '#e0dbd6' }}
          rows={3} value={form.notes || ''} onChange={e => setField('notes', e.target.value)}
          placeholder="Gate code, parking, special instructions…" />
      </div>
    </div>
  )
}

// ─── People Tab ───────────────────────────────────────────────────────────────
function PeopleTab({ people, onChange }) {
  const [expandedId, setExpandedId] = useState(null)

  function addPerson() {
    const p = newPerson()
    onChange([...people, p])
    setExpandedId(p.id)
  }
  function updatePerson(id, field, val) { onChange(people.map(p => p.id === id ? { ...p, [field]: val } : p)) }
  function removePerson(id) { onChange(people.filter(p => p.id !== id)); if (expandedId === id) setExpandedId(null) }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {people.length} {people.length === 1 ? 'Person' : 'People'}
        </p>
        <button onClick={addPerson}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{ backgroundColor: '#fff4f0', color: ORANGE, border: `1px solid #f5cfc3` }}>
          + Add Person
        </button>
      </div>

      {people.length === 0 && (
        <div className="text-center py-10 rounded-2xl" style={{ backgroundColor: '#fafafa', border: '1px dashed #e8e8e8' }}>
          <p className="text-2xl mb-1">👤</p>
          <p className="text-sm font-medium text-gray-400">No contacts yet</p>
          <button onClick={addPerson} className="mt-2 text-xs font-semibold" style={{ color: ORANGE }}>
            + Add first person
          </button>
        </div>
      )}

      <div className="space-y-2">
        {people.map(p => (
          <div key={p.id} className="rounded-xl overflow-hidden" style={{ border: '1px solid #ebebeb' }}>
            <div className="flex items-center gap-2.5 px-3 py-3 cursor-pointer"
              style={{ backgroundColor: expandedId === p.id ? '#fafafa' : 'white' }}
              onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                style={{ backgroundColor: ORANGE }}>
                {p.name ? p.name.charAt(0).toUpperCase() : '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: p.name ? '#1a1a1a' : '#bbb' }}>
                  {p.name || 'New Person'}
                </p>
                <p className="text-xs" style={{ color: '#888' }}>{p.title || 'No title'}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                {p.phone && <>
                  <a href={`tel:${p.phone}`}
                    className="w-8 h-8 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: '#e8f5e9', color: '#15803d' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.6 19.79 19.79 0 0 1 1.58 5.1 2 2 0 0 1 3.54 3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                    </svg>
                  </a>
                  <a href={`sms:${p.phone}`}
                    className="w-8 h-8 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: '#e8f0fe', color: '#1d4ed8' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                  </a>
                </>}
                {p.email && (
                  <a href={`mailto:${p.email}`}
                    className="w-8 h-8 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: '#ede9fe', color: '#7c3aed' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                  </a>
                )}
              </div>
            </div>

            {expandedId === p.id && (
              <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid #f0eeec', backgroundColor: '#fafafa' }}>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Name</label>
                    <input className="w-full border rounded-lg px-2.5 py-2 text-sm bg-white focus:outline-none"
                      style={{ borderColor: '#e0dbd6' }}
                      value={p.name} onChange={e => updatePerson(p.id, 'name', e.target.value)}
                      placeholder="Mike Johnson" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Title</label>
                    <select className="w-full border rounded-lg px-2.5 py-2 text-sm bg-white focus:outline-none"
                      style={{ borderColor: '#e0dbd6' }}
                      value={p.title} onChange={e => updatePerson(p.id, 'title', e.target.value)}>
                      <option value="">Select…</option>
                      {TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Phone</label>
                    <input className="w-full border rounded-lg px-2.5 py-2 text-sm bg-white focus:outline-none"
                      style={{ borderColor: '#e0dbd6' }}
                      type="tel" value={p.phone} onChange={e => updatePerson(p.id, 'phone', e.target.value)}
                      placeholder="(555) 555-5555" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Email</label>
                    <input className="w-full border rounded-lg px-2.5 py-2 text-sm bg-white focus:outline-none"
                      style={{ borderColor: '#e0dbd6' }}
                      type="email" value={p.email} onChange={e => updatePerson(p.id, 'email', e.target.value)}
                      placeholder="mike@shop.com" />
                  </div>
                </div>
                <button onClick={() => removePerson(p.id)} className="text-xs text-red-400 hover:text-red-600 pt-1">
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Activity Tab ─────────────────────────────────────────────────────────────
function ActivityTab({ activities, onChange }) {
  const [addingType, setAddingType] = useState(null)
  const [noteText,   setNoteText]   = useState('')

  function logActivity() {
    if (!addingType) return
    const act = newActivity(addingType)
    act.note = noteText.trim()
    onChange([...activities, act])
    setAddingType(null)
    setNoteText('')
  }

  function removeActivity(id) { onChange(activities.filter(a => a.id !== id)) }

  const sorted = [...activities].sort((a, b) => new Date(b.date) - new Date(a.date))

  return (
    <div>
      {/* Quick-log buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        {ACTIVITY_TYPES.map(t => (
          <button key={t.id}
            onClick={() => setAddingType(addingType === t.id ? null : t.id)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl transition-all"
            style={addingType === t.id
              ? { backgroundColor: t.bg, color: t.color, border: `1.5px solid ${t.color}` }
              : { backgroundColor: '#f5f3f0', color: '#555', border: '1.5px solid transparent' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Note input */}
      {addingType && (
        <div className="mb-4 p-3 rounded-xl" style={{ backgroundColor: '#fafafa', border: '1px solid #ebebeb' }}>
          <textarea
            autoFocus
            className="w-full text-sm focus:outline-none resize-none bg-transparent"
            rows={2}
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder={`Notes about this ${addingType}… (optional)`}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) logActivity() }}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => { setAddingType(null); setNoteText('') }}
              className="text-xs px-3 py-1.5 rounded-lg font-medium"
              style={{ color: '#888', backgroundColor: '#efefef' }}>
              Cancel
            </button>
            <button onClick={logActivity}
              className="text-xs px-3 py-1.5 rounded-lg font-medium text-white"
              style={{ backgroundColor: ORANGE }}>
              Log {ACTIVITY_TYPES.find(t => t.id === addingType)?.label}
            </button>
          </div>
        </div>
      )}

      {/* Feed */}
      {sorted.length === 0 ? (
        <div className="text-center py-10 rounded-2xl" style={{ backgroundColor: '#fafafa', border: '1px dashed #e8e8e8' }}>
          <p className="text-2xl mb-1">📋</p>
          <p className="text-sm font-medium text-gray-400">No activity logged yet</p>
          <p className="text-xs mt-1 text-gray-300">Tap a button above to log your first interaction</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(act => {
            const t = ACTIVITY_TYPES.find(t => t.id === act.type) || ACTIVITY_TYPES[4]
            return (
              <div key={act.id} className="flex gap-3 p-3 rounded-xl group"
                style={{ backgroundColor: 'white', border: '1px solid #f0eeec' }}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-sm"
                  style={{ backgroundColor: t.bg }}>{t.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold" style={{ color: t.color }}>{t.label}</span>
                    <span className="text-xs" style={{ color: '#bbb' }}>{formatDate(act.date)}</span>
                  </div>
                  {act.note && <p className="text-xs mt-0.5" style={{ color: '#555' }}>{act.note}</p>}
                </div>
                <button onClick={() => removeActivity(act.id)}
                  className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all text-xs flex-shrink-0">
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Jobs Tab ─────────────────────────────────────────────────────────────────
function JobsTab({ shopName }) {
  const [jobs,    setJobs]    = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch(`${API_BASE}/api/jobs`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const matched = (Array.isArray(data) ? data : []).filter(j =>
          (j.shop_name || '').toLowerCase() === (shopName || '').toLowerCase()
        )
        setJobs(matched)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [shopName])

  if (loading) return (
    <div className="flex items-center justify-center py-12 gap-2">
      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#e0dbd6" strokeWidth="3"/>
        <path d="M12 2a10 10 0 0 1 10 10" stroke={ORANGE} strokeWidth="3" strokeLinecap="round"/>
      </svg>
      <span className="text-sm text-gray-400">Loading jobs…</span>
    </div>
  )

  if (jobs.length === 0) return (
    <div className="text-center py-10 rounded-2xl" style={{ backgroundColor: '#fafafa', border: '1px dashed #e8e8e8' }}>
      <p className="text-2xl mb-1">🔧</p>
      <p className="text-sm font-medium text-gray-400">No jobs for this shop yet</p>
    </div>
  )

  const completed = jobs.filter(j => j.status === 'complete').length

  return (
    <div>
      <div className="flex gap-4 mb-4">
        <div className="flex-1 p-3 rounded-xl text-center" style={{ backgroundColor: '#f9f8f7', border: '1px solid #ebebeb' }}>
          <p className="text-xl font-bold" style={{ color: ORANGE }}>{jobs.length}</p>
          <p className="text-xs" style={{ color: '#888' }}>Total Jobs</p>
        </div>
        <div className="flex-1 p-3 rounded-xl text-center" style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
          <p className="text-xl font-bold" style={{ color: '#15803d' }}>{completed}</p>
          <p className="text-xs" style={{ color: '#888' }}>Completed</p>
        </div>
      </div>
      <div className="space-y-2">
        {jobs.slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(job => {
          const vehicle   = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
          const isComplete = job.status === 'complete'
          return (
            <div key={job.id} className="p-3 rounded-xl" style={{ border: '1px solid #ebebeb', backgroundColor: isComplete ? '#f8fff9' : 'white' }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>{vehicle || 'Unknown vehicle'}</p>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={isComplete ? { backgroundColor: '#dcfce7', color: '#15803d' } : { backgroundColor: '#f5f3f0', color: '#888' }}>
                  {isComplete ? '✓ Done' : job.status?.replace(/_/g, ' ')}
                </span>
              </div>
              {job.technician && <p className="text-xs mt-0.5" style={{ color: '#888' }}>Tech: {job.technician}</p>}
              {(job.invoice_number || job.quote_number) && (
                <p className="text-xs mt-0.5" style={{ color: '#aaa' }}>
                  Job: {job.invoice_number || job.quote_number}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export default function ShopDetailPanel({ shop, onClose, onSave, onDelete }) {
  const [tab,          setTab]          = useState('info')
  const [form,         setForm]         = useState({
    ...shop,
    people:     Array.isArray(shop.people)     ? shop.people     : [],
    activities: Array.isArray(shop.activities) ? shop.activities : [],
    next_followup: shop.next_followup || '',
  })
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState(null)
  const [dirty,        setDirty]        = useState(false)
  const [showTemplates,setShowTemplates]= useState(false)

  function updateForm(updater) {
    setForm(updater)
    setDirty(true)
  }

  async function handleSave() {
    if (!form.shop_name?.trim()) { setError('Shop name is required'); return }
    setSaving(true); setError(null)
    try {
      await onSave(form, shop)
      setDirty(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const TABS = [
    { id: 'info',     label: 'Info' },
    { id: 'people',   label: `People${form.people.length > 0 ? ` (${form.people.length})` : ''}` },
    { id: 'activity', label: `Activity${form.activities.length > 0 ? ` (${form.activities.length})` : ''}` },
    { id: 'jobs',     label: 'Jobs' },
    { id: 'billing', label: 'Billing' },
  ]

  function confirmClose() {
    if (!dirty) { onClose(); return }
    if (window.confirm('Discard unsaved changes?')) onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={confirmClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex flex-col bg-white shadow-2xl"
        style={{ width: '100%', maxWidth: '480px' }}>

        {/* Header */}
        <div className="flex-shrink-0" style={{ borderBottom: '1px solid #ebebeb' }}>
          <div className="flex items-center gap-3 px-5 py-4">
            <button onClick={confirmClose}
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: '#f5f3f0', color: '#888' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M19 12H5M12 5l-7 7 7 7"/>
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold truncate" style={{ color: '#1a1a1a' }}>
                {form.shop_name || 'Shop'}
              </p>
              {form.address && <p className="text-xs truncate" style={{ color: '#888' }}>{form.address}</p>}
            </div>

            {/* Templates button */}
            <button onClick={() => setShowTemplates(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center gap-1.5 flex-shrink-0"
              style={{ backgroundColor: '#fff4f0', color: ORANGE, border: `1px solid #f5cfc3` }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Message
            </button>

            <button onClick={() => { if (window.confirm('Delete this shop?')) onDelete(shop) }}
              className="text-xs font-medium px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-50 flex-shrink-0">
              Delete
            </button>
          </div>

          {/* Tabs */}
          <div className="flex px-5 gap-0" style={{ borderTop: '1px solid #f5f3f0' }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="text-sm font-medium px-3 py-3 transition-colors relative"
                style={{
                  color: tab === t.id ? ORANGE : '#888',
                  borderBottom: tab === t.id ? `2px solid ${ORANGE}` : '2px solid transparent',
                }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'info' && (
            <InfoTab form={form} setForm={f => updateForm(typeof f === 'function' ? f : () => f)} />
          )}
          {tab === 'people' && (
            <PeopleTab
              people={form.people}
              onChange={people => updateForm(f => ({ ...f, people }))}
            />
          )}
          {tab === 'activity' && (
            <ActivityTab
              activities={form.activities}
              onChange={activities => updateForm(f => ({ ...f, activities }))}
            />
          )}
          {tab === 'jobs' && <JobsTab shopName={form.shop_name} />}
          {tab === 'billing' && (
            <BillingRulesEditor
              shop={form}
              onSave={updated => {
                setForm(f => ({ ...f, billing_rules: updated.billing_rules }))
              }}
            />
          )}
        </div>

        {/* Footer */}
        {tab !== 'jobs' && tab !== 'billing' && (
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-4"
            style={{ borderTop: '1px solid #ebebeb' }}>
            {error && <p className="text-xs text-red-500 flex-1 mr-3">{error}</p>}
            {!error && <span />}
            <button onClick={handleSave} disabled={saving || !dirty}
              className="text-sm px-5 py-2.5 rounded-xl font-semibold text-white transition-opacity"
              style={{ backgroundColor: ORANGE, opacity: saving || !dirty ? 0.4 : 1 }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      {/* Templates modal — z-[70] to sit above panel */}
      {showTemplates && (
        <CRMTemplatesModal shop={form} onClose={() => setShowTemplates(false)} />
      )}
    </>
  )
}
