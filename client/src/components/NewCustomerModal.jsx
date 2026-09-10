// ➕ New Customer (Mark 2026-09-10): one form that asks everything we
// keep forgetting — shop (Google-assisted), the people (owner / GM /
// estimators, add as many as needed), their DRPs, and the Big 3 rule.
// Creates the CRM shop as Active with the rule saved, so the first
// invoice and the job cards are right from day one.
import { useEffect, useRef, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import { Big3Picker, DrpChips, describeRules } from './books/Big3Rules.jsx'

const ORANGE = '#CD4419'
const GREEN = '#15803d'
const ROLES = ['Owner', 'General Manager', 'Estimator', 'Service Advisor', 'Parts Manager', 'Accounting', 'Receptionist', 'Other']
const DEFAULT_BIG3 = { cal_id: 'charge', pcsi: 'included', post_scan: 'included' }
const blankPerson = role => ({ id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, role, name: '', phone: '', email: '' })

export default function NewCustomerModal({ onClose, onCreated }) {
  const [shop, setShop] = useState({ shop_name: '', address: '', phone: '', email: '', website: '', place: null })
  const [people, setPeople] = useState([blankPerson('Owner'), blankPerson('Estimator')])
  const [drps, setDrps] = useState([])
  const [big3, setBig3] = useState({ ...DEFAULT_BIG3 })
  const [notes, setNotes] = useState('')
  const [places, setPlaces] = useState([])
  const [placesBusy, setPlacesBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useRef(null)
  useEffect(() => { nameRef.current?.focus() }, [])

  // Google-assisted shop lookup (same lookup the sales-stop sheet uses).
  useEffect(() => {
    const q = shop.shop_name.trim()
    if (shop.place || q.length < 3) { setPlaces([]); return }
    let dead = false
    const t = setTimeout(async () => {
      setPlacesBusy(true)
      try {
        const r = await apiFetch(`${API_BASE}/api/sales-stops/find-place?q=${encodeURIComponent(q)}`)
        const d = await r.json()
        if (!dead && r.ok) setPlaces((d.places || []).slice(0, 4))
      } catch { /* optional */ } finally { if (!dead) setPlacesBusy(false) }
    }, 450)
    return () => { dead = true; clearTimeout(t) }
  }, [shop.shop_name, shop.place])

  function usePlace(p) {
    setShop(s => ({ ...s, shop_name: p.name || s.shop_name, address: p.address || s.address, phone: s.phone || p.phone || '', website: s.website || p.website || '', place: p }))
    setPlaces([])
  }
  function setPerson(id, field, v) { setPeople(ps => ps.map(p => p.id === id ? { ...p, [field]: v } : p)) }
  function removePerson(id) { setPeople(ps => ps.filter(p => p.id !== id)) }

  async function save() {
    const name = shop.shop_name.trim()
    if (!name) { setError('Shop name is required.'); return }
    setSaving(true); setError('')
    try {
      const cleanPeople = people.filter(p => p.name.trim()).map(p => ({ id: p.id, name: p.name.trim(), title: p.role, phone: p.phone.trim(), email: p.email.trim().toLowerCase(), source: 'new-customer', added_at: new Date().toISOString() }))
      const primary = cleanPeople.find(p => p.role === 'Owner' || p.title === 'Owner') || cleanPeople[0]
      const r = await apiFetch(`${API_BASE}/api/shops`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_name: name, address: shop.address.trim(), phone: shop.phone.trim() || primary?.phone || '', email: shop.email.trim().toLowerCase() || primary?.email || '',
          contact_name: primary?.name || '', pipeline_stage: 'active', referral_source: 'New customer form',
          people: cleanPeople, drps, activities: [{ type: 'note', summary: '➕ Added as a new customer', at: new Date().toISOString() }],
          notes: [notes.trim(), shop.website ? `Website: ${shop.website}` : '', shop.place?.maps_url ? `Google Maps: ${shop.place.maps_url}` : ''].filter(Boolean).join('\n'),
          billing_rules: { big3, big3_set_by: 'new customer form', big3_set_at: new Date().toISOString() },
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      // Save the rule through the proper path too (pings #dispatch + Mark, keeps the audit).
      await apiFetch(`${API_BASE}/api/shops/${d.id}/big3`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: big3 }) }).catch(() => {})
      // Coordinates straight into the map cache when Google gave them.
      if (shop.place?.lat != null) {
        apiFetch(`${API_BASE}/api/shops/${encodeURIComponent(name)}/coordinates`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: shop.place.lat, lng: shop.place.lng }) }).catch(() => {})
      }
      onCreated && onCreated(d)
      onClose()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const input = 'w-full rounded-lg px-3 py-2 text-sm'
  const inputStyle = { border: '1px solid #e0dbd6', outline: 'none' }
  const label = 'block text-[11px] font-semibold uppercase tracking-wider mb-1'

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl flex flex-col" style={{ maxHeight: '92vh', border: '1px solid #ebebeb' }}>
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid #ebebeb' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: '#1a1a1a' }}>➕ New Customer</h2>
            <p className="text-xs" style={{ color: '#888' }}>Everything the first invoice and the job cards need</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-5">
          {/* Shop */}
          <section>
            <label className={label} style={{ color: '#888' }}>Shop</label>
            <input ref={nameRef} value={shop.shop_name} onChange={e => setShop(s => ({ ...s, shop_name: e.target.value, place: null }))} placeholder="Shop name — start typing, Google fills the rest" className={input} style={inputStyle} />
            {(places.length > 0 || placesBusy) && (
              <div className="rounded-lg overflow-hidden mt-1" style={{ border: '1px solid #bfdbfe' }}>
                {placesBusy && places.length === 0 && <div className="px-3 py-2 text-xs" style={{ color: '#888' }}>Looking on Google…</div>}
                {places.map((p, i) => (
                  <button key={p.place_id || i} type="button" onClick={() => usePlace(p)} className="w-full text-left px-3 py-2" style={{ borderTop: i ? '1px solid #eff6ff' : 'none', backgroundColor: 'white' }}>
                    <div className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>{p.name}</div>
                    <div className="text-[11px]" style={{ color: '#888' }}>{p.address}{p.phone ? ` · ${p.phone}` : ''}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input value={shop.address} onChange={e => setShop(s => ({ ...s, address: e.target.value }))} placeholder="Address" className={`${input} col-span-2`} style={inputStyle} />
              <input value={shop.phone} onChange={e => setShop(s => ({ ...s, phone: e.target.value }))} placeholder="Shop phone" inputMode="tel" className={input} style={inputStyle} />
              <input value={shop.email} onChange={e => setShop(s => ({ ...s, email: e.target.value }))} placeholder="Billing email" inputMode="email" className={input} style={inputStyle} />
            </div>
          </section>

          {/* People */}
          <section>
            <div className="flex items-center justify-between mb-1">
              <label className={label} style={{ color: '#888', marginBottom: 0 }}>People</label>
              <div className="flex gap-1">
                <button type="button" onClick={() => setPeople(ps => [...ps, blankPerson('Estimator')])} className="text-[11px] font-bold rounded-full px-2.5 py-1" style={{ backgroundColor: '#fff5f0', color: ORANGE, border: `1px solid ${ORANGE}` }}>+ Estimator</button>
                <button type="button" onClick={() => setPeople(ps => [...ps, blankPerson('Other')])} className="text-[11px] font-bold rounded-full px-2.5 py-1" style={{ backgroundColor: 'white', color: '#555', border: '1px solid #ddd' }}>+ Person</button>
              </div>
            </div>
            <div className="space-y-2">
              {people.map(p => (
                <div key={p.id} className="rounded-lg p-2" style={{ border: '1px solid #ebe7e3', backgroundColor: '#fafaf9' }}>
                  <div className="flex gap-2 mb-1">
                    <select value={p.role} onChange={e => setPerson(p.id, 'role', e.target.value)} className="rounded-md px-2 py-1.5 text-sm" style={{ border: '1px solid #e0dbd6', backgroundColor: 'white' }}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <input value={p.name} onChange={e => setPerson(p.id, 'name', e.target.value)} placeholder="Name" className={`${input} flex-1`} style={inputStyle} />
                    <button type="button" onClick={() => removePerson(p.id)} className="w-8 h-8 rounded-full text-base font-bold flex-shrink-0" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }} aria-label="Remove">×</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={p.phone} onChange={e => setPerson(p.id, 'phone', e.target.value)} placeholder="Phone" inputMode="tel" className={input} style={inputStyle} />
                    <input value={p.email} onChange={e => setPerson(p.id, 'email', e.target.value)} placeholder="Email" inputMode="email" className={input} style={inputStyle} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* DRPs */}
          <section>
            <label className={label} style={{ color: '#888' }}>DRPs — which insurers they're direct-repair for</label>
            <DrpChips value={drps} onChange={setDrps} />
          </section>

          {/* Big 3 */}
          <section className="rounded-xl p-3" style={{ backgroundColor: '#f0fdf4', border: '1.5px solid #bbf7d0' }}>
            <div className="flex items-center justify-between mb-1.5">
              <label className={label} style={{ color: '#166534', marginBottom: 0 }}>🧾 Big 3 on their invoices</label>
              <span className="text-[10px]" style={{ color: '#166534' }}>{describeRules(big3)}</span>
            </div>
            <Big3Picker rules={big3} onChange={setBig3} />
            <p className="text-[11px] mt-1.5" style={{ color: '#4b5563' }}>All three go on every invoice — Charge bills the item, Included shows it at $0.</p>
          </section>

          <section>
            <label className={label} style={{ color: '#888' }}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Gate code, hours, how they like to be billed…" className={input} style={{ ...inputStyle, resize: 'none' }} />
          </section>
          {error && <div className="text-sm px-3 py-2 rounded-lg" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>{error}</div>}
        </div>

        <div className="px-5 py-3 flex-shrink-0 flex gap-2" style={{ borderTop: '1px solid #ebebeb' }}>
          <button type="button" onClick={onClose} className="flex-1 rounded-xl py-2.5 text-sm font-semibold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="flex-[2] rounded-xl py-2.5 text-sm font-bold text-white" style={{ backgroundColor: GREEN, opacity: saving ? .6 : 1 }}>
            {saving ? 'Saving…' : '✅ Add customer'}
          </button>
        </div>
      </div>
    </div>
  )
}
