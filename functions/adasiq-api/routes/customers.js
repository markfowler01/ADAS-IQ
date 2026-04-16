import express from 'express'
import { listCustomers } from '../services/zoho.js'

const router = express.Router()

const DEMO_CUSTOMERS = [
  { contact_id: 'demo-c1', contact_name: 'State Farm Insurance' },
  { contact_id: 'demo-c2', contact_name: 'GEICO' },
  { contact_id: 'demo-c3', contact_name: 'Allstate Insurance' },
  { contact_id: 'demo-c4', contact_name: 'Progressive Insurance' },
  { contact_id: 'demo-c5', contact_name: 'Farmers Insurance' },
]

router.get('/', async (req, res) => {
  if (req.user?.demo) return res.json(DEMO_CUSTOMERS)
  try {
    const customers = await listCustomers()
    res.json(customers)
  } catch (err) {
    console.error('[customers]', err.message)
    res.status(500).json({ error: err.message || 'Failed to fetch customers.' })
  }
})

export default router
