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
// The nightly review also runs on Haiku, and for the same reason: the evening
// endpoint answers a gateway request capped at 30s. This call summarizes facts
// it is handed and asks a question — it is not the pattern-finding step. That
// job is weeklyReview(), which runs on Opus where the judgment compounds.
const REVIEW_MODEL = 'claude-haiku-4-5'
// The Sunday week plan runs on Sonnet, not Opus, for a hard platform reason:
// it answers a gateway request and the gateway kills the connection around
// 30-38s. Opus took ~40s and 408'd, and — verified, not assumed — the handler
// does NOT keep running after the gateway gives up, so the work was simply
// lost. Sonnet finishes this synthesis inside the window. The Opus judgment
// call stays on weeklyReview, which is what actually finds the patterns.
const WEEKPLAN_MODEL = 'claude-sonnet-5'

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
- CRITICAL: a day with "reported": false means he was never asked and never answered. You know NOTHING about what he did that day. Never say or imply he skipped, pushed, avoided, or failed anything on an unreported day, and never count it toward a streak. Only days with "reported": true are evidence about his behavior. If you have no reported days at all, say nothing about his habits — talk about today only.
- Watch the F3 balance (Faith, Family, Fitness, Finances). If an area has gone untouched for several days, one of the three should serve it. He built this system to run his life, not just his business.
- Be specific enough to be checkable tonight. "Follow up with shops" is not a task. "Call the three shops with quotes out past 7 days" is.
- Keep each one under about 90 characters. It has to read on a phone lock screen. Put the number in the task, not a paragraph of reasoning — the reasoning goes in "note".
- If the coaching notes tell you something about how his good days are built, use it.

The affirmation comes first, because he reads it before anything else.
It is one or two sentences, first person, that he says to himself. Ground it in
who he actually is and what he is actually carrying this week — his faith, his
family, the rung of the ladder he is on, the race he is training for. Not a
poster slogan and not hype. The test: would a guy in a blue shirt with grease on
his hands say this out loud without wincing. Steady and true beats loud. Do not
reuse yesterday's wording.

Return raw JSON only. No preamble, no markdown fence.
{
  "affirmation": "...",
  "big3": [
    {"text": "...", "source": "revenue" | "unblocks_team" | "only_you" },
    ...exactly 3
  ],
  "hard_thing": "...",
  "note": "one sentence to Mark on why these three, in plain language"
}`

export async function proposeBig3(req, { goals, recentDays, coachingNotes, todayContext }) {
  // `reported` is load-bearing. Without it the model reads an unchecked box on
  // a day Mark was never asked about as evidence he ducked the task — which it
  // did on day one, telling him he'd "pushed the calls two days running" when
  // one of those days was a test row he never saw.
  const recent = (recentDays || []).slice(-5).map(d => ({
    date: d.date,
    reported: !!d.checkin_at,
    rating: d.rating,
    big3: (d.big3 || []).map(b => ({
      text: b.text,
      status: d.checkin_at ? (b.done ? 'done' : 'not done') : 'unknown — never reported',
    })),
    hard_thing: d.hard_thing
      ? { text: d.hard_thing.text, status: d.checkin_at ? (d.hard_thing.done ? 'done' : 'not done') : 'unknown — never reported' }
      : null,
    f3: d.checkin_at ? (d.f3 || {}) : 'unknown — never reported',
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
    affirmation: parsed.affirmation || '',
    big3: parsed.big3.slice(0, 3),
    hardThing: parsed.hard_thing || '',
    note: parsed.note || '',
  }
}

// ── evening: review the day, then ask ───────────────────────────────────────

const NIGHTLY_SYSTEM = `You write Mark's end-of-day text. He owns Absolute ADAS, a mobile ADAS calibration shop.

You are given what the day actually looked like — jobs closed, commitments due and overdue, promises he made, unread mail, tomorrow's load — and the Big 3 he committed to this morning.

Write a short SMS with three parts, in this order:
1. What the day looked like from the outside. Two or three facts that actually matter, from the data you were given. Not a list dump — the things a chief of staff would mention. If something is overdue or slipping, lead with it.
2. His Big 3, numbered, so he can answer by number.
3. The ask: which ones landed, rate the day 1-10, and what made it that.

Rules:
- This is a text message. Keep the whole thing under 700 characters.
- Never invent a fact. Only use what you were given. If a source is empty, say nothing about it rather than saying "no emails".
- Plain sentences. No headers, no markdown, no emoji, no bullet characters.
- Do not congratulate him and do not pep-talk. State it and ask.
- If he closed nothing and had nothing due, say the day looks quiet from here and ask anyway.

Return raw JSON only.
{"text": "the full SMS"}`

export async function reviewDay(req, { context, big3, hardThing, date }) {
  const list = (big3 || []).map((b, i) => `${i + 1}. ${b.text}`).join('\n') || '(none were set today)'
  const res = await client().messages.create({
    model: REVIEW_MODEL,
    max_tokens: 1200,
    system: NIGHTLY_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        `Date: ${date}`, '',
        '## What the day looked like',
        JSON.stringify(context || {}, null, 1), '',
        '## His Big 3 from this morning',
        list,
        hardThing ? `\nThe hard thing: ${hardThing}` : '',
      ].join('\n'),
    }],
  })
  const parsed = extractJson(firstText(res))
  return parsed?.text ? String(parsed.text).slice(0, 900) : null
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

// ── sunday: plan the week ahead ─────────────────────────────────────────────

const WEEKPLAN_SYSTEM = `You are Mark's chief of staff. Sunday afternoon you sit down with him and plan the week.

He owns Absolute ADAS, a mobile ADAS calibration shop in Western Washington. You are given his goals, what last week actually looked like, what the coming week already has booked, and whatever the weekly review just concluded.

Produce a plan for the week, not a summary of it. What that means:
- A theme for the week. One sentence. What is this week FOR.
- Three outcomes for the week — the things that, if they happen, make it a good week. Same test as his daily Big 3: revenue, team, and the one only he can do. Tie them to his goals, especially whichever rung of his ladder is currently live.
- Day-by-day: what each day is for. Some days are already spoken for by jobs or events — say so and work around them. Do not invent appointments.
- What to say no to. He overcommits. Name the things that will show up this week that he should decline or defer.
- Anything on the calendar that needs preparing for BEFORE it arrives, and which day to prepare on.
- ONE thing for his wife Carrie, every week, without exception. A date night, taking dinner service off her, a morning where she sleeps in — something that costs him time and attention, not money. Name the day it happens and put it on that day too. This is not optional and it is not a filler item; if the week is slammed, it gets smaller, not skipped.

Rules:
- Ground everything in the data you were given. Never invent a job, a meeting, or a number.
- If his goals name a hard constraint (a gate he hasn't cleared, an event he has to be rested for), the week plan respects it. Do not propose work that violates his own stated rules.
- Be concrete. "Focus on sales" is not a plan. "Monday and Tuesday are phone days, 20 shops, target 12 booked" is.
- Short. He reads this on a phone Sunday afternoon.

Return raw JSON only.
{
  "theme": "one sentence",
  "outcomes": ["...", "...", "..."],
  "days": [{"day": "Monday", "focus": "...", "note": "optional constraint or prep"}],
  "for_carrie": {"what": "...", "day": "..."},
  "say_no_to": ["..."],
  "prep": ["..."]
}`

export async function planWeek(req, { goals, weekAhead, lastWeek, review, coachingNotes, today }) {
  const res = await client().messages.create({
    model: WEEKPLAN_MODEL,
    max_tokens: 3000,
    // Thinking is ON by default on Sonnet 5, and it is what pushed this call
    // past the gateway's ~38s ceiling — not the model tier. This is structured
    // synthesis over data already assembled for it, so the reasoning budget
    // buys little here and costs the whole request.
    thinking: { type: 'disabled' },
    system: WEEKPLAN_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        `Today is ${today} (Sunday).`, '',
        '## His goals', goals || '(none on file)', '',
        '## Coaching notes', coachingNotes || '(none yet)', '',
        '## What the week ahead already holds', JSON.stringify(weekAhead, null, 1), '',
        '## Last week, day by day', JSON.stringify(lastWeek || [], null, 1), '',
        '## What the weekly review just concluded', review ? JSON.stringify(review, null, 1) : '(no review — not enough data)',
      ].join('\n'),
    }],
  })
  return extractJson(firstText(res))
}

// ── thursday night: tomorrow's F3 Q ─────────────────────────────────────────

const FRIDAY_Q_SYSTEM = `You build Mark's F3 Friday bootcamp Q. He is Bugle — Site Q at Tundra Woodinville, Nantan at F3 Everett. He leads it Friday morning in the gloom and reads your draft Thursday night to get it in his head, so write it to be MEMORIZED, not referenced.

Home AO is The Bunker (Woodinville HS). Coupons available. A ~2.9 mile loop is in play. Satellites he has used: Bloomberg Hill, Rotary Community Park, Woodin Elementary, Stonehill Meadows.

Hard-won lessons from his own AARs. Follow them:
- Keep it to about THREE blocks. More stations drags it out.
- The format that works: two satellite workouts, then everyone converges at The Bunker to finish together.
- Two stops plus home, and a big readable map. PAX could not read his station codes in the dark.
- High-concept mission themes land. Mumblechatter goes quiet when the work is real.
- Grass over pavement for anything involving partner carries.

Write it in his Q Draft style: a named mission theme, WARMUP, THE THANG in blocks, MARY, and a COT prompt. The COT prompt is a real question about character or faith, not a slogan — he closes the circle with it.

Rules:
- Bodyweight and coupons only. Nothing he does not have.
- Real rep counts. "Some merkins" is not a plan.
- Vary from what he has run recently. You are given his recent Qs; do not rebuild one he just led.
- If he is inside a race taper, say so in the Q note and keep the legs light. The Q still runs, it just does not wreck him.

Return raw JSON only.
{"title": "NAME // SUBTITLE", "theme": "one or two sentences", "warmup": "...", "thang": [{"block": "name", "detail": "..."}], "mary": "...", "cot_prompt": "...", "q_note": "logistics, taper or weather note, or empty string"}`

export async function planFridayQ(req, { recentQs, raceNote, date }) {
  const recent = (recentQs || []).map(q => '- ' + q).join('\n') || '(none on file)'
  const res = await client().messages.create({
    model: WEEKPLAN_MODEL,
    max_tokens: 3000,
    // Same gateway ceiling as the week plan — Opus with thinking on took this
    // past 38s and 408'd, losing the work. Sonnet with thinking off lands
    // around 25s. The Q is well-scoped creative work against a detailed brief,
    // which is where this holds up fine.
    thinking: { type: 'disabled' },
    system: FRIDAY_Q_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        'Friday date: ' + date,
        raceNote ? '\nIMPORTANT: ' + raceNote : '',
        '',
        '## Qs he has led recently — do not repeat these',
        recent,
      ].join('\n'),
    }],
  })
  return extractJson(firstText(res))
}

export function formatFridayQ(q, date) {
  if (!q) return null
  const L = ['Q DRAFT — "' + q.title + '"', 'Friday ' + date + ' · The Bunker', '', q.theme, '',
             'WARMUP: ' + q.warmup, '', 'THE THANG:']
  for (const b of (q.thang || [])) L.push('- ' + b.block + ': ' + b.detail)
  L.push('', 'MARY: ' + q.mary, '', 'COT: ' + q.cot_prompt)
  if (q.q_note) L.push('', 'Q note: ' + q.q_note)
  return L.join('\n')
}

// ── weekly family devotional ────────────────────────────────────────────────

const DEVO_SYSTEM = `You write the Fowler family's weekly devotional. Mark leads it. It is for the two kids still at home:

- Kyleighanne, 14 — early high school. Identity, friendships, comparison, wanting independence and still wanting to be known.
- Wyatt, 12 — middle school. Fairness, courage, belonging, big feelings he does not always have words for.

The four older kids are grown or out. Do not write for them.

Produce ONE devotional for the week that the family reads together, then give Mark ways to keep it alive during the week.

What it needs:
- A short passage. Give the reference and quote it plainly. Pick something concrete — a story, a moment, a real instruction — over an abstract verse. Nothing longer than a few verses.
- The main read: five or six sentences Mark can read out loud at the table. Written for a twelve year old to follow and a fourteen year old not to roll her eyes at. No churchy filler, no "as we journey together."
- One angle for Kyleighanne and one for Wyatt. Same passage, different door in. Hers should respect that she is nearly grown and thinking hard about who she is. His should be concrete and often physical — what would you DO.
- Three conversation prompts for the week: one for the morning (short, before school, thirty seconds), one for midday or the drive (a real question, not a quiz), one for bedtime (quieter, more honest, the kind of question that gets a real answer in the dark).
- One thing the family can DO together this week that makes the passage real. Small. Achievable on a weeknight by a family with a shop to run.

Rules:
- Plain language. Mark's test is whether a guy in a blue shirt with grease on his hands would say it out loud.
- Never talk down to them. Twelve and fourteen can handle a real idea.
- No guilt as a motivator. No "you should feel."
- Do not repeat a passage from the recent list you are given.

Return raw JSON only.
{"theme": "...", "passage_ref": "...", "passage_text": "...", "main_read": "...", "for_kyleighanne": "...", "for_wyatt": "...", "prompts": {"morning": "...", "midday": "...", "bedtime": "..."}, "do_together": "..."}`

export async function planFamilyDevotional(req, { recentPassages, weekOf }) {
  const recent = (recentPassages || []).join(', ') || '(none yet)'
  const res = await client().messages.create({
    model: WEEKPLAN_MODEL,
    max_tokens: 3000,
    thinking: { type: 'disabled' },   // same gateway ceiling as the week plan
    system: DEVO_SYSTEM,
    messages: [{
      role: 'user',
      content: 'Week of ' + weekOf + '.\n\nPassages already used recently, do not reuse: ' + recent,
    }],
  })
  return extractJson(firstText(res))
}

export function formatDevotional(d, weekOf) {
  if (!d) return null
  return [
    'Family devotional — week of ' + weekOf,
    d.theme,
    '',
    d.passage_ref,
    '"' + d.passage_text + '"',
    '',
    d.main_read,
    '',
    'For Kyleighanne (14): ' + d.for_kyleighanne,
    'For Wyatt (12): ' + d.for_wyatt,
    '',
    'Talk about it —',
    '  Morning: ' + d.prompts.morning,
    '  Midday/drive: ' + d.prompts.midday,
    '  Bedtime: ' + d.prompts.bedtime,
    '',
    'Do together this week: ' + d.do_together,
  ].join('\n')
}

// ── evening: close the day ──────────────────────────────────────────────────

const CLOSE_SYSTEM = `Mark has just told you how his day went. You write the last thing he reads before bed.

One or two sentences. It closes the day and it is honest about the day he actually had — you are given his rating, what landed, what didn't, and his own words.

How to pitch it:
- A good day: name the specific thing he did, then let him put it down. Do not inflate it.
- A rough day: do not spin it and do not coach him. Tomorrow is a separate day and he knows what went wrong; say something true that lets him stop carrying it tonight.
- A middling day: those are most days, and most days counting is the point.

Hard rules:
- Never start with "Remember" or "Don't forget".
- No exclamation marks. No emoji. No hype.
- Do not restate his numbers back at him — he just gave them to you.
- Do not assign him anything or ask a question. The day is over.
- Speak to him directly, as someone who watched the day.
- Steady and true beats loud. The test: would a guy in a blue shirt with grease on his hands read this and feel like a person said it.

Return raw JSON only.
{"close": "..."}`

export async function closeDay(req, { day }) {
  const b3 = (day.big3 || []).map(x => (x.done ? '[done] ' : '[not done] ') + x.text).join('; ')
  const res = await client().messages.create({
    model: PARSE_MODEL,   // inline in the Twilio webhook — has to be fast
    max_tokens: 400,
    system: CLOSE_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        'Rating: ' + (day.rating ?? 'not given') + ' out of 10',
        'Big 3: ' + (b3 || 'none were set'),
        day.hard_thing ? 'Hard thing: ' + (day.hard_thing.done ? 'done' : 'not done') + ' — ' + day.hard_thing.text : '',
        day.win ? 'What worked: ' + day.win : '',
        day.drag ? 'What got in the way: ' + day.drag : '',
        '',
        'His own words: "' + (day.raw_reply || '') + '"',
      ].filter(Boolean).join('\n'),
    }],
  })
  const parsed = extractJson(firstText(res))
  return parsed?.close ? String(parsed.close).slice(0, 400) : null
}

export const COACH_MODELS = { coach: COACH_MODEL, parse: PARSE_MODEL }
