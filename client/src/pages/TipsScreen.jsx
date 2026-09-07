// Absolute ADAS TSB library (Mark 2026-09-05) — team tips & tricks:
// calibration, keys, cloning. Quick to add (voice-typed, AI cleanup),
// instantly searchable. Phase 2 adds the ask-Claude box up top.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { API_BASE, apiFetch, getToken } from '../utils/api.js'
import Navbar from '../components/Navbar'

const ORANGE = '#CD4419'
const CATEGORIES = [
  { id: 'calibration', label: '🎯 Calibration', color: '#CD4419', bg: '#fdf3ef' },
  { id: 'keys',        label: '🔑 Keys',        color: '#a16207', bg: '#fefce8' },
  { id: 'cloning',     label: '🧬 Cloning',     color: '#7e22ce', bg: '#fdf4ff' },
  { id: 'general',     label: '💡 General',     color: '#1d4ed8', bg: '#eff6ff' },
]
const catOf = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[3]

function vehicleLabel(t) {
  const yrs = t.year_from && t.year_to ? `${t.year_from}–${t.year_to}` : (t.year_from || t.year_to || '')
  return [yrs, t.make, t.model].filter(Boolean).join(' ') || 'All vehicles'
}

export default function TipsScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [tsbs, setTsbs] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [showNew, setShowNew] = useState(false)
  const [editTsb, setEditTsb] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [toast, setToast] = useState(null)
  const [view, setView] = useState('tips')  // tips | cloning

  const isOwner = String(user?.email || '').toLowerCase().startsWith('mark@') || user?.role === 'owner'
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2600) }

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/api/tsb`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setTsbs(j.tsbs || [])
      setErr(null)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const visible = useMemo(() => {
    let list = tsbs
    if (cat !== 'all') list = list.filter(t => t.category === cat)
    const needle = q.trim().toLowerCase()
    if (needle) {
      list = list.filter(t =>
        [t.title, t.body, t.make, t.model, t.tools, t.author].join(' ').toLowerCase().includes(needle))
    }
    return list
  }, [tsbs, cat, q])

  async function handleDelete(t) {
    if (!window.confirm(`Delete "${t.title}"? This can't be undone.`)) return
    try {
      const r = await apiFetch(`${API_BASE}/api/tsb/${t.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      showToast('🗑 Deleted')
      load()
    } catch (e) { showToast(`Delete failed: ${e.message}`) }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-3xl mx-auto px-4 py-5 pb-24">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-extrabold" style={{ color: '#1a1a1a' }}>📖 Absolute ADAS TSBs</h1>
            <p className="text-xs" style={{ color: '#888' }}>Team tips & tricks — search first, ask a teammate second.</p>
          </div>
          <button onClick={() => setShowNew(true)}
            className="rounded-xl px-4 py-2.5 text-sm font-bold text-white flex-shrink-0"
            style={{ backgroundColor: ORANGE }}>+ New TSB</button>
        </div>

        <div className="flex gap-1.5 mb-3">
          {[['tips', '📖 Tips'], ['cloning', '🧬 Hex Prog Coverage']].map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className="text-sm font-bold rounded-xl px-4 py-2.5"
              style={view === v
                ? { backgroundColor: '#1a1a1a', color: 'white' }
                : { backgroundColor: 'white', border: '1px solid #e0dbd6', color: '#666' }}>{label}</button>
          ))}
        </div>

        {view === 'cloning' && <CloningCoverage />}

        {view === 'tips' && (<>
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search — vehicle, symptom, tool…"
          className="w-full rounded-xl px-4 py-3 text-sm mb-3"
          style={{ border: '1px solid #e0dbd6', backgroundColor: 'white' }}
        />
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3" style={{ scrollbarWidth: 'none' }}>
          {[{ id: 'all', label: 'All' }, ...CATEGORIES].map(c => (
            <button key={c.id} onClick={() => setCat(c.id)}
              className="text-xs font-bold rounded-full px-3 py-1.5 flex-shrink-0"
              style={cat === c.id
                ? { backgroundColor: c.color || '#1a1a1a', color: 'white' }
                : { backgroundColor: 'white', border: '1px solid #e0dbd6', color: '#666' }}>
              {c.label} {c.id !== 'all' ? tsbs.filter(t => t.category === c.id).length || '' : tsbs.length || ''}
            </button>
          ))}
        </div>

        {loading && <p className="text-sm text-center py-10" style={{ color: '#888' }}>Loading…</p>}
        {err && <p className="text-sm text-center py-4" style={{ color: '#dc2626' }}>{err}</p>}
        {!loading && !err && visible.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm mb-1" style={{ color: '#888' }}>
              {tsbs.length === 0 ? 'No TSBs yet — write the first one.' : 'Nothing matches that search.'}
            </p>
            {tsbs.length === 0 && (
              <p className="text-xs" style={{ color: '#aaa' }}>Fought a car and won? Save the trick so nobody fights it twice.</p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {visible.map(t => {
            const c = catOf(t.category)
            const open = String(openId) === String(t.id)
            return (
              <div key={t.id} onClick={() => setOpenId(open ? null : t.id)}
                className="bg-white rounded-xl p-3.5 cursor-pointer shadow-sm"
                style={{ border: '1px solid #ebebeb' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-snug" style={{ color: '#1a1a1a' }}>
                      {t.number ? <span style={{ color: '#aaa', fontWeight: 600 }}>{t.number} · </span> : null}{t.title}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#888' }}>{vehicleLabel(t)}{t.tools ? ` · 🧰 ${t.tools}` : ''}</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0"
                    style={{ backgroundColor: c.bg, color: c.color }}>{c.label}</span>
                </div>
                <p className="text-sm mt-2 whitespace-pre-wrap" style={{ color: '#374151' }}>
                  {open ? t.body : (t.body.length > 140 ? t.body.slice(0, 140) + '…' : t.body)}
                </p>
                {Array.isArray(t.photos) && t.photos.length > 0 && (
                  <div className="flex gap-1.5 mt-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                    {t.photos.map(ph => (
                      <img key={ph.file_id}
                        src={`${API_BASE}/api/tsb/photo/${ph.file_id}?t=${encodeURIComponent(getToken())}`}
                        alt="" loading="lazy"
                        onClick={e => { e.stopPropagation(); window.open(`${API_BASE}/api/tsb/photo/${ph.file_id}?t=${encodeURIComponent(getToken())}`, '_blank') }}
                        className="rounded-lg flex-shrink-0"
                        style={{ height: open ? 120 : 60, width: 'auto', objectFit: 'cover', border: '1px solid #ebebeb' }}
                      />
                    ))}
                  </div>
                )}
                {open && (
                  <div className="flex items-center justify-between mt-3 pt-2" style={{ borderTop: '1px solid #f4f1ee' }}>
                    <span className="text-[11px]" style={{ color: '#aaa' }}>
                      {t.author}{t.created_at ? ` · ${new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                    </span>
                    <div className="flex gap-2">
                      <button onClick={async e => {
                        e.stopPropagation()
                        showToast('📄 Building bulletin…')
                        try {
                          const r = await apiFetch(`${API_BASE}/api/tsb/${t.id}/pdf`, { method: 'POST' })
                          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
                          const blob = await r.blob()
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `${(r.headers.get('Content-Disposition') || '').match(/filename="(.+?)"/)?.[1] || 'Absolute-ADAS-TSB.pdf'}`
                          document.body.appendChild(a); a.click(); a.remove()
                          URL.revokeObjectURL(url)
                          load()
                        } catch (err) { showToast(`PDF failed: ${err.message}`) }
                      }}
                        className="text-xs font-bold rounded-lg px-3 py-1.5"
                        style={{ backgroundColor: '#fdf3ef', color: ORANGE }}>📄 Official PDF</button>
                      <button onClick={e => { e.stopPropagation(); setEditTsb(t) }}
                        className="text-xs font-bold rounded-lg px-3 py-1.5"
                        style={{ backgroundColor: '#f5f3f0', color: '#555' }}>✎ Edit</button>
                      {isOwner && (
                        <button onClick={e => { e.stopPropagation(); handleDelete(t) }}
                          className="text-xs font-bold rounded-lg px-3 py-1.5"
                          style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>Delete</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        </>)}
      </div>

      {(showNew || editTsb) && (
        <TsbModal
          tsb={editTsb}
          onClose={() => { setShowNew(false); setEditTsb(null) }}
          onSaved={(msg, saved) => {
            showToast(msg)
            load()
            // New TSB → reopen in edit mode so photos can be attached.
            if (showNew && saved) { setShowNew(false); setEditTsb(saved) }
            else { setShowNew(false); setEditTsb(null) }
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 text-white text-xs font-semibold rounded-full px-4 py-2 z-50"
          style={{ backgroundColor: '#1a1a1a' }}>{toast}</div>
      )}
    </div>
  )
}

function TsbModal({ tsb, onClose, onSaved }) {
  const isEdit = !!tsb
  const [category, setCategory] = useState(tsb?.category || 'calibration')
  const [body, setBody] = useState(tsb?.body || '')
  const [title, setTitle] = useState(tsb?.title || '')
  const [make, setMake] = useState(tsb?.make || '')
  const [model, setModel] = useState(tsb?.model || '')
  const [yearFrom, setYearFrom] = useState(tsb?.year_from || '')
  const [yearTo, setYearTo] = useState(tsb?.year_to || '')
  const [tools, setTools] = useState(tsb?.tools || '')
  const [cleanup, setCleanup] = useState(!isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function save() {
    if (!body.trim()) { setError('Write the tip first.'); return }
    setSaving(true); setError(null)
    try {
      const payload = { category, body, title, make, model, year_from: yearFrom, year_to: yearTo, tools, cleanup }
      const r = await apiFetch(`${API_BASE}/api/tsb${isEdit ? `/${tsb.id}` : ''}`, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      onSaved(isEdit ? '✅ TSB updated' : '✅ TSB saved — add photos below', j.tsb)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const input = { border: '1px solid #e0dbd6', backgroundColor: 'white' }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5 overflow-y-auto" style={{ maxHeight: '92vh' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold">{isEdit ? '✎ Edit TSB' : '📖 New TSB'}</h2>
          <button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button>
        </div>

        <div className="flex gap-1.5 mb-3 flex-wrap">
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={() => setCategory(c.id)}
              className="text-xs font-bold rounded-full px-3 py-1.5"
              style={category === c.id
                ? { backgroundColor: c.color, color: 'white' }
                : { backgroundColor: 'white', border: '1px solid #e0dbd6', color: '#666' }}>{c.label}</button>
          ))}
        </div>

        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="The tip — talk it in with the mic key. What car, what problem, what fixed it."
          rows={5}
          className="w-full rounded-xl px-3 py-2.5 text-sm mb-2"
          style={input}
        />
        {!isEdit && (
          <label className="flex items-center gap-2 text-xs mb-3" style={{ color: '#666' }}>
            <input type="checkbox" checked={cleanup} onChange={e => setCleanup(e.target.checked)} />
            ✨ Let AI tidy it up and write the title
          </label>
        )}
        {(isEdit || !cleanup) && (
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title"
            className="w-full rounded-xl px-3 py-2.5 text-sm mb-2" style={input} />
        )}

        <div className="grid grid-cols-2 gap-2 mb-2">
          <input value={make} onChange={e => setMake(e.target.value)} placeholder="Make (blank = all)"
            className="rounded-xl px-3 py-2.5 text-sm" style={input} />
          <input value={model} onChange={e => setModel(e.target.value)} placeholder="Model"
            className="rounded-xl px-3 py-2.5 text-sm" style={input} />
          <input value={yearFrom} onChange={e => setYearFrom(e.target.value)} placeholder="Year from" inputMode="numeric"
            className="rounded-xl px-3 py-2.5 text-sm" style={input} />
          <input value={yearTo} onChange={e => setYearTo(e.target.value)} placeholder="Year to" inputMode="numeric"
            className="rounded-xl px-3 py-2.5 text-sm" style={input} />
        </div>
        <input value={tools} onChange={e => setTools(e.target.value)} placeholder="Tools used (Autel IM608, key programmer…)"
          className="w-full rounded-xl px-3 py-2.5 text-sm mb-3" style={input} />

        {/* Photos — only after the TSB exists (needs an id to attach to) */}
        {isEdit && <TsbPhotoEditor tsb={tsb} />}

        {error && <p className="text-xs mb-2" style={{ color: '#dc2626' }}>{error}</p>}
        <button onClick={save} disabled={saving}
          className="w-full py-3 rounded-xl font-bold text-white text-sm"
          style={{ backgroundColor: saving ? '#e5a58e' : ORANGE }}>
          {saving ? (cleanup && !isEdit ? '✨ Cleaning up & saving…' : 'Saving…') : (isEdit ? 'Save Changes' : 'Save TSB')}
        </button>
      </div>
    </div>
  )
}


// Hex Prog II coverage search — server-side substring search over the
// parsed Microtronik dataset (~read-only reference).
function CloningCoverage() {
  const [q, setQ] = useState('')
  const [type, setType] = useState('vehicles')
  const [stats, setStats] = useState(null)
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanDetail, setScanDetail] = useState('')
  const camRef = useRef(null)

  useEffect(() => {
    apiFetch(`${API_BASE}/api/cloning/stats`).then(r => r.json()).then(setStats).catch(() => {})
  }, [])

  useEffect(() => {
    const needle = q.trim()
    if (!needle) { setRes(null); return }
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await apiFetch(`${API_BASE}/api/cloning/search?q=${encodeURIComponent(needle)}&type=${type}`)
        setRes(await r.json())
      } catch { setRes(null) }
      finally { setBusy(false) }
    }, 250)
    return () => clearTimeout(t)
  }, [q, type])

  return (
    <div>
      <div className="flex gap-1.5 mb-2 flex-wrap">
        {[['vehicles', '🚗 Hex Prog · Vehicles'], ['ecus', '🖥 Hex Prog · ECUs'], ['dc706', '🔑 OBDSTAR DC706']].map(([v, label]) => (
          <button key={v} onClick={() => setType(v)}
            className="text-xs font-bold rounded-full px-3 py-1.5"
            style={type === v
              ? { backgroundColor: '#7e22ce', color: 'white' }
              : { backgroundColor: 'white', border: '1px solid #e0dbd6', color: '#666' }}>{label}</button>
        ))}
        {stats?.tools && (
          <span className="text-[11px] self-center ml-auto" style={{ color: '#aaa' }}>
            {stats.tools.map(t => `${t.label}: ${Number(t.vehicles || t.modules || 0).toLocaleString()}`).join(' · ')}
          </span>
        )}
      </div>
      <div className="flex gap-2 mb-1">
        <input
          type="search"
          value={q}
          onChange={e => { setQ(e.target.value); setScanDetail('') }}
          placeholder={type === 'vehicles' ? 'Search — 2018 F-150, BMW 5-Series, EDC17…'
            : type === 'dc706' ? 'Search — make, module, BCM, TCM, MCU…' : 'Search — module, MCU, make…'}
          className="flex-1 rounded-xl px-4 py-3 text-sm"
          style={{ border: '1px solid #e0dbd6', backgroundColor: 'white' }}
        />
        <input
          ref={camRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={async e => {
            const file = e.target.files?.[0]
            if (!file) return
            setScanning(true); setScanDetail('')
            try {
              const fd = new FormData()
              fd.append('image', file)
              const r = await apiFetch(`${API_BASE}/api/cloning/extract-label`, { method: 'POST', body: fd })
              const d = await r.json()
              if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
              if (d.terms) { setQ(d.terms); setScanDetail(d.detail || '') }
              else setScanDetail(d.detail || 'Could not read the label — try a closer, straight-on shot.')
            } catch (err) { setScanDetail(`Scan failed: ${err.message}`) }
            finally { setScanning(false); if (camRef.current) camRef.current.value = '' }
          }}
        />
        <button
          type="button"
          onClick={() => camRef.current?.click()}
          disabled={scanning}
          className="rounded-xl px-4 text-sm font-bold flex-shrink-0"
          style={{ border: '1px solid #e0dbd6', backgroundColor: scanning ? '#f5f3f0' : 'white', color: '#555' }}
        >{scanning ? '🔍…' : '📷 Scan ECU'}</button>
      </div>
      {scanDetail && <p className="text-[11px] mb-2" style={{ color: '#7e22ce' }}>🤖 {scanDetail}</p>}
      <div className="mb-2" />
      {!q.trim() && (
        <p className="text-sm text-center py-10" style={{ color: '#aaa' }}>
          Type a vehicle or module — answers come from the Hex Prog II coverage list.
        </p>
      )}
      {busy && <p className="text-xs text-center py-2" style={{ color: '#aaa' }}>Searching…</p>}
      {res && q.trim() && (
        <>
          <p className="text-[11px] mb-2" style={{ color: '#888' }}>
            {res.total === 0 ? 'No coverage found — Hex Prog may not support this one.'
              : `${res.total}${res.capped ? '+' : ''} match${res.total === 1 ? '' : 'es'}${res.total > 100 ? ' (showing 100 — narrow the search)' : ''}`}
          </p>
          <div className="flex flex-col gap-1.5">
            {(res.results || []).map((r, i) => (
              <div key={i} className="bg-white rounded-xl px-3.5 py-2.5" style={{ border: '1px solid #ebebeb' }}>
                {res.type === 'dc706' ? (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-bold" style={{ color: '#1a1a1a' }}>
                        {r.make}{r.module ? ` · ${r.module}` : ''} — {r.maker} {r.type || r.mcu}
                      </p>
                      {r.method && <MethodBadge method={r.method} />}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: '#666' }}>
                      <span style={{ color: '#7e22ce', fontWeight: 700 }}>{r.system}</span>
                      {r.mcu && <span> · {r.mcu}</span>}
                      {r.caps && <span> · {r.caps}</span>}
                      {r.other && <span> · {r.other}</span>}
                    </p>
                  </>
                ) : res.type === 'vehicles' ? (
                  <>
                    <p className="text-sm font-bold" style={{ color: '#1a1a1a' }}>
                      {[r.year, r.make, r.model].filter(Boolean).join(' ')}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#666' }}>
                      {r.engine && <span>{r.engine} · </span>}
                      {r.ecu && <span className="font-bold" style={{ color: '#7e22ce' }}>ECU {r.ecu}</span>}
                      {r.micro && <span> · {r.micro}</span>}
                      {r.methods && <span> · {r.methods}</span>}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold" style={{ color: '#1a1a1a' }}>
                      {r.make}{r.maker ? ` · ${r.maker}` : ''} — {r.module}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#666' }}>
                      {r.mcu && <span>MCU {r.mcu}</span>}
                      {r.type && <span> · {r.type}</span>}
                      {r.options && <span> · {r.options}</span>}
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}


// Clone-method badge (Mark 2026-09-07: "what kinda clone is it — OBD
// port, bench, boot"). Green = plug in and go; amber = bench wiring;
// red = boot mode (case open); +P003 = needs the adapter.
function MethodBadge({ method }) {
  const m = String(method).toUpperCase()
  const style = m.includes('OBD') && !m.includes('BENCH') && !m.includes('BOOT')
    ? { bg: '#f0fdf4', color: '#15803d' }
    : m.includes('BOOT')
      ? { bg: '#fef2f2', color: '#dc2626' }
      : m.includes('OBD')
        ? { bg: '#eff6ff', color: '#1d4ed8' }
        : { bg: '#fff7ed', color: '#c2410c' }
  const icon = m.includes('BOOT') ? '🧪' : m.includes('OBD') && !m.includes('BENCH') ? '🔌' : '🔧'
  return (
    <span className="text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0 whitespace-nowrap"
      style={{ backgroundColor: style.bg, color: style.color }}>
      {icon} {m}
    </span>
  )
}


// Photo add/remove inside the TSB editor (edit mode — a saved TSB has an
// id to attach files to). New TSBs get photos by saving, then reopening.
function TsbPhotoEditor({ tsb }) {
  const [photos, setPhotos] = useState(tsb.photos || [])
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  async function upload(file) {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('image', file)
      const r = await apiFetch(`${API_BASE}/api/tsb/${tsb.id}/photo`, { method: 'POST', body: fd })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setPhotos(p => [...p, d.photo])
    } catch (e) { alert(`Upload failed: ${e.message}`) }
    finally { setBusy(false); if (ref.current) ref.current.value = '' }
  }
  async function remove(fileId) {
    setPhotos(p => p.filter(x => x.file_id !== fileId))
    apiFetch(`${API_BASE}/api/tsb/${tsb.id}/photo/${fileId}`, { method: 'DELETE' }).catch(() => {})
  }
  return (
    <div className="mb-3">
      <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: '#888' }}>Photos</p>
      <div className="flex gap-1.5 flex-wrap mb-2">
        {photos.map(ph => (
          <div key={ph.file_id} className="relative">
            <img src={`${API_BASE}/api/tsb/photo/${ph.file_id}?t=${encodeURIComponent(getToken())}`} alt=""
              className="rounded-lg" style={{ height: 64, width: 64, objectFit: 'cover', border: '1px solid #ebebeb' }} />
            <button onClick={() => remove(ph.file_id)}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-white text-xs font-bold flex items-center justify-center"
              style={{ backgroundColor: '#dc2626' }}>×</button>
          </div>
        ))}
      </div>
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => upload(e.target.files?.[0])} />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy}
        className="text-xs font-bold rounded-lg px-3 py-2"
        style={{ backgroundColor: '#fdf3ef', color: '#CD4419', border: '1px solid #f5cfc3' }}>
        {busy ? '⏳ Uploading…' : '📷 Add photo'}
      </button>
    </div>
  )
}
