// Enriches ADAS calibration line-items for the Absolute ADAS report:
//   - Plain-language ("third grader") description of what the calibration
//     does, why it's needed for this specific vehicle + trigger, and what
//     happens if it's skipped
//   - Reference links (ALLDATA search, I-CAR OEM search, OEM Job Aid stub,
//     Scan Report on WorkDrive)
//
// Cached in Catalyst Cache under `report_plain_desc:<cal>:<make>:<model>`
// so we don't pay Claude for the same (cal, make, model) combo more than
// once. Cache TTL: 90 days.

import Anthropic from '@anthropic-ai/sdk'
import catalyst from 'zcatalyst-sdk-node'

const MODEL = 'claude-haiku-4-5'
const CACHE_PREFIX = 'report_plain_desc'
const CACHE_TTL_HOURS = 24 * 90

function segment(req) {
  return catalyst.initialize(req).cache().segment()
}

function cacheKey(calName, make, model) {
  const norm = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)
  return `${CACHE_PREFIX}:${norm(calName)}:${norm(make)}:${norm(model)}`
}

async function readCachedDescription(req, calName, make, model) {
  try {
    const val = await segment(req).getValue(cacheKey(calName, make, model))
    return val ? String(val) : null
  } catch { return null }
}

async function writeCachedDescription(req, calName, make, model, text) {
  try {
    const key = cacheKey(calName, make, model)
    const seg = segment(req)
    try { await seg.update(key, text) }
    catch { await seg.put(key, text, CACHE_TTL_HOURS) }
  } catch (e) {
    console.warn('[report enrichment cache write]', e.message)
  }
}

// One Claude call per (cal, make, model) combo — Haiku is fast and cheap,
// plain-English description caps at ~120 tokens.
async function generatePlainDescription({ calibrationName, year, make, model, trigger }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  const client = new Anthropic({ apiKey, timeout: 15000, maxRetries: 1 })

  const vehicle = [year, make, model].filter(Boolean).join(' ') || 'this vehicle'
  const triggerLine = trigger ? ` following ${trigger}` : ''

  const prompt = `Write a 2 to 3 sentence explanation of why a ${calibrationName} calibration is required on a ${vehicle}${triggerLine}.

Rules:
- Target reading level: third grade — plain, everyday words. Assume the reader is an insurance adjuster who is not an ADAS specialist.
- Sentence 1: Explain what the ${calibrationName} does in this ${make || 'vehicle'} (which safety systems it supports).
- Sentence 2: Explain why it must be calibrated after this specific event (why the sensor's alignment or software drifts).
- Sentence 3: Explain what happens if the calibration is skipped (what safety systems fail, why that's dangerous).
- No jargon or acronyms without explanation. No filler. No preamble. Return only the paragraph.`

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = (resp.content || []).map(b => b.text || '').join('').trim()
  if (!text) throw new Error('empty response from Claude')
  return text
}

// Build the reference-links array shown in the report. Search URLs are
// deterministic per vehicle so we don't have to store static references.
export function buildReferenceLinks({ year, make, model, folderShareUrl }) {
  const q = encodeURIComponent([year, make, model].filter(Boolean).join(' '))
  const links = []
  links.push({
    label: `ALLDATA ADAS Quick Reference: ${year || ''} ${make || ''} ${model || ''}`.trim(),
    url: `https://my.alldata.com/repair/#/main?search=${q}`,
  })
  links.push({
    label: `I-CAR OEM Calibration Requirements Search: ${(make || '').toUpperCase()} ${(model || '').toUpperCase()}`.trim(),
    url: `https://rts.i-car.com/collision-repair-news/search?q=${q}`,
  })
  links.push({
    label: 'OEM Position Statement Search (Google)',
    url: `https://www.google.com/search?q=${q}+ADAS+calibration+OEM+position+statement`,
  })
  if (folderShareUrl) {
    links.push({ label: 'Scan Report (WorkDrive)', url: folderShareUrl })
  }
  return links
}

// Main entry — call this for each calibration on the report. Returns
// { plain_description, links }. plain_description falls back to the raw
// justification if Claude is unavailable so a report never fails to
// generate for lack of AI.
export async function enrichCalibration(req, {
  calibrationName, year, make, model, trigger, folderShareUrl,
}) {
  let plainDescription = ''
  try {
    const cached = await readCachedDescription(req, calibrationName, make, model)
    if (cached) {
      plainDescription = cached
    } else {
      plainDescription = await generatePlainDescription({ calibrationName, year, make, model, trigger })
      await writeCachedDescription(req, calibrationName, make, model, plainDescription)
    }
  } catch (e) {
    console.warn('[report enrichment]', calibrationName, '-', e.message)
    plainDescription = ''
  }
  const links = buildReferenceLinks({ year, make, model, folderShareUrl })
  return { plain_description: plainDescription, links }
}
