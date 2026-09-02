// Daily briefing — assembles a live briefing from jobs, revenue (Books), CRM pipeline,
// calendar, and commitments extracted from Cliq + email, then delivers it to Mark
// (Cliq alert channel + SMS). Commitments persist across runs in Catalyst Cache.
//
// Endpoints (all gated by x-cron-secret):
//   GET  /api/briefing/debug    -> JSON (no send) for testing
//   GET  /api/briefing/preview  -> plain-text briefing (no send)
//   POST /api/briefing/send     -> build + deliver now
//   (cron POST /api/cron/daily-briefing is wired in index.js -> sendDailyBriefing)
//
// Every data source is best-effort with a hard time budget: a failed or slow
// source is skipped, never breaks the briefing (Catalyst gateway kills at ~30s).
import express from 'express'
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { readJobsPublic } from './jobs.js'
import { postToCliqChannelById, ADA_CHANNEL_ID } from '../services/cliq.js'
import { sendSMS, sendEmail } from '../services/comms.js'
import { getAccessToken } from '../services/zoho.js'
import {
  getMailAccessToken, getMailAccountIdFor, getUnreadInboxMessages, getMessageContent,
  getAllMailAccounts, getInboxFolderId,
} from '../services/mail.js'
import { extractCommitments } from '../services/commitmentExtractor.js'
import { proposeBig3 } from '../services/dayCoach.js'
import { recordPlan, listDays, getDay, upsertDay } from '../services/dayLedger.js'
import { readContext } from './coach.js'
import { ptDate } from '../services/ptDate.js'
import { sendPushToAll } from './push.js'
import { publishAdaVoice } from '../services/adaVoice.js'
import { getTwilioClient, twilioConfigured, pickFromNumber } from '../services/twilio.js'
import { resolvePhoneConfig } from '../services/phoneConfig.js'

const router = express.Router()
const TARGET = 50000
const SCAN_REPORTS_FOLDER_ID = '147686000000057026' // postscan folder — not commitments
const SELF_BASE = (process.env.SELF_BASE_URL ||
  'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api').replace(/\/$/, '')
const COMMIT_CACHE_KEY = 'ops_commitments'

// Gate every briefing endpoint behind the cron secret — /debug exposes revenue
// and /send can fire SMS, so none of these should be publicly callable.
router.use((req, res, next) => {
  const secret = (process.env.BRIEFING_CRON_SECRET || process.env.MORNING_CRON_SECRET || 'morning-2026').trim()
  // Accept the secret via header OR ?k= query param — the query form lets a Siri
  // "Get Contents of URL" action work with no custom header (the fiddly step).
  const provided = (req.headers['x-cron-secret'] || req.query.k || '').trim()
  if (provided === secret) return next()
  return res.status(401).json({ error: 'Unauthorized' })
})

const todayStr = () => new Date().toISOString().slice(0, 10)

async function safe(label, fn) {
  try { return await fn() } catch (e) { console.error('[briefing]', label, e.message); return null }
}

// Hard per-source budget: times out -> null -> section skipped.
function withTimeout(label, promise, ms) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => {
      console.warn('[briefing] timeout:', label, ms + 'ms')
      resolve(null)
    }, ms)),
  ])
}

// Mon-Fri count for run-rate projection. upTo (1-31) caps the count; null = whole month.
function workingDays(year, monthIdx, upTo = null) {
  const last = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate()
  let n = 0
  for (let d = 1; d <= (upTo || last); d++) {
    const dow = new Date(Date.UTC(year, monthIdx, d)).getUTCDay()
    if (dow !== 0 && dow !== 6) n++
  }
  return n
}

// ---------- sources ----------

async function getRevenue() {
  return safe('revenue', async () => {
    const token = await getAccessToken()
    const orgId = process.env.ZOHO_ORGANIZATION_ID
    const r = await axios.get('https://www.zohoapis.com/books/v3/invoices', {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { organization_id: orgId, per_page: 100, sort_column: 'date', sort_order: 'D' },
      timeout: 5500,
    })
    const invs = r.data?.invoices || []
    const today = todayStr()
    const ym = today.slice(0, 7)
    const y = ym.slice(0, 4)
    const monthlyTotal = invs.filter(i => (i.date || '').startsWith(ym)).reduce((s, i) => s + (parseFloat(i.total) || 0), 0)
    const ytdTotal = invs.filter(i => (i.date || '').startsWith(y)).reduce((s, i) => s + (parseFloat(i.total) || 0), 0)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const yesterdayTotal = invs.filter(i => i.date === yesterday).reduce((s, i) => s + (parseFloat(i.total) || 0), 0)
    const todayTotal = invs.filter(i => i.date === today).reduce((s, i) => s + (parseFloat(i.total) || 0), 0)
    const yr = Number(y), mi = Number(ym.slice(5, 7)) - 1, dayNum = Number(today.slice(8, 10))
    const elapsed = Math.max(1, workingDays(yr, mi, dayNum))
    const projected = Math.round((monthlyTotal / elapsed) * workingDays(yr, mi))
    // Keep the raw records — per-tech revenue is a join of Books invoices to
    // the jobs table on invoice_number, since jobs carry no dollar amount.
    const records = invs
      .filter(i => (i.date || '').startsWith(ym))
      .map(i => ({
        number: String(i.invoice_number || ''),
        total: parseFloat(i.total) || 0,
        date: i.date || '',
        // Books tracks the salesperson on the invoice — the same field behind
        // the "Sales by Salesperson" report Mark already gets daily. That is
        // authoritative; joining on invoice_number was not, because the
        // numbers are free text ("IAR 2017 Mercedes GLS") and never matched.
        salesperson: String(i.salesperson_name || '').trim(),
      }))
    return { monthlyTotal, ytdTotal, yesterdayTotal, todayTotal, projected, invoiceCount: invs.length, records }
  })
}

let lastCrmError = null
async function getCrmShops(req) {
  lastCrmError = null
  try {
    // CRM lives in the CRMShops Datastore table (cache keys are legacy) — same
    // read pattern as mail-agent and routes/shops.js.
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const rows = await app.datastore().table('CRMShops').getAllRows()
    return (rows || []).map(row => row.CRMShops || row)
  } catch (e) {
    lastCrmError = e.message
    console.error('[briefing] crm', e.message)
    return []
  }
}

const msgText = m =>
  (m?.content?.text || (typeof m?.content === 'string' ? m.content : '') || m?.text || '').toString()

// Cliq message-reading is disabled: it needs the ZohoCliq.Messages.READ scope on
// ZOHO_CLIQ_REFRESH_TOKEN (not yet granted). Until Mark regenerates that token,
// commitments come from email only. Re-enable by restoring fetchMessagesProbing.
let lastCliqProbe = 'disabled (missing Messages.READ scope)'
async function getCliqBlocks() {
  return []
}

const stripHtml = s => String(s || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&amp;|&lt;|&gt;|&#\d+;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

async function getEmailBlocks() {
  return (await safe('email', async () => {
    const token = await getMailAccessToken()
    const accountId = await getMailAccountIdFor(token, process.env.MARK_INBOX_EMAIL || 'mark@absoluteadas.com')
    const unread = (await getUnreadInboxMessages(token, accountId)) || []
    const usable = unread.filter(m => String(m.folderId) !== SCAN_REPORTS_FOLDER_ID).slice(0, 5)
    const blocks = await Promise.all(usable.map(m =>
      safe('email:msg', () => getMessageContent(token, accountId, m.folderId, m.messageId))
        .then(c => {
          const body = stripHtml(c?.content || c?.body || '').slice(0, 700)
          const from = m.fromAddress || m.sender || 'unknown'
          return body ? { source: 'email', label: from, text: `Subject: ${m.subject || ''}\nFrom: ${from}\n${body}` } : null
        })))
    return blocks.filter(Boolean)
  })) || []
}

async function getCalendarEvents(date = todayStr()) {
  // Self-call the existing (unauthenticated) calendar route — reuses the tested
  // Zoho + Google-family-calendar logic without duplicating it.
  return (await safe('calendar', async () => {
    const r = await axios.get(`${SELF_BASE}/api/calendar/events`, {
      params: { date }, timeout: 5500,
    })
    return (r.data?.events || []).map(e => ({ title: e.title, start: e.startTime, end: e.endTime }))
  })) || []
}

// ---------- commitment persistence (Catalyst Cache) ----------

const commitKey = c => `${c.person}|${c.text}`.toLowerCase().replace(/\s+/g, ' ').slice(0, 140)

async function persistCommitments(req, fresh) {
  try {
    const seg = catalyst.initialize(req, { type: 'advancedio' }).cache().segment()
    let store = { items: [] }
    try {
      const raw = await seg.getValue(COMMIT_CACHE_KEY)
      if (raw) store = JSON.parse(raw)
    } catch { /* first run */ }
    const byKey = new Map(store.items.map(i => [i.key, i]))
    const today = todayStr()
    for (const c of fresh) {
      const key = commitKey(c)
      const existing = byKey.get(key)
      if (existing) {
        if (c.due) existing.due = c.due
      } else {
        byKey.set(key, { key, text: c.text, person: c.person, direction: c.direction || 'inbound', due: c.due || null, source: c.source || 'cliq', status: 'open', first_seen: today })
      }
    }
    // Drop stale (>45 days) and cap at 60 — Cache values must stay small.
    const cutoff = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10)
    const items = [...byKey.values()]
      .filter(i => i.status === 'open' && (i.first_seen || today) >= cutoff)
      .slice(-60)
    const payload = JSON.stringify({ items })
    try { await seg.put(COMMIT_CACHE_KEY, payload) } catch { await seg.update(COMMIT_CACHE_KEY, payload) }
    return items
  } catch (e) {
    console.error('[briefing] persist', e.message)
    return fresh.map(c => ({ ...c, key: commitKey(c), status: 'open' }))
  }
}

// ---------- build ----------

async function buildBriefing(req, { only, mode = 'morning' } = {}) {
  const today = todayStr()
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const t0 = Date.now()
  const timings = {}
  const timed = (label, p) => p.then(v => { timings[label] = Date.now() - t0; return v })
  const on = s => !only || only.split(',').includes(s)

  const [jobs, revenue, shops, cliqBlocks, emailBlocks, events] = await Promise.all([
    on('jobs') ? timed('jobs', withTimeout('jobs', safe('jobs', () => readJobsPublic(req)), 6000)).then(j => j || []) : [],
    on('revenue') ? timed('revenue', withTimeout('revenue', getRevenue(), 6000)) : null,
    on('crm') ? timed('crm', withTimeout('crm', getCrmShops(req), 6000)).then(s => s || []) : [],
    on('cliq') ? timed('cliq', withTimeout('cliq', getCliqBlocks(), 6000)).then(b => b || []) : [],
    on('email') ? timed('email', withTimeout('email', getEmailBlocks(), 6000)).then(b => b || []) : [],
    on('calendar') ? timed('calendar', withTimeout('calendar', getCalendarEvents(), 6000)).then(e => e || []) : [],
  ])

  // Evening review looks ahead: tomorrow's calendar (jobs come from the same board).
  const tomorrowEvents = mode === 'evening' && on('calendar')
    ? (await withTimeout('calTomorrow', getCalendarEvents(tomorrow), 6000)) || []
    : []

  const fresh = (on('extract')
    ? (await timed('extract', withTimeout('extract',
        safe('extract', () => extractCommitments({ blocks: [...cliqBlocks, ...emailBlocks], today })), 9000)))
    : []) || []

  const commitments = (on('persist')
    ? (await timed('persist', withTimeout('persist', persistCommitments(req, fresh), 4000)))
    : fresh) || fresh

  timings.total = Date.now() - t0
  console.log('[briefing] timings', JSON.stringify(timings))

  const todaysJobs = jobs.filter(j => j.scheduled_date === today)
  const tomorrowsJobs = jobs.filter(j => j.scheduled_date === tomorrow)
  const jaden = jobs.filter(j => String(j.technician || '').toLowerCase().startsWith('jay'))
  const jadenToday = jaden.filter(j => j.scheduled_date === today)
  const openJobs = jobs.filter(j => j.status && j.status !== 'complete')
  const completedToday = jobs.filter(j => j.status === 'complete' &&
    (String(j.completed_at || j.updated_at || '').slice(0, 10) === today))
  const followups = shops.filter(s => s.next_followup && s.next_followup <= today)
  const dueToday = commitments.filter(c => c.due === today)
  const dueTomorrow = commitments.filter(c => c.due === tomorrow)
  const overdue = commitments.filter(c => c.due && c.due < today)
  const outbound = commitments.filter(c => c.direction === 'outbound')

  return {
    today, tomorrow, mode, jobs, revenue, shops, commitments, todaysJobs, tomorrowsJobs,
    jaden, jadenToday, openJobs, completedToday,
    followups, dueToday, dueTomorrow, overdue, outbound, events, tomorrowEvents, timings,
    sources: { cliqBlocks: cliqBlocks.length, emailBlocks: emailBlocks.length, crmError: lastCrmError, cliqProbe: lastCliqProbe },
  }
}

// Month-to-date revenue per technician.
//
// Jobs have no price on them, so the only honest way to attribute dollars is
// to join Books invoices to jobs on invoice_number and read the tech off the
// job. Invoices with no matching job are reported as unattributed rather than
// silently dropped or spread around — a number Mark can't trace is worse than
// no number.
function levenshtein(a, b) {
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

// Month-to-date revenue per person, straight off the Books invoice
// salesperson field — the same field behind the "Sales by Salesperson" report
// Mark already gets daily. An earlier attempt joined invoices to jobs on
// invoice_number; that never matched, because Books numbers are free text
// ("IAR 2017 Mercedes GLS").
//
// Names get typo'd at entry — "Mark Folwer" and "Mark Fowler" are both live in
// Books right now and would otherwise split his total. Near-identical spellings
// are merged onto the most-used one, and the merge is REPORTED rather than
// hidden, because the real fix is in Books, not here.
function techRevenue(jobs, revenue) {
  const records = (revenue?.records || []).filter(r => r.salesperson)
  if (!records.length) return null

  // Known-correct spellings win over frequency. Books currently has "Mark
  // Folwer" and "Mark Fowler" at two invoices each — a tie, so frequency alone
  // picked the typo as the label. Alphabetical is the tiebreak of last resort
  // so the output is at least deterministic.
  const KNOWN = (process.env.SALESPEOPLE || 'Mark Fowler,Jayden Goshorn')
    .split(',').map(x => x.trim()).filter(Boolean)
  const isKnown = n => KNOWN.some(k => k.toLowerCase() === n.toLowerCase())

  const counts = {}
  for (const r of records) counts[r.salesperson] = (counts[r.salesperson] || 0) + 1
  const names = Object.keys(counts).sort((a, b) =>
    (isKnown(b) - isKnown(a)) || (counts[b] - counts[a]) || a.localeCompare(b))

  const canonical = {}
  const merged = []
  for (const name of names) {
    const hit = names.find(c => canonical[c] === c && c !== name &&
      levenshtein(c.toLowerCase(), name.toLowerCase()) <= 2)
    if (hit) { canonical[name] = hit; merged.push(`${name} -> ${hit}`) }
    else canonical[name] = name
  }

  const byTech = {}
  let unattributed = 0, unattributedCount = 0
  for (const r of (revenue?.records || [])) {
    if (!r.salesperson) { unattributed += r.total; unattributedCount++; continue }
    const key = canonical[r.salesperson] || r.salesperson
    byTech[key] = (byTech[key] || 0) + r.total
  }
  return {
    rows: Object.entries(byTech).sort((a, b) => b[1] - a[1]),
    unattributed, unattributedCount, merged,
  }
}

function formatTechRevenue(tr) {
  if (!tr || (!tr.rows.length && !tr.unattributed)) return ''
  const L = ['', 'Sales this month by tech:']
  tr.rows.forEach(([tech, amt]) => L.push(`- ${tech}: ${money(amt)}`))
  if (tr.unattributed > 0) {
    L.push(`- Unassigned: ${money(tr.unattributed)} (${tr.unattributedCount} invoice${tr.unattributedCount === 1 ? '' : 's'} with no salesperson set in Books)`)
  }
  if (tr.merged?.length) L.push(`  (merged misspellings in Books: ${tr.merged.join(', ')} — worth fixing at the source)`)
  return L.join('\n')
}

// ---------- formatting ----------

const money = n => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

function formatFull(b) {
  const L = [`Daily Briefing — ${b.today}`, '']
  if (b.revenue) {
    const mtd = b.revenue.monthlyTotal || 0
    const proj = b.revenue.projected || 0
    const diff = proj - TARGET
    L.push(`Revenue: ${money(b.revenue.yesterdayTotal || 0)} yesterday. ${money(mtd)} month to date.`)
    L.push(`Projected month end: ${money(proj)} vs ${money(TARGET)} target. ${diff >= 0 ? 'Ahead by' : 'Behind by'} ${money(Math.abs(diff))} at current pace.`)
  } else L.push('Revenue: not available this run.')
  L.push(`Field ops: ${b.todaysJobs.length} jobs scheduled today. Jaden has ${b.jadenToday.length} today (${b.jaden.length} on the board). ${b.openJobs.length} open jobs total.`)
  L.push(`Pipeline: ${b.shops.length} shops, ${b.followups.length} follow-ups due.`)
  if (b.events.length) {
    L.push('')
    L.push('Schedule today:')
    b.events.slice(0, 8).forEach(e => L.push(`- ${e.start || ''} ${e.title}`.trim()))
  }
  L.push('')
  L.push(`Commitments: ${b.dueToday.length} due today, ${b.overdue.length} overdue, ${b.commitments.length} open.`)
  if (b.dueToday.length) { L.push(''); L.push('Due today:'); b.dueToday.slice(0, 10).forEach(c => L.push(`- ${c.person}: ${c.text}`)) }
  if (b.overdue.length) { L.push(''); L.push('Overdue:'); b.overdue.slice(0, 10).forEach(c => L.push(`- ${c.person}: ${c.text} (was ${c.due})`)) }
  if (b.outbound.length) { L.push(''); L.push('Your promises:'); b.outbound.slice(0, 8).forEach(c => L.push(`- ${c.text}${c.due ? ` (by ${c.due})` : ''}`)) }
  return L.join('\n')
}

function formatDigestTech(tr) {
  if (!tr?.rows?.length) return ''
  return ' ' + tr.rows.map(([t, a]) => `${t} ${money(a)}`).join(', ') + '.'
}

function formatDigest(b) {
  const proj = b.revenue ? money(b.revenue.projected || 0) : 'n/a'
  const mtd = b.revenue ? money(b.revenue.monthlyTotal || 0) : 'n/a'
  return `Briefing ${b.today}. Rev ${mtd} MTD, projecting ${proj} of ${money(TARGET)}. Jobs today ${b.todaysJobs.length} (Jaden ${b.jadenToday.length}). Events ${b.events.length}. Follow-ups ${b.followups.length}. Commitments due ${b.dueToday.length}, overdue ${b.overdue.length}. Full brief in Cliq.`
}

// ---------- voice (spoken by Siri Shortcut — plain sentences, no markdown/emoji) ----------

// Spoken money: "649 dollars" (no $, TTS reads the comma grouping naturally).
const spoken = n => `${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} dollars`
const weekday = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`

// Strip emoji/symbols so TTS doesn't read "family emoji", and drop empty titles.
const deEmoji = s => String(s || '')
  .replace(/[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}]/gu, '')
  .replace(/\s+/g, ' ').trim()
const eventTitles = (arr, n) => (arr || []).map(e => deEmoji(e.title)).filter(Boolean).slice(0, n)
// Final cleanup: fix stray/doubled punctuation left by omitted sections.
const cleanSpeech = s => String(s)
  .replace(/\s*,\s*,/g, ',').replace(/\s+([.,])/g, '$1')
  .replace(/([.,])\1+/g, '$1').replace(/\.\s*\./g, '.').replace(/,\s*\./g, '.')
  .replace(/\s{2,}/g, ' ').trim()

// Morning briefing, read aloud in the van.
function formatVoiceMorning(b) {
  const L = [`Good morning, Mark. Here's your briefing for ${weekday(b.today)}.`]
  if (b.revenue) {
    const proj = b.revenue.projected || 0
    const diff = proj - TARGET
    L.push(`Yesterday you booked ${spoken(b.revenue.yesterdayTotal || 0)}. You're at ${spoken(b.revenue.monthlyTotal || 0)} for the month, on pace for ${spoken(proj)} against your fifty thousand target, ${diff >= 0 ? 'ahead' : 'behind'} by ${spoken(Math.abs(diff))}.`)
  }
  L.push(`On the board today, ${plural(b.todaysJobs.length, 'job')} scheduled. Jaden has ${b.jadenToday.length}. ${plural(b.openJobs.length, 'job')} open in total.`)
  const ev = eventTitles(b.events, 5)
  if (ev.length) L.push(`On your calendar, ${ev.join(', ')}.`)
  if (b.dueToday.length) {
    L.push(`${plural(b.dueToday.length, 'commitment')} due today. ${b.dueToday.slice(0, 5).map(c => `${c.person}, ${c.text}`).join('. ')}.`)
  } else {
    L.push('No commitments due today.')
  }
  if (b.overdue.length) L.push(`Heads up, ${plural(b.overdue.length, 'commitment')} overdue.`)
  L.push('Make it a great day.')
  return cleanSpeech(L.join(' '))
}

// End-of-day review, read aloud on the way home.
function formatVoiceEvening(b) {
  const L = [`Good evening, Mark. Here's your end of day review for ${weekday(b.today)}.`]
  if (b.revenue) {
    L.push(`Today you booked ${spoken(b.revenue.todayTotal || 0)}. That puts you at ${spoken(b.revenue.monthlyTotal || 0)} for the month, pacing to ${spoken(b.revenue.projected || 0)} of your fifty thousand target.`)
  }
  if (b.completedToday.length) L.push(`You closed out ${plural(b.completedToday.length, 'job')} today.`)
  const evT = eventTitles(b.tomorrowEvents, 4)
  L.push(`${plural(b.openJobs.length, 'job')} still open. Tomorrow you've got ${plural(b.tomorrowsJobs.length, 'job')} on the schedule${evT.length ? `, plus ${evT.join(', ')}` : ''}.`)
  if (b.dueTomorrow.length) {
    L.push(`Due tomorrow, ${b.dueTomorrow.slice(0, 5).map(c => `${c.person}, ${c.text}`).join('. ')}.`)
  }
  if (b.overdue.length) L.push(`Still overdue, ${plural(b.overdue.length, 'commitment')}. Worth clearing before you clock out.`)
  L.push('Two questions before you unplug. Did you move your Big Three today? And what is one thing you are grateful for?')
  L.push("Rest up. Tomorrow's a new one.")
  return cleanSpeech(L.join(' '))
}

// ---------- send + routes ----------

// Ask the coach for today's Big 3 and write them into the day ledger.
//
// Best-effort by design: a failed or slow proposal must never cost Mark his
// briefing, so every path returns null rather than throwing. When this returns
// null the brief still sends, just without a proposed Big 3 — and the evening
// check-in still fires and still asks how the day went.
// Context builder for the planner cron — same sources as the brief, minus the
// commitment extraction the planner doesn't need.
export async function buildBriefingForPlan(req) {
  return buildBriefing(req)
}

// What the evening review reads before it asks how the day went. Same
// sources as the morning brief; the evening cares about what CLOSED, not
// what's scheduled.
export async function gatherDayReview(req) {
  const b = await buildBriefing(req, { mode: 'evening' })
  return {
    completed_today: b.completedToday.map(j => `${j.year || ''} ${j.make || ''} ${j.model || ''}`.trim() || 'job').slice(0, 12),
    jobs_scheduled_today: b.todaysJobs.length,
    open_jobs: b.openJobs.length,
    commitments_due_today: b.dueToday.map(c => `${c.person}: ${c.text}`).slice(0, 10),
    commitments_overdue: b.overdue.map(c => `${c.person}: ${c.text}`).slice(0, 10),
    my_promises: b.outbound.map(c => c.text).slice(0, 8),
    followups_due: b.followups.length,
    unread_inbox: b.sources.emailBlocks,
    tomorrow_jobs: b.tomorrowsJobs.length,
    tomorrow_calendar: eventTitles(b.tomorrowEvents, 5),
    revenue_today: b.revenue?.todayTotal ?? null,
    revenue_mtd: b.revenue?.monthlyTotal ?? null,
    revenue_projected: b.revenue?.projected ?? null,
    revenue_target: TARGET,
    cliq_available: b.sources.cliqProbe !== 'disabled (missing Messages.READ scope)',
  }
}

// What the Sunday planner reads. Looks forward across the next 7 days rather
// than at today, so jobs are bucketed by scheduled_date.
export async function gatherWeekAhead(req) {
  const b = await buildBriefing(req)
  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10)
    const onDay = b.jobs.filter(j => j.scheduled_date === d)
    days.push({
      date: d,
      weekday: weekday(d),
      jobs: onDay.length,
      jaden_jobs: onDay.filter(j => String(j.technician || '').toLowerCase().startsWith('jay')).length,
    })
  }
  return {
    week: days,
    open_jobs: b.openJobs.length,
    shops: b.shops.length,
    followups_due: b.followups.length,
    commitments_open: b.commitments.length,
    commitments_overdue: b.overdue.map(c => `${c.person}: ${c.text}`).slice(0, 10),
    my_promises: b.outbound.map(c => c.text).slice(0, 10),
    revenue_mtd: b.revenue?.monthlyTotal ?? null,
    revenue_projected: b.revenue?.projected ?? null,
    revenue_target: TARGET,
  }
}

export async function planDay(req, b) {
  try {
    const today = ptDate()
    const [ctx, recentDays] = await Promise.all([
      safe('coach-context', () => readContext(req)).then(c => c || { goals: '', coaching_notes: '' }),
      safe('coach-ledger', () => listDays(req, { limit: 10 })).then(d => d || []),
    ])

    const proposal = await withTimeout('big3', proposeBig3(req, {
      goals: ctx.goals,
      coachingNotes: ctx.coaching_notes,
      recentDays,
      todayContext: {
        today,
        weekday: weekday(today),
        load: {
          jobs_today: b.todaysJobs.length,
          jaden_jobs_today: b.jadenToday.length,
          open_jobs: b.openJobs.length,
          calendar: eventTitles(b.events, 6),
          commitments_due_today: b.dueToday.map(c => `${c.person}: ${c.text}`).slice(0, 8),
          commitments_overdue: b.overdue.map(c => `${c.person}: ${c.text}`).slice(0, 8),
          followups_due: b.followups.length,
          revenue_mtd: b.revenue?.monthlyTotal || null,
          revenue_projected: b.revenue?.projected || null,
          revenue_target: TARGET,
        },
      },
    }), 180000)

    if (!proposal?.big3?.length) return null
    await safe('record-plan', () => recordPlan(req, today, {
      big3: proposal.big3, hardThing: proposal.hardThing,
    }))
    await safe('record-note', () => upsertDay(req, today, {
      plan_note: proposal.note || '', affirmation: proposal.affirmation || '',
    }))
    return proposal
  } catch (e) {
    console.error('[briefing] big3 failed:', e.message)
    return null
  }
}

// The affirmation opens the brief — it is the first thing he reads each day.
function formatAffirmation(p) {
  return p?.affirmation ? `${p.affirmation}\n\n` : ''
}

function formatBig3(p) {
  if (!p) return ''
  const L = ['', 'Big 3 today:']
  p.big3.forEach((b, i) => L.push(`${i + 1}. ${b.text}`))
  if (p.hardThing) L.push(`Hard thing (do it first): ${p.hardThing}`)
  if (p.note) { L.push(''); L.push(p.note) }
  return L.join('\n')
}

// One briefing per PT day, whoever asks. The 6 AM LaunchAgent and any
// still-enabled Catalyst cron both call this; without a stamp Mark gets the
// same brief twice. Same idempotence rule the marketing crons run on.
const SENT_KEY = 'briefing_sent_stamp'

async function alreadySentToday(req) {
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const v = await app.cache().segment().getValue(SENT_KEY)
    return v ? String(typeof v === 'string' ? JSON.parse(v).date : v.date) === ptDate() : false
  } catch { return false }
}

async function stampSent(req) {
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const seg = app.cache().segment()
    const val = JSON.stringify({ date: ptDate(), at: new Date().toISOString() })
    try { await seg.update(SENT_KEY, val) } catch { await seg.put(SENT_KEY, val, 48) }
  } catch (e) { console.warn('[briefing stamp]', e.message) }
}

// The script Ada reads. Same order as the written brief: affirmation, the
// brief itself, then the Big 3 — so hearing it and reading it feel like one
// thing rather than two.
function buildSpokenScript(b, big3, tr) {
  const parts = []
  if (big3?.affirmation) parts.push(big3.affirmation)
  parts.push(formatVoiceMorning(b))
  if (tr?.rows?.length) {
    parts.push('Sales this month by tech.')
    tr.rows.forEach(([t, amt]) => parts.push(`${t}, ${spoken(amt)}.`))
  }
  if (big3?.big3?.length) {
    parts.push('Your big three today.')
    big3.big3.forEach((x, i) => parts.push(`Number ${i + 1}. ${x.text}.`))
    if (big3.hardThing) parts.push(`The hard thing, and do it first. ${big3.hardThing}.`)
  }
  parts.push('Go get it.')
  return cleanSpeech(parts.join(' '))
}

export async function sendDailyBriefing(req, { dry = false, only } = {}) {
  if (!dry && req.query?.force !== '1' && await alreadySentToday(req)) {
    console.log('[briefing] already sent today — skipping duplicate')
    return { ok: true, skipped: 'already_sent_today', date: ptDate() }
  }
  const b = await buildBriefing(req, { only })
  // Read the plan the 7:20 planner cron already stored. Generating it here
  // would put a 20-40s Opus call inside a request the gateway kills at 30s.
  const big3 = await safe('read-plan', async () => {
    const day = await getDay(req, ptDate())
    if (!day?.big3?.length) return null
    return {
      big3: day.big3, hardThing: day.hard_thing?.text || '',
      note: day.plan_note || '', affirmation: day.affirmation || '',
    }
  })
  const tr = techRevenue(b.jobs, b.revenue)
  let full = formatAffirmation(big3) + formatFull(b) + formatTechRevenue(tr) + formatBig3(big3)
  // SMS is billed and read by the segment — keep the digest to one or two.
  // The full wording lives in Cliq and the push notification.
  const shortBig3 = (big3?.big3 || [])
    .map((x, i) => `${i + 1}) ${x.text.length > 64 ? x.text.slice(0, 61).trimEnd() + '...' : x.text}`)
    .join(' ')
  let digest = formatAffirmation(big3) + (shortBig3 ? `Big 3: ${shortBig3}\n` : '') + formatDigest(b) + formatDigestTech(tr)
  if (dry) {
    return { ok: true, dry: true, digest, full, big3, commitments: b.commitments, timings: b.timings, sources: b.sources,
      counts: { jobsToday: b.todaysJobs.length, events: b.events.length, dueToday: b.dueToday.length, overdue: b.overdue.length, followups: b.followups.length, shops: b.shops.length } }
  }
  const sent = { cliq: false, sms: false }
  // postToCliqChannelById returns undefined on success — map to true explicitly
  const r = await safe('cliq-send', () => postToCliqChannelById(ADA_CHANNEL_ID, full).then(() => true))
  sent.cliq = !!r
  // Mark's number lives in the MARK_PHONE_NUMBER env var
  const to = (process.env.MARK_PHONE_NUMBER || '').trim()
  if (to) { const s = await safe('sms', () => sendSMS(req, { to, body: digest, category: 'briefing' })); sent.sms = !!s }
  // Ada's voice memo — a file he can tap and play on the way to F3. Hard
  // timeout and fail-soft: TTS plus a git commit is ~12s, and if it runs long
  // the written brief still goes out on time without it.
  const audio = await withTimeout('ada-voice',
    safe('ada-voice', () => publishAdaVoice(buildSpokenScript(b, big3, tr), ptDate(), { slot: 'morning' })),
    22000)
  if (audio?.url) {
    const line = `\n\nListen: ${audio.url}`
    full += line
    digest += line
  }

  // Web Push to the home-screen PWA — the part that actually surfaces on his
  // phone. Cliq and SMS both land silently behind other traffic.
  const pushBody = big3?.big3?.length
    ? big3.big3.map((x, i) => `${i + 1}. ${x.text}`).join('\n')
    : `${b.todaysJobs.length} jobs today, ${b.dueToday.length} commitments due.`
  // Email — for the mornings he's at the computer instead of in the van.
  // Plain text of the same brief plus the audio link, so nothing is only
  // available in one place.
  const emailTo = (process.env.MARK_INBOX_EMAIL || 'mark@absoluteadas.com').trim()
  if (emailTo) {
    const e = await safe('email', () => sendEmail(req, {
      to: emailTo,
      subject: `Ada — ${ptDate()}${big3?.big3?.length ? `: ${big3.big3[0].text}` : ''}`.slice(0, 160),
      body: full,
      category: 'briefing',
    }))
    sent.email = !!e
  }

  const p = await safe('push', () => sendPushToAll(req, {
    title: big3?.big3?.length ? 'Your Big 3 today' : 'Morning briefing',
    body: pushBody, url: '/today', tag: 'morning-briefing',
  }))
  sent.push = !!p
  // Team good-morning fan-out (Kat / Joyce greetings + Jayden sales digest).
  // Piggybacks on this cron so we don't need a second console entry. Failures
  // are swallowed by safe() so a broken Cliq DM never derails Mark's briefing.
  const kickoff = await safe('morning-kickoff', async () => {
    const { sendMorningKickoff } = await import('./dailyGreeting.js')
    return sendMorningKickoff(req)
  })
  if (sent.cliq || sent.sms || sent.push) await stampSent(req)
  return { ok: true, sent, digest, big3, audio: audio?.url || null, kickoff: kickoff || { ok: false } }
}

router.get('/debug', async (req, res) => {
  const b = await buildBriefing(req, { only: req.query.only })
  res.json({
    ok: true, summary: formatDigest(b), full: formatFull(b),
    commitments: b.commitments, revenue: b.revenue, timings: b.timings, sources: b.sources,
    counts: { jobsToday: b.todaysJobs.length, jadenToday: b.jadenToday.length, openJobs: b.openJobs.length, events: b.events.length, followups: b.followups.length, dueToday: b.dueToday.length, overdue: b.overdue.length, shops: b.shops.length },
  })
})
// Planner — runs on its own cron at 7:20 AM PT, ten minutes ahead of the
// briefing. Split out because the Opus call routinely outlives the 30s
// gateway cap that the 7:30 briefing request has to answer inside.
router.post('/plan', async (req, res) => {
  try {
    const b = await buildBriefing(req)
    const proposal = await planDay(req, b)
    res.json({ ok: !!proposal, date: ptDate(), proposal })
  } catch (e) {
    console.error('[briefing/plan]', e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Mail diagnostic — the briefing reported 0 unread while Mark's inbox visibly
// had six. This shows every step of the resolution so the failing one is
// obvious instead of inferred: which mailboxes exist, which matched, which
// folder id came back, and what the raw query returned.
router.get('/mail-debug', async (req, res) => {
  const out = { steps: {} }
  try {
    const token = await getMailAccessToken()
    out.steps.token = !!token
    const accounts = await getAllMailAccounts(token)
    out.steps.accounts = accounts.map(a => ({
      accountId: a.accountId,
      accountName: a.accountName,
      primary: a.primaryEmailAddress,
      mailbox: a.mailboxAddress,
      addresses: (a.emailAddress || []).map(e => e?.mailId).filter(Boolean),
    }))
    const want = process.env.MARK_INBOX_EMAIL || 'mark@absoluteadas.com'
    out.steps.wanted = want
    const accountId = await getMailAccountIdFor(token, want)
    out.steps.matchedAccountId = accountId
    out.steps.matchedIsFirst = accountId === accounts[0]?.accountId

    const folderId = await getInboxFolderId(token, accountId)
    out.steps.resolvedInboxFolderId = folderId

    const msgs = await getUnreadInboxMessages(token, accountId)
    out.steps.unreadCount = msgs.length
    out.steps.subjects = msgs.slice(0, 8).map(m => m.subject || '(no subject)')
    res.json({ ok: true, ...out })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, ...out })
  }
})

router.get('/preview', async (req, res) => { const b = await buildBriefing(req); res.type('text/plain').send(formatFull(b)) })
router.post('/send', async (req, res) => { res.json(await sendDailyBriefing(req)) })

// ── Ada's voice ─────────────────────────────────────────────────────────────
//
// Mark drives to F3 at 4:40 and wanted the brief read to him rather than
// tapping through a phone in the dark. Twilio calls him, Polly reads it.
//
//   GET  /api/briefing/twiml   — the TwiML Twilio fetches (?k= secret, since
//                                Twilio can't send our auth header)
//   POST /api/briefing/call    — place the call
//
// ADA_VOICE overrides the voice; Polly neural US-English female voices that
// work here: Joanna, Danielle, Ruth, Kendra.
const ADA_VOICE = process.env.ADA_VOICE || 'Polly.Joanna-Neural'

// Twilio's <Say> chokes on raw &, <, > — and reads them aloud badly if they
// slip through. Escape before embedding.
function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// Break the brief into sentences so we can put a beat between them. One giant
// <Say> runs together and is hard to follow at 4:40 in the morning.
function speakBlocks(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
}

router.get('/twiml', async (req, res) => {
  const mode = req.query.mode === 'evening' ? 'evening' : 'morning'
  let spoken
  try {
    const b = await buildBriefing(req, { mode })
    spoken = mode === 'evening' ? formatVoiceEvening(b) : formatVoiceMorning(b)
    if (mode === 'morning') {
      // Lead with the affirmation, then the brief, then the Big 3 — same
      // order as the written version, because that's the order he's used to.
      const day = await safe('voice-plan', () => getDay(req, ptDate()))
      const aff = day?.affirmation ? day.affirmation + ' ' : ''
      const big3 = (day?.big3 || []).map((x, i) => `Number ${i + 1}. ${x.text}.`).join(' ')
      const hard = day?.hard_thing?.text ? ` The hard thing, do it first. ${day.hard_thing.text}.` : ''
      spoken = `${aff}${spoken}${big3 ? ` Your big three today. ${big3}${hard}` : ''}`
    }
  } catch (e) {
    console.error('[briefing/twiml]', e.message)
    spoken = "Good morning Mark. I couldn't reach your data this morning. Check the app when you get a minute."
  }

  const says = speakBlocks(spoken)
    .map(s => `<Say voice="${ADA_VOICE}">${escapeXml(s)}</Say><Pause length="1"/>`)
    .join('')
  res.type('text/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${says}<Say voice="${ADA_VOICE}">Go get it.</Say></Response>`
  )
})

router.post('/call', async (req, res) => {
  try {
    const cfg = await resolvePhoneConfig(req)
    if (!twilioConfigured(cfg)) return res.status(500).json({ ok: false, error: 'twilio not configured' })
    const to = (process.env.MARK_PHONE_NUMBER || '').trim()
    if (!to) return res.status(500).json({ ok: false, error: 'MARK_PHONE_NUMBER not set' })

    const mode = req.query.mode === 'evening' ? 'evening' : 'morning'
    const secret = (process.env.BRIEFING_CRON_SECRET || process.env.MORNING_CRON_SECRET || 'morning-2026').trim()
    const base = (process.env.SELF_BASE_URL || SELF_BASE).replace(/\/$/, '')
    const url = `${base}/api/briefing/twiml?mode=${mode}&k=${encodeURIComponent(secret)}`

    const client = await getTwilioClient(cfg)
    const from = pickFromNumber('local', cfg)
    const call = await client.calls.create({ to, from, url, timeout: 25 })
    res.json({ ok: true, sid: call.sid, to, from, mode, voice: ADA_VOICE })
  } catch (e) {
    console.error('[briefing/call]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Voice endpoint — plain spoken text for the Siri "Speak Text" shortcut.
//   /api/briefing/voice            -> morning briefing
//   /api/briefing/voice?mode=evening -> end-of-day review
// GET so the shortcut is dead simple; still gated by the x-cron-secret header.
router.get('/voice', async (req, res) => {
  const mode = req.query.mode === 'evening' ? 'evening' : 'morning'
  const b = await buildBriefing(req, { mode })
  const text = mode === 'evening' ? formatVoiceEvening(b) : formatVoiceMorning(b)
  res.type('text/plain').send(text)
})

export default router
