// 🤝 Founding Partner series (Mark 2026-10-17: "build it" on ~/Downloads/marketing-plan.md).
//
// Eight weekly owner-to-owner posts aimed at INDEPENDENT ADAS BUSINESS OWNERS (not collision
// shops), floating the Absolute ADAS Partner Network idea and ending in a founding-pilot
// invitation. Decisions Mark made:
//   • AUTO-APPROVED — queued Monday, heads-up card with kill + pause links, posts Tuesday 7:45 AM PT
//   • LINKEDIN ONLY (his personal profile). Not the company Facebook page: that audience is his
//     collision-shop customers. Thursday he gets a ready-to-paste version for owner FB groups.
//   • Week 1 = Tue 2026-10-20. Runs 8 weeks, then stops (no cycling).
// Around the posts: Wednesday "5 owner introductions" nudge + intro-drafting form (Mark picks
// every name — these are other ADAS companies, so never auto-generated and never fed into any
// marketing list), Friday signed metrics form, first-Monday founder-video reminder.
//
// Every post body passes partnerClaimIssues() — the plan's guardrails in code — at queue time.
import { enqueueDraft, buildSignedActionUrl } from './captureApprovalQueue.js'
import { getVal, setVal } from './vanDatastore.js'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from './cliq.js'

const META_KEY = 'partner_series'          // { active, done: { [tuesday]: { n, id } }, nudges: { [key]: iso } }
export const METRICS_KEY = 'partner_metrics' // { weeks: { [friday]: { conversations, fit, calls, inquiries, prospects, notes, saved_at } } }
export const START_TUESDAY = '2026-10-20'
const POST_HOUR = 7, POST_MINUTE = 45
const PUBLIC_BASE = process.env.API_PUBLIC_BASE || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'

// LinkedIn bodies are Mark's plan text, word for word. `fb` is the conversational version for
// owner Facebook groups (same facts, no new claims) that Mark posts by hand on Thursdays.
export const POSTS = [
  {
    headline: 'The idea',
    body: `I've been thinking about the future of the independent ADAS company.

A lot of great technicians have built excellent businesses one shop relationship at a time. They've invested in equipment, vans, OEM software, and countless late nights.

Meanwhile, the larger organizations keep getting bigger.

I don't think the only answer is to sell out or try to become a national company by yourself.

What if independent ADAS businesses could stay independently owned and still have access to better systems and support?

That's an idea we're exploring at Absolute ADAS. I'd love to hear from other owners: what's the hardest part of running the business that isn't actually calibrating cars?`,
    fb: `Question for the independent ADAS owners in here.

A lot of us built our businesses one shop relationship at a time. Equipment, vans, OEM software, a lot of late nights. Meanwhile the big outfits keep getting bigger.

I don't think the only options are selling out or trying to go national on your own. What if independent ADAS businesses could stay independently owned and still get better systems and support?

That's something we're exploring at Absolute ADAS. So I'm curious: what's the hardest part of running your business that isn't actually calibrating cars?`,
  },
  {
    headline: 'Keep what you built',
    body: `You spent years building your customer relationships. Why should joining a network mean giving them up?

Here's one principle I'm putting into the Absolute ADAS Partner Network concept: the business you already built stays yours.

Your company. Your tools. Your customers. Your existing job margins.

We're exploring a model where Absolute earns its keep through useful software, billing services, and additional work we help create, not a royalty on your existing customer revenue.

We're still building and testing the model. If you own an independent ADAS business, I'd value your perspective.`,
    fb: `Something I keep coming back to. You spent years building your customer relationships. Joining any kind of network shouldn't mean handing them over.

One principle in the Absolute ADAS Partner Network idea we're working on: what you built stays yours. Your company, your tools, your customers, your margins on the work you already do.

The model we're exploring has Absolute earning its keep through software, billing help, and new work we help create. Not a cut of your existing customer revenue.

We're still building and testing it. If you own an independent ADAS business, I'd like your honest take.`,
  },
  {
    headline: 'The hidden administrative burden',
    body: `The hardest part of owning a mobile ADAS company isn't always the calibration.

It's the estimate, the invoice, the documentation, the follow-up, the unanswered phone call, and the payment you have to chase while you're under the next car.

At Absolute, we've already built our own software and billing operation. That got me thinking: what if those systems could help other independent operators too?

What administrative task would you take off your plate tomorrow if you could?`,
    fb: `Be honest. How much of your week is actually calibrating cars?

The rest is the estimate, the invoice, the documentation, the follow-up, the missed call, and the payment you're chasing while you're under the next car.

At Absolute we already built our own software and billing operation. That got me thinking: could those systems help other independent operators too?

If you could hand off one admin task tomorrow, which one would it be?`,
  },
  {
    headline: "Big doesn't have to mean corporate",
    body: `A large company can have powerful systems. A small independent shop can have incredibly strong relationships and technical expertise.

Those strengths aren't mutually exclusive.

I'm exploring a network of independent ADAS businesses where owners stay independent while sharing selected infrastructure and opportunities.

No promise that we've solved every detail. The first job is to make sure the operators genuinely make more money after participating.

What would a network have to provide for you to consider joining?`,
    fb: `Big companies have powerful systems. Small independent shops have strong relationships and real technical skill. Why can't you have both?

I'm exploring a network of independent ADAS businesses where owners stay independent and share some infrastructure and opportunities.

I haven't solved every detail. The first job is making sure the operators actually make more money by being part of it.

What would a network have to give you before you'd even think about joining?`,
  },
  {
    headline: 'Quality before scale',
    body: `Before we talk about dozens of independent ADAS partners, let's talk about one thing: doing the work correctly.

Calibration procedures, accurate documentation, OEM requirements, good equipment setup, and honest reporting are not optional.

If Absolute builds a partner network, technical quality has to be the standard that holds it together.

What would you want to see in a credible independent ADAS quality program?`,
    fb: `Before anybody talks about growing an ADAS network, let's talk about doing the work right.

Following the calibration procedure, accurate documentation, OEM requirements, a good equipment setup, honest reporting. None of that is optional.

If Absolute builds a partner network, technical quality has to be the thing that holds it together.

What would you want to see in a quality program before you trusted it?`,
  },
  {
    headline: "Why we're starting small",
    body: `I'm not trying to sign up 100 ADAS companies tomorrow.

The first goal is to find one great independent owner, prove the software and billing processes work for both businesses, and measure whether the partnership actually creates value.

If it works, we'll build on it. If something isn't right, we'll fix it before scaling.

I think that's how you build something that lasts.`,
    fb: `I'm not trying to sign up 100 ADAS companies tomorrow.

The first goal is finding one great independent owner, proving the software and billing processes work for both businesses, and measuring whether the partnership actually creates value.

If it works, we build on it. If something's off, we fix it before going any bigger.

That's how I think you build something that lasts.`,
  },
  {
    headline: 'The owner question',
    body: `If you've built your own ADAS business, what would make you trust a network run by another ADAS company?

That's the question I'm spending time on.

I think the answer starts with transparent fees, clear customer ownership, confidentiality, fair exit terms, and proven financial benefit.

I'm interested in building a model that's good for independent owners, not just good for the company running the network.

I'd love to hear where you'd draw the line.`,
    fb: `Question for the owners in here. If you built your own ADAS business, what would it take for you to trust a network run by another ADAS company?

That's what I'm working through right now. I think it starts with transparent fees, clear customer ownership, confidentiality, fair exit terms, and proof it actually pays off for you.

I want a model that's good for independent owners, not just for whoever runs the network.

Where would you draw the line?`,
  },
  {
    headline: 'Founding invitation',
    body: `We're exploring a small founding-partner pilot at Absolute ADAS.

I'm looking to talk with established independent calibration and diagnostics owners who want to stay independent but are interested in better software, billing support, technical collaboration, and potential new work.

This is a conversation, not an ask to sell your company.

If that sounds worth talking about, send me a message. I'd like to hear what you've built and where you want to take it.`,
    fb: `We're exploring a small founding-partner pilot at Absolute ADAS.

I want to talk with established independent calibration and diagnostics owners who want to stay independent but are interested in better software, billing support, working together on the technical side, and possibly new work.

This is a conversation, not an ask to sell your company.

If that sounds worth a talk, send me a message. I'd like to hear what you built and where you want to take it.`,
  },
]

// The plan's guardrails, in code: no national coverage, signed partners, guaranteed
// savings/earnings, approved certification or exclusive contracts that don't exist; no
// coordinated pricing, territory division, hiring restrictions or boycotts. Plus brand voice.
const CLAIM_RULES = [
  [/\bnationwide\b|\bnational (coverage|network|footprint|presence)\b/i, 'national coverage claim'],
  [/\b(signed|our|current|existing) partners\b|\bpartners (have|already) (joined|signed)\b/i, 'claims signed partners'],
  [/\bguarantee/i, 'guaranteed savings/earnings'],
  [/\bcertif(ied|ication)\b/i, 'certification claim'],
  [/\bexclusive (contract|deal|agreement|partner|rights|territor|arrangement)|\bexclusively (with|for|through)\b|\bexclusivity\b/i, 'exclusive contract claim'],
  [/\b(price|pricing) (agreement|floor|minimum|coordination|together)\b|\bset (our|your|the same) prices?\b/i, 'coordinated pricing'],
  [/\bterritor(y|ies)\b/i, 'territory division'],
  [/\bno[- ]?poach|\bnon[- ]?solicit|\bnot hire each other|\bwon'?t hire\b/i, 'hiring restriction'],
  [/\bboycott/i, 'boycott'],
  [/—/, 'em dash (brand voice)'],
  [/!/, 'exclamation mark (brand voice)'],
]
export function partnerClaimIssues(text) {
  return CLAIM_RULES.filter(([re]) => re.test(String(text || ''))).map(([, why]) => why)
}

const ptDateStr = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
const ptHour = (d = new Date()) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(d)) % 24
const weekdayOf = dateStr => new Date(dateStr + 'T12:00:00Z').getUTCDay()
const addDays = (dateStr, n) => new Date(Date.parse(dateStr + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)

/** Week index (0-7) for a Tuesday, or -1 outside the series. */
export function weekIndexFor(tuesday) {
  const diff = Math.round((Date.parse(tuesday + 'T12:00:00Z') - Date.parse(START_TUESDAY + 'T12:00:00Z')) / 86400000)
  if (diff < 0 || diff % 7 !== 0) return -1
  const n = diff / 7
  return n < POSTS.length ? n : -1
}
/** The series Tuesday for any day of that Mon-Sun week. */
const tuesdayOfWeek = dateStr => addDays(dateStr, 2 - (weekdayOf(dateStr) || 7))

// /partners is live (2026-10-17, apply form → Recruiting 🤝 Partners board, ?src counted).
// Mark's post text stays verbatim; the link rides in the first comment.
const partnersComment = n => `For independent ADAS owners who want the details, here's what we're exploring: absoluteadas.com/partners?src=li-partner-w${n + 1}`

/** Signed links (same HMAC as the approval cards, 14-day TTL). */
function signedLink(path, id, action) {
  const u = new URL(buildSignedActionUrl(PUBLIC_BASE, id, action))
  return `${PUBLIC_BASE}/api/capture-calc/${path}?id=${encodeURIComponent(id)}&t=${u.searchParams.get('t')}&sig=${u.searchParams.get('sig')}`
}

async function readMeta(req) {
  return (await getVal(req, META_KEY)) || { active: true, done: {}, nudges: {} }
}

export async function partnerStatus(req) {
  const meta = await readMeta(req)
  return { ...meta, posts: POSTS.length, start: START_TUESDAY, schedule: 'LinkedIn Tue 7:45 AM PT, auto-approved' }
}
export async function setPartnerActive(req, active) {
  const meta = await readMeta(req)
  const next = { ...meta, active: Boolean(active), toggled_at: new Date().toISOString() }
  await setVal(req, META_KEY, next)
  return next
}

/** Queue the LinkedIn post for `tuesday` (auto-approved) + heads-up card. Once per Tuesday. */
async function queueWeek(req, meta, tuesday, { dry }) {
  const n = weekIndexFor(tuesday)
  if (n < 0) return { skipped: true, reason: 'outside the 8-week series' }
  if (meta.done?.[tuesday]) return { skipped: true, reason: 'already queued', id: meta.done[tuesday].id }
  const post = POSTS[n]
  const issues = partnerClaimIssues(post.body)
  if (issues.length) {
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🚫 Founding Partner week ${n + 1} NOT queued: guardrail check flagged ${issues.join(', ')}. Nothing posted.`).catch(() => {})
    return { skipped: true, reason: `guardrail: ${issues.join(', ')}` }
  }
  const { isMarketingPaused } = await import('./marketingKillSwitch.js')
  if (await isMarketingPaused(req, 'social')) return { skipped: true, reason: 'marketing_paused (social)' }
  const { ptIso } = await import('./guideSeries.js')
  let when = ptIso(tuesday, POST_HOUR, POST_MINUTE)
  if (Date.parse(when) < Date.now() + 10 * 60000) when = new Date(Date.now() + 10 * 60000).toISOString()
  if (dry) return { dry: true, tuesday, n: n + 1, headline: post.headline, scheduled_for: when }

  const entry = await enqueueDraft(req, {
    status: 'approved', channel: 'linkedin_personal', category: 'partner_series',
    headline: `Founding Partner ${n + 1}/8: ${post.headline}`, body: post.body,
    scheduled_for: when, meta: { partner_n: n + 1, first_comment: partnersComment(n) },
  })
  // Mutate the shared meta so later nudges in this same tick don't save over the done marker.
  meta.done = { ...(meta.done || {}), [tuesday]: { n: n + 1, id: entry.id, at: new Date().toISOString() } }
  await setVal(req, META_KEY, meta)
  const kill = buildSignedActionUrl(PUBLIC_BASE, entry.id, 'kill')
  const edit = buildSignedActionUrl(PUBLIC_BASE, entry.id, 'edit')
  const pause = signedLink('partner-series/pause', 'partner-series', 'partner_pause')
  await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, [
    `🤝 *Founding Partner series, week ${n + 1} of 8* posts ${tuesday === ptDateStr() ? 'today' : 'tomorrow'} 7:45 AM on your LinkedIn (auto-approved)`,
    `*${post.headline}*`, '', post.body, '',
    `💬 First comment: ${partnersComment(n)}`, '',
    `✏️ Edit: ${edit}`, `❌ Kill this post: ${kill}`, `⏸ Pause the whole series: ${pause}`,
  ].join('\n')).catch(() => {})
  return { queued: true, tuesday, n: n + 1, id: entry.id, scheduled_for: when }
}

/** Fire a once-per-key Cliq nudge. */
async function nudgeOnce(req, meta, key, text, { dry }) {
  if (meta.nudges?.[key]) return { skipped: true, reason: `${key} already sent` }
  if (dry) return { dry: true, nudge: key, text }
  await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, text)
  meta.nudges = { ...(meta.nudges || {}), [key]: new Date().toISOString() }
  await setVal(req, META_KEY, meta)
  return { sent: key }
}

/**
 * Hourly tick (safety-net cron). Everything is idempotent per day/key.
 *   Mon 9 AM-8 PM  queue Tuesday's post + heads-up   (Tue 5-7 AM fallback if Monday missed)
 *   Mon (1st of month) 8 AM-3 PM  founder video reminder
 *   Wed 8 AM-3 PM  5 owner introductions nudge + intro form
 *   Thu 9 AM-3 PM  Facebook-groups version, ready to paste
 *   Fri 3-7 PM     weekly numbers form (signed)
 */
export async function partnerSeriesTick(req, { dateStr = ptDateStr(), hour = ptHour(), dry = false } = {}) {
  const meta = await readMeta(req)
  if (meta.active === false) return { skipped: true, reason: 'series paused' }
  const wd = weekdayOf(dateStr)
  const tuesday = tuesdayOfWeek(dateStr)
  const n = weekIndexFor(tuesday)
  const out = []

  if (wd === 1 && hour >= 9 && hour <= 20) out.push(await queueWeek(req, meta, tuesday, { dry }))
  if (wd === 2 && hour >= 5 && hour <= 7) out.push(await queueWeek(req, meta, tuesday, { dry }))
  if (n < 0) return { skipped: true, reason: 'outside the 8-week series', results: out }
  const post = POSTS[n]

  if (wd === 1 && Number(dateStr.slice(8, 10)) <= 7 && hour >= 8 && hour <= 15) {
    out.push(await nudgeOnce(req, meta, `video_${dateStr.slice(0, 7)}`, [
      `🎥 *This month's founder video* (45 to 75 seconds, filmed on your phone)`,
      `Topic idea from this week's post: *${post.headline}*. One owner question, answered straight. No script needed.`,
    ].join('\n'), { dry }))
  }
  if (wd === 3 && hour >= 8 && hour <= 15) {
    out.push(await nudgeOnce(req, meta, `intro_${dateStr}`, [
      `🤝 *5 owner introductions this week* (Founding Partner week ${n + 1})`,
      `Pick 5 independent ADAS or diagnostics owners you'd genuinely like to talk with. One at a time, not mass DMs.`,
      `Draft each intro here: ${PUBLIC_BASE}/api/capture-calc/partner-intro`,
    ].join('\n'), { dry }))
  }
  if (wd === 4 && hour >= 9 && hour <= 15) {
    out.push(await nudgeOnce(req, meta, `fb_${dateStr}`, [
      `📘 *Founding Partner week ${n + 1}: Facebook groups version*`,
      `Paste into owner groups where posting is allowed (not the company page):`, '', post.fb, '',
      `If the group allows links, add it as a comment: absoluteadas.com/partners?src=fb-group-w${n + 1}`,
    ].join('\n'), { dry }))
  }
  if (wd === 5 && hour >= 15 && hour <= 19) {
    out.push(await nudgeOnce(req, meta, `metrics_${dateStr}`, [
      `📊 *Founding Partner numbers for the week*`,
      `Owner conversations, confirmed fit, discovery calls, website inquiries, pilot prospects. 30 seconds:`,
      signedLink('partner-metrics', `pm-${dateStr}`, 'partner_metrics'),
    ].join('\n'), { dry }))
  }
  return { ok: true, date: dateStr, week: n + 1, results: out }
}

/** Intro draft for one hand-picked owner (Mark sends it himself). */
export async function draftPartnerIntro({ name, company, context, channel }) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const system = `You write as Mark Fowler, owner of Absolute ADAS, a mobile ADAS calibration company in Western Washington. Draft a short first introduction (3 to 5 sentences) to the owner of another independent ADAS or diagnostics business, sent as a ${channel || 'LinkedIn message'}.
Purpose: Mark is exploring how independent ADAS owners could stay independent while sharing software, billing support and new work, and he wants this owner's perspective. The ask is only a short conversation.
HARD RULES: owner to owner, plain and respectful. No pitch, no pricing, fees or terms. Never claim existing or signed partners, national coverage, guaranteed savings or earnings, certification, or exclusivity. Never mention territories, pricing between companies, hiring each other's people, or boycotts. Never offer to buy their company. No em dashes, no exclamation marks, no emojis, no links. Output only the message.`
  const ask = `Owner: ${name}${company ? `, ${company}` : ''}${context ? `\nWhat Mark knows about them: ${context}` : ''}`
  for (let attempt = 1; attempt <= 2; attempt++) {
    const msg = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 400, system, messages: [{ role: 'user', content: ask }] })
    const text = String(msg.content?.[0]?.text || '').trim()
    const issues = partnerClaimIssues(text)
    if (!issues.length) return { text, issues: [] }
    if (attempt === 2) return { text, issues }
  }
}
