// Capture campaign — Nano Banana image generator for LinkedIn post variants.
//
// Design intent: editorial typography on cream background with orange accent.
// Same brand DNA as the newsletter cover but tuned for LinkedIn's 1200x627
// landscape aspect. NO photorealistic faces, NO stock-style shop photos —
// just type on cream with the orange brand mark. Low-risk, high-recognition,
// matches everything else readers see from Absolute ADAS.
//
// Kill switch: CAPTURE_IMAGES_ENABLED env var. Set to "true" to allow live use.
// Otherwise enabled() returns false and the pipeline silently falls back to
// text-only posts. Per-call override via opts.force = true.

import axios from 'axios'
import { commitBinaryFile } from './brewArchive.js'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

function envBundle() {
  return {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
    enabled: String(process.env.CAPTURE_IMAGES_ENABLED || '').toLowerCase() === 'true',
  }
}

export function captureImagesEnabled() {
  const { apiKey, enabled } = envBundle()
  return Boolean(apiKey && enabled)
}

// Style anchor. Plain typography. NO people, NO photo elements. This keeps
// us safely away from uncanny-AI-face territory and ensures consistency
// across every post. Tweak only this string to evolve the look.
const STYLE_PROMPT = `Editorial social-post graphic, landscape 1200x627 (LinkedIn share size).
Cream background (#f5f3f0). Bold orange accent (#CD4419).
Top-left: small monospace caps "ABSOLUTE ADAS" in dark gray (#1a1a1a), with a tiny orange dot before the text. Thin orange underline rule below the wordmark.
Center-left: large bold serif typography in near-black (#1a1a1a) reading "{HEADLINE}". Multi-line OK, generous line spacing, left-aligned, takes up about 60% of the width.
Bottom-left: small monospace text in gray reading "absoluteadas.com/calculator".
Top-right corner: a small, abstract orange editorial accent element — could be a thin underline, a small geometric mark, or a single character glyph. Tasteful, minimal.
NO people, NO faces, NO stock-photo elements, NO illustrations of cars or shops. Type-only design.
Magazine-quality editorial layout. Clean, minimal, lots of negative space. High-end print design feel.`

/**
 * Generate a LinkedIn-share-sized image for one post variant.
 * @param {Object} args
 * @param {string} args.headline - The hook line to feature visually
 * @param {string} args.draftId  - Used as the filename for the GitHub commit
 * @param {Object} [opts]
 * @param {boolean} [opts.force] - Bypass the CAPTURE_IMAGES_ENABLED gate
 * @returns {Promise<{ok: true, url: string, prompt: string} | {ok: false, error: string}>}
 */
export async function generateCaptureImage({ headline, draftId }, opts = {}) {
  const { apiKey, model, enabled } = envBundle()
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY not configured' }
  if (!opts.force && !enabled) return { ok: false, error: 'CAPTURE_IMAGES_ENABLED is not true (kill switch off)' }
  if (!headline) return { ok: false, error: 'headline required' }
  if (!draftId) return { ok: false, error: 'draftId required' }

  const safeHeadline = String(headline).trim().slice(0, 100)
  const prompt = STYLE_PROMPT.replace('{HEADLINE}', safeHeadline)

  try {
    const res = await axios.post(
      `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      },
      {
        params: { key: apiKey },
        timeout: 60000,
        validateStatus: s => s < 500,
      }
    )
    if (res.status >= 300) {
      return { ok: false, error: `Gemini ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}` }
    }
    const parts = res.data?.candidates?.[0]?.content?.parts || []
    const imgPart = parts.find(p => p.inlineData?.data)
    if (!imgPart) return { ok: false, error: 'no image part in response' }
    const buffer = Buffer.from(imgPart.inlineData.data, 'base64')

    // Commit to GitHub Pages so the image has a permanent public URL
    const path = `capture-images/${draftId}.png`
    const r = await commitBinaryFile({
      path,
      buffer,
      message: `Capture campaign image: ${draftId}`,
    })
    if (!r?.ok) return { ok: false, error: r?.error || 'github commit failed' }
    const url = `https://absoluteadas.com/${path}`
    return { ok: true, url, prompt }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}
