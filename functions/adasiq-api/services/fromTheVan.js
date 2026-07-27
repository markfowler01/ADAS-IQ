// "From the Van" subscriber management. Uses Resend's Audience API to hold
// the subscriber list — same infra Resend Broadcasts read from, so a
// subscribe here automatically appears in the next Broadcast send.
//
// Audience lookup is self-healing: on first use we hit Resend, look for
// an audience named "From the Van", and create it if missing. The ID gets
// cached in memory for the container's lifetime. No manual env var setup
// required.

import axios from 'axios'
import crypto from 'crypto'

const RESEND_API = 'https://api.resend.com'
const AUDIENCE_NAME = 'From the Van'
const CATALYST_BASE = 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'

let cachedAudienceId = null

// ─── Unsubscribe URL signing ──────────────────────────────────────────────
// Every email carries a per-recipient link. The signature prevents someone
// from unsubscribing another shop by guessing URLs. Reuses BREW_CRON_SECRET
// (already set in Catalyst) so no new env var is needed.
function unsubSecret() {
  return process.env.VAN_UNSUB_SECRET || process.env.BREW_CRON_SECRET || ''
}

/**
 * Generate a 24-char HMAC-SHA256 signature over an email address. Used to
 * sign unsubscribe URLs so recipients can only unsub themselves.
 */
export function signUnsubEmail(email) {
  const secret = unsubSecret()
  if (!secret) throw new Error('VAN_UNSUB_SECRET / BREW_CRON_SECRET not set — cannot sign unsub URL')
  return crypto.createHmac('sha256', secret)
    .update(String(email).trim().toLowerCase())
    .digest('hex').slice(0, 24)
}

/**
 * Verify a signed unsubscribe request. Returns true if the sig matches
 * the email under the current secret. Uses timingSafeEqual to prevent
 * length-based timing attacks.
 */
export function verifyUnsubSig(email, sig) {
  const secret = unsubSecret()
  if (!secret) return false
  try {
    const expected = signUnsubEmail(email)
    if (!sig || sig.length !== expected.length) return false
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  } catch { return false }
}

/**
 * Build the public unsubscribe URL for a subscriber's email. Recipients see
 * this in the footer of every Magic Lantern email.
 */
export function vanUnsubscribeUrl(email) {
  const e = encodeURIComponent(String(email).trim().toLowerCase())
  const s = signUnsubEmail(email)
  return `${CATALYST_BASE}/api/capture-calc/from-the-van/unsubscribe?e=${e}&s=${s}`
}

function apiKey() {
  const k = process.env.RESEND_API_KEY
  if (!k) throw new Error('RESEND_API_KEY not set')
  return k
}

function auth() {
  return { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' }
}

/**
 * Get the "From the Van" Resend Audience ID, creating it if it doesn't exist.
 * Cached per container for hot-path performance.
 */
export async function getVanAudienceId() {
  if (cachedAudienceId) return cachedAudienceId

  // List existing audiences to find ours.
  const list = await axios.get(`${RESEND_API}/audiences`, {
    headers: auth(), timeout: 10000,
  })
  const found = (list.data?.data || []).find(a => a.name === AUDIENCE_NAME)
  if (found?.id) {
    cachedAudienceId = found.id
    return cachedAudienceId
  }

  // Create it.
  const created = await axios.post(`${RESEND_API}/audiences`,
    { name: AUDIENCE_NAME },
    { headers: auth(), timeout: 10000 })
  if (!created.data?.id) throw new Error(`Resend audience create failed: ${JSON.stringify(created.data).slice(0, 200)}`)
  cachedAudienceId = created.data.id
  return cachedAudienceId
}

/**
 * Mark a subscriber as unsubscribed in the Resend audience. Two-step:
 *   1. Look up the contact by email (Resend requires the contact id for PATCH)
 *   2. PATCH unsubscribed=true so future Broadcasts skip them
 * Idempotent — already-unsubscribed contacts return ok with alreadyUnsub:true.
 * If the email isn't in the audience at all, returns ok with notInAudience:true
 * (still counts as success — nothing to do).
 */
export async function unsubscribeVanContact(email) {
  const clean = String(email || '').trim().toLowerCase()
  if (!clean) return { ok: false, error: 'email required' }
  try {
    const audienceId = await getVanAudienceId()
    // Resend supports GET /audiences/{id}/contacts/{email} directly by email
    const lookup = await axios.get(
      `${RESEND_API}/audiences/${audienceId}/contacts/${encodeURIComponent(clean)}`,
      { headers: auth(), timeout: 10000, validateStatus: s => s < 500 }
    )
    if (lookup.status === 404) return { ok: true, notInAudience: true, email: clean }
    if (lookup.status < 200 || lookup.status >= 300) {
      return { ok: false, error: `Resend lookup ${lookup.status}: ${JSON.stringify(lookup.data).slice(0, 200)}` }
    }
    const contactId = lookup.data?.id
    if (!contactId) return { ok: false, error: 'contact lookup returned no id' }
    if (lookup.data?.unsubscribed === true) return { ok: true, alreadyUnsub: true, email: clean }

    const patch = await axios.patch(
      `${RESEND_API}/audiences/${audienceId}/contacts/${contactId}`,
      { unsubscribed: true },
      { headers: auth(), timeout: 10000, validateStatus: s => s < 500 }
    )
    if (patch.status >= 200 && patch.status < 300) return { ok: true, email: clean, contactId }
    return { ok: false, error: `Resend patch ${patch.status}: ${JSON.stringify(patch.data).slice(0, 200)}` }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * Add a subscriber to the "From the Van" audience.
 * Idempotent — Resend upserts by email.
 *
 * @param {Object} sub
 * @param {string} sub.email
 * @param {string} [sub.firstName]
 * @param {string} [sub.lastName]
 * @param {boolean} [sub.unsubscribed]
 * @returns {Promise<{ok, id?, email?, error?}>}
 */
export async function addVanSubscriber({ email, firstName, lastName, unsubscribed = false }) {
  if (!email) return { ok: false, error: 'email required' }
  try {
    const audienceId = await getVanAudienceId()
    const body = {
      email,
      first_name: firstName || undefined,
      last_name: lastName || undefined,
      unsubscribed,
    }
    const res = await axios.post(
      `${RESEND_API}/audiences/${audienceId}/contacts`,
      body,
      { headers: auth(), timeout: 10000, validateStatus: s => s < 500 }
    )
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, id: res.data?.id, email }
    }
    // Resend returns 422 with details on duplicate — treat as success (idempotent).
    if (res.status === 422 && String(res.data?.message || '').toLowerCase().includes('already')) {
      return { ok: true, duplicate: true, email }
    }
    return { ok: false, error: `Resend ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}` }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * Create a Resend Broadcast against the From the Van audience. Created as
 * a draft (no scheduled_at) so Mark can preview + set the send time in the
 * Resend dashboard. Optionally send/schedule immediately by calling
 * `sendVanBroadcast()` after this returns.
 *
 * @param {Object} args
 * @param {string} args.subject
 * @param {string} args.html
 * @param {string} [args.text]
 * @param {string} [args.previewText]
 * @param {string} [args.from]          default "Mark @ Absolute ADAS <mark@absoluteadas.com>"
 * @param {string} [args.replyTo]       default "mark@absoluteadas.com"
 * @param {string} [args.name]          internal broadcast name (defaults to subject)
 * @returns {Promise<{ok, id?, dashboardUrl?, error?}>}
 */
export async function createVanBroadcast({ subject, html, text, previewText, from, replyTo, name } = {}) {
  if (!subject || !html) return { ok: false, error: 'subject + html required' }
  try {
    const audienceId = await getVanAudienceId()
    const body = {
      audience_id: audienceId,
      from: from || 'Mark @ Absolute ADAS <mark@absoluteadas.com>',
      subject,
      html,
      text: text || undefined,
      reply_to: replyTo ? [replyTo] : ['mark@absoluteadas.com'],
      name: name || subject,
      preview_text: previewText || undefined,
    }
    const res = await axios.post(`${RESEND_API}/broadcasts`, body, {
      headers: auth(), timeout: 20000, validateStatus: s => s < 500,
    })
    if (res.status >= 200 && res.status < 300 && res.data?.id) {
      return {
        ok: true,
        id: res.data.id,
        dashboardUrl: `https://resend.com/broadcasts/${res.data.id}`,
      }
    }
    return { ok: false, error: `Resend ${res.status}: ${JSON.stringify(res.data).slice(0, 400)}` }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * Delete/cancel a Broadcast. Used by the weekly kill handler to abort a
 * previously-scheduled Tuesday send before it fires. Idempotent — a 404
 * from Resend (already deleted or never existed) returns ok:true.
 */
export async function deleteVanBroadcast(id) {
  if (!id) return { ok: false, error: 'id required' }
  try {
    const res = await axios.delete(`${RESEND_API}/broadcasts/${id}`, {
      headers: auth(), timeout: 10000, validateStatus: s => s < 500,
    })
    if (res.status >= 200 && res.status < 300) return { ok: true, ...(res.data || {}) }
    if (res.status === 404) return { ok: true, alreadyGone: true }
    return { ok: false, error: `Resend ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}` }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * Schedule (or immediately send) an existing Broadcast.
 * @param {string} id — broadcast id
 * @param {string} [scheduledAt] — ISO string; omit to send now
 */
export async function sendVanBroadcast(id, scheduledAt) {
  const body = scheduledAt ? { scheduled_at: scheduledAt } : {}
  const res = await axios.post(`${RESEND_API}/broadcasts/${id}/send`, body, {
    headers: auth(), timeout: 15000, validateStatus: s => s < 500,
  })
  if (res.status >= 200 && res.status < 300) return { ok: true, ...(res.data || {}) }
  return { ok: false, error: `Resend ${res.status}: ${JSON.stringify(res.data).slice(0, 400)}` }
}

/**
 * List recent emails sent via Resend's /emails endpoint. Paginated —
 * fetches up to `maxPages` pages of `limit` results. Used to reconstruct
 * Magic Lantern nurture_sent state after Cache evaporation lost it.
 *
 * @param {Object} opts
 * @param {number} [opts.limit=100]    per-page cap (Resend max)
 * @param {number} [opts.maxPages=20]  hard stop so we never run forever
 * @param {number} [opts.sinceDaysAgo] skip pages older than N days (rough — filters after fetch)
 * @returns {Promise<Array<{id, to, from, subject, created_at, last_event}>>}
 */
export async function listRecentResendSends({ limit = 100, maxPages = 20, sinceDaysAgo = 30 } = {}) {
  const all = []
  let after = null
  const cutoff = sinceDaysAgo ? Date.now() - sinceDaysAgo * 86400000 : 0
  for (let page = 0; page < maxPages; page++) {
    const params = { limit }
    if (after) params.after = after
    const res = await axios.get(`${RESEND_API}/emails`, {
      headers: auth(),
      params,
      timeout: 15000,
      validateStatus: s => s < 500,
    })
    if (res.status !== 200 || !Array.isArray(res.data?.data)) {
      // Not fatal — some Resend accounts don't have list-emails enabled
      return all.length ? all : { ok: false, error: `Resend ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}` }
    }
    const rows = res.data.data
    for (const r of rows) {
      const created = Date.parse(r.created_at || 0)
      if (created && cutoff && created < cutoff) return all  // past the cutoff — stop
      all.push({
        id: r.id,
        to: Array.isArray(r.to) ? r.to : [r.to],
        from: r.from,
        subject: r.subject,
        created_at: r.created_at,
        last_event: r.last_event,
      })
    }
    if (!res.data.has_more) break
    after = rows[rows.length - 1]?.id
    if (!after) break
  }
  return all
}

/**
 * List all subscribers in the "From the Van" audience.
 */
export async function listVanSubscribers() {
  const audienceId = await getVanAudienceId()
  const res = await axios.get(
    `${RESEND_API}/audiences/${audienceId}/contacts`,
    { headers: auth(), timeout: 15000 }
  )
  return {
    ok: true,
    audienceId,
    count: (res.data?.data || []).length,
    contacts: res.data?.data || [],
  }
}
