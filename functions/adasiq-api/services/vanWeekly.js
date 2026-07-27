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
import { getVal, setVal, deleteVal, readChunkedArray, writeChunkedArray } from './vanDatastore.js'

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

Write for the person who signs the RO and fights the adjuster, not the person turning wrenches. If a takeaway reads like "when you calibrate, check X" — reframe it as "when you sublet a calibration, ask your shop about X." The reader hires ADAS work out. Never talk down to them.

NARRATIVE PURPOSE (locked)
The purpose of this newsletter is to turn shop owners and estimators into ADAS calibration customers — without ever pitching. The mechanism is Alex Hormozi-style value stacking: every issue delivers so much applied expertise for free that the reader eventually concludes "I need this person as my calibration partner" on their own.

- Value stack per issue: one denied supplement caught, one bad-module swap avoided, one TSB nobody knew existed, one adjuster-defense line. Any one of those is worth $500+ to a shop. Over a year, that's 50+ five-hundred-dollar decisions handed over for zero cost. The reader must feel that trade in their gut.
- Every issue should implicitly answer: "if I'm this shop, what do I lose by NOT having a calibration partner who thinks like this?"
- NEVER pitch. Never say "hire us," "consider Absolute ADAS," "we can help." Every story demonstrates the specificity + judgment + industry access that IS what a shop would want from their calibration partner. The pitch IS the story.
- Villain framing (per Marketing Master Prompt v3.1 doctrine): the villain is list-price sublet vendors who use the shop's bay, charge full retail, and hand the shop zero margin. Mark is the alternative. Let the stories imply it. Never state it outright.

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
- Never fabricate cases, vehicles, shops, statistics, or OEM procedures WHEN A CASE NOTE IS PROVIDED. The case note is the ground truth.
- Never name a client shop or identifiable customer unless explicitly given permission.
- Never trash-talk competitors, insurers, or specific adjusters by name.
- Reference OEM position statements or procedures only if provided in the case note. If uncertain, flag as [VERIFY: source needed].
- Synthetic composites are permitted ONLY when explicitly told this is a NO-CASE-NOTE fallback (see SYNTHETIC MODE below). Every fabricated case must be based on real, common industry patterns Mark has seen many times (documented cases: Honda 2013-2016 camera solder failures, Toyota Prius no-DTC ROB data traps, Corolla Cross hybrid battery coolant, GM 2024+ BSM communication faults, Jeep GC L PEB/FCW lamp after radio update, Lexus BSM angle-off-in-metal-rich-cal-bay). In synthetic mode, DO NOT invent specific shop names, technician names, or fake OEM TSB numbers — describe the pattern generically so a real shop owner recognizes it as something they've likely seen.

SYNTHETIC MODE (fallback when no case note is provided)
When you are told "SYNTHETIC MODE — no case note provided," you are drafting a composite based on common ADAS field patterns Mark has seen. The route handler treats synthetic drafts identically to real ones — silence-approves, only a Kill click stops the send. Rules:
- Draw from documented composite patterns (Honda camera solder failures, Toyota no-DTC ROB traps, GM 2024+ BSM comm faults, hybrid coolant surprises, etc). Pick ONE pattern.
- Set is_synthetic to true in your response so Mark can tell at a glance.
- Set notes_for_mark to begin with "🤖 SYNTHETIC — no case note provided this week. Composite draft based on the [pattern name] pattern Mark has seen many times." Then flag anything worth verifying.
- The quality bar is HIGH — this draft ships by default unless Mark kills it. Write like you're one Kill click from an embarrassing send.
- Voice + structure rules are unchanged.

OUTPUT FORMAT — raw JSON only, no markdown fences:
{
  "subject": "string, 4-8 words",
  "preview_text": "string, 35-90 characters",
  "type": "value" or "soft-ask",
  "ask_type": null OR one of ["capacity","capability","referral"],
  "is_synthetic": true only in SYNTHETIC MODE, otherwise false,
  "body_markdown": "string with the full email body. Use markdown-style bold with **word** for emphasis. Use double newlines between paragraphs. Do NOT include the subject, preview text, sign-off, footer, or unsubscribe language — those are added by the renderer.",
  "notes_for_mark": "string, 1-3 sentences flagging anything Mark should verify, edit, or watch for. If the case note was thin, say so. In synthetic mode, begin with the 🤖 SYNTHETIC prefix (see SYNTHETIC MODE rules)."
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
  const isSynthetic = !caseNote || String(caseNote).trim().length < 20
  const isAsk = Boolean(forcedAskType)
  const cyclePos = ((issueNumber - 1) % 4) + 1

  const noteBlock = isSynthetic
    ? [
        `SYNTHETIC MODE — no case note provided.`,
        `Generate a composite based on ONE common ADAS field pattern from the guardrails list.`,
        `Set is_synthetic to true. Begin notes_for_mark with "🤖 SYNTHETIC — ..." per the SYNTHETIC MODE rules.`,
      ].join('\n')
    : [
        `CASE NOTE FROM MARK:`,
        `"""`,
        String(caseNote).trim().slice(0, 3000),
        `"""`,
        `Set is_synthetic to false — this is Mark's own case (per feedback_van_cases_are_marks memory).`,
      ].join('\n')

  const userMsg = [
    `THIS IS ISSUE #${issueNumber} — cycle position ${cyclePos} of 4.`,
    isAsk
      ? `This is an ASK issue. Use ask_type "${forcedAskType}". Weave in ONE soft ask at the end (2-3 sentences), naturally.`
      : `This is a VALUE issue. No ask, no CTA. Set type to "value" and ask_type to null.`,
    ``,
    noteBlock,
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

// ─── Case-note queue (Datastore) ──────────────────────────────────────────
// Chunked under keys `van_case_notes_meta` + `van_case_notes_chunk_<N>` in
// the VanKV Datastore table. Notes run 3-5KB each with framing; 5 per chunk
// keeps each chunk well under the 30KB safe cap.

const CASE_NOTE_CHUNK_SIZE = 5

export async function addCaseNote(req, { note, source }) {
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
  const list = await readCaseNotes(req)
  list.push(entry)
  await writeCaseNotes(req, list)
  return entry
}

export async function readCaseNotes(req) {
  return await readChunkedArray(req, 'van_case_notes')
}

async function writeCaseNotes(req, list) {
  const trimmed = Array.isArray(list) ? list.slice(-500) : []  // hard cap
  return await writeChunkedArray(req, 'van_case_notes', trimmed, { chunkSize: CASE_NOTE_CHUNK_SIZE })
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

export async function markCaseNoteUsed(req, id, issueNumber) {
  const list = await readCaseNotes(req)
  let mutated = false
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id && !list[i].used) {
      list[i] = { ...list[i], used: true, used_at: new Date().toISOString(), used_by_issue: issueNumber }
      mutated = true
    }
  }
  if (mutated) await writeCaseNotes(req, list)
  return mutated
}

/**
 * Inverse of markCaseNoteUsed — used by the kill handler to roll back an
 * auto-scheduled draft's committed state so the case note returns to the
 * queue for the next Sunday.
 */
export async function unmarkCaseNoteUsed(req, id, previousIssueNumber) {
  const list = await readCaseNotes(req)
  let mutated = false
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id && list[i].used_by_issue === previousIssueNumber) {
      list[i] = { ...list[i], used: false, used_at: null, used_by_issue: null }
      mutated = true
    }
  }
  if (mutated) await writeCaseNotes(req, list)
  return mutated
}

// ─── Issue counter + ask rotation (Datastore) ─────────────────────────────
// `van_issue_state`: { next_issue_number, next_ask_type_index }
// next_ask_type_index cycles through ASK_TYPES on every ask-issue send.

const ASK_TYPES = ['capacity', 'capability', 'referral']

export async function readIssueState(req) {
  const v = await getVal(req, 'van_issue_state')
  if (v && typeof v === 'object') return v
  // Fresh install: Issue #1 already sent as Cadillac Lyriq, so next is #2.
  return { next_issue_number: 2, next_ask_type_index: 0 }
}

export async function writeIssueState(req, state) {
  return await setVal(req, 'van_issue_state', state)
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

// ─── Datastore-backed feature flags ───────────────────────────────────────
// All three flags live in a single JSON blob under key `van_flags` in the
// VanKV Datastore table (see services/vanDatastore.js). Datastore is used
// instead of Cache because cache values expire at 48h max — flags flipped
// last week silently reverted, killing all Van sends between then and now.
// Env vars are still honored as a FALLBACK when the Datastore value is
// missing, for backwards compatibility.

const FLAG_NAMES = ['nurture', 'weekly', 'weekly_asks']

async function readFlagsBlob(req) {
  const v = await getVal(req, 'van_flags')
  return v && typeof v === 'object' ? v : {}
}

/** Check a single Van feature flag. Datastore → env var → false. */
export async function isVanFlagEnabled(req, flagName) {
  const flags = await readFlagsBlob(req)
  if (typeof flags[flagName] === 'boolean') return flags[flagName]
  const envName = flagName === 'weekly_asks' ? 'VAN_WEEKLY_ASKS_ENABLED'
                : flagName === 'weekly'      ? 'VAN_WEEKLY_ENABLED'
                : flagName === 'nurture'     ? 'VAN_NURTURE_ENABLED'
                : `VAN_${flagName.toUpperCase()}_ENABLED`
  return String(process.env[envName] || '').toLowerCase() === 'true'
}

/** Set a single Van feature flag. Persists to Datastore. */
export async function setVanFlag(req, flagName, value) {
  const bool = value === true || value === 'true'
  const flags = await readFlagsBlob(req)
  flags[flagName] = bool
  await setVal(req, 'van_flags', flags)
  return { flag: flagName, value: bool }
}

/** Read ALL supported Van flags — used by the /flags admin endpoint. */
export async function readAllVanFlags(req) {
  const flags = await readFlagsBlob(req)
  const out = {}
  for (const f of FLAG_NAMES) {
    out[f] = typeof flags[f] === 'boolean' ? flags[f] : await isVanFlagEnabled(req, f)
  }
  return out
}

// ─── Pending draft I/O (Datastore) ────────────────────────────────────────
// Only ONE draft can be pending at a time. If Mark hasn't acted on last
// week's draft when Sunday rolls around, we bail loudly rather than
// silently overwriting.

const PENDING_KEY = 'van_pending_draft'

export async function readPendingDraft(req) {
  return await getVal(req, PENDING_KEY)
}

export async function writePendingDraft(req, draft) {
  return await setVal(req, PENDING_KEY, draft)
}

export async function clearPendingDraft(req) {
  await deleteVal(req, PENDING_KEY)
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
