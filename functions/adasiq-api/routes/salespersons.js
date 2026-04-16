import express from 'express'
import { listSalespersons } from '../services/zoho.js'

const router = express.Router()

const DEMO_SALESPERSONS = [
  { salesperson_id: 'demo-s1', salesperson_name: 'Mark Fowler' },
  { salesperson_id: 'demo-s2', salesperson_name: 'Tyler James' },
]

router.get('/', async (req, res) => {
  if (req.user?.demo) return res.json(DEMO_SALESPERSONS)
  try {
    const salespersons = await listSalespersons()
    res.json(salespersons)
  } catch (err) {
    console.error('[salespersons]', err.message)
    res.status(500).json({ error: err.message || 'Failed to fetch salespersons.' })
  }
})

export default router
