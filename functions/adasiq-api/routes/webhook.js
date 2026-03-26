import express from 'express'
import axios from 'axios'
// Reuse jobs storage
import jobsRouter, { readJobsPublic, writeJobsPublic } from './jobs.js'

const router = express.Router()


// POST /webhooks/zoho-books
// Called by Zoho Books when an invoice is created or sent
router.post('/zoho-books', async (req, res) => {
  try {
    // Verify optional secret token
    const webhookSecret = process.env.WEBHOOK_SECRET
    if (webhookSecret) {
      const incomingSecret = req.headers['x-webhook-secret'] || req.query.secret || ''
      if (incomingSecret !== webhookSecret) {
        return res.status(401).json({ error: 'Unauthorized' })
      }
    }

    const payload = req.body
    console.log('[webhook] Zoho Books payload:', JSON.stringify(payload).slice(0, 500))

    // Zoho Books sends the invoice object — extract key fields
    // Payload structure: { invoice: { ... } } or direct invoice object
    const invoice = payload.invoice || payload

    const invoiceNumber = invoice.invoice_number || invoice.number || ''
    const referenceNumber = (invoice.reference_number || invoice.reference || '').toString()
    const customerName = (invoice.customer_name || invoice.contact_name || '').toLowerCase().trim()
    const status = (invoice.status || '').toLowerCase()
    const vin = invoice.custom_fields?.find?.(f =>
      f.label?.toLowerCase().includes('vin')
    )?.value || ''

    console.log(`[webhook] Invoice received: #${invoiceNumber} ref="${referenceNumber}" customer="${customerName}" status="${status}"`)

    // Only auto-mark invoiced for sent/accepted/paid invoices
    const invoicedStatuses = ['sent', 'accepted', 'paid', 'overdue', 'viewed', 'draft']
    if (!invoicedStatuses.includes(status) && status !== '') {
      return res.json({ success: true, message: `Status "${status}" does not trigger invoiced flag` })
    }

    const jobs = await readJobsPublic()
    let matchedJob = null

    // Match strategy 1: VIN match (most reliable)
    if (vin && vin.length > 5) {
      matchedJob = jobs.find(j => j.vin && j.vin.toUpperCase() === vin.toUpperCase() && !j.invoiced)
    }

    // Match strategy 2: reference_number contains RO# from job notes
    if (!matchedJob && referenceNumber) {
      matchedJob = jobs.find(j => {
        if (!j.notes) return false
        // notes format: "RO#: 10562 | Quote: BBR 10562.5"
        const roMatch = j.notes.match(/RO#[:\s]*(\S+)/i)
        if (roMatch) {
          const roNumber = roMatch[1].replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
          const refClean = referenceNumber.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
          if (roNumber && refClean && (refClean.includes(roNumber) || roNumber.includes(refClean))) return true
        }
        // Also check if notes contains the invoice number itself
        return j.notes.toLowerCase().includes(invoiceNumber.toLowerCase())
      })
    }

    // Match strategy 3: customer name + not yet invoiced
    // Only auto-match if exactly 1 unmatched job exists — multiple is too ambiguous
    if (!matchedJob && customerName) {
      const customerJobs = jobs.filter(j =>
        j.shop_name && j.shop_name.toLowerCase().trim() === customerName && !j.invoiced
      )
      if (customerJobs.length === 1) {
        matchedJob = customerJobs[0]
      } else if (customerJobs.length > 1) {
        console.warn(`[webhook] Ambiguous match — ${customerJobs.length} unmatched jobs for "${customerName}". Skipping auto-match to avoid marking the wrong job.`)
      }
    }

    if (!matchedJob) {
      console.log('[webhook] No matching job found for invoice', invoiceNumber)
      return res.json({ success: true, message: 'No matching job found', invoice_number: invoiceNumber })
    }

    // Mark the job as invoiced
    const updatedJob = {
      ...matchedJob,
      invoiced: true,
      invoice_number: invoiceNumber,
      invoice_status: status,
    }
    const updatedJobs = jobs.map(j => j.id === matchedJob.id ? updatedJob : j)
    await writeJobsPublic(updatedJobs)

    console.log(`[webhook] Marked job ${matchedJob.id} as invoiced (invoice ${invoiceNumber})`)
    res.json({ success: true, job_id: matchedJob.id, invoice_number: invoiceNumber })

  } catch (err) {
    console.error('[webhook] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
