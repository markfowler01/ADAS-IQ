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
const BRAND_DARK = '#0d0d0d'
let _logoB64 = null
let _interBoldB64 = null
let _interRegularB64 = null
let _playfairB64 = null
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
  if (!_playfairB64) {
    const buf = await fs.readFile(path.join(ASSETS_DIR, 'fonts', 'PlayfairDisplay-Bold.ttf'))
    _playfairB64 = buf.toString('base64')
  }
  return { logoB64: _logoB64, interBoldB64: _interBoldB64, interRegularB64: _interRegularB64, playfairB64: _playfairB64 }
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

// ─── Scene randomizer ──────────────────────────────────────────────────────
// Curated complete scene scripts. Each is internally coherent so the AI
// gets a focused directive instead of a random mash-up of components.
// Categories span the real collision-industry context Mark works in:
//   - Vehicle in clean shop bay (the original style)
//   - Pre-repair / panel damage visible in the bay
//   - Post-repair / paint booth / freshly finished
//   - Repair in progress (lift, frame rack, prep area)
//   - On the road / driving (subtext: calibrated ADAS working in the world)
//   - Dealership / commercial lot context
//
// HARD BANS (consistent across all scripts): NO people, NO faces, NO graphic
// damage/blood/glass debris, NO branded equipment, NO text rendered in image.
// Vehicle colors curated to neutral palettes that don't clash with orange brand.
const SCENE_SCRIPTS = [
  // ── Clean vehicle in shop bay (the calm/professional baseline) ────────────
  `A silver late-model midsize SUV positioned inside a clean modern collision repair body shop bay with an open roll-up door at the far side. Three-quarter front view, body lines catching light, vehicle filling center of frame. Golden-hour natural light spilling through the bay door from camera-left, warm directional shadows, magazine-cover mood.`,

  `A dark gray executive sedan parked inside a spacious modern shop with skylights overhead and a paint booth visible in soft focus background. Side profile, full-length composition. Overcast natural daylight filtered through the skylights, soft diffuse light, neutral color balance, cinematic.`,

  `A pearl-white luxury sedan parked inside a clean working bay with a tool cart and pegboard visible in deep soft focus. Low-angle front three-quarter shot, dramatic perspective, vehicle hero. Cool overhead LED shop lighting mixed with one warm tungsten lamp off-frame.`,

  `A graphite midsize crossover positioned in a wide industrial bay with high-bay LED lighting and polished concrete floor stretching to the back wall. Wide overhead-ish angle showing the bay with the vehicle parked center. Mixed daylight and warm shop fluorescents, sodium-vapor accents on metal surfaces, working-shop authenticity.`,

  // ── Pre-repair / minor panel damage visible (collision industry context) ─
  `A charcoal full-size SUV inside a clean modern collision repair bay with the front bumper cover lightly creased and the headlight assembly showing minor impact damage. Three-quarter front view, damage visible but not graphic, vehicle still composed and on its wheels. Cool overhead LED shop lighting, neutral cinematic mood, magazine-quality documentary photo.`,

  `A navy blue compact SUV in a body shop bay with the right rear quarter panel showing a clean crease and the rear bumper slightly pushed in from a minor impact. Three-quarter rear view, damage visible but understated. Mixed daylight from open bay door + warm shop fluorescents.`,

  `A white midsize sedan in a body shop with the driver-side door panel removed and set on a padded stand next to the vehicle, exposing the door frame for repair. Side profile of the vehicle, removed door in soft focus foreground. Golden-hour natural light through open bay door, cinematic.`,

  // ── Post-repair / paint booth / freshly finished ─────────────────────────
  `A dark blue station wagon in a clean modern automotive paint booth with bright white walls, freshly painted body panels glistening, paint still wet-looking. Three-quarter front view, vehicle isolated under booth lighting. Cool overhead booth LED lighting, even uniform illumination, glossy-finish editorial photography.`,

  `A slate gray hatchback in a paint booth's drying bay, freshly cleared body panels reflecting the booth lighting. Side profile, full-length composition. Bright clean booth lighting, polished concrete floor, magazine-quality industrial photography.`,

  `A bronze metallic compact SUV parked inside a clean shop bay after final detail, body lines pristine, no damage visible, the vehicle ready for delivery. Three-quarter front view, hero composition. Late-afternoon sun coming through open bay door from camera-right, long shadows, end-of-workday calm.`,

  // ── Vehicle on a lift / repair in progress ───────────────────────────────
  `A black premium crossover SUV on a drive-on alignment lift inside a clean collision repair shop, vehicle suspended at chest height. Side profile, vehicle silhouetted against bay lighting in the background. Mixed natural daylight from open bay door and warm shop fluorescents.`,

  `A champagne metallic minivan parked next to a frame rack in a clean modern body shop, frame rack hardware visible but vehicle not yet attached. Three-quarter front view, vehicle on its wheels, equipment in soft focus background. Overcast diffuse daylight through skylights, neutral color balance.`,

  `A charcoal full-size pickup truck on a two-post lift inside a clean working shop bay, lifted to mid-height. Side profile, full-length composition with the lift columns visible. Cool overhead LED shop lighting, modern editorial feel.`,

  // ── On the road / driving context (calibrated ADAS in the wild) ──────────
  `A silver luxury crossover driving on a clean wet asphalt road in the Pacific Northwest, low cloud cover overhead, evergreen trees in soft focus background. Three-quarter front view from a slightly low angle, vehicle in motion, tire spray faintly visible. Overcast diffuse daylight, slightly cool cinematic color grade, calm and quiet.`,

  `A dark gray midsize pickup on a quiet two-lane highway at the edge of a forest, vehicle in motion. Side profile composition, road and tree line stretching into the distance. Late-afternoon golden light through the trees from camera-right, magazine-cover automotive photography.`,

  `A pearl-white luxury sedan parked at a clean modern overlook with a city skyline visible in soft focus in the background, vehicle calm and composed. Three-quarter front view. Early morning blue-hour light, slightly cool color grade, cinematic.`,

  // ── Commercial / dealership lot context (broader industry framing) ───────
  `A row of late-model vehicles parked neatly at a clean modern auto dealership lot at golden hour, with the hero vehicle (a dark gray midsize crossover) in the foreground three-quarter front. Light spilling across the lot from the setting sun, long shadows, magazine-cover composition.`,

  `A graphite metallic full-size SUV parked at the entrance to a clean modern collision repair facility, signage visible in soft focus background (no readable text). Three-quarter front view, vehicle hero. Overcast natural daylight, neutral color balance, documentary photography.`,
]

/**
 * Pick a single complete scene script per call.
 * Each script is internally coherent so the AI gets a focused, unambiguous
 * directive instead of a recombined mash-up of components.
 */
function pickSceneVariant() {
  return SCENE_SCRIPTS[Math.floor(Math.random() * SCENE_SCRIPTS.length)]
}

// ─── SVG overlay composite ──────────────────────────────────────────────────
// Newspaper-front-page treatment (locked 2026-06-16).
// Layout top-to-bottom:
//   - Top band (cream, ~26% height): orange kicker + black serif headline +
//     gray byline. Reads like a published article masthead.
//   - Middle: the photo (NO mid-image headline overlay anymore).
//   - Bottom band (dark, ~16% height): existing brand footer — logo +
//     "Absolute ADAS" split wordmark + tagline + phone.
//
// Fonts embedded as base64:
//   - Playfair Display variable (used at weight 800) → newspaper headline
//   - Inter Bold + Regular → kicker, byline, footer
async function compositeOverlay(rawImageBuffer, headline) {
  const baseMeta = await sharp(rawImageBuffer).metadata()
  const baseW = baseMeta.width || 1200
  const baseH = baseMeta.height || 627
  const safeHeadline = String(headline || '').trim().slice(0, 120)

  const { logoB64, interBoldB64, interRegularB64, playfairB64 } = await loadBrandAssets()

  // ── Newspaper-style TOP band (white/cream) ───────────────────────────────
  // LOCKED 2026-06-17: fixed pixel sizes so the masthead/footer look identical
  // on every image regardless of source dimensions. +4px overlap into photo
  // zone to swallow Nano Banana's letterbox bars (those caused the dark seams).
  const topH = 220
  const padX = Math.round(baseW * 0.07)               // 70px side padding
  const kickerFontSize = Math.round(topH * 0.075)      // ~20px
  // Capped lower 2026-06-17 so 2-line headlines don't crowd the byline.
  const headlineFontSize =
    safeHeadline.length > 70 ? 38
    : safeHeadline.length > 45 ? 44
    : 48
  const headlineLineGap = Math.round(headlineFontSize * 1.05)
  const bylineFontSize = Math.round(topH * 0.065)     // ~18px

  // Playfair Bold avg char width is ~0.60 em (digits + $ wider than the 0.50
  // I had — that caused "$16,200" to split mid-word at 55px font). 0.60 is
  // conservative enough to fit at the cost of slightly shorter lines.
  const headlineMaxCharsPerLine = Math.round((baseW - 2 * padX) / (headlineFontSize * 0.60))
  const headlineLines = wrapHeadline(safeHeadline, headlineMaxCharsPerLine).slice(0, 3)

  // Build date string in newspaper byline format (e.g. JUNE 17, 2026)
  const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER']
  const now = new Date()
  const dateline = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`
  const byline = `BY MARK FOWLER  ·  ABSOLUTE ADAS  ·  ${dateline}`

  // Y positions inside the top band
  const kickerY = Math.round(topH * 0.18)
  const ruleTopY = Math.round(topH * 0.27)
  const headlineStartY = Math.round(topH * 0.36)
  const ruleBottomY = headlineStartY + headlineLines.length * headlineLineGap + 4
  const bylineY = Math.round(topH * 0.92)

  // ── Bottom band — UNIFIED with brew-tips footer 2026-06-19 ────────────────
  // Mark wants the brew-tips footer (dark bg, Inter Bold split-color wordmark,
  // no phone number) on EVERY post on EVERY platform. Replaces the old cream
  // Playfair footer.
  const footerH = 170
  const footerY = baseH - footerH
  const logoSize = Math.round(footerH * 0.62)
  const wordmarkFontSize = Math.round(footerH * 0.34)
  const taglineFontSize = Math.round(footerH * 0.15)
  const wordmarkWhite = 'Absolute'
  const wordmarkOrange = 'ADAS'
  const tagline = 'Mobile ADAS calibration  ·  Western Washington'

  // Inter Bold avg char width ~0.58 em.
  const wordmarkApproxW = Math.round((wordmarkWhite.length + 1 + wordmarkOrange.length) * wordmarkFontSize * 0.58)
  const taglineApproxW = Math.round(tagline.length * taglineFontSize * 0.55)
  const textBlockW = Math.max(wordmarkApproxW, taglineApproxW)
  const totalBlockW = logoSize + 20 + textBlockW
  const centeredX = Math.round((baseW - totalBlockW) / 2)
  const blockStartX = Math.max(Math.round(baseW * 0.04), centeredX)
  const footerLogoX = blockStartX
  const footerLogoY = footerY + Math.round((footerH - logoSize) / 2)
  const footerTextX = blockStartX + logoSize + 20
  const wordmarkWhiteApproxW = Math.round(wordmarkWhite.length * wordmarkFontSize * 0.58)
  const wordmarkY = footerY + Math.round(footerH * 0.50)
  const wordmarkOrangeX = footerTextX + wordmarkWhiteApproxW + Math.round(wordmarkFontSize * 0.30)
  const taglineY = footerY + Math.round(footerH * 0.78)

  // ── Build SVG ────────────────────────────────────────────────────────────
  const headlineTextSvg = headlineLines.map((line, i) =>
    `<text x="${padX}" y="${headlineStartY + (i + 1) * headlineLineGap - Math.round(headlineLineGap * 0.25)}" class="np-headline">${escXml(line)}</text>`
  ).join('\n      ')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${baseW}" height="${baseH}" viewBox="0 0 ${baseW} ${baseH}">
    <defs>
      <style type="text/css">
        @font-face { font-family: 'Inter'; src: url(data:font/ttf;base64,${interBoldB64}) format('truetype'); font-weight: 700; }
        @font-face { font-family: 'Inter'; src: url(data:font/ttf;base64,${interRegularB64}) format('truetype'); font-weight: 400; }
        @font-face { font-family: 'Playfair'; src: url(data:font/ttf;base64,${playfairB64}) format('truetype'); font-weight: 800; }
        .np-kicker {
          font-family: 'Inter', sans-serif;
          font-weight: 700;
          font-size: ${kickerFontSize}px;
          fill: ${BRAND_ORANGE};
          letter-spacing: 0.18em;
        }
        .np-kicker-brand {
          font-family: 'Inter', sans-serif;
          font-weight: 700;
          font-size: ${kickerFontSize}px;
          fill: rgba(255,255,255,0.75);
          letter-spacing: 0.18em;
        }
        .np-headline {
          font-family: 'Playfair', serif;
          font-weight: 800;
          font-size: ${headlineFontSize}px;
          fill: #ffffff;
          letter-spacing: -0.01em;
        }
        .np-byline {
          font-family: 'Inter', sans-serif;
          font-weight: 700;
          font-size: ${bylineFontSize}px;
          fill: rgba(255,255,255,0.55);
          letter-spacing: 0.12em;
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
      </style>
    </defs>

    <!-- Newspaper top band: DARK background to match footer (+6px overlap into photo to swallow letterbox seam) -->
    <rect x="0" y="0" width="${baseW}" height="${topH + 6}" fill="${BRAND_DARK}"/>

    <!-- Kicker: orange "INDUSTRY REPORT" + light brand on same line -->
    <text x="${padX}" y="${kickerY}" class="np-kicker">INDUSTRY REPORT</text>
    <text x="${padX}" y="${kickerY + Math.round(kickerFontSize * 1.4)}" class="np-kicker-brand" style="font-size:${Math.round(kickerFontSize * 0.75)}px;letter-spacing:0.22em;">ABSOLUTE ADAS  ·  COLLISION + ADAS CALIBRATION</text>

    <!-- Thin hairline rule below kicker -->
    <line x1="${padX}" y1="${ruleTopY + Math.round(topH * 0.04)}" x2="${baseW - padX}" y2="${ruleTopY + Math.round(topH * 0.04)}" stroke="rgba(255,255,255,0.45)" stroke-width="2"/>

    <!-- Headline (serif, left-aligned, white on dark) -->
    ${headlineTextSvg}

    <!-- Thin gray hairline below headline -->
    <line x1="${padX}" y1="${ruleBottomY}" x2="${baseW - padX}" y2="${ruleBottomY}" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>

    <!-- Byline -->
    <text x="${padX}" y="${bylineY}" class="np-byline">${escXml(byline)}</text>

    <!-- Footer band (dark, matches brew-tips style; +8px overlap above footerY to swallow letterbox seam) -->
    <rect x="0" y="${footerY - 8}" width="${baseW}" height="${footerH + 8}" fill="${BRAND_DARK}"/>
    <text x="${footerTextX}" y="${wordmarkY}" class="wordmark-white">${wordmarkWhite}</text>
    <text x="${wordmarkOrangeX}" y="${wordmarkY}" class="wordmark-orange">${wordmarkOrange}</text>
    <text x="${footerTextX}" y="${taglineY}" class="tagline">${escXml(tagline)}</text>
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
//
// {SCENE_DIRECTIVE} is injected per call from pickSceneVariant() so every
// image gets a different vehicle + framing + lighting combination.
const STYLE_PROMPT = `Documentary photograph, landscape 1200x627 (LinkedIn share size). Photoreal, magazine-quality, shot on a 35mm or medium-format camera with shallow depth of field.

SCENE (specific, follow exactly):
{SCENE_DIRECTIVE}

ENVIRONMENT: clean, polished concrete floor. Organized, modern shop. Light coming from a real bay door or skylight, not stock-photo studio. No clutter, no debris.

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
 * @param {string}  [opts.sceneOverride] - Use this scene directive instead of a random vehicle-in-bay variant. Used for holiday-themed images.
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
  // opts.sceneOverride lets callers force a specific scene (e.g. holiday-themed
  // scenes from holidays.js). Falls back to a random vehicle-in-bay scene
  // when not provided, so existing callers keep working unchanged.
  const sceneDirective = opts.sceneOverride && typeof opts.sceneOverride === 'string'
    ? opts.sceneOverride
    : pickSceneVariant()
  const prompt = STYLE_PROMPT
    .replace('{HEADLINE}', safeHeadline)
    .replace('{SCENE_DIRECTIVE}', sceneDirective)
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

    // Commit to GitHub Pages so the image has a permanent public URL.
    // 409 retry with jitter — when multiple image gens fire in parallel (e.g.
    // the 15-image Sunday-night LinkedIn batch), commits race each other and
    // GitHub rejects all but one (the parent SHA they all fetched gets stale
    // the moment the first commit lands). Retry up to 4 times with random
    // jitter before failing.
    const path = `capture-images/${draftId}.png`
    let r = null
    let lastErr = null
    for (let attempt = 0; attempt < 4; attempt++) {
      r = await commitBinaryFile({
        path,
        buffer,
        message: `Capture campaign image: ${draftId}`,
      })
      if (r?.ok) break
      lastErr = r?.error || 'github commit failed'
      // Retry only on 409 (race condition). Other errors fail immediately.
      if (!/409/.test(String(lastErr))) break
      // Jittered backoff: 200-1200ms, 400-1800ms, 600-2400ms across attempts
      const baseMs = 200 + attempt * 400
      const jitter = Math.floor(Math.random() * 800)
      await new Promise(rs => setTimeout(rs, baseMs + jitter))
    }
    if (!r?.ok) {
      if (opts.segment) await appendAudit(opts.segment, { draftId, headline: safeHeadline, ok: false, error: lastErr, latency_ms: Date.now() - t0 })
      return { ok: false, error: lastErr }
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
