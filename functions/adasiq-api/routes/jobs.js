import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { listAllEstimates, getEstimateLineItems } from '../services/zoho.js'

const router = express.Router()

const JOBS_TABLE_NAME = 'Jobs'

// ─── Row ↔ Job Mapping ────────────────────────────────────────────────────────

function rowToJob(row) {
  return {
    id:               String(row.ROWID),
    shop_name:        row.shop_name        || '',
    year:             row.year             || '',
    make:             row.make             || '',
    model:            row.model            || '',
    vehicle:          row.vehicle          || '',
    vin:              row.vin              || '',
    insurer:          row.insurer          || '',
    technician:       row.technician       || '',
    scheduled_date:   row.scheduled_date   || '',
    calibrations:     row.calibrations     || '[]',
    notes:            row.notes            || '',
    report_url:       row.report_url       || '',
    status:           row.status           || 'need_dispatch',
    invoiced:         row.invoiced === 'true',
    created_at:       row.created_at       || '',
    zoho_estimate_id: row.zoho_estimate_id || '',
    quote_number:     row.quote_number     || '',
    quote_url:        row.quote_url        || '',
    folder_url:       row.folder_url       || '',
    invoice_number:   row.invoice_number   || '',
    invoice_status:   row.invoice_status   || '',
  }
}

function jobToRow(job) {
  const { id, invoiced, ...rest } = job
  return { ...rest, invoiced: String(Boolean(invoiced)) }
}

// ─── Datastore Helpers ────────────────────────────────────────────────────────

function getTable(req) {
  // Use advancedio type to get admin credentials for full read/write access
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.datastore().table(JOBS_TABLE_NAME)
}

async function getAllJobs(req) {
  const table = getTable(req)
  const rows = await table.getAllRows()
  return (rows || []).map(rowToJob)
}

async function insertJob(req, jobData) {
  const table = getTable(req)
  const row = jobToRow({ ...jobData, created_at: jobData.created_at || new Date().toISOString() })
  const inserted = await table.insertRow(row)
  return rowToJob(inserted)
}

async function updateJob(req, rowId, updates) {
  const table = getTable(req)
  const row = { ROWID: Number(rowId), ...jobToRow(updates) }
  const updated = await table.updateRow(row)
  return rowToJob(updated)
}

async function deleteJob(req, rowId) {
  const table = getTable(req)
  await table.deleteRow(Number(rowId))
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/jobs
router.get('/', async (req, res) => {
  try {
    const jobs = await getAllJobs(req)
    res.json(jobs)
  } catch (err) {
    console.error('[jobs GET]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/jobs
router.post('/', async (req, res) => {
  try {
    const newJob = await insertJob(req, req.body)
    res.status(201).json(newJob)
  } catch (err) {
    console.error('[jobs POST]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/jobs/:id
router.put('/:id', async (req, res) => {
  try {
    const updated = await updateJob(req, req.params.id, req.body)
    res.json(updated)
  } catch (err) {
    const detail = err?.response?.data || err?.data || err.message
    console.error('[jobs PUT]', JSON.stringify(detail), err.stack)
    res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
  }
})

// PATCH /api/jobs/:id — partial update (only fields provided)
router.patch('/:id', async (req, res) => {
  try {
    const table = getTable(req)
    const currentRow = await table.getRow(Number(req.params.id))
    const currentJob = rowToJob(currentRow)
    const merged = { ...currentJob, ...req.body }
    const updated = await updateJob(req, req.params.id, merged)
    res.json(updated)
  } catch (err) {
    const detail = err?.response?.data || err?.data || err.message
    console.error('[jobs PATCH]', JSON.stringify(detail), err.stack)
    res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
  }
})

// DELETE /api/jobs/:id
router.delete('/:id', async (req, res) => {
  try {
    await deleteJob(req, req.params.id)
    res.json({ success: true })
  } catch (err) {
    console.error('[jobs DELETE]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/jobs/sync-quotes
router.post('/sync-quotes', async (req, res) => {
  try {
    const [estimates, jobs] = await Promise.all([
      listAllEstimates(),
      getAllJobs(req),
    ])

    const linkedJobCount = jobs.filter(j => j.zoho_estimate_id).length
    if (estimates.length === 0 && linkedJobCount > 0) {
      return res.status(503).json({
        error: 'Zoho returned 0 estimates — skipping sync to protect existing jobs. Try again.',
      })
    }

    const estimateMap = new Map(estimates.map(e => [e.estimate_id, e]))
    const existingEstimateIds = new Set(jobs.map(j => j.zoho_estimate_id).filter(Boolean))
    // Only import saved drafts — not sent, accepted, invoiced, etc.
    const IMPORT_STATUSES = new Set(['draft'])

    let created = 0
    for (const est of estimates) {
      if (!IMPORT_STATUSES.has(est.status)) continue
      if (existingEstimateIds.has(est.estimate_id)) continue

      // Fetch line items from the full estimate detail
      const lineItems = await getEstimateLineItems(est.estimate_id)

      await insertJob(req, {
        zoho_estimate_id: est.estimate_id,
        shop_name:    est.customer_name || '',
        vehicle:      [est.cf_year, est.cf_make, est.cf_model].filter(Boolean).join(' '),
        year:         est.cf_year        || '',
        make:         est.cf_make        || '',
        model:        est.cf_model       || '',
        vin:          est.cf_vin         || '',
        insurer:      est.cf_insurer     || '',
        technician:   est.salesperson_name || '',
        scheduled_date: new Date().toISOString().split('T')[0],
        calibrations: JSON.stringify(lineItems),
        notes:        `Quote: ${est.estimate_number}`,
        report_url:   est.quote_url      || '',
        status:       'need_dispatch',
        quote_number: est.estimate_number || '',
        quote_url:    est.quote_url       || '',
        folder_url:   '',
      })
      created++
    }

    let removed = 0
    for (const job of jobs) {
      if (!job.zoho_estimate_id) continue
      const est = estimateMap.get(job.zoho_estimate_id)
      if (!est || !IMPORT_STATUSES.has(est.status)) {
        try {
          await deleteJob(req, job.id)
          removed++
        } catch (e) {
          console.warn(`[jobs sync] could not delete job ${job.id}:`, e.message)
        }
      }
    }

    res.json({ created, removed, total: estimates.length })
  } catch (err) {
    console.error('[jobs sync-quotes]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/jobs/debug
router.get('/debug', async (req, res) => {
  try {
    const jobs = await getAllJobs(req)
    res.json({ ok: true, jobCount: jobs.length })
  } catch (err) {
    res.json({ ok: false, error: err.message })
  }
})

// ─── Exports for webhook.js ───────────────────────────────────────────────────
export { getAllJobs as readJobsPublic, updateJob as updateJobPublic }
export default router
