// 💵 Pay & Benefits (Mark 2026-10-16). One record per person; the offer
// letter is built from it. MARK ONLY: the server 404s everyone else and
// this component is only mounted for Mark's login (not Kat, not the tech).
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch, ORANGE } from '../books/shared'

const GREEN = '#15803d', RED = '#b91c1c', AMBER = '#92400e'
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }
const today = () => new Date().toISOString().slice(0, 10)
const LETTER = { inprogress: ['✍️ Out for signature', '#fef3c7', AMBER], completed: ['✅ Signed', '#dcfce7', GREEN], declined: ['✖ Declined', '#fef2f2', RED], recalled: ['↩ Recalled', '#f5f3f0', '#555'], expired: ['⌛ Expired', '#fef2f2', RED] }

function Wrap({ title, right, children }) {
  return (
    <div className="rounded-xl mb-3 overflow-hidden" style={{ border: `1px solid ${ORANGE}55` }}>
      <div className="px-3 py-2 flex items-center justify-between gap-2" style={{ backgroundColor: '#fff5f0' }}>
        <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: ORANGE, fontFamily: 'IBM Plex Mono, monospace' }}>{title}</div>
        {right}
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  )
}
const Btn = ({ children, onClick, tone = 'gray', disabled }) => <button type="button" disabled={disabled} onClick={onClick} className="text-[11px] font-bold rounded-full px-2.5 py-1 disabled:opacity-50" style={tone === 'orange' ? { backgroundColor: ORANGE, color: 'white' } : tone === 'green' ? { backgroundColor: GREEN, color: 'white' } : tone === 'line' ? { backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` } : { backgroundColor: '#f5f3f0', color: '#555' }}>{children}</button>
const N = ({ v, on, w = 'w-24', step = '1' }) => <input type="number" step={step} value={v ?? ''} onChange={e => on(e.target.value === '' ? '' : Number(e.target.value))} className={`text-sm rounded-lg px-2 py-1.5 ${w}`} style={inp} />
const Lbl = ({ children }) => <div className="text-[11px] font-semibold mt-2 mb-0.5" style={{ color: '#666' }}>{children}</div>

export default function PayBenefits({ m }) {
  const owner = true
  const [rec, setRec] = useState(null)        // view from API
  const [tpls, setTpls] = useState({})
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState(null)      // working copy of comp
  const [busy, setBusy] = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [msg, setMsg] = useState('')

  const load = async () => {
    setErr('')
    try {
      const d = await j('/api/comp'); setTpls(d.templates || {}); setRec(d.members.find(x => x.id === m.id) || { id: m.id, has_comp: false })
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [m.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(body) {
    setBusy(true); setErr('')
    try { const d = await j(`/api/comp/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); setRec(d.member); setEdit(null); setMsg('Saved.') } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const preview = () => openPdf(`/api/comp/${m.id}/letter.pdf`)
  async function openPdf(path) {
    const w = window.open('', '_blank')     // open first (iOS blocks window.open after await)
    try {
      const r = await apiFetch(`${API_BASE}${path}`)
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`) }
      const url = URL.createObjectURL(await r.blob())
      if (w) w.location.href = url; else window.location.href = url
    } catch (e) { if (w) w.close(); setErr(e.message) }
  }
  async function send() {
    setBusy(true); setErr('')
    try { await j(`/api/comp/${m.id}/send-letter`, { method: 'POST' }); setConfirmSend(false); setMsg(`Sent to ${m.name.split(' ')[0]} by text and email.`); await load() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function check() {
    setBusy(true); setErr('')
    try { await j(`/api/comp/${m.id}/letter-check`, { method: 'POST' }); await load() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const c = rec?.comp
  const letter = rec?.letter
  const pill = letter && LETTER[letter.status]

  // ── Editor ──────────────────────────────────────────────────────────────
  if (edit) {
    const set = (k, v) => setEdit(e => ({ ...e, [k]: v }))
    const setB = (k, v) => setEdit(e => ({ ...e, benefits: { ...e.benefits, [k]: v } }))
    const rev = edit.bonuses.find(b => b.kind === 'revenue_tiers'), shop = edit.bonuses.find(b => b.kind === 'new_shop')
    const setBonus = (kind, patch) => setEdit(e => ({ ...e, bonuses: e.bonuses.map(b => b.kind === kind ? { ...b, ...patch } : b) }))
    const toggleBonus = (kind, on) => setEdit(e => {
      const rest = e.bonuses.filter(b => b.kind !== kind)
      if (!on) return { ...e, bonuses: rest }
      const add = kind === 'revenue_tiers'
        ? { kind, label: 'Monthly revenue production bonus', threshold: 40000, tiers: [{ up_to: 55000, pct: 5 }, { up_to: null, pct: 8 }], note: 'Calibrations, pre/post scans, diagnostics and labor count; Calibration ID, technology and other pass-through fees do not. Paid the 15th of the following month.' }
        : { kind, label: 'New shop account bonus', amount: 500, min_jobs: 10, note: 'Paid the 15th of the month after the 10th job. No cap.' }
      return { ...e, bonuses: [...rest, add] }
    })
    const ck = (k, label) => <label key={k} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!!edit.benefits[k]} onChange={e => setB(k, e.target.checked)} />{label}</label>
    return (
      <Wrap title="Pay & benefits · editing" right={<Btn onClick={() => setEdit(null)}>cancel</Btn>}>
        <div className="grid grid-cols-2 gap-x-3">
          <div className="col-span-2"><Lbl>Worker type</Lbl><select value={edit.employment} onChange={e => set('employment', e.target.value)} className="text-sm rounded-lg px-2 py-1.5 w-full" style={inp}><option value="w2">W-2 employee (offer letter)</option><option value="contractor">1099 contractor (contractor agreement)</option></select></div>
          <div><Lbl>Pay type</Lbl><select value={edit.pay_type} onChange={e => set('pay_type', e.target.value)} className="text-sm rounded-lg px-2 py-1.5 w-full" style={inp}><option value="hourly">Hourly</option><option value="salary">Salary (per year)</option><option value="monthly">Monthly</option><option value="per_job">Per job</option></select></div>
          <div><Lbl>{edit.pay_type === 'salary' ? 'Salary $/yr' : edit.pay_type === 'monthly' ? '$ per month' : edit.pay_type === 'per_job' ? '$ per job' : '$ per hour'}</Lbl><N v={edit.pay_rate} on={v => set('pay_rate', v)} w="w-full" step="0.25" /></div>
          <div><Lbl>Start date</Lbl><input type="date" value={edit.start_date} onChange={e => set('start_date', e.target.value)} className="text-sm rounded-lg px-2 py-1.5 w-full" style={inp} /></div>
          <div><Lbl>Pay effective</Lbl><input type="date" value={edit.effective_date} onChange={e => set('effective_date', e.target.value)} className="text-sm rounded-lg px-2 py-1.5 w-full" style={inp} /></div>
          <div className="col-span-2"><Lbl>Title on the letter</Lbl><input value={edit.title} onChange={e => set('title', e.target.value)} className="text-sm rounded-lg px-2 py-1.5 w-full" style={inp} /></div>
          <div className="col-span-2"><Lbl>Work area</Lbl><input value={edit.work_area} onChange={e => set('work_area', e.target.value)} className="text-sm rounded-lg px-2 py-1.5 w-full" style={inp} /></div>
        </div>

        <Lbl>Bonuses</Lbl>
        <label className="flex items-center gap-1.5 text-sm font-semibold"><input type="checkbox" checked={!!rev} onChange={e => toggleBonus('revenue_tiers', e.target.checked)} />Monthly revenue bonus</label>
        {rev && <div className="flex flex-wrap items-center gap-1.5 text-xs ml-5 mb-1" style={{ color: '#555' }}>over $<N v={rev.threshold} on={v => setBonus('revenue_tiers', { threshold: v })} /> · <N v={rev.tiers[0]?.pct} on={v => setBonus('revenue_tiers', { tiers: [{ ...rev.tiers[0], pct: v }, rev.tiers[1]] })} w="w-14" />% up to $<N v={rev.tiers[0]?.up_to} on={v => setBonus('revenue_tiers', { tiers: [{ ...rev.tiers[0], up_to: v }, rev.tiers[1]] })} /> · then <N v={rev.tiers[1]?.pct} on={v => setBonus('revenue_tiers', { tiers: [rev.tiers[0], { up_to: null, pct: v }] })} w="w-14" />%</div>}
        <label className="flex items-center gap-1.5 text-sm font-semibold"><input type="checkbox" checked={!!shop} onChange={e => toggleBonus('new_shop', e.target.checked)} />New shop bonus</label>
        {shop && <div className="flex flex-wrap items-center gap-1.5 text-xs ml-5" style={{ color: '#555' }}>$<N v={shop.amount} on={v => setBonus('new_shop', { amount: v })} /> after <N v={shop.min_jobs} on={v => setBonus('new_shop', { min_jobs: v })} w="w-14" /> jobs</div>}

        <Lbl>Benefits</Lbl>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">Health reimbursement $<N v={edit.benefits.qsehra_monthly} on={v => setB('qsehra_monthly', v)} w="w-20" />/mo</div>
        <div className="flex flex-wrap items-center gap-1.5 text-sm mt-1">Vacation <N v={edit.benefits.vacation_days} on={v => setB('vacation_days', v)} w="w-14" /> days after <N v={edit.benefits.vacation_wait_days} on={v => setB('vacation_wait_days', v)} w="w-14" /> days · <label className="flex items-center gap-1"><input type="checkbox" checked={!!edit.benefits.vacation_carryover} onChange={e => setB('vacation_carryover', e.target.checked)} />carries over</label></div>
        <div className="flex flex-wrap items-center gap-1.5 text-sm mt-1">Paid holidays <N v={edit.benefits.paid_holidays} on={v => setB('paid_holidays', v)} w="w-14" /> · <label className="flex items-center gap-1"><input type="checkbox" checked={edit.benefits.sick_leave === 'wa'} onChange={e => setB('sick_leave', e.target.checked ? 'wa' : 'none')} />WA sick leave</label></div>
        <div className="flex flex-wrap gap-3 mt-1.5">{ck('company_van', 'Company van')}{ck('tools_provided', 'Tools')}{ck('training', 'Training')}{ck('phone', 'Phone')}</div>
        <Lbl>Other perks (one per line)</Lbl>
        <textarea rows={2} value={(edit.benefits.other || []).join('\n')} onChange={e => setB('other', e.target.value.split('\n'))} className="text-sm rounded-lg px-2 py-1.5 w-full" style={inp} placeholder="e.g. Boot allowance $150/yr" />

        <Lbl>Reviews</Lbl>
        {(edit.reviews || []).map((r, i) => <div key={i} className="flex flex-wrap items-center gap-1.5 mb-1"><input type="date" value={r.date} onChange={e => set('reviews', edit.reviews.map((x, k) => k === i ? { ...x, date: e.target.value } : x))} className="text-sm rounded-lg px-2 py-1" style={inp} /><input value={r.label} onChange={e => set('reviews', edit.reviews.map((x, k) => k === i ? { ...x, label: e.target.value } : x))} className="text-sm rounded-lg px-2 py-1 flex-1 min-w-[120px]" style={inp} /><label className="text-xs flex items-center gap-1"><input type="checkbox" checked={!!r.done} onChange={e => set('reviews', edit.reviews.map((x, k) => k === i ? { ...x, done: e.target.checked } : x))} />done</label><button onClick={() => set('reviews', edit.reviews.filter((_, k) => k !== i))} className="text-xs" style={{ color: RED }}>×</button></div>)}
        <Btn tone="line" onClick={() => set('reviews', [...(edit.reviews || []), { date: '', label: 'Annual review', done: false }])}>＋ add review</Btn>

        <Lbl>Private notes (only Mark &amp; Kat)</Lbl>
        <textarea rows={2} value={edit.notes} onChange={e => set('notes', e.target.value)} className="text-sm rounded-lg px-2 py-1.5 w-full" style={inp} />
        {err && <div className="text-xs mt-2" style={{ color: RED }}>{err}</div>}
        <div className="flex gap-2 mt-3"><button disabled={busy} onClick={() => save({ comp: { ...edit, benefits: { ...edit.benefits, other: (edit.benefits.other || []).map(s => s.trim()).filter(Boolean) } } })} className="text-sm font-bold rounded-lg px-4 py-2 text-white disabled:opacity-50" style={{ backgroundColor: GREEN }}>{busy ? 'Saving…' : 'Save'}</button></div>
      </Wrap>
    )
  }

  // ── Not set up yet ──────────────────────────────────────────────────────
  if (rec && !rec.has_comp) {
    return (
      <Wrap title="Pay & benefits">
        <div className="text-sm mb-2" style={{ color: '#555' }}>Not set up yet. Start from a package, then change what's different for {m.name.split(' ')[0]}.</div>
        <div className="flex gap-1.5 flex-wrap">{Object.entries(tpls).map(([k, t]) => <Btn key={k} tone="orange" disabled={busy} onClick={() => save({ from_template: k })}>＋ {t.label || k}</Btn>)}</div>
        {err && <div className="text-xs mt-2" style={{ color: RED }}>{err}</div>}
      </Wrap>
    )
  }
  if (!rec) return err ? <div className="text-xs mb-3" style={{ color: RED }}>Pay & benefits: {err}</div> : null

  // ── Read view ───────────────────────────────────────────────────────────
  const overdue = rec.next_review && rec.next_review.date < today()
  return (
    <Wrap title="Pay & benefits · only you can see this" right={owner && <div className="flex gap-1"><Btn tone="line" onClick={() => { const e = JSON.parse(JSON.stringify(c)); e.reviews = (e.reviews || []).filter(r => !r.auto); setEdit(e) }}>✏️ Edit</Btn></div>}>
      {(rec.summary || []).map((r, i) => (
        <div key={i} className="flex gap-3 py-1.5 text-sm" style={{ borderBottom: '1px solid #f3f3f3' }}>
          <span className="w-20 shrink-0" style={{ color: '#888' }}>{r.k}</span>
          <span className="font-semibold" style={{ color: r.k === 'Next review' && overdue ? RED : '#1a1a1a' }}>{r.v}{r.k === 'Next review' && overdue ? ' · overdue' : ''}</span>
        </div>
      ))}
      {(rec.checkins || []).length > 0 && (
        <div className="mt-2 rounded-lg px-2.5 py-2" style={{ backgroundColor: '#f8f6f4' }}>
          <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Check-ins · set automatically</div>
          {rec.checkins.map(it => (
            <div key={it.key} className="flex justify-between gap-2 text-sm py-0.5">
              <span>{it.slot === 'coffee' ? '☕' : '🍺'} {it.label}</span>
              <span className="text-xs font-semibold" style={{ color: it.status === 'booked' ? GREEN : it.status === 'failed' ? RED : '#999' }}>
                {new Date(it.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}{it.status === 'booked' ? ` · ${it.slot === 'coffee' ? '7:00 AM' : '5:30 PM'} · on your calendar` : it.status === 'past' ? ' · already past' : it.status === 'failed' ? ' · could not book' : ''}
              </span>
            </div>
          ))}
          <div className="text-[11px] mt-1" style={{ color: '#888' }}>Move them in your Zoho calendar if the day doesn't work. A new start date re-books them.</div>
        </div>
      )}
      {owner && (
        <div className="mt-2">
          <div className="flex gap-1.5 flex-wrap items-center">
            <Btn onClick={preview}>📄 Preview letter</Btn>
            {!confirmSend && <Btn tone="orange" disabled={busy} onClick={() => setConfirmSend(true)}>✍️ {letter?.status === 'inprogress' ? 'Resend' : 'Send for signature'}</Btn>}
            {letter?.status === 'inprogress' && <Btn disabled={busy} onClick={check}>↻ Check</Btn>}
            {letter?.status === 'completed' && <Btn onClick={() => openPdf(`/api/comp/${m.id}/signed.pdf`)}>📎 Signed copy</Btn>}
            {pill && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: pill[1], color: pill[2] }}>{pill[0]}{letter.signed_at ? ` ${String(letter.signed_at).slice(0, 10)}` : letter.sent_at ? ` · sent ${String(letter.sent_at).slice(0, 10)}` : ''}</span>}
          </div>
          {confirmSend && (
            <div className="rounded-lg p-2.5 mt-2" style={{ backgroundColor: '#fff5f0', border: `1px solid ${ORANGE}` }}>
              <div className="text-xs font-bold mb-1" style={{ color: '#1a1a1a' }}>Send this letter to {m.name.split(' ')[0]} to sign? (text + email to {m.email || 'no email on file'})</div>
              <div className="text-[11px] mb-2" style={{ color: '#666' }}>Preview it first. {letter?.status === 'inprogress' ? 'The letter already out gets recalled. ' : ''}They read and sign on their phone; you both get the signed copy by email.</div>
              <div className="flex gap-2"><button disabled={busy || !m.email} onClick={send} className="text-xs font-bold rounded-lg px-3 py-1.5 text-white disabled:opacity-50" style={{ backgroundColor: GREEN }}>{busy ? 'Sending…' : 'Yes, send it'}</button><button onClick={() => setConfirmSend(false)} className="text-xs font-semibold px-2" style={{ color: '#888' }}>cancel</button></div>
            </div>
          )}
          {msg && <div className="text-xs mt-2" style={{ color: GREEN }}>{msg}</div>}
          {err && <div className="text-xs mt-2" style={{ color: RED }}>{err}</div>}
          {c?.notes && <div className="text-xs mt-2 px-2 py-1.5 rounded-lg" style={{ backgroundColor: '#f8f6f4', color: '#555' }}>🔒 {c.notes}</div>}
          {(c?.history || []).length > 0 && <details className="mt-2"><summary className="text-[11px] font-semibold cursor-pointer" style={{ color: '#888' }}>History ({c.history.length})</summary>{c.history.slice().reverse().map((h, i) => <div key={i} className="text-[11px] py-0.5" style={{ color: '#666' }}>{String(h.at).slice(0, 10)} · {h.by?.split(' ')[0]} · {h.what}</div>)}</details>}
        </div>
      )}
    </Wrap>
  )
}

// 👥 My people (Mark only): everyone at a glance, built for 50+ techs.
// Search, next check-in, How I work, notes, pay, letter.
export function PayBenefitsTable() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('next')
  useEffect(() => { j('/api/comp').then(d => setRows(d.members)).catch(e => setErr(e.message)) }, [])
  if (err) return <div className="text-sm" style={{ color: RED }}>{err}</div>
  if (!rows) return <div className="text-sm" style={{ color: '#888' }}>Loading…</div>
  const money = n => `$${Number(n || 0).toLocaleString('en-US')}`
  const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const ql = q.toLowerCase()
  const list = rows.filter(r => !ql || [r.name, r.title, r.last_note?.text, ...(r.pinned || []).map(p => p.text), r.work_style?.top].some(x => String(x || '').toLowerCase().includes(ql)))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'notes' ? (b.notes_count || 0) - (a.notes_count || 0) : String(a.next_checkin?.date || '9999').localeCompare(String(b.next_checkin?.date || '9999')))
  const todo = { ws: rows.filter(r => !r.work_style).length, comp: rows.filter(r => !r.has_comp).length, letter: rows.filter(r => r.has_comp && !r.letter).length }
  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people, notes, strengths…" className="text-sm rounded-lg px-3 py-2 flex-1 min-w-[200px]" style={inp} />
        <select value={sort} onChange={e => setSort(e.target.value)} className="text-sm rounded-lg px-2 py-2" style={inp}><option value="next">Next check-in</option><option value="name">Name</option><option value="notes">Most notes</option></select>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3 text-[11px] font-bold">
        <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#f5f3f0' }}>{rows.length} people</span>
        {todo.ws > 0 && <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#fef3c7', color: AMBER }}>🧭 {todo.ws} haven't taken How I work</span>}
        {todo.comp > 0 && <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#fef3c7', color: AMBER }}>💵 {todo.comp} without pay & benefits</span>}
        {todo.letter > 0 && <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#fef3c7', color: AMBER }}>✍️ {todo.letter} letters not sent</span>}
      </div>
      <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid #e8e4e0' }}>
        <table className="w-full text-sm" style={{ minWidth: 860 }}>
          <thead><tr style={{ backgroundColor: '#f8f6f4', color: '#888' }} className="text-[11px] uppercase tracking-wider text-left">
            {['Person', 'Next check-in', 'How they work', 'Your notes', 'Pay', 'Benefits', 'Letter'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
          </tr></thead>
          <tbody>{list.map(r => {
            const c = r.comp, b = c?.benefits, lp = r.letter && LETTER[r.letter.status]
            return (
              <tr key={r.id} style={{ borderTop: '1px solid #f0ece8' }} className="align-top">
                <td className="px-3 py-2"><b>{r.name}</b><div className="text-[11px]" style={{ color: '#888' }}>{r.title}{r.hire_date ? ` · since ${r.hire_date}` : ''}</div></td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{r.next_checkin ? <>{r.next_checkin.slot === 'coffee' ? '☕' : '🍺'} {fmt(r.next_checkin.date)}<div style={{ color: '#888' }}>{r.next_checkin.label}</div></> : <span style={{ color: '#999' }}>—</span>}</td>
                <td className="px-3 py-2 text-xs">{r.work_style ? <><b style={{ color: GREEN }}>{r.work_style.top}</b><div style={{ color: '#888' }}>taken {String(r.work_style.taken_at).slice(0, 10)}</div></> : <span style={{ color: AMBER }}>not taken</span>}</td>
                <td className="px-3 py-2 text-xs" style={{ maxWidth: 260 }}>{(r.pinned || []).map(p => <div key={p.id}>📌 {p.text.slice(0, 80)}</div>)}{r.last_note && <div style={{ color: '#555' }}>{r.last_note.text.slice(0, 80)}</div>}{!r.notes_count && <span style={{ color: '#999' }}>—</span>}{r.notes_count > 0 && <div style={{ color: '#999' }}>{r.notes_count} note{r.notes_count === 1 ? '' : 's'}</div>}</td>
                {!c ? <td colSpan={3} className="px-3 py-2 text-xs" style={{ color: AMBER }}>No pay & benefits record. Open their profile → Pay & benefits.</td> : <>
                  <td className="px-3 py-2 font-semibold whitespace-nowrap">{c.pay_type === 'hourly' ? `${money(c.pay_rate)}/hr` : c.pay_type === 'salary' ? `${money(c.pay_rate)}/yr` : c.pay_type === 'monthly' ? `${money(c.pay_rate)}/mo` : `${money(c.pay_rate)}/job`}</td>
                  <td className="px-3 py-2 text-xs">{[b.qsehra_monthly && `${money(b.qsehra_monthly)}/mo health`, b.vacation_days && `${b.vacation_days} vac days`, c.bonuses.length && `${c.bonuses.length} bonus${c.bonuses.length > 1 ? 'es' : ''}`].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-3 py-2">{lp ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: lp[1], color: lp[2] }}>{lp[0]}</span> : <span className="text-[11px]" style={{ color: '#999' }}>not sent</span>}</td>
                </>}
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      <div className="text-[11px] mt-2" style={{ color: '#888' }}>Only your login sees this page. Tap a person in Directory for the full picture: notes, How they work, pay & benefits, check-ins.</div>
    </div>
  )
}
