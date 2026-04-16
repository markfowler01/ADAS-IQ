import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { createNotification } from './notification-helper.js'

const router = express.Router()
const CHUNK_SIZE = 30

// ── Cache helpers (same pattern as books.js) ────────────────────────────────

function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

async function cacheSet(segment, key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  try {
    await segment.update(key, str)
  } catch (e) {
    try {
      await segment.put(key, str)
    } catch (e2) {
      throw e2
    }
  }
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

// ── Invoice storage (same chunked pattern as books.js) ──────────────────────

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

async function writeInvoices(req, invoices) {
  const segment = getSegment(req)
  const chunks = []
  for (let i = 0; i < invoices.length; i += CHUNK_SIZE) {
    chunks.push(invoices.slice(i, i + CHUNK_SIZE))
  }
  if (chunks.length === 0) chunks.push([])

  for (let i = 0; i < chunks.length; i++) {
    await cacheSet(segment, `books_invoices_chunk_${i}`, JSON.stringify(chunks[i]))
  }
  await cacheSet(segment, 'books_invoices_meta', JSON.stringify({
    chunks: chunks.length,
    total: invoices.length,
    updated: new Date().toISOString(),
  }))
}

// ── Cron auth middleware ────────────────────────────────────────────────────

function requireCronAuth(req, res, next) {
  const cronSecret = process.env.BILLING_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

router.use(requireCronAuth)

// ── Helpers ─────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function daysBetween(dateA, dateB) {
  return Math.floor((new Date(dateA) - new Date(dateB)) / 86400000)
}

function formatCurrency(amount) {
  return '$' + (amount || 0).toFixed(2)
}

// ── POST /check-overdue ─────────────────────────────────────────────────────

router.post('/check-overdue', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const today = todayStr()
    let newlyOverdue = 0
    let alreadyOverdue = 0

    for (const inv of invoices) {
      if (inv.status === 'overdue') {
        alreadyOverdue++
      } else if (inv.status === 'sent' && inv.due_date && inv.due_date < today) {
        inv.status = 'overdue'
        newlyOverdue++
      }
    }

    if (newlyOverdue > 0) {
      await writeInvoices(req, invoices)
      console.log(`[billing-cron] Marked ${newlyOverdue} invoices as overdue`)
    }

    res.json({
      ok: true,
      checked: invoices.length,
      newly_overdue: newlyOverdue,
      already_overdue: alreadyOverdue,
    })
  } catch (err) {
    console.error('[billing-cron check-overdue]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /send-reminders ────────────────────────────────────────────────────

const REMINDER_THRESHOLDS = [
  { days: 30, type: 'escalation', title: 'Escalation — Invoice 30+ days overdue', escalate: true },
  { days: 14, type: 'urgent',     title: 'Urgent — Invoice 14 days overdue' },
  { days: 7,  type: 'followup',   title: 'Follow-up — Invoice 7 days overdue' },
  { days: 1,  type: 'gentle',     title: 'Gentle reminder — Invoice past due' },
]

router.post('/send-reminders', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const today = todayStr()
    let totalSent = 0
    const byType = { gentle: 0, followup: 0, urgent: 0, escalation: 0 }
    let modified = false

    for (const inv of invoices) {
      if (inv.status !== 'overdue') continue

      const daysOverdue = daysBetween(today, inv.due_date)
      if (daysOverdue < 1) continue

      // Ensure reminders_sent array exists
      if (!Array.isArray(inv.reminders_sent)) {
        inv.reminders_sent = []
      }

      // Check each threshold (highest first so we send the most severe applicable)
      for (const threshold of REMINDER_THRESHOLDS) {
        if (daysOverdue < threshold.days) continue

        // Skip if this reminder type was already sent
        const alreadySent = inv.reminders_sent.some(r => r.type === threshold.type)
        if (alreadySent) continue

        // Build notification
        const customerName = inv.customer_name || inv.shop_name || 'Unknown'
        const invoiceNum = inv.invoice_number || inv.id || '—'
        const amount = formatCurrency(inv.balance_due || inv.total || 0)
        const message = `Invoice #${invoiceNum} for ${customerName} (${amount}) is ${daysOverdue} days overdue.`

        await createNotification(req, {
          title: threshold.title,
          message,
          type: threshold.escalate ? 'escalation' : 'billing_reminder',
          link: `/books/invoices/${inv.id}`,
          data: {
            invoiceId: inv.id,
            invoiceNumber: invoiceNum,
            customerName,
            amount: inv.balance_due || inv.total || 0,
            daysOverdue,
            reminderType: threshold.type,
          },
        })

        // Record that we sent this reminder
        inv.reminders_sent.push({ type: threshold.type, date: today })
        byType[threshold.type]++
        totalSent++
        modified = true

        // If escalation, also set billing_status
        if (threshold.escalate) {
          inv.billing_status = 'escalated'
        }

        // Only send the highest-severity new reminder per invoice per run
        break
      }
    }

    if (modified) {
      await writeInvoices(req, invoices)
      console.log(`[billing-cron] Sent ${totalSent} reminders`)
    }

    res.json({ ok: true, reminders_sent: totalSent, by_type: byType })
  } catch (err) {
    console.error('[billing-cron send-reminders]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /aging-summary ──────────────────────────────────────────────────────

router.get('/aging-summary', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const today = todayStr()

    const buckets = {
      current:  { count: 0, amount: 0, invoices: [] },
      '1-30':   { count: 0, amount: 0, invoices: [] },
      '31-60':  { count: 0, amount: 0, invoices: [] },
      '61-90':  { count: 0, amount: 0, invoices: [] },
      '90+':    { count: 0, amount: 0, invoices: [] },
    }

    for (const inv of invoices) {
      if (inv.status !== 'sent' && inv.status !== 'overdue') continue

      const due = inv.due_date || inv.date || today
      const days = daysBetween(today, due)
      const bal = inv.balance_due || 0

      const summary = {
        id: inv.id,
        invoice_number: inv.invoice_number || '—',
        customer_name: inv.customer_name || inv.shop_name || 'Unknown',
        due_date: inv.due_date || '',
        balance_due: bal,
        days_overdue: Math.max(days, 0),
        status: inv.status,
        billing_status: inv.billing_status || null,
        reminders_sent: inv.reminders_sent || [],
      }

      let bucket
      if (days <= 0)       bucket = 'current'
      else if (days <= 30) bucket = '1-30'
      else if (days <= 60) bucket = '31-60'
      else if (days <= 90) bucket = '61-90'
      else                 bucket = '90+'

      buckets[bucket].count++
      buckets[bucket].amount += bal
      buckets[bucket].invoices.push(summary)
    }

    // Round amounts
    for (const key of Object.keys(buckets)) {
      buckets[key].amount = Math.round(buckets[key].amount * 100) / 100
      // Sort invoices within each bucket by days overdue descending
      buckets[key].invoices.sort((a, b) => b.days_overdue - a.days_overdue)
    }

    const totalOutstanding = Object.values(buckets).reduce((s, b) => s + b.amount, 0)

    res.json({
      ok: true,
      as_of: today,
      total_outstanding: Math.round(totalOutstanding * 100) / 100,
      total_invoices: Object.values(buckets).reduce((s, b) => s + b.count, 0),
      buckets,
    })
  } catch (err) {
    console.error('[billing-cron aging-summary]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
