// 🔄 Anti-sublet → Partnership Discount FLIP (Mark's idea, 2026-09-24).
//
// Mark IS a sublet ADAS vendor, so copy that attacks the sublet model is a
// self-own (the 2026-09-24 "delete every post from today" incident). Four
// drafters carry a hard block for it. A hard block is safe but wasteful: the
// run dies and nothing ships.
//
// So instead of failing, we flip. The offending draft is handed back to Claude
// with one instruction — rewrite it as the story of what the RIGHT sublet
// partner ADDS — and the flipped version ships. Every failed attempt becomes a
// Partnership Discount post.
//
// The hard block is still the floor: if the flip comes back dirty (or the flip
// itself fails), the caller throws exactly as before. We never ship a self-own.
import Anthropic from '@anthropic-ai/sdk'
import { detectAntiSubletViolation } from './captureStoryGenerator.js'
import { sanitizeAiOutput } from './textSanitize.js'

const MODEL = 'claude-sonnet-4-6'

const BRIEF = `You are rewriting one piece of Absolute ADAS marketing copy that accidentally attacked the sublet model.

WHY IT IS WRONG: Absolute ADAS IS a sublet ADAS calibration vendor. Copy telling shops to stop subletting, bring calibration in-house, or cut out the middleman argues the shop should fire us. It is a self-own.

THE FLIP: keep the same subject, the same reader, the same length and the same voice — but tell the other half of the story. The RIGHT sublet partner ADDS margin. The Partnership Discount Model puts 15-25% off list back in the shop's pocket on every invoice, which is pure margin they would never get bringing calibration in-house (equipment, targets, training, floor space, liability, and a tech who stops turning hours). Sublet done right is leverage, not a leak.

The villain is never "sublet vendors". The villain is a LIST-PRICE vendor who charges full retail and shares none of it back.

Canonical numbers, use them accurately when dollars come up:
- Static calibration list price: $450
- Standard partner, 15% off: $67.50 margin to the shop per cal
- Volume tier, 15+/mo, 20% off: $90 per cal
- Preferred Partner, 30+/mo, 25% off: $112.50 per cal, plus same-day priority and free documentation

VOICE: a guy in a blue shirt with grease on his hands wrote this. Short sentences. No em dashes. No AI words (delve, leverage as a verb, unlock, synergy, elevate, robust, harness, navigate the landscape, tapestry). No exclamation marks. Do not mention that anything was rewritten, blocked or flipped.`

const jsonOf = raw => { const t = String(raw || ''); const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b < 0) throw new Error('no JSON in flip output'); return JSON.parse(t.slice(a, b + 1)) }
const joinValues = o => Object.values(o).map(v => Array.isArray(v) ? v.join('\n') : String(v ?? '')).join('\n')

/**
 * Rewrite anti-sublet copy as Partnership Discount copy.
 * @param {string|object} payload  the offending copy — a string, or an object whose string/array fields are the copy
 * @param {object}  opts
 * @param {string}  opts.what      what this is, for the prompt ("LinkedIn post", "Brew tip card", …)
 * @param {string}  opts.hit       the phrase the guard matched
 * @param {string}  opts.context   anything else the rewriter should know (channel, category, format rules)
 * @param {number}  opts.tries     flip attempts before giving up (default 2)
 * @returns {Promise<string|object|null>} the flipped copy in the SAME shape, or null if it could not be made clean
 */
export async function flipAntiSublet(payload, { what = 'post', hit = '', context = '', tries = 2 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const isText = typeof payload === 'string'
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const shapeRule = isText
    ? 'Return ONLY the rewritten copy. No preamble, no markdown fences, no notes.'
    : `Return ONLY a JSON object with exactly these keys and the same types as the input: ${Object.keys(payload).join(', ')}. Keep arrays as arrays with the same number of entries. Keep every field roughly its original length. No markdown fences, no notes.`

  for (let i = 0; i < tries; i++) {
    try {
      const msg = await client.messages.create({
        model: MODEL, max_tokens: 2000, system: BRIEF,
        messages: [{ role: 'user', content: `This is a ${what} that tripped the anti-sublet guard${hit ? ` on the phrase "${hit}"` : ''}.${context ? `\n\nContext: ${context}` : ''}\n\nFlip it.${i ? ' Your last attempt still read as anti-sublet — this time remove every trace of "the shop should stop subletting" and make it entirely about the margin the right partner hands back.' : ''}\n\n${shapeRule}\n\n---\n${isText ? payload : JSON.stringify(payload, null, 2)}\n---` }],
      })
      const raw = (msg.content?.find(b => b.type === 'text')?.text || '').trim()
      if (!raw) continue
      const out = isText ? sanitizeAiOutput(raw) : jsonOf(raw)
      if (!isText) for (const k of Object.keys(payload)) if (!(k in out)) throw new Error(`flip dropped key ${k}`)
      const still = detectAntiSubletViolation(isText ? out : joinValues(out))
      if (still) { console.warn(`[sublet-flip] attempt ${i + 1} still anti-sublet ("${still}")`); continue }
      console.log(`[sublet-flip] ✅ ${what} flipped to Partnership Discount copy (was: "${hit}")`)
      return out
    } catch (e) { console.warn(`[sublet-flip] attempt ${i + 1} failed:`, e.message) }
  }
  console.error(`[sublet-flip] could not flip this ${what} — falling back to the hard block`)
  return null
}
