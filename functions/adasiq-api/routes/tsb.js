// Absolute ADAS TSB library (Mark 2026-09-05): in-house tips & tricks —
// calibration, keys, cloning — quick to create (voice-typed, AI-cleaned)
// and searchable. Phase 1: store + CRUD. Phase 2 adds the ask-Claude box.
//
// Storage: AppConfig index-row pattern (same as shop quotes) — durable,
// write-verified, no console table setup needed.
import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import multer from 'multer'
import axios from 'axios'

const router = express.Router()

const INDEX_KEY = 'tsb_index'
const ROW_KEY = id => `tsb:${id}`.slice(0, 64)
export const TSB_CATEGORIES = ['calibration', 'keys', 'cloning', 'general']

async function cfgRow(app, key) {
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key.replace(/'/g, "''")}' LIMIT 1`
  ).catch(() => [])
  return rows?.[0]?.AppConfig || rows?.[0] || null
}
async function cfgSet(app, key, value) {
  const table = app.datastore().table('AppConfig')
  const str = JSON.stringify(value)
  const r = await cfgRow(app, key)
  if (r?.ROWID) await table.updateRow({ ROWID: r.ROWID, config_value: str })
  else await table.insertRow({ config_key: key, config_value: str })
}
async function readIndex(app) {
  const r = await cfgRow(app, INDEX_KEY)
  try { return JSON.parse(r?.config_value || '[]') } catch { return [] }
}
export async function readAllTsbs(req) {
  const app = catalyst.initialize(req)
  const ids = await readIndex(app)
  if (!ids.length) return []
  const rows = await Promise.all(ids.map(async id => {
    const r = await cfgRow(app, ROW_KEY(id))
    try { return JSON.parse(r?.config_value || 'null') } catch { return null }
  }))
  return rows.filter(Boolean)
}
async function writeTsb(req, tsb) {
  const app = catalyst.initialize(req)
  await cfgSet(app, ROW_KEY(tsb.id), tsb)
  const ids = await readIndex(app)
  if (!ids.includes(tsb.id)) {
    ids.push(tsb.id)
    await cfgSet(app, INDEX_KEY, ids)
  }
  const check = await cfgRow(app, ROW_KEY(tsb.id))
  if (!check?.config_value) throw new Error('TSB write did not persist — try again')
}
async function removeTsb(req, id) {
  const app = catalyst.initialize(req)
  const ids = (await readIndex(app)).filter(x => x !== id)
  await cfgSet(app, INDEX_KEY, ids)
  const r = await cfgRow(app, ROW_KEY(id))
  if (r?.ROWID) await app.datastore().table('AppConfig').deleteRow(String(r.ROWID)).catch(() => {})
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
      const { getAccessToken } = await import('../services/workdrive.js')
      const wdToken = await getAccessToken()
      const folderId = await ensureTsbFolder(req, wdToken)
      if (!folderId) return res.status(500).json({ error: 'Could not create the TSB photos folder in WorkDrive.' })
      const ext = (req.file.mimetype.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      const filename = `TSB-${tsb.number || tsb.id}-${Date.now()}.${ext}`
      const { uploadFileToFolder } = await import('../services/workdrive.js')
      const fileId = await uploadFileToFolder(folderId, filename, req.file.buffer, wdToken, req.file.mimetype)
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
  const { getAccessToken } = await import('../services/workdrive.js')
  const wdToken = await getAccessToken()
  const r = await axios.get(`https://download.zoho.com/v1/workdrive/download/${fileId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${wdToken}` },
    responseType: 'arraybuffer', timeout: 25000, maxContentLength: 30 * 1024 * 1024,
  })
  return { buf: Buffer.from(r.data), mime: r.headers['content-type'] || 'image/jpeg' }
}

// GET /photo/:fileId?t=<auth token> — <img> tags can't send headers, so
// the token rides the query string; verified the same way as the header.
router.get('/photo/:fileId', async (req, res) => {
  try {
    if (req.query.t) {
      const { verifyToken } = await import('./auth.js')
      const u = verifyToken(String(req.query.t))
      if (!u) return res.status(401).json({ error: 'unauthorized' })
    }
    // (no t param: requireAuth on the mount already validated the header)
    const { buf, mime } = await fetchWdFile(String(req.params.fileId))
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.type(mime).send(buf)
  } catch (e) {
    res.status(404).json({ error: 'Photo not found' })
  }
})

export default router
