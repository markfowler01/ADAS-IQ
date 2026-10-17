import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { durable } from '../services/durableKV.js'

const router = express.Router()

// ── Cache helpers ────────────────────────────────────────────────────────────

function getSegment(req) {
  return durable(catalyst.initialize(req).cache().segment(), catalyst.initialize(req))
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

async function cacheSet(segment, key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  try { await segment.update(key, str) }
  catch (e) { await segment.put(key, str) }
}

async function cacheGet(segment, key, fallback = null) {
  try {
    const val = await segment.getValue(key)
    return val ? JSON.parse(val) : fallback
  } catch (e) {
    if (isNotFound(e)) return fallback
    throw e
  }
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  tiers: [
    { threshold: 0,      rate: 0.03,  label: 'Starting rate: 3%' },
    { threshold: 40000,  rate: 0.02,  label: '$40K+: 2%' },
    { threshold: 80000,  rate: 0.015, label: '$80K+: 1.5%' },
    { threshold: 120000, rate: 0.01,  label: '$120K+: 1%' },
  ],
  period: 'monthly',
  include_insurance_invoices: true,
  include_shop_invoices: true,
  active: true,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(req) {
  return req.user?.email || req.user?.id || req.user?.name || 'unknown'
}

function isAdmin(req) {
  return req.user?.role !== 'technician'
}

// Jayden's field-tech letter (Mark 2026-10-17 "yes"): no bonus under $40,000
// cash for the month; over that, 5% of revenue above $40,000 when the month
// is $40,000-$55,000, 8% of revenue above $40,000 when the month is over
// $55,000. Not marginal: the rate covers everything above $40,000.
// Ignores the old bonus_config tiers. TODO: Calibration ID / pass-through fees.
const CONTRACT = { threshold: 40000, tiers: [{ up_to: 55000, rate: 0.05 }, { up_to: null, rate: 0.08 }] }
function calculateBonus(revenue) {
  const { threshold, tiers } = CONTRACT
  if (revenue <= threshold) return { bonus: 0, breakdown: [] }
  const t = tiers.find(x => x.up_to === null || revenue <= x.up_to)
  const above = revenue - threshold
  const bonus = Math.round(above * t.rate * 100) / 100
  return { bonus, breakdown: [{ tier: { threshold, rate: t.rate, label: `${t.rate * 100}% of revenue above $40K` }, revenue_in_tier: above, bonus_in_tier: bonus }] }
}

// Match period to date ranges
function periodToRange(period) {
  const now = new Date()
  if (/^\d{4}-\d{2}$/.test(period)) {
    // Specific month like "2026-04"
    const [y, m] = period.split('-').map(Number)
    const start = new Date(y, m - 1, 1)
    const end = new Date(y, m, 1)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  if (period === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  if (period === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const end = new Date(now.getFullYear(), now.getMonth(), 1)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  if (period === 'ytd') {
    const start = new Date(now.getFullYear(), 0, 1)
    return { start: start.toISOString(), end: now.toISOString() }
  }
  if (period === 'this_quarter') {
    const q = Math.floor(now.getMonth() / 3)
    const start = new Date(now.getFullYear(), q * 3, 1)
    const end = new Date(now.getFullYear(), q * 3 + 3, 1)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  // Default: this month
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

// Load invoices via the books storage pattern (shared keys)
async function readInvoices(req) {
  const segment = getSegment(req)
  try {
    const meta = await cacheGet(segment, 'books_invoices_meta', null)
    if (meta && meta.chunks > 0) {
      const parts = await Promise.all(
        Array.from({ length: meta.chunks }, (_, i) =>
          cacheGet(segment, `books_invoices_chunk_${i}`, [])
        )
      )
      return parts.flat()
    }
  } catch (e) { /* fall through */ }
  return []
}

// Load jobs for technician lookup
async function readJobs(req) {
  const segment = getSegment(req)
  try {
    const meta = await cacheGet(segment, 'adas_jobs_meta', null)
    if (meta && meta.chunks > 0) {
      const parts = await Promise.all(
        Array.from({ length: meta.chunks }, (_, i) =>
          cacheGet(segment, `adas_jobs_chunk_${i}`, [])
        )
      )
      return parts.flat()
    }
    // Fallback: try unchunked
    return await cacheGet(segment, 'adas_jobs', [])
  } catch (e) {
    return []
  }
}

// 💵 Bonus revenue = cash received, after discount, by payment date (Mark
// 2026-10-17: "everything to be cash ... including technician bonuses 100%").
// A payment counts for the tech named as salesperson on the invoice it paid.
// Was: legacy Cache invoices with no technician field (so per-tech was ~$0).
const dayOf = iso => String(iso).slice(0, 10)
const dayBefore = iso => { const d = new Date(dayOf(iso) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
async function cashRows(req, start, end) {
  const k = `${start}|${end}`
  req._cashRows = req._cashRows || {}
  if (!req._cashRows[k]) { const { listCashForDateRange } = await import('../services/cashRevenue.js'); req._cashRows[k] = listCashForDateRange(req, dayOf(start), dayBefore(end)) }
  return req._cashRows[k]
}
// user id → the name on Books invoices (salesperson). Emails resolve through the Directory.
async function techNameFor(req, userId) {
  const u = String(userId || '')
  if (!u.includes('@')) return u
  if (u.toLowerCase() === String(req.user?.email || '').toLowerCase() && (req.user?.techName || req.user?.name)) return req.user.techName || req.user.name
  try { const { readTeamMembers } = await import('./team.js'); const m = (await readTeamMembers(req)).find(x => [x.email, x.personal_email].some(e => String(e || '').toLowerCase() === u.toLowerCase())); if (m?.name) return m.name } catch { /* fall through */ }
  return u.split('@')[0]
}
async function getRevenueForUser(req, userId, start, end) {
  const { invoiceBelongsToTech } = await import('./dailyGreeting.js')
  const name = await techNameFor(req, userId)
  let revenue = 0
  const invoiceList = []
  for (const r of await cashRows(req, start, end)) {
    if (!r.salesperson_name || !invoiceBelongsToTech(r, name)) continue
    revenue += Number(r.total) || 0
    invoiceList.push({ id: r.payment_id, invoice_number: r.invoice_number, customer_name: r.customer_name, total: r.total, paid_at: r.date })
  }
  return { revenue: Math.round(revenue * 100) / 100, invoices: invoiceList }
}

// ── Endpoints ────────────────────────────────────────────────────────────────

// Get bonus config
router.get('/config', async (req, res) => {
  try {
    const segment = getSegment(req)
    const config = await cacheGet(segment, 'bonus_config', DEFAULT_CONFIG)
    res.json(config)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Update bonus config (admin)
router.put('/config', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const config = { ...DEFAULT_CONFIG, ...req.body }
    await cacheSet(segment, 'bonus_config', config)
    res.json(config)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Calculate bonus for one user
router.get('/calculate', async (req, res) => {
  try {
    const segment = getSegment(req)
    const config = await cacheGet(segment, 'bonus_config', DEFAULT_CONFIG)
    const userId = req.query.user_id || getUserId(req)
    const period = req.query.period || 'this_month'

    // Non-admins can only see their own
    if (!isAdmin(req) && userId !== getUserId(req)) {
      return res.status(403).json({ error: 'Can only view your own bonus' })
    }

    const { start, end } = periodToRange(period)
    const { revenue, invoices } = await getRevenueForUser(req, userId, start, end, config)
    const calc = calculateBonus(revenue, config.tiers)

    // Progress to next tier
    const nextTier = revenue < 40000 ? { threshold: 40000, rate: 0.05 } : revenue <= 55000 ? { threshold: 55001, rate: 0.08 } : null

    res.json({
      user_id: userId,
      period,
      period_start: start,
      period_end: end,
      total_revenue: revenue,
      bonus_amount: calc.bonus,
      breakdown: calc.breakdown,
      next_tier: nextTier ? {
        threshold: nextTier.threshold,
        rate: nextTier.rate,
        revenue_to_next: nextTier.threshold - revenue,
      } : null,
      invoice_count: invoices.length,
      invoices,
    })
  } catch (e) {
    console.error('[bonuses] calculate failed:', e)
    res.status(500).json({ error: e.message })
  }
})

// Calculate all users (admin)
router.get('/all', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const config = await cacheGet(segment, 'bonus_config', DEFAULT_CONFIG)
    const period = req.query.period || 'this_month'
    const { start, end } = periodToRange(period)

    // Techs = salespeople on the invoices that money came in for.
    const techs = new Set((await cashRows(req, start, end)).map(r => String(r.salesperson_name || '').trim()).filter(Boolean))

    const results = []
    for (const tech of techs) {
      const { revenue, invoices: invs } = await getRevenueForUser(req, tech, start, end, config)
      if (revenue === 0) continue
      const calc = calculateBonus(revenue, config.tiers)
      results.push({
        user_id: tech,
        total_revenue: revenue,
        bonus_amount: calc.bonus,
        invoice_count: invs.length,
      })
    }

    results.sort((a, b) => b.total_revenue - a.total_revenue)
    res.json({ period, period_start: start, period_end: end, results })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Payout history
router.get('/history', async (req, res) => {
  try {
    const segment = getSegment(req)
    const payouts = await cacheGet(segment, 'bonus_payouts', [])
    const userId = req.query.user_id || getUserId(req)

    if (!isAdmin(req) && userId !== getUserId(req)) {
      return res.status(403).json({ error: 'Can only view your own history' })
    }

    const filtered = userId === 'all' && isAdmin(req)
      ? payouts
      : payouts.filter(p => p.user_id === userId)

    filtered.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    res.json(filtered)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Record payout (admin)
router.post('/payouts', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const payouts = await cacheGet(segment, 'bonus_payouts', [])

    const payout = {
      id: `payout_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      user_id: req.body.user_id,
      period: req.body.period,
      amount: Number(req.body.amount) || 0,
      notes: req.body.notes || '',
      paid_by: getUserId(req),
      created_at: new Date().toISOString(),
    }
    payouts.push(payout)
    await cacheSet(segment, 'bonus_payouts', payouts)
    res.json(payout)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
