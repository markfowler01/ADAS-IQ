// Shop Talk — weekly two-tech bay conversation cut from ADAS Brew.
// Private preview only. Nothing ships public until Mark says the episode is good.

import axios from 'axios'
import Anthropic from '@anthropic-ai/sdk'
import catalyst from 'zcatalyst-sdk-node'
import { sanitizeAiOutput } from './textSanitize.js'

const ISSUE_URLS = n => ([
  `https://raw.githubusercontent.com/markfowler01/markfowler01.github.io/main/brew/issues/${n}.html`,
  `https://absoluteadas.com/brew/issues/${n}`,
])

function stripTags(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseIssue(html, number) {
  const title = stripTags((html.match(/<title>([^<]+)<\/title>/i) || [])[1] || '')
  const tagline = stripTags((html.match(/<div class="h1">([\s\S]*?)<\/div>/i) || [])[1] || '')
  const dateRaw = stripTags((html.match(/<div class="date">([\s\S]*?)<\/div>/i) || [])[1] || '')
  const intro = stripTags((html.match(/<div class="intro">([\s\S]*?)<\/div>/i) || [])[1] || '')
  const stories = []
  const parts = String(html).split(/<div class="story">/i).slice(1)
  for (const part of parts.slice(0, 6)) {
    const headline = stripTags((part.match(/<h2>([\s\S]*?)<\/h2>/i) || [])[1] || '').replace(/^\d+\.\s*/, '')
    const body = stripTags((part.match(/<p>([\s\S]*?)<\/p>/i) || [])[1] || '')
    const take = stripTags((part.match(/class="mtake">([\s\S]*?)<\/p>/i) || [])[1] || '').replace(/^Mark says:\s*/i, '')
    if (headline) stories.push({ headline, body, mark_take: take })
  }
  if (!stories.length) {
    for (const m of String(html).matchAll(/<h2>([\s\S]*?)<\/h2>\s*<p>([\s\S]*?)<\/p>/gi)) {
      const headline = stripTags(m[1]).replace(/^\d+\.\s*/, '')
      const body = stripTags(m[2])
      if (headline && body && stories.length < 6) stories.push({ headline, body, mark_take: '' })
    }
  }
  if (!stories.length && (title || intro)) {
    stories.push({ headline: title || tagline || `Issue ${number}`, body: intro || title, mark_take: '' })
  }
  return {
    number,
    title: title.replace(/\s+·\s+ADAS Brew.*$/i, '').trim(),
    tagline,
    date: dateRaw.replace(/\s*·\s*#\d+\s*$/, '').trim(),
    intro,
    stories,
  }
}

async function fetchHtml(url, ms = 4000) {
  const r = await axios.get(url, {
    timeout: ms,
    validateStatus: s => s < 500,
    maxContentLength: 400000,
    headers: { 'User-Agent': 'AbsoluteADAS-ShopTalk/1.0', Accept: 'text/html,*/*' },
  })
  if (r.status >= 300 || !r.data) return ''
  return String(r.data)
}

async function lastIssueNumber(req) {
  if (req) {
    try {
      const val = await catalyst.initialize(req).cache().segment().getValue('brew_meta')
      const n = Number(JSON.parse(val || '{}').last_issue_number) || 0
      if (n > 0) return n
    } catch { /* fall through */ }
  }
  try {
    const html = await fetchHtml('https://raw.githubusercontent.com/markfowler01/markfowler01.github.io/main/brew/archive/index.html', 4000)
    const nums = [...html.matchAll(/\/brew\/issues\/(\d+)/g)].map(m => parseInt(m[1], 10)).filter(n => n > 0)
    if (nums.length) return Math.max(...nums)
  } catch { /* fall through */ }
  return 0
}

async function fetchOneIssue(n) {
  for (const url of ISSUE_URLS(n)) {
    try {
      const html = await fetchHtml(url, 4000)
      if (html && /ADAS Brew|class="story"|class="h1"/i.test(html)) {
        const issue = parseIssue(html, n)
        if (issue.stories.length) return issue
      }
    } catch { /* next url */ }
  }
  return null
}

export async function loadRecentIssues(count = 5, req = null) {
  const max = await lastIssueNumber(req)
  if (!max) throw new Error('Could not read the Brew archive')
  const nums = Array.from({ length: count }, (_, i) => max - i).filter(n => n > 0)
  const found = (await Promise.all(nums.map(n => fetchOneIssue(n)))).filter(Boolean)
  found.sort((a, b) => b.number - a.number)
  if (!found.length) throw new Error('Found the archive but could not read any issues')
  return found
}

const SYSTEM_PROMPT = `You write SHOP TALK. It is not a podcast. It is not a newsletter recap. It is two techs in a collision bay, already talking, captured on a phone in a shirt pocket.

If it sounds like NPR or two guys breaking down the news, you failed. The last version failed. Do not write that again.

WHO THEY ARE
CARL. Late 40s. Lead tech. Dungeon Crawler Carl energy and NEVER say the book. Tired, funny, pissed at systems not at people. Swears like a person: shit, damn, hell, bullshit, ass. Flat. He does not perform the joke. He has seen 20 years of this. He names the actual play.
COLE. Late 20s. ADAS kid. Not Carl's interviewer. He argues. He has a dumb take and sometimes a good one. He talks about a car on the floor, a kid from a carrier, a tool that lied. He can laugh. He does not say wait, they published that?

They are not Mark. They are not Jayden. They do not work at Absolute ADAS on the air.

THE SCENE
Bay door cracked. Scan tool still beeping. Coffee that has been reheated. They are in the middle of a job. The week's news falls OUT of the fight. It is never the agenda.

Use at most TWO facts from the source as fuel. One argument. One thing a shop can do Monday. That is the whole show.

COLD OPEN. First line is already mid-sentence, mid-complaint, mid-job. No names of the show. No so this week.

SHAPE (16 to 20 turns)
1. They are already arguing about a car or a carrier.
2. A fact from this week lands because it proves somebody's point, not because it is the top story.
3. They get specific. A make. A procedure. A line on an estimate. A person they talked to. Invent the shop-floor color (the Camry, the kid, the printed job aid on the toolbox). Do not invent fake stats, fake lawsuits, or fake OEM rules. Steal the real fact, wrap it in a real-feeling bay.
4. Carl says the Monday play in one sentence a tech would actually do.
5. They walk off. Radio. Door. Done.

THIS IS WHAT SUCKS. NEVER WRITE IT.
Cole: Wait, APCIA published that? The insurance group?
Carl: Yeah. Their own report. Safer vehicles, but the bill to fix them went through the roof.
Cole: So what should shops do with that?
That is two hosts reading Brew. Kill it.

THIS IS THE TARGET.
Carl: Kid told me the camera probably still works.
Cole: Which kid.
Carl: The State Farm one. Polo shirt. He poked the lens like that means it's aimed.
Cole: Their own paper dropped this week. Repair costs up thirty four percent. They wrote it.
Carl: And he'll still cut the scan. Print the damn Ford job aid and tape it to the estimate. I'm not debating a polo shirt.

RULES
- 16 to 20 turns. Alternate. Nobody talks twice in a row.
- Each turn is ONE or TWO short sentences. Spoken. Contractions.
- No em dashes. No stage directions. No [pause]. No *laughs*. The text field is only words they say.
- Do not explain acronyms. Do not cite the study like a student. Do not walk headlines.
- Punch up at carriers, OEM nonsense, lazy estimating. Never punch down at shops or techs trying.
- Mild swearing on Carl, a few times, when it would actually come out of his mouth.
- No welcome, no host, no that's our show, no AI sludge (delve, tapestry, landscape, unlock, harness, game-changing).

OUTPUT only raw JSON, no fence:
{"title":"under 50 chars, sounds like a bay complaint","tagline":"one spoken line","week_label":"","turns":[{"who":"carl"|"cole","text":"..."}]}`

function packSource(issues) {
  return issues.slice(0, 3).map(iss => {
    const stories = (iss.stories || []).slice(0, 3).map((s, i) =>
      `  ${i + 1}. ${s.headline}\n     ${String(s.body || '').slice(0, 160)}\n     Take: ${s.mark_take || ''}`
    ).join('\n')
    return `#${iss.number} · ${iss.date || ''} · ${iss.title || iss.tagline}\n${stories}`
  }).join('\n\n')
}

export async function writeShopTalkScript(issues) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
  if (!issues?.length) throw new Error('No Brew issues to cut from')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 18000, maxRetries: 0 })
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1400,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Fuel for this week's bay argument. Steal at most two facts. Write the TARGET version, never the sucks version.\n\n${packSource(issues)}`,
    }],
  })
  const raw = (msg.content || []).map(b => b.text || '').join('').trim()
    .replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '')
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw new Error('Script came back malformed') }
  const turns = (Array.isArray(parsed.turns) ? parsed.turns : [])
    .map(t => ({
      who: String(t.who || '').toLowerCase() === 'cole' ? 'cole' : 'carl',
      text: sanitizeAiOutput(t.text),
    }))
    .filter(t => t.text)
  if (turns.length < 12) throw new Error('Script was too short')
  const first = issues[issues.length - 1]
  const last = issues[0]
  return {
    title: sanitizeAiOutput(parsed.title || 'Shop Talk'),
    tagline: sanitizeAiOutput(parsed.tagline || ''),
    week_label: last?.date || first?.date || sanitizeAiOutput(parsed.week_label || ''),
    issue_numbers: issues.map(i => i.number),
    turns,
    created_at: new Date().toISOString(),
  }
}

export async function buildShopTalkEpisode(issues) {
  const list = issues?.length ? issues : await loadRecentIssues(5)
  const script = await writeShopTalkScript(list)
  script.sources = list.map(i => ({ number: i.number, date: i.date, title: i.title }))
  script.posts_used = 0
  return script
}
