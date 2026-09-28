// 🔬 Scrub button on a job card (Mark 2026-09-28: "create a scrubber button
// on the jobs board" so Kat can test the Absolute ADAS scrubber without
// waiting on the email intake).
//
// It scrubs the estimate already sitting in that car's WorkDrive folder. The
// server picks the CCC estimate over any Kinetic report or post-scan in the
// same folder, runs our scrubber, patches the card and files the result in
// the scrub library.
//
// A scrub usually returns inside Catalyst's ~30s gateway window. When it does
// not, the server says queued and the ticker finishes it, so the button says
// so rather than pretending it failed.
import { useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

export default function ScrubButton({ job, done = false, onDone, compact = false }) {
  // Hooks first — this file must never grow an early return above them (React #310).
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const run = async e => {
    e.stopPropagation()
    if (busy) return
    setBusy(true); setNote('')
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/job/${job.id}`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'The scrub failed.')
      if (d.queued) {
        setNote('queued')
        window.dispatchEvent(new CustomEvent('adas:toast', { detail: '🔬 Scrub is running — the card updates when it lands.' }))
      } else {
        const n = d.scrub?.requiredCount
        window.dispatchEvent(new CustomEvent('adas:toast', {
          detail: `🔬 Scrubbed ${d.scrub?.vehicle || 'the estimate'}${Number.isFinite(n) ? ` · ${n} calibration${n === 1 ? '' : 's'} required` : ''}`,
        }))
      }
      onDone?.(d)
    } catch (err) {
      setNote('failed')
      window.dispatchEvent(new CustomEvent('adas:toast', { detail: `Scrub failed: ${err.message}` }))
    } finally { setBusy(false) }
  }

  const label = busy ? '🔬 Scrubbing…' : done ? '🔄 Re-scrub' : '🔬 Scrub estimate'
  const style = busy
    ? { backgroundColor: '#dbeafe', color: '#1e40af', border: '1.5px solid #93c5fd' }
    : done
      ? { backgroundColor: '#f5f3f0', color: '#555', border: '1.5px solid #ddd' }
      : { backgroundColor: '#1d4ed8', color: '#fff', border: '1.5px solid #1d4ed8' }

  return (
    <button
      onClick={run}
      disabled={busy}
      title={done
        ? 'Run our scrubber over this estimate again'
        : 'Read the estimate in this car\'s folder with the Absolute ADAS scrubber'}
      className={`${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-1'} font-bold rounded inline-block`}
      style={{ ...style, opacity: busy ? 0.85 : 1, cursor: busy ? 'default' : 'pointer' }}
    >{label}{note === 'queued' ? ' · running' : ''}</button>
  )
}
