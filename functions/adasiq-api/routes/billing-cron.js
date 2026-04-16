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

// ── Stale invoice alert — completed jobs not invoiced within 24 hours ─────────

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

router.post('/check-stale-invoicing', async (req, res) => {
  try {
    const jobs = await readJobs(req)
    const invoices = await readInvoices(req)
    const invoicedJobIds = new Set(invoices.map(i => i.job_id).filter(Boolean))

    const now = Date.now()
    const staleThresholdMs = 24 * 60 * 60 * 1000  // 24 hours

    const stale = []
    for (const j of jobs) {
      if (j.status !== 'complete') continue
      if (invoicedJobIds.has(j.id)) continue
      const completedAt = new Date(j.completed_at || j.updated_at || j.created_at).getTime()
      if (!completedAt) continue
      const age = now - completedAt
      if (age < staleThresholdMs) continue

      stale.push({
        job_id: j.id,
        shop_name: j.shop_name,
        ro_number: j.ro_number,
        completed_at: j.completed_at,
        hours_stale: Math.round(age / (60 * 60 * 1000)),
      })
    }

    // Notify admins if there's a stale list
    if (stale.length > 0) {
      await createNotification(req, {
        to: 'admin',
        type: 'stale_invoicing_alert',
        title: `${stale.length} job${stale.length !== 1 ? 's' : ''} need${stale.length === 1 ? 's' : ''} invoicing`,
        body: `Completed jobs waiting 24+ hours:\n${stale.slice(0, 5).map(s => `• ${s.shop_name} · RO# ${s.ro_number} · ${s.hours_stale}h`).join('\n')}${stale.length > 5 ? `\n…and ${stale.length - 5} more` : ''}`,
        link: '/app/?screen=books',
      }).catch(e => console.warn('[billing-cron] notification failed:', e.message))
    }

    res.json({ stale_count: stale.length, stale })
  } catch (e) {
    console.error('[billing-cron stale]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Auto-invoice sweep — creates invoices for completed jobs that opted in ───

async function readShops(req) {
  try {
    const app = catalyst.initialize(req)
    const tbl = app.datastore().table('CRMShops')
    const rows = await tbl.getAllRows()
    return rows.map(r => {
      const row = r.toJSON ? r.toJSON() : r
      const shop = { id: row.ROWID, ...row }
      try { if (typeof shop.billing_rules === 'string') shop.billing_rules = JSON.parse(shop.billing_rules) } catch {}
      return shop
    })
  } catch { return [] }
}

router.post('/auto-invoice-sweep', async (req, res) => {
  try {
    const jobs = await readJobs(req)
    const invoices = await readInvoices(req)
    const shops = await readShops(req)
    const invoicedJobIds = new Set(invoices.map(i => i.job_id).filter(Boolean))

    const shopsById = new Map(shops.map(s => [s.id, s]))
    const shopsByName = new Map(shops.map(s => [(s.shop_name || '').toLowerCase(), s]))

    let created = 0
    let skipped_no_optin = 0
    let skipped_already_invoiced = 0
    const errors = []

    for (const j of jobs) {
      if (j.status !== 'complete') continue
      if (invoicedJobIds.has(j.id)) { skipped_already_invoiced++; continue }

      // Find the shop + check auto_invoice opt-in
      const shop = (j.crm_shop_id && shopsById.get(j.crm_shop_id))
        || shopsByName.get((j.shop_name || '').toLowerCase())
      if (!shop || !shop.billing_rules?.auto_invoice) {
        skipped_no_optin++
        continue
      }

      // Build a minimal invoice from the job (non-destructive — admin can edit after)
      try {
        const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const now = new Date()
        const dueDays = (shop.billing_rules?.default_terms || 'Net 30').match(/\d+/)?.[0] || 30
        const due = new Date(now.getTime() + Number(dueDays) * 24 * 60 * 60 * 1000)

        const lineItems = Array.isArray(j.calibrations)
          ? j.calibrations.map(c => ({
              id: `li_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              description: typeof c === 'string' ? c : (c.name || c.description || 'Calibration'),
              qty: 1,
              rate: typeof c === 'object' ? (Number(c.price) || 0) : 0,
              amount: typeof c === 'object' ? (Number(c.price) || 0) : 0,
            }))
          : []

        const subtotal = lineItems.reduce((s, li) => s + li.amount, 0)

        invoices.push({
          id: invoiceId,
          invoice_number: `INV-AUTO-${Date.now().toString().slice(-6)}`,
          customer_type: 'b2b',
          invoice_type: shop.billing_rules?.invoice_type === 'single' ? 'standard' : 'shop',
          customer_name: shop.shop_name,
          customer_email: shop.billing_rules?.billing_contact_email || shop.email || '',
          customer_phone: shop.phone || '',
          customer_address: shop.address || '',
          customer_contact: shop.billing_rules?.billing_contact_name || '',
          po_number: j.ro_number || '',
          date: now.toISOString().slice(0, 10),
          due_date: due.toISOString().slice(0, 10),
          terms: shop.billing_rules?.default_terms || 'Net 30',
          line_items: lineItems,
          tax_rate: 0, tax_amount: 0,
          discount: 0, discount_pct: 0,
          subtotal, total: subtotal,
          amount_paid: 0, balance_due: subtotal,
          status: 'draft',
          job_id: j.id,
          crm_shop_id: shop.id,
          notes: 'Auto-generated from completed job — please review before sending.',
          created_at: now.toISOString(),
        })
        created++
      } catch (err) {
        errors.push({ job_id: j.id, error: err.message })
      }
    }

    if (created > 0) await writeInvoices(req, invoices)

    res.json({ created, skipped_no_optin, skipped_already_invoiced, errors })
  } catch (e) {
    console.error('[billing-cron auto-invoice]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Apply late fees to overdue invoices — only for shops that opted in ───────

router.post('/apply-late-fees', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const shops = await readShops(req)
    const shopsById = new Map(shops.map(s => [s.id, s]))
    const shopsByName = new Map(shops.map(s => [(s.shop_name || '').toLowerCase(), s]))

    const today = new Date()
    let applied = 0
    let skipped_no_optin = 0
    const details = []

    for (const inv of invoices) {
      if (!['sent', 'overdue'].includes(inv.status)) continue
      if (Number(inv.balance_due || 0) <= 0) continue
      if (!inv.due_date) continue

      const shop = (inv.crm_shop_id && shopsById.get(inv.crm_shop_id))
        || shopsByName.get((inv.customer_name || '').toLowerCase())
      const rules = shop?.billing_rules
      if (!rules?.late_fees_enabled) { skipped_no_optin++; continue }

      const graceDays = Number(rules.late_fee_grace_days ?? 30)
      const due = new Date(inv.due_date)
      const graceEnd = new Date(due.getTime() + graceDays * 24 * 60 * 60 * 1000)
      const daysPastGrace = Math.floor((today - graceEnd) / (24 * 60 * 60 * 1000))
      if (daysPastGrace < 0) continue

      // Track fees per invoice: one accrual per month past grace
      inv.late_fees = Array.isArray(inv.late_fees) ? inv.late_fees : []
      const monthsPastGrace = Math.floor(daysPastGrace / 30) + 1
      const alreadyApplied = inv.late_fees.length

      if (monthsPastGrace <= alreadyApplied) continue

      const monthlyRate = Number(rules.late_fee_percent ?? 1.5) / 100
      const feeAmount = Math.round(Number(inv.total) * monthlyRate * 100) / 100

      inv.late_fees.push({
        id: `lf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        amount: feeAmount,
        rate_percent: rules.late_fee_percent,
        applied_on: today.toISOString(),
        months_past_grace: monthsPastGrace,
      })
      inv.balance_due = Math.max(0, Number(inv.balance_due || 0) + feeAmount)
      inv.total = Math.round((Number(inv.total) + feeAmount) * 100) / 100

      details.push({
        invoice_number: inv.invoice_number,
        customer: inv.customer_name,
        fee_amount: feeAmount,
      })
      applied++
    }

    if (applied > 0) await writeInvoices(req, invoices)

    res.json({ applied, skipped_no_optin, details })
  } catch (e) {
    console.error('[billing-cron late-fees]', e.message)
    res.status(500).json({ error: e.message })
  }
})

export default router
