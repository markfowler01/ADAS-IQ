// 📅 Shop rhythm + 🍖 shop BBQ (Mark 2026-10-24).
//
// "I'm trying to better predict my weeks … on their CRM card I want the top
// three days that they call us with the percentages." The day a shop calls =
// the day the job came in. The Jobs table only holds open work (rows leave
// when invoiced), so the history is Books invoices, each moved back to the
// first day we saw that RO: the scrub (estimate arrived) or the open job,
// when that was within 21 days before the invoice. Same RO = one car (a
// supplement doesn't count twice). Last 12 months.
//
// "As clients reach 40K in sales I want a barbecue automatically scheduled on
// like a Tuesday or Wednesday the following week and notify me directly."
// Every $40k of lifetime invoiced sales after discount (voids/drafts out) is a
// milestone. Each one fires once: Tuesday of the week after the crossing
// (Wednesday if Tuesday lunch is taken) on Mark's Zoho Calendar, 11:30–1:00 at
// the shop, plus a Cliq DM and a text to Mark. Nothing goes to the shop. The
// first run marks milestones already passed as done (no flood on day one).
//
// Stored in DurableKV: shop_rhythm (the card numbers) and shop_bbq (milestones).
import catalyst from 'zcatalyst-sdk-node'
import { kvGet, kvSet } from './durableKV.js'

export const BBQ_STEP = 40000
const WINDOW_DAYS = 365
const MIN_JOBS = 8
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const RHYTHM_KEY = 'shop_rhythm', BBQ_KEY = 'shop_bbq'

const app = req => catalyst.initialize(req)
const normRo = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const ptDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d))
const dowOf = iso => new Date(`${iso}T12:00:00Z`).getUTCDay()
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)
const fmtUSD = n => `$${Math.round(n).toLocaleString('en-US')}`

export async function readRhythm(req) { try { const v = await kvGet(app(req), RHYTHM_KEY); return v ? JSON.parse(v) : null } catch { return null } }
export async function readBbq(req) { try { const v = await kvGet(app(req), BBQ_KEY); return v ? JSON.parse(v) : null } catch { return null } }
async function writeBbq(req, st) { await kvSet(app(req), BBQ_KEY, JSON.stringify(st)) }

// RO → first PT day we saw it (scrubs + open jobs).
async function firstSeenByRo(req) {
  const seen = {}
  const note = (ro, at) => { const k = normRo(ro); if (k.length < 3 || !at) return; const d = ptDate(at); if (!seen[k] || d < seen[k]) seen[k] = d }
  try {
    const z = app(req).zcql()
    for (let off = 0; off < 20000; off += 300) {
      const r = await z.executeZCQLQuery(`SELECT scrub_ro, scrub_at FROM AdasScrubs ORDER BY ROWID LIMIT ${off}, 300`)
      const batch = (r || []).map(x => x.AdasScrubs || x)
      for (const s of batch) note(s.scrub_ro, s.scrub_at)
      if (batch.length < 300) break
    }
  } catch (e) { console.warn('[shop-rhythm] scrubs', e.message) }
  try {
    const { readJobsPublic } = await import('../routes/jobs.js')
    for (const j of await readJobsPublic(req)) note(j.ro_number || j.quote_number, j.created_at)
  } catch (e) { console.warn('[shop-rhythm] jobs', e.message) }
  return seen
}

/** Rebuild the per-shop numbers. Returns { at, shops: { [shopId]: {...} }, invoices } and saves it. */
export async function buildShopRhythm(req) {
  const today = ptDate(Date.now())
  const { invoicedRows, SALES_SINCE } = await import('./salesBasis.js')
  const { getAllShops } = await import('../routes/shops.js')
  const { matchShop } = await import('./shopResolve.js')
  const [invoices, shops, seen] = await Promise.all([invoicedRows(SALES_SINCE, today), getAllShops(req), firstSeenByRo(req)])
  const byContact = Object.fromEntries(shops.filter(s => s.zoho_contact_id).map(s => [String(s.zoho_contact_id), s]))
  const nameHit = {}
  const shopFor = inv => {
    if (byContact[inv.customer_id]) return byContact[inv.customer_id]
    const k = inv.customer_name || ''
    if (!(k in nameHit)) { const m = matchShop(k, shops); nameHit[k] = m.confidence >= 0.8 ? m.shop : null }
    return nameHit[k]
  }
  const since = addDays(today, -WINDOW_DAYS)
  const acc = {}   // shopId → { lifetime, counts[7], cars:Set, invs:[{date,total}] }
  let unmatched = 0
  const unmatchedNames = {}
  // 📊 Everyone together (Mark 2026-10-24: "the total top 3 days we get called for everyone, by the
  // total money"): every invoice in the window, retail included, dollars on the day the car came in.
  const coDollars = [0, 0, 0, 0, 0, 0, 0], coCars = [0, 0, 0, 0, 0, 0, 0], coSeen = new Set()
  const cameOf = (inv, ro) => { const first = ro.length >= 3 ? seen[ro] : ''; return first && first <= inv.date && daysBetween(first, inv.date) <= 21 ? first : inv.date }
  for (const inv of invoices) {
    const total = Number(inv.total) || 0
    const ro = normRo(inv.reference_number)
    if (total > 0 && inv.date >= since) {
      const d = dowOf(cameOf(inv, ro))
      coDollars[d] += total
      const k = `${inv.customer_id || inv.customer_name}|${ro.length >= 3 ? ro : inv.invoice_id}`
      if (!coSeen.has(k)) { coSeen.add(k); coCars[d]++ }
    }
    const s = shopFor(inv); if (!s) { unmatched++; unmatchedNames[inv.customer_name || '?'] = (unmatchedNames[inv.customer_name || '?'] || 0) + 1; continue }
    const a = acc[s.id] = acc[s.id] || { name: s.shop_name, lifetime: 0, counts: [0, 0, 0, 0, 0, 0, 0], cars: new Set(), invs: [] }
    a.lifetime += total
    a.invs.push({ date: inv.date, total })
    if (!(total > 0) || inv.date < since) continue
    const car = ro.length >= 3 ? `ro:${ro}` : `inv:${inv.invoice_id}`
    if (a.cars.has(car)) continue
    a.cars.add(car)
    a.counts[dowOf(cameOf(inv, ro))]++
  }
  const coTotal = coDollars.reduce((t, v) => t + v, 0), coN = coCars.reduce((t, v) => t + v, 0)
  const company = {
    total: Math.round(coTotal), cars: coN,
    top: coDollars.map((v, d) => ({ d, v })).filter(x => x.v > 0).sort((x, y) => y.v - x.v).slice(0, 3)
      .map(x => ({ day: DOW[x.d], dow: x.d, dollars: Math.round(x.v), pct: Math.round((x.v / Math.max(1, coTotal)) * 100), cars: coCars[x.d] })),
  }
  const out = {}
  for (const [id, a] of Object.entries(acc)) {
    const n = a.counts.reduce((t, c) => t + c, 0)
    const top = a.counts.map((c, d) => ({ d, c })).filter(x => x.c > 0).sort((x, y) => y.c - x.c || x.d - y.d).slice(0, 3)
      .map(x => ({ day: DOW[x.d], dow: x.d, pct: Math.round((x.c / Math.max(1, n)) * 100) }))
    out[id] = { name: a.name, n, top, lifetime: Math.round(a.lifetime), nextMilestone: (Math.floor(a.lifetime / BBQ_STEP) + 1) * BBQ_STEP }
  }
  const rec = { at: new Date().toISOString(), since, minJobs: MIN_JOBS, company, shops: out, invoices: invoices.length, unmatched, unmatchedNames }
  await kvSet(app(req), RHYTHM_KEY, JSON.stringify(rec))
  return { rec, acc, shops }
}

// Date the shop's running total first reached `amount`.
function crossingDate(invs, amount) {
  let t = 0
  for (const i of [...invs].sort((a, b) => a.date.localeCompare(b.date))) { t += i.total; if (t >= amount) return i.date }
  return ''
}

// Tuesday of the week after `crossed` (Wednesday if Tuesday lunch is busy). Never in the past.
async function pickBbqDay(crossed, today) {
  const monday = addDays(crossed, -((dowOf(crossed) + 6) % 7))
  let tue = addDays(monday, 8)
  while (tue <= today) tue = addDays(tue, 7)
  const { calendarEventsOn } = await import('../routes/calendar.js')
  // Zoho returns yyyyMMddTHHmmssZ (UTC). Lunch 11:30–13:00 PT.
  const busy = async iso => {
    try {
      const off = new Date(`${iso}T12:00:00Z`).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' }).includes('PDT') ? 7 : 8
      const lo = Date.parse(`${iso}T11:30:00Z`) + off * 3600000, hi = Date.parse(`${iso}T13:00:00Z`) + off * 3600000
      const t = s => { const m = String(s).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN }
      return (await calendarEventsOn(iso)).some(e => { const a = t(e.start), b = t(e.end); return a < hi && b > lo })
    } catch { return false }
  }
  if (!(await busy(tue))) return { date: tue, note: '' }
  const wed = addDays(tue, 1)
  if (!(await busy(wed))) return { date: wed, note: 'Tuesday lunch was taken' }
  return { date: tue, note: 'Tuesday and Wednesday lunch both have something on them' }
}

/**
 * Check every shop for a new $40k milestone. First run (no state) only records
 * what's already passed. `dry` = report, change nothing.
 */
export async function runBbq(req, built, { dry = false } = {}) {
  const today = ptDate(Date.now())
  const st = (await readBbq(req)) || { seeded: false, shops: {} }
  const report = { seeded: st.seeded, scheduled: [], seed: [] }
  const shopById = Object.fromEntries(built.shops.map(s => [s.id, s]))
  for (const [id, a] of Object.entries(built.acc)) {
    const m = Math.floor(a.lifetime / BBQ_STEP)
    const cur = st.shops[id] || { done: 0, history: [] }
    if (!st.seeded) { if (m > 0) report.seed.push({ shop: a.name, lifetime: Math.round(a.lifetime), milestones: m }); cur.done = m; st.shops[id] = cur; continue }
    if (m <= (cur.done || 0)) continue
    const milestone = m * BBQ_STEP
    const crossed = crossingDate(a.invs, milestone) || today
    const pick = dry ? { date: '(dry run)', note: '' } : await pickBbqDay(crossed, today)
    const item = { shop: a.name, milestone, crossed, date: pick.date, note: pick.note, lifetime: Math.round(a.lifetime) }
    report.scheduled.push(item)
    if (dry) continue
    // Lock first: the milestone is spent before anything goes out, so a retry never doubles it.
    cur.done = m; cur.history = [...(cur.history || []), { ...item, at: new Date().toISOString() }].slice(-20)
    st.shops[id] = cur
    await writeBbq(req, st)
    const shop = shopById[id] || {}
    const when = new Date(`${pick.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })
    try {
      const { createCalendarEvent } = await import('../routes/calendar.js')
      item.event = await createCalendarEvent({
        title: `🍖 Shop BBQ: ${a.name} (${fmtUSD(milestone)} milestone)`, date: pick.date, startTime: '11:30', endTime: '13:00',
        location: shop.address || a.name,
        description: `${a.name} passed ${fmtUSD(milestone)} in sales on ${crossed} (lifetime ${fmtUSD(a.lifetime)}). Scheduled by the Absolute ADAS app. The shop has not been told.`,
      })
    } catch (e) { item.calendar_error = e.message; console.warn('[bbq] calendar', e.message) }
    const msg = `🍖 ${a.name} just passed ${fmtUSD(milestone)} in sales. BBQ penciled in ${when} 11:30 at the shop${pick.note ? ` (${pick.note})` : ''}. ${item.event ? 'It is on your calendar. Move it if that day does not work.' : 'Calendar add failed, put it on by hand.'} The shop hasn't been told.`
    try { const { postToCliqUser, TECH_CLIQ_IDS } = await import('./cliq.js'); await postToCliqUser(TECH_CLIQ_IDS.Mark, msg) } catch (e) { console.warn('[bbq] cliq', e.message) }
    try {
      const { getMarkPhone } = await import('./markPhone.js'); const to = await getMarkPhone(req)
      if (to) { const { sendSMS } = await import('./comms.js'); await sendSMS(req, { to, body: msg, category: 'shop_bbq' }) }
    } catch (e) { console.warn('[bbq] sms', e.message) }
    cur.history[cur.history.length - 1] = { ...cur.history[cur.history.length - 1], event: item.event || '', calendar_error: item.calendar_error }
    await writeBbq(req, st)
  }
  if (!st.seeded && !dry) { st.seeded = true; st.seeded_at = new Date().toISOString(); st.seed = report.seed; await writeBbq(req, st) }
  return report
}

/** Once a PT day after 7 AM (last night's invoices are in Books by then). */
export async function maybeShopRhythm(req) {
  const hourPT = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date()))
  if (hourPT < 7) return { fired: false, reason: 'before-window' }
  const stamp = `shop_rhythm_run:${ptDate(Date.now())}`
  const a = app(req)
  if (await kvGet(a, stamp).catch(() => null)) return { fired: false, reason: 'already' }
  await kvSet(a, stamp, new Date().toISOString())
  const built = await buildShopRhythm(req)
  const bbq = await runBbq(req, built)
  return { fired: true, shops: Object.keys(built.rec.shops).length, unmatched: built.rec.unmatched, bbq: { seeded: bbq.seeded, scheduled: bbq.scheduled.length, seed: bbq.seed.length } }
}

/** Shops that usually call on `dateStr`'s weekday (top day, enough history), busiest first. */
export function usuallyCallOn(rhythm, dateStr, limit = 4) {
  const d = dowOf(dateStr)
  const list = Object.values(rhythm?.shops || {}).filter(s => s.n >= MIN_JOBS && s.top?.[0]?.dow === d).sort((a, b) => b.n - a.n)
  return { label: DOW_LONG[d], shops: list.slice(0, limit).map(s => ({ name: s.name, pct: s.top[0].pct })) }
}
