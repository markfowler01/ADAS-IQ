// 🔬 Scrub Library (Mark 2026-09-28: "every job that is scrubbed saved,
// searchable, much like the Kinetic app" → then "how do I look at all these
// scrubs?").
//
// Every scrub we have ever run, newest first, searchable across shop, VIN,
// RO, claim, insurer and sensor name. Card layout like the rest of the app.
// Open one to see each sensor's Required / Not Required verdict with the
// estimate lines it cited and the justification that backs it — that text is
// what gets quoted back at an insurer who says no.
import { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'
const BLUE = '#1d4ed8'

const SOURCE_LABEL = {
  button: '🔬 Scrub button', upload: '📄 Upload screen', email: '📧 Email intake',
  equote: '📧 Email intake', requeue: '🔄 Re-scrub', 'report-only': '📎 Reports only',
}
const sourceLabel = s => SOURCE_LABEL[s] || (String(s || '').startsWith('mail:') ? `📥 ${String(s).slice(5)}` : s || '—')

const when = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ScrubLibraryScreen() {
  // Hooks first, always — this screen has early returns below (React #310).
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)      // the expanded scrub (full payload)
  const [openBusy, setOpenBusy] = useState(false)
  const timer = useRef(null)

  const load = async (search = '') => {
    setLoading(true); setErr('')
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs?limit=80${search ? `&q=${encodeURIComponent(search)}` : ''}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setRows(Array.isArray(d.scrubs) ? d.scrubs : [])
    } catch (e) { setErr(e.message || 'Could not load the library.'); setRows([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { load(''); apiFetch(`${API_BASE}/api/scrubs/stats`).then(r => r.json()).then(setStats).catch(() => {}) }, [])

  // Debounce the search so typing does not fire a request per keystroke.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => load(q.trim()), 350)
    return () => clearTimeout(timer.current)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const openScrub = async row => {
    setOpenBusy(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/${row.id}`)
      const d = await r.json().catch(() => ({}))
      setOpen(r.ok ? d : { ...row, _error: d.error || 'Could not open this scrub.' })
    } catch (e) { setOpen({ ...row, _error: e.message }) }
    finally { setOpenBusy(false) }
  }

  const counts = useMemo(() => ({
    shown: rows.length,
    required: rows.reduce((n, r) => n + (Number(r.requiredCount) || 0), 0),
  }), [rows])

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="mb-3">
        <h1 className="text-xl font-bold" style={{ color: '#1a1a1a' }}>🔬 Scrub Library</h1>
        <p className="text-xs mt-0.5" style={{ color: '#777' }}>
          Every estimate we have scrubbed. Search a shop, VIN, RO, claim, insurer or a sensor name.
        </p>
      </div>

      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search — Gerber, 2022 Mercedes, front radar, RO 3111218046…"
        className="w-full rounded-xl px-3 py-2.5 text-sm mb-3"
        style={{ border: '1.5px solid #ddd', outline: 'none' }}
      />

      <p className="text-xs mb-3" style={{ color: '#777' }}>
        {loading ? 'Loading…' : `${counts.shown} scrub${counts.shown === 1 ? '' : 's'} shown`}
        {stats?.total ? ` · ${stats.total} in the library` : ''}
        {counts.shown ? ` · ${counts.required} calibration${counts.required === 1 ? '' : 's'} called for` : ''}
      </p>

      {err && (
        <div className="rounded-xl p-3 mb-3 text-sm" style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1.5px solid #fecaca' }}>
          {err}
        </div>
      )}

      {!loading && !rows.length && !err && (
        <div className="rounded-xl p-6 text-center text-sm" style={{ backgroundColor: '#f5f3f0', color: '#777' }}>
          {q ? `Nothing matches "${q}".` : 'No scrubs yet. Press 🔬 Scrub estimate on a job card to run the first one.'}
        </div>
      )}

      <div className="grid gap-2">
        {rows.map(s => (
          <button
            key={s.id}
            onClick={() => openScrub(s)}
            className="text-left rounded-xl p-3 w-full"
            style={{ backgroundColor: '#fff', border: `2px solid ${s.requiredCount ? ORANGE : '#e5e5e5'}` }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold truncate" style={{ color: '#1a1a1a' }}>
                  {s.vehicle || 'Vehicle not read'}
                </div>
                <div className="text-xs truncate" style={{ color: '#666' }}>
                  {s.shop || 'Shop not read'}{s.ro ? ` · RO ${s.ro}` : ''}{s.insurer ? ` · 🏦 ${s.insurer}` : ''}
                </div>
              </div>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                style={s.requiredCount
                  ? { backgroundColor: ORANGE, color: '#fff' }
                  : { backgroundColor: '#f5f3f0', color: '#777' }}
              >
                {s.requiredCount} of {s.sensorCount}
              </span>
            </div>

            {s.requiredNames && (
              <div className="text-xs mt-1.5" style={{ color: BLUE }}>🔧 {s.requiredNames}</div>
            )}

            <div className="text-[10px] mt-1.5 flex flex-wrap gap-x-2" style={{ color: '#999' }}>
              <span>{sourceLabel(s.source)}</span>
              {s.by && <span>· {s.by}</span>}
              {s.at && <span>· {when(s.at)}</span>}
              {s.vin && <span className="font-mono">· {s.vin}</span>}
              {Array.isArray(s.reports) && s.reports.length > 0 && <span>· 📎 {s.reports.length} report{s.reports.length === 1 ? '' : 's'}</span>}
            </div>
          </button>
        ))}
      </div>

      {(open || openBusy) && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
          onClick={() => !openBusy && setOpen(null)}
        >
          <div
            className="rounded-2xl w-full max-w-2xl overflow-y-auto"
            style={{ backgroundColor: '#fff', maxHeight: '85vh' }}
            onClick={e => e.stopPropagation()}
          >
            {openBusy && <p className="p-6 text-sm text-center" style={{ color: '#777' }}>Opening…</p>}
            {open && !openBusy && <ScrubDetail s={open} onClose={() => setOpen(null)} />}
          </div>
        </div>
      )}
    </div>
  )
}

function ScrubDetail({ s, onClose }) {
  const cals = Array.isArray(s.payload?.calibrations) ? s.payload.calibrations : []
  // Fall back to the compact per-sensor list when the full payload is missing.
  const list = cals.length ? cals.map(c => ({
    name: c.sensor || c.calibration_name || '',
    type: c.cal_type || '',
    required: c.enabled === true,
    lines: c.line_references || '',
    trigger: c.trigger || '',
    why: c.justification || '',
  })) : (s.sensors || []).map(x => ({ name: x.n, type: x.t, required: x.r, lines: x.l, trigger: x.g, why: '' }))

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold" style={{ color: '#1a1a1a' }}>{s.vehicle || 'Vehicle not read'}</h2>
          <p className="text-xs" style={{ color: '#666' }}>
            {s.shop || 'Shop not read'}{s.ro ? ` · RO ${s.ro}` : ''}{s.claim ? ` · claim ${s.claim}` : ''}
          </p>
          <p className="text-xs" style={{ color: '#999' }}>
            {s.insurer ? `🏦 ${s.insurer} · ` : ''}{sourceLabel(s.source)}{s.by ? ` · ${s.by}` : ''}{s.at ? ` · ${when(s.at)}` : ''}
          </p>
          {s.vin && <p className="text-xs font-mono" style={{ color: '#999' }}>VIN {s.vin}</p>}
        </div>
        <button onClick={onClose} className="text-sm font-bold px-2 py-1 rounded" style={{ color: '#777' }}>✕</button>
      </div>

      {s._error && (
        <div className="rounded-lg p-2 mb-3 text-sm" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>{s._error}</div>
      )}

      {Array.isArray(s.reports) && s.reports.length > 0 && (
        <div className="rounded-lg p-2 mb-3 text-xs" style={{ backgroundColor: '#eff6ff', color: '#1e40af' }}>
          📎 Went out with the invoice: {s.reports.map(r => r.name).join(', ')}
        </div>
      )}

      {!list.length && <p className="text-sm" style={{ color: '#777' }}>No sensors recorded on this scrub.</p>}

      <div className="grid gap-1.5">
        {list.map((c, i) => (
          <div
            key={i}
            className="rounded-lg p-2.5"
            style={{ backgroundColor: c.required ? '#fff7ed' : '#fafafa', border: `1.5px solid ${c.required ? ORANGE : '#eee'}` }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold" style={{ color: '#1a1a1a' }}>{c.name}</span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                style={c.required ? { backgroundColor: ORANGE, color: '#fff' } : { backgroundColor: '#eee', color: '#777' }}
              >{c.required ? 'REQUIRED' : 'not required'}</span>
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: '#777' }}>
              {[c.type, c.trigger, c.lines ? `lines ${c.lines}` : ''].filter(Boolean).join(' · ')}
            </div>
            {c.why && <p className="text-xs mt-1" style={{ color: '#444' }}>{c.why}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
