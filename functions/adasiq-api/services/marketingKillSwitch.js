// Global marketing kill switch.
//
// One flag stored in VanKV Datastore that, when set, short-circuits EVERY
// marketing drafter and publisher across the app: ADAS Brew, From the Van
// weekly, Van pillar, Van nurture (Magic Lantern), daily unified marketing
// drafter, daily "Absolute ADAS" ad, holiday auto-poster, brew tips.
//
// Built 2026-09-24 after a marketing post shipped anti-sublet copy and Mark
// asked for a hard blocker to make sure it can't happen again. The
// per-drafter anti-sublet content reject is layer 1; this switch is layer 0:
// nothing fires at all until Mark flips it back on.
//
// Storage:
//   VanKV.marketing_paused = { paused: true|false, reason: string, at: iso, set_by: string }
//
// Env override:
//   MARKETING_PAUSED=true forces paused regardless of the Datastore value
//   (useful for a fast prod pause via Catalyst env var if the app is broken).

import { getVal, setVal } from './vanDatastore.js'

const KEY = 'marketing_paused'

/**
 * Is the marketing pipeline currently paused?
 * @param {*} req  Express req — used to route Datastore access
 * @returns {Promise<{paused: boolean, reason?: string, at?: string, source: 'env'|'datastore'|'default'}>}
 */
export async function readMarketingKillSwitch(req) {
  if (String(process.env.MARKETING_PAUSED || '').toLowerCase() === 'true') {
    return { paused: true, reason: 'MARKETING_PAUSED env var set to true', source: 'env' }
  }
  try {
    const rec = await getVal(req, KEY)
    if (rec && typeof rec === 'object' && rec.paused === true) {
      return { paused: true, reason: rec.reason || '(no reason set)', at: rec.at, set_by: rec.set_by, source: 'datastore' }
    }
  } catch (e) {
    console.warn('[marketingKillSwitch read]', e.message)
  }
  return { paused: false, source: 'default' }
}

/**
 * Convenience — returns true if marketing is paused. Caller-friendly for
 * `if (await isMarketingPaused(req)) return skip...`.
 */
export async function isMarketingPaused(req) {
  return (await readMarketingKillSwitch(req)).paused
}

/**
 * Pause the marketing pipeline. All drafters/publishers that check the
 * switch will short-circuit until unpaused.
 */
export async function pauseMarketing(req, { reason = 'no reason given', setBy = 'admin' } = {}) {
  const rec = { paused: true, reason: String(reason).slice(0, 300), at: new Date().toISOString(), set_by: String(setBy).slice(0, 80) }
  await setVal(req, KEY, rec)
  return rec
}

/**
 * Un-pause. Marketing pipeline resumes.
 */
export async function resumeMarketing(req, { setBy = 'admin' } = {}) {
  const rec = { paused: false, at: new Date().toISOString(), set_by: String(setBy).slice(0, 80) }
  await setVal(req, KEY, rec)
  return rec
}
