// Sales pipeline territories + cadence (Mark 2026-09-15, "build out the CRM
// pipelines"). Six I-5 zones with an owner and a route day, stage quiet
// times, an in-play cap per owner, Monday lists per owner, a fit score.
// Zones live in the existing `region` column; owner in `assigned_to`.
import catalyst from 'zcatalyst-sdk-node'

export const ZONES = [
  { id: 'north',       label: 'North',        owner: 'Jayden', day: 'Mon',       cities: ['bellingham', 'ferndale', 'lynden', 'blaine', 'nooksack', 'everson', 'mount vernon', 'mt vernon', 'mt. vernon', 'burlington', 'anacortes', 'sedro-woolley', 'sedro woolley', 'oak harbor', 'coupeville', 'langley', 'freeland', 'friday harbor', 'stanwood', 'arlington', 'camano'] },
  { id: 'snohomish',   label: 'Snohomish',    owner: 'Jayden', day: 'Tue · Thu', cities: ['everett', 'marysville', 'lake stevens', 'snohomish', 'monroe', 'granite falls', 'sultan', 'gold bar'] },
  // Mark 2026-10-14: Lynnwood / Edmonds / Mukilteo are Snohomish County but nowhere near Snohomish the city.
  { id: 'southcounty', label: 'South County', owner: 'Jayden', day: 'TBD',       cities: ['lynnwood', 'edmonds', 'mukilteo', 'mountlake terrace', 'brier', 'mill creek'] },
  { id: 'eastside',    label: 'Eastside',     owner: 'Mark',   day: 'Wed',       cities: ['kirkland', 'redmond', 'bellevue', 'bothell', 'woodinville', 'issaquah', 'sammamish', 'kenmore', 'mercer island', 'newcastle', 'duvall', 'carnation', 'snoqualmie', 'north bend'] },
  { id: 'seattle',     label: 'Seattle',      owner: 'Mark',   day: 'Thu',       cities: ['seattle', 'shoreline', 'renton', 'kent', 'tukwila', 'burien', 'seatac', 'des moines', 'lake forest park', 'covington', 'maple valley'] },
  { id: 'south',       label: 'South Sound',  owner: 'Mark',   day: 'Fri (alt)', cities: ['auburn', 'federal way', 'tacoma', 'puyallup', 'sumner', 'fife', 'lakewood', 'university place', 'bonney lake', 'gig harbor', 'milton', 'edgewood', 'spanaway', 'graham', 'buckley', 'pacific', 'algona', 'enumclaw', 'orting', 'steilacoom'] },
  { id: 'olympia',     label: 'Olympia',      owner: 'Mark',   day: 'Fri (alt)', cities: ['lacey', 'olympia', 'tumwater', 'centralia', 'chehalis', 'yelm', 'dupont', 'shelton', 'rochester', 'tenino'] },
  // 🌾 Eastern Washington growth areas (Mark 2026-10-14: "I do wanna grow in this area… the cities
  // are spread out"). One area per hub; owner Mark until someone runs east.
  { id: 'tricities',   label: 'Tri-Cities',   owner: 'Mark',   day: 'East trip', east: true, cities: ['kennewick', 'pasco', 'richland', 'west richland', 'benton city', 'burbank', 'prosser', 'walla walla', 'college place'] },
  { id: 'spokane',     label: 'Spokane',      owner: 'Mark',   day: 'East trip', east: true, cities: ['spokane', 'spokane valley', 'liberty lake', 'cheney', 'airway heights', 'deer park', 'mead', 'pullman', 'colfax', 'wilbur', 'davenport'] },
  { id: 'yakima',      label: 'Yakima',       owner: 'Mark',   day: 'East trip', east: true, cities: ['yakima', 'union gap', 'selah', 'sunnyside', 'grandview', 'wapato', 'toppenish', 'zillah', 'granger', 'moxee'] },
  { id: 'wenatchee',   label: 'Wenatchee',    owner: 'Mark',   day: 'East trip', east: true, cities: ['wenatchee', 'east wenatchee', 'leavenworth', 'cashmere', 'chelan', 'moses lake', 'quincy', 'ephrata', 'othello', 'omak', 'okanogan', 'brewster'] },
  { id: 'cleelum',     label: 'Cle Elum / Ellensburg', owner: 'Mark', day: 'East trip', east: true, cities: ['cle elum', 'roslyn', 'ellensburg', 'kittitas', 'easton'] },
  // Mark 2026-10-14: Kitsap gets its own zone.
  { id: 'kitsap',      label: 'Kitsap',       owner: 'Mark',   day: 'TBD',       cities: ['bremerton', 'poulsbo', 'silverdale', 'port orchard', 'bainbridge island', 'belfair', 'kingston', 'port gamble', 'hansville', 'gorst'] },
  // 🗺 New markets (Mark 2026-10-27: "expanding into areas like Boise, Phoenix, San Francisco … separate CRMs").
  // Phase 1 = prospect lists inside this CRM, one market at a time; the Box (own app copy) comes when a
  // market gets a van. No owner yet → these shops stay out of Monday lists and in-play counts.
  { id: 'boise',       market: 'boise',   label: 'Boise',            owner: '', day: 'TBD', cities: ['boise', 'garden city'] },
  { id: 'meridian',    market: 'boise',   label: 'Meridian / Eagle', owner: '', day: 'TBD', cities: ['meridian', 'eagle', 'star', 'kuna'] },
  { id: 'nampa',       market: 'boise',   label: 'Nampa / Caldwell', owner: '', day: 'TBD', cities: ['nampa', 'caldwell', 'middleton', 'emmett', 'mountain home'] },
  { id: 'phx',         market: 'phoenix', label: 'Phoenix',          owner: '', day: 'TBD', cities: ['phoenix', 'paradise valley', 'cave creek', 'anthem'] },
  { id: 'phxeast',     market: 'phoenix', label: 'East Valley',      owner: '', day: 'TBD', cities: ['mesa', 'chandler', 'gilbert', 'tempe', 'scottsdale', 'queen creek', 'apache junction', 'fountain hills', 'san tan valley'] },
  { id: 'phxwest',     market: 'phoenix', label: 'West Valley',      owner: '', day: 'TBD', cities: ['glendale', 'peoria', 'surprise', 'goodyear', 'avondale', 'buckeye', 'el mirage', 'sun city', 'tolleson', 'litchfield park'] },
  { id: 'sf',          market: 'bay',     label: 'San Francisco',    owner: '', day: 'TBD', cities: ['san francisco', 'daly city', 'south san francisco', 'brisbane', 'colma'] },
  { id: 'peninsula',   market: 'bay',     label: 'Peninsula',        owner: '', day: 'TBD', cities: ['san mateo', 'burlingame', 'redwood city', 'menlo park', 'palo alto', 'san carlos', 'belmont', 'millbrae', 'san bruno', 'foster city'] },
  { id: 'eastbay',     market: 'bay',     label: 'East Bay',         owner: '', day: 'TBD', cities: ['oakland', 'berkeley', 'alameda', 'san leandro', 'hayward', 'fremont', 'union city', 'richmond', 'emeryville', 'walnut creek', 'concord', 'pleasanton', 'dublin', 'livermore', 'san ramon'] },
  { id: 'southbay',    market: 'bay',     label: 'South Bay',        owner: '', day: 'TBD', cities: ['san jose', 'santa clara', 'sunnyvale', 'mountain view', 'milpitas', 'cupertino', 'campbell', 'los gatos'] },
]
export const MARKETS = [
  { id: 'wa',      label: 'Washington',  state: 'WA', home: true },
  { id: 'boise',   label: 'Boise',       state: 'ID' },
  { id: 'phoenix', label: 'Phoenix',     state: 'AZ' },
  { id: 'bay',     label: 'Bay Area',    state: 'CA' },
]
export const MARKET_BY_ID = Object.fromEntries(MARKETS.map(m => [m.id, m]))
export const zoneMarket = z => z?.market || 'wa'
const STATE_RE = /^(WA|Washington|OR|Oregon|ID|Idaho|AZ|Arizona|CA|California)\b/i
const STATE_CODE = { washington: 'WA', oregon: 'OR', idaho: 'ID', arizona: 'AZ', california: 'CA' }
/** Two-letter state named in an address ("…, Boise, ID 83704, USA" → 'ID'), or ''. */
export function stateOf(address) {
  const p = String(address || '').split(',').map(x => x.trim()).find(x => STATE_RE.test(x)); if (!p) return ''
  const w = p.match(STATE_RE)[1]; return w.length === 2 ? w.toUpperCase() : STATE_CODE[w.toLowerCase()]
}
// region = 'out' → out of the I-5 territory (Mark 2026-10-14): kept in the CRM, never in zone counts,
// owner lists or Monday lists. These cities set it automatically.
export const OUT_OF_AREA = 'out'
export const OUT_CITIES = ['vancouver', 'battle ground', 'camas', 'washougal', 'ridgefield', 'longview', 'kelso', 'castle rock', 'aberdeen', 'hoquiam', 'montesano', 'port angeles', 'sequim', 'port townsend', 'forks']
export const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.id, z]))
export const OWNERS = ['Mark', 'Jayden']
export const IN_PLAY_CAP = 10

// Stage ids stay what the app already uses (other features key on them);
// labels and cadence are the new part. quiet = max days without a touch.
export const STAGE_META = {
  target:     { label: 'Not contacted',                   quiet: 30,   inplay: false, exit: 'Nobody has talked to them yet' },
  contacted:  { label: 'Contacted',                       quiet: 14,   inplay: true,  exit: 'We reached them; find the decision maker' },
  interested: { label: 'Shown interest',                  quiet: 10,   inplay: true,  exit: 'They asked questions or want to see more' },
  proposal:   { label: 'High value offer · free demo',    quiet: 5,    inplay: true,  exit: 'Offer or free calibration demo on the table' },
  active:     { label: 'Current customer',                quiet: 30,   inplay: false, exit: 'They send us cars' },
  active2:    { label: 'Own ADAS guy · we are backup',    quiet: 45,   inplay: false, exit: 'We are the backup; tag who they use' },
  denied:     { label: 'Own ADAS guy · not interested',   quiet: 90,   inplay: false, exit: 'Tag who they use; check back in 90 days' },
  lost:       { label: 'Lost',                            quiet: null, inplay: false, exit: 'Reason recorded' },
  trial:      { label: 'High value offer · free demo',    quiet: 5,    inplay: true,  exit: 'legacy id' },
  dormant:    { label: 'Dormant',                         quiet: 90,   inplay: false, exit: 'legacy id' },
}
export const IN_PLAY_STAGES = Object.keys(STAGE_META).filter(k => STAGE_META[k].inplay)

const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000)
const esc = s => String(s || '').replace(/'/g, "''")

/** Zone from an address: longest matching city name wins. */
// The city part of "street, City, WA 98xxx, USA" — street names like "Pacific Hwy S" in Kent must not
// match the town of Pacific (2026-10-14). Falls back to the whole string when there's no ", WA".
export function cityPart(address) {
  const parts = String(address || '').split(',').map(x => x.trim())
  const i = parts.findIndex(p => STATE_RE.test(p))
  return i > 0 ? parts[i - 1] : String(address || '')
}
// Only zones in the address's state: "Glendale, AZ" is West Valley, a WA shop named "Eagle Auto Body"
// is not Meridian. No state (or a bare shop name) → Washington zones only, as before.
export function zoneForAddress(address) {
  const a = ` ${cityPart(address).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `
  const st = stateOf(address) || 'WA'
  let best = null
  for (const z of ZONES.filter(z => MARKET_BY_ID[zoneMarket(z)]?.state === st)) for (const c of z.cities) if (a.includes(` ${c.replace(/[^a-z0-9 ]+/g, ' ')} `) && (!best || c.length > best.len)) best = { id: z.id, len: c.length }
  return best?.id || ''
}
export function zoneOf(shop) { if (shop.region === OUT_OF_AREA) return ''; return ZONE_BY_ID[shop.region] ? shop.region : (zoneForAddress(shop.address) || zoneForAddress(shop.shop_name)) }
/** What the address says: a zone id, 'out' for a known far city, or '' (unknown). Non-WA states are out. */
export function regionForAddress(address) {
  const raw = String(address || ''); if (!raw.trim()) return ''
  // North Bothell / Mill Creek (98012, 98021) is Snohomish County → South County, not Eastside.
  if (/\bbothell\b/i.test(raw) && /\b980(12|21)\b/.test(raw)) return 'southcounty'
  const z = zoneForAddress(raw); if (z) return z
  const a = ` ${cityPart(raw).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `
  if (OUT_CITIES.some(c => a.includes(` ${c} `))) return OUT_OF_AREA
  if (/,\s*(OR|ID|CA|AZ|Oregon|Idaho|California|Arizona)\b/.test(raw)) return OUT_OF_AREA
  return ''
}
/** Which market a shop belongs to: its zone's market; anything else (out of area, unzoned) is Washington. */
export function marketOf(shop) { return zoneMarket(ZONE_BY_ID[zoneOf(shop)]) }
export function ownerOf(shop) { if (OWNERS.includes(shop.assigned_to)) return shop.assigned_to; const z = ZONE_BY_ID[zoneOf(shop)]; return z ? z.owner : '' }

/** Most recent touch: activity, last_contact, stage change, creation. */
export function lastTouch(shop) {
  const dates = []
  if (shop.last_invoice_date) dates.push(String(shop.last_invoice_date).slice(0, 10))
  for (const a of Array.isArray(shop.activities) ? shop.activities : []) { const d = String(a?.date || a?.at || '').slice(0, 10); if (d) dates.push(d) }
  for (const d of [shop.last_contact, shop.stage_changed_at, shop.created_at]) { const s = String(d || '').slice(0, 10); if (s) dates.push(s) }
  return dates.sort().pop() || ''
}
/** Days past the stage's quiet time (positive = stale), or null when the stage has no clock. */
export function staleDays(shop, today = todayPT()) {
  const meta = STAGE_META[shop.pipeline_stage] || STAGE_META.target
  if (meta.quiet == null) return null
  const t = lastTouch(shop); if (!t) return null
  return daysBetween(t, today) - meta.quiet
}
/** 0–10 fit suggestion from what the CRM already knows. */
export function fitSuggest(shop) {
  let s = 3
  const drps = Array.isArray(shop.drps) ? shop.drps.length : 0
  s += drps >= 3 ? 3 : drps === 2 ? 2 : drps === 1 ? 1 : 0
  const cars = parseInt(String(shop.estimated_monthly || shop.volume_potential || '').replace(/[^0-9]/g, ''), 10) || 0
  s += cars >= 30 ? 2 : cars >= 10 ? 1 : 0
  if (shop.kinetic_in_bed) s += 1
  const people = Array.isArray(shop.people) ? shop.people : []
  if (people.some(p => /owner|manager|gm/i.test(String(p?.title || '')))) s += 1
  if (zoneOf(shop)) s += 0; else s -= 1
  if (String(shop.lost_to || '').trim() || (Array.isArray(shop.custom_competitors) && shop.custom_competitors.length)) s -= 1
  return Math.max(0, Math.min(10, s))
}
export function inPlayCount(shops, owner) { return shops.filter(s => ownerOf(s) === owner && IN_PLAY_STAGES.includes(s.pipeline_stage)).length }

/** Everything an owner should do this week. */
/** Attach the last Books invoice date to each shop (Active shops are 'touched' by invoicing). */
export async function withInvoiceDates(shops) {
  try {
    const m = await import('../routes/salesStops.js'); if (typeof m.lastInvoiceByShop !== 'function') return shops
    const inv = await m.lastInvoiceByShop(); const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const byName = {}; for (const v of Object.values(inv)) if (v?.name) byName[norm(v.name)] = v.date || v.last_date || v.last_invoice_date || ''
    return shops.map(s => ({ ...s, last_invoice_date: byName[norm(s.shop_name)] || '' }))
  } catch (e) { console.log('[pipeline] invoice dates skipped:', e.message); return shops }
}
export function mondayList(shops, owner, today = todayPT()) {
  const mine = shops.filter(s => ownerOf(s) === owner && s.pipeline_stage !== 'lost')
  const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7); const we = weekEnd.toISOString().slice(0, 10)
  const item = s => ({ id: s.id, shop: s.shop_name, stage: s.pipeline_stage, stage_label: STAGE_META[s.pipeline_stage]?.label || s.pipeline_stage, zone: zoneOf(s), zone_label: ZONE_BY_ID[zoneOf(s)]?.label || 'no zone', next_followup: s.next_followup || '', next_action: s.next_action || '', last_touch: lastTouch(s), stale: staleDays(s, today), fit: Number(s.fit_score) || fitSuggest(s), phone: s.phone || '' })
  const overdue = mine.filter(s => s.next_followup && s.next_followup < today).map(item)
  const due = mine.filter(s => s.next_followup && s.next_followup >= today && s.next_followup <= we).map(item)
  const stale = mine.filter(s => !overdue.some(o => o.id === s.id) && (staleDays(s, today) || 0) > 0 && !['target', 'denied'].includes(s.pipeline_stage)).map(item).sort((a, b) => b.stale - a.stale)
  const checkBack = mine.filter(s => s.pipeline_stage === 'denied' && (staleDays(s, today) || 0) > 0).map(s => ({ ...item(s), uses: s.lost_to || s.denied_to || '' }))
  const inPlay = mine.filter(s => IN_PLAY_STAGES.includes(s.pipeline_stage)).map(item)
  const targets = mine.filter(s => s.pipeline_stage === 'target').map(item).sort((a, b) => b.fit - a.fit).slice(0, 5)
  const dormant = mine.filter(s => s.pipeline_stage === 'dormant' && (staleDays(s, today) || 0) > 0).map(item)
  const zones = ZONES.filter(z => z.owner === owner).map(z => ({ id: z.id, label: z.label, day: z.day, count: mine.filter(s => zoneOf(s) === z.id).length }))
  return { owner, today, overdue, due_this_week: due, stale, in_play: inPlay, in_play_cap: IN_PLAY_CAP, targets_to_qualify: targets, dormant_due: dormant, check_back: checkBack, zones }
}
export function formatMonday(l) {
  const line = i => `• ${i.shop} (${i.stage_label}${i.zone_label ? ` · ${i.zone_label}` : ''})${i.next_action ? ` — ${i.next_action}` : ''}${i.stale > 0 ? ` · ${i.stale}d past the clock` : ''}`
  const parts = [`📋 *Monday pipeline · ${l.owner}* · in play ${l.in_play.length}/${l.in_play_cap}${l.in_play.length > l.in_play_cap ? ' ⚠ over the cap' : ''}`]
  if (l.overdue.length) parts.push(`*Overdue follow-ups (${l.overdue.length})*\n${l.overdue.slice(0, 8).map(line).join('\n')}`)
  if (l.stale.length) parts.push(`*Gone quiet (${l.stale.length})*\n${l.stale.slice(0, 8).map(line).join('\n')}`)
  if (l.due_this_week.length) parts.push(`*Due this week (${l.due_this_week.length})*\n${l.due_this_week.slice(0, 8).map(i => `• ${i.next_followup} ${i.shop}${i.next_action ? ` — ${i.next_action}` : ''}`).join('\n')}`)
  if (l.targets_to_qualify.length) parts.push(`*Best targets to qualify*\n${l.targets_to_qualify.map(i => `• ${i.shop} (fit ${i.fit}/10 · ${i.zone_label})`).join('\n')}`)
  if (l.dormant_due.length) parts.push(`*Dormant, time for a call (${l.dormant_due.length})*\n${l.dormant_due.slice(0, 5).map(i => `• ${i.shop}`).join('\n')}`)
  if (l.check_back?.length) parts.push(`*Own ADAS guy — 90-day check back (${l.check_back.length})*\n${l.check_back.slice(0, 6).map(i => `• ${i.shop}${i.uses ? ` (uses ${i.uses})` : ''} · ${i.zone_label}`).join('\n')}`)
  parts.push(`Route days: ${l.zones.map(z => `${z.label} ${z.day} (${z.count})`).join(' · ')}\nGET SOME!!!`)
  return parts.join('\n\n')
}

/** Bulk territory setup: what would change (no writes). */
export function setupPreview(shops) {
  const rows = shops.map(s => {
    const zone = zoneOf(s); const owner = OWNERS.includes(s.assigned_to) ? s.assigned_to : (ZONE_BY_ID[zone]?.owner || '')
    return { id: s.id, shop: s.shop_name, address: s.address || '', current_zone: ZONE_BY_ID[s.region] ? s.region : '', zone, current_owner: s.assigned_to || '', owner, stage: s.pipeline_stage, change: (zone && zone !== s.region) || (owner && owner !== s.assigned_to) }
  })
  const counts = {}; for (const r of rows) counts[r.zone || 'unzoned'] = (counts[r.zone || 'unzoned'] || 0) + 1
  return { rows, counts, changes: rows.filter(r => r.change).length, unzoned: rows.filter(r => !r.zone).map(r => ({ id: r.id, shop: r.shop, address: r.address })) }
}
export async function applySetup(req, shops, overrides = {}) {
  const table = catalyst.initialize(req, { type: 'advancedio' }).datastore().table('CRMShops')
  const prev = setupPreview(shops); let n = 0
  for (const r of prev.rows) {
    const zone = overrides[r.id]?.zone ?? r.zone; const owner = overrides[r.id]?.owner ?? (ZONE_BY_ID[zone]?.owner || r.owner)
    if (!zone && !owner) continue
    if (zone === r.current_zone && owner === r.current_owner) continue
    await table.updateRow({ ROWID: String(r.id), ...(zone ? { region: zone } : {}), ...(owner ? { assigned_to: owner } : {}) }); n++
  }
  return { updated: n }
}

export function stats(shops, today = todayPT()) {
  const live = shops.filter(s => !['lost', 'denied'].includes(s.pipeline_stage))
  const grid = {}; for (const z of [...ZONES.map(z => z.id), 'unzoned']) grid[z] = {}
  for (const s of live) { const z = zoneOf(s) || 'unzoned'; grid[z][s.pipeline_stage] = (grid[z][s.pipeline_stage] || 0) + 1 }
  const inPlay = Object.fromEntries(OWNERS.map(o => [o, inPlayCount(shops, o)]))
  const stale = live.filter(s => (staleDays(s, today) || 0) > 0 && s.pipeline_stage !== 'target').length
  const noNext = live.filter(s => IN_PLAY_STAGES.includes(s.pipeline_stage) && !s.next_followup).length
  const ages = {}; for (const s of live) if (s.stage_changed_at) { const d = daysBetween(String(s.stage_changed_at).slice(0, 10), today); (ages[s.pipeline_stage] = ages[s.pipeline_stage] || []).push(d) }
  const avg_days_in_stage = Object.fromEntries(Object.entries(ages).map(([k, v]) => [k, Math.round(v.reduce((a, b) => a + b, 0) / v.length)]))
  return { grid, in_play: inPlay, cap: IN_PLAY_CAP, stale, no_next_action: noNext, avg_days_in_stage, unzoned: live.filter(s => !zoneOf(s)).length, total: live.length }
}

// Monday 7am PT: one list per owner → Mark's alerts channel / Jayden's DM.
export async function postMonday(req, shops, who = 'system') {
  const { postToCliqChannelById, postToCliqUser, MARK_ALERT_CHANNEL_ID, TECH_CLIQ_IDS } = await import('./cliq.js')
  const out = {}
  for (const owner of OWNERS) {
    const l = mondayList(shops, owner); const text = formatMonday(l)
    try { if (owner === 'Mark') await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, text); else await postToCliqUser(TECH_CLIQ_IDS[owner] || owner, text); out[owner] = { ok: true, overdue: l.overdue.length, stale: l.stale.length, in_play: l.in_play.length } }
    catch (e) { out[owner] = { ok: false, error: e.message } }
  }
  return out
}
export async function maybeMondayPipeline(req) {
  const a = catalyst.initialize(req, { type: 'advancedio' })
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date())
  const wd = fmt.find(p => p.type === 'weekday')?.value, h = Number(fmt.find(p => p.type === 'hour')?.value)
  if (wd !== 'Mon' || h < 7) return { fired: false, reason: 'not monday 7am+' }
  const key = `pipeline_monday:${todayPT()}`
  const rows = await a.zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = '${esc(key)}' LIMIT 1`).catch(() => [])
  if (rows?.length) return { fired: false, reason: 'already' }
  await a.datastore().table('AppConfig').insertRow({ config_key: key, config_value: new Date().toISOString() })
  const { getAllShops } = await import('../routes/shops.js')
  return { fired: true, ...(await postMonday(req, await withInvoiceDates(await getAllShops(req)), 'monday-cron')) }
}
