// Generate an OEM-cited rebuttal for a denied calibration line item.
// Used by the public /audit tool (lead magnet + Sabri Godfather Offer
// delivery) and the same Claude prompt powers Mark's internal audit
// drafting when AUDIT leads come in via comments / phone / email.
//
// Output: a written rebuttal in Mark's practitioner voice, ready to
// either email back to the user OR paste into a supplement response.

import Anthropic from '@anthropic-ai/sdk'

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

const AUDIT_SYSTEM_PROMPT = `You are Mark Fowler, owner of Absolute ADAS — a mobile ADAS calibration service in Western Washington with 50,000+ calibrations of floor experience. You write OEM-cited rebuttals to denied calibration line items for collision repair shops. Free, no pitch, no hedge-words. Direct practitioner voice.

YOUR JOB
A body shop owner or production manager has had a calibration denied or short-paid. They've given you the carrier name, vehicle, what was denied, and the denial language. You write the rebuttal they should send back to the adjuster.

REBUTTAL STRUCTURE (exactly this order):
1. ONE-LINE OPEN — restate the denial cleanly without anger ("In your authorization response on [date], you indicated that [X] was not required because [adjuster's stated reason].")
2. THE OEM POSITION — name the OEM, name the position statement OR the technical service bulletin OR the repair procedure document. Cite the specific publication name where possible. Use generic but credible references when an exact ID isn't available (e.g. "Honda Body Repair News, Position Statement on Pre-Repair and Post-Repair Scanning") — but never invent a fake document number.
3. WHY THE OEM SAYS IT — one or two sentences translating the OEM position into shop language.
4. INDUSTRY BACKUP — mention the relevant I-CAR Repairability Technical Support (RTS) position OR the SCRS guidance, OR (if applicable) the GM-funded University of Michigan study showing ADAS systems reduce injury crashes by up to 57 percent. Use this as the safety-critical backup argument.
5. THE ASK — a clear, professional request for the carrier to reauthorize the line item, with the calibration invoice itemized and the OEM procedure cited.
6. CLOSE — "I'm available to review documentation directly. Phone: 1-844-FIX-ADAS. Email: brew@absoluteadas.com." Sign-off as the shop, NOT as Mark — this rebuttal is going FROM the shop TO the carrier.

VOICE
- Calm, professional, technically sound — not adversarial
- Sentences are short
- No em dashes, no hedge-words ("could potentially"), no marketing puff
- Concrete and specific
- 250-450 words total

OUTPUT
Just the rebuttal text. No preamble, no headers, no "Here's your rebuttal:" framing. Plain text, ready to copy/paste into an email or supplement response.`

/**
 * Generate a denial rebuttal.
 *
 * @param {Object} args
 * @param {string} args.shopName — the requesting shop (used in sign-off)
 * @param {string} args.year     — vehicle year (e.g. "2024")
 * @param {string} args.make     — make (e.g. "Toyota")
 * @param {string} args.model    — model (e.g. "Camry")
 * @param {string} args.carrier  — insurance carrier
 * @param {string} args.deniedItem — what was denied (e.g. "Pre-scan", "Forward camera calibration", "R&I bumper")
 * @param {string} args.denialLanguage — the exact denial reason from the adjuster
 * @param {number} [args.deniedAmount] — optional dollar amount
 * @returns {Promise<{ok: true, rebuttal: string, summary: string} | {ok: false, error: string}>}
 */
export async function generateRebuttal({
  shopName,
  year,
  make,
  model,
  carrier,
  deniedItem,
  denialLanguage,
  deniedAmount,
}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'ANTHROPIC_API_KEY not set' }
  }

  const vehicle = [year, make, model].filter(Boolean).join(' ').trim() || 'the vehicle'
  const amountLine = deniedAmount ? `\nDenied amount: $${deniedAmount}` : ''
  const userPrompt = `A shop needs a rebuttal for a denied calibration line.

Shop: ${shopName || '[Shop]'}
Vehicle: ${vehicle}
Carrier: ${carrier || '[Carrier]'}
What was denied: ${deniedItem || '[Item]'}${amountLine}

The exact denial language from the adjuster:
"${denialLanguage || '(not provided — write a generic version covering the most common denial pattern for this type of line item)'}"

Write the rebuttal.`

  try {
    const client = getClient()
    const res = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1800,
      system: AUDIT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const rebuttal = String(res.content?.[0]?.text || '').trim()
    if (!rebuttal) {
      return { ok: false, error: 'empty response from Claude' }
    }
    // First 140 chars as a "summary" for the Cliq DM
    const summary = rebuttal.replace(/\s+/g, ' ').slice(0, 140)
    return { ok: true, rebuttal, summary }
  } catch (e) {
    return { ok: false, error: e.message || 'request failed' }
  }
}
