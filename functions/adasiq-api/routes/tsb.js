// Absolute ADAS TSB library (Mark 2026-09-05): in-house tips & tricks —
// calibration, keys, cloning — quick to create (voice-typed, AI-cleaned)
// and searchable. Phase 1: store + CRUD. Phase 2 adds the ask-Claude box.
//
// Storage: AppConfig index-row pattern (same as shop quotes) — durable,
// write-verified, no console table setup needed.
import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

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

export default router
