// 🏆 Sales records + 🎯 goal pop-ins for the GET SOME meeting (Mark 2026-10-24:
// "keeps track of monthly records, weekly records, technician monthly records
// for sales … and the morning meeting numbers as we hit those goals I want us
// to pop in"; weeks run Monday–Sunday; only in the morning meeting).
//
// Same numbers as the meeting: invoiced after discount by invoice date, voids
// and drafts out. Company = minus the Remote Expert charge. Techs = minus
// Cal ID / pass-through and Remote Expert (salesBasis.techCutter).
//
// Records (best day / week / month, most cars in a day / week, each tech's best
// day / week / month) are checked through yesterday. A record set by a week or
// month still in progress pops once for that period; later days raise the
// number quietly. Goals pop the morning after they're crossed, once a month.
// The first run only records what stands today. DurableKV: sales_records (the
// book) and huddle_pops:<date> (what that morning's meeting shows, fixed once made).
import catalyst from 'zcatalyst-sdk-node'
import { kvGet, kvSet } from './durableKV.js'

const KEY = 'sales_records'
const app = req => catalyst.initialize(req)
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const mondayOf = iso => addDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7))
const fmtUSD = n => `$${Math.round(n).toLocaleString('en-US')}`
const dayLabel = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const weekLabel = mon => `week of ${new Date(`${mon}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
const monthLabel = ym => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export async function readRecords(req) { try { const v = await kvGet(app(req), KEY); return v ? JSON.parse(v) : null } catch { return null } }

// Best period per record key, through `through` (inclusive).
async function standings(req, through) {
  const { invoicedRows, techCutter, SALES_SINCE } = await import('./salesBasis.js')
  const { rosterFromDirectory, invoiceBelongsToTech } = await import('../routes/dailyGreeting.js')
  const { remoteExpertFeesByInvoice, remoteExpertCut } = await import('./remoteExpert.js')
  const invoices = (await invoicedRows(SALES_SINCE, through)).filter(i => i.date && i.date <= through)
  const roster = (await rosterFromDirectory(req)).filter(r => r.type === 'tech')
  const reFees = await remoteExpertFeesByInvoice(req).catch(() => ({}))
  const techCut = await techCutter(req, invoices).catch(() => () => 0)
  const sums = {}   // key → { period → value }
  const add = (key, period, v) => { const m = sums[key] = sums[key] || {}; m[period] = (m[period] || 0) + v }
  for (const inv of invoices) {
    const total = Number(inv.total) || 0
    const co = total - remoteExpertCut(reFees, inv.invoice_number, total)
    const d = inv.date, w = mondayOf(d), ym = d.slice(0, 7)
    add('co_day', d, co); add('co_week', w, co); add('co_month', ym, co)
    if (total > 0) { add('cars_day', d, 1); add('cars_week', w, 1) }
    for (const r of roster) {
      if (!invoiceBelongsToTech(inv, r.name)) continue
      const t = total - techCut(inv)
      add(`tech:${r.name}:day`, d, t); add(`tech:${r.name}:week`, w, t); add(`tech:${r.name}:month`, ym, t)
    }
  }
  const best = {}
  for (const [key, m] of Object.entries(sums)) {
    let top = null
    for (const [period, value] of Object.entries(m)) if (!top || value > top.value + 0.005) top = { period, value: Math.round(value * 100) / 100 }
    if (top) best[key] = top
  }
  return best
}

function describe(key, rec, old) {
  const [kind, name, span] = key.startsWith('tech:') ? ['tech', ...key.slice(5).split(':')] : ['co', '', key]
  const money = !span.startsWith('cars')
  const v = money ? fmtUSD(rec.value) : `${rec.value} cars`
  const was = old ? ` (old record ${money ? fmtUSD(old.value) : `${old.value}`})` : ''
  const unit = span.endsWith('day') ? 'day' : span.endsWith('week') ? 'week' : 'month'
  const when = unit === 'day' ? dayLabel(rec.period) : unit === 'week' ? weekLabel(rec.period) : monthLabel(rec.period)
  const what = kind === 'tech' ? `${name}'s best ${unit} ever` : span.startsWith('cars') ? `Most cars in a ${unit}` : `Best ${unit} ever`
  return { kind: 'record', text: `NEW RECORD · ${what}: ${v}`, sub: `${when}${was}` }
}

/**
 * This morning's pop-ins. `data` = the meeting numbers (goal, mtd, techs).
 * live=false (any date that isn't today) previews without saving anything.
 */
export async function huddlePops(req, data, { live = false } = {}) {
  const dateStr = data.dateStr
  const a = app(req)
  if (live) { try { const v = await kvGet(a, `huddle_pops:${dateStr}`); if (v) return JSON.parse(v) } catch { /* build */ } }
  const st = (await readRecords(req)) || { seeded: false, records: {}, announced: [] }
  const announced = new Set(st.announced || [])
  const pops = []
  // Records through yesterday, worked out by the early-morning job (maybeRefreshStandings)
  // so the meeting itself stays fast. A preview works them out on the spot.
  let best = null
  try { const v = await kvGet(a, `sales_standings:${dateStr}`); if (v) best = JSON.parse(v) } catch { /* none */ }
  if (!best && !live) best = await standings(req, addDays(dateStr, -1))
  best = best || {}
  for (const [key, rec] of Object.entries(best)) {
    const old = st.records[key]
    if (!st.seeded || !old) { st.records[key] = { ...rec, set_on: dateStr }; continue }
    if (rec.value <= old.value + 0.5) continue
    st.records[key] = { ...rec, set_on: dateStr, beat: old.value }
    const tag = `rec:${key}:${rec.period}`
    if (announced.has(tag)) continue
    announced.add(tag)
    pops.push(describe(key, rec, old.period === rec.period ? null : old))
  }
  // Goals crossed (meeting numbers), once a month each.
  const ym = dateStr.slice(0, 7)
  const goalPop = (tag, text, sub) => { if (announced.has(tag)) return; announced.add(tag); pops.push({ kind: 'goal', text, sub }) }
  if (data.goal > 0 && data.mtd >= data.goal) goalPop(`goal:co:${ym}`, `GOAL HIT · The company passed ${fmtUSD(data.goal)} for ${data.monthLabel}`, `${fmtUSD(data.mtd)} so far`)
  for (const t of data.techs || []) {
    if (t.goal > 0 && t.mtd >= t.goal) goalPop(`goal:${t.name}:${ym}`, `GOAL HIT · ${t.name} passed ${fmtUSD(t.goal)} for ${data.monthLabel}`, `${fmtUSD(t.mtd)} so far`)
    if (/^mark\b/i.test(t.name)) continue   // the revenue bonus is the techs' (Jayden's letter), not Mark's
    if (t.mtd >= 55000) goalPop(`bonus55:${t.name}:${ym}`, `🔥 ${t.name} passed $55,000. The 8% bonus is on`, `${fmtUSD(t.mtd)} for ${data.monthLabel}`)
    else if (t.mtd >= 40000) goalPop(`bonus40:${t.name}:${ym}`, `🔥 ${t.name} passed $40,000. The bonus is on`, `${fmtUSD(t.mtd)} for ${data.monthLabel}`)
  }
  if (!live) return pops
  // Day one (first time standings exist): the book is written, nothing pops.
  if (!st.seeded && Object.keys(best).length) { st.seeded = true; st.seeded_on = dateStr; pops.length = 0 }
  st.announced = [...announced].slice(-500)
  await kvSet(a, KEY, JSON.stringify(st))
  await kvSet(a, `huddle_pops:${dateStr}`, JSON.stringify(pops))
  return pops
}

/** Once a PT day from 4 AM: the record standings through yesterday, ready for the 7:30 meeting. */
export async function maybeRefreshStandings(req, { force = false } = {}) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
  const today = fmt.format(new Date())
  const hourPT = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date()))
  if (!force && hourPT < 4) return { fired: false, reason: 'before-window' }
  const a = app(req), key = `sales_standings:${today}`
  if (!force && await kvGet(a, key).catch(() => null)) return { fired: false, reason: 'already' }
  const best = await standings(req, addDays(today, -1))
  await kvSet(a, key, JSON.stringify(best))
  return { fired: true, keys: Object.keys(best).length }
}
