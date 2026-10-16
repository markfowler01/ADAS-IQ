// 🧭 "How I work" — the onboarding personality step (Mark 2026-10-16: "a
// personality test built into this onboarding… their version a little more
// simpler and mine very complex and deep… we can even create our own").
//
// Three parts, ~10 minutes on a phone:
//   1. Big Five — the IPIP 50-item Big-Five markers (Goldberg; public domain,
//      free for any use). The four mood items of the stability scale are
//      swapped for IPIP work-stress items so nothing here reads as a mental
//      health screen. Scored 0–100 per trait (raw scale, not a percentile).
//   2. Shop scenarios — our own 10 questions about the calibration job
//      (procedure discipline, talking to shops, learning, ownership, pace).
//      Not a validated test; it's coaching material.
//   3. What drives you — pick the 2 of 9 statements that fit best
//      (Enneagram-style self-pick; free; the person never sees type names).
//
// Rules: given after hire, used for coaching and check-ins only, NEVER for
// hiring, firing, pay or promotion. The person sees a short, strengths-only
// summary of their own results. Mark alone sees the scores and the deep
// report (stored in AppConfig `mpp:<memberId>`, same private prefix family
// as Pay & Benefits).

export const SCALE = ['Very inaccurate', 'Moderately inaccurate', 'Neither', 'Moderately accurate', 'Very accurate']

// [id, text, scale, keyed(+1/-1)]  E=Extraversion A=Agreeableness C=Conscientiousness S=Steadiness O=Openness
const BIG5 = [
  ['e1', 'Am the life of the party.', 'E', 1], ['a1', 'Feel little concern for others.', 'A', -1], ['c1', 'Am always prepared.', 'C', 1], ['s1', 'Get stressed out easily.', 'S', -1], ['o1', 'Have a rich vocabulary.', 'O', 1],
  ['e2', "Don't talk a lot.", 'E', -1], ['a2', 'Am interested in people.', 'A', 1], ['c2', 'Leave my belongings around.', 'C', -1], ['s2', 'Am relaxed most of the time.', 'S', 1], ['o2', 'Have difficulty understanding abstract ideas.', 'O', -1],
  ['e3', 'Feel comfortable around people.', 'E', 1], ['a3', 'Insult people.', 'A', -1], ['c3', 'Pay attention to details.', 'C', 1], ['s3', 'Worry about things.', 'S', -1], ['o3', 'Have a vivid imagination.', 'O', 1],
  ['e4', 'Keep in the background.', 'E', -1], ['a4', "Sympathize with others' feelings.", 'A', 1], ['c4', 'Make a mess of things.', 'C', -1], ['s4', 'Remain calm under pressure.', 'S', 1], ['o4', 'Am not interested in abstract ideas.', 'O', -1],
  ['e5', 'Start conversations.', 'E', 1], ['a5', "Am not interested in other people's problems.", 'A', -1], ['c5', 'Get chores done right away.', 'C', 1], ['s5', 'Am easily disturbed.', 'S', -1], ['o5', 'Have excellent ideas.', 'O', 1],
  ['e6', 'Have little to say.', 'E', -1], ['a6', 'Have a soft heart.', 'A', 1], ['c6', 'Often forget to put things back in their proper place.', 'C', -1], ['s6', 'Get upset easily.', 'S', -1], ['o6', 'Do not have a good imagination.', 'O', -1],
  ['e7', 'Talk to a lot of different people at parties.', 'E', 1], ['a7', 'Am not really interested in others.', 'A', -1], ['c7', 'Like order.', 'C', 1], ['s7', 'Panic easily.', 'S', -1], ['o7', 'Am quick to understand things.', 'O', 1],
  ['e8', "Don't like to draw attention to myself.", 'E', -1], ['a8', 'Take time out for others.', 'A', 1], ['c8', 'Shirk my duties.', 'C', -1], ['s8', 'Become overwhelmed by events.', 'S', -1], ['o8', 'Use difficult words.', 'O', 1],
  ['e9', "Don't mind being the center of attention.", 'E', 1], ['a9', "Feel others' emotions.", 'A', 1], ['c9', 'Follow a schedule.', 'C', 1], ['s9', 'Get irritated easily.', 'S', -1], ['o9', 'Spend time reflecting on things.', 'O', 1],
  ['e10', 'Am quiet around strangers.', 'E', -1], ['a10', 'Make people feel at ease.', 'A', 1], ['c10', 'Am exacting in my work.', 'C', 1], ['s10', "Feel that I'm unable to deal with things.", 'S', -1], ['o10', 'Am full of ideas.', 'O', 1],
]
// Our own, about the job. P=procedure Cu=customer L=learning Ow=ownership Pa=pace
const SHOP = [
  ['p1', 'If the OEM procedure has a step I think is pointless, I still do it.', 'P', 1],
  ['p2', "I'd rather redo a calibration than send out a car I'm not sure about.", 'P', 1],
  ['p3', 'Taking every required photo on a job feels like a waste of time.', 'P', -1],
  ['cu1', "I'm comfortable explaining to a shop manager why a calibration is needed.", 'Cu', 1],
  ['cu2', 'Walking into a body shop where I know nobody wears me out.', 'Cu', -1],
  ['l1', 'I like figuring out a new scan tool or system on my own.', 'L', 1],
  ['l2', 'When a new tool or procedure comes out, I want to learn it right away.', 'L', 1],
  ['ow1', 'If I make a mistake on a job, I tell Mark right away.', 'Ow', 1],
  ['ow2', "When the van is low on something, I restock it without being asked.", 'Ow', 1],
  ['pa1', "I stay calm when I'm behind schedule and a shop is waiting on me.", 'Pa', 1],
]
// Enneagram-style motivations (self-pick 2). Type names only in Mark's view.
export const DRIVES = [
  { t: 1, text: 'I want things done the right way, every time.', name: 'Type 1 · The Reformer' },
  { t: 2, text: 'I want to help people and be someone they can count on.', name: 'Type 2 · The Helper' },
  { t: 3, text: 'I want to win, hit goals, and be known for results.', name: 'Type 3 · The Achiever' },
  { t: 4, text: 'I want my work to mean something and feel like my own.', name: 'Type 4 · The Individualist' },
  { t: 5, text: 'I want to understand how things really work.', name: 'Type 5 · The Investigator' },
  { t: 6, text: 'I want security and a team I can trust.', name: 'Type 6 · The Loyalist' },
  { t: 7, text: 'I want variety, new experiences, and to keep things fun.', name: 'Type 7 · The Enthusiast' },
  { t: 8, text: 'I want to take charge and go after big challenges.', name: 'Type 8 · The Challenger' },
  { t: 9, text: 'I want things calm and everyone getting along.', name: 'Type 9 · The Peacemaker' },
]
export const TRAITS = {
  E: 'Outgoing energy', A: 'Team warmth', C: 'Discipline & detail', S: 'Steadiness under pressure', O: 'Curiosity & ideas',
  P: 'Procedure discipline', Cu: 'Talking to shops', L: 'Learning drive', Ow: 'Ownership', Pa: 'Calm when behind',
}

// Questions as the portal shows them: Big Five and shop items interleaved, fixed order.
export function questions() {
  const q = BIG5.map(([id, text]) => ({ id, text: 'I ' + text.charAt(0).toLowerCase() + text.slice(1) }))
  SHOP.forEach(([id, text], i) => q.splice(5 + i * 5, 0, { id, text }))
  return { items: q, scale: SCALE, drives: DRIVES.map(d => ({ t: d.t, text: d.text })) }
}

export function score(answers = {}, drives = []) {
  const all = [...BIG5, ...SHOP]
  const missing = all.filter(([id]) => ![1, 2, 3, 4, 5].includes(Number(answers[id]))).map(([id]) => id)
  if (missing.length) throw new Error(`Please answer every question (${missing.length} left).`)
  const sums = {}, counts = {}
  for (const [id, , k, key] of all) { const v = Number(answers[id]); sums[k] = (sums[k] || 0) + (key > 0 ? v : 6 - v); counts[k] = (counts[k] || 0) + 1 }
  const scores = {}
  for (const k of Object.keys(sums)) scores[k] = Math.round(((sums[k] / counts[k]) - 1) / 4 * 100)
  const picks = [...new Set((drives || []).map(Number))].filter(t => t >= 1 && t <= 9).slice(0, 2)
  if (picks.length < 1) throw new Error('Pick at least one "what drives you" statement.')
  return { scores, drives: picks }
}

const band = v => v >= 65 ? 'high' : v <= 35 ? 'low' : 'mid'

// ── The employee's version: short, strengths only ─────────────────────
const STRENGTH = {
  E: 'You bring energy to a room and get people talking.',
  A: 'People feel at ease around you. You make a team work.',
  C: "You're prepared, careful and finish what you start.",
  S: 'You keep your cool when the day goes sideways.',
  O: 'You pick up new ideas fast and think a step ahead.',
  P: "You do the job the right way even when nobody's watching.",
  Cu: "You're comfortable explaining the why to a shop.",
  L: 'You like learning the next tool or system.',
  Ow: 'You own your work and speak up early.',
  Pa: 'You stay steady when the schedule is tight.',
}
const QUIET = {
  E: 'You do your best thinking heads-down, and you listen before you talk.',
  A: "You're direct. People always know where they stand with you.",
  C: "You're flexible and adapt when plans change.",
  S: 'You care a lot about getting it right, and you feel it when things slip.',
  O: 'You trust what works and stick with proven methods.',
}
export function simpleSummary({ scores, drives }) {
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const strengths = ranked.slice(0, 3).map(([k]) => ({ k, title: TRAITS[k], text: STRENGTH[k] }))
  const lowBig = ['E', 'A', 'C', 'O', 'S'].filter(k => band(scores[k]) === 'low').slice(0, 1)
  const style = lowBig.length ? QUIET[lowBig[0]] : 'You bring a balanced mix: you can flex to what the day needs.'
  const drive = DRIVES.find(d => d.t === drives[0])
  return {
    headline: `Your top strength: ${TRAITS[ranked[0][0]].toLowerCase()}`,
    strengths,
    style,
    drive: drive ? `What drives you: "${drive.text}"` : '',
    note: "There are no good or bad results here. This helps Mark know how you work best, and it's never used for pay or job decisions.",
  }
}

// ── Mark's version: every score, plus how to lead this person ─────────
const DEEP = {
  E: { high: ['Energized by people. Natural at shop drop-ins and first visits.', 'Give them the relationship side: new-shop intros, ride-alongs with Kat on sales stops.', 'Watch for: rushing the paperwork to get back to people.'],
       mid: ['Comfortable with people without needing the spotlight.', 'Can do both solo route days and shop-facing work.', ''],
       low: ['Recharges alone. Quiet in groups, not unfriendly.', 'Give them heads-down route days; prep them before first visits; ask for input 1:1, not in the morning meeting.', 'Watch for: going silent when something is wrong. Ask directly.'] },
  A: { high: ['Warm, cooperative, avoids friction.', 'Great with difficult shop staff. Praise in public, correct in private.', 'Watch for: saying yes to a shop when the answer should be no (free calibrations, skipped steps).'],
       mid: ['Cooperative but will push back when it matters.', 'Straight talk works.', ''],
       low: ['Blunt and skeptical. Says what they think.', 'Be direct and give the reason; skip the sugar-coating.', 'Watch for: tone with shop staff. Coach on how a "no" sounds.'] },
  C: { high: ['Organized, careful, follows through. The calibration-tech trait.', 'Hand them the SOPs and the QC role; they will hold the line on photos and post-scans.', 'Watch for: slowing down to perfect things. Set the time box.'],
       mid: ['Reliable most of the time; needs some structure.', 'Checklists in the app carry them. Spot-check the photo set early on.', ''],
       low: ['Flexible and fast, less naturally organized.', 'Lean on the app gates (8 photos, post-scan), short checklists, and a weekly van check.', 'Watch for: skipped steps and a messy van. Inspect early, praise improvement.'] },
  S: { high: ['Calm under pressure. Steady on bad days.', 'Good for the tough jobs and angry shops.', 'Watch for: under-reporting problems because they "have it handled".'],
       mid: ['Handles normal stress fine; a pile-up will show.', 'Check in after rough days.', ''],
       low: ['Feels pressure hard, and cares a lot.', 'Give clear plans and early warning on schedule changes; more check-ins in the first 90 days.', 'Watch for: stress on overloaded days. Keep the schedule realistic.'] },
  O: { high: ['Curious, quick, full of ideas.', 'Give them new tools, new makes, process improvements; ask what they would change.', 'Watch for: getting bored with repeat work, or freelancing on a procedure.'],
       mid: ['Open to new ideas, grounded in what works.', 'Teach the why behind changes.', ''],
       low: ['Practical. Likes proven methods.', 'Show the procedure step by step; introduce change slowly with the reason.', 'Watch for: resisting new tools. Pair them with a win.'] },
}
const DRIVE_LEAD = {
  1: 'Lead with quality and doing it right. Give clear standards; never ask them to cut a corner. Under stress: critical of self and others.',
  2: 'Lead with appreciation. Tell them how they helped. Under stress: over-commits to shops, resentful when not thanked.',
  3: 'Lead with goals and scoreboards (the revenue bonus fits them). Recognize wins. Under stress: chases speed over quality.',
  4: 'Lead with meaning: why calibrations keep families safe. Give them ownership of something. Under stress: withdraws, feels unseen.',
  5: 'Lead with information. Give the manuals and time to learn. Under stress: detaches, hoards knowledge.',
  6: 'Lead with consistency and a plan. Explain changes early. Under stress: worst-case thinking, needs reassurance.',
  7: 'Lead with variety and something new. Keep it fun. Under stress: scattered, avoids the boring parts (paperwork, photos).',
  8: 'Lead with respect and directness. Give them a challenge and room. Under stress: pushes back hard, takes control.',
  9: 'Lead with calm and inclusion. Ask their opinion directly. Under stress: goes along to avoid conflict, procrastinates.',
}
export function deepReport({ scores, drives }) {
  const traits = ['C', 'S', 'A', 'E', 'O'].map(k => { const b = band(scores[k]); const [what, how, watch] = DEEP[k][b]; return { k, name: TRAITS[k], score: scores[k], band: b, what, how, watch } })
  const shop = ['P', 'Cu', 'L', 'Ow', 'Pa'].map(k => ({ k, name: TRAITS[k], score: scores[k], band: band(scores[k]) }))
  const motivation = drives.map(t => ({ t, name: DRIVES.find(d => d.t === t)?.name, statement: DRIVES.find(d => d.t === t)?.text, lead: DRIVE_LEAD[t] }))
  const fit = []
  if (scores.C >= 60 && scores.P >= 60) fit.push('Strong field calibration tech: holds procedure and detail.')
  if (scores.E >= 60 && scores.Cu >= 60) fit.push('Shop-facing: good for new-shop visits and explaining calibrations.')
  if (scores.O >= 60 && scores.L >= 60) fit.push('Trainer / new-tool lead: learns fast and likes new systems.')
  if (scores.C >= 60 && scores.E < 45) fit.push('Back-office or QC: careful, happy heads-down.')
  if (!fit.length) fit.push('Balanced profile: no strong pull; watch where they light up in the first 90 days.')
  const risks = traits.filter(t => t.watch).map(t => t.watch)
  if (scores.P < 45) risks.push('Procedure discipline is low for this job: check photo sets and post-scans on every job for the first month.')
  if (scores.Ow < 45) risks.push("May not volunteer problems: ask \"what went wrong today?\" not \"everything good?\"")
  const talk = {
    '90d': [
      `Start with a strength: ${TRAITS[Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]].toLowerCase()}.`,
      motivation[0] ? `Ask about what drives them ("${motivation[0].statement}"). Is the job giving them that?` : '',
      scores.P < 55 ? 'Walk through one recent job photo set together.' : 'Ask which procedure step feels pointless, and explain the why.',
      scores.S < 45 ? "Ask what's been the most stressful part so far, and what would help." : 'Ask what they would change about how we run the day.',
    ].filter(Boolean),
    '6mo': [
      'Look at their numbers together (jobs, comebacks, revenue bonus progress).',
      scores.L >= 60 ? 'Offer the next skill: a new make, programming, or training others.' : 'Pick one skill to grow over the next 6 months.',
      motivation[1] ? `Second driver: "${motivation[1].statement}". Check that it's being met.` : 'Ask where they want to be in a year.',
    ],
  }
  return { traits, shop, motivation, fit, risks, talk }
}

// Optional AI narrative for Mark (only scores + picks are sent, no answers, no name).
export async function aiNarrative({ scores, drives, title }) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { tracked } = await import('./spend.js')
  const client = tracked(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }))
  const data = { role: title || 'ADAS calibration technician', scores_0_to_100: Object.fromEntries(Object.entries(scores).map(([k, v]) => [TRAITS[k], v])), motivation_self_picks: drives.map(t => DRIVES.find(d => d.t === t)?.name) }
  const res = await client.messages.create({
    model: 'claude-sonnet-5-5', max_tokens: 1400,
    system: 'You write a private leadership brief for Mark Fowler, owner of a small mobile ADAS calibration company in Washington. You get one employee\'s Big Five scores (IPIP, 0-100 raw, not percentiles), scores on 5 job-specific scales, and their self-picked Enneagram-style motivations. Write plain English, short sentences, no em dashes, no jargon. Sections with these exact headings: "Who they are at work", "How to lead them", "How to give feedback", "What motivates them", "Watch for", "Best use on the team". 2-4 bullets each. Be specific to a calibration tech who drives a van to body shops, follows OEM procedures, takes photos, and talks to shop managers. Do not diagnose or mention mental health. This is for coaching only, never for pay, hiring or firing decisions.',
    messages: [{ role: 'user', content: JSON.stringify(data) }],
  }, { timeout: 25000 })
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
}
