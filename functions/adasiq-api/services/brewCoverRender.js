// ADAS Brew daily cover — rendered entirely in code. NO AI-drawn text.
//
// Until 2026-10-11 Gemini drew this whole card, headline included, and it
// shipped Issue #105 reading "ADAS Cabibration Rules". Image models cannot
// be trusted to spell, so every word here is typeset with real font files
// via Pango (sharp `text` input + `fontfile`, which sidesteps the librsvg
// @font-face problem) and the headline renders exactly as the subject line.
//
// Layout (1080×1080): cream page, cup + ADAS BREW masthead, double orange
// rule, ISSUE / weekday-date dateline, auto-fit + line-balanced Playfair
// headline, orange accent bar, dark Absolute ADAS footer band (same lockup
// as the rest of the marketing).

import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import Anthropic from '@anthropic-ai/sdk'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FONTS = path.join(HERE, '..', 'assets', 'fonts')
const LOGO = path.join(HERE, 'assets', 'logo.png')

const F = {
  mono:       { file: path.join(FONTS, 'IBMPlexMono-Bold.ttf'),   family: 'IBM Plex Mono Bold' },
  monoMedium: { file: path.join(FONTS, 'IBMPlexMono-Medium.ttf'), family: 'IBM Plex Mono Medium' },
  serif:      { file: path.join(FONTS, 'PlayfairDisplay-Bold.ttf'), family: 'Playfair Display Bold' },
  inter:      { file: path.join(FONTS, 'Inter-Bold.ttf'),          family: 'Inter Bold' },
}

const SIZE = 1080
const MARGIN = 84
const CREAM = '#f5f3f0'
const ORANGE = '#CD4419'
const INK = '#1a1a1a'
const GRAY = '#6b7280'
const FOOTER_H = 132
const HEADLINE_LH = 0.86   // × Playfair's tall natural line height

const escMarkup = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Render one text block with Pango. Returns { buffer, width, height }. */
async function textImage({ text, font, px, color, width, align = 'left', trackingEm = 0, lineHeight = 0 }) {
  const spacing = Math.round(trackingEm * px * 1024)
  const render = async (withLineHeight) => {
    const attrs = [`foreground="${color}"`]
    if (spacing) attrs.push(`letter_spacing="${spacing}"`)
    if (withLineHeight && lineHeight) attrs.push(`line_height="${lineHeight}"`)
    const buffer = await sharp({
      text: {
        text: `<span ${attrs.join(' ')}>${escMarkup(text)}</span>`,
        font: `${font.family} ${px}`,
        fontfile: font.file,
        rgba: true,
        dpi: 72,
        align,
        ...(width ? { width, wrap: 'word' } : {}),
      },
    }).png().toBuffer()
    const meta = await sharp(buffer).metadata()
    return { buffer, width: meta.width, height: meta.height }
  }
  // line_height needs Pango >= 1.50; fall back to natural leading if absent.
  try { return await render(true) } catch (e) { if (!lineHeight) throw e; return render(false) }
}

/**
 * Fit the headline: largest size (≤ maxPx) that stays within the box and
 * ≤ maxLines, then narrow the wrap width as far as possible without adding a
 * line — balances the lines so no lonely last word ("CSS text-wrap: balance").
 */
async function fitHeadline(headline, { boxW, boxH, maxPx = 112, minPx = 52, maxLines = 5 }) {
  for (let px = maxPx; px >= minPx; px -= 4) {
    const lineH = px * 1.17
    const full = await textImage({ text: headline, font: F.serif, px, color: INK, width: boxW, align: 'centre', lineHeight: HEADLINE_LH })
    const lines = Math.round(full.height / lineH)
    if (full.height > boxH || lines > maxLines) continue

    let lo = Math.round(boxW * 0.45), hi = boxW, best = full
    while (hi - lo > 12) {
      const mid = Math.round((lo + hi) / 2)
      const trial = await textImage({ text: headline, font: F.serif, px, color: INK, width: mid, align: 'centre', lineHeight: HEADLINE_LH })
      if (trial.height <= full.height && trial.width <= boxW) { best = trial; hi = mid } else { lo = mid }
    }
    return { ...best, px }
  }
  // Pathologically long headline: smallest size, let it wrap.
  return { ...(await textImage({ text: headline, font: F.serif, px: minPx, color: INK, width: boxW, align: 'centre', lineHeight: HEADLINE_LH })), px: minPx }
}

/**
 * Turn the email subject into a front-page headline for the cover. Subjects
 * are written for opens ("California Glass Act Live: ADAS Calibration Rules
 * Just Changed"); the cover should read like news (Mark, 2026-10-11).
 * Same facts only. Any failure or a reply that breaks the rules → subject.
 */
export async function toCoverHeadline(subject) {
  const original = String(subject || '').replace(/\s+/g, ' ').trim()
  if (!original || !process.env.ANTHROPIC_API_KEY) return original
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      system: `You are the front-page editor of a trade newspaper for collision repair shop owners. Rewrite the given email subject line as a newspaper headline.
RULES: 5 to 10 words. Headline capitalization: capitalize words of 4+ letters, keep a, an, the, and, but, or, for, nor, to, of, on, in, at, by lowercase unless first. Lead with who did what: a concrete active verb in present tense (Makes, Requires, Bans, Cuts, Adds) rather than a vague one (Updates, Changes, Impacts, Affects) whenever the subject supports it. Use ONLY facts stated in the subject; never add numbers, names, dates or claims. No colon labels like "X Live:" or "Breaking:", no questions, no em dashes, no exclamation marks, no quotes, no hashtags, no emojis. Output ONLY the headline.`,
      messages: [{ role: 'user', content: original }],
    })
    const h = String(msg.content?.[0]?.text || '').replace(/^["'\s]+|["'\s.]+$/g, '').replace(/\s+/g, ' ')
    const words = h.split(' ').filter(Boolean).length
    if (!h || words < 4 || words > 12 || h.length > 90 || /[:!?\u2014#"]|\n/.test(h)) return original
    return h
  } catch (e) {
    console.warn('[brew cover headline] using subject:', e.message)
    return original
  }
}

function datelineParts(issueNumber, dateISO) {
  let dateLabel = ''
  if (dateISO) {
    const d = new Date(String(dateISO).length === 10 ? `${dateISO}T12:00:00Z` : dateISO)
    if (!Number.isNaN(d.getTime())) {
      dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
        .replace(/,(?= [A-Z][a-z]+ \d)/, ' ·')   // "Thursday · October 1, 2026"
    }
  }
  return {
    left: issueNumber ? `ISSUE #${issueNumber}` : 'ADAS BREW',
    right: dateLabel.toUpperCase(),
  }
}

// Line-art coffee cup in brand orange (cup, handle, saucer, two steam curls).
function cupSvg(x, y, s) {
  return `<g transform="translate(${x},${y}) scale(${s / 48})" fill="none" stroke="${ORANGE}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 20 h26 v10 a13 13 0 0 1 -26 0 z"/>
    <path d="M34 23 h3.5 a5 5 0 0 1 0 10 h-4"/>
    <path d="M4 45 h34"/>
    <path d="M16 15 c-3 -3 3 -5 0 -9"/>
    <path d="M25 15 c-3 -3 3 -5 0 -9"/>
  </g>`
}

/**
 * @returns {Promise<{ok: true, buffer: Buffer, mimeType: string, prompt: string} | {ok: false, error: string}>}
 */
export async function renderBrewCover({ issueNumber, dateISO, headline, rewrite = true }) {
  try {
    const coverText = rewrite ? await toCoverHeadline(headline) : headline
    const safeHeadline = String(coverText || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    if (!safeHeadline) return { ok: false, error: 'headline required' }

    // ── Masthead: cup + ADAS BREW, centered as one group ─────────────────
    const mastPx = 46
    const mast = await textImage({ text: 'ADAS BREW', font: F.mono, px: mastPx, color: ORANGE, trackingEm: 0.16 })
    const cupS = 58, cupGap = 18
    const groupW = cupS + cupGap + mast.width
    const groupX = Math.round((SIZE - groupW) / 2)
    const mastTop = 92
    const mastX = groupX + cupS + cupGap
    const mastY = mastTop + Math.round((cupS - mast.height) / 2) + 6

    // ── Double rule + dateline ────────────────────────────────────────────
    const ruleY = mastTop + cupS + 34
    const { left, right } = datelineParts(issueNumber, dateISO)
    const dlPx = 24
    const dlL = await textImage({ text: left, font: F.monoMedium, px: dlPx, color: INK, trackingEm: 0.12 })
    const dlR = right ? await textImage({ text: right, font: F.monoMedium, px: dlPx, color: GRAY, trackingEm: 0.08 }) : null
    const dlY = ruleY + 26
    const rule2Y = dlY + dlL.height + 22

    // ── Headline box between dateline rule and footer ────────────────────
    const accentH = 7, accentGap = 44
    const boxTop = rule2Y + 56
    const boxBottom = SIZE - FOOTER_H - 74
    const boxW = SIZE - MARGIN * 2 - 20
    const boxH = boxBottom - boxTop - accentGap - accentH
    const hl = await fitHeadline(safeHeadline, { boxW, boxH })
    const blockH = hl.height + accentGap + accentH
    const hlY = boxTop + Math.max(0, Math.round((boxBottom - boxTop - blockH) / 2))
    const hlX = Math.round((SIZE - hl.width) / 2)
    const accentY = hlY + hl.height + accentGap
    const accentW = 112

    // ── Footer band: logo + Absolute ADAS lockup, URL right ─────────────
    const footY = SIZE - FOOTER_H
    const logoS = 68
    const logo = await sharp(LOGO).resize(logoS, logoS, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    const wmA = await textImage({ text: 'Absolute', font: F.inter, px: 38, color: '#ffffff' })
    const wmB = await textImage({ text: 'ADAS', font: F.inter, px: 38, color: ORANGE })
    const url = await textImage({ text: 'absoluteadas.com/brew', font: F.monoMedium, px: 24, color: '#d1d5db', trackingEm: 0.04 })
    const footMidY = footY + Math.round(FOOTER_H / 2)
    const logoX = MARGIN, logoY = footMidY - Math.round(logoS / 2)
    const wmX = logoX + logoS + 18
    const wmY = footMidY - Math.round(wmA.height / 2)

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
      <rect width="100%" height="100%" fill="${CREAM}"/>
      ${cupSvg(groupX, mastTop, cupS)}
      <rect x="${MARGIN}" y="${ruleY}" width="${SIZE - MARGIN * 2}" height="4" fill="${ORANGE}"/>
      <rect x="${MARGIN}" y="${ruleY + 9}" width="${SIZE - MARGIN * 2}" height="1.5" fill="${ORANGE}"/>
      <rect x="${MARGIN}" y="${rule2Y}" width="${SIZE - MARGIN * 2}" height="1.5" fill="#d6d1ca"/>
      <rect x="${Math.round((SIZE - accentW) / 2)}" y="${accentY}" width="${accentW}" height="${accentH}" rx="3.5" fill="${ORANGE}"/>
      <rect x="0" y="${footY}" width="${SIZE}" height="${FOOTER_H}" fill="#0d0d0d"/>
      <rect x="0" y="${footY}" width="${SIZE}" height="5" fill="${ORANGE}"/>
    </svg>`

    const layers = [
      { input: mast.buffer, left: mastX, top: mastY },
      { input: dlL.buffer, left: MARGIN, top: dlY },
      ...(dlR ? [{ input: dlR.buffer, left: SIZE - MARGIN - dlR.width, top: dlY }] : []),
      { input: hl.buffer, left: hlX, top: hlY },
      { input: logo, left: logoX, top: logoY },
      { input: wmA.buffer, left: wmX, top: wmY },
      { input: wmB.buffer, left: wmX + wmA.width + 11, top: wmY },
      { input: url.buffer, left: SIZE - MARGIN - url.width, top: footMidY - Math.round(url.height / 2) },
    ]
    const buffer = await sharp(Buffer.from(svg)).composite(layers).png({ compressionLevel: 9 }).toBuffer()
    return {
      ok: true,
      buffer,
      mimeType: 'image/png',
      prompt: `code-rendered cover (no AI text) · headline ${hl.px}px`,
      headline_used: safeHeadline,
    }
  } catch (e) {
    return { ok: false, error: `cover render failed: ${e.message}` }
  }
}
