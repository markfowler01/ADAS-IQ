// Van post image finishing + verification.
//
// 1. compositeVanFooter — stamps the SAME locked dark brand footer used on
//    every other marketing image (brew tips, capture posts): #0d0d0d band,
//    orange logo, "Absolute"(white)+"ADAS"(orange) Inter Bold wordmark,
//    "Mobile ADAS calibration · Western Washington" tagline. Mark: "keep the
//    same footer that's in all my other marketing" (2026-07-05).
//
// 2. verifyVanWrap — Claude vision check that the van in a GENERATED image
//    is actually Mark's van: every wrap string must be crisp and verbatim.
//    Gemini image-to-image loves to redraw lettering into mush; any mangled
//    text fails verification and the caller falls back to the real photo.

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import Anthropic from '@anthropic-ai/sdk'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = path.join(__dirname, '..', 'assets')

const BRAND_ORANGE = '#CD4419'
const BRAND_DARK = '#0d0d0d'

let _logoB64 = null
let _interBoldB64 = null
let _interRegularB64 = null
async function loadAssets() {
  if (!_logoB64) _logoB64 = (await fs.readFile(path.join(ASSETS_DIR, 'absolute-adas-logo.png'))).toString('base64')
  if (!_interBoldB64) _interBoldB64 = (await fs.readFile(path.join(ASSETS_DIR, 'fonts', 'Inter-Bold.ttf'))).toString('base64')
  if (!_interRegularB64) _interRegularB64 = (await fs.readFile(path.join(ASSETS_DIR, 'fonts', 'Inter-Regular.ttf'))).toString('base64')
  return { logoB64: _logoB64, interBoldB64: _interBoldB64, interRegularB64: _interRegularB64 }
}

function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Stamp the locked dark brand footer onto a van photo/scene.
 * @param {Buffer} imageBuffer — PNG/JPEG
 * @returns {Promise<Buffer>} PNG with footer band
 */
export async function compositeVanFooter(imageBuffer) {
  const { logoB64, interBoldB64, interRegularB64 } = await loadAssets()
  const meta = await sharp(imageBuffer).metadata()
  const baseW = meta.width || 1080
  const baseH = meta.height || 1080

  // LOCKED footer geometry — matches captureImage.js / tipImageComposite.js.
  const footerH = 170
  const footerY = baseH - footerH
  const logoSize = Math.round(footerH * 0.62)
  const wordmarkFontSize = Math.round(footerH * 0.34)
  const taglineFontSize = Math.round(footerH * 0.15)
  const wordmarkWhite = 'Absolute'
  const wordmarkOrange = 'ADAS'
  const tagline = 'Mobile ADAS calibration  ·  Western Washington'

  const wordmarkApproxW = Math.round((wordmarkWhite.length + 1 + wordmarkOrange.length) * wordmarkFontSize * 0.58)
  const taglineApproxW = Math.round(tagline.length * taglineFontSize * 0.55)
  const textBlockW = Math.max(wordmarkApproxW, taglineApproxW)
  const totalBlockW = logoSize + 20 + textBlockW
  const blockStartX = Math.max(Math.round(baseW * 0.04), Math.round((baseW - totalBlockW) / 2))
  const footerLogoY = footerY + Math.round((footerH - logoSize) / 2)
  const footerTextX = blockStartX + logoSize + 20
  const wordmarkWhiteApproxW = Math.round(wordmarkWhite.length * wordmarkFontSize * 0.58)
  const wordmarkY = footerY + Math.round(footerH * 0.50)
  const wordmarkOrangeX = footerTextX + wordmarkWhiteApproxW + Math.round(wordmarkFontSize * 0.30)
  const taglineY = footerY + Math.round(footerH * 0.78)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${baseW}" height="${baseH}" viewBox="0 0 ${baseW} ${baseH}">
    <defs>
      <style type="text/css">
        @font-face { font-family: 'Inter'; src: url(data:font/ttf;base64,${interBoldB64}) format('truetype'); font-weight: 700; }
        @font-face { font-family: 'Inter'; src: url(data:font/ttf;base64,${interRegularB64}) format('truetype'); font-weight: 400; }
        .wm-white { font-family: 'Inter', sans-serif; font-weight: 700; font-size: ${wordmarkFontSize}px; fill: #ffffff; letter-spacing: -0.015em; }
        .wm-orange { font-family: 'Inter', sans-serif; font-weight: 700; font-size: ${wordmarkFontSize}px; fill: ${BRAND_ORANGE}; letter-spacing: -0.015em; }
        .tagline { font-family: 'Inter', sans-serif; font-weight: 400; font-size: ${taglineFontSize}px; fill: rgba(255,255,255,0.85); }
      </style>
    </defs>
    <rect x="0" y="${footerY - 8}" width="${baseW}" height="${footerH + 8}" fill="${BRAND_DARK}"/>
    <text x="${footerTextX}" y="${wordmarkY}" class="wm-white">${wordmarkWhite}</text>
    <text x="${wordmarkOrangeX}" y="${wordmarkY}" class="wm-orange">${wordmarkOrange}</text>
    <text x="${footerTextX}" y="${taglineY}" class="tagline">${escXml(tagline)}</text>
    <image x="${blockStartX}" y="${footerLogoY}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${logoB64}"/>
  </svg>`

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg, 'utf-8'), top: 0, left: 0 }])
    .png()
    .toBuffer()
}

/**
 * Composite a pixel-exact van cutout (transparent PNG) onto a generated
 * background: van scaled to ~86% of frame width, seated in the lower third,
 * soft elliptical ground shadow underneath. The van pixels are Mark's real
 * photo — no AI ever touches them.
 *
 * @param {Object} args
 * @param {Buffer} args.cutoutBuffer     — van cutout PNG with alpha
 * @param {Buffer} args.backgroundBuffer — generated scene
 * @param {number} [args.size]           — output square edge (default 1080)
 * @returns {Promise<Buffer>} PNG (footer NOT included — call compositeVanFooter after)
 */
export async function compositeVanOnBackground({ cutoutBuffer, backgroundBuffer, size = 1080 }) {
  const bg = await sharp(backgroundBuffer).resize(size, size, { fit: 'cover' }).png().toBuffer()

  const cutMeta = await sharp(cutoutBuffer).metadata()
  const vanW = Math.round(size * 0.86)
  const vanH = Math.round(cutMeta.height * (vanW / cutMeta.width))
  const van = await sharp(cutoutBuffer).resize(vanW, vanH).png().toBuffer()

  const vanX = Math.round((size - vanW) / 2)
  // Van bottom sits above the footer band (170px) with breathing room.
  const vanBottom = size - 170 - Math.round(size * 0.06)
  const vanY = vanBottom - vanH

  // Soft ground shadow: blurred ellipse under the van.
  const shadowRx = Math.round(vanW * 0.48)
  const shadowRy = Math.round(vanH * 0.07)
  const shadowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs><filter id="b" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="14"/></filter></defs>
    <ellipse cx="${size / 2}" cy="${vanBottom - Math.round(shadowRy * 0.4)}" rx="${shadowRx}" ry="${shadowRy}" fill="rgba(0,0,0,0.45)" filter="url(#b)"/>
  </svg>`

  return sharp(bg)
    .composite([
      { input: Buffer.from(shadowSvg, 'utf-8'), top: 0, left: 0 },
      { input: van, top: vanY, left: vanX },
    ])
    .png()
    .toBuffer()
}

// The wrap copy that must survive VERBATIM in any generated image of the van.
// Taken from the real 2023 ProMaster wrap.
export const VAN_WRAP_STRINGS = [
  'Absolute ADAS',
  'SAME DAY.',
  'DONE RIGHT.',
  '50,000+ CALIBRATIONS',
  '1-844-FIX-ADAS',
  'AbsoluteADAS.com',
  'MOBILE ADAS CALIBRATION',
]

/**
 * Vision-verify that a generated image shows Mark's ACTUAL van — white Ram
 * ProMaster, high roof, with every wrap string crisp and correctly spelled.
 *
 * @param {Buffer} imageBuffer
 * @param {string} [mimeType]
 * @returns {Promise<{ok: boolean, issues: string[]}>}
 */
export async function verifyVanWrap(imageBuffer, mimeType = 'image/png') {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: true, issues: ['verification skipped: no ANTHROPIC_API_KEY'] }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const mediaType = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType) ? mimeType : 'image/png'
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
        {
          type: 'text',
          text: `This image should show a real company service van: a WHITE Ram ProMaster HIGH-ROOF van with a vinyl wrap. Inspect the van's wrap lettering carefully.

The wrap must contain these strings, readable and correctly spelled (whichever are visible from this angle):
${VAN_WRAP_STRINGS.map(s => `- "${s}"`).join('\n')}

FAIL the check if ANY visible lettering on the van is garbled, misspelled, melted, duplicated, invented (text that isn't in the list), or AI-mangled in any way. Also FAIL if the van is not a white high-roof ProMaster, or the wrap layout looks redrawn rather than photographed.

PASS only if the van looks like an authentic photograph of this exact wrapped van with clean, correct lettering.

Respond with ONLY a JSON object — no preamble, no markdown, no explanation outside the JSON: {"ok": true/false, "issues": ["specific problem", ...]}`,
        },
      ],
    }],
  })
  const raw = (msg.content?.[0]?.text || '').trim()
  // Robust extraction: take the outermost {...} even if the model added a
  // prose preamble or markdown fences (the model rejects assistant prefill,
  // so we can't force pure JSON output).
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  const jsonSlice = start >= 0 && end > start ? raw.slice(start, end + 1) : raw
  try {
    const parsed = JSON.parse(jsonSlice)
    return { ok: Boolean(parsed.ok), issues: Array.isArray(parsed.issues) ? parsed.issues : [] }
  } catch {
    // Unparseable verdict — be conservative, fail the check
    return { ok: false, issues: [`unparseable verifier response: ${raw.slice(0, 120)}`] }
  }
}
