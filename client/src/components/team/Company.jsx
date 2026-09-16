// Company page (phase 8): mission, values, who-to-call, roles per seat.
// Everyone reads; Mark + Kat edit in place.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch, ORANGE } from '../books/shared'

const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
const GREEN = '#15803d'

export default function CompanyTab() {
  const [c, setC] = useState(null)
  const [editable, setEditable] = useState(false)
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => j('/api/people/company').then(d => { setC(d.company); setEditable(!!d.editable) }).catch(() => {})
  useEffect(() => { load() }, [])
  if (!c) return <div className="text-sm py-6 text-center" style={{ color: '#888' }}>Loading…</div>
  const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }
  async function save() { setBusy(true); try { const d = await j('/api/people/company', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); setC(d.company); setEdit(false) } catch (e) { alert(e.message) } finally { setBusy(false) } }
  const Card = ({ title, children }) => <div className="rounded-2xl p-4 mb-4 bg-white" style={{ border: '1.5px solid #e8e4e0' }}><div className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>{title}</div>{children}</div>
  if (edit && draft) {
    const upd = (k, i, f, v) => setDraft(d => ({ ...d, [k]: d[k].map((x, n) => n === i ? { ...x, [f]: v } : x) }))
    const del = (k, i) => setDraft(d => ({ ...d, [k]: d[k].filter((_, n) => n !== i) }))
    return (
      <div>
        <Card title="Mission"><textarea value={draft.mission} onChange={e => setDraft(d => ({ ...d, mission: e.target.value }))} rows={3} className="w-full text-sm rounded-lg px-2.5 py-2" style={inp} /></Card>
        <Card title="Values (one per line)"><textarea value={draft.values.join('\n')} onChange={e => setDraft(d => ({ ...d, values: e.target.value.split('\n') }))} rows={6} className="w-full text-sm rounded-lg px-2.5 py-2" style={inp} /></Card>
        <Card title="Who to call">
          {draft.who_to_call.map((w, i) => <div key={i} className="flex gap-2 mb-2 flex-wrap"><input value={w.need} onChange={e => upd('who_to_call', i, 'need', e.target.value)} placeholder="Need" className="flex-1 min-w-[160px] text-sm rounded-lg px-2 py-1.5" style={inp} /><input value={w.person} onChange={e => upd('who_to_call', i, 'person', e.target.value)} placeholder="Person" className="w-40 text-sm rounded-lg px-2 py-1.5" style={inp} /><input value={w.note} onChange={e => upd('who_to_call', i, 'note', e.target.value)} placeholder="How / note" className="w-44 text-sm rounded-lg px-2 py-1.5" style={inp} /><button onClick={() => del('who_to_call', i)} className="text-xs font-bold" style={{ color: '#b91c1c' }}>remove</button></div>)}
          <button onClick={() => setDraft(d => ({ ...d, who_to_call: [...d.who_to_call, { need: '', person: '', note: '' }] }))} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>＋ row</button>
        </Card>
        <Card title="Seats & responsibilities">
          {draft.seats.map((s, i) => <div key={i} className="mb-3 rounded-lg p-2" style={{ backgroundColor: '#faf9f7' }}><div className="flex gap-2 mb-1 flex-wrap"><input value={s.title} onChange={e => upd('seats', i, 'title', e.target.value)} placeholder="Seat title" className="flex-1 min-w-[160px] text-sm rounded-lg px-2 py-1.5 font-bold" style={inp} /><input value={s.person} onChange={e => upd('seats', i, 'person', e.target.value)} placeholder="Who" className="w-40 text-sm rounded-lg px-2 py-1.5" style={inp} /><button onClick={() => del('seats', i)} className="text-xs font-bold" style={{ color: '#b91c1c' }}>remove</button></div><textarea value={s.responsibilities} onChange={e => upd('seats', i, 'responsibilities', e.target.value)} rows={2} placeholder="What this seat owns" className="w-full text-sm rounded-lg px-2 py-1.5" style={inp} /></div>)}
          <button onClick={() => setDraft(d => ({ ...d, seats: [...d.seats, { title: '', person: '', responsibilities: '' }] }))} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>＋ seat</button>
        </Card>
        <div className="flex gap-2"><button onClick={save} disabled={busy} className="rounded-xl px-5 py-2.5 text-sm font-bold text-white" style={{ backgroundColor: GREEN }}>{busy ? 'Saving…' : 'Save'}</button><button onClick={() => setEdit(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button></div>
      </div>
    )
  }
  return (
    <div>
      {editable && <div className="mb-3 text-right"><button onClick={() => { setDraft(JSON.parse(JSON.stringify(c))); setEdit(true) }} className="text-xs font-bold rounded-full px-3 py-1.5" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>✏️ Edit page</button></div>}
      <Card title="Mission"><div className="text-lg font-extrabold leading-snug" style={{ color: '#1a1a1a' }}>{c.mission}</div></Card>
      <Card title="What we stand for"><ul className="space-y-1">{c.values.map((v, i) => <li key={i} className="text-sm flex gap-2" style={{ color: '#1a1a1a' }}><span style={{ color: ORANGE }}>■</span>{v}</li>)}</ul></Card>
      <Card title="Who to call">
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #ebe7e3' }}>
          {c.who_to_call.map((w, i) => <div key={i} className="flex gap-3 px-3 py-2 text-sm" style={{ borderTop: i ? '1px solid #f3f3f3' : 'none' }}><div className="flex-1" style={{ color: '#1a1a1a' }}>{w.need}</div><div className="font-bold" style={{ color: '#1a1a1a' }}>{w.person}</div>{w.note && <div className="text-xs hidden sm:block" style={{ color: '#888' }}>{w.note}</div>}</div>)}
        </div>
      </Card>
      <Card title="Seats & responsibilities">
        {c.seats.map((s, i) => <div key={i} className="py-2" style={{ borderTop: i ? '1px solid #f3f3f3' : 'none' }}><div className="text-sm"><b style={{ color: '#1a1a1a' }}>{s.title}</b>{s.person ? <span style={{ color: '#888' }}> · {s.person}</span> : null}</div><div className="text-xs mt-0.5" style={{ color: '#555' }}>{s.responsibilities}</div></div>)}
      </Card>
      {c.updated_at && <div className="text-[11px]" style={{ color: '#999' }}>Updated {String(c.updated_at).slice(0, 10)} by {c.updated_by}</div>}
    </div>
  )
}
