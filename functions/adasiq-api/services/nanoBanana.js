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

// Style anchor — locked across every daily issue so the brand reads consistent
// even though the image is freshly generated. Tweak this string to evolve the
// look (single source of truth, not per-call).
const STYLE_PROMPT = `Editorial newsletter cover, square 1080x1080.
Cream background (#f5f3f0). Bold orange accent (#CD4419).
At the top, horizontally arranged: a small minimalist line-drawing icon of a steaming coffee cup (one or two thin steam squiggles, in the same orange #CD4419 as the wordmark, simple line art, no fill) immediately followed by small monospace caps reading "ADAS BREW". A thin orange underline rule below the wordmark.
Below the rule, smaller monospace caps in dark gray reading "{ISSUE_LINE}".
Center of the image: large bold serif typography in near-black (#1a1a1a) reading "{HEADLINE}". Multi-line if needed, generous line spacing.
Bottom: small monospace text in gray reading "adas-iq.com/brew".
Magazine-quality editorial layout. Clean, minimal, lots of negative space. No people, no photographs — only the small line-art coffee cup as illustration, otherwise just type on cream with the orange accent. High-end print design feel.`

/**
 * Generate the daily cover image.
 *
 * @param {Object} args
 * @param {number|string} args.issueNumber — e.g. 7
 * @param {string} args.dateISO            — e.g. "2026-05-12"
 * @param {string} args.headline           — the email subject for this issue
 * @returns {Promise<{ok: true, buffer: Buffer, mimeType: string, prompt: string} | {ok: false, error: string}>}
 */
export async function generateCoverImage({ issueNumber, dateISO, headline }) {
  if (!nanoBananaConfigured()) {
    return { ok: false, error: 'GEMINI_API_KEY not set' }
  }
  const { apiKey, model } = envBundle()

  const issueLine = formatIssueLine(issueNumber, dateISO)
  const safeHeadline = String(headline || '').trim().slice(0, 120)
  const prompt = STYLE_PROMPT
    .replace('{ISSUE_LINE}', issueLine)
    .replace('{HEADLINE}', safeHeadline)

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
      const apiErr = res.data?.error?.message || `HTTP ${res.status}`
      return { ok: false, error: apiErr }
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

// Absolute ADAS calibration-tip post — Nano Banana generates ONLY the
// photographic background. The headline, bullet card, and logo footer are
// composited in code (see services/tipImageComposite.js) for pixel-perfect
// brand consistency. The AI is allowed to interpret the photo but is told
// explicitly NOT to render any text, logos, or graphics.
const TIP_STYLE_PROMPT = `Square photographic image, 1080x1080.

Subject: a dramatic moody close-up of a modern vehicle's front-end. Could be a headlight cluster, ADAS sensor housing, grille, windshield camera region, or front quarter-panel — whichever makes for the most cinematic shot. ADAS hardware (cameras, radar, sensors) should be visible or implied.

Lighting: cinematic low-key. Dark blues, blacks, and gunmetal grays dominate. Subtle teal-blue highlights catch the metal and glass edges. Shallow depth of field. Photo-realistic, professional automotive editorial photography quality.

The TOP portion (upper 45%) of the photo should have darker, less-detailed areas (sky, shadow, or out-of-focus background) so headline text can be cleanly overlaid later. The MIDDLE 35% can have the main subject. The BOTTOM 10% will be covered by a graphic footer — keep it visually quiet there too.

CRITICAL: NO TEXT, NO LOGOS, NO WATERMARKS, NO GRAPHICS, NO BORDERS. Just the photograph. Do not add any words, captions, headlines, or branding of any kind to the image — text and branding will be added later in code.`

/**
 * Generate the photographic background for the daily Absolute ADAS tip card.
 * Headline, bullets, and logo are composited on top in code afterward.
 *
 * @returns {Promise<{ok: true, buffer: Buffer, mimeType: string, prompt: string} | {ok: false, error: string}>}
 */
export async function generateTipCardImage(/* headline + bullets unused now — composed in code */) {
  if (!nanoBananaConfigured()) {
    return { ok: false, error: 'GEMINI_API_KEY not set' }
  }
  const { apiKey, model } = envBundle()

  const prompt = TIP_STYLE_PROMPT

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

function formatIssueLine(issueNumber, dateISO) {
  let dateLabel = ''
  if (dateISO) {
    try {
      const d = new Date(dateISO + (dateISO.length === 10 ? 'T12:00:00Z' : ''))
      dateLabel = d.toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      })
    } catch {
      dateLabel = dateISO
    }
  }
  return `ISSUE #${issueNumber}${dateLabel ? ' · ' + dateLabel : ''}`
}
