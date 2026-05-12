import axios from 'axios'

// Pose as a real browser — many publisher sites 403 unknown UAs.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const FETCH_TIMEOUT = 20000

// Source registry — each source has an id, label, type ('rss' | 'scrape' | 'fn'), url, and parser.
//
// Verified May 2026:
//   ✓ Repairer Driven News, SCRS, CollisionWeek, BodyShopBusiness → working RSS
//   ✓ NHTSA → JSON API (recallsByVehicle sweep across common ADAS-equipped vehicles)
//
// Dropped (RSS dead or Cloudflare-blocked):
//   ✗ Collision Repair Magazine — 403 on /feed/ behind Cloudflare bot scoring
//   ✗ Autobody News — site moved to Nuxt/SPA, no public RSS
//   ✗ FenderBender — site moved to Nuxt/SPA, no public RSS; would need headless browser
//   ✗ I-CAR (rts.i-car.com) — no public RSS or news index
//   ✗ ABRN — domain dead, content folded into FenderBender's parent CMS
export const SOURCES = [
  {
    id: 'repairer_driven_news',
    label: 'Repairer Driven News',
    type: 'rss',
    url: 'https://www.repairerdrivennews.com/feed/',
  },
  {
    id: 'collision_week',
    label: 'CollisionWeek',
    type: 'rss',
    url: 'https://www.collisionweek.com/feed/',
  },
  {
    id: 'bodyshop_business',
    label: 'BodyShop Business',
    type: 'rss',
    url: 'https://www.bodyshopbusiness.com/feed/',
  },
  {
    id: 'scrs',
    label: 'SCRS',
    type: 'rss',
    url: 'https://scrs.com/feed/',
  },
  {
    id: 'nhtsa_recalls',
    label: 'NHTSA Recalls',
    type: 'fn',
    fn: 'nhtsaRecentRecalls',
  },
]

// ─── RSS / Atom parser ──────────────────────────────────────────────────────
// Lightweight regex-based parser; sufficient for the feeds we ingest.
// Returns: [{ title, link, pubDate, summary, source }]
function parseRSS(xml, sourceLabel) {
  const items = []
  const entryRegex = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let m
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[2]
    const title       = decode(extractTag(block, 'title'))
    const link        = decode(extractLink(block))
    const pubDateRaw  = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated')
    const summary     = decode(stripHtml(
      extractTag(block, 'description') ||
      extractTag(block, 'summary') ||
      extractTag(block, 'content:encoded') ||
      extractTag(block, 'content') || ''
    ))
    if (!title) continue
    items.push({
      title: title.slice(0, 280),
      link: link || '',
      pubDate: pubDateRaw ? new Date(pubDateRaw).toISOString() : null,
      summary: summary.slice(0, 600),
      source: sourceLabel,
    })
  }
  return items
}

function extractTag(block, tag) {
  // Handles <tag>x</tag>, <tag attr="...">x</tag>, and <tag><![CDATA[x]]></tag>
  const re = new RegExp(`<${escapeReg(tag)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeReg(tag)}>`, 'i')
  const m = re.exec(block)
  if (!m) return ''
  let inner = m[1].trim()
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner)
  if (cdata) inner = cdata[1].trim()
  return inner
}

function extractLink(block) {
  // RSS: <link>url</link>. Atom: <link href="url" .../>
  const tagMatch = /<link\b[^>]*>([^<]+)<\/link>/i.exec(block)
  if (tagMatch && tagMatch[1].trim()) return tagMatch[1].trim()
  const hrefMatch = /<link\b[^>]*\bhref="([^"]+)"/i.exec(block)
  if (hrefMatch) return hrefMatch[1]
  return ''
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── NHTSA recent recalls ───────────────────────────────────────────────────
// api.nhtsa.gov has no public "recent recalls" endpoint — recallsByDate requires
// API auth. recallsByVehicle is the only public list endpoint. So we sweep a set
// of popular ADAS-equipped vehicles for the current + previous model year,
// dedupe by campaign number, filter to recalls reported in the last 60 days.
const NHTSA_SWEEP = [
  // Volume + ADAS-heavy: Toyota family
  { make: 'Toyota', model: 'Camry' },
  { make: 'Toyota', model: 'RAV4' },
  { make: 'Toyota', model: 'Corolla' },
  { make: 'Toyota', model: 'Tacoma' },
  // Honda family
  { make: 'Honda', model: 'Civic' },
  { make: 'Honda', model: 'CR-V' },
  { make: 'Honda', model: 'Accord' },
  // Subaru — heavy EyeSight calibrations
  { make: 'Subaru', model: 'Outback' },
  { make: 'Subaru', model: 'Forester' },
  // Trucks — high regional volume
  { make: 'Ford', model: 'F-150' },
  { make: 'Chevrolet', model: 'Silverado 1500' },
  { make: 'Ram', model: '1500' },
  // Hyundai/Kia — ADAS-rich and recall-prone
  { make: 'Hyundai', model: 'Tucson' },
  { make: 'Kia', model: 'Sportage' },
  // Tesla — frequent OTA bulletins
  { make: 'Tesla', model: 'Model Y' },
  { make: 'Tesla', model: 'Model 3' },
]

// NHTSA returns ReportReceivedDate in DD/MM/YYYY format. Parse it to a JS Date.
function parseNhtsaDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim())
  if (!m) return null
  const [, dd, mm, yyyy] = m
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`)
}

async function fetchNhtsaRecallsForVehicle(make, model, modelYear) {
  const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${modelYear}`
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      timeout: FETCH_TIMEOUT,
      validateStatus: s => s < 500,
    })
    if (res.status !== 200) return []
    const results = Array.isArray(res.data?.results) ? res.data.results : []
    return results
  } catch {
    return []
  }
}

async function nhtsaRecentRecalls() {
  const now = new Date()
  const currentYear = now.getUTCFullYear()
  const modelYears = [currentYear, currentYear + 1] // current MY + next-MY (released mid-year)
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)

  // Fan out: vehicles × modelYears in parallel
  const calls = []
  for (const v of NHTSA_SWEEP) {
    for (const my of modelYears) calls.push(fetchNhtsaRecallsForVehicle(v.make, v.model, my))
  }
  const all = (await Promise.allSettled(calls))
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)

  // Dedupe by campaign number, keep only recalls reported in the last 60 days
  const byCampaign = new Map()
  for (const r of all) {
    const dt = parseNhtsaDate(r.ReportReceivedDate)
    if (!dt || dt < sixtyDaysAgo) continue
    const key = r.NHTSACampaignNumber
    if (!key || byCampaign.has(key)) continue
    byCampaign.set(key, { ...r, _reportDate: dt })
  }

  return Array.from(byCampaign.values()).map(r => {
    const make    = String(r.Make || '').trim()
    const model   = String(r.Model || '').trim()
    const my      = String(r.ModelYear || '').trim()
    const veh     = [my, make, model].filter(Boolean).join(' ')
    const comp    = String(r.Component || '').trim()
    const units   = r.PotentialNumberofUnitsAffected
    const headline = `${veh} — ${comp}${units ? ` (${Number(units).toLocaleString()} vehicles)` : ''}`
    const summary  = String(r.Summary || '').slice(0, 600)
    return {
      title:   headline.slice(0, 280),
      link:    `https://www.nhtsa.gov/recalls?nhtsaId=${encodeURIComponent(r.NHTSACampaignNumber)}`,
      pubDate: r._reportDate.toISOString(),
      summary,
      source:  'NHTSA Recalls',
    }
  })
}

const FUNCTIONS = {
  nhtsaRecentRecalls,
}

// ─── Public API ─────────────────────────────────────────────────────────────
export async function fetchSource(source) {
  if (source.type === 'fn') {
    const fn = FUNCTIONS[source.fn]
    if (!fn) return { items: [], error: `unknown fn: ${source.fn}` }
    try {
      const items = await fn()
      return { items, error: null }
    } catch (e) {
      return { items: [], error: e.message || 'fn failed' }
    }
  }

  const res = await axios.get(source.url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    timeout: FETCH_TIMEOUT,
    validateStatus: s => s < 500,
  })
  if (res.status >= 400) {
    return { items: [], error: `HTTP ${res.status}` }
  }
  const body = String(res.data || '')
  if (source.type === 'rss') {
    return { items: parseRSS(body, source.label), error: null }
  }
  return { items: [], error: `unknown source type: ${source.type}` }
}

// Fetch all sources in parallel, return aggregated items + per-source status.
export async function fetchAllSources() {
  const results = await Promise.allSettled(SOURCES.map(fetchSource))
  const items = []
  const status = []
  for (let i = 0; i < SOURCES.length; i++) {
    const src = SOURCES[i]
    const r = results[i]
    if (r.status === 'fulfilled') {
      const { items: srcItems, error } = r.value
      items.push(...srcItems)
      status.push({ id: src.id, label: src.label, ok: !error, error: error || null, count: srcItems.length })
    } else {
      status.push({ id: src.id, label: src.label, ok: false, error: r.reason?.message || 'fetch failed', count: 0 })
    }
  }
  return { items, status }
}

// Filter items to a recency window (default: last 48h).
// Items with no pubDate are kept (we can't tell — better to include than drop).
export function recentItems(items, hoursBack = 48) {
  const cutoff = Date.now() - hoursBack * 60 * 60 * 1000
  return items.filter(it => {
    if (!it.pubDate) return true
    const t = new Date(it.pubDate).getTime()
    return Number.isFinite(t) ? t >= cutoff : true
  })
}
