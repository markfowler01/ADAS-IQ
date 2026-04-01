import express from 'express'
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { listAllEstimates, getEstimateLineItems } from '../services/zoho.js'

const router = express.Router()

const JOBS_TABLE_NAME = 'Jobs'
const CATALYST_DS_API = 'https://api.catalyst.zoho.com/baas/v1/project'
const DEFAULT_PROJECT_ID = '45874000000016010'

// Catalyst injects x-zc-user-cred-token for web requests and x-zc-admin-cred-token for server-to-server calls.
// For browser-initiated requests the user token is present; admin token may not be.
function getCatalystAuth(req) {
  const token = req.headers['x-zc-user-cred-token'] || req.headers['x-zc-admin-cred-token'] || ''
  const projectId = req.headers['x-zc-projectid'] || DEFAULT_PROJECT_ID
  return { token, projectId }
}

function dsAuthHeaders(token) {
  return { Authorization: `Catalyst-Cred-Token ${token}`, 'Content-Type': 'application/json' }
}

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
    region:           row.region           || '',
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
  // Only include columns that exist in the Catalyst Datastore Jobs table schema.
  // Do not spread unknown/new fields — Catalyst returns an error for unknown column names.
  return {
    shop_name:        job.shop_name        || '',
    vehicle:          job.vehicle          || '',
    year:             job.year             || '',
    make:             job.make             || '',
    model:            job.model            || '',
    vin:              job.vin              || '',
    insurer:          job.insurer          || '',
    technician:       job.technician       || '',
    scheduled_date:   job.scheduled_date   || '',
    calibrations:     typeof job.calibrations === 'string' ? job.calibrations : JSON.stringify(job.calibrations || []),
    notes:            job.notes            || '',
    report_url:       job.report_url       || '',
    status:           job.status           || 'need_dispatch',
    invoiced:         String(Boolean(job.invoiced)),
    created_at:       job.created_at       || '',
    zoho_estimate_id: job.zoho_estimate_id || '',
    quote_number:     job.quote_number     || '',
    quote_url:        job.quote_url        || '',
    folder_url:       job.folder_url       || '',
    invoice_number:   job.invoice_number   || '',
    invoice_status:   job.invoice_status   || '',
  }
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
  // The Catalyst SDK v3.3 uses PATCH for updateRow, but Catalyst's Datastore REST API requires PUT.
  // Bypass the SDK and call PUT directly. Use the table NAME so we don't rely on a hardcoded table ID.
  const { token, projectId } = getCatalystAuth(req)
  const row = { ROWID: Number(rowId), ...jobToRow(updates) }
  const url = `${CATALYST_DS_API}/${projectId}/table/${JOBS_TABLE_NAME}/row`
  const res = await axios.put(url, [row], { headers: dsAuthHeaders(token), timeout: 15000 })
  const updated = res.data?.data?.[0]
  if (!updated) throw new Error('Update returned no data')
  return rowToJob(updated)
}

async function deleteJob(req, rowId) {
  const { token, projectId } = getCatalystAuth(req)
  const url = `${CATALYST_DS_API}/${projectId}/table/${JOBS_TABLE_NAME}/row/${rowId}`
  await axios.delete(url, { headers: dsAuthHeaders(token), timeout: 15000 })
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
