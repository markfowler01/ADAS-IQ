// 🤖 Rick's 3 C's + Verification for one job (spec §8). Mostly taps: the
// facts come from chips and fields; Rick only writes the prose. Nothing
// persists until Approve, placeholders like [DTC CODE] block approval,
// Regenerate shows a diff so hand edits are never silently lost.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { Eyebrow, Pill, Chip, PrimaryButton, SecondaryButton, Notice, ORANGE, GREEN, BLUE } from '../ui/ReviewKit.jsx'

const PURPLE = '#7c3aed'
const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white', borderRadius: 8 }
const FIELDS = [['concern', 'Concern'], ['cause', 'Cause'], ['correction', 'Correction'], ['verification', 'Verification']]
const PH = /\[[A-Z][A-Z0-9 _\/\-]{1,40}\]/
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
const post = (url, b) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })

export default function ThreeCModal({ estimateId, job, onClose, onApproved }) {
  const [opts, setOpts] = useState(null)
  const [inputs, setInputs] = useState(null)
  const [text, setText] = useState({ concern: '', cause: '', correction: '', verification: '' })
  const [prev, setPrev] = useState(null)       // last generated, for the diff view
  const [approvedAt, setApprovedAt] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [lib, setLib] = useState(null)
  const [meta, setMeta] = useState('')
  const base = `/api/estimator/${estimateId}/jobs/${job.id}/threec`
  const set = f => setInputs(i => ({ ...i, ...f }))

  useEffect(() => {
    j(base).then(d => {
      setOpts(d.options); setInputs({ ...d.prefill, ...(d.record?.inputs || {}) })
      const t = d.record?.approved || d.record?.generated
      if (t && !t.raw) setText({ concern: t.concern || '', cause: t.cause || '', correction: t.correction || '', verification: t.verification || '' })
      if (d.record?.approved_at) setApprovedAt(d.record.approved_at)
    }).catch(e => setErr(e.message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    setBusy('gen'); setErr('')
    try {
      const d = await post(`${base}/generate`, { inputs })
      if (d.generated?.raw) { setErr('Rick did not return clean JSON — raw text is in the boxes for you to fix.'); setText({ concern: d.generated.raw, cause: '', correction: '', verification: '' }); return }
      const edited = FIELDS.some(([k]) => text[k] && prev && text[k] !== prev[k])
      if (edited) { setPrev({ ...prev, _next: d.generated }) } else { setText(d.generated); setPrev(d.generated) }
      setMeta(`Rick · ${d.model}${d.examples_used ? ` · learned from ${d.examples_used} approved set${d.examples_used === 1 ? '' : 's'} with this trigger` : ' · no prior examples yet'}`)
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  async function approve() {
    setBusy('ok'); setErr('')
    try { const d = await post(`${base}/approve`, { approved: text, inputs }); setApprovedAt(new Date().toISOString()); onApproved && onApproved(d) ; onClose() }
    catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  async function loadLib() { try { const d = await j('/api/estimator/threec/library'); setLib(d.library || {}) } catch (e) { setErr(e.message) } }

  const placeholders = FIELDS.filter(([k]) => PH.test(text[k] || '')).map(([, l]) => l)
  const complete = FIELDS.every(([k]) => String(text[k] || '').trim())
  if (!inputs || !opts) return <Overlay onClose={onClose}><div className="p-5 text-sm" style={{ color: '#888' }}>{err || 'Loading…'}</div></Overlay>
  const sysOn = s => (inputs.systems || []).includes(s)
  const toggleSys = s => set({ systems: sysOn(s) ? inputs.systems.filter(x => x !== s) : [...(inputs.systems || []), s] })
  const calType = s => inputs.calibration_types?.[s] || ''

  return (
    <Overlay onClose={onClose}>
      <div className="px-5 py-3 flex items-start justify-between gap-2" style={{ backgroundColor: '#f5f3ff', borderBottom: '1px solid #ddd6fe' }}>
        <div><Eyebrow>🤖 Rick · 3 C's + Verification</Eyebrow><div className="font-bold" style={{ color: '#1a1a1a' }}>{job.name}</div><div className="text-xs" style={{ color: '#666' }}>{inputs.vehicle}{inputs.vin ? ` · ${inputs.vin}` : ''}{inputs.ro_number ? ` · RO ${inputs.ro_number}` : ''}{approvedAt ? ` · approved ${approvedAt.slice(0, 10)}` : ''}</div></div>
        <button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button>
      </div>
      <div className="px-5 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: '70vh' }}>
        {err && <Notice tone="red">{err}</Notice>}
        <div>
          <Eyebrow>Trigger event</Eyebrow>
          <div className="flex flex-wrap gap-1.5 mt-1">{opts.triggers.map(t => <Pill key={t} size="sm" tone="orange" on={inputs.trigger_event === t} onClick={() => set({ trigger_event: t })}>{t}</Pill>)}</div>
        </div>
        <div>
          <Eyebrow>Systems calibrated · tap for static / dynamic / both</Eyebrow>
          <div className="flex flex-wrap gap-1.5 mt-1">{opts.systems.map(s => (
            <span key={s} className="inline-flex items-center gap-1">
              <Pill size="sm" on={sysOn(s)} onClick={() => toggleSys(s)}>{s}</Pill>
              {sysOn(s) && <select value={calType(s)} onChange={e => set({ calibration_types: { ...(inputs.calibration_types || {}), [s]: e.target.value } })} className="text-[11px] px-1 py-0.5" style={inp}><option value="">type?</option><option value="static">static</option><option value="dynamic">dynamic</option><option value="both">both</option></select>}
            </span>
          ))}</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Eyebrow>Pre-scan DTCs</Eyebrow><div className="flex gap-1.5 items-center mt-1"><Pill size="sm" tone="green" on={!!inputs.no_dtcs_present} onClick={() => set({ no_dtcs_present: !inputs.no_dtcs_present, pre_scan_dtcs: '' })}>No DTCs present</Pill></div>{!inputs.no_dtcs_present && <input value={inputs.pre_scan_dtcs || ''} onChange={e => set({ pre_scan_dtcs: e.target.value })} placeholder="e.g. C1A01, U0100 — exactly as read" className="w-full mt-1 px-2.5 py-1.5 text-sm" style={{ ...inp, fontFamily: 'IBM Plex Mono, monospace' }} />}</div>
          <div><Eyebrow>Post-scan</Eyebrow><div className="flex flex-wrap gap-1.5 mt-1">{opts.post_scan.map(p => <Pill key={p} size="sm" on={inputs.post_scan_result === p} onClick={() => set({ post_scan_result: p })}>{p}</Pill>)}</div>{inputs.post_scan_result === 'codes remain' && <input value={inputs.post_scan_remaining_dtcs || ''} onChange={e => set({ post_scan_remaining_dtcs: e.target.value })} placeholder="Codes that remain" className="w-full mt-1 px-2.5 py-1.5 text-sm" style={{ ...inp, fontFamily: 'IBM Plex Mono, monospace' }} />}</div>
          <div><Eyebrow>Outcome</Eyebrow><div className="flex flex-wrap gap-1.5 mt-1">{opts.outcomes.map(o => <Pill key={o} size="sm" tone={o === 'could not complete' ? 'amber' : 'green'} on={inputs.outcome === o} onClick={() => set({ outcome: o })}>{o}</Pill>)}</div>{inputs.outcome === 'could not complete' && <div className="flex flex-wrap gap-1 mt-1">{opts.blockers.map(b => <Pill key={b} size="sm" tone="amber" on={inputs.blocking_reason === b} onClick={() => set({ blocking_reason: b })}>{b}</Pill>)}</div>}</div>
          <div><Eyebrow>Road test · audience</Eyebrow><div className="flex flex-wrap gap-1.5 mt-1"><Pill size="sm" on={!!inputs.road_test} onClick={() => set({ road_test: !inputs.road_test })}>Road test performed</Pill><Pill size="sm" tone="blue" on={inputs.audience === 'insurer'} onClick={() => set({ audience: 'insurer' })}>Insurer-facing</Pill><Pill size="sm" tone="blue" on={inputs.audience === 'shop'} onClick={() => set({ audience: 'shop' })}>Shop-facing</Pill></div></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Eyebrow>OEM reference (only if you actually pulled it)</Eyebrow><input value={inputs.oem_reference || ''} onChange={e => set({ oem_reference: e.target.value })} placeholder="Service info doc / position statement" className="w-full mt-1 px-2.5 py-1.5 text-sm" style={inp} /></div>
          <div><Eyebrow>Talk it out (free text)</Eyebrow><input value={inputs.free_notes || ''} onChange={e => set({ free_notes: e.target.value })} placeholder="Anything else that happened" className="w-full mt-1 px-2.5 py-1.5 text-sm" style={inp} /></div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={generate} disabled={busy === 'gen' || !inputs.trigger_event} className="rounded-xl px-4 py-2 text-sm font-bold text-white" style={{ backgroundColor: PURPLE, opacity: busy === 'gen' || !inputs.trigger_event ? .5 : 1 }}>{busy === 'gen' ? '🤖 Rick is writing…' : (text.concern ? '🤖 Regenerate' : '🤖 Ask Rick to write it')}</button>
          <button onClick={loadLib} className="text-xs font-bold" style={{ color: BLUE }}>📚 Use an approved set</button>
          {meta && <span className="text-[11px]" style={{ color: '#888' }}>{meta}</span>}
        </div>
        {lib && (
          <div className="rounded-lg p-2 text-xs space-y-1" style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe' }}>
            {Object.keys(lib).length === 0 && <div style={{ color: '#666' }}>No approved sets yet — approve this one and it becomes the first template.</div>}
            {Object.entries(lib).map(([trig, sets]) => <div key={trig}><b>{trig}</b> {sets.slice(0, 5).map(s => <button key={s.id} onClick={() => { setText(s.approved); setLib(null) }} className="ml-1 underline" style={{ color: BLUE }}>{s.vehicle || s.outcome || 'use'} ({s.approved_at.slice(0, 10)})</button>)}</div>)}
          </div>
        )}
        {prev?._next && (
          <Notice tone="amber"><b>Rick wrote a new version but you had edits.</b> <button className="underline" onClick={() => { setText(prev._next); setPrev(prev._next) }}>Take Rick's new version</button> · <button className="underline" onClick={() => setPrev(null)}>Keep my edits</button>
            {FIELDS.map(([k, l]) => text[k] !== prev._next[k] ? <div key={k} className="mt-1"><b>{l}</b> → <span style={{ color: '#555' }}>{prev._next[k]}</span></div> : null)}
          </Notice>
        )}
        <div className="space-y-2">
          {FIELDS.map(([k, l]) => (
            <div key={k}>
              <div className="flex items-center justify-between"><Eyebrow>{l}</Eyebrow>{PH.test(text[k] || '') && <Chip tone="orange">fill the [PLACEHOLDER]</Chip>}</div>
              <textarea value={text[k]} onChange={e => setText(t => ({ ...t, [k]: e.target.value }))} rows={k === 'concern' ? 2 : 3} className="w-full px-2.5 py-1.5 text-sm" style={{ ...inp, resize: 'vertical', borderColor: PH.test(text[k] || '') ? '#f59e0b' : '#e0dbd6' }} placeholder={`${l}…`} />
            </div>
          ))}
        </div>
      </div>
      <div className="px-5 py-3 flex gap-2" style={{ borderTop: '1px solid #ebebeb' }}>
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        <PrimaryButton tone="green" onClick={approve} disabled={busy === 'ok' || !complete || placeholders.length > 0}>{busy === 'ok' ? 'Saving…' : placeholders.length ? `Fill placeholders in ${placeholders.join(', ')}` : '✅ Approve · goes on the invoice and PDF'}</PrimaryButton>
      </div>
    </Overlay>
  )
}
function Overlay({ children, onClose }) {
  return <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.55)' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col" style={{ maxHeight: '94vh' }}>{children}</div></div>
}
