// Commitment extractor — pulls "I'll do X by Friday"-type commitments from message
// text (Cliq channels, later email/SMS) using Claude. Follows the mail-agent pattern.
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-4-5'
function client() {
  // Hard 12s timeout + no retries: this runs inside Catalyst's 30s gateway window,
  // so a slow/hung API call must die fast rather than sink the whole briefing.
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 12000, maxRetries: 0 })
}

const SYSTEM = `You extract commitments from workplace messages for Mark, owner of Absolute ADAS (mobile ADAS calibration, Western WA).

A COMMITMENT is any statement where a person says they will do something ("I'll have it by Friday", "I will call them", "done by Tuesday"), OR an action a person clearly owns with a timeframe.

Rules:
- Capture BOTH inbound (someone promising Mark or the team) and outbound (Mark promising someone).
- person = the one who owns/made the commitment. Known people: Jaden (field tech), Kat (invoicing / AR), Joyce. Otherwise use the first name, or "External".
- direction = "outbound" if Mark is the one promising, else "inbound".
- Due date logic: use the explicit date if given. "this week" = the coming Friday. "ASAP" or "soon" = 2 days out. No date = null.
- IGNORE small talk, already-completed items, questions, and anything that is not a real commitment.

Output ONLY a JSON array. Each item:
{"text": "<short paraphrase of the commitment>", "person": "<name>", "direction": "inbound|outbound", "due": "YYYY-MM-DD or null", "source": "<source label>"}
If there are no commitments, output [].`

/**
 * @param {{ blocks: {source:string,label:string,text:string}[], today: string }} args
 * @returns {Promise<Array>} array of commitment objects
 */
export async function extractCommitments({ blocks = [], today }) {
  const joined = blocks
    .filter(b => b && b.text && b.text.trim())
    .map(b => `--- source: ${b.source} (${b.label}) ---\n${b.text}`)
    .join('\n\n')
    .slice(0, 8000)
  if (!joined.trim()) return []

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 800,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Today is ${today}.\n\nMessages:\n${joined}` }],
  })

  const raw = (res.content?.[0]?.text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
