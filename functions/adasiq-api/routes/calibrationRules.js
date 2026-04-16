import express from 'express'
import multer from 'multer'
import catalyst from 'zcatalyst-sdk-node'
import { UNIVERSAL_RULES } from '../data/calibrationRulesSeed.js'
import { extractRulesFromJobAid } from '../services/claude.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

const router = express.Router()
const TABLE = 'AdasCalibrationRules'

function getTable(req) {
  const sdk = catalyst.initialize(req, { type: 'advancedio' })
  return sdk.datastore().table(TABLE)
}

function rowToRule(row) {
  return {
    id:                    String(row.ROWID),
    make:                  row.make                  || '',
    model:                 row.model                 || '',
    year_start:            row.year_start            || '',
    year_end:              row.year_end              || '',
    trigger_category:      row.trigger_category      || '',
    trigger_keywords:      row.trigger_keywords      || '',
    required_equipment:    row.required_equipment    || '',
    calibration_name:      row.calibration_name      || '',
    cal_type:              row.cal_type              || '',
    justification_template: row.justification_template || '',
    source:                row.source                || '',
    enabled:               row.enabled               || 'true',
    priority:              row.rule_priority         || '5',
    notes:                 row.notes                 || '',
    created_at:            row.created_at            || '',
  }
}

function ruleToRow(r) {
  return {
    make:                  r.make                  || '',
    model:                 r.model                 || '',
    year_start:            r.year_start            || '',
    year_end:              r.year_end              || '',
    trigger_category:      r.trigger_category      || '',
    trigger_keywords:      r.trigger_keywords      || '',
    required_equipment:    r.required_equipment    || '',
    calibration_name:      r.calibration_name      || '',
    cal_type:              r.cal_type              || '',
    justification_template: r.justification_template || '',
    source:                r.source                || '',
    enabled:               String(r.enabled ?? 'true'),
    rule_priority:         String(r.priority       || '5'),
    notes:                 r.notes                 || '',
    created_at:            r.created_at            || '',
  }
}

function extractErr(err) {
  return err?.data?.message || err?.response?.data?.message || err?.message || 'Unknown error'
}

// POST import-job-aid — upload a PDF, extract rules, optionally save them all
// ?save=true will auto-save all extracted rules to the DB
router.post('/import-job-aid', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF uploaded.' })
  try {
    const rules = await extractRulesFromJobAid(req.file.buffer)

    const autoSave = req.query.save === 'true'
    let saved = []
    if (autoSave) {
      const table = getTable(req)
      for (const r of rules) {
        const data = { ...ruleToRow({ ...r, enabled: 'true', rule_priority: r.rule_priority || '8' }), created_at: new Date().toISOString() }
        const row = await table.insertRow(data)
        saved.push(rowToRule(row))
      }
    }

    res.json({
      extracted: rules.length,
      saved: saved.length,
      rules: autoSave ? saved : rules,
    })
  } catch (err) {
    const msg = err?.message || err?.data?.message || JSON.stringify(err) || 'Unknown error'
    console.error('[import-job-aid] Error:', msg)
    res.status(500).json({ error: msg || 'Import failed — check server logs' })
  }
})

// POST seed — load all universal rules into the database
router.post('/seed', async (req, res) => {
  try {
    const table = getTable(req)
    const results = []
    for (const r of UNIVERSAL_RULES) {
      const data = { ...ruleToRow(r), created_at: new Date().toISOString() }
      const row = await table.insertRow(data)
      results.push(rowToRule(row))
    }
    res.json({ seeded: results.length, rules: results })
  } catch (err) {
    res.status(500).json({ error: extractErr(err) })
  }
})

// GET all rules (optionally filter by make, model, year)
router.get('/', async (req, res) => {
  try {
    const table = getTable(req)
    const rows = await table.getAllRows()
    let rules = (rows || []).map(rowToRule)

    // Optional filters
    const { make, model, year } = req.query
    if (make) rules = rules.filter(r => !r.make || r.make.toLowerCase() === make.toLowerCase())
    if (model) rules = rules.filter(r => !r.model || r.model.toLowerCase().includes(model.toLowerCase()))
    if (year) {
      rules = rules.filter(r => {
        if (!r.year_start && !r.year_end) return true
        const y = parseInt(year)
        const start = r.year_start ? parseInt(r.year_start) : 0
        const end = r.year_end ? parseInt(r.year_end) : 9999
        return y >= start && y <= end
      })
    }

    // Sort: enabled first, then by priority desc
    rules.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled === 'true' ? -1 : 1
      return parseInt(b.priority) - parseInt(a.priority)
    })

    res.json(rules)
  } catch (err) {
    res.status(500).json({ error: extractErr(err) })
  }
})

// GET single rule
router.get('/:id', async (req, res) => {
  try {
    const table = getTable(req)
    const row = await table.getRow(req.params.id)
    res.json(rowToRule(row))
  } catch (err) {
    res.status(500).json({ error: extractErr(err) })
  }
})

// POST create rule
router.post('/', async (req, res) => {
  try {
    const table = getTable(req)
    const data = { ...ruleToRow(req.body), created_at: new Date().toISOString() }
    const row = await table.insertRow(data)
    res.json(rowToRule(row))
  } catch (err) {
    res.status(500).json({ error: extractErr(err) })
  }
})

// POST bulk insert (for seeding)
router.post('/bulk', async (req, res) => {
  try {
    const table = getTable(req)
    const rules = req.body.rules || []
    const results = []
    for (const r of rules) {
      const data = { ...ruleToRow(r), created_at: new Date().toISOString() }
      const row = await table.insertRow(data)
      results.push(rowToRule(row))
    }
    res.json({ inserted: results.length, rules: results })
  } catch (err) {
    res.status(500).json({ error: extractErr(err) })
  }
})

// PUT update rule
router.put('/:id', async (req, res) => {
  try {
    const table = getTable(req)
    const row = { ROWID: req.params.id, ...ruleToRow(req.body) }
    const updated = await table.updateRow(row)
    res.json(rowToRule(updated))
  } catch (err) {
    res.status(500).json({ error: extractErr(err) })
  }
})

// DELETE rule
router.delete('/:id', async (req, res) => {
  try {
    const table = getTable(req)
    await table.deleteRow(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: extractErr(err) })
  }
})

export default router
