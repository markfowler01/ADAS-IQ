// Van Newsletter Contact Modal.
//
// Mark's field workflow: he picks up a contact card at a body shop,
// snaps a photo or reads the card, taps the button on the CRM screen,
// fills in first/last/email/phone/shop-name in ~10 seconds, submits.
// One POST → the person lands on the CRM shop record AND the From-
// the-Van Resend audience. Idempotent on both sides so he can retype
// without duplicating.
//
// Shop-name field auto-suggests against the existing CRM shops passed
// in via `shops` so a re-visit to an existing shop attaches the
// contact to the right row instead of creating a duplicate.

import { useState, useMemo, useRef } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'

export default function VanContactModal({ shops = [], onClose, onSaved }) {
  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [email,     setEmail]     = useState('')
  const [phone,     setPhone]     = useState('')
  const [shopName,  setShopName]  = useState('')
  const [notes,     setNotes]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState(null)

  // Business-card photo scanner state.
  const [imagePreview, setImagePreview] = useState(null)
  const [scanning,     setScanning]     = useState(false)
  const [scanStatus,   setScanStatus]   = useState(null) // 'success' | 'partial' | 'error'
  const fileInputRef = useRef(null)

  // Snap a card → POST to Claude vision → auto-fill any fields the user
  // hasn't already typed into. Never clobber already-typed values so the
  // scan behaves as an assist, not a reset.
  async function handleImageChange(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setImagePreview(URL.createObjectURL(file))
    setScanning(true)
    setScanStatus(null)

    try {
      const formData = new FormData()
      formData.append('image', file)
      const resp = await apiFetch(`${API_BASE}/api/extract-business-card`, {
        method: 'POST',
        body: formData,
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Scan failed')

      let fieldsFound = 0
      if (data.first_name && !firstName)  { setFirstName(data.first_name); fieldsFound++ }
      if (data.last_name  && !lastName)   { setLastName(data.last_name);   fieldsFound++ }
      if (data.email      && !email)      { setEmail(String(data.email).toLowerCase()); fieldsFound++ }
      if (data.phone      && !phone)      { setPhone(data.phone);          fieldsFound++ }
      if (data.shop_name  && !shopName)   { setShopName(data.shop_name);   fieldsFound++ }
      if ((data.title || data.notes) && !notes) {
        const combined = [data.title, data.notes].filter(Boolean).join(' — ')
        if (combined) { setNotes(combined); fieldsFound++ }
      }
      setScanStatus(fieldsFound > 0 ? 'success' : 'partial')
    } catch (err) {
      console.warn('[card-scan]', err.message)
      setScanStatus('error')
    } finally {
      setScanning(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function clearImage() {
    setImagePreview(null)
    setScanStatus(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Shop autocomplete — case-insensitive substring, cap at 6 suggestions.
  const suggestions = useMemo(() => {
    const q = shopName.trim().toLowerCase()
    if (q.length < 2) return []
    return (shops || [])
      .filter(s => String(s.shop_name || '').toLowerCase().includes(q))
      .slice(0, 6)
  }, [shopName, shops])

  const canSubmit = shopName.trim().length > 0
    && (email.trim().length > 0 || phone.trim().length > 0)
    && !submitting

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiFetch(`${API_BASE}/api/shops/van-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name:  lastName.trim(),
          email:      email.trim(),
          phone:      phone.trim(),
          shop_name:  shopName.trim(),
          notes:      notes.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      onSaved && onSaved(data)
      onClose()
    } catch (e) {
      setError(e.message || 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#f0ece8' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: '#1a1a1a' }}>📨 Van Newsletter Contact</h2>
            <p className="text-xs text-gray-400 mt-0.5">Saves to CRM + enrolls in From-the-Van.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none" aria-label="Close">×</button>
        </div>

        <div className="p-5 space-y-3">
          {/* Photo scanner — snap a business card or opt-in slip and let
              Claude fill the form. Reveal Camera roll on mobile via the
              standard file input; capture="environment" nudges rear camera. */}
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>
              📸 Scan a business card
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleImageChange}
              style={{ display: 'none' }}
            />
            {!imagePreview ? (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full mt-1 rounded-lg py-3 text-sm font-semibold flex items-center justify-center gap-2"
                style={{ border: `1.5px dashed ${ORANGE}`, color: ORANGE, backgroundColor: '#fff5f0' }}
              >
                📷 Take photo or choose from library
              </button>
            ) : (
              <div className="mt-1 rounded-lg overflow-hidden" style={{ border: '1px solid #e5e7eb' }}>
                <div className="relative">
                  <img src={imagePreview} alt="Card preview"
                    style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }} />
                  {scanning && (
                    <div className="absolute inset-0 flex items-center justify-center text-white text-sm font-semibold"
                      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
                      🤖 Reading card…
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between px-3 py-2 text-xs" style={{ backgroundColor: '#fafaf9' }}>
                  <span style={{ color: '#666' }}>
                    {scanning && '⏳ Extracting fields…'}
                    {!scanning && scanStatus === 'success' && '✅ Fields filled — review below'}
                    {!scanning && scanStatus === 'partial' && '⚠️ Couldn\'t read some fields — fill manually'}
                    {!scanning && scanStatus === 'error'   && '⚠️ Scan failed — fill manually'}
                  </span>
                  {!scanning && (
                    <button onClick={clearImage} className="font-semibold" style={{ color: ORANGE }}>
                      Retake
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* First + Last */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>
                First name
              </label>
              <input
                autoFocus
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="Sam"
                className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm"
                style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>
                Last name
              </label>
              <input
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="Rodriguez"
                className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm"
                style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>
              Email (used for newsletter)
            </label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="sam@bodyshop.com"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm"
              style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
            />
          </div>

          {/* Phone */}
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>
              Phone
            </label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              type="tel"
              inputMode="tel"
              className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm"
              style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
            />
          </div>

          {/* Shop name + autocomplete */}
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>
              Shop name *
            </label>
            <input
              value={shopName}
              onChange={e => setShopName(e.target.value)}
              placeholder="Sam's Body Shop"
              className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm"
              style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
            />
            {suggestions.length > 0 && (
              <div className="mt-1 rounded-lg border" style={{ borderColor: '#e5e7eb', backgroundColor: 'white' }}>
                {suggestions.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setShopName(s.shop_name)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b last:border-b-0"
                    style={{ borderColor: '#f0ece8', color: '#1a1a1a' }}
                  >
                    <div className="font-medium">{s.shop_name}</div>
                    {s.address && <div className="text-xs text-gray-500 truncate">{s.address}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>
              Notes
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Estimator, prefers text, met at counter"
              rows={2}
              className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm"
              style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
            />
          </div>

          {error && (
            <div className="text-xs rounded-lg p-2" style={{ backgroundColor: '#fef2f2', color: '#991b1b' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t" style={{ borderColor: '#f0ece8' }}>
          <button
            onClick={onClose}
            className="text-sm font-semibold rounded-lg px-4 py-2.5"
            style={{ color: '#666', backgroundColor: '#f5f3f0' }}
          >Cancel</button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="text-sm font-bold rounded-lg px-4 py-2.5 text-white"
            style={{ backgroundColor: canSubmit ? ORANGE : '#e5e7eb' }}
          >
            {submitting ? 'Saving…' : '📨 Add to CRM + Van List'}
          </button>
        </div>
      </div>
    </div>
  )
}
