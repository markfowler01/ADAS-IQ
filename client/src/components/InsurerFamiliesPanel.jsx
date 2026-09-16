// Insurer families → price list (Mark 2026-09-16: Ohio Security = Liberty
// Mutual = Allstate pricing). Everyone can read it; Mark + Kat edit.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import { loadInsurerFamilies } from '../lib/insurerFamilies.js'
const ORANGE = '#CD4419', GREEN = '#15803d'
const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }
export default function InsurerFamiliesPanel() {
  const [d, setD] = useState(null); const [edit, setEdit] = useState(false); const [draft, setDraft] = useState([]); const [busy, setBusy] = useState(false)
  const load = () => apiFetch(`${API_BASE}/api/insurers/families`).then(r => r.json()).then(setD).catch(() => {})
  useEffect(() => { load() }, [])
  if (!d) return null
  async function save() { setBusy(true); try { const r = await apiFetch(`${API_BASE}/api/insurers/families`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ families: draft }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); await load(); await loadInsurerFamilies(true); setEdit(false) } catch (e) { alert(e.message) } finally { setBusy(false) } }
  const upd = (i, k, v) => setDraft(x => x.map((f, n) => n === i ? { ...f, [k]: v } : f))
  return (
    <div className="rounded-2xl p-4 mb-5 bg-white" style={{ border: '1.5px solid #e8e4e0' }}>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <div><div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Pricing</div><div className="font-bold text-base" style={{ color: '#1a1a1a' }}>🏦 Insurer families → price list</div></div>
        {d.editable && !edit && <button onClick={() => { setDraft(JSON.parse(JSON.stringify(d.families)).map(f => ({ ...f, aliases: f.aliases.join(', ') }))); setEdit(true) }} className="ml-auto text-xs font-bold rounded-full px-3 py-1.5" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>✏️ Edit</button>}
      </div>
      <div className="text-xs mb-3" style={{ color: '#888' }}>When a job's insurer matches one of these names, the card shows the pill and invoices price from that list. Unknown insurers get asked once at review time and land here.</div>
      {!edit && d.families.map(f => (
        <div key={f.id} className="flex items-start gap-3 py-2 text-sm" style={{ borderTop: '1px solid #f3f3f3' }}>
          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full text-white flex-shrink-0" style={{ backgroundColor: f.color }}>{f.pill || f.parent}</span>
          <div className="flex-1 min-w-0"><b style={{ color: '#1a1a1a' }}>{f.parent}</b> <span style={{ color: '#888' }}>· {d.pools[f.pool] || f.pool}</span><div className="text-xs" style={{ color: '#555' }}>{f.aliases.join(' · ')}</div></div>
        </div>
      ))}
      {edit && (
        <div>
          {draft.map((f, i) => (
            <div key={i} className="rounded-lg p-2 mb-2" style={{ backgroundColor: '#faf9f7' }}>
              <div className="flex gap-2 mb-1.5 flex-wrap">
                <input value={f.parent} onChange={e => upd(i, 'parent', e.target.value)} placeholder="Parent company" className="flex-1 min-w-[140px] text-sm rounded-lg px-2 py-1.5 font-bold" style={inp} />
                <select value={f.pool} onChange={e => upd(i, 'pool', e.target.value)} className="text-sm rounded-lg px-2 py-1.5" style={inp}>{Object.entries(d.pools).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input value={f.pill} onChange={e => upd(i, 'pill', e.target.value)} placeholder="Pill text" className="w-56 text-sm rounded-lg px-2 py-1.5" style={inp} />
                <input type="color" value={f.color} onChange={e => upd(i, 'color', e.target.value)} className="w-10 h-9 rounded-lg" style={inp} />
                <button onClick={() => setDraft(x => x.filter((_, n) => n !== i))} className="text-xs font-bold" style={{ color: '#b91c1c' }}>remove</button>
              </div>
              <input value={f.aliases} onChange={e => upd(i, 'aliases', e.target.value)} placeholder="Names that count, comma-separated (e.g. ohio security, safeco)" className="w-full text-sm rounded-lg px-2 py-1.5" style={inp} />
            </div>
          ))}
          <div className="flex gap-2"><button onClick={() => setDraft(x => [...x, { id: `fam${x.length + 1}`, parent: '', pool: 'STD', pill: '', color: '#555555', aliases: '' }])} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>＋ family</button><button onClick={save} disabled={busy} className="text-xs font-bold rounded-lg px-3 py-1.5 text-white" style={{ backgroundColor: GREEN }}>{busy ? 'Saving…' : 'Save'}</button><button onClick={() => setEdit(false)} className="text-xs font-semibold px-2" style={{ color: '#888' }}>cancel</button></div>
        </div>
      )}
    </div>
  )
}
