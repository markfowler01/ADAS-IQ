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
import sharp from 'sharp'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { commitBinaryFile } from './brewArchive.js'

// Axios is used for the Gemini API call below; sharp/fs/path are used for
// the local brand-asset composite that matches the newsletter footer.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = path.join(__dirname, '..', 'assets')

// Footer brand assets — same files the tip-card composite uses, so the
// capture image footer reads identically to the newsletter posts.
// "Absolute" in white + "ADAS" in orange + tagline, with the logo PNG.
const BRAND_ORANGE = '#CD4419'
let _logoB64 = null
let _interBoldB64 = null
let _interRegularB64 = null
async function loadBrandAssets() {
  if (!_logoB64) {
    const buf = await fs.readFile(path.join(ASSETS_DIR, 'absolute-adas-logo.png'))
    _logoB64 = buf.toString('base64')
  }
  if (!_interBoldB64) {
    const buf = await fs.readFile(path.join(ASSETS_DIR, 'fonts', 'Inter-Bold.ttf'))
    _interBoldB64 = buf.toString('base64')
  }
  if (!_interRegularB64) {
    const buf = await fs.readFile(path.join(ASSETS_DIR, 'fonts', 'Inter-Regular.ttf'))
    _interRegularB64 = buf.toString('base64')
  }
  return { logoB64: _logoB64, interBoldB64: _interBoldB64, interRegularB64: _interRegularB64 }
}

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

// Default budget: 30 images/day. At ~$0.04 per Nano Banana call that's $1.20/day
// hard cap or about $35/mo. Overridable via env. A daily-cap breach hard-stops
// new generation and posts a Cliq warning so Mark always sees runaway behavior.
const DEFAULT_DAILY_CAP = 30
// Hard limit on a single batch call regardless of daily cap remaining.
const PER_BATCH_LIMIT = 20
// Audit log size — last N image gen events, rotates oldest out.
const AUDIT_LOG_SIZE = 200

function envBundle() {
  return {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
    enabled: String(process.env.CAPTURE_IMAGES_ENABLED || '').toLowerCase() === 'true',
    dailyCap: Number(process.env.CAPTURE_IMAGE_DAILY_CAP || DEFAULT_DAILY_CAP),
  }
}

export function captureImagesEnabled() {
  const { apiKey, enabled } = envBundle()
  return Boolean(apiKey && enabled)
}

export function captureImageConfig() {
  const e = envBundle()
  return {
    enabled: Boolean(e.apiKey && e.enabled),
    keySet: Boolean(e.apiKey),
    envFlag: String(process.env.CAPTURE_IMAGES_ENABLED || '(unset)'),
    dailyCap: e.dailyCap,
    perBatchLimit: PER_BATCH_LIMIT,
    model: e.model,
  }
}

// ─── Daily budget + audit log (Catalyst Cache) ──────────────────────────────
// Counter key rotates by UTC date so it self-clears at midnight UTC.
function dailyCounterKey() {
  return `capture_image_count_${new Date().toISOString().slice(0, 10)}`
}
const AUDIT_LOG_KEY = 'capture_image_audit_log'

async function cacheGet(segment, key, fallback = null) {
  try {
    const val = await segment.getValue(key)
    return val ? JSON.parse(val) : fallback
  } catch (e) {
    if (e?.statusCode === 404 || e?.errorInfo?.statusCode === 404) return fallback
    throw e
  }
}
async function cacheSet(segment, key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  try { await segment.update(key, str) }
  catch { await segment.put(key, str) }
}

/**
 * Returns {used, cap, remaining, blocked, recentFailRate}.
 * blocked=true means do not call Gemini — daily cap is reached.
 */
export async function checkBudget(segment) {
  const { dailyCap } = envBundle()
  const used = Number(await cacheGet(segment, dailyCounterKey(), 0)) || 0
  const audit = (await cacheGet(segment, AUDIT_LOG_KEY, [])) || []
  const recent = audit.slice(0, 10)
  const fails = recent.filter(a => !a.ok).length
  const failRate = recent.length ? fails / recent.length : 0
  return {
    used,
    cap: dailyCap,
    remaining: Math.max(0, dailyCap - used),
    blocked: used >= dailyCap,
    recentFailRate: failRate,
    recentCount: recent.length,
  }
}

async function incrementCounter(segment) {
  const key = dailyCounterKey()
  const prev = Number(await cacheGet(segment, key, 0)) || 0
  await cacheSet(segment, key, prev + 1)
  return prev + 1
}

async function appendAudit(segment, entry) {
  const log = (await cacheGet(segment, AUDIT_LOG_KEY, [])) || []
  const next = [{ ...entry, at: new Date().toISOString() }, ...log].slice(0, AUDIT_LOG_SIZE)
  await cacheSet(segment, AUDIT_LOG_KEY, next)
}

export async function getAuditLog(segment, limit = 50) {
  const log = (await cacheGet(segment, AUDIT_LOG_KEY, [])) || []
  return log.slice(0, limit)
}

// Per-batch limit getter — used by callers that want to refuse oversized requests
export function getPerBatchLimit() { return PER_BATCH_LIMIT }

// ─── SVG overlay composite ──────────────────────────────────────────────────
// Same layout pattern as the newsletter tip card (tipImageComposite.js):
//   - Mid-image: headline with semi-transparent darken band behind it
//   - Bottom band: solid dark footer with logo + "Absolute"/"ADAS" split
//     wordmark + tagline, centered
// Uses real Inter Bold + Inter Regular fonts embedded into the SVG so the
// brand reads identically every time, no AI typography drift.
async function compositeOverlay(rawImageBuffer, headline) {
  const baseMeta = await sharp(rawImageBuffer).metadata()
  const baseW = baseMeta.width || 1200
  const baseH = baseMeta.height || 627
  const safeHeadline = String(headline || '').trim().slice(0, 100)

  const { logoB64, interBoldB64, interRegularB64 } = await loadBrandAssets()

  // ── Footer band geometry (matches newsletter footer proportions) ──────────
  const footerH = Math.round(baseH * 0.16)           // ~100px on 627
  const footerY = baseH - footerH
  const logoSize = Math.round(footerH * 0.62)         // logo fills ~62% of band height
  const wordmarkFontSize = Math.round(footerH * 0.34) // wordmark big enough to read in feed
  const taglineFontSize = Math.round(footerH * 0.15)
  const wordmarkWhite = 'Absolute'
  const wordmarkOrange = 'ADAS'
  const taglineWhite = 'Mobile ADAS calibration  ·  Western Washington  ·  '
  const taglineOrange = '1-844-349-2327'
  // Combined for width math (we render via a single <text> with <tspan>).
  const tagline = taglineWhite + taglineOrange

  // Approximate widths for centering the footer block (Inter Bold ~0.58× em).
  const wordmarkApproxW = Math.round((wordmarkWhite.length + 1 + wordmarkOrange.length) * wordmarkFontSize * 0.58)
  const taglineApproxW = Math.round(tagline.length * taglineFontSize * 0.55)
  const textBlockW = Math.max(wordmarkApproxW, taglineApproxW)
  const totalBlockW = logoSize + 20 + textBlockW
  const blockStartX = Math.round((baseW - totalBlockW) / 2)
  const footerLogoX = blockStartX
  const footerLogoY = footerY + Math.round((footerH - logoSize) / 2)
  const footerTextX = blockStartX + logoSize + 20
  const wordmarkWhiteApproxW = Math.round(wordmarkWhite.length * wordmarkFontSize * 0.58)
  const wordmarkY = footerY + Math.round(footerH * 0.50)
  const wordmarkOrangeX = footerTextX + wordmarkWhiteApproxW + Math.round(wordmarkFontSize * 0.30)
  const taglineY = footerY + Math.round(footerH * 0.78)

  // ── Headline band (mid-image) ────────────────────────────────────────────
  // Dynamic font size based on headline length + word count to keep multi-line
  // headlines readable at thumbnail scale.
  const headlineFontSize = safeHeadline.length > 60 ? 40 : safeHeadline.length > 40 ? 50 : 60
  const headlineMaxCharsPerLine = Math.round(baseW * 0.85 / (headlineFontSize * 0.55))
  const headlineLines = wrapHeadline(safeHeadline, headlineMaxCharsPerLine)
  const lineGap = Math.round(headlineFontSize * 1.15)
  const headlineBlockH = headlineLines.length * lineGap
  // Place the headline block so its bottom edge sits just above the footer
  // band with a comfortable margin.
  const headlineBlockBottom = footerY - Math.round(baseH * 0.04)
  const headlineBlockTop = headlineBlockBottom - headlineBlockH
  const darkenBandPadY = 22
  const darkenBandY = headlineBlockTop - darkenBandPadY
  const darkenBandH = headlineBlockH + darkenBandPadY * 2

  // ── Build SVG ────────────────────────────────────────────────────────────
  const headlineTextSvg = headlineLines.map((line, i) =>
    `<text x="${Math.round(baseW / 2)}" y="${headlineBlockTop + (i + 1) * lineGap - Math.round(lineGap * 0.25)}" class="headline">${escXml(line)}</text>`
  ).join('\n      ')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${baseW}" height="${baseH}" viewBox="0 0 ${baseW} ${baseH}">
    <defs>
      <style type="text/css">
        @font-face { font-family: 'Inter'; src: url(data:font/ttf;base64,${interBoldB64}) format('truetype'); font-weight: 700; }
        @font-face { font-family: 'Inter'; src: url(data:font/ttf;base64,${interRegularB64}) format('truetype'); font-weight: 400; }
        .headline {
          font-family: 'Inter', sans-serif;
          font-weight: 700;
          font-size: ${headlineFontSize}px;
          fill: #ffffff;
          text-anchor: middle;
          letter-spacing: -0.015em;
          paint-order: stroke;
          stroke: rgba(0,0,0,0.55);
          stroke-width: 3px;
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
          font-size: ${taglineFontSize}px;
          fill: rgba(255,255,255,0.85);
          letter-spacing: 0;
        }
        .tagline-phone {
          font-family: 'Inter', sans-serif;
          font-weight: 700;
          fill: ${BRAND_ORANGE};
        }
      </style>
    </defs>
    <!-- Headline darken band -->
    <rect x="0" y="${darkenBandY}" width="${baseW}" height="${darkenBandH}" fill="rgba(0,0,0,0.42)"/>
    ${headlineTextSvg}

    <!-- Footer band (solid dark, full width) -->
    <rect x="0" y="${footerY}" width="${baseW}" height="${footerH}" fill="#0d0d0d"/>
    <!-- Wordmark: "Absolute" white + "ADAS" orange -->
    <text x="${footerTextX}" y="${wordmarkY}" class="wordmark-white">${wordmarkWhite}</text>
    <text x="${wordmarkOrangeX}" y="${wordmarkY}" class="wordmark-orange">${wordmarkOrange}</text>
    <!-- Tagline (white) + phone number CTA (orange, bold) on same line -->
    <text x="${footerTextX}" y="${taglineY}" class="tagline">${escXml(taglineWhite)}<tspan class="tagline-phone">${escXml(taglineOrange)}</tspan></text>
    <!-- Logo PNG embedded as base64 -->
    <image x="${footerLogoX}" y="${footerLogoY}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${logoB64}"/>
  </svg>`

  return sharp(rawImageBuffer)
    .composite([{ input: Buffer.from(svg, 'utf-8'), top: 0, left: 0 }])
    .png()
    .toBuffer()
}

function wrapHeadline(text, maxChars) {
  if (!text) return []
  const words = text.split(/\s+/)
  const lines = []
  let cur = ''
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w
    if (candidate.length > maxChars && cur) {
      lines.push(cur)
      cur = w
    } else {
      cur = candidate
    }
  }
  if (cur) lines.push(cur)
  // Cap at 3 lines — anything longer should be trimmed at the source
  return lines.slice(0, 3)
}

function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// Style anchor. Real body-shop / calibration-floor photography + editorial
// text overlay. The pattern that actually performs on LinkedIn: documentary
// work photography that signals "this is real shop work", with a bold
// readable text overlay so the hook lands in-feed without needing a click.
//
// HARD RULE: NO people, NO faces. AI-generated faces look uncanny and tank
// credibility instantly. The work itself (target frames, scan tools, bay
// floor, vehicles in repair) photographs cleanly and convincingly.
const STYLE_PROMPT = `Documentary photograph, landscape 1200x627 (LinkedIn share size). Photoreal, magazine-quality, shot on a 35mm or medium-format camera with shallow depth of field.

SCENE OPTIONS (pick whichever reads cleanest — vary subtly across generations):
- A late-model SUV or sedan parked inside a clean modern collision repair body shop bay, three-quarter front view, body lines catching light. The vehicle is the hero.
- Close-up on a vehicle's front clip — headlight cluster, grille, windshield base where the rain-sensor and forward camera live. Modern automotive detail, shallow DOF.
- Wide shot of a clean, organized body shop bay: polished concrete floor, open roll-up bay door letting in natural light, a vehicle just inside, paint booth or work bench in the soft-focus background.
- Detail shot of a vehicle hood / windshield / A-pillar with morning light catching the clearcoat. The work environment is implied, not detailed.

LIGHTING (most important): Cinematic, golden-hour natural light spilling through the open bay door, mixed with cool overhead shop fluorescents. Strong directional light, deep shadows, magazine-cover mood. Confident, professional, end-of-workday calm.

ENVIRONMENT: clean, polished concrete floor. Organized, modern shop. Light coming from a real bay door, not stock-photo studio. No clutter, no debris.

HARD BANS — anything in this list looks fake or "AI-weird":
- NO people, no technicians, no hands, no silhouettes. Frame empty of humans.
- NO specific scan-tool devices with visible screens, displayed numbers, menu UI, or brand markings (Autel, Bosch, etc.). AI butchers these.
- NO calibration target frames with complex geometric patterns. AI gets the geometry wrong and it reads as cartoon.
- NO branded logos on any equipment, ANY tools, ANY tags or signage in the shop.
- NO text, NO captions, NO watermarks, NO graphics anywhere in the image. Branding gets composited on after.
- NO stock-photo aesthetic. NO overly bright "advertising" lighting. NO clean white seamless background.

The subject is the vehicle and the environment. Tools and equipment can exist in deep soft focus background but should never be the center of attention.

COMPOSITION (visual zones only — describe the IMAGE, do not write any words):
- Top 60% of frame: the vehicle / scene as described above, the main subject.
- Middle 25% of frame: visually quiet zone — out-of-focus background, smooth shadows, dark walls, plain ceiling. Low detail.
- Bottom 15% of frame: pure darkness — black or near-black shadow, the deep underside of the bay. Uniform, no texture, no detail.

DO NOT WRITE ANY WORDS IN THE IMAGE. Do not place the words "HEADLINE", "OVERLAY", "FOOTER", "ABSOLUTE", "ADAS", "BRAND MARK", "LOGO", "HERE", or any other text, label, caption, or annotation anywhere in the photograph. The composition zones above describe brightness and detail levels only — never write the zone names visibly. The image must be 100% photograph, no rendered text of any kind.

Real photography only. Documentary magazine quality. Just the photograph.`

/**
 * Generate a LinkedIn-share-sized image for one post variant.
 * Runs through every guardrail: kill-switch, daily budget cap, audit log.
 *
 * @param {Object} args
 * @param {string} args.headline - The hook line to feature visually
 * @param {string} args.draftId  - Used as the filename for the GitHub commit
 * @param {Object} [opts]
 * @param {boolean} [opts.force]   - Bypass the CAPTURE_IMAGES_ENABLED gate (test endpoint only)
 * @param {Object}  [opts.segment] - Catalyst cache segment; required for budget + audit
 * @returns {Promise<{ok: true, url: string, prompt: string, budget?: Object} | {ok: false, error: string}>}
 */
export async function generateCaptureImage({ headline, draftId }, opts = {}) {
  const { apiKey, model, enabled } = envBundle()
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY not configured' }
  if (!opts.force && !enabled) return { ok: false, error: 'CAPTURE_IMAGES_ENABLED is not true (kill switch off)' }
  if (!headline) return { ok: false, error: 'headline required' }
  if (!draftId) return { ok: false, error: 'draftId required' }

  // Daily budget cap — hard stop if reached. Test endpoint (opts.force) is
  // exempt so style validation isn't blocked when the cap is consumed.
  let budget = null
  if (opts.segment && !opts.force) {
    budget = await checkBudget(opts.segment)
    if (budget.blocked) {
      const err = `daily image cap reached (${budget.used}/${budget.cap})`
      await appendAudit(opts.segment, { draftId, headline: headline.slice(0, 80), ok: false, error: err, blocked: true })
      return { ok: false, error: err, budget }
    }
  }

  const safeHeadline = String(headline).trim().slice(0, 100)
  const prompt = STYLE_PROMPT.replace('{HEADLINE}', safeHeadline)
  const t0 = Date.now()

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
      const err = `Gemini ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`
      if (opts.segment) await appendAudit(opts.segment, { draftId, headline: safeHeadline, ok: false, error: err.slice(0, 200), latency_ms: Date.now() - t0 })
      return { ok: false, error: err }
    }
    const parts = res.data?.candidates?.[0]?.content?.parts || []
    const imgPart = parts.find(p => p.inlineData?.data)
    if (!imgPart) {
      const err = 'no image part in response'
      if (opts.segment) await appendAudit(opts.segment, { draftId, headline: safeHeadline, ok: false, error: err, latency_ms: Date.now() - t0 })
      return { ok: false, error: err }
    }
    const rawBuffer = Buffer.from(imgPart.inlineData.data, 'base64')

    // Composite the headline + brand footer over the raw photo. The footer
    // layout matches the newsletter tip-card exactly (logo + "Absolute"/"ADAS"
    // split wordmark + tagline, centered) so all Absolute ADAS imagery reads
    // as one brand.
    //
    // POLICY (Mark, 2026-05-19): images without the brand footer must NEVER
    // ship. If the composite step fails, we fail the whole generation rather
    // than shipping an unbranded raw photo. The pipeline downstream already
    // handles image-gen failure by falling back to text-only LinkedIn posts.
    let buffer
    try {
      buffer = await compositeOverlay(rawBuffer, safeHeadline)
    } catch (e) {
      const err = `footer composite failed (image suppressed): ${e.message}`
      console.warn('[captureImage]', err)
      if (opts.segment) await appendAudit(opts.segment, { draftId, headline: safeHeadline, ok: false, error: err, latency_ms: Date.now() - t0 })
      return { ok: false, error: err }
    }

    // Commit to GitHub Pages so the image has a permanent public URL
    const path = `capture-images/${draftId}.png`
    const r = await commitBinaryFile({
      path,
      buffer,
      message: `Capture campaign image: ${draftId}`,
    })
    if (!r?.ok) {
      const err = r?.error || 'github commit failed'
      if (opts.segment) await appendAudit(opts.segment, { draftId, headline: safeHeadline, ok: false, error: err, latency_ms: Date.now() - t0 })
      return { ok: false, error: err }
    }
    const url = `https://absoluteadas.com/${path}`

    // Success — increment counter + log
    let newBudget = null
    if (opts.segment && !opts.force) {
      const used = await incrementCounter(opts.segment)
      newBudget = { used, cap: envBundle().dailyCap, remaining: Math.max(0, envBundle().dailyCap - used) }
      await appendAudit(opts.segment, { draftId, headline: safeHeadline, ok: true, url, latency_ms: Date.now() - t0, size_bytes: buffer.length, used })
    } else if (opts.segment) {
      await appendAudit(opts.segment, { draftId, headline: safeHeadline, ok: true, url, latency_ms: Date.now() - t0, size_bytes: buffer.length, test: true })
    }
    return { ok: true, url, prompt, budget: newBudget }
  } catch (e) {
    if (opts.segment) await appendAudit(opts.segment, { draftId, headline: safeHeadline, ok: false, error: e.message, latency_ms: Date.now() - t0 })
    return { ok: false, error: e.message }
  }
}
