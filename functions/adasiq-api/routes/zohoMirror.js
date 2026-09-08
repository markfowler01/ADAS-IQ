// /api/zoho-mirror — read-only mirror of Zoho Books (books scan B-02).
// Never writes to Zoho. Mounted requireAuth + requireStaff; the sync
// triggers are owner-only. The first full import is preview-then-commit.
import express from 'express'
import { syncMonths, monthsBetween, readMonth, readMeta, buildSummary, todayPT } from '../services/zohoMirror.js'

const router = express.Router()
const isOwner = req => String(req.user?.email || '').toLowerCase().startsWith('mark@') || req.user?.role === 'owner'

function monthsFromQuery(q) {
  const cur = todayPT().slice(0, 7)
  if (q.months) return String(q.months).split(',').map(s => s.trim()).filter(s => /^\d{4}-\d{2}$/.test(s))
  const from = /^\d{4}-\d{2}$/.test(q.from || '') ? q.from : cur
  const to = /^\d{4}-\d{2}$/.test(q.to || '') ? q.to : cur
  return monthsBetween(from, to)
}

router.get('/status', async (req, res) => {
  try { res.json(await readMeta(req)) } catch (e) { res.status(500).json({ error: e.message }) }
})

// Dry run: counts + totals per month, zero writes.
router.get('/preview', async (req, res) => {
  try {
    const months = monthsFromQuery(req.query)
    if (!months.length || months.length > 36) return res.status(400).json({ error: 'Give from/to as YYYY-MM (max 36 months).' })
    res.json(await syncMonths(req, months, { dryRun: true }))
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// Commit: upserts each month's mirror from Zoho into AdasInvoices /
// AdasPayments. Owner only. Capped at 6 months per call so a run stays
// under the 30s API-gateway cap — import a year in two or three passes.
router.post('/sync', async (req, res) => {
  try {
    if (!isOwner(req)) return res.status(403).json({ error: 'Only Mark can run a mirror sync.' })
    const months = monthsFromQuery({ ...req.query, ...(req.body || {}) })
    if (!months.length || months.length > 6) return res.status(400).json({ error: 'Give from/to as YYYY-MM (max 6 months per sync — run it again for the next batch).' })
    res.json(await syncMonths(req, months))
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

router.get('/summary', async (req, res) => {
  try { res.json(await buildSummary(req)) } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/invoices', async (req, res) => {
  try {
    const ym = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayPT().slice(0, 7)
    const list = await readMonth(req, 'inv', ym)
    res.json({ month: ym, invoices: list.sort((a, b) => String(b.date).localeCompare(String(a.date))) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/payments', async (req, res) => {
  try {
    const ym = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayPT().slice(0, 7)
    const list = await readMonth(req, 'pay', ym)
    res.json({ month: ym, payments: list.sort((a, b) => String(b.date).localeCompare(String(a.date))) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default router
