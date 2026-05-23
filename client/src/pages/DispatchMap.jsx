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
  const [selectedJob, setSelectedJob] = useState(null)

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
      const color = pinColor(pin)
      const label = pin.drive_order != null ? String(pin.drive_order) : '•'
      // Custom calibration pin: teardrop with two radar/sensor arcs above the
      // head, signaling "this is a calibration job site" — color-coded by tech,
      // drive order number in the center disc.
      const el = document.createElement('div')
      el.style.cursor = 'pointer'
      el.innerHTML = `
        <svg width="40" height="52" viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg"
             style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.35)); display: block;">
          <!-- Calibration sensor arcs above pin head -->
          <path d="M12 8 Q20 4.5 28 8"  stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.6"/>
          <path d="M9.5 4.5 Q20 0.5 30.5 4.5" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.32"/>
          <!-- Teardrop pin body -->
          <path d="M20 11 C10 11 3 18 3 27.5 C3 36.5 20 51 20 51 C20 51 37 36.5 37 27.5 C37 18 30 11 20 11 Z"
                fill="${color}" stroke="white" stroke-width="2"/>
          <!-- Inner white disc -->
          <circle cx="20" cy="27.5" r="10" fill="white"/>
          <!-- Drive order number -->
          <text x="20" y="31.5" text-anchor="middle"
                font-family="-apple-system, BlinkMacSystemFont, 'IBM Plex Sans', sans-serif"
                font-weight="800" font-size="13" fill="${color}">${label}</text>
        </svg>
      `

      // Click pin -> select job in side panel (don't use the popup; the
      // detail card in the side panel is the spec'd interaction).
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        setSelectedJob(pin)
        setSidePanelTab('jobs')
      })

      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([pin.coords.lng, pin.coords.lat])
        .addTo(map)
      markersRef.current.push(marker)
      bounds.extend([pin.coords.lng, pin.coords.lat])
    })

    // Plot pinned shops as small faded gray markers BEHIND the active job pins.
    // Visual confirmation that pinned-shop locations are saved, even on days
    // when no active job is on the map for that shop.
    if (data.pinned_shops) {
      for (const p of data.pinned_shops) {
        if (p.lat == null || p.lng == null) continue
        // Skip if there's already an active job pin at this shop (avoid stacking)
        const hasActive = pins.some(jp => jp.shop_name && jp.shop_name.toLowerCase().trim() === (p.shop_name_key || '').toLowerCase().trim())
        if (hasActive) continue
        const el = document.createElement('div')
        el.title = p.shop_name_key
        el.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"
               style="display: block; opacity: 0.6;">
            <circle cx="7" cy="7" r="5" fill="#999999" stroke="white" stroke-width="1.5"/>
          </svg>
        `
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([p.lng, p.lat])
          .setPopup(new mapboxgl.Popup({ offset: 10, closeButton: false }).setHTML(`
            <div style="font-family: 'IBM Plex Sans', sans-serif; padding: 4px 2px; min-width: 140px;">
              <div style="font-weight: 600; font-size: 12px; color: #555;">${p.shop_name_key}</div>
              ${p.address ? `<div style="font-size: 11px; color: #888; margin-top: 2px;">${p.address}</div>` : ''}
              <div style="font-size: 10px; color: #aaa; margin-top: 4px; font-style: italic;">Pinned shop (no active job today)</div>
            </div>
          `))
          .addTo(map)
        markersRef.current.push(marker)
      }
    }

    // Plot tech home bases as small house markers, color-coded by tech.
    if (data.tech_homes) {
      for (const [tech, cfg] of Object.entries(data.tech_homes)) {
        if (cfg.home_lat == null || cfg.home_lng == null) continue
        const color = TECH_COLOR[tech] || '#999'
        const el = document.createElement('div')
        el.title = `${tech}'s base`
        el.innerHTML = `
          <svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg"
               style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.35)); display: block;">
            <!-- house silhouette -->
            <path d="M11 2 L2 10 L4 10 L4 19 L9 19 L9 14 L13 14 L13 19 L18 19 L18 10 L20 10 Z"
                  fill="${color}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
        `
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([cfg.home_lng, cfg.home_lat])
          .addTo(map)
        markersRef.current.push(marker)
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
      setSelectedJob(null) // clear selection so the new pin color renders
      await load()
    } catch (e) {
      setErr(`Reassign failed: ${e.message}`)
    }
  }

  async function handleReorder(tech, orderedJobIds) {
    try {
      const res = await apiFetch(`${API_BASE}/api/dispatch/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tech, date, order: orderedJobIds }),
      })
      if (!res.ok) {
        let m = `HTTP ${res.status}`
        try { const j = await res.json(); m = j.error || m } catch {}
        throw new Error(m)
      }
      await load()
    } catch (e) {
      setErr(`Reorder failed: ${e.message}`)
    }
  }

  const pins = data?.pins || []
  // A pin is "unassigned" if it has no technician OR its status is still
  // need_dispatch (the side panel's tech groups treat those as Unassigned
  // too — keep these counts mutually exclusive).
  const isUnassignedPin = (p) => !p.technician || p.status === 'need_dispatch'
  const markCount    = pins.filter(p => !isUnassignedPin(p) && (p.technician || '').toLowerCase().includes('mark')).length
  const jaydenCount  = pins.filter(p => !isUnassignedPin(p) && /jay?den/.test((p.technician || '').toLowerCase())).length
  const unassignedCount = pins.filter(isUnassignedPin).length

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
                  onReorder={handleReorder}
                  ambiguousShops={data?.ambiguous_shops || []}
                  ungeocodedShops={data?.ungeocoded_shops || []}
                  onManualGeocode={(name) => setPickerShop(name)}
                  onJobClick={(p) => setSelectedJob(p)}
                  selectedJob={selectedJob}
                  onClearSelection={() => setSelectedJob(null)}
                  capacities={data?.capacities || {}}
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
