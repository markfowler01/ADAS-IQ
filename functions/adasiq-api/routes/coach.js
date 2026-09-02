// Coach — the context bridge and the weekly learning pass.
//
// WHY A CONTEXT ENDPOINT EXISTS: Mark's goals and the coaching notes live in
// the Obsidian vault on his Mac (iCloud), which Catalyst cannot read. So the
// vault bridge pushes them UP here each morning before the brief runs, and
// pulls the ledger back DOWN afterward to write into the vault. Catalyst is
// the brain, the local bridge is the hands — same split the Ops System spec set.
//
// Endpoints (x-cron-secret, same as briefing/evening):
//   GET  /api/coach/context      -> goals + coaching notes currently in play
//   POST /api/coach/context      -> bridge pushes {goals, coaching_notes}
//   GET  /api/coach/ledger       -> full ledger, for the bridge to write to vault
//   GET  /api/coach/weekly/debug -> run the review, return it, write nothing
//   POST /api/coach/weekly/run   -> run the review, store notes, deliver

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { listDays, summarize, deleteDay } from '../services/dayLedger.js'
import { weeklyReview, planWeek } from '../services/dayCoach.js'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from '../services/cliq.js'
import { sendSMS } from '../services/comms.js'
import { ptDate } from '../services/ptDate.js'
import { gatherWeekAhead } from './briefing.js'

const router = express.Router()

const CONTEXT_KEY = 'coach_context'
const WEEKPLAN_KEY = 'week_plan'
const CONTEXT_TTL_HOURS = 48   // refreshed by the bridge daily; vault is the source

router.use((req, res, next) => {
  const secret = (process.env.BRIEFING_CRON_SECRET || process.env.MORNING_CRON_SECRET || 'morning-2026').trim()
  const provided = (req.headers['x-cron-secret'] || req.query.k || '').trim()
  if (provided === secret) return next()
  return res.status(401).json({ error: 'Unauthorized' })
})

function segment(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.cache().segment()
}

export async function readContext(req) {
  try {
    const val = await segment(req).getValue(CONTEXT_KEY)
    if (!val) return { goals: '', coaching_notes: '' }
    const o = typeof val === 'string' ? JSON.parse(val) : val
    return { goals: o.goals || '', coaching_notes: o.coaching_notes || '', updated_at: o.updated_at || '' }
  } catch (e) {
    console.warn('[coach context read]', e.message)
    return { goals: '', coaching_notes: '' }
  }
}

export async function writeContext(req, patch) {
  const prev = await readContext(req)
  const next = {
    goals: patch.goals !== undefined ? String(patch.goals).slice(0, 12000) : prev.goals,
    coaching_notes: patch.coaching_notes !== undefined
      ? String(patch.coaching_notes).slice(0, 6000) : prev.coaching_notes,
    updated_at: new Date().toISOString(),
  }
  const val = JSON.stringify(next)
  const seg = segment(req)
  try { await seg.update(CONTEXT_KEY, val) }
  catch { await seg.put(CONTEXT_KEY, val, CONTEXT_TTL_HOURS) }
  return next
}

// ── weekly review ────────────────────────────────────────────────────────────

function last7(days) {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  return days.filter(d => d.date >= cutoff)
}

export function formatReview(review, stats) {
  if (!review) return 'Weekly review: not enough recorded days to say anything useful yet.'
  const L = [`Weekly review — ${review.headline}`, '']
  const avg = stats.avgRating === null ? '—' : stats.avgRating.toFixed(1)
  const b3 = stats.avgBig3HitRate === null ? '—' : `${Math.round(stats.avgBig3HitRate * 100)}%`
  L.push(`${stats.rated} of ${stats.days} days rated, averaging ${avg}. Big 3 hit rate ${b3}.`)
  if (stats.missedCheckins.length) L.push(`No check-in on: ${stats.missedCheckins.join(', ')}.`)
  L.push('')
  if (review.what_worked?.length) { L.push('Worked:'); review.what_worked.forEach(x => L.push(`- ${x}`)); L.push('') }
  if (review.what_didnt?.length) { L.push("Didn't:"); review.what_didnt.forEach(x => L.push(`- ${x}`)); L.push('') }
  if (review.pattern) { L.push(`The pattern: ${review.pattern}`); L.push('') }
  if (review.next_week) L.push(`Next week: ${review.next_week}`)
  return L.join('\n')
}

export async function runWeeklyReview(req, { dry = false } = {}) {
  const all = await listDays(req, { limit: 60 })
  const week = last7(all)
  const stats = summarize(week)
  const ctx = await readContext(req)

  // Two rated days is the floor for saying anything about a "week". Below that
  // the model will happily invent a pattern out of noise.
  if (stats.rated < 2) {
    const msg = `Weekly review skipped — only ${stats.rated} rated ${stats.rated === 1 ? 'day' : 'days'} this week. ` +
                `Answer the evening text and this gets useful fast.`
    if (!dry) {
      try { await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg) } catch (e) { console.warn('[weekly cliq]', e.message) }
    }
    return { ok: true, skipped: true, reason: 'insufficient_data', stats, message: msg }
  }

  const review = await weeklyReview(req, { days: week, goals: ctx.goals, priorNotes: ctx.coaching_notes })
  const text = formatReview(review, stats)
  if (dry) return { ok: true, dry: true, stats, review, text }

  if (review?.coaching_notes) {
    await writeContext(req, { coaching_notes: review.coaching_notes })
  }

  const sent = { cliq: false, sms: false }
  try { await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, text); sent.cliq = true }
  catch (e) { console.warn('[weekly cliq]', e.message) }

  const to = (process.env.MARK_PHONE_NUMBER || '').trim()
  if (to && review?.headline) {
    const sms = `Weekly review: ${review.headline}${review.next_week ? ` Next week: ${review.next_week}` : ''}`.slice(0, 600)
    try { await sendSMS(req, { to, body: sms, category: 'weekly_review' }); sent.sms = true }
    catch (e) { console.warn('[weekly sms]', e.message) }
  }

  return { ok: true, date: ptDate(), stats, review, text, sent }
}

export function formatWeekPlan(p) {
  if (!p) return 'Week plan unavailable.'
  const L = [`Week ahead — ${p.theme}`, '']
  if (p.outcomes?.length) { L.push('Outcomes:'); p.outcomes.forEach((o, i) => L.push(`${i + 1}. ${o}`)); L.push('') }
  if (p.days?.length) {
    L.push('The week:')
    p.days.forEach(d => L.push(`- ${d.day}: ${d.focus}${d.note ? ` (${d.note})` : ''}`))
    L.push('')
  }
  if (p.prep?.length) { L.push('Prep ahead:'); p.prep.forEach(x => L.push(`- ${x}`)); L.push('') }
  if (p.say_no_to?.length) { L.push('Say no to:'); p.say_no_to.forEach(x => L.push(`- ${x}`)) }
  return L.join('\n')
}

// Sunday 3 PM. Reviews the week that just ended, then plans the next one —
// in that order, because the review is an input to the plan.
async function readWeekPlan(req) {
  try {
    const v = await segment(req).getValue(WEEKPLAN_KEY)
    if (!v) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  } catch { return null }
}

async function writeWeekPlan(req, obj) {
  const val = JSON.stringify(obj)
  const seg = segment(req)
  try { await seg.update(WEEKPLAN_KEY, val) } catch { await seg.put(WEEKPLAN_KEY, val, 48) }
}

// COMPUTE and DELIVER are separate calls on purpose.
//
// planWeek is an Opus call over a full week of context and takes ~40s. The
// Catalyst gateway kills the HTTP request at 30s, so a single compute+send
// endpoint 408s before it ever reaches the send — which is exactly what it did
// on the first live run. The inner handler keeps executing server-side after
// the gateway gives up, so compute stores its result and a second, fast call
// delivers it. Same split absoluteadas-cron-runner uses for the long drafters.
export async function computeWeekPlan(req) {
  const [weekAhead, ctx, all] = await Promise.all([
    gatherWeekAhead(req), readContext(req), listDays(req, { limit: 14 }),
  ])
  const plan = await planWeek(req, {
    goals: ctx.goals,
    coachingNotes: ctx.coaching_notes,
    weekAhead,
    lastWeek: last7(all),
    review: ctx.coaching_notes || null,
    today: ptDate(),
  })
  if (plan) await writeWeekPlan(req, { date: ptDate(), plan, computed_at: new Date().toISOString() })
  return plan
}

export async function deliverWeekPlan(req, { dry = false } = {}) {
  const stored = await readWeekPlan(req)
  if (!stored?.plan) return { ok: false, error: 'no plan computed yet — run compute first' }
  const plan = stored.plan
  const text = formatWeekPlan(plan)
  if (dry) return { ok: true, dry: true, plan, text, computed_at: stored.computed_at }

  const sent = { cliq: false, sms: false }
  try { await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, text); sent.cliq = true }
  catch (e) { console.warn('[weekplan cliq]', e.message) }
  const to = (process.env.MARK_PHONE_NUMBER || '').trim()
  if (to && plan?.theme) {
    const sms = `Week ahead: ${plan.theme}\n` + (plan.outcomes || []).map((x, i) => `${i + 1}. ${x}`).join('\n')
    try { await sendSMS(req, { to, body: sms.slice(0, 700), category: 'week_plan' }); sent.sms = true }
    catch (e) { console.warn('[weekplan sms]', e.message) }
  }
  return { ok: true, date: stored.date, plan, text, sent }
}

export async function runWeeklyPlanner(req, { dry = false } = {}) {
  // Deliberately does NOT re-run the review. sunday.sh runs the real review
  // first, which stores its conclusions into coaching_notes — this reads those.
  // Running it inline meant two Opus calls in one request and a hard 408 at
  // the 30s gateway cap.
  const [weekAhead, ctx, all] = await Promise.all([
    gatherWeekAhead(req), readContext(req), listDays(req, { limit: 14 }),
  ])
  const plan = await planWeek(req, {
    goals: ctx.goals,
    coachingNotes: ctx.coaching_notes,
    weekAhead,
    lastWeek: last7(all),
    review: ctx.coaching_notes || null,
    today: ptDate(),
  })
  const text = formatWeekPlan(plan)
  if (dry) return { ok: !!plan, dry: true, plan, text, notesUsed: !!ctx.coaching_notes }

  const sent = { cliq: false, sms: false }
  try { await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, text); sent.cliq = true }
  catch (e) { console.warn('[weekplan cliq]', e.message) }
  const to = (process.env.MARK_PHONE_NUMBER || '').trim()
  if (to && plan?.theme) {
    const sms = `Week ahead: ${plan.theme}\n` +
      (plan.outcomes || []).map((o, i) => `${i + 1}. ${o}`).join('\n')
    try { await sendSMS(req, { to, body: sms.slice(0, 700), category: 'week_plan' }); sent.sms = true }
    catch (e) { console.warn('[weekplan sms]', e.message) }
  }
  return { ok: !!plan, plan, text, sent }
}

// ── routes ───────────────────────────────────────────────────────────────────

router.get('/context', async (req, res) => res.json({ ok: true, ...(await readContext(req)) }))

router.post('/context', async (req, res) => {
  const { goals, coaching_notes } = req.body || {}
  if (goals === undefined && coaching_notes === undefined) {
    return res.status(400).json({ ok: false, error: 'send goals and/or coaching_notes' })
  }
  res.json({ ok: true, context: await writeContext(req, { goals, coaching_notes }) })
})

router.get('/ledger', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '90', 10) || 90, 200)
  const days = await listDays(req, { limit })
  res.json({ ok: true, count: days.length, stats: summarize(days), days })
})

router.delete('/ledger/:date', async (req, res) => {
  try { res.json({ ok: true, ...(await deleteDay(req, req.params.date)) }) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get('/weekly/debug', async (req, res) => {
  try { res.json(await runWeeklyReview(req, { dry: true })) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.post('/weekly/plan/compute', async (req, res) => {
  try { const p = await computeWeekPlan(req); res.json({ ok: !!p, plan: p }) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.post('/weekly/plan/deliver', async (req, res) => {
  try { res.json(await deliverWeekPlan(req, { dry: req.query.dry === '1' })) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get('/weekly/plan/debug', async (req, res) => {
  try { res.json(await runWeeklyPlanner(req, { dry: true })) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.post('/weekly/plan', async (req, res) => {
  try { res.json(await runWeeklyPlanner(req)) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.post('/weekly/run', async (req, res) => {
  try { res.json(await runWeeklyReview(req)) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

export default router
