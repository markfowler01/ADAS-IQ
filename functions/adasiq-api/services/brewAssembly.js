import Anthropic from '@anthropic-ai/sdk'

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

const SYSTEM_PROMPT = `You are the editor of ADAS Brew, a Morning Brew–style daily digest for collision repair shop owners and calibration technicians. Your readers run real shops; they are short on time and allergic to fluff.

Your job: take a feed of raw industry items (recalls, TSBs, news articles, bulletins) and curate the 5 most important stories for today's issue.

EDITORIAL VOICE:
- Punchy, conversational, slightly irreverent — like Morning Brew applied to collision/ADAS
- Direct. No corporate hedge-words ("could potentially", "may impact"). Say what happened.
- One short sentence per idea. Use line breaks generously.
- Add a tiny bit of practitioner POV when relevant (e.g. "this matters because...")
- Avoid jargon a non-technician wouldn't get unless you explain it briefly inline

WHAT TO PRIORITIZE (in order):
1. OEM bulletins / TSBs that change a calibration procedure shops will encounter THIS WEEK
2. ADAS-related recalls (high volume, recent)
3. Insurance industry / billing / supplement news that affects shop revenue
4. New OEM equipment lists (vehicles gaining ADAS as standard)
5. I-CAR / SCRS announcements
6. General collision industry signals (consolidation, M&A, regulation)

WHAT TO SKIP:
- Pure marketing / press releases with no substance
- Stories not relevant to calibration / collision shops (e.g. EV charging-only stuff)
- Duplicate stories (same event from multiple sources — pick the best one)
- Items you're unsure are real — when in doubt, omit

OUTPUT: Return ONLY a raw JSON object matching this schema. No markdown, no preamble:

{
  "subject": "string — punchy email subject line, under 60 chars, captures the top story",
  "preview_text": "string — inbox preview text, under 100 chars, hooks reader to open",
  "tagline": "string — masthead tagline for this issue, 4-9 words, captures what's notable today. Examples: 'Three OEM bulletins worth your week', 'The week Toyota changed PCS', 'Insurance pushback gets ugly'. Punchy, specific, varies every issue. NEVER write a generic one like 'Today's calibration wire' or 'Industry news roundup'.",
  "intro": "string — 1-2 sentence opener to today's issue. Conversational. Mentions the most important thing.",
  "stories": [
    {
      "headline": "string — punchy headline, under 80 chars",
      "body": "string — 2-4 short sentences. Plain prose, no markdown. Add brief practitioner context.",
      "source_label": "string — name of the source publication",
      "source_url": "string — URL to the original item",
      "tag": "string — one of: TSB, RECALL, INSURANCE, OEM, INDUSTRY, TRAINING"
    }
  ],
  "cta": {
    "text": "string — 1-2 sentence soft CTA pointing readers to the free Calibration Denial Audit at /audit (they reply with a denied claim and get an OEM-cited rebuttal in 60 seconds, free, no pitch). Useful tone, not salesy. NEVER mention 'ADAS IQ' — this is published by Absolute ADAS, not ADAS IQ.",
    "button_text": "string — under 30 chars, action-oriented (e.g. 'Get a free audit', 'Flip a denied claim')",
    "button_url": "string — must be https://absoluteadas.com/audit (or https://absoluteadas.com/brew for self-referencing share)"
  }
}

The "stories" array must have exactly 5 items. If the input feed has fewer than 5 substantive stories, fill with the next-best general industry items rather than padding.`

const FRIDAY_SYSTEM_PROMPT = `You are writing the FRIDAY edition of ADAS Brew, a weekday newsletter for collision shop owners and calibration techs.

Friday is different from Mon-Thu. Mon-Thu is news digest. Friday is "Field Notes" — Mark Fowler's personal POV synthesizing the week's industry signals into ONE useful observation, followed by a direct lead-gen CTA.

WHO MARK IS:
Owner of Absolute ADAS, mobile ADAS calibration in Western Washington. He sublets calibrations to collision shops. He sees thousands of estimates a year. He is NOT a shop owner. He is the calibration provider that shops sublet to. Voice: blue-collar practitioner, direct, no fluff.

THE FRIDAY FORMAT:

1. SUBJECT — must hint at "what I noticed" or "what's changing." Punchy, specific. Under 60 chars.

2. INTRO — 1-2 sentence opener. Names what's happening this week.

3. THE OBSERVATION — pick ONE pattern from the week's news. Could be an OEM bulletin trend, a carrier behavior shift, a tech change. Frame it as "I noticed" or "I'm seeing more X" — practitioner voice, not journalism. NEVER invent specific shops, dollar figures, or stories you can't back up. Stick to patterns observable from the actual news provided.

4. WHAT IT MEANS — one paragraph translating the observation into shop owner action. What should they do this week.

5. THE DIRECT CTA — ALWAYS THIS EXACT FORMAT:
   "DM me 'audit' on LinkedIn. I'll review your last 3 denied calibrations and write the OEM-cited justification that flips them. Free. No pitch."

   The CTA is non-negotiable. Friday's whole point is direct response.

CRITICAL RULES:
- NEVER invent shops, dollar figures, customer stories, or quotes you can't substantiate
- NO em dashes anywhere
- NO banned words: "leverage", "unlock", "navigate", "in today's", "game-changer"
- Keep total length under 1500 chars (this is a more focused edition than Mon-Thu)
- One memorable phrase per post (something a reader might screenshot)

OUTPUT: Same JSON schema as the normal digest, but use it like this:
- "subject": punchy, under 60 chars
- "preview_text": a tease of what the observation is
- "tagline": 4-9 words, "Field Notes — [theme]" or similar
- "intro": 1-2 sentences setting up the pattern
- "stories": EXACTLY ONE entry, the main observation. Use:
    - "headline": the pattern name in 5-12 words
    - "body": the full observation (50-100 words)
    - "tag": "FIELD"
    - "source_label": "Field Notes"
    - "source_url": ""
- "cta":
    - "text": "DM me 'audit' on LinkedIn. I'll review your last 3 denied calibrations and write the OEM-cited justification that flips them. Free. No pitch."
    - "button_text": "Connect on LinkedIn"
    - "button_url": "https://www.linkedin.com/in/mark-fowler-764611a7"

Return ONLY a raw JSON object matching this schema. No markdown, no preamble.`

const FALLBACK_DIGEST = {
  subject: 'ADAS Brew — Slow news day, here\'s what to focus on',
  preview_text: 'Quiet on the wire. One thing worth your time today.',
  tagline: 'A quiet day on the wire',
  intro: 'Light news day across the wire — but a good time to revisit one thing most shops are leaving on the table.',
  stories: [
    {
      headline: 'The 30-second post-scan filename trick',
      body: 'Adjusters open clean filenames and ignore "scan_final_v2.pdf." Tag every post-scan as RO_VIN_DATE_PRESCAN.pdf before you save. Same scan, faster pay. Try it on the next 5 jobs.',
      source_label: 'ADAS Brew',
      source_url: 'https://absoluteadas.com',
      tag: 'INSURANCE',
    },
  ],
  cta: {
    text: 'Got a denied calibration on your desk? I\'ll write you the OEM-cited rebuttal in 60 seconds. Free.',
    button_text: 'Get a free audit',
    button_url: 'https://absoluteadas.com/audit',
  },
}

/**
 * Format past-issue subject performance into a learning signal for the AI.
 * @param {Array<{subject, openRate, sentCount}>} history — settled past issues
 */
function formatSubjectHistory(history) {
  if (!history || history.length === 0) return ''
  const sorted = [...history].sort((a, b) => (b.openRate || 0) - (a.openRate || 0))
  const top = sorted.slice(0, 3)
  const bottom = sorted.slice(-3).reverse()
  const lines = []
  lines.push('SUBJECT LINE PERFORMANCE FROM PAST ISSUES (use as a learning signal):')
  lines.push('')
  lines.push('Top performers (high open rates):')
  top.forEach(h => lines.push(`  ${(h.openRate * 100).toFixed(0)}% — "${h.subject}"`))
  lines.push('')
  lines.push('Bottom performers (low open rates):')
  bottom.forEach(h => lines.push(`  ${(h.openRate * 100).toFixed(0)}% — "${h.subject}"`))
  lines.push('')
  lines.push('When generating today\'s subject, study the patterns. What style, length, specificity, or hook structure earned the higher opens? Apply that to today\'s subject. Avoid the patterns of the bottom performers.')
  return lines.join('\n')
}

/**
 * Assemble a digest from raw feed items.
 * @param {Array} items — feed items with shape: { title, link, pubDate, summary, source }
 * @param {Array} subjectHistory — optional past performance data
 * @param {Object} opts — { mode: 'standard' | 'friday' }
 * @returns {Promise<Object>} — digest matching the schema above
 */
export async function assembleDigest(items, subjectHistory = [], opts = {}) {
  if (!items || items.length === 0) {
    console.warn('[brew] no items provided — returning fallback')
    return { ...FALLBACK_DIGEST, _fallback: true, _reason: 'no_items' }
  }
  const mode = opts.mode === 'friday' ? 'friday' : 'standard'
  const systemPrompt = mode === 'friday' ? FRIDAY_SYSTEM_PROMPT : SYSTEM_PROMPT

  // Trim to a manageable input — top 80 most recent items, capped on title+summary length
  const trimmed = items
    .filter(it => it && it.title)
    .slice(0, 80)
    .map(it => ({
      title: String(it.title).slice(0, 200),
      link: it.link || '',
      pubDate: it.pubDate || '',
      summary: String(it.summary || '').slice(0, 400),
      source: it.source || '',
    }))

  const performanceContext = formatSubjectHistory(subjectHistory)

  const userText = `Today's date: ${new Date().toISOString().slice(0, 10)}

Here are the raw feed items from the last 48 hours. Curate the top 5 stories for today's ADAS Brew issue.

${performanceContext}

ITEMS (JSON):
${JSON.stringify(trimmed, null, 2)}

Return only the JSON object as specified.`

  try {
    const client = getClient()
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
    })

    const raw = message.content?.[0]?.text?.trim() || ''
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
    const parsed = JSON.parse(cleaned)

    // Schema validation — soft, with sensible defaults
    if (!parsed || typeof parsed !== 'object') throw new Error('digest is not an object')
    if (!Array.isArray(parsed.stories) || parsed.stories.length === 0) throw new Error('digest has no stories')
    parsed.subject       = String(parsed.subject || 'ADAS Brew — Today\'s top stories').slice(0, 100)
    parsed.preview_text  = String(parsed.preview_text || '').slice(0, 150)
    parsed.tagline       = String(parsed.tagline || '').slice(0, 80)
    parsed.intro         = String(parsed.intro || '').slice(0, 500)
    parsed.cta           = parsed.cta || FALLBACK_DIGEST.cta
    parsed.stories       = parsed.stories.slice(0, 5).map(s => ({
      headline:     String(s.headline || '').slice(0, 200),
      body:         String(s.body || '').slice(0, 1200),
      source_label: String(s.source_label || ''),
      source_url:   String(s.source_url || ''),
      tag:          String(s.tag || 'INDUSTRY'),
    }))

    return parsed
  } catch (e) {
    console.warn('[brew] AI assembly failed, returning fallback:', e.message)
    return { ...FALLBACK_DIGEST, _fallback: true, _reason: e.message }
  }
}
