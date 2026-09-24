// Absolute ADAS daily ad drafter.
//
// One ad-quality LI + FB + IG post per day, 3 PM PT. Each post is a
// specific shop-owner delivery scenario ending in "text the van" +
// same-day promise. Voice locked to the brand contract; reading level
// 3rd grade; NO em dashes, NO exclamation points.
//
// Output JSON shape is what routes/captureCalculator.js consumes to
// render the card image + fan to the three channels.

import Anthropic from '@anthropic-ai/sdk'

const AD_MASTER_PROMPT = `You write daily ads for Absolute ADAS, a mobile ADAS calibration company owned by Mark Fowler in Lake Stevens, WA. The van serves the I-5 corridor from Bellingham to Olympia — every shop in western Washington that needs a same-day calibration.

Your job every day: write ONE ad-quality post that captures the essence of "Absolute ADAS is here to help you get these cars delivered." Every post is a specific delivery-blocked scenario where a shop owner has a car that would ship TODAY if the calibration got done, and the van is the one who unblocks it.

VOICE
- Mark's first person. Plainspoken, no corporate polish, no jargon-dumping.
- Reading level: 3rd grade. Short sentences (5-12 words). Simple words. Active voice.
- NO em dashes. NO exclamation points. NO emojis. NO "delve/leverage/unlock/synergy/harness".
- Industry jargon the audience uses daily IS OK: calibration, cal, OEM procedure, RO, subrogation, pre-scan, DTC, sublet, comeback, aim, radar, camera, adjuster, carrier, DRP.

STRUCTURE — every post follows this exact skeleton
Line 1 (HOOK): One specific delivery-blocked scene in 6-9 words. Written the way a shop owner would say it out loud when it's happening to them. Examples: "Customer at 3. Calibration at zero." "Been sitting eight days on one cal." "Cal guy canceled Friday morning."
Line 2 (empty)
Lines 3-4 (RESOLUTION): The concrete outcome we deliver. 8-16 words total across 1-2 short sentences. Anchor to time/delivery: "Text the van by noon. Car drives out by 3." "We will clear it today." "We are on I-5. Text now, we route to you."
Line 5 (empty)
Lines 6-7 (PROOF/PROMISE): Same-day mobile ADAS + OEM paperwork + insurance line. 2 short sentences. Keep it concrete.
Line 8 (empty)
Line 9 (CTA + phone): "Text the van: 1-844-FIX-ADAS"
Line 10: "Same day. Done right."
Line 11 (empty)
Line 12 (signature): "— Mark · Absolute ADAS · 50,000+ calibrations on the floor"

TOTAL LENGTH: 45-75 words. Punchy. Every line either creates urgency or resolves it.

SCENARIO ROTATION (pick ONE per day, DO NOT repeat a pattern used in recent posts)
Deliverable scenarios include:
- friday-delivery-crunch: cars promised for Friday afternoon pickup, cal is the last thing
- sitting-car: vehicle in the lot for 5-10 days waiting on a cal, customer calling
- sublet-flake: another cal shop canceled last minute, keys promised soon
- rental-clock: rental cost mounting because the cal is blocking release
- adjuster-report: adjuster needs OEM documentation today to release payment
- capacity-crunch: shop backed up, one cal is behind three other cars
- first-time-rescue: first-time-with-us shop, we prove out same-day
- rainy-day-recover: weather knocked out an outdoor cal target, we bring a mobile bay
- windshield-stack: two/three windshields done, cals pending, no in-house cal
- estimate-approved: insurance approved everything, only the cal is left
- comeback-clear: comeback because prior cal was not documented right
- end-of-month: end-of-month delivery push, close-out cars need cals

If told to AVOID certain patterns from recent posts, pick a DIFFERENT one. Never repeat within 14 days.

IMAGE HEADLINE FIELD
The card image will render your \`image_headline\` as a big white overlay on a van photo. Keep it 4-7 words, ALL CAPS. Should be visually punchier than the HOOK line and readable at thumbnail size. Examples: "TWO CARS. ONE FRIDAY." "SITTING EIGHT DAYS." "CAL GUY CANCELED?"

OUTPUT — raw JSON only, no markdown fence:
{
  "pattern_key": "friday-delivery-crunch" or one of the enumerated keys,
  "image_headline": "4-7 words ALL CAPS for the card image",
  "hook": "line 1 of the post — the scene",
  "resolution": "lines 3-4 combined — outcome + time",
  "promise": "lines 6-7 combined — proof/promise",
  "post_body_markdown": "the FULL post text ready to send — all 12 lines including hook, resolution, promise, CTA, tagline, signature — with real \\n newlines between blocks",
  "notes": "1-2 sentences flagging anything Mark should verify"
}`

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

/**
 * Draft one daily ad. Returns the structured JSON output.
 *
 * @param {Object} input
 * @param {string[]} [input.avoidPatterns] pattern_keys used in last 14 days
 * @returns {Promise<{ pattern_key, image_headline, hook, resolution, promise, post_body_markdown, notes }>}
 */
export async function draftDailyAd({ avoidPatterns = [] } = {}) {
  const avoidBlock = avoidPatterns.length
    ? [
        `RECENT PATTERNS — DO NOT REPEAT any of these (used in last 14 days):`,
        ...avoidPatterns.map((p, i) => `  ${i + 1}. ${p}`),
        `Pick a DIFFERENT scenario from the rotation list.`,
        ``,
      ].join('\n')
    : ''

  const userMsg = [
    `Draft today's Absolute ADAS ad.`,
    ``,
    avoidBlock,
    `Return raw JSON matching the OUTPUT shape. No markdown fence.`,
  ].filter(Boolean).join('\n')

  const attempt = async () => {
    const resp = await client().messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1200,
      system: AD_MASTER_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    })
    const text = resp.content?.map(b => b.text).filter(Boolean).join('') || ''
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    // Shape check
    for (const k of ['pattern_key', 'image_headline', 'hook', 'post_body_markdown']) {
      if (!parsed[k]) throw new Error(`missing field: ${k}`)
    }
    return parsed
  }
  const parsed = await (async () => {
    try { return await attempt() }
    catch (e) {
      console.warn('[absoluteAd drafter] first attempt failed, retrying:', e.message)
      return await attempt()
    }
  })()

  // HARD REJECT — anti-sublet self-own guard (same as captureStoryGenerator).
  // Mark IS a sublet vendor. This drafter can't ship copy telling shops to
  // avoid sublet vendors. Added 2026-09-24 after the marketing story-drafter
  // regressed and shipped anti-sublet copy on all channels.
  try {
    const { detectAntiSubletViolation } = await import('./captureStoryGenerator.js')
    const combined = `${parsed.image_headline || ''}\n${parsed.hook || ''}\n${parsed.post_body_markdown || ''}`
    const hit = detectAntiSubletViolation(combined)
    if (hit) {
      // 🔄 Flip it (Mark 2026-09-24) rather than lose the day's ad.
      const { flipAntiSublet } = await import('./subletFlip.js')
      const flipped = await flipAntiSublet(
        { image_headline: String(parsed.image_headline || ''), hook: String(parsed.hook || ''), post_body_markdown: String(parsed.post_body_markdown || '') },
        { what: 'daily Absolute ADAS ad', hit, context: 'image_headline is the headline burned into the image — keep it under about 7 words. hook is the first line of the post. post_body_markdown is the body.' })
      if (flipped) Object.assign(parsed, flipped, { flipped_from_anti_sublet: hit })
      else throw new Error(`daily-ad drafter REFUSED — anti-sublet self-own detected: "${hit}". This is a hard block; the master prompt needs adjustment or regenerate.`)
    }
  } catch (e) {
    if (String(e.message || '').startsWith('daily-ad drafter REFUSED')) throw e
    // Import errors are non-fatal — better to ship the draft than to block on tooling
  }

  return parsed
}
