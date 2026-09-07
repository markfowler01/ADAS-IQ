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
function load() {
  if (!_vehicles) {
    try { _vehicles = JSON.parse(readFileSync(join(DATA_DIR, 'hexprog_vehicles.json'), 'utf8')) } catch { _vehicles = [] }
    try { _ecus = JSON.parse(readFileSync(join(DATA_DIR, 'hexprog_ecus.json'), 'utf8')) } catch { _ecus = [] }
    for (const v of _vehicles) v._s = [v.make, v.model, v.year, v.engine, v.ecu, v.micro, v.methods].join(' ').toLowerCase()
    for (const e of _ecus) e._s = [e.make, e.maker, e.module, e.mcu, e.type, e.options].join(' ').toLowerCase()
  }
}

router.get('/stats', (req, res) => {
  load()
  res.json({ tool: 'Hex Prog II', vehicles: _vehicles.length, ecus: _ecus.length })
})

// GET /api/cloning/search?q=2018+f150&type=vehicles
// Every space-separated term must match somewhere in the row.
router.get('/search', (req, res) => {
  load()
  const q = String(req.query.q || '').trim().toLowerCase()
  const type = req.query.type === 'ecus' ? 'ecus' : 'vehicles'
  const list = type === 'ecus' ? _ecus : _vehicles
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

export default router
