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
  const d = new Date(todayStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
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
    case 'Wednesday': return '🐫 Halfway there!'
    case 'Thursday':  return '👀 Almost Friday!'
    case 'Friday':    return '🎉 Happy Friday! Here we go — GET SOME!!!'
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
function buildGreetingMessage({ name, opener }) {
  return [
    opener,
    ``,
    `Good morning ${name}. Hope you've got a great one lined up.`,
  ].join('\n')
}

// Sales digest for a technician. Adds yesterday's + MTD $ and today's
// dispatched jobs on top of the DOW opener.
function buildTechDigestMessage({ techName, opener, yesterday, mtd, goal, jobsToday }) {
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
    `📈 Yesterday's sales: *${fmtUSD(yesterday)}*`,
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

  // One Zoho fetch covers every tech.
  const invoices = await listInvoicesForDateRange(monthStart, dateStr)

  const results = []
  for (const r of RECIPIENTS) {
    let msg
    let mtd = 0, yesterdaySales = 0, jobsToday = 0
    if (r.type === 'tech') {
      for (const inv of invoices) {
        if (!invoiceBelongsToTech(inv, r.name)) continue
        const t = Number(inv.total || 0) || 0
        mtd += t
        if (String(inv.date || '').slice(0, 10) === yesterday) yesterdaySales += t
      }
      jobsToday = await countTodaysJobsForTech(req, r.name, dateStr)
      msg = buildTechDigestMessage({
        techName: r.name, opener,
        yesterday: yesterdaySales, mtd,
        goal: DEFAULT_MONTHLY_GOAL, jobsToday,
      })
    } else {
      msg = buildGreetingMessage({ name: r.name, opener })
    }

    const outcome = await deliver(r, msg)
    results.push({
      recipient: r.name,
      type: r.type,
      ...(r.type === 'tech' ? { mtd, yesterday: yesterdaySales, jobsToday } : {}),
      ...outcome,
    })
  }
  return { date: dateStr, weekday, results }
}

// Cron-fired endpoint.
router.post('/', requireCronSecret, async (req, res) => {
  try {
    const summary = await sendMorningKickoff(req)
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
