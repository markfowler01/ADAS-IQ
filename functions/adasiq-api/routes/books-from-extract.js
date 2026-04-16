// POST /api/books/from-extract
// Mirror of the /api/create-invoice flow, but writes to ADAS IQ Books instead of Zoho.
// Reuses the exact same extracted payload shape so the extractor doesn't fork.
//
// Safeguards:
// - Always creates invoice as `draft` status (never auto-sends)
// - Tagged `created_via: 'kinetic_extract'` for auditability
// - Never calls Zoho — zero side effects on existing Zoho billing
// - Auto-applies billing_rules if a CRM shop match is found

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()
const CHUNK_SIZE = 30

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

async function readServices(req) {
  const segment = getSegment(req)
  return (await cacheGet(segment, 'books_services', [])) || []
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
      return shop
    })
  } catch { return [] }
}

async function getInvoiceNumber(req) {
  const segment = getSegment(req)
  const counter = (await cacheGet(segment, 'books_counter', 0)) || 0
  const next = Number(counter) + 1
  await cacheSet(segment, 'books_counter', next)
  return `INV-${String(next).padStart(4, '0')}`
}

// Match a calibration name to the services catalog (fuzzy)
function matchService(calName, services) {
  if (!calName) return null
  const target = String(calName).toLowerCase().trim()
  const exact = services.find(s => (s.name || '').toLowerCase().trim() === target)
  if (exact) return exact
  // Partial match — keyword overlap
  const targetWords = new Set(target.split(/\s+/).filter(w => w.length > 2))
  let best = null, bestScore = 0
  for (const s of services) {
    const sName = (s.name || '').toLowerCase().trim()
    const sWords = new Set(sName.split(/\s+/).filter(w => w.length > 2))
    const overlap = [...targetWords].filter(w => sWords.has(w)).length
    if (overlap > bestScore) { bestScore = overlap; best = s }
  }
  return bestScore >= 1 ? best : null
}

function matchShop(payload, shops) {
  // Try exact match on customerName, then shop name, then email
  const byCustomerName = payload.customerName
    ? shops.find(s => (s.shop_name || '').toLowerCase() === payload.customerName.toLowerCase())
    : null
  if (byCustomerName) return byCustomerName
  const byShop = payload.shop
    ? shops.find(s => (s.shop_name || '').toLowerCase() === String(payload.shop).toLowerCase())
    : null
  if (byShop) return byShop
  return null
}

// Apply billing_rules — either percentage, flat, or custom per-service pricing
function applyDiscount(rules, subtotal) {
  if (!rules) return { discount: 0, discount_pct: 0 }
  const type = rules.discount_type || 'percentage'
  const value = Number(rules.discount_value || 0)
  if (value <= 0) return { discount: 0, discount_pct: 0 }
  if (type === 'percentage') {
    return {
      discount: Math.round(subtotal * (value / 100) * 100) / 100,
      discount_pct: value,
    }
  }
  if (type === 'flat') {
    return { discount: value, discount_pct: 0 }
  }
  return { discount: 0, discount_pct: 0 }
}

function parseTerms(terms) {
  if (!terms) return 30
  const m = String(terms).match(/\d+/)
  return m ? Number(m[0]) : 30
}

router.post('/from-extract', async (req, res) => {
  try {
    const payload = req.body || {}
    if (!Array.isArray(payload.calibrations) || payload.calibrations.length === 0) {
      return res.status(400).json({ error: 'At least one calibration required' })
    }

    const [invoices, services, shops] = await Promise.all([
      readInvoices(req), readServices(req), readShops(req),
    ])

    const shop = matchShop(payload, shops)
    const rules = shop?.billing_rules || null

    // Build line items from calibrations — match to catalog where possible
    const lineItems = payload.calibrations.map((cal, idx) => {
      const calName = cal.calibration_name || cal.name || cal.description || cal.item_name || cal.trigger || `Calibration ${idx + 1}`
      const matched = matchService(calName, services)
      let rate = 0
      // Custom-priced in billing_rules?
      if (matched && rules?.custom_prices?.[matched.id] !== undefined) {
        rate = Number(rules.custom_prices[matched.id]) || 0
      } else if (matched) {
        rate = Number(matched.unit_price) || 0
      } else if (cal.price || cal.rate) {
        rate = Number(cal.price || cal.rate) || 0
      }
      const qty = Number(cal.qty || 1)
      const amount = qty * rate
      return {
        id: `li_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        description: calName,
        qty, rate, amount,
        retail_amount: amount,
        matched_service_id: matched?.id || null,
        cal_type: cal.cal_type || cal.mode || '',
      }
    })

    const subtotal = lineItems.reduce((s, li) => s + (Number(li.amount) || 0), 0)
    const { discount, discount_pct } = applyDiscount(rules, subtotal)
    const total = Math.max(0, subtotal - discount)

    const now = new Date()
    const termsDays = parseTerms(rules?.default_terms)
    const due = new Date(now.getTime() + termsDays * 24 * 60 * 60 * 1000)

    const invoiceNumber = await getInvoiceNumber(req)

    const invoice = {
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      invoice_number: invoiceNumber,
      customer_type: 'b2b',
      invoice_type: rules?.invoice_type === 'single' ? 'standard' : 'shop',
      customer_name: shop?.shop_name || payload.customerName || payload.shop || '',
      customer_email: rules?.billing_contact_email || shop?.email || '',
      customer_phone: shop?.phone || '',
      customer_address: shop?.address || '',
      customer_contact: rules?.billing_contact_name || shop?.contact_name || '',
      po_number: payload.ro_number || '',
      date: now.toISOString().slice(0, 10),
      due_date: due.toISOString().slice(0, 10),
      terms: rules?.default_terms || 'Net 30',
      line_items: lineItems,
      tax_rate: 0, tax_amount: 0,
      discount, discount_pct,
      subtotal: Math.round(subtotal * 100) / 100,
      total: Math.round(total * 100) / 100,
      amount_paid: 0,
      balance_due: Math.round(total * 100) / 100,
      status: 'draft',                // ← safeguard: never auto-sent
      sent_at: null,
      paid_at: null,
      job_id: '',                     // will be filled once a Kanban job is created
      crm_shop_id: shop?.id || '',
      notes: [
        payload.ro_number ? `RO# ${payload.ro_number}` : '',
        payload.insurer ? `Insurer: ${payload.insurer}` : '',
        payload.vin ? `VIN: ${payload.vin}` : '',
        payload.vehicle || [payload.year, payload.make, payload.model].filter(Boolean).join(' '),
      ].filter(Boolean).join(' · '),
      vehicle: {
        year: payload.year || '',
        make: payload.make || '',
        model: payload.model || '',
        vin: payload.vin || '',
      },
      created_via: 'kinetic_extract',  // ← audit tag
      created_at: now.toISOString(),
    }

    invoices.push(invoice)
    await writeInvoices(req, invoices)

    res.json({
      ok: true,
      invoice,
      matched_shop: shop ? { id: shop.id, shop_name: shop.shop_name } : null,
      applied_billing_rules: !!rules,
      unmatched_calibrations: lineItems
        .filter(li => !li.matched_service_id)
        .map(li => li.description),
    })
  } catch (e) {
    console.error('[books/from-extract]', e)
    res.status(500).json({ error: e.message })
  }
})

export default router
