// "Operator's Corner" — Thursday-only business-side segment in ADAS Brew
// (Mark 2026-10-17: Brew is the channel that brings in independent ADAS
// operators for the Founding Partner Program).
//
// One short practical piece for people who RUN a calibration business:
// getting paid, paperwork that holds up, denials, covering time off.
// Shop readers get it too (one email for everyone, no second send pipeline).
// The /partners line under it is fixed copy in brewRender, never AI-written.
//
// Fails soft to null (block just doesn't render). Mirrors carrierOfWeek.js.

import Anthropic from '@anthropic-ai/sdk'
import { sanitizeAiOutput } from './textSanitize.js'

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

// Rotates by ISO week. Pricing and territory topics are left out on purpose:
// talking competitors into matching prices or splitting areas is off-limits.
const TOPICS = [
  { name: 'Getting paid faster', hint: 'Invoice the day of the job, attach the report and scans, know who approves payment at each shop, follow up on a schedule instead of when you remember.' },
  { name: 'Paperwork that holds up', hint: 'Pre and post scans, OEM procedure cite, setup photos, target measurements, pass/fail printout. A file an adjuster cannot argue with.' },
  { name: 'Taking a week off without losing shops', hint: 'Shops stay loyal when the work still gets done. Backup coverage, telling shops ahead, more than one contact per shop.' },
  { name: 'When a calibration gets denied', hint: 'Read the denial reason, answer with the OEM statement, keep the reply short, track which carriers deny what.' },
  { name: 'More than one contact at every shop', hint: 'Owner, estimator, production manager, front desk. If one person leaves, the account should not leave with them.' },
  { name: 'Hiring tech number two', hint: 'When the calendar is full most weeks, what to look for, train on your process, do not hand off your best shop on day one.' },
  { name: 'The night paperwork problem', hint: 'Do the report in the bay before you leave, templates, photos named right the first time, one system instead of five.' },
  { name: 'Saying no to a calibration', hint: 'When a car is not ready (alignment, ride height, glass, codes), say no in writing and protect yourself and the driver.' },
]

function isoWeek(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 1)
  const dayOfYear = Math.floor((d - start) / 86400000)
  return Math.ceil((dayOfYear + start.getDay() + 1) / 7)
}
export function topicForThisWeek(d = new Date()) {
  return TOPICS[isoWeek(d) % TOPICS.length]
}

const SYSTEM_PROMPT = `You write "Operator's Corner" for the ADAS Brew newsletter, published every Thursday.

Audience: owners of small independent ADAS calibration businesses (1 to 3 techs, their own vans). Collision shop owners read it too, so nothing in it can make a shop look bad.

Written as Mark Fowler, owner of Absolute ADAS. He has been part of 50,000+ calibrations. Peer to peer, owner to owner. Not a sales pitch. Do NOT mention any program, partnership, network, Absolute ADAS services, or links. That is added separately.

Voice rules:
- Short sentences. Plain words. A guy in a blue shirt with grease on his hands should nod along.
- NEVER use em dashes. No AI phrases ("delve", "navigate", "unlock", "harness", "landscape"). No hype words.
- NEVER invent numbers, dollar amounts, percentages, shop names, customers, or stories. Practical advice only.
- NEVER talk about what to charge, matching prices, or dividing up areas or customers.

OUTPUT: raw JSON only, no markdown:
{
  "headline": "string, under 70 chars",
  "body": "string, 2 to 4 short sentences on the problem and how to handle it",
  "do_this": "string, ONE sentence starting with a verb: the thing to do this week"
}`

// Numbers, money and percentages are how made-up facts sneak in. Any of them
// and the block is dropped for the week rather than shipped.
const INVENTED = /\$\s?\d|\d\s?%|\b\d{2,}\b/

export async function generateOperatorCorner(digest, opts = {}) {
  if (!opts.always) {
    const dayPT = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
    if (dayPT !== 'Thu') return null
  }
  if (!process.env.ANTHROPIC_API_KEY) return null
  const topic = opts.topic || topicForThisWeek()
  try {
    const msg = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `This week's topic: ${topic.name}\n\nAngle: ${topic.hint}\n\nWrite this week's Operator's Corner. Return only the JSON.` }],
    })
    const raw = (msg.content?.[0]?.text || '').trim()
    if (!raw) return null
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim())
    const out = {
      topic: topic.name,
      headline: sanitizeAiOutput(String(parsed.headline || '')).slice(0, 100),
      body: sanitizeAiOutput(String(parsed.body || '')).slice(0, 600),
      do_this: sanitizeAiOutput(String(parsed.do_this || '')).slice(0, 220),
    }
    if (!out.headline || !out.body) return null
    const all = `${out.headline} ${out.body} ${out.do_this}`
    if (INVENTED.test(all) || /absolute adas|partner|network|program/i.test(all)) {
      console.warn('[operatorCorner] dropped: failed the no-numbers / no-pitch check')
      return null
    }
    return out
  } catch (e) {
    console.warn('[operatorCorner]', e.message)
    return null
  }
}
