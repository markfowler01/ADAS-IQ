// Gemini 2.5 Flash Image (Nano Banana) — generates the daily ADAS Brew
// cover image. Returns a PNG Buffer + a stable prompt for caption display.
//
// Required env vars:
//   GEMINI_API_KEY        — from aistudio.google.com
// Optional env vars:
//   GEMINI_IMAGE_MODEL    — default: gemini-2.5-flash-image-preview

import axios from 'axios'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

function envBundle() {
  return {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
  }
}

export function nanoBananaConfigured() {
  return Boolean(envBundle().apiKey)
}

/**
 * Daily ADAS Brew cover. NO LONGER AI-GENERATED (2026-10-11): Gemini drew
 * this card's headline and shipped Issue #105 as "ADAS Cabibration Rules".
 * The cover is pure typography, so it is now typeset in code with real
 * fonts — see services/brewCoverRender.js. Export name and return shape are
 * unchanged so every caller (brew run, previews) picks this up as-is.
 *
 * @param {Object} args
 * @param {number|string} args.issueNumber — e.g. 7
 * @param {string} args.dateISO            — e.g. "2026-05-12"
 * @param {string} args.headline           — the email subject for this issue
 * @returns {Promise<{ok: true, buffer: Buffer, mimeType: string, prompt: string} | {ok: false, error: string}>}
 */
export async function generateCoverImage({ issueNumber, dateISO, headline }) {
  const { renderBrewCover } = await import('./brewCoverRender.js')
  return renderBrewCover({ issueNumber, dateISO, headline })
}

// Absolute ADAS calibration-tip post — Nano Banana generates ONLY the
// photographic background. The headline, bullet card, and logo footer are
// composited in code (see services/tipImageComposite.js) for pixel-perfect
// brand consistency. The AI is allowed to interpret the photo but is told
// explicitly NOT to render any text, logos, or graphics.
const TIP_STYLE_PROMPT = `Square photographic image, 1080x1080.

Subject: {PHOTO_SUBJECT}

Lighting: cinematic low-key. Dark blues, blacks, and gunmetal grays dominate. Subtle teal-blue highlights catch metal, glass, or paper edges. Shallow depth of field. Photo-realistic, professional automotive editorial photography quality. The whole frame should read as moody and considered, not stock-photo bright.

The TOP portion (upper 45%) of the photo should have darker, less-detailed areas (sky, shadow, out-of-focus background, dark wall, or paper margins) so headline text can be cleanly overlaid later. The MIDDLE 35% can have the main subject. The BOTTOM 10% will be covered by a graphic footer — keep it visually quiet there too.

CRITICAL: NO TEXT, NO LOGOS, NO WATERMARKS, NO GRAPHICS, NO BORDERS. Just the photograph. Do not add any words, captions, headlines, or branding of any kind to the image — text and branding will be added later in code.`

const DEFAULT_PHOTO_SUBJECT = 'A dramatic moody close-up of a modern vehicle\'s front-end — headlight cluster, ADAS sensor housing, grille, or windshield camera region. ADAS hardware visible or implied. Automotive editorial photography.'

/**
 * Generate the photographic background for the daily Absolute ADAS tip card.
 * Headline, bullets, and logo are composited on top in code afterward.
 *
 * @param {Object} [args]
 * @param {string} [args.photoSubject] — optional thematic subject description
 *   (e.g. "RO paperwork on clipboard, ballpoint pen, shop counter lighting").
 *   Falls back to a generic vehicle close-up if omitted.
 * @returns {Promise<{ok: true, buffer: Buffer, mimeType: string, prompt: string} | {ok: false, error: string}>}
 */
export async function generateTipCardImage(args = {}) {
  const { generateWithoutText } = await import('./aiImageTextGuard.js')
  return generateWithoutText(() => generateTipCardImageRaw(args), { label: 'tip card photo' })
}

async function generateTipCardImageRaw({ photoSubject } = {}) {
  if (!nanoBananaConfigured()) {
    return { ok: false, error: 'GEMINI_API_KEY not set' }
  }
  const { apiKey, model } = envBundle()

  const subject = String(photoSubject || '').trim() || DEFAULT_PHOTO_SUBJECT
  const prompt = TIP_STYLE_PROMPT.replace('{PHOTO_SUBJECT}', subject)

  try {
    const res = await axios.post(
      `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      },
      {
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        timeout: 30000,
        validateStatus: s => s < 500,
      }
    )
    if (res.status >= 400) {
      return { ok: false, error: res.data?.error?.message || `HTTP ${res.status}` }
    }
    const parts = res.data?.candidates?.[0]?.content?.parts || []
    const imagePart = parts.find(p => p.inlineData?.data)
    if (!imagePart) {
      return { ok: false, error: 'no image in response' }
    }
    return {
      ok: true,
      buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
      mimeType: imagePart.inlineData.mimeType || 'image/png',
      prompt,
    }
  } catch (e) {
    return { ok: false, error: e.message || 'request failed' }
  }
}

// Van scene generation (Gemini redrawing the van) was REMOVED 2026-10-11:
// image models redraw wrap lettering into misspellings. The van pillar uses
// the pixel-exact cutout composite (generateVanBackground below, which draws
// NO vehicles and NO text) or Mark's untouched photo.

export async function generateVanBackground(args) {
  const { generateWithoutText } = await import('./aiImageTextGuard.js')
  return generateWithoutText(() => generateVanBackgroundRaw(args), { label: 'van background' })
}

async function generateVanBackgroundRaw({ scenePrompt }) {
  if (!nanoBananaConfigured()) return { ok: false, error: 'GEMINI_API_KEY not set' }
  const { apiKey, model } = envBundle()
  const prompt = `Square 1:1 photographic image. ${String(scenePrompt || '').trim()}

HARD RULES:
- NO vehicles of any kind anywhere in the frame (a real van photo will be composited in later).
- The LOWER HALF of the frame is clear, level asphalt or concrete ground — empty parking area, driveway, or shop apron — where a full-size van will be placed.
- Camera at standing eye level, straight-on or very slight angle. Bright natural Pacific Northwest light, NOT moody or dark.
- Photo-realistic documentary photography. Western Washington: evergreens, realistic collision shop exteriors.
- NO people in the foreground. NO text, NO logos, NO watermarks, NO borders.`
  try {
    const res = await axios.post(
      `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } },
      { headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 45000, validateStatus: s => s < 500 }
    )
    if (res.status >= 400) return { ok: false, error: res.data?.error?.message || `HTTP ${res.status}` }
    const part = (res.data?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data)
    if (!part) return { ok: false, error: 'no image in response' }
    return { ok: true, buffer: Buffer.from(part.inlineData.data, 'base64'), mimeType: part.inlineData.mimeType || 'image/png', prompt }
  } catch (e) {
    return { ok: false, error: e.message || 'request failed' }
  }
}
