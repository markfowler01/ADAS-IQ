import { useState, useEffect, useRef } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import { VinDecodeButton } from './ui/VinDecode.jsx'

const ORANGE = '#CD4419'

// mode 'job' | 'quote' (Mark 2026-09-09: "I want all the same questions
// that are in the requested job to be in the requested quote") — one
// form, two tags. Quote mode adds the insurer and submits request_type
// 'quote' so Kat's alert still reads 📝 Quote Requested.
export default function JobRequestModal({ onClose, onSubmit, defaultDate, mode = 'job' }) {
  const isQuote = mode === 'quote'
  const [customers,    setCustomers]    = useState([])
  const [custLoading,  setCustLoading]  = useState(true)
  const [custSearch,   setCustSearch]   = useState('')
  const [custDropOpen, setCustDropOpen] = useState(false)
  const [selected,     setSelected]     = useState(null)
  // 🏢 Shop or 👤 Person (Mark 2026-09-22): a person is a retail customer —
  // no billing questions, one invoice + tax, pays at the van.
  const [who,          setWho]          = useState('shop')
  // ➕ New shop (Phase E): the tech, standing in the shop, gives the short version.
  const [newShop,      setNewShop]      = useState(null)   // null | { shop_name, contact_name, phone, email, address, customer_type, pay_mode }
  const [newShopBusy,  setNewShopBusy]  = useState(false)
  async function createShop() {
    if (!newShop.shop_name.trim()) { setError('Shop name, please.'); return }
    setNewShopBusy(true); setError(null)
    try {
      const r = await apiFetch(`${API_BASE}/api/shops/quick`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newShop) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      const c = { contact_id: d.contact_id || `crm_${d.shop.id}`, contact_name: d.contact_name || d.shop.shop_name }
      setCustomers(cs => [c, ...cs.filter(x => x.contact_id !== c.contact_id)])
      setSelected(c); setNewShop(null); setCustDropOpen(false)
      if (d.books_error) setError(`Shop saved, but the Zoho Books customer didn't get created (${d.books_error}) — Kat can link it on the CRM card.`)
    } catch (e) { setError(e.message) } finally { setNewShopBusy(false) }
  }
  const [person,       setPerson]       = useState({ name: '', phone: '', email: '' })

  const [technician,  setTechnician]  = useState('')
  const [roNumber,    setRoNumber]    = useState('')
  const [year,        setYear]        = useState('')
  const [make,        setMake]        = useState('')
  const [model,       setModel]       = useState('')
  const [lastFourVin, setLastFourVin] = useState('')
  const [notes,       setNotes]       = useState('')
  const [insurer,     setInsurer]     = useState('')
  // Optional — a dated request lands on the Schedule calendar that day;
  // no date puts it in the Unscheduled lane for Kat to place. The
  // Schedule page pre-fills this when adding straight onto a day.
  const [schedDate,   setSchedDate]   = useState(defaultDate || '')

  // Photo scanner state
  const [imagePreview, setImagePreview] = useState(null)
  const [scanning,     setScanning]     = useState(false)
  const [scanStatus,   setScanStatus]   = useState(null) // 'success' | 'partial' | 'error'

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const custRef    = useRef(null)
  const fileInputRef = useRef(null)

  // Fetch Zoho Books customers
  useEffect(() => {
    apiFetch(`${API_BASE}/api/customers`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setCustomers(data) })
      .catch(() => {})
      .finally(() => setCustLoading(false))
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e) {
      if (custRef.current && !custRef.current.contains(e.target)) setCustDropOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const filteredCustomers = customers
    .filter(c => !custSearch || c.contact_name.toLowerCase().includes(custSearch.toLowerCase()))
    .slice(0, 12)

  // ── Photo scan handler ──────────────────────────────────────────────────────
  async function handleImageChange(e) {
    const file = e.target.files[0]
    if (!file) return

    setImagePreview(URL.createObjectURL(file))
    setScanning(true)
    setScanStatus(null)

    try {
      const formData = new FormData()
      formData.append('image', file)

      const resp = await apiFetch(`${API_BASE}/api/extract-ro-image`, {
        method: 'POST',
        body: formData,
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Scan failed')

      let fieldsFound = 0

      // Coerce every Claude-returned field to a string. Claude sometimes
      // returns model years / RO#s as numbers, and calling .trim() on a
      // number later blows up with "R.trim is not a function" at submit.
      if (data.ro_number != null && data.ro_number !== '') { setRoNumber(String(data.ro_number)); fieldsFound++ }
      if (data.year      != null && data.year      !== '') { setYear(String(data.year));           fieldsFound++ }
      if (data.make      != null && data.make      !== '') { setMake(String(data.make));           fieldsFound++ }
      if (data.model     != null && data.model     !== '') { setModel(String(data.model));         fieldsFound++ }
      if (data.vin) {
        const v = String(data.vin).replace(/\s/g, '').toUpperCase()
        setLastFourVin(v.length === 17 ? v : v.slice(-4))
        fieldsFound++
      }
      if (data.notes && !notes) { setNotes(data.notes); fieldsFound++ }

      // Try to match shop name to a customer in the dropdown
      if (data.shop_name && !selected) {
        const q = data.shop_name.toLowerCase()
        const match = customers.find(c =>
          c.contact_name.toLowerCase().includes(q) ||
          q.includes(c.contact_name.toLowerCase())
        )
        if (match) { setSelected(match); fieldsFound++ }
      }

      setScanStatus(fieldsFound > 0 ? 'success' : 'partial')
    } catch (e) {
      console.warn('[scan]', e.message)
      setScanStatus('error')
    } finally {
      setScanning(false)
      // Reset file input so the same file can be re-selected if needed
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function clearImage() {
    setImagePreview(null)
    setScanStatus(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (who === 'shop' && !selected)       { setError('Please select a customer.'); return }
    if (who === 'person' && (!person.name.trim() || !person.phone.trim())) { setError('Name and cell number, please.'); return }
    setSaving(true)
    setError(null)
    try {
      // Soft blocks (overridable): paid holidays block everyone; approved
      // time off blocks the picked tech.
      if (schedDate) {
        try {
          const r = await apiFetch(`${API_BASE}/api/schedule/off?date=${schedDate}&technician=${encodeURIComponent(technician || '')}`)
          const j = await r.json()
          if (j.off) {
            const msg = j.holiday
              ? `🎉 ${schedDate} is ${j.who} — a paid holiday, shop's closed.\n\nBook another day, or press OK to book anyway.`
              : `🏖 ${j.who || technician} is OFF on ${schedDate} (approved time off).\n\nBook another day, or press OK to book anyway.`
            if (!window.confirm(msg)) { setSaving(false); return }
          }
        } catch { /* check is best-effort */ }
      }
      await onSubmit({
        shop_name:  who === 'person' ? person.name.trim() : selected.contact_name,
        ...(who === 'person'
          ? { customer_kind: 'retail', retail: { name: person.name.trim(), phone: person.phone.trim(), email: person.email.trim() } }
          : { customer: { kind: 'shop', name: selected.contact_name, zoho_contact_id: selected.contact_id } }),
        // Belt-and-suspenders: coerce to string in case a setter ever
        // slips through with a non-string value again (Claude scan,
        // future paste/autofill, etc.).
        ro_number:  String(roNumber || '').trim(),
        year:       String(year     || '').trim(),
        make:       String(make     || '').trim(),
        model:      String(model    || '').trim(),
        vin:        lastFourVin.length === 17 ? lastFourVin.toUpperCase() : (lastFourVin ? `****${lastFourVin.slice(-4).toUpperCase()}` : ''),
        technician: technician,
        insurer:    String(insurer || '').trim(),
        notes:      String(notes || '').trim(),
        scheduled_date: schedDate || '',
        status:     'job_requested',
        request_type: isQuote ? 'quote' : 'job',
      })
      onClose()
    } catch (e) {
      setError(e.message || 'Failed to submit request.')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
        style={{ border: '1px solid #ebebeb', maxHeight: '92vh' }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid #ebebeb' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: '#1a1a1a' }}>{isQuote ? 'Request a Quote' : 'Request a Job'}</h2>
            <p className="text-xs mt-0.5" style={{ color: '#aaa' }}>{isQuote ? 'Kat drafts the estimate from this' : 'Kat will be notified automatically'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-4 overflow-y-auto">

          {/* ── Photo Scanner ────────────────────────────────────────────── */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              Scan Repair Order
            </label>

            {/* Hidden file input — accept images + camera on mobile */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageChange}
            />

            {!imagePreview ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-4 rounded-xl flex flex-col items-center gap-1.5 transition-colors"
                style={{ border: '2px dashed #e0dbd6', backgroundColor: '#fafaf9' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = ORANGE)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#e0dbd6')}
              >
                <span style={{ fontSize: '24px', lineHeight: 1 }}>📸</span>
                <span className="text-sm font-medium" style={{ color: '#666' }}>
                  Photograph or upload a repair order
                </span>
                <span className="text-xs" style={{ color: '#bbb' }}>
                  AI will auto-fill the form
                </span>
              </button>
            ) : (
              <div className="relative rounded-xl overflow-hidden" style={{ border: '1.5px solid #e0dbd6' }}>
                <img
                  src={imagePreview}
                  alt="Repair order"
                  className="w-full object-contain"
                  style={{ maxHeight: '160px', backgroundColor: '#f5f5f5' }}
                />

                {/* Scanning overlay */}
                {scanning && (
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ backgroundColor: 'rgba(255,255,255,0.85)' }}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="animate-spin rounded-full h-5 w-5 border-2"
                        style={{ borderColor: ORANGE, borderTopColor: 'transparent' }}
                      />
                      <span className="text-sm font-semibold" style={{ color: ORANGE }}>
                        Reading repair order…
                      </span>
                    </div>
                  </div>
                )}

                {/* Clear button */}
                {!scanning && (
                  <button
                    type="button"
                    onClick={clearImage}
                    className="absolute top-2 right-2 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold"
                    style={{ backgroundColor: 'rgba(0,0,0,0.55)', color: 'white' }}
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            {/* Scan result feedback */}
            {scanStatus === 'success' && !scanning && (
              <p className="text-xs mt-1.5 font-semibold" style={{ color: '#22a650' }}>
                ✓ Info extracted — review and adjust below
              </p>
            )}
            {scanStatus === 'partial' && !scanning && (
              <p className="text-xs mt-1.5" style={{ color: '#888' }}>
                Couldn't read all fields — fill in any missing info below
              </p>
            )}
            {scanStatus === 'error' && !scanning && (
              <p className="text-xs mt-1.5" style={{ color: '#aaa' }}>
                Couldn't read image — fill in the form manually
              </p>
            )}
          </div>

          {/* Shop or person */}
          <div className="flex gap-1 rounded-full p-0.5" style={{ backgroundColor: '#f5f3f0', border: '1px solid #e0dbd6' }}>
            {[['shop', '🏢 Shop'], ['person', '👤 Person (retail)']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setWho(k)} className="flex-1 rounded-full py-1.5 text-xs font-bold" style={who === k ? { backgroundColor: '#1a1a1a', color: 'white' } : { color: '#555' }}>{l}</button>
            ))}
          </div>
          {who === 'person' && (
            <div className="rounded-xl p-3" style={{ backgroundColor: '#f0fdfa', border: '1.5px solid #99f6e4' }}>
              <div className="text-[11px] mb-2" style={{ color: '#0f766e' }}>A person paying for their own car. One invoice with 10.1% tax, pay at the van. Nothing else to ask.</div>
              <input value={person.name} onChange={e => setPerson(p => ({ ...p, name: e.target.value }))} placeholder="Full name *" className="w-full text-sm rounded-lg px-3 py-2 mb-2" style={{ border: '1.5px solid #99f6e4', outline: 'none', backgroundColor: 'white' }} />
              <div className="grid grid-cols-2 gap-2">
                <input value={person.phone} onChange={e => setPerson(p => ({ ...p, phone: e.target.value }))} placeholder="Cell *" inputMode="tel" className="text-sm rounded-lg px-3 py-2" style={{ border: '1.5px solid #99f6e4', outline: 'none', backgroundColor: 'white' }} />
                <input value={person.email} onChange={e => setPerson(p => ({ ...p, email: e.target.value }))} placeholder="Email (for the receipt)" inputMode="email" className="text-sm rounded-lg px-3 py-2" style={{ border: '1.5px solid #99f6e4', outline: 'none', backgroundColor: 'white' }} />
              </div>
            </div>
          )}
          {newShop && who === 'shop' && (
            <div className="rounded-xl p-3" style={{ backgroundColor: '#fff5f0', border: `1.5px solid ${ORANGE}` }}>
              <div className="flex items-center justify-between mb-2"><div className="text-sm font-bold" style={{ color: ORANGE }}>➕ New shop</div><button type="button" onClick={() => setNewShop(null)} className="text-xs" style={{ color: '#888' }}>cancel</button></div>
              <div className="text-[11px] mb-2" style={{ color: '#666' }}>The short version. The app makes the CRM card and the Books customer; Kat gets the rest as a checklist.</div>
              <input value={newShop.shop_name} onChange={e => setNewShop(x => ({ ...x, shop_name: e.target.value }))} placeholder="Shop name *" className="w-full text-sm rounded-lg px-3 py-2 mb-2" style={{ border: '1.5px solid #fdba74', outline: 'none', backgroundColor: 'white' }} />
              <div className="grid grid-cols-2 gap-2 mb-2">
                <input value={newShop.contact_name} onChange={e => setNewShop(x => ({ ...x, contact_name: e.target.value }))} placeholder="Who you talked to" className="text-sm rounded-lg px-3 py-2" style={{ border: '1.5px solid #fdba74', outline: 'none', backgroundColor: 'white' }} />
                <input value={newShop.phone} onChange={e => setNewShop(x => ({ ...x, phone: e.target.value }))} placeholder="Their phone" inputMode="tel" className="text-sm rounded-lg px-3 py-2" style={{ border: '1.5px solid #fdba74', outline: 'none', backgroundColor: 'white' }} />
                <input value={newShop.email} onChange={e => setNewShop(x => ({ ...x, email: e.target.value }))} placeholder="Email for invoices" inputMode="email" className="text-sm rounded-lg px-3 py-2" style={{ border: '1.5px solid #fdba74', outline: 'none', backgroundColor: 'white' }} />
                <input value={newShop.address} onChange={e => setNewShop(x => ({ ...x, address: e.target.value }))} placeholder="Address (street, city, WA zip)" className="text-sm rounded-lg px-3 py-2" style={{ border: '1.5px solid #fdba74', outline: 'none', backgroundColor: 'white' }} />
              </div>
              <div className="text-[11px] font-bold mb-1" style={{ color: '#9a3412' }}>What kind of shop?</div>
              <div className="flex gap-1.5 flex-wrap mb-2">{[['body_shop', 'Collision'], ['repair_shop', 'Auto repair'], ['dealer', 'Dealer']].map(([k, l]) => <button key={k} type="button" onClick={() => setNewShop(x => ({ ...x, customer_type: k, pay_mode: k === 'body_shop' ? 'net_terms' : 'on_site' }))} className="text-xs font-bold rounded-full px-3 py-1.5" style={newShop.customer_type === k ? { backgroundColor: '#1a1a1a', color: 'white' } : { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>{l}</button>)}</div>
              <div className="text-[11px] font-bold mb-1" style={{ color: '#9a3412' }}>How do they pay?</div>
              <div className="flex gap-1.5 flex-wrap mb-3">{[['on_site', '🚐 On site'], ['net_terms', '✉️ Net terms'], ['either', 'Either']].map(([k, l]) => <button key={k} type="button" onClick={() => setNewShop(x => ({ ...x, pay_mode: k }))} className="text-xs font-bold rounded-full px-3 py-1.5" style={newShop.pay_mode === k ? { backgroundColor: '#0e7490', color: 'white' } : { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>{l}</button>)}</div>
              <button type="button" onClick={createShop} disabled={newShopBusy || !newShop.shop_name.trim()} className="w-full rounded-xl py-2.5 text-sm font-bold text-white" style={{ backgroundColor: ORANGE, opacity: newShopBusy || !newShop.shop_name.trim() ? .5 : 1 }}>{newShopBusy ? 'Creating…' : '➕ Create the shop and use it'}</button>
            </div>
          )}
          {/* Customer dropdown */}
          <div style={who === 'person' ? { display: 'none' } : {}}>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              Customer
            </label>
            <div ref={custRef} className="relative">
              <button
                type="button"
                onClick={() => { setCustDropOpen(o => !o); setCustSearch('') }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left"
                style={{ border: `1.5px solid ${custDropOpen ? ORANGE : '#ddd'}`, backgroundColor: 'white', transition: 'border-color 0.15s' }}
              >
                <span style={{ color: selected ? '#1a1a1a' : '#aaa' }}>
                  {selected ? selected.contact_name : 'Select a customer…'}
                </span>
                <span style={{ color: '#bbb', fontSize: '10px' }}>{custDropOpen ? '▲' : '▼'}</span>
              </button>

              {selected && (
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="absolute right-8 top-2.5 text-xs px-1"
                  style={{ color: '#bbb' }}
                >✕</button>
              )}

              {custDropOpen && (
                <div
                  className="absolute z-30 w-full mt-1 rounded-xl overflow-hidden"
                  style={{ backgroundColor: 'white', border: '1.5px solid #e8e2dc', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: '220px', display: 'flex', flexDirection: 'column' }}
                >
                  <div className="p-2" style={{ borderBottom: '1px solid #f0ece8' }}>
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search customers…"
                      value={custSearch}
                      onChange={e => setCustSearch(e.target.value)}
                      className="w-full text-sm px-2 py-1.5 rounded-lg outline-none"
                      style={{ border: '1.5px solid #e0dbd6', backgroundColor: '#f9f7f5' }}
                    />
                  </div>
                  <div className="overflow-y-auto">
                    {custLoading ? (
                      <p className="text-sm px-4 py-3" style={{ color: '#bbb' }}>Loading…</p>
                    ) : filteredCustomers.length === 0 ? (
                      <p className="text-sm px-4 py-3" style={{ color: '#bbb' }}>No matches</p>
                    ) : (<>
                    <button type="button" onMouseDown={() => { setNewShop({ shop_name: custSearch.trim(), contact_name: '', phone: '', email: '', address: '', customer_type: 'repair_shop', pay_mode: 'on_site' }); setCustDropOpen(false) }}
                      className="w-full text-left px-4 py-2.5 text-sm font-bold" style={{ color: ORANGE, backgroundColor: '#fff5f0', borderBottom: '1px solid #fde4d8' }}>
                      ➕ New shop{custSearch.trim() ? ` — "${custSearch.trim()}"` : ''}
                    </button>
                    {filteredCustomers.map(c => (
                      <button
                        key={c.contact_id}
                        type="button"
                        onMouseDown={() => { setSelected(c); setCustDropOpen(false); setCustSearch('') }}
                        className="w-full text-left px-4 py-2.5 text-sm"
                        style={{
                          color:           selected?.contact_id === c.contact_id ? ORANGE : '#1a1a1a',
                          fontWeight:      selected?.contact_id === c.contact_id ? 600 : 400,
                          backgroundColor: selected?.contact_id === c.contact_id ? '#fdeee8' : 'transparent',
                        }}
                        onMouseEnter={e => { if (selected?.contact_id !== c.contact_id) e.currentTarget.style.backgroundColor = '#fafaf9' }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = selected?.contact_id === c.contact_id ? '#fdeee8' : 'transparent' }}
                      >
                        {c.contact_name}
                      </button>
                    ))}</>)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Technician */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Technician</label>
            <div className="flex gap-2">
              {['Mark', 'Jayden'].map(name => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setTechnician(t => t === name ? '' : name)}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
                  style={{
                    backgroundColor: technician === name ? ORANGE : '#f5f3f0',
                    color:           technician === name ? 'white' : '#555',
                    border:          `1.5px solid ${technician === name ? ORANGE : '#e0dbd6'}`,
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* RO Number */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">RO Number</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none"
              style={{ borderColor: '#ddd' }}
              value={roNumber}
              onChange={e => setRoNumber(e.target.value)}
              placeholder="e.g. 12345"
              onFocus={e => (e.target.style.borderColor = ORANGE)}
              onBlur={e  => (e.target.style.borderColor = '#ddd')}
            />
          </div>

          {/* Year / Make / Model */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Year</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#ddd' }}
                value={year}
                onChange={e => setYear(e.target.value)}
                placeholder="2022"
                onFocus={e => (e.target.style.borderColor = ORANGE)}
                onBlur={e  => (e.target.style.borderColor = '#ddd')}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Make</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#ddd' }}
                value={make}
                onChange={e => setMake(e.target.value)}
                placeholder="Toyota"
                onFocus={e => (e.target.style.borderColor = ORANGE)}
                onBlur={e  => (e.target.style.borderColor = '#ddd')}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Model</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#ddd' }}
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="RAV4"
                onFocus={e => (e.target.style.borderColor = ORANGE)}
                onBlur={e  => (e.target.style.borderColor = '#ddd')}
              />
            </div>
          </div>

          {/* Insurer (blank = cash) */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              Insurer <span style={{ color: '#bbb', textTransform: 'none' }}>(blank = cash)</span>
            </label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#ddd' }}
              value={insurer}
              onChange={e => setInsurer(e.target.value)}
              placeholder="State Farm, Allstate, cash…"
              onFocus={e => (e.target.style.borderColor = ORANGE)}
              onBlur={e  => (e.target.style.borderColor = '#ddd')}
            />
          </div>

          {/* VIN — the full 17 (decodes the car for you) or just the last 4 (Mark 2026-09-22) */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              VIN <span style={{ color: '#bbb', textTransform: 'none' }}>(full 17, or just the last 4)</span>
            </label>
            <div className="flex gap-2 items-center">
              <input
                className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none"
                style={{ borderColor: lastFourVin.length === 17 ? '#16a34a' : '#ddd' }}
                value={lastFourVin}
                onChange={e => setLastFourVin(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 17).toUpperCase())}
                placeholder="A1B2  or  1HGCM82633A004352"
                maxLength={17}
                onFocus={e => (e.target.style.borderColor = ORANGE)}
                onBlur={e  => (e.target.style.borderColor = lastFourVin.length === 17 ? '#16a34a' : '#ddd')}
              />
              <VinDecodeButton vin={lastFourVin} compact onDecoded={d => { if (d?.year && !year) setYear(String(d.year)); if (d?.make && !make) setMake(String(d.make)); if (d?.model && !model) setModel(String(d.model)) }} />
            </div>
            {lastFourVin.length > 4 && lastFourVin.length < 17 && <p className="text-[11px] mt-1" style={{ color: '#b45309' }}>{17 - lastFourVin.length} more for a full VIN — or just the last 4 is fine.</p>}
          </div>

          {/* Scheduled date (optional) */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              Scheduled Date <span style={{ color: '#bbb', textTransform: 'none' }}>(if known)</span>
            </label>
            <input
              type="date"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#ddd' }}
              value={schedDate}
              onChange={e => setSchedDate(e.target.value)}
              onFocus={e => (e.target.style.borderColor = ORANGE)}
              onBlur={e  => (e.target.style.borderColor = '#ddd')}
            />
            <p className="text-[11px] mt-1" style={{ color: '#aaa' }}>
              Leave blank and it goes to the Unscheduled list on the Schedule calendar.
            </p>
          </div>

          {/* What's needed */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              What's Needed
            </label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
              style={{ borderColor: '#ddd' }}
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Describe the calibrations needed or any other details…"
              onFocus={e => (e.target.style.borderColor = ORANGE)}
              onBlur={e  => (e.target.style.borderColor = '#ddd')}
            />
          </div>

          {error && (
            <div className="px-4 py-3 rounded-xl text-sm" style={{ backgroundColor: '#fff0ed', color: ORANGE, border: '1px solid #e8c5b0' }}>
              {error}
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid #ebebeb' }}>
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg font-medium"
            style={{ color: '#555', backgroundColor: '#f5f3f0' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || scanning}
            className="text-sm px-4 py-2 rounded-lg font-medium text-white"
            style={{ backgroundColor: ORANGE, opacity: (saving || scanning) ? 0.7 : 1 }}
          >
            {saving ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  )
}
