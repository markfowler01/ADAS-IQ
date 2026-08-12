// /api/cron-monitor/run — the marketing cron watchdog (built 2026-08-07).
//
// This route was DESIGNED into the system (aa_hourly_monitor and the old
// cron_monitor_1 cron both point here, and /debug/cron-monitor-run
// forwards here after reviving disabled aa_* crons) but was never
// implemented — every invocation 404'd, which is exactly how
// cron_monitor_1 earned its 20 consecutive failures and got disabled.
//
// What it does: reads every cron heartbeat, compares success age against
// that cron's expected cadence, and alerts Mark's channel when something
// has gone quiet. Silent when healthy. Fast (<5s) so the gateway always
// sees a 200.

import express from 'express'
import {
  heartbeatAttempt, stampSuccess, readAllHeartbeats,
} from '../services/cronHeartbeat.js'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from '../services/cliq.js'

const router = express.Router()

function requireCronSecretFlex(req, res, next) {
  const want = String(process.env.BREW_CRON_SECRET || '').replace(/[^a-zA-Z0-9]/g, '')
  const got = String(req.headers['x_cron_secret'] || req.headers['x-cron-secret'] || req.query.secret || '').replace(/[^a-zA-Z0-9]/g, '')
  if (want && got !== want) return res.status(401).type('text/plain').send('Unauthorized')
  next()
}

// Expected cadence per cron → max acceptable success age in minutes.
// Generous thresholds to avoid weekend/holiday false alarms.
const EXPECTATIONS = {
  capture_scheduler:        3 * 60,        // hourly
  capture_nurture:          3 * 60,        // hourly
  capture_van_safety_net:   6 * 60,        // hourly (newer — lenient)
  capture_engagement:       6 * 60,        // hourly batches
  capture_meta:             26 * 60,       // daily 6am drafter
  van_post:                 26 * 60,       // daily van post
  capture_van_nurture:      26 * 60,       // daily Magic Lantern sender
  li_comments:              30 * 60,       // daily
  li_outreach:              80 * 60,       // weekdays only — spans weekends
  capture_weekly:           9 * 24 * 60,   // weekly Friday report
  capture_van_weekly_draft: 9 * 24 * 60,   // weekly Sunday drafter
}

router.all('/run', heartbeatAttempt('cron_monitor'), requireCronSecretFlex, async (req, res) => {
  try {
    const heartbeats = await readAllHeartbeats(req)
    const stale = []
    for (const [name, maxAgeMin] of Object.entries(EXPECTATIONS)) {
      const h = heartbeats?.[name] || {}
      const age = h.last_success_age_min
      if (age == null) {
        stale.push({ cron: name, status: 'no success ever recorded' })
      } else if (age > maxAgeMin) {
        stale.push({ cron: name, status: `last success ${Math.round(age / 60)}h ago (expected < ${Math.round(maxAgeMin / 60)}h)` })
      }
    }

    if (stale.length > 0) {
      const msg = [
        `⏰ *Cron watchdog* — ${stale.length} scheduled job${stale.length > 1 ? 's' : ''} quiet longer than expected:`,
        ...stale.map(s => `• \`${s.cron}\` — ${s.status}`),
        '',
        'Check Catalyst console → Cron for disabled entries (Zoho auto-disables after 20 consecutive errors).',
      ].join('\n')
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg).catch(e =>
        console.warn('[cron-monitor] alert failed:', e.message))
    }

    await stampSuccess(req, 'cron_monitor', { stale: stale.length })
    res.json({ ok: true, checked: Object.keys(EXPECTATIONS).length, stale })
  } catch (e) {
    console.error('[cron-monitor]', e.message)
    res.json({ ok: false, error: e.message })
  }
})

export { router as cronMonitorRouter }
