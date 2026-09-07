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

export default router
