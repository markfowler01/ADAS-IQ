// Phone-system config store — built 2026-07-08 because Catalyst env vars
// were maxed out and we can't add TWILIO_* there anymore.
//
// One Catalyst Cache blob under the key `aa_phone_config` holds every
// setting Twilio SMS + voice needs. Frontend Phone Setup page reads/writes
// via /api/phone-config; SMS + voice route handlers pull the merged
// config at the top of each request via resolvePhoneConfig(req).
//
// Precedence: env var > cache > default. That way a pre-existing env var
// keeps winning (backward compat with anything already set) and cache
// values fill the gaps.

import catalyst from 'zcatalyst-sdk-node'
import {
  readAllPhoneConfig as dsReadAll,
  setConfigValue as dsSet,
  deleteConfigValue as dsDelete,
} from './datastorePhoneConfig.js'

const CACHE_KEY = 'aa_phone_config'

// The exhaustive list of config keys the phone system uses. Any new key
// added to sms.js/voice.js/twilio.js should be added here so the setup
// UI knows to expose it.
export const PHONE_CONFIG_KEYS = [
  { key: 'TWILIO_ACCOUNT_SID',     label: 'Twilio Account SID',      secret: true,  required: true,
    help: 'Starts with AC…' },
  { key: 'TWILIO_AUTH_TOKEN',      label: 'Twilio Auth Token',       secret: true,  required: true,
    help: 'From twilio.com/console' },
  { key: 'TWILIO_PHONE_NUMBER',    label: 'Local 425 number',        secret: false, required: true,
    help: 'E.164, e.g. +14251234567' },
  { key: 'TWILIO_TOLLFREE_NUMBER', label: 'Toll-free 844 number',    secret: false, required: false,
    help: 'E.164, e.g. +18443492327' },
  { key: 'MARK_PHONE_NUMBER',      label: "Mark's cell",             secret: false, required: false,
    help: 'E.164 — ring cascade step 1' },
  { key: 'JAYDEN_PHONE_NUMBER',    label: "Jayden's cell",           secret: false, required: false,
    help: 'E.164 — ring cascade step 2' },
  { key: 'KAT_PHONE_NUMBER',       label: "Kat's phone",             secret: false, required: false,
    help: 'E.164 — ring cascade step 3 (WhatsApp number)' },
  { key: 'AFTER_HOURS_AUTOREPLY',  label: 'After-hours auto-reply',  secret: false, required: false,
    help: '"true" or "false"' },
  { key: 'AFTER_HOURS_START',      label: 'After-hours start (PT)',  secret: false, required: false,
    help: '24h number, default 18' },
  { key: 'AFTER_HOURS_END',        label: 'After-hours end (PT)',    secret: false, required: false,
    help: '24h number, default 7' },
]

// Use the Catalyst SDK for cache access. The SDK handles the admin-token
// scheme mismatch that plagues raw axios (per CLAUDE.md: "Catalyst cache
// admin token must use Catalyst-Cred-Token scheme, not Zoho-oauthtoken").
// Symptom of that bug: axios PUT/POST to the cache endpoint returns 404
// instead of the intended value, which is what was breaking Save in the
// Phone Setup modal on 2026-07-08.

function getSegment(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.cache().segment()
}

// Raw cache blob — no env-var merging. Used by the Setup UI to know
// what's in the cache specifically (so it can distinguish "unset" from
// "set at env-var layer").
//
// Auto-refresh: every successful read pushes TTL back to 48h so
// credentials never expire as long as SOMETHING (SMS webhook, voice
// webhook, phone-health cron, etc) reads them within any 2-day window.
// Datastore layer above still owns durability; this is defense in depth.
export async function readPhoneCache(req) {
  try {
    const segment = getSegment(req)
    const val = await segment.getValue(CACHE_KEY)
    if (!val) return {}
    let obj
    try { obj = typeof val === 'string' ? JSON.parse(val) : (val || {}) }
    catch { return {} }
    // Fire-and-forget TTL refresh. If update fails (key doesn't exist)
    // fall back to put. Errors swallowed — this is best-effort.
    Promise.resolve().then(async () => {
      try { await segment.update(CACHE_KEY, typeof val === 'string' ? val : JSON.stringify(obj)) }
      catch {
        try { await segment.put(CACHE_KEY, typeof val === 'string' ? val : JSON.stringify(obj), 48) }
        catch {}
      }
    })
    return obj
  } catch (e) {
    console.warn('[phone-config read]', e.message)
    return {}
  }
}

async function writePhoneCache(req, obj) {
  const segment = getSegment(req)
  const val = JSON.stringify(obj || {})
  // SDK's `update` fails if the key doesn't exist; `put` creates it. Try
  // update first, fall back to put on failure.
  // TTL MUST be 1-48 hours — anything outside that range is silently
  // rejected by Catalyst. 48 is the max the platform allows.
  try {
    await segment.update(CACHE_KEY, val)
  } catch (e) {
    await segment.put(CACHE_KEY, val, 48)
  }
}

// Upsert a single key. Writes to Datastore (durable source of truth) +
// cache (fast tier) so a subsequent read is hot either way.
export async function setPhoneConfigValue(req, key, value) {
  const known = PHONE_CONFIG_KEYS.find(k => k.key === key)
  if (!known) throw new Error(`Unknown phone config key: ${key}`)
  const strVal = String(value == null ? '' : value)
  // Datastore first — if it fails, the whole save fails loudly.
  await dsSet(req, key, strVal)
  // Cache next — best-effort; if it errors, the next read will
  // repopulate from Datastore anyway.
  try {
    const current = await readPhoneCache(req)
    const next = { ...current, [key]: strVal }
    await writePhoneCache(req, next)
  } catch (e) {
    console.warn('[phone-config cache write]', e.message)
  }
  return await resolvePhoneConfig(req)
}

// Wipe a single key from both stores.
export async function deletePhoneConfigValue(req, key) {
  try { await dsDelete(req, key) } catch (e) { console.warn('[phone-config ds delete]', e.message) }
  try {
    const current = await readPhoneCache(req)
    const next = { ...current }
    delete next[key]
    await writePhoneCache(req, next)
  } catch (e) { console.warn('[phone-config cache delete]', e.message) }
  return await resolvePhoneConfig(req)
}

// The main lookup — env > Datastore > cache > default. Datastore is
// authoritative (never expires); cache is a fast tier that auto-heals
// on miss. Every read repopulates cache so it stays hot.
export async function resolvePhoneConfig(req) {
  const keys = PHONE_CONFIG_KEYS.map(k => k.key)
  // Kick off both reads in parallel — cache usually wins the race.
  const [dsVals, cacheVals] = await Promise.all([
    (async () => {
      try { return await dsReadAll(req, keys) }
      catch (e) { console.warn('[phone-config ds read]', e.message); return {} }
    })(),
    readPhoneCache(req),
  ])

  const out = {}
  const needsCacheRepair = {}
  for (const key of keys) {
    const envVal = process.env[key]
    if (envVal !== undefined && envVal !== '') {
      out[key] = envVal
      continue
    }
    // Datastore wins over cache — it's the source of truth. If the two
    // disagree, cache was probably stale.
    if (dsVals[key] !== undefined && dsVals[key] !== '') {
      out[key] = dsVals[key]
      if (cacheVals[key] !== dsVals[key]) needsCacheRepair[key] = dsVals[key]
      continue
    }
    out[key] = cacheVals[key] || ''
  }

  // Best-effort cache repair — silences on failure.
  if (Object.keys(needsCacheRepair).length > 0) {
    Promise.resolve().then(async () => {
      try {
        const merged = { ...cacheVals, ...needsCacheRepair }
        await writePhoneCache(req, merged)
      } catch {}
    })
  }

  return out
}

// Convenience — one field at a time.
export async function getPhoneValue(req, key) {
  const cfg = await resolvePhoneConfig(req)
  return cfg[key] || ''
}

// Mask helper for the admin UI — hides most of a secret but shows a
// short prefix/suffix so Mark can eyeball whether the right value is
// in there without leaking anything to a screen recording.
export function maskSecret(v) {
  if (!v) return ''
  const s = String(v)
  if (s.length <= 8) return '•'.repeat(s.length)
  return s.slice(0, 4) + '•'.repeat(Math.max(4, s.length - 8)) + s.slice(-4)
}
