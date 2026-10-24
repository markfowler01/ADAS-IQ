// 🔥 GET SOME! Meeting (Mark 2026-10-06, his name for it): "a morning meeting at 7:50 every morning —
// get everybody in the headspace of Absolute ADAS and growth. Email me a graphic I
// can share in a video meeting: individual monthly sales goals and our schedule
// for the day. Branded Absolute ADAS, looks really cool, every single day."
//
// One 1920×1080 PNG (video-share size): a real van photo under a dark brand wash,
// the month's company number vs goal with a pace tick, every tech's own goal bar,
// today's schedule by tech, and the growth line of the day. Emailed to Mark at
// 7:30 PT ("I'm gonna start it early and have the music going") as an attachment
// + inline, once per day. Fonts: Inter + Playfair embedded in the SVG (same
// approach as tipImageComposite / absoluteAdCardImage) so it renders identically
// on Catalyst's bare Linux.
import sharp from 'sharp'
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.join(__dirname, '..', 'assets')
const W = 1920, H = 1080
const ORANGE = '#CD4419'
const MARK_TO = 'mf@absoluteadas.com'
const MARK_CC = 'mfowler4456@gmail.com'
const SENT_PREFIX = 'huddle_sent:'
const PHOTO_ROTATION_KEY = 'huddle_photo_rotation'
export const HUDDLE_WINDOW = { startH: 7, startM: 35, endH: 8, endM: 55 }   // never before 07:35 PT; piggyback stops at 08:55 (meeting moved to 8:00, Mark 2026-10-12)

// ── time helpers (PT) ─────────────────────────────────────────────────────────
const ptParts = (d = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'long' }).formatToParts(d).map(p => [p.type, p.value]))
export function todayPT(d = new Date()) { const p = ptParts(d); return `${p.year}-${p.month}-${p.day}` }
export function nowPT() { const p = ptParts(); return { h: Number(p.hour) % 24, m: Number(p.minute), weekday: p.weekday } }
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const businessDays = (startISO, endISO) => { let n = 0; for (let d = startISO; d <= endISO; d = addDays(d, 1)) { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); if (w !== 0 && w !== 6) n++ } return n }
const fmtUSD = n => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`
const fmtK = n => { const v = Math.round(Number(n) || 0); return v >= 10000 ? `$${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k` : fmtUSD(v) }
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s }

// Growth line of the day — brand voice, short, no exclamation marks except the
// team sign-off. Rotates by day of year so it is never the same two days running.
const GROWTH_LINES = [
  'The Absolute Promise: every calibration we recommend, the shop gets paid for.',
  'Same day. Done right. That is the whole pitch, and we keep it every single car.',
  'Growth is a shop that calls us twice. Earn the second call today.',
  'Every pre-scan is a conversation with the estimator. Have it.',
  'We are not a vendor. We are the shop\'s ADAS department.',
  'Photos, report, invoice, same day. The paperwork is the product too.',
  'The van that shows up on time is the van that gets the next call.',
  'Nobody out-prepares us. Read the estimate before you open the door.',
  'A clean scan report is a sales call the shop forwards to the insurer.',
  'One more shop this month. That is how $30 million gets built.',
  'Find the calibration the estimate missed. That is where the margin lives.',
  'Leave every shop knowing exactly what we did and why.',
  'Speed is a feature. Accuracy is the brand.',
  'Treat the smallest shop like the biggest account.',
]
export function growthLine(dateISO) { const d = new Date(`${dateISO}T12:00:00Z`); const doy = Math.floor((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 0))) / 86400000); return GROWTH_LINES[doy % GROWTH_LINES.length] }

// ── per-tech goals (Mark sets; AppConfig `huddle_tech_goals` = {"Jayden": 20000}) ──
async function readTechGoals(req) {
  try {
    const r = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery("SELECT config_value FROM AppConfig WHERE config_key = 'huddle_tech_goals' LIMIT 1")
    return JSON.parse(r?.[0]?.AppConfig?.config_value || '{}') || {}
  } catch { return {} }
}

// ── data ─────────────────────────────────────────────────────────────────────
export async function buildHuddleData(req, { dateStr = todayPT() } = {}) {
  const year = Number(dateStr.slice(0, 4)), monthStart = `${dateStr.slice(0, 7)}-01`
  const monthEnd = (() => { const d = new Date(Date.UTC(year, Number(dateStr.slice(5, 7)), 0)); return d.toISOString().slice(0, 10) })()
  const yesterday = addDays(dateStr, -1)
  // 📅 "Yesterday" = the last working day (Mark 2026-10-21: daily sales + jobs from
  // the day before). On a Monday that's Friday, with any weekend work rolled in.
  const isWeekend = iso => { const w = new Date(`${iso}T12:00:00Z`).getUTCDay(); return w === 0 || w === 6 }
  let lastStart = yesterday; while (isWeekend(lastStart)) lastStart = addDays(lastStart, -1)
  const lastEnd = yesterday
  const lastLabel = lastStart === lastEnd ? 'Yesterday' : new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${lastStart}T12:00:00Z`))
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${dateStr}T12:00:00Z`))
  const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' }).format(new Date(`${dateStr}T12:00:00Z`))
  const monthLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long' }).format(new Date(`${dateStr}T12:00:00Z`))

  const { getMonthlyGoal } = await import('./paceConfig.js')
  const { fetchCostByDay, sumRange } = await import('./salesRollup.js')
  const goal = (await getMonthlyGoal(req)).goal
  let byDay = {}, lastYearByDay = {}
  try { byDay = (await fetchCostByDay(req, { year }))?.byDay || {} } catch (e) { console.warn('[huddle] rollup:', e.message) }
  try { lastYearByDay = (await fetchCostByDay(req, { year: year - 1 }))?.byDay || {} } catch { /* first year */ }
  const mtd = sumRange(byDay, monthStart, dateStr)
  const yesterdaySales = sumRange(byDay, lastStart, lastEnd)
  const last7 = sumRange(byDay, addDays(dateStr, -7), yesterday), last30 = sumRange(byDay, addDays(dateStr, -30), yesterday)
  const ytd = sumRange(byDay, `${year}-01-01`, dateStr)
  const lastYtd = sumRange(lastYearByDay, `${year - 1}-01-01`, `${year - 1}${dateStr.slice(4)}`)
  const growthPct = lastYtd > 0 ? Math.round(((ytd - lastYtd) / lastYtd) * 100) : null
  const bizDone = businessDays(monthStart, yesterday), bizTotal = businessDays(monthStart, monthEnd), bizLeft = Math.max(0, bizTotal - bizDone)
  const pace = Math.round(goal * (bizDone / Math.max(1, bizTotal)))
  const perDayNeeded = bizLeft > 0 ? Math.max(0, goal - mtd) / bizLeft : 0

  // Techs from the Directory roster + their own goals and MTD sales (invoice salesperson).
  const { rosterFromDirectory, invoiceBelongsToTech } = await import('../routes/dailyGreeting.js')
  const { listInvoicesForDateRange } = await import('./zoho.js')
  const roster = (await rosterFromDirectory(req)).filter(r => r.type === 'tech')
  const goals = await readTechGoals(req)
  let invoices = []
  const fetchFrom = lastStart < monthStart ? lastStart : monthStart
  try { invoices = await listInvoicesForDateRange(fetchFrom, dateStr) } catch (e) { console.warn('[huddle] invoices:', e.message) }
  // Remote Expert is paid to the vendor and is not our sales. Take the matched
  // charge off the invoice it belongs to. Pre-scans and post-scans stay in.
  let reFees = {}
  try { const { remoteExpertFeesByInvoice } = await import('./remoteExpert.js'); reFees = await remoteExpertFeesByInvoice(req) } catch (e) { console.warn('[huddle] remote expert', e.message) }
  const { remoteExpertCut } = await import('./remoteExpert.js')
  const cutOf = inv => remoteExpertCut(reFees, inv.invoice_number, inv.total)
  // Tech bars also drop Cal ID / pass-through lines (Mark 2026-10-22). Company totals keep them.
  let techCut = inv => cutOf(inv)
  try { const { techCutter } = await import('./salesBasis.js'); techCut = await techCutter(req, invoices) } catch (e) { console.warn('[huddle] tech cut', e.message) }
  let reMtd = 0, reYest = 0, re7 = 0, re30 = 0, reYtd = 0
  const last7Start = addDays(dateStr, -7), last30Start = addDays(dateStr, -30), yearStart = `${year}-01-01`
  for (const inv of invoices) {
    const c = cutOf(inv); if (!c) continue
    const d = String(inv.date || '').slice(0, 10)
    if (d >= monthStart && d <= dateStr) reMtd += c
    if (d >= lastStart && d <= lastEnd) reYest += c
    if (d >= last7Start && d <= yesterday) re7 += c
    if (d >= last30Start && d <= yesterday) re30 += c
    if (d >= yearStart && d <= dateStr) reYtd += c
  }
  const perDay = {}
  for (const inv of invoices) { const d = String(inv.date || '').slice(0, 10); if (d >= monthStart && d <= dateStr && !/void|draft/i.test(String(inv.status || ''))) perDay[d] = (perDay[d] || 0) + 1 }
  const lastDayJobs = invoices.filter(inv => { const d = String(inv.date || '').slice(0, 10); return d >= lastStart && d <= lastEnd && !/void|draft/i.test(String(inv.status || '')) }).length
  const jobsMonth = Object.values(perDay).reduce((t, n) => t + n, 0)
  const avgPerJob = jobsMonth ? Math.round(mtd / jobsMonth) : 0
  // Weekdays, plus any Saturday/Sunday that had a car. weekStart marks the first
  // bar of each week so the chart shows a visible break where a weekend was.
  const days = []; let prevW = null
  for (let d = monthStart; d <= monthEnd; d = addDays(d, 1)) {
    const w = new Date(`${d}T12:00:00Z`).getUTCDay(), wk = w === 0 || w === 6
    if (wk && !perDay[d]) continue
    const weekStart = prevW != null && (w === 1 || (w !== 0 && w < prevW) || (w === 6 && prevW === 6))
    days.push({ d, n: perDay[d] || 0, past: d <= yesterday, today: d === dateStr, weekend: wk, weekStart })
    prevW = w === 0 ? 7 : w
  }
  const share = roster.length ? Math.round(goal / roster.length / 500) * 500 : goal
  const techs = roster.map(r => {
    let m = 0, y = 0
    for (const inv of invoices) { if (!invoiceBelongsToTech(inv, r.name)) continue; const t = (Number(inv.total) || 0) - techCut(inv); const d = String(inv.date || '').slice(0, 10); if (d >= monthStart && d <= dateStr) m += t; if (d >= lastStart && d <= lastEnd) y += t }
    const g = Number(goals[r.name]) || share
    return { name: r.name, mtd: Math.round(m), yesterday: Math.round(y), goal: g, pct: Math.min(100, Math.round((m / Math.max(1, g)) * 100)) }
  }).sort((a, b) => b.mtd - a.mtd)

  // Today's schedule by tech.
  const { readJobsPublic } = await import('../routes/jobs.js')
  const ACTIVE = new Set(['need_dispatch', 'dispatched_mark', 'dispatched_jaden', 'pending_parts', 'scheduled', 'confirmed', 'en_route', 'in_progress'])
  let jobs = []
  try { jobs = (await readJobsPublic(req)).filter(j => String(j.scheduled_date || '').slice(0, 10) === dateStr && (ACTIVE.has(j.status) || /dispatch|sched|confirm|progress|route|pending/.test(String(j.status)))) } catch (e) { console.warn('[huddle] jobs:', e.message) }
  const byTech = {}
  for (const j of jobs) {
    const key = (j.technician || 'Unassigned').trim() || 'Unassigned'
    let cals = 0; try { cals = (JSON.parse(j.calibrations || '[]') || []).filter(c => c.enabled !== false).length } catch { /* fine */ }
    ;(byTech[key] = byTech[key] || []).push({ shop: j.shop_name || 'Shop', vehicle: j.vehicle || [j.year, j.make, j.model].filter(Boolean).join(' '), region: j.region || '', cals, status: j.status })
  }
  const schedule = Object.entries(byTech).sort((a, b) => (a[0] === 'Unassigned') - (b[0] === 'Unassigned') || a[0].localeCompare(b[0])).map(([tech, list]) => ({ tech, jobs: list }))

  // 📅 Shops that usually call on this weekday (services/shopRhythm.js, Mark 2026-10-24: "better predict my weeks").
  let calls = { label: '', shops: [] }
  try { const R = await import('./shopRhythm.js'); calls = R.usuallyCallOn(await R.readRhythm(req), dateStr, 4) } catch (e) { console.warn('[huddle] rhythm:', e.message) }
  const mtdNet = Math.round(mtd - reMtd), ytdNet = Math.round(ytd - reYtd)
  const growthNet = lastYtd > 0 ? Math.round(((ytdNet - lastYtd) / lastYtd) * 100) : null
  const perDayNet = bizLeft > 0 ? Math.max(0, goal - mtdNet) / bizLeft : 0
  return { lastLabel, lastStart, lastEnd, lastDayJobs, dateStr, weekday, dateLabel, monthLabel, goal, mtd: mtdNet, last7: Math.round(last7 - re7), last30: Math.round(last30 - re30), jobsMonth, avgPerJob: jobsMonth ? Math.round(mtdNet / jobsMonth) : 0, jobsPerDay: jobsMonth ? Math.round((jobsMonth / Math.max(1, bizDone)) * 10) / 10 : 0, days, pct: Math.min(100, Math.round((mtdNet / Math.max(1, goal)) * 100)), pace, pacePct: Math.min(100, Math.round((pace / Math.max(1, goal)) * 100)), ahead: mtdNet - pace, yesterdaySales: Math.round(yesterdaySales - reYest), bizDone, bizTotal, bizLeft, perDayNeeded: Math.round(perDayNet), ytd: ytdNet, lastYtd, growthPct: growthNet, techs, schedule, jobsToday: jobs.length, calls, line: growthLine(dateStr) }
}

// ── render ───────────────────────────────────────────────────────────────────
let _fonts = null
async function fonts() {
  if (_fonts) return _fonts
  const [ib, ir, pf, mk, logo] = await Promise.all(['fonts/Inter-Bold.ttf', 'fonts/Inter-Regular.ttf', 'fonts/PlayfairDisplay-Bold.ttf', 'fonts/PermanentMarker-Regular.ttf', 'absolute-adas-logo.png'].map(f => fs.readFile(path.join(ASSETS, f))))
  _fonts = { ib: ib.toString('base64'), ir: ir.toString('base64'), pf: pf.toString('base64'), mk: mk.toString('base64'), logo: logo.toString('base64') }
  return _fonts
}

async function background(req) {
  // Real van photo from the WorkDrive library (rotates daily); fallback = brand gradient.
  try {
    const { pickNextVanPhotoDatastore } = await import('./vanPhotoLibrary.js')
    const photo = await pickNextVanPhotoDatastore(req, PHOTO_ROTATION_KEY)
    if (photo?.buffer) {
      return await sharp(photo.buffer).rotate().resize(W, H, { fit: 'cover', position: 'right' }).modulate({ brightness: 0.8, saturation: 0.95 }).jpeg({ quality: 88 }).toBuffer()
    }
  } catch (e) { console.warn('[huddle] van photo:', e.message) }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a1a1a"/><stop offset="1" stop-color="#2b1a14"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

function bar(x, y, w, h, pct, { tickPct = null, color = ORANGE, track = 'rgba(255,255,255,0.14)' } = {}) {
  const fill = Math.max(0, Math.min(w, Math.round(w * (pct / 100))))
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${track}"/>` +
    (fill > 0 ? `<rect x="${x}" y="${y}" width="${Math.max(fill, h)}" height="${h}" rx="${h / 2}" fill="${color}"/>` : '') +
    (tickPct != null ? `<rect x="${x + Math.round(w * (Math.min(100, tickPct) / 100)) - 2}" y="${y - 8}" width="4" height="${h + 16}" rx="2" fill="white"/>` : '')
}

export async function renderHuddlePng(req, data) {
  const f = await fonts()
  const d = data
  const ahead = d.ahead >= 0
  // Mark's mock (2026-10-06): dark glass cards on the left, van alive on the right,
  // orange diagonal accents, big wordmark with the service line, orange footer band.
  const card = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="rgba(8,10,14,0.82)" stroke="rgba(255,255,255,0.1)" stroke-width="2"/>`
  const ICON = {
    cal: (x, y, s = 36) => `<g transform="translate(${x},${y}) scale(${s / 36})" fill="none" stroke="${ORANGE}" stroke-width="3.2" stroke-linecap="round"><rect x="3" y="6" width="30" height="27" rx="4"/><path d="M3 14h30M11 2v8M25 2v8"/><path d="M10 21h4M16 21h4M22 21h4M10 27h4M16 27h4" stroke-width="3"/></g>`,
    target: (x, y, s = 36) => `<g transform="translate(${x},${y}) scale(${s / 36})" fill="none" stroke="${ORANGE}" stroke-width="3.2"><circle cx="18" cy="18" r="15"/><circle cx="18" cy="18" r="9"/><circle cx="18" cy="18" r="3" fill="${ORANGE}"/><path d="M18 3V0M33 18h3" stroke-linecap="round"/></g>`,
    people: (x, y, s = 36) => `<g transform="translate(${x},${y}) scale(${s / 36})" fill="${ORANGE}"><circle cx="13" cy="11" r="6"/><circle cx="26" cy="13" r="5"/><path d="M2 32c0-7 5-11 11-11s11 4 11 11z"/><path d="M22 32c0-5 2-9 5-10 5 0 9 4 9 10z" opacity="0.75"/></g>`,
    clip: (x, y, s = 36) => `<g transform="translate(${x},${y}) scale(${s / 36})" fill="none" stroke="${ORANGE}" stroke-width="3.2" stroke-linecap="round"><rect x="5" y="6" width="26" height="28" rx="4"/><rect x="12" y="2" width="12" height="7" rx="2" fill="rgba(8,10,14,1)"/><path d="M11 18h14M11 25h10"/></g>`,
    trend: (x, y, s = 36) => `<g transform="translate(${x},${y}) scale(${s / 36})" fill="none" stroke="${ORANGE}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 30l9-11 7 6 14-17"/><path d="M24 8h9v9"/></g>`,
    bars: (x, y, s = 36) => `<g transform="translate(${x},${y}) scale(${s / 36})" fill="${ORANGE}"><rect x="3" y="20" width="7" height="14" rx="2"/><rect x="14" y="10" width="7" height="24" rx="2"/><rect x="25" y="3" width="7" height="31" rx="2"/></g>`,
  }
  const L = 52
  // ── Card 1: THE MONTH ─────────────────────────────────────────────────────
  const c1 = { x: L, y: 168, w: 930, h: 356 }
  // Yesterday's sales + cars (Mark 2026-10-21), then last 7 / last 30. Widths are
  // estimated for 22px Inter so the three tiles never collide.
  const jobsTxt = d.lastDayJobs != null ? ` · ${d.lastDayJobs} ${d.lastDayJobs === 1 ? 'job' : 'jobs'}` : ''
  const stats = [[d.lastLabel || 'Yesterday', `${fmtUSD(d.yesterdaySales)}${jobsTxt}`], ['Last 7', fmtUSD(d.last7)], ['Last 30', fmtUSD(d.last30)]]
  const tileW = ([k, v]) => Math.round(k.length * 12.2 + 14 + String(v).length * 13.6)
  const month = `
    ${card(c1.x, c1.y, c1.w, c1.h)}
    ${ICON.cal(c1.x + 30, c1.y + 24)}
    <text x="${c1.x + 84}" y="${c1.y + 54}" class="ch">THE MONTH <tspan class="dot">•</tspan> ${esc(d.monthLabel.toUpperCase())}</text>
    <text x="${c1.x + 30}" y="${c1.y + 170}" class="huge">${esc(fmtUSD(d.mtd))}</text>
    ${bar(c1.x + 30, c1.y + 196, 450, 20, d.pct, { tickPct: d.pacePct })}
    <text x="${c1.x + 30}" y="${c1.y + 256}" class="body2" style="fill:${ahead ? '#4ade80' : '#fca5a5'}">${ahead ? '▲' : '▼'}</text><text x="${c1.x + 66}" y="${c1.y + 256}" class="body2">${esc(fmtUSD(Math.abs(d.ahead)))} <tspan class="w400">${ahead ? 'ahead of' : 'behind'} pace</tspan></text>
    <rect x="${c1.x + 520}" y="${c1.y + 40}" width="2" height="226" fill="rgba(255,255,255,0.14)"/>
    ${ICON.target(c1.x + 548, c1.y + 42)}
    <text x="${c1.x + 598}" y="${c1.y + 70}" class="ch" style="fill:rgba(255,255,255,0.6)">GOAL</text>
    <text x="${c1.x + 548}" y="${c1.y + 150}" class="big2" style="font-size:54px">${esc(fmtUSD(d.goal))}</text>
    <text x="${c1.x + c1.w - 36}" y="${c1.y + 150}" class="big2" text-anchor="end" style="fill:${ORANGE};font-size:54px">${d.pct}%</text>
    <text x="${c1.x + 548}" y="${c1.y + 212}" class="body2 w400">${d.bizLeft} working day${d.bizLeft === 1 ? '' : 's'} left</text>
    <text x="${c1.x + 548}" y="${c1.y + 250}" class="body2 w400" style="font-style:italic;fill:rgba(255,255,255,0.78)">${esc(fmtUSD(d.perDayNeeded))}/day closes the month</text>
    <rect x="${c1.x + 30}" y="${c1.y + 282}" width="${c1.w - 60}" height="1.5" fill="rgba(255,255,255,0.14)"/>
    ${ICON.trend(c1.x + 30, c1.y + 300, 30)}
    ${(() => { let sx = c1.x + 96; return stats.map(([k, v], i) => { const out = `${i ? `<rect x="${sx - 22}" y="${c1.y + 300}" width="2" height="30" fill="rgba(255,255,255,0.2)"/>` : ''}<text x="${sx}" y="${c1.y + 324}" class="stat" style="font-size:22px"><tspan class="w400" style="fill:rgba(255,255,255,0.75)">${esc(k)}</tspan>  ${esc(v)}</text>`; sx += tileW([k, v]) + 44; return out }).join('') })()}`
  // ── Card 2: INDIVIDUAL GOALS ──────────────────────────────────────────────
  const techs = d.techs.slice(0, 4)
  const c2 = { x: L, y: 542, w: 930, h: 206 }
  const tw = techs.length ? Math.floor((c2.w - 40 - 16 * (techs.length - 1)) / techs.length) : c2.w - 40
  const techCards = techs.map((t, i) => {
    const tx = c2.x + 20 + i * (tw + 16), ty = c2.y + 60, th = c2.h - 80
    return `<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="16" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)"/>
      <text x="${tx + 20}" y="${ty + 42}" class="tname">${esc(clip(t.name, 12))}</text>
      <text x="${tx + tw - 20}" y="${ty + 42}" class="stat" text-anchor="end">${esc(fmtK(t.mtd))} <tspan class="w400" style="fill:rgba(255,255,255,0.7)">of ${esc(fmtK(t.goal))}</tspan></text>
      ${bar(tx + 20, ty + 60, tw - 110, 14, t.pct, { color: t.pct >= 100 ? '#4ade80' : ORANGE })}
      <text x="${tx + tw - 20}" y="${ty + 74}" class="stat" text-anchor="end" style="fill:${ORANGE}">${t.pct}%</text>
      <text x="${tx + 20}" y="${ty + 108}" class="small2"><tspan style="fill:${ORANGE}">▼</tspan> Yesterday ${t.yesterday ? esc(fmtUSD(t.yesterday)) : '—'}</text>`
  }).join('')
  const goals = `${card(c2.x, c2.y, c2.w, c2.h)}${ICON.people(c2.x + 30, c2.y + 18)}<text x="${c2.x + 84}" y="${c2.y + 46}" class="ch" style="fill:white">INDIVIDUAL GOALS</text>${techCards}`
  // ── Card 3: TODAY ─────────────────────────────────────────────────────────
  const c3 = { x: 1012, y: 168, w: 856 }
  const MAX = 8
  let rows = [], n = 0
  for (const g of d.schedule) {
    if (n >= MAX) break
    rows.push({ h: true, text: `${g.tech.toUpperCase()}  ·  ${g.jobs.length} ${g.jobs.length === 1 ? 'car' : 'cars'}` }); n++
    for (const j of g.jobs) { if (n >= MAX) { rows.push({ more: true }); break } rows.push({ job: j }); n++ }
  }
  const rowH = r => r.h ? 40 : r.more ? 34 : 62
  const listH = rows.reduce((t, r) => t + rowH(r), 0)
  const callsTxt = d.calls?.shops?.length ? `Usually call on ${d.calls.label}: ${d.calls.shops.slice(0, 3).map(x => clip(String(x.name).replace(/\s+(collision repair|body shop|auto body|inc|llc)\b.*$/i, '').trim(), 20)).join(' · ')}` : ''
  c3.h = Math.max(222, 130 + (rows.length ? listH + 10 : 80)) + (callsTxt ? 46 : 0)
  let yy = c3.y + 128, list = ''
  if (!rows.length) list = `${ICON.clip(c3.x + 30, c3.y + 128, 30)}<text x="${c3.x + 76}" y="${c3.y + 152}" class="body2">Nothing on the board yet for today.</text><text x="${c3.x + 76}" y="${c3.y + 184}" class="small2" style="font-style:italic">Open jobs land here as they are scheduled.</text>`
  else for (const r of rows) {
    if (r.h) { list += `<text x="${c3.x + 30}" y="${yy + 28}" class="ch" style="font-size:22px">${esc(r.text)}</text>` }
    else if (r.more) { list += `<text x="${c3.x + 30}" y="${yy + 24}" class="small2">+ more on the board</text>` }
    else { list += `<text x="${c3.x + 40}" y="${yy + 26}" class="body2">${esc(clip(r.job.shop, 34))}</text><text x="${c3.x + 40}" y="${yy + 52}" class="small2">${esc(clip(r.job.vehicle, 40))}${r.job.cals ? ` · ${r.job.cals} cal${r.job.cals === 1 ? '' : 's'}` : ''}${r.job.region ? ` · ${esc(r.job.region)}` : ''}</text>` }
    yy += rowH(r)
  }
  if (callsTxt) list += `<rect x="${c3.x + 30}" y="${c3.y + c3.h - 52}" width="${c3.w - 60}" height="1.5" fill="rgba(255,255,255,0.18)"/><text x="${c3.x + 30}" y="${c3.y + c3.h - 20}" class="small2" style="fill:white">${esc(clip(callsTxt, 78))}</text>`
  const today = `${card(c3.x, c3.y, c3.w, c3.h)}${ICON.cal(c3.x + 30, c3.y + 26)}<text x="${c3.x + 84}" y="${c3.y + 48}" class="ch" style="font-size:30px;fill:${ORANGE}">TODAY</text><text x="${c3.x + 84}" y="${c3.y + 76}" class="ch" style="font-size:19px">${d.jobsToday} ${d.jobsToday === 1 ? 'CAR' : 'CARS'} ON THE BOARD</text><text x="${c3.x + 84}" y="${c3.y + 118}" class="sched">The schedule</text>${list}`
  // ── Card 4: JOBS DONE (per-day bars) — below TODAY when there is room ──────
  const c4 = { x: 1012, y: c3.y + c3.h + 18, w: 856, h: 214 }
  let jobsCard = ''
  if (c4.y + c4.h < H - 200) {
    const days = d.days || [], maxN = Math.max(1, ...days.map(x => x.n))
    const gap = 6, wkGap = 14, breaks = days.filter(x => x.weekStart).length, inner = c4.w - 60
    const bw = Math.max(8, Math.floor((inner - gap * (days.length - 1) - wkGap * breaks) / Math.max(1, days.length)))
    let off = 0; const xs = days.map(x => { if (x.weekStart) off += wkGap; const v = off; return v })
    const chartH = 60, baseY = c4.y + 106 + chartH   // top-of-bar numbers clear the stat line
    jobsCard = `${card(c4.x, c4.y, c4.w, c4.h)}${ICON.bars(c4.x + 30, c4.y + 18, 30)}<text x="${c4.x + 76}" y="${c4.y + 42}" class="ch" style="fill:white">JOBS DONE <tspan class="dot">•</tspan> ${esc(d.monthLabel.toUpperCase())}</text>
      <text x="${c4.x + c4.w - 30}" y="${c4.y + 76}" class="stat" text-anchor="end">${d.jobsMonth} <tspan class="w400" style="fill:rgba(255,255,255,0.7)">cars</tspan>   ${esc(fmtUSD(d.avgPerJob))} <tspan class="w400" style="fill:rgba(255,255,255,0.7)">avg/car</tspan>   ${d.jobsPerDay} <tspan class="w400" style="fill:rgba(255,255,255,0.7)">/day</tspan></text>
      ${days.map((x, i) => { const bx = c4.x + 30 + i * (bw + gap) + xs[i]; const bh = x.n ? Math.max(6, Math.round(chartH * (x.n / maxN))) : 3; const col = x.today ? 'rgba(255,255,255,0.35)' : x.past ? (x.n ? (x.weekend ? '#f59e0b' : ORANGE) : 'rgba(255,255,255,0.16)') : 'rgba(255,255,255,0.07)'
        return `${x.weekStart ? `<rect x="${bx - (wkGap + gap) / 2 - 1}" y="${baseY - chartH}" width="1.5" height="${chartH + 30}" fill="rgba(255,255,255,0.18)"/>` : ''}<rect x="${bx}" y="${baseY - bh}" width="${bw}" height="${bh}" rx="3" fill="${col}"/>${x.n ? `<text x="${bx + bw / 2}" y="${baseY - bh - 6}" class="small2" text-anchor="middle" style="fill:white;font-weight:700;font-size:16px">${x.n}</text>` : ''}<text x="${bx + bw / 2}" y="${baseY + 24}" class="small2" text-anchor="middle" style="font-size:14px">${Number(x.d.slice(8))}</text>` }).join('')}`
  }
  // ── footer ────────────────────────────────────────────────────────────────
  const FY = H - 186
  const quote = (() => { const words = d.line.split(' '); const a = []; let line = ''; for (const w of words) { if ((line + ' ' + w).trim().length > 34 && a.length < 1) { a.push(line.trim()); line = w } else line = (line + ' ' + w) } a.push(line.trim()); return a.slice(0, 2) })()
  const footer = `
    <polygon points="0,${FY} 1080,${FY} 1000,${H} 0,${H}" fill="${ORANGE}"/>
    <polygon points="1080,${FY} 1130,${FY} 1050,${H} 1000,${H}" fill="rgba(255,255,255,0.35)"/>
    <rect x="1130" y="${FY}" width="${W - 1130}" height="${H - FY}" fill="rgba(8,10,14,0.86)"/>
    <circle cx="${L + 50}" cy="${FY + 93}" r="50" fill="#0e1014"/>${ICON.target(L + 24, FY + 67, 52).replace(/#CD4419/g, 'white')}
    <rect x="${L + 126}" y="${FY + 44}" width="2" height="98" fill="rgba(255,255,255,0.45)"/>
    ${quote.map((q, i) => `<text x="${L + 158}" y="${FY + 74 + i * 48}" class="quote">${esc(q)}</text>`).join('')}
    <text x="${L + 158}" y="${FY + 160}" class="ytd">YTD ${esc(fmtUSD(d.ytd))}  <tspan class="dot" style="fill:white">•</tspan>  ${d.growthPct != null ? `${d.growthPct >= 0 ? '+' : ''}${d.growthPct}% VS LAST YEAR  <tspan class="dot" style="fill:white">•</tspan>  ` : ''}$30M BY 2036</text>
    <text x="${W - 70}" y="${FY + 62}" class="ch" text-anchor="end" style="font-size:26px">SAME DAY. DONE RIGHT.</text>
    <text x="${W - 70}" y="${FY + 140}" class="getsome" text-anchor="end">GET SOME!!!</text>
    <path d="M${W - 470} ${FY + 158} C ${W - 380} ${FY + 150}, ${W - 200} ${FY + 150}, ${W - 70} ${FY + 156}" stroke="${ORANGE}" stroke-width="6" fill="none" stroke-linecap="round"/>`
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style>
      @font-face { font-family: 'Inter'; src: url(data:font/ttf;base64,${f.ib}) format('truetype'); font-weight: 700; }
      @font-face { font-family: 'Inter'; src: url(data:font/ttf;base64,${f.ir}) format('truetype'); font-weight: 400; }
      @font-face { font-family: 'Playfair'; src: url(data:font/ttf;base64,${f.pf}) format('truetype'); font-weight: 700; }
      @font-face { font-family: 'Marker'; src: url(data:font/ttf;base64,${f.mk}) format('truetype'); font-weight: 400; }
      text { fill: white; font-family: 'Inter', sans-serif; font-weight: 700; }
      .w400 { font-weight: 400; }
      .dot { fill: ${ORANGE}; }
      .wordmark { font-size: 92px; letter-spacing: -2px; }
      .service { font-size: 21px; letter-spacing: 6px; fill: rgba(255,255,255,0.92); }
      .meet { font-size: 26px; letter-spacing: 4px; fill: ${ORANGE}; }
      .daydate { font-size: 38px; letter-spacing: 2px; }
      .ch { font-size: 28px; letter-spacing: 2px; fill: ${ORANGE}; }
      .huge { font-size: 128px; letter-spacing: -3px; }
      .big2 { font-size: 54px; letter-spacing: -1px; }
      .body2 { font-size: 28px; }
      .stat { font-size: 24px; }
      .small2 { font-size: 20px; font-weight: 400; fill: rgba(255,255,255,0.78); }
      .tname { font-size: 30px; }
      .sched { font-size: 44px; }
      .quote { font-size: 40px; }
      .ytd { font-size: 22px; letter-spacing: 3px; fill: white; }
      .getsome { font-family: 'Permanent Marker', 'Marker', cursive; font-size: 92px; font-weight: 400; letter-spacing: 1px; }   /* Permanent Marker — Mark's yes 2026-10-06 */
    </style>
    <linearGradient id="wash" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(6,8,12,0.88)"/><stop offset="0.5" stop-color="rgba(6,8,12,0.7)"/><stop offset="1" stop-color="rgba(6,8,12,0.3)"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#wash)"/>
  <!-- diagonal brand accents -->
  <polygon points="1500,0 1920,0 1920,40 1560,150" fill="${ORANGE}" opacity="0.95"/>
  <polygon points="1430,0 1500,0 1560,150 1490,150" fill="rgba(255,255,255,0.18)"/>
  <!-- masthead -->
  <rect x="0" y="0" width="${W}" height="150" fill="rgba(6,8,12,0.78)"/>
  <image href="data:image/png;base64,${f.logo}" x="${L}" y="26" width="104" height="104"/>
  <text x="${L + 130}" y="94" class="wordmark">Absolute <tspan fill="${ORANGE}">ADAS</tspan></text>
  <text x="${L + 136}" y="130" class="service">CALIBRATION  <tspan class="dot">•</tspan>  DIAGNOSTICS  <tspan class="dot">•</tspan>  MOBILE SERVICE</text>
  <text x="${W - 70}" y="60" class="meet" text-anchor="end">GET SOME! MEETING  -  8:00</text>
  <text x="${W - 70}" y="106" class="daydate" text-anchor="end">${esc(d.weekday.toUpperCase())}  <tspan class="dot">•</tspan>  ${esc(d.dateLabel.toUpperCase())}</text>
  ${month}
  ${goals}
  ${today}
  ${jobsCard}
  ${footer}
</svg>`
  if (data?._svgOnly) return svg   // local preview without sharp
  const bg = await background(req)
  return sharp(bg).composite([{ input: Buffer.from(svg, 'utf-8'), top: 0, left: 0 }]).png({ compressionLevel: 8 }).toBuffer()
}

// ── hosting: WorkDrive + tokened public URL (renders inline in any mail client) ──
const PUBLIC_BASE = (process.env.TWILIO_WEBHOOK_BASE_URL || '').replace(/\/$/, '') || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'
async function huddleFolder(req, token) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const r = await app.zcql().executeZCQLQuery("SELECT config_value FROM AppConfig WHERE config_key = 'huddle_folder' LIMIT 1")
  const cached = r?.[0]?.AppConfig?.config_value; if (cached) return cached
  const { walkPath } = await import('./oemAttach.js'); const { createFolderUnder } = await import('./workdrive.js')
  const ops = await walkPath('', token); if (!ops) throw new Error('01_Ops folder not found')
  const f = await createFolderUnder(ops, 'GET SOME Meeting', token)
  const id = f?.folderId || f?.id || f
  if (id) await app.datastore().table('AppConfig').insertRow({ config_key: 'huddle_folder', config_value: String(id) }).catch(() => {})
  return String(id)
}
export async function hostHuddlePng(req, png, dateStr) {
  const { getAccessToken } = await import('./zoho.js'); const { uploadFileToFolder } = await import('./workdrive.js')
  const wd = await getAccessToken()
  const folderId = await huddleFolder(req, wd)
  const { fileId } = await uploadFileToFolder(folderId, `GET-SOME-Meeting-${dateStr}.png`, png, wd, 'image/png')
  const tok = [...Array(22)].map(() => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 54)]).join('')
  await catalyst.initialize(req, { type: 'advancedio' }).datastore().table('AppConfig').insertRow({ config_key: `huddle_img:${tok}`, config_value: String(fileId) })
  return { url: `${PUBLIC_BASE}/api/public/huddle/${tok}.png`, fileId, folderId }
}

// ── email ────────────────────────────────────────────────────────────────────
async function uploadMailAttachment(token, accountId, { name, buffer, contentType = 'image/png' }) {
  // Zoho Mail wants multipart (415 on a raw body, 2026-10-06): field "attach", ?uploadType=multipart
  const FormData = (await import('form-data')).default
  const form = new FormData(); form.append('attach', buffer, { filename: name, contentType })
  const r = await axios.post(`https://mail.zoho.com/api/accounts/${accountId}/messages/attachments`, form, { params: { fileName: name, uploadType: 'multipart' }, headers: { Authorization: `Zoho-oauthtoken ${token}`, ...form.getHeaders() }, maxBodyLength: Infinity, timeout: 30000 })
  const a = Array.isArray(r.data?.data) ? r.data.data[0] : r.data?.data
  if (!a?.storeName) throw new Error(`attachment upload: ${JSON.stringify(r.data).slice(0, 200)}`)
  return { storeName: a.storeName, attachmentPath: a.attachmentPath, attachmentName: a.attachmentName || name }
}

export async function sendHuddle(req, { force = false, to = MARK_TO, cc = MARK_CC } = {}) {
  const dateStr = todayPT(), { h, m, weekday } = nowPT()
  if (!force) {
    if (weekday === 'Saturday' || weekday === 'Sunday') return { skipped: 'weekend', dateStr }
    if (h * 60 + m < HUDDLE_WINDOW.startH * 60 + HUDDLE_WINDOW.startM) return { skipped: `before ${HUDDLE_WINDOW.startH}:${String(HUDDLE_WINDOW.startM).padStart(2, '0')} PT`, dateStr }
  }
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const stampKey = `${SENT_PREFIX}${dateStr}`
  if (!force) { const r = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = '${stampKey}' LIMIT 1`); if (r?.length) return { skipped: 'already sent today', dateStr } }
  await app.datastore().table('AppConfig').insertRow({ config_key: stampKey, config_value: new Date().toISOString() }).catch(() => {})   // claim first: never two emails
  try {
    const data = await buildHuddleData(req, { dateStr })
    const png = await renderHuddlePng(req, data)
    const { getMailAccessToken, getMailAccountId, sendMail } = await import('./mail.js')
    const token = await getMailAccessToken(); const accountId = await getMailAccountId(token)
    const name = `GET-SOME-Meeting-${dateStr}.png`
    let attachments = [], attachErr = ''
    try { attachments = [await uploadMailAttachment(token, accountId, { name, buffer: png })] } catch (e) { attachErr = e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : e.message; console.warn('[huddle] attachment:', attachErr) }
    let hosted = null
    try { hosted = await hostHuddlePng(req, png, dateStr); await rememberToday(req, dateStr, hosted.url) } catch (e) { console.warn('[huddle] hosting:', e.message) }
    const rows = data.techs.map(t => `<tr><td style="padding:4px 12px 4px 0"><b>${esc(t.name)}</b></td><td style="padding:4px 12px 4px 0">${fmtUSD(t.mtd)} of ${fmtUSD(t.goal)}</td><td style="padding:4px 0">${t.pct}%</td></tr>`).join('')
    const sched = data.schedule.map(g => `<p style="margin:6px 0"><b>${esc(g.tech)}</b> · ${g.jobs.map(j => `${esc(j.shop)} (${esc(j.vehicle)})`).join(' · ')}</p>`).join('') || '<p>Nothing on the board yet.</p>'
    const body = `<div style="font-family:Inter,Arial,sans-serif;color:#1a1a1a;max-width:900px">
      <p style="font-size:13px;letter-spacing:2px;color:#CD4419;font-weight:700;margin:0 0 6px">GET SOME! MEETING · ${esc(data.weekday.toUpperCase())} ${esc(data.dateLabel.toUpperCase())}</p>
      <p style="margin:0 0 14px">Share the attached graphic in the meeting (1920×1080). Numbers as of 7:40 AM.</p>
      ${hosted ? `<a href="${hosted.url}"><img src="${hosted.url}" alt="GET SOME! Meeting" style="width:100%;max-width:900px;border-radius:12px;display:block;margin:0 0 8px" /></a><p style="margin:0 0 16px;font-size:13px"><a href="${hosted.url}" style="color:#CD4419;font-weight:700">Open full size (1920×1080) →</a> — share this in the meeting.</p>` : `<img src="data:image/png;base64,${png.toString('base64')}" alt="GET SOME! Meeting" style="width:100%;max-width:900px;border-radius:12px;display:block;margin:0 0 16px" />`}
      <p style="margin:0 0 4px"><b>${esc(data.monthLabel)}:</b> ${fmtUSD(data.mtd)} of ${fmtUSD(data.goal)} (${data.pct}%) · ${data.ahead >= 0 ? 'ahead' : 'behind'} pace by ${fmtUSD(Math.abs(data.ahead))} · ${data.bizLeft} working days left · ${fmtUSD(data.perDayNeeded)}/day closes it.</p>
      <table style="border-collapse:collapse;margin:8px 0 14px">${rows}</table>
      <p style="margin:0 0 4px"><b>Today · ${data.jobsToday} on the board</b></p>${sched}
      ${data.calls?.shops?.length ? `<p style="margin:10px 0 0"><b>📅 Usually call on ${esc(data.calls.label)}:</b> ${data.calls.shops.map(x => `${esc(x.name)} (${x.pct}%)`).join(' · ')}</p>` : ''}
      <p style="margin:16px 0 0;color:#666;font-size:12px">${esc(data.line)}<br/>Set individual goals: AppConfig <code>huddle_tech_goals</code> (e.g. {"Jayden": 20000}). Company goal: Ada's pace goal.</p>
    </div>`
    await sendMail(token, accountId, { to, cc, subject: `🔥 GET SOME! Meeting · ${data.weekday} ${data.dateLabel} · ${fmtUSD(data.mtd)} of ${fmtUSD(data.goal)}`, body, attachments })
    return { sent: true, dateStr, to, bytes: png.length, attachment: attachments.length > 0, attach_error: attachErr || undefined, hosted: hosted?.url || null, mtd: data.mtd, goal: data.goal, jobs: data.jobsToday }
  } catch (e) {
    try { const r = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = '${stampKey}' LIMIT 1`); const row = r?.[0]?.AppConfig; if (row) await app.datastore().table('AppConfig').deleteRow(row.ROWID) } catch { /* fine */ }
    throw e
  }
}

/** Hourly piggyback: fires inside the window, once per day. */
export async function maybeSendHuddle(req) {
  const { h, m } = nowPT(); const t = h * 60 + m
  if (t < HUDDLE_WINDOW.startH * 60 + HUDDLE_WINDOW.startM || t > HUDDLE_WINDOW.endH * 60 + HUDDLE_WINDOW.endM) return { fired: false, reason: 'outside window' }
  return sendHuddle(req)
}

// ── today's image + the meeting room (Phase 1, Mark 2026-10-06 "automate as much as possible") ──
async function cfgGet(req, key) { try { const r = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key}' LIMIT 1`); return r?.[0]?.AppConfig || null } catch { return null } }
async function cfgSet(req, key, value) { const app = catalyst.initialize(req, { type: 'advancedio' }); const row = await cfgGet(req, key); if (row) await app.datastore().table('AppConfig').updateRow({ ROWID: row.ROWID, config_value: value }); else await app.datastore().table('AppConfig').insertRow({ config_key: key, config_value: value }) }
async function rememberToday(req, dateStr, url) { await cfgSet(req, 'huddle_today', JSON.stringify({ date: dateStr, url, at: new Date().toISOString() })) }
/** Today's hosted graphic URL — renders + hosts one if the 7:30 send has not happened yet. */
export async function ensureTodayImage(req) {
  const dateStr = todayPT()
  try { const row = await cfgGet(req, 'huddle_today'); const v = JSON.parse(row?.config_value || '{}'); if (v.date === dateStr && v.url) return { date: dateStr, url: v.url, fresh: false } } catch { /* render */ }
  const data = await buildHuddleData(req, { dateStr })
  const png = await renderHuddlePng(req, data)
  const hosted = await hostHuddlePng(req, png, dateStr)
  await rememberToday(req, dateStr, hosted.url)
  return { date: dateStr, url: hosted.url, fresh: true }
}
/** What the meeting room page needs. */
export async function roomConfig(req) {
  const [pl, ml, ch] = await Promise.all([cfgGet(req, 'huddle_playlist'), cfgGet(req, 'huddle_meeting_link'), cfgGet(req, 'huddle_channel')])
  return { playlist: pl?.config_value || '', meeting_link: ml?.config_value || '', channel: ch?.config_value || 'dispatch', start: '08:00', tz: 'America/Los_Angeles' }
}
export async function roomTokenOk(req, token) { const row = await cfgGet(req, 'huddle_room_token'); return !!(token && row?.config_value && String(row.config_value) === String(token)) }

/** 7:50 Cliq post: the graphic + the join link, once per weekday. */
export async function postHuddle(req, { force = false } = {}) {
  const dateStr = todayPT(), { h, m, weekday } = nowPT()
  if (!force) {
    if (weekday === 'Saturday' || weekday === 'Sunday') return { skipped: 'weekend' }
    const t = h * 60 + m; if (t < 7 * 60 + 48 || t > 8 * 60 + 40) return { skipped: 'outside 07:48–08:40 PT' }
    if (await cfgGet(req, `huddle_posted:${dateStr}`)) return { skipped: 'already posted today' }
  }
  await cfgSet(req, `huddle_posted:${dateStr}`, new Date().toISOString())
  try {
    const img = await ensureTodayImage(req)
    const cfg = await roomConfig(req)
    const data = await buildHuddleData(req, { dateStr })
    const { postToCliqChannel } = await import('./cliq.js')
    const lines = [
      `🔥 *GET SOME! Meeting — 8:00* · ${data.weekday} ${data.dateLabel}`,
      `${data.monthLabel}: *${fmtUSD(data.mtd)}* of ${fmtUSD(data.goal)} (${data.pct}%) · ${data.ahead >= 0 ? 'ahead' : 'behind'} pace by ${fmtUSD(Math.abs(data.ahead))} · ${data.jobsToday} on the board today`,
      `📊 Today's board: ${img.url}`,
      data.calls?.shops?.length ? `📅 Usually call on ${data.calls.label}: ${data.calls.shops.map(x => `${x.name} (${x.pct}%)`).join(' · ')}` : '',
      cfg.meeting_link ? `📹 Join: ${cfg.meeting_link}` : '',
      data.line,
    ].filter(Boolean)
    await postToCliqChannel(cfg.channel || 'dispatch', lines.join('\n'))
    return { posted: true, channel: cfg.channel, url: img.url }
  } catch (e) { try { const row = await cfgGet(req, `huddle_posted:${dateStr}`); if (row) await catalyst.initialize(req, { type: 'advancedio' }).datastore().table('AppConfig').deleteRow(row.ROWID) } catch { /* fine */ }; throw e }
}
export async function maybePostHuddle(req) { return postHuddle(req) }
