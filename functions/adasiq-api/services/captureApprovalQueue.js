// Capture approval queue — pending drafts awaiting Mark's thumbs-up/edit/kill.
//
// Each draft gets a unique ID and a Cliq card with three signed URLs:
//   /approve?id=&t=&sig=  →  marks approved + (later) triggers publish
//   /edit?id=&t=&sig=     →  HTML form prefilled with draft; submit = edited+approved
//   /kill?id=&t=&sig=     →  marks killed (won't be republished)
//
// Tokens are HMAC-SHA256 of (id + action + timestamp) under APPROVAL_HMAC_SECRET.
// Tokens expire 14 days after issuance — long enough for a Friday card to
// still work Monday morning if Mark was offline over the weekend.
//
// Storage: Catalyst Cache under capture_approval_queue. Capped at 200 items.

import crypto from 'crypto'

const QUEUE_KEY = 'capture_approval_queue'
const TOKEN_TTL_DAYS = 14

function getSecret() {
  return process.env.APPROVAL_HMAC_SECRET
      || process.env.BREW_CRON_SECRET    // fallback so we never hard-fail
      || 'capture-default-rotate-me'
}

function signToken(id, action, ts) {
  const payload = `${id}|${action}|${ts}`
  const h = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url')
  return h.slice(0, 32)   // 32-char signature is plenty for a private URL
}

export function buildSignedActionUrl(baseUrl, id, action) {
  const ts = Date.now()
  const sig = signToken(id, action, ts)
  return `${baseUrl}/api/capture-calc/approval/${action}?id=${encodeURIComponent(id)}&t=${ts}&sig=${sig}`
}

export function verifySignedAction({ id, action, t, sig }) {
  if (!id || !action || !t || !sig) return { ok: false, error: 'missing params' }
  const ts = Number(t)
  if (!Number.isFinite(ts)) return { ok: false, error: 'bad timestamp' }
  const age = Date.now() - ts
  if (age < 0) return { ok: false, error: 'timestamp in future' }
  if (age > TOKEN_TTL_DAYS * 86400000) return { ok: false, error: 'token expired' }
  const expected = signToken(id, action, ts)
  if (expected !== sig) return { ok: false, error: 'signature mismatch' }
  return { ok: true }
}

// ─── Queue I/O ──────────────────────────────────────────────────────────────
async function readQueue(segment) {
  try {
    const val = await segment.getValue(QUEUE_KEY)
    return val ? JSON.parse(val) : []
  } catch (e) {
    if (e?.statusCode === 404 || e?.errorInfo?.statusCode === 404) return []
    throw e
  }
}

async function writeQueue(segment, queue) {
  const str = JSON.stringify(queue)
  try { await segment.update(QUEUE_KEY, str) }
  catch { await segment.put(QUEUE_KEY, str) }
}

// Catalyst Cache per-value cap is ~64-100KB. Don't put draft bodies in the
// queue blob at all — store the full body under its own per-draft key and
// the queue only holds metadata. Keeps queue blob tiny no matter how long
// individual drafts run.
const QUEUE_MAX_ITEMS = 100
const FULL_BODY_KEY = (id) => `capture_draft_body_${id}`

/**
 * Enqueue a draft awaiting approval.
 * Body is stored under a separate per-draft cache key (FULL_BODY_KEY) — the
 * queue blob holds only metadata so it can't bloat past Catalyst's per-value
 * cache cap regardless of how long individual drafts run.
 *
 * The returned entry includes body for the caller's immediate use (e.g.
 * formatApprovalCard) but the persisted queue entry does not.
 */
export async function enqueueDraft(segment, draft) {
  const id = crypto.randomBytes(9).toString('base64url')
  const fullBody = String(draft.body || '')

  // Persist full body under its own key (so publisher + edit/confirm can fetch)
  if (fullBody) {
    try { await segment.update(FULL_BODY_KEY(id), fullBody) }
    catch { await segment.put(FULL_BODY_KEY(id), fullBody) }
  }

  // Metadata-only entry for the queue blob
  const queueEntry = {
    id,
    status: 'pending',
    created_at: new Date().toISOString(),
    channel:        String(draft.channel || ''),
    category:       String(draft.category || ''),
    headline:       String(draft.headline || '').slice(0, 200),
    scheduled_for:  draft.scheduled_for || null,
    voice_score:    Number(draft.voice_score) || null,
    // Voice deductions can be verbose — cap to 3 short reason strings only
    voice_deductions: (draft.voice_deductions || []).slice(0, 3).map(d => ({ reason: String(d.reason || '').slice(0, 120), points: d.points })),
    meta:           draft.meta || {},
    has_body:       Boolean(fullBody),
  }
  const queue = await readQueue(segment)
  const next = [queueEntry, ...queue].slice(0, QUEUE_MAX_ITEMS)
  await writeQueue(segment, next)

  // Return entry with body attached for caller's immediate use (Cliq card etc)
  return { ...queueEntry, body: fullBody }
}

/**
 * Read the full untruncated body for a draft (used by the publisher).
 * Falls back to the queue body if the separate key is missing.
 */
export async function getDraftFullBody(segment, id) {
  try {
    const val = await segment.getValue(FULL_BODY_KEY(id))
    if (val) return val
  } catch (e) {
    if (!(e?.statusCode === 404 || e?.errorInfo?.statusCode === 404)) throw e
  }
  // Fallback: queue body (may be truncated)
  const d = await getDraft(segment, id)
  return d?.body || ''
}

/**
 * Save an edited full body. Stores full at FULL_BODY_KEY, returns a
 * { truncated, was_truncated } pair the caller stores in the queue blob.
 * Used by the edit POST flow so the same split-storage pattern applies.
 */
export async function setDraftBody(segment, id, fullBody) {
  const safe = String(fullBody || '')
  if (safe) {
    try { await segment.update(FULL_BODY_KEY(id), safe) }
    catch { await segment.put(FULL_BODY_KEY(id), safe) }
  }
  const truncated = safe.length > QUEUE_BODY_PREVIEW_CHARS
    ? safe.slice(0, QUEUE_BODY_PREVIEW_CHARS) + '\n…[truncated for queue display, full text on publish]'
    : safe
  return { truncated, was_truncated: safe.length > QUEUE_BODY_PREVIEW_CHARS }
}

export async function listQueue(segment, filter = {}) {
  const q = await readQueue(segment)
  if (filter.status) return q.filter(d => d.status === filter.status)
  if (filter.channel) return q.filter(d => d.channel === filter.channel)
  return q
}

export async function getDraft(segment, id) {
  const q = await readQueue(segment)
  return q.find(d => d.id === id) || null
}

/**
 * Update a draft's status. Returns the updated entry or null if not found.
 */
export async function updateDraft(segment, id, patch) {
  const queue = await readQueue(segment)
  const idx = queue.findIndex(d => d.id === id)
  if (idx === -1) return null
  queue[idx] = { ...queue[idx], ...patch, updated_at: new Date().toISOString() }
  await writeQueue(segment, queue)
  return queue[idx]
}

// Helper used by the bot to format approval Cliq card text. Includes the
// scored deduction list so Mark can see voice issues at a glance.
export function formatApprovalCard({ entry, baseUrl }) {
  const approve = buildSignedActionUrl(baseUrl, entry.id, 'approve')
  const edit    = buildSignedActionUrl(baseUrl, entry.id, 'edit')
  const kill    = buildSignedActionUrl(baseUrl, entry.id, 'kill')

  const dedSummary = (entry.voice_deductions || [])
    .slice(0, 3)
    .map(d => `• ${d.reason}`)
    .join('\n') || '_(clean voice score)_'

  return [
    `📝 *DRAFT FOR APPROVAL*`,
    `Channel: *${entry.channel}* · Category: *${entry.category}*`,
    `Voice score: *${entry.voice_score ?? '—'}/100*`,
    entry.scheduled_for ? `Scheduled: *${entry.scheduled_for}*` : '',
    '',
    entry.headline ? `*${entry.headline}*` : '',
    entry.body,
    '',
    `🔍 *Voice notes:*`,
    dedSummary,
    '',
    `👍 *Approve:* ${approve}`,
    `✏️ *Edit & approve:* ${edit}`,
    `❌ *Kill:* ${kill}`,
  ].filter(Boolean).join('\n').slice(0, 6000)
}
