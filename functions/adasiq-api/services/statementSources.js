// 🔭 Where we look for OEM position statements — and the bot that finds new
// places to look (Mark 2026-09-28: "search like 50 or 60 or 100 sources"
// and "a bot that just searches for new places to find these OE position
// statements and adds them to the source search list").
//
// Two things live here:
//   1. The source registry (AdasStatementSources): every page the daily
//      watcher reads, with health per source — last checked, last status,
//      fail count, how many items it has ever produced. Sources are rows,
//      not code, so adding one is an insert, not a deploy.
//   2. The discovery bot: a weekly Claude web-search pass that hunts for
//      pages publishing these documents, verifies each one really answers
//      and really carries the vocabulary, and adds it to the registry —
//      enabled, tagged "discovery bot", with a message to Mark listing what
//      it added. Anything that turns out useless is one switch to disable.
//
// A generic reader handles most sources: it harvests every link on the page
// that points at a PDF or reads like a position statement / bulletin. The
// two original hubs keep their hand parsers (passed in by the caller, so
// this file never imports positionStatements.js and there is no cycle).
//
// Seen-ness moved from a capped AppConfig list to AdasStatementSeen, because
// a hundred sources produce more judged URLs than a 10k row can hold.
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import Anthropic from '@anthropic-ai/sdk'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from './cliq.js'

const SRC = 'AdasStatementSources'
const SEEN = 'AdasStatementSeen'
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; AbsoluteADAS-DocWatch/1.0)' }
const ds = req => catalyst.initialize(req, { type: 'advancedio' })
const nowIso = () => new Date().toISOString()
const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const q = s => String(s ?? '').replace(/'/g, "''")

// Same vocabulary the watcher uses to decide what is worth a look.
export const RELEVANT = /(position statement|adas|calibrat|scan(ning)?|pre-?scan|post-?scan|sensor|camera|radar|lidar|lane|blind ?spot|cruise|windshield|glass|aim|alignment|bumper|driver assist)/i
export const normUrl = u => { let t = String(u || ''); try { t = decodeURIComponent(t) } catch { /* leave it */ } return t.toLowerCase().replace(/[\s_%]+/g, '').replace(/\/+$/, '') }
export const urlHash = u => { const t = normUrl(u); let x = 0; for (let i = 0; i < t.length; i++) x = (Math.imul(x, 31) + t.charCodeAt(i)) | 0; return (x >>> 0).toString(36) }
const abs = (href, base) => { try { return new URL(href, base).toString() } catch { return '' } }
const clean = s => String(s || '').replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const domainOf = u => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }
const keyFor = (name, url) => (str(name, 40) || domainOf(url)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || urlHash(url)

// ── The list we start from ──────────────────────────────────────────────────
// The two hubs, plus every public page that answered the 2026-09-28 probe
// with document vocabulary. Manufacturer tech-info portals (Honda, Nissan,
// Subaru, Kia, BMW, JLR, Audi erWin) are login walls and are NOT here — a
// bot cannot sign in, and must not. The discovery bot grows this list.
export const BUILTIN_SOURCES = [
  { key: 'icar', name: 'I-CAR RTS · OEM position statements', url: 'https://rts.i-car.com/collision-repair-news/oem-position-statements.html', base: 'https://rts.i-car.com', kind: 'hub', parser: 'icar' },
  { key: 'oem1stop', name: 'OEM1Stop · position statements', url: 'https://www.oem1stop.com/position-statements', base: 'https://www.oem1stop.com', kind: 'hub', parser: 'oem1stop' },
  { key: 'mopar-repair-connect', name: 'Mopar Repair Connect (Stellantis)', url: 'https://www.moparrepairconnect.com/', kind: 'oem', oem: 'Stellantis' },
  { key: 'ford-crash-parts', name: 'Ford Crash Parts', url: 'https://fordcrashparts.com/', kind: 'oem', oem: 'Ford' },
  { key: 'mb-collision-centers', name: 'Mercedes-Benz Collision Centers', url: 'https://www.mbcollisioncenters.com/home', kind: 'oem', oem: 'Mercedes-Benz' },
  { key: 'hyundai-techinfo', name: 'Hyundai Tech Info (public pages)', url: 'https://www.hyundaitechinfo.com/', kind: 'oem', oem: 'Hyundai' },
  { key: 'i-car', name: 'I-CAR', url: 'https://www.i-car.com/', kind: 'industry' },
  { key: 'cic', name: 'Collision Industry Conference', url: 'https://ciclink.com/', kind: 'industry' },
  { key: 'scrs', name: 'SCRS', url: 'https://scrs.com/', kind: 'industry' },
  { key: 'repairer-driven-news', name: 'Repairer Driven News', url: 'https://www.repairerdrivennews.com/', kind: 'news' },
  { key: 'autobody-news', name: 'Autobody News', url: 'https://www.autobodynews.com/', kind: 'news' },
  { key: 'fenderbender', name: 'FenderBender', url: 'https://www.fenderbender.com/', kind: 'news' },
  { key: 'collisionweek', name: 'CollisionWeek', url: 'https://collisionweek.com/', kind: 'news' },
  { key: 'hunter-adas', name: 'Hunter Engineering · ADAS', url: 'https://www.hunter.com/adas', kind: 'tool', oem: 'Hunter' },
  { key: 'opus-ivs', name: 'Opus IVS', url: 'https://opusivs.com/', kind: 'tool' },
  { key: 'autel', name: 'Autel', url: 'https://www.autel.com/', kind: 'tool', oem: 'Autel' },
  { key: 'astech', name: 'asTech · training resources', url: 'https://www.astech.com/pages/training-resources', kind: 'tool' },
  { key: 'bosch-diagnostics', name: 'Bosch Diagnostics', url: 'https://www.boschdiagnostics.com/', kind: 'tool' },
]

// ── Registry ────────────────────────────────────────────────────────────────
const shape = r => ({
  id: String(r.ROWID || ''), key: r.src_key || '', name: r.src_name || '', url: r.src_url || '', base: r.src_base || '',
  kind: r.src_kind || '', oem: r.src_oem || '', enabled: String(r.src_enabled) === 'true', parser: r.src_parser || 'generic',
  addedBy: r.src_added_by || '', addedAt: r.src_added_at || '', foundBy: r.src_found_by || '',
  lastChecked: r.src_last_checked || '', lastStatus: r.src_last_status || '', lastHash: r.src_last_hash || '',
  failCount: Number(r.src_fail_count || 0), itemsTotal: Number(r.src_items_total || 0), itemsRelevant: Number(r.src_items_relevant || 0), newTotal: Number(r.src_new_total || 0),
  notes: r.src_notes || '', verifyNote: r.src_verify_note || '',
})
const COLS = 'ROWID, src_key, src_name, src_url, src_base, src_kind, src_oem, src_enabled, src_parser, src_added_by, src_added_at, src_found_by, src_last_checked, src_last_status, src_last_hash, src_fail_count, src_items_total, src_items_relevant, src_new_total, src_notes, src_verify_note'

export async function listSources(req, { enabledOnly = false } = {}) {
  const out = []
  for (let off = 0; off < 1000; off += 200) {
    const rows = await ds(req).zcql().executeZCQLQuery(`SELECT ${COLS} FROM ${SRC} ORDER BY CREATEDTIME ASC LIMIT 200 OFFSET ${off}`)
    const page = (rows || []).map(r => shape(r[SRC] || r))
    out.push(...page); if (page.length < 200) break
  }
  return enabledOnly ? out.filter(s => s.enabled) : out
}

export async function getSource(req, key) {
  const rows = await ds(req).zcql().executeZCQLQuery(`SELECT ${COLS} FROM ${SRC} WHERE src_key = '${q(key)}' LIMIT 1`)
  const r = (rows || [])[0]; return r ? shape(r[SRC] || r) : null
}

export async function addSource(req, s, { by = 'staff', foundBy = '', verifyNote = '', enabled = true } = {}) {
  const key = s.key || keyFor(s.name, s.url)
  const have = await getSource(req, key)
  if (have) return { ok: true, existed: true, source: have }
  // Same page under a different name is still the same page (two discovery
  // runs overlapped on 2026-09-28 and added a few twice).
  const dupe = (await listSources(req)).find(x => normUrl(x.url) === normUrl(s.url))
  if (dupe) return { ok: true, existed: true, source: dupe }
  const row = {
    src_key: key, src_name: str(s.name, 200), src_url: str(s.url, 255), src_base: str(s.base || (() => { try { return new URL(s.url).origin } catch { return '' } })(), 200),
    src_kind: str(s.kind || 'other', 30), src_oem: str(s.oem, 60), src_enabled: enabled ? 'true' : 'false', src_parser: str(s.parser || 'generic', 20),
    src_added_by: str(by, 120), src_added_at: nowIso(), src_found_by: str(foundBy, 120), src_fail_count: 0, src_items_total: 0, src_items_relevant: 0, src_new_total: 0,
    src_notes: str(s.notes || s.why, 2000), src_verify_note: str(verifyNote, 2000),
  }
  await ds(req).datastore().table(SRC).insertRow(row)
  return { ok: true, existed: false, source: shape({ ...row, ROWID: '' }) }
}

export async function setSourceEnabled(req, key, enabled, by = 'staff') {
  const s = await getSource(req, key); if (!s) return { ok: false, error: 'no such source' }
  await ds(req).datastore().table(SRC).updateRow({ ROWID: s.id, src_enabled: enabled ? 'true' : 'false', src_notes: str(`${s.notes ? s.notes + ' · ' : ''}${enabled ? 'enabled' : 'disabled'} by ${by} ${nowIso().slice(0, 10)}`, 2000) })
  return { ok: true, key, enabled }
}

async function stampSource(req, s, patch) {
  try { await ds(req).datastore().table(SRC).updateRow({ ROWID: s.id, ...patch }) } catch (e) { console.warn('[sources] stamp failed:', s.key, e.message) }
}

// ── Verify: does this page answer, and does it carry the vocabulary? ────────
export async function verifySource(url) {
  try {
    const r = await axios.get(url, { headers: UA, timeout: 15000, maxRedirects: 5, validateStatus: () => true, responseType: 'text', maxContentLength: 3 * 1024 * 1024 })
    const html = String(r.data || '')
    const hits = (html.match(RELEVANT) || []).length + (html.match(/position statement/gi) || []).length
    const login = (html.match(/sign in|log ?in|password/gi) || []).length
    const pdfs = (html.match(/href="[^"]+\.pdf/gi) || []).length
    if (r.status < 200 || r.status >= 300) return { ok: false, status: r.status, note: `HTTP ${r.status}` }
    if (hits === 0) return { ok: false, status: r.status, note: 'reachable, but no position-statement vocabulary on the page' }
    if (login >= 20 && hits <= 2) return { ok: false, status: r.status, note: 'looks like a login wall' }
    return { ok: true, status: r.status, note: `${hits} vocabulary hit${hits === 1 ? '' : 's'}, ${pdfs} PDF link${pdfs === 1 ? '' : 's'}`, hits, pdfs, finalUrl: r.request?.res?.responseUrl || url }
  } catch (e) { return { ok: false, status: 0, note: e.code || e.message } }
}

// ── Generic reader ─────────────────────────────────────────────────────────
// Every link that is a PDF or whose text / path reads like one of these
// documents. Nav chrome ("Sign in", "Products") never matches, so it costs
// nothing. Items come out in the same shape the hub parsers produce.
export function genericItems(html, src) {
  const out = [], seen = new Set()
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi
  let m
  while ((m = re.exec(html)) && out.length < 250) {
    const url = abs(m[1], src.base || src.url); if (!url || !/^https?:/i.test(url)) continue
    const text = clean(m[2]); const isPdf = /\.pdf(\?|$)/i.test(url)
    const path = decodeURIComponent(url.split('/').slice(3).join('/')).replace(/[-_]+/g, ' ')
    if (!isPdf && !(RELEVANT.test(text) || RELEVANT.test(path))) continue
    if (!isPdf && text.length < 8) continue
    const n = normUrl(url); if (seen.has(n)) continue; seen.add(n)
    const file = isPdf ? decodeURIComponent(url.split('/').pop() || '') : ''
    const title = text || file.replace(/[_-]+/g, ' ').replace(/\.pdf$/i, '') || path.slice(0, 120)
    let published = ''
    const d = (text + ' ' + file).match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/) || (text + ' ' + file).match(/\((\d{1,2})[-_](\d{1,2})[-_](\d{2,4})\)/)
    if (d) published = d[1].length === 4 ? `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}` : `${d[3].length === 2 ? '20' + d[3] : d[3]}-${d[1].padStart(2, '0')}-${d[2].padStart(2, '0')}`
    else { const y = (text + ' ' + file).match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})\b/i); if (y) { const p = new Date(y[0]); if (!isNaN(p)) published = p.toISOString().slice(0, 10) } }
    out.push({ source: src.name, source_key: src.key, title: str(title, 200), url, published, is_pdf: isPdf, filename: file })
  }
  return out
}
const pageHash = items => urlHash(items.map(i => i.url).sort().join('|'))

/**
 * Read the sources that are due, oldest-checked first. `parsers` maps a
 * parser name to the hub reader (icar / oem1stop) so the originals keep
 * their exact behaviour. Returns the merged items plus per-source health.
 */
export async function checkSources(req, { parsers = {}, max = 15, budgetMs = 20000, only = '' } = {}) {
  const t0 = Date.now()
  let sources = (await listSources(req, { enabledOnly: true })).sort((a, b) => String(a.lastChecked).localeCompare(String(b.lastChecked)))
  if (only) sources = sources.filter(s => s.key === only)
  const items = [], errors = [], checked = []
  const ptDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const readToday = s => String(s.lastChecked || '').slice(0, 10) >= ptDay   // ISO stamp vs PT day: close enough for a daily cycle
  for (const s of sources.slice(0, max)) {
    const first = !s.lastChecked                    // never read before → its catalogue is baseline, not news
    if (Date.now() - t0 > budgetMs) break
    try {
      let list
      if (s.parser && parsers[s.parser]) list = await parsers[s.parser]({ key: s.key, name: s.name, url: s.url, base: s.base })
      else {
        const r = await axios.get(s.url, { headers: UA, timeout: 15000, maxRedirects: 5, responseType: 'text', maxContentLength: 3 * 1024 * 1024 })
        list = genericItems(String(r.data || ''), s)
      }
      const relevant = list.filter(i => RELEVANT.test(i.title) || i.is_pdf).map(i => ({ ...i, first }))
      const h = pageHash(list)
      items.push(...relevant)
      checked.push({ key: s.key, items: list.length, relevant: relevant.length, changed: h !== s.lastHash, first })
      await stampSource(req, s, { src_last_checked: nowIso(), src_last_status: `ok · ${list.length} links, ${relevant.length} relevant${h === s.lastHash ? ' · unchanged' : ''}`, src_last_hash: h, src_fail_count: 0, src_items_total: list.length, src_items_relevant: relevant.length })
    } catch (e) {
      const fails = s.failCount + 1
      errors.push(`${s.name}: ${e.message}`)
      checked.push({ key: s.key, error: e.message })
      await stampSource(req, s, { src_last_checked: nowIso(), src_last_status: `FAIL · ${str(e.message, 150)}`, src_fail_count: fails })
      // Three days dead → one line to Mark, then quiet until it is fixed or disabled.
      if (fails === 3) await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🔭 *Source down 3 checks running:* ${s.name} — ${str(e.message, 120)}. It stays on the list; disable it under OEM Sources if it has moved.`).catch(() => {})
    }
  }
  const byUrl = new Map(); for (const i of items) if (i.url && !byUrl.has(i.url)) byUrl.set(i.url, i)
  const readKeys = new Set(checked.map(c => c.key))
  const due = sources.filter(s => !readKeys.has(s.key) && !readToday(s)).length
  return { items: [...byUrl.values()], errors, checked, due, ms: Date.now() - t0 }
}

export async function bumpNewCount(req, key, n) {
  if (!n) return
  const s = await getSource(req, key).catch(() => null); if (!s) return
  await stampSource(req, s, { src_new_total: s.newTotal + n })
}

// ── Seen table ──────────────────────────────────────────────────────────────
export async function seenHashes(req, hashes) {
  const have = new Set(); const list = [...new Set(hashes.filter(Boolean))]
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40).map(h => `'${q(h)}'`).join(',')
    try { const rows = await ds(req).zcql().executeZCQLQuery(`SELECT seen_hash FROM ${SEEN} WHERE seen_hash IN (${chunk}) LIMIT 200`); for (const r of rows || []) have.add((r[SEEN] || r).seen_hash) } catch (e) { console.warn('[sources] seen lookup failed:', e.message) }
  }
  return have
}
export async function markSeen(req, items, verdict = 'judged') {
  const t = ds(req).datastore().table(SEEN)
  for (const i of items) {
    try { await t.insertRow({ seen_hash: urlHash(i.url), seen_url: str(i.url, 255), seen_source: str(i.source_key, 64), seen_title: str(i.title, 255), seen_at: nowIso(), seen_published: str(i.published, 20), seen_verdict: str(verdict, 20) }) }
    catch (e) { console.warn('[sources] seen insert failed:', e.message) }
  }
}

/** Remove exact-URL duplicates, keeping the oldest row. Safe to run any time. */
export async function dedupeSources(req) {
  const all = await listSources(req)            // CREATEDTIME ASC, so the first is the oldest
  const keep = new Map(), drop = []
  for (const s of all) { const n = normUrl(s.url); if (keep.has(n)) drop.push(s); else keep.set(n, s) }
  for (const d of drop) { try { await ds(req).datastore().table(SRC).deleteRow(d.id) } catch (e) { console.warn('[sources] dedupe delete failed:', d.key, e.message) } }
  return { kept: keep.size, removed: drop.map(d => `${d.key} · ${d.url}`) }
}

// ── Seed ────────────────────────────────────────────────────────────────────
/** Put the built-in list in the registry (verifying each non-hub page first). Safe to run again. */
export async function seedSources(req, { verify = true } = {}) {
  const out = { added: [], existed: [], disabled: [] }
  for (const s of BUILTIN_SOURCES) {
    const have = await getSource(req, s.key); if (have) { out.existed.push(s.key); continue }
    let note = 'built-in hub', ok = true
    if (verify && s.kind !== 'hub') { const v = await verifySource(s.url); ok = v.ok; note = v.note }
    await addSource(req, s, { by: 'seed 2026-09-28', verifyNote: note, enabled: ok })
    ;(ok ? out.added : out.disabled).push(`${s.key} · ${note}`)
  }
  return out
}

// ── Discovery bot ───────────────────────────────────────────────────────────
/**
 * Hunt for new places that publish these documents. Claude runs real web
 * searches, proposes candidate pages we do not already watch, and every
 * candidate is fetched and checked before it is added. Adds are enabled and
 * tagged "discovery bot"; Mark gets one message listing them.
 */
export async function discoverSources(req, { maxAdds = 15, dry = false } = {}) {
  // One run at a time. The weekly ticker and a manual run collided on
  // 2026-09-28 and both added the same pages; the lock lives 15 minutes.
  try {
    const seg = catalyst.initialize(req).cache().segment()
    let last = null; try { last = await seg.getValue('discover_lock') } catch { last = null }
    if (last && Date.now() - Number(last) < 15 * 60000) return { skipped: 'a discovery run is already in progress', dry }
    try { await seg.update('discover_lock', String(Date.now()), 1) } catch { await seg.put('discover_lock', String(Date.now()), 1) }
  } catch { /* no cache = no lock; carry on */ }
  const have = await listSources(req)
  const haveDomains = new Set(have.map(s => domainOf(s.url)).filter(Boolean))
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const prompt = `You are helping Absolute ADAS, a mobile ADAS calibration company, find every web page that publishes automaker (OEM) position statements and repair bulletins about ADAS calibration, pre- and post-repair scanning, windshield/camera replacement, and radar/sensor aiming — the documents a collision shop or insurer would cite.

We already watch these domains, do NOT return them: ${[...haveDomains].sort().join(', ')}.

Search the web and return up to 20 NEW candidate pages. Prefer, in this order: (1) manufacturer collision-repair or technical-information pages that are PUBLIC (no login), (2) industry bodies and aggregators that republish OEM statements, (3) trade news sites with a dedicated OEM-position-statement or ADAS section, (4) calibration tool makers that host OEM statement libraries. Skip pages that need a login. Skip our own site (absoluteadas.com) and Kinetic.

We want pages that LIST the documents themselves — an index, library, archive or category page with links to the PDFs or bulletins — not articles or blog posts that merely talk about position statements. An article titled "how to find OEM position statements" is NOT a source. If a site has both a homepage and a dedicated position-statement page, give the dedicated page.

Return ONLY a JSON array, no prose, each item: {"name": "...", "url": "https://...", "kind": "oem|industry|news|tool", "oem": "brand or empty", "why": "one sentence on what the page publishes"}. URLs must be the specific page that lists the documents, not a homepage, whenever one exists.`
  const msg = await client.messages.create({
    model: 'claude-opus-4-7', max_tokens: 6000, thinking: { type: 'adaptive' },
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 10 }],
    messages: [{ role: 'user', content: prompt }],
  })
  const text = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
  let cands = []
  try { const m = text.match(/\[[\s\S]*\]/); cands = m ? JSON.parse(m[0]) : [] } catch { cands = [] }
  cands = (Array.isArray(cands) ? cands : []).filter(c => c && /^https?:/i.test(String(c.url || ''))).slice(0, 30)

  const out = { proposed: cands.length, added: [], rejected: [], skipped: [], dry }
  for (const c of cands) {
    const dom = domainOf(c.url)
    if (!dom || haveDomains.has(dom) || /absoluteadas|kinetic\.auto/i.test(dom)) { out.skipped.push(`${dom || c.url} · already watched`); continue }
    const v = await verifySource(c.url)
    if (!v.ok) { out.rejected.push(`${c.name || dom} · ${v.note}`); continue }
    if (out.added.length >= maxAdds) { out.skipped.push(`${c.name || dom} · over the per-run cap`); continue }
    if (!dry) await addSource(req, { name: c.name || dom, url: v.finalUrl || c.url, kind: c.kind || 'other', oem: c.oem || '', why: c.why || '' }, { by: 'discovery bot', foundBy: 'discovery bot', verifyNote: v.note, enabled: true })
    haveDomains.add(dom)
    out.added.push({ name: c.name || dom, url: v.finalUrl || c.url, kind: c.kind || 'other', oem: c.oem || '', note: v.note })
  }
  if (!dry && out.added.length) {
    const lines = [`🔭 *Source finder added ${out.added.length} new place${out.added.length === 1 ? '' : 's'} to watch for OEM position statements*`]
    for (const a of out.added) lines.push(`• *${a.name}*${a.oem ? ` (${a.oem})` : ''} — ${a.note}\n   ${a.url}`)
    if (out.rejected.length) lines.push(`Checked and rejected ${out.rejected.length}: ${out.rejected.slice(0, 4).join(' · ')}${out.rejected.length > 4 ? ' …' : ''}`)
    lines.push('Turn any of them off under More → Tools → OEM Sources.')
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, lines.join('\n')).catch(e => console.warn('[sources] cliq failed:', e.message))
  }
  console.log(`[sources] discovery: proposed ${out.proposed}, added ${out.added.length}, rejected ${out.rejected.length}, skipped ${out.skipped.length}${dry ? ' (dry)' : ''}`)
  return out
}
