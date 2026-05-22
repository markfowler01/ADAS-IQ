import express from 'express'
import { readJobsPublic, updateJobPublic, performSyncQuotes } from './jobs.js'
import { postToCliqChannelById, postToCliqChannel, MARK_ALERT_CHANNEL_ID, TECHNICIANS_CHANNEL } from '../services/cliq.js'

const router = express.Router()

const JOB_BOARD_URL = 'https://adas-iq-904191467.development.catalystserverless.com/app/index.html'

// POST /webhooks/zoho-books
// Called by Zoho Books when an invoice is created or sent.
// Marks the matching job invoiced + posts an alert to Mark's channel.
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

    const invoice = payload.invoice || payload
    const invoiceNumber   = invoice.invoice_number || invoice.number || ''
    const referenceNumber = (invoice.reference_number || invoice.reference || '').toString()
    const customerName    = (invoice.customer_name || invoice.contact_name || '').toLowerCase().trim()
    const status          = (invoice.status || '').toLowerCase()
    const total           = invoice.total ?? invoice.total_amount ?? ''
    const vin             = invoice.custom_fields?.find?.(f =>
      f.label?.toLowerCase().includes('vin')
    )?.value || ''

    console.log(`[webhook] Invoice: #${invoiceNumber} ref="${referenceNumber}" customer="${customerName}" status="${status}" total="${total}"`)

    const totalStr = (total !== '' && total != null && !isNaN(Number(total)))
      ? `$${Number(total).toFixed(2)}`
      : ''

    // Only act once the invoice has actually been sent — skip drafts.
    const SENT_STATUSES = ['sent', 'viewed', 'accepted', 'paid', 'overdue']
    if (status && !SENT_STATUSES.includes(status)) {
      console.log(`[webhook] Status "${status}" — invoice not sent yet, skipping`)
      return res.json({ success: true, message: `Status "${status}" — not sent, skipped` })
    }

    const jobs = await readJobsPublic(req)
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
        return j.notes.toLowerCase().includes(invoiceNumber.toLowerCase())
      })
    }

    // Match strategy 3: customer name (only if exactly 1 match)
    if (!matchedJob && customerName) {
      const customerJobs = jobs.filter(j =>
        j.shop_name && j.shop_name.toLowerCase().trim() === customerName && !j.invoiced
      )
      if (customerJobs.length === 1) {
        matchedJob = customerJobs[0]
      } else if (customerJobs.length > 1) {
        console.warn(`[webhook] Ambiguous — ${customerJobs.length} unmatched jobs for "${customerName}". Skipping match.`)
      }
    }

    // No job matched — still alert Mark so an invoice never goes unnoticed.
    if (!matchedJob) {
      console.log('[webhook] No matching job found for invoice', invoiceNumber)
      const cliqMsg = [
        `💰 *Invoice Sent — #${invoiceNumber}*`,
        '',
        `🏢 ${customerName || 'Unknown customer'}`,
        referenceNumber ? `📋 RO#: ${referenceNumber}` : null,
        totalStr ? `💵 Total: ${totalStr}` : null,
        `⚠️ No matching job found in Absolute ADAS`,
        `\n🗂 Job Board: ${JOB_BOARD_URL}`,
      ].filter(l => l !== null).join('\n')
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, cliqMsg).catch(e =>
        console.warn('[webhook] Cliq alert failed (non-fatal):', e.message))
      return res.json({ success: true, message: 'No matching job — alert sent', invoice_number: invoiceNumber })
    }

    const wasAlreadyInvoiced = matchedJob.invoiced === true

    // Update just this one job row — atomic, no overwrite risk
    await updateJobPublic(req, matchedJob.id, {
      ...matchedJob,
      invoiced:       true,
      invoice_number: invoiceNumber,
      invoice_status: status,
    })
    console.log(`[webhook] Marked job ${matchedJob.id} as invoiced (invoice ${invoiceNumber})`)

    // Don't re-notify on a status-change re-fire (sent → viewed → paid).
    if (wasAlreadyInvoiced) {
      console.log('[webhook] Job was already invoiced — skipping duplicate alert')
      return res.json({ success: true, job_id: matchedJob.id, invoice_number: invoiceNumber, message: 'already invoiced' })
    }

    // Build the alert — RO#, vehicle, completion state, total
    const roNum = (matchedJob.notes || '').match(/RO#[:\s]*([^\s|,]+)/i)?.[1]
      || matchedJob.quote_number
      || referenceNumber
      || ''
    const vehicle = [matchedJob.year, matchedJob.make, matchedJob.model].filter(Boolean).join(' ')
      || matchedJob.vehicle || ''
    const isComplete = matchedJob.status === 'complete'

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
      `\n🗂 Job Board: ${JOB_BOARD_URL}`,
    ].filter(l => l !== null).join('\n')

    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, cliqMsg).catch(e =>
      console.warn('[webhook] Cliq alert failed (non-fatal):', e.message))

    // Simpler ping to #technicians — shop, RO#, vehicle, invoiced
    const techMsg = [
      `✅ *RO# ${roNum || 'N/A'} — invoiced*`,
      `🏢 ${matchedJob.shop_name || customerName || 'Unknown shop'}${vehicle ? ' · 🚗 ' + vehicle : ''}`,
    ].join('\n')
    await postToCliqChannel(TECHNICIANS_CHANNEL, techMsg).catch(e =>
      console.warn('[webhook] #technicians alert failed (non-fatal):', e.message))

    res.json({ success: true, job_id: matchedJob.id, invoice_number: invoiceNumber })

  } catch (err) {
    console.error('[webhook] Error:', err.message)
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
