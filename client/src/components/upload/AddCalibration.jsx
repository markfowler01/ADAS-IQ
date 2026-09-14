// Add a calibration Kinetic missed (Mark 2026-09-14: "I need to be able
// to add calibrations that were missing on the Kinetic report"). Quick
// chips for the ten we do most, a search across every calibration rule
// (same lists the Ready-to-Invoice review uses), and a free-text fallback.
// The added line gets priced by the up-front pricer and lands with an
// empty justification box + 🪄 AI rewrite right on the row.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { ORANGE } from '../ui/ReviewKit.jsx'

export default function AddCalibration({ existingNames = [], onAdd, onCancel }) {
  const [topTen, setTopTen] = useState([])
  const [rules, setRules] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let dead = false
    Promise.all([
      apiFetch(`${API_BASE}/api/jobs/top-calibrations`).then(r => r.json()).catch(() => ({ calibrations: [] })),
      apiFetch(`${API_BASE}/api/calibration-rules`).then(r => r.json()).catch(() => []),
    ]).then(([top, all]) => {
      if (dead) return
      setTopTen(top?.calibrations || [])
      setRules(Array.isArray(all) ? all : [])
      setLoading(false)
    })
    return () => { dead = true }
  }, [])

  const have = new Set(existingNames.map(n => String(n || '').toLowerCase()))
  const quick = topTen.filter(t => !have.has(String(t.name || '').toLowerCase())).slice(0, 10)
  const needle = q.trim().toLowerCase()
  const hits = needle
    ? rules.filter(r => String(r.calibration_name || '').toLowerCase().includes(needle) && !have.has(String(r.calibration_name || '').toLowerCase())).slice(0, 12)
    : []
  const exact = needle && rules.some(r => String(r.calibration_name || '').toLowerCase() === needle)

  function add(name, extra = {}) {
    onAdd({ calibration_name: name, cal_type: extra.cal_type || null, trigger: null, line_references: null, justification: null, enabled: true, rule_id: extra.rule_id || null, _added: true })
    setQ('')
  }

  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: '#fff5f0', border: `1.5px solid ${ORANGE}` }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold" style={{ color: '#1a1a1a' }}>＋ Add a calibration Kinetic missed</span>
        <button type="button" onClick={onCancel} className="text-xs font-semibold" style={{ color: '#888' }}>close</button>
      </div>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search every calibration… (e.g. blind spot, radar, camera)"
        className="w-full rounded-lg px-3 py-2 text-sm mb-2" style={{ border: '1px solid #e0dbd6', backgroundColor: 'white', outline: 'none' }}
        onKeyDown={e => { if (e.key === 'Enter' && needle) { const h = hits[0]; h ? add(h.calibration_name, { cal_type: h.cal_type, rule_id: h.id }) : add(q.trim()) } }} />
      {needle ? (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #f5c9b8', backgroundColor: 'white' }}>
          {hits.map(r => (
            <button key={r.id || r.calibration_name} type="button" onClick={() => add(r.calibration_name, { cal_type: r.cal_type, rule_id: r.id })} className="w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2" style={{ borderTop: '1px solid #fdeee8' }}>
              <span style={{ color: '#1a1a1a' }}>{r.calibration_name}</span>
              {r.cal_type && <span className="text-[11px]" style={{ color: '#888', fontFamily: "'IBM Plex Mono', monospace" }}>{r.cal_type}</span>}
            </button>
          ))}
          {!exact && (
            <button type="button" onClick={() => add(q.trim())} className="w-full text-left px-3 py-2 text-sm font-semibold" style={{ borderTop: '1px solid #fdeee8', color: ORANGE }}>
              Add "{q.trim()}" as typed
            </button>
          )}
        </div>
      ) : (
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>{loading ? 'Loading…' : 'Most common'}</div>
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
