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
import { ScanLogo } from '../components/LoadingSplash'
// The SAME blue "Send Quote to Shop" button the jobs page uses — line review, then
// /shop-quotes/send attaches the Quote PDF. Reused, not copied (Mark 2026-09-29).
import { SendQuoteButton } from '../components/ToggleBoard'
import { ShopBig4Bar } from '../components/books/Big3Rules.jsx'
import { BRAND } from '../lib/brandTokens.js'
import PhotoScrub from '../components/PhotoScrub.jsx'
import { shopCoreKey, shopKey as shopKeyRaw } from '../lib/shopResolve.js'
import { FS_ITEMS, fsItemFor, nissanBatteryLine, fsIsOff, dropFsLines } from '../lib/operationsRows.js'

const ORANGE = BRAND.orange
const INK = BRAND.ink
const QUOTE = BRAND.quote

const SOURCE_LABEL = {
  photos: '📸 Photos',
  button: '🔬 Scrub button', upload: '📄 Upload', email: '📧 Email', equote: '📧 Email',
  requeue: '🔄 Re-scrub', 'report-only': '📎 Reports only',
}
const sourceLabel = s => SOURCE_LABEL[s] || (String(s || '').startsWith('mail:') ? `📥 ${String(s).slice(5)}` : s || '—')
const statusNote = s => s.status === 'from-card' ? 'from card' : s.status === 'report-only' ? 'not scrubbed' : ''

// Where this car is on the money path. Grey until it turns into paperwork.
const STAGE = {
  scrubbed: { label: 'scrubbed', bg: '#f5f3f0', fg: '#777' },
  quoted:   { label: 'quoted',   bg: BRAND.quoteSoft, fg: BRAND.quoteHover },
  quote_requested: { label: 'quote requested', bg: '#dbeafe', fg: QUOTE },
  requested: { label: 'job requested', bg: '#ffedd5', fg: '#c2410c' },
  job:      { label: 'active job', bg: BRAND.orangeSoft, fg: ORANGE },   // 🟠 the card is past Requested — brand orange, same signal as the row outline
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
export function normScrub(s) {
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
// 🧰 Full Service (Mark 2026-10-01): headlamp aim, TPMS, programming, resets.
// The scrub always finds them; each shop's CRM rule decides what we do:
// we = on the quote · shop = shop handles it, never quoted · ask = an offer.
const FS_MODE = { we: { label: 'We do it', bg: '#CD4419' }, shop: { label: 'Shop does it', bg: '#78716c' }, ask: { label: 'Ask', bg: '#16a34a' } }
const _fsCache = new Map()
async function fsRulesFor(shop, fresh = false) {
  const k = String(shop || '').trim().toLowerCase(); if (!k) return { rules: {}, set: {} }
  if (!fresh && _fsCache.has(k)) return _fsCache.get(k)
  try { const r = await apiFetch(`${API_BASE}/api/shops/full-service-by-name?shop=${encodeURIComponent(shop)}`); const d = await r.json(); const v = { rules: d.rules || {}, set: d.set || {}, inCrm: !!d.shop_id, on: !!d.on, collision: d.collision !== false, ctype: d.customer_type || '' }; _fsCache.set(k, v); return v }
  catch { return { rules: {}, set: {} } }
}
// Any value the server (or a hand-edited CRM rule) sends is folded into we | shop | ask —
// an unknown mode crashed the whole scrub screen on 2026-10-07 ("reading 'bg'").
const fsMode = (rules, key) => {
  const v = rules?.[key]
  if (v === 'ask') return 'ask'
  if (v === 'off') return 'off'   // Full Service OFF for this shop (the server's default) → the line is not ours at all
  if (v === 'we' || v === 'bill' || v === 'on' || v === 'charge' || v === true || v === 'true' || v === 'included') return 'we'
  return 'shop'   // no answer / false / anything else = the shop's own work (never billed by surprise)
}
// 🧰 Full Service is OFF by default (Mark 2026-10-09: "default off, if it is on for this
// account then add it in"). OFF on a collision shop = the FS lines are not on the report,
// the counts, the quote or the job request. ON shops (or a per-report ON override) keep them.
// List-row required count / pills: drop Full Service lines when the shop is OFF
// so the orange badge matches what the report will show.
function requiredOf(s, fsr) {
  const vehicle = `${s.make || ''} ${s.vehicle || ''}`
  const sensors = s.sensors || []
  if (!sensors.length) {
    const names = String(s.requiredNames || '').split(/\s*[,|;]\s*/).filter(Boolean)
    const kept = dropFsLines(names.map(n => ({ name: n })), fsr, vehicle).map(x => x.name)
    return { count: kept.length || (fsIsOff(fsr) ? 0 : s.requiredCount), names: kept }
  }
  const names = dropFsLines(sensors.filter(x => x.r).map(x => ({ name: x.n })), fsr, vehicle).map(x => x.name)
  return { count: names.length, names }
}
/** Per-report override (Mark 2026-10-07): 'on' | 'off' | '' bends the CRM rules for THIS scrub only. */
function withOverride(fsr, override) {
  if (!fsr || !override || fsr.collision === false) return fsr
  const keys = FS_ITEMS.map(f => f.key)
  if (override === 'off') return { ...fsr, on: false, override, rules: Object.fromEntries(keys.map(k => [k, 'off'])) }
  return { ...fsr, on: true, override, rules: Object.fromEntries(keys.map(k => [k, fsr.set?.[k] || 'we'])) }
}
/** Apply the shop's Full Service rules to outgoing calibration rows (quote / job request). */
function applyFs(cals, rules, collision = true) {
  const offers = [], shopDoes = [], weDo = []
  for (const c of cals) {
    const f = fsItemFor(c.calibration_name)
    // Optional items (not OEM-required) only exist for Full Service shops that do or offer them.
    if (f?.optional && (!collision || fsMode(rules, f.key) === 'shop')) { c._drop = true; continue }
    if (!collision || !f) continue   // repair shop / dealer / retail: plain lines, no Full Service
    const m = fsMode(rules, f.key)
    if (m === 'off') { c._drop = true; continue }   // Full Service OFF for this shop → not on the quote at all (required or not)
    if (!c.enabled && !f.optional) continue
    if (f.optional && m === 'we') c.enabled = true
    if (m === 'we') weDo.push(`${f.emoji} ${c.calibration_name}`)
    else { c.enabled = false; (m === 'shop' ? shopDoes : offers).push(`${f.emoji} ${c.calibration_name}`); c.justification = `${m === 'shop' ? 'Required · shop handles this (Full Service rule).' : '💰 Offer: required, and we can do it for the shop.'} ${c.justification || ''}`.trim() }
  }
  for (let i = cals.length - 1; i >= 0; i--) if (cals[i]._drop) cals.splice(i, 1)
  if (!collision) return []
  return [weDo.length ? `🧰 Full Service (we do it): ${weDo.join(', ')}` : '', offers.length ? `💰 Offer the shop: ${offers.join(', ')}` : '', shopDoes.length ? `🏪 Shop handles: ${shopDoes.join(', ')}` : ''].filter(Boolean)
}

export async function requestJobFor(scrub, user, kind = 'job') {
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
  const fsr = withOverride(await fsRulesFor(full.shop), full.payload?.fs_override || '')
  const fsNotes = applyFs(cals, fsr.rules, fsr.collision !== false)
  const req = cals.filter(c => c.enabled).map(c => c.calibration_name)
  const notes = [
    `${quote ? '📝 Quote requested' : '📋 Job requested'} from the scrub${full.ro ? ` · RO ${full.ro}` : ''}${full.claim ? ` · claim ${full.claim}` : ''}${full.insurer ? ` · ${full.insurer}` : ''}`,
    req.length ? `Required: ${req.join(', ')}` : 'Scrub found nothing required — check before dispatch',
    ...fsNotes,
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
    scrub_id: full.id || '', scrub_source: full.source || full.by_source || '',   // server DMs Kat the full picture
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

// Same-size action chips: ink = scan, blue = quote, orange = job.
// One height, one radius, one type size — they sit as a single row, no wrap.
function ActionBtn({ children, onClick, title, bg, fg = '#fff', border, busy, dim, full, grow }) {
  return (
    <span role="button" tabIndex={0} onClick={onClick} title={title}
      className={`inline-flex items-center justify-center font-extrabold rounded-md whitespace-nowrap cursor-pointer select-none ${grow ? 'w-full' : ''}`}
      style={{
        height: full ? 40 : 28,
        padding: '0 10px',
        fontSize: full ? 13 : 11,
        letterSpacing: '-0.01em',
        lineHeight: 1,
        backgroundColor: bg,
        color: fg,
        border: border || '1px solid transparent',
        opacity: busy ? 0.7 : dim ? 0.4 : 1,
        boxSizing: 'border-box',
      }}>{children}</span>
  )
}

const REQ_STYLE = { quote: { bg: QUOTE, label: 'Quote' }, job: { bg: ORANGE, label: 'Create Job' } }
// Pre-scan stays ink on purpose (Mark 2026-10-09: "the prescan black looks sick").
function RowPreScan({ s, onDone, full = false }) {
  const [prev, setPrev] = useState(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  if (scansOf(s).pre.done_at) return null
  const open = async e => {
    e.stopPropagation(); e.preventDefault(); if (busy) return
    setBusy('preview'); setMsg('')
    try { const r = await apiFetch(`${API_BASE}/api/scrubs/${s.id}/scan/preview`); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); setPrev(d) }
    catch (x) { setMsg(x.message || 'failed') } finally { setBusy('') }
  }
  const send = async e => {
    e.stopPropagation(); e.preventDefault(); if (busy) return
    setBusy('send'); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/${s.id}/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ which: 'pre', done: true }) })
      const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setPrev(null); if (d.scrub) onDone(d.scrub)
    } catch (x) { setMsg(x.message || 'failed') } finally { setBusy('') }
  }
  const cancel = e => { e.stopPropagation(); e.preventDefault(); setPrev(null) }
  return (
    <span className={`relative inline-flex ${full ? 'flex-1 min-w-0' : ''}`} onClick={e => e.stopPropagation()}>
      <ActionBtn full={full} grow={full} bg={INK} busy={!!busy} onClick={open}
        title="Pre-scan done — bills the one-line pre-scan per the shop's rule and emails both documents">
        {busy === 'preview' ? '…' : 'Pre-scan'}
      </ActionBtn>
      {prev && (
        <span className="absolute z-30 mt-1 rounded-lg p-2 text-[11px] font-sans"
          style={{ backgroundColor: BRAND.cream, border: `1px solid ${BRAND.line}`, color: INK, minWidth: 260, maxWidth: 360, whiteSpace: 'normal', top: '100%', right: full ? 'auto' : 0, left: full ? 0 : 'auto' }}>
          <b>{prev.mode === 'charge' ? 'Bill the pre-scan?' : prev.mode === 'included' ? 'No charge — just mark done' : 'Shop handles its own — just mark done'}</b>
          {prev.mode === 'charge' && <div className="mt-0.5">{prev.billing_mode === 'dual' ? `Estimate ${prev.item?.name || ''} $${Number(prev.list || 0).toFixed(2)} + cost invoice $${Number(prev.cost || 0).toFixed(2)} (${prev.discount_pct}% off)` : `Invoice ${prev.item?.name || ''} $${Number(prev.cost || 0).toFixed(2)}`} → {prev.emails?.join(', ') || 'no email'}</div>}
          {prev.warnings?.length > 0 && <div className="mt-0.5" style={{ color: '#b45309' }}>{prev.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}
          <span className="flex gap-1 mt-1.5">
            <button disabled={!!busy || (prev.mode === 'charge' && !prev.can_bill)} onClick={send} className="flex-1 rounded px-2 py-1.5 font-bold text-white" style={{ backgroundColor: INK, opacity: prev.mode === 'charge' && !prev.can_bill ? .5 : 1 }}>{busy === 'send' ? 'Sending…' : prev.mode === 'charge' ? 'Send both · mark done' : 'Mark done'}</button>
            <button disabled={!!busy} onClick={cancel} className="rounded px-2 py-1.5 font-bold" style={{ backgroundColor: '#fff', color: '#555', border: `1px solid ${BRAND.line}` }}>Cancel</button>
          </span>
        </span>
      )}
      {msg && <span className="absolute left-0 top-full mt-1 text-[10px] font-sans whitespace-nowrap" style={{ color: BRAND.red }}>{msg}</span>}
    </span>
  )
}
// 🚦 Create Job on EVERY estimate row (Mark 2026-10-09: "every ccc estimate needs
// to have a button on the right that says create job"). What it does depends on
// where the car is on the money path:
//   · nothing on the board        → Quote request (blue) + Create Job (orange) → Job Requested
//   · quote requested (card out)  → Create Job flips that same card to Job Requested
//   · quote SENT (shop said yes)  → Jayden / Mark / Dispatch later picker, same as the
//                                   board's Quoted jacket — approves the quote and moves the card
//   · requested / active job      → "On the board →"
//   · invoiced / paid             → nothing (the RO's green $ says it all)
const DISPATCH_PICK = [['jayden', 'Jayden', BRAND.jayden], ['mark', 'Mark', ORANGE], ['need_dispatch', 'Later', INK]]
async function moveQuoteRequestToJob(s) {
  const r = await apiFetch(`${API_BASE}/api/jobs/${s.jobId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_type: 'job' }) })
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  const l = await apiFetch(`${API_BASE}/api/scrubs/${s.id}/job`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: String(s.jobId), stage: 'requested' }) })
  const ld = await l.json().catch(() => ({}))
  return normScrub(ld.scrub || { ...s, stage: 'requested' })
}
async function approveQuoteAsJob(s, dispatch) {
  if (s.quoteId) {
    const r = await apiFetch(`${API_BASE}/api/shop-quotes/${encodeURIComponent(s.quoteId)}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved', dispatch: dispatch === 'need_dispatch' ? undefined : dispatch }) })
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  } else if (s.jobId) {
    // Quote number is on the card but the Books estimate id never landed — move the card ourselves.
    const status = dispatch === 'jayden' ? 'dispatched_jaden' : dispatch === 'mark' ? 'dispatched_mark' : 'need_dispatch'
    const body = { status }
    if (dispatch === 'jayden') body.technician = 'Jayden'
    if (dispatch === 'mark') body.technician = 'Mark'
    const r = await apiFetch(`${API_BASE}/api/jobs/${s.jobId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  } else {
    throw new Error('No quote or job card on this scrub')
  }
  let next = { ...s, stage: 'job' }
  if (s.jobId) {
    const l = await apiFetch(`${API_BASE}/api/scrubs/${s.id}/job`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: String(s.jobId), stage: 'job' }) })
    const ld = await l.json().catch(() => ({})); if (ld.scrub) next = ld.scrub
  }
  return normScrub(next)
}
function RowRequest({ s, user, onDone, full = false, onNavigate }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [pick, setPick] = useState(false)
  if (['invoiced', 'paid'].includes(s.stage)) return null   // already billed — nothing to request
  const stop = e => { e.stopPropagation(); e.preventDefault() }
  const run = async (key, fn) => {
    if (busy) return
    setBusy(key); setErr('')
    try { onDone(await fn()) } catch (x) { setErr(x.message || 'failed') } finally { setBusy('') }
  }
  const wrapCls = `inline-flex items-center gap-1 min-w-0 ${full ? 'w-full flex-1' : ''}`
  const errLine = err ? <span className="absolute left-0 top-full mt-1 text-[10px] font-sans whitespace-nowrap" style={{ color: BRAND.red }}>⚠ {err}</span> : null
  const jobBtn = (onClick, title, label, extra = {}) => (
    <ActionBtn full={full} grow={full} bg={err ? BRAND.red : ORANGE} busy={!!busy} onClick={e => { stop(e); onClick() }} title={title} {...extra}>
      {busy ? '…' : err ? 'Retry' : label}
    </ActionBtn>
  )

  // On the board already (requested, or an active job) → one tap to the board.
  if (s.jobId && (s.stage === 'requested' || s.stage === 'job')) {
    const active = s.stage === 'job'
    return (
      <span className={wrapCls} onClick={stop}>
        <ActionBtn full={full} grow={full} onClick={e => { stop(e); onNavigate && onNavigate('kanban') }}
          title={active ? 'This car is an active job on the board' : 'Job requested — Kat is pricing it'}
          bg={active ? BRAND.orangeSoft : '#ffedd5'} fg={active ? ORANGE : '#c2410c'}
          border={`1px solid ${active ? ORANGE : '#fdba74'}`}>
          {active ? 'On the board →' : 'Requested →'}
        </ActionBtn>
      </span>
    )
  }

  // Quote SENT → never show Quote again. If we have the card, who takes it?
  // If the cron marked it quoted but never linked a card, Create Job makes one.
  if (s.stage === 'quoted') {
    return (
      <span className={`relative ${wrapCls}`} onClick={stop} title={err || ''}>
        {s.quoteId || s.jobId
          ? (!pick
            ? jobBtn(() => setPick(true), 'Shop approved the quote — pick who takes the job', 'Create Job')
            : <>
                {DISPATCH_PICK.map(([k, label, bg]) => (
                  <ActionBtn key={k} full={full} grow={full} bg={bg} busy={busy === k} dim={busy && busy !== k}
                    onClick={e => { stop(e); run(k, () => approveQuoteAsJob(s, k)) }}>{busy === k ? '…' : label}</ActionBtn>
                ))}
                <ActionBtn full={full} bg="#fff" fg="#777" border={`1px solid ${BRAND.line}`} onClick={e => { stop(e); setPick(false) }}>Cancel</ActionBtn>
              </>)
          : jobBtn(() => run('job', () => requestJobFor(s, user, 'job')), 'Quote is out — send this car to Job Requested so Kat can dispatch it', 'Create Job')}
        {errLine}
      </span>
    )
  }

  // Quote requested (card in Quotes Requested) → Create Job moves that card.
  if (s.jobId && s.stage === 'quote_requested') {
    return (
      <span className={`relative ${wrapCls}`} onClick={stop}>
        {jobBtn(() => run('job', () => moveQuoteRequestToJob(s)), 'Move this card from Quotes Requested to Job Requested — Kat prices and dispatches it', 'Create Job')}
        {errLine}
      </span>
    )
  }

  // Nothing on the board yet → Quote (blue, left) + Create Job (orange, right).
  return (
    <span className={`relative ${wrapCls}`} onClick={stop} title={err || ''}>
      {['quote', 'job'].map(k => (
        <ActionBtn key={k} full={full} grow={full} bg={err ? BRAND.red : REQ_STYLE[k].bg}
          busy={busy === k} dim={busy && busy !== k}
          onClick={e => { stop(e); run(k, () => requestJobFor(s, user, k)) }}
          title={k === 'quote' ? 'Send to Quotes Requested with every scrub detail — Kat drafts the estimate' : 'Send to Job Requested with every scrub detail — Kat prices and dispatches it'}>
          {busy === k ? '…' : err ? 'Retry' : REQ_STYLE[k].label}
        </ActionBtn>
      ))}
      {errLine}
    </span>
  )
}

// Pre-scan + Quote + Create Job as one even row (list + phone cards).
function RowActions({ s, user, onDone, full = false, onNavigate }) {
  return (
    <span className={`inline-flex items-center ${full ? 'w-full gap-1.5 mt-2' : 'gap-1'}`} onClick={e => { e.stopPropagation(); e.preventDefault() }}>
      <RowPreScan s={s} onDone={onDone} full={full} />
      <RowRequest s={s} user={user} onDone={onDone} onNavigate={onNavigate} full={full} />
    </span>
  )
}

// RO on the list rows. Invoiced / paid = the RO itself gets a green
// highlighter with a $ instead of a separate "invoiced …" tag (Mark
// 2026-09-30: "instead of crowding this area"); other stages keep their pill.
// 🔬 Scan lifecycle (Mark 2026-10-07/08): the scans record rides in s.reports as {kind:'scans'}.
const scansOf = s => { const e = (s?.reports || []).find(r => r && r.kind === 'scans'); return { pre: e?.pre || {}, post: e?.post || {}, completed_at: e?.completed_at || '' } }
const scanState = s => { const sc = scansOf(s); const preDone = !!sc.pre.done_at, preInv = !!(sc.pre.invoice_number || sc.pre.mode === 'included' || sc.pre.mode === 'off'); const postDone = !!sc.post.done_at, postInv = !!(sc.post.invoice_number || sc.post.mode === 'included' || sc.post.mode === 'off'); if (preDone && preInv && postDone && postInv) return 'complete'; if (postDone) return 'post_done'; if (preDone && preInv) return 'pre_invoiced'; if (preDone) return 'pre_done'; return 'none' }
const SCAN_STYLE = { none: null, pre_done: { border: '#888888', bg: '#f5f3f0', label: 'Pre-scan done' }, pre_invoiced: { border: '#0A0A0A', bg: '#f5f3f0', label: 'Pre-scan invoiced · waiting on post-scan' }, post_done: { border: '#d97706', bg: '#fffbeb', label: 'Post-scan done · bill it' }, complete: { border: '#16a34a', bg: '#f0fdf4', label: 'Complete' } }
function ScanBoxes({ s }) {
  const sc = scansOf(s), st = scanState(s)
  if (st === 'none') return null
  const box = (k, label) => { const v = sc[k]; const done = !!v.done_at; const inv = v.invoice_number || (v.mode === 'included' ? 'no charge' : v.mode === 'off' ? 'shop' : ''); return <span key={k} className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: done ? (inv ? '#dcfce7' : '#e8e4e0') : '#f3f4f6', color: done ? (inv ? '#166534' : '#0A0A0A') : '#9ca3af', border: `1px solid ${done ? (inv ? '#86efac' : '#c4bfb8') : '#e5e7eb'}` }}>{done ? '☑' : '☐'} {label}{inv ? ` · ${inv}` : ''}</span> }
  return <div className="flex gap-1 flex-wrap mt-0.5">{box('pre', 'Pre-scan')}{box('post', 'Post-scan')}{st === 'complete' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#16a34a', color: '#fff' }}>✅ COMPLETE</span>}</div>
}
function RoTag({ s }) {
  const billed = ['invoiced', 'paid'].includes(s.stage)
  const ro = s.ro ? `RO ${s.ro}` : 'no RO'
  if (!billed) return <>{ro}<StagePill s={s} /></>
  return <span className="font-bold px-1.5 py-0.5 rounded whitespace-nowrap" title={`${s.stage === 'paid' ? 'Paid' : 'Invoiced'}${s.invoiceNumber ? ` · ${s.invoiceNumber}` : ''}`} style={{ backgroundColor: s.stage === 'paid' ? '#86efac' : '#bbf7d0', color: '#14532d' }}>$ {ro}</span>
}

// 📝 Quote already sent → blue border on the list (Mark 2026-09-30). Billed cars
// don't need it (their RO is the green $ highlight).
// Only a quote actually SENT (stage 'quoted' — set by Send Quote). A job's Books
// estimate number alone isn't a sent quote; once it's a job it shows "on the board".
const quoteSent = s => s.stage === 'quoted'
// 🟠 Active job (Mark 2026-10-09: "we need a way to mark a active job") — automatic:
// the card is past Requested (stage 'job'), so the row gets the brand-orange outline
// and a light orange tint, the mirror of the blue quoted outline. Billed cars drop it.
const activeJob = s => s.stage === 'job'
const ACTIVE_TINT = '#fff7f3'
// One place for the row/card frame: quoted (blue) > active job (orange) > scan state > plain.
const rowFrame = s => quoteSent(s) ? { border: QUOTE, bg: BRAND.quoteSoft }
  : activeJob(s) ? { border: ORANGE, bg: ACTIVE_TINT }
  : SCAN_STYLE[scanState(s)] ? { border: SCAN_STYLE[scanState(s)].border, bg: SCAN_STYLE[scanState(s)].bg }
  : null

// 👀 Last lot-walk result on a car (Mark 2026-09-30).
const SEEN = {
  here:      { label: 'On site', bg: '#dcfce7', fg: '#166534', icon: '✅' },
  not_ready: { label: 'Not ready',  bg: '#fef3c7', fg: '#92400e', icon: '⏳' },
  estimate:  { label: 'Estimate only', bg: '#f3f4f6', fg: '#4b5563', icon: '📄' },
  gone:      { label: 'Not here',   bg: '#fee2e2', fg: '#b91c1c', icon: '❌' },
  found:     { label: 'Found on walk', bg: '#e6f4f4', fg: '#1F8B8B', icon: '🆕' },
}
function SeenChip({ s }) {
  const v = s.seen; if (!v || !SEEN[v.s]) return null
  const st = SEEN[v.s]
  const when = v.at ? new Date(v.at).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' }) : ''
  return <div className="mt-0.5"><span className="text-[10px] font-bold font-sans px-1.5 py-0.5 rounded" title={v.n || ''} style={{ backgroundColor: st.bg, color: st.fg }}>👀 {st.icon} {st.label}{v.st ? ` · ${v.st}` : ''}{v.d ? ` · check ${shortDay(v.d)}` : ''}{when ? ` · seen ${when}` : ''}{v.by ? ` · ${v.by}` : ''}{v.n ? ` · ${v.n}` : ''}</span></div>
}

// ⏱ Shop clock (Mark 2026-10-01: "most cars have about a two week lifespan at a
// body shop"). Once a walk sees the car on the lot, it counts days ON SITE
// toward ~14. Before that it counts days since the first estimate came in.
// Stops counting once the car is invoiced or marked Not here.
const SHOP_LIFE = 14
const daysSince = iso => { const t = Date.parse(iso || ''); return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 864e5)) }
const carKeyOf = c => (String(c.vin || '').length === 17 ? c.vin : '') || (c.ro ? `ro:${c.ro}` : `id:${c.id}`)
function clockOf(s, first) {
  if (['invoiced', 'paid'].includes(s.stage) || s.seen?.s === 'gone') return null
  if (s.seen?.on && ['here', 'not_ready', 'found'].includes(s.seen.s)) { const d = daysSince(s.seen.on); return d == null ? null : { kind: 'onsite', d } }
  const d = daysSince(first || s.at); return d == null ? null : { kind: 'estimate', d }
}
// Running out = on site 10+ days, or an estimate 12+ days old, and not on the board yet.
const runningOut = (s, first) => { const c = clockOf(s, first); return !!c && s.stage !== 'job' && (c.kind === 'onsite' ? c.d >= 10 : c.d >= 12) }
function ShopClock({ s, first }) {
  const c = clockOf(s, first); if (!c) return null
  const days = c.d === 0 ? 'today' : `${c.d}d`
  let txt, bg, fg
  if (c.kind === 'onsite') {
    const left = SHOP_LIFE - c.d
    txt = `🚗 On site ${days} · ${left > 0 ? `~${left}d left` : 'past 2 wks'}`
    ;[bg, fg] = c.d >= 12 ? ['#dc2626', '#fff'] : c.d >= 8 ? ['#f59e0b', '#fff'] : ['#16a34a', '#fff']
  } else {
    txt = `⏱ ${c.d === 0 ? 'Estimate today' : `${days} since estimate`}`
    ;[bg, fg] = c.d >= 14 ? ['#fee2e2', '#b91c1c'] : c.d >= 7 ? ['#fef3c7', '#92400e'] : ['#f1f5f9', '#475569']
  }
  return <span className="text-[10px] font-bold font-sans px-1.5 py-0.5 rounded-full whitespace-nowrap" title={c.kind === 'onsite' ? `On the lot since ${new Date(s.seen.on).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Cars usually leave the shop in about 2 weeks.` : 'Days since the first estimate for this car came in. A lot walk that sees it on site starts the on-site clock.'} style={{ backgroundColor: bg, color: fg }}>{txt}</span>
}

// ⏳ Not ready → where it's at + when to check back (Mark 2026-09-30: techs guess
// "two days, a week" — make it two taps). A stage pre-picks its usual wait.
const WALK_STAGES = [['Waiting parts', 7], ['In body', 7], ['In paint', 2], ['Reassembly', 1], ['Waiting alignment', 1]]
const WALK_WHEN = [['Tomorrow', 1], ['2 days', 2], ['3 days', 3], ['1 week', 7], ['2 weeks', 14]]
const ptDate = (plusDays = 0) => { const d = new Date(Date.now() + plusDays * 864e5); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d) }
const shortDay = ymd => { try { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) } catch { return ymd } }

// 🚶 Lot walk: one shop's active cars as a big-button checklist; add cars found
// on the lot; finish → summary to Kat + #dispatch. Phone first.
function LotWalk({ shop, cars, user, onSeen, onFound, onRequest, onNavigate, onClose }) {
  const [walk, setWalk] = useState(null)
  const [err, setErr] = useState('')
  const [marks, setMarks] = useState({})        // scrubId → status
  const [notes, setNotes] = useState({})
  const [nr, setNr] = useState({})          // scrubId → { open, stage, days } for Not ready
  const [dues, setDues] = useState({})      // scrubId → 'YYYY-MM-DD' chosen
  const [busy, setBusy] = useState('')
  const [found, setFound] = useState([])
  const [f, setF] = useState({ open: false, vin: '', vehicle: '', ro: '', note: '' })
  const [done, setDone] = useState(null)
  useEffect(() => {
    apiFetch(`${API_BASE}/api/scrubs/walks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop }) })
      .then(r => r.json()).then(d => d.walk ? setWalk(d.walk) : setErr(d.error || 'Could not start the walk.')).catch(e => setErr(e.message))
  }, [shop])
  const mark = async (s, status, extra = {}) => {
    if (!walk || busy) return
    if (status === 'not_ready' && !extra.due) { setNr(x => ({ ...x, [s.id]: { ...(x[s.id] || {}), open: true } })); return }   // ask where + when first
    setBusy(`${s.id}:${status}`)
    try {
      const ids = s._ids || [s.id]
      for (const [i, id] of ids.entries()) {
        const body = { scrubId: id, status, note: notes[s.id] || '', label: [s.vehicle, s.ro && `RO ${s.ro}`].filter(Boolean).join(' · '), shop, stage: extra.stage || '', ...(i === 0 && extra.due ? { due: extra.due, siblings: ids.slice(1) } : {}) }
        const r = await apiFetch(`${API_BASE}/api/scrubs/walks/${walk.id}/mark`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const d = await r.json(); if (!r.ok) throw new Error(d.error)
        onSeen(id, d.seen || { s: status, at: new Date().toISOString(), by: user?.techName || (user?.name || '').split(' ')[0] || '', n: notes[s.id] || '', st: extra.stage || '', d: extra.due || '' })
      }
      setMarks(m => ({ ...m, [s.id]: status }))
      if (extra.due) { setDues(x => ({ ...x, [s.id]: extra.due })); setNr(x => ({ ...x, [s.id]: { ...(x[s.id] || {}), open: false } })) }
    } catch (e) { setErr(e.message || 'Could not save that.') } finally { setBusy('') }
  }
  const addFound = async () => {
    if (!walk || (!f.vin.trim() && !f.vehicle.trim())) return
    setBusy('found')
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/walks/${walk.id}/found`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop, vin: f.vin, vehicle: f.vehicle, ro: f.ro, note: f.note }) })
      const d = await r.json(); if (!r.ok || !d.id) throw new Error(d.error || 'Could not add the car.')
      const row = { id: d.id, shop, vin: f.vin.length === 17 ? f.vin.toUpperCase() : '', vehicle: f.vehicle || `VIN …${f.vin}`, ro: f.ro, stage: 'scrubbed', status: 'found', sensors: [], requiredCount: 0, sensorCount: 0, at: new Date().toISOString(), seen: { s: 'found', at: new Date().toISOString(), on: new Date().toISOString(), n: f.note } }
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
  const carKey = carKeyOf
  const sibs = new Map()
  for (const c of [...cars].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))) { const k = carKey(c); sibs.set(k, [...(sibs.get(k) || []), c]) }
  const uniq = [...sibs.values()].map(list => ({ ...list[0], _ids: list.map(x => x.id), _first: list.map(x => x.at).filter(Boolean).sort()[0] || '' }))
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
              <div className="mt-1"><ShopClock s={s} first={s._first} /></div>
              <ScanBoxes s={s} />
              {/* 🔬 Post-scan done from the walk (Mark 2026-10-08): ticks the car's box; the invoice fills in at Bill it. */}
              {!!s.id && !scansOf(s).post.done_at && (
                <button disabled={!!busy} onClick={async () => { setBusy(`${s.id}:post`); try { const r = await apiFetch(`${API_BASE}/api/scrubs/${s.id}/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ which: 'post', done: true }) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); if (d.scrub) onRequest && onRequest(d.scrub) } catch (e) { window.alert(e.message) } finally { setBusy('') } }}
                  className="mt-2 w-full rounded-lg py-2.5 text-xs font-bold text-white" style={{ backgroundColor: '#d97706' }}>{busy === `${s.id}:post` ? '…' : '🔬 Post-scan done'}</button>
              )}
              <div className="grid grid-cols-2 gap-1.5 mt-2">
                {['here', 'not_ready', 'estimate', 'gone'].map(k => (
                  <button key={k} onClick={() => mark(s, k)} disabled={!walk || !!busy}
                    className="rounded-lg py-2.5 text-xs font-bold" style={m === k ? { backgroundColor: SEEN[k].fg, color: '#fff' } : { backgroundColor: '#fff', color: SEEN[k].fg, border: `1.5px solid ${SEEN[k].fg}`, opacity: busy === `${s.id}:${k}` ? .5 : 1 }}>
                    {SEEN[k].icon} {SEEN[k].label}
                  </button>
                ))}
              </div>
              {nr[s.id]?.open && (
                <div className="mt-2 rounded-lg p-2" style={{ backgroundColor: '#fffbeb', border: '1px solid #fcd34d' }}>
                  <div className="text-[11px] font-bold mb-1" style={{ color: '#92400e' }}>Where's it at?</div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {WALK_STAGES.map(([st, days]) => (
                      <button key={st} onClick={() => setNr(x => ({ ...x, [s.id]: { ...x[s.id], stage: x[s.id]?.stage === st ? '' : st, days } }))} className="rounded-full px-2.5 py-1.5 text-xs font-bold"
                        style={nr[s.id]?.stage === st ? { backgroundColor: '#92400e', color: '#fff' } : { backgroundColor: '#fff', color: '#92400e', border: '1px solid #fcd34d' }}>{st}</button>
                    ))}
                  </div>
                  <div className="text-[11px] font-bold mb-1" style={{ color: '#92400e' }}>Check back {nr[s.id]?.days ? <span className="font-normal">(usual for {nr[s.id].stage?.toLowerCase()}: highlighted)</span> : ''}</div>
                  <div className="flex flex-wrap gap-1">
                    {WALK_WHEN.map(([l, days]) => (
                      <button key={l} disabled={!!busy} onClick={() => mark(s, 'not_ready', { stage: nr[s.id]?.stage || '', due: ptDate(days) })} className="rounded-full px-2.5 py-1.5 text-xs font-bold"
                        style={nr[s.id]?.days === days ? { backgroundColor: '#b45309', color: '#fff' } : { backgroundColor: '#fff', color: '#b45309', border: '1px solid #f59e0b' }}>{l}</button>
                    ))}
                    <label className="rounded-full px-2.5 py-1.5 text-xs font-bold flex items-center gap-1" style={{ backgroundColor: '#fff', color: '#b45309', border: '1px solid #f59e0b' }}>📅
                      <input type="date" min={ptDate(1)} onChange={e => e.target.value && mark(s, 'not_ready', { stage: nr[s.id]?.stage || '', due: e.target.value })} className="text-xs bg-transparent" style={{ width: 110, outline: 'none' }} />
                    </label>
                  </div>
                </div>
              )}
              {m === 'not_ready' && dues[s.id] && !nr[s.id]?.open && <div className="text-xs font-bold mt-1.5" style={{ color: '#92400e' }}>⏳ {nr[s.id]?.stage ? `${nr[s.id].stage} · ` : ''}check back {shortDay(dues[s.id])} — it'll be on your Live Day To-Do</div>}
              <input value={notes[s.id] || ''} onChange={e => setNotes(n => ({ ...n, [s.id]: e.target.value }))} placeholder="Note (optional) — e.g. waiting on bumper"
                className="w-full text-xs rounded-lg px-2.5 py-2 mt-1.5" style={inp} />
              {m === 'here' && <RowRequest s={s} user={user} onDone={onRequest} onNavigate={onNavigate} full />}
            </div>
          )
        })}
      </div>
      {/* ＋ Found a car */}
      <div className="mt-3 rounded-xl p-3" style={{ border: '2px dashed #1F8B8B', backgroundColor: '#e6f4f4' }}>
        {!f.open
          ? <button onClick={() => setF(x => ({ ...x, open: true }))} className="w-full text-sm font-bold py-1" style={{ color: '#1F8B8B' }}>＋ Found a car that isn't listed</button>
          : <div className="grid gap-1.5">
              <div className="text-sm font-bold" style={{ color: '#1F8B8B' }}>🆕 Car found on the lot</div>
              <input value={f.vin} onChange={e => setF(x => ({ ...x, vin: e.target.value.toUpperCase() }))} placeholder="VIN (full 17) or last 4–8" className="text-sm rounded-lg px-2.5 py-2 font-mono" style={inp} />
              <input value={f.vehicle} onChange={e => setF(x => ({ ...x, vehicle: e.target.value }))} placeholder="Year make model (e.g. 2022 Honda CR-V)" className="text-sm rounded-lg px-2.5 py-2" style={inp} />
              <input value={f.ro} onChange={e => setF(x => ({ ...x, ro: e.target.value }))} placeholder="RO (if you know it)" className="text-sm rounded-lg px-2.5 py-2" style={inp} />
              <input value={f.note} onChange={e => setF(x => ({ ...x, note: e.target.value }))} placeholder="Note — what's going on with it" className="text-sm rounded-lg px-2.5 py-2" style={inp} />
              <div className="flex gap-1.5">
                <button onClick={() => setF({ open: false, vin: '', vehicle: '', ro: '', note: '' })} className="flex-1 rounded-lg py-2.5 text-sm font-bold" style={{ backgroundColor: '#fff', color: '#555', border: '1px solid #ddd' }}>Cancel</button>
                <button onClick={addFound} disabled={busy === 'found' || (!f.vin.trim() && !f.vehicle.trim())} className="flex-1 rounded-lg py-2.5 text-sm font-bold text-white" style={{ backgroundColor: '#1F8B8B', opacity: (!f.vin.trim() && !f.vehicle.trim()) ? .5 : 1 }}>{busy === 'found' ? 'Adding…' : 'Add car'}</button>
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
function CalPills({ s, fsr }) {
  const { names } = requiredOf(s, fsr)
  return names.map(n => <span key={n} className="text-[10px] font-bold font-sans px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: '#fff1ec', color: '#b4380f', border: '1px solid #f6c3b1' }}>{String(n).replace(/\s*calibration$/i, '')}</span>)
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
  const [photoOpen, setPhotoOpen] = useState(false)   // 📸 scrub from estimate photos
  const [rows, setRows] = useState([])
  const [fsByShop, setFsByShop] = useState({})   // shop name → Full Service rule (list counts drop FS lines when OFF)
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
  const [tab, setTab] = useState('active')        // active | archive (invoiced + paid) | archived (🗄 purged by hand or auto, Mark 2026-10-07)
  const [archivedRows, setArchivedRows] = useState([])
  const loadArchived = async () => { try { const r = await apiFetch(`${API_BASE}/api/scrubs?limit=500&archived=1`); const d = await r.json().catch(() => ({})); setArchivedRows(Array.isArray(d.scrubs) ? d.scrubs.map(normScrub) : []) } catch { setArchivedRows([]) } }
  const [shopSel, setShopSel] = useState('')      // '' = all shops
  const [walkShop, setWalkShop] = useState('')    // 🚶 a lot walk is open for this shop
  const [hot, setHot] = useState(false)           // ⏰ only cars running out of shop time
  const onFile = async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await uploadReport(f) }
  const onDrop = async e => {
    e.preventDefault(); setDragOver(false)
    const f = [...(e.dataTransfer?.files || [])].find(x => /pdf$/i.test(x.name) || x.type === 'application/pdf')
    if (!f) { setUp({ busy: false, msg: 'Drop a PDF estimate.', name: '' }); return }
    if (up.busy) return
    await uploadReport(f)
  }
  const [dupNote, setDupNote] = useState(null)   // 🔁 same CCC already scrubbed → opened, nothing charged
  const uploadReport = async (f, force = false) => {
    const name = f.name
    setUp({ busy: true, msg: force ? `Scrubbing ${name} again — about a minute…` : `Scrubbing ${name} — about a minute…`, name })
    setDupNote(null)
    const fd = new FormData(); fd.append('file', f, name); if (force) fd.append('force', '1')
    let refused = ''
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/upload`, { method: 'POST', body: fd })
      if (r.status === 400) { const d = await r.json().catch(() => ({})); refused = d.error || 'Not accepted.' }
      else if (r.ok) {
        // Finished inside the window, or the same file was just scrubbed → open it now.
        const d = await r.json().catch(() => ({}))
        if (d.scrubId) {
          const l = await apiFetch(`${API_BASE}/api/scrubs?limit=60`).then(x => x.json()).catch(() => ({}))
          const hit = (l.scrubs || []).find(x => String(x.id) === String(d.scrubId))
          if (hit) {
            setRows((l.scrubs || []).map(normScrub)); setUp({ busy: false, msg: '', name: '' })
            if (d.duplicate) setDupNote({ when: d.scrubbed_at, why: d.duplicate_why, file: f })
            openScrub(hit); return
          }
        }
      }
    } catch { /* gateway cut — the scrub is still running */ }
    if (refused) { setUp({ busy: false, msg: refused, name: '' }); return }
    const t0 = Date.now()
    const fresh = x => !x.at || Date.parse(x.at) >= t0 - 120000   // this upload's scrub, not an older one of the same file
    while (Date.now() - t0 < 180000) {
      await new Promise(res => setTimeout(res, 5000))
      try {
        const r = await apiFetch(`${API_BASE}/api/scrubs?limit=30`)
        const d = await r.json().catch(() => ({}))
        const hit = (d.scrubs || []).find(x => (x.fileName === name || (x.fileName || '').endsWith(name)) && fresh(x))
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

  useEffect(() => { load(''); loadArchived(); apiFetch(`${API_BASE}/api/scrubs/stats`).then(r => r.json()).then(setStats).catch(() => {}) }, [])
  useEffect(() => {
    const names = [...new Set(rows.map(s => s.shop).filter(Boolean))]
    names.forEach(shop => {
      if (fsByShop[shop] || _fsCache.has(String(shop).trim().toLowerCase())) {
        if (!fsByShop[shop] && _fsCache.has(String(shop).trim().toLowerCase())) setFsByShop(m => ({ ...m, [shop]: _fsCache.get(String(shop).trim().toLowerCase()) }))
        return
      }
      fsRulesFor(shop).then(r => setFsByShop(m => (m[shop] ? m : { ...m, [shop]: r })))
    })
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps
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
          : <ScrubReport s={open} user={user} onBack={closeScrub} onNavigate={onNavigate} onExtracted={onExtracted} onArchived={() => { load(q.trim()); loadArchived() }} />}
      </div>
    )
  }

  // ── Active / Archive + shop grouping (Mark 2026-09-30) ──
  const billed = s => ['invoiced', 'paid'].includes(s.stage)
  // ⏱ First time each car showed up (supplements are new rows; the clock runs from the first).
  const firstAt = (() => { const m = new Map(); for (const r of rows) { const k = carKeyOf(r); if (r.at && (!m.has(k) || r.at < m.get(k))) m.set(k, r.at) } return m })()
  const first = s => firstAt.get(carKeyOf(s)) || s.at
  const hotCount = rows.filter(s => !billed(s) && runningOut(s, first(s))).length
  const tabRows = tab === 'archived' ? archivedRows : rows.filter(s => (tab === 'archive' ? billed(s) : !billed(s))).filter(s => !hot || tab === 'archive' || runningOut(s, first(s)))
  // One shop, many spellings ("…LLC", "…Llc", "Avon Body Shop, Llc") → one group,
  // shown under its most common spelling.
  const shopKey = s => shopCoreKey(s.shop) || shopKeyRaw(s.shop) || 'noshop'
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
          onSeen={addSeen} onFound={row => setRows(rs => [row, ...rs])} onRequest={swapRow} onNavigate={onNavigate}
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
          <button onClick={() => setPhotoOpen(true)} className="rounded-lg px-4 py-2.5 text-sm font-bold whitespace-nowrap" style={{ backgroundColor: '#15803d', color: '#fff', minHeight: 44 }}>📸 Photos</button>
          {photoOpen && <PhotoScrub user={user} onClose={() => { setPhotoOpen(false); load(q) }} />}
        </div>
        {up.msg && !up.busy && <div className="w-full text-xs rounded-lg px-3 py-2" style={{ backgroundColor: up.busy ? '#f5f3f0' : '#fef2f2', color: up.busy ? '#0A0A0A' : '#b91c1c' }}>{up.msg}</div>}
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
        style={{ border: `2px dashed ${dragOver ? ORANGE : '#cfcfcf'}`, backgroundColor: dragOver ? '#fff5f0' : up.busy ? '#fdf3ef' : '#fafafa', color: up.busy ? '#6b6b6b' : '#555', borderColor: up.busy ? '#e8c5b0' : undefined }}
      >
        {up.busy && <ScanLogo size={96} />}
        <div className={up.busy ? 'text-sm font-bold mt-2' : 'text-sm font-bold'} style={{ color: dragOver ? ORANGE : INK, letterSpacing: up.busy ? '0.08em' : undefined, textTransform: up.busy ? 'uppercase' : undefined }}>{up.busy ? <>Scanning the <span style={{ color: ORANGE }}>estimate</span></> : dragOver ? 'Drop it' : '📥 Drop an estimate here'}</div>
        <div className="text-xs mt-1">{up.busy ? up.msg : 'Drag a CCC estimate PDF onto this box, or tap to choose one. It is scrubbed and filed in the library.'}</div>
      </div>

      {err && (
        <div className="rounded-xl p-3 mb-3 text-sm" style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1.5px solid #fecaca' }}>{err}</div>
      )}

      {dupNote && (
        <div className="rounded-xl px-3 py-2 mb-2 text-xs flex items-center gap-2 flex-wrap" style={{ backgroundColor: '#f0fdf4', border: '1.5px solid #86efac', color: '#166534' }}>
          <span>♻️ <b>Already scrubbed</b>{dupNote.when ? ` ${shortWhen(dupNote.when)}` : ''} — opened the existing one, nothing charged ({dupNote.why}).</span>
          {user?.role === 'owner' && <button onClick={() => uploadReport(dupNote.file, true)} className="font-bold underline">Scrub again anyway</button>}
          <button onClick={() => setDupNote(null)} className="ml-auto font-bold" style={{ color: '#166534' }}>✕</button>
        </div>
      )}
      {/* Active / Archive + shop picker */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {[['active', 'Active', rows.filter(s => !billed(s)).length], ['archive', '💵 Billed', rows.filter(billed).length], ['archived', '🗄 Archived', archivedRows.length]].map(([k, l, n]) => (
          <button key={k} onClick={() => { setTab(k); setShopSel('') }} className="rounded-lg px-3 py-2 text-sm font-bold"
            style={tab === k ? { backgroundColor: INK, color: '#fff' } : { backgroundColor: '#f5f3f0', color: '#555' }}>{l} <span className="opacity-70">{n}</span></button>
        ))}
        {tab === 'active' && (hotCount > 0 || hot) && (
          <button onClick={() => { setHot(h => !h); setShopSel('') }} className="rounded-lg px-3 py-2 text-sm font-bold" title="On site 10+ days or estimate 12+ days old, and not on the board yet"
            style={hot ? { backgroundColor: '#dc2626', color: '#fff' } : { backgroundColor: '#fee2e2', color: '#b91c1c' }}>⏰ Running out <span className="opacity-80">{hotCount}</span></button>
        )}
        {tab === 'archive' && <span className="text-xs" style={{ color: '#888' }}>Invoiced and paid cars</span>}
        {tab === 'archived' && <span className="text-xs" style={{ color: '#888' }}>Purged by hand or auto-archived — open one and Resurrect to bring it back</span>}
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
                [g.rows.filter(s => s.stage === 'job').length, 'active'],
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
                    title={quoteSent(s) ? `Quote sent${s.quoteNumber ? ` · ${s.quoteNumber}` : ''}` : activeJob(s) ? 'Active job — on the board' : undefined}
                    style={{ borderBottom: '1px solid #f0f0f0', ...(rowFrame(s) ? { outline: `2px solid ${rowFrame(s).border}`, outlineOffset: -2, backgroundColor: rowFrame(s).bg } : {}) }}
                  >
                    <td className="py-2.5 pl-2">
                      {(() => { const n = requiredOf(s, fsByShop[s.shop]).count; return (
                      <span
                        className="inline-flex items-center justify-center text-[11px] font-bold rounded-full"
                        style={{ width: 24, height: 24, backgroundColor: n ? ORANGE : '#e5e5e5', color: n ? '#fff' : '#888' }}
                        title={`${n} required of ${s.sensorCount} sensors`}
                      >{n}</span>
                      ) })()}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="font-bold" style={{ color: INK }}>{s.vehicle || 'Vehicle not read'}</div>
                      <div className="mt-0.5"><ShopClock s={s} first={first(s)} /></div>
                      <SeenChip s={s} />
                      <ScanBoxes s={s} />
                      <div className="text-xs font-mono flex items-center gap-1.5 flex-wrap" style={{ color: ORANGE }}><RoTag s={s} /><CalPills s={s} fsr={fsByShop[s.shop]} />{statusNote(s) && <span className="text-[10px] font-sans" style={{ color: '#999' }}>{statusNote(s)}</span>}</div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs" style={{ color: '#555' }}><CopyVin vin={s.vin} /></td>
                    <td className="py-2.5 pr-3 font-mono text-xs" style={{ color: '#555' }}>{s.claim || '—'}</td>
                    <td className="py-2.5 pr-3 text-xs" style={{ color: '#555' }}>{s.shop || '—'}</td>
                    <td className="py-2.5 pr-3 text-xs" style={{ color: '#888' }}>{shortWhen(s.at)}</td>
                    <td className="py-2.5 pr-2 whitespace-nowrap"><RowActions s={s} user={user} onDone={swapRow} onNavigate={onNavigate} /></td>
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
              style={{ backgroundColor: rowFrame(s)?.bg || '#fff', border: `2px solid ${rowFrame(s)?.border || (requiredOf(s, fsByShop[s.shop]).count ? '#f3c9ba' : '#e5e5e5')}` }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold leading-snug" style={{ color: INK, overflowWrap: 'anywhere' }}>{s.vehicle || 'Vehicle not read'}</div>
                  <div className="text-xs font-mono flex items-center gap-2 flex-wrap" style={{ color: ORANGE }}><RoTag s={s} /><CalPills s={s} fsr={fsByShop[s.shop]} /></div>
                </div>
                {(() => { const n = requiredOf(s, fsByShop[s.shop]).count; return (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                  style={{ backgroundColor: n ? ORANGE : '#f5f3f0', color: n ? '#fff' : '#777' }}>
                  {n} of {s.sensorCount}
                </span>
                ) })()}
              </div>
              <div className="mt-1"><ShopClock s={s} first={first(s)} /></div>
              <SeenChip s={s} />
              <ScanBoxes s={s} />
              <div className="text-[11px] mt-1" style={{ color: '#666' }}>{s.shop || '—'}</div>
              <div className="text-[10px] mt-0.5 font-mono" style={{ color: '#999' }}><CopyVin vin={s.vin} /></div>
              <div className="text-[10px] mt-0.5" style={{ color: '#999' }}>{shortWhen(s.at)}</div>
              <RowActions s={s} user={user} onDone={swapRow} onNavigate={onNavigate} full />
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
  required: c.enabled === true && !/^(CONDITIONAL:|REVIEW NEEDED|NOT REQUIRED)/.test(c.classification || ''),
  lines: c.line_references || '',
  trigger: c.trigger || '', why: c.justification || '',
  added: !!c._added, edited: !!c._edited, by: c._by || '', guard: c._guard || '', learned: c._learned || '',
  reportRequired: !!(c._reportRequired || c._onReport),
  classification: c.classification || '', title: c.operation_title || '', procedure: c.procedure || '',
  required_before: c.required_before || '', repair_relationship: c.repair_relationship || '', oem_reference: c.oem_reference || '',
})
const fromLine = l => ({
  calibration_name: l.name, cal_type: l.type || null, trigger: l.trigger || null,
  line_references: l.lines || null, justification: l.why || '',
  enabled: l.classification === 'REVIEW NEEDED' ? true : !!l.required,
  ...(l.classification ? { classification: l.classification } : {}),
  ...(l.title ? { operation_title: l.title } : {}),
  ...(l.procedure ? { procedure: l.procedure } : {}),
  ...(l.required_before ? { required_before: l.required_before } : {}),
  ...(l.repair_relationship ? { repair_relationship: l.repair_relationship } : {}),
  ...(l.oem_reference ? { oem_reference: l.oem_reference } : {}),
  ...(l.added ? { _added: true, _by: l.by } : {}), ...(l.edited ? { _edited: true, _by: l.by } : {}),
  ...(l.reportRequired ? { _reportRequired: true } : {}),
})

function ScrubReport({ s: initial, user, onBack, onNavigate, onExtracted, onArchived }) {
  // 🗄 Archive / Resurrect (Mark 2026-10-07): nothing is deleted; the car leaves the active list.
  const [archBusy, setArchBusy] = useState(false)
  const [archPick, setArchPick] = useState(false)
  const archive = async reason => {
    setArchBusy(true)
    try { const r = await apiFetch(`${API_BASE}/api/scrubs/${initial.id}/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`); onArchived && onArchived('archived'); onBack && onBack() }
    catch (e) { window.alert(e.message || 'Could not archive') } finally { setArchBusy(false); setArchPick(false) }
  }
  const resurrect = async () => {
    setArchBusy(true)
    try { const r = await apiFetch(`${API_BASE}/api/scrubs/${initial.id}/resurrect`, { method: 'POST' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`); onArchived && onArchived('resurrected'); onBack && onBack() }
    catch (e) { window.alert(e.message || 'Could not resurrect') } finally { setArchBusy(false) }
  }
  const [s, setS] = useState(initial)
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
  const [fbBusy, setFbBusy] = useState('')
  const [fbFlash, setFbFlash] = useState(null)
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
  // ✨ "Why?" popups + the shop's online-report link (Mark 2026-10-02).
  const [whyData, setWhyData] = useState(null)
  const [whyOpen, setWhyOpen] = useState(null)
  useEffect(() => {
    let live = true
    apiFetch(`${API_BASE}/api/scrubs/${s.id}/why`).then(r => r.ok ? r.json() : null).then(d => { if (live) setWhyData(d) }).catch(() => {})
    return () => { live = false }
  }, [s.id, s.at])
  const whyFor = c => { const n = String(c.name || '').toLowerCase(); return (whyData?.rows || []).find(r => String(r.name).toLowerCase() === n) || null }
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
  // `list` = every line the scrub found (what Edit works on and what gets saved).
  // `visible` = what the report shows: Full Service lines drop out when the shop is OFF.
  const list = useMemo(() => {
    const cals = Array.isArray(p.calibrations) ? p.calibrations : []
    return foldBsm(cals.length ? cals.map(toLine) : (s.sensors || []).map(x => ({ name: x.n, type: x.t, required: x.r, lines: x.l, trigger: x.g, why: '' })), { name: 'name', req: 'required', lines: 'lines', trig: 'trigger' })
  }, [s]) // eslint-disable-line react-hooks/exhaustive-deps
  const [fsCrm, setFsCrm] = useState(null)   // the shop's Full Service rule (CRM); null until loaded
  useEffect(() => { let live = true; fsRulesFor(s.shop).then(r => { if (live) setFsCrm(r) }); return () => { live = false } }, [s.shop])
  const fsEff = fsCrm ? withOverride(fsCrm, p.fs_override || '') : null   // what THIS report uses
  const vehicleBits = `${s.make || ''} ${s.vehicle || ''}`
  const visible = useMemo(() => dropFsLines(list, fsEff, vehicleBits).map(l => ({
    ...l, onReport: !!(l.reportRequired || nissanBatteryLine(l, vehicleBits)),
  })), [list, fsEff, vehicleBits])   // eslint-disable-line react-hooks/exhaustive-deps
  const shown = editing ? draft : visible
  const required = shown.filter(c => c.required)

  // 📋 Request Job (Mark 2026-09-30): a tech on the scrub taps one button and
  // the car lands in the board's Job Requested column with everything the
  // scrub knows — shop, car, VIN, RO, claim, insurer, every calibration line,
  // and the estimate link — so Kat only has to price and dispatch it. Same
  // POST the board's "+ Request Job" uses, so Kat's alert fires the same way.
  // The RowRequest control does the work; this just lands the result and says what happened.
  const onRequested = next => {
    setS(next)
    setReqMsg(next.stage === 'quote_requested' ? '✓ On the board in Quotes Requested — Kat has it.'
      : next.stage === 'requested' ? '✓ On the board in Job Requested — Kat has it.'
      : next.stage === 'job' ? '✓ Quote approved — the card is on the board as an active job.' : '')
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
      const qCals = list.map(l => ({
        calibration_name: l.name, enabled: l.required === true, cal_type: l.type || '',
        trigger: l.trigger || '', line_references: l.lines || '', justification: l.why || '',
      }))
      { const fsr = withOverride(await fsRulesFor(s.shop), s.payload?.fs_override || ''); applyFs(qCals, fsr.rules, fsr.collision !== false) }   // 🧰 shop-handled + offers start OFF; flip an offer on to sell it
      const jobData = {
        shop: s.shop || '', ro_number: s.ro || '', insurer: s.insurer || '', claim: s.claim || '',
        vin: s.vin || '', vehicle: [s.year, s.make, s.model].filter(Boolean).join(' '),
        year: s.year || '', make: s.make || '', model: s.model || '',
        calibrations: qCals,
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

  const sendFeedback = async (c, action) => {
    const key = `${action}:${c.name}`
    const label = c.title || c.name
    if (fbBusy) return
    setFbBusy(key); setSaveMsg(''); setFbFlash(null)
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/${s.id}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sensor: c.name, action, trigger: c.trigger, lines: c.lines }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      if (d.keptOff) {
        const text = d.message || `Kept off — ${label} stays off. A hard rule demoted it.`
        setSaveMsg(text); setFbFlash({ name: c.name, text, ok: true })
        return
      }
      if (d.scrub) setS(d.scrub)
      const n = d.lesson?.n || 1
      const text = action === 'miss'
        ? `Learned — ${label} is required now (${n}×). The next similar ${s.make || 'car'} gets it.`
        : `Learned — ${label} was extra (${n}×). The next similar ${s.make || 'car'} drops it.`
      setSaveMsg(text); setFbFlash({ name: c.name, text, ok: true })
    } catch (e) {
      const text = e.message || 'Feedback failed.'
      setSaveMsg(text); setFbFlash({ name: c.name, text, ok: false })
    } finally { setFbBusy('') }
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
          {s.status === 'archived' && <div className="mt-3 rounded-lg p-3" style={{ backgroundColor: '#f3f4f6', border: '1px solid #d1d5db' }}>
            <div className="text-sm font-bold" style={{ color: '#374151' }}>🗄 Archived{p.archive?.auto ? ' automatically' : ''}{p.archive?.reason ? ` — ${p.archive.reason}` : ''}</div>
            <div className="text-[11px]" style={{ color: '#6b7280' }}>{p.archive?.by ? `${p.archive.by} · ` : ''}{when(p.archive?.at) || ''}</div>
            <button onClick={resurrect} disabled={archBusy} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm font-bold text-white" style={{ backgroundColor: '#15803d' }}>{archBusy ? '…' : '♻️ Resurrect — back to the active list'}</button>
          </div>}
          {s.status !== 'archived' && !editing && (archPick
            ? <div className="mt-3 rounded-lg p-3" style={{ backgroundColor: '#f3f4f6', border: '1px solid #d1d5db' }}>
                <div className="text-xs font-bold mb-2" style={{ color: '#374151' }}>Why is this car leaving the list?</div>
                <div className="flex flex-wrap gap-1.5">{['Never came on site', 'Not completed', 'Duplicate', 'Shop cancelled', 'Other'].map(r => <button key={r} disabled={archBusy} onClick={() => archive(r)} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: '#fff', color: '#374151', border: '1px solid #9ca3af' }}>{r}</button>)}</div>
                <button onClick={() => setArchPick(false)} className="mt-2 text-xs font-semibold" style={{ color: '#6b7280' }}>Cancel</button>
              </div>
            : <button onClick={() => setArchPick(true)} className="mt-3 w-full rounded-lg px-3 py-2 text-xs font-bold" style={{ backgroundColor: '#fff', color: '#6b7280', border: '1px solid #d1d5db' }} title="Take this car off the active list — nothing is deleted, Resurrect brings it back">🗄 Archive this scrub</button>)}

          <button onClick={downloadPdf} disabled={pdfBusy || editing || (!shown.length && !hasStoredReport)}
            className="mt-4 w-full rounded-lg px-3 py-3 text-sm font-bold"
            style={{ backgroundColor: pdfBusy ? '#f5f3f0' : ORANGE, color: pdfBusy ? '#777' : '#fff', opacity: (shown.length || hasStoredReport) && !editing ? 1 : 0.5 }}
          >{pdfBusy ? 'Building…' : (!list.length && hasStoredReport) ? '📄 Report that went out ↓' : '📄 Absolute ADAS report ↓'}</button>
          {whyData?.url && <a href={whyData.url} target="_blank" rel="noreferrer" className="mt-2 block w-full rounded-lg px-3 py-2.5 text-sm font-bold text-center" style={{ backgroundColor: '#fff', color: ORANGE, border: `1.5px solid ${ORANGE}` }}>🌐 Online report (shop view) ↗</a>}

          {/* 📝 Quote: build the Books estimate, then hand off to the SAME blue
              Send-Quote button the jobs page uses (line review → /shop-quotes/send
              with the Quote PDF). A previously-quoted scrub goes straight to send. */}
          {(() => {
            if (s.invoiceNumber) return null
            const qid = quoteId || s.quoteId || ''
            if (qid) return (
              <div className="mt-2 flex flex-col gap-1.5">
                {s.quoteNumber && <div className="text-xs font-semibold text-center" style={{ color: '#0A0A0A' }}>📝 Quote {s.quoteNumber} is built — review the lines and send:</div>}
                <SendQuoteButton
                  result={{ quoteId: qid, quoteNumber: s.quoteNumber || '' }}
                  job={{ scrubId: s.id, shop: s.shop || '', year: s.year || '', make: s.make || '', model: s.model || '', vin: s.vin || '', ro_number: s.ro || '', claim: s.claim || '', insurer: s.insurer || '' }}
                  lineCount={required.length}
                  selectedCustomer={{ name: s.shop || '' }}
                  onNavigate={onNavigate} />
              </div>
            )
            return (
              <button onClick={openBuilder} disabled={qBusy || editing || !list.length || !onExtracted}
                className="mt-2 w-full rounded-lg px-3 py-3 text-sm font-bold"
                style={{ backgroundColor: qBusy ? BRAND.cream : QUOTE, color: qBusy ? '#777' : '#fff', opacity: list.length && !editing && onExtracted ? 1 : 0.5 }}
                title="Opens the estimate screen pre-filled from this scrub — pick the customer, check the lines, build, then send"
              >{qBusy ? 'Opening the estimate…' : `Build quote${required.length ? ` (${required.length} required)` : ''}`}</button>
            )
          })()}
          {qMsg && <p className="text-xs mt-2" style={{ color: qMsg.startsWith('✓') ? '#0A0A0A' : '#b91c1c' }}>{qMsg}</p>}

          {/* 📋 Create Job / 📝 Quote request — the SAME state-aware control as the list rows:
              Quote + Create Job when nothing is on the board, Create Job on a quote request,
              the Jayden / Mark / Dispatch later picker on a sent quote, "On the board →" after. */}
          {!editing && !['invoiced', 'paid'].includes(s.stage) && (
            <div className="hidden md:block mt-2"><RowRequest s={s} user={user} onDone={onRequested} onNavigate={onNavigate} full /></div>
          )}
          {reqMsg && <p className="text-xs mt-1" style={{ color: reqMsg.startsWith('✓') ? '#166534' : '#b91c1c' }}>{reqMsg}</p>}
          {/* 📱 Phone: the same control pinned to the bottom of the screen */}
          {!editing && !['invoiced', 'paid'].includes(s.stage) && (
            <div className="md:hidden fixed left-0 right-0 bottom-0 z-40 p-2" style={{ backgroundColor: 'rgba(255,255,255,.96)', borderTop: '1px solid #eee', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}>
              <RowRequest s={s} user={user} onDone={onRequested} onNavigate={onNavigate} full />
            </div>
          )}
          {!editing && !['invoiced', 'paid'].includes(s.stage) && <div className="md:hidden" style={{ height: 72 }} />}

          {/* 🧾 Build job — price it now (Mark 2026-09-30; renamed 2026-10-09 so it
              isn't confused with the one-tap Create Job above). The retired "Create
              invoice" shortcut skipped Bill it and made a single, wrong invoice. This
              opens the SAME review screen an upload opens; its Create job builds the
              Books estimate and puts the card on the board, and Bill it (both invoices)
              runs from Ready to Invoice exactly like every other job. */}
          {s.jobId && s.stage === 'job'
            ? <button onClick={() => onNavigate && onNavigate('kanban')} className="mt-2 w-full rounded-lg px-3 py-3 text-sm font-bold" style={{ backgroundColor: '#fdeae2', color: ORANGE, border: `1.5px solid ${ORANGE}` }}>🟠 Active job{s.quoteNumber ? ` · ${s.quoteNumber}` : ''} — open the board →</button>
            : <button onClick={openBuilder} disabled={qBusy || editing || !list.length || !onExtracted}
                className="mt-2 w-full rounded-lg px-3 py-3 text-sm font-bold"
                style={{ backgroundColor: qBusy ? '#f5f3f0' : '#fff', color: qBusy ? '#777' : ORANGE, border: `1.5px solid ${ORANGE}`, opacity: list.length && !editing && onExtracted ? 1 : 0.5 }}
                title="Opens the same review screen as an uploaded report: pick the customer, check the lines, Create job → the card goes on the board priced"
              >{qBusy ? 'Opening…' : `🧾 Build job (price it now)${required.length ? ` · ${required.length} required` : ''}`}</button>}

          {!editing
            ? <button onClick={startEdit} className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#fff', color: INK, border: '1.5px solid #ddd' }}>✏️ Edit calibration lines</button>
            : <div className="mt-2 grid grid-cols-2 gap-2">
                <button onClick={save} disabled={saving} className="rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#166534', color: '#fff' }}>{saving ? 'Saving…' : '✓ Save'}</button>
                <button onClick={cancelEdit} disabled={saving} className="rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#fff', color: '#777', border: '1.5px solid #ddd' }}>Cancel</button>
              </div>}

          {s.fileId && (estUrl
            ? <a href={estUrl} target="_blank" rel="noreferrer" className="mt-2 block text-center w-full rounded-lg px-3 py-3 text-sm font-bold" style={{ backgroundColor: '#f5f3f0', color: '#0A0A0A', border: '1.5px solid #c4bfb8' }}>📎 Open the CCC estimate (tap again)</a>
            : <button onClick={fetchEstimate} disabled={estBusy} className="mt-2 w-full rounded-lg px-3 py-3 text-sm font-bold" style={{ backgroundColor: '#fff', color: '#0A0A0A', border: '1.5px solid #c4bfb8' }}>{estBusy ? 'Fetching…' : '📎 Open the CCC estimate'}</button>)}
          {!s.fileId && <p className="text-xs mt-2" style={{ color: '#999' }}>No estimate file is stored for this scrub yet.</p>}

          {!list.length && s.jobId && !cardGone && !editing && (
            <button onClick={loadFromCard} disabled={cardBusy} className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#fff', color: ORANGE, border: `1.5px solid ${ORANGE}` }}>
              {cardBusy ? 'Reading the card…' : '🔄 Load calibrations from the job card'}
            </button>
          )}
          {cardMsg && <p className="text-xs mt-2" style={{ color: cardMsg.startsWith('Loaded') ? '#166534' : '#b91c1c' }}>{cardMsg}</p>}
          {saveMsg && <p className="text-xs mt-2" style={{ color: /^(Saved|Learned|Kept)/.test(saveMsg) ? '#166534' : '#b91c1c' }}>{saveMsg}</p>}

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
            {!required.some(c => /^wheel alignment$/i.test(c.name || '')) && required.some(c => /front radar|acc radar|distance sensor/i.test(c.name || '') && !/side|corner|park/i.test(c.name || '') && /4-wheel vehicle alignment must be performed/i.test(c.why || '')) && (
              <div className="rounded-lg px-3 py-2.5 mb-5 text-sm" style={{ backgroundColor: '#fff7ed', border: '1.5px solid #CD4419', color: '#0A0A0A' }}>
                <div className="font-bold">Prerequisite: wheel alignment required</div>
                <div>A 4-wheel vehicle alignment must be performed before proceeding with radar alignment procedure.</div>
              </div>
            )}
            {list.some(c => c.classification === 'REQUIRED: OEM PREREQUISITE') && (
              <div className="rounded-lg px-3 py-2.5 mb-5 text-sm" style={{ backgroundColor: '#fff7ed', border: '1.5px solid #CD4419', color: '#0A0A0A' }}>
                <div className="font-bold">Dependency chain</div>
                <div>Front radar is a direct trigger. Four-wheel alignment is the OEM prerequisite. Steering angle stays conditional until an alignment adjustment is on the estimate. Radar aiming is last.</div>
              </div>
            )}
            {(() => {
              const row = list.find(c => /battery.?disconnect reset/i.test(c.name || ''))
              const onReport = list.some(c => c.classification === 'REVIEW NEEDED' || (/battery.?disconnect reset/i.test(c.name || '') && /Operations Required after Disconnecting Battery/i.test(`${c.title || ''} ${c.why || ''}`)))
              const note = String(row?.why || '').match(/12V battery disconnect[\s\S]*?Position Statement Power Window Servicing Post-Repair\./)
              if (!note || onReport) return null
              return (
                <div className="rounded-lg px-3 py-2.5 mb-5 text-sm" style={{ backgroundColor: '#fff7ed', border: '1.5px solid #CD4419', color: '#0A0A0A' }}>
                  <div className="font-bold">Battery Operations</div>
                  <div>{note[0]}</div>
                </div>
              )
            })()}

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
                    {alldata.links.length > 1 && <div className="mt-1 flex flex-wrap gap-1.5">{alldata.links.slice(1, 6).map((l, i) => <a key={i} href={l.url} target="_blank" rel="noreferrer" className="text-[11px] font-bold px-2 py-1 rounded" style={{ backgroundColor: '#fff', color: '#0A0A0A', border: '1px solid #c4bfb8' }}>{l.label.slice(0, 40)}</a>)}</div>}
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
              <div className="rounded-lg px-3 py-2.5 mb-5 text-xs" style={{ backgroundColor: '#f5f3f0', color: '#0A0A0A' }}>📎 Went out with the invoice: {s.reports.map(r => r.name).join(', ')}</div>
            )}

            {!editing && s.shop && <ShopBig4Bar shopName={s.shop} />}
            {!editing && s.status !== 'archived' && <ScanPanel s={s} onUpdated={setS} />}
            {!editing && <FullServiceCard shop={s.shop} rows={list} scrubId={s.id} override={s.payload?.fs_override || ''} onOverride={ov => setS(x => ({ ...x, payload: { ...(x.payload || {}), fs_override: ov || undefined } }))} />}

            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold" style={{ color: INK }}>Operations</h3>
              <div className="text-xs flex gap-3" style={{ color: '#777' }}>
                <span><span style={{ color: ORANGE }}>●</span> Required</span>
                <span><span style={{ color: '#bbb' }}>●</span> Not required</span>
                {editing && <span style={{ color: '#b45309' }}>tap ● to flip · tap a name to open it</span>}
              </div>
            </div>
            {fbFlash && <div className="text-xs font-semibold mb-2" style={{ color: fbFlash.ok ? '#166534' : '#b91c1c' }}>{fbFlash.text}</div>}

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
                <table className="w-full text-sm" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: 220 }} />
                    <col />
                    <col style={{ width: 72 }} />
                    <col style={{ width: 268 }} />
                    <col style={{ width: editing ? 40 : 132 }} />
                  </colgroup>
                  <thead>
                    <tr style={{ backgroundColor: ORANGE }}>
                      <th className="text-left font-bold py-2 px-3" style={{ color: '#fff' }}>Sensor</th>
                      <th className="text-left font-bold py-2 px-3" style={{ color: '#fff' }}>Repair triggers</th>
                      <th className="text-left font-bold py-2 px-3" style={{ color: '#fff', whiteSpace: 'nowrap' }}>Lines</th>
                      <th className="text-left font-bold py-2 px-3" style={{ color: '#fff', whiteSpace: 'nowrap' }}>Type</th>
                      {!editing && <th className="text-right font-bold py-2 px-3" style={{ color: '#fff', whiteSpace: 'nowrap' }}>Teach</th>}
                      {editing && <th style={{ width: 40 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Required to the TOP (Mark 2026-10-09: "all the calibrations needed are all over
                        the list") — required → always-required → not required, same order as the PDF.
                        `i` stays the line's real index so edit-mode flips / removes hit the right row. */}
                    {(() => {
                      const withIdx = shown.map((c, i) => ({ c, i }))
                      const onReport = x => x.c.required || x.c.onReport
                      // CONDITIONAL and REVIEW sit in the Operations block, same order as the PDF.
                      // enabled stays false on a conditional row, so it does not count as required.
                      const held = c => /^(CONDITIONAL:|REVIEW NEEDED)/.test(c.classification || '')
                      const rankOf = c => ({
                        'REQUIRED: DIRECT TRIGGER': 1,
                        'REQUIRED: OEM PREREQUISITE': 2,
                        'REQUIRED: SECONDARY OPERATION': 3,
                        'CONDITIONAL: VERIFICATION NEEDED': 4,
                        'REVIEW NEEDED': 5,
                      })[c.classification || (c.required ? 'REQUIRED: DIRECT TRIGGER' : '')] || 9
                      const req = withIdx.filter(x => onReport(x) || held(x.c)).sort((a, b) => rankOf(a.c) - rankOf(b.c))
                      const not = withIdx.filter(x => !onReport(x) && !held(x.c))
                      const always = editing ? [] : (whyData?.rows || []).filter(r => r.always)
                      let pos = 0
                      const row = ({ c, i }) => (
                        <LineRow key={i} c={c} i={i} zebra={pos++} editing={editing} vehicle={vehicleBits} expanded={!!expanded[i] || (editing && !!c.added)}
                          onToggle={() => setExpanded(e => ({ ...e, [i]: !e[i] }))}
                          onFlip={() => patchLine(i, { required: !c.required })}
                          onPatch={patch => patchLine(i, patch)}
                          onRewrite={() => rewriteLine(i)} aiBusy={aiBusy === i}
                          onRemove={() => removeLine(i)}
                          onWhy={editing ? null : () => setWhyOpen({ ...(whyFor(c) || {}), name: c.name, required: c.required, type: c.type, why: c.why })}
                          onFeedback={editing ? null : (action) => sendFeedback(c, action)}
                          fbBusy={fbBusy} fbFlash={fbFlash && fbFlash.name === c.name ? fbFlash : null} />
                      )
                      return (
                        <>
                          {req.map(row)}
                          {always.map((r, k) => (
                            <tr key={`a${k}`} style={{ backgroundColor: pos++ % 2 ? '#fafafa' : '#fff', borderBottom: '1px solid #f0f0f0' }}>
                              <td className="py-2.5 px-3 font-bold" style={{ color: INK }}><span style={{ color: ORANGE, marginRight: 6, fontSize: 16 }}>●</span>{r.name}<WhyBtn onClick={() => setWhyOpen(r)} /></td>
                              <td className="py-2.5 px-3" style={{ color: '#444' }}>{r.trigger}</td>
                              <td className="py-2.5 px-3 font-mono text-xs" style={{ color: '#444', whiteSpace: 'nowrap' }}>—</td>
                              <td className="py-2.5 px-3" style={{ whiteSpace: 'nowrap' }}><span style={{ display: 'inline-block', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700, lineHeight: '18px', padding: '2px 8px', borderRadius: 4, backgroundColor: ORANGE, color: '#fff' }}>{r.type}</span></td>
                              {!editing && <td />}
                            </tr>
                          ))}
                          {not.length > 0 && (req.length + always.length) > 0 && (
                            <tr key="divider"><td colSpan={5} className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: '#999', borderTop: '2px solid #e5e5e5' }}>Not required — nothing on this estimate disturbs these</td></tr>
                          )}
                          {not.map(row)}
                        </>
                      )
                    })()}
                  </tbody>
                </table>
              </div>
            )}
            {!editing && whyData?.docs?.length > 0 && (
              <div className="rounded-lg p-3 mt-3" style={{ backgroundColor: '#f4f2f0', border: '1px solid #e0dbd6', borderLeft: `4px solid ${ORANGE}` }}>
                <div className="text-sm font-bold mb-1" style={{ color: INK }}>Supporting OEM documents</div>
                {whyData.docs.map(d => <div key={d.n} className="text-xs mt-1"><a href={d.href} target="_blank" rel="noreferrer" style={{ color: INK, textDecoration: 'underline' }}>Attachment {d.n} — {d.title}</a></div>)}
              </div>
            )}
            {whyOpen && <WhyModal r={whyOpen} onClose={() => setWhyOpen(null)} />}

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
                  <button onClick={writeAdd} disabled={add.busy || !add.name.trim()} className="rounded-lg px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: '#f5f3f0', color: '#0A0A0A', border: '1.5px solid #c4bfb8' }}>{add.busy ? 'Writing…' : '🪄 Write the justification'}</button>
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

// 🧰 The Full Service items this car needs + the shop's rule for each, settable
// right here (the first pick for a shop becomes its rule; it's also on the
// CRM Billing tab).
// 🔬 Pre-scan / post-scan on the report (Mark 2026-10-07/08). Pre-scan done → one-line
// billing per the shop's Big 3 rule, both documents emailed; post-scan done → rides on
// the calibration invoice. Both filled + invoiced = green, archived after 7 days.
function ScanPanel({ s, onUpdated }) {
  const sc = scansOf(s), st = scanState(s)
  const [prev, setPrev] = useState(null)      // pre-scan billing preview (confirm sheet)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const post = async (which, done = true) => {
    setBusy(which); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/${s.id}/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ which, done }) })
      const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      if (d.scrub) onUpdated && onUpdated(d.scrub)
      setPrev(null)
      setMsg(d.bill?.billed ? `✓ Pre-scan billed — ${d.bill.mode === 'dual' ? `estimate ${d.bill.estimate_number} + invoice ${d.bill.invoice_number}` : `invoice ${d.bill.invoice_number}`} emailed to ${(d.bill.emails || []).join(', ')}.` : done ? `✓ ${which === 'pre' ? 'Pre-scan' : 'Post-scan'} marked done${d.bill && !d.bill.billed ? ` (${d.bill.mode === 'off' ? 'shop handles pre-scans' : 'no charge'} — nothing billed)` : ''}.` : 'Unchecked.')
    } catch (e) { setMsg(`⚠ ${e.message}`) } finally { setBusy('') }
  }
  const openPreview = async () => {
    setBusy('preview'); setMsg('')
    try { const r = await apiFetch(`${API_BASE}/api/scrubs/${s.id}/scan/preview`); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); setPrev(d) }
    catch (e) { setMsg(`⚠ ${e.message}`) } finally { setBusy('') }
  }
  const style = SCAN_STYLE[st] || { border: '#e5e7eb', bg: '#fafafa', label: 'Scans' }
  const Box = ({ k, label, onCheck }) => { const v = sc[k]; const done = !!v.done_at; const inv = v.invoice_number || (v.mode === 'included' ? 'no charge' : v.mode === 'off' ? 'shop handles' : ''); return (
    <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: '#fff', border: `1px solid ${done ? '#86efac' : '#e5e7eb'}` }}>
      <div className="min-w-0"><div className="text-sm font-bold" style={{ color: INK }}>{done ? '☑' : '☐'} {label}</div><div className="text-[11px]" style={{ color: '#666' }}>{done ? `${v.by || ''}${v.done_at ? ` · ${shortWhen(v.done_at)}` : ''}${inv ? ` · ${inv}` : ' · not billed yet'}${v.pdf?.name ? ' · 📎 report attached' : ''}` : 'not done'}</div></div>
      {!done ? <button disabled={!!busy} onClick={onCheck} className="rounded-lg px-3 py-2 text-xs font-bold text-white whitespace-nowrap" style={{ backgroundColor: k === 'pre' ? INK : '#d97706' }}>{busy === k || busy === 'preview' ? '…' : k === 'pre' ? '🔬 Pre-scan done' : '🔬 Post-scan done'}</button>
        : !v.invoice_number && <button disabled={!!busy} onClick={() => post(k, false)} className="text-[11px] font-semibold" style={{ color: '#6b7280' }}>undo</button>}
    </div>) }
  return (
    <div className="rounded-xl p-3 mb-4" style={{ border: `2px solid ${style.border}`, backgroundColor: style.bg }}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="text-sm font-extrabold" style={{ color: style.border === '#e5e7eb' ? INK : style.border }}>🔬 Scans · {style.label}</div>
        {st === 'complete' && sc.completed_at && <span className="text-[11px]" style={{ color: '#166534' }}>archives 7 days after {shortWhen(sc.completed_at)}</span>}
      </div>
      <div className="grid gap-2">
        <Box k="pre" label="Pre-scan" onCheck={openPreview} />
        <Box k="post" label="Post-scan" onCheck={() => post('post')} />
      </div>
      {prev && (
        <div className="mt-3 rounded-lg p-3" style={{ backgroundColor: '#fff', border: `1.5px solid ${INK}` }}>
          <div className="text-sm font-bold" style={{ color: INK }}>{prev.mode === 'charge' ? 'Bill the pre-scan now?' : prev.mode === 'included' ? 'Mark pre-scan done (no charge)' : 'Mark pre-scan done (shop handles its own)'}</div>
          {prev.mode === 'charge' && <div className="text-xs mt-1" style={{ color: '#444' }}>
            {prev.billing_mode === 'dual' ? <>Estimate (insurance) <b>{prev.item?.name}</b> ${Number(prev.list || 0).toFixed(2)} + cost invoice ${Number(prev.cost || 0).toFixed(2)} ({prev.discount_pct}% off) — both emailed to {prev.emails?.join(', ') || '—'}.</> : <>Invoice <b>{prev.item?.name}</b> ${Number(prev.cost || 0).toFixed(2)}{prev.discount_pct ? ` (${prev.discount_pct}% off)` : ''} — emailed to {prev.emails?.join(', ') || '—'}.</>}
            <div className="mt-1" style={{ color: '#666' }}>{prev.shop_name} · {prev.insurer || 'no insurer'} · one line, nothing else on it.</div>
          </div>}
          {prev.warnings?.length > 0 && <ul className="text-[11px] mt-1" style={{ color: '#b45309' }}>{prev.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>}
          <div className="flex gap-2 mt-2">
            <button disabled={!!busy || (prev.mode === 'charge' && !prev.can_bill)} onClick={() => post('pre')} className="flex-1 rounded-lg px-3 py-2.5 text-sm font-bold text-white" style={{ backgroundColor: INK, opacity: prev.mode === 'charge' && !prev.can_bill ? .5 : 1 }}>{busy === 'pre' ? 'Sending…' : prev.mode === 'charge' ? `💸 Send both${prev.billing_mode === 'single' ? '' : ''} · mark done` : '✓ Mark done'}</button>
            <button disabled={!!busy} onClick={() => setPrev(null)} className="rounded-lg px-3 py-2.5 text-sm font-bold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div className="text-xs mt-2 font-semibold" style={{ color: msg.startsWith('⚠') ? '#b91c1c' : '#166534' }}>{msg}</div>}
    </div>
  )
}
function FullServiceCard({ shop, rows, scrubId, override = '', onOverride }) {
  const items = FS_ITEMS.map(f => ({ ...f, rows: (rows || []).filter(r => (r.required || f.optional) && f.match.test(r.name)) })).filter(f => f.rows.length)
  const [crm, setCrm] = useState(null)        // the account's rule, as the CRM has it
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { if (!items.length) return; if (shop) fsRulesFor(shop).then(setCrm); else setCrm({ rules: {}, set: {}, on: false, collision: true, inCrm: false }) }, [shop, items.length])
  const fs = crm ? withOverride(crm, override) : null   // what THIS report uses
  const setOverride = async next => {
    if (!scrubId || busy) return
    setBusy('override'); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/${scrubId}/full-service-override`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ override: next }) })
      const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      onOverride && onOverride(d.fs_override || '')
      setMsg(next ? `This report: Full Service ${next.toUpperCase()}. The CRM still says ${crm?.on ? 'ON' : 'OFF'} for ${shop}.` : `Back to the CRM rule (${crm?.on ? 'ON' : 'OFF'}).`)
    } catch (e) { setMsg(e.message || 'failed') } finally { setBusy('') }
  }
  const shown = items.filter(f => !f.optional || fs?.on)   // optional items only matter to Full Service shops
  if (crm && crm.collision === false) return null   // collision shops only
  if (!shown.length && !items.length) return null
  const seg = (k, label) => <button key={k} onClick={() => setOverride(k)} disabled={!!busy || !scrubId} className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={override === k ? { backgroundColor: '#1F8B8B', color: '#fff' } : { backgroundColor: '#fff', color: '#1F8B8B', border: '1px solid #8eb8b8' }}>{label}</button>
  const pick = async (key, mode) => {
    if (!shop || busy) return
    setBusy(key); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/shops/full-service-by-name`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop, rules: { [key]: mode } }) })
      const d = await r.json(); if (!d.ok) throw new Error(d.error || 'Could not save')
      setCrm(await fsRulesFor(shop, true)); setMsg(`Saved for ${shop}.`)
    } catch (e) { setMsg(e.message) } finally { setBusy('') }
  }
  // 🧰 OFF (the default): one quiet line. The FS lines are off the report, counts, quote
  // and job request; the per-report ON switch is right here for the odd car we do them on.
  if (!crm || (crm.collision !== false && !fs?.on)) {
    const held = items.filter(f => !f.optional)
    return (
      <div className="rounded-lg px-3 py-2 mb-4 flex items-center justify-between gap-2 flex-wrap text-xs" style={{ backgroundColor: '#f5f3f0', border: '1px solid #e0dbd6', color: '#555' }}>
        <span>🧰 <b style={{ color: INK }}>Full Service off</b>{shop ? ` for ${shop}` : ''}{crm ? '' : ' (checking the CRM…)'} — {held.length ? `${held.length} line${held.length > 1 ? 's' : ''} held back: ${held.map(f => f.label).join(', ')}` : 'nothing on this estimate for it'}.{crm && !crm.inCrm && shop ? ` ${shop} isn't in the CRM yet.` : ''}</span>
        {crm && scrubId && <span className="flex gap-1 items-center"><span className="text-[10px] font-bold" style={{ color: '#1F8B8B' }}>THIS REPORT:</span>{seg('', `CRM (${crm.on ? 'ON' : 'OFF'})`)}{seg('on', 'ON')}</span>}
        {msg && <span className="w-full text-[11px] font-semibold" style={{ color: msg.startsWith('Saved') || msg.startsWith('This report') || msg.startsWith('Back') ? '#166534' : '#b91c1c' }}>{msg}</span>}
      </div>
    )
  }
  return (
    <div className="rounded-xl p-3 mb-4" style={{ border: '2px solid #1F8B8B', backgroundColor: '#e6f4f4' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-extrabold" style={{ color: '#1F8B8B' }}>🧰 Full Service on this car</div>
        {crm && crm.collision !== false && <div className="flex gap-1 items-center">
          <span className="text-[10px] font-bold mr-1" style={{ color: '#1F8B8B' }}>THIS REPORT:</span>
          {seg('', `CRM default (${crm.on ? 'ON' : 'OFF'})`)}{seg('on', 'ON')}{seg('off', 'OFF')}
        </div>}
      </div>
      {override && <div className="text-[11px] mb-1 font-semibold" style={{ color: '#1F8B8B' }}>Override for this report only — {shop} stays {crm?.on ? 'ON' : 'OFF'} in the CRM. The PDF, online report and quote follow this switch.</div>}
      <div className="text-[11px] mb-2" style={{ color: '#555' }}>{!shop ? 'Required follow-up work. No shop on this scrub.'
        : fs && !fs.collision ? `Required follow-up work. ${shop} isn't a collision shop, so this is billed as normal work.`
        : fs && !fs.on ? `Required follow-up work. Full Service is OFF for ${shop}: the shop does it, and our report says so. Turn it on in CRM → Billing once it's agreed with the shop.`
        : `Required follow-up work. ${shop} is on Full Service; 💰 = offer it to the shop.`}</div>
      <div className="grid gap-2">
        {shown.map(f => {
          const m = fsMode(fs?.rules, f.key), isSet = !!fs?.set?.[f.key]
          return (
            <div key={f.key} className="rounded-lg p-2" style={{ backgroundColor: '#fff', border: '1px solid #bae6fd' }}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-bold" style={{ color: INK }}>{f.emoji} {f.label} {m === 'ask' && fs?.on && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>💰 Offer</span>}{!isSet && <span className="text-[10px] ml-1" style={{ color: '#999' }}>no rule yet</span>}</div>
                {fs?.on && fs?.collision && <div className="flex gap-1">
                  {Object.entries(FS_MODE).map(([k, v]) => (
                    <button key={k} onClick={() => pick(f.key, k)} disabled={!shop || !!busy || !fs?.inCrm} className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                      style={m === k ? { backgroundColor: v.bg, color: '#fff' } : { backgroundColor: '#fff', color: v.bg, border: `1px solid ${v.bg}`, opacity: busy === f.key ? .5 : 1 }}>{v.label}</button>
                  ))}
                </div>}
                {!(fs?.on && fs?.collision) && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: (FS_MODE[m] || FS_MODE.shop).bg, color: '#fff' }}>{m === 'shop' ? 'Shop does it' : 'We do it'}</span>}
              </div>
              <div className="text-[11px] mt-1" style={{ color: '#666' }}>{f.rows.map(r => `${r.name}${r.lines ? ` (line ${r.lines})` : ''}`).join(' · ')}</div>
            </div>
          )
        })}
      </div>
      {fs && !fs.inCrm && shop && <div className="text-[11px] mt-1.5" style={{ color: '#b45309' }}>{shop} isn't in the CRM yet. Add it there to save a rule.</div>}
      {msg && <div className="text-[11px] mt-1.5 font-semibold" style={{ color: msg.startsWith('Saved') ? '#166534' : '#b91c1c' }}>{msg}</div>}
    </div>
  )
}

function WhyBtn({ onClick }) {
  return <button onClick={e => { e.stopPropagation(); onClick() }} title="Why?" className="ml-2 rounded-full px-1.5 py-0.5 text-xs" style={{ backgroundColor: '#fdf3ef' }}>✨</button>
}
// ✨ Kinetic-style "Why is this required?" — Q / A / OEM reference + open-at-page.
function WhyModal({ r, onClose }) {
  const name = String(r.name || '').replace(/\s*calibration$/i, '')
  const q = r.required === false ? `Why isn't a ${name} calibration required?` : `Why is a ${name}${r.type ? ` – ${r.type}` : ''} ${r.always ? '' : 'calibration '}required?`.replace(/\s+required/, ' required')
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} className="rounded-t-2xl sm:rounded-2xl sm:mb-10" style={{ background: '#fff', maxWidth: 620, width: '100%', maxHeight: '80vh', overflow: 'auto', padding: 18, position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', right: 12, top: 10, fontSize: 18, color: '#666' }}>✕</button>
        <h3 className="font-bold pr-8" style={{ color: INK }}>Q: {q}</h3>
        <p className="text-sm mt-2" style={{ color: '#333' }}><b>A:</b> {r.why || (r.required === false ? 'No operation on this estimate disturbs this sensor.' : 'Required by the vehicle manufacturer for this repair.')}</p>
        {(r.refs || []).map(x => (
          <div key={x.n} className="rounded-lg p-2.5 mt-2.5 text-xs" style={{ backgroundColor: '#f4f2f0', border: '1px solid #e0dbd6', borderLeft: `4px solid ${ORANGE}`, color: INK }}>
            <b style={{ color: ORANGE }}>OEM Reference:</b> Attachment {x.n} — {x.title}{x.pages?.length ? `, see page${x.pages.length > 1 ? 's' : ''} ${x.pages.join(', ')}` : ''}
            <div><a href={x.href} target="_blank" rel="noreferrer" className="inline-block mt-2 rounded-lg px-3 py-1.5 font-bold" style={{ backgroundColor: ORANGE, color: '#fff' }}>Open the OEM document{x.pages?.[0] ? ` at page ${x.pages[0]}` : ''} ↗</a></div>
          </div>
        ))}
        {(r.named || []).map(t => <div key={t} className="rounded-lg p-2.5 mt-2.5 text-xs" style={{ backgroundColor: '#f4f2f0', borderLeft: `4px solid ${ORANGE}` }}><b style={{ color: ORANGE }}>OEM Reference:</b> {t}</div>)}
      </div>
    </div>
  )
}

function LineRow({ c, i, zebra, editing, vehicle, expanded, onToggle, onFlip, onPatch, onRewrite, aiBusy, onRemove, onWhy, onFeedback, fbBusy, fbFlash }) {
  const lit = !!(c.required || c.onReport)
  const dim = !lit
  const cell = { border: '1.5px solid #ddd', borderRadius: 6, padding: '3px 6px', fontSize: 12, width: '100%' }
  const shade = (zebra ?? i) % 2 ? '#fafafa' : '#fff'   // zebra = display position (the table is sorted); i = the real line index
  const nissanBat = nissanBatteryLine(c, vehicle)
  const marks = [
    c.added ? `added${c.by ? ` · ${c.by}` : ''}` : '',
    !c.added && c.edited ? 'edited' : '',
    c.guard ? 'rule' : '',
    c.learned ? 'learned' : '',
    fsItemFor(c.name) && !nissanBat ? 'Full Service' : '',
  ].filter(Boolean)
  const typeLabel = c.classification || (c.required ? (c.type || 'Required') : 'not required')
  const typeStyle = {
    display: 'inline-block',
    whiteSpace: 'nowrap',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: '18px',
    padding: '2px 6px',
    borderRadius: 4,
    backgroundColor: lit ? ORANGE : (c.classification || c.required ? '#f5f3f0' : '#eee'),
    color: lit ? '#fff' : (c.classification || c.required ? '#444' : '#888'),
  }
  return (
    <>
      <tr style={{ backgroundColor: shade, borderBottom: '1px solid #f0f0f0' }}>
        <td className="py-2.5 px-3 font-bold align-top" style={{ color: dim ? '#999' : INK }}>
          <span onClick={editing ? onFlip : undefined} style={{ color: lit ? ORANGE : '#ccc', marginRight: 6, cursor: editing ? 'pointer' : 'default', fontSize: 16 }} title={editing ? 'Flip required / not required' : ''}>●</span>
          <span onClick={onToggle} style={{ cursor: 'pointer' }}>
            {(c.why || editing) ? <span style={{ color: '#bbb', marginRight: 4 }}>{expanded ? '⌄' : '›'}</span> : null}
            {c.title || c.name}
          </span>
          {onWhy && <WhyBtn onClick={onWhy} />}
        </td>
        <td className="py-2.5 px-3 align-top" style={{ color: dim ? '#aaa' : '#444', lineHeight: 1.45 }}>
          {editing ? <input value={c.trigger} onChange={e => onPatch({ trigger: e.target.value })} placeholder="repair that disturbs it" style={cell} /> : (c.trigger || '—')}
        </td>
        <td className="py-2.5 px-3 font-mono text-xs align-top" style={{ color: dim ? '#aaa' : '#444', whiteSpace: 'nowrap' }}>
          {editing ? <input value={c.lines} onChange={e => onPatch({ lines: e.target.value })} placeholder="3-4, 13" style={{ ...cell, width: 64 }} /> : (c.lines || '—')}
        </td>
        <td className="py-2.5 px-3 align-top" style={{ whiteSpace: 'nowrap' }}>
          {editing
            ? <select value={c.type || ''} onChange={e => onPatch({ type: e.target.value })} style={{ ...cell, width: 130 }}><option value="">—</option>{CAL_TYPES.map(t => <option key={t}>{t}</option>)}</select>
            : <span style={typeStyle}>{typeLabel}</span>}
        </td>
        {!editing && onFeedback && (
          <td className="py-2.5 px-3 text-right align-top" style={{ whiteSpace: 'nowrap' }}>
            {!lit && (
              <button type="button" onClick={e => { e.stopPropagation(); onFeedback('miss') }}
                className="inline-flex items-center justify-center font-extrabold rounded-md cursor-pointer"
                style={{ height: 28, padding: '0 10px', fontSize: 11, backgroundColor: fbBusy === `miss:${c.name}` ? '#ddd' : '#fff', color: ORANGE, border: `1px solid ${ORANGE}` }}
                title={c.guard === 'demoted' ? 'A hard rule demoted this, so Missed leaves it off.' : 'We should have required this — the next similar car will'}>{fbBusy === `miss:${c.name}` ? '…' : 'Missed'}</button>
            )}
            {c.required && !c.guard && (
              <button type="button" onClick={e => { e.stopPropagation(); onFeedback('extra') }}
                className="inline-flex items-center justify-center font-extrabold rounded-md cursor-pointer"
                style={{ height: 28, padding: '0 10px', fontSize: 11, backgroundColor: fbBusy === `extra:${c.name}` ? '#ddd' : '#fff', color: '#777', border: `1px solid ${BRAND.line}` }}
                title="We should not have required this">{fbBusy === `extra:${c.name}` ? '…' : 'Extra'}</button>
            )}
            {marks.length > 0 && <div style={{ marginTop: 4, fontSize: 10, fontWeight: 600, color: '#999', whiteSpace: 'nowrap' }}>{marks.join(' · ')}</div>}
            {fbFlash && <div className="text-[11px] font-semibold mt-1 whitespace-normal text-right" style={{ color: fbFlash.ok ? '#166534' : '#b91c1c', maxWidth: 120 }}>{fbFlash.text}</div>}
          </td>
        )}
        {editing && <td className="py-2.5 px-2 text-right"><button onClick={onRemove} title="Remove this line" style={{ color: '#b91c1c', fontWeight: 700 }}>✕</button></td>}
      </tr>
      {expanded && (c.why || editing) && (
        <tr style={{ backgroundColor: '#fff7ed' }}>
          <td colSpan={5} className="px-3 py-2.5 text-xs" style={{ color: '#444', borderBottom: '1px solid #f0f0f0' }}>
            {editing
              ? <div>
                  <textarea value={c.why} onChange={e => onPatch({ why: e.target.value })} rows={3} style={{ ...cell, fontFamily: 'inherit' }} placeholder="Why this calibration is required — or press 🪄 and it is written from the trigger and lines above" />
                  <button onClick={onRewrite} disabled={aiBusy} className="mt-1 rounded-lg px-2.5 py-1 text-[11px] font-bold" style={{ backgroundColor: '#f5f3f0', color: '#0A0A0A', border: '1.5px solid #c4bfb8' }}>{aiBusy ? 'Writing…' : '🪄 AI rewrite from the reason'}</button>
                </div>
              : c.why}
          </td>
        </tr>
      )}
    </>
  )
}
