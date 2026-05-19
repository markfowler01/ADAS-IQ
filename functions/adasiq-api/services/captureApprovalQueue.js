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

/**
 * Enqueue a draft awaiting approval.
 * @param {Object} segment — Catalyst cache segment
 * @param {Object} draft — {channel, category, body, headline?, scheduled_for?, voice_score?, meta?}
 * @returns {Promise<{id, ...draft}>}
 */
export async function enqueueDraft(segment, draft) {
  const id = crypto.randomBytes(9).toString('base64url')
  const entry = {
    id,
    status: 'pending',
    created_at: new Date().toISOString(),
    channel:        String(draft.channel || ''),
    category:       String(draft.category || ''),
    headline:       String(draft.headline || ''),
    body:           String(draft.body || ''),
    scheduled_for:  draft.scheduled_for || null,
    voice_score:    Number(draft.voice_score) || null,
    voice_deductions: draft.voice_deductions || [],
    meta:           draft.meta || {},
  }
  const queue = await readQueue(segment)
  const next = [entry, ...queue].slice(0, 200)
  await writeQueue(segment, next)
  return entry
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
