// Insurer families → which price list a job bills on (Mark 2026-09-16:
// Ohio Security is Liberty Mutual, and Liberty Mutual uses Allstate's
// calibration schedule). ONE table for the server (item pool) and the
// client (card pill). Defaults here; Mark/Kat edit the live copy on
// More → Item Mapping → Insurer families (AppConfig `insurer_families`).
// pools: STD (standard list) · SF · AS · AMFAM · CP
import catalyst from 'zcatalyst-sdk-node'

export const POOLS = { STD: 'Standard pricing', SF: 'State Farm pricing', AS: 'Allstate pricing', AMFAM: 'Am Fam pricing', GEICO: 'GEICO pricing', CP: 'Cash / customer pay' }
// Mark 2026-09-16: on State Farm, Allstate, Liberty Mutual and GEICO jobs
// (and their sister companies) the invoice carries Cal ID OFF, Snapshot
// OFF, PCSI included, Post-Scan included — regardless of the shop's rule.
export const INSURER_BIG3 = { cal_id: 'off', pcsi: 'included', post_scan: 'included', snapshot: 'off' }
export const DEFAULT_FAMILIES = [
  { id: 'state_farm', parent: 'State Farm', pool: 'SF', pill: 'STATE FARM PRICING', color: '#b91c1c', aliases: ['state farm'], big3: INSURER_BIG3 },
  { id: 'allstate', parent: 'Allstate', pool: 'AS', pill: 'ALLSTATE PRICING', color: '#1d4ed8', aliases: ['allstate', 'us general', 'u.s. general', 'integon', 'national general', 'esurance', 'encompass'], big3: INSURER_BIG3 },
  // Liberty Mutual family bills on Allstate's schedule (Mark 2026-09-16, confirmed for Ohio Security).
  { id: 'liberty', parent: 'Liberty Mutual', pool: 'AS', pill: 'LIBERTY MUTUAL · ALLSTATE PRICING', color: '#f59e0b', aliases: ['liberty mutual', 'ohio security', 'safeco', 'ohio casualty', 'peerless', 'west american', 'liberty mutual fire', 'lm general', 'lm insurance'], big3: INSURER_BIG3 },
  { id: 'geico', parent: 'GEICO', pool: 'GEICO', pill: 'GEICO PRICING', color: '#0369a1', aliases: ['geico', 'government employees insurance', 'geico general', 'geico indemnity', 'geico casualty', 'geico advantage', 'geico choice', 'geico secure'], big3: INSURER_BIG3 },
  { id: 'amfam', parent: 'American Family', pool: 'AMFAM', pill: 'AM FAM PRICING', color: '#0e7490', aliases: ['american family', 'amfam'] },
  { id: 'cash', parent: 'Customer pay', pool: 'CP', pill: 'CASH', color: '#15803d', aliases: ['cash', 'customer pay', 'self pay'] },
]
let _active = DEFAULT_FAMILIES, _loadedAt = 0
const clean = list => (Array.isArray(list) ? list : []).map((f, i) => ({
  id: String(f.id || `fam${i + 1}`).replace(/[^a-z0-9_]/gi, '').slice(0, 30) || `fam${i + 1}`,
  parent: String(f.parent || '').slice(0, 80), pool: POOLS[String(f.pool || '').toUpperCase()] ? String(f.pool).toUpperCase() : 'STD',
  pill: String(f.pill || '').slice(0, 60), color: /^#[0-9a-f]{6}$/i.test(f.color || '') ? f.color : '#555555',
  aliases: (Array.isArray(f.aliases) ? f.aliases : String(f.aliases || '').split(',')).map(a => String(a).trim().toLowerCase()).filter(Boolean).slice(0, 40),
  big3: f.big3 && typeof f.big3 === 'object' ? Object.fromEntries(Object.entries(f.big3).filter(([k, v]) => ['cal_id', 'pcsi', 'post_scan', 'snapshot'].includes(k) && ['charge', 'included', 'off'].includes(v))) : null,
})).filter(f => f.parent && f.aliases.length)

export function familiesNow() { return _active }
export function familyFor(insurer) {
  const ins = String(insurer || '').toLowerCase()
  if (!ins) return null
  for (const f of _active) for (const a of f.aliases) if (a && ins.includes(a)) return f
  return null
}
export function poolFor(insurer) { const f = familyFor(insurer); return f ? (f.pool === 'STD' ? null : f.pool) : null }
async function cfg(req) { const app = catalyst.initialize(req); return { zcql: app.zcql(), table: app.datastore().table('AppConfig') } }
export async function loadFamilies(req, force = false) {
  if (!force && Date.now() - _loadedAt < 5 * 60000) return _active
  try {
    const { zcql } = await cfg(req)
    const rows = await zcql.executeZCQLQuery("SELECT config_value FROM AppConfig WHERE config_key = 'insurer_families' LIMIT 1")
    const v = rows?.[0]?.AppConfig?.config_value || rows?.[0]?.config_value
    if (v) { const list = clean(JSON.parse(v)); if (list.length) _active = list }
  } catch (e) { console.warn('[insurers] load failed, using defaults:', e.message) }
  _loadedAt = Date.now()
  return _active
}
export async function saveFamilies(req, list) {
  const cleaned = clean(list)
  if (!cleaned.length) throw new Error('At least one family required')
  const { zcql, table } = await cfg(req)
  const rows = await zcql.executeZCQLQuery("SELECT ROWID FROM AppConfig WHERE config_key = 'insurer_families' LIMIT 1")
  const r = rows?.[0]?.AppConfig || rows?.[0]
  const value = JSON.stringify(cleaned)
  if (r?.ROWID) await table.updateRow({ ROWID: String(r.ROWID), config_key: 'insurer_families', config_value: value })
  else await table.insertRow({ config_key: 'insurer_families', config_value: value })
  _active = cleaned; _loadedAt = Date.now()
  return cleaned
}
/** Learn: "this insurer bills on pool X" — adds the alias to the matching family (or a Standard family). */
export async function learnInsurer(req, insurer, pool, by) {
  const alias = String(insurer || '').trim().toLowerCase().slice(0, 80)
  if (!alias) throw new Error('insurer required')
  const p = POOLS[String(pool || '').toUpperCase()] ? String(pool).toUpperCase() : 'STD'
  const list = (await loadFamilies(req, true)).map(f => ({ ...f, aliases: [...f.aliases] }))
  for (const f of list) f.aliases = f.aliases.filter(a => a !== alias)
  let fam = list.find(f => f.pool === p && (p !== 'STD' || f.id === 'standard'))
  if (!fam) { fam = { id: p === 'STD' ? 'standard' : `pool_${p.toLowerCase()}`, parent: p === 'STD' ? 'Standard pricing' : POOLS[p], pool: p, pill: p === 'STD' ? '' : POOLS[p].toUpperCase(), color: '#555555', aliases: [] }; list.push(fam) }
  fam.aliases.push(alias)
  console.log(`[insurers] learned "${alias}" → ${p} (by ${by || '?'})`)
  return saveFamilies(req, list)
}
