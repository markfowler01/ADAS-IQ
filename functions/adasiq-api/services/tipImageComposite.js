// Compose the daily Absolute ADAS tip-card image — Nano Banana photo as the
// background, with headline + bullets + footer painted on top via Sharp + SVG.
// All text uses Inter (the absolute-adas.com website typeface) embedded as
// @font-face in the SVG, so the brand reads identically every day.

import sharp from 'sharp'
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = path.join(__dirname, '..', 'assets')

const BRAND_ORANGE = '#CD4419'
const BRAND_DARK = '#0d0d0d'
const CARD_WHITE = '#ffffff'
const BULLET_DARK = '#374151'

const CANVAS = 1080

// Cache the font + logo bytes in memory across cron invocations
let _interBoldB64 = null
let _interRegularB64 = null
let _logoB64 = null

async function loadAssets() {
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

// Greedy word-wrap. Returns array of lines. Uses an approximate char-width
// (~0.55x the pixel font size for Inter Bold), then verifies via line count.
function wrapLines(text, maxCharsPerLine) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

// XML-escape a string for safe inclusion in SVG.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildSvgOverlay({ headline, bullets, interBoldB64, interRegularB64, logoB64 }) {
  // Layout knobs
  const headlineBandY = 0
  const headlineBandH = 480
  const cardX = 60
  const cardY = 530
  const cardW = CANVAS - 120
  const cardH = 420
  const footerH = 130
  const footerY = CANVAS - footerH

  // Headline: split into up to 3 lines depending on length
  const headlineUpper = String(headline || '').toUpperCase().trim()
  const headlineLines = wrapLines(headlineUpper, headlineUpper.length > 36 ? 22 : 26).slice(0, 3)
  const headlineLineCount = headlineLines.length
  // Pick a font size that fits comfortably for the line count
  const headlineFontSize = headlineLineCount >= 3 ? 70 : headlineLineCount === 2 ? 84 : 100
  const headlineLineHeight = Math.round(headlineFontSize * 1.06)
  const headlineBlockH = headlineLineHeight * headlineLineCount
  const headlineStartY = Math.round((headlineBandH - headlineBlockH) / 2) + Math.round(headlineFontSize * 0.78)

  const headlineSvgLines = headlineLines.map((line, i) =>
    `<text x="${CANVAS / 2}" y="${headlineStartY + i * headlineLineHeight}" class="headline">${esc(line)}</text>`
  ).join('\n  ')

  // Bullets — vertical stack inside the white card
  const bulletItems = (Array.isArray(bullets) ? bullets : []).slice(0, 6)
  const bulletFontSize = bulletItems.length >= 6 ? 28 : 32
  const bulletLineGap = Math.round((cardH - 60) / bulletItems.length)
  const bulletDotR = 8
  const bulletPadLeft = 50
  const bulletTextX = cardX + bulletPadLeft + 22 + 16
  const bulletDotX = cardX + bulletPadLeft + 22
  const bulletStartY = cardY + 40

  const bulletsSvg = bulletItems.map((b, i) => {
    const y = bulletStartY + i * bulletLineGap
    return `
  <circle cx="${bulletDotX}" cy="${y + bulletFontSize / 2 - 8}" r="${bulletDotR}" fill="${BRAND_ORANGE}"/>
  <text x="${bulletTextX}" y="${y + bulletFontSize - 6}" class="bullet">${esc(b)}</text>`
  }).join('')

  // Footer — logo + wordmark + tagline, horizontally centered as a block
  const logoSize = 70
  // Approximate wordmark width at 36px Inter Bold ≈ 0.55 * 36 * char count
  const wordmark = 'Absolute ADAS'
  const tagline = 'Driving safety forward, one calibration at a time.'
  const wordmarkApproxW = Math.round(wordmark.length * 36 * 0.55)
  const taglineApproxW = Math.round(tagline.length * 16 * 0.55)
  const textBlockW = Math.max(wordmarkApproxW, taglineApproxW)
  const totalBlockW = logoSize + 18 + textBlockW
  const blockStartX = Math.round((CANVAS - totalBlockW) / 2)
  const footerLogoY = footerY + Math.round((footerH - logoSize) / 2)
  const footerTextX = blockStartX + logoSize + 18

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <style type="text/css">
      @font-face { font-family: 'Inter'; src: url(data:font/ttf;base64,${interBoldB64}) format('truetype'); font-weight: 700; }
      @font-face { font-family: 'Inter'; src: url(data:font/ttf;base64,${interRegularB64}) format('truetype'); font-weight: 400; }
      .headline {
        font-family: 'Inter', sans-serif;
        font-weight: 700;
        font-size: ${headlineFontSize}px;
        fill: ${BRAND_ORANGE};
        text-anchor: middle;
        letter-spacing: -0.01em;
        paint-order: stroke;
        stroke: rgba(0,0,0,0.35);
        stroke-width: 4px;
      }
      .bullet {
        font-family: 'Inter', sans-serif;
        font-weight: 400;
        font-size: ${bulletFontSize}px;
        fill: ${BULLET_DARK};
        letter-spacing: -0.005em;
      }
      .wordmark {
        font-family: 'Inter', sans-serif;
        font-weight: 700;
        font-size: 36px;
        fill: #ffffff;
        letter-spacing: -0.01em;
      }
      .tagline {
        font-family: 'Inter', sans-serif;
        font-weight: 400;
        font-size: 16px;
        fill: rgba(255,255,255,0.78);
        letter-spacing: 0;
      }
    </style>
  </defs>
  <!-- Headline darken band -->
  <rect x="0" y="${headlineBandY}" width="${CANVAS}" height="${headlineBandH}" fill="rgba(0,0,0,0.55)"/>
  <!-- Headline -->
  ${headlineSvgLines}
  <!-- White bullet card -->
  <rect x="${cardX - 4}" y="${cardY - 4 + 8}" width="${cardW + 8}" height="${cardH + 8}" rx="22" ry="22" fill="rgba(0,0,0,0.25)"/>
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="18" ry="18" fill="${CARD_WHITE}"/>
  ${bulletsSvg}
  <!-- Footer band -->
  <rect x="0" y="${footerY}" width="${CANVAS}" height="${footerH}" fill="${BRAND_DARK}"/>
  <image href="data:image/png;base64,${logoB64}" x="${blockStartX}" y="${footerLogoY}" width="${logoSize}" height="${logoSize}"/>
  <text x="${footerTextX}" y="${footerY + 56}" class="wordmark">${esc(wordmark)}</text>
  <text x="${footerTextX}" y="${footerY + 86}" class="tagline">${esc(tagline)}</text>
</svg>`
}

/**
 * Compose the final tip-card image.
 *
 * @param {Object} args
 * @param {Buffer} args.photoBuffer — Nano Banana PNG (any dimensions; fitted to 1080x1080)
 * @param {string} args.headline    — punchy headline (4–9 words)
 * @param {string[]} args.bullets   — 5–6 short bullet items
 * @returns {Promise<Buffer>} composited PNG (1080x1080)
 */
export async function composeTipImage({ photoBuffer, headline, bullets }) {
  const { interBoldB64, interRegularB64, logoB64 } = await loadAssets()

  // Photo → 1080x1080 cover
  const photo = await sharp(photoBuffer)
    .resize(CANVAS, CANVAS, { fit: 'cover', position: 'center' })
    .toBuffer()

  const svg = buildSvgOverlay({ headline, bullets, interBoldB64, interRegularB64, logoB64 })

  // Composite SVG overlay on photo, output PNG
  const final = await sharp(photo)
    .composite([{ input: Buffer.from(svg, 'utf-8'), top: 0, left: 0 }])
    .png()
    .toBuffer()

  return final
}
