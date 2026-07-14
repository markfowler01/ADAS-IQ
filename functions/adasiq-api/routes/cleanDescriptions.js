// POST /api/clean-descriptions — AI cleanup for the Manual Invoice
// screen's per-calibration justification notes (Mark 2026-07-14).
// Body: { year, make, model, items: [{ name, description }] }
// Returns: { descriptions: [string, ...] } in the same order.

import express from 'express'
import { cleanCalibrationDescriptions } from '../services/claude.js'

const router = express.Router()

router.post('/', async (req, res) => {
  try {
    const { year, make, model, items } = req.body || {}
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required' })
    }
    if (items.length > 20) {
      return res.status(400).json({ error: 'too many items (max 20)' })
    }
    const descriptions = await cleanCalibrationDescriptions({
      year:  String(year  || ''),
      make:  String(make  || ''),
      model: String(model || ''),
      items: items.map(it => ({
        name: String(it?.name || ''),
        description: String(it?.description || ''),
      })),
    })
    res.json({ descriptions })
  } catch (err) {
    console.error('[clean-descriptions]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export { router as cleanDescriptionsRouter }
