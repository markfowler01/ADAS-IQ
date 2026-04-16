import express from 'express'
import { getExpenseAccounts, createExpense, getMileageTrips } from '../services/zoho.js'

const router = express.Router()

// GET /api/expenses/accounts — list expense accounts from Zoho Books
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await getExpenseAccounts()
    res.json({ ok: true, accounts })
  } catch (err) {
    console.error('[expenses] Failed to fetch accounts:', err.response?.data || err.message)
    res.status(500).json({ error: 'Failed to fetch expense accounts' })
  }
})

// POST /api/expenses — create an expense in Zoho Books
router.post('/', async (req, res) => {
  const { account_id, date, amount, description, reference_number, vehicle_name } = req.body
  if (!account_id || !date || !amount) {
    return res.status(400).json({ error: 'account_id, date, and amount are required' })
  }
  try {
    const result = await createExpense({ account_id, date, amount, description, reference_number, vehicle_name })
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[expenses] Failed to create expense:', err.response?.data || err.message)
    res.status(500).json({ error: err.response?.data?.message || 'Failed to create expense' })
  }
})

// GET /api/expenses/mileage — fetch mileage trips from Zoho Expense
router.get('/mileage', async (req, res) => {
  const page = parseInt(req.query.page) || 1
  try {
    const result = await getMileageTrips({ page, per_page: 50 })
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[expenses] Failed to fetch mileage:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
