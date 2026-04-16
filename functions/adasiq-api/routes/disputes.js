// Invoice dispute / denial tracking workflow.
// Tracks partial denials, disputes, resubmissions so you can recover revenue.

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import PDFDocument from 'pdfkit'

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

async function writeInvoices(req, invoices) {
  const segment = getSegment(req)
  const CHUNK_SIZE = 30
  const chunks = []
  for (let i = 0; i < invoices.length; i += CHUNK_SIZE) {
    chunks.push(invoices.slice(i, i + CHUNK_SIZE))
  }
  if (chunks.length === 0) chunks.push([])
  for (let i = 0; i < chunks.length; i++) {
    await cacheSet(segment, `books_invoices_chunk_${i}`, chunks[i])
  }
  await cacheSet(segment, 'books_invoices_meta', {
    chunks: chunks.length, total: invoices.length,
    updated: new Date().toISOString(),
  })
}

function getUserName(req) { return req.user?.name || req.user?.email || 'Unknown' }

// ── Mark invoice as disputed / denied ────────────────────────────────────────

router.post('/invoices/:id/dispute', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const inv = invoices.find(i => i.id === req.params.id)
    if (!inv) return res.status(404).json({ error: 'Not found' })

    // New status: 'disputed' — keeps invoice visible in aging but flags it
    inv.status = req.body.full_denial ? 'denied' : 'disputed'
    inv.disputed_at = new Date().toISOString()
    inv.disputed_by = getUserName(req)
    inv.denial_reason = req.body.reason || ''
    inv.denial_code = req.body.code || 'other'  // 'docs_missing', 'insurer_denied', 'shop_disputes', 'other'
    inv.denied_line_items = Array.isArray(req.body.denied_line_items) ? req.body.denied_line_items : []
    inv.denied_amount = Number(req.body.denied_amount) || 0

    inv.dispute_history = Array.isArray(inv.dispute_history) ? inv.dispute_history : []
    inv.dispute_history.push({
      id: `disp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      action: 'opened',
      status: inv.status,
      reason: inv.denial_reason,
      code: inv.denial_code,
      by: inv.disputed_by,
      at: inv.disputed_at,
      denied_amount: inv.denied_amount,
    })

    await writeInvoices(req, invoices)
    res.json(inv)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Add a note / action to an existing dispute
router.post('/invoices/:id/dispute-action', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const inv = invoices.find(i => i.id === req.params.id)
    if (!inv) return res.status(404).json({ error: 'Not found' })

    const action = req.body.action  // 'note', 'resubmitted', 'partial_recovery', 'written_off'
    if (!action) return res.status(400).json({ error: 'action required' })

    inv.dispute_history = Array.isArray(inv.dispute_history) ? inv.dispute_history : []
    const entry = {
      id: `disp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      action,
      note: req.body.note || '',
      by: getUserName(req),
      at: new Date().toISOString(),
    }
    if (action === 'resubmitted') {
      inv.resubmitted_at = entry.at
      inv.status = 'sent'  // back into AR cycle
    } else if (action === 'partial_recovery') {
      const recovered = Number(req.body.recovered_amount) || 0
      entry.recovered_amount = recovered
      inv.amount_paid = Number(inv.amount_paid || 0) + recovered
      inv.balance_due = Math.max(0, Number(inv.total || 0) - inv.amount_paid)
      if (inv.balance_due === 0) inv.status = 'paid'
    } else if (action === 'written_off') {
      const writtenOff = Number(req.body.written_off_amount) || inv.balance_due || 0
      entry.written_off_amount = writtenOff
      inv.write_off_amount = (inv.write_off_amount || 0) + writtenOff
      inv.balance_due = Math.max(0, inv.balance_due - writtenOff)
      inv.status = 'written_off'
      inv.written_off_at = entry.at
    }
    inv.dispute_history.push(entry)

    await writeInvoices(req, invoices)
    res.json(inv)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// List all disputed/denied invoices
router.get('/invoices', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const disputed = invoices.filter(i =>
      ['disputed', 'denied'].includes(i.status) ||
      (Array.isArray(i.dispute_history) && i.dispute_history.length > 0)
    )
    disputed.sort((a, b) => (b.disputed_at || '').localeCompare(a.disputed_at || ''))
    res.json(disputed)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Dispute summary / report
router.get('/report', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const disputed = invoices.filter(i => i.dispute_history?.length > 0)

    let total_disputed_amount = 0
    let total_recovered = 0
    let total_written_off = 0
    let open_count = 0
    const byReason = {}

    for (const i of disputed) {
      total_disputed_amount += Number(i.denied_amount || i.total || 0)
      if (['disputed', 'denied'].includes(i.status)) open_count++

      for (const h of (i.dispute_history || [])) {
        if (h.recovered_amount) total_recovered += Number(h.recovered_amount)
        if (h.written_off_amount) total_written_off += Number(h.written_off_amount)
      }

      const code = i.denial_code || 'other'
      if (!byReason[code]) byReason[code] = { code, count: 0, amount: 0 }
      byReason[code].count++
      byReason[code].amount += Number(i.denied_amount || 0)
    }

    res.json({
      open_count,
      total_disputed: disputed.length,
      total_disputed_amount: Math.round(total_disputed_amount * 100) / 100,
      total_recovered: Math.round(total_recovered * 100) / 100,
      total_written_off: Math.round(total_written_off * 100) / 100,
      recovery_rate: total_disputed_amount > 0
        ? Math.round((total_recovered / total_disputed_amount) * 100)
        : 0,
      by_reason: Object.values(byReason).sort((a, b) => b.amount - a.amount),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Generate a dispute letter PDF (resubmit-ready)
router.get('/invoices/:id/dispute-letter', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const inv = invoices.find(i => i.id === req.params.id)
    if (!inv) return res.status(404).json({ error: 'Not found' })

    const segment = getSegment(req)
    const branding = (await cacheGet(segment, 'adas_iq_branding', {})) || {}
    const companyName = branding.company_name || 'Absolute ADAS'
    const website = branding.website || 'absoluteadas.com'
    const phone = branding.phone || ''
    const address = branding.address || ''
    const primaryColor = branding.primary_color || '#CD4419'

    const doc = new PDFDocument({ size: 'LETTER', margin: 60 })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition',
      `attachment; filename="dispute-${inv.invoice_number}.pdf"`)
    doc.pipe(res)

    // Header
    doc.fillColor(primaryColor).fontSize(20).font('Helvetica-Bold')
      .text(companyName, 60, 60)
    doc.fillColor('#555').fontSize(10).font('Helvetica')
      .text(address, 60, 85)
      .text(`${website}${phone ? ` · ${phone}` : ''}`, 60, 98)

    doc.fontSize(10).fillColor('black')
      .text(new Date().toLocaleDateString('en-US',
        { year: 'numeric', month: 'long', day: 'numeric' }),
        60, 140, { align: 'right', width: 492 })

    // Recipient
    doc.text(`Re: Invoice ${inv.invoice_number} — Dispute / Reconsideration Request`, 60, 180)
    doc.text(`Billed to: ${inv.customer_name}`, 60, 196)
    doc.text(`Total: $${Number(inv.total).toFixed(2)}    Denied: $${Number(inv.denied_amount || 0).toFixed(2)}`, 60, 212)

    // Body
    let y = 250
    doc.fontSize(11).text('To whom it may concern:', 60, y)
    y += 25
    doc.fontSize(10).text(
      `We are writing to formally dispute the denial of charges on invoice ${inv.invoice_number} ` +
      `dated ${inv.date}. The following calibrations were performed according to OEM position statements ` +
      `and documented per industry-standard practices:`,
      60, y, { width: 490 })
    y += 55

    // Line items
    doc.font('Helvetica-Bold').text('Services Performed:', 60, y)
    y += 16
    doc.font('Helvetica')
    for (const li of (inv.line_items || [])) {
      doc.text(`• ${li.description} — $${Number(li.amount).toFixed(2)}`, 80, y, { width: 470 })
      y += 14
    }

    y += 10
    doc.font('Helvetica-Bold').text('Denial Reason Cited:', 60, y)
    y += 16
    doc.font('Helvetica').fillColor('#555')
      .text(inv.denial_reason || '(no reason provided)', 80, y, { width: 470 })
    y += 30
    doc.fillColor('black').font('Helvetica-Bold').text('Our Response:', 60, y)
    y += 16
    doc.font('Helvetica')
      .text(
        `Each calibration listed was required per OEM documentation and was performed using ` +
        `approved equipment under proper conditions. Full photographic evidence, pre-scan, ` +
        `and post-scan reports are available upon request, along with GPS-verified on-site ` +
        `timing records.`,
        60, y, { width: 490 })
    y += 50
    doc.text(
      `We respectfully request reconsideration of the denied line items. Please contact us ` +
      `at your earliest convenience to discuss documentation requirements or schedule a review.`,
      60, y, { width: 490 })
    y += 45

    doc.text(`Sincerely,`, 60, y)
    y += 30
    doc.font('Helvetica-Bold').text(companyName, 60, y)
    doc.font('Helvetica').fillColor('#555').fontSize(9)
      .text(`${website}${phone ? ` · ${phone}` : ''}`, 60, y + 14)

    doc.end()
  } catch (e) {
    console.error('[disputes] letter failed:', e.message)
    if (!res.headersSent) res.status(500).json({ error: e.message })
  }
})

export default router
