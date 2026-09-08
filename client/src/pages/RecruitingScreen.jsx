// Recruiting board (Mark 2026-09-07): the simple replacement for Zoho
// Recruit. Website form → candidate lands in New → drag/tap through the
// stages → notes, rating, call/text/email from the card.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import Navbar from '../components/Navbar'

const ORANGE = '#CD4419'
const APPLY_URL = `${API_BASE}/api/public/recruit/apply`
const STAGE_COLORS = {
  new: '#CD4419', contacted: '#b45309', phone_screen: '#1d4ed8', ride_along: '#7e22ce',
  offer: '#0e7490', hired: '#15803d', passed: '#6b7280',
}
const daysSince = iso => { const d = new Date(iso); return isNaN(d) ? '' : Math.floor((Date.now() - d) / 86400000) }
const digits = s => String(s || '').replace(/[^\d+]/g, '')

export default function RecruitingScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [stages, setStages] = useState([])
  const [cands, setCands] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState(null)      // candidate id in detail
  const [adding, setAdding] = useState(false)
  const [showEmbed, setShowEmbed] = useState(false)
  const [mobileStage, setMobileStage] = useState('active')
  const [dragId, setDragId] = useState(null)
  const [overStage, setOverStage] = useState(null)
  const [toast, setToast] = useState(null)
  const say = m => { setToast(m); setTimeout(() => setToast(null), 2600) }
  const isOwner = String(user?.email || '').toLowerCase().startsWith('mark@') || user?.role === 'owner'

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/api/recruit`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setStages(j.stages || []); setCands(j.candidates || []); setErr(null)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function patch(id, body, okMsg) {
    const prev = cands
    setCands(cs => cs.map(c => c.id === id ? { ...c, ...body } : c))
    try {
      const r = await apiFetch(`${API_BASE}/api/recruit/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      if (okMsg) say(okMsg)
    } catch (e) { setCands(prev); say(`Save failed: ${e.message}`) }
  }
  async function remove(id) {
    if (!window.confirm('Delete this candidate? This can\'t be undone.')) return
    try {
      const r = await apiFetch(`${API_BASE}/api/recruit/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      setCands(cs => cs.filter(c => c.id !== id)); setOpen(null); say('🗑 Deleted')
    } catch (e) { say(`Delete failed: ${e.message}`) }
  }

  const byStage = useMemo(() => Object.fromEntries(stages.map(s => [s.id, cands.filter(c => c.stage === s.id)])), [stages, cands])
  const activeStages = stages.filter(s => !['hired', 'passed'].includes(s.id))
  const current = cands.find(c => c.id === open)

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-7xl mx-auto px-4 py-5 pb-24">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h1 className="text-xl font-extrabold" style={{ color: '#1a1a1a' }}>🧑‍🔧 Recruiting</h1>
            <p className="text-xs" style={{ color: '#888' }}>{cands.length} candidates · {activeStages.reduce((n, s) => n + (byStage[s.id]?.length || 0), 0)} in play</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowEmbed(v => !v)} className="text-xs font-bold rounded-xl px-3 py-2.5" style={{ backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>🔗 Website form</button>
            <button onClick={() => setAdding(true)} className="text-sm font-bold rounded-xl px-4 py-2.5 text-white" style={{ backgroundColor: ORANGE }}>+ Add candidate</button>
          </div>
        </div>

        {showEmbed && (
          <div className="rounded-xl p-4 mb-4 text-sm" style={{ backgroundColor: 'white', border: '1px solid #e0dbd6' }}>
            <p className="font-bold mb-1" style={{ color: '#1a1a1a' }}>The application page</p>
            <p className="text-xs mb-2" style={{ color: '#666' }}>Applicants fill out <b>absoluteadas.com/careers</b>. Every submission emails you, pings your alerts, and lands here in <b>New</b>. The form posts to:</p>
            <code className="block text-[11px] rounded-lg px-3 py-2 break-all" style={{ backgroundColor: '#f5f3f0', color: '#444' }}>{APPLY_URL}</code>
          </div>
        )}

        {err && <p className="text-sm py-3" style={{ color: '#dc2626' }}>{err}</p>}
        {loading && <p className="text-sm text-center py-10" style={{ color: '#888' }}>Loading…</p>}

        {/* Mobile: stage chips + list */}
        {!loading && (
          <div className="md:hidden">
            <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2" style={{ scrollbarWidth: 'none' }}>
              {[{ id: 'active', label: 'In play', n: activeStages.reduce((n, s) => n + (byStage[s.id]?.length || 0), 0) },
                ...stages.map(s => ({ id: s.id, label: s.label, n: byStage[s.id]?.length || 0 }))].map(t => (
                <button key={t.id} onClick={() => setMobileStage(t.id)} className="text-xs font-bold rounded-full px-3 py-2 flex-shrink-0"
                  style={mobileStage === t.id ? { backgroundColor: STAGE_COLORS[t.id] || '#1a1a1a', color: 'white' } : { backgroundColor: 'white', border: '1px solid #e0dbd6', color: t.n ? '#1a1a1a' : '#bbb' }}>
                  {t.label} {t.n || ''}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {(mobileStage === 'active' ? cands.filter(c => !['hired', 'passed'].includes(c.stage)) : (byStage[mobileStage] || [])).map(c => (
                <CandidateCard key={c.id} c={c} stages={stages} onOpen={() => setOpen(c.id)} showStage={mobileStage === 'active'} />
              ))}
            </div>
          </div>
        )}

        {/* Desktop: columns */}
        {!loading && (
          <div className="hidden md:flex gap-3 overflow-x-auto pb-4" style={{ alignItems: 'flex-start' }}>
            {stages.map(s => (
              <div key={s.id} className="flex-shrink-0 flex flex-col" style={{ width: 250 }}
                onDragOver={e => { e.preventDefault(); setOverStage(s.id) }}
                onDragLeave={() => setOverStage(null)}
                onDrop={e => { e.preventDefault(); setOverStage(null); if (dragId) { patch(dragId, { stage: s.id }, `→ ${s.label}`); setDragId(null) } }}>
                <div className="rounded-xl px-3 py-2 mb-2 flex items-center justify-between" style={{ backgroundColor: STAGE_COLORS[s.id] || '#1a1a1a' }}>
                  <span className="text-white text-sm font-bold">{s.label}</span>
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,.25)', color: 'white' }}>{byStage[s.id]?.length || 0}</span>
                </div>
                <div className="rounded-xl p-2 flex flex-col gap-2 min-h-24" style={{ backgroundColor: overStage === s.id ? '#fdf3ef' : '#efece8', border: `2px dashed ${overStage === s.id ? ORANGE : 'transparent'}` }}>
                  {(byStage[s.id] || []).map(c => (
                    <div key={c.id} draggable onDragStart={() => setDragId(c.id)}>
                      <CandidateCard c={c} stages={stages} onOpen={() => setOpen(c.id)} />
                    </div>
                  ))}
                  {(byStage[s.id] || []).length === 0 && <p className="text-[11px] text-center py-3" style={{ color: '#c8c4c0' }}>drop here</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {current && (
        <CandidateModal c={current} stages={stages} isOwner={isOwner}
          onClose={() => setOpen(null)}
          onPatch={(body, msg) => patch(current.id, body, msg)}
          onDelete={() => remove(current.id)} />
      )}
      {adding && (
        <AddModal onClose={() => setAdding(false)} onSaved={c => { setCands(cs => [c, ...cs]); setAdding(false); say('✅ Candidate added') }} />
      )}
      {toast && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 text-white text-xs font-semibold rounded-full px-4 py-2 z-50" style={{ backgroundColor: '#1a1a1a' }}>{toast}</div>}
    </div>
  )
}

function CandidateCard({ c, stages, onOpen, showStage }) {
  const d = daysSince(c.updated_at || c.created_at)
  const stage = stages.find(s => s.id === c.stage)
  return (
    <div onClick={onOpen} className="bg-white rounded-xl p-3 cursor-pointer shadow-sm" style={{ border: `2px solid ${STAGE_COLORS[c.stage] || '#e0dbd6'}` }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold leading-snug" style={{ color: '#1a1a1a' }}>{c.name}</p>
        {c.rating > 0 && <span className="text-[11px] flex-shrink-0" style={{ color: '#f59e0b' }}>{'★'.repeat(c.rating)}</span>}
      </div>
      <p className="text-xs mt-0.5" style={{ color: '#666' }}>{[c.role, c.city].filter(Boolean).join(' · ') || 'No role given'}</p>
      {(c.experience || c.message) && <p className="text-xs mt-1.5" style={{ color: '#888' }}>{String(c.experience || c.message).slice(0, 90)}{String(c.experience || c.message).length > 90 ? '…' : ''}</p>}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#f5f3f0', color: '#888' }}>{c.source || 'manual'}</span>
        <span className="text-[10px]" style={{ color: '#aaa' }}>{showStage && stage ? `${stage.label} · ` : ''}{d === '' ? '' : d === 0 ? 'today' : `${d}d`}</span>
      </div>
    </div>
  )
}

function CandidateModal({ c, stages, isOwner, onClose, onPatch, onDelete }) {
  const [notes, setNotes] = useState(c.notes || '')
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({ name: c.name, phone: c.phone, email: c.email, city: c.city, role: c.role, certs: c.certs, availability: c.availability, resume_url: c.resume_url })
  const input = { border: '1px solid #e0dbd6', backgroundColor: 'white' }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ backgroundColor: 'rgba(0,0,0,.5)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5 overflow-y-auto" style={{ maxHeight: '92vh' }}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-lg font-extrabold" style={{ color: '#1a1a1a' }}>{c.name}</h2>
            <p className="text-xs" style={{ color: '#888' }}>{[c.role, c.city, c.source].filter(Boolean).join(' · ')} · applied {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button>
        </div>

        <div className="flex gap-2 mb-3 flex-wrap">
          {c.phone && <a href={`tel:${digits(c.phone)}`} className="text-xs font-bold rounded-lg px-3 py-2" style={{ backgroundColor: '#1a1a1a', color: 'white' }}>📞 Call</a>}
          {c.phone && <a href={`sms:${digits(c.phone)}`} className="text-xs font-bold rounded-lg px-3 py-2" style={{ backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>💬 Text</a>}
          {c.email && <a href={`mailto:${c.email}`} className="text-xs font-bold rounded-lg px-3 py-2" style={{ backgroundColor: '#f5f3f0', color: '#444', border: '1px solid #e0dbd6' }}>✉️ Email</a>}
          {c.resume_url && <a href={c.resume_url} target="_blank" rel="noreferrer" className="text-xs font-bold rounded-lg px-3 py-2" style={{ backgroundColor: '#f5f3f0', color: '#444', border: '1px solid #e0dbd6' }}>📄 Resume</a>}
          <span className="ml-auto text-lg" title="Rating">
            {[1, 2, 3, 4, 5].map(n => <button key={n} onClick={() => onPatch({ rating: c.rating === n ? 0 : n })} style={{ color: n <= c.rating ? '#f59e0b' : '#ddd' }}>★</button>)}
          </span>
        </div>

        <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#888' }}>Stage</p>
        <div className="flex gap-1.5 flex-wrap mb-4">
          {stages.map(s => (
            <button key={s.id} onClick={() => onPatch({ stage: s.id }, `→ ${s.label}`)} className="text-xs font-bold rounded-full px-3 py-1.5"
              style={c.stage === s.id ? { backgroundColor: STAGE_COLORS[s.id], color: 'white' } : { backgroundColor: 'white', border: '1px solid #e0dbd6', color: '#666' }}>{s.label}</button>
          ))}
        </div>

        {!edit ? (
          <div className="text-sm mb-3 grid grid-cols-2 gap-x-3 gap-y-1" style={{ color: '#374151' }}>
            <div><span style={{ color: '#888' }}>Phone</span><br />{c.phone || '—'}</div>
            <div><span style={{ color: '#888' }}>Email</span><br /><span className="break-all">{c.email || '—'}</span></div>
            <div><span style={{ color: '#888' }}>Availability</span><br />{c.availability || '—'}</div>
            <div><span style={{ color: '#888' }}>Certs / licenses</span><br />{c.certs || '—'}</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['city', 'City'], ['role', 'Role'], ['certs', 'Certs'], ['availability', 'Availability'], ['resume_url', 'Resume link']].map(([k, ph]) => (
              <input key={k} value={f[k] || ''} onChange={e => setF({ ...f, [k]: e.target.value })} placeholder={ph} className="rounded-lg px-3 py-2 text-sm" style={input} />
            ))}
          </div>
        )}
        {(c.experience || c.message) && !edit && (
          <div className="rounded-lg p-3 mb-3 text-sm whitespace-pre-wrap" style={{ backgroundColor: '#f9f8f7', color: '#374151' }}>
            {c.experience && <><b>Experience:</b> {c.experience}{c.message ? '\n\n' : ''}</>}
            {c.message && <><b>Message:</b> {c.message}</>}
          </div>
        )}

        <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#888' }}>Your notes</p>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => notes !== c.notes && onPatch({ notes }, '📝 Notes saved')}
          rows={4} placeholder="Phone screen went well, knows Autel, can start in 2 weeks…" className="w-full rounded-lg px-3 py-2 text-sm mb-3" style={input} />

        <div className="flex gap-2">
          {!edit ? (
            <button onClick={() => setEdit(true)} className="text-xs font-bold rounded-lg px-3 py-2" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>✎ Edit details</button>
          ) : (
            <button onClick={() => { onPatch(f, '✅ Saved'); setEdit(false) }} className="text-xs font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: ORANGE }}>Save details</button>
          )}
          {isOwner && <button onClick={onDelete} className="text-xs font-bold rounded-lg px-3 py-2 ml-auto" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>Delete</button>}
        </div>
      </div>
    </div>
  )
}

function AddModal({ onClose, onSaved }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', city: '', role: 'ADAS Technician', source: 'referral', experience: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const input = { border: '1px solid #e0dbd6', backgroundColor: 'white' }
  async function save() {
    if (!f.name.trim()) { setErr('Name is required'); return }
    setSaving(true); setErr(null)
    try {
      const r = await apiFetch(`${API_BASE}/api/recruit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      onSaved(j.candidate)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ backgroundColor: 'rgba(0,0,0,.5)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-3"><h2 className="text-base font-bold">+ Add candidate</h2><button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button></div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          {[['name', 'Name *'], ['phone', 'Phone'], ['email', 'Email'], ['city', 'City'], ['role', 'Role'], ['source', 'Where from (referral, Indeed…)']].map(([k, ph]) => (
            <input key={k} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} placeholder={ph} className="rounded-lg px-3 py-2.5 text-sm" style={input} />
          ))}
        </div>
        <textarea value={f.experience} onChange={e => setF({ ...f, experience: e.target.value })} rows={3} placeholder="Experience / how you met them" className="w-full rounded-lg px-3 py-2.5 text-sm mb-3" style={input} />
        {err && <p className="text-xs mb-2" style={{ color: '#dc2626' }}>{err}</p>}
        <button onClick={save} disabled={saving} className="w-full py-3 rounded-xl font-bold text-white text-sm" style={{ backgroundColor: saving ? '#e5a58e' : ORANGE }}>{saving ? 'Saving…' : 'Add to New'}</button>
      </div>
    </div>
  )
}
