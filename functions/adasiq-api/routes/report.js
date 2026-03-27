import express from 'express'
import { generateADASIQPdf } from '../services/pdf.js'

const router = express.Router()

router.post('/', async (req, res) => {
  const { ro_number } = req.body
  try {
    const buffer = await generateADASIQPdf(req.body)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="ADAS-IQ-${ro_number || 'report'}.pdf"`)
    res.send(buffer)
  } catch (err) {
    console.error('[report]', err.message)
    res.status(500).json({ error: 'PDF generation failed: ' + err.message })
  }
})

export default router
