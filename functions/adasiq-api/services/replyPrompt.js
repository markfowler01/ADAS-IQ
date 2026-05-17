// One-line reply prompt for the ADAS Brew daily newsletter.
// Sits at the bottom of the email, above the byline. Asks the reader for
// specific info Mark can use to build the audit-tool / sublet relationship.
//
// Fails-soft to a generic fallback if Anthropic is down.

import Anthropic from '@anthropic-ai/sdk'
import { sanitizeAiOutput } from './textSanitize.js'

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

const SYSTEM_PROMPT = `You write a ONE-LINE reply prompt for the ADAS Brew daily newsletter. It sits at the end of the email — last thing the reader sees before the byline.

Audience: collision shop owners, glass shop managers, service writers in Western Washington.

Goal: get the reader to hit reply with specific info Mark can use to:
  - Build relationships (he replies personally)
  - Mine for /audit tool leads
  - Stay current on what carriers are doing this week

Voice (locked brand contract):
- Direct, practical. Peer in the bay, not a marketer.
- NEVER use em dashes. NEVER use AI phrases ("delve", "unlock", "navigate").
- Sound like Mark would actually write it after pouring his coffee.

Format requirements:
- ONE sentence. Under 20 words.
- Must be a SPECIFIC question, not generic ("what do you think?" is BANNED).
- Tied to TODAY's stories where possible — pick the strongest angle.
- Start with "Reply:" or "Reply with:" — no preamble, no markdown, no quotes.

Examples:
- "Reply: which carrier short-paid you most last month?"
- "Reply with: any Honda Sensing recals you've sublet in the last 30 days? Carrier name."
- "Reply: what OEM bulletin is your shop most stuck on right now?"
- "Reply with: did State Farm push back on your last calibration line? What did they cite?"

OUTPUT: just the line. No preamble.`

/**
 * Generate today's reply prompt from the digest's stories.
 * @param {Object} digest — output of assembleDigest()
 * @returns {Promise<string>}
 */
export async function generateReplyPrompt(digest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return 'Reply: what carrier is denying the most calibrations in your shop this week?'
  }
  const stories = Array.isArray(digest?.stories) ? digest.stories : []
  if (stories.length === 0) {
    return 'Reply: what carrier is denying the most calibrations in your shop this week?'
  }

  const storyLines = stories.map((s, i) => `${i + 1}. [${s.tag || 'IND'}] ${s.headline}\n   ${s.body || ''}`).join('\n')

  try {
    const client = getClient()
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Today's stories:\n${storyLines}\n\nWrite the one-line reply prompt for today.`,
      }],
    })
    let text = (message.content?.[0]?.text || '').trim()
    if (!text) throw new Error('empty')
    text = text.split('\n')[0].replace(/^["']|["']$/g, '').trim()
    if (!/^reply\b/i.test(text)) text = `Reply: ${text}`
    return sanitizeAiOutput(text).slice(0, 200)
  } catch (e) {
    console.warn('[replyPrompt]', e.message)
    return 'Reply: what carrier is denying the most calibrations in your shop this week?'
  }
}
