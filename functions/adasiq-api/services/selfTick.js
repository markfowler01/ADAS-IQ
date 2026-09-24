// ⏱ App-side ticker (Mark 2026-09-24: "have this run every 15 min").
//
// GitHub Actions is the scheduler on paper, but it delivers only ~7–10 of the
// ~28 scheduled runs a day for this repo (measured 2026-09-18 → 09-24), so the
// "hourly" watchdog really fires every 2–3 hours and a 15-minute cron would
// never be honoured. Catalyst crons can't go below an hour either.
//
// So the app ticks itself: any staff request to the board fires the email
// intake at most once every N minutes. Kat and the techs have the app open all
// day, which is exactly when shop estimates arrive.
//
// Mechanics that matter on Catalyst: a dangling promise after res.json() kills
// the instance, so we can't fire-and-forget. Instead we POST to our own cron
// route with a short timeout and swallow the timeout — the receiving
// invocation is a separate instance and finishes the sweep on its own. Cost:
// under a second on one request per window.
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'

const FALLBACK_BASE = 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'
const baseUrl = req => (process.env.API_PUBLIC_BASE
  || (req?.get?.('host') ? `https://${String(req.get('host')).replace(/:443$/, '')}/server/adasiq-api` : FALLBACK_BASE))

const TICKS = {
  email_intake: { minutes: 15, path: '/api/crm-sync-cron/email-intake', secret: () => process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026' },
  // 📋 OEM position statements — once a day. The route carries its own PT-day
  // guard too, so whichever scheduler gets there first wins and the rest no-op.
  position_statements: { minutes: 6 * 60, path: '/api/crm-sync-cron/position-statements?once=1', secret: () => process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026' },
  // Drains one queued OEM PDF at a time — a Claude read is ~17s and the
  // gateway kills a request at 30s, so they can only go one per invocation.
  position_import: { minutes: 4, path: '/api/crm-sync-cron/position-statements/import-next', secret: () => process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026' },
}

/** Claim the window in Cache. Returns false when someone already claimed it. */
async function claim(req, key, minutes) {
  try {
    const seg = catalyst.initialize(req).cache().segment()
    const stamp = `tick_${key}`
    let last = null
    try { last = await seg.getValue(stamp) } catch { last = null }
    if (last && Date.now() - Number(last) < minutes * 60000) return false
    const now = String(Date.now())
    try { await seg.update(stamp, now, 1) } catch { await seg.put(stamp, now, 1) }
    return true
  } catch { return false }   // no Cache = no tick; never break the request
}

/**
 * Fire a due tick. Never throws, never waits long, never runs for a cron call.
 * @returns {Promise<string>} '' when nothing fired, else the tick name.
 */
export async function maybeSelfTick(req, key = 'email_intake') {
  const t = TICKS[key]; if (!t) return ''
  if (req?.headers?.['x-cron-secret']) return ''            // don't tick from a cron call
  if (String(process.env.SELF_TICK || '').toLowerCase() === 'off') return ''
  try {
    if (!(await claim(req, key, t.minutes))) return ''
    const url = `${baseUrl(req)}${t.path}`
    await axios.post(url, {}, { headers: { 'x-cron-secret': t.secret() }, timeout: 1200, validateStatus: () => true })
      .catch(e => { if (e.code !== 'ECONNABORTED') console.log(`[self-tick] ${key} dispatch:`, e.message) })
    console.log(`[self-tick] ${key} fired (every ${t.minutes} min, app-side)`)
    return key
  } catch (e) { console.log('[self-tick] skipped:', e.message); return '' }
}
