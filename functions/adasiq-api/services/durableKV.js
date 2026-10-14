// 🗄 Durable cache (Mark 2026-10-14: "I don't want anything saved in cache. I want you to database
// everything"). Catalyst Cache forgets everything within 48 h, and an audit found ~30 kinds of real
// records whose ONLY copy was the cache: payroll runs, bonuses, mileage, quotes, the declined-
// calibration log, NPS answers, website leads, job progress, projects, van inventory, settings…
//
// durable(segment, app) wraps a cache segment so those keys are WRITE-THROUGH to the Datastore table
// DurableKV and READ-THROUGH from it when the cache comes back empty. Every other key passes straight
// to the cache unchanged (locks, dedupe stamps, live call state stay fast and temporary).
//   • put/update(key, value)  → cache first (as before), then the Datastore copy
//   • getValue(key)           → cache; on a miss, the Datastore copy (and the cache is re-warmed)
//   • a cache HIT on a durable key copies it to the Datastore once per instance (backfills old data)
//   • delete(key)             → both
// Values are split into 9,000-char parts (the text column holds 10,000).
const TABLE = 'DurableKV'
const PART = 9000

// Keys whose only home used to be the cache (audit 2026-10-14). Prefix match.
export const DURABLE_KEYS = /^(books_invoices_|books_counter$|books_expenses|books_deposits|books_services|payroll_runs|payroll_settings|bonus_config|bonus_payouts|mileage_trips|mileage_settings|quotes$|declined_calibrations|adas_jobs|nps_responses|capture_calc_submissions|partnership_audit_requests|audit_tool_submissions|tool_quote_submissions|comms_log|announcements|org_open_seats|adas_iq_settings|adas_iq_branding|adas_iq_notifications|absolute_adas_job_state|absolute_adas_tech_config|van_inventory|pm_projects|pm_tasks|capture_approval_queue|capture_draft_body_|pace_monthly_goal|brew_meta|brew_published_|brew_tips_queue|marketing_notified_comments|brew_email_marker|github_pat_secondbrain|week_plan|family_devo_passages|closing_history|garmin_data_|sms_media|sms_status)/

const esc = s => String(s).replace(/'/g, "''")
const backfilled = new Set()

async function rowsFor(app, key) {
  const r = await app.zcql().executeZCQLQuery(`SELECT ROWID, kv_part FROM ${TABLE} WHERE kv_key = '${esc(key)}' LIMIT 300`)
  return (r || []).map(x => x[TABLE]).filter(Boolean)
}

export async function kvGet(app, key) {
  const r = await app.zcql().executeZCQLQuery(`SELECT kv_part, kv_value FROM ${TABLE} WHERE kv_key = '${esc(key)}' ORDER BY kv_part ASC LIMIT 300`)
  const parts = (r || []).map(x => x[TABLE]).filter(Boolean)
  if (!parts.length) return null
  return parts.sort((a, b) => Number(a.kv_part) - Number(b.kv_part)).map(p => p.kv_value || '').join('')
}

export async function kvSet(app, key, value) {
  const s = value == null ? '' : (typeof value === 'string' ? value : JSON.stringify(value))
  const chunks = []
  for (let i = 0; i < Math.max(1, Math.ceil(s.length / PART)); i++) chunks.push(s.slice(i * PART, (i + 1) * PART))
  const t = app.datastore().table(TABLE)
  const have = await rowsFor(app, key)
  const byPart = new Map(have.map(h => [Number(h.kv_part), h.ROWID]))
  const now = new Date().toISOString()
  for (let i = 0; i < chunks.length; i++) {
    const row = { kv_key: key, kv_part: i, kv_parts: chunks.length, kv_value: chunks[i], kv_updated: now }
    if (byPart.has(i)) await t.updateRow({ ROWID: byPart.get(i), ...row })
    else await t.insertRow(row)
  }
  for (const h of have) if (Number(h.kv_part) >= chunks.length) { try { await t.deleteRow(h.ROWID) } catch { /* fine */ } }
}

export async function kvDelete(app, key) {
  const t = app.datastore().table(TABLE)
  for (const h of await rowsFor(app, key)) { try { await t.deleteRow(h.ROWID) } catch { /* fine */ } }
}

const empty = v => v === null || v === undefined || v === ''

export function durable(segment, app) {
  if (!segment || !app || segment.__durable) return segment
  return new Proxy(segment, {
    get(target, prop) {
      if (prop === '__durable') return true
      if (prop === 'getValue') return async (key, ...rest) => {
        let v = null
        try { v = await target.getValue(key, ...rest) } catch { v = null }
        if (!DURABLE_KEYS.test(String(key))) return v
        if (empty(v)) {
          try { v = await kvGet(app, String(key)) } catch (e) { console.warn('[durableKV] read', key, e.message) }
          if (!empty(v)) { try { await target.put(key, v) } catch { try { await target.update(key, v) } catch { /* warm best-effort */ } } }
        } else if (!backfilled.has(key)) {
          backfilled.add(key)
          try { if (empty(await kvGet(app, String(key)))) await kvSet(app, String(key), v) } catch (e) { console.warn('[durableKV] backfill', key, e.message) }
        }
        return v
      }
      if (prop === 'put' || prop === 'update') return async (key, value, ...rest) => {
        const r = await target[prop](key, value, ...rest)
        if (DURABLE_KEYS.test(String(key))) { try { await kvSet(app, String(key), value); backfilled.add(key) } catch (e) { console.error('[durableKV] WRITE FAILED', key, e.message) } }
        return r
      }
      if (prop === 'delete') return async (key, ...rest) => {
        let r
        try { r = await target.delete(key, ...rest) } catch (e) { if (!DURABLE_KEYS.test(String(key))) throw e }
        if (DURABLE_KEYS.test(String(key))) { try { await kvDelete(app, String(key)) } catch (e) { console.warn('[durableKV] delete', key, e.message) } }
        return r
      }
      const v = target[prop]
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}
