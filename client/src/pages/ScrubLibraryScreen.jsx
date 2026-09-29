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
  job:      { label: 'on the board', bg: '#fff7ed', fg: '#b45309' },
  invoiced: { label: 'invoiced', bg: '#dcfce7', fg: '#166534' },
  paid:     { label: 'paid',     bg: '#166534', fg: '#fff' },
}
function StagePill({ s }) {
  const st = STAGE[s.stage] || STAGE.scrubbed
  const detail = s.invoiceNumber ? ` ${s.invoiceNumber}` : s.quoteNumber ? ` ${s.quoteNumber}` : ''
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap" style={{ backgroundColor: st.bg, color: st.fg }}>{st.label}{detail}</span>
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

export default function ScrubLibraryScreen() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)
  const [openBusy, setOpenBusy] = useState(false)
  const timer = useRef(null)

  const load = async (search = '') => {
    setLoading(true); setErr('')
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs?limit=100${search ? `&q=${encodeURIComponent(search)}` : ''}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setRows(Array.isArray(d.scrubs) ? d.scrubs : [])
    } catch (e) { setErr(e.message || 'Could not load the library.'); setRows([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { load(''); apiFetch(`${API_BASE}/api/scrubs/stats`).then(r => r.json()).then(setStats).catch(() => {}) }, [])
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

  if (open || openBusy) {
    return openBusy
      ? <div className="p-10 text-center text-sm" style={{ color: '#777' }}>Opening…</div>
      : <ScrubReport s={open} onBack={() => setOpen(null)} />
  }

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: INK }}>Scrubs</h1>
          <p className="text-xs mt-0.5" style={{ color: '#888' }}>
            {loading ? 'Loading…' : `${rows.length} shown`}{stats?.total ? ` · ${stats.total} in the library` : ''}
          </p>
        </div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search vehicle, RO, VIN, claim, shop, sensor…"
          className="rounded-lg px-3 py-2 text-sm"
          style={{ border: '1.5px solid #ddd', outline: 'none', minWidth: 280 }}
        />
      </div>

      {err && (
        <div className="rounded-xl p-3 mb-3 text-sm" style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1.5px solid #fecaca' }}>{err}</div>
      )}

      {!loading && !rows.length && !err && (
        <div className="rounded-xl p-8 text-center text-sm" style={{ backgroundColor: '#f5f3f0', color: '#777' }}>
          {q ? `Nothing matches "${q}".` : 'No scrubs yet. Press 🔬 Scrub estimate on a job card to run the first one.'}
        </div>
      )}

      {/* Desktop table */}
      {!!rows.length && (
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
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr
                  key={s.id}
                  onClick={() => openScrub(s)}
                  className="cursor-pointer hover:bg-gray-50"
                  style={{ borderBottom: '1px solid #f0f0f0' }}
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
                    <div className="text-xs font-mono flex items-center gap-2" style={{ color: ORANGE }}>{s.ro ? `RO ${s.ro}` : 'no RO'}<StagePill s={s} />{statusNote(s) && <span className="text-[10px] font-sans" style={{ color: '#999' }}>{statusNote(s)}</span>}</div>
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-xs" style={{ color: '#555' }}>{s.vin || '—'}</td>
                  <td className="py-2.5 pr-3 font-mono text-xs" style={{ color: '#555' }}>{s.claim || '—'}</td>
                  <td className="py-2.5 pr-3 text-xs" style={{ color: '#555' }}>{s.shop || '—'}</td>
                  <td className="py-2.5 pr-3 text-xs" style={{ color: '#888' }}>{shortWhen(s.at)}</td>
                  <td className="py-2.5 text-right pr-2" style={{ color: ORANGE }}>→</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Phone cards */}
      <div className="md:hidden grid gap-2">
        {rows.map(s => (
          <button key={s.id} onClick={() => openScrub(s)} className="text-left rounded-xl p-3 w-full"
            style={{ backgroundColor: '#fff', border: `2px solid ${s.requiredCount ? ORANGE : '#e5e5e5'}` }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold truncate" style={{ color: INK }}>{s.vehicle || 'Vehicle not read'}</div>
                <div className="text-xs font-mono flex items-center gap-2" style={{ color: ORANGE }}>{s.ro ? `RO ${s.ro}` : 'no RO'}<StagePill s={s} /></div>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{ backgroundColor: s.requiredCount ? ORANGE : '#f5f3f0', color: s.requiredCount ? '#fff' : '#777' }}>
                {s.requiredCount} of {s.sensorCount}
              </span>
            </div>
            <div className="text-[11px] mt-1" style={{ color: '#666' }}>{s.shop || '—'}</div>
            <div className="text-[10px] mt-0.5 font-mono" style={{ color: '#999' }}>{s.vin || '—'}</div>
            <div className="text-[10px] mt-0.5" style={{ color: '#999' }}>{shortWhen(s.at)}</div>
          </button>
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
  added: !!c._added, edited: !!c._edited, by: c._by || '',
})
const fromLine = l => ({
  calibration_name: l.name, cal_type: l.type || null, trigger: l.trigger || null,
  line_references: l.lines || null, justification: l.why || '', enabled: !!l.required,
  ...(l.added ? { _added: true, _by: l.by } : {}), ...(l.edited ? { _edited: true, _by: l.by } : {}),
})

function ScrubReport({ s: initial, onBack }) {
  const [s, setS] = useState(initial)
  const [cardBusy, setCardBusy] = useState(false)
  const [cardMsg, setCardMsg] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfErr, setPdfErr] = useState('')
  const [expanded, setExpanded] = useState({})
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [aiBusy, setAiBusy] = useState(-1)
  const [estUrl, setEstUrl] = useState('')      // two-tap open (never window.open after an await — iOS PWA rule)
  const [estBusy, setEstBusy] = useState(false)
  const [add, setAdd] = useState({ name: '', type: 'Static', lines: '', reason: '', why: '', busy: false })

  const p = s.payload || {}
  const list = useMemo(() => {
    const cals = Array.isArray(p.calibrations) ? p.calibrations : []
    return cals.length ? cals.map(toLine) : (s.sensors || []).map(x => ({ name: x.n, type: x.t, required: x.r, lines: x.l, trigger: x.g, why: '' }))
  }, [s]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = editing ? draft : list
  const required = shown.filter(c => c.required)

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
      <div className="flex flex-col lg:flex-row gap-5">

        {/* Left rail */}
        <div className="lg:w-72 shrink-0">
          <h1 className="text-2xl font-bold leading-tight" style={{ color: INK }}>{s.vehicle || 'Vehicle not read'}</h1>
          {s.ro && <p className="text-sm font-mono font-bold mt-1" style={{ color: ORANGE }}>RO {s.ro}</p>}
          <p className="text-sm mt-3" style={{ color: '#444' }}><span className="font-bold">VIN:</span> <span className="font-mono">{s.vin || '—'}</span></p>
          <p className="text-sm mt-1" style={{ color: '#444' }}><span className="font-bold">Updated:</span> {when(s.at) || '—'}</p>
          <p className="text-sm mt-1" style={{ color: '#444' }}><span className="font-bold">By:</span> {s.by || sourceLabel(s.source)}</p>
          <p className="text-sm mt-1 flex items-center gap-2" style={{ color: '#444' }}><span className="font-bold">Stage:</span> <StagePill s={s} /></p>
          {s.quoteNumber && s.quoteNumber !== s.invoiceNumber && <p className="text-sm mt-1" style={{ color: '#444' }}><span className="font-bold">Quote:</span> {s.quoteNumber}</p>}
          {s.status === 'edited' && <p className="text-xs mt-1" style={{ color: '#b45309' }}>✏️ Lines edited by hand{p._edited_by ? ` · ${p._edited_by}` : ''}</p>}

          <button onClick={downloadPdf} disabled={pdfBusy || editing || (!shown.length && !hasStoredReport)}
            className="mt-4 w-full rounded-lg px-3 py-2.5 text-sm font-bold"
            style={{ backgroundColor: pdfBusy ? '#f5f3f0' : ORANGE, color: pdfBusy ? '#777' : '#fff', opacity: (shown.length || hasStoredReport) && !editing ? 1 : 0.5 }}
          >{pdfBusy ? 'Building…' : (!list.length && hasStoredReport) ? '📄 Report that went out ↓' : '📄 Absolute ADAS report ↓'}</button>

          {!editing
            ? <button onClick={startEdit} className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#fff', color: INK, border: '1.5px solid #ddd' }}>✏️ Edit calibration lines</button>
            : <div className="mt-2 grid grid-cols-2 gap-2">
                <button onClick={save} disabled={saving} className="rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#166534', color: '#fff' }}>{saving ? 'Saving…' : '✓ Save'}</button>
                <button onClick={cancelEdit} disabled={saving} className="rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#fff', color: '#777', border: '1.5px solid #ddd' }}>Cancel</button>
              </div>}

          {s.fileId && (estUrl
            ? <a href={estUrl} target="_blank" rel="noreferrer" className="mt-2 block text-center w-full rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#eff6ff', color: '#1e40af', border: '1.5px solid #93c5fd' }}>📎 Open the estimate (tap again)</a>
            : <button onClick={fetchEstimate} disabled={estBusy} className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: '#fff', color: '#1e40af', border: '1.5px solid #93c5fd' }}>{estBusy ? 'Fetching…' : '📎 Open the CCC estimate'}</button>)}

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
                <Fact k="VIN" v={s.vin} />
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
