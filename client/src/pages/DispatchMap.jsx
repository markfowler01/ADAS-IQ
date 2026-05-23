// /dispatch/map screen — desktop-primary dispatch view with Mapbox map +
// side panel. Pins color-coded by tech; drag jobs between groups to
// reassign; manual override picker for shops without geocoded locations.

import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { API_BASE, apiFetch } from '../utils/api.js'
import DispatchSidePanel from '../components/DispatchSidePanel.jsx'
import ManualGeocodePicker from '../components/ManualGeocodePicker.jsx'
import PinnedShopsPanel from '../components/PinnedShopsPanel.jsx'
import Navbar from '../components/Navbar.jsx'

const ORANGE = '#CD4419'
const TECH_COLOR = { Mark: '#CD4419', Jayden: '#1F8B8B' }
const PENDING_COLOR = '#E5A52B'
const UNASSIGNED_COLOR = '#999999'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function pinColor(pin) {
  if (pin.status === 'pending_parts') return PENDING_COLOR
  if (pin.status === 'need_dispatch') return UNASSIGNED_COLOR
  const t = (pin.technician || '').toLowerCase()
  if (t.includes('mark')) return TECH_COLOR.Mark
  if (t.includes('jayden') || t.includes('jaden')) return TECH_COLOR.Jayden
  return UNASSIGNED_COLOR
}

export default function DispatchMap({ user, onLogout, currentScreen, onNavigate }) {
  const [date, setDate] = useState(todayISO())
  const [techFilter, setTechFilter] = useState('all')
  const [includeUnassigned, setIncludeUnassigned] = useState(true)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [pickerShop, setPickerShop] = useState(null)
  const [sidePanelTab, setSidePanelTab] = useState('jobs') // 'jobs' | 'pinned'

  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])

  const load = useCallback(async () => {
    try {
      setErr('')
      const params = new URLSearchParams({ date })
      if (techFilter !== 'all') params.set('tech', techFilter)
      if (includeUnassigned) params.set('unassigned', 'true')
      const res = await apiFetch(`${API_BASE}/api/dispatch/map-data?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setData(json)
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [date, techFilter, includeUnassigned])

  useEffect(() => { load() }, [load])

  // Initialize the map once
  useEffect(() => {
    if (!MAPBOX_TOKEN || !mapContainer.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-122.062, 47.998], // Lake Stevens
      zoom: 10,
    })
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')
    mapRef.current = map
    return () => { try { map.remove() } catch {} ; mapRef.current = null }
  }, [])

  // Render pins whenever data changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !data) return

    // Clear existing markers
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    const bounds = new mapboxgl.LngLatBounds()
    const pins = (data.pins || []).filter(p => p.coords && p.coords.lat != null)

    pins.forEach(pin => {
      const el = document.createElement('div')
      el.style.cssText = `
        width: 32px; height: 32px; border-radius: 50%;
        background: ${pinColor(pin)};
        color: white; font-weight: 800; font-size: 12px;
        display: flex; align-items: center; justify-content: center;
        border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        cursor: pointer;
      `
      el.textContent = pin.drive_order != null ? String(pin.drive_order) : '•'

      const popup = new mapboxgl.Popup({ offset: 18, closeButton: false }).setHTML(`
        <div style="font-family: 'IBM Plex Sans', sans-serif; padding: 4px 2px; min-width: 180px;">
          <div style="font-weight: 700; font-size: 13px; color: #1a1a1a;">${pin.shop_name || 'Unknown'}</div>
          <div style="font-size: 12px; color: #555; margin-top: 2px;">${pin.vehicle || ''}</div>
          ${pin.technician ? `<div style="font-size: 11px; color: #888; margin-top: 4px;">👤 ${pin.technician}</div>` : ''}
          ${pin.time_window_start ? `<div style="font-size: 11px; color: #888;">⏰ ${pin.time_window_start} – ${pin.time_window_end || ''}</div>` : ''}
        </div>
      `)

      const marker = new mapboxgl.Marker(el)
        .setLngLat([pin.coords.lng, pin.coords.lat])
        .setPopup(popup)
        .addTo(map)
      markersRef.current.push(marker)
      bounds.extend([pin.coords.lng, pin.coords.lat])
    })

    // Plot tech home bases as small diamond markers
    if (data.tech_homes) {
      for (const [tech, cfg] of Object.entries(data.tech_homes)) {
        if (cfg.home_lat == null || cfg.home_lng == null) continue
        const el = document.createElement('div')
        el.style.cssText = `
          width: 16px; height: 16px; transform: rotate(45deg);
          background: ${TECH_COLOR[tech] || '#999'};
          border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          opacity: 0.6;
        `
        new mapboxgl.Marker(el).setLngLat([cfg.home_lng, cfg.home_lat]).addTo(map)
        markersRef.current.push({ remove: () => el.remove() })
        bounds.extend([cfg.home_lng, cfg.home_lat])
      }
    }

    if (pins.length > 0 && !bounds.isEmpty()) {
      try { map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 500 }) } catch {}
    }
  }, [data])

  async function handleReassign(jobId, newTech) {
    try {
      const res = await apiFetch(`${API_BASE}/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ technician: newTech }),
      })
      if (!res.ok) {
        let m = `HTTP ${res.status}`
        try { const j = await res.json(); m = j.error || m } catch {}
        throw new Error(m)
      }
      await load()
    } catch (e) {
      setErr(`Reassign failed: ${e.message}`)
    }
  }

  const pins = data?.pins || []
  const markCount = pins.filter(p => (p.technician || '').toLowerCase().includes('mark')).length
  const jaydenCount = pins.filter(p => /jay?den/.test((p.technician || '').toLowerCase())).length
  const unassignedCount = pins.filter(p => !p.technician || p.status === 'need_dispatch').length

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ border: '1px solid #ddd' }}
          />
          <div className="flex gap-1">
            {['all', 'Mark', 'Jayden'].map(opt => (
              <button
                key={opt}
                onClick={() => setTechFilter(opt)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{
                  backgroundColor: techFilter === opt ? ORANGE : '#f5f3f0',
                  color: techFilter === opt ? 'white' : '#555',
                  border: techFilter === opt ? `1px solid ${ORANGE}` : '1px solid #ddd',
                }}
              >{opt === 'all' ? 'All' : opt}</button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: '#555' }}>
            <input type="checkbox" checked={includeUnassigned} onChange={e => setIncludeUnassigned(e.target.checked)} />
            Include unassigned (Need to Dispatch)
          </label>
          <div className="ml-auto text-xs" style={{ color: '#888' }}>
            <span style={{ color: TECH_COLOR.Mark }}>● Mark {markCount}</span>
            <span className="ml-3" style={{ color: TECH_COLOR.Jayden }}>● Jayden {jaydenCount}</span>
            <span className="ml-3" style={{ color: UNASSIGNED_COLOR }}>● Unassigned {unassignedCount}</span>
          </div>
        </div>

        {err && (
          <div className="rounded-xl px-4 py-3 text-sm mb-3" style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
            {err}
          </div>
        )}

        {!MAPBOX_TOKEN && (
          <div className="rounded-xl p-6 mb-3 text-center" style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
            <div className="font-semibold mb-1">Mapbox token not configured</div>
            <div className="text-sm">Add <code>VITE_MAPBOX_PUBLIC_TOKEN</code> to a <code>.env</code> file at the repo root and redeploy. See <code>docs/dispatch-map-setup.md</code>.</div>
          </div>
        )}

        {/* Split: map left, side panel right */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4" style={{ height: 'calc(100vh - 220px)', minHeight: 480 }}>
          <div
            ref={mapContainer}
            className="rounded-2xl overflow-hidden"
            style={{ border: '1px solid #ebebeb', backgroundColor: '#e8e4e0' }}
          />
          <div className="rounded-2xl overflow-hidden flex flex-col" style={{ border: '1px solid #ebebeb', backgroundColor: '#f5f3f0' }}>
            {/* Tab toggle */}
            <div className="flex gap-1 px-2 pt-2" style={{ backgroundColor: '#f5f3f0' }}>
              {[
                { id: 'jobs',   label: 'Jobs' },
                { id: 'pinned', label: 'Pinned Shops' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setSidePanelTab(t.id)}
                  className="px-3 py-1.5 rounded-t-lg text-xs font-semibold"
                  style={{
                    backgroundColor: sidePanelTab === t.id ? 'white' : 'transparent',
                    color: sidePanelTab === t.id ? '#1a1a1a' : '#666',
                    border: '1px solid #ebebeb',
                    borderBottom: sidePanelTab === t.id ? '1px solid white' : '1px solid #ebebeb',
                    marginBottom: -1,
                  }}
                >{t.label}</button>
              ))}
            </div>
            <div className="flex-1 overflow-hidden">
              {sidePanelTab === 'jobs' ? (
                <DispatchSidePanel
                  pins={pins}
                  onReassign={handleReassign}
                  ambiguousShops={data?.ambiguous_shops || []}
                  ungeocodedShops={data?.ungeocoded_shops || []}
                  onManualGeocode={(name) => setPickerShop(name)}
                  onJobClick={() => {}}
                />
              ) : (
                <PinnedShopsPanel onChanged={load} />
              )}
            </div>
          </div>
        </div>
      </div>

      {pickerShop && (
        <ManualGeocodePicker
          shopName={pickerShop}
          onSaved={() => { setPickerShop(null); load() }}
          onClose={() => setPickerShop(null)}
        />
      )}
    </div>
  )
}
