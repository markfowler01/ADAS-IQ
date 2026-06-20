// Cron heartbeat helpers — shared across marketing routes + cron-monitor.
//
// A documented gotcha: Catalyst auto-disables a cron after 20 consecutive
// failures. Combined with weekly crons, an outage can go silent for weeks
// before anyone notices. Each cron route stamps two cache keys:
//
//   - "attempt"  — set BEFORE auth runs, so 401 failures still register.
//                  Tells us "the cron was invoked at the gateway."
//   - "success"  — set AFTER the handler completes its work. Tells us
//                  "the cron actually did its job, not just got called."
//
// The debug endpoint surfaces both ages. If attempt is stale but the cron is
// still listed as Active in the Console, the cron isn't reaching the function
// at all. If attempt is fresh but success is stale, the handler is crashing.
//
// Cache TTL is ~24-48h on Catalyst — fine for hourly/daily crons, marginal
// for weekly crons. For weekly visibility, a missing heartbeat key is itself
// a signal (treated as "very stale" by the dashboard).

import catalyst from 'zcatalyst-sdk-node'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from './cliq.js'

// All cron names tracked by the heartbeat dashboard. Add new crons here so
// they appear at /api/capture-calc/debug/heartbeats.
export const CRON_NAMES = [
  'capture_scheduler',
  'capture_nurture',
  'capture_meta',
  'capture_linkedin',
  'capture_engagement',
  'capture_weekly',
  'cron_monitor',
  'holiday_poster',
  'li_comments',
]

export const HB_ATTEMPT_KEY = name => `capture_hb_attempt_${name}`
export const HB_SUCCESS_KEY = name => `capture_hb_success_${name}`

function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}

async function cacheSet(seg, key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  try { await seg.update(key, str) }
  catch { await seg.put(key, str) }
}

/**
 * Express middleware. Stamps the attempt key, then calls next() regardless
 * of success/failure. Heartbeat failures must never block the cron handler.
 *
 *   captureCalcRouter.all('/scheduler/run', heartbeatAttempt('capture_scheduler'), requireCronSecret, handler)
 */
export function heartbeatAttempt(name) {
  return async (req, res, next) => {
    try {
      const seg = getSegment(req)
      await cacheSet(seg, HB_ATTEMPT_KEY(name), { at: new Date().toISOString() })
    } catch (e) { /* swallow */ }
    next()
  }
}

/**
 * Call from inside a handler after the work completes successfully. Optional
 * extra fields go into the cache payload (e.g. processed count).
 */
export async function stampSuccess(req, name, extra = {}) {
  try {
    const seg = getSegment(req)
    await cacheSet(seg, HB_SUCCESS_KEY(name), { at: new Date().toISOString(), ...extra })
  } catch (e) { /* swallow */ }
}

/**
 * Cron-failure reporter. Use in the outer catch of every cron route handler.
 *
 * Why: a 500 response auto-disables the cron after 20 consecutive failures
 * (this is what bit us 2026-05-24 and 2026-06-13). Returning 200 with the
 * error in the body means Catalyst never auto-disables, but we still need
 * Mark to see the failure — so we Cliq-alert his channel.
 *
 * Pattern in each cron handler:
 *   try { ... } catch (e) {
 *     await reportCronFailure(req, 'capture_scheduler', e)
 *     res.json({ ok: false, error: e.message })
 *   }
 */
export async function reportCronFailure(req, cronName, err) {
  const msg = err?.message || String(err)
  console.error(`[cron ${cronName}] FAILED:`, msg, err?.stack)
  try {
    const alertText = [
      `🚨 *Cron failure: ${cronName}*`,
      `Error: ${msg}`,
      ``,
      `Returning 200 to Catalyst so the cron isn't auto-disabled. Check`,
      `the heartbeat dashboard — attempt timestamp will be fresh, success`,
      `timestamp will be stale.`,
    ].join('\n')
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, alertText)
  } catch { /* Cliq down? Never crash the handler over a missed alert. */ }
}

/**
 * Read all heartbeats for the dashboard. Returns a record keyed by cron name.
 */
export async function readAllHeartbeats(req) {
  const seg = getSegment(req)
  const isNotFound = e => e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
  const get = async (key) => {
    try {
      const v = await seg.getValue(key)
      return v ? JSON.parse(v) : null
    } catch (e) {
      if (isNotFound(e)) return null
      return null
    }
  }
  const now = Date.now()
  const ageMin = iso => iso ? Math.round((now - new Date(iso).getTime()) / 60000) : null
  const out = {}
  for (const name of CRON_NAMES) {
    const a = await get(HB_ATTEMPT_KEY(name))
    const s = await get(HB_SUCCESS_KEY(name))
    out[name] = {
      last_attempt: a?.at || null,
      last_attempt_age_min: ageMin(a?.at),
      last_success: s?.at || null,
      last_success_age_min: ageMin(s?.at),
      extra: s ? { ...s, at: undefined } : null,
    }
  }
  return out
}
