// Claude assembles the daily Absolute ADAS calibration-tip card.
// Two input modes:
//   - manualTip: user-submitted via the web form (headline + bullets + notes)
//   - brewDigest: today's ADAS Brew digest, synthesized into a tip
//
// Always returns { headline, bullets[], caption } — the bullets feed the image,
// the caption is the FB/IG post text.

import Anthropic from '@anthropic-ai/sdk'

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

const TIP_SYSTEM_PROMPT = `You're writing for Absolute ADAS — a mobile ADAS calibration service in Western Washington run by Mark Fowler. Audience: collision shop owners, body shop production managers, and calibration techs. Voice: blue-collar practitioner, direct, no fluff, no corporate hedge-words.

Your job: produce ONE calibration-tip card for today's social post. Output is structured for an image overlay (headline + bullet list) plus a longer caption for the post body.

CARD RULES:
- "headline": 4–9 words. Punchy. Imperative or noun-phrase. Example: "What technicians check before calibration starts" or "Five line items insurance always denies".
- "bullets": exactly 5–6 items. Each 3–7 words. No periods at end. Concrete, specific actions or facts. NEVER generic ("be careful", "stay informed"). NEVER full sentences.
- "caption": 2–4 short paragraphs, 400–800 chars total. Practitioner voice. Sets up the tip, gives one concrete why-it-matters, and a single soft mention of ADAS Brew or adas-iq.com/brew at the end. NEVER hype words ("game-changer", "unlock", "leverage"). NO em dashes.

OUTPUT: raw JSON only, no markdown:
{
  "headline": "string",
  "bullets": ["string", "string", ...],
  "caption": "string"
}`

/**
 * @param {Object} args
 * @param {Object} [args.manualTip] — { headline, bullets, notes } from the web form
 * @param {Object} [args.brewDigest] — today's ADAS Brew digest object
 * @returns {Promise<{headline: string, bullets: string[], caption: string}>}
 */
export async function assembleTipCard({ manualTip, brewDigest } = {}) {
  let userPrompt
  if (manualTip) {
    const bulletLines = Array.isArray(manualTip.bullets)
      ? manualTip.bullets.join('\n')
      : String(manualTip.bullets || '')
    userPrompt = `Build a tip card from this user-submitted idea. Polish the wording but keep the spirit and specificity intact.

HEADLINE IDEA: ${manualTip.headline || '(none — derive from notes)'}

BULLET IDEAS (one per line):
${bulletLines}

EXTRA CONTEXT / NOTES:
${manualTip.notes || '(none)'}

Generate the tip card.`
  } else if (brewDigest) {
    const stories = (brewDigest.stories || []).slice(0, 5).map((s, i) =>
      `${i + 1}. ${s.headline}\n   ${s.body || ''}\n   tag: ${s.tag || ''}`
    ).join('\n\n')
    userPrompt = `Synthesize a calibration-tip card from today's ADAS Brew industry digest. Pick the most actionable angle — what should shops DO about this week's news? Frame it as a practical tip, not a news recap. The tip should make sense even to someone who didn't read the brew.

TODAY'S BREW SUBJECT: ${brewDigest.subject || ''}

TODAY'S 5 STORIES:
${stories}

Generate the tip card.`
  } else {
    throw new Error('assembleTipCard requires manualTip or brewDigest')
  }

  const client = getClient()
  const res = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: TIP_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const text = res.content?.[0]?.text || ''
  // Strip any markdown code fences Claude might still emit
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    return {
      headline: String(parsed.headline || '').slice(0, 120),
      bullets: Array.isArray(parsed.bullets)
        ? parsed.bullets.map(b => String(b).slice(0, 80)).slice(0, 6)
        : [],
      caption: String(parsed.caption || '').slice(0, 1800),
    }
  } catch (e) {
    throw new Error(`tip card JSON parse failed: ${e.message} — raw: ${cleaned.slice(0, 200)}`)
  }
}
