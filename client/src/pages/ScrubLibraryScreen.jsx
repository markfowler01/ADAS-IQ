// 🔬 Scrub Library (Mark 2026-09-28).
//
// Laid out like the Kinetic ID report list he works in every day, because
// that shape is already proven for this job — but with the vehicle and RO
// leading, since that is what he actually looks for ("make model with RO
// number at the far left, the most usable data").
//
// Opening one shows the same Calibration Identification Report structure —
// Repair / Vehicle header, a summary, then every sensor with its verdict,
// triggers and line numbers — in Absolute ADAS colours, matching the PDF the
// button downloads so the screen and the document read as one thing.
import { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import Navbar from '../components/Navbar'
// The SAME blue "Send Quote to Shop" button the jobs page uses — line review, then
// /shop-quotes/send attaches the Quote PDF. Reused, not copied (Mark 2026-09-29).
import { SendQuoteButton } from '../components/ToggleBoard'

const ORANGE = '#CD4419'
const INK = '#1a1a1a'

const SOURCE_LABEL = {
  button: '🔬 Scrub button', upload: '📄 Upload', email: '📧 Email', equote: '📧 Email',
  requeue: '🔄 Re-scrub', 'report-only': '📎 Reports only',
}
const sourceLabel = s => SOURCE_LABEL[s] || (String(s || '').startsWith('mail:') ? `📥 ${String(s).slice(5)}` : s || '—')
const statusNote = s => s.status === 'from-card' ? 'from card' : s.status === 'report-only' ? 'not scrubbed' : ''

// Where this car is on the money path. Grey until it turns into paperwork.
const STAGE = {
  scrubbed: { label: 'scrubbed', bg: '#f5f3f0', fg: '#777' },
  quoted:   { label: 'quoted',   bg: '#eff6ff', fg: '#1e40af' },
  quote_requested: { label: 'quote requested', bg: '#dbeafe', fg: '#1d4ed8' },
  requested: { label: 'job requested', bg: '#ffedd5', fg: '#c2410c' },
  job:      { label: 'on the board', bg: '#fff7ed', fg: '#b45309' },
  invoiced: { label: 'invoiced', bg: '#dcfce7', fg: '#166534' },
  paid:     { label: 'paid',     bg: '#166534', fg: '#fff' },
}
function StagePill({ s }) {
  const st = STAGE[s.stage] || STAGE.scrubbed
  const detail = s.invoiceNumber ? ` ${s.invoiceNumber}` : s.quoteNumber ? ` ${s.quoteNumber}` : ''
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap" style={{ backgroundColor: st.bg, color: st.fg }}>{st.label}{detail}</span>
}

// One tap copies the VIN (Mark 2026-09-30). Inside a clickable row it stops
// the tap from opening the scrub. Clipboard write is synchronous with the tap
// (iOS PWA rule: no clipboard after an await).
function CopyVin({ vin, className = '', style = {} }) {
  const [ok, setOk] = useState(false)
  if (!vin) return <span className={className} style={style}>—</span>
  const copy = e => {
    e.stopPropagation(); e.preventDefault()
    try { navigator.clipboard?.writeText(vin) } catch { /* fine */ }
    setOk(true); setTimeout(() => setOk(false), 1500)
  }
  return (
    <span role="button" tabIndex={0} onClick={copy} onKeyDown={e => e.key === 'Enter' && copy(e)} title="Tap to copy the VIN"
      className={`cursor-pointer rounded px-1 -mx-1 hover:bg-orange-50 ${className}`} style={{ ...style, ...(ok ? { color: '#166534' } : {}) }}>
      {ok ? '✓ copied' : vin}{!ok && <span className="ml-1 opacity-40">⧉</span>}
    </span>
  )
}

// Rear blind spot is ONE line on every make/model (Mark 2026-09-30). Scrubs
// saved before the rule, and Kinetic uploads, carry Left / Right rows — fold
// them for display (the server folds on every new save). Works on the list's
// sensors ({n,r,l,g}) and the detail's lines ({name,required,lines,trigger}).
function foldBsm(items, k = { name: 'n', req: 'r', lines: 'l', trig: 'g' }) {
  if (!Array.isArray(items)) return items
  const isBsm = x => /blind.?spot|\bbsm\b|\bblis\b/i.test(String(x[k.name] || '')) && !/front/i.test(String(x[k.name] || ''))
  const rows = items.filter(isBsm)
  if (rows.length < 2 && !(rows[0] && /\b(left|right)\b/i.test(rows[0][k.name]))) return items
  const side = x => /\bleft\b/i.test(x[k.name]) ? 'left' : /\bright\b/i.test(x[k.name]) ? 'right' : ''
  const on = rows.filter(x => x[k.req])
  const sides = [...new Set((on.length ? on : rows).map(side).filter(Boolean))]
  const note = sides.length === 2 ? 'both sides' : sides.length ? `${sides[0]} side` : ''
  const keep = { ...(on[0] || rows[0]), [k.name]: 'Rear Blind Spot Radar', [k.req]: on.length > 0,
    [k.lines]: [...new Set(rows.flatMap(x => String(x[k.lines] || '').split(/,\s*/)).filter(Boolean))].join(', ') }
  if (note) keep[k.trig] = [keep[k.trig] || '', `(${note})`].filter(Boolean).join(' ')
  const out = items.filter(x => !isBsm(x)); out.splice(items.indexOf(rows[0]), 0, keep)
  return out
}
function normScrub(s) {
  if (!s || !Array.isArray(s.sensors) || !s.sensors.length) return s
  const sensors = foldBsm(s.sensors)
  if (sensors === s.sensors) return s
  return { ...s, sensors, requiredCount: sensors.filter(x => x.r).length, sensorCount: sensors.length }
}

// 📋 Request Job (Mark 2026-09-30) — shared by the list rows and the scrub
// page. Puts the car in the board's Job Requested column with everything the
// scrub knows (shop, car, VIN, RO, claim, insurer, every calibration line,
// the estimate link) and marks the scrub "job requested". Same POST as the
// board's "+ Request Job", so Kat's alert fires the same way.
async function requestJobFor(scrub, user, kind = 'job') {
  const quote = kind === 'quote'
  let full = scrub
  if (!Array.isArray(scrub?.payload?.calibrations)) {
    const r = await apiFetch(`${API_BASE}/api/scrubs/${scrub.id}`)
    if (r.ok) full = { ...scrub, ...(await r.json()) }
  }
  const raw = Array.isArray(full.payload?.calibrations) && full.payload.calibrations.length
    ? full.payload.calibrations.map(toLine)
    : (full.sensors || []).map(x => ({ name: x.n, type: x.t, required: x.r, lines: x.l, trigger: x.g, why: '' }))
  const list = foldBsm(raw, { name: 'name', req: 'required', lines: 'lines', trig: 'trigger' })
  const cals = list.map(c => ({ calibration_name: c.name, cal_type: c.type || '', trigger: c.trigger || '', line_references: c.lines || '', justification: c.why || '', enabled: !!c.required }))
  const req = cals.filter(c => c.enabled).map(c => c.calibration_name)
  const notes = [
    `${quote ? '📝 Quote requested' : '📋 Job requested'} from the scrub${full.ro ? ` · RO ${full.ro}` : ''}${full.claim ? ` · claim ${full.claim}` : ''}${full.insurer ? ` · ${full.insurer}` : ''}`,
    req.length ? `Required: ${req.join(', ')}` : 'Scrub found nothing required — check before dispatch',
    full.fileId ? `CCC estimate: https://workdrive.zoho.com/file/${full.fileId}` : '',
  ].filter(Boolean).join('\n')
  const payload = {
    shop_name: full.shop || '', customer: full.shop ? { kind: 'shop', name: full.shop } : undefined,
    year: full.year || '', make: full.make || '', model: full.model || '',
    vehicle: [full.year, full.make, full.model].filter(Boolean).join(' ') || full.vehicle || '',
    vin: full.vin || '', insurer: full.insurer || '', quote_number: full.ro || '', ro_number: full.ro || '',
    technician: user?.techName || (user?.role === 'technician' ? (user?.name || '').split(' ')[0] : '') || '',
    notes, status: 'job_requested', via_request: true, request_type: quote ? 'quote' : 'job',   // quote → board's Quotes Requested column
    calibrations: JSON.stringify(cals),
  }
  const r = await apiFetch(`${API_BASE}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  const jobId = String(d.id || d.job?.id || '')
  const stage = quote ? 'quote_requested' : 'requested'
  let next = { ...full, jobId, stage }
  if (jobId) {
    const l = await apiFetch(`${API_BASE}/api/scrubs/${full.id}/job`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId, stage }) })
    const ld = await l.json().catch(() => ({}))
    if (ld.scrub) next = ld.scrub
  }
  return normScrub(next)
}

// Quote (blue, left) + Job (orange, right) — one tap each, right on the row
// (Mark 2026-09-30: "50-50 … quote on the left in blue, job in orange").
// full = the phone card's full-width 50/50 bar.
const REQ_STYLE = { quote: { bg: '#1d4ed8', label: '📝 Quote' }, job: { bg: '#CD4419', label: '📋 Job' } }
function RowRequest({ s, user, onDone, full = false }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  if (s.jobId || ['invoiced', 'paid'].includes(s.stage)) return null   // already billed — nothing to request
  const go = kind => async e => {
    e.stopPropagation(); e.preventDefault()
    if (busy) return
    setBusy(kind); setErr('')
    try { onDone(await requestJobFor(s, user, kind)) } catch (x) { setErr(x.message || 'failed') } finally { setBusy('') }
  }
  return (
    <span className={`flex gap-1.5 ${full ? 'w-full mt-2' : ''}`} title={err || ''}>
      {['quote', 'job'].map(k => (
        <span key={k} role="button" tabIndex={0} onClick={go(k)} onKeyDown={e => e.key === 'Enter' && go(k)(e)}
          title={k === 'quote' ? 'Send to Quotes Requested with every scrub detail — Kat drafts the estimate' : 'Send to Job Requested with every scrub detail — Kat prices and dispatches it'}
          className={`inline-flex items-center justify-center font-bold rounded-lg whitespace-nowrap cursor-pointer text-white ${full ? 'flex-1 text-sm py-2.5' : 'text-[11px] px-2 py-1'}`}
          style={{ backgroundColor: err ? '#b91c1c' : REQ_STYLE[k].bg, opacity: busy && busy !== k ? .4 : busy ? .7 : 1 }}>
          {busy === k ? '…' : err ? '⚠ Retry' : `${REQ_STYLE[k].label}${full ? ' request' : ''}`}
        </span>
      ))}
    </span>
  )
}

// RO on the list rows. Invoiced / paid = the RO itself gets a green
// highlighter with a $ instead of a separate "invoiced …" tag (Mark
// 2026-09-30: "instead of crowding this area"); other stages keep their pill.
function RoTag({ s }) {
  const billed = ['invoiced', 'paid'].includes(s.stage)
  const ro = s.ro ? `RO ${s.ro}` : 'no RO'
  if (!billed) return <>{ro}<StagePill s={s} /></>
  return <span className="font-bold px-1.5 py-0.5 rounded whitespace-nowrap" title={`${s.stage === 'paid' ? 'Paid' : 'Invoiced'}${s.invoiceNumber ? ` · ${s.invoiceNumber}` : ''}`} style={{ backgroundColor: s.stage === 'paid' ? '#86efac' : '#bbf7d0', color: '#14532d' }}>$ {ro}</span>
}

// 📝 Quote already sent → blue border on the list (Mark 2026-09-30). Billed cars
// don't need it (their RO is the green $ highlight).
const QUOTE_BLUE = '#2563eb'
// Only a quote actually SENT (stage 'quoted' — set by Send Quote). A job's Books
// estimate number alone isn't a sent quote; once it's a job it shows "on the board".
const quoteSent = s => s.stage === 'quoted'

// 👀 Last lot-walk result on a car (Mark 2026-09-30).
const SEEN = {
  here:      { label: 'On the lot', bg: '#dcfce7', fg: '#166534', icon: '✅' },
  not_ready: { label: 'Not ready',  bg: '#fef3c7', fg: '#92400e', icon: '⏳' },
  gone:      { label: 'Not here',   bg: '#fee2e2', fg: '#b91c1c', icon: '❌' },
  found:     { label: 'Found on walk', bg: '#e0f2fe', fg: '#0369a1', icon: '🆕' },
}
function SeenChip({ s }) {
  const v = s.seen; if (!v || !SEEN[v.s]) return null
  const st = SEEN[v.s]
  const when = v.at ? new Date(v.at).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' }) : ''
  return <div className="mt-0.5"><span className="text-[10px] font-bold font-sans px-1.5 py-0.5 rounded" title={v.n || ''} style={{ backgroundColor: st.bg, color: st.fg }}>👀 {st.icon} {st.label}{when ? ` · ${when}` : ''}{v.by ? ` · ${v.by}` : ''}{v.n ? ` · ${v.n}` : ''}</span></div>
}

// 🚶 Lot walk: one shop's active cars as a big-button checklist; add cars found
// on the lot; finish → summary to Kat + #dispatch. Phone first.
function LotWalk({ shop, cars, user, onSeen, onFound, onRequest, onClose }) {
  const [walk, setWalk] = useState(null)
  const [err, setErr] = useState('')
  const [marks, setMarks] = useState({})        // scrubId → status
  const [notes, setNotes] = useState({})
  const [busy, setBusy] = useState('')
  const [found, setFound] = useState([])
  const [f, setF] = useState({ open: false, vin: '', vehicle: '', ro: '', note: '' })
  const [done, setDone] = useState(null)
  useEffect(() => {
    apiFetch(`${API_BASE}/api/scrubs/walks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop }) })
      .then(r => r.json()).then(d => d.walk ? setWalk(d.walk) : setErr(d.error || 'Could not start the walk.')).catch(e => setErr(e.message))
  }, [shop])
  const mark = async (s, status) => {
    if (!walk || busy) return
    setBusy(`${s.id}:${status}`)
    try {
      for (const id of (s._ids || [s.id])) {
        const r = await apiFetch(`${API_BASE}/api/scrubs/walks/${walk.id}/mark`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scrubId: id, status, note: notes[s.id] || '', label: [s.vehicle, s.ro && `RO ${s.ro}`].filter(Boolean).join(' · ') }) })
        const d = await r.json(); if (!r.ok) throw new Error(d.error)
        onSeen(id, { s: status, at: new Date().toISOString(), by: user?.techName || (user?.name || '').split(' ')[0] || '', n: notes[s.id] || '' })
      }
      setMarks(m => ({ ...m, [s.id]: status }))
    } catch (e) { setErr(e.message || 'Could not save that.') } finally { setBusy('') }
  }
  const addFound = async () => {
    if (!walk || (!f.vin.trim() && !f.vehicle.trim())) return
    setBusy('found')
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/walks/${walk.id}/found`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop, vin: f.vin, vehicle: f.vehicle, ro: f.ro, note: f.note }) })
      const d = await r.json(); if (!r.ok || !d.id) throw new Error(d.error || 'Could not add the car.')
      const row = { id: d.id, shop, vin: f.vin.length === 17 ? f.vin.toUpperCase() : '', vehicle: f.vehicle || `VIN …${f.vin}`, ro: f.ro, stage: 'scrubbed', status: 'found', sensors: [], requiredCount: 0, sensorCount: 0, at: new Date().toISOString(), seen: { s: 'found', at: new Date().toISOString(), n: f.note } }
      setFound(x => [...x, row]); onFound(row); setMarks(m => ({ ...m, [d.id]: 'found' }))
      setF({ open: false, vin: '', vehicle: '', ro: '', note: '' })
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const finish = async () => {
    if (!walk) return onClose()
    setBusy('finish')
    try { const r = await apiFetch(`${API_BASE}/api/scrubs/walks/${walk.id}/finish`, { method: 'POST' }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setDone(d.walk) }
    catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  // One card per car: a car scrubbed 5 times is still one car on the lot.
  // Newest scrub is the card; a tap marks every scrub of that car.
  const carKey = c => (String(c.vin || '').length === 17 ? c.vin : '') || (c.ro ? `ro:${c.ro}` : `id:${c.id}`)
  const sibs = new Map()
  for (const c of [...cars].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))) { const k = carKey(c); sibs.set(k, [...(sibs.get(k) || []), c]) }
  const uniq = [...sibs.values()].map(list => ({ ...list[0], _ids: list.map(x => x.id) }))
  const all = [...uniq, ...found.filter(x => !uniq.some(c => c._ids.includes(x.id)))]
  const left = all.filter(s => !marks[s.id]).length
  const inp = { border: '1.5px solid #ddd', outline: 'none', backgroundColor: '#fff' }
  if (done) return (
    <div className="p-4 max-w-xl mx-auto">
      <div className="rounded-2xl p-5 text-center" style={{ backgroundColor: '#f0fdf4', border: '2px solid #86efac' }}>
        <div className="text-3xl">🚶✅</div>
        <div className="text-lg font-extrabold mt-1" style={{ color: '#166534' }}>Walk done · {shop}</div>
        <div className="text-sm mt-1" style={{ color: '#166534' }}>{done.summary}</div>
        <div className="text-xs mt-2" style={{ color: '#555' }}>Kat and #dispatch have the summary.</div>
        <button onClick={onClose} className="mt-4 rounded-xl px-5 py-3 text-sm font-bold text-white" style={{ backgroundColor: INK }}>Back to Scrubs</button>
      </div>
    </div>
  )
  return (
    <div className="p-3 max-w-xl mx-auto pb-28">
      <div className="flex items-center justify-between gap-2 mb-3">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>← Scrubs</button>
        <div className="text-right min-w-0">
          <div className="text-base font-extrabold truncate" style={{ color: INK }}>🚶 {shop}</div>
          <div className="text-[11px]" style={{ color: '#888' }}>{all.length - left} of {all.length} checked</div>
        </div>
      </div>
      {err && <div className="rounded-lg px-3 py-2 mb-2 text-sm" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>{err}</div>}
      {!walk && !err && <div className="text-sm p-4 text-center" style={{ color: '#888' }}>Starting the walk…</div>}
      {!all.length && walk && <div className="rounded-xl p-4 mb-2 text-sm text-center" style={{ backgroundColor: '#f5f3f0', color: '#666' }}>No active cars for {shop}. Add what you find on the lot below.</div>}
      <div className="grid gap-2">
        {all.map(s => {
          const m = marks[s.id]
          return (
            <div key={s.id} className="rounded-xl p-3" style={{ border: `2px solid ${m ? SEEN[m].fg : '#e5e5e5'}`, backgroundColor: m ? SEEN[m].bg : '#fff' }}>
              <div className="text-sm font-bold leading-snug" style={{ color: INK }}>{s.vehicle || 'Vehicle'}</div>
              <div className="text-xs font-mono flex items-center gap-1.5 flex-wrap mt-0.5" style={{ color: ORANGE }}>{s.ro ? `RO ${s.ro}` : 'no RO'}{s.vin ? <span style={{ color: '#888' }}>…{String(s.vin).slice(-6)}</span> : null}<CalPills s={s} /></div>
              <div className="grid grid-cols-3 gap-1.5 mt-2">
                {['here', 'not_ready', 'gone'].map(k => (
                  <button key={k} onClick={() => mark(s, k)} disabled={!walk || !!busy}
                    className="rounded-lg py-2.5 text-xs font-bold" style={m === k ? { backgroundColor: SEEN[k].fg, color: '#fff' } : { backgroundColor: '#fff', color: SEEN[k].fg, border: `1.5px solid ${SEEN[k].fg}`, opacity: busy === `${s.id}:${k}` ? .5 : 1 }}>
                    {SEEN[k].icon} {SEEN[k].label}
                  </button>
                ))}
              </div>
              <input value={notes[s.id] || ''} onChange={e => setNotes(n => ({ ...n, [s.id]: e.target.value }))} placeholder="Note (optional) — e.g. waiting on bumper"
                className="w-full text-xs rounded-lg px-2.5 py-2 mt-1.5" style={inp} />
              {m === 'here' && <RowRequest s={s} user={user} onDone={onRequest} full />}
            </div>
          )
        })}
      </div>
      {/* ＋ Found a car */}
      <div className="mt-3 rounded-xl p-3" style={{ border: '2px dashed #0369a1', backgroundColor: '#f0f9ff' }}>
        {!f.open
          ? <button onClick={() => setF(x => ({ ...x, open: true }))} className="w-full text-sm font-bold py-1" style={{ color: '#0369a1' }}>＋ Found a car that isn't listed</button>
          : <div className="grid gap-1.5">
              <div className="text-sm font-bold" style={{ color: '#0369a1' }}>🆕 Car found on the lot</div>
              <input value={f.vin} onChange={e => setF(x => ({ ...x, vin: e.target.value.toUpperCase() }))} placeholder="VIN (full 17) or last 4–8" className="text-sm rounded-lg px-2.5 py-2 font-mono" style={inp} />
              <input value={f.vehicle} onChange={e => setF(x => ({ ...x, vehicle: e.target.value }))} placeholder="Year make model (e.g. 2022 Honda CR-V)" className="text-sm rounded-lg px-2.5 py-2" style={inp} />
              <input value={f.ro} onChange={e => setF(x => ({ ...x, ro: e.target.value }))} placeholder="RO (if you know it)" className="text-sm rounded-lg px-2.5 py-2" style={inp} />
              <input value={f.note} onChange={e => setF(x => ({ ...x, note: e.target.value }))} placeholder="Note — what's going on with it" className="text-sm rounded-lg px-2.5 py-2" style={inp} />
              <div className="flex gap-1.5">
                <button onClick={() => setF({ open: false, vin: '', vehicle: '', ro: '', note: '' })} className="flex-1 rounded-lg py-2.5 text-sm font-bold" style={{ backgroundColor: '#fff', color: '#555', border: '1px solid #ddd' }}>Cancel</button>
                <button onClick={addFound} disabled={busy === 'found' || (!f.vin.trim() && !f.vehicle.trim())} className="flex-1 rounded-lg py-2.5 text-sm font-bold text-white" style={{ backgroundColor: '#0369a1', opacity: (!f.vin.trim() && !f.vehicle.trim()) ? .5 : 1 }}>{busy === 'found' ? 'Adding…' : 'Add car'}</button>
              </div>
            </div>}
      </div>
      {/* Finish, pinned to the bottom */}
      <div className="fixed left-0 right-0 bottom-0 z-40 p-2" style={{ backgroundColor: 'rgba(255,255,255,.96)', borderTop: '1px solid #eee', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}>
        <div className="max-w-xl mx-auto">
          <button onClick={finish} disabled={!walk || busy === 'finish'} className="w-full rounded-xl py-3.5 text-base font-bold text-white" style={{ backgroundColor: '#0f766e' }}>
            {busy === 'finish' ? 'Finishing…' : left ? `Finish walk (${left} not checked)` : '✅ Finish walk'}
          </button>
        </div>
      </div>
    </div>
  )
}

// One pill per REQUIRED calibration on the list rows (Mark 2026-09-30).
function CalPills({ s }) {
  const names = (s.sensors || []).filter(x => x.r).map(x => x.n)
  const list = names.length ? names : String(s.requiredNames || '').split(/\s*[,|;]\s*/).filter(Boolean)
  return list.map(n => <span key={n} className="text-[10px] font-bold font-sans px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: '#fff1ec', color: '#b4380f', border: '1px solid #f6c3b1' }}>{String(n).replace(/\s*calibration$/i, '')}</span>)
}

const when = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const shortWhen = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ScrubLibraryScreen({ user, onLogout, currentScreen, onNavigate, onExtracted }) {
  const nav = <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)
  const [openBusy, setOpenBusy] = useState(false)
  const timer = useRef(null)
  const fileRef = useRef(null)
  const [up, setUp] = useState({ busy: false, msg: '', name: '' })

  // ⬆️ Upload a report (Mark 2026-09-29). The scrub runs past the gateway's
  // 30s window more often than not, so a cut response is not a failure: we
  // poll the list for the file name for up to three minutes and open it.
  const pickFile = () => fileRef.current?.click()
  const [dragOver, setDragOver] = useState(false)
  const [tab, setTab] = useState('active')        // active | archive (invoiced + paid)
  const [shopSel, setShopSel] = useState('')      // '' = all shops
  const [walkShop, setWalkShop] = useState('')    // 🚶 a lot walk is open for this shop
  const onFile = async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await uploadReport(f) }
  const onDrop = async e => {
    e.preventDefault(); setDragOver(false)
    const f = [...(e.dataTransfer?.files || [])].find(x => /pdf$/i.test(x.name) || x.type === 'application/pdf')
    if (!f) { setUp({ busy: false, msg: 'Drop a PDF estimate.', name: '' }); return }
    if (up.busy) return
    await uploadReport(f)
  }
  const uploadReport = async f => {
    const name = f.name
    setUp({ busy: true, msg: `Scrubbing ${name} — about a minute…`, name })
    const fd = new FormData(); fd.append('file', f, name)
    let refused = ''
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/upload`, { method: 'POST', body: fd })
      if (r.status === 400) { const d = await r.json().catch(() => ({})); refused = d.error || 'Not accepted.' }
    } catch { /* gateway cut — the scrub is still running */ }
    if (refused) { setUp({ busy: false, msg: refused, name: '' }); return }
    const t0 = Date.now()
    while (Date.now() - t0 < 180000) {
      await new Promise(res => setTimeout(res, 8000))
      try {
        const r = await apiFetch(`${API_BASE}/api/scrubs?limit=30`)
        const d = await r.json().catch(() => ({}))
        const hit = (d.scrubs || []).find(x => x.fileName === name || (x.fileName || '').endsWith(name))
        if (hit) { setRows((d.scrubs || []).map(normScrub)); setUp({ busy: false, msg: '', name: '' }); openScrub(hit); return }
      } catch { /* keep polling */ }
    }
    setUp({ busy: false, msg: `${name} is taking longer than usual — pull to refresh in a minute.`, name: '' })
  }

  const load = async (search = '') => {
    setLoading(true); setErr('')
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs?limit=1000${search ? `&q=${encodeURIComponent(search)}` : ''}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setRows(Array.isArray(d.scrubs) ? d.scrubs.map(normScrub) : [])
    } catch (e) { setErr(e.message || 'Could not load the library.'); setRows([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { load(''); apiFetch(`${API_BASE}/api/scrubs/stats`).then(r => r.json()).then(setStats).catch(() => {}) }, [])
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => load(q.trim()), 350)
    return () => clearTimeout(timer.current)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  // Opening a report pushes a history entry, so the browser back button and
  // the phone's back gesture return to the list instead of leaving the app
  // (Mark 2026-09-29: "there's no way to go back"). Closing pops it.
  useEffect(() => {
    const onPop = () => { setOpen(null); setOpenBusy(false) }
    window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop)
  }, [])
  const closeScrub = () => { setOpen(null); if (window.history.state?.scrub) window.history.back() }
  const swapRow = next => setRows(rs => rs.map(r => (r.id === next.id ? { ...r, ...next } : r)))
  const openScrub = async row => {
    setOpenBusy(true)
    try { window.history.pushState({ scrub: row.id }, '') } catch { /* fine */ }
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/${row.id}`)
      const d = await r.json().catch(() => ({}))
      setOpen(r.ok ? d : { ...row, _error: d.error || 'Could not open this scrub.' })
    } catch (e) { setOpen({ ...row, _error: e.message }) }
    finally { setOpenBusy(false) }
  }

  if (open || openBusy) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#fff' }}>
        {nav}
        {openBusy
          ? <div className="p-10 text-center text-sm" style={{ color: '#777' }}>Opening…</div>
          : <ScrubReport s={open} user={user} onBack={closeScrub} onNavigate={onNavigate} onExtracted={onExtracted} />}
      </div>
    )
  }

  // ── Active / Archive + shop grouping (Mark 2026-09-30) ──
  const billed = s => ['invoiced', 'paid'].includes(s.stage)
  const tabRows = rows.filter(s => (tab === 'archive' ? billed(s) : !billed(s)))
  // One shop, many spellings ("…LLC", "…Llc", "Avon Body Shop, Llc") → one group,
  // shown under its most common spelling.
  const shopKey = s => String(s.shop || '').toLowerCase().replace(/[.,&']/g, ' ').replace(/\b(llc|inc|co|corp|corporation|ltd|the)\b/g, ' ').replace(/[^a-z0-9]+/g, '') || 'noshop'
  const shopLabel = (() => {
    const m = new Map()
    for (const s of rows) { const k = shopKey(s); const n = (s.shop || '').trim() || 'No shop'; const c = m.get(k) || {}; c[n] = (c[n] || 0) + 1; m.set(k, c) }
    const out = new Map(); for (const [k, c] of m) out.set(k, Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]); return out
  })()
  const shopName = s => shopLabel.get(shopKey(s)) || 'No shop'
  const shops = (() => {
    const m = new Map()
    for (const s of tabRows) { const k = shopName(s); const e = m.get(k) || { name: k, n: 0, last: '' }; e.n++; if ((s.at || '') > e.last) e.last = s.at || ''; m.set(k, e) }
    return [...m.values()].sort((a, b) => b.last.localeCompare(a.last))
  })()
  const viewRows = shopSel ? tabRows.filter(s => shopName(s) === shopSel) : tabRows
  const groups = shops.filter(g => !shopSel || g.name === shopSel).map(g => ({ ...g, rows: viewRows.filter(s => shopName(s) === g.name) })).filter(g => g.rows.length)
  const addSeen = (id, seen) => setRows(rs => rs.map(r => (r.id === id ? { ...r, seen } : r)))

  if (walkShop) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#fff' }}>
        {nav}
        <LotWalk shop={walkShop} cars={rows.filter(s => !billed(s) && shopName(s) === walkShop)} user={user}
          onSeen={addSeen} onFound={row => setRows(rs => [row, ...rs])} onRequest={swapRow}
          onClose={() => setWalkShop('')} />
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#fff' }}>
    {nav}
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: INK }}>Scrubs</h1>
          <p className="text-xs mt-0.5" style={{ color: '#888' }}>
            {loading ? 'Loading…' : `${rows.length} shown`}{stats?.total ? ` · ${stats.total} in the library` : ''}
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={pickFile} disabled={up.busy} className="rounded-lg px-4 py-2.5 text-sm font-bold whitespace-nowrap" style={{ backgroundColor: ORANGE, color: '#fff', minHeight: 44, opacity: up.busy ? 0.6 : 1 }}>{up.busy ? '⏳ Scrubbing…' : '⬆️ Upload report'}</button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={onFile} style={{ display: 'none' }} />
        </div>
        {up.msg && <div className="w-full text-xs rounded-lg px-3 py-2" style={{ backgroundColor: up.busy ? '#eff6ff' : '#fef2f2', color: up.busy ? '#1e40af' : '#b91c1c' }}>{up.msg}</div>}
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search vehicle, RO, VIN, claim, shop, sensor…"
          className="rounded-lg px-3 py-2.5 text-sm w-full sm:w-auto"
          style={{ border: '1.5px solid #ddd', outline: 'none', minWidth: 0 }}
        />
      </div>

      {/* 📥 Drop box (Mark 2026-09-29: "a box that I can drop an estimate into"). Tap on a phone. */}
      <div
        onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !up.busy && pickFile()}
        role="button"
        className="rounded-xl mb-4 px-4 py-5 text-center cursor-pointer select-none"
        style={{ border: `2px dashed ${dragOver ? ORANGE : '#cfcfcf'}`, backgroundColor: dragOver ? '#fff5f0' : up.busy ? '#eff6ff' : '#fafafa', color: up.busy ? '#1e40af' : '#555' }}
      >
        <div className="text-sm font-bold" style={{ color: dragOver ? ORANGE : INK }}>{up.busy ? '⏳ Scrubbing…' : dragOver ? 'Drop it' : '📥 Drop an estimate here'}</div>
        <div className="text-xs mt-1">{up.busy ? up.msg : 'Drag a CCC estimate PDF onto this box, or tap to choose one. It is scrubbed and filed in the library.'}</div>
      </div>

      {err && (
        <div className="rounded-xl p-3 mb-3 text-sm" style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1.5px solid #fecaca' }}>{err}</div>
      )}

      {/* Active / Archive + shop picker */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {[['active', 'Active', rows.filter(s => !billed(s)).length], ['archive', '🗄 Archive', rows.filter(billed).length]].map(([k, l, n]) => (
          <button key={k} onClick={() => { setTab(k); setShopSel('') }} className="rounded-lg px-3 py-2 text-sm font-bold"
            style={tab === k ? { backgroundColor: INK, color: '#fff' } : { backgroundColor: '#f5f3f0', color: '#555' }}>{l} <span className="opacity-70">{n}</span></button>
        ))}
        {tab === 'archive' && <span className="text-xs" style={{ color: '#888' }}>Invoiced and paid cars</span>}
      </div>
      {shops.length > 1 && (
        <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
          <button onClick={() => setShopSel('')} className="rounded-full px-3 py-1.5 text-xs font-bold whitespace-nowrap flex-shrink-0"
            style={!shopSel ? { backgroundColor: ORANGE, color: '#fff' } : { backgroundColor: '#fff', color: '#555', border: '1px solid #e0dbd6' }}>All shops · {tabRows.length}</button>
          {shops.map(g => (
            <button key={g.name} onClick={() => setShopSel(shopSel === g.name ? '' : g.name)} className="rounded-full px-3 py-1.5 text-xs font-bold whitespace-nowrap flex-shrink-0"
              style={shopSel === g.name ? { backgroundColor: ORANGE, color: '#fff' } : { backgroundColor: '#fff', color: '#555', border: '1px solid #e0dbd6' }}>{g.name} · {g.n}</button>
          ))}
        </div>
      )}

      {!loading && !rows.length && !err && (
        <div className="rounded-xl p-8 text-center text-sm" style={{ backgroundColor: '#f5f3f0', color: '#777' }}>
          {q ? `Nothing matches "${q}".` : 'No scrubs yet. Press 🔬 Scrub estimate on a job card to run the first one.'}
        </div>
      )}

      {groups.map(g => (
        <div key={g.name} className="mb-5">
          {/* Shop header: counts + lot walk */}
          <div className="flex items-center justify-between gap-2 mb-1.5 px-1 flex-wrap">
            <div className="min-w-0">
              <div className="text-base font-extrabold truncate" style={{ color: INK }}>{g.name}</div>
              <div className="text-[11px]" style={{ color: '#888' }}>{[
                [g.rows.filter(s => !s.stage || s.stage === 'scrubbed').length, 'scrubbed'],
                [g.rows.filter(s => ['quote_requested', 'requested'].includes(s.stage)).length, 'requested'],
                [g.rows.filter(s => s.stage === 'quoted').length, 'quote sent'],
                [g.rows.filter(s => s.stage === 'job').length, 'on the board'],
                [g.rows.filter(billed).length, 'invoiced'],
              ].filter(([n]) => n).map(([n, l]) => `${n} ${l}`).join(' · ')}</div>
            </div>
            {tab === 'active' && g.name !== 'No shop' && (
              <button onClick={() => setWalkShop(g.name)} className="rounded-lg px-3 py-2 text-sm font-bold whitespace-nowrap" style={{ backgroundColor: '#0f766e', color: '#fff', minHeight: 40 }}>🚶 Lot walk</button>
            )}
          </div>
      {/* Desktop table */}
        {!!g.rows.length && (
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #eee' }}>
                  <th className="text-left font-bold py-2 pl-2" style={{ color: INK, width: 44 }}></th>
                  <th className="text-left font-bold py-2" style={{ color: INK }}>Vehicle · RO</th>
                  <th className="text-left font-bold py-2" style={{ color: INK }}>VIN</th>
                  <th className="text-left font-bold py-2" style={{ color: INK }}>Claim</th>
                  <th className="text-left font-bold py-2" style={{ color: INK }}>Shop</th>
                  <th className="text-left font-bold py-2" style={{ color: INK }}>Updated</th>
                  <th className="text-left font-bold py-2" style={{ color: INK }}></th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map(s => (
                  <tr
                    key={s.id}
                    onClick={() => openScrub(s)}
                    className="cursor-pointer hover:bg-gray-50"
                    title={quoteSent(s) ? `Quote sent${s.quoteNumber ? ` · ${s.quoteNumber}` : ''}` : undefined}
                    style={{ borderBottom: '1px solid #f0f0f0', ...(quoteSent(s) ? { outline: `2px solid ${QUOTE_BLUE}`, outlineOffset: -2, backgroundColor: '#f5f9ff' } : {}) }}
                  >
                    <td className="py-2.5 pl-2">
                      <span
                        className="inline-flex items-center justify-center text-[11px] font-bold rounded-full"
                        style={{ width: 24, height: 24, backgroundColor: s.requiredCount ? ORANGE : '#e5e5e5', color: s.requiredCount ? '#fff' : '#888' }}
                        title={`${s.requiredCount} required of ${s.sensorCount} sensors`}
                      >{s.requiredCount}</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="font-bold" style={{ color: INK }}>{s.vehicle || 'Vehicle not read'}</div>
                      <SeenChip s={s} />
                      <div className="text-xs font-mono flex items-center gap-1.5 flex-wrap" style={{ color: ORANGE }}><RoTag s={s} /><CalPills s={s} />{statusNote(s) && <span className="text-[10px] font-sans" style={{ color: '#999' }}>{statusNote(s)}</span>}</div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs" style={{ color: '#555' }}><CopyVin vin={s.vin} /></td>
                    <td className="py-2.5 pr-3 font-mono text-xs" style={{ color: '#555' }}>{s.claim || '—'}</td>
                    <td className="py-2.5 pr-3 text-xs" style={{ color: '#555' }}>{s.shop || '—'}</td>
                    <td className="py-2.5 pr-3 text-xs" style={{ color: '#888' }}>{shortWhen(s.at)}</td>
                    <td className="py-2.5 pr-2"><RowRequest s={s} user={user} onDone={swapRow} /></td>
                    <td className="py-2.5 text-right pr-2" style={{ color: ORANGE }}>→</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
  
        {/* Phone cards */}
        <div className="md:hidden grid grid-cols-1 gap-2">   {/* grid-cols-1 = minmax(0,1fr): one long card can't widen the page */}
          {g.rows.map(s => (
            <button key={s.id} onClick={() => openScrub(s)} className="text-left rounded-xl p-3 w-full min-w-0 overflow-hidden"
              style={{ backgroundColor: quoteSent(s) ? '#f5f9ff' : '#fff', border: `2px solid ${quoteSent(s) ? QUOTE_BLUE : s.requiredCount ? ORANGE : '#e5e5e5'}` }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold leading-snug" style={{ color: INK, overflowWrap: 'anywhere' }}>{s.vehicle || 'Vehicle not read'}</div>
                  <div className="text-xs font-mono flex items-center gap-2 flex-wrap" style={{ color: ORANGE }}><RoTag s={s} /><CalPills s={s} /></div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                  style={{ backgroundColor: s.requiredCount ? ORANGE : '#f5f3f0', color: s.requiredCount ? '#fff' : '#777' }}>
                  {s.requiredCount} of {s.sensorCount}
                </span>
              </div>
              <SeenChip s={s} />
              <div className="text-[11px] mt-1" style={{ color: '#666' }}>{s.shop || '—'}</div>
              <div className="text-[10px] mt-0.5 font-mono" style={{ color: '#999' }}><CopyVin vin={s.vin} /></div>
              <div className="text-[10px] mt-0.5" style={{ color: '#999' }}>{shortWhen(s.at)}</div>
              <RowRequest s={s} user={user} onDone={swapRow} full />
            </button>
          ))}
        </div>
          </div>
      ))}
    </div>
    </div>
  )
}

// ── One scrub, as a Calibration Identification Report ────────────────────────
// ✏️ Editable (Mark 2026-09-28: "sometimes the scrubber is wrong and we need to
// manually add calibration lines before the report is created or downloaded
// ... along with the reason, using AI to rewrite it"). Edit mode lets the
// estimator toggle, add, rewrite and remove lines; Save writes them back to
// the library row, so the PDF button prints exactly what is on screen.
const SENSOR_NAMES = ['Front Windshield Camera', 'Front Radar', 'Front Side Radar', 'Rear Blind Spot Radar — Left', 'Rear Blind Spot Radar — Right', 'Back Up Camera', 'Around View Camera', 'Park Distance Sensor', 'Steering Angle Sensor', 'Seat Weight Sensor', 'Headlamp Aim', 'Night Vision Camera', 'Driver Monitor Camera', 'Rear Radar (rear AEB)', 'Rear Camera Mirror']
const CAL_TYPES = ['Static', 'Dynamic', 'Static + Dynamic']

const toLine = c => ({
  name: c.sensor || c.calibration_name || '', type: c.cal_type || '',
  required: c.enabled === true, lines: c.line_references || '',
  trigger: c.trigger || '', why: c.justification || '',
  added: !!c._added, edited: !!c._edited, by: c._by || '', guard: c._guard || '',
})
const fromLine = l => ({
  calibration_name: l.name, cal_type: l.type || null, trigger: l.trigger || null,
  line_references: l.lines || null, justification: l.why || '', enabled: !!l.required,
  ...(l.added ? { _added: true, _by: l.by } : {}), ...(l.edited ? { _edited: true, _by: l.by } : {}),
})

function ScrubReport({ s: initial, user, onBack, onNavigate, onExtracted }) {
  const [s, setS] = useState(initial)
  const [reqBusy, setReqBusy] = useState('')
  const [reqMsg, setReqMsg] = useState('')
  const [cardBusy, setCardBusy] = useState(false)
  const [cardMsg, setCardMsg] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfErr, setPdfErr] = useState('')
  const [qBusy, setQBusy] = useState(false)
  const [qMsg, setQMsg] = useState('')
  // The Books estimate id once a quote is built (or already stamped on the
  // scrub) — this is what unlocks the shared Send-Quote review/send button.
  const [quoteId, setQuoteId] = useState(initial.quoteId || '')
  const [expanded, setExpanded] = useState({})
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [aiBusy, setAiBusy] = useState(-1)
  const [estUrl, setEstUrl] = useState('')      // two-tap open (never window.open after an await — iOS PWA rule)
  const [estBusy, setEstBusy] = useState(false)
  const [add, setAdd] = useState({ name: '', type: 'Static', lines: '', reason: '', why: '', busy: false })
  // 📚 ALLDATA quick reference: known deep links for this year/make/model, else VIN + selector.
  const [alldata, setAlldata] = useState({ links: [], match: 'loading' })
  const [pasteUrl, setPasteUrl] = useState('')
  const [pasteBusy, setPasteBusy] = useState(false)
  const [pasteMsg, setPasteMsg] = useState('')
  const [vinCopied, setVinCopied] = useState(false)
  useEffect(() => {
    let live = true
    apiFetch(`${API_BASE}/api/scrubs/${s.id}/alldata`).then(r => r.json()).then(d => { if (live) setAlldata(d && Array.isArray(d.links) ? d : { links: [], match: 'none' }) }).catch(() => { if (live) setAlldata({ links: [], match: 'none' }) })
    return () => { live = false }
  }, [s.id])
  const ALLDATA_HOME = 'https://my.alldata.com/repair/'
  const quickRef = alldata.links.find(l => /quick reference|adas systems|locations/i.test(l.label)) || alldata.links[0]
  // No deep link for this car: copy the VIN first (synchronously, so the tab
  // still opens on iOS), then the tech pastes it into ALLDATA's vehicle box.
  const openAlldataWithVin = () => {
    try { navigator.clipboard?.writeText(s.vin || '') } catch { /* fine */ }
    setVinCopied(true); setTimeout(() => setVinCopied(false), 4000)
  }
  const savePaste = async () => {
    setPasteBusy(true); setPasteMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/${s.id}/alldata`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: pasteUrl.trim() }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setAlldata({ links: d.links || [], match: d.match || 'exact' }); setPasteUrl(''); setPasteMsg('Saved — one tap for the next ' + [s.year, s.make, s.model].filter(Boolean).join(' ') + '.')
    } catch (e) { setPasteMsg(e.message || 'Could not save that link.') }
    finally { setPasteBusy(false) }
  }

  const p = s.payload || {}
  const list = useMemo(() => {
    const cals = Array.isArray(p.calibrations) ? p.calibrations : []
    return foldBsm(cals.length ? cals.map(toLine) : (s.sensors || []).map(x => ({ name: x.n, type: x.t, required: x.r, lines: x.l, trigger: x.g, why: '' })), { name: 'name', req: 'required', lines: 'lines', trig: 'trigger' })
  }, [s]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = editing ? draft : list
  const required = shown.filter(c => c.required)

  // 📋 Request Job (Mark 2026-09-30): a tech on the scrub taps one button and
  // the car lands in the board's Job Requested column with everything the
  // scrub knows — shop, car, VIN, RO, claim, insurer, every calibration line,
  // and the estimate link — so Kat only has to price and dispatch it. Same
  // POST the board's "+ Request Job" uses, so Kat's alert fires the same way.
  async function requestJob(kind = 'job') {
    if (reqBusy || s.jobId) return
    setReqBusy(kind); setReqMsg('')
    try { setS(await requestJobFor(s, user, kind)); setReqMsg(kind === 'quote' ? '✓ On the board in Quotes Requested — Kat has it.' : '✓ On the board in Job Requested — Kat has it.') }
    catch (e) { setReqMsg(e.message || 'Could not send the request.') }
    finally { setReqBusy('') }
  }

  const neverScrubbed = !list.length && ['report-only', 'from-card'].includes(s.status)
  const cardGone = neverScrubbed && s.stage === 'invoiced'
  const hasStoredReport = (s.reports || []).some(r => r.kind === 'absolute' && r.id)
  const vehicle = { year: s.year, make: s.make, model: s.model }

  const downloadPdf = async () => {
    setPdfBusy(true); setPdfErr('')
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/${s.id}/pdf`)
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`) }
      const blob = await r.blob(); const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `Absolute ADAS_${s.ro || [s.year, s.make, s.model].filter(Boolean).join(' ') || 'report'}.pdf`
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) { setPdfErr(e.message || 'Could not build the PDF.') }
    finally { setPdfBusy(false) }
  }

  // 📝 Build quote (Mark 2026-09-29: "I expected a screen to pop up so I can
  // build the estimate"). This opens the SAME estimate screen the jobs page
  // shows after a report upload — customer picker (auto-matched by shop name),
  // every calibration line with its toggle, then Build → the Send-Quote review.
  // We hand the scrub to App's own handleExtracted(jobData, pdfFile), exactly
  // as UploadScreen does, so nothing about that flow is duplicated here.
  // _requestId = the scrub's job card, so ToggleBoard PATCHes that card
  // instead of spawning a second one (one-card lifecycle).
  const openBuilder = async () => {
    if (!onExtracted) { setQMsg('The estimate screen is not available from here.'); return }
    if (!list.length) { setQMsg('Nothing to quote — this scrub has no calibration lines.'); return }
    setQBusy(true); setQMsg('')
    try {
      const jobData = {
        shop: s.shop || '', ro_number: s.ro || '', insurer: s.insurer || '', claim: s.claim || '',
        vin: s.vin || '', vehicle: [s.year, s.make, s.model].filter(Boolean).join(' '),
        year: s.year || '', make: s.make || '', model: s.model || '',
        calibrations: list.map(l => ({
          calibration_name: l.name, enabled: l.required === true, cal_type: l.type || '',
          trigger: l.trigger || '', line_references: l.lines || '', justification: l.why || '',
        })),
        document_links: Array.isArray(p.document_links) ? p.document_links : [],
        _requestId: s.jobId || null,
        _scrubId: s.id,
      }
      // The filed CCC estimate rides along as the PDF, same as an upload would,
      // so it attaches to the Books quote / WorkDrive folder. Missing file = no PDF.
      let file = null
      if (s.fileId) {
        try {
          const r = await apiFetch(`${API_BASE}/api/scrubs/${s.id}/estimate`)
          if (r.ok) {
            const blob = await r.blob()
            file = new File([blob], s.fileName || `CCC-${s.ro || 'estimate'}.pdf`, { type: 'application/pdf' })
          }
        } catch { /* fine — the builder works without the PDF */ }
      }
      onExtracted(jobData, file)
    } catch (e) { setQMsg(e.message || 'Could not open the estimate screen.') }
    finally { setQBusy(false) }
  }

  const loadFromCard = async () => {
    setCardBusy(true); setCardMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/${s.id}/from-card`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      if (d.scrub) setS(d.scrub)
      setCardMsg(`Loaded ${d.required} required of ${d.sensors} from the job card.`)
    } catch (e) { setCardMsg(e.message || 'Could not read the job card.') }
    finally { setCardBusy(false) }
  }

  // First tap fetches the estimate and shows a real link; second tap opens it.
  const fetchEstimate = async () => {
    setEstBusy(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/${s.id}/estimate`)
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`) }
      setEstUrl(URL.createObjectURL(await r.blob()))
    } catch (e) { setPdfErr(e.message || 'Could not open the estimate.') }
    finally { setEstBusy(false) }
  }

  // 🪄 The same writer the review screen uses, fed the estimator's reason.
  const rewrite = async (name, reason, lines) => {
    const r = await apiFetch(`${API_BASE}/api/extract/rewrite-justification`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calibration_name: name, ...vehicle, trigger: reason || 'added by the estimator', line_references: lines || '' }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || !d.justification) throw new Error(d.error || 'The rewrite failed.')
    return d.justification
  }

  const startEdit = () => { setDraft(list.map(l => ({ ...l }))); setSaveMsg(''); setEditing(true) }
  const cancelEdit = () => { setEditing(false); setDraft([]); setSaveMsg('') }
  const patchLine = (i, patch) => setDraft(d => d.map((l, j) => j === i ? { ...l, ...patch, edited: true } : l))
  const removeLine = i => setDraft(d => d.filter((_, j) => j !== i))
  const rewriteLine = async i => {
    setAiBusy(i)
    try { const why = await rewrite(draft[i].name, draft[i].trigger, draft[i].lines); patchLine(i, { why }) }
    catch (e) { setSaveMsg(e.message) }
    finally { setAiBusy(-1) }
  }
  const writeAdd = async () => {
    if (!add.name.trim()) return
    setAdd(a => ({ ...a, busy: true }))
    try { const why = await rewrite(add.name.trim(), add.reason, add.lines); setAdd(a => ({ ...a, why, busy: false })) }
    catch (e) { setSaveMsg(e.message); setAdd(a => ({ ...a, busy: false })) }
  }
  const commitAdd = () => {
    if (!add.name.trim()) return
    setDraft(d => [...d, { name: add.name.trim(), type: add.type, required: true, lines: add.lines.trim(), trigger: add.reason.trim(), why: add.why, added: true }])
    setAdd({ name: '', type: 'Static', lines: '', reason: '', why: '', busy: false })
  }
  const save = async () => {
    setSaving(true); setSaveMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/${s.id}/calibrations`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calibrations: draft.map(fromLine) }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      if (d.scrub) setS(d.scrub)
      setEditing(false); setDraft([])
      setSaveMsg(`Saved — ${d.required} required of ${d.sensors}. The PDF prints this list.`)
    } catch (e) { setSaveMsg(e.message || 'Save failed.') }
    finally { setSaving(false) }
  }

  const Fact = ({ k, v }) => (
    <div className="text-sm leading-relaxed">
      <span className="font-bold" style={{ color: INK }}>{k}: </span>
      <span style={{ color: '#444' }}>{v || 'None'}</span>
    </div>
  )
  const input = { border: '1.5px solid #ddd', borderRadius: 6, padding: '4px 6px', fontSize: 12, width: '100%' }

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <button onClick={onBack} className="mb-3 rounded-xl px-4 py-3 text-base font-bold inline-flex items-center gap-2"
        style={{ backgroundColor: '#fff', color: INK, border: '1.5px solid #ddd', minHeight: 48 }}>← Scrubs</button>
      <div className="flex flex-col lg:flex-row gap-5">

        {/* Left rail */}
        <div className="lg:w-72 shrink-0">
          <h1 className="text-2xl font-bold leading-tight" style={{ color: INK }}>{s.vehicle || 'Vehicle not read'}</h1>
          {s.ro && <p className="text-sm font-mono font-bold mt-1" style={{ color: ORANGE }}>RO {s.ro}</p>}
          <p className="text-sm mt-3" style={{ color: '#444' }}><span className="font-bold">VIN:</span> <CopyVin vin={s.vin} className="font-mono" /></p>
          <p className="text-sm mt-1" style={{ color: '#444' }}><span className="font-bold">Updated:</span> {when(s.at) || '—'}</p>
          <p className="text-sm mt-1" style={{ color: '#444' }}><span className="font-bold">By:</span> {s.by || sourceLabel(s.source)}</p>
          <p className="text-sm mt-1 flex items-center gap-2" style={{ color: '#444' }}><span className="font-bold">Stage:</span> <StagePill s={s} /></p>
          {s.quoteNumber && s.quoteNumber !== s.invoiceNumber && <p className="text-sm mt-1" style={{ color: '#444' }}><span className="font-bold">Quote:</span> {s.quoteNumber}</p>}
          {s.status === 'edited' && <p className="text-xs mt-1" style={{ color: '#b45309' }}>✏️ Lines edited by hand{p._edited_by ? ` · ${p._edited_by}` : ''}</p>}

          <button onClick={downloadPdf} disabled={pdfBusy || editing || (!shown.length && !hasStoredReport)}
            className="mt-4 w-full rounded-lg px-3 py-3 text-sm font-bold"
            style={{ backgroundColor: pdfBusy ? '#f5f3f0' : ORANGE, color: pdfBusy ? '#777' : '#fff', opacity: (shown.length || hasStoredReport) && !editing ? 1 : 0.5 }}
          >{pdfBusy ? 'Building…' : (!list.length && hasStoredReport) ? '📄 Report that went out ↓' : '📄 Absolute ADAS report ↓'}</button>

          {/* 📝 Quote: build the Books estimate, then hand off to the SAME blue
              Send-Quote button the jobs page uses (line review → /shop-quotes/send
              with the Quote PDF). A previously-quoted scrub goes straight to send. */}
          {(() => {
            if (s.invoiceNumber) return null
            const qid = quoteId || s.quoteId || ''
            if (qid) return (
              <div className="mt-2 flex flex-col gap-1.5">
                {s.quoteNumber && <div className="text-xs font-semibold text-center" style={{ color: '#1e40af' }}>📝 Quote {s.quoteNumber} is built — review the lines and send:</div>}
                <SendQuoteButton
                  result={{ quoteId: qid, quoteNumber: s.quoteNumber || '' }}
                  job={{ shop: s.shop || '', year: s.year || '', make: s.make || '', model: s.model || '', vin: s.vin || '', ro_number: s.ro || '', claim: s.claim || '', insurer: s.insurer || '' }}
                  lineCount={required.length}
                  selectedCustomer={{ name: s.shop || '' }}
                  onNavigate={onNavigate} />
              </div>
            )
            return (
              <button onClick={openBuilder} disabled={qBusy || editing || !list.length || !onExtracted}
                className="mt-2 w-full rounded-lg px-3 py-3 text-sm font-bold"
                style={{ backgroundColor: qBusy ? '#f5f3f0' : '#1e40af', color: qBusy ? '#777' : '#fff', opacity: list.length && !editing && onExtracted ? 1 : 0.5 }}
                title="Opens the estimate screen pre-filled from this scrub — pick the customer, check the lines, build, then send"
              >{qBusy ? 'Opening the estimate…' : `📝 Build quote${required.length ? ` (${required.length} required)` : ''}`}</button>
            )
          })()}
          {qMsg && <p className="text-xs mt-2" style={{ color: qMsg.startsWith('✓') ? '#1e40af' : '#b91c1c' }}>{qMsg}</p>}

          {/* 📝 Quote / 📋 Job request — techs hand the car to Kat with the scrub attached */}
          {!s.jobId && !['invoiced', 'paid'].includes(s.stage)
            ? <div className="mt-2 hidden md:flex gap-2">
                {['quote', 'job'].map(k => (
                  <button key={k} onClick={() => requestJob(k)} disabled={!!reqBusy || editing}
                    className="flex-1 rounded-lg px-3 py-3 text-sm font-bold text-white"
                    style={{ backgroundColor: REQ_STYLE[k].bg, opacity: reqBusy && reqBusy !== k ? .45 : reqBusy ? .7 : 1 }}
                    title={k === 'quote' ? 'Quotes Requested column — Kat drafts the estimate' : 'Job Requested column — Kat prices and dispatches it'}
                  >{reqBusy === k ? 'Requesting…' : `${REQ_STYLE[k].label} request`}</button>
                ))}
              </div>
            : ['requested', 'quote_requested'].includes(s.stage) && <button onClick={() => onNavigate && onNavigate('kanban')} className="mt-2 w-full rounded-lg px-3 py-3 text-sm font-bold" style={s.stage === 'quote_requested' ? { backgroundColor: '#dbeafe', color: '#1d4ed8', border: '1.5px solid #93c5fd' } : { backgroundColor: '#ffedd5', color: '#c2410c', border: '1.5px solid #fdba74' }}>{s.stage === 'quote_requested' ? '📝 Quote requested' : '📋 Job requested'} — open the board →</button>}
          {reqMsg && <p className="text-xs mt-1" style={{ color: reqMsg.startsWith('✓') ? '#166534' : '#b91c1c' }}>{reqMsg}</p>}
          {/* 📱 Phone: Quote | Job pinned to the bottom of the screen, 50/50 */}
          {!s.jobId && !['invoiced', 'paid'].includes(s.stage) && (
            <div className="md:hidden fixed left-0 right-0 bottom-0 z-40 flex gap-2 p-2" style={{ backgroundColor: 'rgba(255,255,255,.96)', borderTop: '1px solid #eee', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}>
              {['quote', 'job'].map(k => (
                <button key={k} onClick={() => requestJob(k)} disabled={!!reqBusy || editing}
                  className="flex-1 rounded-xl py-3.5 text-base font-bold text-white"
                  style={{ backgroundColor: REQ_STYLE[k].bg, opacity: reqBusy && reqBusy !== k ? .45 : reqBusy ? .7 : 1 }}
                >{reqBusy === k ? 'Requesting…' : `${REQ_STYLE[k].label} request`}</button>
              ))}
            </div>
          )}
          {!s.jobId && !['invoiced', 'paid'].includes(s.stage) && <div className="md:hidden" style={{ height: 72 }} />}

          {/* 🧾 Create Job (Mark 2026-09-30): the retired "Create invoice" shortcut
              skipped Bill it and made a single, wrong invoice. This opens the SAME
              review screen an upload opens; its Create job builds the Books estimate
              and puts the card on the board, and Bill it (both invoices) runs from
              Ready to Invoice exactly like every other job. */}
          {s.jobId && s.stage === 'job'
            ? <button onClick={() => onNavigate && onNavigate('kanban')} className="mt-2 w-full rounded-lg px-3 py-3 text-sm font-bold" style={{ backgroundColor: '#fff7ed', color: '#b45309', border: '1.5px solid #fcd34d' }}>🧾 Job created{s.quoteNumber ? ` · ${s.quoteNumber}` : ''} — open the board →</button>
            : <button onClick={openBuilder} disabled={qBusy || editing || !list.length || !onExtracted}
                className="mt-2 w-full rounded-lg px-3 py-3 text-sm font-bold"
                style={{ backgroundColor: qBusy ? '#f5f3f0' : ORANGE, color: qBusy ? '#777' : '#fff', opacity: list.length && !editing && onExtracted ? 1 : 0.5 }}
                title="Opens the same review screen as an uploaded report: pick the customer, check the lines, Create job → the card goes on the board"
              >{qBusy ? 'Opening…' : `🧾 Create Job${required.length ? ` (${required.length} required)` : ''}`}</button>}

          {!editing
            ? <button onClick={startEdit} className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#fff', color: INK, border: '1.5px solid #ddd' }}>✏️ Edit calibration lines</button>
            : <div className="mt-2 grid grid-cols-2 gap-2">
                <button onClick={save} disabled={saving} className="rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#166534', color: '#fff' }}>{saving ? 'Saving…' : '✓ Save'}</button>
                <button onClick={cancelEdit} disabled={saving} className="rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#fff', color: '#777', border: '1.5px solid #ddd' }}>Cancel</button>
              </div>}

          {s.fileId && (estUrl
            ? <a href={estUrl} target="_blank" rel="noreferrer" className="mt-2 block text-center w-full rounded-lg px-3 py-3 text-sm font-bold" style={{ backgroundColor: '#eff6ff', color: '#1e40af', border: '1.5px solid #93c5fd' }}>📎 Open the CCC estimate (tap again)</a>
            : <button onClick={fetchEstimate} disabled={estBusy} className="mt-2 w-full rounded-lg px-3 py-3 text-sm font-bold" style={{ backgroundColor: '#fff', color: '#1e40af', border: '1.5px solid #93c5fd' }}>{estBusy ? 'Fetching…' : '📎 Open the CCC estimate'}</button>)}
          {!s.fileId && <p className="text-xs mt-2" style={{ color: '#999' }}>No estimate file is stored for this scrub yet.</p>}

          {!list.length && s.jobId && !cardGone && !editing && (
            <button onClick={loadFromCard} disabled={cardBusy} className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#fff', color: ORANGE, border: `1.5px solid ${ORANGE}` }}>
              {cardBusy ? 'Reading the card…' : '🔄 Load calibrations from the job card'}
            </button>
          )}
          {cardMsg && <p className="text-xs mt-2" style={{ color: cardMsg.startsWith('Loaded') ? '#166534' : '#b91c1c' }}>{cardMsg}</p>}
          {saveMsg && <p className="text-xs mt-2" style={{ color: saveMsg.startsWith('Saved') ? '#166534' : '#b91c1c' }}>{saveMsg}</p>}

          <button onClick={onBack} className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#fff', color: INK, border: '1.5px solid #ddd' }}>← All scrubs</button>
          {pdfErr && <p className="text-xs mt-2" style={{ color: '#b91c1c' }}>{pdfErr}</p>}
          {s._error && <p className="text-xs mt-2" style={{ color: '#b91c1c' }}>{s._error}</p>}
        </div>

        {/* The report */}
        <div className="flex-1 min-w-0 rounded-2xl overflow-hidden" style={{ border: `1.5px solid ${editing ? ORANGE : '#e5e5e5'}`, backgroundColor: '#fff' }}>
          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-2" style={{ backgroundColor: ORANGE }}>
            <div>
              <div className="text-xl font-bold" style={{ color: '#fff' }}>Absolute ADAS</div>
              <div className="text-xs" style={{ color: 'rgba(255,255,255,0.85)' }}>ADAS Calibration &amp; Diagnostic Report</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold" style={{ color: '#fff' }}>{editing ? '✏️ Editing calibration lines' : 'Calibration Identification Report'}</div>
              <div className="text-xs" style={{ color: 'rgba(255,255,255,0.85)' }}>{when(s.at)}</div>
            </div>
          </div>

          <div className="p-5">
            <div className="grid sm:grid-cols-2 gap-5 mb-5">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider pb-1 mb-1.5" style={{ color: ORANGE, borderBottom: `2px solid ${ORANGE}` }}>Repair</div>
                <Fact k="Customer" v={s.shop} />
                <Fact k="Claim" v={s.claim} />
                <Fact k="Insurer" v={s.insurer} />
                <Fact k="Repair Order" v={s.ro} />
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider pb-1 mb-1.5" style={{ color: ORANGE, borderBottom: `2px solid ${ORANGE}` }}>Vehicle</div>
                <Fact k="Vehicle" v={s.vehicle} />
                <Fact k="Trim" v={p.trim || p.model || s.model} />
                <div className="text-sm leading-relaxed"><span className="font-bold" style={{ color: INK }}>VIN: </span><CopyVin vin={s.vin} style={{ color: '#444' }} /></div>
                <Fact k="Point of impact" v={p.point_of_impact} />
              </div>
            </div>

            <h3 className="text-lg font-bold mb-2" style={{ color: INK }}>Summary</h3>
            <div className="grid sm:grid-cols-2 gap-3 mb-5">
              <div className="rounded-lg px-3 py-2.5 flex items-center justify-between" style={{ backgroundColor: '#fff7ed', borderLeft: `4px solid ${ORANGE}` }}>
                <span className="text-sm font-bold" style={{ color: INK }}>Required Operations</span>
                <span className="text-xl font-bold" style={{ color: ORANGE }}>{required.length}</span>
              </div>
              <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: '#f5f3f0' }}>
                <div className="text-xs font-bold mb-0.5" style={{ color: '#555' }}>Sensors checked</div>
                <div className="text-sm" style={{ color: '#444' }}>{neverScrubbed ? 'Not scrubbed' : `${shown.length} on this vehicle`}{p.estimate_version ? ` · ${p.estimate_version}` : ''}{s.status === 'from-card' ? ' · from the job card' : ''}</div>
              </div>
            </div>

            {(p._guard?.flipped?.length || p._guard?.added?.length) ? (
              <div className="rounded-lg px-3 py-2.5 mb-5 text-xs" style={{ backgroundColor: '#ecfdf5', color: '#065f46' }}>
                <div className="font-bold mb-0.5">🛡️ Hard rules enforced on this scrub</div>
                {[...(p._guard.flipped || []), ...(p._guard.added || [])].map((g, i) => <div key={i}>• {g}</div>)}
              </div>
            ) : null}
            {/* 📚 ADAS Systems, Locations, and Calibrations — ALLDATA quick reference (Mark 2026-09-29) */}
            {!editing && (
              <div className="rounded-lg px-3 py-3 mb-5" style={{ backgroundColor: '#f5f3f0', border: '1.5px solid #e5e5e5' }}>
                <div className="text-sm font-bold mb-1" style={{ color: INK }}>ADAS Systems, Locations, and Calibrations</div>
                <div className="text-xs mb-2" style={{ color: '#666' }}>ALLDATA's quick reference for this vehicle: every ADAS component, where it sits, and the calibration it needs.</div>
                {alldata.match === 'loading' ? <div className="text-xs" style={{ color: '#999' }}>Looking up this car…</div> : quickRef ? (
                  <>
                    <a href={quickRef.url} target="_blank" rel="noreferrer" className="block text-center w-full rounded-xl px-4 py-3 text-base font-bold" style={{ backgroundColor: ORANGE, color: '#fff', minHeight: 48 }}>📚 Open in ALLDATA</a>
                    <div className="text-[11px] mt-1.5" style={{ color: '#777' }}>{alldata.match === 'exact' ? `Saved page for this ${[s.year, s.make, s.model].filter(Boolean).join(' ')}` : `Closest saved page: ${quickRef.for || 'same year and make'} — check the vehicle in ALLDATA's header`}{alldata.links.length > 1 ? ` · ${alldata.links.length - 1} more ALLDATA page${alldata.links.length > 2 ? 's' : ''} for this car below` : ''}</div>
                    {alldata.links.length > 1 && <div className="mt-1 flex flex-wrap gap-1.5">{alldata.links.slice(1, 6).map((l, i) => <a key={i} href={l.url} target="_blank" rel="noreferrer" className="text-[11px] font-bold px-2 py-1 rounded" style={{ backgroundColor: '#fff', color: '#1e40af', border: '1px solid #93c5fd' }}>{l.label.slice(0, 40)}</a>)}</div>}
                  </>
                ) : (
                  <>
                    <a href={ALLDATA_HOME} target="_blank" rel="noreferrer" onClick={openAlldataWithVin} className="block text-center w-full rounded-xl px-4 py-3 text-base font-bold" style={{ backgroundColor: ORANGE, color: '#fff', minHeight: 48 }}>📚 Copy VIN + open ALLDATA</a>
                    <div className="text-[11px] mt-1.5" style={{ color: vinCopied ? '#166534' : '#777' }}>{vinCopied ? `VIN ${s.vin} copied — paste it into ALLDATA's vehicle box, then open ADAS Quick Reference.` : `No saved ALLDATA page for this ${[s.year, s.make, s.model].filter(Boolean).join(' ')} yet. The button copies the VIN; paste it into ALLDATA's vehicle box.`}</div>
                  </>
                )}
                <div className="mt-3 flex gap-2">
                  <input value={pasteUrl} onChange={e => setPasteUrl(e.target.value)} placeholder="Paste this car's ALLDATA page link here to save it for next time" className="flex-1 min-w-0 rounded-lg px-3 py-2.5 text-xs" style={{ border: '1.5px solid #ddd' }} />
                  <button onClick={savePaste} disabled={pasteBusy || !pasteUrl.trim()} className="rounded-lg px-3 py-2.5 text-xs font-bold whitespace-nowrap" style={{ backgroundColor: '#fff', color: ORANGE, border: `1.5px solid ${ORANGE}` }}>{pasteBusy ? 'Saving…' : 'Save link'}</button>
                </div>
                {pasteMsg && <div className="text-[11px] mt-1" style={{ color: pasteMsg.startsWith('Saved') ? '#166534' : '#b91c1c' }}>{pasteMsg}</div>}
              </div>
            )}
            {s.oemRefs && !editing && (
              <div className="rounded-lg px-3 py-2.5 mb-5 text-xs" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
                <div className="font-bold mb-1" style={{ color: INK }}>References</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{String(s.oemRefs).slice(0, 1200)}</div>
              </div>
            )}
            {Array.isArray(s.reports) && s.reports.length > 0 && !editing && (
              <div className="rounded-lg px-3 py-2.5 mb-5 text-xs" style={{ backgroundColor: '#eff6ff', color: '#1e40af' }}>📎 Went out with the invoice: {s.reports.map(r => r.name).join(', ')}</div>
            )}

            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold" style={{ color: INK }}>Operations</h3>
              <div className="text-xs flex gap-3" style={{ color: '#777' }}>
                <span><span style={{ color: ORANGE }}>●</span> Required</span>
                <span><span style={{ color: '#bbb' }}>●</span> Not required</span>
                {editing && <span style={{ color: '#b45309' }}>tap ● to flip · tap a name to open it</span>}
              </div>
            </div>

            {!shown.length && !editing && (
              <p className="text-sm" style={{ color: '#777' }}>
                {cardGone
                  ? 'This car was billed before the library learned to read the job card, and the card was removed after billing, as designed. The sensor list cannot be rebuilt here, but the report that went out with the invoice is on the button to the left. You can also add lines by hand with ✏️ Edit.'
                  : neverScrubbed
                    ? 'This car was billed with its reports attached, but no scrub was ever run on it. The calibrations live on the job card — load them with the button on the left, or press Scrub estimate on the card to run a real scrub.'
                    : 'No sensors recorded on this scrub. Add them by hand with ✏️ Edit calibration lines.'}
              </p>
            )}

            {(!!shown.length || editing) && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: ORANGE }}>
                      <th className="text-left font-bold py-2 px-3" style={{ color: '#fff' }}>Sensor</th>
                      <th className="text-left font-bold py-2 px-3" style={{ color: '#fff' }}>Repair triggers</th>
                      <th className="text-left font-bold py-2 px-3" style={{ color: '#fff' }}>Lines</th>
                      <th className="text-left font-bold py-2 px-3" style={{ color: '#fff' }}>Type</th>
                      {editing && <th style={{ width: 36 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c, i) => (
                      <LineRow key={i} c={c} i={i} editing={editing} expanded={!!expanded[i] || (editing && !!c.added)}
                        onToggle={() => setExpanded(e => ({ ...e, [i]: !e[i] }))}
                        onFlip={() => patchLine(i, { required: !c.required })}
                        onPatch={patch => patchLine(i, patch)}
                        onRewrite={() => rewriteLine(i)} aiBusy={aiBusy === i}
                        onRemove={() => removeLine(i)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {editing && (
              <div className="rounded-lg p-3 mt-4" style={{ backgroundColor: '#fff5f0', border: `1.5px solid ${ORANGE}` }}>
                <div className="text-sm font-bold mb-2" style={{ color: INK }}>➕ Add a calibration the scrubber missed</div>
                <div className="grid sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-bold" style={{ color: '#555' }}>Sensor</label>
                    <input list="aa-sensors" value={add.name} onChange={e => setAdd(a => ({ ...a, name: e.target.value }))} placeholder="Front Radar" style={input} />
                    <datalist id="aa-sensors">{SENSOR_NAMES.map(n => <option key={n} value={n} />)}</datalist>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold" style={{ color: '#555' }}>Type</label>
                    <select value={add.type} onChange={e => setAdd(a => ({ ...a, type: e.target.value }))} style={input}>{CAL_TYPES.map(t => <option key={t}>{t}</option>)}</select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold" style={{ color: '#555' }}>Estimate line numbers</label>
                    <input value={add.lines} onChange={e => setAdd(a => ({ ...a, lines: e.target.value }))} placeholder="12, 14-16" style={input} />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold" style={{ color: '#555' }}>Why (the repair that disturbs it)</label>
                    <input value={add.reason} onChange={e => setAdd(a => ({ ...a, reason: e.target.value }))} placeholder="Front bumper cover R&I, radar bracket disturbed" style={input} />
                  </div>
                </div>
                <div className="mt-2">
                  <label className="text-[11px] font-bold" style={{ color: '#555' }}>Justification (🪄 writes it in the house format from your reason)</label>
                  <textarea value={add.why} onChange={e => setAdd(a => ({ ...a, why: e.target.value }))} rows={3} style={{ ...input, fontFamily: 'inherit' }} />
                </div>
                <div className="flex gap-2 mt-2">
                  <button onClick={writeAdd} disabled={add.busy || !add.name.trim()} className="rounded-lg px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: '#eff6ff', color: '#1e40af', border: '1.5px solid #93c5fd' }}>{add.busy ? 'Writing…' : '🪄 Write the justification'}</button>
                  <button onClick={commitAdd} disabled={!add.name.trim()} className="rounded-lg px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: ORANGE, color: '#fff' }}>➕ Add as required</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function LineRow({ c, i, editing, expanded, onToggle, onFlip, onPatch, onRewrite, aiBusy, onRemove }) {
  const dim = !c.required
  const cell = { border: '1.5px solid #ddd', borderRadius: 6, padding: '3px 6px', fontSize: 12, width: '100%' }
  return (
    <>
      <tr style={{ backgroundColor: i % 2 ? '#fafafa' : '#fff', borderBottom: '1px solid #f0f0f0' }}>
        <td className="py-2.5 px-3 font-bold" style={{ color: dim ? '#999' : INK }}>
          <span onClick={editing ? onFlip : undefined} style={{ color: c.required ? ORANGE : '#ccc', marginRight: 6, cursor: editing ? 'pointer' : 'default', fontSize: 16 }} title={editing ? 'Flip required / not required' : ''}>●</span>
          <span onClick={onToggle} style={{ cursor: 'pointer' }}>
            {(c.why || editing) ? <span style={{ color: '#bbb', marginRight: 4 }}>{expanded ? '⌄' : '›'}</span> : null}
            {c.name}
          </span>
          {c.added && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#fff7ed', color: '#b45309' }}>added{c.by ? ` · ${c.by}` : ''}</span>}
          {!c.added && c.edited && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f5f3f0', color: '#777' }}>edited</span>}
          {c.guard && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#ecfdf5', color: '#065f46' }} title="Enforced by the guard: a hard rule in code, not the model's judgment">🛡️ rule</span>}
        </td>
        <td className="py-2.5 px-3" style={{ color: dim ? '#aaa' : '#444' }}>
          {editing ? <input value={c.trigger} onChange={e => onPatch({ trigger: e.target.value })} placeholder="repair that disturbs it" style={cell} /> : (c.trigger || '—')}
        </td>
        <td className="py-2.5 px-3 font-mono text-xs" style={{ color: dim ? '#aaa' : '#444' }}>
          {editing ? <input value={c.lines} onChange={e => onPatch({ lines: e.target.value })} placeholder="3-4, 13" style={{ ...cell, width: 90 }} /> : (c.lines || '—')}
        </td>
        <td className="py-2.5 px-3">
          {editing
            ? <select value={c.type || ''} onChange={e => onPatch({ type: e.target.value })} style={{ ...cell, width: 130 }}><option value="">—</option>{CAL_TYPES.map(t => <option key={t}>{t}</option>)}</select>
            : c.required
              ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: ORANGE, color: '#fff' }}>{c.type || 'Required'}</span>
              : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#eee', color: '#888' }}>not required</span>}
        </td>
        {editing && <td className="py-2.5 px-2 text-right"><button onClick={onRemove} title="Remove this line" style={{ color: '#b91c1c', fontWeight: 700 }}>✕</button></td>}
      </tr>
      {expanded && (c.why || editing) && (
        <tr style={{ backgroundColor: '#fff7ed' }}>
          <td colSpan={editing ? 5 : 4} className="px-3 py-2.5 text-xs" style={{ color: '#444', borderBottom: '1px solid #f0f0f0' }}>
            {editing
              ? <div>
                  <textarea value={c.why} onChange={e => onPatch({ why: e.target.value })} rows={3} style={{ ...cell, fontFamily: 'inherit' }} placeholder="Why this calibration is required — or press 🪄 and it is written from the trigger and lines above" />
                  <button onClick={onRewrite} disabled={aiBusy} className="mt-1 rounded-lg px-2.5 py-1 text-[11px] font-bold" style={{ backgroundColor: '#eff6ff', color: '#1e40af', border: '1.5px solid #93c5fd' }}>{aiBusy ? 'Writing…' : '🪄 AI rewrite from the reason'}</button>
                </div>
              : c.why}
          </td>
        </tr>
      )}
    </>
  )
}
