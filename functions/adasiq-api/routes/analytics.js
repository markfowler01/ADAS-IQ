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
  } catch { /* fall through */ }
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
    return await cacheGet(segment, 'adas_jobs', [])
  } catch { return [] }
}

async function readExpenses(req) {
  const segment = getSegment(req)
  return await cacheGet(segment, 'books_expenses', []) || []
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function todayISO() { return new Date().toISOString().slice(0, 10) }

function startOfWeek(d = new Date()) {
  const day = d.getDay()
  const offset = day === 0 ? -6 : 1 - day
  const result = new Date(d)
  result.setDate(d.getDate() + offset)
  result.setHours(0, 0, 0, 0)
  return result
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

// ── Daily Review ─────────────────────────────────────────────────────────────

router.get('/daily-review', async (req, res) => {
  try {
    const [invoices, jobs, expenses] = await Promise.all([
      readInvoices(req), readJobs(req), readExpenses(req)
    ])

    const today = todayISO()
    const now = new Date()
    const weekStart = startOfWeek(now).toISOString().slice(0, 10)
    const monthStart = startOfMonth(now).toISOString().slice(0, 10)

    const yesterdayStart = new Date(now)
    yesterdayStart.setDate(now.getDate() - 1)
    const yesterdayISO = yesterdayStart.toISOString().slice(0, 10)

    const lastWeekStart = new Date(startOfWeek(now))
    lastWeekStart.setDate(lastWeekStart.getDate() - 7)

    // Sales aggregations
    const paid = invoices.filter(i => i.status === 'paid')
    const created = invoices.filter(i => !!i.created_at)

    const salesToday = paid.filter(i => (i.paid_at || '').startsWith(today))
      .reduce((s, i) => s + (i.total || 0), 0)
    const salesYesterday = paid.filter(i => (i.paid_at || '').startsWith(yesterdayISO))
      .reduce((s, i) => s + (i.total || 0), 0)
    const salesThisWeek = paid.filter(i => (i.paid_at || '') >= weekStart)
      .reduce((s, i) => s + (i.total || 0), 0)
    const salesLastWeek = paid.filter(i => {
      if (!i.paid_at) return false
      const d = i.paid_at.slice(0, 10)
      return d >= lastWeekStart.toISOString().slice(0, 10) && d < weekStart
    }).reduce((s, i) => s + (i.total || 0), 0)
    const salesMTD = paid.filter(i => (i.paid_at || '') >= monthStart)
      .reduce((s, i) => s + (i.total || 0), 0)

    // Jobs today
    const jobsToday = jobs.filter(j => (j.scheduled_date || j.created_at || '').startsWith(today))
    const jobsCompletedToday = jobs.filter(j =>
      j.status === 'complete' && (j.completed_at || '').startsWith(today)
    )

    // Invoice counts
    const invoicesCreatedToday = created.filter(i => (i.created_at || '').startsWith(today)).length
    const outstanding = invoices.filter(i => ['sent', 'overdue'].includes(i.status))
      .reduce((s, i) => s + (i.balance_due || i.total || 0), 0)
    const overdueCount = invoices.filter(i => i.status === 'overdue').length
    const sentNotPaid = invoices.filter(i => i.status === 'sent').length

    // Customer activity (top customers this month)
    const byCustomer = {}
    for (const inv of paid) {
      if (!inv.paid_at || inv.paid_at < monthStart) continue
      const name = inv.customer_name || '—'
      byCustomer[name] = (byCustomer[name] || 0) + (inv.total || 0)
    }
    const topCustomers = Object.entries(byCustomer)
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    // Busy customers (job count this month)
    const jobsByCustomer = {}
    for (const j of jobs) {
      const d = j.scheduled_date || j.created_at
      if (!d || d < monthStart) continue
      const name = j.shop_name || j.customer_name || '—'
      jobsByCustomer[name] = (jobsByCustomer[name] || 0) + 1
    }
    const busyCustomers = Object.entries(jobsByCustomer)
      .map(([name, job_count]) => ({ name, job_count }))
      .sort((a, b) => b.job_count - a.job_count)
      .slice(0, 5)

    // Trends: last 14 days of revenue
    const dailyTrend = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      const revenue = paid.filter(inv => (inv.paid_at || '').startsWith(key))
        .reduce((s, inv) => s + (inv.total || 0), 0)
      dailyTrend.push({ date: key, revenue })
    }

    // Expenses MTD
    const expensesMTD = expenses.filter(e => (e.date || '') >= monthStart)
      .reduce((s, e) => s + (e.amount || 0), 0)

    // KPIs
    const averageInvoice = paid.length > 0
      ? paid.reduce((s, i) => s + (i.total || 0), 0) / paid.length
      : 0

    const kpis = {
      avg_invoice: Math.round(averageInvoice * 100) / 100,
      paid_count_total: paid.length,
      jobs_total: jobs.length,
      jobs_complete: jobs.filter(j => j.status === 'complete').length,
      completion_rate: jobs.length > 0
        ? Math.round((jobs.filter(j => j.status === 'complete').length / jobs.length) * 100)
        : 0,
    }

    // Pending billing (completed jobs without invoices)
    const invoicedJobIds = new Set(invoices.map(i => i.job_id).filter(Boolean))
    const needsBilling = jobs.filter(j => j.status === 'complete' && !invoicedJobIds.has(j.id)).length

    // Deltas
    const dayDelta = salesYesterday === 0 ? null
      : Math.round(((salesToday - salesYesterday) / salesYesterday) * 100)
    const weekDelta = salesLastWeek === 0 ? null
      : Math.round(((salesThisWeek - salesLastWeek) / salesLastWeek) * 100)

    res.json({
      generated_at: new Date().toISOString(),
      sales: {
        today: salesToday,
        yesterday: salesYesterday,
        week: salesThisWeek,
        last_week: salesLastWeek,
        mtd: salesMTD,
        day_delta_pct: dayDelta,
        week_delta_pct: weekDelta,
      },
      jobs: {
        today: jobsToday.length,
        completed_today: jobsCompletedToday.length,
        needs_billing: needsBilling,
      },
      invoices: {
        created_today: invoicesCreatedToday,
        outstanding,
        overdue_count: overdueCount,
        sent_not_paid: sentNotPaid,
      },
      expenses: {
        mtd: expensesMTD,
        net_mtd: salesMTD - expensesMTD,
      },
      top_customers: topCustomers,
      busy_customers: busyCustomers,
      daily_trend: dailyTrend,
      kpis,
    })
  } catch (e) {
    console.error('[analytics] daily-review failed:', e)
    res.status(500).json({ error: e.message })
  }
})

// ── Trends — historical ──────────────────────────────────────────────────────

router.get('/trends', async (req, res) => {
  try {
    const period = req.query.period || 'monthly'
    const count = Math.min(Number(req.query.count) || 12, 36)
    const [invoices, expenses] = await Promise.all([readInvoices(req), readExpenses(req)])

    const now = new Date()
    const buckets = []

    for (let i = count - 1; i >= 0; i--) {
      let start, end, label, key
      if (period === 'daily') {
        const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0)
        start = d.toISOString()
        const ed = new Date(d); ed.setDate(ed.getDate() + 1)
        end = ed.toISOString()
        key = d.toISOString().slice(0, 10)
        label = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
      } else if (period === 'weekly') {
        const d = startOfWeek(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (i * 7)))
        start = d.toISOString()
        const ed = new Date(d); ed.setDate(ed.getDate() + 7)
        end = ed.toISOString()
        key = start.slice(0, 10)
        label = `Wk ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
      } else {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        start = d.toISOString()
        const ed = new Date(d.getFullYear(), d.getMonth() + 1, 1)
        end = ed.toISOString()
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        label = d.toLocaleDateString([], { month: 'short', year: '2-digit' })
      }

      const revenue = invoices
        .filter(inv => inv.status === 'paid' && inv.paid_at && inv.paid_at >= start && inv.paid_at < end)
        .reduce((s, inv) => s + (inv.total || 0), 0)
      const expense = expenses
        .filter(e => e.date && e.date >= start.slice(0, 10) && e.date < end.slice(0, 10))
        .reduce((s, e) => s + (e.amount || 0), 0)
      const invoiceCount = invoices
        .filter(inv => inv.created_at && inv.created_at >= start && inv.created_at < end)
        .length

      buckets.push({ key, label, revenue, expense, net: revenue - expense, invoices: invoiceCount })
    }

    res.json({ period, count, buckets })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Customer insights ────────────────────────────────────────────────────────

router.get('/customers', async (req, res) => {
  try {
    const [invoices, jobs] = await Promise.all([readInvoices(req), readJobs(req)])
    const paid = invoices.filter(i => i.status === 'paid')

    const map = new Map()
    for (const inv of paid) {
      const name = inv.customer_name || '—'
      if (!map.has(name)) {
        map.set(name, { name, revenue: 0, invoice_count: 0, job_count: 0, last_invoice: null, first_invoice: null })
      }
      const c = map.get(name)
      c.revenue += inv.total || 0
      c.invoice_count += 1
      if (!c.last_invoice || inv.paid_at > c.last_invoice) c.last_invoice = inv.paid_at
      if (!c.first_invoice || inv.paid_at < c.first_invoice) c.first_invoice = inv.paid_at
    }
    for (const j of jobs) {
      const name = j.shop_name || j.customer_name || '—'
      if (map.has(name)) map.get(name).job_count += 1
    }

    const results = Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map(c => ({
        ...c,
        avg_invoice: c.invoice_count > 0 ? Math.round((c.revenue / c.invoice_count) * 100) / 100 : 0,
        days_since_last: c.last_invoice
          ? Math.floor((Date.now() - new Date(c.last_invoice).getTime()) / (24 * 60 * 60 * 1000))
          : null,
      }))

    res.json({ customers: results, total_customers: results.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Service mix ──────────────────────────────────────────────────────────────

router.get('/service-mix', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const paid = invoices.filter(i => i.status === 'paid')

    const byService = {}
    for (const inv of paid) {
      for (const li of (inv.line_items || [])) {
        const desc = li.description || '—'
        if (!byService[desc]) byService[desc] = { description: desc, qty: 0, revenue: 0 }
        byService[desc].qty += Number(li.qty) || 0
        byService[desc].revenue += Number(li.amount) || 0
      }
    }
    const results = Object.values(byService).sort((a, b) => b.revenue - a.revenue)
    res.json({ services: results })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
