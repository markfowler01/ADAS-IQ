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

// Greedy word-wrap. Returns array of lines.
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

// Smart headline split — prefer natural breaks at periods, em-dashes, semicolons,
// or colons before falling back to word-wrap. Always returns 1, 2, or 3 lines
// (never truncates content). Used to lay out the editorial headline.
function splitHeadline(text, targetMaxCharsPerLine = 22) {
  const clean = String(text || '').trim()
  if (!clean) return []

  // Try splitting at sentence-level delimiters first
  const sentenceBreak = clean.match(/^(.+?[.!?:;])\s+(.+)$/)
  if (sentenceBreak) {
    const a = sentenceBreak[1].trim()
    const b = sentenceBreak[2].trim()
    // If each half fits roughly within target, use them as-is
    if (a.length <= targetMaxCharsPerLine + 6 && b.length <= targetMaxCharsPerLine + 6) {
      return [a, b]
    }
    // Otherwise word-wrap each half and stitch
    const aLines = wrapLines(a, targetMaxCharsPerLine)
    const bLines = wrapLines(b, targetMaxCharsPerLine)
    return [...aLines, ...bLines].slice(0, 3)
  }

  // Try em-dash
  const dashBreak = clean.match(/^(.+?)\s*[—–-]\s*(.+)$/)
  if (dashBreak) {
    const a = dashBreak[1].trim()
    const b = dashBreak[2].trim()
    if (a.length <= targetMaxCharsPerLine + 6 && b.length <= targetMaxCharsPerLine + 6) {
      return [a, b]
    }
  }

  // Fallback to greedy word-wrap, allow up to 3 lines
  return wrapLines(clean, targetMaxCharsPerLine).slice(0, 3)
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

function buildSvgOverlay({ eyebrow, headline, headlineEmphasis, bullets, interBoldB64, interRegularB64, logoB64 }) {
  // Layout knobs — tightened so the photo breathes and the card isn't cavernous
  const headlineBandY = 0
  const headlineBandH = 480
  const cardX = 60
  const cardY = 560
  const cardW = CANVAS - 120
  const cardH = 280 // tighter — 3 bullets fit snugly, no dead space
  const ctaY = cardY + cardH + 14
  const footerH = 130
  const footerY = CANVAS - footerH

  // ── Eyebrow (small all-caps label above headline)
  const eyebrowText = String(eyebrow || '').toUpperCase().trim()
  const eyebrowY = 110
  const eyebrowSvg = eyebrowText
    ? `<text x="${CANVAS / 2}" y="${eyebrowY}" class="eyebrow">${esc(eyebrowText)}</text>
       <line x1="${CANVAS / 2 - 32}" y1="${eyebrowY + 12}" x2="${CANVAS / 2 + 32}" y2="${eyebrowY + 12}" stroke="${BRAND_ORANGE}" stroke-width="3" stroke-linecap="round"/>`
    : ''

  // ── Headline — smart split at natural breaks, then dynamically size the
  // font so the longest line fits within the canvas width minus padding.
  const headlineUpper = String(headline || '').toUpperCase().trim()
  const headlineLines = splitHeadline(headlineUpper, 22)
  const headlineLineCount = headlineLines.length
  // Inter Bold uppercase average char width ≈ 0.62× the font size in pixels
  // (raised from 0.58 — the previous estimate was overconfident and let the
  // text bleed past the canvas edges).
  const HEADLINE_AVAIL_W = CANVAS - 140
  const CHAR_WIDTH_FACTOR = 0.62
  const longestLineChars = Math.max(...headlineLines.map(l => l.length))
  // Cap font by line count, then shrink further if longest line wouldn't fit
  const fontByLineCount = headlineLineCount >= 3 ? 64 : headlineLineCount === 2 ? 86 : 108
  const maxFontForWidth = Math.floor(HEADLINE_AVAIL_W / (longestLineChars * CHAR_WIDTH_FACTOR))
  const headlineFontSize = Math.min(fontByLineCount, maxFontForWidth)
  const headlineLineHeight = Math.round(headlineFontSize * 1.05)
  const headlineBlockH = headlineLineHeight * headlineLineCount
  // Center the headline block below the eyebrow within the remaining headline band
  const headlineBlockTop = eyebrowY + 50
  const availableH = headlineBandH - headlineBlockTop
  const headlineStartY = headlineBlockTop + Math.round((availableH - headlineBlockH) / 2) + Math.round(headlineFontSize * 0.78)

  // If Claude provided a headline_emphasis phrase, color that span orange.
  // The phrase is matched against the uppercase headline; if it spans across
  // a line break it only gets highlighted on the line where it appears.
  const emphasisUpper = String(headlineEmphasis || '').toUpperCase().trim()
  const renderHeadlineLineContent = (line) => {
    if (!emphasisUpper) return esc(line)
    const idx = line.indexOf(emphasisUpper)
    if (idx < 0) return esc(line)
    const before = line.slice(0, idx)
    const match = line.slice(idx, idx + emphasisUpper.length)
    const after = line.slice(idx + emphasisUpper.length)
    return `${esc(before)}<tspan fill="${BRAND_ORANGE}">${esc(match)}</tspan>${esc(after)}`
  }
  const headlineSvgLines = headlineLines.map((line, i) =>
    `<text x="${CANVAS / 2}" y="${headlineStartY + i * headlineLineHeight}" class="headline">${renderHeadlineLineContent(line)}</text>`
  ).join('\n  ')

  // ── Bullets (exactly 3, larger, more breathing room)
  const bulletItems = (Array.isArray(bullets) ? bullets : []).slice(0, 3)
  const bulletFontSize = 32
  const bulletLineGap = Math.round(cardH / (bulletItems.length + 0.5))
  const bulletDotR = 10
  const bulletPadLeft = 60
  const bulletDotX = cardX + bulletPadLeft + 22
  const bulletTextX = bulletDotX + 26
  const firstBulletY = cardY + Math.round((cardH - bulletLineGap * (bulletItems.length - 1)) / 2)

  const bulletsSvg = bulletItems.map((b, i) => {
    const y = firstBulletY + i * bulletLineGap
    return `
  <circle cx="${bulletDotX}" cy="${y - bulletFontSize / 2 + 8}" r="${bulletDotR}" fill="${BRAND_ORANGE}"/>
  <text x="${bulletTextX}" y="${y}" class="bullet">${esc(b)}</text>`
  }).join('')

  // ── CTA ribbon (small orange pill, bottom-right of bullet card area)
  const ctaText = '→ Daily at adas-iq.com/brew'
  const ctaApproxW = Math.round(ctaText.length * 20 * 0.6) + 36
  const ctaH = 38
  const ctaX = cardX + cardW - ctaApproxW
  const ctaTextY = ctaY + Math.round(ctaH * 0.66)
  const ctaSvg = `
  <rect x="${ctaX}" y="${ctaY}" width="${ctaApproxW}" height="${ctaH}" rx="${ctaH / 2}" ry="${ctaH / 2}" fill="${BRAND_ORANGE}"/>
  <text x="${ctaX + ctaApproxW / 2}" y="${ctaTextY}" class="cta">${esc(ctaText)}</text>`

  // ── Footer (logo + split-color wordmark, matches absoluteadas.com brand)
  // "Absolute" in white + "ADAS" in orange, both Inter Bold, single line.
  const logoSize = 76
  const wordmarkWhite = 'Absolute'
  const wordmarkOrange = 'ADAS'
  const wordmarkFontSize = 40
  const tagline = 'Driving safety forward, one calibration at a time.'
  // Approximate widths for centering — Inter Bold ≈ 0.58× font size per char,
  // plus a single space between the two words.
  const wordmarkApproxW = Math.round((wordmarkWhite.length + 1 + wordmarkOrange.length) * wordmarkFontSize * 0.58)
  const taglineApproxW = Math.round(tagline.length * 16 * 0.55)
  const textBlockW = Math.max(wordmarkApproxW, taglineApproxW)
  const totalBlockW = logoSize + 20 + textBlockW
  const blockStartX = Math.round((CANVAS - totalBlockW) / 2)
  const footerLogoY = footerY + Math.round((footerH - logoSize) / 2)
  const footerTextX = blockStartX + logoSize + 20
  const wordmarkWhiteApproxW = Math.round(wordmarkWhite.length * wordmarkFontSize * 0.58)
  const wordmarkOrangeX = footerTextX + wordmarkWhiteApproxW + Math.round(wordmarkFontSize * 0.30)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <style type="text/css">
      @font-face { font-family: 'Inter'; src: url(data:font/ttf;base64,${interBoldB64}) format('truetype'); font-weight: 700; }
      @font-face { font-family: 'Inter'; src: url(data:font/ttf;base64,${interRegularB64}) format('truetype'); font-weight: 400; }
      .eyebrow {
        font-family: 'Inter', sans-serif;
        font-weight: 700;
        font-size: 22px;
        fill: ${BRAND_ORANGE};
        text-anchor: middle;
        letter-spacing: 0.22em;
      }
      .headline {
        font-family: 'Inter', sans-serif;
        font-weight: 700;
        font-size: ${headlineFontSize}px;
        fill: #ffffff;
        text-anchor: middle;
        letter-spacing: -0.015em;
        paint-order: stroke;
        stroke: rgba(0,0,0,0.45);
        stroke-width: 3px;
      }
      .bullet {
        font-family: 'Inter', sans-serif;
        font-weight: 400;
        font-size: ${bulletFontSize}px;
        fill: ${BULLET_DARK};
        letter-spacing: -0.005em;
      }
      .cta {
        font-family: 'Inter', sans-serif;
        font-weight: 700;
        font-size: 18px;
        fill: #ffffff;
        text-anchor: middle;
        letter-spacing: 0.02em;
      }
      .wordmark-white {
        font-family: 'Inter', sans-serif;
        font-weight: 700;
        font-size: ${wordmarkFontSize}px;
        fill: #ffffff;
        letter-spacing: -0.015em;
      }
      .wordmark-orange {
        font-family: 'Inter', sans-serif;
        font-weight: 700;
        font-size: ${wordmarkFontSize}px;
        fill: ${BRAND_ORANGE};
        letter-spacing: -0.015em;
      }
      .tagline {
        font-family: 'Inter', sans-serif;
        font-weight: 400;
        font-size: 18px;
        fill: rgba(255,255,255,0.85);
        letter-spacing: 0;
      }
    </style>
  </defs>
  <!-- Headline darken band — lighter so the photo shows through more -->
  <rect x="0" y="${headlineBandY}" width="${CANVAS}" height="${headlineBandH}" fill="rgba(0,0,0,0.42)"/>
  <!-- Eyebrow -->
  ${eyebrowSvg}
  <!-- Headline -->
  ${headlineSvgLines}
  <!-- Bullet card -->
  <rect x="${cardX - 4}" y="${cardY - 4 + 8}" width="${cardW + 8}" height="${cardH + 8}" rx="22" ry="22" fill="rgba(0,0,0,0.25)"/>
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="18" ry="18" fill="${CARD_WHITE}"/>
  ${bulletsSvg}
  <!-- CTA ribbon -->
  ${ctaSvg}
  <!-- Footer band -->
  <rect x="0" y="${footerY}" width="${CANVAS}" height="${footerH}" fill="${BRAND_DARK}"/>
  <image href="data:image/png;base64,${logoB64}" x="${blockStartX}" y="${footerLogoY}" width="${logoSize}" height="${logoSize}"/>
  <text x="${footerTextX}" y="${footerY + 58}" class="wordmark-white">${esc(wordmarkWhite)}</text>
  <text x="${wordmarkOrangeX}" y="${footerY + 58}" class="wordmark-orange">${esc(wordmarkOrange)}</text>
  <text x="${footerTextX}" y="${footerY + 96}" class="tagline">${esc(tagline)}</text>
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
export async function composeTipImage({ photoBuffer, eyebrow, headline, headlineEmphasis, bullets }) {
  const { interBoldB64, interRegularB64, logoB64 } = await loadAssets()

  // Photo → 1080x1080 cover
  const photo = await sharp(photoBuffer)
    .resize(CANVAS, CANVAS, { fit: 'cover', position: 'center' })
    .toBuffer()

  const svg = buildSvgOverlay({ eyebrow, headline, headlineEmphasis, bullets, interBoldB64, interRegularB64, logoB64 })

  // Composite SVG overlay on photo, output PNG
  const final = await sharp(photo)
    .composite([{ input: Buffer.from(svg, 'utf-8'), top: 0, left: 0 }])
    .png()
    .toBuffer()

  return final
}
