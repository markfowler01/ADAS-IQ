// Directory → Training: everyone sees the modules and their own progress;
// Mark + Kat edit titles, video links, reading, and quiz questions.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch, ORANGE } from '../books/shared'

const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
const GREEN = '#15803d', BLUE = '#1d4ed8'
const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }

export default function TrainingTab() {
  const [d, setD] = useState(null); const [edit, setEdit] = useState(false); const [draft, setDraft] = useState(null); const [busy, setBusy] = useState(false); const [link, setLink] = useState('')
  const load = () => j('/api/people/course').then(setD).catch(() => {})
  useEffect(() => { load() }, [])
  if (!d) return <div className="text-sm py-6 text-center" style={{ color: '#888' }}>Loading…</div>
  const c = d.course
  async function save() { setBusy(true); try { await j('/api/people/course', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); await load(); setEdit(false) } catch (e) { alert(e.message) } finally { setBusy(false) } }
  const upd = (i, k, v) => setDraft(x => ({ ...x, modules: x.modules.map((m, n) => n === i ? { ...m, [k]: v } : m) }))
  const updQ = (i, qi, k, v) => setDraft(x => ({ ...x, modules: x.modules.map((m, n) => n === i ? { ...m, quiz: m.quiz.map((q, qn) => qn === qi ? { ...q, [k]: v } : q) } : m) }))
  if (edit && draft) return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap"><span className="text-sm font-bold">Editing the course</span><label className="text-xs" style={{ color: '#555' }}>Pass mark % <input type="number" value={draft.pass_pct} onChange={e => setDraft(x => ({ ...x, pass_pct: Number(e.target.value) }))} className="w-16 text-sm rounded-lg px-2 py-1 ml-1" style={inp} /></label><button onClick={save} disabled={busy} className="ml-auto rounded-xl px-4 py-2 text-sm font-bold text-white" style={{ backgroundColor: GREEN }}>{busy ? 'Saving…' : 'Save course'}</button><button onClick={() => setEdit(false)} className="rounded-xl px-3 py-2 text-sm font-semibold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button></div>
      {draft.modules.map((m, i) => (
        <div key={i} className="rounded-2xl p-3 mb-3 bg-white" style={{ border: '1.5px solid #e8e4e0' }}>
          <div className="flex gap-2 mb-2 flex-wrap"><input value={m.title} onChange={e => upd(i, 'title', e.target.value)} placeholder="Module title" className="flex-1 min-w-[200px] text-sm font-bold rounded-lg px-2 py-1.5" style={inp} /><input type="number" value={m.minutes} onChange={e => upd(i, 'minutes', Number(e.target.value))} className="w-20 text-sm rounded-lg px-2 py-1.5" style={inp} title="minutes" /><button onClick={() => setDraft(x => ({ ...x, modules: x.modules.filter((_, n) => n !== i) }))} className="text-xs font-bold" style={{ color: '#b91c1c' }}>remove</button></div>
          <input value={m.video_url} onChange={e => upd(i, 'video_url', e.target.value)} placeholder="Video link — YouTube (unlisted is fine), Loom, or a WorkDrive share link" className="w-full text-sm rounded-lg px-2 py-1.5 mb-2" style={inp} />
          <textarea value={m.reading} onChange={e => upd(i, 'reading', e.target.value)} rows={5} placeholder="What they read (short sentences)" className="w-full text-sm rounded-lg px-2 py-1.5 mb-2" style={inp} />
          <div className="text-[11px] font-bold mb-1" style={{ color: '#888' }}>QUIZ</div>
          {(m.quiz || []).map((q, qi) => (
            <div key={qi} className="rounded-lg p-2 mb-2" style={{ backgroundColor: '#faf9f7' }}>
              <div className="flex gap-2 mb-1"><input value={q.q} onChange={e => updQ(i, qi, 'q', e.target.value)} placeholder="Question" className="flex-1 text-sm rounded-lg px-2 py-1.5" style={inp} /><button onClick={() => upd(i, 'quiz', m.quiz.filter((_, n) => n !== qi))} className="text-xs font-bold" style={{ color: '#b91c1c' }}>✕</button></div>
              {q.options.map((o, oi) => <div key={oi} className="flex items-center gap-2 mb-1"><input type="radio" name={`c${i}_${qi}`} checked={q.correct === oi} onChange={() => updQ(i, qi, 'correct', oi)} title="correct answer" /><input value={o} onChange={e => updQ(i, qi, 'options', q.options.map((x, n) => n === oi ? e.target.value : x))} className="flex-1 text-sm rounded-lg px-2 py-1" style={inp} /></div>)}
              <button onClick={() => updQ(i, qi, 'options', [...q.options, ''])} className="text-[11px] font-bold" style={{ color: BLUE }}>＋ option</button>
            </div>
          ))}
          <button onClick={() => upd(i, 'quiz', [...(m.quiz || []), { id: `q${(m.quiz || []).length + 1}`, q: '', options: ['', ''], correct: 0 }])} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>＋ question</button>
        </div>
      ))}
      <button onClick={() => setDraft(x => ({ ...x, modules: [...x.modules, { id: `m${x.modules.length + 1}`, title: '', minutes: 5, video_url: '', reading: '', quiz: [] }] }))} className="text-sm font-bold rounded-xl px-4 py-2" style={{ backgroundColor: 'white', color: ORANGE, border: `1.5px solid ${ORANGE}` }}>＋ Add module</button>
    </div>
  )
  const passed = c.modules.filter(m => d.my_progress?.[m.id]?.passed).length
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="text-sm" style={{ color: '#555' }}>{c.modules.length} modules · pass mark {c.pass_pct}%{d.my_id ? ` · you've passed ${passed}/${c.modules.length}` : ''}</div>
        {d.my_id && <button onClick={async () => { try { const r = await j('/api/people/onboarding/my-link'); setLink(r.link); window.open(r.link, '_blank') } catch (e) { alert(e.message) } }} className="text-xs font-bold rounded-full px-3 py-1.5 text-white" style={{ backgroundColor: GREEN }}>▶ Take the training</button>}
        {d.editable && <button onClick={() => { setDraft(JSON.parse(JSON.stringify(c))); setEdit(true) }} className="ml-auto text-xs font-bold rounded-full px-3 py-1.5" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>✏️ Edit course</button>}
      </div>
      {c.modules.map((m, i) => (
        <div key={m.id} className="rounded-2xl p-4 mb-3 bg-white flex items-start gap-3" style={{ border: `1.5px solid ${d.my_progress?.[m.id]?.passed ? '#86efac' : '#e8e4e0'}` }}>
          <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{ backgroundColor: d.my_progress?.[m.id]?.passed ? GREEN : ORANGE }}>{d.my_progress?.[m.id]?.passed ? '✓' : i + 1}</span>
          <div className="flex-1 min-w-0"><div className="font-bold text-sm" style={{ color: '#1a1a1a' }}>{m.title}</div><div className="text-xs" style={{ color: '#888' }}>{m.minutes} min · {m.video_url ? '🎬 video' : '📝 no video yet'} · {(m.quiz || []).length} questions</div><div className="text-xs mt-1 line-clamp-2" style={{ color: '#555' }}>{m.reading}</div></div>
        </div>
      ))}
      <div className="text-xs" style={{ color: '#888' }}>New hires take this from their onboarding link. Everyone else can take it from the button above; progress shows on your profile.</div>
    </div>
  )
}
