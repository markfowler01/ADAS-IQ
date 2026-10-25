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
    const came = cameOf(inv, ro)
    a.counts[dowOf(came)]++
    if (!a.lastCame || came > a.lastCame) a.lastCame = came
    if (!a.firstCame || came < a.firstCame) a.firstCame = came
  }
  for (const inv of invoices) {   // 12-month dollars per shop (every invoice on the car, supplements too)
    const total = Number(inv.total) || 0; if (!(total > 0) || inv.date < since) continue
    const s = shopFor(inv); if (s && acc[s.id]) acc[s.id].year = (acc[s.id].year || 0) + total
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
    // 📞 Gone quiet (Mark 2026-10-25): a shop that usually sends a car every `gap` days and
    // has now gone 3 gaps (at least 2 weeks) without one. Worth = cars missed × average car.
    if (n >= MIN_JOBS && a.lastCame) {
      const gap = Math.max(1, daysBetween(a.firstCame, today) / n)
      const quietDays = daysBetween(a.lastCame, today)
      const perCar = (a.year || 0) / n
      out[id].gap = Math.round(gap * 10) / 10
      out[id].lastCame = a.lastCame
      if (quietDays >= Math.max(14, 3 * gap)) out[id].quiet = { days: quietDays, missed: Math.floor(quietDays / gap), worth: Math.round(Math.floor(quietDays / gap) * perCar), usual: top.map(t => t.day) }
    }
  }
  // 💳 When each shop pays (Mark 2026-10-25), from the Books mirror (AdasInvoices: date + last
  // payment date). Shops are due on receipt, so Books calls every open invoice "overdue";
  // what matters is late FOR THAT SHOP. Median days to pay over 12 months (3+ paid invoices).
  try {
    const { readAll } = await import('./zohoMirror.js')
    const mirror = (await readAll(req, 'inv')).filter(i => !/void|draft/i.test(i.status))
    const paidDays = {}, open = {}
    for (const i of mirror) {
      const s = shopFor({ customer_id: i.customer_id, customer_name: i.customer_name }); if (!s || !out[s.id]) continue
      if (i.status === 'paid' && i.last_payment_date && i.date >= since) (paidDays[s.id] = paidDays[s.id] || []).push(Math.max(0, daysBetween(i.date, i.last_payment_date)))
      else if (i.balance > 0) (open[s.id] = open[s.id] || []).push(i)
    }
    const sunday = addDays(today, (7 - dowOf(today)) % 7)
    const cash = { thisWeek: 0, week: [], late: [], open: 0 }
    for (const [id, o] of Object.entries(out)) {
      const d = (paidDays[id] || []).sort((x, y) => x - y)
      const median = d.length >= 3 ? d[Math.floor(d.length / 2)] : null
      const ops = open[id] || []
      const openAmt = ops.reduce((t, i) => t + i.balance, 0)
      if (median == null && !ops.length) continue
      let week = 0, late = 0, lateDays = 0
      for (const i of ops) {
        if (median == null) continue
        const expect = addDays(i.date, median)
        if (expect < addDays(today, -7)) { late += i.balance; lateDays = Math.max(lateDays, daysBetween(expect, today)) }
        else if (expect <= sunday) week += i.balance
      }
      o.pay = { median, paid: d.length, open: Math.round(openAmt), openN: ops.length, week: Math.round(week), late: Math.round(late), lateDays }
      cash.open += openAmt; cash.thisWeek += week
      if (week > 0) cash.week.push({ id, name: o.name, amount: Math.round(week) })
      if (late > 0) cash.late.push({ id, name: o.name, amount: Math.round(late), daysLate: lateDays, median })
    }
    cash.thisWeek = Math.round(cash.thisWeek); cash.open = Math.round(cash.open)
    cash.week.sort((x, y) => y.amount - x.amount); cash.late.sort((x, y) => y.amount - x.amount)
    company.cash = cash
  } catch (e) { console.warn('[shop-rhythm] pay', e.message) }
  company.quiet = Object.entries(out).filter(([, o]) => o.quiet).map(([id, o]) => ({ id, name: o.name, ...o.quiet })).sort((x, y) => y.worth - x.worth).slice(0, 10)
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
  let monday = null
  if (dowOf(ptDate(Date.now())) === 1) { try { monday = await sendMondayList(req, built.rec) } catch (e) { console.warn('[shop-rhythm] monday list', e.message) } }
  return { fired: true, shops: Object.keys(built.rec.shops).length, unmatched: built.rec.unmatched, bbq: { seeded: bbq.seeded, scheduled: bbq.scheduled.length, seed: bbq.seed.length }, monday }
}

/** Shops that usually call on `dateStr`'s weekday (top day, enough history), busiest first. */
export function usuallyCallOn(rhythm, dateStr, limit = 4) {
  const d = dowOf(dateStr)
  const list = Object.values(rhythm?.shops || {}).filter(s => s.n >= MIN_JOBS && s.top?.[0]?.dow === d).sort((a, b) => b.n - a.n)
  return { label: DOW_LONG[d], shops: list.slice(0, limit).map(s => ({ name: s.name, pct: s.top[0].pct })) }
}

/** Monday: 📞 quiet shops to Mark + Jayden; 💳 cash this week + late-for-them to Mark only. Cliq DMs. */
export function mondayLines(rec) {
  const c = rec?.company || {}
  const quiet = (c.quiet || []).slice(0, 6).map(q => `• *${q.name}* · ${q.days} days, usually every ${Math.max(1, Math.round(rec.shops[q.id]?.gap || 0))}d (${q.usual.join('/')}) · ~${fmtUSD(q.worth)} missed`)
  const call = quiet.length ? ['📞 *Call these. They went quiet on their usual days:*', ...quiet] : ['📞 No regular shop has gone quiet. Nice.']
  const cash = c.cash ? [
    `💳 *Cash likely this week: ${fmtUSD(c.cash.thisWeek)}*${c.cash.week.length ? ` (${c.cash.week.slice(0, 4).map(w => `${w.name} ${fmtUSD(w.amount)}`).join(', ')})` : ''}`,
    ...(c.cash.late.length ? ['⏰ *Late for them (chase these):*', ...c.cash.late.slice(0, 6).map(l => `• *${l.name}* · ${fmtUSD(l.amount)} · ${l.daysLate} days past when they usually pay (~${l.median}d)`)] : []),
  ] : []
  return { call, cash }
}
async function sendMondayList(req, rec) {
  const { call, cash } = mondayLines(rec)
  const { postToCliqUser, TECH_CLIQ_IDS } = await import('./cliq.js')
  await postToCliqUser(TECH_CLIQ_IDS.Mark, ['🗓 *Monday list*', ...call, '', ...cash].join('\n'))
  await postToCliqUser(TECH_CLIQ_IDS.Jayden, ['🗓 *Monday list*', ...call].join('\n')).catch(e => console.warn('[shop-rhythm] jayden dm', e.message))
  return { quiet: rec.company?.quiet?.length || 0, late: rec.company?.cash?.late?.length || 0 }
}
