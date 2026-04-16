import express from 'express'
import crypto from 'crypto'
import catalyst from 'zcatalyst-sdk-node'
import PDFDocument from 'pdfkit'

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

async function readQuotes(req) {
  const segment = getSegment(req)
  return (await cacheGet(segment, 'quotes', [])) || []
}

async function writeQuotes(req, quotes) {
  const segment = getSegment(req)
  await cacheSet(segment, 'quotes', quotes)
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
    chunks: chunks.length,
    total: invoices.length,
    updated: new Date().toISOString(),
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(req) {
  return req.user?.email || req.user?.id || req.user?.name || 'unknown'
}

function isAdmin(req) {
  return req.user?.role !== 'technician'
}

function newId(prefix = 'q') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// Signed token so shops can approve quotes without portal login
function tokenSecret() {
  return process.env.SESSION_SECRET || 'adasiq-portal-secret'
}

function makeApprovalToken(quoteId) {
  const data = { type: 'quote_approval', quote_id: quoteId,
    exp: Date.now() + 90 * 24 * 60 * 60 * 1000 }  // 90 days
  const body = Buffer.from(JSON.stringify(data)).toString('base64url')
  const sig = crypto.createHmac('sha256', tokenSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verifyApprovalToken(token) {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', tokenSecret()).update(body).digest('base64url')
  if (sig !== expected) return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (data.exp < Date.now()) return null
    return data
  } catch { return null }
}

function approvalUrl(req, quoteId) {
  const token = makeApprovalToken(quoteId)
  const base = process.env.WEB_BASE_URL
    || `${req.protocol}://${req.get('host')}/app`
  return `${base}/quote?q=${encodeURIComponent(quoteId)}&t=${encodeURIComponent(token)}`
}

function computeQuoteTotals(quote) {
  const subtotal = (quote.line_items || []).reduce((s, li) =>
    s + (Number(li.qty) || 0) * (Number(li.rate) || 0), 0)
  const discount = Number(quote.discount) || 0
  const taxRate = Number(quote.tax_rate) || 0
  const taxAmount = Math.max(0, (subtotal - discount) * (taxRate / 100))
  const total = Math.max(0, subtotal - discount + taxAmount)
  quote.subtotal = Math.round(subtotal * 100) / 100
  quote.tax_amount = Math.round(taxAmount * 100) / 100
  quote.total = Math.round(total * 100) / 100
  return quote
}

// ── Endpoints (admin) ────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const quotes = await readQuotes(req)
    quotes.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    res.json(quotes)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const quotes = await readQuotes(req)
    const q = quotes.find(x => x.id === req.params.id)
    if (!q) return res.status(404).json({ error: 'Not found' })
    res.json(q)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/', async (req, res) => {
  try {
    const quotes = await readQuotes(req)
    const q = {
      id: newId(),
      quote_number: req.body.quote_number || `Q-${Date.now().toString().slice(-6)}`,
      customer_type: req.body.customer_type || 'b2b',
      customer_name: req.body.customer_name || '',
      customer_email: req.body.customer_email || '',
      customer_phone: req.body.customer_phone || '',
      customer_address: req.body.customer_address || '',
      customer_contact: req.body.customer_contact || '',
      crm_shop_id: req.body.crm_shop_id || '',
      po_number: req.body.po_number || '',
      vehicle: req.body.vehicle || { year: '', make: '', model: '', vin: '' },
      ro_number: req.body.ro_number || '',
      date: req.body.date || new Date().toISOString().slice(0, 10),
      valid_until: req.body.valid_until
        || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      line_items: Array.isArray(req.body.line_items) ? req.body.line_items : [],
      tax_rate: Number(req.body.tax_rate) || 0,
      discount: Number(req.body.discount) || 0,
      notes: req.body.notes || '',
      terms: req.body.terms || 'Net 30',
      status: 'draft',  // draft, sent, approved, declined, expired, converted
      sent_at: null,
      approved_at: null,
      declined_at: null,
      decline_reason: '',
      approved_by_name: '',
      approved_by_email: '',
      converted_to_invoice_id: '',
      converted_at: null,
      author_id: getUserId(req),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    computeQuoteTotals(q)
    quotes.push(q)
    await writeQuotes(req, quotes)
    res.json(q)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const quotes = await readQuotes(req)
    const idx = quotes.findIndex(x => x.id === req.params.id)
    if (idx < 0) return res.status(404).json({ error: 'Not found' })
    if (quotes[idx].status === 'converted') {
      return res.status(400).json({ error: 'Cannot edit converted quotes' })
    }
    const allowed = ['quote_number', 'customer_name', 'customer_email', 'customer_phone',
      'customer_address', 'customer_contact', 'crm_shop_id', 'po_number', 'vehicle',
      'ro_number', 'date', 'valid_until', 'line_items', 'tax_rate', 'discount',
      'notes', 'terms']
    for (const f of allowed) {
      if (req.body[f] !== undefined) quotes[idx][f] = req.body[f]
    }
    computeQuoteTotals(quotes[idx])
    quotes[idx].updated_at = new Date().toISOString()
    await writeQuotes(req, quotes)
    res.json(quotes[idx])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const quotes = await readQuotes(req)
    const q = quotes.find(x => x.id === req.params.id)
    if (!q) return res.status(404).json({ error: 'Not found' })
    if (q.status === 'converted') {
      return res.status(400).json({ error: 'Cannot delete a quote that became an invoice' })
    }
    await writeQuotes(req, quotes.filter(x => x.id !== req.params.id))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Mark quote as sent + return an approval URL the admin can copy/email
router.post('/:id/send', async (req, res) => {
  try {
    const quotes = await readQuotes(req)
    const q = quotes.find(x => x.id === req.params.id)
    if (!q) return res.status(404).json({ error: 'Not found' })

    q.status = 'sent'
    q.sent_at = new Date().toISOString()
    await writeQuotes(req, quotes)

    const url = approvalUrl(req, q.id)
    res.json({ ok: true, quote: q, approval_url: url })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Admin gets the approval URL anytime
router.get('/:id/approval-url', async (req, res) => {
  try {
    const quotes = await readQuotes(req)
    const q = quotes.find(x => x.id === req.params.id)
    if (!q) return res.status(404).json({ error: 'Not found' })
    res.json({ url: approvalUrl(req, q.id) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Convert approved quote → invoice (admin)
router.post('/:id/convert-to-invoice', async (req, res) => {
  try {
    const quotes = await readQuotes(req)
    const q = quotes.find(x => x.id === req.params.id)
    if (!q) return res.status(404).json({ error: 'Not found' })
    if (q.status === 'converted' && q.converted_to_invoice_id) {
      return res.status(400).json({
        error: 'Already converted',
        invoice_id: q.converted_to_invoice_id,
      })
    }

    const invoices = await readInvoices(req)

    // Build the invoice
    const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const inv = {
      id: invoiceId,
      invoice_number: req.body.invoice_number
        || q.quote_number.replace(/^Q-/, 'INV-'),
      customer_type: q.customer_type,
      invoice_type: req.body.invoice_type || 'standard',
      customer_name: q.customer_name,
      customer_email: q.customer_email,
      customer_phone: q.customer_phone,
      customer_address: q.customer_address,
      customer_contact: q.customer_contact,
      po_number: q.po_number,
      date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      terms: q.terms || 'Net 30',
      line_items: (q.line_items || []).map(li => ({
        id: `li_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        description: li.description,
        qty: li.qty,
        rate: li.rate,
        amount: (Number(li.qty) || 0) * (Number(li.rate) || 0),
        retail_amount: (Number(li.qty) || 0) * (Number(li.rate) || 0),
      })),
      tax_rate: q.tax_rate,
      tax_amount: q.tax_amount,
      discount: q.discount,
      discount_pct: 0,
      subtotal: q.subtotal,
      total: q.total,
      amount_paid: 0,
      balance_due: q.total,
      status: 'draft',
      job_id: '',
      crm_shop_id: q.crm_shop_id,
      notes: q.notes,
      from_quote_id: q.id,
      created_at: new Date().toISOString(),
    }
    invoices.push(inv)
    await writeInvoices(req, invoices)

    q.status = 'converted'
    q.converted_to_invoice_id = invoiceId
    q.converted_at = new Date().toISOString()
    await writeQuotes(req, quotes)

    res.json({ ok: true, invoice: inv, quote: q })
  } catch (e) {
    console.error('[quotes] convert failed:', e)
    res.status(500).json({ error: e.message })
  }
})

// ── Public endpoints (shop approval flow, no auth) ──────────────────────────

// Shop views the quote using the token
router.get('/public/:id', async (req, res) => {
  try {
    const token = req.query.t
    const data = verifyApprovalToken(token)
    if (!data || data.quote_id !== req.params.id) {
      return res.status(401).json({ error: 'Invalid or expired link' })
    }
    const quotes = await readQuotes(req)
    const q = quotes.find(x => x.id === req.params.id)
    if (!q) return res.status(404).json({ error: 'Not found' })

    // Return trimmed view
    res.json({
      id: q.id,
      quote_number: q.quote_number,
      customer_name: q.customer_name,
      date: q.date,
      valid_until: q.valid_until,
      vehicle: q.vehicle,
      ro_number: q.ro_number,
      line_items: q.line_items,
      subtotal: q.subtotal,
      tax_amount: q.tax_amount,
      discount: q.discount,
      total: q.total,
      terms: q.terms,
      notes: q.notes,
      status: q.status,
      approved_at: q.approved_at,
      declined_at: q.declined_at,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/public/:id/approve', async (req, res) => {
  try {
    const token = req.body?.token || req.query.t
    const data = verifyApprovalToken(token)
    if (!data || data.quote_id !== req.params.id) {
      return res.status(401).json({ error: 'Invalid or expired link' })
    }
    const quotes = await readQuotes(req)
    const q = quotes.find(x => x.id === req.params.id)
    if (!q) return res.status(404).json({ error: 'Not found' })
    if (['approved', 'declined', 'converted', 'expired'].includes(q.status)) {
      return res.status(400).json({ error: `Already ${q.status}` })
    }
    q.status = 'approved'
    q.approved_at = new Date().toISOString()
    q.approved_by_name = req.body?.name || ''
    q.approved_by_email = req.body?.email || ''
    await writeQuotes(req, quotes)
    res.json({ ok: true, quote_number: q.quote_number, total: q.total })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/public/:id/decline', async (req, res) => {
  try {
    const token = req.body?.token || req.query.t
    const data = verifyApprovalToken(token)
    if (!data || data.quote_id !== req.params.id) {
      return res.status(401).json({ error: 'Invalid or expired link' })
    }
    const quotes = await readQuotes(req)
    const q = quotes.find(x => x.id === req.params.id)
    if (!q) return res.status(404).json({ error: 'Not found' })
    q.status = 'declined'
    q.declined_at = new Date().toISOString()
    q.decline_reason = req.body?.reason || ''
    await writeQuotes(req, quotes)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Public PDF (with approval token) — for "Download Quote PDF"
router.get('/public/:id/pdf', async (req, res) => {
  const token = req.query.t
  const data = verifyApprovalToken(token)
  if (!data || data.quote_id !== req.params.id) {
    return res.status(401).send('Invalid link')
  }
  try {
    const quotes = await readQuotes(req)
    const q = quotes.find(x => x.id === req.params.id)
    if (!q) return res.status(404).send('Not found')

    const segment = getSegment(req)
    const branding = await cacheGet(segment, 'adas_iq_branding', {})
    const companyName = branding.company_name || 'Absolute ADAS'
    const website = branding.website || 'absoluteadas.com'
    const primaryColor = branding.primary_color || '#CD4419'

    const doc = new PDFDocument({ size: 'LETTER', margin: 50 })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${q.quote_number}.pdf"`)
    doc.pipe(res)

    // Header
    doc.rect(0, 0, 612, 100).fill(primaryColor)
    doc.fillColor('white').fontSize(24).text(companyName.toUpperCase(), 50, 35)
    doc.fontSize(10).text(website, 50, 65)
    doc.fontSize(14).text('QUOTE', 400, 40, { width: 160, align: 'right' })
    doc.fontSize(10).text(q.quote_number, 400, 65, { width: 160, align: 'right' })

    // Info
    doc.fillColor('black').fontSize(10)
    doc.text('FOR', 50, 130, { underline: true })
    doc.text(q.customer_name, 50, 145)
    if (q.customer_contact) doc.text(q.customer_contact, 50, 160)
    if (q.ro_number) doc.text(`RO# ${q.ro_number}`, 50, 175)
    if (q.vehicle?.year || q.vehicle?.make) {
      doc.text([q.vehicle.year, q.vehicle.make, q.vehicle.model].filter(Boolean).join(' '), 50, 190)
      if (q.vehicle.vin) doc.text(`VIN: ${q.vehicle.vin}`, 50, 205)
    }
    doc.text(`Date: ${q.date}`, 400, 130)
    doc.text(`Valid until: ${q.valid_until}`, 400, 145)

    // Line items
    let y = 240
    doc.fontSize(10).fillColor('gray')
    doc.text('DESCRIPTION', 50, y)
    doc.text('QTY', 350, y, { width: 40, align: 'right' })
    doc.text('RATE', 400, y, { width: 60, align: 'right' })
    doc.text('AMOUNT', 470, y, { width: 80, align: 'right' })
    y += 15
    doc.moveTo(50, y).lineTo(550, y).stroke('#e5e7eb')
    y += 10
    doc.fillColor('black')
    for (const li of (q.line_items || [])) {
      const amt = (Number(li.qty) || 0) * (Number(li.rate) || 0)
      doc.text(li.description || '', 50, y, { width: 290 })
      doc.text(String(li.qty || 0), 350, y, { width: 40, align: 'right' })
      doc.text(`$${Number(li.rate || 0).toFixed(2)}`, 400, y, { width: 60, align: 'right' })
      doc.text(`$${amt.toFixed(2)}`, 470, y, { width: 80, align: 'right' })
      y += 25
    }

    // Totals
    y += 10
    doc.moveTo(350, y).lineTo(550, y).stroke('#e5e7eb')
    y += 10
    doc.fillColor('gray').text('Subtotal', 400, y, { width: 60, align: 'right' })
    doc.fillColor('black').text(`$${Number(q.subtotal).toFixed(2)}`, 470, y, { width: 80, align: 'right' })
    y += 15
    if (Number(q.discount) > 0) {
      doc.fillColor('gray').text('Discount', 400, y, { width: 60, align: 'right' })
      doc.fillColor('black').text(`-$${Number(q.discount).toFixed(2)}`, 470, y, { width: 80, align: 'right' })
      y += 15
    }
    doc.fillColor(primaryColor).fontSize(12).text('TOTAL', 400, y, { width: 60, align: 'right' })
    doc.text(`$${Number(q.total).toFixed(2)}`, 470, y, { width: 80, align: 'right' })

    // Approval
    y += 50
    const approvalHere = approvalUrl(req, q.id)
    doc.rect(100, y, 400, 40).fill(primaryColor)
    doc.fillColor('white').fontSize(12).text('REVIEW & APPROVE ONLINE', 100, y + 13,
      { width: 400, align: 'center', link: approvalHere })
    y += 60
    doc.fillColor('gray').fontSize(8)
      .text(approvalHere, 50, y, { width: 500, align: 'center', link: approvalHere })

    // Terms
    if (q.notes) {
      y += 30
      doc.fontSize(9).fillColor('gray').text('NOTES', 50, y)
      y += 12
      doc.fillColor('black').text(q.notes, 50, y, { width: 500 })
    }

    doc.end()
  } catch (e) {
    console.error('[quotes] PDF failed:', e)
    if (!res.headersSent) res.status(500).send(e.message)
  }
})

export default router
