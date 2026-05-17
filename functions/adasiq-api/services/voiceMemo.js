// Mark's 60-second voice memo for the ADAS Brew newsletter.
//
// Pipeline:
//   1. Claude writes a ~60-second SPOKEN script in Mark's voice from today's
//      top story. Conversational (different from written voice — fewer clauses,
//      more pauses, contractions).
//   2. OpenAI TTS (Onyx voice — confident male broadcaster) converts script
//      to MP3.
//   3. MP3 committed to GitHub at /audio/{dateISO}.mp3 → served from
//      absoluteadas.com/audio/{dateISO}.mp3
//   4. <audio> player embedded at top of email (with fallback "Listen" link
//      for clients that strip the audio tag — Gmail, Outlook).
//
// Failure modes (each fail-soft):
//   - No OPENAI_API_KEY:  returns null (no audio block in email)
//   - Claude script gen:  returns null
//   - TTS conversion:     returns null
//   - GitHub commit:      returns null
// Email ships either way.
//
// Default cadence: every weekday (Mon-Fri Pacific) — pairs with daily newsletter.
// Skips Sat/Sun so we don't burn TTS budget on days the newsletter doesn't ship.
// Override via opts.always = true (forces gen regardless of day, used by /_test-voice-memo).

import Anthropic from '@anthropic-ai/sdk'
import axios from 'axios'
import { sanitizeAiOutput } from './textSanitize.js'
import { commitBinaryFile } from './brewArchive.js'

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

const SCRIPT_SYSTEM_PROMPT = `You write the ADAS Brew Top-of-Newsletter Riff — a 90-second to 2-minute SPOKEN voice memo. Goes through text-to-speech, plays at the top of the email.

Who's speaking: Mark Fowler. Owner of Absolute ADAS, mobile ADAS calibration in Western Washington. 50,000+ calibrations. Walked into the shop with a coffee in his hand and something on his mind. Hits record.

Who's listening: a collision shop owner or service writer about to start their day. They tapped play because they trust Mark to cut through the BS.

OPEN COLD. No throat-clearing. No "welcome back to the newsletter." No "Hey, Mark here." Just start swinging on the first thing on his mind.

COVER THREE THINGS, IN THIS ORDER:

1. The biggest piece of news this week in collision, ADAS, or auto repair. What happened, why it matters to a shop owner, and what the talking heads are getting wrong about it. Call out the BS where you see it. If an OEM, insurer, or industry group is being slippery, say so plainly. Shop owners already know the game is rigged in places — don't pretend otherwise.

2. One thing that's quietly costing shops money right now that nobody's talking about loud enough. A calibration requirement everyone's missing, an insurer trick, a scan procedure being skipped, a tool that's not doing what it claims. Be specific. Name a dollar amount per RO if you can.

3. A one-liner take or hot opinion to close the riff. Something a shop owner would laugh at, nod at, and forward to his estimator. End with something he can use Monday morning, not a lecture.

TONE RULES:
- Talk like you're at the counter, not at a podium. Contractions. No corporate speak.
- Mild swearing is fine if it lands ("damn", "hell", "BS", "crap"). Sparingly. Don't force it.
- Short sentences. If you catch yourself qualifying something three ways, cut it.
- Edgy is fine. Mean isn't. The target is bad actors and lazy thinking, never the shops themselves.
- Punch UP at insurers, big DRPs playing games, OEMs writing impossible procedures.
- Punch SIDEWAYS at the industry's bad habits.
- NEVER punch DOWN at techs or shop owners trying to do it right.
- One specific number, name, or dollar figure beats ten general observations.

SPOKEN-WRITING REQUIREMENTS (TTS will pronounce exactly what you write):
- Contractions everywhere. "Don't", "won't", "it's", "you're", "we're", "they're".
- One thought per sentence. Periods, not long comma-strung phrases.
- No bullet points, no lists, no headers, no stage directions, no [pause] notation. Just spoken words.
- Natural connectors when they help: "Here's the thing.", "Look.", "And here's what's wild."

HARD BANS:
- NEVER use em dashes (TTS trips on them).
- NEVER use AI phrases ("delve", "tapestry", "navigate", "unlock", "harness", "in today's landscape").
- NEVER use marketing hype ("revolutionary", "game-changing", "leverage").
- Don't preach faith or family values. They show up through integrity, not lectures.

LENGTH: 210 to 280 words (90 seconds to 2 minutes at ~140 wpm). If it doesn't fit in 2 minutes, it doesn't belong at the top of the newsletter.

Voice test: would a guy in a blue shirt with grease on his hands SAY this out loud at the counter, or roll his eyes at it?

OUTPUT: just the script. No preamble, no markdown, no stage directions. Just the words Mark would say.`

/**
 * Generate the spoken script for today's voice memo.
 * @param {Object} digest — output of assembleDigest()
 * @returns {Promise<string|null>}
 */
async function generateScript(digest) {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const stories = Array.isArray(digest?.stories) ? digest.stories : []
  if (stories.length === 0) return null
  const lines = stories.map((s, i) => `${i + 1}. [${s.tag || 'IND'}] ${s.headline}\n   ${s.body || ''}`).join('\n')
  try {
    const client = getAnthropic()
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: SCRIPT_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Today's stories:\n\n${lines}\n\nWrite Mark's 60-second voice memo for today. Pick the strongest story and stay in spoken voice.`,
      }],
    })
    const text = (msg.content?.[0]?.text || '').trim()
    if (!text) return null
    return sanitizeAiOutput(text)
  } catch (e) {
    console.warn('[voiceMemo script]', e.message)
    return null
  }
}

/**
 * Convert spoken script to MP3 via OpenAI TTS (Onyx voice, tts-1 model).
 * Cheapest viable path. ~$0.003 per 60-sec memo.
 * @param {string} script
 * @returns {Promise<Buffer|null>}
 */
async function scriptToMp3(script) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !script) return null
  try {
    const res = await axios.post(
      'https://api.openai.com/v1/audio/speech',
      {
        model: 'tts-1',          // cheap + fast; tts-1-hd is ~2x cost for slight quality lift
        voice: process.env.BREW_VOICE_MEMO_VOICE || 'echo',  // Mark-picked: closest to his real voice
        input: script.slice(0, 4000),  // OpenAI cap is 4096 chars
        response_format: 'mp3',
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
        timeout: 30000,
        validateStatus: s => s < 500,
      }
    )
    if (res.status >= 300) {
      console.warn('[voiceMemo tts]', `OpenAI ${res.status}`)
      return null
    }
    return Buffer.from(res.data)
  } catch (e) {
    console.warn('[voiceMemo tts]', e.message)
    return null
  }
}

/**
 * End-to-end: script → MP3 → commit to GitHub → returns the public URL.
 * @param {Object} digest
 * @param {string} dateISO — YYYY-MM-DD, used as filename
 * @param {Object} [opts]
 * @param {boolean} [opts.always] — if true, bypasses the weekday gate (used by /_test-voice-memo)
 * @returns {Promise<{url:string, script:string}|null>}
 */
export async function buildAndPublishVoiceMemo(digest, dateISO, opts = {}) {
  // Mon-Fri Pacific only — newsletter doesn't ship on weekends.
  if (!opts.always) {
    const dayPT = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
    if (dayPT === 'Sat' || dayPT === 'Sun') return null
  }

  const publicUrl = `https://absoluteadas.com/audio/${dateISO}.mp3`

  // Short-circuit: if today's MP3 is already on GitHub, return its URL without
  // re-running Claude + TTS. Makes /preview reliable (returns instantly under
  // the 30s gateway cap) and prevents redundant TTS spend if the cron retries.
  // opts.force=true bypasses this (used by /_test-voice-memo to regenerate).
  if (!opts.force) {
    try {
      const head = await axios.head(
        `https://raw.githubusercontent.com/markfowler01/markfowler01.github.io/main/audio/${dateISO}.mp3`,
        { timeout: 5000, validateStatus: s => s < 500 }
      )
      if (head.status === 200) {
        return { url: publicUrl, cached: true, script: null }
      }
    } catch { /* fall through and generate */ }
  }

  // Skip if no TTS key — fail-soft so the email still ships
  if (!process.env.OPENAI_API_KEY) {
    console.log('[voiceMemo] OPENAI_API_KEY not set, skipping audio')
    return null
  }

  const script = await generateScript(digest)
  if (!script) return null

  const mp3 = await scriptToMp3(script)
  if (!mp3) return null

  try {
    const r = await commitBinaryFile({
      path: `audio/${dateISO}.mp3`,
      buffer: mp3,
      message: `Voice memo for ADAS Brew ${dateISO}`,
    })
    if (!r?.ok || !r?.rawUrl) return null
    return { url: publicUrl, rawUrl: r.rawUrl, script }
  } catch (e) {
    console.warn('[voiceMemo commit]', e.message)
    return null
  }
}
