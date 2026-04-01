import express from 'express'
import axios from 'axios'
import { listAllEstimates } from '../services/zoho.js'

const router = express.Router()

// ─── Catalyst Datastore Config ────────────────────────────────────────────────
const CATALYST_API = 'https://api.catalyst.zoho.com/baas/v1/project'
const DEFAULT_PROJECT_ID = '45874000000016010'
const JOBS_TABLE_NAME = 'Jobs'

let _tableId = null

function getAuth(req) {
  const token = req.headers['x-zc-admin-cred-token'] || req.headers['x-zc-user-cred-token'] || ''
  const projectId = req.headers['x-zc-projectid'] || DEFAULT_PROJECT_ID
  return { token, projectId }
}

function dsHeaders(token) {
  return {
    Authorization: `Catalyst-Cred-Token ${token}`,
    'Content-Type': 'application/json',
  }
}

async function getTableId(token, projectId) {
  if (_tableId) return _tableId
  const res = await axios.get(`${CATALYST_API}/${projectId}/table`, {
    headers: dsHeaders(token),
    timeout: 10000,
  })
  const tables = res.data?.data || []
  const table = tables.find(t => t.table_name === JOBS_TABLE_NAME)
  if (!table) {
    throw new Error(
      `Catalyst Datastore table "${JOBS_TABLE_NAME}" not found. ` +
      `Create it in the Catalyst console first (see setup instructions).`
    )
  }
  _tableId = String(table.table_id)
  console.log(`[jobs] Discovered table "${JOBS_TABLE_NAME}" id=${_tableId}`)
  return _tableId
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
  // Strip id — ROWID is managed by Catalyst
  const { id, invoiced, ...rest } = job
  return {
    ...rest,
    invoiced: String(Boolean(invoiced)),
  }
}

// ─── Datastore Operations ─────────────────────────────────────────────────────

async function getAllJobs(token, projectId) {
  const tableId = await getTableId(token, projectId)
  let all = []
  let nextToken = undefined

  do {
    const params = { maxRows: 200 }
    if (nextToken) params.next_token = nextToken

    const res = await axios.get(`${CATALYST_API}/${projectId}/table/${tableId}/row`, {
      headers: dsHeaders(token),
      params,
      timeout: 15000,
    })
    const rows = res.data?.data || []
    all = all.concat(rows.map(rowToJob))
    nextToken = res.data?.next_token || null
  } while (nextToken)

  return all
}

async function insertJob(token, projectId, jobData) {
  const tableId = await getTableId(token, projectId)
  const row = jobToRow({ ...jobData, created_at: jobData.created_at || new Date().toISOString() })
  const res = await axios.post(
    `${CATALYST_API}/${projectId}/table/${tableId}/row`,
    [row],
    { headers: dsHeaders(token), timeout: 15000 }
  )
  const inserted = res.data?.data?.[0]
  if (!inserted) throw new Error('Insert returned no row')
  return rowToJob(inserted)
}

async function updateJob(token, projectId, rowId, updates) {
  const tableId = await getTableId(token, projectId)
  const row = { ROWID: Number(rowId), ...jobToRow(updates) }
  const res = await axios.put(
    `${CATALYST_API}/${projectId}/table/${tableId}/row`,
    [row],
    { headers: dsHeaders(token), timeout: 15000 }
  )
  const updated = res.data?.data?.[0]
  if (!updated) throw new Error('Update returned no row')
  return rowToJob(updated)
}

async function deleteJob(token, projectId, rowId) {
  const tableId = await getTableId(token, projectId)
  await axios.delete(
    `${CATALYST_API}/${projectId}/table/${tableId}/row/${rowId}`,
    { headers: dsHeaders(token), timeout: 15000 }
  )
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/jobs
router.get('/', async (req, res) => {
  try {
    const { token, projectId } = getAuth(req)
    const jobs = await getAllJobs(token, projectId)
    res.json(jobs)
  } catch (err) {
    console.error('[jobs GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/jobs
router.post('/', async (req, res) => {
  try {
    const { token, projectId } = getAuth(req)
    const newJob = await insertJob(token, projectId, req.body)
    res.status(201).json(newJob)
  } catch (err) {
    console.error('[jobs POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/jobs/:id
router.put('/:id', async (req, res) => {
  try {
    const { token, projectId } = getAuth(req)
    const updated = await updateJob(token, projectId, req.params.id, req.body)
    res.json(updated)
  } catch (err) {
    console.error('[jobs PUT]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/jobs/:id
router.delete('/:id', async (req, res) => {
  try {
    const { token, projectId } = getAuth(req)
    await deleteJob(token, projectId, req.params.id)
    res.json({ success: true })
  } catch (err) {
    console.error('[jobs DELETE]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/jobs/sync-quotes
router.post('/sync-quotes', async (req, res) => {
  try {
    const { token, projectId } = getAuth(req)
    const [estimates, jobs] = await Promise.all([
      listAllEstimates(),
      getAllJobs(token, projectId),
    ])

    // Safety check — if Zoho returned nothing, refuse to run removal
    const linkedJobCount = jobs.filter(j => j.zoho_estimate_id).length
    if (estimates.length === 0 && linkedJobCount > 0) {
      return res.status(503).json({
        error: 'Zoho returned 0 estimates — skipping sync to protect existing jobs. Try again.',
      })
    }

    const estimateMap = new Map(estimates.map(e => [e.estimate_id, e]))
    const existingEstimateIds = new Set(jobs.map(j => j.zoho_estimate_id).filter(Boolean))
    const SKIP_STATUSES = new Set(['void', 'expired'])

    // Create jobs for new estimates
    let created = 0
    for (const est of estimates) {
      if (SKIP_STATUSES.has(est.status)) continue
      if (existingEstimateIds.has(est.estimate_id)) continue

      await insertJob(token, projectId, {
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
        calibrations: '[]',
        notes:        `Quote: ${est.estimate_number}`,
        report_url:   est.quote_url      || '',
        status:       'need_dispatch',
        quote_number: est.estimate_number || '',
        quote_url:    est.quote_url       || '',
        folder_url:   '',
      })
      created++
    }

    // Remove jobs for voided/deleted estimates
    let removed = 0
    for (const job of jobs) {
      if (!job.zoho_estimate_id) continue
      const est = estimateMap.get(job.zoho_estimate_id)
      if (!est || SKIP_STATUSES.has(est.status)) {
        try {
          await deleteJob(token, projectId, job.id)
          removed++
        } catch (e) {
          console.warn(`[jobs sync] could not delete job ${job.id}:`, e.message)
        }
      }
    }

    res.json({ created, removed, total: estimates.length })
  } catch (err) {
    console.error('[jobs sync-quotes]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── Debug ────────────────────────────────────────────────────────────────────
router.get('/debug', async (req, res) => {
  try {
    const { token, projectId } = getAuth(req)
    const hasToken = !!token
    const tableId = await getTableId(token, projectId)
    const jobs = await getAllJobs(token, projectId)
    res.json({ ok: true, hasToken, projectId, tableId, jobCount: jobs.length })
  } catch (err) {
    res.json({ ok: false, error: err.message })
  }
})

// ─── Exports for webhook.js ───────────────────────────────────────────────────
export { getAllJobs as readJobsPublic, updateJob as updateJobPublic }
export default router
