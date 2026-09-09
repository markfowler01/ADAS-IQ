// Sales stops (Mark 2026-09-09): techs log "I stopped by" from the field
// in under a minute — pick the shop (nearest first), tap an outcome,
// optionally scan a business card, one-line note. Lands in the CRM
// (activity log, people, last_contact, target→contacted), posts to
// #aajobs, and feeds the Live Day scoreboard: stops this week vs goal,
// streak, leaderboard.
//
// Money rule (Mark): stops carry NO bonus. A stop that turns into a NEW
// customer pays the tech 1% of that customer's invoiced sales for their
// first 30 days (from their first invoice). trackNewCustomerBonus() is
// called from the invoice pipeline (routes/webhook.js).
//
// Table SalesStops (Catalyst MCP 2026-09-09, id 45874000000556113):
//   tech, shop_name, shop_key, shop_id, outcome (talked|cards|card),
//   stop_note, person_name/title/email/phone, got_card, stop_at, stop_date,
//   lat, lng, new_shop, bonus_status ('' | pending | active | paid),
//   bonus_json {first_invoice_date, window_end, sales, bonus, invoices[]}
import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import axios from 'axios'
import { getAllShops, insertShop, updateShop } from './shops.js'
import { postToCliqChannel, AA_JOBS_CHANNEL } from '../services/cliq.js'

const router = express.Router()
const TABLE = 'SalesStops'
const BONUS_RATE = 0.01
const BONUS_WINDOW_DAYS = 30
const ATTRIBUTION_DAYS = 90
const DEFAULT_WEEK_GOAL = 5
const q = s => String(s ?? '').replace(/'/g, "''")
const shopKeyOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const OUTCOMES = {
  talked: { label: 'Talked to someone', emoji: '🤝' },
  cards:  { label: 'Left cards — nobody free', emoji: '📇' },
  card:   { label: 'Got a business card', emoji: '📇✨' },
}

function tbl(req) { return catalyst.initialize(req, { type: 'advancedio' }).datastore().table(TABLE) }
function rowToStop(r) {
  r = r?.[TABLE] || r
  let bonus = null
  try { bonus = r.bonus_json ? JSON.parse(r.bonus_json) : null } catch { bonus = null }
  return {
    id: String(r.ROWID), tech: r.tech || '', shop_name: r.shop_name || '', shop_key: r.shop_key || '', shop_id: r.shop_id || '',
    outcome: r.outcome || '', note: r.stop_note || '', person: { name: r.person_name || '', title: r.person_title || '', email: r.person_email || '', phone: r.person_phone || '' },
    got_card: r.got_card === 'yes', at: r.stop_at || '', date: r.stop_date || '', lat: r.lat ?? null, lng: r.lng ?? null,
    new_shop: r.new_shop === 'yes', bonus_status: r.bonus_status || '', bonus,
  }
}
async function allStops(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const out = []
  for (let off = 0; off < 6000; off += 300) {
    const rows = await app.zcql().executeZCQLQuery(`SELECT * FROM ${TABLE} ORDER BY stop_at DESC LIMIT ${off}, 300`)
    const batch = (rows || []).map(rowToStop)
    out.push(...batch)
    if (batch.length < 300) break
  }
  return out
}

// Monday-start week in PT.
function weekStartPT(dateStr = todayPT()) {
  const d = new Date(dateStr + 'T12:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7   // Mon=0
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}
function streakOf(dates) {
  const set = new Set(dates)
  let day = todayPT()
  if (!set.has(day)) day = addDays(day, -1)
  let n = 0
  while (set.has(day)) { n++; day = addDays(day, -1) }
  return n
}

export async function weekGoal(req) {
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const rows = await app.zcql().executeZCQLQuery(`SELECT config_value FROM AppConfig WHERE config_key = 'sales_stop_week_goal' LIMIT 1`)
    const v = Number((rows?.[0]?.AppConfig || rows?.[0])?.config_value)
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_WEEK_GOAL
  } catch { return DEFAULT_WEEK_GOAL }
}

export function buildStats(stops, goal) {
  const wk = weekStartPT()
  const byTech = {}
  for (const s of stops) {
    const t = s.tech || 'Unknown'
    const b = byTech[t] ||= { tech: t, week: 0, total: 0, cards: 0, dates: [], pending: [], earned: 0, active: [], last: null }
    b.total++
    if (s.date >= wk) b.week++
    if (s.got_card) b.cards++
    b.dates.push(s.date)
    if (!b.last || s.at > b.last) b.last = s.at
    if (s.bonus_status === 'pending') b.pending.push(s.shop_name)
    if (s.bonus_status === 'active' || s.bonus_status === 'paid') {
      b.earned += Number(s.bonus?.bonus || 0)
      b.active.push({ shop: s.shop_name, sales: s.bonus?.sales || 0, bonus: s.bonus?.bonus || 0, window_end: s.bonus?.window_end, status: s.bonus_status })
    }
  }
  const techs = Object.values(byTech).map(b => {
    const streak = streakOf(b.dates)
    const milestones = []
    if (b.total >= 1) milestones.push('🚐 First stop')
    if (b.total >= 10) milestones.push('🔟 10 stops')
    if (b.total >= 50) milestones.push('5️⃣0️⃣ 50 stops')
    if (b.cards >= 5) milestones.push('📇 5 cards')
    if (streak >= 3) milestones.push('🔥 3-day streak')
    if (b.active.length) milestones.push('💰 Landed a customer')
    const { dates, ...rest } = b
    return { ...rest, streak, goal, hit: b.week >= goal, milestones, pending: [...new Set(b.pending)] }
  }).sort((a, b) => b.week - a.week || b.total - a.total)
  return { week_start: wk, goal, techs, leaderboard: techs.map(t => ({ tech: t.tech, week: t.week, total: t.total, streak: t.streak, earned: Math.round(t.earned * 100) / 100 })) }
}

// ── Nearby shops ─────────────────────────────────────────────────────────
function miles(a, b, c, d) {
  const R = 3958.8, toR = x => x * Math.PI / 180
  const dLat = toR(c - a), dLng = toR(d - b)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
// Shops a tech can stop at = CRM shops ∪ Books customers (anything in
// the dispatch geocache). CRM shops with an address but no coordinates
// get geocoded on the fly (a few per call) and cached. Each row carries
// days since the last invoice so "haven't been there in a while" shops
// rise to the top — the seed of the relationship radar.
let _invCache = { at: 0, byKey: {} }
async function lastInvoiceByShop() {
  if (Date.now() - _invCache.at < 10 * 60 * 1000) return _invCache.byKey
  try {
    const { listInvoicesForDateRange } = await import('../services/zoho.js')
    const to = todayPT(), from = addDays(to, -180)
    const inv = await listInvoicesForDateRange(from, to)
    const byKey = {}
    for (const i of inv) {
      const k = shopKeyOf(i.customer_name)
      if (!k) continue
      if (!byKey[k] || i.date > byKey[k].date) byKey[k] = { date: i.date, name: i.customer_name }
      byKey[k].count = (byKey[k].count || 0) + 1
    }
    _invCache = { at: Date.now(), byKey }
  } catch (e) { console.log('[sales-stop] invoice lookup failed:', e.message) }
  return _invCache.byKey
}
// Forgiving search (Mark 2026-09-09, "Maiko" for Maaco): every typed
// word must match a word in the shop name or its address by prefix, or
// within 2 letters of edit distance. Scored so exact/prefix hits rank
// above fuzzy ones.
function lev(a, b) {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m) return n; if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]
}
function fuzzyFilter(rows, query) {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (!words.length) return rows
  const scored = []
  for (const r of rows) {
    const hay = `${r.shop_name} ${r.address || ''}`.toLowerCase()
    const tokens = hay.split(/[^a-z0-9]+/).filter(Boolean)
    let score = 0, ok = true
    for (const w of words) {
      if (hay.includes(w)) { score += 3; continue }
      const near = tokens.some(t => t.startsWith(w) || (w.length >= 4 && lev(w, t.slice(0, Math.max(w.length, 3))) <= (w.length >= 6 ? 2 : 1)) || (w.length >= 4 && lev(w, t) <= 2))
      if (near) score += 1; else { ok = false; break }
    }
    if (ok) scored.push({ r, score })
  }
  return scored.sort((a, b) => b.score - a.score || (a.r.distance_mi ?? 999) - (b.r.distance_mi ?? 999)).map(x => x.r)
}
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000)

router.get('/nearby', async (req, res) => {
  try {
    const lat = Number(req.query.lat), lng = Number(req.query.lng)
    const hasLoc = Number.isFinite(lat) && Number.isFinite(lng)
    const qs = String(req.query.q || '').trim().toLowerCase()
    const geo = await import('../services/geocoding.js')
    const [shops, stops, cache, lastInv] = await Promise.all([
      getAllShops(req), allStops(req).catch(() => []), geo.readGeocache(req).catch(() => ({})), lastInvoiceByShop(),
    ])
    const norm = geo.normalizeKey
    // Union: CRM shops first, then Books customers the CRM doesn't know.
    const seen = new Set()
    const rows = []
    for (const sh of shops) {
      seen.add(shopKeyOf(sh.shop_name))
      // "Stopped before" from CRM history too (visit activities / last_contact),
      // not just the new SalesStops table — so a shop Mark has hit for
      // years doesn't read "never stopped".
      const visits = (Array.isArray(sh.activities) ? sh.activities : []).filter(a => a && (a.type === 'visit' || a.type === 'meeting'))
      const lastVisit = visits.map(a => String(a.at || '').slice(0, 10)).filter(Boolean).sort().pop() || String(sh.last_contact || '').slice(0, 10) || null
      rows.push({ id: sh.id, shop_name: sh.shop_name, pipeline_stage: sh.pipeline_stage, address: sh.address || '', in_crm: true, crm_last_visit: lastVisit, crm_visits: visits.length })
    }
    for (const [k, v] of Object.entries(cache)) {
      if (!k || typeof v !== 'object') continue
      const name = v.shop_name || k
      if (seen.has(shopKeyOf(name))) continue
      seen.add(shopKeyOf(name))
      rows.push({ id: '', shop_name: name, pipeline_stage: 'active', address: v.address || '', in_crm: false })
    }
    // …and every shop with a card on the Jobs board (new customers whose
    // first invoice hasn't gone out yet, e.g. Perfect Reflections).
    try {
      const { readJobsPublic } = await import('./jobs.js')
      for (const j of await readJobsPublic(req)) {
        const name = String(j.shop_name || '').trim()
        if (!name || seen.has(shopKeyOf(name))) continue
        seen.add(shopKeyOf(name))
        rows.push({ id: '', shop_name: name, pipeline_stage: 'active', address: '', in_crm: false })
      }
    } catch (e) { console.log('[sales-stop] jobs union failed:', e.message) }
    // …and anyone invoiced in the last 180 days, even if never geocoded.
    for (const v of Object.values(lastInv)) {
      if (!v?.name || seen.has(shopKeyOf(v.name))) continue
      seen.add(shopKeyOf(v.name))
      rows.push({ id: '', shop_name: v.name, pipeline_stage: 'active', address: '', in_crm: false })
    }
    // Geocode a few CRM shops that still have no coordinates (cached after).
    let geocoded = 0
    const raw = {}
    for (const r of rows) {
      if (!r.in_crm || !r.address || geocoded >= 6) continue
      const c = cache[norm(r.shop_name)]
      if (c && c.lat != null) continue
      const g = await geo.geocodeAddress(r.address).catch(() => null)
      geocoded++
      if (g && g.lat != null) { cache[norm(r.shop_name)] = { ...g, address: r.address, geocoded_at: new Date().toISOString() }; raw[norm(r.shop_name)] = cache[norm(r.shop_name)] }
    }
    if (Object.keys(raw).length) {
      try { const cur = await geo.readGeocacheRaw(req); await geo.writeGeocache(req, { ...cur, ...raw }) } catch (e) { console.log('[sales-stop] geocache write failed:', e.message) }
    }
    const lastStop = {}
    for (const st of stops) if (!lastStop[st.shop_key]) lastStop[st.shop_key] = st
    const today = todayPT()
    const out = rows.map(r => {
      const c = cache[norm(r.shop_name)]
      const dist = (hasLoc && c && c.lat != null) ? miles(lat, lng, c.lat, c.lng) : null
      const ls = lastStop[shopKeyOf(r.shop_name)]
      const li = lastInv[shopKeyOf(r.shop_name)]
      return {
        ...r, distance_mi: dist == null ? null : Math.round(dist * 10) / 10,
        last_stop: ls ? { tech: ls.tech, date: ls.date } : (r.crm_last_visit ? { tech: '', date: r.crm_last_visit, from_crm: true } : null),
        last_job: li ? li.date : null, days_since_job: li ? daysBetween(li.date, today) : null, jobs_180d: li?.count || 0,
      }
    })
    const wantAll = String(req.query.all || '') === '1'
    let list
    if (qs) list = fuzzyFilter(out, qs).slice(0, 25)
    else if (wantAll) list = out.sort((a, b) => a.shop_name.localeCompare(b.shop_name)).slice(0, 300)
    else if (hasLoc) list = out.filter(r => r.distance_mi != null).sort((a, b) => a.distance_mi - b.distance_mi).slice(0, 15)
    else {
      // No location: body shops first (CRM shops + repeat customers),
      // longest since a job at the top; one-off cash customers last.
      const rank = r => (r.in_crm ? 0 : (r.jobs_180d >= 2 ? 1 : 2))
      list = out.sort((a, b) => rank(a) - rank(b) || (b.days_since_job ?? -1) - (a.days_since_job ?? -1)).slice(0, 30)
    }
    res.json({ ok: true, shops: list, has_location: hasLoc, geocoded })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Log a stop ───────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const b = req.body || {}
    const tech = String(b.tech || req.user?.name || req.user?.email || 'Tech').trim().split(' ')[0]
    const shopName = String(b.shop_name || '').trim()
    const outcome = OUTCOMES[b.outcome] ? b.outcome : 'talked'
    const note = String(b.note || '').trim().slice(0, 2000)
    const p = b.person || {}
    const person = { name: String(p.name || '').trim().slice(0, 120), title: String(p.title || '').trim().slice(0, 80), email: String(p.email || '').trim().toLowerCase().slice(0, 200), phone: String(p.phone || '').trim().slice(0, 40) }
    const gotCard = outcome === 'card' || !!(person.name && (person.email || person.phone))
    if (!shopName) return res.status(400).json({ error: 'Pick a shop first.' })

    // CRM: find or create the shop, then log the visit on it.
    const shops = await getAllShops(req)
    const key = shopKeyOf(shopName)
    let shop = shops.find(s => shopKeyOf(s.shop_name) === key)
    let newShop = false
    const now = new Date().toISOString(), today = todayPT()
    const summary = `🚐 Sales stop by ${tech} — ${OUTCOMES[outcome].label}${person.name ? ` · met ${person.name}${person.title ? ` (${person.title})` : ''}` : ''}${note ? ` — ${note}` : ''}`
    const activity = { type: 'visit', summary, at: now, by: tech, source: 'sales-stop' }
    if (!shop) {
      shop = await insertShop(req, {
        shop_name: shopName, pipeline_stage: 'contacted', referral_source: `Sales stop (${tech})`,
        contact_name: person.name || '', phone: person.phone || '', email: person.email || '', last_contact: today,
        people: person.name ? [{ id: `p_${Date.now()}`, name: person.name, title: person.title, email: person.email, phone: person.phone, source: 'sales-stop', added_by: tech, added_at: now }] : [],
        activities: [activity], notes: '',
      })
      newShop = true
    } else {
      const people = Array.isArray(shop.people) ? [...shop.people] : []
      if (person.name) {
        const idx = people.findIndex(x => (person.email && String(x.email || '').toLowerCase() === person.email) || String(x.name || '').toLowerCase() === person.name.toLowerCase())
        const entry = { name: person.name, title: person.title || undefined, email: person.email || undefined, phone: person.phone || undefined, source: 'sales-stop', added_by: tech, added_at: now }
        Object.keys(entry).forEach(k => entry[k] === undefined && delete entry[k])
        if (idx >= 0) people[idx] = { ...people[idx], ...entry }
        else people.push({ id: `p_${Date.now()}`, ...entry })
      }
      const activities = [activity, ...(Array.isArray(shop.activities) ? shop.activities : [])].slice(0, 200)
      const patch = { ...shop, people, activities, last_contact: today }
      if (shop.pipeline_stage === 'target') patch.pipeline_stage = 'contacted'
      shop = await updateShop(req, shop.id, patch)
    }

    // Bonus eligibility: pending when the shop has never been invoiced.
    let bonusStatus = ''
    try { bonusStatus = (await hasPriorInvoices(shop.shop_name, today)) ? '' : 'pending' } catch { bonusStatus = 'pending' }

    // lat/lng columns hold 4 decimals (~11 m); phones send 8+, which the
    // Datastore rejects as "Invalid input value" (Mark's first stop,
    // 2026-09-09). Round, and leave the keys out entirely when unknown.
    const row = {
      tech, shop_name: shop.shop_name, shop_key: key, shop_id: String(shop.id || ''), outcome, stop_note: note,
      person_name: person.name, person_title: person.title, person_email: person.email, person_phone: person.phone,
      got_card: gotCard ? 'yes' : 'no', stop_at: now, stop_date: today,
      new_shop: newShop ? 'yes' : 'no', bonus_status: bonusStatus, bonus_json: '',
    }
    if (Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng))) {
      row.lat = Math.round(Number(b.lat) * 10000) / 10000
      row.lng = Math.round(Number(b.lng) * 10000) / 10000
    }
    let inserted
    try { inserted = await tbl(req).insertRow(row) }
    catch (e) {
      // Never lose the stop over coordinates — retry without them.
      console.log('[sales-stop] insert failed, retrying without lat/lng:', e.message)
      delete row.lat; delete row.lng
      inserted = await tbl(req).insertRow(row)
    }
    const stop = rowToStop(inserted)

    // Van newsletter if we got an email (same as the counter flow).
    if (person.email) {
      import('../services/fromTheVan.js').then(m => m.addVanSubscriber({ email: person.email, firstName: person.name.split(' ')[0], lastName: person.name.split(' ').slice(1).join(' ') })).catch(() => {})
    }

    // Team credit in #aajobs + fresh stats for the confetti screen.
    const stats = buildStats(await allStops(req), await weekGoal(req))
    const mine = stats.techs.find(t => t.tech === tech)
    const line = [
      `🚐 *${tech} stopped by ${shop.shop_name}*${newShop ? ' (new to the CRM)' : ''}`,
      `${OUTCOMES[outcome].emoji} ${OUTCOMES[outcome].label}${person.name ? ` · met ${person.name}${person.title ? ` (${person.title})` : ''}` : ''}`,
      note ? `📝 ${note}` : null,
      bonusStatus === 'pending' ? `🎯 Never invoiced — first job here pays ${tech} 1% of their first 30 days` : null,
      mine ? `📊 ${mine.week}/${mine.goal} this week${mine.streak >= 2 ? ` · 🔥 ${mine.streak}-day streak` : ''}${mine.hit ? ' · GET SOME!!!' : ''}` : null,
    ].filter(Boolean).join('\n')
    await postToCliqChannel(AA_JOBS_CHANNEL, line).catch(e => console.log('[sales-stop] #aajobs post failed:', e.message))

    res.status(201).json({ ok: true, stop, shop: { id: shop.id, shop_name: shop.shop_name, pipeline_stage: shop.pipeline_stage }, new_shop: newShop, bonus_pending: bonusStatus === 'pending', stats: mine, leaderboard: stats.leaderboard })
  } catch (e) {
    console.error('[sales-stop]', e.message)
    res.status(500).json({ error: e.message })
  }
})

router.get('/stats', async (req, res) => {
  try {
    const stats = buildStats(await allStops(req), await weekGoal(req))
    const tech = String(req.query.tech || '').trim().split(' ')[0]
    res.json({ ok: true, ...stats, mine: tech ? stats.techs.find(t => t.tech.toLowerCase() === tech.toLowerCase()) || null : null })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/recent', async (req, res) => {
  try {
    const stops = await allStops(req)
    const tech = String(req.query.tech || '').trim().split(' ')[0].toLowerCase()
    res.json({ ok: true, stops: (tech ? stops.filter(s => s.tech.toLowerCase() === tech) : stops).slice(0, 50) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Owner: set the weekly goal.
router.put('/goal', async (req, res) => {
  try {
    const owner = String(req.user?.email || '').toLowerCase().startsWith('mark@') || req.user?.role === 'owner'
    if (!owner) return res.status(403).json({ error: 'Only Mark can set the goal.' })
    const n = Number(req.body?.goal)
    if (!Number.isFinite(n) || n < 1) return res.status(400).json({ error: 'goal must be ≥ 1' })
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const rows = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = 'sales_stop_week_goal' LIMIT 1`)
    const row = rows?.[0]?.AppConfig || rows?.[0]
    if (row?.ROWID) await app.datastore().table('AppConfig').updateRow({ ROWID: String(row.ROWID), config_value: String(n) })
    else await app.datastore().table('AppConfig').insertRow({ config_key: 'sales_stop_week_goal', config_value: String(n) })
    res.json({ ok: true, goal: n })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Bonus: 1% of a NEW customer's first-30-day invoiced sales ───────────
async function hasPriorInvoices(customerName, beforeDate) {
  const { getAccessToken } = await import('../services/zoho.js')
  const token = await getAccessToken()
  const r = await axios.get('https://www.zohoapis.com/books/v3/invoices', {
    headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 15000,
    params: { organization_id: process.env.ZOHO_ORGANIZATION_ID, customer_name: customerName, date_end: addDays(beforeDate, -1), per_page: 5 },
  })
  return (r.data?.invoices || []).length > 0
}

// Called from routes/webhook.js after an invoice alerts. Idempotent per
// invoice number. Returns null when nothing applies.
export async function trackNewCustomerBonus(req, invoice) {
  try {
    const customer = String(invoice.customer_name || '').trim()
    const number = String(invoice.invoice_number || '')
    const date = String(invoice.date || todayPT()).slice(0, 10)
    const total = Number(invoice.total ?? invoice.total_amount ?? 0) || 0
    if (!customer || !number || total <= 0) return null
    const key = shopKeyOf(customer)
    const stops = (await allStops(req)).filter(s => s.shop_key === key)
    if (!stops.length) return null

    // 1) An ACTIVE window for this shop → add this invoice if inside it.
    const active = stops.find(s => s.bonus_status === 'active')
    if (active) {
      const bj = active.bonus || {}
      if ((bj.invoices || []).some(i => i.number === number)) return null
      if (date > bj.window_end) return null
      bj.invoices = [...(bj.invoices || []), { number, date, total }]
      bj.sales = Math.round((bj.invoices.reduce((s, i) => s + i.total, 0)) * 100) / 100
      bj.bonus = Math.round(bj.sales * BONUS_RATE * 100) / 100
      await tbl(req).updateRow({ ROWID: active.id, bonus_json: JSON.stringify(bj) })
      await postToCliqChannel(AA_JOBS_CHANNEL, `💰 *${active.tech}'s new customer ${customer}* invoiced again · $${total.toFixed(2)} → bonus now $${bj.bonus.toFixed(2)} (1% of $${bj.sales.toFixed(2)}, window to ${bj.window_end})`).catch(() => {})
      return { tech: active.tech, bonus: bj.bonus }
    }

    // 2) No active window: is this the customer's FIRST invoice, and was
    //    there a stop within the last 90 days?
    const recent = stops.filter(s => s.date <= date && s.date >= addDays(date, -ATTRIBUTION_DAYS)).sort((a, b) => b.at.localeCompare(a.at))[0]
    if (!recent) return null
    if (await hasPriorInvoices(customer, date)) {
      // Not a new customer — clear any pending flags for this shop.
      for (const s of stops.filter(x => x.bonus_status === 'pending')) await tbl(req).updateRow({ ROWID: s.id, bonus_status: '' }).catch(() => {})
      return null
    }
    const bj = { first_invoice_date: date, window_end: addDays(date, BONUS_WINDOW_DAYS), invoices: [{ number, date, total }], sales: total, bonus: Math.round(total * BONUS_RATE * 100) / 100, rate: BONUS_RATE }
    await tbl(req).updateRow({ ROWID: recent.id, bonus_status: 'active', bonus_json: JSON.stringify(bj) })
    for (const s of stops.filter(x => x.id !== recent.id && x.bonus_status === 'pending')) await tbl(req).updateRow({ ROWID: s.id, bonus_status: '' }).catch(() => {})
    await postToCliqChannel(AA_JOBS_CHANNEL, `💰🎉 *NEW CUSTOMER — ${customer}* · ${recent.tech}'s stop on ${recent.date} just paid off!\nFirst invoice ${number} · $${total.toFixed(2)} → ${recent.tech} earns 1% of everything they invoice through ${bj.window_end}. Bonus so far: $${bj.bonus.toFixed(2)}. GET SOME!!!`).catch(() => {})
    console.log(`[sales-stop bonus] ${recent.tech} ← ${customer} first invoice ${number} $${total}`)
    return { tech: recent.tech, bonus: bj.bonus, first: true }
  } catch (e) {
    console.log('[sales-stop bonus] failed:', e.message)
    return null
  }
}

export default router
