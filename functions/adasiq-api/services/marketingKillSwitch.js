// Global marketing kill switch — SCOPED.
//
// One record in VanKV that short-circuits marketing drafters/publishers.
// Scopes let Mark pause the risky surfaces (social posts, tip cards, daily
// ad) without holding the newsletters hostage.
//
//   scope 'social'     — unified story drafter, van pillar, brew tips card,
//                        daily "Absolute ADAS" ad. Where the 2026-09-24
//                        anti-sublet self-own actually came from.
//   scope 'newsletter' — From the Van weekly drafter (all paths: route,
//                        nurture piggyback, safety-net create).
//   scope 'all'        — everything above.
//
// ADAS Brew's /run and /run-bonus NEVER check this switch (locked rule —
// see feedback_brew_pipeline_locked). Magic Lantern nurture sends never
// check it either (opted-in 1:1 sequence).
//
// Storage:
//   VanKV.marketing_paused = { paused, scopes:[...], reason, at, set_by }
//   A record with paused:true and no scopes means 'all' (backward compat).
//
// Env override: MARKETING_PAUSED=true → paused for all scopes.

import { getVal, setVal } from './vanDatastore.js'

const KEY = 'marketing_paused'
export const SCOPES = ['social', 'newsletter', 'all']

export async function readMarketingKillSwitch(req) {
  if (String(process.env.MARKETING_PAUSED || '').toLowerCase() === 'true') {
    return { paused: true, scopes: ['all'], reason: 'MARKETING_PAUSED env var set to true', source: 'env' }
  }
  try {
    const rec = await getVal(req, KEY)
    if (rec && typeof rec === 'object' && rec.paused === true) {
      const scopes = Array.isArray(rec.scopes) && rec.scopes.length ? rec.scopes : ['all']
      return { paused: true, scopes, reason: rec.reason || '(no reason set)', at: rec.at, set_by: rec.set_by, source: 'datastore' }
    }
  } catch (e) {
    console.warn('[marketingKillSwitch read]', e.message)
  }
  return { paused: false, scopes: [], source: 'default' }
}

/**
 * Is marketing paused for this scope? Default scope is 'social' because
 * that's what most callers are (drafters that post publicly). The Van
 * weekly newsletter paths pass 'newsletter' explicitly.
 */
export async function isMarketingPaused(req, scope = 'social') {
  const rec = await readMarketingKillSwitch(req)
  if (!rec.paused) return false
  return rec.scopes.includes('all') || rec.scopes.includes(scope)
}

export async function pauseMarketing(req, { reason = 'no reason given', setBy = 'admin', scopes = ['all'] } = {}) {
  const clean = (Array.isArray(scopes) ? scopes : [scopes]).map(s => String(s)).filter(s => SCOPES.includes(s))
  const rec = {
    paused: true,
    scopes: clean.length ? clean : ['all'],
    reason: String(reason).slice(0, 300),
    at: new Date().toISOString(),
    set_by: String(setBy).slice(0, 80),
  }
  await setVal(req, KEY, rec)
  return rec
}

export async function resumeMarketing(req, { setBy = 'admin' } = {}) {
  const rec = { paused: false, scopes: [], at: new Date().toISOString(), set_by: String(setBy).slice(0, 80) }
  await setVal(req, KEY, rec)
  return rec
}
