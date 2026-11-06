// 💼 Sales Mode (Mark 2026-10-08: "it's very hard for me to switch from sales to technician
// to everything — make it mindless"). One button → the gear-change card → the app's own
// ordered queue → one card at a time: who, why now, the one thing to say, three buttons.
// "Did it" asks only what the stage gate needs. A wrap at the end posts to Cliq.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'

const ORANGE = '#CD4419', INK = '#1a1a1a'
const BUCKET = { overdue: { label: 'OVERDUE PROMISE', color: '#b91c1c' }, today: { label: 'DUE TODAY', color: ORANGE }, nearby: { label: 'NEAR TODAY\'S JOBS', color: '#1F8B8B' }, stalled: { label: 'STALLED', color: '#6b7280' }, no_next_step: { label: 'NO NEXT STEP', color: '#b45309' }, new: { label: 'NEW TARGET', color: '#0A0A0A' } }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) }

export default function SalesMode({ user, onClose, onOpenDeal, stats }) {
  const [phase, setPhase] = useState('gear')   // gear | queue | wrap
  const [meta, setMeta] = useState(null)
  const [q, setQ] = useState(null)
  const [i, setI] = useState(0)
  const [log, setLog] = useState([])            // what happened this block
  const [err, setErr] = useState('')
  useEffect(() => { apiFetch(`${API_BASE}/api/deals/meta`).then(r => r.json()).then(setMeta).catch(() => {}) }, [])
  const load = async () => { setErr(''); try { const r = await apiFetch(`${API_BASE}/api/deals/queue`); const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); setQ(d); setI(0) } catch (e) { setErr(e.message) } }
  useEffect(() => { load() }, [])
  const items = q?.queue || []
  const cur = items[i] || null
  const advance = entry => { setLog(l => [...l, entry]); if (i + 1 >= items.length) setPhase('wrap'); else setI(i + 1) }

  if (phase === 'gear') return (
    <Shell onClose={onClose}>
      <div className="text-center px-6 py-10">
        <div className="text-xs font-bold tracking-[.3em]" style={{ color: ORANGE }}>SALES MODE</div>
        <div className="text-3xl font-extrabold mt-3" style={{ color: INK }}>You are the shop's ADAS department.</div>
        <div className="text-base mt-3" style={{ color: '#555' }}>Every calibration we recommend, the shop gets paid for. Same day. Done right.</div>
        {stats && <div className="text-sm mt-4 font-semibold" style={{ color: '#444' }}>{stats}</div>}
        <div className="mt-6 text-sm" style={{ color: '#666' }}>{q ? `${q.count} in the queue · ${q.totals.overdue} overdue · ${q.totals.today} due today · ${q.totals.nearby} near today's jobs` : 'Building your queue…'}</div>
        <div className="mt-2 text-xs" style={{ color: '#888' }}>Breathe. Tech mode is off. The app decides who's next — you just talk.</div>
        <button onClick={() => setPhase('queue')} disabled={!q} className="mt-8 rounded-2xl px-10 py-4 text-lg font-extrabold text-white" style={{ backgroundColor: ORANGE, opacity: q ? 1 : .5 }}>▶ Start</button>
        {err && <div className="text-xs mt-3" style={{ color: '#b91c1c' }}>{err}</div>}
      </div>
    </Shell>
  )

  if (phase === 'wrap' || !cur) return (
    <Shell onClose={onClose}>
      <div className="px-6 py-10 text-center">
        <div className="text-xs font-bold tracking-[.3em]" style={{ color: '#15803d' }}>BLOCK DONE</div>
        <div className="text-3xl font-extrabold mt-3" style={{ color: INK }}>{log.length ? `${log.length} ${log.length === 1 ? 'card' : 'cards'} handled.` : 'Queue is empty.'}</div>
        <div className="text-sm mt-3" style={{ color: '#555' }}>{log.filter(l => l.did).length} done · {log.filter(l => l.miss).length} couldn't reach · {log.filter(l => l.later).length} later{log.filter(l => l.moved).length ? ` · ${log.filter(l => l.moved).length} stage moves` : ''}</div>
        <div className="mt-6 text-left mx-auto max-w-md">{log.map((l, k) => <div key={k} className="text-xs py-1" style={{ color: '#444', borderBottom: '1px solid #f0f0f0' }}>{l.did ? '✅' : l.miss ? '📵' : '⏭'} <b>{l.shop}</b>{l.note ? ` — ${l.note}` : ''}{l.next ? ` → ${l.next}` : ''}</div>)}</div>
        <button onClick={onClose} className="mt-8 rounded-2xl px-10 py-4 text-lg font-extrabold text-white" style={{ backgroundColor: INK }}>Back to tech mode</button>
      </div>
    </Shell>
  )

  return (
    <Shell onClose={onClose} top={<span className="text-xs font-bold" style={{ color: '#888' }}>{i + 1} of {items.length}</span>}>
      <QueueCard item={cur} meta={meta} user={user} onOpenDeal={onOpenDeal} onAdvance={advance} onRefresh={load} />
    </Shell>
  )
}

function Shell({ children, onClose, top }) {
  return (
    <div className="fixed inset-0 z-[65] flex flex-col" style={{ backgroundColor: '#f5f3f0' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ backgroundColor: '#fff', borderBottom: '1px solid #eee' }}>
        <div className="text-sm font-extrabold" style={{ color: ORANGE }}>💼 Sales Mode</div>
        <div className="flex items-center gap-3">{top}<button onClick={onClose} className="text-sm font-bold px-3 py-1.5 rounded-lg" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Exit</button></div>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

function QueueCard({ item, meta, onOpenDeal, onAdvance, onRefresh }) {
  const { deal, shop, coach, why, bucket } = item
  const b = BUCKET[bucket] || BUCKET.today
  const [mode, setMode] = useState('')          // '' | did | miss | later | qualify
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [f, setF] = useState({ type: bucket === 'nearby' ? 'Visit' : 'Call', step_tag: '', summary: '', next_step: '', next_step_date: plusDays(3), objection_type: '', move: '', tq: '', sq: '', fq: '' })
  const person = (shop.people || []).find(p => p.id === deal?.decision_maker_id) || (shop.people || [])[0]
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const need = deal ? gateNeeds(deal, meta) : []

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      let d = deal
      if (!d) {   // new target: create the deal with the three scores (that is the Qualified gate)
        const r = await apiFetch(`${API_BASE}/api/deals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: shop.id, tq_score: f.tq, sq_score: f.sq, fq_score: f.fq }) })
        const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); d = j.deal
        if (f.tq && f.sq && f.fq) { await apiFetch(`${API_BASE}/api/deals/${d.id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: 'Prospecting', note: 'qualified in Sales Mode' }) }) }
        onAdvance({ shop: shop.name, did: true, note: `qualified ${f.tq}/${f.sq}/${f.fq}` }); return
      }
      if (mode === 'did' || mode === 'miss') {
        const body = mode === 'did' ? { type: f.type, step_tag: f.step_tag, summary: f.summary || `${f.type} — done`, next_step: f.next_step, next_step_date: f.next_step_date, objection_type: f.objection_type }
          : { type: f.type, step_tag: 'Follow-up', summary: f.summary || `${f.type} — no answer`, next_step: f.next_step || 'Try again', next_step_date: f.next_step_date }
        const r = await apiFetch(`${API_BASE}/api/deals/${d.id}/activity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
        let moved = ''
        if (mode === 'did' && f.move) {
          const m = await apiFetch(`${API_BASE}/api/deals/${d.id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: f.move, objection: f.objection_type }) })
          const mj = await m.json(); if (!m.ok) { setErr(mj.error || 'Could not move the stage'); setBusy(false); return } moved = f.move
        }
        onAdvance({ shop: shop.name, did: mode === 'did', miss: mode === 'miss', note: f.summary, next: f.next_step ? `${f.next_step} (${f.next_step_date})` : '', moved }); return
      }
      if (mode === 'later') {
        if (f.next_step_date) await apiFetch(`${API_BASE}/api/deals/${d.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ next_step_date: f.next_step_date, next_step: f.next_step || d.next_step }) })
        onAdvance({ shop: shop.name, later: true, next: f.next_step_date }); return
      }
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-5">
      <div className="text-[11px] font-extrabold tracking-[.25em]" style={{ color: b.color }}>{b.label}</div>
      <div className="text-2xl font-extrabold mt-1 leading-tight" style={{ color: INK }}>{shop.name}</div>
      <div className="text-sm mt-1" style={{ color: '#555' }}>{why}</div>
      <div className="mt-3 rounded-xl p-3 text-sm" style={{ backgroundColor: '#fff', border: '1px solid #e5e5e5' }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div><b style={{ color: INK }}>{person?.name || 'No contact yet'}</b>{person?.title ? <span style={{ color: '#888' }}> · {person.title}</span> : null}</div>
          {(person?.phone || shop.phone) && <a href={`tel:${person?.phone || shop.phone}`} className="text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ backgroundColor: '#15803d' }}>📞 {person?.phone || shop.phone}</a>}
        </div>
        {shop.address && <div className="text-xs mt-1" style={{ color: '#666' }}>{shop.address}</div>}
        {deal && <div className="text-xs mt-2 flex gap-2 flex-wrap" style={{ color: '#444' }}><span className="font-bold px-1.5 rounded" style={{ backgroundColor: '#f5f3f0' }}>{deal.stage}</span>{deal.priority && <span className="font-bold px-1.5 rounded" style={{ backgroundColor: deal.priority === 'HPP' ? '#fef3c7' : '#f5f3f0', color: deal.priority === 'HPP' ? '#92400e' : '#444' }}>{deal.priority}</span>}<span>{deal.days_in_stage}d in stage</span>{deal.next_step && <span>· next: {deal.next_step}{deal.next_step_date ? ` (${deal.next_step_date})` : ''}</span>}</div>}
        {deal?.pain_in_their_words && <div className="text-xs mt-2 italic" style={{ color: '#555' }}>"{deal.pain_in_their_words}"</div>}
        {shop.last_contact && <div className="text-[11px] mt-1" style={{ color: '#888' }}>Last touch {shop.last_contact}</div>}
      </div>

      {coach && (
        <div className="mt-3 rounded-xl p-4" style={{ backgroundColor: '#1a1a1a', color: '#fff' }}>
          <div className="text-[10px] font-bold tracking-[.25em]" style={{ color: ORANGE }}>THE ONE THING · {coach.question !== '—' ? `"${coach.question}"` : deal?.stage || 'Qualify'}</div>
          <div className="text-base font-bold mt-1">{coach.goal}</div>
          <div className="text-sm mt-2" style={{ color: 'rgba(255,255,255,.85)' }}>{coach.say}</div>
          {coach.done && <div className="text-xs mt-2" style={{ color: 'rgba(255,255,255,.6)' }}>Done looks like: {coach.done}</div>}
          {need.length > 0 && <div className="text-xs mt-2" style={{ color: '#fcd34d' }}>To move on you still need: {need.join(', ')}</div>}
        </div>
      )}

      {!mode && (
        <div className="grid grid-cols-3 gap-2 mt-4">
          {deal ? <>
            <button onClick={() => setMode('did')} className="rounded-xl py-4 text-sm font-extrabold text-white" style={{ backgroundColor: '#15803d' }}>✅ Did it</button>
            <button onClick={() => setMode('miss')} className="rounded-xl py-4 text-sm font-extrabold" style={{ backgroundColor: '#fff', color: '#b45309', border: '1.5px solid #fcd34d' }}>📵 Couldn't reach</button>
            <button onClick={() => setMode('later')} className="rounded-xl py-4 text-sm font-extrabold" style={{ backgroundColor: '#fff', color: '#555', border: '1.5px solid #ddd' }}>⏭ Not now</button>
          </> : <button onClick={() => setMode('qualify')} className="col-span-3 rounded-xl py-4 text-sm font-extrabold text-white" style={{ backgroundColor: ORANGE }}>🎯 Qualify them (three scores)</button>}
        </div>
      )}

      {mode === 'qualify' && (
        <div className="mt-4 rounded-xl p-3" style={{ backgroundColor: '#fff', border: `1.5px solid ${ORANGE}` }}>
          {[['tq', 'Technical — volume & the cars we calibrate'], ['sq', 'Stakeholder — can we reach the decision maker'], ['fq', 'Fit — DRPs, current setup, distance']].map(([k, label]) => (
            <div key={k} className="mb-2"><div className="text-xs font-bold mb-1" style={{ color: INK }}>{label}</div><div className="flex gap-1">{['High', 'Medium', 'Low'].map(v => <button key={v} onClick={() => set(k, v)} className="flex-1 rounded-lg py-2 text-xs font-bold" style={f[k] === v ? { backgroundColor: ORANGE, color: '#fff' } : { backgroundColor: '#f5f3f0', color: '#444' }}>{v}</button>)}</div></div>
          ))}
          <Actions busy={busy} onOk={submit} onCancel={() => setMode('')} okLabel="Save & queue them" disabled={!(f.tq && f.sq && f.fq)} />
        </div>
      )}

      {(mode === 'did' || mode === 'miss') && (
        <div className="mt-4 rounded-xl p-3" style={{ backgroundColor: '#fff', border: `1.5px solid ${mode === 'did' ? '#15803d' : '#fcd34d'}` }}>
          <div className="flex gap-1 mb-2">{(meta?.activity_types || ['Visit', 'Call', 'Text', 'Email']).slice(0, 4).map(t => <button key={t} onClick={() => set('type', t)} className="flex-1 rounded-lg py-2 text-xs font-bold" style={f.type === t ? { backgroundColor: INK, color: '#fff' } : { backgroundColor: '#f5f3f0', color: '#444' }}>{t}</button>)}</div>
          <textarea value={f.summary} onChange={e => set('summary', e.target.value)} placeholder={mode === 'did' ? 'What happened, in their words… (use the mic key)' : 'Left a message? Note…'} rows={3} className="w-full rounded-lg px-3 py-2 text-sm" style={{ border: '1px solid #ddd' }} />
          {mode === 'did' && <>
            <div className="text-xs font-bold mt-2 mb-1" style={{ color: INK }}>Objection, if any</div>
            <div className="flex gap-1 flex-wrap">{(meta?.objections || []).map(o => <button key={o} onClick={() => set('objection_type', f.objection_type === o ? '' : o)} className="rounded-full px-2.5 py-1 text-xs font-bold" style={f.objection_type === o ? { backgroundColor: '#b91c1c', color: '#fff' } : { backgroundColor: '#fff', color: '#b91c1c', border: '1px solid #fca5a5' }}>{o}</button>)}</div>
            <div className="text-xs font-bold mt-2 mb-1" style={{ color: INK }}>Move the deal?</div>
            <div className="flex gap-1 flex-wrap">{(meta?.stages || []).filter(s => s !== deal.stage).map(s => <button key={s} onClick={() => set('move', f.move === s ? '' : s)} className="rounded-full px-2.5 py-1 text-xs font-bold" style={f.move === s ? { backgroundColor: ORANGE, color: '#fff' } : { backgroundColor: '#fff', color: ORANGE, border: '1px solid #f5c2ae' }}>{s}</button>)}</div>
          </>}
          <div className="text-xs font-bold mt-2 mb-1" style={{ color: INK }}>Next step <span className="font-normal" style={{ color: '#888' }}>(required — a promise with a date)</span></div>
          <input value={f.next_step} onChange={e => set('next_step', e.target.value)} placeholder={mode === 'did' ? 'e.g. Send me the next car — Thursday' : 'Try again'} className="w-full rounded-lg px-3 py-2 text-sm" style={{ border: '1px solid #ddd' }} />
          <div className="flex gap-1 mt-1.5 flex-wrap">{[['Tomorrow', 1], ['3 days', 3], ['1 week', 7], ['2 weeks', 14]].map(([l, n]) => <button key={l} onClick={() => set('next_step_date', plusDays(n))} className="rounded-full px-2.5 py-1 text-xs font-bold" style={f.next_step_date === plusDays(n) ? { backgroundColor: INK, color: '#fff' } : { backgroundColor: '#f5f3f0', color: '#444' }}>{l}</button>)}<input type="date" value={f.next_step_date} min={today()} onChange={e => set('next_step_date', e.target.value)} className="rounded-lg px-2 py-1 text-xs" style={{ border: '1px solid #ddd' }} /></div>
          <Actions busy={busy} onOk={submit} onCancel={() => setMode('')} okLabel={mode === 'did' ? 'Log it & next card' : 'Log & next'} disabled={!f.next_step_date} />
        </div>
      )}
      {mode === 'later' && (
        <div className="mt-4 rounded-xl p-3" style={{ backgroundColor: '#fff', border: '1.5px solid #ddd' }}>
          <div className="text-xs font-bold mb-1" style={{ color: INK }}>When?</div>
          <div className="flex gap-1 flex-wrap">{[['Tomorrow', 1], ['3 days', 3], ['1 week', 7]].map(([l, n]) => <button key={l} onClick={() => set('next_step_date', plusDays(n))} className="rounded-full px-2.5 py-1 text-xs font-bold" style={f.next_step_date === plusDays(n) ? { backgroundColor: INK, color: '#fff' } : { backgroundColor: '#f5f3f0', color: '#444' }}>{l}</button>)}</div>
          <Actions busy={busy} onOk={submit} onCancel={() => setMode('')} okLabel="Skip for now" />
        </div>
      )}
      {err && <div className="text-xs mt-2 font-semibold" style={{ color: '#b91c1c' }}>⚠ {err}</div>}
      <div className="flex justify-between mt-4 text-xs">
        {deal ? <button onClick={() => onOpenDeal && onOpenDeal(deal.id)} className="font-bold" style={{ color: '#1F8B8B' }}>Open the full deal card →</button> : <span />}
        <button onClick={onRefresh} className="font-bold" style={{ color: '#888' }}>↻ Rebuild queue</button>
      </div>
    </div>
  )
}
function Actions({ busy, onOk, onCancel, okLabel, disabled }) {
  return <div className="flex gap-2 mt-3"><button onClick={onOk} disabled={busy || disabled} className="flex-1 rounded-xl py-3 text-sm font-extrabold text-white" style={{ backgroundColor: '#15803d', opacity: busy || disabled ? .5 : 1 }}>{busy ? 'Saving…' : okLabel}</button><button onClick={onCancel} disabled={busy} className="rounded-xl px-4 py-3 text-sm font-bold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Back</button></div>
}
// What the NEXT stage's gate still wants (mirrors services/deals.js gateFor).
function gateNeeds(d, meta) {
  const stages = meta?.stages || []
  const idx = stages.indexOf(d.stage); const next = stages[idx + 1]
  const m = []
  if (next === 'Prospecting' && !(d.tq_score && d.sq_score && d.fq_score)) m.push('the three scores')
  if (next === 'Discovery') { if (!d.pain_in_their_words) m.push('pain in their words'); if (!(d.pain_types || []).length) m.push('pain types'); if (!d.decision_maker_id) m.push('decision maker') }
  if (next === 'Bridged' && !d.billing_expectations_set) m.push('billing expectations set')
  if (next === 'Next Step Asked' && !(d.next_step && d.next_step_date)) m.push('a next step with a date')
  if (next === 'Implementing' && !d.w9_received) m.push('the W-9')
  if (next === 'Won' && !(d.first_job_id && d.second_job_id)) m.push('two linked jobs')
  return m
}
