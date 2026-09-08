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
  for (let off = 0; ; off += ZCQL_PAGE) {
    const rows = await app.zcql().executeZCQLQuery(`${sqlNoLimit} LIMIT ${off}, ${ZCQL_PAGE}`)
    const batch = (rows || []).map(r => r?.[TABLE] || r).filter(Boolean)
    out.push(...batch)
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
    res.json({ ok: true, tsb })
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
router.post('/:id/pdf', async (req, res) => {
  try {
    const tsbs = await readAllTsbs(req)
    const tsb = tsbs.find(t => String(t.id) === String(req.params.id))
    if (!tsb) return res.status(404).json({ error: 'TSB not found' })

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

    const buf = await donePdf
    res.type('application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${tsb.number}.pdf"`)
    res.send(buf)
  } catch (e) {
    console.error('[tsb pdf]', e.message)
    res.status(500).json({ error: e.message })
  }
})


// ── Ask the TSB brain (Mark 2026-09-07, Phase 2) ────────────────────────
// Pre-filter TSBs by the question's words (keeps the prompt small), let
// Claude answer in plain language, and cite the TSBs it leaned on so the
// client can render those cards under the answer.
router.post('/ask', async (req, res) => {
  try {
    const question = String(req.body?.question || '').trim()
    if (!question) return res.status(400).json({ error: 'Ask a question.' })
    const all = await readAllTsbs(req)
    if (!all.length) return res.json({ answer: 'No TSBs in the library yet — write the first one.', cited: [] })

    // Rank by how many question words hit each TSB; always keep a floor
    // so a loosely-worded question still gets the newest tips as context.
    const words = question.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    const scored = all.map(t => {
      const hay = [t.title, t.body, t.make, t.model, t.year_from, t.year_to, t.tools, t.category].join(' ').toLowerCase()
      return { t, score: words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) }
    }).sort((a, b) => b.score - a.score || String(b.t.created_at || '').localeCompare(String(a.t.created_at || '')))
    const shortlist = (scored.some(x => x.score > 0) ? scored.filter(x => x.score > 0) : scored).slice(0, 12).map(x => x.t)

    const context = shortlist.map((t, i) =>
      `[${i + 1}] ${t.number || `TSB-${t.id}`} — ${t.title}\n` +
      `    Category: ${t.category} · Vehicles: ${[t.year_from && t.year_to ? `${t.year_from}-${t.year_to}` : (t.year_from || t.year_to || ''), t.make, t.model].filter(Boolean).join(' ') || 'all'}` +
      `${t.tools ? ` · Tools: ${t.tools}` : ''}\n    ${String(t.body).replace(/\s+/g, ' ').slice(0, 500)}`
    ).join('\n\n')

    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25000, maxRetries: 1 })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      messages: [{ role: 'user', content:
        `You are the Absolute ADAS shop knowledge assistant. Answer the technician's question using ONLY the TSBs below. ` +
        `Be direct and practical, like a senior tech giving a quick answer at the bay. If a TSB applies, name it by its number. ` +
        `If none of the TSBs actually answer the question, say so plainly and suggest they write one.\n\n` +
        `After your answer, add a line exactly like: CITED: [1, 3] listing the bracket numbers you used (or CITED: [] if none).\n\n` +
        `QUESTION: ${question}\n\nTSBs:\n${context}` }],
    })
    let answer = (msg.content || []).map(b => b.text || '').join('').trim()
    let cited = []
    const m = answer.match(/CITED:\s*\[([^\]]*)\]/i)
    if (m) {
      cited = m[1].split(',').map(x => parseInt(x.trim(), 10)).filter(n => n >= 1 && n <= shortlist.length)
      answer = answer.replace(/CITED:\s*\[[^\]]*\]/i, '').trim()
    }
    const citedTsbs = [...new Set(cited)].map(n => shortlist[n - 1]).filter(Boolean)
    res.json({ answer, cited: citedTsbs })
  } catch (e) {
    console.error('[tsb ask]', e.message)
    res.status(500).json({ error: e.message || 'Ask failed.' })
  }
})

// ── Photos (Mark 2026-09-07: "pics in the list and on the PDF") ─────────
// Stored in a dedicated WorkDrive folder; bytes are streamed back
// through /api/tsb/photo/:fileId so <img> tags and the PDF generator
// can both render them (WorkDrive share links don't hotlink).
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) cb(new Error('Only image files are accepted'))
    else cb(null, true)
  },
})

async function ensureTsbFolder(req, wdToken) {
  const app = catalyst.initialize(req)
  const r = await cfgRow(app, 'tsb_photos_folder_id')
  const saved = r?.config_value ? String(r.config_value).replace(/"/g, '') : ''
  if (saved) return saved
  const { createJobFolder } = await import('../services/workdrive.js')
  const f = await createJobFolder('Absolute ADAS TSB Photos', wdToken)
  const id = f?.folderId
  if (id) await cfgSet(app, 'tsb_photos_folder_id', id)
  return id
}

router.post('/:id/photo', (req, res) => {
  photoUpload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'No image provided' })
    try {
      const tsbs = await readAllTsbs(req)
      const tsb = tsbs.find(t => String(t.id) === String(req.params.id))
      if (!tsb) return res.status(404).json({ error: 'TSB not found' })
      const { getAccessToken } = await import('../services/zoho.js')
      const wdToken = await getAccessToken()
      const folderId = await ensureTsbFolder(req, wdToken)
      if (!folderId) return res.status(500).json({ error: 'Could not create the TSB photos folder in WorkDrive.' })
      const ext = (req.file.mimetype.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      const filename = `TSB-${tsb.number || tsb.id}-${Date.now()}.${ext}`
      const { uploadFileToFolder } = await import('../services/workdrive.js')
      const fileId = wdId(await uploadFileToFolder(folderId, filename, req.file.buffer, wdToken, req.file.mimetype))
      tsb.photos = Array.isArray(tsb.photos) ? tsb.photos : []
      tsb.photos.push({ file_id: fileId, name: filename, mime: req.file.mimetype })
      await writeTsb(req, tsb)
      res.json({ ok: true, photo: { file_id: fileId, name: filename } })
    } catch (e) {
      console.error('[tsb photo]', e.message)
      res.status(500).json({ error: e.message })
    }
  })
})

router.delete('/:id/photo/:fileId', async (req, res) => {
  try {
    const tsbs = await readAllTsbs(req)
    const tsb = tsbs.find(t => String(t.id) === String(req.params.id))
    if (!tsb) return res.status(404).json({ error: 'TSB not found' })
    tsb.photos = (tsb.photos || []).filter(p => String(p.file_id) !== String(req.params.fileId))
    await writeTsb(req, tsb)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

async function fetchWdFile(fileId) {
  const { getAccessToken } = await import('../services/zoho.js')
  const wdToken = await getAccessToken()
  const r = await axios.get(`https://workdrive.zoho.com/api/v1/download/${fileId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${wdToken}` },
    responseType: 'arraybuffer', timeout: 25000, maxContentLength: 30 * 1024 * 1024,
  })
  return { buf: Buffer.from(r.data), mime: r.headers['content-type'] || 'image/jpeg' }
}

// GET /photo/:fileId?t=<auth token> — <img> tags can't send headers, so
// the token rides the query string; verified the same way as the header.
// Photos are served from /api/public/tsb/photo/:fileId?t=<token> — the
// staff mount's requireAuth can't see a query token, and <img> tags
// can't send headers.
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

export default router
