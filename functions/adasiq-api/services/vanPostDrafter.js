// Van-in-the-field daily post drafter.
//
// New content pillar alongside the educational unified drafter (metaDrafter.js).
// One post per day, 6:30 AM PT, fanned to FB + IG + LinkedIn.
//
// The pillar's job is BRAND PRESENCE, not education. Photo of Mark's service
// van at a real Western Washington shop (or driving between shops, or parked
// at home on weekends) + one-line caption that speaks to where the shop is
// in its weekly workflow rhythm.
//
// Weekly rhythm (Mark's diagnosis of a collision shop's week):
//   Mon  — teardown day; week-ahead outlook
//   Tue  — bumper-off day (Honda / Acura / Kia / Hyundai cals happen here)
//   Wed  — parts + paint day; "we're not in the way"
//   Thu  — assembly day; the volume day
//   Fri  — delivery day; the hero day, most cals fire here
//   Sat  — rest / family / gratitude
//   Sun  — van prep / getting ready for Monday

import Anthropic from '@anthropic-ai/sdk'
import { sanitizeAiOutput } from './textSanitize.js'
import { scoreDraft } from './voiceScorer.js'

const MIN_VOICE_SCORE = 82
const MAX_RETRIES = 2

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

// ─── Day-of-week templates ─────────────────────────────────────────────────
// Each day carries: the shop's current pain, the van's role, and a scene
// direction for the image prompt (Nano Banana renders it).
const DAY_TEMPLATES = {
  Mon: {
    angle: 'teardown-day',
    guidance: 'Monday morning. The shop\'s intake pile is stacked. Teardown crew is starting on the CR-V, the RDX, the Sorento. Absolute ADAS slots in around the workflow — before paint, during assembly, or Friday morning. The post positions us as the calibration partner who fits INTO the shop\'s week, not the vendor who disrupts it.',
    scene: 'The Absolute ADAS orange service van parked in front of a collision repair shop in Western Washington, morning sun on the van, teardown bay visible behind it, one or two cars with hoods up in the background. Documentary photography style, natural light, bright and clean.',
  },
  Tue: {
    angle: 'bumper-off',
    guidance: 'Tuesday. The Honda / Acura / Kia / Hyundai brands need calibration BEFORE paint — bumper off, radar exposed. Absolute ADAS shows up at exactly the right point in the workflow so the shop doesn\'t pull the bumper twice. Speak to the timing insight most vendors miss.',
    scene: 'Absolute ADAS orange van parked at a collision bay, a mid-size Honda or Acura sedan visible in the background with bumper removed and front radar sensor exposed. Bright indoor bay lighting. Documentary photography style.',
  },
  Wed: {
    angle: 'parts-paint',
    guidance: 'Wednesday. Parts landed on two RO\'s. Paint booth is running on three more. Absolute ADAS is not in the way — we show up when the car is ready. Positions us as respectful of the shop\'s cadence, not another sublet vendor competing for bay time.',
    scene: 'Absolute ADAS orange van driving on a Western Washington road between two shops, mid-day, Cascade mountains barely visible in the distance. Or: van parked outside a shop\'s paint booth door, no visible activity, just presence. Documentary photography, natural light.',
  },
  Thu: {
    angle: 'assembly-volume',
    guidance: 'Thursday. Assembly line is moving. Four cars across two shops need calibration sign-off before Friday delivery. Absolute ADAS is the volume day partner — steady hands, moving fast. Positions us as the reason Friday works.',
    scene: 'Absolute ADAS orange van parked at a busy collision shop with three or four cars visible in bays being assembled, technicians moving in the background. Documentary photography, natural bay light, action feel but composed.',
  },
  Fri: {
    angle: 'delivery-day',
    guidance: 'Friday. Delivery day. Six cars need cal sign-off by 3pm. This is why shops keep us on speed dial. The hero post of the week — most emotional, most "we are the answer." Every shop owner reading this recognizes the pressure of a delivery Friday.',
    scene: 'Absolute ADAS orange van at a collision shop with multiple cars staged in the parking lot ready for pickup, one car being handed to a customer in the background. Late morning light. Documentary photography style.',
  },
  Sat: {
    angle: 'rest-family',
    guidance: 'Saturday. Some things matter more than calibrations. Speaks to the shop owner as a person — kids, weekend, real life. Grateful for another week done. Emotional register is warmer, quieter. No sales angle. Presence and humanity.',
    scene: 'Absolute ADAS orange van parked at a suburban Western Washington home driveway, morning light, hint of family life (kids\' bikes visible, or a lake visible in the distance, or a barbecue setup). Warm and quiet. Documentary photography, natural light.',
  },
  Sun: {
    angle: 'prep-for-monday',
    guidance: 'Sunday. Van getting stocked. Targets cleaned. Software updated. Whatever Monday brings, we\'ll be ready. Positions as diligent, prepared, professional. Sets up the reader for a Monday that starts strong.',
    scene: 'Absolute ADAS orange van parked in a home garage or clean shop bay, back doors open, ADAS calibration targets and equipment neatly organized inside, evening or early morning light. Documentary photography style, quiet and prepared.',
  },
}

// ─── System prompt ─────────────────────────────────────────────────────────
const VAN_SYSTEM_PROMPT = `You are the drafting engine for Mark Fowler's van-in-the-field content pillar at Absolute ADAS, a mobile ADAS calibration company in Western Washington.

This is a DIFFERENT pillar from the educational Partnership Discount Model posts. This pillar is about BRAND PRESENCE. The reader — a body shop owner — should see the post and feel: "Absolute ADAS is out there serving shops like mine, every day of the week, and they get how our week works."

Voice (locked, non-negotiable):
- Peer in the bay. Not selling. Not preaching.
- Short. Under 90 words total body. Under 50 is often better.
- Direct. No emojis. No fluff phrases. No "in today's fast-paced world" AI tells.
- Speak in a way a body shop owner would talk to another body shop owner over coffee.
- Shop-owner vocabulary is fair game when it fits: RO, cycle time, sublet, teardown, assembly, delivery, DRP, comeback, backorder. Don't force it.
- NEVER use em dashes.
- Use real Western Washington city names when a location fits: Kirkland, Everett, Tacoma, Tukwila, Renton, Lynnwood, Bellevue, Marysville, Puyallup, Auburn, Olympia, Mount Vernon.

Format:
- 40-90 words. Tight is always better.
- First line is a scene / time-anchor (e.g. "Monday morning." or "Friday. Delivery day.")
- 2-4 short sentences of body.
- End with the brand tag on its own line: "Absolute ADAS · Western Washington"
- NO hashtags. NO URLs. NO "link in bio". This pillar is presence, not conversion.

Headline (used only for the image overlay, not shown in the caption itself):
- Under 60 characters.
- Compresses the day's angle into a punch line the reader can absorb in 1 second.
- Example: "Monday. Teardown day." or "Friday. Delivery day."

Image prompt:
- Documentary photography style — no polish, no ads, no glossy magazine feel.
- Natural light. Van is the focal point.
- Never render text, logos, or watermarks (the SVG composite adds those in code).

Output JSON only: {"headline": "...", "body": "...", "image_prompt": "..."}`

/**
 * Draft ONE van-in-the-field post for the given day.
 *
 * @param {Object} input
 * @param {string} input.dayName — Mon/Tue/Wed/Thu/Fri/Sat/Sun
 * @param {string} [input.targetDate] — ISO datestring (for logging only)
 * @returns {Promise<{headline, body, image_prompt, voice_score, voice_deductions, angle}>}
 */
export async function draftVanPost({ dayName, targetDate = null } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')
  const template = DAY_TEMPLATES[dayName]
  if (!template) throw new Error(`unknown dayName: ${dayName}`)

  const dateLine = targetDate
    ? `TARGET POST DATE: ${new Date(targetDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' })}`
    : `TARGET POST DATE: not provided`

  const userMsg = [
    dateLine,
    '',
    `Today's angle: ${template.angle} (${dayName}).`,
    '',
    `SHOP-WEEK CONTEXT: ${template.guidance}`,
    '',
    `SCENE for the image prompt (use as raw material, expand and polish): ${template.scene}`,
    '',
    `Write ONE van-in-the-field post for ${dayName}. Follow the format exactly.`,
    '',
    `Return JSON only: {"headline":"...","body":"...","image_prompt":"..."}`,
  ].join('\n')

  const client = getClient()
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system: VAN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  })
  const raw = (msg.content?.[0]?.text || '').trim()
  if (!raw) throw new Error('Empty response from Claude')
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

  let parsed
  try { parsed = JSON.parse(cleaned) }
  catch (e) { throw new Error(`Could not parse van draft: ${e.message}. Raw: ${cleaned.slice(0, 200)}`) }

  let headline = sanitizeAiOutput(String(parsed.headline || '')).slice(0, 80)
  let body = sanitizeAiOutput(String(parsed.body || '')).slice(0, 800)
  let imagePrompt = String(parsed.image_prompt || '').trim().slice(0, 1200)
  let { score, deductions } = scoreDraft(body, { channel: 'facebook' })

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (score >= MIN_VOICE_SCORE) break
    const reasons = (deductions || []).map(d => `- ${d.reason} (${d.points} pts)`).join('\n')
    const feedback = `Your draft scored ${score}/100. Deductions:\n${reasons}\n\nRewrite. Fix every flagged issue. Return JSON: {"headline":"...","body":"...","image_prompt":"..."}`
    try {
      const retry = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: VAN_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: userMsg },
          { role: 'assistant', content: JSON.stringify({ headline, body, image_prompt: imagePrompt }) },
          { role: 'user', content: feedback },
        ],
      })
      const r = (retry.content?.[0]?.text || '').trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
      const p = JSON.parse(r)
      const nh = sanitizeAiOutput(String(p.headline || headline)).slice(0, 80)
      const nb = sanitizeAiOutput(String(p.body || '')).slice(0, 800)
      const nip = String(p.image_prompt || '').trim().slice(0, 1200)
      if (!nb) break
      const s = scoreDraft(nb, { channel: 'facebook' })
      if (s.score > score) {
        headline = nh
        body = nb
        score = s.score
        deductions = s.deductions
        if (nip) imagePrompt = nip
      }
    } catch (e) {
      console.warn('[vanDrafter retry]', e.message)
      break
    }
  }

  return { headline, body, image_prompt: imagePrompt, voice_score: score, voice_deductions: deductions, angle: template.angle }
}

// Helper: today's day-of-week in PT.
export function todayDayName() {
  return new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
}

// Exported for the /debug/van-preview endpoint.
export { DAY_TEMPLATES }
