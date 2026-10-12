// Stray-text guard for AI-generated image layers.
//
// Every Gemini layer we publish is prompted "NO TEXT" — headlines, logos and
// footers are typeset in code. But image models still sneak in fake shop
// signage, plate characters or caption-like scribbles, and AI lettering is
// where misspellings come from ("Cabibration", 2026-10-11). This vision check
// runs on the raw AI layer BEFORE any real text is composited on top.
//
// Fails OPEN on API/parse errors (a Claude hiccup must not cost the post its
// image — the no-text prompt is still the first line of defense).

import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'

/**
 * @param {Buffer} imageBuffer — the raw AI layer (no code-rendered text yet)
 * @returns {Promise<{hasText: boolean, found: string}>}
 */
export async function detectAiText(imageBuffer) {
  if (!process.env.ANTHROPIC_API_KEY) return { hasText: false, found: '' }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const small = await sharp(imageBuffer).resize(768, 768, { fit: 'inside' }).jpeg({ quality: 82 }).toBuffer()
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: small.toString('base64') } },
          { type: 'text', text: `Does this image contain ANY visible written characters — words, letters, numbers, signage, labels, captions, license-plate characters, or text-like scribbles that imitate writing? Ignore pure shapes, textures and patterns that do not look like writing.
Respond ONLY with JSON: {"has_text": true/false, "found": "<the characters you can see, or empty>"}` },
        ],
      }],
    })
    const raw = (msg.content?.[0]?.text || '').trim()
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}')
    const parsed = JSON.parse(s >= 0 && e > s ? raw.slice(s, e + 1) : raw)
    return { hasText: Boolean(parsed.has_text), found: String(parsed.found || '').slice(0, 120) }
  } catch (e) {
    console.warn('[aiImageTextGuard] check skipped:', e.message)
    return { hasText: false, found: '' }
  }
}

/**
 * Run an AI image generator up to `attempts` times until it returns a layer
 * with no stray text. Generator must resolve to {ok, buffer, ...}.
 */
export async function generateWithoutText(genFn, { attempts = 2, label = 'ai image' } = {}) {
  let last = null
  for (let i = 1; i <= attempts; i++) {
    const r = await genFn()
    if (!r?.ok) return r
    const { hasText, found } = await detectAiText(r.buffer)
    if (!hasText) return r
    console.warn(`[${label}] attempt ${i} rejected — AI drew text: "${found}"`)
    last = found
  }
  return { ok: false, error: `AI kept drawing text into the image ("${last}") — image suppressed` }
}
