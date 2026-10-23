// 📇 Caller card (Mark 2026-10-05: "when customers text or call I want their CRM to
// just pop up"). One drawer, one server call (/api/voice/caller) — the shop, the
// contact, last jobs, open AR, last texts, Big 3 rule — with Open CRM · Open thread ·
// Add note. Unknown number → "Not in CRM" + Create. Right-side panel on desktop,
// bottom sheet on the phone. Opened by the live-call bar, the SMS thread, and the
// ?caller= deep link the push notification carries.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import JobRequestModal from './JobRequestModal.jsx'

const ORANGE = '#CD4419'
const TYPE = { body_shop: { label: '🏢 COLLISION', color: '#CD4419' }, repair_shop: { label: '🔧 REPAIR', color: '#0A0A0A' }, dealer: { label: '🚗 DEALER', color: '#B33A15' }, retail: { label: '🙂 RETAIL', color: '#1F8B8B' } }
const STAGE = { target: 'Not contacted', contacted: 'Contacted', interested: 'Shown interest', proposal: 'Free demo offered', active: '✅ Current customer', active2: '🔄 We are backup', denied: '🚫 Not interested', lost: '❌ Lost' }
const money = n => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const ago = iso => { if (!iso) return ''; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d}d ago` : d < 365 ? `${Math.floor(d / 30)}mo ago` : `${Math.floor(d / 365)}y ago` }
const fmtPhone = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p || '' }

export default function CallerDrawer({ phone, user, onClose, onNavigate, context = '' }) {
  const [card, setCard] = useState(null)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  // 📅 Book it from the call (Mark 2026-10-22: "people want to make an appointment").
  const [booking, setBooking] = useState(false)
  const [booked, setBooked] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    let alive = true
    setCard(null); setErr('')
    apiFetch(`${API_BASE}/api/voice/caller?phone=${encodeURIComponent(phone || '')}`)
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); if (alive) setCard(j) })
      .catch(e => alive && setErr(e.message))
    return () => { alive = false }
  }, [phone])

  const go = (screen, key, value) => { try { if (key) sessionStorage.setItem(key, value) } catch {} ; onNavigate && onNavigate(screen); onClose && onClose() }
  async function saveNote() {
    const t = note.trim(); if (!t || !card?.shop?.id) return
    setSaving(true); setSaved('')
    try {
      const r = await apiFetch(`${API_BASE}/api/voice/note`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: card.shop.id, text: t, context }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      setNote(''); setSaved('Saved to the CRM timeline')
    } catch (e) { setSaved(`⚠ ${e.message}`) } finally { setSaving(false) }
  }

  const shop = card?.shop
  const tb = shop ? (TYPE[shop.customer_type] || { label: '? type not set', color: '#888' }) : null
  const isTech = user?.role === 'technician'

  return (
    <div className="fixed inset-0 z-[60]" onClick={onClose}>
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
      <div onClick={e => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 sm:bottom-auto sm:left-auto sm:top-0 sm:right-0 sm:h-full sm:w-[420px] bg-white rounded-t-2xl sm:rounded-none shadow-2xl flex flex-col"
        style={{ maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #eee' }}>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#888' }}>📇 Caller{context ? ` · ${context}` : ''}</div>
            <div className="font-bold text-lg truncate" style={{ color: '#1a1a1a' }}>{card ? (shop?.shop_name || card.contact?.contact_name || 'Not in CRM') : '…'}</div>
            <div className="text-xs" style={{ color: '#666' }}>{card?.contact?.contact_name && shop ? `${card.contact.contact_name} · ` : ''}{fmtPhone(phone)}</div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {card && <button onClick={() => setBooking(true)} className="text-sm font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: '#CD4419' }}>📅 Create job</button>}
            <button onClick={onClose} className="text-xl px-2" style={{ color: '#888' }} aria-label="Close">✕</button>
          </div>
        </div>
        {booked && <div className="px-4 py-2 text-sm font-bold" style={{ backgroundColor: '#dcfce7', color: '#15803d' }}>{booked}</div>}

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
          {err && <div className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: '#fee2e2', color: '#b91c1c' }}>{err}</div>}
          {!card && !err && <div className="text-xs" style={{ color: '#888' }}>Looking them up…</div>}

          {card && !shop && (
            <div className="rounded-xl p-3" style={{ backgroundColor: '#fffbeb', border: '1.5px solid #fcd34d' }}>
              <div className="font-bold" style={{ color: '#92400e' }}>Not in the CRM</div>
              <div className="text-xs mt-1" style={{ color: '#92400e' }}>No shop or contact has this number.{card.texts?.length ? ` They have texted us ${card.texts.length} time${card.texts.length === 1 ? '' : 's'}.` : ''}</div>
              {!isTech && <button onClick={() => go('crm', 'adas_new_shop_phone', phone)} className="mt-2 text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ backgroundColor: '#15803d' }}>➕ Create in CRM</button>}
            </div>
          )}

          {shop && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'white', color: tb.color, border: `1px solid ${tb.color}` }}>{tb.label}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: shop.pipeline_stage === 'active' ? '#dcfce7' : '#f3f4f6', color: shop.pipeline_stage === 'active' ? '#15803d' : '#444' }}>{STAGE[shop.pipeline_stage] || shop.pipeline_stage || '—'}</span>
                {shop.address && <span className="text-[11px]" style={{ color: '#666' }}>{shop.address}</span>}
              </div>

              {card.big3 && (
                <div className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: '#f5f3f0' }}>
                  <span className="font-bold">Big 3:</span> Cal ID {card.big3.cal_id || '—'} · PCSI {card.big3.pcsi || '—'} · Post-scan {card.big3.post_scan || '—'}
                  {card.full_service ? <span> · <span className="font-bold" style={{ color: ORANGE }}>Full service ON</span></span> : null}
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg py-2" style={{ backgroundColor: '#f5f3f0' }}><div className="text-[10px] font-bold" style={{ color: '#888' }}>OPEN AR</div><div className="font-bold" style={{ color: card.ar?.overdue > 0 ? '#b91c1c' : '#1a1a1a' }}>{money(card.ar?.open)}</div>{card.ar?.overdue > 0 && <div className="text-[10px]" style={{ color: '#b91c1c' }}>{money(card.ar.overdue)} overdue</div>}</div>
                <div className="rounded-lg py-2" style={{ backgroundColor: '#f5f3f0' }}><div className="text-[10px] font-bold" style={{ color: '#888' }}>LAST INVOICE</div><div className="font-bold">{card.ar?.last_invoice ? ago(card.ar.last_invoice) : '—'}</div></div>
                <div className="rounded-lg py-2" style={{ backgroundColor: '#f5f3f0' }}><div className="text-[10px] font-bold" style={{ color: '#888' }}>12 MO</div><div className="font-bold">{card.ar?.count_12mo ?? 0} inv</div></div>
              </div>

              {card.jobs?.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#888' }}>Recent jobs</div>
                  {card.jobs.map(j => (
                    <button key={j.id} onClick={() => go('jobs', 'adas_open_job', j.id)} className="w-full text-left flex items-center justify-between gap-2 py-1.5" style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <span className="truncate">{j.vehicle || 'Vehicle'}{j.ro_number ? <span style={{ color: '#888' }}> · RO {j.ro_number}</span> : null}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#f5f3f0', color: '#444' }}>{String(j.status || '').replace(/_/g, ' ')}{j.when ? ` · ${ago(j.when)}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}

              {card.texts?.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#888' }}>Last texts</div>
                  {card.texts.map((t, i) => (
                    <div key={i} className="text-xs py-1" style={{ color: '#444' }}><span className="font-bold" style={{ color: t.direction === 'inbound' ? '#1F8B8B' : ORANGE }}>{t.direction === 'inbound' ? 'Them' : 'Us'}</span> · {ago(t.at)} — {t.body}</div>
                  ))}
                </div>
              )}

              {card.activities?.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#888' }}>CRM timeline</div>
                  {card.activities.map(a => <div key={a.id} className="text-xs py-1" style={{ color: '#444' }}>{ago(a.at)} · {a.by ? `${a.by}: ` : ''}{a.text}</div>)}
                </div>
              )}

              {!isTech && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#888' }}>Add a note</div>
                  <div className="flex gap-2">
                    <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveNote()} placeholder="What did they want?" className="flex-1 text-sm rounded-lg px-3 py-2" style={{ border: '1px solid #e0dbd6' }} />
                    <button onClick={saveNote} disabled={saving || !note.trim()} className="text-xs font-bold px-3 rounded-lg text-white" style={{ backgroundColor: ORANGE, opacity: saving || !note.trim() ? 0.6 : 1 }}>{saving ? '…' : 'Save'}</button>
                  </div>
                  {saved && <div className="text-[11px] mt-1" style={{ color: saved.startsWith('⚠') ? '#b91c1c' : '#15803d' }}>{saved}</div>}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 px-4 py-3" style={{ borderTop: '1px solid #eee' }}>
          {shop && !isTech && <button onClick={() => go('crm', 'adas_open_shop', shop.id)} className="flex-1 text-sm font-bold py-2 rounded-xl" style={{ color: '#1F8B8B', border: '1.5px solid #1F8B8B' }}>📇 Open CRM</button>}
          <button onClick={() => { try { sessionStorage.setItem('adas_skip_caller_card', '1') } catch {} ; go('sms', 'aa_sms_deeplink', phone) }} className="flex-1 text-sm font-bold py-2 rounded-xl" style={{ color: ORANGE, border: `1.5px solid ${ORANGE}` }}>💬 Open thread</button>
          <a href={`tel:${phone}`} className="text-sm font-bold py-2 px-4 rounded-xl text-white text-center" style={{ backgroundColor: '#15803d' }}>📞</a>
        </div>
      </div>
      {booking && (
        <div onClick={e => e.stopPropagation()}>
          <JobRequestModal
            mode="job"
            defaultShopName={shop?.shop_name || card?.contact?.contact_name || ''}
            onClose={() => setBooking(false)}
            onSubmit={async formData => {
              const notes = [formData.ro_number ? `RO# ${formData.ro_number}` : '', formData.notes || '', `📞 Booked from a call with ${fmtPhone(phone)}`].filter(Boolean).join('\n')
              const payload = {
                shop_name: formData.shop_name || '', year: formData.year || '', make: formData.make || '', model: formData.model || '',
                vehicle: [formData.year, formData.make, formData.model].filter(Boolean).join(' '), vin: formData.vin || formData.last_four_vin || '',
                technician: formData.technician || '', insurer: formData.insurer || '', notes, quote_number: formData.ro_number || '',
                scheduled_date: formData.scheduled_date || '', status: 'job_requested', calibrations: '[]', via_request: true, request_type: 'job',
              }
              const r = await apiFetch(`${API_BASE}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
              if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Could not create the job') }
              setBooking(false); setBooked(`✅ Job booked${formData.scheduled_date ? ` for ${formData.scheduled_date}` : ''} — it's on the board in Job Requested`)
            }}
          />
        </div>
      )}
    </div>
  )
}
