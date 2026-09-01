// Morning kickoff — daily good-morning + sales digest.
//
// Rebuilt 2026-07-06 after Mark noticed the whole morning-kickoff had
// silently stopped. Restores what was described in earlier working notes
// but never made it into the tracked repo:
//   • 7am DM to Kat + Joyce — warm day-of-week greeting, no sales
//   • 7am DM to Mark (→ his channel, since self-DM is blocked)
//     and to Jayden — greeting + yesterday's sales + MTD $ / goal +
//     jobs on today's board
//   • Day-of-week aware opener:
//       Mon → "Happy Monday!"
//       Tue → "Happy Tuesday!"
//       Wed → "Halfway there!"
//       Thu → "Almost Friday!"
//       Fri → "Happy Friday! Here we go — GET SOME!!!"
//       Sat/Sun → skipped (shop is closed)
//
// Cron-fired POST /api/cron/daily-greeting (x-cron-secret header).
// Suggested Catalyst cron: daily at 07:30 America/Los_Angeles.
// Env var: MORNING_CRON_SECRET (falls back to 'morning-2026').

import express from 'express'
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { listInvoicesForDateRange } from '../services/zoho.js'
import {
  postToCliqUser, postToCliqChannel, postToCliqChannelById,
  MARK_ALERT_CHANNEL_ID, TECHNICIANS_CHANNEL,
} from '../services/cliq.js'

const router = express.Router()

const DEFAULT_MONTHLY_GOAL = 20000
const JOBS_TABLE = 'Jobs'
const CRON_SECRET_FALLBACK = 'morning-2026'

// Full roster. Techs get sales digests; non-techs get warm greetings only.
// `to` is passed straight to postToCliqUser — accepts numeric ID OR email.
const RECIPIENTS = [
  { name: 'Mark',   type: 'tech',    to: null,                          markChannel: true },
  { name: 'Jayden', type: 'tech',    to: 'jayden@absoluteadas.com' },
  { name: 'Kat',    type: 'greet',   to: 914153354 },
  { name: 'Joyce',  type: 'greet',   to: 'joyce@absoluteadas.com' },
]

function requireCronSecret(req, res, next) {
  const expected = String(process.env.MORNING_CRON_SECRET || CRON_SECRET_FALLBACK).trim()
  const got = String(
    req.headers['x-cron-secret']
    || req.headers['x_cron_secret']
    || req.query.secret
    || ''
  ).trim()
  if (!expected || got !== expected) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// PT calendar helpers.
function todayPT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
function yesterdayPT(todayStr) {
  return daysAgoPT(todayStr, 1)
}
function daysAgoPT(todayStr, n) {
  const d = new Date(todayStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
function monthStartPT(todayStr) {
  return todayStr.slice(0, 7) + '-01'
}
function weekdayPT() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'long',
  }).format(new Date())
}

// Day-of-week opener. First line of every message. Weekend keys return
// null so the caller can skip the send entirely on Sat/Sun.
function dayOfWeekOpener(weekday) {
  switch (weekday) {
    case 'Monday':    return '☀️ Happy Monday!'
    case 'Tuesday':   return '☀️ Happy Tuesday!'
    case 'Wednesday': return '🐫 Happy Wednesday — halfway there!'
    case 'Thursday':  return '👀 Almost Friday!'
    case 'Friday':    return '🎉 Happy Friday! Big finish.'
    default:          return null   // Saturday/Sunday — skip
  }
}

function invoiceBelongsToTech(inv, tech) {
  const sp = String(inv.salesperson_name || '').toLowerCase().trim()
  const t  = String(tech || '').toLowerCase().trim()
  if (!sp || !t) return false
  return sp.includes(t) || t.includes(sp)
}

async function countTodaysJobsForTech(req, techName, dateStr) {
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const table = app.datastore().table(JOBS_TABLE)
    const rows = await table.getAllRows()
    const t = String(techName || '').toLowerCase()
    const ACTIVE = new Set(['dispatched_mark', 'dispatched_jaden', 'pending_parts', 'ready_invoice'])
    return rows.filter(r => {
      if (!ACTIVE.has(r.status)) return false
      if ((r.scheduled_date || '').slice(0, 10) !== dateStr) return false
      const rowTech = String(r.technician || '').toLowerCase()
      if (rowTech.includes(t) || t.includes(rowTech)) return true
      if (t.includes('mark')   && r.status === 'dispatched_mark')  return true
      if (t.includes('jayden') && r.status === 'dispatched_jaden') return true
      return false
    }).length
  } catch (e) {
    console.warn('[daily-greeting] countTodaysJobsForTech failed:', e.message)
    return 0
  }
}

function fmtUSD(n) {
  return `$${Math.round(n || 0).toLocaleString('en-US')}`
}

// Warm short greeting for Kat + Joyce — no sales numbers, just the DOW
// opener and a friendly tail.
// Exact format per Mark 2026-09-01: "Happy Tuesday Kat - Lets get some!!!"
function buildGreetingMessage({ name, weekday }) {
  return `Happy ${weekday} ${name} — Let's get some!!!`
}

// Sales digest for a technician. Adds the reference day's sales + MTD $
// and today's dispatched jobs on top of the DOW opener. On Mondays the
// reference day is FRIDAY (yesterday = Sunday = automatic goose egg,
// Mark 2026-07-13) and a last-week total rides along.
function buildTechDigestMessage({ techName, opener, refLabel, refSales, weekTotal, mtd, goal, jobsToday }) {
  const pct = Math.min(100, Math.round((mtd / Math.max(1, goal)) * 100))
  const goalGap = Math.max(0, goal - mtd)
  const cheer =
    pct >= 100 ? `🔥 You blew past the ${fmtUSD(goal)} goal. Stack it.`
    : pct >= 75 ? `Only ${fmtUSD(goalGap)} from the ${fmtUSD(goal)} goal — real close.`
    : pct >= 50 ? `Halfway there — ${fmtUSD(goalGap)} to the ${fmtUSD(goal)} goal.`
    : pct >= 25 ? `Solid start — ${fmtUSD(goalGap)} to close out the month.`
    : `Fresh page. ${fmtUSD(goalGap)} to the ${fmtUSD(goal)} goal.`
  const jobsLine = jobsToday > 0
    ? `📋 ${jobsToday} ${jobsToday === 1 ? 'job' : 'jobs'} on your board today.`
    : `📋 No dispatched jobs on the board yet — check back at 8am.`
  return [
    `${opener} Morning ${techName}.`,
    ``,
    `📈 ${refLabel} sales: *${fmtUSD(refSales)}*`,
    ...(weekTotal != null ? [`🗓 Last week's total: *${fmtUSD(weekTotal)}*`] : []),
    `📊 MTD: *${fmtUSD(mtd)}* of ${fmtUSD(goal)} (${pct}%)`,
    jobsLine,
    ``,
    cheer,
  ].join('\n')
}

// Route ANY recipient's message with a graceful fallback.
//   • markChannel: true → post to Mark alert channel (self-DM blocked)
//   • else → DM via postToCliqUser(to, ...)
//   • on DM failure → post to #technicians with "Hey ${name}!" preface
async function deliver(recipient, msg) {
  const { name, markChannel, to } = recipient
  try {
    if (markChannel) {
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg)
      return { ok: true, via: 'mark-channel' }
    }
    await postToCliqUser(to, msg)
    return { ok: true, via: 'dm' }
  } catch (e) {
    const primaryErr = e.message
    try {
      await postToCliqChannel(TECHNICIANS_CHANNEL, `Hey ${name}!\n\n${msg}`)
      return { ok: true, via: 'tech-channel-fallback', warning: primaryErr }
    } catch (e2) {
      return { ok: false, error: `${primaryErr}; fallback also failed: ${e2.message}` }
    }
  }
}

// Exported so the existing /api/cron/daily-briefing (routes/briefing.js
// → sendDailyBriefing) can piggyback this side of the morning routine on
// the cron trigger that's already set up in Catalyst — one console cron
// fires both Mark's own briefing and the whole-team good-morning fan-out.
export async function sendMorningKickoff(req) {
  const dateStr = todayPT()
  const yesterday = yesterdayPT(dateStr)
  const monthStart = monthStartPT(dateStr)
  const weekday = weekdayPT()
  const opener = dayOfWeekOpener(weekday)

  // Skip weekends entirely. Sat/Sun = shop closed; no need to bug the team.
  if (!opener) return { date: dateStr, weekday, skipped: 'weekend', results: [] }

  // Monday special-case (Mark 2026-07-13): yesterday is Sunday — always
  // a goose egg. Report FRIDAY's sales instead, plus a total for the
  // week that just ended (last Monday through Sunday).
  const isMonday = weekday === 'Monday'
  const refDay = isMonday ? daysAgoPT(dateStr, 3) : yesterday
  const refLabel = isMonday ? "Friday's" : "Yesterday's"
  const lastMonday = daysAgoPT(dateStr, 7)

  // One Zoho fetch covers every tech. On Mondays the window widens to
  // cover last week even when it crosses a month boundary; MTD sums are
  // still gated to monthStart below.
  const fetchStart = (isMonday && lastMonday < monthStart) ? lastMonday : monthStart
  const invoices = await listInvoicesForDateRange(fetchStart, dateStr)

  const results = []
  for (const r of RECIPIENTS) {
    let msg
    let mtd = 0, refSales = 0, weekTotal = 0, jobsToday = 0
    if (r.type === 'tech') {
      for (const inv of invoices) {
        if (!invoiceBelongsToTech(inv, r.name)) continue
        const t = Number(inv.total || 0) || 0
        const d = String(inv.date || '').slice(0, 10)
        if (d >= monthStart) mtd += t
        if (d === refDay) refSales += t
        if (isMonday && d >= lastMonday && d <= yesterday) weekTotal += t
      }
      jobsToday = await countTodaysJobsForTech(req, r.name, dateStr)
      msg = buildTechDigestMessage({
        techName: r.name, opener,
        refLabel, refSales,
        weekTotal: isMonday ? weekTotal : null,
        mtd, goal: DEFAULT_MONTHLY_GOAL, jobsToday,
      })
    } else {
      msg = buildGreetingMessage({ name: r.name, weekday })
    }

    const outcome = await deliver(r, msg)
    results.push({
      recipient: r.name,
      type: r.type,
      ...(r.type === 'tech' ? { mtd, refDay, refSales, ...(isMonday ? { weekTotal } : {}), jobsToday } : {}),
      ...outcome,
    })
  }
  return { date: dateStr, weekday, results }
}

// ── Piggyback scheduler ─────────────────────────────────────────────────────
//
// Mark is out of Catalyst cron slots, so we can't add a dedicated 7:30am
// entry for this. Instead we ride on postscan-fetcher (hourly, already
// running) via maybeFireMorningKickoff. Two guards keep it sane:
//
//   1. Time window — only fire 7:30–8:00 PT (Mark's ask 2026-07-07).
//      The postscan cron ticks in that window, we send. Outside the
//      window, no-op. If postscan happens to skip the window entirely
//      on some tick, the greeting won't fire that day — widen the
//      minute range below if that becomes a pattern.
//   2. Once-per-day dedup — Catalyst Cache key `morning_kickoff_YYYY-MM-DD`.
//      Once we send today's kickoff we stamp the key with a 25h TTL. The
//      next postscan tick sees the key and skips. Rolls over naturally
//      at midnight.
//
// Any failure inside is caught and logged — postscan never breaks over
// this piggyback.
const CATALYST_API = 'https://api.catalyst.zoho.com'

// Delivery window (PT) — hour and minute inclusive on the low side,
// exclusive on the high side. Currently 07:00 ≤ t < 08:00 (per Mark
// 2026-07-07 — widened from 07:30 so any postscan cron minute in the
// 7am hour will catch it).
const KICKOFF_WINDOW_START_H = 7
const KICKOFF_WINDOW_START_M = 0
const KICKOFF_WINDOW_END_H   = 8
const KICKOFF_WINDOW_END_M   = 0

function catalystHeaders(req) {
  const token = req.headers['x-zc-admin-cred-token'] || req.headers['x-zc-user-cred-token'] || ''
  return { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }
}
function catalystProjectId(req) {
  return req.headers['x-zc-projectid'] || process.env.CATALYST_PROJECT_ID || ''
}

function hourMinutePT() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const hStr = parts.find(p => p.type === 'hour')?.value || '0'
  const mStr = parts.find(p => p.type === 'minute')?.value || '0'
  // Intl may return '24' at midnight — normalise to 0.
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  return { h: h === 24 ? 0 : h, m }
}

function isInKickoffWindow(h, m) {
  const startTotal = KICKOFF_WINDOW_START_H * 60 + KICKOFF_WINDOW_START_M
  const endTotal   = KICKOFF_WINDOW_END_H   * 60 + KICKOFF_WINDOW_END_M
  const nowTotal   = h * 60 + m
  return nowTotal >= startTotal && nowTotal < endTotal
}

async function readKickoffFiredKey(req, dateStr) {
  const key = `morning_kickoff_${dateStr}`
  const url = `${CATALYST_API}/baas/v1/project/${catalystProjectId(req)}/cache/${key}`
  try {
    const r = await axios.get(url, { headers: catalystHeaders(req) })
    return r.data?.data?.cache_value || null
  } catch (e) {
    if (e.response?.status === 404) return null
    throw e
  }
}

async function stampKickoffFired(req, dateStr) {
  const key = `morning_kickoff_${dateStr}`
  const baseUrl = `${CATALYST_API}/baas/v1/project/${catalystProjectId(req)}/cache`
  const headers = catalystHeaders(req)
  const value = new Date().toISOString()
  try {
    await axios.put(`${baseUrl}/${key}`, { cache_value: value, expiry_in_hours: 25 }, { headers })
  } catch (e) {
    if (e.response?.status === 404) {
      await axios.post(baseUrl, { cache_name: key, cache_value: value, expiry_in_hours: 25 }, { headers })
    } else {
      throw e
    }
  }
}

// Piggyback entry point — called from postscan.js /run (and any other
// hourly cron we want as a fallback). Returns a small status object; all
// exceptions are caught and returned as { fired: false, error }.
export async function maybeFireMorningKickoff(req) {
  const dateStr = todayPT()
  const { h, m } = hourMinutePT()
  if (!isInKickoffWindow(h, m)) {
    return { fired: false, reason: `outside window (${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} PT)` }
  }
  try {
    const already = await readKickoffFiredKey(req, dateStr)
    if (already) return { fired: false, reason: 'already sent today', at: already }
  } catch (e) {
    console.warn('[kickoff-dedup] cache read failed, will send anyway:', e.message)
  }
  try {
    const summary = await sendMorningKickoff(req)
    try { await stampKickoffFired(req, dateStr) }
    catch (e) { console.warn('[kickoff-dedup] cache stamp failed (kickoff sent OK):', e.message) }
    return { fired: true, ...summary }
  } catch (e) {
    console.error('[kickoff] send failed:', e.message)
    return { fired: false, error: e.message }
  }
}

// Cron-fired endpoint — same once-per-day dedup as the piggyback (the
// unguarded direct call double-greeted Kat on 2026-09-01: Catalyst cron
// at 7:49 after the piggyback's 7:04 send). ?force=1 for manual tests.
router.post('/', requireCronSecret, async (req, res) => {
  try {
    if (req.query.force !== '1') {
      const dateStr = todayPT()
      try {
        const already = await readKickoffFiredKey(req, dateStr)
        if (already) return res.json({ ok: true, fired: false, reason: 'already sent today', at: already })
      } catch { /* cache miss — proceed */ }
    }
    const summary = await sendMorningKickoff(req)
    try { await stampKickoffFired(req, todayPT()) } catch { /* sent OK */ }
    res.json({ ok: true, ...summary })
  } catch (e) {
    console.error('[daily-greeting]', e.message, e.stack)
    res.status(500).json({ error: e.message })
  }
})

// Manual "run now" — same auth. Useful for testing without waiting for
// the cron window. Runs 7 days a week (does NOT enforce the weekend skip)
// so you can inspect the shape whenever.
router.post('/run', requireCronSecret, async (req, res) => {
  try {
    const summary = await sendMorningKickoff(req)
    res.json({ ok: true, ...summary })
  } catch (e) {
    console.error('[daily-greeting run]', e.message, e.stack)
    res.status(500).json({ error: e.message })
  }
})

export default router
