import express from 'express'
import crypto from 'crypto'
import catalyst from 'zcatalyst-sdk-node'
import PDFDocument from 'pdfkit'
import Stripe from 'stripe'

const router = express.Router()

// ── Stripe initialization (lazy, only if configured) ─────────────────────────

let _stripe = null
function stripe() {
  if (_stripe) return _stripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  _stripe = new Stripe(key, { apiVersion: '2024-12-18.acacia' })
  return _stripe
}

function stripeConfigured() {
  return !!process.env.STRIPE_SECRET_KEY
}

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

async function readShops(req) {
  try {
    const app = catalyst.initialize(req)
    const tbl = app.datastore().table('CRMShops')
    const rows = await tbl.getAllRows()
    return rows.map(r => {
      const row = r.toJSON ? r.toJSON() : r
      const shop = { id: row.ROWID, ...row }
      try { if (typeof shop.people === 'string') shop.people = JSON.parse(shop.people) } catch {}
      try { if (typeof shop.billing_rules === 'string') shop.billing_rules = JSON.parse(shop.billing_rules) } catch {}
      return shop
    })
  } catch (e) {
    console.error('[portal] readShops failed:', e)
    return []
  }
}

// ── Token helpers (HMAC-signed, no DB needed) ────────────────────────────────

function tokenSecret() {
  return process.env.SESSION_SECRET || 'adasiq-portal-secret'
}

function signToken(payload, expiresInMs = 30 * 24 * 60 * 60 * 1000) {
  // 30 days by default for portal access
  const data = {
    ...payload,
    exp: Date.now() + expiresInMs,
    nonce: crypto.randomBytes(6).toString('hex'),
  }
  const body = Buffer.from(JSON.stringify(data)).toString('base64url')
  const sig = crypto.createHmac('sha256', tokenSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', tokenSecret()).update(body).digest('base64url')
  if (sig !== expected) return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (data.exp && data.exp < Date.now()) return null
    return data
  } catch {
    return null
  }
}

// Magic-link token (short-lived, 15 min) — contains shop_id + email
function makeMagicLink(req, shop) {
  const token = signToken(
    { type: 'magic', shop_id: shop.id, email: (shop.email || '').toLowerCase() },
    15 * 60 * 1000
  )
  // Prefer a configured portal base URL, else fall back to request origin
  const base = process.env.PORTAL_BASE_URL
    || `${req.protocol}://${req.get('host')}/app/portal`
  return `${base}?token=${encodeURIComponent(token)}`
}

// Portal session token (30 days)
function makeSessionToken(shop) {
  return signToken({ type: 'portal', shop_id: shop.id, email: (shop.email || '').toLowerCase() })
}

// Per-invoice pay token (never expires — gets embedded in the PDF sent to customer)
function makeInvoicePayToken(invoiceId) {
  return signToken({ type: 'invoice_pay', invoice_id: invoiceId },
    365 * 24 * 60 * 60 * 1000)  // 1 year
}

// Base URL for customer-facing pay links
function payBaseUrl(req) {
  return process.env.PORTAL_BASE_URL
    || `${req.protocol}://${req.get('host')}/app/pay`
}

export function buildInvoicePayUrl(req, invoiceId) {
  const token = makeInvoicePayToken(invoiceId)
  const base = payBaseUrl(req).replace(/\/portal$/, '/pay')
  return `${base}?i=${encodeURIComponent(invoiceId)}&t=${encodeURIComponent(token)}`
}

// Middleware: require portal auth via X-Portal-Token
async function requirePortalAuth(req, res, next) {
  const token = req.headers['x-portal-token'] || req.query.portal_token
  const data = verifyToken(token)
  if (!data || data.type !== 'portal') {
    return res.status(401).json({ error: 'Portal authentication required' })
  }
  try {
    const shops = await readShops(req)
    const shop = shops.find(s => s.id === data.shop_id)
    if (!shop) return res.status(404).json({ error: 'Shop not found' })
    req.portalShop = shop
    next()
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// ── Shop invoice lookup ──────────────────────────────────────────────────────

function invoicesForShop(allInvoices, shop) {
  const shopName = (shop.shop_name || '').toLowerCase().trim()
  return allInvoices.filter(inv => {
    if (inv.crm_shop_id && inv.crm_shop_id === shop.id) return true
    const customerName = (inv.customer_name || '').toLowerCase().trim()
    if (customerName && shopName && customerName === shopName) return true
    // Also match if the shop's billing_contact_email matches the invoice customer_email
    const billingEmail = (shop.billing_rules?.billing_contact_email || shop.email || '').toLowerCase()
    if (billingEmail && (inv.customer_email || '').toLowerCase() === billingEmail) return true
    return false
  })
}

// ── Public endpoints (no auth) ───────────────────────────────────────────────

// Request a magic link
router.post('/request-access', async (req, res) => {
  try {
    const email = (req.body?.email || '').toLowerCase().trim()
    if (!email) return res.status(400).json({ error: 'Email required' })

    const shops = await readShops(req)

    // Match shop email OR billing contact email OR any contact person email
    const shop = shops.find(s => {
      if ((s.email || '').toLowerCase() === email) return true
      const brEmail = s.billing_rules?.billing_contact_email
      if (brEmail && brEmail.toLowerCase() === email) return true
      if (Array.isArray(s.people)) {
        if (s.people.some(p => (p.email || '').toLowerCase() === email)) return true
      }
      return false
    })

    if (!shop) {
      // Don't leak which emails are valid — always succeed
      return res.json({ ok: true, message: 'If that email is on file, a login link has been sent.' })
    }

    const link = makeMagicLink(req, shop)

    // TODO: send email with the link. For now we log + return it in dev.
    // In production, wire into your email provider (Zoho Mail, SendGrid, etc.)
    console.log(`[portal] Magic link for ${shop.shop_name} (${email}): ${link}`)

    const response = { ok: true, message: 'Login link sent to your email.' }
    // In dev / demo mode, return the link directly so testing is easy
    if (process.env.NODE_ENV !== 'production' || process.env.PORTAL_RETURN_LINK === 'true') {
      response.dev_link = link
    }
    res.json(response)
  } catch (e) {
    console.error('[portal] request-access failed:', e)
    res.status(500).json({ error: e.message })
  }
})

// Verify magic link → return portal session token
router.post('/verify-token', async (req, res) => {
  try {
    const token = req.body?.token
    const data = verifyToken(token)
    if (!data || data.type !== 'magic') {
      return res.status(401).json({ error: 'Invalid or expired link' })
    }
    const shops = await readShops(req)
    const shop = shops.find(s => s.id === data.shop_id)
    if (!shop) return res.status(404).json({ error: 'Shop not found' })

    const sessionToken = makeSessionToken(shop)
    res.json({
      token: sessionToken,
      shop: {
        id: shop.id,
        shop_name: shop.shop_name,
        email: shop.email,
        phone: shop.phone,
        address: shop.address,
      },
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Authenticated portal endpoints ───────────────────────────────────────────

router.get('/me', requirePortalAuth, async (req, res) => {
  const shop = req.portalShop
  res.json({
    id: shop.id,
    shop_name: shop.shop_name,
    email: shop.email,
    phone: shop.phone,
    address: shop.address,
    billing_contact: shop.billing_rules?.billing_contact_name || shop.contact_name,
  })
})

router.get('/invoices', requirePortalAuth, async (req, res) => {
  try {
    const all = await readInvoices(req)
    const mine = invoicesForShop(all, req.portalShop)

    // Normalize for portal display — don't expose internal fields
    const trimmed = mine.map(inv => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_type: inv.invoice_type || 'standard',
      date: inv.date,
      due_date: inv.due_date,
      terms: inv.terms,
      po_number: inv.po_number,
      customer_name: inv.customer_name,
      line_items: inv.line_items || [],
      subtotal: inv.subtotal,
      tax_amount: inv.tax_amount,
      discount: inv.discount,
      discount_pct: inv.discount_pct,
      total: inv.total,
      amount_paid: inv.amount_paid,
      balance_due: inv.balance_due,
      status: inv.status,
      job_id: inv.job_id,
      notes: inv.notes,
      sent_at: inv.sent_at,
      paid_at: inv.paid_at,
    }))

    trimmed.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    res.json(trimmed)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/invoices/:id', requirePortalAuth, async (req, res) => {
  try {
    const all = await readInvoices(req)
    const mine = invoicesForShop(all, req.portalShop)
    const inv = mine.find(i => i.id === req.params.id)
    if (!inv) return res.status(404).json({ error: 'Not found' })
    res.json(inv)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PDF download
router.get('/invoices/:id/pdf', async (req, res) => {
  // Portal token can come from header OR query string (for direct link downloads)
  const token = req.headers['x-portal-token'] || req.query.portal_token
  const data = verifyToken(token)
  if (!data || data.type !== 'portal') {
    return res.status(401).json({ error: 'Portal authentication required' })
  }
  try {
    const shops = await readShops(req)
    const shop = shops.find(s => s.id === data.shop_id)
    if (!shop) return res.status(404).json({ error: 'Shop not found' })

    const all = await readInvoices(req)
    const mine = invoicesForShop(all, shop)
    const inv = mine.find(i => i.id === req.params.id)
    if (!inv) return res.status(404).json({ error: 'Not found' })

    // Load branding
    const segment = getSegment(req)
    const branding = await cacheGet(segment, 'adas_iq_branding', {})
    const companyName = branding.company_name || 'Absolute ADAS'
    const website = branding.website || 'absoluteadas.com'
    const primaryColor = branding.primary_color || '#CD4419'
    const footerText = branding.invoice_footer || 'Thank you for your business!'

    const doc = new PDFDocument({ size: 'LETTER', margin: 50 })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition',
      `attachment; filename="${inv.invoice_number || 'invoice'}.pdf"`)
    doc.pipe(res)

    // Header
    doc.rect(0, 0, 612, 100).fill(primaryColor)
    doc.fillColor('white').fontSize(24).text(companyName.toUpperCase(), 50, 35)
    doc.fontSize(10).text(website, 50, 65)
    const typeLabel = inv.invoice_type === 'insurance' ? 'INSURANCE INVOICE'
      : inv.invoice_type === 'shop' ? 'SHOP INVOICE' : 'INVOICE'
    doc.fontSize(14).text(typeLabel, 400, 40, { width: 160, align: 'right' })
    doc.fontSize(10).text(inv.invoice_number || '', 400, 65, { width: 160, align: 'right' })

    // Customer info
    doc.fillColor('black').fontSize(10)
    doc.text('BILL TO', 50, 130, { underline: true })
    doc.text(inv.customer_name || shop.shop_name, 50, 145)
    if (inv.customer_address) doc.text(inv.customer_address, 50, 160)
    if (inv.po_number) doc.text(`PO# ${inv.po_number}`, 50, 175)

    doc.text(`Date: ${inv.date || ''}`, 400, 130)
    doc.text(`Due: ${inv.due_date || ''}`, 400, 145)
    doc.text(`Terms: ${inv.terms || 'Net 30'}`, 400, 160)

    // Line items table
    let y = 220
    doc.fontSize(10).fillColor('gray')
    doc.text('DESCRIPTION', 50, y)
    doc.text('QTY', 350, y, { width: 40, align: 'right' })
    doc.text('RATE', 400, y, { width: 60, align: 'right' })
    doc.text('AMOUNT', 470, y, { width: 80, align: 'right' })
    y += 15
    doc.moveTo(50, y).lineTo(550, y).stroke('#e5e7eb')
    y += 10

    doc.fillColor('black')
    for (const li of (inv.line_items || [])) {
      doc.text(li.description || '', 50, y, { width: 290 })
      doc.text(String(li.qty || 0), 350, y, { width: 40, align: 'right' })
      doc.text(`$${Number(li.rate || 0).toFixed(2)}`, 400, y, { width: 60, align: 'right' })
      doc.text(`$${Number(li.amount || 0).toFixed(2)}`, 470, y, { width: 80, align: 'right' })
      y += 25
    }

    // Totals
    y += 10
    doc.moveTo(350, y).lineTo(550, y).stroke('#e5e7eb')
    y += 10
    doc.fillColor('gray').text('Subtotal', 400, y, { width: 60, align: 'right' })
    doc.fillColor('black').text(`$${Number(inv.subtotal || 0).toFixed(2)}`, 470, y, { width: 80, align: 'right' })
    y += 15
    if (Number(inv.discount) > 0 || Number(inv.discount_pct) > 0) {
      doc.fillColor('gray').text(`Discount${inv.discount_pct ? ` (${inv.discount_pct}%)` : ''}`, 330, y, { width: 130, align: 'right' })
      doc.fillColor('black').text(`-$${Number(inv.discount || 0).toFixed(2)}`, 470, y, { width: 80, align: 'right' })
      y += 15
    }
    if (Number(inv.tax_amount) > 0) {
      doc.fillColor('gray').text('Tax', 400, y, { width: 60, align: 'right' })
      doc.fillColor('black').text(`$${Number(inv.tax_amount || 0).toFixed(2)}`, 470, y, { width: 80, align: 'right' })
      y += 15
    }
    doc.fillColor(primaryColor).fontSize(12).text('TOTAL', 400, y, { width: 60, align: 'right' })
    doc.text(`$${Number(inv.total || 0).toFixed(2)}`, 470, y, { width: 80, align: 'right' })
    y += 20
    if (Number(inv.amount_paid) > 0) {
      doc.fillColor('gray').fontSize(10).text('Paid', 400, y, { width: 60, align: 'right' })
      doc.fillColor('#16a34a').text(`-$${Number(inv.amount_paid || 0).toFixed(2)}`, 470, y, { width: 80, align: 'right' })
      y += 15
      doc.fillColor('black').fontSize(11).text('Balance Due', 370, y, { width: 90, align: 'right' })
      doc.text(`$${Number(inv.balance_due || 0).toFixed(2)}`, 470, y, { width: 80, align: 'right' })
    }

    // Pay Online link (only if there's a balance due)
    if (Number(inv.balance_due || inv.total) > 0 && inv.status !== 'paid') {
      const payUrl = buildInvoicePayUrl(req, inv.id)
      y += 30
      doc.rect(350, y, 200, 34).fill(primaryColor)
      doc.fillColor('white').fontSize(11).text('💳 PAY ONLINE', 350, y + 6,
        { width: 200, align: 'center' })
      doc.fontSize(8).text('Click to pay this invoice', 350, y + 20,
        { width: 200, align: 'center', link: payUrl, underline: true })
      doc.fillColor('gray').fontSize(7).text(payUrl, 50, y + 40,
        { width: 500, align: 'center', link: payUrl })
    }

    // Footer
    doc.fontSize(9).fillColor('gray').text(
      `${footerText} · ${companyName} · ${website}`,
      50, 730, { width: 500, align: 'center' }
    )

    doc.end()
  } catch (e) {
    console.error('[portal] PDF failed:', e)
    res.status(500).json({ error: e.message })
  }
})

// Record a payment (customer self-serves)
router.post('/invoices/:id/pay', requirePortalAuth, async (req, res) => {
  try {
    const all = await readInvoices(req)
    const mine = invoicesForShop(all, req.portalShop)
    const inv = mine.find(i => i.id === req.params.id)
    if (!inv) return res.status(404).json({ error: 'Not found' })

    const amount = Number(req.body?.amount || inv.balance_due || 0)
    if (amount <= 0) return res.status(400).json({ error: 'Invalid amount' })

    const method = req.body?.method || 'Other'
    const reference = req.body?.reference || ''
    const note = req.body?.note || ''

    // Update invoice
    const fullIdx = all.findIndex(i => i.id === inv.id)
    if (fullIdx < 0) return res.status(404).json({ error: 'Not found' })
    const target = all[fullIdx]

    target.amount_paid = Number(target.amount_paid || 0) + amount
    target.balance_due = Math.max(0, Number(target.total || 0) - target.amount_paid)
    target.payments = Array.isArray(target.payments) ? target.payments : []
    target.payments.push({
      id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      amount,
      method,
      reference,
      note,
      recorded_by: `portal:${req.portalShop.shop_name}`,
      recorded_at: new Date().toISOString(),
    })

    if (target.balance_due === 0) {
      target.status = 'paid'
      target.paid_at = new Date().toISOString()
    }

    await writeInvoices(req, all)

    // Also write a deposit record so books stay in sync
    try {
      const segment = getSegment(req)
      const deposits = await cacheGet(segment, 'books_deposits', []) || []
      deposits.unshift({
        id: `dep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        date: new Date().toISOString().slice(0, 10),
        amount,
        from: req.portalShop.shop_name,
        memo: reference || note,
        method,
        invoice_id: target.id,
        invoice_number: target.invoice_number,
        created_via: 'portal',
        created_at: new Date().toISOString(),
      })
      await cacheSet(segment, 'books_deposits', deposits)
    } catch (e) { console.warn('[portal] deposit write failed:', e.message) }

    res.json({ ok: true, invoice: target })
  } catch (e) {
    console.error('[portal] payment failed:', e)
    res.status(500).json({ error: e.message })
  }
})

// ── Per-invoice public pay link (no login required) ─────────────────────────

// Lookup an invoice by its pay token (for the pay page to display details)
router.get('/pay/:invoiceId/info', async (req, res) => {
  try {
    const token = req.query.t
    const data = verifyToken(token)
    if (!data || data.type !== 'invoice_pay' || data.invoice_id !== req.params.invoiceId) {
      return res.status(401).json({ error: 'Invalid or expired payment link' })
    }
    const all = await readInvoices(req)
    const inv = all.find(i => i.id === req.params.invoiceId)
    if (!inv) return res.status(404).json({ error: 'Invoice not found' })

    // Return a trimmed view for the public pay page
    res.json({
      id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_type: inv.invoice_type,
      date: inv.date,
      due_date: inv.due_date,
      customer_name: inv.customer_name,
      line_items: (inv.line_items || []).map(li => ({
        description: li.description, qty: li.qty, rate: li.rate, amount: li.amount,
      })),
      subtotal: inv.subtotal,
      tax_amount: inv.tax_amount,
      discount: inv.discount,
      total: inv.total,
      amount_paid: inv.amount_paid,
      balance_due: inv.balance_due,
      status: inv.status,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Submit a payment using the per-invoice token
router.post('/pay/:invoiceId', async (req, res) => {
  try {
    const token = req.body?.token || req.query.t
    const data = verifyToken(token)
    if (!data || data.type !== 'invoice_pay' || data.invoice_id !== req.params.invoiceId) {
      return res.status(401).json({ error: 'Invalid or expired payment link' })
    }

    const all = await readInvoices(req)
    const idx = all.findIndex(i => i.id === req.params.invoiceId)
    if (idx < 0) return res.status(404).json({ error: 'Invoice not found' })
    const inv = all[idx]

    const amount = Number(req.body?.amount || inv.balance_due || 0)
    if (amount <= 0) return res.status(400).json({ error: 'Invalid amount' })

    const method = req.body?.method || 'Other'
    const reference = req.body?.reference || ''
    const note = req.body?.note || ''
    const payerName = req.body?.payer_name || inv.customer_name || ''
    const payerEmail = req.body?.payer_email || ''

    inv.amount_paid = Number(inv.amount_paid || 0) + amount
    inv.balance_due = Math.max(0, Number(inv.total || 0) - inv.amount_paid)
    inv.payments = Array.isArray(inv.payments) ? inv.payments : []
    inv.payments.push({
      id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      amount, method, reference, note,
      payer_name: payerName, payer_email: payerEmail,
      recorded_by: 'public_pay_link',
      recorded_at: new Date().toISOString(),
    })

    if (inv.balance_due === 0) {
      inv.status = 'paid'
      inv.paid_at = new Date().toISOString()
    }

    await writeInvoices(req, all)

    // Write a deposit record so books auto-reconcile
    try {
      const segment = getSegment(req)
      const deposits = await cacheGet(segment, 'books_deposits', []) || []
      deposits.unshift({
        id: `dep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        date: new Date().toISOString().slice(0, 10),
        amount,
        from: payerName || inv.customer_name,
        memo: reference || note,
        method,
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        created_via: 'pay_link',
        created_at: new Date().toISOString(),
      })
      await cacheSet(segment, 'books_deposits', deposits)
    } catch (e) { console.warn('[portal] deposit write failed:', e.message) }

    res.json({
      ok: true,
      paid_amount: amount,
      new_balance: inv.balance_due,
      invoice_number: inv.invoice_number,
      status: inv.status,
    })
  } catch (e) {
    console.error('[portal] pay-link payment failed:', e)
    res.status(500).json({ error: e.message })
  }
})

// Admin endpoint: get the pay link for an invoice (used by Books UI)
router.get('/admin/pay-link/:invoiceId', async (req, res) => {
  // Requires the main app auth — use X-Auth-Token header
  const headerToken = req.headers['x-auth-token']
  if (!headerToken) return res.status(401).json({ error: 'Not authenticated' })
  // We don't have access to verifyToken from auth.js here without a circular import,
  // so this endpoint trusts the presence of a valid X-Auth-Token via the mount point.
  // In practice, mount this behind requireAuth in index.js.
  try {
    const url = buildInvoicePayUrl(req, req.params.invoiceId)
    res.json({ url })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Stripe Checkout ──────────────────────────────────────────────────────────

// Builds the base URL for success/cancel redirects
function webBase(req) {
  return process.env.WEB_BASE_URL
    || `${req.protocol}://${req.get('host')}/app`
}

// Create a Stripe Checkout Session for a specific invoice
// Supports two flows: 'card' or 'us_bank_account' (ACH)
async function createCheckoutSession(req, inv, { paymentMethod = 'card', payerEmail, returnPath }) {
  if (!stripeConfigured()) {
    const err = new Error('Online card/ACH payments are not yet configured. Please use ACH/Check/Zelle via the payment form, or contact us.')
    err.status = 501
    throw err
  }

  const amount = Math.round(Number(inv.balance_due ?? inv.total) * 100)
  if (amount <= 0) {
    const err = new Error('Nothing to pay — invoice is already paid in full.')
    err.status = 400
    throw err
  }

  // ACH via us_bank_account. We use the standard checkout flow; Stripe renders Plaid.
  const methodTypes = paymentMethod === 'ach'
    ? ['us_bank_account']
    : ['card']

  const base = webBase(req)
  const returnBase = returnPath ? `${base}${returnPath}` : `${base}/pay`

  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    payment_method_types: methodTypes,
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `Invoice ${inv.invoice_number}`,
          description: inv.customer_name ? `Billed to ${inv.customer_name}` : undefined,
        },
        unit_amount: amount,
      },
      quantity: 1,
    }],
    customer_email: payerEmail || inv.customer_email || undefined,
    success_url: `${returnBase}?stripe_status=success&i=${encodeURIComponent(inv.id)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${returnBase}?stripe_status=cancelled&i=${encodeURIComponent(inv.id)}`,
    metadata: {
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      payment_method: paymentMethod,
      customer_name: inv.customer_name || '',
    },
    // ACH typically delays finalization — we only mark the invoice paid
    // in the webhook when payment_intent.status === 'succeeded'.
    payment_intent_data: {
      metadata: {
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
      },
    },
  })

  return session
}

// Portal-authed: logged-in customer pays their own invoice
router.post('/invoices/:id/stripe-checkout', requirePortalAuth, async (req, res) => {
  try {
    const all = await readInvoices(req)
    const mine = invoicesForShop(all, req.portalShop)
    const inv = mine.find(i => i.id === req.params.id)
    if (!inv) return res.status(404).json({ error: 'Not found' })

    const session = await createCheckoutSession(req, inv, {
      paymentMethod: req.body?.method === 'ach' ? 'ach' : 'card',
      payerEmail: req.body?.payer_email,
      returnPath: '/portal',
    })
    res.json({ url: session.url, session_id: session.id })
  } catch (e) {
    console.error('[portal] stripe-checkout (authed) failed:', e.message)
    res.status(e.status || 500).json({ error: e.message })
  }
})

// Public pay-link variant: anyone with the signed invoice token can start checkout
router.post('/pay/:invoiceId/stripe-checkout', async (req, res) => {
  try {
    const token = req.body?.token || req.query.t
    const data = verifyToken(token)
    if (!data || data.type !== 'invoice_pay' || data.invoice_id !== req.params.invoiceId) {
      return res.status(401).json({ error: 'Invalid or expired payment link' })
    }
    const all = await readInvoices(req)
    const inv = all.find(i => i.id === req.params.invoiceId)
    if (!inv) return res.status(404).json({ error: 'Invoice not found' })

    const session = await createCheckoutSession(req, inv, {
      paymentMethod: req.body?.method === 'ach' ? 'ach' : 'card',
      payerEmail: req.body?.payer_email,
      returnPath: `/pay?i=${encodeURIComponent(inv.id)}&t=${encodeURIComponent(token)}`,
    })
    res.json({ url: session.url, session_id: session.id })
  } catch (e) {
    console.error('[portal] stripe-checkout (public) failed:', e.message)
    res.status(e.status || 500).json({ error: e.message })
  }
})

// ── Stripe webhook ───────────────────────────────────────────────────────────
// Mounted in index.js BEFORE express.json() with raw body parser so we can verify signatures.
// This handler is exported and mounted separately in index.js.

export async function handleStripeWebhook(req, res) {
  try {
    if (!stripeConfigured()) return res.status(501).json({ error: 'Stripe not configured' })

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    let event
    if (webhookSecret) {
      const sig = req.headers['stripe-signature']
      try {
        event = stripe().webhooks.constructEvent(req.body, sig, webhookSecret)
      } catch (err) {
        console.error('[portal] webhook signature verification failed:', err.message)
        return res.status(400).send(`Webhook signature error: ${err.message}`)
      }
    } else {
      // Dev mode: accept unsigned webhooks (never do this in prod)
      console.warn('[portal] ⚠️  STRIPE_WEBHOOK_SECRET not set — accepting unsigned webhook')
      event = typeof req.body === 'string' ? JSON.parse(req.body)
        : Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString())
        : req.body
    }

    // Handle relevant events
    if (event.type === 'checkout.session.completed'
        || event.type === 'checkout.session.async_payment_succeeded'
        || event.type === 'payment_intent.succeeded') {

      // Extract invoice reference + amount
      let invoiceId, amount, paymentMethod, reference, payerEmail
      if (event.type.startsWith('checkout.session')) {
        const s = event.data.object
        invoiceId = s.metadata?.invoice_id
        amount = Number(s.amount_total) / 100
        paymentMethod = s.metadata?.payment_method === 'ach' ? 'ACH / Bank Transfer (Stripe)' : 'Credit Card (Stripe)'
        reference = s.payment_intent || s.id
        payerEmail = s.customer_details?.email || s.customer_email
      } else {
        const pi = event.data.object
        invoiceId = pi.metadata?.invoice_id
        amount = Number(pi.amount_received) / 100
        const types = pi.payment_method_types || []
        paymentMethod = types.includes('us_bank_account') ? 'ACH / Bank Transfer (Stripe)' : 'Credit Card (Stripe)'
        reference = pi.id
        payerEmail = pi.receipt_email
      }

      if (!invoiceId || amount <= 0) {
        console.warn('[portal] webhook missing invoice_id or amount:', event.type)
        return res.json({ received: true })
      }

      // Load and update the invoice
      const all = await readInvoices(req)
      const idx = all.findIndex(i => i.id === invoiceId)
      if (idx < 0) {
        console.warn('[portal] webhook: invoice not found:', invoiceId)
        return res.json({ received: true })
      }
      const target = all[idx]

      // Idempotency: skip if we've already recorded this reference
      const alreadyRecorded = (target.payments || []).some(p => p.reference === reference)
      if (alreadyRecorded) {
        console.log('[portal] webhook: already recorded, skipping:', reference)
        return res.json({ received: true })
      }

      target.amount_paid = Number(target.amount_paid || 0) + amount
      target.balance_due = Math.max(0, Number(target.total || 0) - target.amount_paid)
      target.payments = Array.isArray(target.payments) ? target.payments : []
      target.payments.push({
        id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        amount,
        method: paymentMethod,
        reference,
        note: 'Automatically recorded via Stripe',
        payer_email: payerEmail || '',
        recorded_by: 'stripe_webhook',
        recorded_at: new Date().toISOString(),
      })

      if (target.balance_due === 0) {
        target.status = 'paid'
        target.paid_at = new Date().toISOString()
      }

      await writeInvoices(req, all)

      // Auto-record deposit
      try {
        const segment = getSegment(req)
        const deposits = await cacheGet(segment, 'books_deposits', []) || []
        deposits.unshift({
          id: `dep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          date: new Date().toISOString().slice(0, 10),
          amount,
          from: target.customer_name,
          memo: `Stripe ${paymentMethod.includes('ACH') ? 'ACH' : 'card'} — ${reference}`,
          method: paymentMethod,
          invoice_id: target.id,
          invoice_number: target.invoice_number,
          created_via: 'stripe_webhook',
          created_at: new Date().toISOString(),
        })
        await cacheSet(segment, 'books_deposits', deposits)
      } catch (e) {
        console.warn('[portal] deposit write failed in webhook:', e.message)
      }

      console.log(`[portal] ✓ Webhook recorded $${amount} on ${target.invoice_number}`)
    }

    res.json({ received: true })
  } catch (e) {
    console.error('[portal] webhook handler error:', e)
    res.status(500).json({ error: e.message })
  }
}

// Public endpoint to check Stripe availability (so the UI can show/hide buttons)
router.get('/stripe/status', (req, res) => {
  res.json({ configured: stripeConfigured() })
})

export default router
