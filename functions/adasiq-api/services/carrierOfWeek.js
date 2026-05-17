// "Carrier of the Week" — Wednesday-only deep-dive on one insurance carrier.
//
// Builds the carrier-intelligence reputation that makes Mark's /audit tool
// the obvious move. Picks ONE carrier in rotation, summarizes their recent
// denial patterns + the rebuttal angle that's flipping claims that week.
//
// Renders as a bonus block under the markets/audio/greeting, ABOVE the
// regular 5-story list. Only fires on Wednesdays Pacific.
//
// Fails-soft to null if Claude is down. Voice-spec compliant via sanitizer.

import Anthropic from '@anthropic-ai/sdk'
import { sanitizeAiOutput } from './textSanitize.js'

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

// Rotate through the carriers Mark deals with most. Cycle by ISO week number
// so the same carrier doesn't repeat consecutively.
const CARRIERS = [
  { name: 'State Farm',         hint: 'Largest US auto insurer. Often the strictest on calibration line items.' },
  { name: 'Allstate',           hint: 'Major DRP network with formal pricing schedules.' },
  { name: 'Progressive',        hint: 'Growing market share, aggressive on labor rate scrutiny.' },
  { name: 'Liberty Mutual',     hint: 'Heavy in commercial, formal OEM-cite expectations.' },
  { name: 'Farmers',            hint: 'West Coast presence, growing collision footprint.' },
  { name: 'GEICO',              hint: 'Direct-to-consumer giant, fast turnaround pressure.' },
  { name: 'USAA',               hint: 'Military families. High customer-satisfaction expectations.' },
  { name: 'Nationwide',         hint: 'Mid-market national carrier.' },
]

function carrierForToday() {
  const d = new Date()
  // ISO week number (1-53)
  const start = new Date(d.getFullYear(), 0, 1)
  const dayOfYear = Math.floor((d - start) / 86400000)
  const isoWeek = Math.ceil((dayOfYear + start.getDay() + 1) / 7)
  return CARRIERS[isoWeek % CARRIERS.length]
}

const SYSTEM_PROMPT = `You write the "Carrier of the Week" deep-dive for the ADAS Brew newsletter, published every Wednesday.

This block sits at the top of Wednesday's email, above the regular 5-story news digest. Goal: build Mark's reputation as the calibration-denial-rebuttal expert by giving readers something they can use on the very next claim with this carrier.

Audience: collision shop owner or service writer with 90 seconds and a pile of denied claims.

Voice (locked brand contract):
- Direct, practical, peer in the bay.
- Confident without arrogance. Mark has done 50k+ calibrations and seen every denial pattern.
- Talk to the reader like Mark would across a shop counter, not like an insurance analyst on TV.
- NEVER use em dashes. NEVER use AI phrases ("delve", "navigate", "unlock", "harness"). NEVER use hype words.
- Faith and family values present in integrity, never preached.

CONTENT REQUIREMENTS (be specific — fake or vague answers are worse than no block at all):
- ONE carrier (the one named in the user prompt).
- The 2-3 denial patterns this carrier is leaning on RIGHT NOW for ADAS calibration claims. Concrete. Name the line items they're cutting (pre-scan, post-scan, calibration, R&R, sublet, etc.).
- The single STRONGEST rebuttal angle that's flipping their denials this week. Reference an OEM cite, I-CAR position statement, or specific procedure language where you can.
- ONE play the reader can run THIS WEEK on their next claim against this carrier.

OUTPUT: raw JSON only, no markdown:
{
  "carrier": "string — the carrier name, verbatim",
  "headline": "string — under 70 chars, in Mark's voice. Examples: 'State Farm is cutting pre-scans first', 'Allstate's new ADAS denial pattern (and the cite that flips it)'",
  "patterns": ["string", "string", "string"] — 2-3 short bullets, each under 100 chars, naming what they're denying",
  "rebuttal": "string — 1-2 sentences. The strongest OEM-cited rebuttal angle.",
  "play_this_week": "string — 1 sentence. The action Mark would take on the next claim. Starts with a verb."
}

The whole block reads aloud in 30-40 seconds. Tight. No filler.`

/**
 * Generate the Wednesday Carrier of the Week block.
 * Returns null on non-Wednesdays, on failure, or if Anthropic key missing.
 *
 * @param {Object} digest — today's digest (for context, not strictly required)
 * @returns {Promise<{carrier, headline, patterns, rebuttal, play_this_week} | null>}
 */
export async function generateCarrierOfWeek(digest, opts = {}) {
  // Wednesday-only gate (overridable via opts.always for /preview testing)
  if (!opts.always) {
    const dayPT = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
    if (dayPT !== 'Wed') return null
  }
  if (!process.env.ANTHROPIC_API_KEY) return null

  const carrier = opts.carrier || carrierForToday()
  const newsContext = Array.isArray(digest?.stories) && digest.stories.length
    ? digest.stories.map(s => `- [${s.tag}] ${s.headline}`).join('\n')
    : '(no story context available today)'

  try {
    const client = getClient()
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `This week's carrier: ${carrier.name}\n\nCarrier context: ${carrier.hint}\n\nThis week's industry news headlines for context (use only if relevant):\n${newsContext}\n\nWrite today's Carrier of the Week block on ${carrier.name}.`,
      }],
    })
    const raw = (msg.content?.[0]?.text || '').trim()
    if (!raw) return null
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    return {
      carrier:           sanitizeAiOutput(String(parsed.carrier || carrier.name)).slice(0, 60),
      headline:          sanitizeAiOutput(String(parsed.headline || '')).slice(0, 120),
      patterns:          (Array.isArray(parsed.patterns) ? parsed.patterns : [])
                            .slice(0, 3)
                            .map(p => sanitizeAiOutput(String(p)).slice(0, 200))
                            .filter(Boolean),
      rebuttal:          sanitizeAiOutput(String(parsed.rebuttal || '')).slice(0, 400),
      play_this_week:    sanitizeAiOutput(String(parsed.play_this_week || '')).slice(0, 250),
    }
  } catch (e) {
    console.warn('[carrierOfWeek]', e.message)
    return null
  }
}
