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
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from '../services/cliq.js'
import { sendSMS } from '../services/comms.js'
import { getAccessToken } from '../services/zoho.js'
import {
  getMailAccessToken, getMailAccountId, getUnreadInboxMessages, getMessageContent,
} from '../services/mail.js'
import { extractCommitments } from '../services/commitmentExtractor.js'

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
  const provided = (req.headers['x-cron-secret'] || '').trim()
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
    const yr = Number(y), mi = Number(ym.slice(5, 7)) - 1, dayNum = Number(today.slice(8, 10))
    const elapsed = Math.max(1, workingDays(yr, mi, dayNum))
    const projected = Math.round((monthlyTotal / elapsed) * workingDays(yr, mi))
    return { monthlyTotal, ytdTotal, yesterdayTotal, projected, invoiceCount: invs.length }
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
    const accountId = await getMailAccountId(token)
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

async function getCalendarEvents() {
  // Self-call the existing (unauthenticated) calendar route — reuses the tested
  // Zoho + Google-family-calendar logic without duplicating it.
  return (await safe('calendar', async () => {
    const r = await axios.get(`${SELF_BASE}/api/calendar/events`, {
      params: { date: todayStr() }, timeout: 5500,
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

async function buildBriefing(req, { only } = {}) {
  const today = todayStr()
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
  const jaden = jobs.filter(j => String(j.technician || '').toLowerCase().startsWith('jay'))
  const jadenToday = jaden.filter(j => j.scheduled_date === today)
  const openJobs = jobs.filter(j => j.status && j.status !== 'complete')
  const followups = shops.filter(s => s.next_followup && s.next_followup <= today)
  const dueToday = commitments.filter(c => c.due === today)
  const overdue = commitments.filter(c => c.due && c.due < today)
  const outbound = commitments.filter(c => c.direction === 'outbound')

  return {
    today, jobs, revenue, shops, commitments, todaysJobs, jaden, jadenToday, openJobs,
    followups, dueToday, overdue, outbound, events, timings,
    sources: { cliqBlocks: cliqBlocks.length, emailBlocks: emailBlocks.length, crmError: lastCrmError, cliqProbe: lastCliqProbe },
  }
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

function formatDigest(b) {
  const proj = b.revenue ? money(b.revenue.projected || 0) : 'n/a'
  const mtd = b.revenue ? money(b.revenue.monthlyTotal || 0) : 'n/a'
  return `Briefing ${b.today}. Rev ${mtd} MTD, projecting ${proj} of ${money(TARGET)}. Jobs today ${b.todaysJobs.length} (Jaden ${b.jadenToday.length}). Events ${b.events.length}. Follow-ups ${b.followups.length}. Commitments due ${b.dueToday.length}, overdue ${b.overdue.length}. Full brief in Cliq.`
}

// ---------- send + routes ----------

export async function sendDailyBriefing(req, { dry = false, only } = {}) {
  const b = await buildBriefing(req, { only })
  const full = formatFull(b)
  const digest = formatDigest(b)
  if (dry) {
    return { ok: true, dry: true, digest, full, commitments: b.commitments, timings: b.timings, sources: b.sources,
      counts: { jobsToday: b.todaysJobs.length, events: b.events.length, dueToday: b.dueToday.length, overdue: b.overdue.length, followups: b.followups.length, shops: b.shops.length } }
  }
  const sent = { cliq: false, sms: false }
  // postToCliqChannelById returns undefined on success — map to true explicitly
  const r = await safe('cliq-send', () => postToCliqChannelById(MARK_ALERT_CHANNEL_ID, full).then(() => true))
  sent.cliq = !!r
  // Mark's number lives in the MARK_PHONE_NUMBER env var
  const to = (process.env.MARK_PHONE_NUMBER || '').trim()
  if (to) { const s = await safe('sms', () => sendSMS(req, { to, body: digest, category: 'briefing' })); sent.sms = !!s }
  return { ok: true, sent, digest }
}

router.get('/debug', async (req, res) => {
  const b = await buildBriefing(req, { only: req.query.only })
  res.json({
    ok: true, summary: formatDigest(b), full: formatFull(b),
    commitments: b.commitments, revenue: b.revenue, timings: b.timings, sources: b.sources,
    counts: { jobsToday: b.todaysJobs.length, jadenToday: b.jadenToday.length, openJobs: b.openJobs.length, events: b.events.length, followups: b.followups.length, dueToday: b.dueToday.length, overdue: b.overdue.length, shops: b.shops.length },
  })
})
router.get('/preview', async (req, res) => { const b = await buildBriefing(req); res.type('text/plain').send(formatFull(b)) })
router.post('/send', async (req, res) => { res.json(await sendDailyBriefing(req)) })

export default router
