// 📎 Cited OEM documents travel with the report (Mark 2026-10-02: "whatever rule
// you cite for the reason why we're doing the calibration, I want that document
// attached to the report in a clean way").
//
// The scrubber names the library document it relied on inside each REQUIRED
// calibration's justification (the prompt asks it to). Here we match those
// names back to AdasPositionStatements rows, number them Attachment 1, 2 …,
// and after the report is drawn append each document's own pages behind a
// "Supporting OEM documents" index. Only documents actually cited on this car,
// each once. A document that can't be fetched is left off (and the numbering
// closes up), so the report never fails or points at a missing attachment.
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'

const TABLE = 'AdasPositionStatements'
const MAX_DOCS = 4          // a report stays a report, not a binder
const MAX_PAGES_PER_DOC = 8
const norm = s => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()

let _lib = { at: 0, rows: [] }
export async function oemLibrary(req) { return library(req) }
async function library(req) {
  if (Date.now() - _lib.at < 10 * 60 * 1000 && _lib.rows.length) return _lib.rows
  const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(
    `SELECT ROWID, doc_oem, doc_title, doc_published_date, doc_source_url, doc_hosted_url, doc_filename FROM ${TABLE} LIMIT 300`)
  // The same document filed twice (two file names, one title) attaches once.
  // ALLDATA pages are licensed to our subscription: cited by name on reports, never
  // attached or handed to shops/insurers (Mark 2026-10-02).
  const isAlldata = d => /alldata/i.test(`${d.doc_title || ''} ${d.doc_source_url || ''} ${d.doc_filename || ''} ${d.doc_oem || ''}`)
  const seen = new Set()
  _lib = { at: Date.now(), rows: (rows || []).map(r => r[TABLE] || r).filter(d => d.doc_title && !isAlldata(d)).filter(d => { const k = `${norm(d.doc_title)}|${d.doc_published_date || ''}`; if (seen.has(k)) return false; seen.add(k); return true }) }
  return _lib.rows
}

// Distinctive phrases of a title that a justification would quote:
// the whole title and the part after "Position Statement:" etc.
function keys(title) {
  const t = String(title || '')
  const out = [norm(t)]
  const after = t.split(/[:–—-]\s/).slice(1).join(' ')
  if (after) out.push(norm(after))
  return [...new Set(out)].filter(k => k.length >= 18)
}

/**
 * Which library documents the enabled calibrations cite. Mutates each cited
 * calibration with _attach: [n, …]. Returns [{ n, row, cals: [names] }].
 */
export async function citedDocs(req, cals) {
  const lib = await library(req).catch(() => [])
  if (!lib.length) return []
  const found = new Map()
  for (const c of cals || []) {
    if (!c || c.enabled === false) continue
    const text = norm(`${c.justification || ''} ${c.note || ''} ${c.trigger || ''}`)
    if (!text) continue
    for (const row of lib) {
      if (!keys(row.doc_title).some(k => text.includes(k))) continue
      const id = String(row.ROWID)
      if (!found.has(id)) { if (found.size >= MAX_DOCS) continue; found.set(id, { n: found.size + 1, row, cals: [] }) }
      const d = found.get(id)
      d.cals.push(c.calibration_name)
      c._attach = [...new Set([...(c._attach || []), d.n])]
    }
  }
  return [...found.values()]
}

// WorkDrive file id per library row, found once by name and remembered.
async function workdriveId(req, row, token) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const key = `psdoc_fid_${row.ROWID}`
  try {
    const r = await app.zcql().executeZCQLQuery(`SELECT config_value FROM AppConfig WHERE config_key = '${key}' LIMIT 1`)
    const v = r?.[0]?.AppConfig?.config_value; if (v) return String(v)
  } catch { /* look it up */ }
  const name = String(row.doc_source_url || '').replace(/^workdrive:/, '').split('/').pop()
  if (!name) return ''
  // Walk the path first (Command Center → 01_Ops → OEM docs → <make> → file);
  // WorkDrive's search doesn't index this team folder.
  let walked = ''
  try { walked = await walkPath(String(row.doc_source_url || '').replace(/^workdrive:/, ''), token) } catch (e) { console.warn('[oem-attach] walk:', e.message) }
  if (walked) { try { await app.datastore().table('AppConfig').insertRow({ config_key: key, config_value: walked }) } catch { /* fine */ } return walked }
  const s = await axios.get('https://www.zohoapis.com/workdrive/api/v1/files/search', { headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { search_str: name.replace(/\.pdf$/i, ''), search_scope: 'team', type: 'file' }, timeout: 15000 }).catch(() => null)
  const hit = (s?.data?.data || []).find(f => String(f.attributes?.name || '').toLowerCase() === name.toLowerCase())
  if (!hit?.id) return ''
  try { await app.datastore().table('AppConfig').insertRow({ config_key: key, config_value: String(hit.id) }) } catch { /* fine */ }
  return String(hit.id)
}

// "OEM docs/GM/file.pdf" → WorkDrive file id. The OEM docs folder sits in
// Absolute ADAS Command Center → 01_Ops; the Command Center id is found from the
// HR → Team folder (people.js) once and kept for the life of the instance.
const PEOPLE_FOLDER_ID = 'mniqhb081c583db4e4b54ae1a007f31f84c1b'
let _cc = ''
export async function walkPath(path, token) {
  const H = { Authorization: `Zoho-oauthtoken ${token}` }
  const parentOf = async id => (await axios.get(`https://workdrive.zoho.com/api/v1/files/${id}`, { headers: H, timeout: 15000 })).data?.data?.attributes?.parent_id || ''
  if (!_cc) _cc = await parentOf(await parentOf(PEOPLE_FOLDER_ID))
  if (!_cc) return ''
  const { listChildren } = await import('./workdrive.js')
  const norm2 = v => String(v || '').trim().toLowerCase()
  let cur = _cc
  for (const part of ['01_Ops', ...path.split('/').filter(Boolean)]) {
    const kids = await listChildren(cur, token, { max: 1000 })
    const hit = kids.find(k => norm2(k.name) === norm2(part)) || kids.find(k => norm2(k.name).replace(/\.pdf$/, '') === norm2(part).replace(/\.pdf$/, ''))
    if (!hit) return ''
    cur = hit.id
  }
  return cur
}

async function docBytes(req, row) {
  const src = String(row.doc_hosted_url || row.doc_source_url || '')
  if (/^https?:\/\//i.test(src)) {
    const r = await axios.get(src, { responseType: 'arraybuffer', timeout: 20000, maxContentLength: 25 * 1024 * 1024, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AbsoluteADAS-Reports/1.0)' } })
    return Buffer.from(r.data)
  }
  if (src.startsWith('workdrive:')) {
    const { getAccessToken } = await import('./zoho.js'); const token = await getAccessToken()
    const id = await workdriveId(req, row, token)
    if (!id) throw new Error('not found in WorkDrive')
    const { downloadFile } = await import('./workdrive.js')
    return (await downloadFile(id, token)).buffer
  }
  throw new Error('no file on record')
}

/**
 * Fetch each cited document; keep only the ones that load as PDFs and renumber
 * them 1..n (cals' _attach follows), so the report never points at a missing one.
 */
export async function fetchCited(req, docs, cals) {
  if (!docs?.length) return []
  const { PDFDocument } = await import('pdf-lib')
  const got = await Promise.all(docs.map(d => docBytes(req, d.row).then(async b => { await PDFDocument.load(b, { ignoreEncryption: true }); return { ...d, bytes: b } }).catch(e => { console.warn(`[oem-attach] "${d.row.doc_title}" not attached: ${e.message}`); return null })))
  const ok = got.filter(Boolean)
  const renum = new Map(ok.map((d, i) => [d.n, i + 1]))
  for (const c of cals || []) if (Array.isArray(c._attach)) { c._attach = c._attach.map(n => renum.get(n)).filter(Boolean); if (!c._attach.length) delete c._attach }
  const final = ok.map((d, i) => ({ ...d, n: i + 1 }))
  // 📝 "Why is this required?" note (Mark 2026-10-02, Kinetic's Q&A popup): for each
  // calibration, the attachment(s) it cites and the pages in them that talk about
  // that sensor — "see pages 1, 6".
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
  for (const d of final) {
    const pages = []
    try { await pdfParse(d.bytes, { max: MAX_PAGES_PER_DOC, pagerender: pg => pg.getTextContent().then(t => { const txt = t.items.map(i => i.str).join(' '); pages.push(txt); return txt }) }) } catch { /* no page text (scan) */ }
    d.pageTexts = pages
  }
  const KW = n => /inspection|pcsi/i.test(n) ? /seat ?belt|srs|steering column|inspect/i : /scan/i.test(n) ? /pre-?(repair )?scan|post-?(repair )?scan|scanning/i : /camera|windshield|multipurpose/i.test(n) ? /camera|windshield|forward[- ]?view|lane/i : /side radar|corner|cross/i.test(n) ? /corner|side radar|cross.?traffic/i : /blind|rear.*radar|bsm|bsi|side obstacle/i.test(n) ? /blind|bsm|bsi|side (blind|obstacle)|rear radar/i : /radar|distance|millimeter/i.test(n) ? /radar|distance sensor|millimeter|cruise/i : /steering|sas|vsa/i.test(n) ? /steering angle|vsa|neutral position|alignment/i : /seat|occupant|ods|ocs/i.test(n) ? /seat|occupant|weight sensor/i : /park|sonar|ultrasonic/i.test(n) ? /park|sonar|ultrasonic/i : /around|surround|multi.?view/i.test(n) ? /surround|around view|multi.?view|360/i : /headl/i.test(n) ? /headl|aim/i : /program|module/i.test(n) ? /program|module|sps/i : null
  for (const c of cals || []) {
    if (!Array.isArray(c._attach)) continue
    const re = KW(String(c.calibration_name || ''))
    c._refs = c._attach.map(n => { const d = final.find(x => x.n === n); if (!d) return null
      const pg = re ? (d.pageTexts || []).map((t, i) => (re.test(t) ? i + 1 : 0)).filter(Boolean).slice(0, 4) : []
      return { n, title: `${d.row.doc_oem ? d.row.doc_oem + ': ' : ''}${d.row.doc_title}`, pages: pg } }).filter(Boolean)
  }
  return final
}

/** Report PDF + the cited documents' pages appended. Never throws: worst case the report alone. */
export async function appendCitedDocs(req, reportBuf, docs) {
  if (!docs?.length) return reportBuf
  try {
    const { PDFDocument } = await import('pdf-lib')
    const out = await PDFDocument.load(reportBuf)
    const got = await Promise.all(docs.map(d => (d.bytes ? Promise.resolve(d.bytes) : docBytes(req, d.row)).then(b => ({ d, b })).catch(e => ({ d, err: e.message }))))
    for (const { d, b, err } of got) {
      if (err || !b) { console.warn(`[oem-attach] Attachment ${d.n} "${d.row.doc_title}" not attached: ${err}`); continue }
      try {
        const src = await PDFDocument.load(b, { ignoreEncryption: true })
        const n = Math.min(src.getPageCount(), MAX_PAGES_PER_DOC)
        const pages = await out.copyPages(src, [...Array(n).keys()])
        pages.forEach(p => out.addPage(p))
        d.attached = true; d.pages = n
      } catch (e) { console.warn(`[oem-attach] could not read "${d.row.doc_title}": ${e.message}`) }
    }
    return Buffer.from(await out.save())
  } catch (e) { console.warn('[oem-attach] merge failed, report sent alone:', e.message); return reportBuf }
}
