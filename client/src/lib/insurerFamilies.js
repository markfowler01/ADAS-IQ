// Client copy of the insurer-family table. Starts with the built-in
// defaults (so cards render before the fetch) and refreshes from the
// server once per load; mirrors services/insurerFamilies.js.
import { API_BASE, apiFetch } from '../utils/api.js'
export const DEFAULT_FAMILIES = [
  { id: 'state_farm', parent: 'State Farm', pool: 'SF', pill: 'STATE FARM PRICING', color: '#b91c1c', aliases: ['state farm'] },
  { id: 'allstate', parent: 'Allstate', pool: 'AS', pill: 'ALLSTATE PRICING', color: '#1d4ed8', aliases: ['allstate', 'us general', 'u.s. general', 'integon', 'national general'] },
  { id: 'liberty', parent: 'Liberty Mutual', pool: 'AS', pill: 'LIBERTY MUTUAL · ALLSTATE PRICING', color: '#f59e0b', aliases: ['liberty mutual', 'ohio security', 'safeco', 'ohio casualty', 'peerless', 'west american', 'liberty mutual fire', 'lm general', 'lm insurance'] },
  { id: 'amfam', parent: 'American Family', pool: 'AMFAM', pill: 'AM FAM PRICING', color: '#0e7490', aliases: ['american family', 'amfam'] },
]
let _families = DEFAULT_FAMILIES, _loading = null
export function loadInsurerFamilies(force = false) {
  if (_loading && !force) return _loading
  _loading = apiFetch(`${API_BASE}/api/insurers/families`).then(r => r.json()).then(d => { if (d?.ok && Array.isArray(d.families) && d.families.length) _families = d.families; return _families }).catch(() => _families)
  return _loading
}
export function familyFor(insurer) {
  const ins = String(insurer || '').toLowerCase()
  if (!ins) return null
  if (!_loading) loadInsurerFamilies()
  for (const f of _families) for (const a of f.aliases || []) if (a && ins.includes(String(a).toLowerCase())) return f
  return null
}
export function familiesNow() { return _families }
