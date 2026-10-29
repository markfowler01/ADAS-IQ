// 🗑 Recently removed (Mark 2026-10-29: "I need you to create a system that this can
// never happen again"). Every card that left the board in the last 90 days — why, who,
// when — with one-tap Restore. Server: services/jobTrash.js, /api/jobs/trash.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const REASONS = { invoice_sent: '🧾 Invoice sent', estimate_closed: '📄 Quote closed in Books', clean_invoiced: '🧹 Clean Out', cleanup: '🧹 Cleanup', quote_dead: '💀 Quote marked dead', manual: '✋ Deleted on the board', automation: '🤖 Automation' }
const when = iso => { try { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return iso } }
const pretty = s => String(s || '').replace(/_/g, ' ')

export function JobTrashButton({ onClick }) {
  return (
    <button onClick={onClick} className="flex text-xs font-medium px-3 py-1.5 rounded-lg items-center gap-1.5"
      style={{ color: '#555', border: '1px solid #e0dbd6', backgroundColor: 'white', flexShrink: 0 }}
      title="Every card taken off the board in the last 90 days — restore any of them">
      🗑 Recently removed
    </button>
  )
}

export default function JobTrashModal({ onClose, onRestored }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [q, setQ] = useState('')

  const load = async () => {
    setErr('')
    try {
      const r = await apiFetch(`${API_BASE}/api/jobs/trash`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setItems(d.items || [])
    } catch (e) { setErr(e.message); setItems([]) }
  }
  useEffect(() => { load() }, [])

  const restore = async it => {
    if (!confirm(`Put ${it.summary.shop}${it.summary.vehicle ? ' · ' + it.summary.vehicle : ''} back on the board (${pretty(it.summary.status)})?`)) return
    setBusy(it.id)
    try {
      const r = await apiFetch(`${API_BASE}/api/jobs/trash/${it.id}/restore`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setItems(list => list.filter(x => x.id !== it.id))
      onRestored?.(d)
    } catch (e) { alert(`Restore failed: ${e.message}`) }
    setBusy('')
  }

  const shown = (items || []).filter(it => {
    if (!q.trim()) return true
    const s = it.summary || {}
    return [s.shop, s.vehicle, s.ro, s.vin, s.technician, it.reason, it.by].join(' ').toLowerCase().includes(q.trim().toLowerCase())
  })

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-8" style={{ background: 'rgba(0,0,0,.45)' }} onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl flex flex-col" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b" style={{ borderColor: '#eee' }}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold">🗑 Recently removed</h2>
            <button onClick={onClose} className="text-sm px-2 py-1 rounded" style={{ color: '#666' }}>Close</button>
          </div>
          <p className="text-xs mt-1" style={{ color: '#777' }}>Every card that left the board in the last 90 days. Nothing is gone for good — Restore puts it back exactly as it was.</p>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search shop, vehicle, RO, VIN…"
            className="mt-3 w-full text-sm px-3 py-2 rounded-lg" style={{ border: '1px solid #e0dbd6' }} />
        </div>
        <div className="overflow-y-auto px-3 py-2">
          {items === null && <p className="text-sm p-4" style={{ color: '#888' }}>Loading…</p>}
          {err && <p className="text-sm p-4" style={{ color: '#b91c1c' }}>{err}</p>}
          {items && !shown.length && !err && <p className="text-sm p-4" style={{ color: '#888' }}>Nothing here{q ? ' for that search' : ''}.</p>}
          {shown.map(it => {
            const s = it.summary || {}
            const live = !s.invoiced && !['complete'].includes(s.status)
            return (
              <div key={it.id} className="flex items-start gap-3 px-2 py-3 border-b" style={{ borderColor: '#f2f0ee' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{s.shop || 'Job'}{s.vehicle ? ` · ${s.vehicle}` : ''}</div>
                  <div className="text-xs mt-0.5" style={{ color: '#666' }}>
                    {pretty(s.status)}{s.technician ? ` · ${s.technician}` : ''}{s.ro ? ` · ${s.ro}` : ''}{s.invoiced ? ' · invoiced' : ''}
                  </div>
                  <div className="text-xs mt-1 flex flex-wrap gap-1.5 items-center">
                    <span className="px-1.5 py-0.5 rounded font-bold" style={{ background: it.auto ? '#fef3c7' : '#f3f4f6', color: it.auto ? '#92400e' : '#374151' }}>{REASONS[it.reason] || it.reason}</span>
                    {live && <span className="px-1.5 py-0.5 rounded font-bold" style={{ background: '#fee2e2', color: '#b91c1c' }}>⚠️ was live work</span>}
                    <span style={{ color: '#888' }}>{when(it.at)} · by {it.by}{it.match ? ` · matched by ${it.match}` : ''}</span>
                  </div>
                  {it.detail && <div className="text-xs mt-0.5" style={{ color: '#999' }}>{it.detail}</div>}
                </div>
                <button disabled={busy === it.id} onClick={() => restore(it)} className="text-xs font-bold px-3 py-1.5 rounded-lg flex-shrink-0"
                  style={{ background: '#111827', color: 'white', opacity: busy === it.id ? 0.5 : 1 }}>
                  {busy === it.id ? 'Restoring…' : '↩︎ Restore'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
