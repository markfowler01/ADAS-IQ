import express from 'express'
import { listSalespersons } from '../services/zoho.js'

const router = express.Router()

// Mark 2026-08-27: the picker shows ONLY Mark and Jayden. The Zoho
// Books /users list this used to mirror includes office staff (Joyce,
// Kat) and misses Jayden entirely (he has no Books login). Books only
// receives salesperson_NAME on estimates/invoices, so a Books user
// account is not required — we keep Mark's real user_id when Books
// has it and synthesize ids otherwise.
const SALES_ROSTER = [
  { email: 'mark@absoluteadas.com',   name: 'Mark Fowler' },
  { email: 'jayden@absoluteadas.com', name: 'Jayden Goshorn' },
]

const DEMO_SALESPERSONS = [
  { salesperson_id: 'demo-s1', salesperson_name: 'Mark Fowler' },
  { salesperson_id: 'demo-s2', salesperson_name: 'Jayden Goshorn' },
]

router.get('/', async (req, res) => {
  if (req.user?.demo) return res.json(DEMO_SALESPERSONS)
  let books = []
  try {
    books = await listSalespersons()
  } catch (err) {
    console.warn('[salespersons] Books users lookup failed (roster still served):', err.message)
  }
  const out = SALES_ROSTER.map(r => {
    const u = books.find(u =>
      String(u.email || '').toLowerCase() === r.email ||
      String(u.name || '').trim().toLowerCase() === r.name.toLowerCase()
    )
    return {
      user_id: u?.user_id || `roster-${r.name.split(' ')[0].toLowerCase()}`,
      name: r.name,
      email: u?.email || r.email,
    }
  })
  res.json(out)
})

export default router
