// Absolute ADAS TSB library (Mark 2026-09-05): in-house tips & tricks —
// calibration, keys, cloning — quick to create (voice-typed, AI-cleaned)
// and searchable. Phase 1: store + CRUD. Phase 2 adds the ask-Claude box.
//
// Storage: Datastore table AdasTsb (created via Catalyst MCP 2026-09-07),
// one row per TSB keyed by tsb_id. Columns carry a tsb_ prefix because
// Datastore rejects reserved words (title/number/…) as column names.
// The small config bit (photo folder id) stays on the AppConfig
// index-row pattern.
import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import multer from 'multer'
// uploadFileToFolder resolves to { fileId } (sometimes a bare id) — always keep the string.
const wdId = r => String((r && typeof r === 'object') ? (r.fileId || r.id || r.resource_id || '') : (r || ''))
import axios from 'axios'

const router = express.Router()

const TABLE = 'AdasTsb'
const ZCQL_PAGE = 300
export const TSB_CATEGORIES = ['calibration', 'keys', 'cloning', 'general']

const q = s => String(s ?? '').replace(/'/g, "''")
// Datastore stores 4-byte UTF-8 (emoji) as '?', so strip it on write.
const clean = (s, max) => String(s ?? '').replace(/[\u{10000}-\u{10FFFF}]/gu, '').slice(0, max)

const toRow = t => ({
  tsb_id: String(t.id), tsb_number: clean(t.number, 30), tsb_title: clean(t.title, 120), tsb_body: clean(t.body, 10000),
  tsb_category: TSB_CATEGORIES.includes(t.category) ? t.category : 'general',
  make: clean(t.make, 100), model: clean(t.model, 100), year_from: clean(t.year_from, 10), year_to: clean(t.year_to, 10),
  tools: clean(t.tools, 255), author: clean(t.author, 100),
  photos_json: JSON.stringify(Array.isArray(t.photos) ? t.photos : []).slice(0, 10000),
  created_at: clean(t.created_at, 40), updated_at: clean(t.updated_at, 40), updated_by: clean(t.updated_by, 100),
})
const fromRow = r => {
  let photos = []
  try { photos = JSON.parse(r.photos_json || '[]') } catch { photos = [] }
  const t = {
    id: String(r.tsb_id || ''), title: r.tsb_title || '', body: r.tsb_body || '', category: r.tsb_category || 'general',
    make: r.make || '', model: r.model || '', year_from: r.year_from || '', year_to: r.year_to || '',
    tools: r.tools || '', author: r.author || '', created_at: r.created_at || '',
  }
  if (r.tsb_number) t.number = r.tsb_number
  if (Array.isArray(photos) && photos.length) t.photos = photos
  if (r.updated_at) { t.updated_at = r.updated_at; t.updated_by = r.updated_by || '' }
  return t
}

// ZCQL results come wrapped { AdasTsb: {...} }; ROWIDs stay strings.
async function zcqlAll(app, sqlNoLimit) {
  const out = []
  const seen = new Set(); for (let off = 0; ; off += ZCQL_PAGE) {
    const rows = await app.zcql().executeZCQLQuery(`${sqlNoLimit} LIMIT ${off}, ${ZCQL_PAGE}`)
    const batch = (rows || []).map(r => r?.[TABLE] || r).filter(Boolean)
    for (const x of batch) { const id = String(x?.ROWID || x?.id || ''); if (id && seen.has(id)) continue; if (id) seen.add(id); out.push(x) }
    if (batch.length < ZCQL_PAGE) break
  }
  return out
}
async function findRowId(app, id) {
  const rows = await zcqlAll(app, `SELECT ROWID FROM ${TABLE} WHERE tsb_id = '${q(id)}'`)
  return rows[0]?.ROWID ? String(rows[0].ROWID) : null
}

async function cfgRow(app, key) {
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${q(key)}' LIMIT 1`
  ).catch(() => [])
  return rows?.[0]?.AppConfig || rows?.[0] || null
}
async function cfgSet(app, key, value) {
  const table = app.datastore().table('AppConfig')
  const str = JSON.stringify(value)
  const r = await cfgRow(app, key)
  if (r?.ROWID) await table.updateRow({ ROWID: String(r.ROWID), config_value: str })
  else await table.insertRow({ config_key: key, config_value: str })
}

export async function readAllTsbs(req) {
  const app = catalyst.initialize(req)
  const rows = await zcqlAll(app, `SELECT * FROM ${TABLE} ORDER BY ROWID`)
  return rows.map(fromRow)
}
async function writeTsb(req, tsb) {
  const app = catalyst.initialize(req)
  const table = app.datastore().table(TABLE)
  const row = toRow(tsb)
  const rid = await findRowId(app, tsb.id)
  if (rid) await table.updateRow({ ROWID: rid, ...row })
  else await table.insertRow(row)
  const check = await findRowId(app, tsb.id)
  if (!check) throw new Error('TSB write did not persist — try again')
}
async function removeTsb(req, id) {
  const app = catalyst.initialize(req)
  const rid = await findRowId(app, id)
  if (rid) await app.datastore().table(TABLE).deleteRow(rid)
}

// Voice-typed tips arrive messy. Claude tidies grammar and writes a
// title, but never invents content — non-fatal, raw text wins on error.
async function cleanupTip(body) {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 15000, maxRetries: 1 })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content:
        `Clean up this voice-typed shop tip from an ADAS calibration technician. Fix grammar and punctuation, keep every technical detail and the writer's meaning EXACTLY — do not add or invent anything. Then write a short title (under 60 chars).\n\n` +
        `Return ONLY raw JSON: {"title": "...", "body": "..."}\n\nTip:\n${String(body).slice(0, 4000)}` }],
    })
    const raw = (msg.content || []).map(b => b.text || '').join('').trim()
      .replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '')
    const parsed = JSON.parse(raw)
    if (parsed?.body) return { title: String(parsed.title || '').slice(0, 80), body: String(parsed.body) }
  } catch (e) { console.warn('[tsb] cleanup failed (using raw):', e.message) }
  return null
}

// 📋 OEM position statements — the same library the daily watcher fills,
// opened up to technicians here (Mark 2026-09-24: "make this database
// available to the technicians under the TSB page"). Read-only for everyone.
let _canonOem = null
async function readOemDocs(req) {
  try {
    if (!_canonOem) { try { ({ canonicalOem: _canonOem } = await import('../services/positionStatements.js')) } catch { _canonOem = x => x } }
    const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(
      `SELECT ROWID, doc_oem, doc_type, doc_title, doc_summary, doc_notes, doc_published_date, doc_source_url, doc_hosted_url, doc_filename FROM AdasPositionStatements LIMIT ${ZCQL_PAGE}`)
    return (rows || []).map(r => { const x = r.AdasPositionStatements || r; return {
      id: String(x.ROWID), oem: _canonOem(x.doc_oem || ''), oem_full: x.doc_oem || '', type: x.doc_type || '', title: x.doc_title || '',
      summary: x.doc_summary || '', notes: x.doc_notes || '', published_date: x.doc_published_date || '',
      url: x.doc_hosted_url || x.doc_source_url || '', source_url: x.doc_source_url || '', filename: x.doc_filename || '',
    } })
  } catch (e) { console.warn('[tsb] OEM docs read failed:', e.message); return [] }
}

// 🎥 Training videos (Mark 2026-09-25: "a video training section on the TSB
// page"). These are the SAME modules new hires get in onboarding — filling in
// a module's video_url once puts it in both places, so there is one library,
// not two. Any signed-in user, technicians included.
const TRAIN_KEY = 'training_videos'
async function readTraining(req) {
  try {
    const r = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${TRAIN_KEY}' LIMIT 1`)
    const row = r?.[0]?.AppConfig
    return { row: row ? String(row.ROWID) : null, list: row ? (JSON.parse(row.config_value || '[]') || []) : [] }
  } catch { return { row: null, list: [] } }
}
async function writeTraining(req, row, list) {
  const t = catalyst.initialize(req, { type: 'advancedio' }).datastore().table('AppConfig')
  const v = JSON.stringify(list).slice(0, 9800)
  if (row) await t.updateRow({ ROWID: row, config_key: TRAIN_KEY, config_value: v })
  else await t.insertRow({ config_key: TRAIN_KEY, config_value: v })
}

router.get('/training', async (req, res) => {
  try {
    const { list } = await readTraining(req)
    let course = []
    try {
      const { readCourse } = await import('./people.js')
      course = ((await readCourse(req))?.modules || [])
        .filter(m => String(m.video_url || '').trim())
        .map(m => ({ id: `mod_${m.id}`, title: m.title || '', url: String(m.video_url).trim(), oem: 'Onboarding', minutes: Number(m.minutes) || 0, notes: String(m.reading || '').replace(/\s+/g, ' ').slice(0, 300), from_course: true }))
    } catch { course = [] }
    const videos = [...list, ...course]
    const tags = [...new Set(videos.map(v => v.oem).filter(Boolean))].sort()
    res.json({ ok: true, videos, tags })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/tsb/training — add one. Staff only; techs watch, they do not post.
router.post('/training', express.json({ limit: '16kb' }), async (req, res) => {
  try {
    if (String(req.user?.role || '') === 'technician') return res.status(403).json({ error: 'Staff only' })
    const b = req.body || {}
    const url = String(b.url || '').trim()
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Paste the video link (it has to start with http).' })
    const { row, list } = await readTraining(req)
    const v = {
      id: `v_${Date.now().toString(36)}`,
      title: clean(b.title, 140) || 'Untitled video',
      url, oem: clean(b.oem, 40) || 'General',
      minutes: Number(b.minutes) || 0,
      notes: clean(b.notes, 400),
      by: req.user?.name || 'staff', at: new Date().toISOString(),
    }
    list.unshift(v)
    await writeTraining(req, row, list.slice(0, 80))
    res.json({ ok: true, video: v })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/training/:id', async (req, res) => {
  try {
    if (String(req.user?.role || '') === 'technician') return res.status(403).json({ error: 'Staff only' })
    const { row, list } = await readTraining(req)
    const next = list.filter(v => v.id !== req.params.id)
    await writeTraining(req, row, next)
    res.json({ ok: true, removed: list.length - next.length })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/tsb/oem-docs — the OEM library for the TSB page's search.
router.get('/oem-docs', async (req, res) => {
  try {
    const docs = await readOemDocs(req)
    docs.sort((a, b) => String(b.published_date || '').localeCompare(String(a.published_date || '')))
    res.json({ docs, oems: [...new Set(docs.map(d => d.oem).filter(Boolean))].sort() })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/tsb — everything; the client filters instantly.
router.get('/', async (req, res) => {
  try {
    const tsbs = await readAllTsbs(req)
    tsbs.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    res.json({ tsbs })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/tsb — create. { body, title?, category, year_from?, year_to?, make?, model?, tools?, cleanup? }
router.post('/', async (req, res) => {
  try {
    const b = req.body || {}
    const rawBody = String(b.body || '').trim()
    if (!rawBody) return res.status(400).json({ error: 'Tip text is required.' })
    const category = TSB_CATEGORIES.includes(b.category) ? b.category : 'general'
    let title = String(b.title || '').trim()
    let bodyText = rawBody
    if (b.cleanup !== false) {
      const cleaned = await cleanupTip(rawBody)
      if (cleaned) { bodyText = cleaned.body; if (!title) title = cleaned.title }
    }
    if (!title) title = bodyText.slice(0, 60)
    const tsb = {
      id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
      title, body: bodyText, category,
      make:  String(b.make  || '').trim(),
      model: String(b.model || '').trim(),
      year_from: String(b.year_from || '').trim(),
      year_to:   String(b.year_to   || '').trim(),
      tools: String(b.tools || '').trim(),
      author: req.user?.techName || req.user?.email || 'Team',
      created_at: new Date().toISOString(),
    }
    await writeTsb(req, tsb)
    let posted = null
    try { posted = await postTsbToChannel(req, tsb) } catch (e) { posted = { ok: false, error: e.message } }
    res.json({ ok: true, tsb, posted })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /api/tsb/:id — edit any field (whole team can improve tips).
router.put('/:id', async (req, res) => {
  try {
    const tsbs = await readAllTsbs(req)
    const existing = tsbs.find(t => String(t.id) === String(req.params.id))
    if (!existing) return res.status(404).json({ error: 'TSB not found' })
    const b = req.body || {}
    const updated = {
      ...existing,
      title: b.title !== undefined ? String(b.title).slice(0, 80) : existing.title,
      body:  b.body  !== undefined ? String(b.body) : existing.body,
      category: TSB_CATEGORIES.includes(b.category) ? b.category : existing.category,
      make:  b.make  !== undefined ? String(b.make).trim()  : existing.make,
      model: b.model !== undefined ? String(b.model).trim() : existing.model,
      year_from: b.year_from !== undefined ? String(b.year_from).trim() : existing.year_from,
      year_to:   b.year_to   !== undefined ? String(b.year_to).trim()   : existing.year_to,
      tools: b.tools !== undefined ? String(b.tools).trim() : existing.tools,
      updated_at: new Date().toISOString(),
      updated_by: req.user?.techName || req.user?.email || '',
    }
    await writeTsb(req, updated)
    res.json({ ok: true, tsb: updated })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /api/tsb/:id — owner only.
router.delete('/:id', async (req, res) => {
  try {
    const email = String(req.user?.email || '').toLowerCase()
    const isOwner = email.startsWith('mark@') || req.user?.role === 'owner'
    if (!isOwner) return res.status(403).json({ error: 'Only Mark can delete TSBs.' })
    await removeTsb(req, String(req.params.id))
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})


// ── Official bulletin PDF (Mark 2026-09-05: "look very official") ───────
// Numbered AA-TSB-<year>-<seq>; the number is assigned on first export
// and stored on the TSB so it never changes.
// Build the official bulletin PDF. Assigns the AA-TSB number on first use (stored, never changes).
export async function buildTsbPdf(req, tsb, tsbs = null) {
  tsbs = tsbs || await readAllTsbs(req)
  if (!tsb.number) {
      const year = new Date(tsb.created_at || Date.now()).getFullYear()
      const seqs = tsbs.map(t => {
        const m = /AA-TSB-\d{4}-(\d+)/.exec(t.number || '')
        return m ? parseInt(m[1], 10) : 0
      })
      tsb.number = `AA-TSB-${year}-${String(Math.max(0, ...seqs) + 1).padStart(3, '0')}`
      await writeTsb(req, tsb)
    }

    const PDFDocument = (await import('pdfkit')).default
    const ORANGE = '#CD4419'
    const DARK = '#1a1a1a'
    const GRAY = '#6b7280'
    const M = 54
    const doc = new PDFDocument({ margin: 0, size: 'LETTER' })
    const chunks = []
    doc.on('data', c => chunks.push(c))
    const donePdf = new Promise(r => doc.on('end', () => r(Buffer.concat(chunks))))
    const W = doc.page.width

    // Letterhead band
    doc.rect(0, 0, W, 86).fill(DARK)
    doc.rect(0, 86, W, 4).fill(ORANGE)
    doc.font('Helvetica-Bold').fontSize(19).fillColor('white').text('ABSOLUTE ADAS', M, 24)
    doc.font('Helvetica').fontSize(8.5).fillColor('#d1d5db')
      .text('Advanced Driver Assistance Systems · Calibration · Diagnostics', M, 48)
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ORANGE)
      .text('TECHNICAL SERVICE BULLETIN', M, 62, { characterSpacing: 1.5 })
    doc.font('Helvetica-Bold').fontSize(12).fillColor('white')
      .text(tsb.number, W - M - 180, 30, { width: 180, align: 'right' })
    doc.font('Helvetica').fontSize(8.5).fillColor('#d1d5db')
      .text(new Date(tsb.created_at || Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        W - M - 180, 48, { width: 180, align: 'right' })

    // Reference block
    let y = 112
    const yrs = tsb.year_from && tsb.year_to ? `${tsb.year_from}–${tsb.year_to}` : (tsb.year_from || tsb.year_to || '')
    const rows = [
      ['SUBJECT', tsb.title || ''],
      ['CATEGORY', String(tsb.category || 'general').toUpperCase()],
      ['APPLICABLE VEHICLES', [yrs, tsb.make, tsb.model].filter(Boolean).join(' ') || 'All makes and models'],
      tsb.tools ? ['EQUIPMENT', tsb.tools] : null,
      ['ISSUED BY', `Absolute ADAS Technical Team${tsb.author ? ` · ${tsb.author}` : ''}`],
    ].filter(Boolean)
    for (const [label, value] of rows) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GRAY).text(label, M, y + 2, { width: 130, characterSpacing: 0.5 })
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text(value, M + 140, y, { width: W - M * 2 - 140 })
      y = Math.max(y + 16, doc.y + 6)
    }
    doc.moveTo(M, y + 4).lineTo(W - M, y + 4).lineWidth(1).strokeColor('#e5e7eb').stroke()
    y += 18

    // Body
    doc.font('Helvetica-Bold').fontSize(8).fillColor(ORANGE).text('SERVICE INFORMATION', M, y, { characterSpacing: 1 })
    y += 16
    doc.font('Helvetica').fontSize(10.5).fillColor('#111827')
      .text(String(tsb.body || ''), M, y, { width: W - M * 2, lineGap: 3.5 })

    // Photos (fetched from WorkDrive, embedded as real images)
    if (Array.isArray(tsb.photos) && tsb.photos.length) {
      let py = doc.y + 18
      doc.font('Helvetica-Bold').fontSize(8).fillColor(ORANGE).text('PHOTOS', M, py, { characterSpacing: 1 })
      py += 14
      const imgW = (W - M * 2 - 12) / 2
      let col = 0
      for (const ph of tsb.photos.slice(0, 6)) {
        try {
          const { buf } = await fetchWdFile(ph.file_id)
          if (py + 180 > doc.page.height - 80) { doc.addPage(); py = 54; col = 0 }
          const x = M + col * (imgW + 12)
          doc.image(buf, x, py, { fit: [imgW, 170] })
          if (col === 1) py += 182
          col = col === 0 ? 1 : 0
        } catch (e) { console.warn('[tsb pdf] photo skip:', e.message) }
      }
      if (col === 1) py += 182
      doc.y = py
    }

    // Footer
    const fy = doc.page.height - 64
    doc.moveTo(M, fy).lineTo(W - M, fy).lineWidth(0.5).strokeColor('#e5e7eb').stroke()
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(DARK).text('ABSOLUTE ADAS', M, fy + 10)
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
      .text('Lake Stevens, WA · absoluteadas.com', M, fy + 21)
    doc.font('Helvetica').fontSize(7).fillColor('#9ca3af')
      .text(`${tsb.number} · Internal technical bulletin. Procedures reflect Absolute ADAS field experience; always verify against current OEM service information.`,
        M, fy + 34, { width: W - M * 2 })
    doc.end()

    return donePdf
}

router.post('/:id/pdf', async (req, res) => {
  try {
    const tsbs = await readAllTsbs(req)
    const tsb = tsbs.find(t => String(t.id) === String(req.params.id))
    if (!tsb) return res.status(404).json({ error: 'TSB not found' })
    const buf = await buildTsbPdf(req, tsb, tsbs)
    res.type('application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${tsb.number}.pdf"`)
    res.send(buf)
  } catch (e) {
    console.error('[tsb pdf]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// 📣 Post the bulletin PDF to the techs' Cliq channel (Mark 2026-10-12: "when [someone] creates a
// TSB tip I want it posted in PDF form to the technicians channel"). Uploads the PDF as a file;
// if Cliq refuses the upload, posts a message with a link to the PDF instead.
const TSB_CHANNEL = 'technicians'
const TSB_CHANNEL_ID = 'O6015142000000681005'
const PUBLIC_BASE = process.env.API_PUBLIC_BASE || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'
export async function postTsbToChannel(req, tsb, { reason = 'new', channelId = '' } = {}) {
  const { TECHNICIANS_CHANNEL, getCliqAccessToken, postToCliqChannel, postToCliqChannelById } = await import('../services/cliq.js')
  const tsbs = await readAllTsbs(req)
  const cur = tsbs.find(t => String(t.id) === String(tsb.id)) || tsb
  const buf = await buildTsbPdf(req, cur, tsbs)
  const vehicle = [cur.year_from && cur.year_to && cur.year_from !== cur.year_to ? `${cur.year_from}–${cur.year_to}` : (cur.year_from || cur.year_to || ''), cur.make, cur.model].filter(Boolean).join(' ')
  const head = `📖 *${reason === 'update' ? 'Updated TSB' : 'New TSB'} · ${cur.number}*${cur.author ? ` from ${cur.author}` : ''}\n*${cur.title}*${vehicle ? ` · ${vehicle}` : ''} · ${String(cur.category || 'general')}${(cur.photos || []).length ? ` · 📷 ${cur.photos.length}` : ''}`
  const token = await getCliqAccessToken()
  const FormData = (await import('form-data')).default
  const filename = `${cur.number} ${String(cur.title || 'bulletin').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60)}.pdf`
  const targets = channelId
    ? [`channels/${channelId}`]
    : [`channels/${TSB_CHANNEL_ID}`, `channelsbyname/${TECHNICIANS_CHANNEL || TSB_CHANNEL}`]
  let lastErr = null
  for (const target of targets) {
    try {
      const fd = new FormData()
      fd.append('file', buf, { filename, contentType: 'application/pdf' })
      fd.append('comments', head.replace(/\*/g, ''))
      await axios.post(`https://cliq.zoho.com/company/883116359/api/v2/${target}/files`, fd, {
        headers: { ...fd.getHeaders(), Authorization: `Zoho-oauthtoken ${token}` },
        timeout: 18000, maxBodyLength: Infinity,
      })
      return { ok: true, via: 'file', number: cur.number, target }
    } catch (e) {
      lastErr = e
      console.warn('[tsb post] file upload failed:', target, e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 200))
    }
  }
  if (!cur.share_key) { cur.share_key = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); await writeTsb(req, cur) }
  const msg = `${head}\n[📄 Open ${cur.number} (PDF)](${PUBLIC_BASE}/api/public/tsb/${encodeURIComponent(cur.number)}.pdf?k=${cur.share_key})`
  if (channelId) await postToCliqChannelById(channelId, msg)
  else await postToCliqChannel(TECHNICIANS_CHANNEL || TSB_CHANNEL, msg)
  return { ok: true, via: 'link', number: cur.number, upload_error: lastErr?.response?.status || lastErr?.message }
}

// POST /api/tsb/:id/post — re-post (e.g. after adding photos).
router.post('/:id/post', async (req, res) => {
  try {
    const tsb = (await readAllTsbs(req)).find(t => String(t.id) === String(req.params.id))
    if (!tsb) return res.status(404).json({ error: 'TSB not found' })
    res.json(await postTsbToChannel(req, tsb, { reason: 'update' }))
  } catch (e) { res.status(500).json({ error: e.message }) }
})


export const tsbPublicRouter = express.Router()
tsbPublicRouter.get('/photo/:fileId', async (req, res) => {
  try {
    const { verifyToken } = await import('./auth.js')
    if (!req.query.t || !verifyToken(String(req.query.t))) return res.status(401).json({ error: 'unauthorized' })
    const { buf, mime } = await fetchWdFile(String(req.params.fileId))
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.type(mime).send(buf)
  } catch (e) { console.log('[tsb photo]', e.response?.status, e.message); res.status(404).json({ error: 'Photo not found' }) }
})

// GET /api/public/tsb/:id.pdf?k=<share key> — the link posted to Cliq when a file upload is refused.
tsbPublicRouter.get('/:id.pdf', async (req, res) => {
  try {
    const tsbs = await readAllTsbs(req)
    const tsb = tsbs.find(t => String(t.id) === String(req.params.id) || String(t.number || '') === String(req.params.id))
    if (!tsb || !tsb.share_key || String(req.query.k || '') !== tsb.share_key) return res.status(404).json({ error: 'not found' })
    const buf = await buildTsbPdf(req, tsb, tsbs)
    res.type('application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${tsb.number}.pdf"`); res.send(buf)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default router
