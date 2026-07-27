// LinkedIn network growth — the WINGMAN, not a bot.
//
// LinkedIn's API doesn't allow automated connection invites or member
// messaging (partner-locked), and browser automation is how accounts get
// restricted (Mark already lost an IG account to automated comments —
// 2026-06 hard lock). So this system drafts, and MARK sends:
//
//   1. Every weekday morning a Cliq card lists ~10 CRM shops he isn't
//      connected with yet — each with a tap-to-search LinkedIn link and a
//      ready-to-paste invite note in his voice (≤280 chars, fits the
//      300-char invite note limit).
//   2. /debug/li-welcome is a phone-friendly form: paste a new connection's
//      name → get a welcome DM draft to copy into LinkedIn.
//
// Every message is human-sent from linkedin.com. Nothing here touches
// LinkedIn's servers at all.
//
// Suggested-shop state lives in VanKV (Datastore) — Cache caps at 48h.

import Anthropic from '@anthropic-ai/sdk'
import { getAllShops } from '../routes/shops.js'
import { getVal, setVal } from './vanDatastore.js'

const STATE_KEY = 'li_outreach_state'   // { suggested: { [shopId]: iso }, updated_at }
const BATCH_SIZE = 10

// Competitors never end up on Mark's outreach lists (standing rule 2026-06):
// silent-remove, no exceptions. Substring match on shop name + email.
const COMPETITOR_RE = /avscalibrations|hivecalibrations|abs-c|calibration/i

function anthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

export async function readOutreachState(req) {
  const v = await getVal(req, STATE_KEY)
  return v && typeof v === 'object' ? v : { suggested: {} }
}

export async function writeOutreachState(req, state) {
  await setVal(req, STATE_KEY, { ...state, updated_at: new Date().toISOString() })
}

/**
 * Pick the next batch of shops worth connecting with.
 * Preference: named contact person first (a person to connect WITH), then
 * pipeline targets over customers, then oldest last_contact first.
 */
export function pickOutreachBatch({ shops, state, count = BATCH_SIZE }) {
  const suggested = state?.suggested || {}
  // Out-of-state shops (OR/ID/CA addresses or 97xxx/83xxx/9[0-6]xxx zips)
  // aren't Mark's audience — Western WA only.
  const OUT_OF_AREA_RE = /,\s*(OR|ID|CA)\b|\b(97|83|9[0-6])\d{3}\b/
  const candidates = (shops || []).filter(s =>
    s.shop_name &&
    !suggested[s.id] &&
    !COMPETITOR_RE.test(`${s.shop_name} ${s.email || ''}`) &&
    !OUT_OF_AREA_RE.test(String(s.address || ''))
  )
  const contactName = s => (s.people?.[0]?.name || s.contact_name || '').trim()
  candidates.sort((a, b) => {
    const aNamed = contactName(a) ? 0 : 1
    const bNamed = contactName(b) ? 0 : 1
    if (aNamed !== bNamed) return aNamed - bNamed
    const aTarget = a.pipeline_stage === 'target' ? 0 : 1
    const bTarget = b.pipeline_stage === 'target' ? 0 : 1
    if (aTarget !== bTarget) return aTarget - bTarget
    return String(a.last_contact || '').localeCompare(String(b.last_contact || ''))
  })
  return candidates.slice(0, count).map(s => ({
    shop_id: s.id,
    shop_name: s.shop_name,
    contact_name: contactName(s),
    city: cityFromAddress(s.address),
    pipeline_stage: s.pipeline_stage || '',
  }))
}

function cityFromAddress(address) {
  // "123 Main St, Tacoma, WA 98402" → "Tacoma". CRM addresses are messy —
  // some are just "Everett, WA 98208", some have no city at all. Drop any
  // segment that's a state+zip ("WA 98208") and take the last one left
  // that isn't a street line.
  const parts = String(address || '').split(',').map(p => p.trim()).filter(Boolean)
    .filter(p => !/^[A-Z]{2}\s*\d{5}/.test(p) && !/^\d{5}(-\d{4})?$/.test(p) && !/^(USA|United States|WA)$/i.test(p))
  if (!parts.length) return ''
  const last = parts[parts.length - 1].replace(/\s+[A-Z]{2}\s*\d{5}.*$/, '').trim()
  // A street line ("123 Main St") starts with digits — not a city.
  return /^\d/.test(last) ? '' : last
}

const VOICE_RULES = `You write as Mark Fowler, owner of Absolute ADAS, a mobile ADAS
calibration company in Western Washington. Voice test: "would a guy in a blue
shirt with grease on his hands write this?"
HARD RULES: no em dashes, no exclamation marks, no emojis, no links, no
pitch, no discounts, no "synergy"-class words, never mention this was drafted.
Plain, direct, neighborly. One or two sentences.`

/**
 * Draft invite notes for a batch in ONE Claude call.
 * Returns [{shop_id, note}] — note ≤280 chars (LinkedIn cap is 300).
 */
export async function draftInviteNotes({ targets }) {
  if (!targets?.length) return []
  const list = targets.map((t, i) =>
    `${i + 1}. ${t.contact_name || 'the owner'} at ${t.shop_name}${t.city ? `, ${t.city}` : ''}`).join('\n')
  const msg = await anthropic().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: `${VOICE_RULES}
You draft LinkedIn CONNECTION INVITE notes. Each must be under 280 characters,
reference the shop or town naturally, and read like Mark typed it between
calibrations. Vary the phrasing across notes — no two alike. These are collision
shops in his service area, some he already works with, some he wants to meet.
Never imply a prior relationship that may not exist. Good bones: shared trade,
same region, keeps his feed local. Return ONLY a JSON array:
[{"n": 1, "note": "..."}, ...]`,
    messages: [{ role: 'user', content: `Draft invite notes for:\n${list}` }],
  })
  const text = msg.content?.[0]?.text || '[]'
  const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
  return targets.map((t, i) => ({
    ...t,
    note: String(arr.find(a => a.n === i + 1)?.note || '').slice(0, 280),
  }))
}

/**
 * Draft a welcome DM for one new connection (the /li-welcome form).
 */
export async function draftWelcomeMessage({ name, company, context }) {
  const msg = await anthropic().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: `${VOICE_RULES}
You draft the FIRST direct message to a brand-new LinkedIn connection. Two or
three sentences max. Thank them for connecting like a human would, one grounded
line about the trade or their area if known. NO pitch, NO links, NO asking for
anything. The goal is only that they remember Mark as a real person.`,
    messages: [{
      role: 'user',
      content: `New connection: ${name}${company ? ` (${company})` : ''}${context ? `\nContext from Mark: ${context}` : ''}`,
    }],
  })
  return String(msg.content?.[0]?.text || '').trim()
}

function liSearchUrl(t) {
  const q = encodeURIComponent([t.contact_name, t.shop_name].filter(Boolean).join(' '))
  return `https://www.linkedin.com/search/results/people/?keywords=${q}`
}

/**
 * Cliq card for the morning batch.
 */
export function formatOutreachCard({ items }) {
  const lines = [
    `🤝 *LINKEDIN OUTREACH — today's ${items.length}*`,
    `Tap the link, hit Connect, paste the note. 10 minutes.`,
    `_(Out of personalized-note credits this month? Send without a note — the list order still holds.)_`,
    '',
  ]
  items.forEach((t, i) => {
    lines.push(`*${i + 1}. ${t.contact_name || 'Owner'} — ${t.shop_name}*${t.city ? ` (${t.city})` : ''}`)
    lines.push(`🔎 ${liSearchUrl(t)}`)
    lines.push('```')
    lines.push(t.note)
    lines.push('```')
    lines.push('')
  })
  return lines.join('\n').slice(0, 6000)
}
