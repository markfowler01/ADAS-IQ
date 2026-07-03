// GET /api/tech-stats?tech=Mark[&date=YYYY-MM-DD]
//
// Returns MTD invoiced-sales totals for one technician plus today's totals,
// so the Live Day scoreboard can render a live MTD progress bar without
// hitting Zoho on every render.
//
// Sales come from Zoho Books invoices (drafts excluded). Filter by
// salesperson_name — the picker on the invoice/estimate side always writes
// this field so it's the source of truth for "who sold it." Match is
// case-insensitive substring so "Mark Fowler" matches a query of "Mark"
// and "Jayden Goshorn" matches "Jayden".
//
// 5-min in-memory cache per (tech, dateStr) so a fleet of Live Day tabs
// doesn't hammer Zoho. Small cache — clears on cold container. Reset by
// bumping cache key or waiting for TTL.

import express from 'express'
import { listInvoicesForDateRange } from '../services/zoho.js'

const router = express.Router()

const DAILY_GOAL_DIVISOR = 20 // ~20 working days per month
const DEFAULT_MONTHLY_GOAL = 20000

// PT date helpers — MTD boundaries follow the tech's local calendar (PT).
function todayPT() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(new Date()) // YYYY-MM-DD
}
function monthStartPT(dateStr) {
  return dateStr.slice(0, 7) + '-01'
}

// ── Tiny in-memory cache ────────────────────────────────────────────────────
const cache = new Map()
const CACHE_TTL_MS = 5 * 60 * 1000
function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null }
  return hit.value
}
function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value })
  // Cheap cap — don't hoard entries across many techs/dates.
  if (cache.size > 50) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    cache.delete(oldest[0])
  }
}

// Match invoice.salesperson_name to a tech query.
// Mark → matches "Mark", "Mark Fowler". Jayden → matches "Jayden", "Jayden Goshorn".
// Case-insensitive substring both ways so partials on either side work.
function invoiceBelongsToTech(inv, tech) {
  const sp = String(inv.salesperson_name || '').toLowerCase().trim()
  const t  = String(tech || '').toLowerCase().trim()
  if (!sp || !t) return false
  return sp.includes(t) || t.includes(sp)
}

router.get('/', async (req, res) => {
  try {
    const requested = String(req.query.tech || '').trim()
    if (!requested) return res.status(400).json({ error: 'tech query param required' })

    // Privacy gate: technicians can only view their own stats. Admins/owners
    // can view anyone's.
    let tech = requested
    if (req.user?.role === 'technician') {
      const myName = String(req.user?.techName || '').trim()
      if (!myName) return res.status(403).json({ error: 'forbidden — no tech name on session' })
      if (myName.toLowerCase() !== requested.toLowerCase()) {
        return res.status(403).json({ error: 'forbidden — techs can only view their own stats' })
      }
      tech = myName
    }

    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
      ? String(req.query.date)
      : todayPT()
    const monthStart = monthStartPT(dateStr)
    const cacheKey = `${tech.toLowerCase()}|${dateStr}`

    let totals = cacheGet(cacheKey)
    if (!totals) {
      const invoices = await listInvoicesForDateRange(monthStart, dateStr)
      let mtd_sales = 0
      let today_sales = 0
      for (const inv of invoices) {
        if (!invoiceBelongsToTech(inv, tech)) continue
        const t = Number(inv.total || 0) || 0
        mtd_sales += t
        if (String(inv.date || '').slice(0, 10) === dateStr) today_sales += t
      }
      totals = { mtd_sales, today_sales }
      cacheSet(cacheKey, totals)
    }

    const mtd_goal = DEFAULT_MONTHLY_GOAL
    const daily_goal = Math.round(mtd_goal / DAILY_GOAL_DIVISOR)

    res.json({
      tech,
      date: dateStr,
      month: monthStart.slice(0, 7),
      mtd_sales: totals.mtd_sales,
      today_sales: totals.today_sales,
      mtd_goal,
      daily_goal,
      // NOTE: goal is a static default here. TechScoreboard on the frontend
      // reads its editable per-tech goal from localStorage today; a future
      // appConfig service can override this when it's restored.
    })
  } catch (e) {
    console.error('[tech-stats]', e.message, e.stack)
    res.status(500).json({ error: e.message })
  }
})

export default router
