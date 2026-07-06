'use strict'
// absoluteadas-cron-runner — Catalyst-native scheduler for the marketing crons.
//
// WHY THIS EXISTS:
// 1. GitHub Actions' cron scheduler proved unreliable (2026-07-05/06: schedule
//    events delayed 3-5 hours or dropped entirely — the 6 AM van post and
//    daily drafter never fired on time).
// 2. Catalyst URL-type crons hit the HTTP gateway, which caps at 30s. Long
//    drafters 408 there, the cron records a failure, and 20 consecutive
//    failures auto-disable the cron (happened May 24, Jun 13, Jun 16).
//
// THIS function is invoked DIRECTLY by Function-type crons — no gateway, 540s
// budget. It fires the same no-auth /debug/* endpoints the GH workflow uses,
// treats gateway 408s on long drafters as "expected, work continues" (the
// inner handler keeps running server-side), and ALWAYS exits successfully so
// the cron system never counts a failure. Real outcome monitoring stays where
// it already lives: heartbeats + cron_monitor + Cliq alerts.
//
// Cron setup (Catalyst console → Cron, type "Function", timezone America/Los_Angeles):
//   job=hourly    every hour at :07
//   job=van       daily 6:01 AM
//   job=drafters  daily 6:13 AM
//   job=tasks     daily 6:23 AM
//   job=weekly    Friday 7:17 AM
//
// GH Actions workflow stays enabled as a backup — every endpoint is
// idempotent, so double-firing never double-posts.

const BASE = 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api/api/capture-calc/debug'

const JOBS = {
  // publisher + nurture + LI comments + auto-disable email monitor
  hourly: [
    { name: 'capture_scheduler', path: 'run-scheduler',      timeoutMs: 120000 },
    { name: 'capture_nurture',   path: 'nurture-run',        timeoutMs: 90000 },
    { name: 'li_comments',       path: 'li-comments-check',  timeoutMs: 90000 },
    { name: 'cron_monitor',      path: 'cron-monitor-run',   timeoutMs: 60000 },
  ],
  // long drafters: gateway 408s at 30s but the inner handler keeps running —
  // timeout/408 here is expected and NOT a failure
  van:      [{ name: 'van_post',      path: 'van-draft-day',  timeoutMs: 40000, longDrafter: true }],
  drafters: [{ name: 'capture_meta',  path: 'draft-meta-day', timeoutMs: 40000, longDrafter: true }],
  tasks: [
    { name: 'capture_engagement', path: 'engagement-run',     timeoutMs: 60000 },
    { name: 'holiday_poster',     path: 'holiday-poster-run', timeoutMs: 90000 },
  ],
  weekly: [{ name: 'capture_weekly', path: 'weekly-run', timeoutMs: 60000 }],
  // fast connectivity test for console/manual verification
  ping: [{ name: 'heartbeats', path: 'heartbeats', timeoutMs: 15000 }],
}

async function hit({ name, path, timeoutMs, longDrafter }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}/${path}`, { signal: ctrl.signal })
    const body = (await res.text()).slice(0, 300)
    return { name, http: res.status, ok: res.status < 500, body }
  } catch (e) {
    // AbortError on a long drafter = gateway still chewing, work continues
    if (longDrafter) return { name, http: 'timeout', ok: true, note: 'expected for long drafter — inner handler continues' }
    return { name, http: 'error', ok: false, error: String(e.message).slice(0, 200) }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = async (context, basicIO) => {
  const job = String(basicIO.getArgument('job') || 'hourly')
  const steps = JOBS[job]
  const started = new Date().toISOString()

  if (!steps) {
    basicIO.write(JSON.stringify({ ok: false, error: `unknown job: ${job}`, jobs: Object.keys(JOBS) }))
    context.close()
    return
  }

  const results = []
  for (const step of steps) {
    results.push(await hit(step))
  }

  // Always report success to the cron system — endpoint failures are surfaced
  // through heartbeats/Cliq, and a "failed" cron here risks auto-disable.
  basicIO.write(JSON.stringify({ ok: true, job, started, results }))
  context.close()
}
