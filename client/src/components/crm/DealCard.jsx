// 💼 Deal card — every field, the activity timeline, stage history, linked jobs, the
// stage-specific coaching prompt, and a quick log (Mark's spec 2026-10-07).
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'

const ORANGE = '#CD4419', INK = '#1a1a1a'
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
const when = iso => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

export default function DealCard({ id, user, meta, onClose, onChanged }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [log, setLog] = useState({ type: 'Call', step_tag: '', summary: '', next_step: '', next_step_date: '', objection_type: '' })
  const [edit, setEdit] = useState({})
  const load = async () => { try { const r = await apiFetch(`${API_BASE}/api/deals/${id}`); const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); setD(j); setEdit({}) } catch (e) { setErr(e.message) } }
  useEffect(() => { load() }, [id])
  const deal = d?.deal
  const val = k => (k in edit ? edit[k] : deal?.[k])
  const dirty = Object.keys(edit).length > 0
  const save = async () => {
    setBusy('save'); setErr('')
    try { const r = await apiFetch(`${API_BASE}/api/deals/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edit) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); await load(); onChanged && onChanged() }
    catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const move = async stage => {
    setBusy(stage); setErr('')
    try { const r = await apiFetch(`${API_BASE}/api/deals/${id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage, objection: val('objection_type') || '' }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); await load(); onChanged && onChanged() }
    catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const addLog = async () => {
    if (!log.summary.trim() && !log.next_step) return
    setBusy('log'); setErr('')
    try { const r = await apiFetch(`${API_BASE}/api/deals/${id}/activity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(log) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setLog({ type: 'Call', step_tag: '', summary: '', next_step: '', next_step_date: '', objection_type: '' }); await load(); onChanged && onChanged() }
    catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const Field = ({ k, label, children }) => <div className="mb-2"><div className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: '#888' }}>{label}</div>{children}</div>
  const Sel = ({ k, options, allowEmpty = true }) => <select value={val(k) || ''} onChange={e => setEdit(x => ({ ...x, [k]: e.target.value }))} className="w-full rounded-lg px-2 py-1.5 text-sm" style={{ border: '1px solid #ddd' }}>{allowEmpty && <option value="">—</option>}{options.map(o => <option key={o} value={o}>{o}</option>)}</select>
  const Txt = ({ k, type = 'text', ph = '' }) => <input type={type} value={val(k) || ''} placeholder={ph} onChange={e => setEdit(x => ({ ...x, [k]: type === 'number' ? Number(e.target.value) : e.target.value }))} className="w-full rounded-lg px-2 py-1.5 text-sm" style={{ border: '1px solid #ddd' }} />
  const Chk = ({ k, label }) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!val(k)} onChange={e => setEdit(x => ({ ...x, [k]: e.target.checked }))} /> {label}</label>
  const people = d?.shop?.people || []

  return (
    <div className="fixed inset-0 z-[60]" onClick={onClose}>
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,.4)' }} />
      <div onClick={e => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full sm:w-[560px] bg-white shadow-2xl overflow-y-auto">
        {!deal ? <div className="p-5 text-sm" style={{ color: err ? '#b91c1c' : '#888' }}>{err || 'Loading…'}</div> : (
          <div className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div><div className="text-[10px] font-bold tracking-[.25em]" style={{ color: ORANGE }}>DEAL · {deal.deal_type?.toUpperCase()}</div><div className="text-xl font-extrabold" style={{ color: INK }}>{deal.shop_name}</div>
                <div className="text-xs mt-0.5" style={{ color: '#666' }}>{d.shop?.address || ''}{d.shop?.phone ? ` · ${d.shop.phone}` : ''}</div></div>
              <button onClick={onClose} className="text-xl" style={{ color: '#888' }}>✕</button>
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: INK }}>{deal.stage}</span>
              {deal.priority && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>{deal.priority}</span>}
              <span className="text-xs" style={{ color: '#888' }}>{deal.days_in_stage}d in stage · owner {deal.owner || '—'}</span>
            </div>
            {d.coach && <div className="mt-3 rounded-xl p-3" style={{ backgroundColor: '#1a1a1a', color: '#fff' }}><div className="text-[10px] font-bold tracking-[.25em]" style={{ color: ORANGE }}>COACH · {d.coach.question}</div><div className="text-sm font-bold mt-1">{d.coach.goal}</div><div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,.8)' }}>{d.coach.say}</div></div>}
            {/* stage moves with gate reasons */}
            <div className="mt-3">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#888' }}>Move to</div>
              <div className="flex gap-1 flex-wrap">{(d.gates || []).filter(g => g.stage !== deal.stage).map(g => <button key={g.stage} disabled={!!busy} onClick={() => move(g.stage)} title={g.blocked_by || `Move to ${g.stage}`} className="rounded-full px-2.5 py-1 text-xs font-bold" style={g.blocked_by ? { backgroundColor: '#f5f3f0', color: '#999', border: '1px solid #e5e5e5' } : { backgroundColor: '#fff', color: ORANGE, border: `1px solid ${ORANGE}` }}>{g.blocked_by ? '🔒 ' : ''}{g.stage}</button>)}</div>
              <div className="text-[11px] mt-1" style={{ color: '#888' }}>🔒 = the gate isn't met yet — hover/tap for what's missing.</div>
            </div>
            {err && <div className="text-xs mt-2 font-semibold rounded-lg px-2 py-1.5" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>{err}</div>}

            {/* quick log */}
            <div className="mt-4 rounded-xl p-3" style={{ backgroundColor: '#f5f3f0' }}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#888' }}>Log a touch</div>
              <div className="flex gap-1 flex-wrap mb-2">{(meta?.activity_types || []).map(t => <button key={t} onClick={() => setLog(l => ({ ...l, type: t }))} className="rounded-full px-2.5 py-1 text-xs font-bold" style={log.type === t ? { backgroundColor: INK, color: '#fff' } : { backgroundColor: '#fff', color: '#444', border: '1px solid #ddd' }}>{t}</button>)}</div>
              <div className="flex gap-1 flex-wrap mb-2">{(meta?.step_tags || []).map(t => <button key={t} onClick={() => setLog(l => ({ ...l, step_tag: l.step_tag === t ? '' : t }))} className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={log.step_tag === t ? { backgroundColor: '#1F8B8B', color: '#fff' } : { backgroundColor: '#fff', color: '#1F8B8B', border: '1px solid #b8d4d4' }}>{t}</button>)}</div>
              <textarea value={log.summary} onChange={e => setLog(l => ({ ...l, summary: e.target.value }))} rows={2} placeholder="What happened (their words)…" className="w-full rounded-lg px-2 py-1.5 text-sm" style={{ border: '1px solid #ddd' }} />
              <div className="grid grid-cols-2 gap-2 mt-2">
                <input value={log.next_step} onChange={e => setLog(l => ({ ...l, next_step: e.target.value }))} placeholder="Next step" className="rounded-lg px-2 py-1.5 text-sm" style={{ border: '1px solid #ddd' }} />
                <input type="date" value={log.next_step_date} min={today()} onChange={e => setLog(l => ({ ...l, next_step_date: e.target.value }))} className="rounded-lg px-2 py-1.5 text-sm" style={{ border: '1px solid #ddd' }} />
              </div>
              <div className="flex gap-1 flex-wrap mt-2">{(meta?.objections || []).map(o => <button key={o} onClick={() => setLog(l => ({ ...l, objection_type: l.objection_type === o ? '' : o }))} className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={log.objection_type === o ? { backgroundColor: '#b91c1c', color: '#fff' } : { backgroundColor: '#fff', color: '#b91c1c', border: '1px solid #fca5a5' }}>{o}</button>)}</div>
              <button onClick={addLog} disabled={busy === 'log'} className="mt-2 w-full rounded-lg py-2 text-sm font-bold text-white" style={{ backgroundColor: '#15803d' }}>{busy === 'log' ? 'Saving…' : 'Log it'}</button>
            </div>

            {/* fields */}
            <div className="mt-4 grid grid-cols-2 gap-x-3">
              <Field label="Technical (TQ)"><Sel k="tq_score" options={meta?.scores || []} /></Field>
              <Field label="Stakeholder (SQ)"><Sel k="sq_score" options={meta?.scores || []} /></Field>
              <Field label="Fit (FQ)"><Sel k="fq_score" options={meta?.scores || []} /></Field>
              <Field label="Owner"><Sel k="owner" options={['Mark', 'Jayden', 'Kat']} /></Field>
              <Field label="Deal type"><Sel k="deal_type" options={meta?.deal_types || []} allowEmpty={false} /></Field>
              <Field label="Current setup"><Sel k="current_setup" options={meta?.setups || []} /></Field>
              <Field label="Est. monthly volume"><Txt k="est_monthly_volume" type="number" /></Field>
              <Field label="DRP affiliations"><Txt k="drp_affiliations" ph="State Farm, GEICO…" /></Field>
              <Field label="Decision maker"><select value={val('decision_maker_id') || ''} onChange={e => setEdit(x => ({ ...x, decision_maker_id: e.target.value }))} className="w-full rounded-lg px-2 py-1.5 text-sm" style={{ border: '1px solid #ddd' }}><option value="">—</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}{p.title ? ` (${p.title})` : ''}</option>)}</select></Field>
              <Field label="Estimator"><select value={val('estimator_id') || ''} onChange={e => setEdit(x => ({ ...x, estimator_id: e.target.value }))} className="w-full rounded-lg px-2 py-1.5 text-sm" style={{ border: '1px solid #ddd' }}><option value="">—</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}{p.title ? ` (${p.title})` : ''}</option>)}</select></Field>
            </div>
            <Field label="Pain, in their words"><textarea value={val('pain_in_their_words') || ''} onChange={e => setEdit(x => ({ ...x, pain_in_their_words: e.target.value }))} rows={2} className="w-full rounded-lg px-2 py-1.5 text-sm" style={{ border: '1px solid #ddd' }} /></Field>
            <Field label="Pain types"><div className="flex gap-1 flex-wrap">{(meta?.pain_types || []).map(p => { const cur = val('pain_types') || []; const on = cur.includes(p); return <button key={p} onClick={() => setEdit(x => ({ ...x, pain_types: on ? cur.filter(y => y !== p) : [...cur, p] }))} className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={on ? { backgroundColor: INK, color: '#fff' } : { backgroundColor: '#fff', color: '#444', border: '1px solid #ddd' }}>{p}</button> })}</div></Field>
            <div className="grid grid-cols-2 gap-x-3">
              <Field label="Next step"><Txt k="next_step" /></Field>
              <Field label="Next step date"><Txt k="next_step_date" type="date" /></Field>
              <Field label="Objection"><Sel k="objection_type" options={meta?.objections || []} /></Field>
              <Field label="Recontact date"><Txt k="recontact_date" type="date" /></Field>
              <Field label="Lost reason"><Txt k="lost_reason" /></Field>
              <Field label="First / second job (ids)"><div className="flex gap-1"><Txt k="first_job_id" ph="first job" /><Txt k="second_job_id" ph="second job" /></div></Field>
            </div>
            <div className="flex gap-4 mb-2"><Chk k="billing_expectations_set" label="Billing expectations set" /><Chk k="w9_received" label="W-9 received" /></div>
            {dirty && <button onClick={save} disabled={busy === 'save'} className="w-full rounded-lg py-2.5 text-sm font-bold text-white" style={{ backgroundColor: ORANGE }}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>}

            {/* linked jobs */}
            {d.jobs?.length > 0 && <div className="mt-4"><div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#888' }}>Jobs with this shop</div>{d.jobs.map(j => <div key={j.id} className="flex items-center justify-between text-xs py-1" style={{ borderBottom: '1px solid #f0f0f0' }}><span style={{ color: INK }}>{j.vehicle || 'Vehicle'} <span style={{ color: '#888' }}>· {j.status}{j.scheduled_date ? ` · ${j.scheduled_date}` : ''}</span></span><span className="flex gap-1">{deal.first_job_id !== j.id && deal.second_job_id !== j.id && <button onClick={() => setEdit(x => ({ ...x, [deal.first_job_id ? 'second_job_id' : 'first_job_id']: String(j.id) }))} className="font-bold" style={{ color: '#1F8B8B' }}>link as {deal.first_job_id ? '2nd' : '1st'}</button>}{(deal.first_job_id === j.id || deal.second_job_id === j.id) && <span className="font-bold" style={{ color: '#15803d' }}>{deal.first_job_id === j.id ? '1st' : '2nd'} ✓</span>}</span></div>)}</div>}

            {/* timeline */}
            <div className="mt-4"><div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#888' }}>Timeline</div>
              {[...(d.activities || []).map(a => ({ at: a.at, text: `${a.type}${a.step_tag ? ` · ${a.step_tag}` : ''}: ${a.summary}${a.meta?.next_step ? ` → ${a.meta.next_step}${a.meta.next_step_date ? ` (${a.meta.next_step_date})` : ''}` : ''}`, by: a.by, kind: 'act' })), ...(d.history || []).map(h => ({ at: h.at, text: `${h.from || 'new'} → ${h.to}${h.note ? ` (${h.note})` : ''}`, by: h.by, kind: 'hist' }))].sort((a, b) => String(b.at).localeCompare(String(a.at))).map((e, i) => <div key={i} className="text-xs py-1" style={{ borderBottom: '1px solid #f0f0f0', color: e.kind === 'hist' ? '#B33A15' : '#444' }}><span style={{ color: '#888' }}>{when(e.at)}</span> · {e.by} — {e.text}</div>)}
              {!(d.activities || []).length && !(d.history || []).length && <div className="text-xs" style={{ color: '#888' }}>Nothing yet.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
