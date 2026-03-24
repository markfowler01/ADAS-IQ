import express from 'express'
import { createDraftQuote } from '../services/zoho.js'

const router = express.Router()

router.post('/', async (req, res) => {
  const { customerId, customerName, salespersonId, salespersonName, shop, ro_number, insurer, vin, vehicle, year, make, model, claim, calibrations, pdfBase64, pdfFilename } = req.body

  // calibrations can be empty — the 3 fixed line items are always added by createDraftQuote

  try {
    const result = await createDraftQuote({
      customerId: customerId || null,
      customerName: customerName || null,
      salespersonId: salespersonId || null,
      salespersonName: salespersonName || null,
      shop,
      ro_number,
      vin,
      vehicle,
      year,
      make,
      model,
      insurer,
      claim,
      calibrations,
      pdfBase64: pdfBase64 || null,
      pdfFilename: pdfFilename || null,
    })
    res.json(result)
  } catch (err) {
    console.error('[invoice]', err.message)
    res.status(500).json({ error: err.message || 'Quote creation failed.' })
  }
})

export default router
