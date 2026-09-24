import express from 'express'
import multer from 'multer'
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { listAllEstimates, getEstimateLineItems, getAccessToken, updateEstimateShareLink, updateEstimateSalesperson } from '../services/zoho.js'
import { createNotification } from './notifications.js'
import { postToCliqChannel, AA_JOBS_CHANNEL, DISPATCH_CHANNEL } from '../services/cliq.js'
import { uploadFileToFolder, findFolderByRO, findFolderByShopVehicle, createShareLink, createJobFolder, listChildren } from '../services/workdrive.js'
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

// Extra-services piggyback marker. Extras added by the Live Day
// Ready-to-Invoice modal live inside `notes` between these markers so
// no Catalyst Datastore column change is required. Parse out for display
// and Cliq alerts; keep the raw block hidden from techs typing regular
// notes.
const EXTRA_START = '<<EXTRAS>>'
const EXTRA_END   = '<</EXTRAS>>'
const EXTRA_RE = new RegExp(`\\n*${EXTRA_START}([\\s\\S]*?)${EXTRA_END}\\n*`, 'g')

// 🤝 Price talked on site (Mark 2026-09-22) rides in notes the same way —
// {amount, with, note, by, at} — so no schema change; Bill it reads it.
const AGREED_START = '<<AGREED>>'
const AGREED_END   = '<</AGREED>>'
const AGREED_RE = new RegExp(`\\n*${AGREED_START}([\\s\\S]*?)${AGREED_END}\\n*`, 'g')
// <<CUST>> — who the job is for, from the tech's request (Phase C, 2026-09-22):
// { kind: 'shop'|'retail', id (retail customer id), name, zoho_contact_id }
const CUST_START = '<<CUST>>'
const CUST_END   = '<</CUST>>'
const CUST_RE = new RegExp(`\\n*${CUST_START}([\\s\\S]*?)${CUST_END}\\n*`, 'g')

function splitNotes(rawNotes) {
  const raw = String(rawNotes || '')
  let extras = '', agreed = null
  const m = raw.match(new RegExp(`${EXTRA_START}([\\s\\S]*?)${EXTRA_END}`))
  if (m) extras = m[1].trim()
  const a = raw.match(new RegExp(`${AGREED_START}([\\s\\S]*?)${AGREED_END}`))
  if (a) { try { agreed = JSON.parse(a[1]) } catch { agreed = null } }
  let customer = null
  const c = raw.match(new RegExp(`${CUST_START}([\\s\\S]*?)${CUST_END}`))
  if (c) { try { customer = JSON.parse(c[1]) } catch { customer = null } }
  const cleanNotes = raw.replace(EXTRA_RE, '').replace(AGREED_RE, '').replace(CUST_RE, '').trim()
  return { cleanNotes, extras, agreed, customer }
}

function joinNotes(cleanNotes, extras, agreed = null, customer = null) {
  const base = String(cleanNotes || '').trim()
  const ex = String(extras || '').trim()
  const parts = [base]
  if (ex) parts.push(`${EXTRA_START}${ex}${EXTRA_END}`)
  if (customer && (customer.kind === 'retail' || customer.kind === 'shop')) parts.push(`${CUST_START}${JSON.stringify({ kind: customer.kind, id: String(customer.id || '').slice(0, 40), name: String(customer.name || '').slice(0, 120), zoho_contact_id: String(customer.zoho_contact_id || '').slice(0, 40) })}${CUST_END}`)
  if (agreed && Number(agreed.amount) > 0) parts.push(`${AGREED_START}${JSON.stringify({ amount: Math.round(Number(agreed.amount) * 100) / 100, with: String(agreed.with || '').slice(0, 60), note: String(agreed.note || '').slice(0, 200), by: String(agreed.by || '').slice(0, 40), at: agreed.at || new Date().toISOString() })}${AGREED_END}`)
  return parts.filter(Boolean).join('\n\n')
}

function rowToJob(row) {
  const { cleanNotes, extras, agreed, customer } = splitNotes(row.notes)
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
    notes:            cleanNotes,
    extra_services:   extras,
    agreed_price:     agreed,
    customer:         customer,
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
    photo_slots:      row.photo_slots      || '',
    odo_before:       row.odo_before       || '',
    odo_after:        row.odo_after        || '',
    request_type:     row.request_type     || '',   // 'quote' | 'job' | '' (Mark 2026-09-10: Quotes Requested column)
    extra_items:      row.extra_items      || '',   // JSON [{item_id,name,rate,quantity,note}] added by the tech at Ready to Invoice
    billed_via_app:   row.billed_via_app   || '',   // '💸 Bill it' stamp: "<who> <when>"
    cash_quoted:      row.cash_quoted      || '',   // customer-pay number the customer was told (350 / 700)
    tires_set:        row.tires_set        || '',   // "36F/36R psi · tech · when"
    pcsi_checks:      row.pcsi_checks      || '',   // JSON {belts, airbags, front, rear, windshield, by, at}
  }
}

function jobToRow(job) {
  // Only include columns that exist in the Catalyst Datastore Jobs table schema.
  // Do not spread unknown/new fields — Catalyst returns an error for unknown column names.
  // extra_services piggybacks inside `notes` via joinNotes so no schema change
  // is required.
  const cleanNotes = String(job.notes || '').replace(EXTRA_RE, '').replace(AGREED_RE, '').replace(CUST_RE, '').trim()
  // agreed_price / customer: null clears; undefined keeps whatever the notes already carry.
  const carried = splitNotes(job.notes)
  const keep = job.agreed_price === undefined ? carried.agreed : job.agreed_price
  const keepCust = job.customer === undefined ? carried.customer : job.customer
  const notesWithExtras = joinNotes(cleanNotes, job.extra_services, keep, keepCust)
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
    notes:            notesWithExtras,
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
    photo_slots:      typeof job.photo_slots === 'string' ? job.photo_slots : (job.photo_slots ? JSON.stringify(job.photo_slots) : ''),
    odo_before:       String(job.odo_before ?? '').slice(0, 20),
    odo_after:        String(job.odo_after ?? '').slice(0, 20),
    request_type:     (job.status || 'need_dispatch') === 'job_requested' ? String(job.request_type || '').slice(0, 10) : '',
    extra_items:      typeof job.extra_items === 'string' ? job.extra_items : (job.extra_items ? JSON.stringify(job.extra_items) : ''),
    billed_via_app:   String(job.billed_via_app || '').slice(0, 40),
    cash_quoted:      String(job.cash_quoted || '').slice(0, 20),
    tires_set:        String(job.tires_set || '').slice(0, 120),
    pcsi_checks:      String(job.pcsi_checks || '').slice(0, 255),
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
//
// All job-flow Cliq notifications (requested / needs-dispatch / dispatched /
// ready-invoice) fan into the shared #aajobs channel instead of DMing Mark,
// Kat, or Jayden individually. One channel, everyone subscribed, no missed
// DMs when someone is head-down on something else. Set on 2026-07-06 —
// prior model was per-recipient DMs (see git history / CLAUDE.md).
//
// In-app + email notifications are NOT deleted — they still fire through
// createNotification so the /notifications bell inbox stays populated.

// "Needs Dispatch" — fires when a job lands in need_dispatch. Posts to
// #aajobs channel + writes a bell inbox row. No more Mark/Kat DMs.
async function notifyNeedsDispatch(req, job) {
  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  const roNum = job.quote_number || (job.notes || '').match(/RO#[:\s]*([^\s|,]+)/i)?.[1] || ''
  const shop = job.shop_name || 'Unknown shop'
  const scheduled = job.scheduled_date ? ` · 📅 ${job.scheduled_date}` : ''

  const tesla = isTeslaJob(job)
  const msg = [
    `📋 *${tesla ? '⚡ TESLA · ' : ''}Needs Dispatch* · ${shop}`,
    `${vehicle || 'Vehicle TBD'}${roNum ? ' · RO# ' + roNum : ''}${scheduled}`,
    tesla ? `⚡ TESLA — use Tesla pricing.` : null,
  ].filter(Boolean).join('\n')
  await postToCliqChannel(AA_JOBS_CHANNEL, msg)
    .catch(e => console.warn('[aajobs needs_dispatch]', e.message))

  // Silent bell-inbox row for Mark + Kat so the /notifications feed still shows
  // it. skipCliq flag tells createNotification not to also post a duplicate Cliq
  // DM/channel — Cliq is handled above via the channel post.
  const title = `New job to dispatch: ${shop}`
  const body = `${vehicle || 'Vehicle TBD'}${roNum ? ' · RO# ' + roNum : ''}`
  await createNotification(req, {
    to: 'Mark', toEmail: 'mf@absoluteadas.com',
    type: 'needs_dispatch', title, body, jobId: job.id, job,
    skipCliq: true, skipTechChannel: true,
  }).catch(e => console.warn('[notif needs_dispatch/Mark inbox]', e.message))
  await createNotification(req, {
    to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com',
    type: 'needs_dispatch', title, body, jobId: job.id, job,
    skipCliq: true, skipTechChannel: true,
  }).catch(e => console.warn('[notif needs_dispatch/Kat inbox]', e.message))
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
// On cash-customer jobs we prepend "💵 CASH" to the title so the tech
// knows before rolling up not to promise extras and to expect the
// $700-cap invoice.
async function notifyJobDispatched(req, job, prevTech = '') {
  if (!job.technician) return
  // 📲 Text the tech's cell (Mark 2026-09-23) — awaited, Catalyst freezes after the response.
  try { const { sendTechAssignmentText } = await import('../services/techAssignText.js'); await sendTechAssignmentText(req, job, prevTech) } catch (e) { console.warn('[assign-sms]', e.message) }
  const { isCashCustomer, CASH_MAX_OUT_OF_POCKET } = await import('../services/cashPricing.js')
  const isCash = isCashCustomer(job)
  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  const roNum = job.quote_number || (job.notes || '').match(/RO#[:\s]*([^\s|,]+)/i)?.[1] || ''
  const shop = job.shop_name || 'Unknown shop'
  const scheduled = job.scheduled_date ? ` · 📅 ${job.scheduled_date}` : ''
  const cashTag = isCash ? '💵 CASH · ' : ''
  const tesla = isTeslaJob(job)
  const teslaTag = tesla ? '⚡ TESLA · ' : ''

  const msg = [
    `🚐 *${teslaTag}${cashTag}Dispatched to ${job.technician}* · ${shop}`,
    `${vehicle || 'Vehicle TBD'}${roNum ? ' · RO# ' + roNum : ''}${scheduled}`,
    tesla ? `⚡ TESLA — use Tesla pricing.` : null,
    isCash ? `💵 CASH — CP pricing, max $${CASH_MAX_OUT_OF_POCKET} out of pocket.` : null,
  ].filter(Boolean).join('\n')
  await postToCliqChannel(AA_JOBS_CHANNEL, msg)
    .catch(e => console.warn('[aajobs job_dispatched]', e.message))

  // Silent inbox row for the tech so the bell feed still shows it — no Cliq DM.
  const cashBody = isCash ? `\n\n💵 CASH CUSTOMER — max $${CASH_MAX_OUT_OF_POCKET} out of pocket.` : ''
  await createNotification(req, {
    to: job.technician, toEmail: '',
    type: 'job_dispatched',
    title: `${teslaTag}${cashTag}Job dispatched to ${job.technician}: ${shop}`,
    body: `${vehicle || 'Vehicle TBD'} — ${shop}${job.scheduled_date ? ' on ' + job.scheduled_date : ''}${cashBody}`,
    jobId: job.id, job,
    skipCliq: true, skipTechChannel: true,
  }).catch(e => console.warn('[notif job_dispatched inbox]', e.message))
}

// Cash-customer reminder to Kat when a job hits ready_invoice. Fires
// alongside the existing job_ready_invoice notification — the extra DM
// gives Kat a scannable zeroing checklist so PCSI / Post Scan / Calibration
// ID cost don't sneak onto a cash invoice. Idempotent-ish (fires on every
// status→ready_invoice transition; downstream ready_invoice notification
// handles the once-per-job dedup).
async function notifyReadyToInvoiceCash(req, job) {
  const { isCashCustomer, summarizeCashPricing, CASH_MAX_OUT_OF_POCKET } = await import('../services/cashPricing.js')
  if (!isCashCustomer(job)) return
  let cals = []
  try {
    cals = typeof job.calibrations === 'string' ? JSON.parse(job.calibrations || '[]') : (job.calibrations || [])
  } catch { cals = [] }
  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  const roNum = job.quote_number || (job.notes || '').match(/RO#[:\s]*([^\s|,]+)/i)?.[1] || ''
  const msg = [
    `💵 *CASH CUSTOMER — Ready to Invoice*`,
    `${job.shop_name || 'Job'}${vehicle ? ' · ' + vehicle : ''}${roNum ? ' · RO# ' + roNum : ''}`,
    `Price it on the 💵 Cash (CP) schedule — the app caps the total at $${CASH_MAX_OUT_OF_POCKET} automatically.`,
    `📋 ${summarizeCashPricing(cals)}`,
  ].join('\n')
  try { await postToCliqChannel(AA_JOBS_CHANNEL, msg) }
  catch (e) { console.warn('[aajobs ready_invoice cash]', e.message) }
}

// Tesla jobs bill on Tesla pricing (Mark 2026-07-10). Matches on the
// make OR the combined vehicle string so imports that only fill
// `vehicle` still trigger.
export function isTeslaJob(job) {
  if (!job) return false
  return /tesla/i.test(String(job.make || '')) || /tesla/i.test(String(job.vehicle || ''))
}

// Tesla-pricing reminder to Kat when a Tesla hits ready_invoice — same
// fire-alongside pattern as the cash reminder above.
async function notifyReadyToInvoiceTesla(req, job) {
  if (!isTeslaJob(job)) return
  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  const roNum = job.quote_number || (job.notes || '').match(/RO#[:\s]*([^\s|,]+)/i)?.[1] || ''
  const msg = [
    `⚡ *TESLA — Ready to Invoice*`,
    `${job.shop_name || 'Job'}${vehicle ? ' · ' + vehicle : ''}${roNum ? ' · RO# ' + roNum : ''}`,
    `⚠️ *Use TESLA PRICING on this invoice.*`,
  ].join('\n')
  try { await postToCliqChannel(AA_JOBS_CHANNEL, msg) }
  catch (e) { console.warn('[aajobs ready_invoice tesla]', e.message) }
}

// Auto-dispatch (Mark 2026-07-24): a job created WITH a technician goes
// straight into that tech's dispatched column — "Needs Dispatch" is
// only for genuinely unassigned work. Matches full Zoho names too
// ("Jayden Goshorn", "Mark Fowler"/"Mark Folwer"). Unknown names (Kat,
// blank) return null → normal unassigned flow.
function dispatchedStatusFor(technician) {
  const t = String(technician || '').toLowerCase().trim()
  if (t.startsWith('jay')) return 'dispatched_jaden'
  if (t.startsWith('mark')) return 'dispatched_mark'
  return null
}

// Parts-waiting notice to #aajobs (Mark 2026-07-13): when a job moves
// into Pending/Waiting-on-Parts — shop, year make model, and the move.
async function notifyPartsWaiting(req, job) {
  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  const msg = [
    `⏳ *Moved to Parts Waiting* · ${job.shop_name || 'Job'}`,
    `🚗 ${vehicle || 'Vehicle TBD'}`,
  ].join('\n')
  try { await postToCliqChannel(AA_JOBS_CHANNEL, msg) }
  catch (e) { console.warn('[aajobs parts_waiting]', e.message) }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/jobs/clean-invoiced — bulk-remove every already-invoiced
// job from the board (Mark 2026-07-11). One-click cleanup for leftovers
// from before the Books webhook started auto-deleting on invoice-sent.
// Capped per call to stay well inside the 30s gateway limit; the
// response says how many remain so the UI can offer another pass.
router.post('/clean-invoiced', async (req, res) => {
  try {
    const jobs = await getAllJobs(req)
    // Scope: invoiced jobs IN THE COMPLETED COLUMN only (Mark
    // 2026-07-12) — an invoiced job still sitting in another column is
    // there for a reason and stays put.
    const targets = jobs.filter(j => j.invoiced === true && j.status === 'complete')
    const batch = targets.slice(0, 100)
    let removed = 0
    for (const j of batch) {
      try { await deleteJob(req, j.id); removed++ }
      catch (e) { console.warn('[clean-invoiced] delete failed', j.id, e.message) }
    }
    res.json({ ok: true, removed, remaining: targets.length - removed })
  } catch (err) {
    console.error('[clean-invoiced]', err.message)
    res.status(500).json({ error: err.message })
  }
})

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
    // ⏱ The board is the app's heartbeat — it carries the 15-minute email
    // intake, because GitHub drops most of its scheduled runs (2026-09-24).
    try { const { maybeSelfTick } = await import('../services/selfTick.js'); await maybeSelfTick(req) } catch { /* never block the board */ }
    res.json(jobs)
  } catch (err) {
    console.error('[jobs GET]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/jobs
// Which Waiting-for-Kat request is this report for? Exactly one confident
// hit or null — a wrong merge is worse than a duplicate card.
async function findOpenRequestFor(req, body) {
  const all = (await getAllJobs(req)).filter(j => (j.status || '') === 'job_requested')
  if (!all.length) return null
  const digits = s => { const d = (String(s || '').match(/\d{4,}/) || [''])[0]; return /^(19[89]\d|20[0-3]\d)$/.test(d) ? '' : d }   // a model year is not an RO
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const vin = String(body.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const ro = digits(body.invoice_number) || digits(body.quote_number) || digits(body.ro_number) || digits((body.notes || '').match(/RO#?\s*([\w-]+)/i)?.[1])
  const shop = norm(body.shop_name)
  const veh = norm(body.vehicle || [body.year, body.make, body.model].filter(Boolean).join(' '))
  const one = (list, via) => (list.length === 1 ? { ...list[0], _via: via } : null)
  const reqRO = j => digits(j.quote_number) || digits(j.invoice_number) || digits((j.notes || '').match(/RO#?\s*([\w-]+)/i)?.[1])
  if (ro) { const hit = one(all.filter(j => reqRO(j) === ro), 'RO#'); if (hit) return hit }
  if (vin.length === 17) { const hit = one(all.filter(j => String(j.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === vin), 'VIN'); if (hit) return hit }
  if (vin.length >= 4 && shop) { const l4 = vin.slice(-4); const hit = one(all.filter(j => norm(j.shop_name) === shop && String(j.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '').endsWith(l4)), 'last-4 VIN + shop'); if (hit) return hit }
  if (shop && veh) { const hit = one(all.filter(j => norm(j.shop_name) === shop && norm(j.vehicle || [j.year, j.make, j.model].filter(Boolean).join(' ')) === veh), 'shop + vehicle'); if (hit) return hit }
  return null
}

router.post('/', async (req, res) => {
  try {
    // Auto-dispatch on create (Mark 2026-07-24): a technician on the
    // job (Kat picked one creating it, or the quote carried one) sends
    // it straight to their column with today's date — skipping the
    // Needs Dispatch step. Tech-requested cards (via_request) keep
    // their job_requested status for the Waiting-for-Kat flow.
    const body = { ...req.body }
    // A request is only a request when it says so (via_request). Anything
    // else asking for job_requested — a created job with a Books quote,
    // an old client, a stray default — is filed at Needs Dispatch
    // (Mark 2026-09-08: "if she creates a job and it does not get
    // dispatched it needs to be in needs to be dispatched").
    if (body.status === 'job_requested' && !body.via_request) {
      console.log(`[jobs POST] job_requested without via_request → need_dispatch (${body.shop_name || ''} ${body.quote_number || ''})`)
      body.status = 'need_dispatch'
    }
    // 👤 Person (retail) request (Phase C): find-or-create the retail customer,
    // pin it on the card. A shop request carries the Books contact the tech picked.
    if (body.customer_kind === 'retail' && body.retail?.name) {
      try {
        const { findOrCreateRetail } = await import('./estimator.js')
        const { customer, created } = await findOrCreateRetail(req, { name: body.retail.name, phone: body.retail.phone, email: body.retail.email })
        body.customer = { kind: 'retail', id: customer.id, name: customer.name, zoho_contact_id: customer.zoho_contact_id || '' }
        body.shop_name = customer.name
        if (!body.insurer) body.insurer = 'Cash'
        console.log(`[jobs POST] retail person ${created ? 'created' : 'matched'}: ${customer.name} (${customer.id})`)
      } catch (e) { console.warn('[jobs POST] retail customer failed (card still created):', e.message) }
    } else if (body.customer && body.customer.kind === 'shop') {
      body.customer = { kind: 'shop', id: '', name: String(body.customer.name || body.shop_name || '').slice(0, 120), zoho_contact_id: String(body.customer.zoho_contact_id || '').slice(0, 40) }
    }
    delete body.customer_kind; delete body.retail
    const autoStatus = dispatchedStatusFor(body.technician)
    const autoDispatched = !body.via_request && autoStatus &&
      (!body.status || body.status === 'need_dispatch')
    if (autoDispatched) {
      body.status = autoStatus
      if (!body.scheduled_date) {
        body.scheduled_date = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date())
      }
    }
    // Safety net (Mark 2026-09-21): a job built from a Kinetic report
    // while a tech's request for the same car is still Waiting for Kat
    // converts THAT card instead of adding a second one — so photos,
    // tires, odometer reads and the WorkDrive folder the tech already
    // put on the request ride along, whichever button Kat pressed.
    let newJob = null
    if (!body.via_request) {
      try {
        const match = await findOpenRequestFor(req, body)
        if (match) {
          const carry = {}
          for (const k of ['photo_slots', 'tires_set', 'odo_before', 'odo_after', 'pcsi_checks']) if (match[k] && !body[k]) carry[k] = match[k]
          if (match.folder_url && !body.folder_url) carry.folder_url = match.folder_url
          if (match.technician && !body.technician) carry.technician = match.technician
          const merged = { ...match, ...carry, ...body, id: match.id, via_request: false, request_type: '' }
          newJob = await updateJob(req, match.id, merged)
          let shots = 0; try { const sl = JSON.parse(newJob.photo_slots || '{}'); shots = ['lf', 'rf', 'lr', 'rr', 'vin', 'odo_before', 'odo_after'].filter(k => sl[k]?.fileId).length + (sl.setup || []).length } catch { /* none */ }
          console.log(`[jobs POST] converted request ${match.id} (${match.shop_name} · ${match.vehicle}) via ${match._via} — ${shots} photo(s) carried`)
          await postToCliqChannel(DISPATCH_CHANNEL, `🔗 *${newJob.shop_name || 'Job'}${newJob.vehicle ? ' · ' + newJob.vehicle : ''}* — built from the report onto ${match.technician || 'the tech'}'s request${shots ? ` · ${shots} photo${shots === 1 ? '' : 's'} already in the folder` : ''}. One card, one folder.`).catch(() => {})
        }
      } catch (e) { console.warn('[jobs POST] request match failed (creating fresh):', e.message) }
    }
    if (!newJob) newJob = await insertJob(req, body)

    // Request from the Live Day "Request a Job" or "Request a Quote" form
    // → post to #aajobs. request_type: 'quote' | 'job' distinguishes them
    // in the header emoji + label so Kat can tell what's being asked at a
    // glance (a quote wants a price back, a job wants scheduling).
    // Also drops a silent bell-inbox row for Kat so /notifications still lists it.
    if (req.body.via_request) {
      const isQuote = String(req.body.request_type || '').toLowerCase() === 'quote'
      const vehicle = newJob.vehicle || [newJob.year, newJob.make, newJob.model].filter(Boolean).join(' ')
      const shop = newJob.shop_name || 'Unknown shop'
      const reqBy = newJob.technician ? ` · 👤 Requested by ${newJob.technician}` : ''
      const ro = newJob.quote_number ? ` · RO# ${newJob.quote_number}` : ''
      const insurer = newJob.insurer ? ` · 🏦 ${newJob.insurer}` : (isQuote ? ' · 🏦 Cash' : '')
      const notes = (newJob.notes || '').trim()
      const notesLine = isQuote && notes ? `\n📝 ${notes.replace(/\n+/g, ' ')}` : ''
      const header = isQuote ? '📝 *Quote Requested*' : '🆕 *Job Requested*'
      const msg = [
        `${header} · ${shop}`,
        `${vehicle || 'Vehicle TBD'}${ro}${reqBy}${insurer}${notesLine}`,
      ].join('\n')
      await postToCliqChannel(AA_JOBS_CHANNEL, msg)
        .catch(e => console.warn(`[aajobs ${isQuote ? 'quote' : 'job'}_requested]`, e.message))
      // Also fan to #dispatch so the schedulers see it in their working channel.
      await postToCliqChannel(DISPATCH_CHANNEL, msg)
        .catch(e => console.warn(`[dispatch ${isQuote ? 'quote' : 'job'}_requested]`, e.message))
      await createNotification(req, {
        to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com',
        type: 'job_requested',
        title: `${isQuote ? 'New quote request' : 'New job request'}: ${shop}`,
        body: `${vehicle || 'Vehicle TBD'}${reqBy}${ro}`,
        jobId: newJob.id, job: newJob,
        skipCliq: true, skipTechChannel: true,
      }).catch(e => console.warn('[notif job_requested inbox]', e.message))
    }

    // Notify dispatchers (Mark + Kat) + #technicians when a new job arrives at need_dispatch
    // (covers: Upload Report → Create Zoho Invoice, ManualQuoteScreen, any other direct job creation)
    if (autoDispatched || (newJob.technician && /^dispatched_/.test(String(newJob.status || '')) && !req.body.via_request)) {
      // Straight-to-tech: DM the assigned tech + #technicians instead
      // of the Needs Dispatch alert. Also when the card was created already
      // marked dispatched (Mark 2026-09-23: every car that gets dispatched).
      await notifyJobDispatched(req, newJob)
    } else if (!req.body.via_request && (newJob.status === 'need_dispatch' || (!newJob.status && req.body.status === 'need_dispatch'))) {
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

    // 📸 Photo gate on the PUT path too (board drag-drop) — same rule as
    // PATCH: no Ready to Invoice until the photo set is complete.
    if (req.body.status === 'ready_invoice' && prevStatus !== 'ready_invoice') {
      const { photoProgress, describeMissing } = await import('../services/jobPhotos.js')
      let cur = null
      try { cur = rowToJob(await getTable(req).getRow(req.params.id)) } catch {}
      const merged = { ...(cur || {}), ...req.body }
      const prog = photoProgress(merged)
      // Mark 2026-09-17: "we need to get the car invoiced so we can get a
      // check" — photos NEVER block the handoff to Kat. An incomplete set
      // becomes a debt the app chases (red card + 6pm owed list) instead
      // of a wall. Safety inspection + tires still block: that's work.
      if (!prog.complete) { await markPending(merged, prog, req); req.body.photo_slots = merged.photo_slots }
      if (await tireGate(req, res, merged)) return
      relayCustomerPay(req, req.body, cur)
      delete req.body.photo_override
      delete req.body.photos_pending
    }

    const updated = await updateJob(req, req.params.id, req.body)
    if (req.body.status === 'ready_invoice' && prevStatus !== 'ready_invoice') await writePcsiStory(req, updated)
    if (req.body.cash_quoted && String(cur?.cash_quoted || '') !== String(req.body.cash_quoted)) await applyCashQuoted(req, updated)

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

    // Tell #aajobs when a job parks on Waiting-on-Parts
    if (updated.status === 'pending_parts' && prevStatus !== 'pending_parts') {
      await notifyPartsWaiting(req, updated)
    }

    // Notify the assigned tech + #technicians when a job is dispatched (tech assigned)
    const newTech = updated.technician
    const techChanged = newTech && newTech !== prevTech
    const statusBecameDispatched = /^dispatched_/.test(updated.status || '') && !/^dispatched_/.test(prevStatus || '')
    if (newTech && (techChanged || statusBecameDispatched)) {
      await notifyJobDispatched(req, updated, prevTech || '')
    }
    // Keep the linked Zoho estimate's salesperson in sync with the technician
    if (techChanged) {
      await syncTechnicianToZoho(updated, newTech)
    }

    // Notify Kat when a job moves to ready_invoice
    if (updated.status === 'ready_invoice' && prevStatus !== 'ready_invoice') {
      await (async () => {
        const vehicle = updated.vehicle || [updated.year, updated.make, updated.model].filter(Boolean).join(' ')
        const roNum = updated.quote_number || (updated.notes || '').match(/RO#[:\s]*([^\s|,]+)/i)?.[1] || ''
        const shop = updated.shop_name || 'Job'
        const insurer = updated.insurer || 'Customer Pay (CP)'
        const tech = updated.technician ? ` · 👤 ${updated.technician}` : ''
        const extras = String(updated.extra_services || '').trim()
        const msg = [
          `🟢 *Ready to Invoice* · ${shop}`,
          `${vehicle || 'Vehicle TBD'}${roNum ? ' · RO# ' + roNum : ''}${tech}`,
          ...payLines(updated, insurer),
          extras ? `\n🚨 *ALERT — EXTRA SERVICES TO ADD TO INVOICE:*\n${extras}` : null,
        ].filter(Boolean).join('\n')
        await postToCliqChannel(AA_JOBS_CHANNEL, msg)
          .catch(e => console.warn('[aajobs job_ready_invoice]', e.message))
        // Also fan to #Dispatch so the scheduling side sees ready-to-invoice
        // events without having to also subscribe to #aajobs.
        await postToCliqChannel(DISPATCH_CHANNEL, msg)
          .catch(e => console.warn('[dispatch job_ready_invoice]', e.message))
        await createNotification(req, {
          to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com',
          type: 'job_ready_invoice',
          title: `Ready to invoice: ${shop}${extras ? ' (+ extras)' : ''}`,
          body: extras ? `🚩 Extras: ${extras}` : '',
          jobId: updated.id, job: updated,
          skipCliq: true, skipTechChannel: true,
        }).catch(e => console.warn('[notif job_ready_invoice inbox]', e.message))
      })()
      // Extra "zero these" DM to Kat on cash jobs — no-op for insurance jobs.
      await notifyReadyToInvoiceCash(req, updated).catch(e => console.warn('[cash ready_invoice PUT]', e.message))
      await notifyReadyToInvoiceTesla(req, updated).catch(e => console.warn('[tesla ready_invoice PUT]', e.message))
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
    if (!currentRow) return res.status(404).json({ error: 'Job not found — it may have been invoiced or deleted. Refresh the board.' })
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

    // 📸 Photo gate (Mark 2026-09-08): a job can't go Ready to Invoice
    // until its photo set is complete and the test drive is over a mile.
    // Enforced here so no client path skips it. Mark alone can override
    // with a reason (logged on the card + #dispatch).
    if (req.body.status === 'ready_invoice' && currentJob.status !== 'ready_invoice') {
      const { photoProgress, gateApplies, describeMissing } = await import('../services/jobPhotos.js')
      if (gateApplies(merged)) {
        const prog = photoProgress(merged)
        if (!prog.complete) await markPending(merged, prog, req)   // debt, not a block (2026-09-17)
      }
      if (await tireGate(req, res, merged)) return
      relayCustomerPay(req, merged, currentJob)
      delete merged.photo_override
      delete merged.photos_pending
    }

    const updated = await updateJob(req, req.params.id, merged)
    if (req.body.status === 'ready_invoice' && currentJob.status !== 'ready_invoice') await writePcsiStory(req, updated)
    if (req.body.cash_quoted && String(currentJob.cash_quoted || '') !== String(req.body.cash_quoted)) await applyCashQuoted(req, updated)

    if (req.body.status === 'complete' && currentJob.status !== 'complete') {
      logCompletion(req, updated).catch(e => console.warn('[completions]', e.message))
      logJobHistory(req, updated, 'complete')
    }
    if (req.body.invoiced === true && !currentJob.invoiced) {
      logJobHistory(req, updated, 'invoiced')
      // Invoice notifications come solely from the Zoho Books webhook — see webhook.js
    }

    // Notify dispatchers when a job lands in need_dispatch
    // Tell #aajobs when a job parks on Waiting-on-Parts
    if (updated.status === 'pending_parts' && currentJob.status !== 'pending_parts') {
      await notifyPartsWaiting(req, updated)
    }

    if (updated.status === 'need_dispatch' && currentJob.status !== 'need_dispatch') {
      await notifyNeedsDispatch(req, updated)
    }

    // Notify the assigned tech + #technicians when a job is dispatched (tech assigned)
    const newTech = updated.technician
    const techChanged = newTech && newTech !== currentJob.technician
    const statusBecameDispatched = /^dispatched_/.test(updated.status || '') && !/^dispatched_/.test(currentJob.status || '')
    if (newTech && (techChanged || statusBecameDispatched)) {
      await notifyJobDispatched(req, updated, currentJob.technician || '')
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
      await (async () => {
        const vehicle = updated.vehicle || [updated.year, updated.make, updated.model].filter(Boolean).join(' ')
        const roNum = updated.quote_number || (updated.notes || '').match(/RO#[:\s]*([^\s|,]+)/i)?.[1] || ''
        const shop = updated.shop_name || 'Job'
        const insurer = updated.insurer || 'Customer Pay (CP)'
        const tech = updated.technician ? ` · 👤 ${updated.technician}` : ''
        // Extra services line — set from the Live Day Ready-to-Invoice modal.
        // Prefixed with 🚩 so Kat can't miss it in the channel scroll.
        const extras = String(updated.extra_services || '').trim()
        const msg = [
          `🟢 *Ready to Invoice* · ${shop}`,
          `${vehicle || 'Vehicle TBD'}${roNum ? ' · RO# ' + roNum : ''}${tech}`,
          ...payLines(updated, insurer),
          extras ? `\n🚨 *ALERT — EXTRA SERVICES TO ADD TO INVOICE:*\n${extras}` : null,
        ].filter(Boolean).join('\n')
        await postToCliqChannel(AA_JOBS_CHANNEL, msg)
          .catch(e => console.warn('[aajobs job_ready_invoice]', e.message))
        // Also fan to #Dispatch so the scheduling side sees ready-to-invoice
        // events without having to also subscribe to #aajobs.
        await postToCliqChannel(DISPATCH_CHANNEL, msg)
          .catch(e => console.warn('[dispatch job_ready_invoice]', e.message))
        await createNotification(req, {
          to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com',
          type: 'job_ready_invoice',
          title: `Ready to invoice: ${shop}${extras ? ' (+ extras)' : ''}`,
          body: extras ? `🚩 Extras: ${extras}` : '',
          jobId: updated.id, job: updated,
          skipCliq: true, skipTechChannel: true,
        }).catch(e => console.warn('[notif job_ready_invoice inbox]', e.message))
      })()
      await notifyReadyToInvoiceCash(req, updated).catch(e => console.warn('[cash ready_invoice PATCH]', e.message))
      await notifyReadyToInvoiceTesla(req, updated).catch(e => console.warn('[tesla ready_invoice PATCH]', e.message))
    }

    res.json(updated)
  } catch (err) {
    const detail = extractErr(err)
    console.error('[jobs PATCH]', detail, err.stack)
    res.status(500).json({ error: detail })
  }
})

// DELETE /api/jobs/:id
// GET /api/jobs/:id/scrub — the CCC extraction the email intake stored for
// this card (AppConfig scrub_<id>), shaped like /api/extract so the review
// screen opens on it with no re-upload (2026-09-24).
router.get('/:id/scrub', async (req, res) => {
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const rows = await app.zcql().executeZCQLQuery(`SELECT config_value FROM AppConfig WHERE config_key = 'scrub_${String(req.params.id).replace(/[^0-9]/g, '')}' LIMIT 1`)
    const raw = rows?.[0]?.AppConfig?.config_value
    if (!raw) return res.status(404).json({ error: 'No scrub stored for this card.' })
    res.json(JSON.parse(raw))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/:id', async (req, res) => {
  try {
    // 📧 Learn from a delete (2026-09-24): an emailed request deleted with
    // ?block=1 puts the sender on the intake suppress list.
    if (req.query.block === '1') {
      try {
        const row = await getTable(req).getRow(req.params.id)
        const job = row ? rowToJob(row) : null
        const m = /(?:texted|emailed) \(([^)]+@[^)]+)\):/.exec(String(job?.notes || ''))
        if (m) { const { addSuppressed } = await import('../services/emailToJob.js'); await addSuppressed(req, m[1]); console.log(`[jobs DELETE] intake sender blocked: ${m[1]}`) }
      } catch (e) { console.warn('[jobs DELETE] block failed (non-fatal):', e.message) }
    }
    // Tombstone the linked estimate BEFORE deleting (Mark 2026-07-14:
    // "when I delete a job it doesn't stay deleted") — otherwise the
    // quote sync sees an active Books estimate with no job row and
    // recreates the card on the next webhook. AppConfig row
    // `deleted_estimate:<id>` tells performSyncQuotes to skip it.
    try {
      const app = catalyst.initialize(req, { type: 'advancedio' })
      const rows = await app.zcql().executeZCQLQuery(
        `SELECT zoho_estimate_id FROM Jobs WHERE ROWID = '${String(req.params.id).replace(/'/g, "''")}' LIMIT 1`
      )
      const estId = rows?.[0]?.Jobs?.zoho_estimate_id
      if (estId) {
        const key = `deleted_estimate:${estId}`.slice(0, 64)
        const existing = await app.zcql().executeZCQLQuery(
          `SELECT ROWID FROM AppConfig WHERE config_key = '${key.replace(/'/g, "''")}' LIMIT 1`
        )
        if (!existing?.[0]) {
          await app.datastore().table('AppConfig').insertRow({
            config_key: key, config_value: new Date().toISOString(),
          })
        }
      }
    } catch (e) {
      console.warn('[jobs DELETE] tombstone failed (non-fatal):', e.message)
    }
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

    // Mirror the PATCH /:id ready_invoice branch: post to #aajobs and
    // #Dispatch, drop an inbox row for Kat, fire the cash-customer
    // reminder if applicable. Was previously missing the channel posts
    // (only inbox notification fired), so a tech tapping "Complete"
    // didn't ping Cliq — fixed 2026-07-08.
    if (current.status !== 'ready_invoice') {
      const vehicle = updated.vehicle || [updated.year, updated.make, updated.model].filter(Boolean).join(' ')
      const roNum = updated.quote_number || (updated.notes || '').match(/RO#[:\s]*([^\s|,]+)/i)?.[1] || ''
      const shop = updated.shop_name || 'Job'
      const insurer = updated.insurer || 'Customer Pay (CP)'
      const tech = updated.technician ? ` · 👤 ${updated.technician}` : ''
      const msg = [
        `🟢 *Ready to Invoice* · ${shop}`,
        `${vehicle || 'Vehicle TBD'}${roNum ? ' · RO# ' + roNum : ''}${tech}`,
        ...payLines(updated, insurer),
      ].join('\n')
      await postToCliqChannel(AA_JOBS_CHANNEL, msg)
        .catch(e => console.warn('[aajobs job_ready_invoice complete]', e.message))
      await postToCliqChannel(DISPATCH_CHANNEL, msg)
        .catch(e => console.warn('[dispatch job_ready_invoice complete]', e.message))
      await createNotification(req, {
        to: 'Kath',
        toEmail: 'k.belmonte@absoluteadas.com',
        type: 'job_ready_invoice',
        title: `Ready to invoice: ${shop}`,
        body: '',
        jobId: updated.id,
        job: updated,
        skipCliq: true, skipTechChannel: true,
      }).catch(e => console.warn('[notifications complete]', e.message))
      await notifyReadyToInvoiceCash(req, updated).catch(e => console.warn('[cash ready_invoice complete]', e.message))
      await notifyReadyToInvoiceTesla(req, updated).catch(e => console.warn('[tesla ready_invoice complete]', e.message))
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
  // Age cutoff (2026-07-13): Books keeps abandoned quotes in "sent"
  // forever, and listAllEstimates pages through ALL of history — on
  // 2026-07-12 that flooded the board with 33 dead quotes, some years
  // old. A quote that hasn't moved in 2 weeks isn't a dispatchable job.
  // An estimate with no date is treated as too old.
  const SYNC_MAX_AGE_DAYS = 14
  const cutoffDate = new Date(Date.now() - SYNC_MAX_AGE_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0]
  const estimateTooOld = est => !est.date || est.date < cutoffDate

  // Deleted-on-the-board tombstones (Mark 2026-07-14): a job deleted in
  // the app must STAY deleted even though its estimate is still active
  // in Books. Exact-key lookup per import candidate — usually 0-2/sync.
  const isTombstoned = async (estimateId) => {
    try {
      const app = catalyst.initialize(req, { type: 'advancedio' })
      const key = `deleted_estimate:${estimateId}`.slice(0, 64)
      const rows = await app.zcql().executeZCQLQuery(
        `SELECT ROWID FROM AppConfig WHERE config_key = '${key.replace(/'/g, "''")}' LIMIT 1`
      )
      return !!rows?.[0]
    } catch (e) {
      console.warn('[jobs sync] tombstone check failed:', e.message)
      return false
    }
  }

  let created = 0
  for (const est of estimates) {
    if (!IMPORT_STATUSES.has(est.status)) continue
    if (estimateTooOld(est)) continue
    if (existingEstimateIds.has(est.estimate_id)) continue
    if (await isTombstoned(est.estimate_id)) continue

    // Fetch line items from the full estimate detail
    const lineItems = await getEstimateLineItems(est.estimate_id)

    // Request-first (Mark 2026-09-05, replacing the 7/24 auto-dispatch):
    // imported estimates land as REQUESTS — no auto-dispatch, no fake
    // today-date. Salesperson rides along as the suggested tech; the
    // card becomes a job when Kat creates it (or someone moves it).
    // A request scheduled for today still reaches the tech's Live lane.
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
      scheduled_date: '',
      calibrations: JSON.stringify(lineItems),
      notes:        `Quote: ${est.estimate_number}`,
      report_url:   est.quote_url      || '',
      status:       'job_requested',
      via_request:  true,
      request_type: 'job',
      quote_number: est.estimate_number || '',
      quote_url:    est.quote_url       || '',
      folder_url:   est.cf_scan_report_and_documentation || '',
    })
    created++

    // New quote imported → Needs-attention alert to Mark + Kat (techs
    // aren't pinged for unconfirmed quote work).
    try {
      {
        await notifyNeedsDispatch(req, { ...newJob, vehicle })
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
    // A job whose estimate vanished, left the active statuses, or aged
    // past the cutoff comes off the board (need_dispatch only).
    if (!est || !IMPORT_STATUSES.has(est.status) || estimateTooOld(est)) {
      // Only auto-remove untouched cards: Need to Dispatch, or a sync-
      // created request that nobody edited (notes still the bare
      // 'Quote:' signature). Progressed jobs stay even if the estimate
      // was voided/declined in Zoho.
      if (job.status === 'need_dispatch' ||
          (job.status === 'job_requested' && /^Quote: /.test(job.notes || ''))) {
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

// Resolve (or CREATE) the job's WorkDrive folder id. Tries every RO
// form, then shop+vehicle, then makes the folder — an upload from the
// field must never dead-end on "folder not found" (Mark 2026-08-30).
async function resolveJobFolder(req, job, wdToken, { noCreate = false } = {}) {
  if (job.folder_url) {
    const m = job.folder_url.match(/workdrive\.zoho\.com\/(?:folder|home[^ ]*?\/folders)\/([a-z0-9]+)/i)
    if (m) return m[1]
  }
  const candidates = [job.invoice_number, job.quote_number, job.ro_number]
    .filter(Boolean)
    .flatMap(r => {
      const full = String(r).trim()
      const digits = full.match(/\d{4,}/)?.[0]
      return digits && digits !== full ? [full, digits] : [full]
    })
  for (const ro of candidates) {
    const found = await findFolderByRO(ro, wdToken).catch(() => null)
    if (found?.folderId) return found.folderId
  }
  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  const byShop = await findFolderByShopVehicle(job.shop_name, vehicle, wdToken).catch(() => null)
  if (byShop?.folderId) return byShop.folderId
  if (noCreate) return null
  // Last resort: create it, same naming as the report pipeline
  const fullRO = candidates[0] || 'Job'
  const folderName = `${fullRO} — ${job.shop_name || ''} — ${vehicle}`.slice(0, 80)
  const created = await createJobFolder(folderName, wdToken).catch(() => null)
  if (created?.folderId) {
    console.log(`[wd-folder] created folder for job ${job.id}: ${folderName}`)
    return created.folderId
  }
  return null
}

const parsePhotoSlots = raw => { try { const o = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); if (!Array.isArray(o.setup)) o.setup = o.setup ? [o.setup] : []; return o } catch { return { setup: [] } } }
const ptDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const ptHour = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date()))

// Mark 2026-09-17: the invoice goes out on the tech's word. An incomplete
// photo set at Ready to Invoice is recorded as a DEBT on the card
// (photo_slots._pending) and chased by the 6pm owed list until the shots
// land. Cleared automatically in the photo-slot route when the set fills.
async function markPending(merged, prog, req) {
  const { describeMissing } = await import('../services/jobPhotos.js')
  const slots = parsePhotoSlots(merged.photo_slots)
  const who = req.user?.techName || req.user?.name || req.user?.email || 'tech'
  const missingLabels = describeMissing(prog)
  slots._pending = { slots: prog.missing, at: new Date().toISOString(), by: who, labels: missingLabels }
  merged.photo_slots = JSON.stringify(slots)
  await postToCliqChannel(DISPATCH_CHANNEL,
    `📸 *${merged.shop_name || 'Job'}${merged.vehicle ? ' · ' + merged.vehicle : ''} → Ready to Invoice · photos still owed* (${who})\n` +
    `Missing: ${missingLabels.join(', ')}. Bill it now — the shots upload on their own and the card clears itself. They stay on 📸 Still to do in Live Day and the 6pm owed list until they land.`).catch(e => console.log('[photos-owed] cliq failed:', e.message))
  // Rolling log for the weekly per-tech count.
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const rows = await app.zcql().executeZCQLQuery("SELECT ROWID, config_value FROM AppConfig WHERE config_key = 'photos_owed_log' LIMIT 1")
    const r = rows?.[0]?.AppConfig || rows?.[0]
    let log = []
    try { log = r?.config_value ? JSON.parse(r.config_value) : [] } catch { log = [] }
    log.push({ job_id: String(merged.id || ''), shop: merged.shop_name || '', vehicle: merged.vehicle || '', tech: who, at: new Date().toISOString(), missing: prog.missing })
    const value = JSON.stringify(log.slice(-200))
    const table = app.datastore().table('AppConfig')
    if (r?.ROWID) await table.updateRow({ ROWID: String(r.ROWID), config_key: 'photos_owed_log', config_value: value })
    else await table.insertRow({ config_key: 'photos_owed_log', config_value: value })
  } catch (e) { console.log('[photos-owed] log failed (non-fatal):', e.message) }
  console.log(`[photos-owed] ${merged.shop_name || 'job'} by ${who}: ${missingLabels.join(', ')}`)
  return merged
}

// ── Reconcile the card with the WorkDrive folder (Mark 2026-09-23: "Jayden
//    did upload all of those pictures, but it's still notifying us"). Shots
//    reach the folder by three roads — the guided sheet, the plain 📷 Upload
//    button, and misfiled slots from the sorter — but only the first fills a
//    slot. So: read the folder, fill empty slots from the file names, count
//    everything else as unlabeled, and if the folder holds a full set the
//    card stops owing. Never creates a folder.
const IMG_RE = /\.(jpe?g|png|heic|heif|webp|gif)$/i
export async function reconcilePhotosFromFolder(req, job, { notify = true } = {}) {
  const { SLOTS, photoProgress } = await import('../services/jobPhotos.js')
  const slots = parsePhotoSlots(job.photo_slots)
  const wdToken = await getAccessToken()
  const folderId = slots._folder_id || await resolveJobFolder(req, job, wdToken, { noCreate: true })
  if (!folderId) return { ok: false, why: 'no folder' }
  const files = (await listChildren(folderId, wdToken, { folders: false })).filter(f => IMG_RE.test(f.name || ''))
  const known = new Set()
  for (const k of Object.keys(slots)) { const v = slots[k]; if (v?.fileId) known.add(String(v.fileId)); if (Array.isArray(v)) v.forEach(x => x?.fileId && known.add(String(x.fileId))) }
  let filledFromNames = 0
  const claimed = new Set()
  for (const sl of SLOTS) {
    const re = new RegExp(`^0?${sl.n}\\s+${sl.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
    const hits = files.filter(f => re.test(f.name))
    for (const f of hits) {
      claimed.add(String(f.id))
      if (known.has(String(f.id))) continue
      const entry = { fileId: String(f.id), name: f.name, at: new Date().toISOString(), from: 'folder' }
      if (sl.multi) { slots.setup = [...(slots.setup || []), entry]; filledFromNames++ }
      else if (!slots[sl.key]?.fileId) { slots[sl.key] = entry; filledFromNames++ }
      known.add(String(f.id))
    }
  }
  const unlabeled = files.filter(f => !claimed.has(String(f.id)) && !known.has(String(f.id)))
  slots._folder_id = folderId
  const probe = { ...job, photo_slots: JSON.stringify(slots) }
  const prog = photoProgress(probe)
  const fullSet = prog.missing.length === 0 || files.length >= SLOTS.length
  let cleared = false
  if (slots._pending && fullSet) {
    cleared = true
    const by = slots._pending.by
    delete slots._pending
    slots._folder_ok = { images: files.length, unlabeled: unlabeled.length, at: new Date().toISOString(), missing_labels: prog.missing }
    if (notify) await postToCliqChannel(DISPATCH_CHANNEL, `✅ *Photos in* · ${job.shop_name || 'Job'}${job.vehicle ? ' · ' + job.vehicle : ''} — ${files.length} photo${files.length === 1 ? '' : 's'} in the folder${prog.missing.length ? ` (${prog.missing.length} not labeled: ${prog.missing.join(', ')})` : ''}${by ? ` · from ${by}` : ''}. Off the owed list.`).catch(e => console.log('[photos reconcile] cliq failed:', e.message))
  } else if (!slots._pending && fullSet) {
    slots._folder_ok = { images: files.length, unlabeled: unlabeled.length, at: new Date().toISOString(), missing_labels: prog.missing }
  }
  const changed = cleared || filledFromNames > 0 || String(job.photo_slots || '') !== JSON.stringify(slots)
  let updated = job
  if (changed) updated = await updateJob(req, job.id, { ...job, photo_slots: JSON.stringify(slots) })
  console.log(`[photos reconcile] job ${job.id} ${job.shop_name || ''}: ${files.length} images, +${filledFromNames} from names, ${unlabeled.length} unlabeled, missing ${prog.missing.length}${cleared ? ' → cleared' : ''}`)
  return { ok: true, images: files.length, filled_from_names: filledFromNames, unlabeled: unlabeled.length, missing: prog.missing, cleared, job: updated }
}
/** Hourly: every owed card gets checked against its folder. */
export async function reconcileOwedPhotos(req) {
  const owed = await photosOwedList(req)
  const out = { checked: owed.length, cleared: 0, filled: 0 }
  for (const o of owed) {
    try { const r = await reconcilePhotosFromFolder(req, { ...o.job, folder_url: '', invoice_number: o.invoice_number, status: o.status }); if (r.cleared) out.cleared++; out.filled += r.filled_from_names || 0 } catch (e) { console.log('[photos reconcile]', o.id, e.message) }
  }
  return out
}

/** Does this card still owe photos? Guards the invoice-time card delete. */
export function photosStillOwed(job) {
  try { return !!parsePhotoSlots(job?.photo_slots)?._pending?.at } catch { return false }
}

/** Every job still owing photos, newest first. Drives the 6pm list and the in-app view. */
export async function photosOwedList(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID, shop_name, vehicle, year, make, model, vin, technician, status, invoice_number, photo_slots, tires_set, odo_before, odo_after FROM ${JOBS_TABLE_NAME} WHERE status = 'ready_invoice' OR status = 'complete' ORDER BY ROWID DESC LIMIT 300`)
  const out = []
  for (const r of rows || []) {
    const j = r[JOBS_TABLE_NAME] || r
    const slots = parsePhotoSlots(j.photo_slots)
    const p = slots?._pending
    if (!p?.at) continue
    out.push({ id: String(j.ROWID), shop_name: j.shop_name || '', vehicle: j.vehicle || '', technician: j.technician || p.by || '',
      status: j.status, invoice_number: j.invoice_number || '', owed_since: p.at, by: p.by || '',
      missing: p.slots || [], labels: p.labels || p.slots || [],
      hours: Math.max(0, Math.round((Date.now() - new Date(p.at).getTime()) / 3600000)),
      // Everything the photo sheet needs so Live Day can open it straight
      // from this list — there is no GET /api/jobs/:id (Mark 2026-09-18).
      job: { id: String(j.ROWID), shop_name: j.shop_name || '', vehicle: j.vehicle || '', year: j.year || '', make: j.make || '',
        model: j.model || '', vin: j.vin || '', technician: j.technician || '', photo_slots: j.photo_slots || '',
        tires_set: j.tires_set || '', odo_before: j.odo_before || '', odo_after: j.odo_after || '' } })
  }
  return out.sort((a, b) => String(a.owed_since).localeCompare(String(b.owed_since)))
}

// 6pm PT daily: one message with every job still owing photos, and on
// Mondays a 7-day count per tech so a dead-signal shop shows up as a
// pattern instead of a habit.
export async function maybePhotosOwedDigest(req) {
  const hour = ptHour()
  if (hour < 18 || hour > 21) return { fired: false, reason: `outside the 6-9pm window (hour=${hour})` }
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const today = ptDay()
  const stampKey = `photos_owed_digest:${today}`
  const seen = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = '${stampKey}' LIMIT 1`)
  if (seen?.[0]) return { fired: false, reason: 'already sent today' }
  try { await reconcileOwedPhotos(req) } catch (e) { console.log('[photos digest] reconcile failed:', e.message) }
  const owed = await photosOwedList(req)
  await app.datastore().table('AppConfig').insertRow({ config_key: stampKey, config_value: new Date().toISOString() }).catch(() => {})
  if (!owed.length) return { fired: true, owed: 0 }
  const lines = owed.map(o => {
    const age = o.hours >= 24 ? `${Math.floor(o.hours / 24)}d` : `${o.hours}h`
    return `• ${o.shop_name}${o.vehicle ? ` · ${o.vehicle}` : ''}${o.invoice_number ? ` · inv ${o.invoice_number}` : ''} — ${(o.labels || []).join(', ')} · ${o.technician || o.by} · ${age}`
  })
  let weekly = ''
  if (new Date(today + 'T12:00:00Z').getUTCDay() === 1) {
    try {
      const r = await app.zcql().executeZCQLQuery("SELECT config_value FROM AppConfig WHERE config_key = 'photos_owed_log' LIMIT 1")
      const log = JSON.parse((r?.[0]?.AppConfig || r?.[0])?.config_value || '[]')
      const since = new Date(Date.now() - 7 * 86400000).toISOString()
      const tally = {}
      for (const e of log) if (e.at >= since) tally[e.tech || '?'] = (tally[e.tech || '?'] || 0) + 1
      const parts = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`)
      if (parts.length) weekly = `\n\nLast 7 days, jobs invoiced with photos owed: ${parts.join(' · ')}`
    } catch { /* non-fatal */ }
  }
  const msg = `📸 *Photos owed — ${owed.length} job${owed.length === 1 ? '' : 's'}*\n${lines.join('\n')}${weekly}\n\nThey upload on their own once the phone has signal; each card clears itself when the set completes.`
  const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
  await Promise.allSettled([postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg), postToCliqChannel(DISPATCH_CHANNEL, msg)])
  return { fired: true, owed: owed.length }
}

// Owner/staff view of the same list.
router.get('/photos-owed', async (req, res) => {
  try { res.json({ ok: true, owed: await photosOwedList(req) }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})


// POST /api/jobs/photo-classify — "which shot is this?" on a small
// thumbnail, BEFORE the real upload (Mark 2026-09-21: "let AI decide is
// super slow"). The phone sends ~50 KB, learns the slot in ~2 s, and then
// uploads the full photo straight into it — so on a one-bar signal the
// slow part happens once, not once-then-again after a guess. No job
// state touched; the phone maps "odometer" to before/after itself.
router.post('/photo-classify', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo.' })
    const { classifyPhoto } = await import('../services/jobPhotos.js')
    const t0 = Date.now()
    const ai = await classifyPhoto(req.file.buffer, req.file.mimetype)
    console.log(`[photo-classify] ${Math.round(req.file.size / 1024)} KB → ${ai.slot} ${ai.confidence} in ${Date.now() - t0}ms`)
    res.json({ ok: true, ...ai })
  } catch (e) {
    console.log('[photo-classify] failed:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/jobs/:id/photo-slot — one photo into one slot of the job's
// photo set (Mark 2026-09-08). Multipart field "photo"; optional "slot"
// (lf|rf|lr|rr|vin|odo_before|odo_after|setup). No slot → Claude sorts
// it. Odometer slots get their miles read (tech can correct via PATCH
// odo_before / odo_after). File lands in the job's WorkDrive folder
// with a self-describing name and the slot map is saved on the row.
router.post('/:id/photo-slot', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo. Send the image in the "photo" field.' })
    const { SLOTS, parseSlots, photoProgress, fileNameFor, classifyPhoto, MAX_SETUP_PHOTOS } = await import('../services/jobPhotos.js')
    const table = getTable(req)
    const row = await table.getRow(req.params.id)
    if (!row) return res.status(404).json({ error: 'Job not found' })
    const job = rowToJob(row)
    const slots = parseSlots(job.photo_slots)

    let slotKey = String(req.body?.slot || '').trim()
    let miles = req.body?.miles != null && req.body.miles !== '' ? Number(req.body.miles) : null
    const known = new Set(SLOTS.map(s => s.key))
    const needsClassify = !known.has(slotKey) || (/^odo_/.test(slotKey) && miles == null) || slotKey === 'vin'
    // The AI look (~2s) and the WorkDrive prep (token + folder) are
    // independent — run them side by side (Mark 2026-09-21: "let AI
    // decide is super slow").
    const t0 = Date.now()
    const aiP = needsClassify
      ? classifyPhoto(req.file.buffer, req.file.mimetype).catch(e => { console.log('[photo-slot] classify failed:', e.message); return null })
      : Promise.resolve(null)
    const prepP = (async () => {
      const wdToken = await getAccessToken()
      let folderId = slots._folder_id || null
      if (!folderId) { folderId = await resolveJobFolder(req, job, wdToken); if (folderId) slots._folder_id = folderId }
      return { wdToken, folderId }
    })()
    const [ai, prep] = await Promise.all([aiP, prepP])
    console.log(`[photo-slot] prep ${Date.now() - t0}ms${needsClassify ? ' (incl. AI)' : ''}`)
    if (needsClassify) {
      if (!known.has(slotKey)) {
        if (ai?.slot === 'odometer') slotKey = slots.odo_before?.fileId ? 'odo_after' : 'odo_before'
        else if (ai && known.has(ai.slot) && ai.confidence >= 0.5) slotKey = ai.slot
        else return res.status(422).json({ error: 'Could not tell which shot this is — pick the slot.', suggested: ai?.slot || null })
      }
      if (/^odo_/.test(slotKey) && miles == null && ai?.miles != null) miles = ai.miles
    }
    const slotDef = SLOTS.find(s => s.key === slotKey)
    if (slotDef.multi && (slots.setup || []).length >= MAX_SETUP_PHOTOS) {
      return res.status(400).json({ error: `Setup photos are full (${MAX_SETUP_PHOTOS}).` })
    }

    // The folder id is remembered inside photo_slots after the first shot
    // (2026-09-15): folder_url is usually the external share link, which
    // can't be turned back into an id, so every photo was re-searching
    // WorkDrive (and the Search API is broken → slow listing fallback).
    const { wdToken, folderId } = prep
    if (!folderId) return res.status(404).json({ error: 'No WorkDrive folder for this job yet.' })
    const idx = slotDef.multi ? (slots.setup || []).length : 0
    const name = fileNameFor(slotKey, job, idx, req.file.mimetype)
    const up = await uploadFileToFolder(folderId, name, req.file.buffer, wdToken, req.file.mimetype)
    const fileId = String(up?.fileId || up?.id || up || '')
    const entry = { fileId, name, at: new Date().toISOString() }
    // VIN plate (Mark 2026-09-11): read the VIN off the label, keep it on the
    // slot (copyable in the sheet), fill the card's VIN if blank, flag a mismatch.
    let vinInfo = null
    if (slotKey === 'vin') {
      const read = ai?.vin || null
      const cardVin = String(job.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      entry.vin = read
      entry.vin_mismatch = !!(read && cardVin && cardVin !== read)
      vinInfo = { read, card: cardVin || null, mismatch: entry.vin_mismatch }
    }
    if (slotDef.multi) slots.setup = [...(slots.setup || []), entry]
    else slots[slotKey] = entry

    const patch = { photo_slots: JSON.stringify(slots) }
    if (vinInfo?.read && !vinInfo.card) patch.vin = vinInfo.read
    if (!job.folder_url) patch.folder_url = `https://workdrive.zoho.com/folder/${folderId}`
    if (slotKey === 'odo_before' && miles != null) patch.odo_before = String(miles)
    if (slotKey === 'odo_after' && miles != null) patch.odo_after = String(miles)
    // Fresh read right before the write (2026-09-23): two shots uploading at
    // once each read the row, added their slot, and the second write erased
    // the first — the files were in the folder but the card lost the slots.
    let base = job
    try { base = rowToJob(await getTable(req).getRow(job.id)); const fresh = parsePhotoSlots(base.photo_slots); if (slotDef.multi) fresh.setup = [...(fresh.setup || []), entry]; else fresh[slotKey] = entry; if (fresh._pending && slots._pending === undefined) delete fresh._pending; patch.photo_slots = JSON.stringify(fresh) } catch (e) { console.log('[photo-slot] fresh read failed, writing what we have:', e.message) }
    let updated = await updateJob(req, job.id, { ...base, ...patch })
    // Was the card moved to Ready to Invoice on a bad signal? Once the set is whole, clear the flag and tell #dispatch.
    // The debt is the SHOTS, not the test drive: clear it as soon as all
    // eight slots are filled, or a short test drive would keep the card on
    // the owed list forever (Mark 2026-09-18).
    const after = parsePhotoSlots(updated.photo_slots)
    if (after._pending && photoProgress(updated).missing.length === 0) {
      const by = after._pending.by; delete after._pending
      updated = await updateJob(req, job.id, { ...updated, photo_slots: JSON.stringify(after) })
      // Awaited: Catalyst freezes the function once the response goes out.
      await postToCliqChannel(DISPATCH_CHANNEL, `✅ *All photos in* · ${job.shop_name || 'Job'}${job.vehicle ? ' · ' + job.vehicle : ''} — the set from ${by}'s phone finished uploading. Good to invoice.`).catch(e => console.log('[photo-slot] cliq failed:', e.message))
    }
    console.log(`[photo-slot] job ${job.id} ← ${name}${miles != null ? ` (${miles} mi)` : ''}${ai ? ` [ai ${ai.slot} ${ai.confidence}]` : ''}`)
    res.json({ ok: true, slot: slotKey, miles, vin: vinInfo, name, fileId, job: updated, progress: photoProgress(updated) })
  } catch (err) {
    console.error('[photo-slot]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/jobs/:id/photos/reconcile — the sheet calls this when a tech
// opens a card that still shows shots owed, so a set that's already in the
// folder clears on the spot instead of at the next hourly pass.
router.post('/:id/photos/reconcile', async (req, res) => {
  try {
    const job = rowToJob(await getTable(req).getRow(req.params.id))
    if (!job) return res.status(404).json({ error: 'Job not found' })
    const r = await reconcilePhotosFromFolder(req, job)
    res.json({ ok: true, images: r.images ?? 0, cleared: !!r.cleared, missing: r.missing || [], job: r.job || job })
  } catch (e) { console.warn('[photos reconcile route]', e.message); res.status(500).json({ error: e.message }) }
})

// 🛞 Tire gate (Mark 2026-09-11): every job needs "all four set to the
// manufacturer spec" confirmed at Ready to Invoice. Same override as photos.
// Mark 2026-09-22: collision work only — repair-shop jobs and retail
// (person) jobs skip the inspection + tires. Dealers and body shops keep it.
const SAFETY_SKIP_TYPES = new Set(['repair_shop', 'retail'])
async function safetyGateApplies(req, merged) {
  if (merged?.customer?.kind === 'retail') return false
  try {
    const { findShopByName } = await import('../services/big3.js')
    const shop = await findShopByName(req, merged?.shop_name)
    const br = shop?.billing_rules ? (typeof shop.billing_rules === 'string' ? JSON.parse(shop.billing_rules || '{}') : shop.billing_rules) : {}
    if (br?.customer_type && SAFETY_SKIP_TYPES.has(br.customer_type)) return false
  } catch (e) { console.log('[tireGate] shop lookup failed (gate stays on):', e.message) }
  return true
}
async function tireGate(req, res, merged) {
  const isOwner = String(req.user?.email || '').toLowerCase().startsWith('mark@') || req.user?.role === 'owner'
  const override = String(req.body.photo_override || '').trim()
  if (isOwner && override) return false
  if (!(await safetyGateApplies(req, merged))) return false
  let c = null
  try { c = merged.pcsi_checks ? JSON.parse(merged.pcsi_checks) : null } catch { c = null }
  const missing = []
  if (!c?.belts) missing.push('seat belts')
  if (!c?.airbags) missing.push('airbag system')
  if (!String(merged.tires_set || '').trim() && !(c?.front || c?.rear)) missing.push('tire pressures')
  if (!missing.length) return false
  res.status(409).json({ error: `Post-collision safety inspection first — still need: ${missing.join(', ')}. Confirm it on the Ready to Invoice screen.`, tires_gate: true, pcsi_gate: true, missing })
  return true
}
// Payment line(s) for the Ready-to-Invoice channel post (Mark 2026-09-11:
// "put in the cash and then the dollar amount… make it very alert").
function payLines(job, insurer) {
  const q = String(job?.cash_quoted || '').trim()
  if (q) return [
    `\n💵💵💵 *CUSTOMER PAY — TOLD $${q}* 💵💵💵`,
    `*Bill as CASH · total must be $${q}*`,
  ]
  if (_cash.isCashCustomer(job)) return [`💵 *CASH CUSTOMER* · CP pricing · max $${_cash.CASH_MAX_OUT_OF_POCKET}`]
  return [`🏦 ${insurer}`]
}
// 💵 The tech picked $350 / $700 → the Books quote is capped at that number
// right away, so Kat's manual Convert and Bill it both land on the promise.
async function applyCashQuoted(req, job) {
  try {
    if (!job?.zoho_estimate_id || !job?.cash_quoted) return
    const { applyCashCapToEstimate } = await import('../services/estimateCash.js')
    const token = await getAccessToken()
    const r = await Promise.race([applyCashCapToEstimate(token, job.zoho_estimate_id, job.cash_quoted), new Promise(res => setTimeout(() => res({ timeout: true }), 8000))])
    console.log(`[cash-quoted] job ${job.id} → $${job.cash_quoted}: ${r?.timeout ? 'TIMEOUT' : r ? `list $${r.list_total} → $${r.total}${r.capped ? ' (cap line added)' : ' (under the number, no cap)'}` : 'no estimate'}`)
    if (r && !r.timeout) postToCliqChannel(DISPATCH_CHANNEL, `💵 Quote ${r.estimate_number} re-priced for customer pay: list $${r.list_total.toFixed(2)} → $${r.total.toFixed(2)}${r.capped ? ' (cap line added)' : ''}`).catch(() => {})
  } catch (e) { console.log('[cash-quoted] failed (non-fatal):', e.message) }
}
// Write the PCSI story onto the Books quote (fallback Post-Scan / first line).
// Runs before the response (Catalyst ends the function once res goes out).
async function writePcsiStory(req, job) {
  try {
    if (!job?.zoho_estimate_id || !job?.pcsi_checks) return
    const { buildStory, writeStoryToEstimate } = await import('../services/pcsiStory.js')
    const { photoProgress } = await import('../services/jobPhotos.js')
    const story = buildStory(job, null, photoProgress(job).miles?.delta ?? null)
    if (!story) return
    const token = await getAccessToken()
    const r = await Promise.race([writeStoryToEstimate(token, job.zoho_estimate_id, story), new Promise(res => setTimeout(() => res({ timeout: true }), 8000))])
    console.log(`[pcsi-story] job ${job.id} → ${r?.timeout ? 'TIMEOUT' : r ? `"${r.line}"${r.unchanged ? ' (unchanged)' : ''}` : 'no estimate line'}`)
  } catch (e) { console.log('[pcsi-story] failed (non-fatal):', e.message) }
}
// 💵 Customer pay relay (Mark 2026-09-11): the advisor tells the tech "that's
// customer pay" mid-job and a number ($350 / $700) gets quoted — Kat and
// #dispatch need to know both, and the card must read CASH from here on.
function relayCustomerPay(req, merged, prev) {
  const q = String(req.body.cash_quoted || '').trim()
  if (!q || String(prev?.cash_quoted || '') === q) return
  const { isCashInsurerOrBlank } = _cash
  if (!isCashInsurerOrBlank(merged.insurer)) merged.insurer = 'Customer Pay'
  const who = req.user?.techName || req.user?.name || req.user?.email || 'tech'
  const line = `💵 *CUSTOMER PAY · told $${q}* — ${merged.shop_name || 'Job'} · ${merged.vehicle || ''}${merged.quote_number ? ` · ${merged.quote_number}` : ''}\nby ${who} at Ready to Invoice — bill as cash, max $${q}.`
  postToCliqChannel(DISPATCH_CHANNEL, line).catch(() => {})
  createNotification(req, { to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com', type: 'ready_invoice', title: `💵 Customer pay · told $${q} · ${merged.shop_name || ''}`, body: `${merged.vehicle || ''} — ${who} says the customer was told $${q}. Bill as cash.`, jobId: req.params.id, job: merged, skipCliq: true, skipTechChannel: true }).catch(() => {})
  merged.notes = `${merged.notes ? merged.notes + '\n' : ''}💵 Customer pay — told $${q} (${who})`
}
import * as _cash from '../services/cashPricing.js'

// DELETE /api/jobs/:id/photo-slot/:slot[?fileId=] — remove a wrong photo
// (Mark 2026-09-10: "one of my technicians put the wrong pictures in
// there"). Clears the slot (or one setup entry by fileId), wipes the
// odometer reading for odo slots, and moves the WorkDrive file to Trash
// (best effort — the slot is cleared even if WorkDrive is slow).
router.delete('/:id/photo-slot/:slot', async (req, res) => {
  try {
    const { SLOTS, parseSlots, photoProgress } = await import('../services/jobPhotos.js')
    const slotKey = String(req.params.slot || '')
    const slotDef = SLOTS.find(s => s.key === slotKey)
    if (!slotDef) return res.status(400).json({ error: 'Unknown slot' })
    const table = getTable(req)
    const row = await table.getRow(req.params.id)
    if (!row) return res.status(404).json({ error: 'Job not found' })
    const job = rowToJob(row)
    const slots = parseSlots(job.photo_slots)
    const wantId = String(req.query.fileId || '')
    let removed = []
    if (slotDef.multi) {
      const keep = [], gone = []
      for (const e of slots.setup || []) ((wantId ? String(e.fileId) === wantId : false) ? gone : keep).push(e)
      if (!wantId && (slots.setup || []).length) gone.push(slots.setup.pop())   // no id → drop the newest
      slots.setup = wantId ? keep : (slots.setup || [])
      removed = gone
    } else {
      if (slots[slotKey]) removed = [slots[slotKey]]
      delete slots[slotKey]
    }
    const patch = { photo_slots: JSON.stringify(slots) }
    if (slotKey === 'odo_before') patch.odo_before = ''
    if (slotKey === 'odo_after') patch.odo_after = ''
    const updated = await updateJob(req, job.id, { ...job, ...patch })
    // Trash the files in WorkDrive after the slot is cleared.
    for (const e of removed) {
      if (!e?.fileId) continue
      try {
        const { trashFile } = await import('../services/workdrive.js')
        await trashFile(String(e.fileId), await getAccessToken())
      } catch (err) { console.log(`[photo-slot] trash failed for ${e.fileId}:`, err.message) }
    }
    console.log(`[photo-slot] job ${job.id} − ${slotKey}${wantId ? ' ' + wantId : ''} (${removed.length} file${removed.length === 1 ? '' : 's'})`)
    res.json({ ok: true, slot: slotKey, removed: removed.length, job: updated, progress: photoProgress(updated) })
  } catch (err) {
    console.error('[photo-slot delete]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/jobs/catalog — Books items for the tech's "add an item" picker
// at Ready to Invoice (Mark 2026-09-10: "have the technician add the
// actual item"). Cached 10 min. Services + goods, name/rate/type only.
let _catCache = { at: 0, items: [] }
router.get('/catalog', async (req, res) => {
  try {
    if (Date.now() - _catCache.at > 10 * 60 * 1000) {
      const { getItemCatalogForAudit } = await import('../services/zoho.js')
      const { allItems } = await getItemCatalogForAudit()
      _catCache = { at: Date.now(), items: (allItems || []).map(i => ({ item_id: i.item_id, name: i.name, rate: Number(i.rate) || 0, type: i.product_type || 'service' })).sort((a, b) => a.name.localeCompare(b.name)) }
    }
    res.json({ ok: true, items: _catCache.items })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/jobs/:id/photo-progress — checklist state for a card.
router.get('/:id/photo-progress', async (req, res) => {
  try {
    const { photoProgress, gateApplies, SLOTS } = await import('../services/jobPhotos.js')
    const row = await getTable(req).getRow(req.params.id)
    if (!row) return res.status(404).json({ error: 'Job not found' })
    const job = rowToJob(row)
    res.json({ ok: true, progress: photoProgress(job), gate: gateApplies(job), slots: SLOTS, photo_slots: job.photo_slots, odo_before: job.odo_before, odo_after: job.odo_after })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Internal WorkDrive link for the team — opens the WorkDrive APP on
// phones (every tech has it). The external zohoexternal link is
// view-only and stays reserved for shops/reports.
router.get('/:id/wd-folder', async (req, res) => {
  try {
    const table = getTable(req)
    const row = await table.getRow(req.params.id)
    if (!row) return res.status(404).json({ error: 'Job not found' })
    const job = rowToJob(row)
    const wdToken = await getAccessToken()
    const folderId = await resolveJobFolder(req, job, wdToken)
    if (!folderId) return res.status(404).json({ error: 'No WorkDrive folder for this job yet.' })
    res.json({ ok: true, url: `https://workdrive.zoho.com/folder/${folderId}` })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/jobs/:id/upload-photo
// Uploads a single file to the job's WorkDrive folder — resolves by any
// RO form, shop+vehicle, or creates the folder. Never a dead end.
const uploadSingle = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }).single('file')
router.post('/:id/upload-photo', (req, res) => {
  uploadSingle(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    try {
      const table = getTable(req)
      const row = await table.getRow(req.params.id)
      if (!row) return res.status(404).json({ error: 'Job not found' })
      const job = rowToJob(row)
      const wdToken = await getAccessToken()
      const folderId = await resolveJobFolder(req, job, wdToken)
      if (!folderId) return res.status(500).json({ error: 'Could not find or create a WorkDrive folder — check the WorkDrive connection.' })
      const filename = req.file.originalname || `photo-${Date.now()}.jpg`
      await uploadFileToFolder(folderId, filename, req.file.buffer, wdToken, req.file.mimetype)
      // The plain Upload button never filled a slot — count it against the set now.
      let rec = null; try { rec = await reconcilePhotosFromFolder(req, job) } catch (e) { console.log('[upload-photo] reconcile skipped:', e.message) }
      res.json({ ok: true, filename, job: rec?.job || undefined, photos: rec ? { images: rec.images, missing: rec.missing, cleared: rec.cleared } : undefined })
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
// A tech is ACTING on a scheduled request whose job isn't created yet →
// Kat gets an urgent Cliq + bell, once per job per day (Mark 2026-08-31:
// "tell kat they are working on the job and need the job created").
async function nudgeKatJobNeeded(req, job, action) {
  if ((job.status || '') !== 'job_requested') return
  try {
    const catalystMod = (await import('zcatalyst-sdk-node')).default
    const app = catalystMod.initialize(req)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const stampKey = `kat_nudge:${job.id}:${today}`.slice(0, 64)
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT ROWID FROM AppConfig WHERE config_key = '${stampKey}' LIMIT 1`).catch(() => [])
    if (rows?.length) return
    await app.datastore().table('AppConfig')
      .insertRow({ config_key: stampKey, config_value: new Date().toISOString() }).catch(() => {})
    const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
    const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js')
    await postToCliqChannel(DISPATCH_CHANNEL,
      `🚨 *${job.technician || 'Tech'} is ${action} — JOB NOT CREATED YET*\n` +
      `${job.shop_name || 'Shop'} · ${vehicle || 'Vehicle TBD'}${job.quote_number ? ` · RO ${job.quote_number}` : ''}\n` +
      `Kat — create the job from the card in Waiting-on-Kat now.`).catch(() => {})
    const { createNotification } = await import('./notifications.js')
    await createNotification(req, {
      to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com',
      type: 'job_requested',
      title: `🚨 ${job.technician || 'Tech'} working ${job.shop_name || 'a job'} — create the job`,
      body: `${vehicle || ''} — tech is ${action}, paperwork needed now`,
      jobId: job.id, job,
      skipCliq: true, skipTechChannel: true,
    }).catch(() => {})
  } catch (e) { console.warn('[kat-nudge]', e.message) }
}

// Tech's "I'm here" button (Mark 2026-09-05): posts the urgent create-
// this-job-ASAP ping to the dispatch channel + Kat's bell. Explicit
// button press, so it bypasses the once-a-day directions nudge — but a
// 10-minute stamp stops accidental double-taps from spamming Kat.
router.post('/:id/need-job-now', async (req, res) => {
  try {
    const jobs = await getAllJobs(req)
    const job = jobs.find(j => String(j.id) === String(req.params.id))
    if (!job) return res.status(404).json({ error: 'Job not found' })
    if ((job.status || '') !== 'job_requested') {
      return res.status(400).json({ error: 'This card is already a job.' })
    }
    const catalystMod = (await import('zcatalyst-sdk-node')).default
    const app = catalystMod.initialize(req)
    const bucket = Math.floor(Date.now() / 600000)  // 10-min window
    const stampKey = `need_job_now:${job.id}:${bucket}`.slice(0, 64)
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT ROWID FROM AppConfig WHERE config_key = '${stampKey}' LIMIT 1`).catch(() => [])
    if (rows?.length) return res.json({ ok: true, deduped: true })
    await app.datastore().table('AppConfig')
      .insertRow({ config_key: stampKey, config_value: new Date().toISOString() }).catch(() => {})

    const who = req.user?.techName || job.technician || 'Tech'
    const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
    const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js')
    await postToCliqChannel(DISPATCH_CHANNEL,
      `🚨 *${who} is AT THE CAR — needs this job created ASAP*\n` +
      `${job.shop_name || 'Shop'} · ${vehicle || 'Vehicle TBD'}${job.vin ? ` · VIN ${job.vin}` : ''}${job.quote_number ? ` · RO ${job.quote_number}` : ''}\n` +
      `Kat — create the job from the Job Requested card now.`).catch(() => {})
    const { createNotification } = await import('./notifications.js')
    await createNotification(req, {
      to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com',
      type: 'job_requested',
      title: `🚨 ${who} at ${job.shop_name || 'the shop'} — create the job ASAP`,
      body: `${vehicle || ''} — tech is at the car waiting on paperwork`,
      jobId: job.id, job,
      skipCliq: true, skipTechChannel: true,
    }).catch(() => {})
    res.json({ ok: true })
  } catch (e) {
    console.error('[need-job-now]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Route info for Head-to-the-Job: the REAL street address. The Books
// contacts LIST omits addresses entirely (documented in zoho.js) — the
// first version searched Maps by shop name and navigated a tech toward
// Montana (Mark, 2026-08-30). Full-contact fetch or bust.
router.get('/:id/route-info', async (req, res) => {
  try {
    const jobs = await getAllJobs(req)
    const job = jobs.find(j => String(j.id) === String(req.params.id))
    if (!job) return res.status(404).json({ error: 'Job not found' })
    nudgeKatJobNeeded(req, job, 'getting directions').catch(() => {})
    let address = '', matched = '', phoneOnFile = false
    try {
      const { listCustomers, getCustomerFull } = await import('../services/zoho.js')
      const customers = await listCustomers()
      const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const target = norm(job.shop_name)
      const hit = customers.find(c => norm(c.contact_name) === target || norm(c.company_name) === target)
        || customers.find(c => target && (norm(c.contact_name).includes(target) || target.includes(norm(c.contact_name))))
      if (hit) {
        matched = hit.contact_name
        phoneOnFile = !!(hit.phone || hit.mobile)
        const full = await getCustomerFull(hit.contact_id)
        const a = full?.billing_address || full?.shipping_address || {}
        address = [a.address, a.street2, a.city, a.state, a.zip].filter(Boolean).join(', ')
        if (!phoneOnFile) phoneOnFile = !!(full?.phone || full?.mobile)
      }
    } catch (e) { console.warn('[route-info] lookup failed:', e.message) }
    res.json({ ok: true, shop_matched: matched, address, phone_on_file: phoneOnFile })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Head to the Job (Mark 2026-08-30) ──────────────────────────────────
// One tap on the tech's Live view: looks up the shop's Books contact
// for address + phone, texts the shop that the tech is rolling, pings
// #dispatch, and hands the client a maps destination.
router.post('/:id/enroute', async (req, res) => {
  try {
    const jobs = await getAllJobs(req)
    const job = jobs.find(j => String(j.id) === String(req.params.id))
    if (!job) return res.status(404).json({ error: 'Job not found' })

    await nudgeKatJobNeeded(req, job, 'on the way').catch(() => {})
    const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
    const tech = req.body?.technician || job.technician || 'Your technician'
    const ro = job.quote_number || job.ro_number || ''

    const etaMin = Number(req.body?.eta_minutes) > 0 && Number(req.body?.eta_minutes) < 600
      ? Math.round(Number(req.body.eta_minutes)) : null

    // Shop lookup in Books — full contact (the list omits phone-less rows
    // and ALL addresses).
    let address = '', phone = '', matched = '', contactFirst = ''
    try {
      const { listCustomers, getCustomerFull } = await import('../services/zoho.js')
      const customers = await listCustomers()
      const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const target = norm(job.shop_name)
      const hit = customers.find(c => norm(c.contact_name) === target || norm(c.company_name) === target)
        || customers.find(c => target && (norm(c.contact_name).includes(target) || target.includes(norm(c.contact_name))))
      if (hit) {
        matched = hit.contact_name
        phone = hit.phone || hit.mobile || ''
        const full = await getCustomerFull(hit.contact_id).catch(() => null)
        if (full) {
          const a = full.billing_address || full.shipping_address || {}
          address = [a.address, a.street2, a.city, a.state, a.zip].filter(Boolean).join(', ')
          if (!phone) phone = full.phone || full.mobile || ''
          const persons = full.contact_persons || []
          const primary = persons.find(pp => pp.is_primary_contact) || persons[0]
          contactFirst = (primary?.first_name || full.first_name || '').trim()
        }
      }
    } catch (e) { console.warn('[enroute] customer lookup failed:', e.message) }

    // Text the shop — customer-facing: plain, no exclamation points.
    let texted = false
    if (phone) {
      try {
        const { sendTwilioSMS, normalizePhoneUS } = await import('../services/twilio.js')
        const { resolvePhoneConfig } = await import('../services/phoneConfig.js')
        const cfg = await resolvePhoneConfig(req)
        const to = normalizePhoneUS(phone)
        if (to) {
          // Mark's template (2026-08-30): "{vehicle}, RO {ro}. Hey
          // {contact_first}, it's {tech_first} with Absolute ADAS, about
          // {eta} minutes out. Reply here if anything's changed. See you
          // soon." Replies land in the 844 SMS inbox.
          const techFirst = String(tech).trim().split(/\s+/)[0]
          await sendTwilioSMS({
            to,
            body: `${vehicle || 'Your vehicle'}${ro ? `, RO ${ro}` : ''}. ` +
              `Hey ${contactFirst || 'there'}, it's ${techFirst} with Absolute ADAS, ` +
              `${etaMin ? `about ${etaMin} minutes out` : 'we will be there soon'}. ` +
              `Reply here if anything's changed. See you soon.`,
            from: 'tollfree',
            cfg,
          })
          texted = true
        }
      } catch (e) { console.warn('[enroute] SMS failed (non-fatal):', e.message) }
    }

    // Dispatch visibility
    try {
      const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js')
      await postToCliqChannel(DISPATCH_CHANNEL,
        `🚗 *${tech} en route* · ${job.shop_name || 'Shop'} · ${vehicle}${ro ? ` · RO ${ro}` : ''}${etaMin ? ` · ~${etaMin} min out` : ''}${texted ? ' · shop texted' : ' · ⚠ no shop phone on file'}`)
    } catch { /* non-fatal */ }

    res.json({
      ok: true,
      texted,
      shop_matched: matched,
      address,
      maps_query: address || job.shop_name || '',
    })
  } catch (e) {
    console.error('[enroute]', e.message)
    res.status(500).json({ error: e.message })
  }
})

export { getAllJobs as readJobsPublic, updateJob as updateJobPublic, deleteJob as deleteJobPublic, insertJob as insertJobPublic, resolveJobFolder as resolveJobFolderPublic }
export { findOpenRequestFor, insertJob, updateJob }   // text→job (2026-09-23)
export default router
