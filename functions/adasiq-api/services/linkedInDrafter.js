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

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

const POST_TYPES = [
  { day: 'Mon', type: 'story',     prompt: 'A SHORT STORY POST from the field. Open with a specific scene (place, time, sensory detail). Name the shop owner with a first name only (use a generic first name like "Mike" if the story is composite). Tell one specific moment from the visit. End with a single universal lesson and ONE CTA.' },
  { day: 'Tue', type: 'framework', prompt: 'A FRAMEWORK / EDUCATIONAL POST. Lead with a counterintuitive observation about how body shops think about ADAS revenue. Walk through one of the 4 A\'s (Audit, Activate, Allocate, or Amplify) and explain HOW it works inside a shop\'s real workflow. End with the calculator CTA.' },
  { day: 'Wed', type: 'story',     prompt: 'A SECOND STORY POST. Different angle than Monday. This one is about a denial that got reversed, or a sublet vendor surprise, or a calibration that almost shipped wrong. Specific. Named characters. End with a lesson + CTA.' },
  { day: 'Thu', type: 'framework', prompt: 'A FRAMEWORK / OPINION POST. Take one side of an industry debate that shop owners actually have in real life. (e.g. "should I buy an Autel kit", "do I really need pre-scan and post-scan", "is the sublet model dead"). Strong opinion, well-defended, no hedging. End with calculator CTA.' },
  { day: 'Fri', type: 'case_study', prompt: 'A CASE STUDY POST. Use the case study material I provide (or a labeled composite if none). Format: shop name (or composite label), city, before-state, after-state with specific dollar figure, time to result, one direct quote from the owner. End with the audit CTA.' },
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
- "The Absolute Capture System" OR one of the 4 A's: Audit, Activate, Allocate, Amplify. Reference by name. Repetition builds the brand of the mechanism.

CTAs (rotate, one per post):
- "Calculate your shop's capture number: absoluteadas.com/calculator"
- "Run your number in 60 seconds: absoluteadas.com/calculator"
- "Book a free 15-min Revenue Audit: absoluteadas.com/audit"
- "DM me 'audit' if your sublet calibration line item is bigger than you'd like."

VILLAIN FRAMING (use selectively, never every post):
- Industry consolidators (Caliber, Gerber, Crash Champions, Joe Hudson's, Classic Collision) building in-house ADAS to eat indie DRP work. Don't attack them by name — reference as "the national consolidators".
- The sublet vendor MODEL (not vendors as people) that makes shops dependent.
- The five-year clock: shops without an ADAS story will sell to consolidators for pennies by 2030.

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
  return {
    drafts: drafts.slice(0, 5).map((d, i) => ({
      day: String(d.day || POST_TYPES[i]?.day || ''),
      type: String(d.type || POST_TYPES[i]?.type || ''),
      headline: sanitizeAiOutput(String(d.headline || '')).slice(0, 120),
      body: sanitizeAiOutput(String(d.body || '')).slice(0, 2200),
    })),
  }
}
