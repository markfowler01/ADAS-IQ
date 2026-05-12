/**
 * POST /api/cleanup-completed/run
 *
 * Cron-protected route that deletes Kanban jobs from the "complete" column
 * that are BOTH invoiced AND more than 24 hours old.
 *
 * Safety rules (all three must be true to delete):
 *   1. status === 'complete'
 *   2. invoiced === true
 *   3. created_at is more than 24 hours ago
 *
 * Protected by X-Cron-Secret header (CLEANUP_CRON_SECRET env var).
 * When CLEANUP_CRON_SECRET is not set the route is open (dev convenience).
 *
 * GET /api/cleanup-completed/dry-run — shows what WOULD be deleted, no changes made.
 */

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()
const JOBS_TABLE = 'Jobs'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

function getTable(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.datastore().table(JOBS_TABLE)
}

function isInvoiced(row) {
  // The datastore stores booleans as strings — handle both forms
  return row.invoiced === true || row.invoiced === 'true'
}

function isOldEnough(row) {
  if (!row.created_at) return true // no timestamp → treat as old
  return new Date(row.created_at).getTime() < Date.now() - ONE_DAY_MS
}

function isCandidateForDeletion(row) {
  return row.status === 'complete' && isInvoiced(row) && isOldEnough(row)
}

function checkAuth(req, res) {
  const secret = process.env.CLEANUP_CRON_SECRET
  if (secret && req.headers['x-cron-secret'] !== secret) {
    res.status(401).json({ error: 'Unauthorized — invalid or missing X-Cron-Secret header' })
    return false
  }
  return true
}

// ── Dry run — read-only preview ───────────────────────────────────────────────
router.get('/dry-run', async (req, res) => {
  if (!checkAuth(req, res)) return
  try {
    const rows = await getTable(req).getAllRows()
    const candidates = rows.filter(isCandidateForDeletion)

    res.json({
      would_delete: candidates.length,
      total_jobs:   rows.length,
      jobs: candidates.map(r => ({
        id:         String(r.ROWID),
        shop_name:  r.shop_name  || '',
        vehicle:    r.vehicle    || [r.year, r.make, r.model].filter(Boolean).join(' '),
        created_at: r.created_at || '',
        invoiced:   r.invoiced,
        status:     r.status,
      })),
    })
  } catch (err) {
    console.error('[cleanup dry-run]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Live run — actually deletes ───────────────────────────────────────────────
router.post('/run', async (req, res) => {
  if (!checkAuth(req, res)) return
  try {
    const table    = getTable(req)
    const rows     = await table.getAllRows()
    const candidates = rows.filter(isCandidateForDeletion)

    let deleted = 0
    let failed  = 0
    const deletedJobs = []
    const errors = []

    for (const row of candidates) {
      try {
        await table.deleteRow(String(row.ROWID))
        deleted++
        deletedJobs.push({
          id:        String(row.ROWID),
          shop_name: row.shop_name || '',
          vehicle:   row.vehicle   || [row.year, row.make, row.model].filter(Boolean).join(' '),
          created_at: row.created_at || '',
        })
      } catch (e) {
        console.error(`[cleanup] failed to delete ROWID ${row.ROWID}:`, e.message)
        failed++
        errors.push({ id: String(row.ROWID), error: e.message })
      }
    }

    console.log(`[cleanup] Run complete — deleted ${deleted}, failed ${failed}, total jobs scanned ${rows.length}`)
    res.json({ deleted, failed, total_scanned: rows.length, jobs: deletedJobs, errors })
  } catch (err) {
    console.error('[cleanup run]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Job Requested cleanup — deletes job_requested cards older than 24 hours ───
// These are stale requests that were never dispatched or already handled.
router.post('/job-requested', async (req, res) => {
  if (!checkAuth(req, res)) return
  try {
    const table = getTable(req)
    const rows  = await table.getAllRows()
    const candidates = rows.filter(r =>
      r.status === 'job_requested' && isOldEnough(r)
    )

    let deleted = 0
    let failed  = 0
    const deletedJobs = []
    const errors = []

    for (const row of candidates) {
      try {
        await table.deleteRow(String(row.ROWID))
        deleted++
        deletedJobs.push({
          id:        String(row.ROWID),
          shop_name: row.shop_name || '',
          vehicle:   row.vehicle   || [row.year, row.make, row.model].filter(Boolean).join(' '),
          ro_number: row.ro_number || '',
          created_at: row.created_at || '',
        })
      } catch (e) {
        failed++
        errors.push({ id: String(row.ROWID), error: e.message })
      }
    }

    console.log(`[cleanup job-requested] deleted ${deleted}, failed ${failed}, scanned ${rows.length}`)
    res.json({ deleted, failed, total_scanned: rows.length, jobs: deletedJobs, errors })
  } catch (err) {
    console.error('[cleanup job-requested]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Force cleanup — deletes ALL complete cards regardless of invoiced/age ─────
router.post('/force', async (req, res) => {
  if (!checkAuth(req, res)) return
  try {
    const table = getTable(req)
    const rows  = await table.getAllRows()
    const candidates = rows.filter(r => r.status === 'complete')

    let deleted = 0
    let failed  = 0
    const deletedJobs = []
    const errors = []

    for (const row of candidates) {
      try {
        await table.deleteRow(String(row.ROWID))
        deleted++
        deletedJobs.push({
          id:         String(row.ROWID),
          shop_name:  row.shop_name  || '',
          vehicle:    row.vehicle    || [row.year, row.make, row.model].filter(Boolean).join(' '),
          created_at: row.created_at || '',
          invoiced:   row.invoiced,
        })
      } catch (e) {
        failed++
        errors.push({ id: String(row.ROWID), error: e.message })
      }
    }

    console.log(`[cleanup force] deleted ${deleted}, failed ${failed}, scanned ${rows.length}`)
    res.json({ deleted, failed, total_scanned: rows.length, jobs: deletedJobs, errors })
  } catch (err) {
    console.error('[cleanup force]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Ready-to-Invoice cleanup — deletes ready_invoice cards that are invoiced ──
router.post('/ready-invoice', async (req, res) => {
  if (!checkAuth(req, res)) return
  try {
    const table = getTable(req)
    const rows  = await table.getAllRows()
    const candidates = rows.filter(r =>
      r.status === 'ready_invoice' && isInvoiced(r)
    )

    let deleted = 0
    let failed  = 0
    const deletedJobs = []
    const errors = []

    for (const row of candidates) {
      try {
        await table.deleteRow(String(row.ROWID))
        deleted++
        deletedJobs.push({
          id:         String(row.ROWID),
          shop_name:  row.shop_name  || '',
          vehicle:    row.vehicle    || [row.year, row.make, row.model].filter(Boolean).join(' '),
          created_at: row.created_at || '',
          invoiced:   row.invoiced,
        })
      } catch (e) {
        failed++
        errors.push({ id: String(row.ROWID), error: e.message })
      }
    }

    console.log(`[cleanup ready-invoice] deleted ${deleted}, failed ${failed}, scanned ${rows.length}`)
    res.json({ deleted, failed, total_scanned: rows.length, jobs: deletedJobs, errors })
  } catch (err) {
    console.error('[cleanup ready-invoice]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
