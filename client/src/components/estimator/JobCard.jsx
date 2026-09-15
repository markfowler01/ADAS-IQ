// One job on the estimator (spec §5 UI): header = drag handle · name ·
// category · status pills · job total; body = lines (labor) with parts
// nested under each line. Collapsed by default once it has a line.
// Every amount shown comes from the shared engine (cents in, dollars out).
import { useState, useEffect } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { Chip, Eyebrow, ORANGE, GREEN, BLUE } from '../ui/ReviewKit.jsx'
import { RATE_KEYS, RATE_LABELS, PART_SOURCES, JOB_STATUSES, JOB_CATEGORIES, fmtCents, fromCents, toCents, blankLine, blankPart, effectiveRate } from '../../lib/estimatorCalc.js'

export const STATUS_STYLE = {
  recommended: { bg: '#eff6ff', fg: BLUE, border: '#bfdbfe', label: 'Recommended' },
  approved:    { bg: '#dcfce7', fg: GREEN, border: '#86efac', label: 'Approved' },
  declined:    { bg: '#fee2e2', fg: '#b91c1c', border: '#fecaca', label: 'Declined' },
  deferred:    { bg: '#f5f3f0', fg: '#666', border: '#e0dbd6', label: 'Deferred' },
}
const CAT_EMOJI = { calibration: '🎯', diagnostic: '🔍', mechanical: '🔧', programming: '💾', sublet: '🤝' }
const SRC_LABEL = { oem: 'OEM', aftermarket: 'A/M', recycled: 'Used', reconditioned: 'Recon', sublet: 'Sublet' }
const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white', borderRadius: 8 }

/** Dollar input that edits cents: shows 1234.50, commits on blur / Enter. */
export function Money({ cents, onChange, placeholder = '0.00', bold = false, width = 92, disabled = false, muted = false }) {
  const [txt, setTxt] = useState(cents == null || cents === '' ? '' : fromCents(cents))
  useEffect(() => { setTxt(cents == null || cents === '' ? '' : fromCents(cents)) }, [cents])
  const commit = () => { const v = txt.trim() === '' ? null : toCents(txt); if (v !== cents) onChange(v); setTxt(v == null ? '' : fromCents(v)) }
  return <input value={txt} disabled={disabled} onChange={e => setTxt(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && e.target.blur()} inputMode="decimal" placeholder={placeholder}
    className={`px-2 py-1 text-sm text-right tabular-nums ${bold ? 'font-bold' : ''}`} style={{ ...inp, width, color: muted ? '#999' : '#1a1a1a', fontStyle: muted ? 'italic' : 'normal' }} />
}
function Txt({ value, onChange, placeholder, className = '', style = {}, disabled }) {
  const [v, setV] = useState(value || '')
  useEffect(() => { setV(value || '') }, [value])
  return <input value={v} disabled={disabled} onChange={e => setV(e.target.value)} onBlur={() => v !== (value || '') && onChange(v)} onKeyDown={e => e.key === 'Enter' && e.target.blur()} placeholder={placeholder} className={`px-2 py-1 text-sm ${className}`} style={{ ...inp, ...style }} />
}
function Num({ value, onChange, step = 0.1, width = 64, disabled }) {
  const [v, setV] = useState(String(value ?? ''))
  useEffect(() => { setV(String(value ?? '')) }, [value])
  return <input value={v} disabled={disabled} onChange={e => setV(e.target.value)} onBlur={() => { const n = Number(v); if (Number.isFinite(n) && n !== Number(value)) onChange(n) }} onKeyDown={e => e.key === 'Enter' && e.target.blur()} inputMode="decimal" step={step} className="px-2 py-1 text-sm text-right tabular-nums" style={{ ...inp, width }} />
}
/** Parts markup as a percent on cost (40 = +40%). Blank / equal to the estimate box = follows the box. */
export function MarkupBox({ bp, estMarkup = 4000, onChange, disabled, width = 56 }) {
  const eff = bp == null ? estMarkup : bp
  const fmtPct = b => String(Math.round(b) / 100).replace(/\.0+$/, '')
  const [txt, setTxt] = useState(fmtPct(eff))
  useEffect(() => { setTxt(fmtPct(bp == null ? estMarkup : bp)) }, [bp, estMarkup])
  const commit = () => { const pct = Number(String(txt).replace('%', '')); if (!Number.isFinite(pct) || pct < 0) { setTxt(fmtPct(eff)); return } const nb = Math.round(pct * 100); onChange(nb === estMarkup ? null : nb) }
  return <input value={txt} disabled={disabled} onChange={e => setTxt(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && e.target.blur()} inputMode="decimal" title="Markup on cost, in percent (40 = cost + 40%). Blank follows the estimate's box." className="px-2 py-1 text-sm text-right tabular-nums" style={{ ...inp, width, color: bp == null ? '#999' : '#1a1a1a', fontStyle: bp == null ? 'italic' : 'normal' }} />
}
const Sel = ({ value, onChange, options, labels = {}, width, disabled }) => (
  <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className="px-1.5 py-1 text-xs font-semibold" style={{ ...inp, width, color: '#444' }}>
    {options.map(o => <option key={o} value={o}>{labels[o] || o}</option>)}
  </select>
)

export default function JobCard({ job, settings, catalog = [], canEdit, onPatch, onStatus, onDuplicate, onDelete, onSaveTemplate, dragProps = {}, forceOpen = false, usual = null, vehicle = '' }) {
  // Learned pricing nudge: this job is usually billed at X (median of past saves); flag a >15% drift.
  const drift = usual && usual.count >= 2 && usual.usual_cents > 0 && job.total_cents > 0 ? (job.total_cents - usual.usual_cents) / usual.usual_cents : 0
  const drifted = Math.abs(drift) > 0.15
  const [open, setOpen] = useState(forceOpen || !(job.lines || []).length)
  const [catQ, setCatQ] = useState('')
  const [addingCat, setAddingCat] = useState(false)
  const [rick, setRick] = useState(null)      // { busy, text, err }
  const st = STATUS_STYLE[job.status] || STATUS_STYLE.recommended
  const rates = settings?.rates || {}
  const estRate = settings?.labor_rate_cents ?? null           // the box at the top of the estimate
  const estMarkup = settings?.parts_markup_bp ?? 4000          // 40% on cost by default
  const mult = bp => (1 + (bp ?? estMarkup) / 10000)
  const lines = job.lines || []
  const setLines = next => onPatch({ lines: next })
  const patchLine = (id, f) => setLines(lines.map(l => l.id === id ? { ...l, ...f } : l))
  const patchPart = (lid, pid, f) => setLines(lines.map(l => l.id === lid ? { ...l, parts: (l.parts || []).map(p => p.id === pid ? { ...p, ...f } : p) } : l))
  const addLine = (extra = {}) => { setLines([...lines, { ...blankLine(job.category === 'calibration' ? 'calibration' : job.category === 'diagnostic' ? 'diagnostic' : job.category === 'programming' ? 'programming' : 'mechanical'), ...extra }]); setOpen(true) }
  const addPart = lid => setLines(lines.map(l => l.id === lid ? { ...l, parts: [...(l.parts || []), blankPart()] } : l))
  const catHits = catQ.trim() ? catalog.filter(it => it.name.toLowerCase().includes(catQ.trim().toLowerCase())).slice(0, 8) : []
  const dim = job.status === 'declined' || job.status === 'deferred'

  const { onHandleDown, style: dragStyle, ...dragRest } = dragProps
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1.5px solid ${job.status === 'approved' ? '#86efac' : '#e8e4e0'}`, backgroundColor: 'white', opacity: dim ? .7 : 1, ...(dragStyle || {}) }} {...dragRest}>
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-2 flex-wrap" style={{ backgroundColor: job.status === 'approved' ? '#f0fdf4' : '#faf9f7', borderBottom: open ? '1px solid #eee' : 'none' }}>
        {canEdit && <span title="Drag to reorder" onMouseDown={dragProps.onHandleDown} className="cursor-grab select-none text-lg leading-none" style={{ color: '#bbb' }}>⋮⋮</span>}
        <button type="button" onClick={() => setOpen(o => !o)} className="text-xs font-bold w-5 text-center" style={{ color: '#888' }}>{open ? '▾' : '▸'}</button>
        <span>{CAT_EMOJI[job.category] || '🔧'}</span>
        <Txt value={job.name} onChange={v => onPatch({ name: v })} disabled={!canEdit} placeholder="Job name (e.g. Front camera calibration)" className="font-bold flex-1 min-w-[160px]" style={{ border: 'none', backgroundColor: 'transparent', padding: '2px 4px', fontSize: 15 }} />
        {canEdit ? <Sel value={job.category} onChange={v => onPatch({ category: v })} options={JOB_CATEGORIES} labels={{ calibration: 'Calibration', diagnostic: 'Diagnostic', mechanical: 'Mechanical', programming: 'Programming', sublet: 'Sublet' }} width={110} /> : <Chip>{job.category}</Chip>}
        <div className="flex gap-1">
          {JOB_STATUSES.map(s => { const x = STATUS_STYLE[s]; const on = job.status === s; return (
            <button key={s} type="button" disabled={!canEdit} onClick={() => !on && onStatus(s)} className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ backgroundColor: on ? x.fg : 'white', color: on ? 'white' : x.fg, border: `1.5px solid ${on ? x.fg : x.border}` }}>{x.label}</button>
          ) })}
        </div>
        <div className="ml-auto text-right">
          <div className="font-extrabold tabular-nums" style={{ color: job.status === 'approved' ? GREEN : '#1a1a1a', fontSize: 17 }}>{fmtCents(job.total_cents)}</div>
          {!open && <div className="text-[10px]" style={{ color: '#888' }}>{lines.length} line{lines.length === 1 ? '' : 's'} · labor {fmtCents(job.labor_cents)} · parts {fmtCents(job.parts_cents)}</div>}
          {drifted && <div className="text-[10px] font-bold" style={{ color: '#92400e' }}>🤖 Rick: usually {fmtCents(usual.usual_cents)} · {drift > 0 ? '+' : ''}{Math.round(drift * 100)}%</div>}
        </div>
      </div>
      {job.status === 'approved' && job.authorized_by_name && (
        <div className="px-3 py-1 text-[11px]" style={{ backgroundColor: '#f0fdf4', color: '#166534', borderBottom: open ? '1px solid #dcfce7' : 'none' }}>
          ✅ Authorized {fmtCents(job.authorized_amount_cents)} · {job.authorized_method} · by {job.authorized_by_name} · taken by {job.authorized_by_employee} · {String(job.authorized_at || '').slice(0, 16).replace('T', ' ')}
        </div>
      )}
      {job.status === 'declined' && job.decline_reason && <div className="px-3 py-1 text-[11px]" style={{ backgroundColor: '#fef2f2', color: '#991b1b' }}>Declined · {job.decline_reason}</div>}

      {open && (
        <div className="px-2.5 py-2 space-y-2">
          {lines.length === 0 && <div className="text-xs italic px-1" style={{ color: '#999' }}>No lines yet. Add labor, or pick a calibration straight from Zoho Books.</div>}
          {lines.map((l, li) => (
            <div key={l.id} className="rounded-lg" style={{ border: '1px solid #f1ede9', backgroundColor: '#fffdfb' }}>
              {/* Labor line */}
              <div className="flex items-center gap-1.5 px-2 py-1.5 flex-wrap">
                <span className="text-[10px] font-bold w-5 text-center" style={{ color: '#bbb', fontFamily: 'IBM Plex Mono, monospace' }}>{li + 1}</span>
                <Txt value={l.desc} onChange={v => patchLine(l.id, { desc: v })} disabled={!canEdit} placeholder="Labor operation" className="flex-1 min-w-[180px]" />
                {l.flat_cents == null ? (<>
                  <Sel value={l.rate_key} onChange={v => patchLine(l.id, { rate_key: v })} options={RATE_KEYS} labels={RATE_LABELS} width={104} disabled={!canEdit} />
                  <Num value={l.hours} onChange={v => patchLine(l.id, { hours: Math.round(v * 10) / 10 })} disabled={!canEdit} />
                  <span className="text-[10px]" style={{ color: '#999' }}>hr ×</span>
                  <Money cents={l.rate_override_cents ?? effectiveRate(l, rates, estRate)} onChange={v => patchLine(l.id, { rate_override_cents: v == null || v === effectiveRate({ ...l, rate_override_cents: null }, rates, estRate) ? null : v })} width={78} disabled={!canEdit} muted={l.rate_override_cents == null} />
                </>) : (<>
                  <Chip tone="orange">Books price</Chip>
                  <Money cents={l.flat_cents} onChange={v => patchLine(l.id, { flat_cents: v ?? 0 })} width={86} disabled={!canEdit} />
                </>)}
                <label className="flex items-center gap-1 text-[10px]" style={{ color: '#888' }}><input type="checkbox" checked={l.taxable !== false} disabled={!canEdit} onChange={e => patchLine(l.id, { taxable: e.target.checked })} />tax</label>
                <span className="font-bold tabular-nums text-sm w-[76px] text-right" style={{ color: '#1a1a1a' }}>{fmtCents(l.labor_cents)}</span>
                {canEdit && <button type="button" onClick={() => setLines(lines.filter(x => x.id !== l.id))} className="text-xs px-1" style={{ color: '#bbb' }} title="Remove line">✕</button>}
              </div>
              {/* Parts */}
              {(l.parts || []).map(p => (
                <div key={p.id} className="flex items-center gap-1.5 pl-8 pr-2 py-1 flex-wrap" style={{ borderTop: '1px dashed #f1ede9' }}>
                  <span className="text-[10px]" style={{ color: '#bbb' }}>part</span>
                  <Txt value={p.pn} onChange={v => patchPart(l.id, p.id, { pn: v })} disabled={!canEdit} placeholder="Part #" style={{ width: 96, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }} />
                  <Txt value={p.desc} onChange={v => patchPart(l.id, p.id, { desc: v })} disabled={!canEdit} placeholder="Description" className="flex-1 min-w-[140px]" />
                  <Sel value={p.source} onChange={v => patchPart(l.id, p.id, { source: v })} options={PART_SOURCES} labels={SRC_LABEL} width={78} disabled={!canEdit} />
                  <Num value={p.qty} onChange={v => patchPart(l.id, p.id, { qty: v })} step={1} width={48} disabled={!canEdit} />
                  <span className="text-[10px]" style={{ color: '#999' }}>×</span>
                  <Money cents={p.cost_cents} onChange={v => patchPart(l.id, p.id, { cost_cents: v ?? 0 })} width={78} disabled={!canEdit} />
                  <span className="text-[10px]" style={{ color: '#999' }}>cost +</span>
                  <MarkupBox bp={p.markup_bp} estMarkup={estMarkup} onChange={bp => patchPart(l.id, p.id, { markup_bp: bp })} disabled={!canEdit} />
                  <span className="text-[10px]" style={{ color: '#999' }}>% =</span>
                  <Money cents={p.price_cents ?? p.price_each_cents} onChange={v => patchPart(l.id, p.id, { price_cents: v })} width={78} disabled={!canEdit} muted={p.price_cents == null} />
                  <label className="flex items-center gap-1 text-[10px]" style={{ color: '#888' }}><input type="checkbox" checked={p.taxable !== false} disabled={!canEdit} onChange={e => patchPart(l.id, p.id, { taxable: e.target.checked })} />tax</label>
                  <span className="font-semibold tabular-nums text-sm w-[76px] text-right" style={{ color: '#444' }}>{fmtCents(p.total_cents)}</span>
                  {canEdit && <button type="button" onClick={() => patchLine(l.id, { parts: l.parts.filter(x => x.id !== p.id) })} className="text-xs px-1" style={{ color: '#bbb' }}>✕</button>}
                </div>
              ))}
              {canEdit && <div className="pl-8 py-1"><button type="button" onClick={() => addPart(l.id)} className="text-[11px] font-bold" style={{ color: BLUE }}>＋ part</button></div>}
            </div>
          ))}

          {canEdit && (
            <div className="flex flex-wrap gap-1.5 items-center pt-1">
              <button type="button" onClick={() => addLine()} className="text-xs font-bold rounded-lg px-2.5 py-1.5 text-white" style={{ backgroundColor: ORANGE }}>＋ Labor line</button>
              <button type="button" onClick={() => setAddingCat(a => !a)} className="text-xs font-bold rounded-lg px-2.5 py-1.5" style={{ backgroundColor: '#fff5f0', color: ORANGE, border: `1px solid #f5c9b8` }}>🎯 Calibration from Books</button>
              <span className="flex-1" />
              <button type="button" onClick={onSaveTemplate} className="text-[11px] font-semibold px-2 py-1 rounded-lg" style={{ backgroundColor: '#f5f3f0', color: '#666' }}>Save as template</button>
              <button type="button" onClick={onDuplicate} className="text-[11px] font-semibold px-2 py-1 rounded-lg" style={{ backgroundColor: '#f5f3f0', color: '#666' }}>Duplicate</button>
              <button type="button" onClick={onDelete} className="text-[11px] font-semibold px-2 py-1 rounded-lg" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>Delete job</button>
            </div>
          )}
          {addingCat && canEdit && (
            <div className="rounded-lg p-2" style={{ backgroundColor: '#fff5f0', border: '1px solid #f5c9b8' }}>
              <Eyebrow>Zoho Books calibration items · list price, read only</Eyebrow>
              <input autoFocus value={catQ} onChange={e => setCatQ(e.target.value)} placeholder="Search Books items… blind spot, front camera, radar" className="w-full rounded-lg px-3 py-2 text-sm mt-1" style={inp} />
              {catHits.map(it => (
                <button key={it.item_id} type="button" onClick={() => { addLine({ desc: it.name, rate_key: 'calibration', hours: 0, flat_cents: it.rate_cents, item_id: it.item_id }); setCatQ(''); setAddingCat(false) }} className="w-full text-left flex justify-between px-2 py-1.5 text-sm" style={{ borderTop: '1px solid #fdeee8' }}>
                  <span>{it.name}</span><span className="font-bold tabular-nums" style={{ color: GREEN }}>{fmtCents(it.rate_cents)}</span>
                </button>
              ))}
              {catQ.trim() && catHits.length === 0 && <div className="text-xs px-2 py-1" style={{ color: '#888' }}>Nothing in Books matches.</div>}
            </div>
          )}
          <div>
            <div className="flex items-center justify-between"><Eyebrow>Invoice line (what the customer reads)</Eyebrow>{canEdit && <button type="button" disabled={rick?.busy || !lines.some(l => l.desc)} onClick={async () => { setRick({ busy: true }); try { const r = await apiFetch(`${API_BASE}/api/estimator/rick/describe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: job.name, lines, vehicle }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); setRick({ text: d.description }) } catch (e) { setRick({ err: e.message }) } }} className="text-[11px] font-bold px-2 py-0.5 rounded-lg text-white" style={{ backgroundColor: '#7c3aed', opacity: rick?.busy || !lines.some(l => l.desc) ? .5 : 1 }}>{rick?.busy ? '🤖 Rick is writing…' : '🤖 Ask Rick'}</button>}</div>
            <Txt value={job.invoice_description} onChange={v => onPatch({ invoice_description: v })} disabled={!canEdit} placeholder={job.name || 'One customer-facing sentence'} className="w-full" />
            {rick?.err && <div className="text-[11px] mt-1" style={{ color: '#b91c1c' }}>{rick.err}</div>}
            {rick?.text && (
              <div className="mt-1 rounded-lg px-2.5 py-1.5 text-sm flex items-center gap-2 flex-wrap" style={{ backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe' }}>
                <span className="text-[10px] font-bold" style={{ color: '#7c3aed' }}>RICK</span><span className="flex-1" style={{ color: '#1a1a1a' }}>{rick.text}</span>
                <button type="button" onClick={() => { onPatch({ invoice_description: rick.text }); setRick(null) }} className="text-[11px] font-bold px-2 py-0.5 rounded-lg text-white" style={{ backgroundColor: '#7c3aed' }}>Use it</button>
                <button type="button" onClick={() => setRick(null)} className="text-[11px]" style={{ color: '#888' }}>✕</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
