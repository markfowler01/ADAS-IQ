// Absolute ADAS daily ad card image.
//
// Real van photo → cover → bottom-half dark gradient for readability →
// eyebrow ("ABSOLUTE ADAS · DAILY"), big single-line headline, phone
// bar, "SAME DAY. DONE RIGHT." wordmark. 1080×1080, Instagram-safe,
// works cross-channel.
//
// Design notes:
//   - Photo is treated as "the hero" — copy is minimal so the van + tech
//     read at thumbnail size.
//   - Headline autosizes to fit the width. Two-line max.
//   - Bottom strip (~28% of canvas) carries the CTA + brand. Darkened
//     enough that phone number reads white on any photo.
//   - No bullets, no small print, no dates — the copy in the caption
//     does the heavy lifting; the image is the scroll-stopper.

import sharp from 'sharp'
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = path.join(__dirname, '..', 'assets')

const BRAND_ORANGE = '#CD4419'
const CANVAS = 1080

let _interBoldB64 = null
let _interRegularB64 = null
let _logoB64 = null

async function loadFonts() {
  if (!_interBoldB64) {
    const buf = await fs.readFile(path.join(ASSETS_DIR, 'fonts', 'Inter-Bold.ttf'))
    _interBoldB64 = buf.toString('base64')
  }
  if (!_interRegularB64) {
    const buf = await fs.readFile(path.join(ASSETS_DIR, 'fonts', 'Inter-Regular.ttf'))
    _interRegularB64 = buf.toString('base64')
  }
  if (!_logoB64) {
    const buf = await fs.readFile(path.join(ASSETS_DIR, 'absolute-adas-logo.png'))
    _logoB64 = buf.toString('base64')
  }
  return { interBoldB64: _interBoldB64, interRegularB64: _interRegularB64, logoB64: _logoB64 }
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * Fit a headline into the card width by picking a font size + line count.
 * Simple heuristic — Inter Bold ≈ 0.55× fontSize per character.
 * Prefers ONE line; falls back to TWO if the string is long.
 */
function fitHeadline(headline, maxWidthPx = 960) {
  const clean = String(headline || '').trim().toUpperCase()
  const words = clean.split(/\s+/)
  const totalChars = clean.length
  // Try one-line sizes, largest first
  for (const size of [128, 116, 104, 92, 84]) {
    const width = totalChars * size * 0.55
    if (width <= maxWidthPx) {
      return { lines: [clean], fontSize: size }
    }
  }
  // Two-line split — balance by word count
  const half = Math.ceil(words.length / 2)
  const line1 = words.slice(0, half).join(' ')
  const line2 = words.slice(half).join(' ')
  for (const size of [92, 84, 76, 68]) {
    const w1 = line1.length * size * 0.55
    const w2 = line2.length * size * 0.55
    if (Math.max(w1, w2) <= maxWidthPx) {
      return { lines: [line1, line2], fontSize: size }
    }
  }
  // Give up and cram it
  return { lines: [line1, line2], fontSize: 68 }
}

/**
 * Build the SVG overlay drawn on top of the van photo.
 */
function buildSvgOverlay({ imageHeadline, interBoldB64, interRegularB64, logoB64 }) {
  const fit = fitHeadline(imageHeadline, 960)
  const phone = '1-844-FIX-ADAS'
  const tagline = 'SAME DAY. DONE RIGHT.'

  // Bottom strip covers the lower ~44% of canvas
  const stripY = Math.round(CANVAS * 0.56)
  const stripH = CANVAS - stripY

  // Phone CTA bar — DOMINANT element on the card. Layout inside the bar:
  //   small CTA label ("→ TAP TO TEXT THE VAN")
  //   giant phone number (biggest single element on the whole card)
  const ctaBarH = 180
  const ctaBarY = CANVAS - 260            // top of orange strip
  const ctaLabelY = ctaBarY + 44          // baseline of the "TAP TO TEXT" line
  const ctaPhoneY = ctaBarY + 138         // baseline of the phone number
  const phoneFontSize = 90                // was 46 — nearly 2× bigger, dominates
  const ctaLabelFontSize = 26             // was 22 — slightly bigger
  // Tagline strip (below the orange bar) — bigger + bolder per Mark's earlier ask
  const taglineFontSize = 42
  const taglineY = CANVAS - 34            // baseline

  // Headline block — vertically centered in the space between the top of
  // the bottom fade and the top of the CTA bar. Prevents cramping now that
  // the CTA bar is much taller.
  const headlineBlockH = fit.lines.length * (fit.fontSize + 12) - 12
  const headlineAreaH = ctaBarY - stripY
  const headlineTopY = stripY + Math.round((headlineAreaH - headlineBlockH) / 2)
  const headlineTspans = fit.lines.map((line, i) => {
    if (i === 0) return `<tspan x="${CANVAS / 2}" y="${headlineTopY + fit.fontSize - 6}">${esc(line)}</tspan>`
    return `<tspan x="${CANVAS / 2}" dy="${fit.fontSize + 12}">${esc(line)}</tspan>`
  }).join('')

  // Top-right logo + wordmark ─────────────────────────────────────────
  // Logo image + "Absolute ADAS" (split-color: white + orange) right-aligned.
  const logoSize = 74
  const wordmarkFontSize = 32
  const wordmarkWhite = 'Absolute'
  const wordmarkOrange = 'ADAS'
  const wordmarkGap = 12  // px between logo and wordmark
  // Approximate widths (Inter Bold ≈ 0.55× fontSize per char)
  const wordmarkWhiteW = Math.round(wordmarkWhite.length * wordmarkFontSize * 0.55)
  const wordmarkOrangeW = Math.round(wordmarkOrange.length * wordmarkFontSize * 0.55)
  const wordmarkSpace = Math.round(wordmarkFontSize * 0.28)
  const wordmarkTotalW = wordmarkWhiteW + wordmarkSpace + wordmarkOrangeW
  const brandBlockW = logoSize + wordmarkGap + wordmarkTotalW
  const rightMargin = 40
  const topMargin = 40
  const brandBlockRight = CANVAS - rightMargin
  const brandBlockLeft = brandBlockRight - brandBlockW
  const logoX = brandBlockLeft
  const logoY = topMargin
  const wordmarkStartX = logoX + logoSize + wordmarkGap
  // Vertical center of wordmark against logo
  const wordmarkBaselineY = logoY + Math.round(logoSize / 2) + Math.round(wordmarkFontSize / 3)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <style type="text/css">
      @font-face { font-family: 'Inter'; src: url(data:font/ttf;base64,${interBoldB64}) format('truetype'); font-weight: 700; }
      @font-face { font-family: 'Inter'; src: url(data:font/ttf;base64,${interRegularB64}) format('truetype'); font-weight: 400; }
      .headline { font-family: 'Inter'; font-weight: 700; font-size: ${fit.fontSize}px; fill: #ffffff; text-anchor: middle; letter-spacing: -0.01em; }
      .phone { font-family: 'Inter'; font-weight: 700; font-size: ${phoneFontSize}px; fill: #ffffff; text-anchor: middle; letter-spacing: 0.05em; }
      .phone-label { font-family: 'Inter'; font-weight: 700; font-size: ${ctaLabelFontSize}px; fill: #ffffff; text-anchor: middle; letter-spacing: 0.32em; }
      .tagline { font-family: 'Inter'; font-weight: 700; font-size: ${taglineFontSize}px; fill: #ffffff; text-anchor: middle; letter-spacing: 0.14em; }
      .brand-white { font-family: 'Inter'; font-weight: 700; font-size: ${wordmarkFontSize}px; fill: #ffffff; letter-spacing: -0.005em; }
      .brand-orange { font-family: 'Inter'; font-weight: 700; font-size: ${wordmarkFontSize}px; fill: ${BRAND_ORANGE}; letter-spacing: -0.005em; }
    </style>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,0)"/>
      <stop offset="30%" stop-color="rgba(0,0,0,0.55)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.95)"/>
    </linearGradient>
    <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,0.62)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </linearGradient>
  </defs>

  <!-- top darken (protects logo readability on light photos) -->
  <rect x="0" y="0" width="${CANVAS}" height="200" fill="url(#topFade)"/>

  <!-- bottom fade -->
  <rect x="0" y="${stripY}" width="${CANVAS}" height="${stripH}" fill="url(#bottomFade)"/>

  <!-- Top-right brand: logo + Absolute ADAS wordmark -->
  <image href="data:image/png;base64,${logoB64}" x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>
  <text x="${wordmarkStartX}" y="${wordmarkBaselineY}" class="brand-white">${esc(wordmarkWhite)}</text>
  <text x="${wordmarkStartX + wordmarkWhiteW + wordmarkSpace}" y="${wordmarkBaselineY}" class="brand-orange">${esc(wordmarkOrange)}</text>

  <!-- headline -->
  <text class="headline">${headlineTspans}</text>

  <!-- Phone CTA bar — dominant element, arrow prefix + tap invitation -->
  <rect x="0" y="${ctaBarY}" width="${CANVAS}" height="${ctaBarH}" fill="${BRAND_ORANGE}"/>
  <text x="${CANVAS / 2}" y="${ctaLabelY}" class="phone-label">→ TAP TO TEXT THE VAN</text>
  <text x="${CANVAS / 2}" y="${ctaPhoneY}" class="phone">${esc(phone)}</text>

  <!-- Tagline (bolder + bigger per Mark's ask) -->
  <text x="${CANVAS / 2}" y="${taglineY}" class="tagline">${esc(tagline)}</text>
</svg>`
}

/**
 * Compose the ad card image.
 * @param {Object} args
 * @param {Buffer} args.photoBuffer  real van photo (any dimensions)
 * @param {string} args.imageHeadline  4-7 words ALL CAPS
 * @returns {Promise<Buffer>} 1080×1080 PNG
 */
export async function composeAdCardImage({ photoBuffer, imageHeadline }) {
  const { interBoldB64, interRegularB64, logoB64 } = await loadFonts()

  // Cover crop with a vertical bias toward keeping the BOTTOM of the source
  // photo (where the van + tech usually are — phone shots typically frame
  // with sky above). Predictable across all photos, unlike 'attention'
  // which picked inconsistent focal points.
  const meta = await sharp(photoBuffer).metadata()
  const srcW = meta.width || CANVAS
  const srcH = meta.height || CANVAS
  const scale = Math.max(CANVAS / srcW, CANVAS / srcH)
  const scaledW = Math.round(srcW * scale)
  const scaledH = Math.round(srcH * scale)
  // Horizontal: center
  const cropX = Math.max(0, Math.round((scaledW - CANVAS) / 2))
  // Vertical: skip 70% of the excess from the top so the crop retains the
  // bottom of the source (van + tech). At 50% (center) we saw the van
  // sitting too low; biasing higher brings it up toward vertical center.
  const vExcess = Math.max(0, scaledH - CANVAS)
  const cropY = Math.round(vExcess * 0.70)

  const photo = await sharp(photoBuffer)
    .resize(scaledW, scaledH, { fit: 'fill' })
    .extract({ left: cropX, top: cropY, width: CANVAS, height: CANVAS })
    .toBuffer()

  const svg = buildSvgOverlay({ imageHeadline, interBoldB64, interRegularB64, logoB64 })

  const final = await sharp(photo)
    .composite([{ input: Buffer.from(svg, 'utf-8'), top: 0, left: 0 }])
    .png()
    .toBuffer()

  return final
}
