// Job photo set (Mark 2026-09-08) — the tech side, built to be dead
// simple: one button opens the camera, a big label says what to shoot,
// each shutter tap saves and moves to the next shot. Order doesn't
// matter either: "Pick from roll" sends a batch and the server sorts
// them into slots. Uploads queue with retries so bad shop signal never
// costs a photo.
//
// Mirrors services/jobPhotos.js (slots, progress, gate date).
import { Fragment, useEffect, useRef, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'
const GREEN = '#15803d'
const RED = '#b91c1c'

// Order (Mark 2026-09-11): cluster → VIN → LF → RF → RR → LR → setup → post-cal cluster.
export const SLOTS = [
  { key: 'odo_before', n: 1, label: 'Cluster — odometer before',  short: 'Odo before', hint: 'Dash on, total miles readable. Before the test drive.' },
  { key: 'vin',        n: 2, label: 'VIN plate',                  short: 'VIN',        hint: 'Door-jamb sticker or dash plate, straight on. We read the VIN for you.' },
  { key: 'lf',         n: 3, label: 'Left front corner',          short: 'LF corner',  hint: 'Stand at the driver headlight. Whole car in the shot.' },
  { key: 'rf',         n: 4, label: 'Right front corner',         short: 'RF corner',  hint: 'Same shot from the passenger headlight.' },
  { key: 'rr',         n: 5, label: 'Right rear corner',          short: 'RR corner',  hint: 'Passenger tail light. Whole car in.' },
  { key: 'lr',         n: 6, label: 'Left rear corner',           short: 'LR corner',  hint: 'Driver tail light. Whole car in.' },
  { key: 'setup',      n: 7, label: 'Calibration setup',          short: 'Setup',      hint: 'Targets, rig, tablet. Snap as many as you want.', multi: true },
  { key: 'odo_after',  n: 8, label: 'Cluster — odometer after calibration', short: 'Odo after', hint: 'After the test drive. Needs more than 1 mile over the first shot.' },
]
export const MIN_MILES = 1.0
export const PHOTO_GATE_FROM = '2026-09-09'

export function parseSlots(raw) {
  if (!raw) return { setup: [] }
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!o || typeof o !== 'object') return { setup: [] }
    if (!Array.isArray(o.setup)) o.setup = o.setup ? [o.setup] : []
    return o
  } catch { return { setup: [] } }
}
const milesOf = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : null }

export function photoProgress(job) {
  const slots = parseSlots(job?.photo_slots)
  const missing = []
  let filled = 0
  for (const s of SLOTS) {
    const ok = s.multi ? (slots.setup || []).length > 0 : !!slots[s.key]?.fileId
    if (ok) filled++; else missing.push(s.key)
  }
  const before = milesOf(job?.odo_before), after = milesOf(job?.odo_after)
  const delta = before != null && after != null ? Math.round((after - before) * 10) / 10 : null
  const milesOk = delta != null && delta > MIN_MILES
  const problems = [...missing]
  if (!missing.includes('odo_before') && !missing.includes('odo_after') && !milesOk) problems.push('miles')
  return { filled, total: SLOTS.length, missing, setupCount: (slots.setup || []).length, miles: { before, after, delta, ok: milesOk }, complete: missing.length === 0 && milesOk, problems, slots }
}

// Every job, every button (Mark 2026-09-10). Kept as a function so the
// call sites don't change.
export function gateApplies() { return true }

// Statuses where a tech is on the car and photos make sense.
export function photosRelevant(job) {
  // Requests included (Mark 2026-09-09): techs shoot at the car before
  // Kat creates the job; the card converts in place and keeps them.
  return ['job_requested', 'dispatched_mark', 'dispatched_jaden', 'pending_parts', 'need_dispatch', 'ready_invoice'].includes(job?.status)
}

// ── Badge: "📸 5/8" red until complete, green when done ────────────────
export function PhotoBadge({ job, onClick, size = 'sm' }) {
  const p = photoProgress(job)
  const done = p.complete
  const cls = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onClick && onClick() }}
      className={`${cls} font-extrabold rounded-full inline-flex items-center gap-1`}
      style={done
        ? { backgroundColor: '#dcfce7', color: GREEN, border: '1px solid #86efac' }
        : { backgroundColor: '#fef2f2', color: RED, border: '1px solid #fecaca' }}>
      📸 {p.filled}/{p.total}{done ? ' ✓' : ''}{!done && p.miles.delta != null && !p.miles.ok ? ` · ${p.miles.delta} mi` : ''}
    </button>
  )
}

// ── Upload queue with retries (module-level so it survives the sheet
//    closing). Each item: { id, jobId, slot, file, tries, status, error }
const queue = []
const listeners = new Set()
const notify = () => listeners.forEach(fn => fn([...queue]))
let pumping = false
async function pump() {
  if (pumping) return
  pumping = true
  try {
    while (true) {
      const item = queue.find(q => q.status === 'queued')
      if (!item) break
      item.status = 'uploading'; notify()
      try {
        const fd = new FormData()
        fd.append('photo', item.file, item.file.name || 'photo.jpg')
        if (item.slot) fd.append('slot', item.slot)
        if (item.miles != null) fd.append('miles', String(item.miles))
        const r = await apiFetch(`${API_BASE}/api/jobs/${item.jobId}/photo-slot`, { method: 'POST', body: fd })
        const d = await r.json().catch(() => ({}))
        if (r.status === 422) { item.status = 'needs_slot'; item.error = d.error; item.suggested = d.suggested; notify(); continue }
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
        item.status = 'done'; item.result = d; item.error = null; notify()
      } catch (e) {
        item.tries = (item.tries || 0) + 1
        if (item.tries < 4) {
          item.status = 'queued'; item.error = e.message; notify()
          await new Promise(r => setTimeout(r, [2000, 5000, 10000][item.tries - 1] || 10000))
        } else { item.status = 'failed'; item.error = e.message; notify() }
      }
    }
  } finally { pumping = false }
}
export function enqueuePhoto({ jobId, slot, file, miles = null }) {
  const item = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, jobId, slot, file, miles, tries: 0, status: 'queued', preview: URL.createObjectURL(file) }
  queue.push(item); notify(); pump()
  return item
}
function useQueue(jobId) {
  const [items, setItems] = useState(() => queue.filter(q => q.jobId === jobId))
  useEffect(() => {
    const fn = all => setItems(all.filter(q => q.jobId === jobId))
    listeners.add(fn); fn([...queue])
    return () => listeners.delete(fn)
  }, [jobId])
  return items
}

// ── The sheet ──────────────────────────────────────────────────────────
// mode 'photos' = plain checklist; 'gate' = came from Ready to Invoice,
// shows "Continue → Ready to Invoice" once complete (and Mark's override).
export function JobPhotosSheet({ job: initialJob, onClose, onJobUpdated, onComplete, mode = 'photos', user = null }) {
  const [job, setJob] = useState(initialJob)
  const [current, setCurrent] = useState(() => photoProgress(initialJob).missing[0] || 'setup')
  const [odoEdit, setOdoEdit] = useState({ before: '', after: '' })
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideText, setOverrideText] = useState('')
  const camRef = useRef(null)
  const rollRef = useRef(null)
  const items = useQueue(job.id)
  const prog = photoProgress(job)
  const isOwner = String(user?.email || '').toLowerCase().startsWith('mark@') || user?.role === 'owner'

  // Fold finished uploads back into the job so the checklist ticks live.
  useEffect(() => {
    const done = items.filter(i => i.status === 'done' && i.result?.job && !i._applied)
    if (!done.length) return
    let next = job
    for (const i of done) { i._applied = true; next = i.result.job }
    setJob(next); onJobUpdated && onJobUpdated(next)
    const p = photoProgress(next)
    setCurrent(p.missing[0] || 'setup')
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setOdoEdit({ before: job.odo_before || '', after: job.odo_after || '' })
  }, [job.odo_before, job.odo_after])

  function shoot(slotKey) { setCurrent(slotKey); setTimeout(() => camRef.current?.click(), 0) }
  // × on a filled slot (Mark 2026-09-10): clears it on the card and trashes
  // the WorkDrive file. Setup photos delete one at a time by fileId.
  const [removing, setRemoving] = useState(null)
  async function removePhoto(slotKey, fileId = null, label = '') {
    if (!window.confirm(`Delete ${label || SLOTS.find(s => s.key === slotKey)?.label || 'this photo'}?`)) return
    setRemoving(`${slotKey}:${fileId || ''}`)
    try {
      const r = await apiFetch(`${API_BASE}/api/jobs/${job.id}/photo-slot/${slotKey}${fileId ? `?fileId=${encodeURIComponent(fileId)}` : ''}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      // drop any local preview for that slot so the row reads empty
      for (const it of items) if (it.slot === slotKey && (!fileId || it.result?.fileId === fileId)) { it.status = 'removed'; it._applied = true }
      notify()
      setJob(d.job); onJobUpdated && onJobUpdated(d.job)
      const p = photoProgress(d.job)
      setCurrent(p.missing[0] || 'setup')
    } catch (e) { alert(`Couldn't delete: ${e.message}`) }
    finally { setRemoving(null) }
  }
  function onCamFile(e) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    enqueuePhoto({ jobId: job.id, slot: current, file: f })
    // Optimistically advance to the next missing slot (setup stays put).
    const missing = prog.missing.filter(k => k !== current)
    setCurrent(missing[0] || 'setup')
  }
  function onRollFiles(e) {
    const files = Array.from(e.target.files || []); e.target.value = ''
    files.forEach(f => enqueuePhoto({ jobId: job.id, slot: null, file: f }))
  }
  function resolveNeedsSlot(item, slotKey) {
    item.slot = slotKey; item.status = 'queued'; item.error = null; notify(); pump()
  }
  // 🛞 Tire pressures live in the checklist (Mark 2026-09-11: "like the
  // pictures — one of those lines, not after Ready to Invoice"). Default
  // 36 F / 36 R, editable; saved on the card as tires_set.
  const parseTires = t => { const m = /(\d+)F\/(\d+)R/.exec(String(t || '')); return { front: m ? Number(m[1]) : 36, rear: m ? Number(m[2]) : 36 } }
  const [tire, setTire] = useState(() => parseTires(initialJob.tires_set))
  const [tireBusy, setTireBusy] = useState(false)
  const tiresDone = !!String(job.tires_set || '').trim()
  useEffect(() => { if (job.tires_set) setTire(parseTires(job.tires_set)) }, [job.tires_set])
  async function saveTires() {
    setTireBusy(true)
    try {
      const who = user?.techName || user?.name || user?.email || job.technician || 'tech'
      const stamp = `${Number(tire.front) || 36}F/${Number(tire.rear) || 36}R psi · ${who} · ${new Date().toISOString().slice(0, 16)}`
      const r = await apiFetch(`${API_BASE}/api/jobs/${job.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tires_set: stamp }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setJob(d); onJobUpdated && onJobUpdated(d)
    } catch (e) { alert(`Couldn't save tire pressures: ${e.message}`) }
    finally { setTireBusy(false) }
  }
  const [copied, setCopied] = useState(false)
  async function copyVin(v) {
    try { await navigator.clipboard.writeText(v); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { window.prompt('Copy the VIN:', v) }
  }
  async function useVin(v) {
    try {
      const r = await apiFetch(`${API_BASE}/api/jobs/${job.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vin: v }) })
      const d = await r.json()
      if (r.ok) { setJob(d); onJobUpdated && onJobUpdated(d) }
    } catch { /* tech can retry */ }
  }
  async function saveMiles(which) {
    const v = odoEdit[which]
    const body = which === 'before' ? { odo_before: v } : { odo_after: v }
    try {
      const r = await apiFetch(`${API_BASE}/api/jobs/${job.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      if (r.ok) { setJob(d); onJobUpdated && onJobUpdated(d) }
    } catch { /* keep the edit box, tech can retry */ }
  }

  const cur = SLOTS.find(s => s.key === current) || SLOTS.find(s => s.key === 'setup')
  const pending = items.filter(i => i.status === 'queued' || i.status === 'uploading').length
  const needsSlot = items.filter(i => i.status === 'needs_slot')
  const failed = items.filter(i => i.status === 'failed')

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* hidden inputs: camera + roll */}
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={onCamFile} />
        <input ref={rollRef} type="file" accept="image/*" multiple hidden onChange={onRollFiles} />

        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Job photos</div>
            <div className="font-bold text-base" style={{ color: '#1a1a1a' }}>{job.shop_name || 'Job'}</div>
            <div className="text-xs" style={{ color: '#666' }}>{job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')}</div>
          </div>
          <div className="flex items-center gap-2">
            <PhotoBadge job={job} />
            <button onClick={onClose} className="text-2xl px-1 leading-none" style={{ color: '#888' }}>×</button>
          </div>
        </div>

        {/* THE big button — what to shoot next */}
        {!prog.complete || current === 'setup' ? (
          <button type="button" onClick={() => shoot(current)}
            className="w-full rounded-2xl py-5 px-4 text-left text-white mb-3"
            style={{ backgroundColor: ORANGE, boxShadow: '0 6px 18px rgba(205,68,25,.3)' }}>
            <div className="text-[11px] font-bold uppercase tracking-widest" style={{ opacity: .85 }}>📸 Tap to shoot · {cur.n} of {SLOTS.length}</div>
            <div className="text-2xl font-extrabold leading-tight mt-0.5">{cur.label}</div>
            <div className="text-sm mt-1" style={{ opacity: .9 }}>{cur.hint}</div>
          </button>
        ) : (
          <div className="rounded-2xl py-4 px-4 mb-3 text-center font-extrabold text-lg" style={{ backgroundColor: '#dcfce7', color: GREEN }}>
            ✓ Photo set complete{prog.miles.delta != null ? ` · test drive ${prog.miles.delta} mi` : ''}{tiresDone ? ` · 🛞 ${tire.front}/${tire.rear} psi` : ' · 🛞 tires next'}
          </div>
        )}

        <div className="flex gap-2 mb-3">
          <button type="button" onClick={() => rollRef.current?.click()}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold"
            style={{ backgroundColor: 'white', color: ORANGE, border: `1.5px solid ${ORANGE}` }}>
            🖼 Pick from roll — any order, I'll sort them
          </button>
        </div>

        {pending > 0 && (
          <div className="text-xs font-semibold mb-2 px-3 py-2 rounded-lg" style={{ backgroundColor: '#fffbeb', color: '#92400e' }}>
            ⏫ Uploading {pending} photo{pending > 1 ? 's' : ''}… keep shooting, this runs in the background.
          </div>
        )}
        {needsSlot.map(item => (
          <div key={item.id} className="rounded-xl p-2 mb-2 flex items-center gap-2" style={{ backgroundColor: '#fff5f0', border: `1px dashed ${ORANGE}` }}>
            <img src={item.preview} alt="" className="w-12 h-12 rounded-lg object-cover" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold" style={{ color: '#1a1a1a' }}>Which shot is this?</div>
              <div className="flex flex-wrap gap-1 mt-1">
                {SLOTS.map(s => (
                  <button key={s.key} type="button" onClick={() => resolveNeedsSlot(item, s.key)}
                    className="text-[10px] font-bold rounded-full px-2 py-0.5"
                    style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>{s.short}</button>
                ))}
              </div>
            </div>
          </div>
        ))}
        {failed.map(item => (
          <div key={item.id} className="rounded-xl p-2 mb-2 flex items-center gap-2 text-xs" style={{ backgroundColor: '#fef2f2', color: RED }}>
            <img src={item.preview} alt="" className="w-10 h-10 rounded-lg object-cover" />
            <span className="flex-1">Upload failed: {item.error}</span>
            <button type="button" onClick={() => { item.tries = 0; item.status = 'queued'; notify(); pump() }}
              className="font-bold rounded-full px-2 py-1" style={{ backgroundColor: 'white', border: '1px solid #fecaca' }}>Retry</button>
          </div>
        ))}

        {/* Checklist */}
        <div className="rounded-xl overflow-hidden mb-3" style={{ border: '1px solid #ebe7e3' }}>
          {SLOTS.map(s => {
            const filled = s.multi ? prog.setupCount > 0 : !!prog.slots[s.key]?.fileId
            const local = items.find(i => i.slot === s.key && (i.status === 'done' || i.status === 'uploading' || i.status === 'queued'))
            const isCur = current === s.key
            return (
              <Fragment key={s.key}>
              {s.key === 'lf' && (
                <div className="flex items-center gap-2 px-3 py-2" style={{ borderTop: '1px solid #f1ede9', backgroundColor: tiresDone ? 'white' : '#fff7ed' }}>
                  <span className="w-9 h-9 rounded-lg flex items-center justify-center text-base" style={{ backgroundColor: tiresDone ? '#dcfce7' : '#f5f3f0', color: tiresDone ? GREEN : '#bbb' }}>{tiresDone ? '✓' : '🛞'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold" style={{ color: tiresDone ? GREEN : '#1a1a1a' }}>Tire pressures — manufacturer spec</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[11px]" style={{ color: '#888' }}>F</span>
                      <input type="number" inputMode="numeric" min="20" max="80" value={tire.front} onChange={e => setTire(t => ({ ...t, front: e.target.value }))} className="w-14 text-sm rounded-md px-1 py-1 text-center font-bold" style={{ border: '1px solid #e0dbd6' }} />
                      <span className="text-[11px]" style={{ color: '#888' }}>R</span>
                      <input type="number" inputMode="numeric" min="20" max="80" value={tire.rear} onChange={e => setTire(t => ({ ...t, rear: e.target.value }))} className="w-14 text-sm rounded-md px-1 py-1 text-center font-bold" style={{ border: '1px solid #e0dbd6' }} />
                      <span className="text-[11px]" style={{ color: '#888' }}>psi{tiresDone ? ' · set' : ''}</span>
                    </div>
                  </div>
                  <button type="button" onClick={saveTires} disabled={tireBusy}
                    className="text-xs font-bold rounded-full px-2.5 py-1.5"
                    style={tiresDone ? { backgroundColor: 'white', color: '#888', border: '1px solid #ddd' } : { backgroundColor: ORANGE, color: 'white' }}>
                    {tireBusy ? '…' : tiresDone ? 'update' : 'All 4 set ✓'}
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 px-3 py-2" style={{ borderTop: s.n === 1 ? 'none' : '1px solid #f1ede9', backgroundColor: isCur && !filled ? '#fff5f0' : 'white' }}>
                {local?.preview ? <img src={local.preview} alt="" className="w-9 h-9 rounded-lg object-cover" />
                  : <span className="w-9 h-9 rounded-lg flex items-center justify-center text-base" style={{ backgroundColor: filled ? '#dcfce7' : '#f5f3f0', color: filled ? GREEN : '#bbb' }}>{filled ? '✓' : s.n}</span>}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold" style={{ color: filled ? GREEN : '#1a1a1a' }}>{s.label}{s.multi && prog.setupCount ? ` (${prog.setupCount})` : ''}</div>
                  {s.key === 'vin' && filled && (() => {
                    const read = prog.slots.vin?.vin || null
                    const cardVin = String(job.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
                    const mismatch = !!(read && cardVin && cardVin !== read)
                    return (
                      <div className="mt-0.5">
                        {read ? (
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-xs font-bold tracking-wider" style={{ fontFamily: 'IBM Plex Mono, monospace', color: mismatch ? RED : '#1a1a1a' }}>{read}</span>
                            <button type="button" onClick={() => copyVin(read)} className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ backgroundColor: copied ? '#dcfce7' : '#f5f3f0', color: copied ? GREEN : '#555', border: '1px solid #e0dbd6' }}>{copied ? 'Copied ✓' : 'Copy'}</button>
                          </div>
                        ) : <div className="text-[11px]" style={{ color: '#888' }}>Couldn't read the VIN — redo the shot straight on.</div>}
                        {mismatch && (
                          <div className="text-[11px] mt-0.5 flex items-center gap-1 flex-wrap" style={{ color: RED }}>
                            ⚠️ Card says {cardVin}
                            <button type="button" onClick={() => useVin(read)} className="font-bold rounded-full px-2 py-0.5" style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: RED }}>Use the plate's VIN</button>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  {(s.key === 'odo_before' || s.key === 'odo_after') && filled && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <input value={s.key === 'odo_before' ? odoEdit.before : odoEdit.after}
                        onChange={e => setOdoEdit(o => ({ ...o, [s.key === 'odo_before' ? 'before' : 'after']: e.target.value }))}
                        onBlur={() => saveMiles(s.key === 'odo_before' ? 'before' : 'after')}
                        inputMode="decimal" placeholder="miles"
                        className="w-24 text-xs rounded-md px-2 py-1" style={{ border: '1px solid #e0dbd6', fontFamily: 'IBM Plex Mono, monospace' }} />
                      <span className="text-[10px]" style={{ color: '#888' }}>mi · fix if the read is off</span>
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => shoot(s.key)}
                  className="text-xs font-bold rounded-full px-2.5 py-1.5"
                  style={filled ? { backgroundColor: 'white', color: '#888', border: '1px solid #ddd' } : { backgroundColor: ORANGE, color: 'white' }}>
                  {filled ? (s.multi ? '+ more' : 'redo') : '📸'}
                </button>
                {filled && !s.multi && (
                  <button type="button" onClick={() => removePhoto(s.key)} disabled={removing === `${s.key}:`}
                    title="Delete this photo" aria-label="Delete this photo"
                    className="w-8 h-8 rounded-full flex items-center justify-center text-base font-bold"
                    style={{ backgroundColor: '#fef2f2', color: RED, border: '1px solid #fecaca', opacity: removing === `${s.key}:` ? .5 : 1 }}>×</button>
                )}
              </div>
              </Fragment>
            )
          })}
          {/* Setup photos: one × each */}
          {prog.setupCount > 0 && (
            <div className="px-3 pb-2 flex flex-wrap gap-1.5" style={{ backgroundColor: 'white' }}>
              {(prog.slots.setup || []).map((e, i) => (
                <span key={e.fileId || i} className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full pl-2 pr-1 py-0.5" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
                  Setup {i + 1}
                  <button type="button" onClick={() => removePhoto('setup', e.fileId, `Setup photo ${i + 1}`)} disabled={removing === `setup:${e.fileId}`}
                    aria-label={`Delete setup photo ${i + 1}`} className="w-5 h-5 rounded-full flex items-center justify-center font-bold" style={{ backgroundColor: '#fef2f2', color: RED }}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="px-3 py-2 text-xs font-bold" style={{ borderTop: '1px solid #f1ede9', backgroundColor: prog.miles.ok ? '#dcfce7' : '#fff', color: prog.miles.ok ? GREEN : (prog.miles.delta != null ? RED : '#888') }}>
            🚗 Test drive: {prog.miles.delta == null ? 'need both odometer shots' : `${prog.miles.delta} mi ${prog.miles.ok ? '✓' : `— need more than ${MIN_MILES}`}`}
          </div>
        </div>

        {mode === 'gate' && (
          <div className="flex flex-col gap-2">
            <button type="button" disabled={!prog.complete || !tiresDone || pending > 0} onClick={() => onComplete && onComplete(job)}
              className="w-full rounded-xl py-3 text-sm font-bold text-white"
              style={{ backgroundColor: '#7e22ce', opacity: prog.complete && tiresDone && pending === 0 ? 1 : .45 }}>
              {prog.complete && !tiresDone ? '🛞 Set the tire pressures first' : '🟢 Continue → Ready to Invoice'}
            </button>
            {isOwner && !(prog.complete && tiresDone) && (
              overrideOpen ? (
                <div className="rounded-xl p-2" style={{ border: '1px dashed #ddd' }}>
                  <input value={overrideText} onChange={e => setOverrideText(e.target.value)} placeholder="Why (goes on the card + #dispatch)"
                    className="w-full text-sm rounded-md px-2 py-1.5 mb-2" style={{ border: '1px solid #e0dbd6' }} />
                  <button type="button" disabled={!overrideText.trim()} onClick={() => onComplete && onComplete(job, overrideText.trim())}
                    className="w-full rounded-lg py-2 text-xs font-bold" style={{ backgroundColor: '#fef2f2', color: RED, border: '1px solid #fecaca' }}>
                    Override the photo gate (Mark only)
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setOverrideOpen(true)} className="text-xs font-semibold" style={{ color: '#888' }}>
                  Override (Mark only)
                </button>
              )
            )}
          </div>
        )}
        {mode !== 'gate' && (
          <button type="button" onClick={onClose} className="w-full rounded-xl py-2.5 text-sm font-bold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Done</button>
        )}
      </div>
    </div>
  )
}

// ── Card control: badge + big button, self-hosting the sheet ───────────
export function TakePhotosControl({ job, onJobUpdated, compact = false }) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState(job)
  useEffect(() => { setLocal(job) }, [job])
  if (!photosRelevant(local)) return null
  const p = photoProgress(local)
  return (
    <>
      {compact ? (
        <PhotoBadge job={local} size="xs" onClick={() => setOpen(true)} />
      ) : (
        <button type="button" onClick={e => { e.stopPropagation(); setOpen(true) }}
          className="w-full flex items-center justify-between gap-2 rounded-xl px-3"
          style={{ backgroundColor: p.complete ? '#f0fdf4' : '#fff5f0', border: `1.5px solid ${p.complete ? '#86efac' : ORANGE}`, padding: '10px 12px', minHeight: '44px' }}>
          <span className="text-sm font-bold" style={{ color: p.complete ? GREEN : ORANGE }}>
            {p.complete ? '📸 Photos done' : `📸 Take photos · ${p.filled}/${p.total}`}
          </span>
          <PhotoBadge job={local} />
        </button>
      )}
      {open && (
        <JobPhotosSheet job={local} onClose={() => setOpen(false)}
          onJobUpdated={j => { setLocal(j); onJobUpdated && onJobUpdated(j) }} />
      )}
    </>
  )
}
