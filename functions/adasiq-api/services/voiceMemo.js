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
// Default cadence: Friday only (matches the Field Notes / personal-POV pairing).
// Override via opts.daily = true.

import Anthropic from '@anthropic-ai/sdk'
import axios from 'axios'
import { sanitizeAiOutput } from './textSanitize.js'
import { commitBinaryFile } from './brewArchive.js'

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

const SCRIPT_SYSTEM_PROMPT = `You write a ~60-second SPOKEN voice memo for the ADAS Brew newsletter. This will be converted to MP3 with text-to-speech and played at the top of the email.

Who's speaking: Mark Fowler. Owner of Absolute ADAS, mobile ADAS calibration in Western Washington. 50,000+ calibrations on the floor. He has been reading the wire all morning. Pours a coffee. Hits record.

Who's listening: a collision shop owner or service writer about to start their day. They tapped play because they trust Mark.

VOICE & TONE (locked brand contract — non-negotiable):
- Direct, practical, peer in the bay. Not a broadcaster, not a marketer.
- Confident without arrogance. Don't brag about the 50,000+.
- Safety-first framing when relevant. Every calibration protects a real driver.
- Faith and family values present in integrity, not preached.

SPOKEN-WRITING DIFFERENCES (this is critical — different from the email text):
- Use contractions. "Don't", "won't", "it's", "you're", "we're".
- Short sentences. Read aloud, they should feel natural.
- Conversational connectors: "So...", "Here's the thing...", "Look,...", "Quick one for you..."
- One thought per sentence. TTS will run sentences together if too long.
- No bullet points. No lists. No headers. Just talking.
- Natural pauses with periods. Avoid commas inside long phrases — use periods.

HARD RULES:
- NEVER use em dashes (TTS pronounces them as pauses but they trip the model).
- NEVER use AI phrases ("delve", "tapestry", "in today's", "navigate", "unlock", "harness").
- NEVER use hype words ("revolutionary", "game-changing", "leverage").
- ALWAYS start with a friendly greeting: "Hey, Mark here." or "Morning, Mark Fowler here."
- ALWAYS end with a single sign-off + a forward-looker. Examples:
    "That's it from me. Pour a second cup."
    "Catch you in the morning."
    "If you got a denial today, hit reply."
- Target length: 130-180 words (60 seconds of natural speech at ~140 wpm).
- Pick ONE story from the digest. Don't try to cover all five. Pick the strongest practitioner angle.

Voice test: would a guy in a blue shirt with grease on his hands SAY this out loud, or roll his eyes at it?

OUTPUT: just the script. No preamble, no markdown, no stage directions, no [pause] notation. Just the words Mark would say.`

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
 * @param {boolean} [opts.daily] — if true, runs every weekday; default Friday-only
 * @returns {Promise<{url:string, script:string}|null>}
 */
export async function buildAndPublishVoiceMemo(digest, dateISO, opts = {}) {
  // Friday-only by default — pairs with Field Notes / personal POV cadence
  const dayPT = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
  if (!opts.daily && dayPT !== 'Fri') return null

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
    // Public URL on absoluteadas.com (served from GitHub Pages)
    const publicUrl = `https://absoluteadas.com/audio/${dateISO}.mp3`
    return { url: publicUrl, rawUrl: r.rawUrl, script }
  } catch (e) {
    console.warn('[voiceMemo commit]', e.message)
    return null
  }
}
