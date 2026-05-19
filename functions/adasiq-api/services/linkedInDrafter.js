// LinkedIn personal-profile draft generator.
//
// Mark posts 5 times a week (Mon-Fri, 6-8am PT) on his personal profile:
//   2 story posts  (Mon, Wed)
//   2 educational/framework posts  (Tue, Thu)
//   1 case study or testimonial  (Fri)
//
// This service takes Mark's one weekly story (he writes ~200 words from a
// real shop visit on Tue/Wed/Fri mornings per the v2.5 team model) and uses
// Claude to generate 5 distinct LinkedIn drafts that follow the voice
// contract. Kat queues them for Mark's morning approval each weekday.
//
// All drafts ship through sanitizeAiOutput so em dashes / AI tells can't slip
// through, even if Claude regresses on those rules.

import Anthropic from '@anthropic-ai/sdk'
import { sanitizeAiOutput } from './textSanitize.js'
import { scoreDraft } from './voiceScorer.js'

const MIN_VOICE_SCORE = 70   // Brief: re-draft anything below 70
const MAX_RETRIES = 2        // Brief: max 3 retries total (first attempt + 2 retries)

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

const POST_TYPES = [
  { day: 'Mon', type: 'story',     prompt: 'A SHORT STORY POST from the field. Open with a specific scene (place, time, sensory detail). Name the shop owner with a first name only (use a generic first name like "Mike" if the story is composite). Tell one specific moment from the visit — the moment the shop owner realized their old mobile calibration vendor was charging full list and pocketing 100% of the margin while using the shop\'s bay/power/time. End with a single universal lesson and ONE CTA.' },
  { day: 'Tue', type: 'framework', prompt: 'A FRAMEWORK / EDUCATIONAL POST. Lead with a counterintuitive observation about the standard sublet calibration playbook. Walk through one of the 4 components of the Partnership Discount Model (We come to you / We discount off list / You bill at list / Volume rewards you more) and show the per-job dollar math (a $450 static cal billed at list, partner pays $382.50, $67.50 margin to the shop). End with the calculator CTA.' },
  { day: 'Wed', type: 'story',     prompt: 'A SECOND STORY POST. Different angle than Monday. Could be a shop owner who switched vendors and started earning $675/month margin on the same calibration volume they were already doing, or a moment where a shop owner saw the discount line item on the first Absolute ADAS invoice and did the math. Specific. Named characters. End with a lesson + CTA.' },
  { day: 'Thu', type: 'framework', prompt: 'A FRAMEWORK / OPINION POST. Take one side of an industry debate shop owners actually have. Examples: "do you actually save money buying a $250k Autel kit?", "what counts as a fair sublet rate when the vendor uses your bay?", "the difference between a calibration vendor and a calibration partner". Strong opinion, well-defended, no hedging. End with calculator CTA.' },
  { day: 'Fri', type: 'case_study', prompt: 'A CASE STUDY POST. Use the case study material I provide (or a labeled composite if none). Format: shop name (or composite label), city, calibrations/month with Absolute ADAS, monthly margin earned via the partnership discount, one direct quote from the owner. End with the Partnership Audit CTA.' },
]

const SYSTEM_PROMPT = `You are the drafting engine for Mark Fowler's LinkedIn personal-profile posts. Mark is the owner of Absolute ADAS, a mobile ADAS calibration company in Western Washington with 50,000+ calibrations on the floor.

You are writing for his personal LinkedIn profile, not his company page. The audience is body shop owners, MSOs, and insurance industry people. They follow Mark for direct, no-fluff opinions and stories from the field.

VOICE & CONSTRAINTS (locked, non-negotiable):
- Direct, punchy, no fluff. Peer at the counter, not the podium.
- Pattern-interrupt opener every time. Never "Are you a body shop owner who..."
- Use shop-owner vocabulary: GP%, capture rate, cycle time, sublet, DRP, severity, touch time, RO, retail vs trade, comeback, supplement.
- Story over pitch when length allows.
- NEVER use em dashes anywhere.
- NEVER use AI phrases: "delve", "leverage", "in today's fast-paced", "elevate", "unlock", "synergy", "robust", "harness", "navigate the landscape", "tapestry".
- NO hedging: never "may", "might", "could potentially".
- One CTA per post. Not three.
- 100-220 words per post (LinkedIn sweet spot for personal-profile reach).

REQUIRED REFERENCES (every post must include exactly one):
- "The Partnership Discount Model" OR one of the 4 components: "We come to you" / "We discount off list automatically" / "You bill at list" / "Volume rewards you more". Reference by name. Repetition builds the brand of the mechanism.

CANONICAL PRICING (use only these numbers — do not invent):
- Static calibration list price: $450
- Standard partner discount (1-14 jobs/mo): 15% off list = $382.50 partner price = $67.50 margin to the shop per cal
- Volume tier (15-29 jobs/mo): 20% off = $90 margin per cal
- Preferred Partner tier (30+ jobs/mo): 25% off = $112.50 margin per cal + same-day priority + free documentation
- Annual margin examples to anchor headlines:
    10 cals/mo @ 15% = $675/mo = $8,100/year
    15 cals/mo @ 20% = $1,350/mo = $16,200/year
    30 cals/mo @ 25% = $3,375/mo = $40,500/year
- BSM/LKA/Dynamic: $375 list. 360-view: $650 list. Pre/post-scan: $95 each.

CTAs (rotate, one per post):
- "Run your numbers in 60 seconds: absoluteadas.com/calculator"
- "See your shop's annual margin: absoluteadas.com/calculator"
- "Book your 15-min Partnership Audit: absoluteadas.com/audit"
- "DM me 'partner' if your mobile cal vendor still charges you full list."

VILLAIN FRAMING (use selectively, never every post):
- THE VILLAIN IS: "list-price sublet vendors that don't discount." Mobile ADAS calibration companies that show up at the shop's bay, use the shop's power and parking, lean on the shop's tech when they need a hand, charge full list, send the invoice, and leave. They are not bad people. The playbook is what's broken. We are the answer.
- Reference language: "Most mobile calibration vendors charge list and walk away." / "The standard sublet playbook." / "Vendors that don't acknowledge what your shop brings to the job." / "Vendors that don't discount."
- HARD BANS (any of these = failed QA, re-draft):
  · NEVER attack "sublet vendors" as a category (Absolute IS a sublet vendor).
  · NEVER tell shops to bring calibration in-house or buy an Autel kit (we WANT them to keep subletting — to us, not to list-price vendors).
  · NEVER frame calibration as a "leak" or "money walking out the door."
  · NEVER reference "The Absolute Capture System" or the old 4 A's (Audit/Activate/Allocate/Amplify) — that was the prior v2.5 doctrine which self-owned by attacking the sublet model.
  · NEVER mention specific competitor company names (legal risk).

CASE STUDIES:
- If real shop names + numbers are provided, use them verbatim.
- If not, label composites clearly: "Composite of three real shops in our Western Washington portfolio."
- Never invent shop names or numbers without the composite label.

OUTPUT FORMAT: raw JSON only, no markdown:
{
  "drafts": [
    {"day": "Mon", "type": "story",       "headline": "string under 80 chars to summarize", "body": "string with the full post text including line breaks"},
    {"day": "Tue", "type": "framework",   ...},
    {"day": "Wed", "type": "story",       ...},
    {"day": "Thu", "type": "framework",   ...},
    {"day": "Fri", "type": "case_study",  ...}
  ]
}

The body field is the EXACT text Mark will paste into LinkedIn. Format with normal paragraph breaks (\\n\\n between paragraphs). No hashtags inside the body (Kat adds those when queuing).`

/**
 * Generate a week's worth of LinkedIn drafts.
 * @param {Object} input
 * @param {string} input.story        - Mark's 200-ish word raw story from this week's shop visit
 * @param {string} [input.caseStudy]  - Real case study material for Friday's post (shop, owner, numbers)
 * @param {string} [input.angle]      - Optional steering for Tue/Thu (e.g. "Autel kit vs partner")
 * @returns {Promise<{drafts: Array<{day,type,headline,body}>}>}
 */
export async function draftLinkedInWeek({ story, caseStudy = '', angle = '' } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }
  if (!story || story.trim().length < 40) {
    throw new Error('story is required (Mark\'s ~200-word raw story from a shop visit)')
  }

  const slate = POST_TYPES.map((p, i) => `${i + 1}. ${p.day} (${p.type}): ${p.prompt}`).join('\n')

  const userMsg = [
    `MARK'S STORY THIS WEEK (use as raw material for the story posts):`,
    `"""`,
    story.trim().slice(0, 1500),
    `"""`,
    '',
    caseStudy ? [`CASE STUDY MATERIAL FOR FRIDAY:`, `"""`, caseStudy.trim().slice(0, 1500), `"""`].join('\n') : 'NO REAL CASE STUDY PROVIDED — use a labeled composite for Friday.',
    '',
    angle ? `ANGLE STEERING FOR FRAMEWORK POSTS: ${angle.slice(0, 300)}` : '',
    '',
    `Write five LinkedIn posts following this slate exactly:`,
    slate,
    '',
    `Return JSON only. No preamble, no markdown.`,
  ].filter(Boolean).join('\n')

  const client = getClient()
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  })

  const raw = (msg.content?.[0]?.text || '').trim()
  if (!raw) throw new Error('Empty response from Claude')
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    throw new Error(`Could not parse LinkedIn drafts: ${e.message}. Raw: ${cleaned.slice(0, 300)}`)
  }

  const drafts = Array.isArray(parsed.drafts) ? parsed.drafts : []
  const scored = drafts.slice(0, 5).map((d, i) => {
    const day = String(d.day || POST_TYPES[i]?.day || '')
    const type = String(d.type || POST_TYPES[i]?.type || '')
    const headline = sanitizeAiOutput(String(d.headline || '')).slice(0, 120)
    const body = sanitizeAiOutput(String(d.body || '')).slice(0, 2200)
    const { score, deductions } = scoreDraft(body, { channel: 'linkedin' })
    return { day, type, headline, body, voice_score: score, voice_deductions: deductions }
  })

  // Re-draft any below MIN_VOICE_SCORE — max MAX_RETRIES per draft.
  for (let i = 0; i < scored.length; i++) {
    if (scored[i].voice_score >= MIN_VOICE_SCORE) continue
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const redraft = await redraftOne({
        client, originalPrompt: userMsg, draft: scored[i],
        slate, type: scored[i].type, day: scored[i].day,
      })
      if (!redraft) break
      const { score, deductions } = scoreDraft(redraft.body, { channel: 'linkedin' })
      if (score > scored[i].voice_score) {
        scored[i] = { ...scored[i], ...redraft, voice_score: score, voice_deductions: deductions, retries: attempt }
      }
      if (score >= MIN_VOICE_SCORE) break
    }
  }

  return { drafts: scored }
}

// ─── 3-VARIANT-PER-SLOT GENERATOR ────────────────────────────────────────────
// Per the Engineering Brief v1.0: every scheduled slot gets 3 A/B/C variants
// testing different hook angles (greed / fear / identity / curiosity). Mark
// picks the winner via the Cliq approval card.

// v3.1 hooks (Greed / Fairness / Identity). Fear was a v2.5 hook that used
// the "consolidator threat" villain framing — replaced because v3.1 villain
// is "list-price vendors that don't discount", not consolidators.
const DEFAULT_HOOKS = ['greed', 'fairness', 'identity']

const HOOK_GUIDANCE = {
  greed:     'GREED HOOK — open with the dollar margin uncollected. Name a number ($8,100/yr at Standard tier, $16,200/yr at Volume, $40,500/yr at Preferred). Make the reader feel the partnership margin they\'re leaving on the table at their current calibration volume.',
  fairness:  'FAIRNESS HOOK — open with the imbalance. The mobile vendor uses the shop\'s bay, the shop\'s power, the shop\'s tech\'s time, and charges full list anyway. Frame the Partnership Discount Model as the response: vendors that recognize the shop\'s facility is part of the calibration and discount accordingly.',
  identity:  'IDENTITY HOOK — open with the shop owner who runs a sharper operation than the rest. The shop owner who knows the difference between a vendor that charges and a vendor that partners. The shop owner who isn\'t paying list like everyone else.',
  curiosity: 'CURIOSITY HOOK — open with a counterintuitive observation or a hidden number. "The calibration math 95% of shop owners never run." "Why every Absolute ADAS invoice shows a 15% discount line item."',
}

const SLOT_DEFS = {
  Mon: { type: 'story',      prompt: POST_TYPES[0].prompt },
  Tue: { type: 'framework',  prompt: POST_TYPES[1].prompt },
  Wed: { type: 'story',      prompt: POST_TYPES[2].prompt },
  Thu: { type: 'framework',  prompt: POST_TYPES[3].prompt },
  Fri: { type: 'case_study', prompt: POST_TYPES[4].prompt },
}

/**
 * Generate 3 hook-variant drafts for one slot. Each variant tests a different
 * hook angle so Mark can pick the strongest. Voice-scored + retried per slot.
 *
 * @param {Object} input
 * @param {string} input.day        — Mon/Tue/Wed/Thu/Fri
 * @param {string} input.story      — Mark's weekly raw story
 * @param {string} [input.caseStudy]
 * @param {string} [input.angle]
 * @param {Array<string>} [input.hooks] — default ['greed','fear','identity']
 * @returns {Promise<{day, type, variants: [{hook, headline, body, voice_score, voice_deductions}]}>}
 */
export async function draftSlotVariants({ day, story, caseStudy = '', angle = '', hooks = DEFAULT_HOOKS } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')
  if (!story || story.trim().length < 40) throw new Error('story is required')
  const slot = SLOT_DEFS[day]
  if (!slot) throw new Error(`unknown day: ${day}`)

  const variantGuidance = hooks.map(h => `${h.toUpperCase()}: ${HOOK_GUIDANCE[h] || h}`).join('\n')

  const userMsg = [
    `Today's slot: ${day} (${slot.type}).`,
    slot.prompt,
    '',
    'MARK\'S WEEKLY STORY (use as raw material if relevant):',
    `"""`, story.trim().slice(0, 1500), `"""`,
    '',
    caseStudy ? [`CASE STUDY MATERIAL:`, `"""`, caseStudy.trim().slice(0, 1500), `"""`].join('\n') : 'NO REAL CASE STUDY PROVIDED — use a labeled composite if needed.',
    '',
    angle ? `ANGLE STEERING: ${angle.slice(0, 300)}` : '',
    '',
    `Write THREE distinct variants of this single slot — one per hook below. Same slot, same type, three different opening angles. Each variant must be a complete LinkedIn post (100-220 words, full post text, ready to publish).`,
    '',
    variantGuidance,
    '',
    `Return JSON only: {"day":"${day}","type":"${slot.type}","variants":[{"hook":"${hooks[0]}","headline":"...","body":"..."},{"hook":"${hooks[1]}","headline":"...","body":"..."},{"hook":"${hooks[2]}","headline":"...","body":"..."}]}`,
  ].filter(Boolean).join('\n')

  const client = getClient()
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  })
  const raw = (msg.content?.[0]?.text || '').trim()
  if (!raw) throw new Error('Empty response from Claude')
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
  let parsed
  try { parsed = JSON.parse(cleaned) }
  catch (e) { throw new Error(`Could not parse variants: ${e.message}. Raw: ${cleaned.slice(0, 200)}`) }

  const variants = Array.isArray(parsed.variants) ? parsed.variants : []
  const scored = variants.slice(0, 3).map((v, i) => {
    const hook = String(v.hook || hooks[i] || '').toLowerCase()
    const headline = sanitizeAiOutput(String(v.headline || '')).slice(0, 120)
    const body = sanitizeAiOutput(String(v.body || '')).slice(0, 2200)
    const { score, deductions } = scoreDraft(body, { channel: 'linkedin' })
    return { hook, headline, body, voice_score: score, voice_deductions: deductions }
  })

  return { day, type: slot.type, variants: scored }
}

/**
 * Convenience batch: draft Mon-Fri 3-variant slots in parallel. Used by the
 * Sunday-night cron to seed the week's approval queue.
 *
 * @param {{story, caseStudy?, angle?}} input
 * @returns {Promise<Array<{day, type, variants}>>}
 */
export async function draftWeekVariants({ story, caseStudy = '', angle = '' } = {}) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const results = await Promise.allSettled(
    days.map(day => draftSlotVariants({ day, story, caseStudy, angle }))
  )
  return results
    .map((r, i) => r.status === 'fulfilled' ? r.value : { day: days[i], type: SLOT_DEFS[days[i]]?.type, variants: [], error: r.reason?.message })
}

// One-shot retry: ask Claude to rewrite a single draft using the violations as feedback.
async function redraftOne({ client, originalPrompt, draft, slate, type, day }) {
  try {
    const reasons = (draft.voice_deductions || []).map(d => `- ${d.reason} (${d.points} pts)`).join('\n')
    const feedback = `Your previous draft for ${day} (${type}) scored ${draft.voice_score}/100 on the voice contract. Specific deductions:\n${reasons}\n\nRewrite ONLY this single post. Fix every flagged issue. Return JSON: {"day":"${day}","type":"${type}","headline":"...","body":"..."}`
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: originalPrompt },
        { role: 'assistant', content: JSON.stringify({ drafts: [{ day, type, headline: draft.headline, body: draft.body }] }) },
        { role: 'user', content: feedback },
      ],
    })
    const raw = (msg.content?.[0]?.text || '').trim()
    if (!raw) return null
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    const d = Array.isArray(parsed.drafts) ? parsed.drafts[0] : parsed
    if (!d?.body) return null
    return {
      day, type,
      headline: sanitizeAiOutput(String(d.headline || draft.headline)).slice(0, 120),
      body: sanitizeAiOutput(String(d.body || '')).slice(0, 2200),
    }
  } catch (e) {
    console.warn('[linkedInDrafter redraft]', e.message)
    return null
  }
}
