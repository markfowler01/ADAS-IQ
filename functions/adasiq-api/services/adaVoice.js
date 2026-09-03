// Ada's voice — the daily brief as a playable audio message.
//
// Mark wanted to hear the brief on the way to F3 at 4:40 rather than read it
// in the dark. Not a phone call — a file he taps and plays.
//
// Reuses the pipeline already proven by the ADAS Brew voice memo: OpenAI TTS
// to MP3, committed to the GitHub Pages site, served from absoluteadas.com.
// Nothing new to provision.

import axios from 'axios'
import { commitBinaryFile } from './brewArchive.js'

// Voice options, warmest to brightest: sage, coral, nova, shimmer.
// Mark asked for something warmer than the default, so this sits on sage —
// breathier and more conversational than nova, which reads a little clipped.
// Swap with ADA_TTS_VOICE without a deploy.
const ADA_TTS_VOICE = process.env.ADA_TTS_VOICE || 'sage'

// gpt-4o-mini-tts accepts an `instructions` prompt, which steers delivery far
// more than picking from a fixed voice list ever could — pace, warmth, how
// close she sits to the mic. Falls back to tts-1-hd if that model is
// unavailable, because a missing memo must never cost him the brief.
const ADA_TTS_MODEL = process.env.ADA_TTS_MODEL || 'gpt-4o-mini-tts'
const ADA_TTS_FALLBACK = 'tts-1-hd'

// Mark asked for warmer. This is the lever that actually moves it.
const ADA_TTS_STYLE = process.env.ADA_TTS_STYLE ||
  'Warm, low and unhurried, close to the mic. Speak like you know him well and ' +
  'you are the first voice he hears today, before anyone else is up. Relaxed and ' +
  'confident, never bright or perky, never newsreader. Let the sentences breathe ' +
  'and land. Slightly slower than conversational.'

async function toMp3(script) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !script) return null
  try {
    const opts = {
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      timeout: 45000,
      validateStatus: st => st < 500,
    }
    const body = {
      model: ADA_TTS_MODEL,
      voice: ADA_TTS_VOICE,
      input: script.slice(0, 4000),   // OpenAI caps at 4096 chars
      response_format: 'mp3',
    }
    // `instructions` is only honoured by the gpt-4o-*-tts models — sending it
    // to tts-1 is a 400, so it is gated on the model family.
    if (/^gpt-/.test(ADA_TTS_MODEL)) body.instructions = ADA_TTS_STYLE

    let res = await axios.post('https://api.openai.com/v1/audio/speech', body, opts)
    if (res.status >= 300) {
      console.warn('[adaVoice tts] ' + ADA_TTS_MODEL + ' -> ' + res.status + ', falling back to ' + ADA_TTS_FALLBACK)
      res = await axios.post('https://api.openai.com/v1/audio/speech', {
        model: ADA_TTS_FALLBACK, voice: ADA_TTS_VOICE,
        input: script.slice(0, 4000), response_format: 'mp3',
      }, opts)
      if (res.status >= 300) { console.warn('[adaVoice tts] fallback also ' + res.status); return null }
    }
    return Buffer.from(res.data)
  } catch (e) {
    console.warn('[adaVoice tts]', e.message)
    return null
  }
}

/**
 * Render a spoken script to a playable URL.
 * Returns { url } or null — always fail-soft, because a missing audio file
 * must never cost Mark the written brief.
 */
export async function publishAdaVoice(script, dateISO, { slot = 'morning', force = false } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    console.log('[adaVoice] no OPENAI_API_KEY, skipping audio')
    return null
  }
  const name = 'ada-' + slot + '-' + dateISO + '-' + ADA_TTS_VOICE + '.mp3'
  const publicUrl = 'https://absoluteadas.com/audio/' + name

  // Already rendered today? Return it rather than paying for TTS twice — the
  // morning cron can retry, and /debug gets called while iterating.
  if (!force) {
    try {
      const head = await axios.head(
        'https://raw.githubusercontent.com/markfowler01/markfowler01.github.io/main/audio/' + name,
        { timeout: 5000, validateStatus: s => s < 500 }
      )
      if (head.status === 200) return { url: publicUrl, cached: true }
    } catch { /* fall through and render */ }
  }

  const mp3 = await toMp3(script)
  if (!mp3) return null
  try {
    const r = await commitBinaryFile({
      path: 'audio/' + name,
      buffer: mp3,
      message: 'Ada ' + slot + ' brief ' + dateISO,
    })
    if (!r?.ok) return null
    return { url: publicUrl, bytes: mp3.length, voice: ADA_TTS_VOICE }
  } catch (e) {
    console.warn('[adaVoice commit]', e.message)
    return null
  }
}
