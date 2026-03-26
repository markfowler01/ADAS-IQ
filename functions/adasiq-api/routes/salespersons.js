import express from 'express'
import { listSalespersons } from '../services/zoho.js'

const router = express.Router()

router.get('/', async (req, res) => {
  try {
    const salespersons = await listSalespersons()
    res.json(salespersons)
  } catch (err) {
    console.error('[salespersons]', err.message)
    res.status(500).json({ error: err.message || 'Failed to fetch salespersons.' })
  }
})

export default router
