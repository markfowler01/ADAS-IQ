import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { readJobsPublic, updateJobPublic, deleteJobPublic, performSyncQuotes } from './jobs.js'
import { postToCliqChannelById, postToCliqChannel, MARK_ALERT_CHANNEL_ID, TECHNICIANS_CHANNEL, DISPATCH_CHANNEL, AA_JOBS_CHANNEL } from '../services/cliq.js'
import { listInvoicesForDateRange } from '../services/zoho.js'

// Running per-day invoiced total for the #Dispatch summary (Mark
// 2026-07-11). One AppConfig row per PT day:
//   config_key  invoiced_day_total:<YYYY-MM-DD>
//   config_value {"total":1234.56,"count":3}
// Read-modify-write is fine at invoice frequency (a handful per day).
const DAY_TOTAL_TABLE = 'AppConfig'
function dayKeyPT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
async function bumpDayInvoiceTotal(req, amount) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const key = `invoiced_day_total:${dayKeyPT()}`
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID, config_value FROM ${DAY_TOTAL_TABLE} WHERE config_key = '${key}' LIMIT 1`
  )
  const r = rows?.[0]?.[DAY_TOTAL_TABLE] || rows?.[0] || null
  let acc = { total: 0, count: 0 }
  if (r?.config_value) {
    try { acc = JSON.parse(r.config_value) } catch { acc = { total: 0, count: 0 } }
  }
  acc.total = Math.round((Number(acc.total || 0) + amount) * 100) / 100
  acc.count = Number(acc.count || 0) + 1
  const table = app.datastore().table(DAY_TOTAL_TABLE)
  if (r?.ROWID) {
    await table.updateRow({ ROWID: String(r.ROWID), config_key: key, config_value: JSON.stringify(acc) })
  } else {
    await table.insertRow({ config_key: key, config_value: JSON.stringify(acc) })
  }
  return acc
}

const router = express.Router()


// ── Shared invoice pipeline ─────────────────────────────────────────────────
// One code path for BOTH delivery mechanisms:
//   • push — Zoho Books webhook (instant, but Books-side config can
//     silently break: wrong action type, auto-disable, etc.)
//   • pull — hourly sweep over Books' sent invoices (guaranteed catch-up)
// Dedup (AppConfig stamp per invoice number) runs FIRST so however many
// times an invoice arrives — webhook refires, hourly sweeps — alerts go
// out exactly once. partially_paid included: the sweep sees invoices in
// every post-sent state.
const SENT_STATUSES = ['sent', 'viewed', 'accepted', 'partially_paid', 'paid', 'overdue']

async function checkAndStampAlerted(req, dedupId) {
  if (!dedupId) return false
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const stampKey = `invoice_alerted:${dedupId}`.slice(0, 64)
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID FROM AppConfig WHERE config_key = '${stampKey.replace(/'/g, "''")}' LIMIT 1`
  )
  if (rows?.[0]) return true
  await app.datastore().table('AppConfig').insertRow({
    config_key: stampKey, config_value: new Date().toISOString(),
  })
  return false
}

export async function processSentInvoice(req, invoice, jobsCache) {
  const invoiceNumber   = invoice.invoice_number || invoice.number || ''
  const referenceNumber = (invoice.reference_number || invoice.reference || '').toString()
  const customerName    = (invoice.customer_name || invoice.contact_name || '').toLowerCase().trim()
  const status          = (invoice.status || '').toLowerCase()
  const total           = invoice.total ?? invoice.total_amount ?? ''
  const vin             = invoice.custom_fields?.find?.(f =>
    f.label?.toLowerCase().includes('vin')
  )?.value || ''

  const totalStr = (total !== '' && total != null && !isNaN(Number(total)))
    ? `$${Number(total).toFixed(2)}`
    : ''

  if (status && !SENT_STATUSES.includes(status)) {
    return { action: 'skipped', reason: `status "${status}" — not sent` }
  }

  // Dedup FIRST — matched or not, an invoice alerts exactly once.
  let alreadyAlerted = false
  try {
    alreadyAlerted = await checkAndStampAlerted(req, invoiceNumber || referenceNumber)
  } catch (e) {
    console.warn('[invoice] dedup check failed — sending anyway:', e.message)
  }

  const jobs = jobsCache || await readJobsPublic(req)
  let matchedJob = null

  // Match strategy 1: VIN (most reliable)
  if (vin && vin.length > 5) {
    matchedJob = jobs.find(j => j.vin && j.vin.toUpperCase() === vin.toUpperCase() && !j.invoiced)
  }

  // Match strategy 2: reference_number contains RO# from job notes
  if (!matchedJob && referenceNumber) {
    matchedJob = jobs.find(j => {
      if (!j.notes) return false
      const roMatch = j.notes.match(/RO#[:\s]*(\S+)/i)
      if (roMatch) {
        const roNumber = roMatch[1].replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
        const refClean = referenceNumber.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
        if (roNumber && refClean && (refClean.includes(roNumber) || roNumber.includes(refClean))) return true
      }
      return invoiceNumber ? j.notes.toLowerCase().includes(invoiceNumber.toLowerCase()) : false
    })
  }

  // Match strategy 3: customer name (only if exactly 1 match)
  if (!matchedJob && customerName) {
    const customerJobs = jobs.filter(j =>
      j.shop_name && j.shop_name.toLowerCase().trim() === customerName && !j.invoiced
    )
    if (customerJobs.length === 1) matchedJob = customerJobs[0]
    else if (customerJobs.length > 1) {
      console.warn(`[invoice] Ambiguous — ${customerJobs.length} unmatched jobs for "${customerName}". Skipping match.`)
    }
  }

  if (alreadyAlerted) {
    // Alerts already went out — just make sure the board is clean.
    if (matchedJob) {
      await deleteJobPublic(req, matchedJob.id)
        .then(() => console.log(`[invoice] Removed already-alerted job ${matchedJob.id} from board`))
        .catch(e => console.warn('[invoice] board cleanup failed (non-fatal):', e.message))
    }
    return { action: 'already-alerted', invoice_number: invoiceNumber, job_id: matchedJob?.id }
  }

  // No job matched — still alert Mark so an invoice never goes unnoticed.
  if (!matchedJob) {
    console.log('[invoice] No matching job found for invoice', invoiceNumber)
    const cliqMsg = [
      `💰 *Invoice Sent — #${invoiceNumber}*`,
      '',
      `🏢 ${customerName || 'Unknown customer'}`,
      referenceNumber ? `📋 RO#: ${referenceNumber}` : null,
      totalStr ? `💵 Total: ${totalStr}` : null,
      `⚠️ No matching job found in Absolute ADAS`,
    ].filter(l => l !== null).join('\n')
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, cliqMsg).catch(e =>
      console.warn('[invoice] Cliq alert failed (non-fatal):', e.message))
    return { action: 'no-match-alerted', invoice_number: invoiceNumber }
  }

  // Update just this one job row — atomic, no overwrite risk
  await updateJobPublic(req, matchedJob.id, {
    ...matchedJob,
    invoiced:       true,
    invoice_number: invoiceNumber,
    invoice_status: status,
  })
  console.log(`[invoice] Marked job ${matchedJob.id} as invoiced (invoice ${invoiceNumber})`)

  // Build the alert — RO#, vehicle, completion state, total
  const roNum = (matchedJob.notes || '').match(/RO#[:\s]*([^\s|,]+)/i)?.[1]
    || matchedJob.quote_number
    || referenceNumber
    || ''
  const vehicle = [matchedJob.year, matchedJob.make, matchedJob.model].filter(Boolean).join(' ')
    || matchedJob.vehicle || ''
  const isComplete = matchedJob.status === 'complete'

  // Day accumulator once — feeds Mark's alert channel and #Dispatch.
  let acc = null
  try { acc = await bumpDayInvoiceTotal(req, Number(total) || 0) }
  catch (e) { console.warn('[invoice] day-total bump failed (non-fatal):', e.message) }

  const cliqMsg = [
    `💰 *Invoice Sent — #${invoiceNumber}*`,
    '',
    `🏢 ${matchedJob.shop_name || customerName || 'Unknown shop'}`,
    roNum ? `📋 RO#: ${roNum}` : null,
    vehicle ? `🚗 ${vehicle}${matchedJob.vin ? ' · VIN: ' + matchedJob.vin : ''}` : null,
    `🏦 ${matchedJob.insurer || 'Customer Pay (CP)'}`,
    isComplete
      ? '✅ Job completed'
      : `⚠️ Job NOT marked complete (status: ${(matchedJob.status || 'unknown').replace(/_/g, ' ')})`,
    totalStr ? `💵 Total: ${totalStr}` : null,
    acc ? `📊 Today's revenue: $${Number(acc.total).toFixed(2)} · ${acc.count} invoice${acc.count === 1 ? '' : 's'}` : null,
  ].filter(l => l !== null).join('\n')

  await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, cliqMsg).catch(e =>
    console.warn('[invoice] Cliq alert failed (non-fatal):', e.message))

  // Simpler ping to #technicians — shop, RO#, vehicle, invoiced
  const techMsg = [
    `✅ *RO# ${roNum || 'N/A'} — invoiced*`,
    `🏢 ${matchedJob.shop_name || customerName || 'Unknown shop'}${vehicle ? ' · 🚗 ' + vehicle : ''}`,
  ].join('\n')
  await postToCliqChannel(TECHNICIANS_CHANNEL, techMsg).catch(e =>
    console.warn('[invoice] #technicians alert failed (non-fatal):', e.message))

  // Quick #aajobs ping (Mark 2026-07-13): shop, vehicle, tech, invoiced.
  try {
    const aaMsg = [
      `✅ *Invoiced* · ${matchedJob.shop_name || customerName || 'Unknown shop'}`,
      vehicle ? `🚗 ${vehicle}` : null,
      matchedJob.technician ? `👤 ${matchedJob.technician}` : null,
    ].filter(Boolean).join('\n')
    await postToCliqChannel(AA_JOBS_CHANNEL, aaMsg)
  } catch (e) {
    console.warn('[invoice] #aajobs invoiced ping failed (non-fatal):', e.message)
  }

  // #Dispatch invoice summary + running day total (Mark 2026-07-11).
  try {
    const dispatchMsg = [
      `💰 *Invoiced* · ${matchedJob.shop_name || customerName || 'Unknown shop'}`,
      vehicle ? `🚗 ${vehicle}` : null,
      totalStr ? `💵 ${totalStr}` : null,
      ...(acc ? [
        `──────────`,
        `📊 *Today: $${Number(acc.total).toFixed(2)}* · ${acc.count} invoice${acc.count === 1 ? '' : 's'}`,
      ] : []),
    ].filter(Boolean).join('\n')
    await postToCliqChannel(DISPATCH_CHANNEL, dispatchMsg)
  } catch (e) {
    console.warn('[invoice] #Dispatch day-total alert failed (non-fatal):', e.message)
  }

  // Invoice is out the door — remove the card from the board.
  await deleteJobPublic(req, matchedJob.id)
    .then(() => console.log(`[invoice] Removed invoiced job ${matchedJob.id} from board`))
    .catch(e => console.warn('[invoice] board cleanup failed (non-fatal):', e.message))

  return { action: 'alerted', invoice_number: invoiceNumber, job_id: matchedJob.id }
}

// Pull-based backstop (Mark 2026-07-13, after the Books workflow rule
// turned out to have no webhook action at all): sweep the last two PT
// days of Books invoices and run anything unstamped through the same
// pipeline. Rides the hourly postscan cron; also manually triggerable
// via POST /webhooks/zoho-books/sweep.
export async function sweepSentInvoices(req) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const y = new Date(today + 'T12:00:00Z'); y.setUTCDate(y.getUTCDate() - 1)
  const yesterday = y.toISOString().slice(0, 10)

  const invoices = await listInvoicesForDateRange(yesterday, today)
  const jobs = await readJobsPublic(req)
  const results = []
  for (const inv of invoices) {
    try {
      const r = await processSentInvoice(req, inv, jobs)
      results.push({ invoice: inv.invoice_number, ...r })
    } catch (e) {
      results.push({ invoice: inv.invoice_number, action: 'error', error: e.message })
    }
  }
  return results
}

// POST /webhooks/zoho-books
// Called by Zoho Books when an invoice is created or sent.
router.post('/zoho-books', async (req, res) => {
  try {
    const webhookSecret = process.env.WEBHOOK_SECRET
    if (webhookSecret) {
      const incomingSecret = req.headers['x-webhook-secret'] || req.query.secret || ''
      if (incomingSecret !== webhookSecret) {
        return res.status(401).json({ error: 'Unauthorized' })
      }
    }
    const payload = req.body
    console.log('[webhook] Zoho Books payload:', JSON.stringify(payload).slice(0, 500))
    const result = await processSentInvoice(req, payload.invoice || payload)
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('[webhook] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /webhooks/zoho-books/sweep — manual/cron trigger for the pull
// backstop. Same optional-secret gate as the webhook.
router.post('/zoho-books/sweep', async (req, res) => {
  try {
    const webhookSecret = process.env.WEBHOOK_SECRET
    if (webhookSecret) {
      const incomingSecret = req.headers['x-webhook-secret'] || req.query.secret || ''
      if (incomingSecret !== webhookSecret) {
        return res.status(401).json({ error: 'Unauthorized' })
      }
    }
    const results = await sweepSentInvoices(req)
    res.json({ success: true, count: results.length, results })
  } catch (err) {
    console.error('[webhook sweep] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /webhooks/zoho-books-estimate
// Called by Zoho Books when a quote/estimate is created or updated.
// Triggers a sync so the new quote immediately appears in Need to Dispatch.
router.post('/zoho-books-estimate', async (req, res) => {
  try {
    const webhookSecret = process.env.WEBHOOK_SECRET
    if (webhookSecret) {
      const incomingSecret = req.headers['x-webhook-secret'] || req.query.secret || ''
      if (incomingSecret !== webhookSecret) {
        return res.status(401).json({ error: 'Unauthorized' })
      }
    }

    const payload = req.body
    console.log('[webhook estimate] Zoho Books estimate payload:', JSON.stringify(payload).slice(0, 500))

    const result = await performSyncQuotes(req)
    console.log(`[webhook estimate] Sync complete — created: ${result.created}, removed: ${result.removed}`)
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('[webhook estimate] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
