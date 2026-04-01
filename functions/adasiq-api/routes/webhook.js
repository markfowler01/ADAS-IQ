import express from 'express'
import { readJobsPublic, updateJobPublic } from './jobs.js'

const router = express.Router()

// POST /webhooks/zoho-books
// Called by Zoho Books when an invoice is created or sent
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
    const invoiceNumber  = invoice.invoice_number || invoice.number || ''
    const referenceNumber = (invoice.reference_number || invoice.reference || '').toString()
    const customerName   = (invoice.customer_name || invoice.contact_name || '').toLowerCase().trim()
    const status         = (invoice.status || '').toLowerCase()
    const vin            = invoice.custom_fields?.find?.(f =>
      f.label?.toLowerCase().includes('vin')
    )?.value || ''

    console.log(`[webhook] Invoice: #${invoiceNumber} ref="${referenceNumber}" customer="${customerName}" status="${status}"`)

    const invoicedStatuses = ['sent', 'accepted', 'paid', 'overdue', 'viewed', 'draft']
    if (!invoicedStatuses.includes(status) && status !== '') {
      return res.json({ success: true, message: `Status "${status}" does not trigger invoiced flag` })
    }

    // Get Catalyst auth from headers (injected by Catalyst for all incoming requests)
    const token     = req.headers['x-zc-admin-cred-token'] || req.headers['x-zc-user-cred-token'] || ''
    const projectId = req.headers['x-zc-projectid'] || '45874000000016010'

    const jobs = await readJobsPublic(token, projectId)
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
        console.warn(`[webhook] Ambiguous — ${customerJobs.length} unmatched jobs for "${customerName}". Skipping.`)
      }
    }

    if (!matchedJob) {
      console.log('[webhook] No matching job found for invoice', invoiceNumber)
      return res.json({ success: true, message: 'No matching job found', invoice_number: invoiceNumber })
    }

    // Update just this one job row — atomic, no overwrite risk
    await updateJobPublic(token, projectId, matchedJob.id, {
      ...matchedJob,
      invoiced:       true,
      invoice_number: invoiceNumber,
      invoice_status: status,
    })

    console.log(`[webhook] Marked job ${matchedJob.id} as invoiced (invoice ${invoiceNumber})`)
    res.json({ success: true, job_id: matchedJob.id, invoice_number: invoiceNumber })

  } catch (err) {
    console.error('[webhook] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
