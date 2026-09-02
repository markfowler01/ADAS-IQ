// Evening check-in — the half of the loop that listens.
//
// ~8:30 PM PT the cron fires sendEveningCheckin(). It texts Mark a recap of the
// Big 3 he committed to this morning plus the two questions, and parks a
// "pending" marker in cache. When his reply lands on the Twilio inbound webhook
// (routes/sms.js), that handler sees the marker, hands the text to
// dayCoach.parseCheckin, and writes the result into the day ledger.
//
// The reply is parsed INLINE in the webhook — Catalyst can't fire-and-forget
// after responding, and Twilio times out around 15s, which is why the parse
// runs on Haiku. See services/dayCoach.js.
//
// Endpoints (gated by the same cron secret the morning briefing uses):
//   GET  /api/evening/debug   -> what tonight's text would say, no send
//   POST /api/evening/send    -> build + send now
//   GET  /api/evening/pending -> inspect the pending marker

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { sendSMS } from '../services/comms.js'
import { postToCliqChannelById, ADA_CHANNEL_ID } from '../services/cliq.js'
import { getDay, upsertDay, recordCheckin } from '../services/dayLedger.js'
import { parseCheckin, reviewDay, closeDay } from '../services/dayCoach.js'
import { ptDate } from '../services/ptDate.js'
import { gatherDayReview } from './briefing.js'

const router = express.Router()

const PENDING_KEY = 'evening_pending'
const PENDING_TTL_HOURS = 24
// A reply is only treated as a check-in answer inside this window. After it,
// a text from Mark is just a text — he shouldn't have tonight's rating
// silently overwritten by tomorrow's "hey are you around".
const REPLY_WINDOW_MS = 14 * 60 * 60 * 1000

router.use((req, res, next) => {
  const secret = (process.env.BRIEFING_CRON_SECRET || process.env.MORNING_CRON_SECRET || 'morning-2026').trim()
  const provided = (req.headers['x-cron-secret'] || req.query.k || '').trim()
  if (provided === secret) return next()
  return res.status(401).json({ error: 'Unauthorized' })
})

export { ptDate } from '../services/ptDate.js'

function segment(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.cache().segment()
}

export async function readPending(req) {
  try {
    const val = await segment(req).getValue(PENDING_KEY)
    if (!val) return null
    return typeof val === 'string' ? JSON.parse(val) : val
  } catch (e) {
    console.warn('[evening pending read]', e.message)
    return null
  }
}

async function writePending(req, obj) {
  const val = JSON.stringify(obj)
  const seg = segment(req)
  try { await seg.update(PENDING_KEY, val) }
  catch { await seg.put(PENDING_KEY, val, PENDING_TTL_HOURS) }
}

export async function clearPending(req) {
  try { await writePending(req, { cleared_at: new Date().toISOString() }) }
  catch (e) { console.warn('[evening pending clear]', e.message) }
}

// ── the message ──────────────────────────────────────────────────────────────

export function formatCheckin(day) {
  const L = []
  const big3 = day?.big3 || []
  if (big3.length) {
    L.push('End of day. Your Big 3 were:')
    big3.forEach((b, i) => L.push(`${i + 1}. ${b.text}`))
    if (day.hard_thing?.text) L.push(`Hard thing: ${day.hard_thing.text}`)
    L.push('')
    L.push('Which ones landed? Rate the day 1-10 and tell me what made it that.')
  } else {
    // No Big 3 on file — either the morning brief didn't run or he never got
    // one set. Still worth asking; a rated day with no plan is useful data.
    L.push('End of day. No Big 3 on file for today.')
    L.push('')
    L.push('How did it go? Rate the day 1-10 and tell me what made it that.')
  }
  return L.join('\n')
}

export async function sendEveningCheckin(req, { dry = false } = {}) {
  const date = ptDate()
  const day = await getDay(req, date)

  // Review the day before asking about it. Gather what actually happened —
  // jobs closed, commitments due and overdue, promises outstanding, unread
  // mail, tomorrow's load — and let the coach lead with the part that matters.
  // Falls back to the plain question if either step fails; a missed review
  // must never cost him the check-in, because the check-in is the data.
  let body = null
  let reviewed = false
  try {
    const context = await gatherDayReview(req)
    body = await reviewDay(req, {
      context, date,
      big3: day?.big3 || [],
      hardThing: day?.hard_thing?.text || '',
    })
    reviewed = !!body
  } catch (e) {
    console.warn('[evening review]', e.message)
  }
  if (!body) body = formatCheckin(day)
  if (dry) return { ok: true, dry: true, date, body, reviewed, big3: day?.big3 || [] }

  const to = (process.env.MARK_PHONE_NUMBER || '').trim()
  if (!to) return { ok: false, error: 'MARK_PHONE_NUMBER not set' }

  let sent = false
  try {
    await sendSMS(req, { to, body, category: 'evening_checkin' })
    sent = true
  } catch (e) {
    console.error('[evening send]', e.message)
  }

  if (sent) {
    await writePending(req, {
      date,
      big3: (day?.big3 || []).map(b => ({ text: b.text })),
      hard_thing: day?.hard_thing?.text || '',
      sent_at: new Date().toISOString(),
    })
  }
  return { ok: sent, date, body, reviewed, sent }
}

async function safeClose(req, day) {
  try { return await closeDay(req, { day }) }
  catch (e) { console.warn('[evening close]', e.message); return null }
}

// ── handling the reply ───────────────────────────────────────────────────────

// Called from the Twilio inbound webhook when the sender is Mark. Returns
// { handled: false } when this text isn't a check-in answer, so the caller
// falls through to normal SMS handling.
export async function tryHandleCheckinReply(req, { from, body }) {
  const markPhone = (process.env.MARK_PHONE_NUMBER || '').trim()
  if (!markPhone || !from || from !== markPhone) return { handled: false, reason: 'not_mark' }

  const pending = await readPending(req)
  if (!pending?.date || !pending.sent_at) return { handled: false, reason: 'no_pending' }

  const age = Date.now() - new Date(pending.sent_at).getTime()
  if (!Number.isFinite(age) || age < 0 || age > REPLY_WINDOW_MS) {
    return { handled: false, reason: 'stale_pending' }
  }

  // Already answered tonight — treat further texts as ordinary messages rather
  // than overwriting a recorded day.
  const existing = await getDay(req, pending.date)
  if (existing?.checkin_at) return { handled: false, reason: 'already_answered' }

  const text = String(body || '').trim()
  if (!text) return { handled: false, reason: 'empty' }

  let parsed
  try {
    parsed = await parseCheckin(req, {
      reply: text, big3: pending.big3 || [], hardThing: pending.hard_thing,
    })
  } catch (e) {
    console.error('[evening parse]', e.message)
    return { handled: false, reason: 'parse_failed' }
  }

  const day = await recordCheckin(req, pending.date, parsed)
  await clearPending(req)

  const hit = (day.big3 || []).filter(b => b.done).length
  const total = (day.big3 || []).length

  // The day closes on an affirmation, the way the morning opens on one — but
  // written against the day he just described, not a stock line. Best-effort:
  // if it fails he still gets the receipt, because the logging is the point.
  const close = await safeClose(req, day)
  const ack = `Logged${day.rating ? ` — ${day.rating}/10` : ''}${total ? `, ${hit}/${total} on the Big 3` : ''}.` +
    (close ? `\n\n${close}` : ' Rest up.')
  try { await sendSMS(req, { to: markPhone, body: ack, category: 'evening_checkin' }) }
  catch (e) { console.warn('[evening ack]', e.message) }

  try {
    await postToCliqChannelById(ADA_CHANNEL_ID,
      `Day logged ${day.date}: ${day.rating ?? '—'}/10, Big 3 ${hit}/${total}` +
      `${day.win ? `\nWorked: ${day.win}` : ''}${day.drag ? `\nGot in the way: ${day.drag}` : ''}`)
  } catch (e) { console.warn('[evening cliq]', e.message) }

  return { handled: true, date: day.date, rating: day.rating, hit, total }
}

// ── routes ───────────────────────────────────────────────────────────────────

router.get('/debug', async (req, res) => res.json(await sendEveningCheckin(req, { dry: true })))
router.post('/send', async (req, res) => res.json(await sendEveningCheckin(req)))
router.get('/pending', async (req, res) => res.json({ ok: true, pending: await readPending(req) }))

// Manual re-file, for when a reply is missed or misparsed.
router.post('/record', async (req, res) => {
  const date = String(req.query.date || req.body?.date || ptDate())
  const patch = req.body?.patch || {}
  res.json({ ok: true, day: await upsertDay(req, date, patch) })
})

export default router
