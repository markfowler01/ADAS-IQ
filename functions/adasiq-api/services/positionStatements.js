// 📋 OEM position-statement watcher (Mark 2026-09-24: "a bot that scours the
// web for OEM position statements, runs every day, and lets me know if there
// are new ones").
//
// Two hubs carry essentially everything the industry publishes:
//   • I-CAR RTS  — reverse-chronological index, title + date per entry
//   • OEM1Stop   — the OEMs' own PDFs, linked directly
// Each run reads both, drops anything already in AdasPositionStatements or
// already dismissed, keeps what is actually about ADAS / scanning /
// calibration, and tells Mark. Reports go to Mark's alerts channel only —
// never #dispatch (Mark 2026-09-24). New PDFs are read by Claude and filed in the
// table with a summary and a "why this matters" note in Mark's terms.
//
// It never publishes to absoluteadas.com — hosting a file on the public site
// is Mark's call, so doc_hosted_url stays empty until he says go.
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import Anthropic from '@anthropic-ai/sdk'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from './cliq.js'

const TABLE = 'AdasPositionStatements'
const SEEN_KEY = 'position_statements_seen'      // urls we've already judged
const RUN_KEY = 'position_statements_last_run'   // PT day stamp
const QUEUE_KEY = 'position_statements_queue'    // PDFs waiting to be read
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; AbsoluteADAS-DocWatch/1.0)' }
const MAX_PDF = 20 * 1024 * 1024

const SOURCES = [
  { key: 'icar', name: 'I-CAR RTS', url: 'https://rts.i-car.com/collision-repair-news/oem-position-statements.html', base: 'https://rts.i-car.com' },
  { key: 'oem1stop', name: 'OEM1Stop', url: 'https://www.oem1stop.com/position-statements', base: 'https://www.oem1stop.com' },
]

// Only things that touch what we actually get paid for.
const RELEVANT = /(adas|calibrat|scan(ning)?|pre-?scan|post-?scan|sensor|camera|radar|lidar|lane|blind ?spot|cruise|windshield|glass|aim|alignment|bumper|driver assist)/i
const OEMS = ['Stellantis', 'Acura', 'Alfa Romeo', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Fiat', 'Ford', 'Genesis', 'GM', 'General Motors', 'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Land Rover', 'Lexus', 'Lincoln', 'Lucid', 'Maserati', 'Mazda', 'Mercedes-Benz', 'Mercedes', 'Mini', 'Mitsubishi', 'Nissan', 'Polestar', 'Porsche', 'Ram', 'Rivian', 'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo', 'Karma', 'VinFast', 'Scout']
const oemFrom = t => { const s = String(t || ''); const hit = OEMS.find(o => new RegExp(`\\b${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s)); return hit === 'GM' ? 'General Motors' : hit === 'Mercedes' ? 'Mercedes-Benz' : (hit || '') }
const typeFrom = t => /position statement|position:/i.test(t) ? 'position_statement' : /guide|matrix|chart/i.test(t) ? 'coverage_guide' : /bulletin|tsb/i.test(t) ? 'bulletin' : 'reference'
// One brand, one name. Claude reads the PDF letterhead and returns things like
// "Ford Motor Company", "FCA US LLC (Stellantis / Mopar)" or "INFINITI"; the
// search chips need "Ford", "Stellantis", "Infiniti" (Mark 2026-09-24).
const OEM_ALIAS = { 'ford motor company': 'Ford', 'fca us llc': 'Stellantis', 'fca': 'Stellantis', 'mopar': 'Stellantis', 'chrysler group': 'Stellantis', 'general motors': 'General Motors', 'gm': 'General Motors', 'american honda': 'Honda', 'honda motor': 'Honda', 'toyota motor': 'Toyota', 'nissan north america': 'Nissan', 'hyundai motor': 'Hyundai', 'kia motors': 'Kia', 'kia america': 'Kia', 'mercedes benz': 'Mercedes-Benz', 'mbusa': 'Mercedes-Benz', 'subaru of america': 'Subaru', 'volkswagen group': 'Volkswagen', 'snap-on / john bean': 'Snap-on', 'john bean': 'Snap-on', 'hunter engineering': 'Hunter', 'launch tech': 'Launch', 'rivian automotive': 'Rivian', 'lucid motors': 'Lucid' }
export function canonicalOem(raw) {
  let t = String(raw || '').trim()
  if (!t) return ''
  const paren = t.match(/\(([^)]+)\)/)                       // "Lincoln (Ford Motor Company)" → keep Lincoln
  t = t.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t && paren) t = paren[1].trim()
  const key = t.toLowerCase().replace(/[.,]/g, '').trim()
  if (OEM_ALIAS[key]) return OEM_ALIAS[key]
  for (const [k, v] of Object.entries(OEM_ALIAS)) if (key.startsWith(k)) return v
  const known = OEMS.find(o => o.toLowerCase() === key); if (known) return known === 'GM' ? 'General Motors' : known === 'Mercedes' ? 'Mercedes-Benz' : known
  // ALL CAPS or all lower → Title Case, hyphens kept (Snap-on, Mercedes-Benz)
  if (t === t.toUpperCase() || t === t.toLowerCase()) t = t.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase())
  return t.slice(0, 60)
}
const abs = (href, base) => { try { return new URL(href, base).toString() } catch { return '' } }
const clean = s => String(s || '').replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
// oem1stop links arrive %20-encoded in one place and spaced in another; the
// same PDF must not read as new because of that.
// AppConfig values cap near 10k chars, so the seen-list holds a short hash per
// document, never the URL itself (400+ URLs blew the row and the write failed
// silently on the first live run, 2026-09-24).
export const urlHash = u => { const t = normUrl(u); let x = 0; for (let i = 0; i < t.length; i++) x = (Math.imul(x, 31) + t.charCodeAt(i)) | 0; return (x >>> 0).toString(36) }
export const normUrl = u => { let t = String(u || ''); try { t = decodeURIComponent(t) } catch { /* leave it */ } return t.toLowerCase().replace(/[\s_%]+/g, '').replace(/\/+$/, '') }
const ptDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

// ── AppConfig helpers ────────────────────────────────────────────────────────
async function cfg(req, key, fb) {
  try { const r = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key}' LIMIT 1`); const row = r?.[0]?.AppConfig; if (!row) return { row: null, value: fb }; try { return { row: String(row.ROWID), value: JSON.parse(row.config_value) } } catch { return { row: String(row.ROWID), value: row.config_value } } } catch { return { row: null, value: fb } }
}
async function cfgSet(req, key, row, value) {
  const t = catalyst.initialize(req, { type: 'advancedio' }).datastore().table('AppConfig'); const v = typeof value === 'string' ? value : JSON.stringify(value)
  if (row) await t.updateRow({ ROWID: row, config_key: key, config_value: v }); else await t.insertRow({ config_key: key, config_value: v })
}

// ── Sources ──────────────────────────────────────────────────────────────────
async function fetchIcar(src) {
  const { data: html } = await axios.get(src.url, { headers: UA, timeout: 25000 })
  const out = []
  // <a href="/crn-2465.html">Title</a> … nearby date text
  const re = /<a[^>]+href="((?:https?:\/\/rts\.i-car\.com)?\/crn-\d+\.html)"[^>]*>([\s\S]{3,200}?)<\/a>([\s\S]{0,300}?)(?=<a[^>]+href="\/crn-|$)/gi
  let m
  while ((m = re.exec(html))) {
    const title = clean(m[2]); if (!title || title.length < 8) continue
    const tail = m[3] || ''
    const d = tail.match(/(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i)
      || tail.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i)
    let published = ''
    if (d) { const p = new Date(d[1].replace(/(\d+)(st|nd|rd|th)/, '$1')); if (!isNaN(p)) published = p.toISOString().slice(0, 10) }
    out.push({ source: src.name, source_key: src.key, title, url: abs(m[1], src.base), published, is_pdf: false })
  }
  return out
}
async function fetchOem1stop(src) {
  const { data: html } = await axios.get(src.url, { headers: UA, timeout: 25000 })
  const out = []
  const re = /<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]{0,200}?)<\/a>/gi
  let m
  while ((m = re.exec(html))) {
    const url = abs(m[1], src.base); if (!url) continue
    const file = decodeURIComponent(url.split('/').pop() || '')
    const title = clean(m[2]) || file.replace(/[_-]+/g, ' ').replace(/\.pdf$/i, '')
    // Filenames carry the date: Lucid_POS_…(9-1-26).pdf
    const d = file.match(/\((\d{1,2})[-_](\d{1,2})[-_](\d{2,4})\)/)
    let published = ''
    if (d) { const y = d[3].length === 2 ? `20${d[3]}` : d[3]; published = `${y}-${String(d[1]).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}` }
    out.push({ source: src.name, source_key: src.key, title, url, published, is_pdf: true, filename: file })
  }
  return out
}

export async function fetchAllSources() {
  const found = [], errors = []
  for (const src of SOURCES) {
    try { found.push(...(src.key === 'icar' ? await fetchIcar(src) : await fetchOem1stop(src))) }
    catch (e) { errors.push(`${src.name}: ${e.message}`); console.warn(`[pos-stmt] ${src.name} failed:`, e.message) }
  }
  // de-dupe by url, keep the first title we saw
  const byUrl = new Map()
  for (const f of found) if (f.url && !byUrl.has(f.url)) byUrl.set(f.url, f)
  return { items: [...byUrl.values()], errors }
}

// ── What we already know ─────────────────────────────────────────────────────
export async function knownUrls(req) {
  const set = new Set()
  try {
    const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT doc_source_url, doc_filename FROM ${TABLE} LIMIT 300`)
    for (const r of rows || []) { const x = r?.[TABLE] || r; if (x?.doc_source_url) set.add(normUrl(x.doc_source_url)); if (x?.doc_filename) set.add(normUrl(x.doc_filename)) }
  } catch (e) { console.warn('[pos-stmt] table read failed:', e.message) }
  return set
}

// ── Claude reads the PDF ─────────────────────────────────────────────────────
async function summarizePdf(buffer, hint) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 900,
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } },
      { type: 'text', text: `This is a collision-industry document (likely an OEM position statement). Absolute ADAS is a mobile ADAS calibration company that bills insurers; Mark uses these to defend calibration line items when an adjuster pushes back.

Return JSON only:
{
 "oem": "manufacturer or equipment maker, e.g. Ford, Mazda, Hunter Engineering",
 "type": "position_statement | coverage_guide | bulletin | reference",
 "title": "the document's own title, with the month and year in parentheses if shown",
 "published_date": "YYYY-MM-DD or empty",
 "summary": "3-4 sentences: what the OEM requires, on which vehicles/conditions, and what it says about scanning and calibration. Concrete, no fluff.",
 "notes": "one or two sentences to Mark on how to USE this — which claim it wins, what to quote at an adjuster. Plain words.",
 "adas_relevant": true/false
}
${hint ? `\nContext from the page that linked it: ${hint}` : ''}` },
    ] }],
  })
  const raw = msg.content?.find(b => b.type === 'text')?.text || ''
  const out = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
  return out
}

/**
 * File a PDF we already hold the bytes for — Mark's own curated collection in
 * WorkDrive (2026-09-24), not something scraped off the web.
 */
export async function importBuffer(req, { buffer, filename, sourceLabel = '', oemHint = '' }) {
  if (!buffer || buffer.length < 512 || buffer.slice(0, 5).toString('latin1') !== '%PDF-') throw new Error('not a PDF')
  const meta = await summarizePdf(buffer, [oemHint ? `Filed by Absolute ADAS under "${oemHint}"` : '', filename].filter(Boolean).join(' · '))
  const name = String(filename || 'document.pdf').replace(/[^\w.\- ]+/g, '-').slice(0, 200)
  const row = {
    doc_oem: canonicalOem(meta.oem || oemHint).slice(0, 120),
    doc_type: String(meta.type || 'reference').slice(0, 60),
    doc_title: String(meta.title || name.replace(/\.pdf$/i, '')).slice(0, 400),
    doc_filename: name,
    doc_summary: String(meta.summary || '').slice(0, 2000),
    doc_notes: String(meta.notes || '').slice(0, 1000),
    doc_source_url: String(sourceLabel || `workdrive:${name}`).slice(0, 600),
    doc_hosted_url: '',
    doc_published_date: String(meta.published_date || '').slice(0, 10),
    doc_file_size_bytes: String(buffer.length),
    doc_imported_at: new Date().toISOString(),
  }
  const inserted = await catalyst.initialize(req, { type: 'advancedio' }).datastore().table(TABLE).insertRow(row)
  return { imported: true, row: { ...row, ROWID: inserted?.ROWID || '' } }
}

/** Download a PDF, read it, and file it in AdasPositionStatements. */
export async function importPdf(req, item) {
  const r = await axios.get(item.url, { headers: UA, responseType: 'arraybuffer', timeout: 45000, maxContentLength: MAX_PDF })
  const buffer = Buffer.from(r.data)
  if (buffer.length < 512 || buffer.slice(0, 5).toString('latin1') !== '%PDF-') throw new Error('not a PDF')
  const meta = await summarizePdf(buffer, item.title)
  if (meta.adas_relevant === false) return { skipped: 'not ADAS related', meta }
  const filename = (item.filename || item.url.split('/').pop() || 'document.pdf').replace(/[^\w.\-]+/g, '-').toLowerCase()
  const row = {
    doc_oem: canonicalOem(meta.oem || oemFrom(item.title)).slice(0, 120),
    doc_type: String(meta.type || typeFrom(item.title)).slice(0, 60),
    doc_title: String(meta.title || item.title).slice(0, 400),
    doc_filename: filename.slice(0, 200),
    doc_summary: String(meta.summary || '').slice(0, 2000),
    doc_notes: String(meta.notes || '').slice(0, 1000),
    doc_source_url: String(item.url).slice(0, 600),
    doc_hosted_url: '',                       // stays empty until Mark says publish
    doc_published_date: String(meta.published_date || item.published || '').slice(0, 10),
    doc_file_size_bytes: String(buffer.length),
    doc_imported_at: new Date().toISOString(),
  }
  const inserted = await catalyst.initialize(req, { type: 'advancedio' }).datastore().table(TABLE).insertRow(row)
  return { imported: true, row: { ...row, ROWID: inserted?.ROWID || inserted?.toJSON?.()?.ROWID || '' } }
}

/**
 * One daily pass. dry:true reads and reports without writing anything.
 * onceADay:true makes repeat calls in the same PT day no-ops (the schedulers
 * are unreliable, so several things call this).
 */
export async function scanPositionStatements(req, { dry = false, onceADay = false, maxImports = 4 } = {}) {
  const out = { checked: 0, relevant: 0, new: 0, imported: [], flagged: [], errors: [], dry }
  let dayRow = null
  if (onceADay) {
    const { row, value } = await cfg(req, RUN_KEY, '')
    if (String(value) === ptDay()) { out.skipped = 'already ran today'; return out }
    dayRow = { row }   // stamped at the END, so a run the gateway kills retries
  }
  const stampDay = async () => { if (onceADay && !dry) await cfgSet(req, RUN_KEY, dayRow.row, ptDay()).catch(() => {}) }
  const { items, errors } = await fetchAllSources()
  out.errors.push(...errors)
  out.checked = items.length
  const known = await knownUrls(req)
  const { row: seenRow, value: seenVal } = await cfg(req, SEEN_KEY, [])
  const seen = new Set(Array.isArray(seenVal) ? seenVal : [])

  const fresh = items.filter(i => RELEVANT.test(i.title))
  out.relevant = fresh.length
  // FIRST RUN: the hubs carry years of back-catalogue. Record it all as seen
  // and tell Mark the watch is armed, rather than crying "393 new documents".
  // The back-catalogue is imported on demand with backfillPositionStatements().
  const firstRun = !seen.size
  const news = fresh.filter(i => !known.has(normUrl(i.url)) && !known.has(normUrl(i.filename || '')) && !seen.has(urlHash(i.url)))
  out.new = news.length
  if (firstRun) {
    out.baseline = true
    for (const i of news) seen.add(urlHash(i.url))
    if (!dry) await cfgSet(req, SEEN_KEY, seenRow, [...seen].slice(-900))
    out.catalogued = news.length
    out.newest = news.slice().sort((a, b) => String(b.published || '').localeCompare(String(a.published || ''))).slice(0, 10).map(i => ({ oem: oemFrom(i.title), title: i.title, published: i.published, url: i.url }))
    await stampDay()
    console.log(`[pos-stmt] baseline set: ${news.length} documents catalogued, watching from here`)
    if (!dry) await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `📋 *OEM document watch is on.* Baseline set from I-CAR RTS and OEM1Stop: ${news.length} ADAS-related documents catalogued. From now on you only hear about ones that appear after today.`).catch(() => {})
    return out
  }
  if (!news.length) { await stampDay(); console.log(`[pos-stmt] ${out.checked} checked, ${out.relevant} relevant, nothing new`); return out }

  // Newest first so a capped run takes the ones that matter.
  news.sort((a, b) => String(b.published || '').localeCompare(String(a.published || '')))
  const { row: qRow, value: qVal } = await cfg(req, QUEUE_KEY, [])
  const queue = Array.isArray(qVal) ? qVal : []
  for (const item of news) {
    if (dry) { out.flagged.push({ ...item, oem: oemFrom(item.title), type: typeFrom(item.title) }); continue }
    seen.add(urlHash(item.url))
    out.flagged.push({ ...item, oem: oemFrom(item.title), type: typeFrom(item.title) })
    if (item.is_pdf && queue.length < maxImports) queue.push({ url: item.url, title: item.title, filename: item.filename || '', published: item.published || '' })
  }
  if (!dry) await cfgSet(req, SEEN_KEY, seenRow, [...seen].slice(-600))
  await announce(req, out)
  return out
}

async function announce(req, out) {
  if (!out.imported.length && !out.flagged.length) return
  const lines = ['📋 *New OEM position statements found today*']
  for (const d of out.imported) lines.push(`✅ *${d.oem || 'OEM'}* — ${d.title}${d.published ? ` (${d.published})` : ''}\n   Filed in the library. [source](${d.url})`)
  for (const f of out.flagged.slice(0, 8)) lines.push(`👀 *${f.oem || 'OEM'}* — ${f.title}${f.published ? ` (${f.published})` : ''}${f.why ? ` · ${f.why}` : ''}\n   [open](${f.url})`)
  if (out.flagged.length > 8) lines.push(`…and ${out.flagged.length - 8} more.`)
  if (out.errors.length) lines.push(`⚠ ${out.errors.slice(0, 3).join(' · ')}`)
  await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, lines.join('\n')).catch(e => console.warn('[pos-stmt] cliq failed:', e.message))
  try {
    const { createNotification } = await import('../routes/notifications.js')
    await createNotification(req, { to: 'Mark', toEmail: 'mark@absoluteadas.com', type: 'onboarding', title: `📋 ${out.imported.length + out.flagged.length} new OEM document${out.imported.length + out.flagged.length === 1 ? '' : 's'}`, body: [...out.imported, ...out.flagged].slice(0, 3).map(d => `${d.oem || 'OEM'}: ${d.title}`).join(' · ').slice(0, 300), skipCliq: true, skipTechChannel: true })
  } catch (e) { console.warn('[pos-stmt] bell failed:', e.message) }
}

/**
 * Pull the back-catalogue into the library on demand — newest first, capped.
 * Mark runs this when he wants the library filled; the daily watch never does
 * it on its own (each PDF costs a Claude read).
 */
export async function backfillPositionStatements(req, { limit = 5, oem = '' } = {}) {
  // The Catalyst gateway kills a request at ~30s and one PDF read costs ~17s,
  // so this queues the work and imports only what fits in a safe budget. The
  // rest drains on its own from the board ticker (Mark hit the cap with
  // limit=5 on 2026-09-24).
  const t0 = Date.now()
  // Only start an import while there is a full read's worth of headroom left.
  // Source fetching eats ~10s, a Claude PDF read ~17s, the gateway dies at 30s
  // — so realistically this files one and queues the rest.
  const BUDGET_MS = 7000
  const want = Math.min(Math.max(Number(limit) || 5, 1), 40)
  const out = { imported: [], failed: [], requested: want, oem }
  const { items, errors } = await fetchAllSources()
  const known = await knownUrls(req)
  let pool = items.filter(i => i.is_pdf && RELEVANT.test(i.title) && !known.has(normUrl(i.url)))
  if (oem) pool = pool.filter(i => new RegExp(oem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(i.title))
  pool.sort((a, b) => String(b.published || '').localeCompare(String(a.published || '')))

  const { row: qRow, value: qVal } = await cfg(req, QUEUE_KEY, [])
  const queue = Array.isArray(qVal) ? qVal : []
  const have = new Set(queue.map(x => normUrl(x.url)))
  for (const i of pool.slice(0, want)) if (!have.has(normUrl(i.url))) { queue.push({ url: i.url, title: i.title, filename: i.filename || '', published: i.published || '' }); have.add(normUrl(i.url)) }
  await cfgSet(req, QUEUE_KEY, qRow, queue.slice(0, 60))

  // Import what fits, then hand the rest to the ticker.
  const { row: seenRow, value: seenVal } = await cfg(req, SEEN_KEY, [])
  const seen = new Set(Array.isArray(seenVal) ? seenVal : [])
  while (queue.length && Date.now() - t0 < BUDGET_MS) {
    const item = queue.shift()
    await cfgSet(req, QUEUE_KEY, qRow, queue)   // drop first — a bad PDF can never loop
    try {
      const r = await importPdf(req, { ...item, is_pdf: true })
      if (r.imported) { out.imported.push({ oem: r.row.doc_oem, title: r.row.doc_title, published: r.row.doc_published_date }); seen.add(urlHash(item.url)) }
      else out.failed.push({ title: item.title, why: r.skipped })
    } catch (e) { out.failed.push({ title: item.title, why: e.message }) }
  }
  await cfgSet(req, SEEN_KEY, seenRow, [...seen].slice(-900))
  out.errors = errors
  out.left_in_queue = queue.length
  out.more_available = Math.max(0, pool.length - want)
  out.note = queue.length ? `${queue.length} queued — they file themselves as the app is used, or call /position-statements/import-next.` : 'Queue empty.'
  if (out.imported.length) await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `📋 *${out.imported.length} document${out.imported.length === 1 ? '' : 's'} added to the OEM library*\n${out.imported.map(d => `• ${d.oem || 'OEM'} — ${d.title}${d.published ? ` (${d.published})` : ''}`).join('\n')}${queue.length ? `\n${queue.length} more queued.` : ''}`).catch(() => {})
  return out
}

/** Read one queued PDF into the library. Call until left is 0. */
export async function importNextPositionStatement(req) {
  const { row, value } = await cfg(req, QUEUE_KEY, [])
  const queue = Array.isArray(value) ? value : []
  if (!queue.length) return { done: true, left: 0 }
  const item = queue.shift()
  await cfgSet(req, QUEUE_KEY, row, queue)   // drop it first — a bad PDF can't loop
  try {
    const r = await importPdf(req, { ...item, is_pdf: true })
    if (r.imported) {
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `📋 *Added to the OEM library* — ${r.row.doc_oem || 'OEM'}: ${r.row.doc_title}${r.row.doc_published_date ? ` (${r.row.doc_published_date})` : ''}\n${r.row.doc_summary.slice(0, 280)}\n_${r.row.doc_notes.slice(0, 200)}_`).catch(() => {})
      return { imported: r.row.doc_title, oem: r.row.doc_oem, left: queue.length }
    }
    return { skipped: r.skipped, title: item.title, left: queue.length }
  } catch (e) { return { failed: e.message, title: item.title, left: queue.length } }
}

/**
 * The OEM library as context for the CCC scrubber (Mark 2026-09-24: "I want
 * the scrubber to use this as a reference also"). Compact on purpose: the
 * matching make gets its full summary, everyone else a one-liner, so the
 * prompt stays small enough to ride along with no extra Claude call.
 */
export async function oemReferenceBlock(req, { make = '' } = {}) {
  try {
    const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(
      `SELECT doc_oem, doc_type, doc_title, doc_summary, doc_notes, doc_published_date FROM ${TABLE} LIMIT 300`)
    const docs = (rows || []).map(r => r[TABLE] || r).filter(d => d.doc_title)
    if (!docs.length) return ''
    const want = canonicalOem(make).toLowerCase()
    const mine = want ? docs.filter(d => canonicalOem(d.doc_oem).toLowerCase() === want) : []
    const rest = docs.filter(d => !mine.includes(d))
    const line = (d, long) => `- ${canonicalOem(d.doc_oem) || 'OEM'}: "${d.doc_title}"${d.doc_published_date ? ` (${d.doc_published_date})` : ''}${long ? `\n    ${String(d.doc_summary || '').replace(/\s+/g, ' ').slice(0, 420)}` : ''}`
    const parts = []
    if (mine.length) parts.push(`What ${canonicalOem(make)} itself publishes (use these first, cite them by name):\n${mine.map(d => line(d, true)).join('\n')}`)
    if (rest.length) parts.push(`Other manufacturers' statements on file (only relevant if this vehicle is one of them):\n${rest.slice(0, 60).map(d => line(d, false)).join('\n')}`)
    return parts.join('\n\n')
  } catch (e) { console.warn('[pos-stmt] reference block failed:', e.message); return '' }
}
