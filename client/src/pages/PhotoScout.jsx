// 📸 Photo Scout review (Mark 2026-10-09). The agent scores every calibration shot in the job
// folders; this screen shows the picks best-first so Mark can approve, skip, or mark used.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419', INK = '#1a1a1a'
const TABS = [
  { id: 'pick', label: '✨ New picks' },
  { id: 'maybe', label: '🤔 Maybe' },
  { id: 'approved', label: '👍 Approved' },
  { id: 'used', label: '📣 Posted' },
  { id: 'rejected', label: '🚫 Passed' },
]

function Thumb({ fileId }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let url = '', dead = false
    apiFetch(`${API_BASE}/api/photo-scout/thumb/${fileId}`).then(r => r.ok ? r.blob() : null).then(b => { if (b && !dead) { url = URL.createObjectURL(b); setSrc(url) } }).catch(() => {})
    return () => { dead = true; if (url) URL.revokeObjectURL(url) }
  }, [fileId])
  return src ? <img src={src} alt="" className="w-full h-56 object-cover rounded-t-2xl" /> : <div className="w-full h-56 rounded-t-2xl animate-pulse" style={{ backgroundColor: '#eee' }} />
}

export default function PhotoScout() {
  const [tab, setTab] = useState('pick')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState('')
  const load = async () => { setLoading(true); try { const r = await apiFetch(`${API_BASE}/api/photo-scout?state=${tab}`); const d = await r.json(); setRows(d.rows || []) } catch { setRows([]) } finally { setLoading(false) } }
  useEffect(() => { load() }, [tab])
  const setState = async (row, state) => { setRows(rs => rs.filter(r => r.id !== row.id)); await apiFetch(`${API_BASE}/api/photo-scout/${row.id}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) }).catch(() => {}) }
  const run = async () => {
    setRunning(true); setNote('Scouting the last 7 days of job folders…')
    try { const r = await apiFetch(`${API_BASE}/api/photo-scout/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 7 }) }); const d = await r.json().catch(() => ({}))
      setNote(d.ok ? `Looked at ${d.screened} new shots · ${d.picked?.length || 0} new picks${d.skipped_cap ? ' · hit the $3 daily cap' : ''}` : 'Still working in the background, check back in a few minutes.')
    } catch { setNote('Still working in the background, check back in a few minutes.') }
    setRunning(false); load()
  }
  const copy = t => { try { navigator.clipboard.writeText(t) } catch { /* fine */ } }

  return (
    <div className="px-3 sm:px-6 py-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h1 className="text-2xl font-extrabold" style={{ color: INK }}>📸 Photo Scout</h1>
        <button onClick={run} disabled={running} className="text-sm font-extrabold rounded-xl px-4 py-2 text-white disabled:opacity-60" style={{ backgroundColor: ORANGE }}>{running ? 'Scouting…' : '🔎 Scout now'}</button>
      </div>
      <p className="text-sm mb-3" style={{ color: '#666' }}>Every night the scout looks at the calibration setup shots in the job folders, keeps the ones worth posting, and checks them for plates, VINs, faces and shop logos. Plates, VINs and faces are blurred automatically. Picks and anything you approve are copied (GPS stripped) to WorkDrive → 00_Brand Assets → 04_Photos → 03_Calibrations → ✨ Social picks.</p>
      {note && <div className="rounded-xl px-3 py-2 mb-3 text-sm font-semibold" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>{note}</div>}
      <div className="flex gap-2 flex-wrap mb-4">
        {TABS.map(t => <button key={t.id} onClick={() => setTab(t.id)} className="text-sm font-bold rounded-full px-3 py-1.5" style={tab === t.id ? { backgroundColor: INK, color: '#fff' } : { backgroundColor: '#fff', color: INK, border: '1px solid #e0dbd6' }}>{t.label}</button>)}
      </div>
      {loading ? <div className="text-sm" style={{ color: '#888' }}>Loading…</div>
        : !rows.length ? <div className="rounded-2xl p-6 text-center text-sm" style={{ backgroundColor: '#fff', border: '1px dashed #ddd', color: '#888' }}>{tab === 'pick' ? 'No new picks yet. The scout runs every night, or press Scout now.' : 'Nothing here yet.'}</div>
        : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(r => (
            <div key={r.id} className="rounded-2xl shadow-sm flex flex-col" style={{ backgroundColor: '#fff', border: '1px solid #eee' }}>
              <div className="relative">
                <Thumb fileId={r.pick_file_id || r.file_id} />
                <span className="absolute top-2 left-2 text-sm font-extrabold rounded-full px-2.5 py-1" style={{ backgroundColor: r.score >= 9 ? '#166534' : r.score >= 7 ? ORANGE : '#6b7280', color: '#fff' }}>⭐ {r.score}/10</span>
                {!r.safe && <span className="absolute top-2 right-2 text-xs font-bold rounded-full px-2 py-1" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>⚠ needs blur</span>}
                {r.blurred && <span className="absolute top-2 right-2 text-xs font-bold rounded-full px-2 py-1" style={{ backgroundColor: '#eef2ff', color: '#3730a3' }} title="Plate / VIN / faces blurred on this copy">🫥 blurred</span>}
              </div>
              <div className="p-3 flex flex-col gap-1.5 flex-1">
                <div className="text-sm font-extrabold" style={{ color: INK }}>{r.angle || r.what || 'Calibration shot'}</div>
                <div className="text-xs" style={{ color: '#888' }}>{r.folder}</div>
                {r.caption && <div className="text-sm italic rounded-lg p-2" style={{ backgroundColor: '#faf7f4', color: '#333' }}>"{r.caption}" <button onClick={() => copy(r.caption)} className="not-italic text-xs font-bold ml-1" style={{ color: ORANGE }}>Copy</button></div>}
                {r.crop && r.crop !== 'none' && <div className="text-xs" style={{ color: '#555' }}>✂️ {r.crop}</div>}
                {!!(r.issues || []).length && <div className="text-xs font-semibold" style={{ color: '#991b1b' }}>⚠ {r.issues.join(' · ')}</div>}
                <div className="flex gap-2 mt-auto pt-2">
                  {tab !== 'approved' && tab !== 'used' && <button onClick={() => setState(r, 'approved')} className="flex-1 text-sm font-bold rounded-xl py-2 text-white" style={{ backgroundColor: '#166534' }}>👍 Approve</button>}
                  {tab === 'approved' && <button onClick={() => setState(r, 'used')} className="flex-1 text-sm font-bold rounded-xl py-2 text-white" style={{ backgroundColor: ORANGE }}>📣 Posted it</button>}
                  {tab !== 'rejected' && <button onClick={() => setState(r, 'rejected')} className="flex-1 text-sm font-bold rounded-xl py-2" style={{ backgroundColor: '#f3f4f6', color: '#444' }}>Pass</button>}
                  {tab === 'rejected' && <button onClick={() => setState(r, 'pick')} className="flex-1 text-sm font-bold rounded-xl py-2" style={{ backgroundColor: '#f3f4f6', color: '#444' }}>↩ Back to picks</button>}
                </div>
              </div>
            </div>
          ))}
        </div>}
    </div>
  )
}
