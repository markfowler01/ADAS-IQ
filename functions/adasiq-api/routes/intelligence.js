// Phase 8 — business intelligence endpoints:
// - Rebook / repeat-offender detection (VIN re-cal within 90 days)
// - Per-shop margin mix (revenue by calibration type per shop)
// - Revenue forecasting (pipeline × conversion × avg invoice)
// - Competitor intel summary

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()

function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
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
  } catch { /* noop */ }
  return []
}

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
    return (await cacheGet(segment, 'adas_jobs', [])) || []
  } catch { return [] }
}

async function readShops(req) {
  try {
    const app = catalyst.initialize(req)
    const tbl = app.datastore().table('CRMShops')
    const rows = await tbl.getAllRows()
    return rows.map(r => {
      const row = r.toJSON ? r.toJSON() : r
      const shop = { id: row.ROWID, ...row }
      try { if (typeof shop.billing_rules === 'string') shop.billing_rules = JSON.parse(shop.billing_rules) } catch {}
      try { if (typeof shop.custom_competitors === 'string') shop.custom_competitors = JSON.parse(shop.custom_competitors) } catch {}
      return shop
    })
  } catch { return [] }
}

async function readServices(req) {
  const segment = getSegment(req)
  return (await cacheGet(segment, 'books_services', [])) || []
}

function isAdmin(req) { return req.user?.role !== 'technician' }

// ── Rebook / repeat-offender detection ───────────────────────────────────────
// If a VIN we've already calibrated comes in again within 90 days,
// it could mean the calibration didn't hold, or the vehicle was in another
// collision, or our tech needs re-training. This flags it.

router.get('/rebook-alerts', async (req, res) => {
  try {
    const jobs = await readJobs(req)
    const withVin = jobs.filter(j => j.vin && j.vin.length > 6)

    // Group by VIN
    const byVin = {}
    for (const j of withVin) {
      const vin = j.vin.toUpperCase()
      if (!byVin[vin]) byVin[vin] = []
      byVin[vin].push(j)
    }

    const alerts = []
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000

    for (const [vin, vinJobs] of Object.entries(byVin)) {
      if (vinJobs.length < 2) continue

      // Sort by date
      vinJobs.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))

      for (let i = 1; i < vinJobs.length; i++) {
        const prev = vinJobs[i - 1]
        const curr = vinJobs[i]
        const prevDate = new Date(prev.completed_at || prev.created_at).getTime()
        const currDate = new Date(curr.created_at).getTime()
        const daysBetween = Math.floor((currDate - prevDate) / (24 * 60 * 60 * 1000))

        if (currDate - prevDate <= NINETY_DAYS && currDate - prevDate > 0) {
          alerts.push({
            vin,
            shop_name: curr.shop_name,
            vehicle: [curr.year, curr.make, curr.model].filter(Boolean).join(' '),
            previous_job_id: prev.id,
            previous_job_date: prev.completed_at || prev.created_at,
            previous_technician: prev.technician,
            previous_calibrations: (prev.calibrations || []).map(c => typeof c === 'string' ? c : c.name),
            current_job_id: curr.id,
            current_job_date: curr.created_at,
            current_technician: curr.technician,
            current_calibrations: (curr.calibrations || []).map(c => typeof c === 'string' ? c : c.name),
            days_between: daysBetween,
            severity: daysBetween < 30 ? 'high' : daysBetween < 60 ? 'medium' : 'low',
          })
        }
      }
    }

    alerts.sort((a, b) => new Date(b.current_job_date) - new Date(a.current_job_date))

    res.json({ total_alerts: alerts.length, alerts })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Per-shop margin mix ──────────────────────────────────────────────────────
// Revenue + margin breakdown per shop by calibration type.
// Uses cost_of_goods from the services catalog for true margin.

router.get('/shop-margin-mix', async (req, res) => {
  try {
    const [invoices, services] = await Promise.all([readInvoices(req), readServices(req)])
    const servicesByName = new Map()
    const servicesByZohoId = new Map()
    for (const s of services) {
      servicesByName.set((s.name || '').toLowerCase().trim(), s)
      if (s.zoho_item_id) servicesByZohoId.set(s.zoho_item_id, s)
    }

    // Get period filter
    const period = req.query.period || 'ytd'
    const now = new Date()
    let since
    if (period === 'this_month') since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    else if (period === 'quarter') since = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString()
    else if (period === 'ytd')     since = new Date(now.getFullYear(), 0, 1).toISOString()
    else                            since = '1970-01-01T00:00:00.000Z'

    const paid = invoices.filter(i =>
      i.status === 'paid' && (i.paid_at || i.date || '') >= since)

    // Group by shop
    const byShop = {}
    for (const inv of paid) {
      const shopKey = inv.customer_name || '—'
      if (!byShop[shopKey]) {
        byShop[shopKey] = {
          shop: shopKey,
          invoice_count: 0,
          revenue: 0,
          cogs: 0,
          by_calibration: {},
        }
      }
      const s = byShop[shopKey]
      s.invoice_count++
      s.revenue += Number(inv.total) || 0

      for (const li of (inv.line_items || [])) {
        const amt = Number(li.amount) || 0
        const qty = Number(li.qty) || 1

        // Try to find service by name or zoho_item_id
        let svc = null
        if (li.zoho_item_id && servicesByZohoId.has(li.zoho_item_id)) {
          svc = servicesByZohoId.get(li.zoho_item_id)
        } else if (li.description) {
          svc = servicesByName.get((li.description || '').toLowerCase().trim())
        }

        const cogsPerUnit = Number(svc?.cost_of_goods) || 0
        const lineCogs = cogsPerUnit * qty
        s.cogs += lineCogs

        const calName = li.description || 'Unknown'
        if (!s.by_calibration[calName]) {
          s.by_calibration[calName] = { name: calName, revenue: 0, cogs: 0, qty: 0 }
        }
        s.by_calibration[calName].revenue += amt
        s.by_calibration[calName].cogs += lineCogs
        s.by_calibration[calName].qty += qty
      }
    }

    // Flatten + compute margins
    const results = Object.values(byShop).map(s => ({
      shop: s.shop,
      invoice_count: s.invoice_count,
      revenue: Math.round(s.revenue * 100) / 100,
      cogs: Math.round(s.cogs * 100) / 100,
      gross_profit: Math.round((s.revenue - s.cogs) * 100) / 100,
      margin_percent: s.revenue > 0 ? Math.round(((s.revenue - s.cogs) / s.revenue) * 100) : 0,
      avg_invoice: s.invoice_count > 0 ? Math.round((s.revenue / s.invoice_count) * 100) / 100 : 0,
      top_calibrations: Object.values(s.by_calibration)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5)
        .map(c => ({
          name: c.name, qty: c.qty,
          revenue: Math.round(c.revenue * 100) / 100,
          margin_percent: c.revenue > 0 ? Math.round(((c.revenue - c.cogs) / c.revenue) * 100) : 0,
        })),
    }))

    results.sort((a, b) => b.gross_profit - a.gross_profit)
    res.json({ period, since, shops: results })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Revenue forecasting ──────────────────────────────────────────────────────
// Pipeline of open jobs × historical conversion rate × average invoice.

router.get('/forecast', async (req, res) => {
  try {
    const [invoices, jobs] = await Promise.all([readInvoices(req), readJobs(req)])
    const now = new Date()

    // Month to date
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const mtdPaid = invoices.filter(i => i.status === 'paid' && (i.paid_at || '') >= monthStart)
    const mtdRevenue = mtdPaid.reduce((s, i) => s + (Number(i.total) || 0), 0)

    // Historical monthly average (last 6 months, excluding current)
    const monthlyTotals = []
    for (let i = 1; i <= 6; i++) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      const monthPaid = invoices.filter(inv =>
        inv.status === 'paid' && inv.paid_at
        && new Date(inv.paid_at) >= mStart && new Date(inv.paid_at) < mEnd
      )
      monthlyTotals.push(monthPaid.reduce((s, inv) => s + (Number(inv.total) || 0), 0))
    }
    const avgMonthlyRevenue = monthlyTotals.length > 0
      ? monthlyTotals.reduce((s, n) => s + n, 0) / monthlyTotals.length
      : 0

    // Days remaining in month
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const dayOfMonth = now.getDate()
    const daysRemaining = daysInMonth - dayOfMonth
    const monthFraction = daysRemaining / daysInMonth

    // Pace projection (simple)
    const mtdPaceProjection = dayOfMonth > 0
      ? (mtdRevenue / dayOfMonth) * daysInMonth
      : avgMonthlyRevenue

    // Pipeline: open jobs not yet invoiced, estimated at avg invoice per paid job
    const invoicedJobIds = new Set(invoices.map(i => i.job_id).filter(Boolean))
    const openPipeline = jobs.filter(j =>
      ['needs_dispatch', 'dispatched', 'in_progress', 'on_hold', 'complete']
        .includes(j.status) && !invoicedJobIds.has(j.id)
    )
    const avgPaidInvoice = mtdPaid.length > 0
      ? mtdRevenue / mtdPaid.length
      : (avgMonthlyRevenue / Math.max(1, mtdPaid.length || 5))

    // Pipeline forecast: 75% historical completion/conversion rate
    const pipelineForecast = openPipeline.length * avgPaidInvoice * 0.75

    // Composite forecast: blend pace + pipeline
    const compositeForecast = Math.round(
      (mtdPaceProjection * 0.6 + (mtdRevenue + pipelineForecast) * 0.4) * 100
    ) / 100

    res.json({
      mtd_revenue: Math.round(mtdRevenue * 100) / 100,
      avg_monthly_revenue: Math.round(avgMonthlyRevenue * 100) / 100,
      pace_projection: Math.round(mtdPaceProjection * 100) / 100,
      open_pipeline_count: openPipeline.length,
      pipeline_value_estimated: Math.round(pipelineForecast * 100) / 100,
      composite_forecast: compositeForecast,
      day_of_month: dayOfMonth,
      days_in_month: daysInMonth,
      days_remaining: daysRemaining,
      month_fraction_complete: Math.round((1 - monthFraction) * 100),
      trailing_6_months: monthlyTotals,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Competitor intel ─────────────────────────────────────────────────────────
// Aggregates competitor mentions across shops

router.get('/competitors', async (req, res) => {
  try {
    const shops = await readShops(req)
    const byCompetitor = {}

    for (const s of shops) {
      // custom_competitors array: names on active shops tell you who you're beating
      // lost_to field on lost shops tells you who beat you
      const competitors = [
        ...(Array.isArray(s.custom_competitors) ? s.custom_competitors : []),
        ...(s.lost_to ? [s.lost_to] : []),
      ]
      for (const c of competitors) {
        if (!c) continue
        const key = String(c).trim()
        if (!key) continue
        if (!byCompetitor[key]) {
          byCompetitor[key] = {
            competitor: key,
            won_against: 0,
            lost_to: 0,
            shops_mentioning: [],
          }
        }
        if (s.lost_to && s.lost_to === key) {
          byCompetitor[key].lost_to++
        } else {
          byCompetitor[key].won_against++
        }
        byCompetitor[key].shops_mentioning.push({
          shop_name: s.shop_name,
          pipeline_stage: s.pipeline_stage,
        })
      }
    }

    const results = Object.values(byCompetitor).sort((a, b) =>
      (b.won_against + b.lost_to) - (a.won_against + a.lost_to))
    res.json({ competitors: results, total_competitors: results.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Weather-aware scheduling flags ───────────────────────────────────────────
// Uses Open-Meteo (free, no API key) to fetch forecast for a city/address.
// Called from the frontend when creating/editing a dynamic calibration job.

router.get('/weather-check', async (req, res) => {
  try {
    const { lat, lng, date } = req.query
    if (!lat || !lng) return res.status(400).json({ error: 'lat + lng required' })

    // Open-Meteo forecast API — no key needed
    const axios = (await import('axios')).default
    const r = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: lat, longitude: lng,
        daily: 'precipitation_sum,weathercode,temperature_2m_max,temperature_2m_min,wind_speed_10m_max',
        timezone: 'auto',
        forecast_days: 7,
      },
      timeout: 6000,
    })

    const daily = r.data?.daily || {}
    const forecast = (daily.time || []).map((day, i) => ({
      date: day,
      precipitation_inches: Math.round((daily.precipitation_sum?.[i] || 0) * 0.0393701 * 100) / 100,
      high_temp_f: Math.round(((daily.temperature_2m_max?.[i] || 0) * 9/5 + 32)),
      low_temp_f: Math.round(((daily.temperature_2m_min?.[i] || 0) * 9/5 + 32)),
      wind_mph: Math.round((daily.wind_speed_10m_max?.[i] || 0) * 0.621371),
      weather_code: daily.weathercode?.[i],
    }))

    const targetDate = date || new Date().toISOString().slice(0, 10)
    const forDate = forecast.find(f => f.date === targetDate)

    let verdict = 'ok'
    const warnings = []
    if (forDate) {
      if (forDate.precipitation_inches > 0.25) {
        verdict = 'bad'
        warnings.push('Heavy precipitation expected — dynamic cals may fail')
      } else if (forDate.precipitation_inches > 0.05) {
        verdict = 'risk'
        warnings.push('Light precipitation — check lane line visibility')
      }
      if (forDate.wind_mph > 25) {
        warnings.push('High winds — may affect radar calibrations')
        verdict = verdict === 'bad' ? 'bad' : 'risk'
      }
      if (forDate.high_temp_f > 105 || forDate.low_temp_f < 20) {
        warnings.push('Temperature extreme — watch for equipment issues')
      }
    }

    res.json({ date: targetDate, verdict, warnings, forecast, for_date: forDate })
  } catch (e) {
    console.error('[weather-check]', e.message)
    // Graceful fallback — don't block the UI
    res.json({ verdict: 'unknown', warnings: [], forecast: [], error: e.message })
  }
})

export default router
