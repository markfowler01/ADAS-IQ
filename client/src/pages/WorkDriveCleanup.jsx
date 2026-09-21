// WorkDrive folder cleanup (Mark 2026-09-21). Scan finds job folders that
// look like the same vehicle; Mark picks which one to keep and presses
// Merge. Nothing moves until he does.
import { useState } from 'react'
import Navbar from '../components/Navbar'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419', GREEN = '#15803d', RED = '#b91c1c'
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }

export default function WorkDriveCleanup({ user, onLogout, currentScreen, onNavigate }) {
  const [scan, setScan] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [keep, setKeep] = useState({})      // group key → folder id
  const [done, setDone] = useState({})      // group key → result
  const [confirmAll, setConfirmAll] = useState(false)
  async function run() { setBusy('scan'); setErr(''); setDone({}); try { const d = await j('/api/workdrive-cleanup/scan'); setScan(d); setKeep(Object.fromEntries(d.groups.map(g => [g.key, g.keep_id]))) } catch (e) { setErr(e.message) } finally { setBusy('') } }
  async function merge(g) {
    const keepId = keep[g.key] || g.keep_id
    setBusy(g.key); setErr('')
    try { const r = await j('/api/workdrive-cleanup/merge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keep_id: keepId, drop_ids: g.folders.map(f => f.id).filter(id => id !== keepId) }) }); setDone(d => ({ ...d, [g.key]: r })) }
    catch (e) { setErr(`${g.key}: ${e.message}`) } finally { setBusy('') }
  }
  async function mergeAll() { setConfirmAll(false); for (const g of scan.groups) if (!done[g.key]) await merge(g) }
  const pending = (scan?.groups || []).filter(g => !done[g.key])
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-3xl mx-auto px-4 py-5">
        <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Tools</div>
        <h1 className="text-2xl font-extrabold mb-1" style={{ color: '#1a1a1a' }}>📁 WorkDrive folder cleanup</h1>
        <p className="text-sm mb-4" style={{ color: '#555' }}>Finds job folders that look like the same car — same RO#, or same shop and vehicle — and combines them. Files move into the folder you keep (renamed if a name clashes), the empty folder goes to WorkDrive's trash, and any job card pointing at the old folder is repointed. Nothing moves until you press Merge.</p>
        <div className="flex gap-2 flex-wrap mb-4">
          <button onClick={run} disabled={!!busy} className="text-sm font-bold rounded-xl px-4 py-2.5 text-white" style={{ backgroundColor: ORANGE, opacity: busy ? .6 : 1 }}>{busy === 'scan' ? 'Scanning…' : scan ? '↻ Scan again' : '🔍 Scan job folders'}</button>
          {pending.length > 1 && !confirmAll && <button onClick={() => setConfirmAll(true)} disabled={!!busy} className="text-sm font-bold rounded-xl px-4 py-2.5" style={{ backgroundColor: 'white', color: RED, border: `1.5px solid ${RED}` }}>Merge all {pending.length} groups</button>}
          {confirmAll && <span className="flex items-center gap-2 text-sm"><span className="font-bold" style={{ color: RED }}>Merge all {pending.length} groups as suggested?</span><button onClick={mergeAll} className="text-sm font-bold rounded-xl px-3 py-2 text-white" style={{ backgroundColor: RED }}>Yes, merge all</button><button onClick={() => setConfirmAll(false)} className="text-sm px-2" style={{ color: '#888' }}>cancel</button></span>}
        </div>
        {err && <div className="text-sm mb-3 px-3 py-2 rounded-lg" style={{ backgroundColor: '#fef2f2', color: RED }}>{err}</div>}
        {scan && <div className="text-xs mb-3" style={{ color: '#888' }}>Scanned {scan.scanned} folders · {scan.groups.length} duplicate group{scan.groups.length === 1 ? '' : 's'}</div>}
        {scan && scan.groups.length === 0 && <div className="rounded-2xl p-6 text-center bg-white text-sm" style={{ border: '1.5px solid #e8e4e0', color: GREEN }}>✓ No duplicates. One folder per car.</div>}
        {(scan?.groups || []).map(g => {
          const r = done[g.key]
          return (
            <div key={g.key} className="rounded-2xl p-4 mb-3 bg-white" style={{ border: `1.5px solid ${r ? '#86efac' : '#e8e4e0'}` }}>
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <div className="text-xs font-bold uppercase tracking-wider" style={{ color: g.kind === 'ro' ? ORANGE : '#0e7490', fontFamily: 'IBM Plex Mono, monospace' }}>{g.kind === 'ro' ? `RO ${g.key.slice(3)}` : `same vehicle · ${g.key.slice(4)}`}</div>
                {r ? <span className="text-xs font-bold" style={{ color: GREEN }}>✓ merged · {r.moved} file{r.moved === 1 ? '' : 's'} moved · {r.trashed.length} folder{r.trashed.length === 1 ? '' : 's'} trashed{r.repointed ? ` · ${r.repointed} card${r.repointed === 1 ? '' : 's'} repointed` : ''}{r.failed.length ? ` · ${r.failed.length} failed` : ''}</span>
                  : <button onClick={() => merge(g)} disabled={!!busy} className="text-xs font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: RED, opacity: busy ? .6 : 1 }}>{busy === g.key ? 'Merging…' : `Merge ${g.folders.length - 1} into kept`}</button>}
              </div>
              {g.folders.map(f => {
                const isKeep = (keep[g.key] || g.keep_id) === f.id
                return (
                  <label key={f.id} className="flex items-start gap-3 py-2 cursor-pointer" style={{ borderTop: '1px solid #f3f3f3' }}>
                    <input type="radio" name={g.key} checked={isKeep} disabled={!!r} onChange={() => setKeep(k => ({ ...k, [g.key]: f.id }))} className="mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate" style={{ color: isKeep ? GREEN : '#1a1a1a' }}>{isKeep ? 'KEEP · ' : ''}{f.name}</div>
                      <div className="text-[11px]" style={{ color: '#888' }}>{f.files != null ? `${f.files} file${f.files === 1 ? '' : 's'}` : 'files: ?'}{f.created ? ` · created ${f.created}` : ''}{f.cards.length ? ` · card: ${f.cards.map(c => `${c.shop} ${c.vehicle} (${c.status})`).join(', ')}` : ' · no job card points here'}</div>
                    </div>
                    <a href={`https://workdrive.zoho.com/folder/${f.id}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-[11px] font-bold rounded-full px-2.5 py-1" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>open</a>
                  </label>
                )
              })}
              {r?.failed?.length > 0 && <div className="text-[11px] mt-2" style={{ color: RED }}>Couldn't move: {r.failed.map(x => `${x.name} (${x.error})`).join(' · ')}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
