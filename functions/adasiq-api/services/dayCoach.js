// Day coach — the judgment layer over the ledger.
//
// Three Claude calls, each with a different job:
//   proposeBig3()   morning: reads goals + recent ledger, proposes the day's Big 3
//   parseCheckin()  evening: turns Mark's plain-English SMS reply into a record
//   weeklyReview()  Sunday: reads 7 days and writes what it sees
//
// MODEL SPLIT — deliberate, not cost-shaving:
//   parseCheckin runs INLINE in the Twilio inbound webhook. Catalyst can't
//   fire-and-forget after responding (see the Catalyst quirks notes), so the
//   parse has to finish before we answer Twilio, and Twilio gives up around
//   15s. Haiku does this extraction reliably in ~1s. The other two run on the
//   cron runner (direct function invoke, 540s budget) where Opus's judgment is
//   the whole point and latency doesn't matter.

import Anthropic from '@anthropic-ai/sdk'

const COACH_MODEL = 'claude-opus-5'      // judgment: proposals, pattern-finding
const PARSE_MODEL = 'claude-haiku-4-5'   // extraction: SMS -> JSON, on a clock

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

// Models return JSON but sometimes wrap it in prose or a fence. Pull the first
// balanced object out rather than trusting the whole string to parse.
function extractJson(text) {
  const s = String(text || '')
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : s
  const start = body.indexOf('{')
  if (start === -1) return null
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < body.length; i++) {
    const c = body[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(body.slice(start, i + 1)) } catch { return null }
    }
  }
  return null
}

const firstText = res => (res?.content || []).filter(b => b.type === 'text').map(b => b.text).join('')

// ── morning: propose the Big 3 ───────────────────────────────────────────────

const BIG3_SYSTEM = `You are Mark's chief of staff. Mark owns Absolute ADAS, a mobile ADAS calibration shop in Western Washington. Every morning you propose his Big 3 — the three things that, if he only did those, would make the day a win.

The rules he set for himself, in his own planner:
  (a) one that moves revenue most
  (b) one that unblocks the team
  (c) one only he can do

You also propose "the hard thing" — the one task he doesn't want to do. It goes first in the day.

How to choose:
- Anchor on the goals you're given. A day that hits three tasks unrelated to his goals is a busy day, not a good day.
- Look at what he missed yesterday and the day before. A Big 3 item he's ducked twice is usually the hard thing.
- Watch the F3 balance (Faith, Family, Fitness, Finances). If an area has gone untouched for several days, one of the three should serve it. He built this system to run his life, not just his business.
- Be specific enough to be checkable tonight. "Follow up with shops" is not a task. "Call the three shops with quotes out past 7 days" is.
- If the coaching notes tell you something about how his good days are built, use it.

Return raw JSON only. No preamble, no markdown fence.
{
  "big3": [
    {"text": "...", "source": "revenue" | "unblocks_team" | "only_you" },
    ...exactly 3
  ],
  "hard_thing": "...",
  "note": "one sentence to Mark on why these three, in plain language"
}`

export async function proposeBig3(req, { goals, recentDays, coachingNotes, todayContext }) {
  const recent = (recentDays || []).slice(-5).map(d => ({
    date: d.date,
    rating: d.rating,
    big3: (d.big3 || []).map(b => ({ text: b.text, done: !!b.done })),
    hard_thing: d.hard_thing || null,
    f3: d.f3 || {},
    win: d.win || '',
    drag: d.drag || '',
  }))

  const user = [
    `Today is ${todayContext.today} (${todayContext.weekday}).`,
    '',
    '## His goals',
    goals || '(no goals on file — say so in your note)',
    '',
    '## What today already looks like',
    JSON.stringify(todayContext.load || {}, null, 1),
    '',
    '## The last few days',
    recent.length ? JSON.stringify(recent, null, 1) : '(no history yet — this is the first day)',
    '',
    '## Coaching notes from the last weekly review',
    coachingNotes || '(none yet)',
  ].join('\n')

  const res = await client().messages.create({
    model: COACH_MODEL,
    max_tokens: 4000,
    system: BIG3_SYSTEM,
    messages: [{ role: 'user', content: user }],
  })
  const parsed = extractJson(firstText(res))
  if (!parsed?.big3?.length) return null
  return {
    big3: parsed.big3.slice(0, 3),
    hardThing: parsed.hard_thing || '',
    note: parsed.note || '',
  }
}

// ── evening: parse the reply ─────────────────────────────────────────────────

const PARSE_SYSTEM = `You turn one text message into JSON. Mark is answering an end-of-day check-in about his Big 3, how the day went, and why. He texts casually and in fragments. Read him generously.

You are given the Big 3 he was asked about, in order. Decide which he hit.

Mapping notes:
- "got 1 and 3" / "first two" / "all of them" / "none" -> map onto the list by position.
- He may name a task instead of a number. Match it.
- Rating: any 1-10 he gives for the day. "solid" ~8, "rough"/"garbage" ~3, "fine"/"ok" ~6. null if there's genuinely nothing to go on.
- win = what made it good. drag = what got in the way. Quote his own words, trimmed. Empty string if absent.
- f3: true only when he actually indicates it happened. Faith (church, prayer, scripture, devotional), Family (wife, kids, dinner, time at home), Fitness (F3, workout, gym, ran, lifted), Finances (budget, books, bills, personal money — NOT business revenue).
- hard_thing_done: did he do the hard thing.
- Anything he didn't address is false/null, never a guess.

Return raw JSON only.
{"big3_done": [bool, bool, bool], "hard_thing_done": bool, "rating": int|null, "energy": {"morning": int|null, "midday": int|null, "evening": int|null}, "win": "", "drag": "", "f3": {"faith": bool, "family": bool, "fitness": bool, "finances": bool}}`

export async function parseCheckin(req, { reply, big3, hardThing }) {
  const list = (big3 || []).map((b, i) => `${i + 1}. ${b.text}`).join('\n') || '(none were set)'
  const res = await client().messages.create({
    model: PARSE_MODEL,
    max_tokens: 700,
    system: PARSE_SYSTEM,
    messages: [{
      role: 'user',
      content: `His Big 3 today:\n${list}\n\nThe hard thing: ${hardThing || '(none set)'}\n\nHis reply:\n"""${reply}"""`,
    }],
  })
  const parsed = extractJson(firstText(res)) || {}
  const n = (big3 || []).length
  return {
    big3_done: Array.from({ length: n }, (_, i) => !!parsed.big3_done?.[i]),
    hard_thing_done: !!parsed.hard_thing_done,
    rating: Number.isFinite(parsed.rating) ? Math.max(1, Math.min(10, parsed.rating)) : null,
    energy: parsed.energy || {},
    win: String(parsed.win || '').slice(0, 300),
    drag: String(parsed.drag || '').slice(0, 300),
    f3: {
      faith: !!parsed.f3?.faith, family: !!parsed.f3?.family,
      fitness: !!parsed.f3?.fitness, finances: !!parsed.f3?.finances,
    },
    raw_reply: String(reply || '').slice(0, 2000),
  }
}

// ── sunday: the learning pass ────────────────────────────────────────────────

const REVIEW_SYSTEM = `You are Mark's coach. Once a week you read his day ledger and tell him what you see.

This is the part of the system that learns. Your output feeds into next week's morning briefs, so write for that: what should the brief do differently on Monday because of what happened this week.

What to look for — only claim it if the data actually shows it:
- What separates his 8+ days from his 5- days. Look at what he wrote in "win" and "drag", not just the numbers.
- Which Big 3 items keep getting set and keep not getting done. Something set three times and never finished is not a task problem, it's a wrong-task problem — say so.
- F3 balance. Which areas are getting nothing.
- Whether he's answering the check-in at all. Missed check-ins are data too.

Rules:
- Be concrete and short. He reads this on a phone.
- Do not congratulate him. Do not pad. If it was a bad week, say it was a bad week.
- One week is a small sample. Say "this week" not "you always". Flag a pattern as tentative until you've seen it repeat.
- If there isn't enough data to say anything useful, say that instead of inventing a pattern.

Return raw JSON only.
{
  "headline": "one sentence on the week",
  "what_worked": ["..."],
  "what_didnt": ["..."],
  "pattern": "the one thing most worth acting on, or empty string if the data won't support one",
  "next_week": "concrete guidance the morning brief should apply next week",
  "coaching_notes": "what to carry into every morning brief from here on — this text is fed back in verbatim, so write it as instructions to yourself"
}`

export async function weeklyReview(req, { days, goals, priorNotes }) {
  const res = await client().messages.create({
    model: COACH_MODEL,
    max_tokens: 8000,
    system: REVIEW_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        '## His goals', goals || '(none on file)', '',
        '## Coaching notes carried in from last week', priorNotes || '(none)', '',
        '## The week', JSON.stringify(days, null, 1),
      ].join('\n'),
    }],
  })
  return extractJson(firstText(res))
}

export const COACH_MODELS = { coach: COACH_MODEL, parse: PARSE_MODEL }
