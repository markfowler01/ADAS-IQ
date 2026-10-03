// 🔀 Merge duplicate CRM shops (Mark 2026-10-02: "only me and Kat can merge, auto
// merge exact twins"). The kept shop gets everything it's missing from the others —
// phone, email, Books link, contacts, notes, DRPs, rules (its own rules always win) —
// plus the others' names as aliases, so a scrub or quote under an old name still
// lands on it. The others are deleted; each deleted row is saved whole in AppConfig
// "shop_merge_log" (last 200) so anything can be put back by hand.
import catalyst from 'zcatalyst-sdk-node'

const ACTIVE = ['active', 'active2', 'second_active']
const STAGE_RANK = { active: 9, active2: 9, second_active: 9, trial: 7, negotiating: 6, proposal: 6, meeting: 5, interested: 4, contacted: 3, target: 1, lost: 0, denied: 0 }
const blank = v => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)
export const isOwner = req => ['mark@absoluteadas.com', 'mf@absoluteadas.com', 'mfowler4456@gmail.com'].includes(String(req.user?.email || '').toLowerCase()) || req.user?.role === 'owner'

/** Which shop to keep when nobody picked: customer > Books link > rules > most history > oldest. */
export function pickKeeper(shops) {
  const score = s => (ACTIVE.includes(s.pipeline_stage || s.stage) ? 1e6 : 0) + ((s.zoho_contact_id || s.books) ? 1e5 : 0) + ((s.billing_rules && Object.keys(s.billing_rules || {}).length) || s.has_rules ? 1e4 : 0) + (Array.isArray(s.activities) ? s.activities.length : 0)
  return [...shops].sort((a, b) => score(b) - score(a) || Number(a.id) - Number(b.id))[0]
}

export async function mergeShops(req, keepId, mergeIds, by = '') {
  const { getAllShops, updateShop, deleteShop } = await import('../routes/shops.js')
  const all = await getAllShops(req)
  const keep = all.find(s => String(s.id) === String(keepId))
  const others = all.filter(s => mergeIds.map(String).includes(String(s.id)) && String(s.id) !== String(keepId))
  if (!keep) throw new Error('The shop to keep was not found.')
  if (!others.length) throw new Error('Nothing to merge into it.')
  const out = { ...keep }
  const br = { ...(keep.billing_rules || {}) }
  const aliases = new Set(Array.isArray(br.aliases) ? br.aliases : [])
  for (const o of others) {
    for (const f of ['contact_name', 'phone', 'email', 'address', 'region', 'assigned_to', 'zoho_contact_id', 'estimated_monthly', 'volume_potential', 'referral_source', 'shop_rate', 'insurance_rate', 'next_followup', 'last_contact', 'shop_id'])
      if (blank(out[f]) && !blank(o[f])) out[f] = o[f]
    if ((STAGE_RANK[o.pipeline_stage] || 0) > (STAGE_RANK[out.pipeline_stage] || 0)) out.pipeline_stage = o.pipeline_stage
    const key = p => String(p?.email || p?.phone || p?.name || '').toLowerCase().trim()
    const people = [...(out.people || [])]
    for (const p of o.people || []) if (!people.some(x => key(x) && key(x) === key(p))) people.push(p)
    out.people = people
    out.activities = [...(out.activities || []), ...(o.activities || []), { type: 'note', at: new Date().toISOString(), by: by || 'app', text: `🔀 Merged "${o.shop_name}" into this shop${o.phone ? ` (${o.phone})` : ''}` }]
    out.drps = [...new Set([...(out.drps || []), ...(o.drps || [])])]
    if (o.notes && !String(out.notes || '').includes(o.notes)) out.notes = [out.notes, `— from ${o.shop_name}: ${o.notes}`].filter(Boolean).join('\n')
    const obr = o.billing_rules || {}
    for (const [k, v] of Object.entries(obr)) if (k !== 'aliases' && blank(br[k]) && !blank(v)) br[k] = v   // kept shop's own rules always win
    for (const a of Array.isArray(obr.aliases) ? obr.aliases : []) aliases.add(a)
    if (String(o.shop_name).trim().toLowerCase() !== String(keep.shop_name).trim().toLowerCase()) aliases.add(o.shop_name)
  }
  br.aliases = [...aliases]
  out.billing_rules = br
  const saved = await updateShop(req, keep.id, out)
  // Keep every deleted row, whole, before it goes.
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const r0 = await app.zcql().executeZCQLQuery("SELECT ROWID, config_value FROM AppConfig WHERE config_key = 'shop_merge_log' LIMIT 1")
    const row = r0?.[0]?.AppConfig
    const prev = (() => { try { return JSON.parse(row?.config_value || '[]') } catch { return [] } })()
    const list = [{ at: new Date().toISOString(), by, kept: { id: keep.id, name: keep.shop_name }, deleted: others }, ...prev].slice(0, 200)
    if (row) await app.datastore().table('AppConfig').updateRow({ ROWID: row.ROWID, config_value: JSON.stringify(list) })
    else await app.datastore().table('AppConfig').insertRow({ config_key: 'shop_merge_log', config_value: JSON.stringify(list) })
  } catch (e) { throw new Error(`Could not save the merge log, nothing deleted: ${e.message}`) }
  for (const o of others) await deleteShop(req, o.id)
  try {
    const { postToCliqChannel, DISPATCH_CHANNEL } = await import('./cliq.js')
    await postToCliqChannel(DISPATCH_CHANNEL, `🔀 *CRM merge* · kept *${keep.shop_name}* · merged ${others.map(o => `"${o.shop_name}"`).join(', ')} (by ${by || 'app'})`)
  } catch { /* fine */ }
  return { kept: { id: saved.id, name: saved.shop_name }, merged: others.map(o => ({ id: o.id, name: o.shop_name })), aliases: br.aliases }
}

/** Exact twins = same name (ignoring "auto / body / collision …") AND same phone. */
export async function exactTwinGroups(req) {
  const { getAllShops } = await import('../routes/shops.js')
  const shops = await getAllShops(req)
  const loose = n => String(n || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(the|auto|automotive|body|bodyshop|shop|collision|repair|repairs|center|centre|rebuild|rebuilders|inc|llc|co|company|and|of)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const digits = p => String(p || '').replace(/\D/g, '').slice(-10)
  const m = new Map()
  for (const s of shops) { const ph = digits(s.phone), nm = loose(s.shop_name); if (ph.length !== 10 || nm.length < 3) continue; const k = `${nm}|${ph}`; m.set(k, [...(m.get(k) || []), s]) }
  return [...m.values()].filter(g => g.length > 1)
}

export async function mergeExactTwins(req, by = '', { dry = false } = {}) {
  const groups = await exactTwinGroups(req)
  const results = []
  for (const g of groups) {
    const keep = pickKeeper(g)
    if (dry) { results.push({ keep: keep.shop_name, merge: g.filter(s => s.id !== keep.id).map(s => s.shop_name) }); continue }
    try { results.push(await mergeShops(req, keep.id, g.map(s => s.id), by || 'auto-merge (exact twins)')) } catch (e) { results.push({ error: e.message, keep: keep.shop_name }) }
  }
  return { groups: groups.length, results }
}
