import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { buildInvoicePayUrl } from './portal.js'

const router = express.Router()

const CHUNK_SIZE = 30

// ── Cache helpers ────────────────────────────────────────────────────────────

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

// ── Invoice storage ──────────────────────────────────────────────────────────

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

// ── Services storage ─────────────────────────────────────────────────────────

async function readServices(req) {
  const segment = getSegment(req)
  return await cacheGet(segment, 'books_services', null)
}

async function writeServices(req, services) {
  const segment = getSegment(req)
  await cacheSet(segment, 'books_services', JSON.stringify(services))
}

const DEFAULT_SERVICES = [
  { id: 'svc_001', name: 'Front Camera Calibration', category: 'Calibration', unit_price: 175, active: true },
  { id: 'svc_002', name: 'Rear Camera Calibration', category: 'Calibration', unit_price: 175, active: true },
  { id: 'svc_003', name: 'Front Radar Calibration', category: 'Calibration', unit_price: 195, active: true },
  { id: 'svc_004', name: 'Blind Spot Monitor Calibration', category: 'Calibration', unit_price: 175, active: true },
  { id: 'svc_005', name: 'Lane Keep Assist Calibration', category: 'Calibration', unit_price: 175, active: true },
  { id: 'svc_006', name: 'Adaptive Cruise Control Calibration', category: 'Calibration', unit_price: 195, active: true },
  { id: 'svc_007', name: 'Parking Assist Calibration', category: 'Calibration', unit_price: 150, active: true },
  { id: 'svc_008', name: '360 Camera System Calibration', category: 'Calibration', unit_price: 250, active: true },
  { id: 'svc_009', name: 'Dynamic ADAS Suite (multiple systems)', category: 'Calibration', unit_price: 395, active: true },
  { id: 'svc_010', name: 'Travel Fee', category: 'Other', unit_price: 0, active: true },
]

async function getOrSeedServices(req) {
  let services = await readServices(req)
  if (!services) {
    services = DEFAULT_SERVICES
    await writeServices(req, services)
  }
  return services
}

// ── Invoice number counter ───────────────────────────────────────────────────

async function nextInvoiceNumber(req) {
  const segment = getSegment(req)
  let counter = await cacheGet(segment, 'books_counter', 0)
  counter = (counter || 0) + 1
  await cacheSet(segment, 'books_counter', JSON.stringify(counter))
  return `INV-${String(counter).padStart(4, '0')}`
}

// ── Compute totals ───────────────────────────────────────────────────────────

function computeTotals(invoice) {
  const line_items = Array.isArray(invoice.line_items) ? invoice.line_items : []
  const subtotal = line_items.reduce((sum, li) => sum + (Number(li.amount) || 0), 0)
  const tax_rate = Number(invoice.tax_rate) || 0
  const tax_amount = Math.round(subtotal * tax_rate) / 100
  const discount = Number(invoice.discount) || 0
  const total = Math.max(0, subtotal + tax_amount - discount)
  const amount_paid = Number(invoice.amount_paid) || 0
  const balance_due = Math.max(0, total - amount_paid)
  return { subtotal, tax_rate, tax_amount, discount, total, amount_paid, balance_due }
}

function applyLineAmounts(line_items) {
  return (line_items || []).map(li => ({
    ...li,
    amount: Math.round((Number(li.qty) || 0) * (Number(li.rate) || 0) * 100) / 100,
  }))
}

// ── Overdue check ────────────────────────────────────────────────────────────

function checkOverdue(invoice) {
  if (invoice.status === 'sent') {
    const today = new Date().toISOString().slice(0, 10)
    if (invoice.due_date && invoice.due_date < today) {
      return { ...invoice, status: 'overdue' }
    }
  }
  return invoice
}

// ── Dashboard ────────────────────────────────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  try {
    const invoices = (await readInvoices(req)).map(checkOverdue)

    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const monthStr = `${year}-${String(month).padStart(2, '0')}`

    let revenue_mtd = 0
    let outstanding = 0
    let overdue_count = 0
    let paid_mtd = 0
    let invoice_count = invoices.length
    let draft_count = 0

    for (const inv of invoices) {
      if (inv.status === 'paid') {
        const paidDate = (inv.paid_at || '').slice(0, 7)
        if (paidDate === monthStr) {
          revenue_mtd += inv.total || 0
          paid_mtd += inv.amount_paid || 0
        }
      }
      if (inv.status === 'sent' || inv.status === 'overdue') {
        outstanding += inv.balance_due || 0
      }
      if (inv.status === 'overdue') overdue_count++
      if (inv.status === 'draft') draft_count++
    }

    res.json({ revenue_mtd, outstanding, overdue_count, paid_mtd, invoice_count, draft_count })
  } catch (err) {
    console.error('[books dashboard]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Invoices list ────────────────────────────────────────────────────────────

router.get('/invoices', async (req, res) => {
  try {
    const invoices = (await readInvoices(req))
      .map(checkOverdue)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    res.json(invoices)
  } catch (err) {
    console.error('[books GET invoices]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Get single invoice ───────────────────────────────────────────────────────

router.get('/invoices/:id', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const invoice = invoices.find(i => i.id === req.params.id)
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
    res.json(checkOverdue(invoice))
  } catch (err) {
    console.error('[books GET invoice]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Create invoice ───────────────────────────────────────────────────────────

router.post('/invoices', async (req, res) => {
  try {
    const b = req.body
    const now = new Date().toISOString()
    const today = now.slice(0, 10)

    // Compute due date from terms if not provided
    const terms = b.terms || 'Net 14'
    let due_date = b.due_date || ''
    if (!due_date) {
      const daysMap = { 'Net 7': 7, 'Net 14': 14, 'Net 30': 30, 'Due on Receipt': 0 }
      const days = daysMap[terms] ?? 14
      const d = new Date(today)
      d.setDate(d.getDate() + days)
      due_date = d.toISOString().slice(0, 10)
    }

    const line_items = applyLineAmounts(b.line_items)
    // Use caller-supplied invoice number if provided, otherwise auto-assign
    const invoice_number = (b.invoice_number && b.invoice_number.trim())
      ? b.invoice_number.trim()
      : await nextInvoiceNumber(req)

    const base = {
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      invoice_number,
      customer_name: b.customer_name || '',
      customer_email: b.customer_email || '',
      customer_phone: b.customer_phone || '',
      customer_address: b.customer_address || '',
      date: b.date || today,
      due_date,
      status: b.status || 'draft',
      line_items,
      tax_rate: Number(b.tax_rate) || 0,
      discount: Number(b.discount) || 0,
      amount_paid: 0,
      notes: b.notes || '',
      terms,
      created_at: now,
      sent_at: null,
      paid_at: null,
    }

    const totals = computeTotals(base)
    const invoice = { ...base, ...totals }

    const invoices = await readInvoices(req)
    invoices.push(invoice)
    await writeInvoices(req, invoices)
    res.status(201).json(invoice)
  } catch (err) {
    console.error('[books POST invoice]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Update invoice ───────────────────────────────────────────────────────────

router.put('/invoices/:id', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const idx = invoices.findIndex(i => i.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Invoice not found' })

    const b = req.body
    const existing = invoices[idx]

    const line_items = applyLineAmounts(b.line_items !== undefined ? b.line_items : existing.line_items)

    const updated = {
      ...existing,
      ...b,
      id: existing.id,
      invoice_number: existing.invoice_number,
      created_at: existing.created_at,
      line_items,
      tax_rate: Number(b.tax_rate !== undefined ? b.tax_rate : existing.tax_rate) || 0,
      discount: Number(b.discount !== undefined ? b.discount : existing.discount) || 0,
      amount_paid: Number(b.amount_paid !== undefined ? b.amount_paid : existing.amount_paid) || 0,
    }

    // Carry sent_at / paid_at timestamps
    if (b.status === 'sent' && !existing.sent_at) updated.sent_at = new Date().toISOString()
    if (b.status === 'paid' && !existing.paid_at) updated.paid_at = new Date().toISOString()

    const totals = computeTotals(updated)
    invoices[idx] = { ...updated, ...totals }
    await writeInvoices(req, invoices)
    res.json(invoices[idx])
  } catch (err) {
    console.error('[books PUT invoice]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Patch invoice (partial update) ──────────────────────────────────────

router.patch('/invoices/:id', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const idx = invoices.findIndex(i => i.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Invoice not found' })

    const existing = invoices[idx]
    const allowed = ['status', 'billing_status', 'sent_at', 'paid_at', 'escalated_at', 'escalation_notes']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    // Auto-set timestamps on status changes
    if (updates.status === 'sent' && !existing.sent_at) updates.sent_at = new Date().toISOString()
    if (updates.status === 'paid' && !existing.paid_at) updates.paid_at = new Date().toISOString()

    invoices[idx] = { ...existing, ...updates }

    // Recompute totals if line items could have changed (they won't here, but safety)
    const totals = computeTotals(invoices[idx])
    invoices[idx] = { ...invoices[idx], ...totals }

    await writeInvoices(req, invoices)
    res.json(invoices[idx])
  } catch (err) {
    console.error('[books PATCH invoice]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Quick status change ─────────────────────────────────────────────────

router.patch('/invoices/:id/status', async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['draft', 'sent', 'paid', 'overdue', 'void', 'job_complete', 'invoice_needed', 'invoice_created', 'awaiting_payment', 'escalated']
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` })
    }

    const invoices = await readInvoices(req)
    const idx = invoices.findIndex(i => i.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Invoice not found' })

    const existing = invoices[idx]
    const updates = { status }

    // Auto-set timestamps
    if (status === 'sent' && !existing.sent_at) updates.sent_at = new Date().toISOString()
    if (status === 'paid' && !existing.paid_at) updates.paid_at = new Date().toISOString()
    if (status === 'escalated') updates.escalated_at = new Date().toISOString()

    invoices[idx] = { ...existing, ...updates }
    await writeInvoices(req, invoices)
    res.json(invoices[idx])
  } catch (err) {
    console.error('[books PATCH invoice status]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Delete invoice ───────────────────────────────────────────────────────────

router.delete('/invoices/:id', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const filtered = invoices.filter(i => i.id !== req.params.id)
    if (filtered.length === invoices.length) return res.status(404).json({ error: 'Invoice not found' })
    await writeInvoices(req, filtered)
    res.json({ success: true })
  } catch (err) {
    console.error('[books DELETE invoice]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Record payment ───────────────────────────────────────────────────────────

router.post('/invoices/:id/payment', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const idx = invoices.findIndex(i => i.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Invoice not found' })

    const amount = Number(req.body.amount) || 0
    if (amount <= 0) return res.status(400).json({ error: 'Payment amount must be > 0' })

    const inv = invoices[idx]
    const new_paid = Math.min((inv.amount_paid || 0) + amount, inv.total || 0)
    const balance_due = Math.max(0, (inv.total || 0) - new_paid)
    const status = balance_due <= 0 ? 'paid' : inv.status
    const paid_at = status === 'paid' ? (inv.paid_at || new Date().toISOString()) : inv.paid_at

    invoices[idx] = { ...inv, amount_paid: new_paid, balance_due, status, paid_at }
    await writeInvoices(req, invoices)
    res.json(invoices[idx])
  } catch (err) {
    console.error('[books payment]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── PDF generation ───────────────────────────────────────────────────────────

// Admin: get the public pay link for an invoice (to copy + send to customer)
router.get('/invoices/:id/pay-link', async (req, res) => {
  try {
    const url = buildInvoicePayUrl(req, req.params.id)
    res.json({ url })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/invoices/:id/pdf', async (req, res) => {
  try {
    const invoices = await readInvoices(req)
    const invoice = invoices.find(i => i.id === req.params.id)
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' })

    const inv = checkOverdue(invoice)

    const doc = new PDFDocument({ size: 'LETTER', margin: 50 })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${inv.invoice_number}.pdf"`)
    doc.pipe(res)

    const ORANGE = '#CD4419'
    const LIGHT_GRAY = '#f7f7f7'
    const TEXT_DARK = '#1a1a1a'
    const TEXT_MED = '#555555'
    const PAGE_WIDTH = doc.page.width
    const MARGIN = 50
    const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

    // ── Orange header bar ──────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_WIDTH, 80).fill(ORANGE)

    // Company name left
    doc.font('Helvetica-Bold').fontSize(20).fillColor('white')
      .text('ABSOLUTE ADAS', MARGIN, 22, { width: CONTENT_WIDTH / 2 })
    doc.font('Helvetica').fontSize(11).fillColor('rgba(255,255,255,0.85)')
      .text('absoluteadas.com', MARGIN, 46)

    // Invoice label + number right
    const invoiceLabel = inv.invoice_type === 'insurance' ? 'INSURANCE INVOICE'
      : inv.invoice_type === 'shop' ? 'SHOP INVOICE' : 'INVOICE'
    const labelFontSize = invoiceLabel === 'INVOICE' ? 22 : 16
    doc.font('Helvetica-Bold').fontSize(labelFontSize).fillColor('white')
      .text(invoiceLabel, 0, invoiceLabel === 'INVOICE' ? 18 : 22, { width: PAGE_WIDTH - MARGIN, align: 'right' })
    doc.font('Helvetica').fontSize(12).fillColor('rgba(255,255,255,0.9)')
      .text(inv.invoice_number, 0, 44, { width: PAGE_WIDTH - MARGIN, align: 'right' })

    // ── Bill To + Invoice details row ──────────────────────────────────────
    let y = 106

    doc.font('Helvetica-Bold').fontSize(9).fillColor(ORANGE)
      .text('BILL TO', MARGIN, y)

    doc.font('Helvetica-Bold').fontSize(9).fillColor(ORANGE)
      .text('INVOICE DETAILS', PAGE_WIDTH / 2, y)

    y += 14

    const isB2B = inv.customer_type === 'b2b' || (!inv.customer_type && true)
    doc.font('Helvetica-Bold').fontSize(12).fillColor(TEXT_DARK)
      .text(inv.customer_name || '—', MARGIN, y, { width: CONTENT_WIDTH / 2 - 10 })

    // Right column: date details
    const labelX = PAGE_WIDTH / 2
    const valueX = PAGE_WIDTH / 2 + 90
    const detailWidth = CONTENT_WIDTH / 2

    function detailRow(label, value, rowY) {
      doc.font('Helvetica').fontSize(10).fillColor(TEXT_MED)
        .text(label, labelX, rowY, { width: 88 })
      doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT_DARK)
        .text(value || '—', valueX, rowY, { width: detailWidth - 90 })
    }

    detailRow('Date:', inv.date || '', y)
    y += 16
    detailRow('Due Date:', inv.due_date || '', y)
    y += 16
    if (inv.po_number) {
      detailRow('PO #:', inv.po_number, y)
      y += 16
    }
    // Status badge
    const statusColors = { draft: '#888888', sent: '#2563EB', paid: '#16a34a', overdue: '#dc2626', void: '#888888' }
    const statusColor = statusColors[inv.status] || '#888888'
    const statusLabel = inv.status === 'paid' ? 'Paid' : inv.status.charAt(0).toUpperCase() + inv.status.slice(1)
    doc.roundedRect(valueX, y - 1, 52, 16, 4).fill(statusColor)
    doc.font('Helvetica-Bold').fontSize(9).fillColor('white')
      .text(statusLabel, valueX + 2, y + 2, { width: 50, align: 'center' })

    // Customer details below name
    let custY = y - (inv.po_number ? 48 : 32) + 18
    if (isB2B && inv.customer_contact) {
      doc.font('Helvetica').fontSize(10).fillColor(TEXT_MED)
        .text(`Contact: ${inv.customer_contact}`, MARGIN, custY, { width: CONTENT_WIDTH / 2 - 10 })
      custY += 14
    }
    if (inv.customer_email) {
      doc.font('Helvetica').fontSize(10).fillColor(TEXT_MED)
        .text(inv.customer_email, MARGIN, custY, { width: CONTENT_WIDTH / 2 - 10 })
      custY += 14
    }
    if (inv.customer_phone) {
      doc.font('Helvetica').fontSize(10).fillColor(TEXT_MED)
        .text(inv.customer_phone, MARGIN, custY, { width: CONTENT_WIDTH / 2 - 10 })
      custY += 14
    }
    if (inv.customer_address) {
      doc.font('Helvetica').fontSize(10).fillColor(TEXT_MED)
        .text(inv.customer_address, MARGIN, custY, { width: CONTENT_WIDTH / 2 - 10 })
    }

    y += 30

    // ── Line items table ───────────────────────────────────────────────────
    const TABLE_TOP = Math.max(y, 220)
    const COL = {
      desc: MARGIN,
      qty: MARGIN + CONTENT_WIDTH * 0.55,
      rate: MARGIN + CONTENT_WIDTH * 0.68,
      amount: MARGIN + CONTENT_WIDTH * 0.82,
    }
    const COL_WIDTHS = {
      desc: CONTENT_WIDTH * 0.54,
      qty: CONTENT_WIDTH * 0.12,
      rate: CONTENT_WIDTH * 0.13,
      amount: CONTENT_WIDTH * 0.18,
    }
    const ROW_H = 22

    // Header
    doc.rect(MARGIN, TABLE_TOP, CONTENT_WIDTH, ROW_H).fill(ORANGE)
    doc.font('Helvetica-Bold').fontSize(9).fillColor('white')
    doc.text('DESCRIPTION', COL.desc + 4, TABLE_TOP + 7, { width: COL_WIDTHS.desc })
    doc.text('QTY', COL.qty, TABLE_TOP + 7, { width: COL_WIDTHS.qty, align: 'center' })
    doc.text('RATE', COL.rate, TABLE_TOP + 7, { width: COL_WIDTHS.rate, align: 'right' })
    doc.text('AMOUNT', COL.amount, TABLE_TOP + 7, { width: COL_WIDTHS.amount, align: 'right' })

    // Rows
    const line_items = Array.isArray(inv.line_items) ? inv.line_items : []
    let rowY = TABLE_TOP + ROW_H
    const isShopInv = inv.invoice_type === 'shop'

    for (let i = 0; i < line_items.length; i++) {
      const li = line_items[i]
      const bg = i % 2 === 0 ? 'white' : LIGHT_GRAY
      doc.rect(MARGIN, rowY, CONTENT_WIDTH, ROW_H).fill(bg)
      doc.font('Helvetica').fontSize(10).fillColor(TEXT_DARK)
      doc.text(li.description || '', COL.desc + 4, rowY + 6, { width: COL_WIDTHS.desc - 4, ellipsis: true })
      doc.text(String(li.qty || 0), COL.qty, rowY + 6, { width: COL_WIDTHS.qty, align: 'center' })
      if (isShopInv && li.retail_amount && li.retail_amount !== li.amount) {
        // Show original price struck through, then discounted
        doc.font('Helvetica').fontSize(8).fillColor('#999999')
          .text(`$${Number(li.rate || 0).toFixed(2)}`, COL.rate, rowY + 3, { width: COL_WIDTHS.rate, align: 'right' })
        doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT_DARK)
          .text(`$${Number(li.amount || 0).toFixed(2)}`, COL.amount, rowY + 6, { width: COL_WIDTHS.amount, align: 'right' })
      } else {
        doc.text(`$${Number(li.rate || 0).toFixed(2)}`, COL.rate, rowY + 6, { width: COL_WIDTHS.rate, align: 'right' })
        doc.text(`$${Number(li.amount || 0).toFixed(2)}`, COL.amount, rowY + 6, { width: COL_WIDTHS.amount, align: 'right' })
      }
      rowY += ROW_H
    }

    // Bottom border of table
    doc.rect(MARGIN, rowY, CONTENT_WIDTH, 1).fill('#e0e0e0')
    rowY += 16

    // ── Totals section ─────────────────────────────────────────────────────
    const TOTALS_LABEL_X = PAGE_WIDTH - MARGIN - 220
    const TOTALS_VALUE_X = PAGE_WIDTH - MARGIN - 100

    function totalsRow(label, value, bold = false, color = TEXT_DARK) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(TEXT_MED)
        .text(label, TOTALS_LABEL_X, rowY, { width: 118 })
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(color)
        .text(value, TOTALS_VALUE_X, rowY, { width: 100, align: 'right' })
      rowY += 16
    }

    if (inv.invoice_type === 'shop' && (inv.discount_pct || 0) > 0) {
      // Compute retail subtotal from line items
      const retailSub = line_items.reduce((s, li) => s + (Number(li.retail_amount || li.rate || 0)), 0)
      totalsRow('Retail Total', `$${retailSub.toFixed(2)}`)
      totalsRow(`Discount (${inv.discount_pct}%)`, `-$${(retailSub - (inv.subtotal || 0)).toFixed(2)}`)
    }
    totalsRow('Subtotal', `$${Number(inv.subtotal || 0).toFixed(2)}`)
    if ((inv.tax_rate || 0) > 0) {
      totalsRow(`Tax (${inv.tax_rate}%)`, `$${Number(inv.tax_amount || 0).toFixed(2)}`)
    }
    if ((inv.discount || 0) > 0) {
      totalsRow('Discount', `-$${Number(inv.discount || 0).toFixed(2)}`)
    }

    // Total Due box
    rowY += 4
    doc.rect(TOTALS_LABEL_X - 8, rowY - 4, 220, 26).fill(ORANGE)
    doc.font('Helvetica-Bold').fontSize(11).fillColor('white')
      .text('TOTAL DUE', TOTALS_LABEL_X, rowY + 3, { width: 118 })
    doc.font('Helvetica-Bold').fontSize(11).fillColor('white')
      .text(`$${Number(inv.total || 0).toFixed(2)}`, TOTALS_VALUE_X, rowY + 3, { width: 100, align: 'right' })
    rowY += 30 + 8

    if ((inv.amount_paid || 0) > 0) {
      totalsRow('Amount Paid', `-$${Number(inv.amount_paid || 0).toFixed(2)}`)
    }

    // Balance due
    const balanceColor = (inv.balance_due || 0) <= 0 ? '#16a34a' : '#dc2626'
    totalsRow('Balance Due', `$${Number(inv.balance_due || 0).toFixed(2)}`, true, balanceColor)

    // ── Notes ──────────────────────────────────────────────────────────────
    if (inv.notes && inv.notes.trim()) {
      rowY += 20
      doc.font('Helvetica-Bold').fontSize(9).fillColor(ORANGE)
        .text('NOTES', MARGIN, rowY)
      rowY += 13
      doc.font('Helvetica').fontSize(10).fillColor(TEXT_MED)
        .text(inv.notes, MARGIN, rowY, { width: CONTENT_WIDTH })
    }

    // ── Pay Online button + QR code (only if balance due) ──────────────────
    if ((inv.balance_due || inv.total || 0) > 0 && inv.status !== 'paid') {
      try {
        const payUrl = buildInvoicePayUrl(req, inv.id)
        rowY += 30

        // QR code on the left, pay button on the right
        const qrDataUrl = await QRCode.toDataURL(payUrl, { width: 100, margin: 0 })
        const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64')
        doc.image(qrBuffer, MARGIN, rowY, { width: 65, height: 65 })
        doc.font('Helvetica').fontSize(7).fillColor('#888888')
          .text('Scan to pay', MARGIN, rowY + 68, { width: 65, align: 'center' })

        const btnX = MARGIN + 90
        const btnW = CONTENT_WIDTH - 90
        doc.rect(btnX, rowY + 5, btnW, 40).fill(ORANGE)
        doc.font('Helvetica-Bold').fontSize(13).fillColor('white')
          .text('PAY THIS INVOICE ONLINE', btnX, rowY + 13,
            { width: btnW, align: 'center', link: payUrl })
        doc.font('Helvetica').fontSize(8).fillColor('white')
          .text('Card · ACH · Check · Zelle', btnX, rowY + 30,
            { width: btnW, align: 'center', link: payUrl })
        rowY += 85
        doc.font('Helvetica').fontSize(7).fillColor('#999999')
          .text(payUrl, MARGIN, rowY, { width: CONTENT_WIDTH, align: 'center', link: payUrl })
      } catch (e) {
        console.warn('[books PDF] pay link failed:', e.message)
      }
    }

    // ── 90-day warranty notice ─────────────────────────────────────────────
    rowY += 20
    doc.font('Helvetica-Bold').fontSize(8).fillColor(ORANGE)
      .text('90-DAY WORKMANSHIP WARRANTY', MARGIN, rowY, { width: CONTENT_WIDTH, align: 'center' })
    rowY += 11
    doc.font('Helvetica').fontSize(7).fillColor('#888888')
      .text('All calibrations performed per OEM specifications. Contact us within 90 days if any calibrated system requires recalibration due to workmanship.',
        MARGIN, rowY, { width: CONTENT_WIDTH, align: 'center' })

    // ── Footer ─────────────────────────────────────────────────────────────
    const FOOTER_Y = doc.page.height - 45
    doc.rect(0, FOOTER_Y - 10, PAGE_WIDTH, 1).fill('#ebebeb')
    doc.font('Helvetica').fontSize(9).fillColor(TEXT_MED)
      .text('Thank you for your business!  ·  Absolute ADAS  ·  absoluteadas.com',
        MARGIN, FOOTER_Y, { width: CONTENT_WIDTH, align: 'center' })

    if (inv.terms) {
      doc.font('Helvetica').fontSize(8).fillColor('#aaaaaa')
        .text(`Terms: ${inv.terms}`, MARGIN, FOOTER_Y + 14, { width: CONTENT_WIDTH, align: 'center' })
    }

    doc.end()
  } catch (err) {
    console.error('[books PDF]', err.message)
    if (!res.headersSent) res.status(500).json({ error: err.message })
  }
})

// ── Services ─────────────────────────────────────────────────────────────────

router.get('/services', async (req, res) => {
  try {
    const services = await getOrSeedServices(req)
    res.json(services)
  } catch (err) {
    console.error('[books GET services]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/services', async (req, res) => {
  try {
    const b = req.body
    const services = await getOrSeedServices(req)
    const service = {
      id: `svc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: b.name || '',
      category: b.category || 'Calibration',
      unit_price: Number(b.unit_price) || 0,
      active: b.active !== undefined ? !!b.active : true,
    }
    services.push(service)
    await writeServices(req, services)
    res.status(201).json(service)
  } catch (err) {
    console.error('[books POST service]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.put('/services/:id', async (req, res) => {
  try {
    const services = await getOrSeedServices(req)
    const idx = services.findIndex(s => s.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Service not found' })
    services[idx] = {
      ...services[idx],
      ...req.body,
      id: services[idx].id,
    }
    await writeServices(req, services)
    res.json(services[idx])
  } catch (err) {
    console.error('[books PUT service]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.delete('/services/:id', async (req, res) => {
  try {
    const services = await getOrSeedServices(req)
    const filtered = services.filter(s => s.id !== req.params.id)
    if (filtered.length === services.length) return res.status(404).json({ error: 'Service not found' })
    await writeServices(req, filtered)
    res.json({ success: true })
  } catch (err) {
    console.error('[books DELETE service]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── CRM Shops cache reader (mirrors shops.js pattern) ────────────────────────

async function readShops(req) {
  const segment = getSegment(req)
  // Try chunked format first
  try {
    const metaRaw = await segment.getValue('crm_shops_meta')
    if (metaRaw) {
      const { chunks } = JSON.parse(metaRaw)
      const parts = await Promise.all(
        Array.from({ length: chunks }, (_, i) =>
          segment.getValue(`crm_shops_chunk_${i}`)
            .then(v => (v ? JSON.parse(v) : []))
            .catch(() => [])
        )
      )
      return parts.flat()
    }
  } catch (e) { /* fall through to legacy */ }
  // Legacy single-key fallback
  try {
    const val = await segment.getValue('crm_shops')
    return val ? JSON.parse(val) : []
  } catch (e) {
    if (e?.statusCode === 404 || e?.errorInfo?.statusCode === 404) return []
    throw e
  }
}

// ── Shop lookup endpoint ─────────────────────────────────────────────────────

router.get('/shop-lookup/:shopName', async (req, res) => {
  try {
    const query = decodeURIComponent(req.params.shopName).toLowerCase().trim()
    const shops = await readShops(req)
    // Find shops that match (partial, case-insensitive)
    const results = shops.filter(s =>
      (s.shop_name || '').toLowerCase().includes(query)
    ).slice(0, 8)
    if (results.length === 0) {
      return res.json({ found: false, results: [] })
    }
    // Return results with relevant fields
    const mapped = results.map(s => ({
      id: s.id,
      shop_name: s.shop_name || '',
      shop_rate: s.shop_rate || '0',
      insurance_rate: s.insurance_rate || '0',
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      people: s.people || [],
    }))
    res.json({ found: true, results: mapped, shop: mapped[0] })
  } catch (err) {
    console.error('[books shop-lookup]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Create invoices from job ──────────────────────────────────────────────────

router.post('/invoices/from-job', async (req, res) => {
  try {
    const { job, crm_shop, insurance_company, invoice_number_insurance, invoice_number_shop } = req.body
    if (!job) return res.status(400).json({ error: 'job is required' })

    // 0. Parse billing_rules from the CRM shop (if present)
    let billingRules = null
    if (crm_shop?.billing_rules) {
      billingRules = typeof crm_shop.billing_rules === 'string'
        ? JSON.parse(crm_shop.billing_rules)
        : crm_shop.billing_rules
    }

    // 1. Parse calibrations
    let calibrations = []
    try {
      calibrations = typeof job.calibrations === 'string'
        ? JSON.parse(job.calibrations || '[]')
        : (job.calibrations || [])
    } catch { calibrations = [] }

    // 2. Load services catalog
    const services = await getOrSeedServices(req)

    // 3. Match calibrations to services
    function findService(calName) {
      const lc = (calName || '').toLowerCase()
      const firstWord = lc.split(' ')[0]
      return services.find(s =>
        s.name.toLowerCase().includes(lc) ||
        s.name.toLowerCase().includes(firstWord)
      )
    }

    // Resolve service price — billing_rules custom prices override catalog
    function resolvePrice(svc, calName) {
      if (!svc) return 175
      if (billingRules?.discount_type === 'custom' && billingRules.custom_prices) {
        const customPrice = billingRules.custom_prices[svc.id]
        if (customPrice !== undefined && customPrice !== null) return Number(customPrice)
      }
      return svc.unit_price
    }

    const now = new Date().toISOString()
    const today = now.slice(0, 10)

    // Use billing_rules.default_terms to compute due date
    const termsStr = billingRules?.default_terms || 'Net 14'
    const termsDays = (() => {
      if (termsStr === 'Due on Receipt') return 0
      const match = termsStr.match(/Net\s+(\d+)/i)
      return match ? parseInt(match[1], 10) : 14
    })()
    const dueDate = (() => {
      const d = new Date(today)
      d.setDate(d.getDate() + termsDays)
      return d.toISOString().slice(0, 10)
    })()

    // Resolve discount — billing_rules takes precedence over legacy shop_rate
    let discPct = 0
    let discFlat = 0
    if (billingRules) {
      if (billingRules.discount_type === 'percentage') {
        discPct = parseFloat(billingRules.discount_value || 0)
      } else if (billingRules.discount_type === 'flat') {
        discFlat = parseFloat(billingRules.discount_value || 0)
      }
      // 'custom' type uses per-service pricing via resolvePrice, no blanket discount
    } else {
      discPct = parseFloat(crm_shop?.shop_rate || 0)
    }

    // Resolve invoice type from billing rules
    const invoiceType = billingRules?.invoice_type || 'dual'

    // Build line items — use override if provided (from modal with user-edited prices)
    const lineItemsOverride = req.body.line_items_override
    let retailLineItems
    if (Array.isArray(lineItemsOverride) && lineItemsOverride.length > 0) {
      retailLineItems = lineItemsOverride.map(li => ({
        id: `li_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        description: li.description || li.name || '',
        qty: Number(li.qty) || 1,
        rate: Number(li.rate) || 175,
        amount: (Number(li.qty) || 1) * (Number(li.rate) || 175),
        retail_amount: (Number(li.qty) || 1) * (Number(li.rate) || 175),
      }))
    } else {
      retailLineItems = calibrations.map(cal => {
        const svc = findService(cal.name)
        const rate = resolvePrice(svc, cal.name)
        return {
          id: `li_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          description: (cal.name || '') + (cal.mode ? ` (${cal.mode})` : ''),
          qty: 1,
          rate,
          amount: rate,
          retail_amount: rate,
          no_match: !svc,
        }
      })
    }

    // Apply discount to shop line items
    const shopLineItems = retailLineItems.map(li => {
      const qty = Number(li.qty) || 1
      const rate = Number(li.rate) || 0
      const retail = qty * rate
      let discounted = retail
      if (discPct > 0) {
        discounted = Math.round(retail * (1 - discPct / 100) * 100) / 100
      } else if (discFlat > 0) {
        // Distribute flat discount proportionally across line items
        const totalRetail = retailLineItems.reduce((sum, l) => sum + (Number(l.qty) || 1) * (Number(l.rate) || 0), 0)
        const share = totalRetail > 0 ? retail / totalRetail : 0
        discounted = Math.round((retail - discFlat * share) * 100) / 100
        if (discounted < 0) discounted = 0
      }
      return {
        ...li,
        id: `li_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        amount: discounted,
        retail_amount: retail,
      }
    })

    // Resolve billing contact — billing_rules overrides shop default
    const billingContact = billingRules?.billing_contact_name || crm_shop?.people?.[0]?.name || ''
    const billingEmail = billingRules?.billing_contact_email || crm_shop?.email || ''
    const billingPhone = billingRules?.billing_contact_phone || crm_shop?.phone || ''

    // 5. Generate invoice numbers (use caller-supplied numbers if provided)
    const insuranceNumber = (invoice_number_insurance && invoice_number_insurance.trim())
      ? invoice_number_insurance.trim()
      : await nextInvoiceNumber(req)
    const shopNumber = (invoice_number_shop && invoice_number_shop.trim())
      ? invoice_number_shop.trim()
      : await nextInvoiceNumber(req)

    const createdInvoices = []

    // 6. Build insurance invoice (if dual or insurance_only)
    if (invoiceType === 'dual' || invoiceType === 'insurance_only') {
      const insBase = {
        id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        invoice_number: insuranceNumber,
        customer_type: 'b2b',
        invoice_type: 'insurance',
        customer_name: insurance_company || 'Insurance',
        customer_email: '',
        customer_phone: '',
        customer_address: '',
        customer_contact: '',
        po_number: '',
        crm_shop_id: crm_shop?.id || '',
        discount_pct: 0,
        date: today,
        due_date: dueDate,
        status: 'draft',
        line_items: retailLineItems,
        tax_rate: 0,
        discount: 0,
        amount_paid: 0,
        notes: `Job #${job.id || ''} — ${job.vehicle || ''} — Tech: ${job.technician || ''}`,
        terms: termsStr,
        created_at: now,
        sent_at: null,
        paid_at: null,
        job_id: job.id || '',
      }
      const insTotals = computeTotals(insBase)
      createdInvoices.push({ ...insBase, ...insTotals })
    }

    // 7. Build shop invoice (if dual or single)
    if (invoiceType === 'dual' || invoiceType === 'single') {
      const shopBase = {
        id: `inv_${Date.now() + 1}_${Math.random().toString(36).slice(2, 6)}`,
        invoice_number: shopNumber,
        customer_type: 'b2b',
        invoice_type: invoiceType === 'single' ? 'single' : 'shop',
        customer_name: crm_shop?.shop_name || job.shop_name || '',
        customer_email: billingEmail,
        customer_phone: billingPhone,
        customer_address: crm_shop?.address || '',
        customer_contact: billingContact,
        po_number: '',
        crm_shop_id: crm_shop?.id || '',
        discount_pct: discPct,
        date: today,
        due_date: dueDate,
        status: 'draft',
        line_items: invoiceType === 'single' ? retailLineItems : shopLineItems,
        tax_rate: 0,
        discount: 0,
        amount_paid: 0,
        notes: `Job #${job.id || ''} — ${job.vehicle || ''} — Tech: ${job.technician || ''}`,
        terms: termsStr,
        created_at: now,
        sent_at: null,
        paid_at: null,
        job_id: job.id || '',
      }
      const shopTotals = computeTotals(shopBase)
      createdInvoices.push({ ...shopBase, ...shopTotals })
    }

    // 9. Save invoices
    const invoices = await readInvoices(req)
    invoices.push(...createdInvoices)
    await writeInvoices(req, invoices)

    // Respond with the created invoices — maintain backwards-compatible shape
    const insuranceInvoice = createdInvoices.find(i => i.invoice_type === 'insurance') || null
    const shopInvoice = createdInvoices.find(i => i.invoice_type === 'shop' || i.invoice_type === 'single') || null
    res.status(201).json({ insurance: insuranceInvoice, shop: shopInvoice })
  } catch (err) {
    console.error('[books from-job]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// EXPENSES
// ═══════════════════════════════════════════════════════════════════════════

async function readExpenses(req) {
  const segment = getSegment(req)
  return await cacheGet(segment, 'books_expenses', [])
}

async function writeExpenses(req, expenses) {
  const segment = getSegment(req)
  await cacheSet(segment, 'books_expenses', JSON.stringify(expenses))
}

const EXPENSE_CATEGORIES = ['Fuel', 'Tools & Equipment', 'Software & Subscriptions', 'Marketing', 'Office & Supplies', 'Vehicle', 'Insurance', 'Subcontractor', 'Meals & Entertainment', 'Other']

router.get('/expenses', async (req, res) => {
  try {
    const expenses = await readExpenses(req)
    res.json(expenses.sort((a, b) => (b.date || '').localeCompare(a.date || '')))
  } catch (err) {
    console.error('[books GET expenses]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/expenses', async (req, res) => {
  try {
    const b = req.body
    if (!b.amount || Number(b.amount) <= 0) return res.status(400).json({ error: 'Amount required' })
    const expense = {
      id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date: b.date || new Date().toISOString().slice(0, 10),
      category: b.category || 'Other',
      vendor: b.vendor || '',
      description: b.description || '',
      amount: Math.round(Number(b.amount) * 100) / 100,
      payment_method: b.payment_method || 'Other',
      receipt_note: b.receipt_note || '',
      created_at: new Date().toISOString(),
    }
    const expenses = await readExpenses(req)
    expenses.push(expense)
    await writeExpenses(req, expenses)
    res.status(201).json(expense)
  } catch (err) {
    console.error('[books POST expense]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.put('/expenses/:id', async (req, res) => {
  try {
    const expenses = await readExpenses(req)
    const idx = expenses.findIndex(e => e.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Expense not found' })
    expenses[idx] = { ...expenses[idx], ...req.body, id: expenses[idx].id, created_at: expenses[idx].created_at }
    expenses[idx].amount = Math.round(Number(expenses[idx].amount) * 100) / 100
    await writeExpenses(req, expenses)
    res.json(expenses[idx])
  } catch (err) {
    console.error('[books PUT expense]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.delete('/expenses/:id', async (req, res) => {
  try {
    const expenses = await readExpenses(req)
    const filtered = expenses.filter(e => e.id !== req.params.id)
    if (filtered.length === expenses.length) return res.status(404).json({ error: 'Expense not found' })
    await writeExpenses(req, filtered)
    res.json({ success: true })
  } catch (err) {
    console.error('[books DELETE expense]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/expense-categories', (_req, res) => res.json(EXPENSE_CATEGORIES))

// ═══════════════════════════════════════════════════════════════════════════
// DEPOSITS
// ═══════════════════════════════════════════════════════════════════════════

async function readDeposits(req) {
  const segment = getSegment(req)
  return await cacheGet(segment, 'books_deposits', [])
}

async function writeDeposits(req, deposits) {
  const segment = getSegment(req)
  await cacheSet(segment, 'books_deposits', JSON.stringify(deposits))
}

router.get('/deposits', async (req, res) => {
  try {
    const deposits = await readDeposits(req)
    res.json(deposits.sort((a, b) => (b.date || '').localeCompare(a.date || '')))
  } catch (err) {
    console.error('[books GET deposits]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/deposits', async (req, res) => {
  try {
    const b = req.body
    if (!b.amount || Number(b.amount) <= 0) return res.status(400).json({ error: 'Amount required' })
    const deposit = {
      id: `dep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date: b.date || new Date().toISOString().slice(0, 10),
      amount: Math.round(Number(b.amount) * 100) / 100,
      from: b.from || '',
      memo: b.memo || '',
      method: b.method || 'Check',
      invoice_id: b.invoice_id || '',
      invoice_number: b.invoice_number || '',
      created_at: new Date().toISOString(),
    }
    const deposits = await readDeposits(req)
    deposits.push(deposit)
    await writeDeposits(req, deposits)
    res.status(201).json(deposit)
  } catch (err) {
    console.error('[books POST deposit]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.delete('/deposits/:id', async (req, res) => {
  try {
    const deposits = await readDeposits(req)
    const filtered = deposits.filter(d => d.id !== req.params.id)
    if (filtered.length === deposits.length) return res.status(404).json({ error: 'Deposit not found' })
    await writeDeposits(req, filtered)
    res.json({ success: true })
  } catch (err) {
    console.error('[books DELETE deposit]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// FULL REPORT  —  GET /api/books/report?period=year&year=2025
// ═══════════════════════════════════════════════════════════════════════════

router.get('/report', async (req, res) => {
  try {
    const [allInvoices, allExpenses] = await Promise.all([
      readInvoices(req),
      readExpenses(req),
    ])

    const invoices  = allInvoices.map(checkOverdue)
    const expenses  = allExpenses

    const now       = new Date()
    const thisYear  = now.getFullYear()
    const thisMonth = now.getMonth() + 1

    // ── Period filter ────────────────────────────────────────────────────
    const period = req.query.period || 'year'   // year | quarter | month | all
    const year   = parseInt(req.query.year  || thisYear,  10)
    const month  = parseInt(req.query.month || thisMonth, 10)

    function inPeriod(dateStr) {
      if (!dateStr) return false
      if (period === 'all') return true
      const [y, m] = dateStr.split('-').map(Number)
      if (period === 'year')    return y === year
      if (period === 'month')   return y === year && m === month
      if (period === 'quarter') {
        const q = Math.ceil(month / 3)
        return y === year && Math.ceil(m / 3) === q
      }
      return true
    }

    // ── Revenue: count paid invoices (by paid_at or date for older records) ─
    // We report on SENT+PAID invoices for revenue recognition
    const revenueInvoices = invoices.filter(i =>
      (i.status === 'paid' || i.status === 'sent' || i.status === 'overdue') &&
      inPeriod(i.status === 'paid' ? (i.paid_at || i.date) : i.date)
    )

    const periodExpenses = expenses.filter(e => inPeriod(e.date))

    // ── Monthly breakdown (last 12 months or full year) ──────────────────
    function buildMonths() {
      const months = []
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        months.push({
          key:     `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          label:   d.toLocaleString('en-US', { month: 'short', year: '2-digit' }),
          revenue: 0,
          expenses: 0,
          net: 0,
          paid_count: 0,
        })
      }
      return months
    }

    const monthlyMap = {}
    const months = buildMonths()
    months.forEach(m => { monthlyMap[m.key] = m })

    for (const inv of invoices) {
      if (inv.status !== 'paid') continue
      const dateStr = (inv.paid_at || inv.date || '').slice(0, 7)
      if (monthlyMap[dateStr]) {
        monthlyMap[dateStr].revenue   += inv.total || 0
        monthlyMap[dateStr].paid_count++
      }
    }
    for (const exp of expenses) {
      const dateStr = (exp.date || '').slice(0, 7)
      if (monthlyMap[dateStr]) {
        monthlyMap[dateStr].expenses += exp.amount || 0
      }
    }
    months.forEach(m => {
      m.revenue  = Math.round(m.revenue  * 100) / 100
      m.expenses = Math.round(m.expenses * 100) / 100
      m.net      = Math.round((m.revenue - m.expenses) * 100) / 100
    })

    // ── Revenue by customer ──────────────────────────────────────────────
    const customerMap = {}
    for (const inv of invoices) {
      if (inv.status !== 'paid') continue
      const name = inv.customer_name || 'Unknown'
      if (!customerMap[name]) customerMap[name] = { name, revenue: 0, invoice_count: 0 }
      customerMap[name].revenue       += inv.total || 0
      customerMap[name].invoice_count++
    }
    const byCustomer = Object.values(customerMap)
      .map(c => ({ ...c, revenue: Math.round(c.revenue * 100) / 100 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)

    // ── Revenue by invoice type ──────────────────────────────────────────
    const typeMap = {}
    for (const inv of invoices) {
      if (inv.status !== 'paid') continue
      const t = inv.invoice_type || 'standard'
      if (!typeMap[t]) typeMap[t] = { type: t, revenue: 0, count: 0 }
      typeMap[t].revenue += inv.total || 0
      typeMap[t].count++
    }
    const byType = Object.values(typeMap)
      .map(t => ({ ...t, revenue: Math.round(t.revenue * 100) / 100 }))
      .sort((a, b) => b.revenue - a.revenue)

    // ── Top services (by line item description) ──────────────────────────
    const svcMap = {}
    for (const inv of invoices) {
      if (inv.status !== 'paid') continue
      for (const li of (inv.line_items || [])) {
        const desc = li.description || 'Unknown'
        if (!svcMap[desc]) svcMap[desc] = { description: desc, revenue: 0, qty: 0 }
        svcMap[desc].revenue += li.amount || 0
        svcMap[desc].qty     += li.qty || 0
      }
    }
    const topServices = Object.values(svcMap)
      .map(s => ({ ...s, revenue: Math.round(s.revenue * 100) / 100 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)

    // ── Expenses by category ─────────────────────────────────────────────
    const expCatMap = {}
    for (const exp of periodExpenses) {
      const cat = exp.category || 'Other'
      if (!expCatMap[cat]) expCatMap[cat] = { category: cat, total: 0, count: 0 }
      expCatMap[cat].total += exp.amount || 0
      expCatMap[cat].count++
    }
    const byExpenseCategory = Object.values(expCatMap)
      .map(c => ({ ...c, total: Math.round(c.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total)

    // ── Aging report (outstanding invoices) ──────────────────────────────
    const today = now.toISOString().slice(0, 10)
    const aging = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, over_90: 0 }
    for (const inv of invoices) {
      if (inv.status !== 'sent' && inv.status !== 'overdue') continue
      const due = inv.due_date || inv.date || today
      const diffMs = new Date(today) - new Date(due)
      const days = Math.floor(diffMs / 86400000)
      const bal = inv.balance_due || 0
      if (days <= 0)       aging.current     += bal
      else if (days <= 30) aging.days_1_30   += bal
      else if (days <= 60) aging.days_31_60  += bal
      else if (days <= 90) aging.days_61_90  += bal
      else                 aging.over_90     += bal
    }
    Object.keys(aging).forEach(k => { aging[k] = Math.round(aging[k] * 100) / 100 })

    // ── Totals ───────────────────────────────────────────────────────────
    const totalRevenue  = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0)
    const totalPaid     = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.amount_paid || 0), 0)
    const totalOutstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.balance_due || 0), 0)
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0)
    const ytdRevenue    = invoices.filter(i => i.status === 'paid' && (i.paid_at || i.date || '').startsWith(String(thisYear))).reduce((s, i) => s + (i.total || 0), 0)
    const ytdExpenses   = expenses.filter(e => (e.date || '').startsWith(String(thisYear))).reduce((s, e) => s + (e.amount || 0), 0)
    const mtdRevenue    = invoices.filter(i => i.status === 'paid' && (i.paid_at || i.date || '').startsWith(`${thisYear}-${String(thisMonth).padStart(2,'0')}`)).reduce((s, i) => s + (i.total || 0), 0)
    const mtdExpenses   = expenses.filter(e => (e.date || '').startsWith(`${thisYear}-${String(thisMonth).padStart(2,'0')}`)).reduce((s, e) => s + (e.amount || 0), 0)

    res.json({
      period,
      year,
      month,
      months,
      by_customer:        byCustomer,
      by_type:            byType,
      top_services:       topServices,
      by_expense_category: byExpenseCategory,
      aging,
      totals: {
        all_time_revenue:    Math.round(totalRevenue  * 100) / 100,
        all_time_expenses:   Math.round(totalExpenses * 100) / 100,
        all_time_net:        Math.round((totalRevenue - totalExpenses) * 100) / 100,
        ytd_revenue:         Math.round(ytdRevenue    * 100) / 100,
        ytd_expenses:        Math.round(ytdExpenses   * 100) / 100,
        ytd_net:             Math.round((ytdRevenue - ytdExpenses) * 100) / 100,
        mtd_revenue:         Math.round(mtdRevenue    * 100) / 100,
        mtd_expenses:        Math.round(mtdExpenses   * 100) / 100,
        mtd_net:             Math.round((mtdRevenue - mtdExpenses) * 100) / 100,
        outstanding:         Math.round(totalOutstanding * 100) / 100,
        invoice_count:       invoices.length,
        paid_count:          invoices.filter(i => i.status === 'paid').length,
        overdue_count:       invoices.filter(i => i.status === 'overdue').length,
        expense_count:       expenses.length,
      },
    })
  } catch (err) {
    console.error('[books report]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
