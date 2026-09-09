import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { readJobsPublic, updateJobPublic, deleteJobPublic, performSyncQuotes } from './jobs.js'
import { postToCliqChannelById, postToCliqChannel, MARK_ALERT_CHANNEL_ID, TECHNICIANS_CHANNEL, DISPATCH_CHANNEL, AA_JOBS_CHANNEL } from '../services/cliq.js'
import { listInvoicesForDateRange, getAccessToken } from '../services/zoho.js'
import axios from 'axios'

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

// Alert-once claim (rebuilt 2026-09-09 after BBR 10908 alerted nobody):
//   • race-safe — Books fires 2-3 webhook payloads within 200ms; every
//     caller inserts, then the LOWEST ROWID wins, the rest stand down.
//   • releasable — if every channel fails, the winner deletes its claim
//     so the hourly sweep retries next hour instead of "already alerted".
const stampKeyFor = id => `invoice_alerted:${id}`.slice(0, 64)
async function claimInvoiceAlert(req, dedupId) {
  if (!dedupId) return { claimed: true, rowId: null }
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const key = stampKeyFor(dedupId).replace(/'/g, "''")
  const read = async () => (await app.zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = '${key}' LIMIT 10`) || [])
    .map(r => r?.AppConfig || r).filter(r => r?.ROWID).map(r => String(r.ROWID))
  if ((await read()).length) return { claimed: false }
  const ins = await app.datastore().table('AppConfig').insertRow({ config_key: stampKeyFor(dedupId), config_value: new Date().toISOString() })
  const mine = String(ins?.ROWID || '')
  const all = await read()
  const winner = all.map(x => BigInt(x)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0]
  if (!mine || String(winner) !== mine) return { claimed: false }
  return { claimed: true, rowId: mine }
}
async function releaseInvoiceAlert(req, rowId) {
  if (!rowId) return
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    await app.datastore().table('AppConfig').deleteRow(rowId)
    console.log('[invoice] alert claim released — sweep will retry')
  } catch (e) { console.log('[invoice] claim release failed:', e.message) }
}

// Cliq with retries + VISIBLE logging (console.warn never reaches the
// Catalyst log viewer, which is why 9:05 today left no trace).
async function cliqTry(label, fn, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      await fn()
      console.log(`[invoice] ✓ ${label}${i > 1 ? ` (attempt ${i})` : ''}`)
      return true
    } catch (e) {
      const msg = `${e.response?.status || ''} ${e.response?.data?.message || e.message}`.trim()
      console.log(`[invoice] ✗ ${label} attempt ${i}/${tries}: ${msg}`)
      if (i < tries) await new Promise(r => setTimeout(r, i === 1 ? 1500 : 3000))
    }
  }
  return false
}

// Bell + email fallback so an invoice is never silent even with Cliq down.
async function bellFallback(req, title, body) {
  try {
    const { createNotification } = await import('./notifications.js')
    for (const who of [{ to: 'Mark', toEmail: 'mf@absoluteadas.com' }, { to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com' }]) {
      await createNotification(req, { ...who, type: 'invoice_sent', title, body, skipCliq: true, skipTechChannel: true })
    }
    console.log('[invoice] ✓ bell+email fallback delivered')
    return true
  } catch (e) { console.log('[invoice] ✗ bell fallback failed:', e.message); return false }
}

// Same tombstone the board's DELETE writes (`deleted_estimate:<id>`) —
// performSyncQuotes skips tombstoned estimates on import.
async function tombstoneEstimate(req, estId) {
  if (!estId) return
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const key = `deleted_estimate:${estId}`.slice(0, 64)
    const existing = await app.zcql().executeZCQLQuery(
      `SELECT ROWID FROM AppConfig WHERE config_key = '${key.replace(/'/g, "''")}' LIMIT 1`
    )
    if (!existing?.[0]) {
      await app.datastore().table('AppConfig').insertRow({ config_key: key, config_value: new Date().toISOString() })
    }
  } catch (e) { console.log('[invoice] tombstone failed (non-fatal):', e.message) }
}

export async function processSentInvoice(req, invoice, jobsCache, opts = {}) {
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

  // Claim FIRST — matched or not, an invoice alerts exactly once. The
  // claim is released below if nothing got through.
  let alreadyAlerted = false
  let claimRow = null
  try {
    const c = await claimInvoiceAlert(req, invoiceNumber || referenceNumber)
    alreadyAlerted = !c.claimed
    claimRow = c.rowId
  } catch (e) {
    console.log('[invoice] claim check failed — sending anyway:', e.message)
  }

  const jobs = jobsCache || await readJobsPublic(req)
  let matchedJob = null

  let matchVia = null   // 'vin' | 'ro' | 'name' — name alone is a weak match

  // Match strategy 1: VIN (most reliable)
  if (vin && vin.length > 5) {
    matchedJob = jobs.find(j => j.vin && j.vin.toUpperCase() === vin.toUpperCase() && !j.invoiced)
    if (matchedJob) matchVia = 'vin'
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
    if (matchedJob) matchVia = 'ro'
  }

  // Match strategy 3: customer name (only if exactly 1 match)
  if (!matchedJob && customerName) {
    const customerJobs = jobs.filter(j =>
      j.shop_name && j.shop_name.toLowerCase().trim() === customerName && !j.invoiced
    )
    if (customerJobs.length === 1) { matchedJob = customerJobs[0]; matchVia = 'name' }
    else if (customerJobs.length > 1) {
      console.log(`[invoice] Ambiguous — ${customerJobs.length} unmatched jobs for "${customerName}". Skipping match.`)
    }
  }

  if (alreadyAlerted) {
    // Alerts already went out — just make sure the board is clean.
    // Mark 2026-09-08 ("why does this keep popping up"): this branch ran
    // every hour from the sweep and, on a NAME-ONLY match, deleted
    // whatever lone card that shop had — including a fresh sync-imported
    // request for a different vehicle. With no tombstone, the next sync
    // re-imported it and re-alerted. Now: only a VIN / RO match may
    // remove a card here, and the estimate is tombstoned so it stays gone.
    if (matchedJob && matchVia !== 'name') {
      await tombstoneEstimate(req, matchedJob.zoho_estimate_id)
      await deleteJobPublic(req, matchedJob.id)
        .then(() => console.log(`[invoice] Removed already-alerted job ${matchedJob.id} from board (matched by ${matchVia})`))
        .catch(e => console.log('[invoice] board cleanup failed (non-fatal):', e.message))
    } else if (matchedJob) {
      console.log(`[invoice] already-alerted #${invoiceNumber}: name-only match on job ${matchedJob.id} — leaving the card alone`)
    }
    return { action: 'already-alerted', invoice_number: invoiceNumber, job_id: matchedJob?.id, match: matchVia }
  }

  // No job matched — still alert so an invoice never goes unnoticed.
  // A replay (card already gone) fans out to #dispatch + #aajobs too.
  if (!matchedJob) {
    console.log('[invoice] No matching job found for invoice', invoiceNumber, opts.replay ? '(replay)' : '')
    const cliqMsg = [
      `💰 *Invoice Sent — #${invoiceNumber}*${opts.replay ? ' · 🔁 replayed' : ''}`,
      '',
      `🏢 ${customerName || 'Unknown customer'}`,
      referenceNumber ? `📋 RO#: ${referenceNumber}` : null,
      totalStr ? `💵 Total: ${totalStr}` : null,
      opts.replay ? `ℹ️ Card was already invoiced and off the board` : `⚠️ No matching job found in Absolute ADAS`,
    ].filter(l => l !== null).join('\n')
    const ok = []
    ok.push(await cliqTry('Mark alert channel', () => postToCliqChannelById(MARK_ALERT_CHANNEL_ID, cliqMsg)))
    if (opts.replay) {
      ok.push(await cliqTry('#dispatch', () => postToCliqChannel(DISPATCH_CHANNEL, cliqMsg)))
      ok.push(await cliqTry('#aajobs', () => postToCliqChannel(AA_JOBS_CHANNEL, `✅ *Invoiced* · ${customerName || 'Unknown'}${referenceNumber ? ' · RO# ' + referenceNumber : ''}${totalStr ? ' · ' + totalStr : ''}`)))
    }
    if (!ok.some(Boolean)) {
      const bell = await bellFallback(req, `Invoice sent: #${invoiceNumber}`, cliqMsg.replace(/\*/g, ''))
      if (!bell) await releaseInvoiceAlert(req, claimRow)
    }
    return { action: 'no-match-alerted', invoice_number: invoiceNumber, cliq: ok }
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
  catch (e) { console.log('[invoice] day-total bump failed (non-fatal):', e.message) }

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

  const techMsg = [
    `✅ *RO# ${roNum || 'N/A'} — invoiced*`,
    `🏢 ${matchedJob.shop_name || customerName || 'Unknown shop'}${vehicle ? ' · 🚗 ' + vehicle : ''}`,
  ].join('\n')
  const aaMsg = [
    `✅ *Invoiced* · ${matchedJob.shop_name || customerName || 'Unknown shop'}`,
    vehicle ? `🚗 ${vehicle}` : null,
    matchedJob.technician ? `👤 ${matchedJob.technician}` : null,
  ].filter(Boolean).join('\n')
  const dispatchMsg = [
    `💰 *Invoiced* · ${matchedJob.shop_name || customerName || 'Unknown shop'}`,
    vehicle ? `🚗 ${vehicle}` : null,
    totalStr ? `💵 ${totalStr}` : null,
    ...(acc ? [
      `──────────`,
      `📊 *Today: $${Number(acc.total).toFixed(2)}* · ${acc.count} invoice${acc.count === 1 ? '' : 's'}`,
    ] : []),
  ].filter(Boolean).join('\n')

  // Fan-out with retries; every result logged. If Cliq is down for all
  // four, fall back to bell+email for Mark + Kat; if even that fails,
  // release the claim so the hourly sweep tries again.
  const results = {
    mark: await cliqTry('Mark alert channel', () => postToCliqChannelById(MARK_ALERT_CHANNEL_ID, cliqMsg)),
    technicians: await cliqTry('#technicians', () => postToCliqChannel(TECHNICIANS_CHANNEL, techMsg)),
    aajobs: await cliqTry('#aajobs', () => postToCliqChannel(AA_JOBS_CHANNEL, aaMsg)),
    dispatch: await cliqTry('#dispatch', () => postToCliqChannel(DISPATCH_CHANNEL, dispatchMsg)),
  }
  if (!Object.values(results).some(Boolean)) {
    const bell = await bellFallback(req, `Invoice sent: #${invoiceNumber} · ${matchedJob.shop_name || customerName || ''}`, cliqMsg.replace(/\*/g, ''))
    if (!bell) await releaseInvoiceAlert(req, claimRow)
  }
  console.log(`[invoice] alert summary #${invoiceNumber}: ${JSON.stringify(results)}`)

  // Invoice is out the door — remove the card from the board. Tombstone
  // its estimate first so the hourly quote sync can't bring it back.
  await tombstoneEstimate(req, matchedJob.zoho_estimate_id)
  await deleteJobPublic(req, matchedJob.id)
    .then(() => console.log(`[invoice] Removed invoiced job ${matchedJob.id} from board`))
    .catch(e => console.log('[invoice] board cleanup failed (non-fatal):', e.message))

  return { action: 'alerted', invoice_number: invoiceNumber, job_id: matchedJob.id, cliq: results }
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

// POST /webhooks/zoho-books/replay  { invoice_number }  — owner or cron
// secret. Re-sends the alert for one invoice (Mark 2026-09-09: BBR 10908
// alerted nobody). Clears the claim, pulls the invoice from Books, runs
// the normal pipeline with replay=true.
router.post('/zoho-books/replay', async (req, res) => {
  try {
    const owner = String(req.user?.email || '').toLowerCase().startsWith('mark@') || req.user?.role === 'owner'
    const secret = String(process.env.BILLING_CRON_SECRET || process.env.MORNING_CRON_SECRET || 'morning-2026').trim()
    if (!owner && String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(403).json({ error: 'Owner only.' })
    const number = String(req.body?.invoice_number || req.query.invoice_number || '').trim()
    if (!number) return res.status(400).json({ error: 'invoice_number required' })
    const token = await getAccessToken()
    const r = await axios.get('https://www.zohoapis.com/books/v3/invoices', {
      headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { organization_id: process.env.ZOHO_ORGANIZATION_ID, invoice_number: number }, timeout: 15000,
    })
    const inv = (r.data?.invoices || []).find(i => String(i.invoice_number) === number) || r.data?.invoices?.[0]
    if (!inv) return res.status(404).json({ error: `Invoice ${number} not found in Books` })
    // clear any claim so the pipeline runs again
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const key = stampKeyFor(inv.invoice_number || inv.reference_number).replace(/'/g, "''")
    const rows = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = '${key}' LIMIT 10`)
    for (const row of rows || []) { const id = (row?.AppConfig || row)?.ROWID; if (id) await app.datastore().table('AppConfig').deleteRow(String(id)).catch(() => {}) }
    const result = await processSentInvoice(req, inv, null, { replay: true })
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[webhook replay]', err.message)
    res.status(500).json({ error: err.response?.data?.message || err.message })
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
