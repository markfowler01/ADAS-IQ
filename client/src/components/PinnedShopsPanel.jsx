// Pinned shops tab inside the Dispatch Map side panel.
// Lists Mark's main-client pins, lets him add new ones by typing an address
// (geocoded server-side), and delete existing ones. Manual pins are sticky;
// the geocoding cron never overwrites them.

import { useState, useEffect, useCallback } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'

export default function PinnedShopsPanel({ onChanged }) {
  const [pins, setPins] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [shopName, setShopName] = useState('')
  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState('')

  const load = useCallback(async () => {
    try {
      setErr('')
      const res = await apiFetch(`${API_BASE}/api/shops/pins`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setPins(json.pins || [])
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAdd(e) {
    e.preventDefault()
    if (!shopName.trim() || !address.trim()) return
    setSaving(true)
    setErr('')
    try {
      const res = await apiFetch(`${API_BASE}/api/shops/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_name: shopName.trim(), address: address.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setSavedFlash(`Pinned "${shopName.trim()}"`)
      setTimeout(() => setSavedFlash(''), 2500)
      setShopName('')
      setAddress('')
      await load()
      onChanged && onChanged()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(key) {
    if (!confirm(`Remove pin for "${key}"? The cron will re-resolve the location from Zoho/CRM next run.`)) return
    setErr('')
    try {
      const res = await apiFetch(`${API_BASE}/api/shops/pin/${encodeURIComponent(key)}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      await load()
      onChanged && onChanged()
    } catch (e) {
      setErr(e.message)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-3" style={{ backgroundColor: '#f5f3f0' }}>
      {/* Add form */}
      <form
        onSubmit={handleAdd}
        className="rounded-xl mb-3 p-3 bg-white"
        style={{ border: '1px solid #ebebeb' }}
      >
        <div className="text-xs uppercase tracking-wider mb-2 font-semibold"
          style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>
          + Add pinned shop
        </div>
        <input
          type="text"
          placeholder="Shop name (e.g. L-M Body Shop)"
          value={shopName}
          onChange={e => setShopName(e.target.value)}
          className="w-full mb-2 px-3 py-2 rounded-lg text-sm"
          style={{ border: '1px solid #ddd' }}
        />
        <input
          type="text"
          placeholder="Full address (street, city, state, zip)"
          value={address}
          onChange={e => setAddress(e.target.value)}
          className="w-full mb-2 px-3 py-2 rounded-lg text-sm"
          style={{ border: '1px solid #ddd' }}
        />
        <button
          type="submit"
          disabled={saving || !shopName.trim() || !address.trim()}
          className="w-full rounded-lg text-white font-bold py-2 text-sm"
          style={{ backgroundColor: ORANGE, opacity: (saving || !shopName.trim() || !address.trim()) ? 0.5 : 1 }}
        >{saving ? 'Geocoding…' : 'Save pin'}</button>
        {savedFlash && (
          <div className="text-xs mt-2" style={{ color: '#15803d' }}>✓ {savedFlash}</div>
        )}
      </form>

      {err && (
        <div className="rounded-lg px-3 py-2 text-xs mb-3"
          style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
          {err}
        </div>
      )}

      {/* Pins list */}
      <div className="text-xs uppercase tracking-wider mb-2 font-semibold px-1"
        style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>
        Current pins ({pins.length})
      </div>
      {loading ? (
        <p className="text-sm px-2" style={{ color: '#aaa' }}>Loading…</p>
      ) : pins.length === 0 ? (
        <p className="text-xs px-2 italic" style={{ color: '#bbb' }}>No pinned shops yet. Add your main clients above.</p>
      ) : (
        <ul className="space-y-2">
          {pins.map(p => (
            <li key={p.shop_name_key}
              className="rounded-lg px-3 py-2 bg-white"
              style={{ border: '1px solid #ebebeb' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate" style={{ color: '#1a1a1a' }}>
                    {p.shop_name_key}
                  </div>
                  {p.address && (
                    <div className="text-xs mt-0.5" style={{ color: '#666' }}>{p.address}</div>
                  )}
                  <div className="text-[10px] mt-1 font-mono" style={{ color: '#999' }}>
                    {p.lat?.toFixed(5)}, {p.lng?.toFixed(5)}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(p.shop_name_key)}
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: '#991b1b', backgroundColor: '#fef2f2', border: '1px solid #fecaca' }}
                  title="Remove pin"
                >Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
