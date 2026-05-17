// One-sentence markets commentary for the ADAS Brew newsletter.
//
// Takes the 5 fetched stocks and asks Claude for a single line of context:
// what happened today, what was the standout move, in Mark's voice (per the
// locked brand voice spec). Fails-soft to empty string so the email still
// ships if Claude is unreachable.

import Anthropic from '@anthropic-ai/sdk'

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

const SYSTEM_PROMPT = `You write a ONE-SENTENCE markets line for the ADAS Brew daily newsletter. It sits under a table of 5 stock prices.

Audience: a collision shop owner or service writer with 90 seconds. They glanced at the prices. Your line gives them the WHY in plain English.

Voice (locked brand contract — non-negotiable):
- Direct, practical, no fluff or corporate jargon.
- Talk like a peer in the bay, not a financial analyst on TV.
- NEVER use em dashes. Use periods, commas, or parentheses.
- NEVER use AI-sounding phrases: "delve into", "in today's", "navigate", "unlock", "harness", "tapestry".
- NEVER use hype words: "revolutionary", "game-changing", "leverage", "cutting-edge".
- One sentence. Under 25 words.
- If everything moved the same direction, name the theme (broader tape, sector rotation, etc.).
- If one ticker stood out (biggest move), name it.
- No predictions. Just what happened.

Voice test: would a guy in a blue shirt with grease on his hands write this, or roll his eyes at it?

OUTPUT: just the sentence. No preamble, no markdown, no quotes.`

/**
 * Generate one sentence of context for the day's market moves.
 * @param {Array} stocks — output of fetchTopStocks()
 * @returns {Promise<string>} sentence, or '' on failure
 */
export async function assembleMarketsCommentary(stocks) {
  if (!Array.isArray(stocks) || stocks.length === 0) return ''
  if (!process.env.ANTHROPIC_API_KEY) return ''

  // Compose the data table for Claude
  const lines = stocks.map(s => {
    const day = Number.isFinite(s.changePct) ? `${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%` : 'n/a'
    const ytd = Number.isFinite(s.ytdPct) ? `${s.ytdPct >= 0 ? '+' : ''}${s.ytdPct.toFixed(2)}%` : 'n/a'
    return `${s.name} (${s.symbol}): $${Number(s.price).toFixed(2)} | today ${day} | YTD ${ytd}`
  })

  try {
    const client = getClient()
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Today's prices:\n${lines.join('\n')}\n\nWrite one sentence explaining the day's market action for the ADAS Brew reader.`,
      }],
    })
    const text = (message.content?.[0]?.text || '').trim()
    if (!text) return ''
    // Sanity: trim to one line, strip surrounding quotes if Claude added them
    return text.split('\n')[0].replace(/^["']|["']$/g, '').trim().slice(0, 200)
  } catch (e) {
    console.warn('[marketsCommentary]', e.message)
    return ''
  }
}
