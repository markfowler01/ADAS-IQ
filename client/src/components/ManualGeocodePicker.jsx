// Tiny manual-geocode picker. Shows a centered Mapbox map of Lake Stevens
// area; user clicks the location, hits Save, and the lat/lng is PUT to
// /api/shops/:shopName/coordinates with source: "manual".
//
// Used when the geocoding cron returns "ambiguous" or "failed" for a shop.

import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN

export default function ManualGeocodePicker({ shopName, initialLat, initialLng, onSaved, onClose }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const [coords, setCoords] = useState(
    initialLat != null && initialLng != null ? { lat: initialLat, lng: initialLng } : { lat: 47.998, lng: -122.062 }
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!MAPBOX_TOKEN) { setErr('Mapbox token not configured (VITE_MAPBOX_PUBLIC_TOKEN).'); return }
    mapboxgl.accessToken = MAPBOX_TOKEN
    if (!containerRef.current) return
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [coords.lng, coords.lat],
      zoom: 12,
    })
    mapRef.current = map
    markerRef.current = new mapboxgl.Marker({ color: ORANGE, draggable: true })
      .setLngLat([coords.lng, coords.lat])
      .addTo(map)
    markerRef.current.on('dragend', () => {
      const ll = markerRef.current.getLngLat()
      setCoords({ lat: ll.lat, lng: ll.lng })
    })
    map.on('click', (e) => {
      markerRef.current.setLngLat(e.lngLat)
      setCoords({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })
    return () => { try { map.remove() } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setSaving(true)
    setErr('')
    try {
      const res = await apiFetch(`${API_BASE}/api/shops/${encodeURIComponent(shopName)}/coordinates`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: coords.lat, lng: coords.lng }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      onSaved && onSaved(json)
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl bg-white overflow-hidden flex flex-col" style={{ width: '100%', maxWidth: 720, maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #ebebeb' }}>
          <div>
            <div className="text-xs uppercase tracking-wider" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Set location for</div>
            <div className="text-base font-bold" style={{ color: '#1a1a1a' }}>{shopName}</div>
          </div>
          <button onClick={onClose} className="text-xl px-2" style={{ color: '#888' }}>×</button>
        </div>
        <div ref={containerRef} style={{ flex: 1, minHeight: 360 }} />
        <div className="px-5 py-3 flex items-center justify-between gap-3" style={{ borderTop: '1px solid #ebebeb' }}>
          <div className="text-xs font-mono" style={{ color: '#666' }}>
            {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
          </div>
          {err && <div className="text-xs flex-1" style={{ color: '#991b1b' }}>{err}</div>}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
            <button onClick={save} disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-bold text-white"
              style={{ backgroundColor: ORANGE, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save Location'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
