import express from 'express'
import { listCustomers } from '../services/zoho.js'

const router = express.Router()

router.get('/', async (req, res) => {
  try {
    const customers = await listCustomers()
    res.json(customers)
  } catch (err) {
    console.error('[customers]', err.message)
    res.status(500).json({ error: err.message || 'Failed to fetch customers.' })
  }
})

export default router
