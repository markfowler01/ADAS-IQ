// Auto-generate the weekly "raw story" when Mark hasn't dropped one.
//
// Sunday-night LinkedIn batch needs a 200-word raw story. Per Mark's
// directive 2026-05-19: fully automate. If no real story is stored at
// capture_weekly_story_current, this generator produces a labeled-composite
// story Claude can then remix into the 15 LinkedIn drafts.
//
// Composite labeling is mandatory per v3.1 doctrine. The generated story
// always opens with "[COMPOSITE]" so downstream drafters propagate that flag.
//
// Variation is engineered into the prompt: rotates across 7 narrative
// archetypes × city options × shop sizes, plus uses recent-history
// avoidance (last 4 generated stories are passed in as anti-examples).

import Anthropic from '@anthropic-ai/sdk'
import { sanitizeAiOutput } from './textSanitize.js'

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

// 7 narrative archetypes covering different stages of the
// shop-owner-discovers-the-Partnership-Discount-Model journey.
const ARCHETYPES = [
  { name: 'audit-moment', desc: 'Shop owner just discovered the leak. We walked through 90 days of their sublet invoices and they realized for the first time how much margin they were leaving on the table. Their reaction.' },
  { name: 'first-invoice', desc: 'Shop owner partnered with us 30-45 days ago. They just got their first month of Absolute ADAS invoices with the 15% discount line. Their service writer or bookkeeper noticed it first. Their reaction the first time they did the multiplication.' },
  { name: 'sixty-day-margin', desc: 'Shop owner 60 days into partnership. Q1 margin report from their bookkeeper just landed. The new ADAS line item shows up clearly. Specific dollar amount. How they decided to deploy it (hire, bonus, paint booth upgrade, etc).' },
  { name: 'comparison-quote', desc: 'Shop owner who got curious and called a competing mobile ADAS vendor to ask about partner discounts. The competing vendor had no concept of one. The conversation that followed.' },
  { name: 'estimator-teaching', desc: 'Shop owner explaining to a new service writer or estimator how the Partnership Discount works — why the 15% line item exists, why it matters, what to do when it shows up. A teaching moment that crystallizes the model.' },
  { name: 'volume-upgrade', desc: 'Shop owner just crossed 15 calibrations a month and got bumped to the Volume tier (20% off list). The moment they noticed their margin per cal jumped from $67.50 to $90.' },
  { name: 'drp-conversation', desc: 'Shop owner had a check-in with their DRP rep (State Farm or other major carrier) and the conversation included how their ADAS workflow has improved. A moment that showed the broader credibility play.' },
]

const CITIES = [
  'Marysville', 'Everett', 'Mukilteo', 'Lake Stevens', 'Snohomish',
  'Bothell', 'Lynnwood', 'Bellevue', 'Kirkland', 'Redmond',
  'Tukwila', 'Renton', 'Auburn', 'Tacoma', 'Puyallup',
  'Olympia', 'Bellingham', 'Mount Vernon', 'Burlington',
]

const SHOP_PROFILES = [
  { size: 'two-bay', years: 'eighteen years in', vol: '6-12 calibrations a month' },
  { size: 'three-bay', years: 'twelve years in', vol: '10-15 calibrations a month' },
  { size: 'four-bay', years: 'twenty-two years in', vol: '15-25 calibrations a month' },
  { size: 'six-bay', years: 'thirty-one years in', vol: '25-40 calibrations a month' },
  { size: 'eight-bay MSO outpost', years: 'six years under current ownership', vol: '40-60 calibrations a month' },
]

const FIRST_NAMES = ['Mike', 'Rob', 'Tony', 'Dave', 'Steve', 'Brian', 'Pete', 'Kyle', 'Jim', 'Greg', 'Maria', 'Jennifer', 'Karen', 'Lisa', 'Sandra']

const SYSTEM_PROMPT = `You write a short raw "weekly story" for Mark Fowler (owner of Absolute ADAS) as if he had just walked back from a shop visit and was talking it through. This story becomes the raw material for the next week's LinkedIn posts.

Mark's voice (locked):
- Direct, peer in the bay, not at the podium
- No fluff, no AI tells, no em dashes
- Shop-owner vocabulary: GP%, capture rate, cycle time, sublet, DRP, severity, touch time, RO, retail vs trade, comeback, supplement
- Story over pitch
- Story should feel like Mark just sat down with coffee and is talking it out

Hard constraints:
- ALWAYS open the story with the literal label "[COMPOSITE]" on its own line, then a blank line, then the story. This propagates the composite flag through every downstream LinkedIn draft.
- NEVER use em dashes anywhere.
- NEVER use AI phrases (delve, leverage, unlock, synergy, elevate, robust, in today's fast-paced, harness, navigate the landscape, tapestry).
- Length: 180-240 words for the story body (not counting the COMPOSITE label).
- Reference the canonical pricing accurately when dollars come up:
  · Static cal list: $450
  · Standard partner (15% off): $67.50 margin per cal
  · Volume tier (15+/mo, 20% off): $90 margin per cal
  · Preferred Partner (30+/mo, 25% off): $112.50 margin per cal + same-day priority + free docs
- Mention "Partnership Discount Model" or one of its 4 components naturally at least once.
- Name the shop owner with a first name only.
- Pick a real Western Washington city.
- Specific moment, specific number, specific reaction.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 ABSOLUTE HARD RULE — READ THIS TWICE 🚨
Mark IS a sublet ADAS calibration vendor. Absolute ADAS is a sublet.

You are FORBIDDEN from generating copy that:
- Tells shops to avoid, drop, replace, stop using, or "think twice about" ADAS sublet vendors
- Uses phrases like "don't sublet", "stop subletting", "you don't need a sublet", "cut out the middleman"
- Frames sublet vendors as a category to escape from
- Suggests shops bring calibration in-house instead of subletting
- Calls ADAS vendors overpriced, greedy, or predatory as a group

The villain is SPECIFICALLY: list-price sublet vendors who charge full retail
and don't share margin with the shop. Mark's Partnership Discount Model
solves this by giving shops 15-25% off list — WITHIN the sublet relationship,
not by killing it. The shop keeps their calibration partner AND their margin.

If your draft contains any anti-sublet framing, YOU HAVE VIOLATED THE HARD
RULE. Rewrite it before returning.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OUTPUT: just the story. Starts with [COMPOSITE] on its own line. No preamble, no markdown, no closing notes.`

/**
 * Generate one weekly composite story.
 * @param {Object} [input]
 * @param {string[]} [input.recentStories] — recent past stories to avoid repeating
 * @returns {Promise<string>}
 */
export async function generateWeeklyStory({ recentStories = [] } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')

  const archetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)]
  const city = CITIES[Math.floor(Math.random() * CITIES.length)]
  const profile = SHOP_PROFILES[Math.floor(Math.random() * SHOP_PROFILES.length)]
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]

  const recentBlock = recentStories.length
    ? `\n\nRECENTLY GENERATED STORIES (do NOT repeat the same archetype, owner-name, or specific scenario):\n---\n${recentStories.slice(0, 4).map((s, i) => `Recent #${i + 1}:\n${s.slice(0, 600)}`).join('\n---\n')}\n---\n`
    : ''

  const userMsg = `Generate this week's raw weekly story using:

ARCHETYPE: ${archetype.name}
${archetype.desc}

SHOP PROFILE: ${firstName}'s shop in ${city}. ${profile.size} operation, ${profile.years}, ${profile.vol}.

Pick a specific moment from a recent imagined shop visit Mark made. Use the canonical Partnership Discount math accurately. Keep it tight (180-240 words).${recentBlock}

Return just the story body, starting with [COMPOSITE] on its own line.`

  const client = getClient()
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  })
  const raw = (msg.content?.[0]?.text || '').trim()
  if (!raw) throw new Error('Empty response from Claude story generator')
  const sanitized = sanitizeAiOutput(raw)

  // HARD REJECT — anti-sublet phrasing must never ship. Mark IS a sublet
  // vendor. This is a self-own that hit us 2026-09-24 and prompted the
  // "delete every post from today" emergency. Better to fail loudly and
  // block the send than let another anti-sublet post go out.
  const violation = detectAntiSubletViolation(sanitized)
  if (violation) {
    // 🔄 Flip it instead of dying (Mark 2026-09-24): the same story retold as
    // what the right sublet partner ADDS. Hard block stays the floor.
    const { flipAntiSublet } = await import('./subletFlip.js')
    const flipped = await flipAntiSublet(sanitized, { what: 'weekly composite story', hit: violation, context: 'Keep the [COMPOSITE] label on its own first line, 180-240 words, first-name-only shop owner, a Western Washington city, one specific number and one specific reaction.' })
    // The label has to sit on its own line with a blank line under it — that
    // is what every downstream LinkedIn draft splits on.
    if (flipped) return `[COMPOSITE]\n\n${String(flipped).replace(/^\s*\[COMPOSITE\]\s*/i, '').trim()}`
    throw new Error(`Anti-sublet self-own detected in story output — refusing to return: "${violation}". Rework the master prompt or regenerate.`)
  }

  return sanitized
}

/**
 * Scan text for phrasing that attacks the sublet model as a category
 * (which Mark IS). Returns the matched phrase if a violation is present,
 * or null if the copy is safe.
 *
 * Deliberately generous — false positives are cheaper than another
 * self-own that goes public.
 */
export function detectAntiSubletViolation(text) {
  // Normalize curly/typographic apostrophes — Claude emits ’ (U+2019) far
  // more often than ', and every "don't" pattern below would miss it.
  const t = String(text || '').toLowerCase().replace(/[‘’ʼ′`]/g, "'")
  const patterns = [
    /don'?t use\s+(?:an?\s+)?(?:adas\s+)?sublet/,
    /stop\s+(?:using|subletting|paying)\s+(?:an?\s+|your\s+)?(?:adas\s+)?sublet/,
    /avoid\s+(?:the\s+|using\s+)?(?:adas\s+)?sublet/,
    /(?:you\s+)?don'?t\s+need\s+(?:an?\s+|the\s+)?(?:adas\s+)?sublet/,
    /(?:drop|dump|fire|ditch)\s+(?:your\s+)?(?:adas\s+)?sublet/,
    /cut\s+out\s+the\s+middleman/,
    /(?:bring|take)\s+(?:calibration|adas|it)\s+in[- ]house(?:\s+instead)?/,
    /sublet\s+(?:vendors|companies|shops)\s+(?:are\s+)?(?:overpriced|greedy|predatory|ripping)/,
    /stop\s+subletting/,
    /don'?t\s+sublet/,
    /think\s+twice\s+(?:about|before)\s+subletting/,
    /sublet(?:ting)?\s+is\s+(?:killing|hurting|costing)\s+(?:you|your\s+shop)/,
  ]
  for (const re of patterns) {
    const m = t.match(re)
    if (m) return m[0]
  }
  return null
}

export { ARCHETYPES, CITIES, SHOP_PROFILES }
