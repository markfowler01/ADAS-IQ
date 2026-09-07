// Hex Prog cloning coverage (Mark 2026-09-07): searchable dataset parsed
// from Microtronik's Hexprog II vehicle list + ECU list PDFs. Read-only
// reference data shipped with the function; swap the JSON files to
// update when Microtronik releases a new version.
import express from 'express'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const router = express.Router()
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

let _vehicles = null
let _ecus = null
let _dc706 = null
function load() {
  if (!_vehicles) {
    try { _vehicles = JSON.parse(readFileSync(join(DATA_DIR, 'hexprog_vehicles.json'), 'utf8')) } catch { _vehicles = [] }
    try { _ecus = JSON.parse(readFileSync(join(DATA_DIR, 'hexprog_ecus.json'), 'utf8')) } catch { _ecus = [] }
    try { _dc706 = JSON.parse(readFileSync(join(DATA_DIR, 'dc706_modules.json'), 'utf8')) } catch { _dc706 = [] }
    for (const v of _vehicles) v._s = [v.make, v.model, v.year, v.engine, v.ecu, v.micro, v.methods].join(' ').toLowerCase()
    for (const e of _ecus) e._s = [e.make, e.maker, e.module, e.mcu, e.type, e.options].join(' ').toLowerCase()
    for (const d of _dc706) d._s = [d.make, d.module, d.maker, d.type, d.mcu, d.system, d.method, d.other].join(' ').toLowerCase()
  }
}

router.get('/stats', (req, res) => {
  load()
  res.json({
    tools: [
      { id: 'hexprog', label: 'Hex Prog II', vehicles: _vehicles.length, ecus: _ecus.length },
      { id: 'dc706', label: 'OBDSTAR DC706', modules: _dc706.length },
    ],
  })
})

// GET /api/cloning/search?q=...&type=vehicles|ecus|dc706
// Every space-separated term must match somewhere in the row.
router.get('/search', (req, res) => {
  load()
  const q = String(req.query.q || '').trim().toLowerCase()
  const type = ['ecus', 'dc706'].includes(req.query.type) ? req.query.type : 'vehicles'
  const list = type === 'ecus' ? _ecus : type === 'dc706' ? _dc706 : _vehicles
  if (!q) return res.json({ type, total: list.length, results: [] })
  const terms = q.split(/\s+/).filter(Boolean)
  const hits = []
  for (const row of list) {
    if (terms.every(t => row._s.includes(t))) {
      hits.push(row)
      if (hits.length >= 400) break
    }
  }
  res.json({
    type,
    total: hits.length,
    capped: hits.length >= 400,
    results: hits.slice(0, 100).map(({ _s, ...r }) => r),
  })
})

// Photo-of-ECU search (Mark 2026-09-07): snap the module label, Claude
// vision pulls the searchable identifiers, the client runs the search.
import multer from 'multer'
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) cb(new Error('Only image files are accepted'))
    else cb(null, true)
  },
})

router.post('/extract-label', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided.' })
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25000, maxRetries: 1 })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: req.file.mimetype || 'image/jpeg', data: req.file.buffer.toString('base64') } },
          { type: 'text', text:
            `This is a photo of an automotive ECU/module label (engine computer, TCM, BCM, or similar). Extract the identifiers a coverage-list search needs:\n` +
            `- manufacturer (Bosch, Continental, Denso, Delphi, Magneti Marelli, Temic, Kefico...)\n` +
            `- module family/name (e.g. ME17.9.11, EDC17C46, MG1CS019, DQ200, 8GMF)\n` +
            `- MCU chip if printed (e.g. TC1766, MPC5565)\n` +
            `- notable part numbers\n\n` +
            `Return ONLY raw JSON: {"terms": "<2-4 best search words, most specific first>", "detail": "<one line: what module this looks like>"}. If nothing is readable: {"terms": "", "detail": "could not read the label"}.` },
        ],
      }],
    })
    const raw = (msg.content || []).map(b => b.text || '').join('').trim()
      .replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '')
    const parsed = JSON.parse(raw)
    res.json({ terms: String(parsed?.terms || '').trim(), detail: String(parsed?.detail || '').trim() })
  } catch (e) {
    console.error('[cloning extract-label]', e.message)
    res.status(500).json({ error: e.message || 'Label extraction failed.' })
  }
})

export default router
