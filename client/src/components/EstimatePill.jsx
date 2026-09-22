// 📝 "E-1007 · approved $612" on a job card when an estimator estimate is
// tied to it (Phase F). One fetch per session, like the Big 3 map.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

let _map = null, _at = 0, _p = null
export function useEstimateJobMap() {
  const [map, setMap] = useState(_map || {})
  useEffect(() => {
    if (_map && Date.now() - _at < 5 * 60 * 1000) { setMap(_map); return }
    if (!_p) _p = apiFetch(`${API_BASE}/api/estimator/job-map`).then(r => r.json()).then(d => { _map = d.map || {}; _at = Date.now(); _p = null; return _map }).catch(() => { _p = null; return _map || {} })
    _p.then(m => setMap(m || {}))
  }, [])
  return map
}
export function invalidateEstimateJobMap() { _map = null; _at = 0 }
const fmt = c => `$${(Number(c || 0) / 100).toFixed(0)}`
const TONE = { draft: ['#f5f3f0', '#555'], sent: ['#fffbeb', '#b45309'], approved: ['#dcfce7', '#166534'], invoiced: ['#dbeafe', '#1e40af'], declined: ['#fef2f2', '#b91c1c'] }
export default function EstimatePill({ jobId, size = 'xs' }) {
  const map = useEstimateJobMap()
  const e = map[String(jobId)]
  if (!e) return null
  const [bg, fg] = TONE[e.status] || TONE.draft
  const cls = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
  return <span className={`${cls} font-bold rounded inline-block`} style={{ backgroundColor: bg, color: fg }} title={`Estimator ${e.number} · ${e.status}`}>📝 {e.number} · {e.status}{e.grand_total_cents ? ` ${fmt(e.grand_total_cents)}` : ''}</span>
}
