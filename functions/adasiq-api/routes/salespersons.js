import express from 'express'
import { listSalespersons } from '../services/zoho.js'

const router = express.Router()

// Mark 2026-08-27: the picker is Mark and Jayden ONLY. The raw Zoho
// Books /users list dragged in Joyce and Kat (and missed Jayden, who
// isn't a Books user). Only salesperson_name goes onto the estimate —
// Books auto-creates the record on first use — so Jayden needs no
// Books account; his real user_id is grafted on when one exists.
const SALES_TEAM = [
  { match: 'mark',   name: 'Mark Fowler',    email: 'mark@absoluteadas.com' },
  { match: 'jayden', name: 'Jayden Goshorn', email: 'jayden@absoluteadas.com' },
]

function toTeam(zohoUsers) {
  return SALES_TEAM.map(t => {
    const z = (zohoUsers || []).find(u =>
      String(u.name || '').toLowerCase().includes(t.match) ||
      String(u.email || '').toLowerCase().startsWith(t.match))
    return { user_id: z?.user_id || t.match, name: t.name, email: z?.email || t.email }
  })
}

router.get('/', async (req, res) => {
  if (req.user?.demo) return res.json(toTeam([]))
  try {
    res.json(toTeam(await listSalespersons()))
  } catch (err) {
    // Zoho hiccup: serve the static team instead of a broken picker
    console.warn('[salespersons] zoho fetch failed, static fallback:', err.message)
    res.json(toTeam([]))
  }
})

export default router
