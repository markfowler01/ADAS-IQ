import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()

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

function getUserId(req) {
  return req.user?.email || req.user?.id || req.user?.name || 'unknown'
}

function getUserName(req) {
  return req.user?.name || req.user?.email || 'Unknown'
}

// ── Log a declined calibration ───────────────────────────────────────────────

router.post('/log', async (req, res) => {
  try {
    const segment = getSegment(req)
    const log = (await cacheGet(segment, 'declined_calibrations', [])) || []

    const entry = {
      id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      job_id: req.body.job_id || '',
      shop_name: req.body.shop_name || '',
      crm_shop_id: req.body.crm_shop_id || '',
      calibration_name: req.body.calibration_name || '',
      recommended_price: Number(req.body.recommended_price) || 0,
      decline_reason: req.body.decline_reason || '',
      decline_code: req.body.decline_code || '',  // 'cost', 'not_needed', 'insurance_denied', 'other'
      vehicle: req.body.vehicle || null,
      ro_number: req.body.ro_number || '',
      logged_by_id: getUserId(req),
      logged_by_name: getUserName(req),
      created_at: new Date().toISOString(),
    }
    log.unshift(entry)
    // Keep last 2000 entries so this doesn't grow unbounded
    await cacheSet(segment, 'declined_calibrations', log.slice(0, 2000))
    res.json({ ok: true, entry })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── List declines (admin) ────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const segment = getSegment(req)
    const log = (await cacheGet(segment, 'declined_calibrations', [])) || []
    const { shop_name, crm_shop_id, from, to } = req.query
    let filtered = log
    if (shop_name) filtered = filtered.filter(e =>
      (e.shop_name || '').toLowerCase() === shop_name.toLowerCase())
    if (crm_shop_id) filtered = filtered.filter(e => e.crm_shop_id === crm_shop_id)
    if (from) filtered = filtered.filter(e => e.created_at >= from)
    if (to) filtered = filtered.filter(e => e.created_at <= to)
    res.json(filtered)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Delete (admin) ───────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    if (req.user?.role === 'technician') return res.status(403).json({ error: 'Admin only' })
    const segment = getSegment(req)
    const log = (await cacheGet(segment, 'declined_calibrations', [])) || []
    await cacheSet(segment, 'declined_calibrations', log.filter(e => e.id !== req.params.id))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Lost revenue report ──────────────────────────────────────────────────────

router.get('/report', async (req, res) => {
  try {
    const segment = getSegment(req)
    const log = (await cacheGet(segment, 'declined_calibrations', [])) || []

    const period = req.query.period || 'ytd'
    const now = new Date()
    let since
    if (period === 'this_month')  since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    else if (period === 'last_month')  since = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
    else if (period === 'quarter') since = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString()
    else if (period === 'ytd')     since = new Date(now.getFullYear(), 0, 1).toISOString()
    else                            since = '1970-01-01T00:00:00.000Z'

    const filtered = log.filter(e => e.created_at >= since)

    const totalLost = filtered.reduce((s, e) => s + (Number(e.recommended_price) || 0), 0)

    // By shop
    const byShop = {}
    for (const e of filtered) {
      const key = e.shop_name || '—'
      if (!byShop[key]) byShop[key] = { shop: key, count: 0, lost_revenue: 0, reasons: {} }
      byShop[key].count++
      byShop[key].lost_revenue += Number(e.recommended_price) || 0
      const r = e.decline_code || 'other'
      byShop[key].reasons[r] = (byShop[key].reasons[r] || 0) + 1
    }
    const shopList = Object.values(byShop)
      .sort((a, b) => b.lost_revenue - a.lost_revenue)

    // By calibration type
    const byCal = {}
    for (const e of filtered) {
      const key = e.calibration_name || '—'
      if (!byCal[key]) byCal[key] = { calibration: key, count: 0, lost_revenue: 0 }
      byCal[key].count++
      byCal[key].lost_revenue += Number(e.recommended_price) || 0
    }
    const calList = Object.values(byCal)
      .sort((a, b) => b.lost_revenue - a.lost_revenue)

    // By reason
    const byReason = {}
    for (const e of filtered) {
      const key = e.decline_code || 'other'
      if (!byReason[key]) byReason[key] = { reason: key, count: 0, lost_revenue: 0 }
      byReason[key].count++
      byReason[key].lost_revenue += Number(e.recommended_price) || 0
    }

    res.json({
      period,
      since,
      total_declines: filtered.length,
      total_lost_revenue: Math.round(totalLost * 100) / 100,
      by_shop: shopList,
      by_calibration: calList,
      by_reason: Object.values(byReason),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
