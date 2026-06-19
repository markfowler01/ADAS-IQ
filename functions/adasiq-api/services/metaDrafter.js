// Meta (Facebook + Instagram) draft generator.
//
// Per master prompt v3.1 section 16 — posting cadence:
//   FB company: Mon/Wed/Fri 12:00pm PT  (3/week)
//   IG company: Mon/Tue/Thu 11:30am PT  (3/week)
//
// Mirrors the LinkedIn drafter pattern:
//   - Same weekly story input as the LinkedIn batch
//   - Same voice contract (em dashes banned, AI tells banned, etc.)
//   - Voice-scored and re-drafted below threshold
//   - Returns separate FB + IG drafts (different formatting per channel)
//
// Channel formatting differences:
//   - Facebook: longer-form, story-first, similar to LinkedIn (180-260 words)
//   - Instagram: shorter, visual-first, single CTA, hashtags allowed (80-150 words)
//
// Image: both channels share the same generated image asset (one image per slot
// reduces gen cost). Instagram REQUIRES an image (Graph API constraint); FB
// works text-only too but image-first performs better.

import Anthropic from '@anthropic-ai/sdk'
import { sanitizeAiOutput } from './textSanitize.js'
import { scoreDraft } from './voiceScorer.js'
import { MAGIC_LANTERN_LIBRARY, MAGIC_LANTERN_ROUTING_BLOCK } from './magicLanternLibrary.js'

const MIN_VOICE_SCORE = 70
const MAX_RETRIES = 2

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

// Daily posting per channel — 1 post per day per channel, rotating categories.
// Schedules spread across the day so the same follower doesn't see all 3 channels back-to-back.
// FB at 12pm PT, IG at 11:30am PT, TT at 2pm PT.
// Categories rotate on a 3-cycle, repeated across 7 days.
export const FB_SLOTS = [
  { day: 'Mon', hour: 12, minute: 0, type: 'story' },
  { day: 'Tue', hour: 12, minute: 0, type: 'framework' },
  { day: 'Wed', hour: 12, minute: 0, type: 'case_study' },
  { day: 'Thu', hour: 12, minute: 0, type: 'story' },
  { day: 'Fri', hour: 12, minute: 0, type: 'framework' },
  { day: 'Sat', hour: 12, minute: 0, type: 'case_study' },
  { day: 'Sun', hour: 12, minute: 0, type: 'story' },
]
export const IG_SLOTS = [
  { day: 'Mon', hour: 11, minute: 30, type: 'visual_hook' },
  { day: 'Tue', hour: 11, minute: 30, type: 'mechanism' },
  { day: 'Wed', hour: 11, minute: 30, type: 'testimonial' },
  { day: 'Thu', hour: 11, minute: 30, type: 'visual_hook' },
  { day: 'Fri', hour: 11, minute: 30, type: 'mechanism' },
  { day: 'Sat', hour: 11, minute: 30, type: 'testimonial' },
  { day: 'Sun', hour: 11, minute: 30, type: 'visual_hook' },
]
export const TT_SLOTS = [
  { day: 'Mon', hour: 14, minute: 0, type: 'visual_hook' },
  { day: 'Tue', hour: 14, minute: 0, type: 'mechanism' },
  { day: 'Wed', hour: 14, minute: 0, type: 'testimonial' },
  { day: 'Thu', hour: 14, minute: 0, type: 'visual_hook' },
  { day: 'Fri', hour: 14, minute: 0, type: 'mechanism' },
  { day: 'Sat', hour: 14, minute: 0, type: 'testimonial' },
  { day: 'Sun', hour: 14, minute: 0, type: 'visual_hook' },
]
// YouTube Shorts — Tue/Thu/Sat at 1pm PT (different days from FB/TT to
// spread reach). Static-image short videos generated via Cloudinary.
export const YT_SLOTS = [
  { day: 'Tue', hour: 13, minute: 0,  type: 'visual_hook' },
  { day: 'Thu', hour: 13, minute: 0,  type: 'mechanism' },
  { day: 'Sat', hour: 13, minute: 0,  type: 'testimonial' },
]

const FB_TYPE_PROMPTS = {
  story:      'A STORY POST from the field. Open with a specific scene. Name the shop owner with a first name (use composite label if not real). One specific moment from a real visit where the owner realized their old mobile cal vendor was charging full list and walking. End with a single universal lesson + ONE CTA.',
  framework:  'A FRAMEWORK / EDUCATIONAL POST. Walk through one of the 4 components of the Partnership Discount Model (We come to you / We discount off list / You bill at list / Volume rewards you more). Show the per-job dollar math at $450 list. End with the calculator CTA.',
  case_study: 'A CASE STUDY POST. Format: shop name (or composite label), city, calibrations/month, monthly partnership margin earned, one direct quote. End with the Partnership Audit CTA.',
}

const IG_TYPE_PROMPTS = {
  visual_hook:  'A VISUAL HOOK CAPTION. Punchy headline-style opener (one short line). 2-3 short body lines. Big specific dollar number anchor. End with CTA per the SHARED CTA RULES block (full URL spelled out, never "/calculator" alone). 3-6 relevant hashtags at the end (#bodyshop #collisionrepair #ADAS #autobody #shopowner). 80-130 words total.',
  mechanism:    'A MECHANISM EXPLAINER CAPTION. One of the 4 Partnership Discount Model components named explicitly. Quick math: $450 list → $382.50 partner → $67.50 margin. End with CTA per the SHARED CTA RULES block. 3-6 hashtags. 100-150 words.',
  testimonial:  'A TESTIMONIAL / CASE STUDY CAPTION. Shop name or composite label, city, dollar margin per month. One real-sounding quote in quotes. End with CTA per the SHARED CTA RULES block. 3-6 hashtags. 90-140 words.',
}

// TikTok captions: shortest of the three channels. First line must hook
// instantly (TikTok truncates ~100 chars on feed). Energy higher than IG.
// Photo posts can be 2200 chars but under 150 words performs best.
const TT_TYPE_PROMPTS = {
  visual_hook:  'A TIKTOK HOOK CAPTION for a photo post. Open with a one-line hook under 90 chars that survives TikTok\'s feed truncation. Quick dollar-number anchor. End with CTA per the SHARED CTA RULES block (full URL spelled out). 4-6 hashtags (#bodyshop #autobody #collisionrepair #ADAS #shopowner #washingtonbusiness). 60-110 words total.',
  mechanism:    'A TIKTOK MECHANISM CAPTION. Open with the question/number hook. Walk through the math fast: $450 list → $382.50 to you → $67.50 stays. Name "The Partnership Discount Model" once. End with CTA per the SHARED CTA RULES block. 4-6 hashtags. 80-130 words.',
  testimonial:  'A TIKTOK SHOP-OWNER STORY CAPTION. One quick scene, one named shop owner (or composite label), one dollar figure. Direct quote in quotes. End with CTA per the SHARED CTA RULES block. 4-6 hashtags. 70-120 words.',
}

// YouTube Shorts: title (headline) is what people see — under 60 chars works
// best. Description is searchable + sometimes shown. The video itself is a
// static image so the title + first description line carry all the weight.
const YT_TYPE_PROMPTS = {
  visual_hook:  'A YOUTUBE SHORT for a still-image video. Headline = the Short title (under 60 chars, hook-first). Body = the description: 1-2 short paragraphs, finish with the URL absoluteadas.com/calculator and 3-5 hashtags (#ADAS #BodyShop #CollisionRepair #AutoBody #Shorts). 80-140 words body.',
  mechanism:    'A YOUTUBE SHORT explaining one component of The Partnership Discount Model. Headline = punchy title under 60 chars (e.g. "$450 → $382.50 → your margin"). Body = walk through the math in 2 short paragraphs, end with absoluteadas.com/calculator + 3-5 hashtags. 100-160 words body.',
  testimonial:  'A YOUTUBE SHORT testimonial/case-study. Headline = title under 60 chars naming a number ("$2,700/mo in margin he never saw"). Body = 2 short paragraphs telling the story, one quote, end with absoluteadas.com/partnership-audit + 3-5 hashtags. Label composites. 90-150 words body.',
}

// Image prompt spec. Two-layer system:
//
//   1. Standard template (below) — used when no seasonal hook applies.
//      Drafter picks VEHICLE + SCENE based on the post's LESSON.
//   2. Magic Lantern library (imported) — 40 pre-written templates for US
//      holidays, Seahawks games, Mariners games, and Washington regional
//      events. The routing block tells the drafter which layer to use based
//      on the post's target date (passed in the user message).
//
// Drafter outputs image_prompt as one string. When a library template matches
// the date, it should be COPIED VERBATIM (the "Avoid:" lines do critical work).
const IMAGE_PROMPT_SPEC = `IMAGE PROMPT GENERATION (ALSO REQUIRED):

After writing the post body, also output an "image_prompt" field for nano banana.

STEP 1 — Check the "TARGET POST DATE" in the user message and apply Magic Lantern routing:

${MAGIC_LANTERN_ROUTING_BLOCK}

STEP 2 — If no seasonal/regional template applies, pick the SCENE template that matches the LESSON of the post and use it LITERALLY. Each scene type is a different template. DO NOT mix them.

═══════════════════════════════════════════════════════════════════════════
CONVERSATION SCENE
Use when the post's lesson is about: DRP rep stories, customer phone calls, sales conversations, partnership audits, partner objections, "the moment someone realized." The image must NOT have a vehicle in frame — the human moment is the subject.

Template (use LITERALLY, do not add a vehicle):
"A real-feel American collision repair shop office on a bright midday, documentary photography style. The room is FULLY ILLUMINATED — overhead fluorescent fixtures all switched on, large windows with vertical blinds flooding the space with bright daylight, sun visible outside, every surface clearly readable, no part of the frame falls into shadow. MEDIUM-CLOSE composition centered on the subject — the camera is roughly 8 feet from the desk, the desk fills the lower third of the frame, the subject fills the middle third, the back wall fills the upper third. NO empty floor space, NO black void at the bottom. Shop owner in his 40s wearing a plain navy or charcoal polo shirt, seated at a slightly cluttered metal desk holding a smartphone to his ear, mid-conversation, focused expression. Stack of paperwork, an open laptop, and a coffee mug on the desk, all clearly visible and well-lit. Out-of-focus shop bay visible through an open doorway behind him, ALSO well-lit through its own bay door. Concrete floor visible but tight to the desk. Mid-2020s setting. Shot on 35mm, natural color grading, BRIGHT BALANCED DAYLIGHT EXPOSURE, no high-contrast lighting. AVOID: dark scenes, evening or night lighting, large empty floor in foreground, large dark shadow areas, single-light dramatic setups, noir aesthetic, low-key lighting, vehicles anywhere in frame, posed corporate stock-photo expression, executive boardroom feel, luxury settings, rendered look."

═══════════════════════════════════════════════════════════════════════════
WORK SCENE
Use when the post's lesson is about: the actual fix in progress, technical calibration moment, hands-on work happening.

Template (fill [VEHICLE] with one option below):
"A real-feel American collision repair shop interior, documentary photography style, natural fluorescent and window lighting, slightly worn but professional environment. [VEHICLE] in a clean working bay, hood up or panels exposed, tech in mid-task at the workbench. Concrete floor, rolling tool cart, pegboard with tools, mid-2020s setting. Shot on 35mm, natural color grading. AVOID: luxury cars, exotic vehicles, overly clean studio lighting, rendered look, stock photo aesthetic."

═══════════════════════════════════════════════════════════════════════════
DOCUMENTATION SCENE
Use when the post's lesson is about: audit-proofing, paperwork, case studies, system stories, "here's the proof."

Template (focus is paperwork; vehicle in soft focus background):
"A real-feel American collision repair shop interior, documentary photography style, natural window light. Close-up of a clipboard, tablet, or printed calibration report resting on a metal workbench in the foreground, papers slightly askew, ballpoint pen on top. [VEHICLE] visible in soft focus in the bay behind. Concrete floor. Mid-2020s setting. Shot on 35mm, natural color grading. AVOID: vehicles dominating the frame, luxury cars, rendered look, stock photo aesthetic."

═══════════════════════════════════════════════════════════════════════════
VEHICLE options (used ONLY for Work + Documentation scenes — NEVER LUXURY):
- Toyota Camry, Honda Accord, Nissan Altima
- Ford Escape, Honda CR-V, Toyota RAV4
- Subaru Outback, Forester
- Ford F-150, Chevy Silverado, Toyota Tacoma
- Honda Odyssey, Toyota Sienna

────────────────────────────────────────────────────
${MAGIC_LANTERN_LIBRARY}
────────────────────────────────────────────────────

OUTPUT JSON: {"headline":"...","body":"...","image_prompt":"<the full prompt as one string>"}`

const SHARED_VOICE = `VOICE & CONSTRAINTS (locked, non-negotiable):
- Direct, punchy, no fluff. Peer at the counter, not the podium.
- Pattern-interrupt opener every time. Never "Are you a body shop owner who..."
- Use shop-owner vocabulary: GP%, capture rate, cycle time, sublet, DRP, severity, touch time, RO, retail vs trade, comeback, supplement.
- Story over pitch when length allows.
- NEVER use em dashes anywhere. Use periods, commas, or parentheses.
- NEVER use AI phrases: "delve", "leverage", "in today's fast-paced", "elevate", "unlock", "synergy", "robust", "harness", "navigate the landscape", "tapestry".
- NO hedging: never "may", "might", "could potentially".
- One CTA per post. Not three.

REQUIRED REFERENCE: every post mentions "The Partnership Discount Model" OR one of the 4 components by name ("We come to you" / "We discount off list automatically" / "You bill at list" / "Volume rewards you more").

CANONICAL PRICING (use only these numbers):
- Static calibration list: $450
- Standard tier (1-14 cals/mo): 15% off = $382.50 partner price = $67.50 margin per cal
- Volume tier (15-29 cals/mo): 20% off = $90 margin per cal
- Preferred Partner tier (30+ cals/mo): 25% off = $112.50 margin per cal + same-day priority + free docs
- 10 cals/mo @ 15% = $675/mo = $8,100/year
- 15 cals/mo @ 20% = $1,350/mo = $16,200/year
- 30 cals/mo @ 25% = $3,375/mo = $40,500/year

VILLAIN FRAMING (selectively, never every post):
- Villain is "list-price sublet vendors that don't discount." Mobile cal companies that use the shop's bay, power, tech's time, charge full list, send invoice, leave.
- Reference language: "Most mobile calibration vendors charge list and walk away." "The standard sublet playbook." "Vendors that don't discount."
- HARD BANS:
  · NEVER attack "sublet vendors" as a category (we ARE one).
  · NEVER tell shops to bring calibration in-house.
  · NEVER frame calibration as a "leak" or "money walking out the door."
  · NEVER mention specific competitor company names.

CASE STUDIES:
- If real shop names + numbers provided, use verbatim.
- If not, label composites: "Composite of three real shops in our Western Washington portfolio."

HEADLINE PATTERN — LOCKED 2026-06-16 (applies to: framework, case_study, mechanism, testimonial)

Every headline for these four post types MUST "stack the math" — pair a specific volume number with a specific dollar outcome. Hormozi-grade specificity. Vague hooks like "The Partnership Discount Model in 60 seconds" or "Stop leaving money on the table" are BANNED for these types — they failed the 9/10 grading bar.

Approved headline templates (pick the one that fits the post body):

1. The volume-stack (best for framework, mechanism):
   "{N} calibrations a month. {ANNUAL} a year."
   examples:
   · "10 calibrations a month. $8,100 a year."
   · "15 calibrations a month. $16,200 a year."
   · "30 calibrations a month. $40,500 a year."

2. The case-study reveal (best for case_study, testimonial):
   "How {Shop name} captured {ANNUAL} a year."
   "{Shop name} captured {ANNUAL} in margin last year."
   "{Shop name} found {ANNUAL} sitting in their workflow."
   examples:
   · "How Avon Body Shop captured $9,720 a year."
   · "Hendrick Collision Bellevue found $16,200 sitting in their workflow."

3. The per-cal margin reveal (alt for mechanism):
   "{PER_CAL_MARGIN} per calibration. {N} a month."
   examples:
   · "$67.50 per calibration. 10 a month."
   · "$112.50 per calibration. 30 a month."

USE ONLY THESE CANONICAL NUMBERS (from v3.1 master prompt):
- Standard tier: 10 cals/mo → $67.50 margin/cal → $8,100/year
- Volume tier:   15 cals/mo → $90 margin/cal    → $16,200/year
- Preferred:     30 cals/mo → $112.50 margin/cal → $40,500/year

DOLLAR FORMATTING (locked 2026-06-16, applies EVERYWHERE — headline AND body):
- ALWAYS use the literal $ symbol followed by digits with thousands commas: "$8,100", "$16,200", "$40,500", "$67.50".
- NEVER spell "dollars" after a number ("8100 dollars" is BANNED).
- NEVER spell "thousand" / "k" ("8K" is BANNED, "8 thousand" is BANNED).
- For dollar figures under 100, two decimal places are fine ("$67.50"); over 100, drop cents ("$8,100" not "$8,100.00").
- This rule has no exceptions. It applies to every post type, every channel, every headline, every body line.

Story and visual_hook posts are EXEMPT from the math-stack PATTERN itself (those can lead with narrative). They are NOT exempt from the dollar-formatting rule — any dollar amount in those posts also uses $X,XXX format. The hard rule is: every framework / case_study / mechanism / testimonial headline contains at least one specific dollar figure AND one specific volume number, both formatted per above.

CTA RULES — LOCKED 2026-06-17 (overrides any conflicting per-channel rule)

Every post MUST close with a CTA that does THREE things:
  1. Action verb up front  (Book / Run / See / Get — never "Link in bio" alone, never "click here")
  2. Concrete offer        (what the reader gets and how long it takes)
  3. Full URL spelled out  (absoluteadas.com/calculator OR absoluteadas.com/partnership-audit — never just "/calculator" or "/partnership-audit")

URL ROUTING by post type:
  · visual_hook, framework, mechanism (top of funnel) → absoluteadas.com/calculator
  · case_study, testimonial             (warmer audience) → absoluteadas.com/partnership-audit
  · story                               (depends on the lesson; pick the one that fits)

APPROVED CTA WORDINGS (use one verbatim per post — do not invent variations):

For absoluteadas.com/calculator:
  · "Run your numbers in 60 seconds at absoluteadas.com/calculator"
  · "See what your shop's leaving on the table. absoluteadas.com/calculator"

For absoluteadas.com/partnership-audit:
  · "Book your free 15-min Partnership Audit at absoluteadas.com/partnership-audit"
  · "Get on Mark's calendar — free, 15 minutes. absoluteadas.com/partnership-audit"

CHANNEL FORMATTING — the URL is ALWAYS the full absoluteadas.com/... form (clickable on FB/LinkedIn, plain-text but clear on IG/TikTok). For IG and TikTok, follow the CTA line with "(Link in bio.)" so phone-readers know where to tap. NEVER use bare "/calculator" or "/partnership-audit" — always include the absoluteadas.com prefix.

BANNED CTAs:
  · "Link in bio" without an action verb in front
  · "Click here" / "Click the link"
  · Any URL missing the absoluteadas.com prefix
  · Multiple URLs in one post (one CTA per post — locked elsewhere)`

const FB_SYSTEM_PROMPT = `You are the drafting engine for the Absolute ADAS Facebook business page. Audience: body shop owners, glass shops, collision MSOs in Western Washington.

${SHARED_VOICE}

FACEBOOK-SPECIFIC FORMAT:
- 180-260 words per post.
- Lead with a hook line that stands on its own (Facebook truncates after ~3 lines on mobile).
- Paragraph breaks every 2-3 sentences (Facebook wall of text dies).
- One CTA at the bottom. URL on its own line: "absoluteadas.com/calculator" or "absoluteadas.com/partnership-audit".
- No hashtags inside the body (Facebook hashtags don't move reach the way IG ones do).

${IMAGE_PROMPT_SPEC}`

const IG_SYSTEM_PROMPT = `You are the drafting engine for the Absolute ADAS Instagram business account. Audience: body shop owners, glass shops, collision MSOs scrolling on phone.

${SHARED_VOICE}

INSTAGRAM-SPECIFIC FORMAT:
- 80-150 words per caption.
- First line must be a hook that survives the "..." truncation (Instagram truncates around 125 chars on the feed).
- Short punchy lines, line breaks for scanability.
- Emoji are OK if they earn their spot (one or two max, never decorative).
- CTA always references "Link in bio" because IG can't do clickable links in captions: "Link in bio: /calculator" or "Link in bio: /partnership-audit".
- End with 3-6 relevant hashtags on a single line: #bodyshop #collisionrepair #ADAS #autobody #shopowner #washingtonbusiness

${IMAGE_PROMPT_SPEC}`

const TT_SYSTEM_PROMPT = `You are the drafting engine for the Absolute ADAS TikTok business account. Audience: body shop owners and collision techs scrolling TikTok in the afternoon.

${SHARED_VOICE}

TIKTOK-SPECIFIC FORMAT:
- 60-130 words per caption. Shorter than IG.
- First line is everything — TikTok truncates around 90-100 chars on the feed. Hook must land before the "more" cut.
- Energy higher than IG, less polished, more spoken-rhythm. Still shop-owner peer voice, not influencer-speak.
- One CTA at the end: "Link in bio → /calculator" or "Link in bio → /partnership-audit".
- End with 4-6 relevant hashtags on a single line: #bodyshop #autobody #collisionrepair #ADAS #shopowner #washingtonbusiness
- Do NOT mention "music" or "sound" — TikTok auto-adds music to photo posts.

${IMAGE_PROMPT_SPEC}`

const YT_SYSTEM_PROMPT = `You are the drafting engine for Absolute ADAS YouTube Shorts. Audience: body shop owners searching YouTube for ADAS guidance, plus existing followers.

${SHARED_VOICE}

YOUTUBE-SHORTS-SPECIFIC FORMAT:
- The video itself is a still image (8 sec, vertical 9:16) so all the weight is on the TITLE and the first 100 chars of the DESCRIPTION.
- "headline" field = the Short's title. Keep it under 60 chars. Punchy + searchable. Front-load the number or hook.
- "body" field = the description. 80-160 words. First sentence is what shows under the title — make it carry. Include a URL on its own line near the end (absoluteadas.com/calculator or /partnership-audit). Finish with 3-5 hashtags including #Shorts.
- No emoji in the title (hurts search). Sparing emoji in description OK.
- No reference to "watch this video" — there's nothing to watch; it's a static image.

${IMAGE_PROMPT_SPEC}`

/**
 * Generate one channel's draft for a single slot.
 *
 * @param {Object} input
 * @param {'facebook'|'instagram'} input.channel
 * @param {string} input.day         — Mon/Tue/Wed/Thu/Fri/Sat/Sun
 * @param {string} input.type        — slot type (story/framework/case_study OR visual_hook/mechanism/testimonial)
 * @param {string} input.story       — Mark's weekly raw story
 * @param {string} [input.caseStudy]
 * @returns {Promise<{headline, body, voice_score, voice_deductions}>}
 */
export async function draftMetaSlot({ channel, day, type, story, caseStudy = '', targetDate = null } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')
  if (!story || story.trim().length < 40) throw new Error('story is required')
  if (!['facebook', 'instagram', 'tiktok', 'youtube'].includes(channel)) throw new Error(`unknown channel: ${channel}`)

  const system = channel === 'facebook'  ? FB_SYSTEM_PROMPT
    :          channel === 'instagram' ? IG_SYSTEM_PROMPT
    :          channel === 'tiktok'    ? TT_SYSTEM_PROMPT
    :          /* youtube */             YT_SYSTEM_PROMPT
  const typePrompt = channel === 'facebook'  ? FB_TYPE_PROMPTS[type]
    :              channel === 'instagram' ? IG_TYPE_PROMPTS[type]
    :              channel === 'tiktok'    ? TT_TYPE_PROMPTS[type]
    :              /* youtube */             YT_TYPE_PROMPTS[type]
  if (!typePrompt) throw new Error(`unknown ${channel} type: ${type}`)
  const isFB = channel === 'facebook'

  // Format the target date for Magic Lantern routing. If targetDate isn't
  // provided, we still tell the model to fall back to the standard template.
  const dateLine = targetDate
    ? `TARGET POST DATE: ${new Date(targetDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' })} (${new Date(targetDate).toISOString().slice(0, 10)})`
    : `TARGET POST DATE: not provided — use the STANDARD TEMPLATE for image_prompt.`

  const userMsg = [
    dateLine,
    '',
    `Today's slot: ${day} ${channel.toUpperCase()} (${type}).`,
    typePrompt,
    '',
    `MARK'S WEEKLY STORY (raw material if relevant):`,
    `"""`, story.trim().slice(0, 1500), `"""`,
    '',
    caseStudy ? [`CASE STUDY MATERIAL:`, `"""`, caseStudy.trim().slice(0, 1500), `"""`].join('\n') : 'NO REAL CASE STUDY PROVIDED, use a labeled composite if needed.',
    '',
    `Write ONE ${channel} post for this slot. Complete, publish-ready text.`,
    '',
    `Return JSON only: {"headline":"...","body":"..."}`,
  ].filter(Boolean).join('\n')

  const client = getClient()
  const maxBody = isFB ? 2400 : 1400
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system,
    messages: [{ role: 'user', content: userMsg }],
  })
  const raw = (msg.content?.[0]?.text || '').trim()
  if (!raw) throw new Error('Empty response from Claude')
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

  let parsed
  try { parsed = JSON.parse(cleaned) }
  catch (e) { throw new Error(`Could not parse meta draft: ${e.message}. Raw: ${cleaned.slice(0, 200)}`) }

  let headline = sanitizeAiOutput(String(parsed.headline || '')).slice(0, 120)
  let body = sanitizeAiOutput(String(parsed.body || '')).slice(0, maxBody)
  // image_prompt is a raw template-filled string for nano banana — do NOT
  // sanitize it (sanitization would mangle legitimate punctuation in the
  // prompt). Cap at 1200 chars so a runaway prompt doesn't bloat the queue row.
  let imagePrompt = String(parsed.image_prompt || '').trim().slice(0, 1200)
  let { score, deductions } = scoreDraft(body, { channel })

  // Retry below threshold
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (score >= MIN_VOICE_SCORE) break
    const reasons = (deductions || []).map(d => `- ${d.reason} (${d.points} pts)`).join('\n')
    const feedback = `Your previous draft scored ${score}/100 on the voice contract. Deductions:\n${reasons}\n\nRewrite this single post. Fix every flagged issue. Return JSON: {"headline":"...","body":"..."}`
    try {
      const retry = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system,
        messages: [
          { role: 'user', content: userMsg },
          { role: 'assistant', content: JSON.stringify({ headline, body }) },
          { role: 'user', content: feedback },
        ],
      })
      const r = (retry.content?.[0]?.text || '').trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
      const p = JSON.parse(r)
      const newHeadline = sanitizeAiOutput(String(p.headline || headline)).slice(0, 120)
      const newBody = sanitizeAiOutput(String(p.body || '')).slice(0, maxBody)
      const newImagePrompt = String(p.image_prompt || '').trim().slice(0, 1200)
      if (!newBody) break
      const s = scoreDraft(newBody, { channel })
      if (s.score > score) {
        headline = newHeadline
        body = newBody
        score = s.score
        deductions = s.deductions
        if (newImagePrompt) imagePrompt = newImagePrompt
      }
    } catch (e) {
      console.warn('[metaDrafter retry]', e.message)
      break
    }
  }

  return { headline, body, image_prompt: imagePrompt, voice_score: score, voice_deductions: deductions }
}

/**
 * Generate the full week's worth of social drafts: 3 FB + 3 IG + 3 TikTok + 3 YT = 12 drafts.
 * Used by the Sunday-night cron to seed the week's approval queue.
 *
 * YouTube is GATED behind YOUTUBE_REFRESH_TOKEN — if that env var isn't set,
 * we skip YT drafting entirely (no Claude calls, no image gen, no Cloudinary).
 * To enable YouTube later: finish the Google Cloud OAuth setup + set the three
 * YOUTUBE_* env vars, and the next Sunday batch will start producing YT drafts
 * automatically. All scaffolding (slots, drafter, scheduler) stays in place.
 *
 * @param {{story, caseStudy?}} input
 * @returns {Promise<{fb: Array, ig: Array, tt: Array, yt: Array}>}
 */
/**
 * Daily variant of draftMetaWeek — drafts ONLY today's slot from each channel.
 * Used by the daily cron so something fresh goes out every day rather than
 * batching a week's worth on Sunday (which is fragile if the Sunday run fails).
 *
 * @param {{story, caseStudy?, dayName?}} input  dayName like 'Mon' overrides today (for testing)
 * @returns {Promise<{fb: Array, ig: Array, tt: Array, yt: Array, day: string}>}
 */
export async function draftMetaDay({ story, caseStudy = '', dayName } = {}) {
  const ytEnabled = !!process.env.YOUTUBE_REFRESH_TOKEN
  const today = dayName || new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
  const todayDateIso = new Date().toISOString()

  const fbSlots = FB_SLOTS.filter(s => s.day === today)
  const igSlots = IG_SLOTS.filter(s => s.day === today)
  const ttSlots = TT_SLOTS.filter(s => s.day === today)
  const ytSlots = ytEnabled ? YT_SLOTS.filter(s => s.day === today) : []

  const mk = (channel, slot) => draftMetaSlot({ channel, day: slot.day, type: slot.type, story, caseStudy, targetDate: todayDateIso })
  const [fbResults, igResults, ttResults, ytResults] = await Promise.all([
    Promise.allSettled(fbSlots.map(s => mk('facebook',  s))),
    Promise.allSettled(igSlots.map(s => mk('instagram', s))),
    Promise.allSettled(ttSlots.map(s => mk('tiktok',    s))),
    Promise.allSettled(ytSlots.map(s => mk('youtube',   s))),
  ])

  return {
    day: today,
    fb: fbResults.map((r, i) => r.status === 'fulfilled' ? { ...fbSlots[i], ...r.value } : { ...fbSlots[i], error: r.reason?.message }),
    ig: igResults.map((r, i) => r.status === 'fulfilled' ? { ...igSlots[i], ...r.value } : { ...igSlots[i], error: r.reason?.message }),
    tt: ttResults.map((r, i) => r.status === 'fulfilled' ? { ...ttSlots[i], ...r.value } : { ...ttSlots[i], error: r.reason?.message }),
    yt: ytEnabled
      ? ytResults.map((r, i) => r.status === 'fulfilled' ? { ...ytSlots[i], ...r.value } : { ...ytSlots[i], error: r.reason?.message })
      : [],
  }
}

export async function draftMetaWeek({ story, caseStudy = '' } = {}) {
  const ytEnabled = !!process.env.YOUTUBE_REFRESH_TOKEN
  // Compute the next future occurrence of each slot's day-of-week so the
  // drafter can route image prompts through Magic Lantern (holidays / sports /
  // regional events keyed by the actual post date).
  const nextDateForDay = (dayName) => {
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    const target = dayMap[dayName]
    if (target === undefined) return null
    const now = new Date()
    const todayUtc = now.getUTCDay()
    let daysAhead = (target - todayUtc + 7) % 7
    if (daysAhead === 0) daysAhead = 7
    const r = new Date(now)
    r.setUTCDate(now.getUTCDate() + daysAhead)
    return r.toISOString()
  }
  const fbPromises = FB_SLOTS.map(slot => draftMetaSlot({ channel: 'facebook',  day: slot.day, type: slot.type, story, caseStudy, targetDate: nextDateForDay(slot.day) }))
  const igPromises = IG_SLOTS.map(slot => draftMetaSlot({ channel: 'instagram', day: slot.day, type: slot.type, story, caseStudy, targetDate: nextDateForDay(slot.day) }))
  const ttPromises = TT_SLOTS.map(slot => draftMetaSlot({ channel: 'tiktok',    day: slot.day, type: slot.type, story, caseStudy, targetDate: nextDateForDay(slot.day) }))
  const ytPromises = ytEnabled
    ? YT_SLOTS.map(slot => draftMetaSlot({ channel: 'youtube', day: slot.day, type: slot.type, story, caseStudy, targetDate: nextDateForDay(slot.day) }))
    : []
  const [fbResults, igResults, ttResults, ytResults] = await Promise.all([
    Promise.allSettled(fbPromises),
    Promise.allSettled(igPromises),
    Promise.allSettled(ttPromises),
    Promise.allSettled(ytPromises),
  ])
  return {
    fb: fbResults.map((r, i) => r.status === 'fulfilled' ? { ...FB_SLOTS[i], ...r.value } : { ...FB_SLOTS[i], error: r.reason?.message }),
    ig: igResults.map((r, i) => r.status === 'fulfilled' ? { ...IG_SLOTS[i], ...r.value } : { ...IG_SLOTS[i], error: r.reason?.message }),
    tt: ttResults.map((r, i) => r.status === 'fulfilled' ? { ...TT_SLOTS[i], ...r.value } : { ...TT_SLOTS[i], error: r.reason?.message }),
    yt: ytEnabled
      ? ytResults.map((r, i) => r.status === 'fulfilled' ? { ...YT_SLOTS[i], ...r.value } : { ...YT_SLOTS[i], error: r.reason?.message })
      : [],
  }
}
