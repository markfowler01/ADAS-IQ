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
Bottom: small monospace text in gray reading "absoluteadas.com/brew".
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
export async function generateTipCardImage({ photoSubject } = {}) {
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

// ─── Van-in-the-field scene (image-to-image) ────────────────────────────────
// Takes a REAL photo of Mark's wrapped service van as the reference image and
// asks Gemini to place that exact van into the day's scene. The wrap ("SAME
// DAY. DONE RIGHT.", Absolute ADAS logo, 1-844-FIX-ADAS) must survive intact —
// that wrap IS the branding, so no SVG composite is layered on afterward.
const VAN_SCENE_RULES = `
ABSOLUTE RULE — THE VAN IS IMMUTABLE:
Treat the van in the reference photo as a LOCKED, UNEDITABLE object — like a cut-out sticker placed into a new background. You may change ONLY the environment around the van (background, ground, lighting direction, weather). You may NOT redraw, repaint, re-render, re-typeset, resize, mirror, or "improve" the van itself in any way.
- Every letter, word, number, and graphic on the wrap must appear EXACTLY as photographed, pixel-faithful: "Absolute ADAS" logo, "MOBILE ADAS CALIBRATION · WESTERN WASHINGTON", "SAME DAY. DONE RIGHT.", "50,000+ CALIBRATIONS", "OEM TARGETS STATIC + DYNAMIC", "For Collision & Glass shops. We come to you.", "1-844-FIX-ADAS", "AbsoluteADAS.com", and the red circuit-pattern details.
- If a wrap element would be unreadable at the new angle, keep the SAME camera angle as the reference photo instead of inventing new lettering.
- Do NOT mirror the van or show its opposite side (the graphics would be fabricated).
- Same wheels, same mirrors, same proportions, same roof height.

SCENE RULES:
- Photo-realistic documentary photography. Natural light. No glossy advertisement look.
- Square 1:1 framing, van prominent and unobstructed.
- Western Washington, USA setting: evergreen trees, Pacific Northwest light, realistic collision shop exteriors.
- NO added text, NO added logos, NO watermarks, NO borders anywhere in the image.
- People, if any, are background only — small, out of focus, no faces in detail.`

/**
 * Generate a van-in-the-field scene from a real van photo + scene direction.
 * @param {Object} args
 * @param {Buffer} args.vanPhotoBuffer — real photo of the wrapped van
 * @param {string} args.vanPhotoMime   — e.g. "image/jpeg"
 * @param {string} args.scenePrompt    — day-specific scene description
 * @returns {Promise<{ok: true, buffer: Buffer, mimeType: string, prompt: string} | {ok: false, error: string}>}
 */
export async function generateVanSceneImage({ vanPhotoBuffer, vanPhotoMime = 'image/jpeg', scenePrompt }) {
  if (!nanoBananaConfigured()) return { ok: false, error: 'GEMINI_API_KEY not set' }
  if (!vanPhotoBuffer?.length) return { ok: false, error: 'vanPhotoBuffer required' }
  const { apiKey, model } = envBundle()

  const prompt = `Using the attached reference photo of this exact service van, create a new photograph placing this van in the following scene:\n\n${String(scenePrompt || '').trim()}\n${VAN_SCENE_RULES}`

  try {
    const res = await axios.post(
      `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
      {
        contents: [{
          parts: [
            { inlineData: { mimeType: vanPhotoMime, data: vanPhotoBuffer.toString('base64') } },
            { text: prompt },
          ],
        }],
        generationConfig: { responseModalities: ['IMAGE'] },
      },
      {
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        timeout: 45000,
        validateStatus: s => s < 500,
      }
    )
    if (res.status >= 400) {
      return { ok: false, error: res.data?.error?.message || `HTTP ${res.status}` }
    }
    const parts = res.data?.candidates?.[0]?.content?.parts || []
    const imagePart = parts.find(p => p.inlineData?.data)
    if (!imagePart) return { ok: false, error: 'no image in response' }
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

/**
 * Generate a BACKGROUND-ONLY scene for the van composite path. No vehicles —
 * the real van cutout gets composited on top in code, so the lower half must
 * be clear, level ground where a van can plausibly park.
 * @param {{scenePrompt: string}} args
 */
export async function generateVanBackground({ scenePrompt }) {
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
