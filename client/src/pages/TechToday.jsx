// /today screen — the logged-in tech's day in drive order.
// Mobile-first. Each card derives its visual state from timestamps stored
// in the absolute_adas_job_state cache (see backend services/dispatch.js).

import { useState, useEffect, useCallback } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import TodayJobCard from '../components/TodayJobCard.jsx'
import CalibrationReviewModal from '../components/CalibrationReviewModal.jsx'
import Navbar from '../components/Navbar.jsx'

const ORANGE = '#CD4419'

// Open the native maps app. Tries lat/lng first (always works), then a search
// query built from address / shop name. iOS prefers Apple Maps; everything else
// Google. Logs the chosen target so we can debug "no address" reports.
function openMaps({ lat, lng, address, shopName }) {
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
  const fallbackQuery = address || (shopName ? `${shopName}, Lake Stevens, WA` : '')
  let url

  if (isiOS) {
    if (lat != null && lng != null) {
      url = `maps://?daddr=${lat},${lng}`
    } else if (fallbackQuery) {
      url = `maps://?daddr=${encodeURIComponent(fallbackQuery)}`
    }
  }
  if (!url) {
    if (lat != null && lng != null) {
      url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    } else if (fallbackQuery) {
      url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fallbackQuery)}`
    }
  }
  console.log('[navigate]', { lat, lng, address, shopName, url })
  if (url) window.location.href = url
  else alert(`No location for "${shopName || 'this job'}". Add an address to the shop in CRM or set coordinates from the Dispatch Map.`)
}

export default function TechToday({ user, onLogout, currentScreen, onNavigate }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [reviewJob, setReviewJob] = useState(null)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    try {
      setErr('')
      const res = await apiFetch(`${API_BASE}/api/today`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setData(json)
      // Auto-expand the next active job (first non-complete)
      const next = (json.jobs || []).find(j => !j.completed_at)
      if (next && expandedId == null) setExpandedId(next.id)
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [expandedId])

  useEffect(() => { load() }, [load])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  async function patchState(jobId, path) {
    const res = await apiFetch(`${API_BASE}/api/jobs/${jobId}/${path}`, { method: 'PATCH' })
    if (!res.ok) {
      let m = `HTTP ${res.status}`
      try { const j = await res.json(); m = j.error || m } catch {}
      throw new Error(m)
    }
    return res.json()
  }

  async function postAction(jobId, path, body) {
    const res = await apiFetch(`${API_BASE}/api/jobs/${jobId}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
    if (!res.ok) {
      let m = `HTTP ${res.status}`
      try { const j = await res.json(); m = j.error || m } catch {}
      throw new Error(m)
    }
    return res.json()
  }

  async function handleAction(job, action) {
    try {
      if (action === 'navigate') {
        // Stamp en_route_at first (so the card flips), then open maps.
        if (!job.en_route_at) {
          await patchState(job.id, 'en-route').catch(() => {})
        }
        openMaps({
          lat: job.coords?.lat,
          lng: job.coords?.lng,
          address: job.nav_address || job.shop_address,
          shopName: job.shop_name,
        })
        await load()
        return
      }
      if (action === 'start') {
        await patchState(job.id, 'start')
        await load()
        return
      }
      if (action === 'complete') {
        // Open calibration review first; on Done, call /complete with updated cals.
        setReviewJob(job)
        return
      }
      if (action === 'running-late') {
        const delay = window.prompt('Roughly how many minutes late?', '15')
        if (delay == null) return
        await postAction(job.id, 'running-late', { delay_min: Number(delay) || 0 })
        showToast('Kat has been notified you are running late.')
        return
      }
      if (action === "can't-access") {
        const note = window.prompt('Brief note for Kat (optional):', '')
        await postAction(job.id, 'cant-access', { note: note || '' })
        showToast('Kat has been notified about access.')
        return
      }
    } catch (e) {
      showToast(`Action failed: ${e.message}`)
    }
  }

  async function handleCalReviewConfirm(updatedCals) {
    if (!reviewJob) return
    try {
      const res = await apiFetch(`${API_BASE}/api/jobs/${reviewJob.id}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calibrations: updatedCals }),
      })
      if (!res.ok) {
        let m = `HTTP ${res.status}`
        try { const j = await res.json(); m = j.error || m } catch {}
        throw new Error(m)
      }
      setReviewJob(null)
      showToast('✓ Job complete. Kat has been notified to invoice.')
      await load()
    } catch (e) {
      showToast(`Complete failed: ${e.message}`)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f5f3f0' }}>
        <p className="text-gray-400 text-sm">Loading…</p>
      </div>
    )
  }

  const jobs = data?.jobs || []
  const completed = jobs.filter(j => j.completed_at).length

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

      {/* Sticky header */}
      <div className="sticky top-0 z-10 px-4 py-3" style={{ backgroundColor: '#f5f3f0', borderBottom: '1px solid #e8e4e0' }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>
              Today · {data?.tech || ''}
            </div>
            <div className="text-base font-bold" style={{ color: '#1a1a1a' }}>
              {new Date(data?.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
          </div>
          <div className="text-sm font-semibold" style={{ color: ORANGE }}>
            {completed} of {jobs.length} complete
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">
        {err && (
          <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
            {err}
          </div>
        )}

        {jobs.length === 0 && !err && (
          <div className="rounded-2xl bg-white p-8 text-center" style={{ border: '1px solid #ebebeb' }}>
            <div className="text-4xl mb-2">🌤️</div>
            <p className="text-base font-semibold" style={{ color: '#1a1a1a' }}>No jobs scheduled for today.</p>
            <p className="text-sm mt-1" style={{ color: '#888' }}>Enjoy the day.</p>
          </div>
        )}

        {jobs.map(job => (
          <TodayJobCard
            key={job.id}
            job={job}
            isExpanded={expandedId === job.id}
            onToggleExpand={() => setExpandedId(prev => prev === job.id ? null : job.id)}
            onAction={(name) => handleAction(job, name)}
          />
        ))}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed left-4 right-4 z-50 rounded-xl px-4 py-3 text-sm shadow-lg"
          style={{ bottom: 24, backgroundColor: '#1a1a1a', color: 'white', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
          {toast}
        </div>
      )}

      {/* Calibration review modal (intercepts Complete) */}
      {reviewJob && (
        <CalibrationReviewModal
          job={reviewJob}
          onConfirm={handleCalReviewConfirm}
          onClose={() => setReviewJob(null)}
        />
      )}
    </div>
  )
}
