import express from 'express'
import multer from 'multer'
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { listAllEstimates, getEstimateLineItems, getAccessToken, updateEstimateShareLink, updateEstimateSalesperson } from '../services/zoho.js'
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

// ─── Notification helpers ─────────────────────────────────────────────────────

// "Needs Dispatch" — fires when a job lands in need_dispatch.
// Goes to both dispatchers (Mark + Kat) and the #technicians channel (posted once).
async function notifyNeedsDispatch(req, job) {
  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  const roNum = job.quote_number || (job.notes || '').match(/RO#[:\s]*([^\s|,]+)/i)?.[1] || ''
  const title = `New job to dispatch: ${job.shop_name || 'Unknown shop'}`
  const body = `${vehicle || 'Vehicle TBD'}${roNum ? ' · RO# ' + roNum : ''}`
  // Mark — also posts the message to #technicians
  await createNotification(req, {
    to: 'Mark', toEmail: 'mf@absoluteadas.com',
    type: 'needs_dispatch', title, body, jobId: job.id, job,
  }).catch(e => console.warn('[notif needs_dispatch/Mark]', e.message))
  // Kat — skip #technicians so the channel isn't double-posted
  await createNotification(req, {
    to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com',
    type: 'needs_dispatch', title, body, jobId: job.id, job, skipTechChannel: true,
  }).catch(e => console.warn('[notif needs_dispatch/Kat]', e.message))
}

// When a job's technician is reassigned, push it to the linked Zoho estimate's
// salesperson field. Awaited (Catalyst kills fire-and-forget) but errors are
// swallowed so a Zoho hiccup never fails the job update.
async function syncTechnicianToZoho(job, techName) {
  if (!job?.zoho_estimate_id || !techName) return
  await updateEstimateSalesperson(job.zoho_estimate_id, techName)
    .then(() => console.log(`[zoho-sync] Estimate ${job.zoho_estimate_id} salesperson → ${techName}`))
    .catch(e => console.warn('[zoho-sync] salesperson update failed (non-fatal):', e.message))
}

// "Job Dispatched" — fires when a tech is assigned.
// Goes to the assigned tech (DM) + the #technicians channel.
async function notifyJobDispatched(req, job) {
  if (!job.technician) return
  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  await createNotification(req, {
    to: job.technician, toEmail: '',
    type: 'job_dispatched',
    title: `Job dispatched to ${job.technician}: ${job.shop_name || 'New job'}`,
    body: `${vehicle || 'Vehicle TBD'} — ${job.shop_name || 'Unknown shop'}${job.scheduled_date ? ' on ' + job.scheduled_date : ''}`,
    jobId: job.id, job,
  }).catch(e => console.warn('[notif job_dispatched]', e.message))
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

    // Notify dispatchers (Mark + Kat) + #technicians when a new job arrives at need_dispatch
    // (covers: Upload Report → Create Zoho Invoice, ManualQuoteScreen, any other direct job creation)
    if (!req.body.via_request && (newJob.status === 'need_dispatch' || (!newJob.status && req.body.status === 'need_dispatch'))) {
      await notifyNeedsDispatch(req, newJob)
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
      // Invoice notifications come solely from the Zoho Books webhook — see webhook.js
    }

    // Notify dispatchers when a job lands in need_dispatch
    if (updated.status === 'need_dispatch' && prevStatus !== 'need_dispatch') {
      await notifyNeedsDispatch(req, updated)
    }

    // Notify the assigned tech + #technicians when a job is dispatched (tech assigned)
    const newTech = updated.technician
    const techChanged = newTech && newTech !== prevTech
    const statusBecameDispatched = /^dispatched_/.test(updated.status || '') && !/^dispatched_/.test(prevStatus || '')
    if (newTech && (techChanged || statusBecameDispatched)) {
      await notifyJobDispatched(req, updated)
    }
    // Keep the linked Zoho estimate's salesperson in sync with the technician
    if (techChanged) {
      await syncTechnicianToZoho(updated, newTech)
    }

    // Notify Kat when a job moves to ready_invoice
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

    // Auto-status-move: if technician is newly assigned (or changed) and the
    // request did NOT explicitly set status, derive the dispatched_* column.
    // Lets dispatch reassign jobs from the new map view without separately
    // dragging the Kanban card.
    if (req.body.technician !== undefined && req.body.technician && req.body.status === undefined) {
      const nt = (req.body.technician || '').toLowerCase()
      const ot = (currentJob.technician || '').toLowerCase()
      if (nt !== ot) {
        if (nt.includes('jayden') || nt.includes('jaden'))      req.body.status = 'dispatched_jaden'
        else if (nt.includes('mark'))                            req.body.status = 'dispatched_mark'
      }
    }

    const merged = { ...currentJob, ...req.body }
    const updated = await updateJob(req, req.params.id, merged)

    if (req.body.status === 'complete' && currentJob.status !== 'complete') {
      logCompletion(req, updated).catch(e => console.warn('[completions]', e.message))
      logJobHistory(req, updated, 'complete')
    }
    if (req.body.invoiced === true && !currentJob.invoiced) {
      logJobHistory(req, updated, 'invoiced')
      // Invoice notifications come solely from the Zoho Books webhook — see webhook.js
    }

    // Notify dispatchers when a job lands in need_dispatch
    if (updated.status === 'need_dispatch' && currentJob.status !== 'need_dispatch') {
      await notifyNeedsDispatch(req, updated)
    }

    // Notify the assigned tech + #technicians when a job is dispatched (tech assigned)
    const newTech = updated.technician
    const techChanged = newTech && newTech !== currentJob.technician
    const statusBecameDispatched = /^dispatched_/.test(updated.status || '') && !/^dispatched_/.test(currentJob.status || '')
    if (newTech && (techChanged || statusBecameDispatched)) {
      await notifyJobDispatched(req, updated)
    }
    // Keep the linked Zoho estimate's salesperson in sync with the technician
    if (techChanged) {
      await syncTechnicianToZoho(updated, newTech)
    }
    // Recompute drive_order for BOTH the new tech's day and the old tech's day
    // (the old tech now has one fewer stop, so their route shrinks).
    if (techChanged && updated.scheduled_date) {
      try {
        const { recomputeDayForTech, isAssignedTo, readJobState, mergeJobState } = await import('../services/dispatch.js')
        const all = await getAllJobs(req)
        const stateMap = await readJobState(req)
        const dayJobsForTech = (tech) => all
          .filter(j => isAssignedTo(j, tech))
          .filter(j => (j.scheduled_date || '') === updated.scheduled_date)
          .map(j => mergeJobState(j, stateMap))
        await recomputeDayForTech(req, newTech, updated.scheduled_date, dayJobsForTech(newTech))
        if (currentJob.technician && currentJob.technician !== newTech) {
          await recomputeDayForTech(req, currentJob.technician, updated.scheduled_date, dayJobsForTech(currentJob.technician))
        }
      } catch (e) {
        console.warn('[jobs PATCH] drive_order recompute on reassign failed (non-fatal):', e.message)
      }
    }

    // Notify Kat when a job moves to ready_invoice
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

// ─── Field-state routes (dispatch map / tech today) ─────────────────────────
//
// These store per-job timestamps and derived fields (drive_order, time windows,
// en_route_at, started_at, completed_at) in the absolute_adas_job_state cache
// instead of the Jobs Datastore table so the feature works without a schema
// migration. See services/dispatch.js + docs/dispatch-map-setup.md.

// PATCH /api/jobs/:id/en-route — tech tapped "Navigate". No Cliq noise.
router.patch('/:id/en-route', async (req, res) => {
  try {
    const { updateJobStateFields } = await import('../services/dispatch.js')
    const state = await updateJobStateFields(req, req.params.id, { en_route_at: new Date().toISOString() })
    res.json({ ok: true, job_id: String(req.params.id), state })
  } catch (err) {
    console.error('[jobs en-route]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/jobs/:id/start — tech tapped "Start Job". No Cliq noise.
router.patch('/:id/start', async (req, res) => {
  try {
    const { updateJobStateFields } = await import('../services/dispatch.js')
    const state = await updateJobStateFields(req, req.params.id, { started_at: new Date().toISOString() })
    res.json({ ok: true, job_id: String(req.params.id), state })
  } catch (err) {
    console.error('[jobs start]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/jobs/:id/complete — tech finished. Sets completed_at, optionally
// updates calibrations (from the Calibration Review Modal), moves status to
// ready_invoice. The existing ready_invoice → Kat notification fires from the
// PATCH /:id handler chain. Then recomputes remaining drive_order for the
// tech's day so the next card surfaces.
router.patch('/:id/complete', async (req, res) => {
  try {
    const { updateJobStateFields, recomputeDayForTech, isAssignedTo, readJobState, mergeJobState } = await import('../services/dispatch.js')
    const jobId = String(req.params.id)

    // 1) Stamp completed_at
    await updateJobStateFields(req, jobId, { completed_at: new Date().toISOString() })

    // 2) Move job to ready_invoice (and optionally update calibrations) via the
    // existing updateJob path so all existing notifications fire normally.
    const current = rowToJob(await getTable(req).getRow(jobId))
    const patch = { status: 'ready_invoice' }
    if (req.body?.calibrations !== undefined) {
      patch.calibrations = typeof req.body.calibrations === 'string'
        ? req.body.calibrations
        : JSON.stringify(req.body.calibrations || [])
    }
    const merged = { ...current, ...patch }
    const updated = await updateJob(req, jobId, merged)

    // Fire the existing Kat notification (mirrors PATCH /:id ready_invoice branch)
    if (current.status !== 'ready_invoice') {
      await createNotification(req, {
        to: 'Kath',
        toEmail: 'k.belmonte@absoluteadas.com',
        type: 'job_ready_invoice',
        title: `Ready to invoice: ${updated.shop_name || 'Job'}`,
        body: '',
        jobId: updated.id,
        job: updated,
      }).catch(e => console.warn('[notifications complete]', e.message))
    }

    // 3) Recompute remaining drive_order for this tech's day
    if (updated.technician && updated.scheduled_date) {
      try {
        const allJobs = await getAllJobs(req)
        const stateMap = await readJobState(req)
        const techJobs = allJobs
          .filter(j => isAssignedTo(j, updated.technician))
          .filter(j => (j.scheduled_date || '') === updated.scheduled_date)
          .map(j => mergeJobState(j, stateMap))
        await recomputeDayForTech(req, updated.technician, updated.scheduled_date, techJobs)
      } catch (e) {
        console.warn('[jobs complete] recompute failed (non-fatal):', e.message)
      }
    }

    res.json({ ok: true, job: updated })
  } catch (err) {
    console.error('[jobs complete]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/jobs/:id/running-late — tech pings Kat with a delay note
router.post('/:id/running-late', async (req, res) => {
  try {
    const { postToCliqUser, TECH_CLIQ_IDS } = await import('../services/cliq.js')
    const jobId = String(req.params.id)
    const current = rowToJob(await getTable(req).getRow(jobId))
    const delayMin = Number(req.body?.delay_min || 0) || 0
    const note = (req.body?.note || '').toString().slice(0, 280)

    const vehicle = current.vehicle || [current.year, current.make, current.model].filter(Boolean).join(' ')
    const msg = [
      `⏰ *Running late: ${current.shop_name || 'Job'}*`,
      vehicle ? `🚗 ${vehicle}` : null,
      current.technician ? `👤 ${current.technician}` : null,
      delayMin ? `⌛ ~${delayMin} min late` : '⌛ Running behind',
      note ? `📝 ${note}` : null,
    ].filter(Boolean).join('\n')

    const katId = TECH_CLIQ_IDS.Kat || TECH_CLIQ_IDS.Kath
    if (katId) await postToCliqUser(katId, msg).catch(e => console.warn('[running-late cliq]', e.message))

    res.json({ ok: true })
  } catch (err) {
    console.error('[jobs running-late]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/jobs/:id/cant-access — tech can't access the vehicle, pings Kat
router.post('/:id/cant-access', async (req, res) => {
  try {
    const { postToCliqUser, TECH_CLIQ_IDS } = await import('../services/cliq.js')
    const jobId = String(req.params.id)
    const current = rowToJob(await getTable(req).getRow(jobId))
    const note = (req.body?.note || '').toString().slice(0, 280)

    const vehicle = current.vehicle || [current.year, current.make, current.model].filter(Boolean).join(' ')
    const msg = [
      `🚫 *Can't access vehicle: ${current.shop_name || 'Job'}*`,
      vehicle ? `🚗 ${vehicle}` : null,
      current.technician ? `👤 ${current.technician}` : null,
      note ? `📝 ${note}` : null,
    ].filter(Boolean).join('\n')

    const katId = TECH_CLIQ_IDS.Kat || TECH_CLIQ_IDS.Kath
    if (katId) await postToCliqUser(katId, msg).catch(e => console.warn('[cant-access cliq]', e.message))

    res.json({ ok: true })
  } catch (err) {
    console.error('[jobs cant-access]', err.message)
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

    // Notify dispatchers (Mark + Kat) + #technicians that a new job is ready to dispatch
    try {
      await notifyNeedsDispatch(req, { ...newJob, vehicle })
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

// GET /api/jobs/top-calibrations — top calibrations for the Review modal quick-add chips.
//
// Source of truth: Zoho Books "Sales Invoice by Product" report (ordered by sales value).
// These are the exact Zoho item names so they match cleanly when an invoice is created.
// Skipped: PCSI / Post Collision Safety Inspection 1 (always-included badge),
//          POST / Post-Scan (always-included badge), -No Value-, Diagnostic 1 (not a calibration).
const TOP_CALIBRATIONS = [
  'Front Windshield Calibration',
  'Front Radar (ACC) - Static',
  'Around View Camera Calibration (AVC) - Static',
  'Blind Spot Calibration (BS)',
  'SFP - 3A Static Calibrations - (All others)',
  'Front Radar Calibration',
  'Park Distance Sensor - Static (PSC)',
  'Front Radar (ACC) - Dynamic',
  'Around View Calibration (AVC) - Dynamic',
  'Rear Blind Spot Radar (BSR)',
  'Steering Angle Sensor',
  'SFP - Level 2 - Dynamic Calibrations',
]

router.get('/top-calibrations', async (req, res) => {
  try {
    res.json({
      ok: true,
      calibrations: TOP_CALIBRATIONS.map(name => ({ name })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

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
