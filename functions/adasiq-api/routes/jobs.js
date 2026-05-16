import express from 'express'
import multer from 'multer'
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { listAllEstimates, getEstimateLineItems, getAccessToken, updateEstimateShareLink } from '../services/zoho.js'
import { createNotification } from './notifications.js'
import { uploadFileToFolder, findFolderByRO, findFolderByShopVehicle, createShareLink } from '../services/workdrive.js'
import { appendHistory } from '../services/history.js'

const router = express.Router()

const JOBS_TABLE_NAME = 'Jobs'
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })

// ─── Completions Cache ────────────────────────────────────────────────────────
const COMPLETIONS_KEY = 'tech_completions'
const CATALYST_API   = 'https://api.catalyst.zoho.com'

function catalystHeaders(req) {
  const token = req.headers['x-zc-admin-cred-token'] || req.headers['x-zc-user-cred-token'] || ''
  return { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }
}
function catalystProjectId(req) {
  return req.headers['x-zc-projectid'] || process.env.CATALYST_PROJECT_ID || ''
}

async function readCompletions(req) {
  const url = `${CATALYST_API}/baas/v1/project/${catalystProjectId(req)}/cache/${COMPLETIONS_KEY}`
  try {
    const r = await axios.get(url, { headers: catalystHeaders(req) })
    const val = r.data?.data?.cache_value
    return val ? JSON.parse(val) : []
  } catch (e) {
    if (e.response?.status === 404) return []
    throw e
  }
}

async function logCompletion(req, job) {
  let records = []
  try { records = await readCompletions(req) } catch {}

  records.push({
    tech:        job.technician || 'Unknown',
    jobId:       job.id,
    shop:        job.shop_name || '',
    vehicle:     job.vehicle   || [job.year, job.make, job.model].filter(Boolean).join(' '),
    completedAt: new Date().toISOString(),
  })

  // Keep rolling 90 days
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
  records = records.filter(r => new Date(r.completedAt).getTime() > cutoff)

  const projectId = catalystProjectId(req)
  const baseUrl   = `${CATALYST_API}/baas/v1/project/${projectId}/cache`
  const headers   = catalystHeaders(req)
  const body      = { cache_name: COMPLETIONS_KEY, cache_value: JSON.stringify(records), expiry_in_hours: null }

  try {
    await axios.put(`${baseUrl}/${COMPLETIONS_KEY}`, { cache_value: body.cache_value, expiry_in_hours: null }, { headers })
  } catch (e) {
    if (e.response?.status === 404) await axios.post(baseUrl, body, { headers })
    else throw e
  }
}

// ─── History Logging ─────────────────────────────────────────────────────────

function logJobHistory(req, job, trigger) {
  // Stable dedup ID so re-completing the same job doesn't add duplicate entries
  const id = `job_${job.id}_${trigger}`
  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  appendHistory(req, {
    id,
    shop:         job.shop_name   || '',
    vehicle,
    roNumber:     job.invoice_number || job.quote_number || '',
    vin:          job.vin          || '',
    calibrations: (() => {
      try { return JSON.parse(job.calibrations || '[]') } catch { return [] }
    })(),
    estimateUrl:  job.quote_url    || '',
    pdfUrl:       job.folder_url   || '',
    technician:   job.technician   || '',
    createdAt:    new Date().toISOString(),
  })
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
  const table = getTable(req)
  // CRITICAL: keep ROWID as a string — these IDs exceed Number.MAX_SAFE_INTEGER,
  // so Number(rowId) silently loses precision and Catalyst can't find the row.
  const row = { ROWID: rowId, ...jobToRow(updates) }
  const updated = await table.updateRow(row)
  if (!updated) throw new Error('Update returned no data')
  return rowToJob(updated)
}

async function deleteJob(req, rowId) {
  const table = getTable(req)
  // Keep rowId as string for the same precision reason
  await table.deleteRow(rowId)
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/jobs/completions — tech completion log (last 90 days)
router.get('/completions', async (req, res) => {
  try {
    const records = await readCompletions(req)
    res.json(records)
  } catch (err) {
    console.error('[completions GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

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

    // Notify Kat when this is a manual job request (via_request flag from JobRequestModal)
    if (req.body.via_request) {
      const vehicle = newJob.vehicle || [newJob.year, newJob.make, newJob.model].filter(Boolean).join(' ')
      await createNotification(req, {
        to: 'Kath',
        toEmail: 'k.belmonte@absoluteadas.com',
        type: 'job_requested',
        title: `New job request: ${newJob.shop_name || 'Unknown shop'}`,
        body: `${vehicle || 'Vehicle TBD'}${newJob.technician ? ' · Requested by ' + newJob.technician : ''}${newJob.quote_number ? ' · RO# ' + newJob.quote_number : ''}`,
        jobId: newJob.id,
        job: newJob,
      }).catch(e => console.warn('[notifications job request]', e.message))
    }

    res.status(201).json(newJob)
  } catch (err) {
    console.error('[jobs POST]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

function extractErr(err) {
  // CatalystAPIError has .data.message; plain errors have .message
  return err?.data?.message || err?.response?.data?.message || err?.message || 'Unknown error'
}

// PUT /api/jobs/:id
router.put('/:id', async (req, res) => {
  try {
    // Read current status before update so we can detect completion transition
    let prevStatus = null
    try {
      const cur = rowToJob(await getTable(req).getRow(req.params.id))
      prevStatus = cur.status
    } catch {}

    // Read previous technician so we can detect assignment changes
    let prevTech = null
    try {
      const cur = rowToJob(await getTable(req).getRow(req.params.id))
      prevTech = cur.technician
      if (!prevStatus) prevStatus = cur.status
    } catch {}

    const updated = await updateJob(req, req.params.id, req.body)

    if (req.body.status === 'complete' && prevStatus !== 'complete') {
      logCompletion(req, updated).catch(e => console.warn('[completions]', e.message))
      logJobHistory(req, updated, 'complete')
    }
    if (req.body.invoiced === true || req.body.invoiced === 'true') {
      logJobHistory(req, updated, 'invoiced')
      const vehicle = updated.vehicle || [updated.year, updated.make, updated.model].filter(Boolean).join(' ')
      await createNotification(req, {
        to: 'Mark',
        toEmail: 'mf@absoluteadas.com',
        type: 'job_invoiced',
        title: `Job invoiced: ${updated.shop_name || 'Job'}`,
        body: `${vehicle || 'Vehicle'} — ${updated.shop_name || 'Unknown shop'}${updated.invoice_number ? ' · Invoice #' + updated.invoice_number : ''}`,
        jobId: updated.id,
        job: updated,
      }).catch(e => console.warn('[notifications invoiced]', e.message))
    }

    // Notify tech on every job update when a tech is assigned
    const newTech = updated.technician
    if (newTech) {
      const vehicle = updated.vehicle || [updated.year, updated.make, updated.model].filter(Boolean).join(' ')
      const statusChanged = updated.status !== prevStatus
      const techChanged = newTech !== prevTech
      const type = techChanged ? 'job_assigned' : 'job_updated'
      const action = techChanged ? `Job assigned to ${newTech}` : `Job updated for ${newTech}`
      await createNotification(req, {
        to: newTech,
        toEmail: req.user?.email || '',
        type,
        title: `${action}: ${updated.shop_name || 'New job'}`,
        body: `${vehicle || 'Vehicle TBD'} — ${updated.shop_name || 'Unknown shop'}${updated.scheduled_date ? ' on ' + updated.scheduled_date : ''}${statusChanged ? ' → ' + (updated.status || '').replace(/_/g, ' ') : ''}`,
        jobId: updated.id,
        job: updated,
      }).catch(e => console.warn('[notifications]', e.message))
    }

    // Notify Kath + #technicians when job moves to ready_invoice
    if (updated.status === 'ready_invoice' && prevStatus !== 'ready_invoice') {
      await createNotification(req, {
        to: 'Kath',
        toEmail: 'k.belmonte@absoluteadas.com',
        type: 'job_ready_invoice',
        title: `Ready to invoice: ${updated.shop_name || 'Job'}`,
        body: '',
        jobId: updated.id,
        job: updated,
      }).catch(e => console.warn('[notifications]', e.message))
    }

    res.json(updated)
  } catch (err) {
    const detail = extractErr(err)
    console.error('[jobs PUT]', detail, err.stack)
    res.status(500).json({ error: detail })
  }
})

// PATCH /api/jobs/:id — partial update (only fields provided)
router.patch('/:id', async (req, res) => {
  try {
    const table = getTable(req)
    const currentRow = await table.getRow(req.params.id)
    const currentJob = rowToJob(currentRow)
    const merged = { ...currentJob, ...req.body }
    const updated = await updateJob(req, req.params.id, merged)

    if (req.body.status === 'complete' && currentJob.status !== 'complete') {
      logCompletion(req, updated).catch(e => console.warn('[completions]', e.message))
      logJobHistory(req, updated, 'complete')
    }
    if (req.body.invoiced === true && !currentJob.invoiced) {
      logJobHistory(req, updated, 'invoiced')
      const vehicle = updated.vehicle || [updated.year, updated.make, updated.model].filter(Boolean).join(' ')
      await createNotification(req, {
        to: 'Mark',
        toEmail: 'mf@absoluteadas.com',
        type: 'job_invoiced',
        title: `Job invoiced: ${updated.shop_name || 'Job'}`,
        body: `${vehicle || 'Vehicle'} — ${updated.shop_name || 'Unknown shop'}${updated.invoice_number ? ' · Invoice #' + updated.invoice_number : ''}`,
        jobId: updated.id,
        job: updated,
      }).catch(e => console.warn('[notifications invoiced]', e.message))
    }

    // Notify tech on every job update when a tech is assigned
    const newTech = updated.technician
    if (newTech) {
      const vehicle = updated.vehicle || [updated.year, updated.make, updated.model].filter(Boolean).join(' ')
      const statusChanged = updated.status !== currentJob.status
      const techChanged = newTech !== currentJob.technician
      const type = techChanged ? 'job_assigned' : 'job_updated'
      const action = techChanged ? `Job assigned to ${newTech}` : `Job updated for ${newTech}`
      await createNotification(req, {
        to: newTech,
        toEmail: req.user?.email || '',
        type,
        title: `${action}: ${updated.shop_name || 'New job'}`,
        body: `${vehicle || 'Vehicle TBD'} — ${updated.shop_name || 'Unknown shop'}${updated.scheduled_date ? ' on ' + updated.scheduled_date : ''}${statusChanged ? ' → ' + (updated.status || '').replace(/_/g, ' ') : ''}`,
        jobId: updated.id,
        job: updated,
      }).catch(e => console.warn('[notifications]', e.message))
    }

    // Notify Kath + #technicians when job moves to ready_invoice
    if (updated.status === 'ready_invoice' && currentJob.status !== 'ready_invoice') {
      await createNotification(req, {
        to: 'Kath',
        toEmail: 'k.belmonte@absoluteadas.com',
        type: 'job_ready_invoice',
        title: `Ready to invoice: ${updated.shop_name || 'Job'}`,
        body: '',
        jobId: updated.id,
        job: updated,
      }).catch(e => console.warn('[notifications]', e.message))
    }

    res.json(updated)
  } catch (err) {
    const detail = extractErr(err)
    console.error('[jobs PATCH]', detail, err.stack)
    res.status(500).json({ error: detail })
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
export async function performSyncQuotes(req) {
  const [estimates, jobs] = await Promise.all([
    listAllEstimates(),
    getAllJobs(req),
  ])

  const linkedJobCount = jobs.filter(j => j.zoho_estimate_id).length
  if (estimates.length === 0 && linkedJobCount > 0) {
    const err = new Error('Zoho returned 0 estimates — skipping sync to protect existing jobs. Try again.')
    err.status = 503
    throw err
  }

  const estimateMap = new Map(estimates.map(e => [e.estimate_id, e]))
  const existingEstimateIds = new Set(jobs.map(j => j.zoho_estimate_id).filter(Boolean))
  // Import draft + sent + accepted quotes — these are all "active" estimates that should be in the app
  const IMPORT_STATUSES = new Set(['draft', 'sent', 'accepted'])

  let created = 0
  for (const est of estimates) {
    if (!IMPORT_STATUSES.has(est.status)) continue
    if (existingEstimateIds.has(est.estimate_id)) continue

    // Fetch line items from the full estimate detail
    const lineItems = await getEstimateLineItems(est.estimate_id)

    const vehicle = [est.cf_year, est.cf_make, est.cf_model].filter(Boolean).join(' ')
    const newJob = await insertJob(req, {
      zoho_estimate_id: est.estimate_id,
      shop_name:    est.customer_name || '',
      vehicle,
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
      folder_url:   est.cf_scan_report_and_documentation || '',
    })
    created++

    // Notify Mark + assigned salesperson that a new job is ready to dispatch
    try {
      const notifTitle = `New job: ${est.customer_name || 'Unknown shop'}`
      const notifBody = [vehicle, est.estimate_number ? `Quote #${est.estimate_number}` : ''].filter(Boolean).join(' · ')
      const jobData = { ...newJob, vehicle }

      // Always notify Mark (dispatcher)
      await createNotification(req, {
        to: 'Mark',
        toEmail: 'mf@absoluteadas.com',
        type: 'job_created',
        title: notifTitle,
        body: notifBody,
        jobId: newJob.id || '',
        job: jobData,
      })

      // Also notify the salesperson from Zoho if they're not Mark
      const salesperson = (est.salesperson_name || '').trim()
      if (salesperson && salesperson.toLowerCase() !== 'mark') {
        await createNotification(req, {
          to: salesperson,
          toEmail: null,
          type: 'job_created',
          title: notifTitle,
          body: notifBody,
          jobId: newJob.id || '',
          job: jobData,
        })
      }
    } catch (notifErr) {
      console.warn('[jobs sync] notification failed:', notifErr.message)
    }
  }

  let removed = 0
  let folderLinked = 0
  for (const job of jobs) {
    if (!job.zoho_estimate_id) continue
    const est = estimateMap.get(job.zoho_estimate_id)
    if (!est || !IMPORT_STATUSES.has(est.status)) {
      // Only auto-remove if the job is still sitting in Need to Dispatch
      // (hasn't been dispatched or worked on). Progressed jobs stay even if
      // the estimate was voided/declined in Zoho.
      if (job.status === 'need_dispatch') {
        try {
          await deleteJob(req, job.id)
          removed++
        } catch (e) {
          console.warn(`[jobs sync] could not delete job ${job.id}:`, e.message)
        }
      } else {
        console.log(`[jobs sync] estimate ${job.zoho_estimate_id} no longer active but job ${job.id} is in "${job.status}" — keeping`)
      }
    } else if (!job.folder_url && est.cf_scan_report_and_documentation) {
      // Backfill folder_url for existing jobs that are missing it
      try {
        await updateJob(req, job.id, { ...job, folder_url: est.cf_scan_report_and_documentation })
        folderLinked++
      } catch (e) {
        console.warn(`[jobs sync] could not backfill folder_url for job ${job.id}:`, e.message)
      }
    }
  }

  return { created, removed, folderLinked, total: estimates.length }
}

router.post('/sync-quotes', async (req, res) => {
  try {
    const result = await performSyncQuotes(req)
    res.json(result)
  } catch (err) {
    console.error('[jobs sync-quotes]', err.message, err.stack)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// GET /api/jobs/:id/workdrive-folder — return the WorkDrive folder URL for a job.
// Always returns a public zohoexternal.com share link — never an internal URL.
// Searches WorkDrive by RO number or shop/vehicle if no folder is linked yet.
router.get('/:id/workdrive-folder', async (req, res) => {
  try {
    const table = getTable(req)
    const row = await table.getRow(req.params.id)
    const job = rowToJob(row)

    const wdToken = await getAccessToken()

    // Helper: given a folderId + folderName, create a public share link, persist it, and return it.
    async function resolvePublicLink(folderId, folderName) {
      const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
      const label = folderName || [job.invoice_number || job.quote_number, job.shop_name, vehicle]
        .filter(Boolean).join(' — ') || `Job ${job.id}`
      const shareLink = await createShareLink(folderId, label, wdToken)
      updateJob(req, job.id, { ...job, folder_url: shareLink }).catch(e =>
        console.warn('[jobs workdrive-folder] could not persist share link:', e.message)
      )
      return shareLink
    }

    // 1. Already have a public share link — return it immediately
    if (job.folder_url && job.folder_url.includes('zohoexternal.com')) {
      return res.json({ folderUrl: job.folder_url })
    }

    // 2. Have an internal folder URL — extract ID and create a public share link
    if (job.folder_url) {
      const m = job.folder_url.match(/\/folders?\/([a-z0-9]+)/i)
      if (m) {
        const shareLink = await resolvePublicLink(m[1], null)
        return res.json({ folderUrl: shareLink })
      }
    }

    // 3. No URL — search WorkDrive by RO number
    const roNumber = job.invoice_number || job.quote_number
    if (roNumber) {
      const found = await findFolderByRO(roNumber, wdToken)
      if (found) {
        const shareLink = await resolvePublicLink(found.folderId, found.folderName)
        return res.json({ folderUrl: shareLink, folderName: found.folderName })
      }
    }

    // 4. Fallback — search by shop name + vehicle
    const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
    const found = await findFolderByShopVehicle(job.shop_name, vehicle, wdToken)
    if (found) {
      const shareLink = await resolvePublicLink(found.folderId, found.folderName)
      return res.json({ folderUrl: shareLink, folderName: found.folderName })
    }

    res.status(404).json({ error: `No WorkDrive folder found for "${job.shop_name || 'this job'}". The folder may not have been created yet.` })
  } catch (err) {
    console.error('[jobs workdrive-folder]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/jobs/:id/photos — upload one or more photos to the job's WorkDrive folder.
// Accepts multipart/form-data with field name "photos" (multiple files allowed).
// If the job has no folder_url, it is looked up via WorkDrive (by RO number or shop/vehicle)
// and the discovered URL is saved back to the job row so future uploads skip the search.
router.post('/:id/photos', upload.array('photos', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded. Send files in the "photos" field.' })
    }

    const table = getTable(req)
    const row = await table.getRow(req.params.id)
    const job = rowToJob(row)

    // ── Resolve folder ID ───────────────────────────────────────────────────
    // folder_url may be a zohoexternal.com share link (no folder ID in URL)
    // or an internal workdrive.zoho.com/folder/xxx URL (has folder ID).
    // Always need the actual folder ID to upload files.
    let folderUrl = job.folder_url
    let folderId = null

    if (folderUrl) {
      // Internal URL — folder ID is embedded
      const m = folderUrl.match(/\/folders?\/([a-z0-9]+)/i)
      if (m) folderId = m[1]
      // zohoexternal.com share link — no folder ID in URL, must search
    }

    if (!folderId) {
      const wdToken = await getAccessToken()
      const roNumber = job.invoice_number || job.quote_number
      let found = null

      if (roNumber) found = await findFolderByRO(roNumber, wdToken)
      if (!found) {
        const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
        found = await findFolderByShopVehicle(job.shop_name, vehicle, wdToken)
      }

      if (!found) {
        return res.status(404).json({
          error: `No WorkDrive folder found for this job. Open WorkDrive first to locate and link the folder.`,
        })
      }

      folderId = found.folderId
      // Only overwrite folder_url if we don't already have a public share link
      if (!folderUrl || !folderUrl.includes('zohoexternal.com')) {
        folderUrl = `https://workdrive.zoho.com/folder/${folderId}`
        updateJob(req, job.id, { ...job, folder_url: folderUrl }).catch(e =>
          console.warn('[jobs photos] could not persist folder_url:', e.message)
        )
      }
    }

    // ── Upload each file ────────────────────────────────────────────────────
    const wdToken = await getAccessToken()
    const uploaded = []
    const errors = []

    for (const file of req.files) {
      try {
        const result = await uploadFileToFolder(folderId, file.originalname, file.buffer, wdToken, file.mimetype)
        uploaded.push({ filename: file.originalname, fileId: result.fileId })
      } catch (e) {
        console.error(`[jobs photos] upload failed for "${file.originalname}":`, e.message)
        errors.push({ filename: file.originalname, error: e.message })
      }
    }

    if (uploaded.length === 0) {
      return res.status(500).json({ error: 'All uploads failed.', errors })
    }

    res.json({ uploaded, errors, folderUrl })
  } catch (err) {
    console.error('[jobs photos]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/jobs/:id/upload-photo
// Uploads a single file to the job's WorkDrive folder (found by RO number or shop/vehicle)
const uploadSingle = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }).single('file')
router.post('/:id/upload-photo', (req, res) => {
  uploadSingle(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'No file provided' })

    try {
      const jobId = req.params.id
      const table = getTable(req)
      const row = await table.getRow(jobId)
      if (!row) return res.status(404).json({ error: 'Job not found' })
      const job = rowToJob(row)

      // ── Resolve folder ─────────────────────────────────────────────────────
      let folderId = null

      if (job.folder_url) {
        const m = job.folder_url.match(/\/folders?\/([a-z0-9]+)/i)
        if (m) folderId = m[1]
      }

      if (!folderId) {
        const wdToken = await getAccessToken()
        const roNumber = job.invoice_number || job.quote_number
        let found = null

        if (roNumber) {
          found = await findFolderByRO(roNumber, wdToken)
        }
        if (!found) {
          const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
          found = await findFolderByShopVehicle(job.shop_name, vehicle, wdToken)
        }

        if (!found) {
          return res.status(404).json({ error: 'Could not find WorkDrive folder for this job. Make sure the RO number matches the folder name.' })
        }

        folderId = found.folderId
        const folderUrl = `https://workdrive.zoho.com/folder/${folderId}`
        updateJob(req, job.id, { ...job, folder_url: folderUrl }).catch(e =>
          console.warn('[upload-photo] could not persist folder_url:', e.message)
        )
      }

      const wdToken = await getAccessToken()
      const filename = req.file.originalname || `upload-${Date.now()}`
      await uploadFileToFolder(folderId, filename, req.file.buffer, wdToken, req.file.mimetype)

      res.json({ ok: true, filename })
    } catch (e) {
      console.error('[upload-photo]', e.message)
      res.status(500).json({ error: e.message })
    }
  })
})

// POST /api/jobs/:id/refresh-share-link
// Generates a fresh public WorkDrive share link for an existing folder and updates
// both the job record AND the linked Zoho Books estimate custom field.
router.post('/:id/refresh-share-link', async (req, res) => {
  try {
    const table = getTable(req)
    const row = await table.getRow(req.params.id)
    const job = rowToJob(row)

    // Extract the WorkDrive folder ID from whatever URL we have stored
    const folderIdMatch = (job.folder_url || '').match(/\/folders?\/([a-z0-9]+)/i)
    if (!folderIdMatch) {
      return res.status(400).json({
        error: 'No WorkDrive folder ID found on this job. The folder may not have been created yet — create a new estimate to generate one.',
      })
    }
    const folderId = folderIdMatch[1]

    // Build a folder label from job data (same pattern as createDraftQuote)
    const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
    const folderLabel = [job.invoice_number || job.quote_number, job.shop_name, vehicle]
      .filter(Boolean).join(' — ') || `Job ${job.id}`

    // Generate a fresh external share link
    const token = await getAccessToken()
    const shareLink = await createShareLink(folderId, folderLabel, token)

    // Persist the new public URL on the job
    const updated = await updateJob(req, job.id, { ...job, folder_url: shareLink })

    // Also update the Zoho Books estimate custom field if we have one
    if (job.zoho_estimate_id) {
      try {
        await updateEstimateShareLink(job.zoho_estimate_id, shareLink)
        console.log(`[refresh-share-link] Updated estimate ${job.zoho_estimate_id} with new link`)
      } catch (e) {
        console.warn('[refresh-share-link] Could not update Zoho Books estimate (non-fatal):', e.message)
      }
    }

    res.json({ ok: true, shareLink, job: updated })
  } catch (err) {
    console.error('[refresh-share-link]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── Exports for webhook.js ───────────────────────────────────────────────────
export { getAllJobs as readJobsPublic, updateJob as updateJobPublic }
export default router
