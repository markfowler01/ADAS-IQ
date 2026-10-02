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
async function library(req) {
  if (Date.now() - _lib.at < 10 * 60 * 1000 && _lib.rows.length) return _lib.rows
  const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(
    `SELECT ROWID, doc_oem, doc_title, doc_published_date, doc_source_url, doc_hosted_url, doc_filename FROM ${TABLE} LIMIT 300`)
  // The same document filed twice (two file names, one title) attaches once.
  const seen = new Set()
  _lib = { at: Date.now(), rows: (rows || []).map(r => r[TABLE] || r).filter(d => d.doc_title).filter(d => { const k = `${norm(d.doc_title)}|${d.doc_published_date || ''}`; if (seen.has(k)) return false; seen.add(k); return true }) }
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
  const s = await axios.get('https://www.zohoapis.com/workdrive/api/v1/files/search', { headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { search_str: name.replace(/\.pdf$/i, ''), search_scope: 'team', type: 'file' }, timeout: 15000 }).catch(() => null)
  const hit = (s?.data?.data || []).find(f => String(f.attributes?.name || '').toLowerCase() === name.toLowerCase())
  if (!hit?.id) return ''
  try { await app.datastore().table('AppConfig').insertRow({ config_key: key, config_value: String(hit.id) }) } catch { /* fine */ }
  return String(hit.id)
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
  return ok.map((d, i) => ({ ...d, n: i + 1 }))
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
