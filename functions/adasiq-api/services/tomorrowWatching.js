// One-line "tomorrow we're watching" stinger for the ADAS Brew daily newsletter.
// Last thing readers see before unsubscribe — trains them to expect tomorrow's
// issue. Predictions based on today's signals: pending bulletins, carriers in
// the news, recall watch, etc.
//
// Fails-soft to a generic fallback if Anthropic is down.

import Anthropic from '@anthropic-ai/sdk'
import { sanitizeAiOutput } from './textSanitize.js'

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

const SYSTEM_PROMPT = `You write a ONE-LINE "tomorrow we're watching" stinger for the ADAS Brew daily newsletter. It's the very last line readers see before unsubscribe info.

Goal: give them a reason to open tomorrow's email.

Voice (locked brand contract):
- Direct, peer in the bay, no fluff.
- NEVER use em dashes. NEVER use AI phrases.
- Speculative but specific. Use today's signals — pending OEM bulletins, carriers in the news, upcoming recall windows, etc.

Format requirements:
- ONE sentence. Under 22 words.
- Must start with "Tomorrow:" — no preamble, no markdown, no quotes.
- Reference real, concrete things from today's stories.

Examples:
- "Tomorrow: watch for Honda's response on the camera recall + an Allstate denial pattern we're seeing across 8 shops this week."
- "Tomorrow: the new IIHS scoring methodology drops and three OEMs have bulletins queued."
- "Tomorrow: a Toyota TSB on RAV4 lane departure cals plus an update on the Mobileye chip shortage."

OUTPUT: just the line. No preamble.`

/**
 * Generate today's "Tomorrow we're watching" stinger from the digest.
 * @param {Object} digest — output of assembleDigest()
 * @returns {Promise<string>}
 */
export async function generateTomorrowWatching(digest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return 'Tomorrow: more carrier signals + OEM bulletins worth your morning coffee.'
  }
  const stories = Array.isArray(digest?.stories) ? digest.stories : []
  if (stories.length === 0) {
    return 'Tomorrow: more carrier signals + OEM bulletins worth your morning coffee.'
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
        content: `Today's stories:\n${storyLines}\n\nWrite the one-line "Tomorrow:" stinger for tomorrow's expected coverage.`,
      }],
    })
    let text = (message.content?.[0]?.text || '').trim()
    if (!text) throw new Error('empty')
    text = text.split('\n')[0].replace(/^["']|["']$/g, '').trim()
    if (!/^tomorrow\b/i.test(text)) text = `Tomorrow: ${text}`
    return sanitizeAiOutput(text).slice(0, 220)
  } catch (e) {
    console.warn('[tomorrowWatching]', e.message)
    return 'Tomorrow: more carrier signals + OEM bulletins worth your morning coffee.'
  }
}
