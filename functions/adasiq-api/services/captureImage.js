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
    const buffer = Buffer.from(imgPart.inlineData.data, 'base64')

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
