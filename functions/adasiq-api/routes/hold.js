// The Hold — HTTP surface. Mirrors the planner's tab so the data can move off
// his phone's localStorage and stop being one iOS eviction from gone.
import express from 'express'
import {
  listContacts, upsertContact, logTouch, overdue, birthdays,
  holdStatus, importFromPlanner, emptyContact, CIRCLE_TIERS,
} from '../services/hold.js'
import { ptDate } from '../services/ptDate.js'

const router = express.Router()

router.get('/', async (req, res) => {
  try {
    const today = ptDate()
    const all = await listContacts(req, { includeArchived: req.query.archived === '1' })
    res.json({
      ok: true, today, total: all.length,
      contacts: all
        .map(c => ({ ...c, status: holdStatus(c, today) }))
        .sort((a, b) => b.status.powerScore - a.status.powerScore),
    })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get('/due', async (req, res) => {
  try {
    const today = ptDate()
    const [due, bd] = await Promise.all([overdue(req, today, Number(req.query.limit) || 5), birthdays(req, today)])
    res.json({ ok: true, today, ...due, birthdays: bd })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Is the durable table actually there? Cache-only means a 48h TTL and this
// data is gone — the exact failure that ate the SMS history in July.
router.get('/storage', async (req, res) => {
  try {
    const app = (await import('zcatalyst-sdk-node')).default.initialize(req, { type: 'advancedio' })
    await app.zcql().executeZCQLQuery('SELECT ROWID FROM hold_contacts LIMIT 1')
    res.json({ ok: true, durable: true, table: 'hold_contacts' })
  } catch (e) {
    res.json({
      ok: true, durable: false, table: 'hold_contacts', error: e.message,
      warning: 'Cache only — contacts expire after 48h. Create the table in the Catalyst console.',
      columns: ['hold_id (varchar 64)', 'name (varchar 255)', 'circle (varchar 32)', 'payload (text/bigint text)'],
    })
  }
})

router.post('/contact', async (req, res) => {
  try {
    const b = req.body || {}
    if (!b.name && !b.id) return res.status(400).json({ ok: false, error: 'name or id required' })
    // A new contact with no cadence gets its circle's default rather than
    // silently inheriting "quarterly" and never surfacing.
    if (!b.id && !b.touchGoal) {
      const tier = CIRCLE_TIERS.find(t => t.key === (b.circle || 'network'))
      b.touchGoal = { type: tier?.defaultGoal || 'quarterly', customDays: null }
    }
    res.json({ ok: true, contact: await upsertContact(req, b.id ? b : { ...emptyContact(b.name), ...b }) })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.post('/touch', async (req, res) => {
  try {
    const { id, type, note, date } = req.body || {}
    if (!id) return res.status(400).json({ ok: false, error: 'id required' })
    res.json({ ok: true, contact: await logTouch(req, id, { type, note, date }) })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Paste the planner's `planner:holds` array here to move it off the phone.
router.post('/import', async (req, res) => {
  try {
    const raw = Array.isArray(req.body) ? req.body : (req.body?.holds || [])
    if (!Array.isArray(raw) || !raw.length) return res.status(400).json({ ok: false, error: 'expected a non-empty array of contacts' })
    res.json({ ok: true, ...(await importFromPlanner(req, raw)), total: (await listContacts(req)).length })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

export default router
