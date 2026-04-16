import express from 'express'
import { generateADASIQPdf } from '../services/pdf.js'

const router = express.Router()

router.post('/', async (req, res) => {
  const { shop, ro_number, insurer, vin, vehicle, year, make, model, claim, calibrations, document_links } = req.body
  try {
    const buffer = await generateADASIQPdf({ shop, ro_number, insurer, vin, vehicle, year, make, model, claim, calibrations, document_links })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="ADAS-IQ-${ro_number || 'report'}.pdf"`)
    res.send(buffer)
  } catch (err) {
    console.error('[report] PDF generation failed:', err.message)
    res.status(500).json({ error: 'PDF generation failed.' })
  }
})

export default router
