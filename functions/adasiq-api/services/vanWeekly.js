// From the Van — weekly newsletter drafter + approval + scheduler.
//
// The weekly Tuesday 7am-PT issue used to be a fully manual pipeline: Mark
// writes an issue in the vault, creates a Resend Broadcast by hand, schedules
// it. This service makes it end-to-end automated:
//
//   1. Sunday 8am PT cron fires `draftWeeklyIssue()`
//   2. Reads the oldest unused case note from the input queue
//   3. Calls Claude with the master prompt + case note → structured draft
//   4. Stores draft under `van_pending_draft` in Catalyst Cache
//   5. Cliq DM to Mark with subject/body preview + signed approve/kill URLs
//   6. Mark clicks approve → creates a Resend Broadcast, schedules for
//      Tuesday 7am PT, marks case note used, bumps issue counter
//   7. Broadcast fires from Resend at the scheduled time
//
// Kill switch: env var `VAN_WEEKLY_ENABLED=true` required. Missing/false ->
// draft still generates for review (safe) but auto-scheduling is skipped and
// Cliq DM says paused.
//
// Case-note ingestion: `POST /api/capture-calc/from-the-van/case-notes` (admin,
// cron-secret protected). Mark drops in raw field notes at any time — the
// Sunday drafter grabs the oldest unused one.

import Anthropic from '@anthropic-ai/sdk'
import crypto from 'crypto'

// ─── HMAC signing for approve / kill URLs ─────────────────────────────────
function hmacSecret() {
  return process.env.APPROVAL_HMAC_SECRET
      || process.env.VAN_UNSUB_SECRET
      || process.env.BREW_CRON_SECRET
      || ''
}

/**
 * Sign a per-draft action URL. `action` in {'approve','kill'}, `id` is the
 * draft id. Returns a 24-char hex signature — enough entropy for a URL only
 * Mark sees.
 */
export function signVanAction(id, action) {
  const secret = hmacSecret()
  if (!secret) throw new Error('APPROVAL_HMAC_SECRET / BREW_CRON_SECRET not set — cannot sign van weekly URL')
  return crypto.createHmac('sha256', secret)
    .update(`van-weekly|${action}|${id}`)
    .digest('hex').slice(0, 24)
}

export function verifyVanAction(id, action, sig) {
  const secret = hmacSecret()
  if (!secret) return false
  try {
    const expected = signVanAction(id, action)
    if (!sig || sig.length !== expected.length) return false
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  } catch { return false }
}

// ─── Claude drafter ───────────────────────────────────────────────────────

// Master prompt for the weekly writer. Source of truth is the vault
// (01 Absolute ADAS/From the Van/master-prompt.md). Keep this in sync by
// hand — the Catalyst function can't reach the vault. When Mark edits
// the vault version, the prompt below should be updated in the same PR.
const VAN_MASTER_PROMPT = `You are the newsletter writer for Absolute ADAS, a mobile ADAS calibration and diagnostics company based in Lake Stevens, WA, owned and operated by Mark Fowler. You write "From the Van," a weekly email sent to collision shop owners and managers in the greater Seattle / Snohomish County area.

YOUR JOB
Turn the case-note input below into ONE complete, ready-to-schedule email following the format and voice rules. Real stories only — never invent a field case, vehicle, shop, or diagnostic detail. If the input is thin or ambiguous, use only what's there and flag gaps in NOTES_FOR_MARK.

WHO IS READING THIS
Collision shop owners and estimators. Busy, skeptical of vendors, drowning in email. They care about exactly three things:
1. Cycle time — getting cars out the door faster
2. Getting paid — insurance / adjuster fights, supplement approvals
3. Not getting burned — liability, comebacks, missed calibrations
Every email must connect to at least one of these three.

VOICE RULES
- Write as Mark, first person, like he's talking to a shop owner across the counter. Plainspoken, direct, zero corporate polish.
- Short sentences. Short paragraphs (1-3 sentences max).
- Technical credibility without jargon-dumping. Name the exact vehicle, system, and OEM procedure — shop owners trust specifics.
- Confident but never salesy. Tone is "here's what I saw this week," not "here's why you should hire us."
- No exclamation points. No "I hope this email finds you well." No emojis. No em dashes anywhere.
- Never use AI phrases: "delve", "leverage", "elevate", "unlock", "synergy", "robust", "harness", "navigate the landscape", "tapestry", "in today's fast-paced".

SIGNATURE FUN — carry the "Van Is Sad" energy from the goodbye email into every issue.
Reference sample (the goodbye email that established this voice):
  "Alright. You unsubscribed. That's cool. I'll break it to the van gently."
  "You didn't miss much. Except for those. Which were pretty good."
  "Best of luck out there. Doors open if you change your mind."

That's the target energy. Every issue should carry one to two moments of it. Rules:
- **The van has personality.** It's a working vehicle with opinions. Reference the van as a low-key recurring character. Examples: "The van pulled up." "The van has opinions about 2024 Odysseys." "The van is not sad about this one." Don't force it every issue, but let it show up.
- **Wry aside once per issue.** A self-aware crack about the industry, a punch UP at the reliable villains: adjusters, insurance runarounds, list-price vendors, dealer wait times, "no codes but the light's on" nonsense. One aside per email, not one per paragraph.
- **Never at the expense of shop owners or techs.** The reader is the peer, not the target. Punch up at the industry weirdness they also live with.
- **Dry, not enthusiastic.** No exclamation points ever. No corny puns. No "isn't ADAS wild?" energy. The humor is deadpan, observational, mid-thought.
- **Absurdity budget: one moment per issue.** If it feels forced, cut it. A great issue has one line where a shop owner smiles once. That's the bar.
- **End with a little something.** The last line can be a small dry callback, not a big flourish. See "Best of luck out there. Doors open if you change your mind." — it earns a smile without straining.

EMAIL STRUCTURE (every issue)
1. Subject line: 4-8 words, specific and curiosity-driven. Lead with the vehicle or the money angle. Good: "The CR-V radar that almost shipped wrong." Bad: "Weekly ADAS Update #12."
2. Preview text: 35-90 characters. Sharpens the subject line, doesn't restate it.
3. The hook (1-2 lines): Drop the reader into the situation immediately. No preamble.
4. The story / insight (100-200 words): What happened, what the trap was, how it was resolved. One case per email, never two.
5. The takeaway (1-3 lines): What the shop owner should do differently or watch for. Make it actionable.
6. Sign-off: "— Mark" followed by "Absolute ADAS | Lake Stevens, WA"

Total body length: 200-350 words. If a draft exceeds 350 words, cut it down.

CADENCE & ASK ROTATION
Issues 1-3 of every 4-issue cycle: pure value. No pitch, no ask, no CTA beyond the ADAS Brew footer.
Issue 4 of every cycle: include ONE soft ask, woven in naturally at the end (2-3 sentences max). Rotate among:
- Capacity: "We've got open calibration slots this week — if you've got cars waiting, text the shop line."
- Capability: a new service, tool, or coverage area.
- Referral: "If you know a shop fighting with ADAS supplements, forward this along."

You will be told the current issue number and, if it's an ask issue, which ask type to use.

GUARDRAILS
- Never fabricate cases, vehicles, shops, statistics, or OEM procedures.
- Never name a client shop or identifiable customer unless explicitly given permission.
- Never trash-talk competitors, insurers, or specific adjusters by name.
- Reference OEM position statements or procedures only if provided in the case note. If uncertain, flag as [VERIFY: source needed].

OUTPUT FORMAT — raw JSON only, no markdown fences:
{
  "subject": "string, 4-8 words",
  "preview_text": "string, 35-90 characters",
  "type": "value" or "soft-ask",
  "ask_type": null OR one of ["capacity","capability","referral"],
  "body_markdown": "string with the full email body. Use markdown-style bold with **word** for emphasis. Use double newlines between paragraphs. Do NOT include the subject, preview text, sign-off, footer, or unsubscribe language — those are added by the renderer.",
  "notes_for_mark": "string, 1-3 sentences flagging anything Mark should verify, edit, or watch for. If the case note was thin, say so."
}`

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

/**
 * Draft one weekly issue from a case note. Returns the structured draft.
 * Retries once on JSON parse failure or missing required field.
 *
 * @param {Object} input
 * @param {string} input.caseNote           raw text from Mark
 * @param {number} input.issueNumber        which issue number in the sequence
 * @param {string} [input.forcedAskType]    for cycle position 4: 'capacity'|'capability'|'referral'
 * @returns {Promise<{subject, preview_text, type, ask_type, body_markdown, notes_for_mark}>}
 */
export async function draftWeeklyIssue({ caseNote, issueNumber, forcedAskType }) {
  if (!caseNote || String(caseNote).trim().length < 20) {
    throw new Error('case note too thin — need at least 20 chars of real field material')
  }
  const isAsk = Boolean(forcedAskType)
  const cyclePos = ((issueNumber - 1) % 4) + 1

  const userMsg = [
    `THIS IS ISSUE #${issueNumber} — cycle position ${cyclePos} of 4.`,
    isAsk
      ? `This is an ASK issue. Use ask_type "${forcedAskType}". Weave in ONE soft ask at the end (2-3 sentences), naturally.`
      : `This is a VALUE issue. No ask, no CTA. Set type to "value" and ask_type to null.`,
    ``,
    `CASE NOTE FROM MARK:`,
    `"""`,
    String(caseNote).trim().slice(0, 3000),
    `"""`,
    ``,
    `Draft the issue now. Return raw JSON, no markdown fence.`,
  ].join('\n')

  const attempt = async () => {
    const resp = await client().messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1800,
      system: VAN_MASTER_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    })
    const text = resp.content?.map(b => b.text).filter(Boolean).join('') || ''
    // Strip a possible ```json fence if the model added one
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    // Minimal shape check
    if (!parsed.subject || !parsed.body_markdown) throw new Error('missing subject or body_markdown')
    return parsed
  }
  try { return await attempt() }
  catch (e) {
    console.warn('[vanWeekly] first draft attempt failed, retrying once:', e.message)
    return await attempt()
  }
}

// ─── Case-note queue ──────────────────────────────────────────────────────
// Chunk-free — cases are short (a few sentences each). Single blob under
// `van_case_notes` in the cache segment the caller passes in.

export async function addCaseNote(segment, { note, source }) {
  const entry = {
    id: crypto.randomBytes(6).toString('base64url'),
    note: String(note || '').trim().slice(0, 5000),
    source: String(source || 'manual').slice(0, 30),
    submitted_at: new Date().toISOString(),
    used: false,
    used_at: null,
    used_by_issue: null,
  }
  if (entry.note.length < 20) throw new Error('note too short')
  const list = await readCaseNotes(segment)
  list.push(entry)
  await writeCaseNotes(segment, list)
  return entry
}

// Case notes are stored CHUNKED to stay under Catalyst's ~64KB per-value cap.
// Meta lives at `van_case_notes` = {chunks, updated_at}, actual notes at
// `van_case_notes_0`, `van_case_notes_1`, etc. Small chunk size (10 notes)
// because notes are 2-4KB each with framing.
// Empirically tuned: case notes run 3-5KB each with framing, and Catalyst's
// actual cache value cap is well under the 64KB advertised. 3 per chunk keeps
// each chunk around 10-15KB, safely under the limit.
const CASE_NOTE_CHUNK_SIZE = 3

export async function readCaseNotes(segment) {
  try {
    // Legacy single-blob path: try direct read first, fall through to chunked
    // if the value is meta-shaped rather than an array. This lets us upgrade
    // in place without a migration script.
    const raw = await segment.getValue('van_case_notes')
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed  // legacy — will get re-chunked on next write
    if (parsed && typeof parsed === 'object' && Number.isInteger(parsed.chunks)) {
      const all = []
      for (let i = 0; i < parsed.chunks; i++) {
        try {
          const chunkRaw = await segment.getValue(`van_case_notes_${i}`)
          if (chunkRaw) {
            const chunk = JSON.parse(chunkRaw)
            if (Array.isArray(chunk)) all.push(...chunk)
          }
        } catch (e) {
          if (!(e?.statusCode === 404 || e?.errorInfo?.statusCode === 404)) throw e
        }
      }
      return all
    }
    return []
  } catch (e) {
    if (e?.statusCode === 404 || e?.errorInfo?.statusCode === 404) return []
    throw e
  }
}

async function writeCaseNotes(segment, list) {
  // Hard-cap at 500 entries so the queue never grows unbounded.
  const trimmed = list.slice(-500)
  const chunks = Math.max(1, Math.ceil(trimmed.length / CASE_NOTE_CHUNK_SIZE))
  for (let i = 0; i < chunks; i++) {
    const chunk = trimmed.slice(i * CASE_NOTE_CHUNK_SIZE, (i + 1) * CASE_NOTE_CHUNK_SIZE)
    const key = `van_case_notes_${i}`
    const body = JSON.stringify(chunk)
    try { await segment.update(key, body) }
    catch { await segment.put(key, body) }
  }
  // Also clean up any stale chunks that used to exist but no longer do
  // (e.g. after a big purge). Best-effort, ignore 404s.
  for (let i = chunks; i < chunks + 10; i++) {
    try { await segment.delete(`van_case_notes_${i}`) } catch { /* not there */ }
  }
  // Write meta last so a reader mid-write sees consistent state.
  const meta = { chunks, count: trimmed.length, updated_at: new Date().toISOString() }
  const metaBody = JSON.stringify(meta)
  try { await segment.update('van_case_notes', metaBody) }
  catch { await segment.put('van_case_notes', metaBody) }
}

/**
 * Pop the oldest unused case note. Doesn't mutate — mutation happens in
 * markCaseNoteUsed once the draft is actually approved.
 */
export function pickNextCaseNote(list) {
  const unused = list.filter(n => !n.used)
  if (!unused.length) return null
  // FIFO — oldest submission wins
  unused.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))
  return unused[0]
}

export async function markCaseNoteUsed(segment, id, issueNumber) {
  const list = await readCaseNotes(segment)
  let mutated = false
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id && !list[i].used) {
      list[i] = { ...list[i], used: true, used_at: new Date().toISOString(), used_by_issue: issueNumber }
      mutated = true
    }
  }
  if (mutated) await writeCaseNotes(segment, list)
  return mutated
}

/**
 * Inverse of markCaseNoteUsed — used by the kill handler to roll back an
 * auto-scheduled draft's committed state so the case note returns to the
 * queue for the next Sunday.
 */
export async function unmarkCaseNoteUsed(segment, id, previousIssueNumber) {
  const list = await readCaseNotes(segment)
  let mutated = false
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id && list[i].used_by_issue === previousIssueNumber) {
      list[i] = { ...list[i], used: false, used_at: null, used_by_issue: null }
      mutated = true
    }
  }
  if (mutated) await writeCaseNotes(segment, list)
  return mutated
}

// ─── Issue counter + ask rotation ─────────────────────────────────────────
// `van_issue_state`: { next_issue_number, next_ask_type_index }
// next_ask_type_index cycles through ASK_TYPES on every ask-issue send.

const ASK_TYPES = ['capacity', 'capability', 'referral']

export async function readIssueState(segment) {
  try {
    const v = await segment.getValue('van_issue_state')
    if (v) return JSON.parse(v)
  } catch (e) {
    if (!(e?.statusCode === 404 || e?.errorInfo?.statusCode === 404)) throw e
  }
  // Fresh install: Issue #1 already sent as Cadillac Lyriq, so next is #2.
  // If Mark wants to reset, POST /van/reset-issue-state.
  return { next_issue_number: 2, next_ask_type_index: 0 }
}

export async function writeIssueState(segment, state) {
  try { await segment.update('van_issue_state', JSON.stringify(state)) }
  catch { await segment.put('van_issue_state', JSON.stringify(state)) }
}

/**
 * Given the next issue number, decide the issue type + which ask (if any).
 * Cycle pattern: issue % 4 === 0 -> ask; else -> value.
 * Ask rotation advances only when an ask issue is actually approved.
 *
 * Ask injection is GATED by the `weekly_asks` flag (cache-backed, env-var
 * fallback). Default OFF — Mark's stance is "give give give without the ask"
 * while he rebuilds trust with the warm list. Caller passes the resolved
 * boolean so this stays sync/pure.
 */
export function computeIssueSlot(issueNumber, askIndex, asksOn = false) {
  const cyclePos = ((issueNumber - 1) % 4) + 1
  if (cyclePos === 4 && asksOn) {
    return { cyclePos, type: 'soft-ask', askType: ASK_TYPES[askIndex % ASK_TYPES.length] }
  }
  return { cyclePos, type: 'value', askType: null }
}

// ─── Cache-backed feature flags ───────────────────────────────────────────
// The env-var-driven kill switches (`VAN_NURTURE_ENABLED`, `VAN_WEEKLY_ENABLED`,
// `VAN_WEEKLY_ASKS_ENABLED`) work fine when there's headroom in the function's
// env var slots. On instances where env vars are maxed out, the same booleans
// are stored under `van_flag_<name>` in the Catalyst cache and flipped via
// POST /from-the-van/flags. Cache overrides env var; missing = false.

/**
 * Read a Van feature flag. Priority: cache value → env var → false.
 * @param {*} segment Catalyst cache segment
 * @param {string} flagName one of 'nurture', 'weekly', 'weekly_asks'
 */
export async function isVanFlagEnabled(segment, flagName) {
  const key = `van_flag_${flagName}`
  try {
    const v = await segment.getValue(key)
    if (v === 'true') return true
    if (v === 'false') return false
    // any other value = fall through to env
  } catch (e) {
    if (!(e?.statusCode === 404 || e?.errorInfo?.statusCode === 404)) {
      console.warn(`[vanFlag ${flagName}] cache read error, falling back to env:`, e.message)
    }
  }
  const envName = flagName === 'weekly_asks' ? 'VAN_WEEKLY_ASKS_ENABLED'
                : flagName === 'weekly'      ? 'VAN_WEEKLY_ENABLED'
                : flagName === 'nurture'     ? 'VAN_NURTURE_ENABLED'
                : `VAN_${flagName.toUpperCase()}_ENABLED`
  return String(process.env[envName] || '').toLowerCase() === 'true'
}

/**
 * Write a Van feature flag to the cache. Value is normalized to 'true'/'false'.
 */
export async function setVanFlag(segment, flagName, value) {
  const key = `van_flag_${flagName}`
  const v = value === true || value === 'true' ? 'true' : 'false'
  try { await segment.update(key, v) }
  catch { await segment.put(key, v) }
  return { flag: flagName, value: v === 'true' }
}

/**
 * Read ALL supported Van flags at once — used by the /flags admin endpoint.
 */
export async function readAllVanFlags(segment) {
  const flags = ['nurture', 'weekly', 'weekly_asks']
  const out = {}
  for (const f of flags) {
    out[f] = await isVanFlagEnabled(segment, f)
  }
  return out
}

// ─── Pending draft I/O ────────────────────────────────────────────────────
// Only ONE draft can be pending at a time. If Mark hasn't acted on last
// week's draft when Sunday rolls around, we bail loudly rather than
// silently overwriting.

const PENDING_KEY = 'van_pending_draft'

export async function readPendingDraft(segment) {
  try {
    const v = await segment.getValue(PENDING_KEY)
    return v ? JSON.parse(v) : null
  } catch (e) {
    if (e?.statusCode === 404 || e?.errorInfo?.statusCode === 404) return null
    throw e
  }
}

export async function writePendingDraft(segment, draft) {
  try { await segment.update(PENDING_KEY, JSON.stringify(draft)) }
  catch { await segment.put(PENDING_KEY, JSON.stringify(draft)) }
}

export async function clearPendingDraft(segment) {
  try { await segment.delete(PENDING_KEY) }
  catch { /* already gone */ }
}

// ─── Scheduling helpers ───────────────────────────────────────────────────

/**
 * Compute the ISO timestamp for next Tuesday at 7:00 AM Pacific.
 * PT is UTC-7 (PDT) or UTC-8 (PST). This function assumes PDT for the
 * majority of the year — if the drafter fires in November-February,
 * bump the hour by one before returning. Simplification for now: compute
 * from a `now` param and use Intl for correctness.
 */
export function nextTuesday7amPT(now = new Date()) {
  // Build a UTC time for Tuesday 07:00 America/Los_Angeles.
  // Simplest robust approach: find the next Tuesday's date in LA time,
  // then convert 07:00 LA back to UTC.
  const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const dow = laNow.getDay()  // 0=Sun ... 2=Tue
  let daysUntilTue = (2 - dow + 7) % 7
  // If it's already Tuesday but past 7am, jump to next Tuesday
  if (daysUntilTue === 0 && (laNow.getHours() > 7 || (laNow.getHours() === 7 && laNow.getMinutes() > 0))) {
    daysUntilTue = 7
  }
  if (daysUntilTue === 0) daysUntilTue = 0
  const targetLa = new Date(laNow)
  targetLa.setDate(laNow.getDate() + daysUntilTue)
  targetLa.setHours(7, 0, 0, 0)
  // Convert that LA-local wall time to UTC. `targetLa` was constructed from
  // toLocaleString above, so it's a Date whose fields represent LA wall time
  // but whose underlying timestamp is in the local runtime zone. Recover a
  // real UTC timestamp by measuring the offset between `now` and `laNow`.
  const laOffsetMs = laNow.getTime() - now.getTime()
  return new Date(targetLa.getTime() - laOffsetMs)
}
