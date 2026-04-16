import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()

// ── Cache helpers ────────────────────────────────────────────────────────────

function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
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

function calculateBonus(revenue, tiers) {
  let bonus = 0
  const breakdown = []
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold)
  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i]
    const nextThreshold = sorted[i + 1]?.threshold ?? Infinity
    if (revenue <= tier.threshold) break
    const revenueInTier = Math.min(revenue, nextThreshold) - tier.threshold
    const bonusInTier = revenueInTier * tier.rate
    bonus += bonusInTier
    breakdown.push({
      tier: { threshold: tier.threshold, rate: tier.rate, label: tier.label },
      revenue_in_tier: revenueInTier,
      bonus_in_tier: bonusInTier,
    })
  }
  return { bonus: Math.round(bonus * 100) / 100, breakdown }
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

// Get revenue for a user in a date range
async function getRevenueForUser(req, userId, start, end, config) {
  const invoices = await readInvoices(req)
  const jobs = await readJobs(req)
  const jobsById = new Map(jobs.map(j => [j.id, j]))

  let revenue = 0
  const invoiceList = []

  for (const inv of invoices) {
    if (inv.status !== 'paid') continue
    if (!inv.paid_at) continue
    if (inv.paid_at < start || inv.paid_at >= end) continue

    // Filter by invoice type config
    if (inv.invoice_type === 'insurance' && !config.include_insurance_invoices) continue
    if (inv.invoice_type === 'shop' && !config.include_shop_invoices) continue

    // Find technician: check invoice.technician first, fall back to job
    let tech = inv.technician || inv.assigned_to || ''
    if (!tech && inv.job_id) {
      const job = jobsById.get(inv.job_id)
      if (job) tech = job.technician || job.assigned_to || ''
    }

    // Match by user_id or name
    if (tech !== userId && tech?.toLowerCase() !== userId.toLowerCase()) continue

    revenue += inv.total || 0
    invoiceList.push({
      id: inv.id,
      invoice_number: inv.invoice_number,
      customer_name: inv.customer_name,
      total: inv.total,
      paid_at: inv.paid_at,
    })
  }

  return { revenue, invoices: invoiceList }
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
    const nextTier = [...config.tiers].sort((a, b) => a.threshold - b.threshold)
      .find(t => t.threshold > revenue)

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

    const invoices = await readInvoices(req)
    const jobs = await readJobs(req)
    const jobsById = new Map(jobs.map(j => [j.id, j]))

    // Collect all unique techs
    const techs = new Set()
    for (const inv of invoices) {
      let tech = inv.technician || inv.assigned_to
      if (!tech && inv.job_id) {
        const job = jobsById.get(inv.job_id)
        if (job) tech = job.technician || job.assigned_to
      }
      if (tech) techs.add(tech)
    }
    for (const job of jobs) {
      if (job.technician) techs.add(job.technician)
      if (job.assigned_to) techs.add(job.assigned_to)
    }

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
