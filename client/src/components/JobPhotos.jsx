// Job photo set (Mark 2026-09-08) — the tech side, built to be dead
// simple: one button opens the camera, a big label says what to shoot,
// each shutter tap saves and moves to the next shot. Order doesn't
// matter either: "Pick from roll" sends a batch and the server sorts
// them into slots. Uploads queue with retries so bad shop signal never
// costs a photo.
//
// Mirrors services/jobPhotos.js (slots, progress, gate date).
import { Fragment, useEffect, useRef, useState } from 'react'
import { isOwnerUser, isMarkUser } from '../utils/identity.js'
import { API_BASE, apiFetch, getToken } from '../utils/api.js'

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
  const slots = parseSlots(job?.photo_slots) || {}
  const owed = !p.complete && !!slots._pending   // invoiced with shots outstanding (2026-09-17)
  const folderOk = !p.complete && !!slots._folder_ok   // full set in the folder, some not labeled (2026-09-23)
  const done = p.complete || folderOk
  const cls = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onClick && onClick() }}
      className={`${cls} font-extrabold rounded-full inline-flex items-center gap-1`}
      style={done
        ? { backgroundColor: '#dcfce7', color: GREEN, border: '1px solid #86efac' }
        : { backgroundColor: '#fef2f2', color: RED, border: '1px solid #fecaca' }}>
      📸 {folderOk ? `${slots._folder_ok.images} in folder ✓` : `${p.filled}/${p.total}${done ? ' ✓' : owed ? ' owed' : ''}`}{!done && p.miles.delta != null && !p.miles.ok ? ` · ${p.miles.delta} mi` : ''}
    </button>
  )
}

// ── Upload queue with retries (module-level so it survives the sheet
//    closing). Each item: { id, jobId, slot, file, tries, status, error }
//
// Mark 2026-09-15: a tech shot all eight, the uploads errored (his 8-hour
// sign-in had expired mid-job) and he had to shoot them all again. Never
// again: every photo is written to the phone's own storage (IndexedDB)
// the moment it's taken, uploads resume on their own after a reload,
// a re-sign-in, or the app being killed, a signed-out upload waits
// instead of failing, and photos are shrunk before they go up so bad
// shop signal has far less to push.
const queue = []
const listeners = new Set()
const notify = () => listeners.forEach(fn => fn([...queue]))
const LIVE = ['preparing', 'queued', 'uploading', 'needs_slot', 'failed', 'paused']

// IndexedDB — the photo file itself is stored, not just a pointer.
const DB_NAME = 'adasiq-photo-queue', STORE = 'queue'
function idb() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB_NAME, 1)
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }) }
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
    } catch (e) { rej(e) }
  })
}
async function idbWrite(fn) {
  try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); fn(tx.objectStore(STORE)); tx.oncomplete = res; tx.onerror = () => rej(tx.error) }); db.close() } catch { /* no storage — uploads still run from memory */ }
}
const idbPut = item => idbWrite(st => st.put({ id: item.id, jobId: item.jobId, slot: item.slot, miles: item.miles, blob: item.file, name: item.file.name || 'photo.jpg', type: item.file.type || 'image/jpeg', at: item.at }))
const idbDel = id => idbWrite(st => st.delete(id))
async function idbAll() {
  try { const db = await idb(); const rows = await new Promise((res, rej) => { const q = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error) }); db.close(); return rows } catch { return [] }
}

// Shrink before upload: long edge ≤ 2000 px, JPEG 0.86. A 12 MP phone
// shot (4–6 MB) becomes ~400 KB; the odometer and VIN reads still work
// at that size. Anything that can't be decoded goes up as-is.
async function shrink(file, slot = null) {
  try {
    if (!/^image\//.test(file.type || '') || file.size < 350 * 1024) return file
    let bmp
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { bmp = await createImageBitmap(file) }
    // Odometer + VIN need pixels for the AI read; corners/setup don't (Mark 2026-09-16: "10 times faster" on bad signal).
    const MAX = /^odo_|^vin$/.test(slot || '') ? 1800 : 1400, s = Math.min(1, MAX / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s))
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.()
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', /^odo_|^vin$/.test(slot || '') ? 0.84 : 0.76))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], String(file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified || Date.now() })
  } catch { return file }
}

// A ~50 KB look for the sorter — enough for "which corner is this", not
// meant for reading an odometer (the full photo does that server-side).
async function thumb(file) {
  try {
    let bmp
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { bmp = await createImageBitmap(file) }
    const s = Math.min(1, 640 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s))
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.()
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.6))
    return blob ? new File([blob], 'thumb.jpg', { type: 'image/jpeg' }) : null
  } catch { return null }
}

// Sorter (Mark 2026-09-21: "let AI decide is super slow"): ask on the
// thumbnail FIRST, then upload the real photo straight into the slot.
// One big upload instead of upload → guess → maybe upload again. The
// odometer answer maps to whichever odo slot is still open, counting
// photos already in line for this job.
async function sortOnPhone(item, filled) {
  const t = await thumb(item.file)
  if (!t) return null
  const fd = new FormData(); fd.append('photo', t, 'thumb.jpg')
  const r = await apiFetch(`${API_BASE}/api/jobs/photo-classify`, { method: 'POST', body: fd })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  let slot = d.slot
  if (slot === 'odometer') {
    const claimed = k => filled?.[k]?.fileId || queue.some(q => q.jobId === item.jobId && q.slot === k && q.id !== item.id && LIVE.includes(q.status))
    slot = !claimed('odo_before') ? 'odo_before' : !claimed('odo_after') ? 'odo_after' : 'odo_after'
  }
  const known = SLOTS.some(x => x.key === slot)
  return { slot: known ? slot : null, confidence: Number(d.confidence) || 0, suggested: known ? slot : null }
}

// Upload with a live percentage (Mark 2026-09-23: "we can't tell that
// pictures are uploading"). fetch() has no upload progress; XHR does.
function xhrUpload(url, fd, onProgress) {
  return new Promise(resolve => {
    const x = new XMLHttpRequest()
    x.open('POST', url)
    const t = getToken(); if (t) x.setRequestHeader('X-Auth-Token', t)
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)) }
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText || '{}') } catch { d = {} } resolve({ status: x.status, ok: x.status >= 200 && x.status < 300, data: d }) }
    x.onerror = () => resolve({ status: 0, ok: false, data: { error: 'Network error' } })
    x.ontimeout = () => resolve({ status: 0, ok: false, data: { error: 'Upload timed out' } })
    x.timeout = 45000   // a hung request must free its lane quickly, not sit for two minutes
    x.send(fd)
  })
}
let lastNotify = 0
const notifyThrottled = () => { const n = Date.now(); if (n - lastNotify > 150) { lastNotify = n; notify() } }

// Three lanes (2026-09-24). It was one, because two at once used to race on
// the card and the second write erased the first slot — the server merges on
// a fresh read now, so that is handled. One lane meant a single hung photo
// blocked the other 48.
// A 49-shot batch takes longer than the screen stays on, and iOS suspends a
// sleeping tab mid-upload. Hold a wake lock while anything is in flight.
let wakeLock = null
async function holdScreen() {
  try { if (!wakeLock && navigator.wakeLock?.request) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener?.('release', () => { wakeLock = null }) } } catch { /* not supported — uploads still run */ }
}
function releaseScreen() { try { wakeLock?.release?.(); } catch { /* fine */ } wakeLock = null }

let workers = 0
const MAX_WORKERS = 3
async function pump() {
  if (workers >= MAX_WORKERS) return
  workers++
  holdScreen()
  if (workers < MAX_WORKERS && queue.filter(q => q.status === 'queued').length > 1) pump()
  try {
    while (true) {
      const item = queue.find(q => q.status === 'queued')
      if (!item) break
      if (!getToken()) { item.status = 'paused'; item.error = 'Waiting for sign-in — these upload on their own once you are back in.'; notify(); break }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { item.status = 'paused'; item.error = 'No signal — will upload as soon as the phone is back online.'; notify(); break }
      item.status = 'uploading'; item.progress = 0; notify()
      try {
        const fd = new FormData()
        fd.append('photo', item.file, item.file.name || 'photo.jpg')
        if (item.slot) fd.append('slot', item.slot)
        if (item.miles != null) fd.append('miles', String(item.miles))
        const r = await xhrUpload(`${API_BASE}/api/jobs/${item.jobId}/photo-slot`, fd, pct => { item.progress = pct; notifyThrottled() })
        const d = r.data || {}
        if (r.status === 401) { item.status = 'paused'; item.error = 'Signed out — sign back in and these upload on their own.'; notify(); break }
        if (r.status === 422) {
          if (!item._retriedSlot) { item._retriedSlot = true; item.slot = d.suggested || SLOTS.find(x => !x.multi && !queue.some(q => q.jobId === item.jobId && q.slot === x.key && q.id !== item.id && LIVE.includes(q.status)))?.key || 'setup'; item.status = 'queued'; notify(); continue }
          item.status = 'needs_slot'; item.error = d.error; item.suggested = d.suggested; notify(); continue
        }
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
        item.status = 'done'; item.progress = 100; item.result = d; item.error = null; notify()
        idbDel(item.id)
      } catch (e) {
        item.tries = (item.tries || 0) + 1
        if (item.tries < 5) {
          item.status = 'queued'; item.error = e.message; notify()
          await new Promise(r => setTimeout(r, [2000, 5000, 10000, 20000][item.tries - 1] || 20000))
        } else { item.status = 'failed'; item.error = e.message; notify() }
      }
    }
  } finally {
    workers--
    if (workers === 0 && !queue.some(q => ['queued', 'uploading', 'preparing'].includes(q.status))) releaseScreen()
  }
}
/** Put every paused/failed photo back in line and push. Called on sign-in, on 'online', when the app comes back to the front, and by the Retry button. */
export function resumePhotoQueue() {
  let any = false
  for (const q of queue) if (q.status === 'paused' || q.status === 'failed') { q.status = 'queued'; q.tries = 0; q.error = null; any = true }
  if (rescueStalledPrep()) any = true
  if (any) notify()
  pump()
}
let restored = false
/** Reload whatever was still waiting on this phone (after a reload, re-sign-in, or the app being killed) and carry on. */
export async function restorePhotoQueue() {
  if (restored) return; restored = true
  const rows = await idbAll()
  for (const r of rows) {
    if (queue.some(q => q.id === r.id)) continue
    let file; try { file = new File([r.blob], r.name || 'photo.jpg', { type: r.type || 'image/jpeg' }) } catch { continue }
    queue.push({ id: r.id, jobId: r.jobId, slot: r.slot || null, miles: r.miles ?? null, file, tries: 0, status: 'queued', preview: URL.createObjectURL(file), at: r.at, restored: true })
  }
  if (rows.length) { notify(); pump() }
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => resumePhotoQueue())
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resumePhotoQueue() })
  // Heartbeat: nothing should sit in 'preparing' while the app is open.
  setInterval(() => { rescueStalledPrep(); if (queue.some(q => q.status === 'queued')) pump() }, 15000)
}
// A photo sits in 'preparing' while it is sorted by AI and shrunk. If the
// phone sleeps or the app is backgrounded mid-prep those promises never
// settle, and nothing used to rescue them: pump() only looks at 'queued' and
// resumePhotoQueue() only revived 'paused'/'failed'. The thumbnail showed, the
// photo never left the phone (Mark 2026-09-24, Gerber Mercedes + Avon Subaru:
// eight shots each, zero in WorkDrive). Anything stuck this long gets a slot
// and goes in line.
const PREP_STALL_MS = 40000
// Prep = one classify fetch + a full-size image decode per photo. Unbounded,
// a 49-shot batch fired 49 of each at once: the phone ran out of memory and
// the browser's 6-connection budget went to classify calls, so the actual
// upload sat at 0% with no connection (Mark 2026-09-24). Two lanes, and big
// batches skip the phone-side sort entirely — the server sorts in ~1s while
// it stores the photo, which is one round trip instead of two.
const PREP_LANES = 2
const SKIP_SORT_OVER = 4
let prepping = 0
const prepWaiting = []
const prepAcquire = () => prepping < PREP_LANES ? (prepping++, Promise.resolve()) : new Promise(r => prepWaiting.push(r)).then(() => { prepping++ })
const prepRelease = () => { prepping--; const next = prepWaiting.shift(); if (next) next() }
function pickOpenSlot(item, filled = null) {
  const taken = k => filled?.[k]?.fileId || queue.some(q => q.jobId === item.jobId && q.slot === k && q.id !== item.id && LIVE.includes(q.status))
  return SLOTS.find(x => !x.multi && !taken(x.key))?.key || 'setup'
}
/** Move any photo that stalled while preparing into the upload line. */
export function rescueStalledPrep(force = false) {
  let any = false
  for (const q of queue) {
    if (q.status !== 'preparing') continue
    if (!force && Date.now() - (q.prepAt || 0) < PREP_STALL_MS) continue
    if (!q.slot) q.slot = pickOpenSlot(q)
    q.status = 'queued'; q.error = null; any = true
    console.warn('[photos] prep stalled — sending it anyway:', q.id, q.slot)
  }
  if (any) { notify(); pump() }
  return any
}

export function enqueuePhoto({ jobId, slot, file, miles = null, filled = null }) {
  const item = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, jobId, slot, file, miles, tries: 0, status: 'preparing', preview: URL.createObjectURL(file), at: new Date().toISOString(), prepAt: Date.now() }
  queue.push(item); notify()
  // Save the original to the phone first (nothing is ever lost), then swap in the shrunk copy.
  idbPut(item).then(async () => {
    await prepAcquire()
    try {
      // A big batch goes up unsorted and lets the server place each shot —
      // one request instead of two, and the uploader keeps its connection.
      const batch = queue.filter(q => q.jobId === item.jobId && ['preparing', 'queued'].includes(q.status)).length
      if (!item.slot && batch <= SKIP_SORT_OVER) {
        // Never stop the tech to ask (Mark 2026-09-23: "it's annoying them"):
        // unsure → the next open slot in shooting order; they can redo later.
        try {
          const r = await sortOnPhone(item, filled)
          item.slot = (r?.slot && r.confidence >= 0.5) ? r.slot : (r?.suggested || pickOpenSlot(item, filled))
        } catch { item.slot = pickOpenSlot(item, filled) }
      }
      const small = await shrink(file, item.slot)
      if (small !== file) { item.file = small }
      await idbPut(item)
    } finally { prepRelease() }
    item.status = 'queued'; notify(); pump()
  }).catch(e => {
    // Prep blew up (HEIC decode, storage, a suspended tab). The photo still
    // goes up — an unsorted shot beats a lost one.
    console.warn('[photos] prep failed, queueing the original:', e?.message)
    if (!item.slot) item.slot = pickOpenSlot(item, filled)
    item.status = 'queued'; notify(); pump()
  })
  return item
}
export function useUploadSummary() {
  const [s, setS] = useState(() => summarize(queue))
  useEffect(() => { const fn = all => setS(summarize(all)); listeners.add(fn); fn([...queue]); return () => listeners.delete(fn) }, [])
  return s
}
export function progressOf(items) {
  // Percent across this batch: finished ones count 100, in flight count their own %, waiting count 0.
  const batch = items.filter(q => ['preparing', 'queued', 'uploading', 'done'].includes(q.status))
  if (!batch.length) return { pct: 0, done: 0, total: 0, busy: 0 }
  const done = batch.filter(q => q.status === 'done').length
  const sum = batch.reduce((n, q) => n + (q.status === 'done' ? 100 : q.status === 'uploading' ? (q.progress || 0) : 0), 0)
  return { pct: Math.round(sum / batch.length), done, total: batch.length, busy: batch.length - done }
}
function summarize(all) {
  const live = all.filter(q => LIVE.includes(q.status))
  const pr = progressOf(all)
  return {
    pct: pr.pct, done: pr.done, batch: pr.total,
    total: live.length,
    busy: live.filter(q => ['preparing', 'queued', 'uploading'].includes(q.status)).length,
    paused: live.filter(q => q.status === 'paused').length,
    failed: live.filter(q => q.status === 'failed').length,
    needsSlot: live.filter(q => q.status === 'needs_slot').length,
    note: live.find(q => q.status === 'paused' || q.status === 'failed')?.error || '',
  }
}
/** Floating pill, app-wide: shows while photos are still going up and
 *  offers one-tap Retry when something got stuck. Also restores the
 *  queue from the phone on first mount (i.e. once the user is signed in). */
export function UploadTray() {
  const s = useUploadSummary()
  useEffect(() => { restorePhotoQueue() }, [])
  if (!s.total) return null
  const stuck = s.paused + s.failed
  return (
    <div className="fixed left-3 bottom-3 z-[60] rounded-full shadow-lg text-xs font-bold flex items-center gap-2 px-3 py-2"
      style={stuck ? { backgroundColor: '#fef2f2', color: RED, border: '1px solid #fecaca' } : { backgroundColor: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
      {stuck
        ? <><span>⚠️ {stuck} photo{stuck > 1 ? 's' : ''} waiting · {s.note}</span><button type="button" onClick={resumePhotoQueue} className="rounded-full px-2 py-0.5" style={{ backgroundColor: 'white', border: '1px solid #fecaca' }}>Retry</button></>
        : <span className="flex items-center gap-2">📤 {s.done}/{s.batch} up · {s.pct}%<span className="inline-block rounded-full overflow-hidden" style={{ width: 90, height: 6, backgroundColor: '#fde68a' }}><span className="block h-full" style={{ width: `${s.pct}%`, backgroundColor: '#b45309', transition: 'width .2s' }} /></span><span className="font-normal">saved on this phone</span></span>}
      {s.needsSlot > 0 && <span>· {s.needsSlot} need a slot</span>}
    </div>
  )
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
  const pickRef = useRef(null)
  // Mark 2026-09-21: the tech has often already taken the shot, so every
  // slot asks first — camera, or the photos already on the phone.
  const [chooseFor, setChooseFor] = useState(null)
  const items = useQueue(job.id)
  const prog = photoProgress(job)
  const isOwner = isOwnerUser(user)

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
  // Card says shots are owed → ask the server to look in the folder right now (2026-09-23).
  useEffect(() => {
    const slots = parseSlots(initialJob?.photo_slots) || {}
    if (!slots._pending && photoProgress(initialJob).complete) return
    if (!slots._pending && !initialJob?.folder_url) return
    let dead = false
    apiFetch(`${API_BASE}/api/jobs/${initialJob.id}/photos/reconcile`, { method: 'POST' }).then(r => r.json()).then(d => {
      if (dead || !d?.ok || !d.job) return
      if (d.images > 0) { setJob(d.job); onJobUpdated && onJobUpdated(d.job); const p = photoProgress(d.job); setCurrent(p.missing[0] || 'setup') }
    }).catch(() => {})
    return () => { dead = true }
  }, [initialJob?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function shoot(slotKey) { setCurrent(slotKey); setTimeout(() => camRef.current?.click(), 0) }
  function choose(slotKey) { setCurrent(slotKey); setChooseFor(slotKey) }
  function pickFor(slotKey) { setCurrent(slotKey); setChooseFor(null); setTimeout(() => pickRef.current?.click(), 0) }
  // Photos chosen from the phone for ONE slot. A multi slot (setup) takes
  // them all; a single slot takes the first and lets the sorter place the
  // rest rather than dropping them on the floor.
  function onPickFiles(e) {
    const files = Array.from(e.target.files || []); e.target.value = ''
    if (!files.length) return
    const slotKey = current
    const multi = SLOTS.find(x => x.key === slotKey)?.multi
    if (multi) { files.forEach(f => enqueuePhoto({ jobId: job.id, slot: slotKey, file: f })) }
    else {
      enqueuePhoto({ jobId: job.id, slot: slotKey, file: files[0] })
      files.slice(1).forEach(f => enqueuePhoto({ jobId: job.id, slot: null, file: f, filled: prog.slots }))
      const missing = prog.missing.filter(k => k !== slotKey)
      setCurrent(missing[0] || 'setup')
    }
  }
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
    if (!files.length) return
    // One photo, one slot still open → it's that slot. No AI needed.
    const open = prog.missing.filter(k => k !== 'setup')
    if (files.length === 1 && open.length === 1) { enqueuePhoto({ jobId: job.id, slot: open[0], file: files[0] }); return }
    files.forEach(f => enqueuePhoto({ jobId: job.id, slot: null, file: f, filled: prog.slots }))
  }
  function resolveNeedsSlot(item, slotKey) {
    // Sorted on the phone now, so the shrink for this slot hasn't run yet.
    item.slot = slotKey; item.error = null; item.status = 'preparing'; notify()
    shrink(item.file, slotKey).then(small => { if (small !== item.file) item.file = small; item.status = 'queued'; notify(); pump() })
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
  const pending = items.filter(i => i.status === 'queued' || i.status === 'uploading' || i.status === 'preparing').length
  const needsSlot = items.filter(i => i.status === 'needs_slot')
  const failed = items.filter(i => i.status === 'failed' || i.status === 'paused')
  // Bad-signal path: photos on this phone (queued/uploading/paused) count toward the gate; the card carries a 'still uploading' flag until they land.
  const onPhone = items.filter(i => ['preparing', 'queued', 'uploading', 'paused', 'failed'].includes(i.status))
  const rollOnPhone = onPhone.filter(i => !i.slot).length
  const uncovered = prog.missing.filter(k => !onPhone.some(i => i.slot === k))
  const milesBlocked = prog.problems.includes('miles') && !prog.missing.includes('odo_before') && !prog.missing.includes('odo_after')
  const coveredByPhone = !prog.complete && uncovered.length <= rollOnPhone && !milesBlocked
  const pendingPayload = coveredByPhone ? { slots: prog.missing, roll: rollOnPhone } : null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* hidden inputs: camera + roll */}
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={onCamFile} />
        <input ref={rollRef} type="file" accept="image/*" multiple hidden onChange={onRollFiles} />
        <input ref={pickRef} type="file" accept="image/*" multiple hidden onChange={onPickFiles} />

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
            ✓ All 8 in — nice{prog.miles.delta != null ? ` · test drive ${prog.miles.delta} mi` : ''}{tiresDone ? ` · 🛞 ${tire.front}/${tire.rear} psi` : ' · 🛞 tires next'}
          </div>
        )}

        <div className="flex gap-2 mb-3">
          <button type="button" onClick={() => rollRef.current?.click()}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold"
            style={{ backgroundColor: 'white', color: ORANGE, border: `1.5px solid ${ORANGE}` }}>
            🖼 Pick from roll — any order, sorted before they upload
          </button>
        </div>

        {pending > 0 && (() => { const pr = progressOf(items); return (
          <div className="text-xs font-semibold mb-2 px-3 py-2 rounded-lg" style={{ backgroundColor: '#fffbeb', color: '#92400e' }}>
            <div className="flex items-center justify-between"><span>⏫ Uploading {pr.done} of {pr.total} · {pr.pct}%</span><span className="font-normal">saved on this phone first</span></div>
            <div className="rounded-full overflow-hidden mt-1.5" style={{ height: 8, backgroundColor: '#fde68a' }}><div className="h-full" style={{ width: `${pr.pct}%`, backgroundColor: '#b45309', transition: 'width .2s' }} /></div>
            <div className="mt-1 font-normal">Keep shooting. Nothing is lost if the signal drops or you get signed out.</div>
          </div>
        ) })()}
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
            <span className="flex-1">{item.status === 'paused' ? item.error : `Upload failed: ${item.error} — the photo is safe on this phone.`}</span>
            <button type="button" onClick={resumePhotoQueue}
              className="font-bold rounded-full px-2 py-1" style={{ backgroundColor: 'white', border: '1px solid #fecaca' }}>Retry</button>
          </div>
        ))}

        {/* Checklist */}
        <div className="rounded-xl overflow-hidden mb-3" style={{ border: '1px solid #ebe7e3' }}>
          {SLOTS.map(s => {
            const filled = s.multi ? prog.setupCount > 0 : !!prog.slots[s.key]?.fileId
            const local = items.find(i => i.slot === s.key && ['done', 'uploading', 'queued', 'preparing', 'paused'].includes(i.status))
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
                {!filled && <button type="button" onClick={() => pickFor(s.key)} title="Use a photo already on the phone" className="text-[11px] font-bold rounded-full px-2 py-1.5" style={{ backgroundColor: 'white', color: '#888', border: '1px solid #e0dbd6' }}>🖼</button>}
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
            <button type="button" disabled={!tiresDone} onClick={() => onComplete && onComplete(job, undefined, pendingPayload)}
              className="w-full rounded-xl py-3 text-sm font-bold text-white"
              style={{ backgroundColor: '#7e22ce', opacity: tiresDone ? 1 : .45 }}>
              {!tiresDone ? '🛞 Set the tire pressures first'
                : prog.complete ? '🟢 Continue → Ready to Invoice'
                : coveredByPhone ? `🟢 Continue → Ready to Invoice (${onPhone.length} photo${onPhone.length === 1 ? '' : 's'} still uploading — fine)`
                : `🟢 Continue → Ready to Invoice (${prog.missing.length} photo${prog.missing.length === 1 ? '' : 's'} still owed)`}
            </button>
            {!prog.complete && (
              <div className="text-[11px] text-center" style={{ color: '#666' }}>
                {coveredByPhone
                  ? 'Photos are saved on this phone and upload on their own. Kat can invoice now; the card clears itself when they land.'
                  : 'Kat can invoice now. The missing shots stay on the card and on the 6pm owed list until you add them — take them when you can.'}
              </div>
            )}
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

      {/* Camera or the roll? (Mark 2026-09-21: "often the technician has
          already taken a picture and wants to upload that picture") */}
      {chooseFor && (() => {
        const slot = SLOTS.find(x => x.key === chooseFor)
        return (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
            onClick={e => { e.stopPropagation(); setChooseFor(null) }}>
            <div className="bg-white w-full sm:max-w-xs rounded-t-2xl sm:rounded-2xl p-4" onClick={e => e.stopPropagation()}>
              <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>
                {slot ? `${slot.n} of ${SLOTS.length}` : 'Photo'}
              </div>
              <div className="font-extrabold text-lg mb-3" style={{ color: '#1a1a1a' }}>{slot?.label || 'Add a photo'}</div>
              <button type="button" onClick={() => { setChooseFor(null); setTimeout(() => camRef.current?.click(), 0) }}
                className="w-full rounded-xl py-3.5 text-base font-bold text-white mb-2"
                style={{ backgroundColor: ORANGE }}>📷 Take a picture</button>
              <button type="button" onClick={() => pickFor(chooseFor)}
                className="w-full rounded-xl py-3.5 text-base font-bold mb-2"
                style={{ backgroundColor: 'white', color: ORANGE, border: `1.5px solid ${ORANGE}` }}>🖼 Upload a picture</button>
              <div className="text-[11px] text-center mb-2" style={{ color: '#888' }}>
                {slot?.multi
                  ? 'Pick as many as you like — they all land here.'
                  : 'Already shot it? Pick it from your phone. Extras you pick get sorted into the right slots.'}
              </div>
              <button type="button" onClick={() => setChooseFor(null)}
                className="w-full rounded-xl py-2 text-sm font-bold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── Card control: badge + big button, self-hosting the sheet ───────────
export function TakePhotosControl({ job, onJobUpdated, compact = false }) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState(job)
  useEffect(() => { setLocal(job) }, [job])
  const items = useQueue(job.id)
  if (!photosRelevant(local)) return null
  const p = photoProgress(local)
  const up = progressOf(items)
  const uploading = up.busy > 0
  return (
    <>
      {compact ? (
        <PhotoBadge job={local} size="xs" onClick={() => setOpen(true)} />
      ) : (
        <button type="button" onClick={e => { e.stopPropagation(); setOpen(true) }}
          className="w-full flex items-center justify-between gap-2 rounded-xl px-3"
          style={{ backgroundColor: p.complete ? '#f0fdf4' : '#fff5f0', border: `1.5px solid ${p.complete ? '#86efac' : ORANGE}`, padding: '10px 12px', minHeight: '44px' }}>
          <span className="text-sm font-bold" style={{ color: p.complete ? GREEN : ORANGE }}>
            {uploading ? `⬆︎ Uploading ${up.done}/${up.total} · ${up.pct}%` : p.complete ? '📸 Photos done' : `📸 Take photos · ${p.filled}/${p.total}`}
          </span>
          <PhotoBadge job={local} />
        </button>
      )}
      {uploading && !compact && <div className="rounded-full overflow-hidden -mt-1 mb-2" style={{ height: 5, backgroundColor: '#fde68a' }}><div className="h-full" style={{ width: `${up.pct}%`, backgroundColor: '#b45309', transition: 'width .2s' }} /></div>}
      {open && (
        <JobPhotosSheet job={local} onClose={() => setOpen(false)}
          onJobUpdated={j => { setLocal(j); onJobUpdated && onJobUpdated(j) }} />
      )}
    </>
  )
}
