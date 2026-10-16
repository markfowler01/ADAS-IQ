// 🔒 Mark's notes on a person — tips, tricks, life details, wins, concerns,
// goals. Mark only (server 404s everyone else). Pinned notes stay on top
// and ride along in the day-before check-in prep brief.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch, ORANGE } from '../books/shared'

const GREEN = '#15803d', RED = '#b91c1c'
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
const TAGS = { tip: '💡 Tip', life: '❤️ Life & family', win: '⭐ Win', concern: '⚠️ Concern', goal: '🎯 Goal', other: '🗒 Note' }
const TAG_BG = { tip: '#fef9c3', life: '#fce7f3', win: '#dcfce7', concern: '#fee2e2', goal: '#e0e7ff', other: '#f5f3f0' }
const ago = iso => { const d = Math.round((Date.now() - new Date(iso)) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d}d ago` : String(iso).slice(0, 10) }

export default function MarkNotes({ m }) {
  const [notes, setNotes] = useState(null)
  const [text, setText] = useState('')
  const [tag, setTag] = useState('tip')
  const [pin, setPin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [delId, setDelId] = useState('')
  useEffect(() => { j(`/api/comp/${m.id}/notes`).then(d => setNotes(d.notes)).catch(e => setErr(e.message)) }, [m.id])
  const run = async (fn) => { setBusy(true); setErr(''); try { const d = await fn(); setNotes(d.notes) } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const add = () => run(async () => { const d = await j(`/api/comp/${m.id}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, tag, pinned: pin }) }); setText(''); setPin(false); return d })
  const upd = (id, body) => run(() => j(`/api/comp/${m.id}/notes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  const del = id => run(async () => { const d = await j(`/api/comp/${m.id}/notes/${id}`, { method: 'DELETE' }); setDelId(''); return d })
  const shown = (notes || []).filter(n => !q || n.text.toLowerCase().includes(q.toLowerCase()) || TAGS[n.tag].toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="rounded-xl mb-3 overflow-hidden" style={{ border: `1px solid ${ORANGE}55` }}>
      <div className="px-3 py-2 flex items-center justify-between" style={{ backgroundColor: '#fff5f0' }}>
        <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: ORANGE, fontFamily: 'IBM Plex Mono, monospace' }}>🔒 My notes on {m.name.split(' ')[0]} · only you</div>
        {notes && <span className="text-[10px]" style={{ color: '#999' }}>{notes.length}</span>}
      </div>
      <div className="px-3 py-2">
        <textarea rows={2} value={text} onChange={e => setText(e.target.value)} placeholder={`Anything worth remembering about ${m.name.split(' ')[0]}: kids' names, how they like feedback, what fires them up, a tip that worked…`} className="w-full text-sm rounded-lg px-2 py-1.5" style={{ border: '1px solid #e0dbd6', outline: 'none' }} />
        <div className="flex flex-wrap gap-1 items-center mt-1">
          {Object.entries(TAGS).map(([k, l]) => <button key={k} type="button" onClick={() => setTag(k)} className="text-[11px] font-bold rounded-full px-2 py-0.5" style={tag === k ? { backgroundColor: '#1a1a1a', color: 'white' } : { backgroundColor: TAG_BG[k], color: '#444' }}>{l}</button>)}
          <label className="text-[11px] flex items-center gap-1 ml-1"><input type="checkbox" checked={pin} onChange={e => setPin(e.target.checked)} />📌 pin</label>
          <button type="button" disabled={busy || !text.trim()} onClick={add} className="ml-auto text-xs font-bold rounded-lg px-3 py-1.5 text-white disabled:opacity-40" style={{ backgroundColor: GREEN }}>{busy ? '…' : 'Save'}</button>
        </div>
        {err && <div className="text-xs mt-1" style={{ color: RED }}>{err}</div>}
        {(notes || []).length > 6 && <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search notes…" className="w-full text-xs rounded-lg px-2 py-1 mt-2" style={{ border: '1px solid #e0dbd6', outline: 'none' }} />}
        <div className="mt-2">
          {notes === null && !err && <div className="text-xs" style={{ color: '#999' }}>Loading…</div>}
          {notes && notes.length === 0 && <div className="text-xs" style={{ color: '#999' }}>No notes yet. Pinned and ⚠️/🎯/❤️ notes show up in your prep brief the day before each check-in.</div>}
          {shown.map(n => (
            <div key={n.id} className="py-1.5" style={{ borderBottom: '1px solid #f3f3f3' }}>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="font-bold rounded-full px-1.5 py-0.5" style={{ backgroundColor: TAG_BG[n.tag] }}>{TAGS[n.tag]}</span>
                <span style={{ color: '#999' }}>{ago(n.at)}</span>
                <button onClick={() => upd(n.id, { pinned: !n.pinned })} className="ml-auto" title={n.pinned ? 'Unpin' : 'Pin'} style={{ opacity: n.pinned ? 1 : 0.35 }}>📌</button>
                {delId === n.id
                  ? <><button onClick={() => del(n.id)} className="font-bold" style={{ color: RED }}>delete</button><button onClick={() => setDelId('')} style={{ color: '#888' }}>keep</button></>
                  : <button onClick={() => setDelId(n.id)} style={{ color: '#bbb' }}>✕</button>}
              </div>
              <div className="text-sm mt-0.5 whitespace-pre-wrap" style={{ color: '#1a1a1a' }}>{n.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
