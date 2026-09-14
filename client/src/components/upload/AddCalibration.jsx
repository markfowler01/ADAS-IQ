// Add a calibration Kinetic missed (Mark 2026-09-14: "I need to be able
// to add calibrations that were missing on the Kinetic report"). Quick
// chips for the ten we do most, a search across every calibration rule
// (same lists the Ready-to-Invoice review uses), and a free-text fallback.
// The added line gets priced by the up-front pricer and lands with an
// empty justification box + 🪄 AI rewrite right on the row.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { ORANGE } from '../ui/ReviewKit.jsx'

export default function AddCalibration({ existingNames = [], onAdd, onCancel, vehicle = {} }) {
  const [writing, setWriting] = useState('')   // name being written up by the AI
  // Mark 2026-09-14: "from the Zoho Books menu" — the search is the Books
  // item catalog (same list Bill it uses), so what you add is a real item
  // with a real price. Chips = the ten we do most.
  const [topTen, setTopTen] = useState([])
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let dead = false
    Promise.all([
      apiFetch(`${API_BASE}/api/jobs/top-calibrations`).then(r => r.json()).catch(() => ({ calibrations: [] })),
      apiFetch(`${API_BASE}/api/jobs/catalog`).then(r => r.json()).catch(() => ({ items: [] })),
    ]).then(([top, cat]) => {
      if (dead) return
      setTopTen(top?.calibrations || [])
      setItems(Array.isArray(cat?.items) ? cat.items : [])
      setLoading(false)
    })
    return () => { dead = true }
  }, [])

  // Only calibration-type Books items (Mark: "none of the key stuff, just the top calibrations").
  const KEY_STUFF = /\bkeys?\b|fob|transponder|remote|blade|prox|smart key|key ?less|immobil/i
  const CAL_WORDS = /calibrat|scan|radar|camera|sensor|blind|adas|lidar|aim|static|dynamic|inspection|snapshot|steering|seat weight|park|occupant|\bsas\b|\bsws\b|headlamp|night vision|mirror|windshield|ride|set-?up|program|module|360|surround|lane|cruise|collision|report|alignment/i
  const isCalItem = it => !KEY_STUFF.test(it.name || '') && CAL_WORDS.test(it.name || '')
  const have = new Set(existingNames.map(n => String(n || '').toLowerCase()))
  const quick = topTen.filter(t => !have.has(String(t.name || '').toLowerCase())).slice(0, 10)
  const needle = q.trim().toLowerCase()
  const hits = needle
    ? items.filter(it => isCalItem(it) && String(it.name || '').toLowerCase().includes(needle) && !have.has(String(it.name || '').toLowerCase())).slice(0, 12)
    : []
  const exact = needle && items.some(it => String(it.name || '').toLowerCase() === needle)

  // Mark 2026-09-14: "with the same why-this-calibration-needs-to-be-performed
  // with the AI rewrite" — the justification is written automatically on add,
  // same writer the rows use, so it lands looking like the extracted ones.
  async function add(name, extra = {}) {
    setQ(''); setWriting(name)
    let justification = null
    try {
      const r = await apiFetch(`${API_BASE}/api/extract/rewrite-justification`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calibration_name: name, year: vehicle?.year, make: vehicle?.make, model: vehicle?.model, trigger: 'Added by the estimator — missed on the Kinetic report', line_references: '' }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d.justification) justification = d.justification
    } catch { /* the row still has 🪄 AI rewrite */ }
    setWriting('')
    onAdd({ calibration_name: name, cal_type: extra.cal_type || null, trigger: null, line_references: null, justification, enabled: true, item_id: extra.item_id || null, _added: true })
  }

  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: '#fff5f0', border: `1.5px solid ${ORANGE}` }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold" style={{ color: '#1a1a1a' }}>＋ Add a calibration Kinetic missed</span>
        <button type="button" onClick={onCancel} className="text-xs font-semibold" style={{ color: '#888' }}>close</button>
      </div>
      {writing && <div className="text-xs font-semibold mb-2" style={{ color: '#7c3aed' }}>🪄 Writing why {writing} is required…</div>}
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} disabled={!!writing} placeholder="Search calibrations in Zoho Books… (e.g. blind spot, radar, camera)"
        className="w-full rounded-lg px-3 py-2 text-sm mb-2" style={{ border: '1px solid #e0dbd6', backgroundColor: 'white', outline: 'none' }}
        onKeyDown={e => { if (e.key === 'Enter' && needle) { const h = hits[0]; h ? add(h.name, { item_id: h.item_id }) : add(q.trim()) } }} />
      {needle ? (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #f5c9b8', backgroundColor: 'white' }}>
          {hits.map(it => (
            <button key={it.item_id} type="button" onClick={() => add(it.name, { item_id: it.item_id })} className="w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2" style={{ borderTop: '1px solid #fdeee8' }}>
              <span style={{ color: '#1a1a1a' }}>{it.name}{it.type === 'goods' ? <span className="text-[11px]" style={{ color: '#888' }}> · part</span> : null}</span>
              <span className="text-xs font-bold tabular-nums" style={{ color: '#15803d' }}>${Number(it.rate || 0).toFixed(0)}</span>
            </button>
          ))}
          {hits.length === 0 && <div className="px-3 py-2 text-xs" style={{ color: '#888' }}>No calibration item in Zoho Books matches "{q.trim()}".</div>}
          {!exact && (
            <button type="button" onClick={() => add(q.trim())} className="w-full text-left px-3 py-2 text-sm font-semibold" style={{ borderTop: '1px solid #fdeee8', color: ORANGE }}>
              Add "{q.trim()}" as typed
            </button>
          )}
        </div>
      ) : (
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>{loading ? 'Loading Zoho Books items…' : 'Most common · or search the Books menu above'}</div>
          <div className="flex flex-wrap gap-1.5">
            {quick.map(t => (
              <button key={t.name} type="button" onClick={() => add(t.name)} className="text-xs font-semibold rounded-full px-2.5 py-1" style={{ backgroundColor: 'white', color: '#1a1a1a', border: '1px solid #f5c9b8' }}>{t.name}</button>
            ))}
            {!loading && quick.length === 0 && <span className="text-xs" style={{ color: '#888' }}>Type to search.</span>}
          </div>
        </div>
      )}
      <div className="text-[11px] mt-2" style={{ color: '#888' }}>It lands switched on with a price. Write the justification on the row, or tap 🪄 AI rewrite.</div>
    </div>
  )
}
