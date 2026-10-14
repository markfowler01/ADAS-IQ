// One spoken line → MP3. Short lines + mini-tts instructions so Carl
// actually sounds tired, not like a newsreader.

import axios from 'axios'

const MODEL = process.env.SHOP_TALK_TTS_MODEL || 'gpt-4o-mini-tts'

const VOICES = {
  carl: {
    voice: process.env.SHOP_TALK_CARL_VOICE || 'ash',
    instructions:
      'You are Carl, a late-40s collision tech. Deadpan. Low. Close to the mic. Tired, not sad. ' +
      'Swear flat when the words are there. Never a host. Never bright. Never smile through it. Let it land.',
  },
  cole: {
    voice: process.env.SHOP_TALK_COLE_VOICE || 'echo',
    instructions:
      'You are Cole, a younger ADAS tech talking to Carl in the shop. Faster. A little amused. ' +
      'You argue. Not a sidekick. Not perky. Not a podcast guest.',
  },
}

export async function speakShopTalkLine(who, text) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
  const line = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 320)
  if (!line) throw new Error('Empty line')
  const spec = VOICES[who] || VOICES.carl
  const opts = {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    responseType: 'arraybuffer',
    timeout: 14000,
    validateStatus: s => s < 500,
  }
  const body = {
    model: MODEL,
    voice: spec.voice,
    input: line,
    response_format: 'mp3',
  }
  if (/^gpt-/.test(MODEL)) body.instructions = spec.instructions
  let res = await axios.post('https://api.openai.com/v1/audio/speech', body, opts)
  if (res.status >= 300) {
    res = await axios.post('https://api.openai.com/v1/audio/speech', {
      model: 'tts-1',
      voice: who === 'cole' ? 'echo' : 'onyx',
      input: line,
      response_format: 'mp3',
    }, { ...opts, timeout: 10000 })
  }
  if (res.status >= 300) throw new Error(`TTS ${res.status}`)
  return Buffer.from(res.data)
}
