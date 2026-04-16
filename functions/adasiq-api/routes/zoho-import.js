import express from 'express'
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { getAccessToken, listCustomers } from '../services/zoho.js'

const router = express.Router()

const ZOHO_API_BASE = 'https://www.zohoapis.com/books/v3'

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

function isAdmin(req) { return req.user?.role !== 'technician' }

function zohoHeaders(token) {
  return { Authorization: `Zoho-oauthtoken ${token}` }
}

function orgParam() {
  return { organization_id: process.env.ZOHO_ORGANIZATION_ID }
}

// ── Paginated fetchers ───────────────────────────────────────────────────────

async function fetchAllInvoices(token) {
  let all = []
  let page = 1
  let hasMore = true
  while (hasMore) {
    const res = await axios.get(`${ZOHO_API_BASE}/invoices`, {
      headers: zohoHeaders(token),
      params: { ...orgParam(), per_page: 200, page, sort_column: 'date', sort_order: 'D' },
      timeout: 20000,
    })
    const invoices = res.data?.invoices || []
    all = all.concat(invoices)
    hasMore = res.data?.page_context?.has_more_page === true
    page++
  }
  return all
}

async function fetchInvoiceDetail(token, invoiceId) {
  const res = await axios.get(`${ZOHO_API_BASE}/invoices/${invoiceId}`, {
    headers: zohoHeaders(token),
    params: { ...orgParam() },
    timeout: 15000,
  })
  return res.data?.invoice
}

async function fetchAllItems(token) {
  let all = []
  let page = 1
  let hasMore = true
  while (hasMore) {
    const res = await axios.get(`${ZOHO_API_BASE}/items`, {
      headers: zohoHeaders(token),
      params: { ...orgParam(), per_page: 200, page },
      timeout: 15000,
    })
    const items = res.data?.items || []
    all = all.concat(items)
    hasMore = res.data?.page_context?.has_more_page === true
    page++
  }
  return all
}

// ── Mappers: Zoho → ADAS IQ native format ───────────────────────────────────

function mapZohoInvoiceToNative(zInv) {
  // Zoho status codes: draft, sent, overdue, paid, partially_paid, void, unpaid
  let status = 'draft'
  if (zInv.status === 'paid') status = 'paid'
  else if (zInv.status === 'overdue') status = 'overdue'
  else if (zInv.status === 'void') status = 'void'
  else if (zInv.status === 'draft') status = 'draft'
  else status = 'sent'

  // Attempt to classify insurance vs shop based on customer name hints
  const custName = (zInv.customer_name || '').toLowerCase()
  let invoiceType = 'standard'
  const insurers = ['state farm', 'geico', 'allstate', 'progressive', 'farmers', 'liberty mutual', 'usaa', 'nationwide', 'insurance']
  if (insurers.some(i => custName.includes(i))) invoiceType = 'insurance'

  return {
    id: `zoho_${zInv.invoice_id}`,
    invoice_number: zInv.invoice_number,
    customer_type: 'b2b',
    invoice_type: invoiceType,
    customer_name: zInv.customer_name,
    customer_email: zInv.email || '',
    customer_phone: zInv.phone || '',
    customer_address: [
      zInv.billing_address?.address,
      zInv.billing_address?.city,
      zInv.billing_address?.state,
      zInv.billing_address?.zip,
    ].filter(Boolean).join(', '),
    customer_contact: '',
    po_number: zInv.reference_number || '',
    date: zInv.date,
    due_date: zInv.due_date,
    terms: zInv.payment_terms_label || '',
    line_items: (zInv.line_items || []).map(li => ({
      id: `li_${li.line_item_id || Math.random().toString(36).slice(2, 8)}`,
      description: li.name + (li.description ? ` — ${li.description}` : ''),
      qty: Number(li.quantity) || 1,
      rate: Number(li.rate) || 0,
      amount: Number(li.item_total) || 0,
      retail_amount: Number(li.item_total) || 0,
      zoho_item_id: li.item_id,
    })),
    tax_rate: 0,
    tax_amount: Number(zInv.tax_total) || 0,
    discount: Number(zInv.discount_total) || 0,
    discount_pct: 0,
    subtotal: Number(zInv.sub_total) || 0,
    total: Number(zInv.total) || 0,
    amount_paid: Number(zInv.payment_made) || 0,
    balance_due: Number(zInv.balance) || 0,
    status,
    sent_at: status !== 'draft' ? zInv.date + 'T00:00:00Z' : null,
    paid_at: status === 'paid' && zInv.last_payment_date ? zInv.last_payment_date + 'T00:00:00Z' : null,
    job_id: '',
    crm_shop_id: '',
    notes: zInv.notes || '',
    // Keep original Zoho references for cross-linking
    zoho_invoice_id: zInv.invoice_id,
    zoho_customer_id: zInv.customer_id,
    imported_from_zoho: true,
    imported_at: new Date().toISOString(),
    created_at: zInv.created_time || (zInv.date + 'T00:00:00Z'),
  }
}

function mapZohoItemToService(zItem) {
  // Classify by name
  const name = (zItem.name || '').toLowerCase()
  let category = 'Other'
  if (name.includes('calibration') || name.includes('camera') || name.includes('radar') ||
      name.includes('sensor') || name.includes('adas')) category = 'Calibration'
  else if (name.includes('labor') || name.includes('hour') || name.includes('service')) category = 'Labor'

  return {
    id: `zoho_svc_${zItem.item_id}`,
    name: zItem.name,
    category,
    unit_price: Number(zItem.rate) || 0,
    description: zItem.description || '',
    active: zItem.status === 'active',
    zoho_item_id: zItem.item_id,
    imported_from_zoho: true,
    imported_at: new Date().toISOString(),
  }
}

// ── Storage helpers (match books.js chunking) ────────────────────────────────

const CHUNK_SIZE = 30

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
    chunks: chunks.length,
    total: invoices.length,
    updated: new Date().toISOString(),
  })
}

// ── Endpoints ────────────────────────────────────────────────────────────────

// Preview what would be imported (no writes)
router.get('/preview', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const token = await getAccessToken()
    const [customers, invoices, items] = await Promise.all([
      listCustomers(),
      fetchAllInvoices(token),
      fetchAllItems(token),
    ])
    res.json({
      customers: { count: customers.length, sample: customers.slice(0, 5) },
      invoices: { count: invoices.length, sample: invoices.slice(0, 5).map(i => ({
        invoice_number: i.invoice_number, customer_name: i.customer_name,
        date: i.date, total: i.total, status: i.status,
      })) },
      items: { count: items.length, sample: items.slice(0, 10).map(i => ({
        name: i.name, rate: i.rate, status: i.status,
      })) },
    })
  } catch (e) {
    console.error('[zoho-import] preview failed:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Import customers → CRM shops (merge with existing)
router.post('/customers', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })

    const customers = await listCustomers()
    const app = catalyst.initialize(req)
    const tbl = app.datastore().table('CRMShops')
    const existingRows = await tbl.getAllRows()
    const existing = existingRows.map(r => r.toJSON ? r.toJSON() : r)

    let created = 0, skipped = 0, updated = 0
    for (const c of customers) {
      const matchByZohoId = existing.find(s => s.zoho_contact_id === c.contact_id)
      const matchByName = !matchByZohoId && existing.find(s =>
        (s.shop_name || '').toLowerCase() === (c.contact_name || '').toLowerCase()
      )

      const payload = {
        shop_name: c.contact_name,
        phone: c.phone || c.mobile || '',
        email: c.email || '',
        address: [
          c.billing_address?.address,
          c.billing_address?.city,
          c.billing_address?.state,
          c.billing_address?.zip,
        ].filter(Boolean).join(', '),
        zoho_contact_id: c.contact_id,
        pipeline_stage: 'active',  // Customers in Zoho Books = active customers
      }

      try {
        if (matchByZohoId) {
          // Already linked — light update for contact info only
          await tbl.updateRow({ ROWID: matchByZohoId.ROWID, ...payload })
          updated++
        } else if (matchByName) {
          // Name matches — link + merge
          await tbl.updateRow({ ROWID: matchByName.ROWID, ...payload })
          updated++
        } else {
          await tbl.insertRow({
            ...payload,
            people: '[]', activities: '[]',
            created_at: new Date().toISOString(),
          })
          created++
        }
      } catch (err) {
        console.warn('[zoho-import] customer sync failed:', c.contact_name, err.message)
        skipped++
      }
    }

    res.json({ total: customers.length, created, updated, skipped })
  } catch (e) {
    console.error('[zoho-import] customers failed:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Import items → services catalog
router.post('/items', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })

    const token = await getAccessToken()
    const zItems = await fetchAllItems(token)

    const segment = getSegment(req)
    const existing = await cacheGet(segment, 'books_services', []) || []
    const existingByZohoId = new Map(existing.filter(s => s.zoho_item_id).map(s => [s.zoho_item_id, s]))
    const existingByName = new Map(existing.map(s => [s.name.toLowerCase(), s]))

    const merged = [...existing]
    let created = 0, updated = 0, skipped = 0

    for (const z of zItems) {
      const mapped = mapZohoItemToService(z)

      if (existingByZohoId.has(z.item_id)) {
        // Update existing link
        const idx = merged.findIndex(s => s.id === existingByZohoId.get(z.item_id).id)
        if (idx >= 0) {
          merged[idx] = { ...merged[idx], unit_price: mapped.unit_price, active: mapped.active }
          updated++
        }
      } else if (existingByName.has(mapped.name.toLowerCase())) {
        // Match by name → attach zoho_item_id
        const idx = merged.findIndex(s => s.id === existingByName.get(mapped.name.toLowerCase()).id)
        if (idx >= 0) {
          merged[idx] = { ...merged[idx], zoho_item_id: z.item_id, unit_price: mapped.unit_price }
          updated++
        }
      } else {
        merged.push(mapped)
        created++
      }
    }

    await cacheSet(segment, 'books_services', merged)
    res.json({ total: zItems.length, created, updated, skipped, total_services_now: merged.length })
  } catch (e) {
    console.error('[zoho-import] items failed:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Import invoices (history) — this is the big one, supports chunked progress
router.post('/invoices', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })

    const { limit, since } = req.body || {}

    const token = await getAccessToken()
    let zInvoices = await fetchAllInvoices(token)
    if (since) zInvoices = zInvoices.filter(i => i.date >= since)
    if (limit) zInvoices = zInvoices.slice(0, limit)

    const existing = await readInvoices(req)
    const existingByZohoId = new Map(existing.filter(i => i.zoho_invoice_id).map(i => [i.zoho_invoice_id, i]))

    const merged = [...existing]
    let created = 0, updated = 0, failed = 0

    // Fetch full details in batches (to get line_items) — throttled
    for (let i = 0; i < zInvoices.length; i++) {
      const summary = zInvoices[i]
      try {
        const detail = await fetchInvoiceDetail(token, summary.invoice_id)
        const mapped = mapZohoInvoiceToNative(detail)

        if (existingByZohoId.has(summary.invoice_id)) {
          const idx = merged.findIndex(inv => inv.id === existingByZohoId.get(summary.invoice_id).id)
          if (idx >= 0) {
            // Preserve local-only fields (job_id, crm_shop_id, payments)
            merged[idx] = {
              ...mapped,
              job_id: merged[idx].job_id || '',
              crm_shop_id: merged[idx].crm_shop_id || '',
              payments: merged[idx].payments || [],
            }
            updated++
          }
        } else {
          merged.push(mapped)
          created++
        }

        // Light throttling to respect Zoho rate limits (200 req/min)
        if (i % 10 === 9) await new Promise(r => setTimeout(r, 1000))
      } catch (err) {
        console.warn('[zoho-import] invoice failed:', summary.invoice_number, err.message)
        failed++
      }
    }

    // Sort by date desc
    merged.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    await writeInvoices(req, merged)

    res.json({
      total_found: zInvoices.length,
      created, updated, failed,
      total_invoices_now: merged.length,
    })
  } catch (e) {
    console.error('[zoho-import] invoices failed:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// One-click: import everything in the right order
router.post('/full', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })

    const results = {}

    // 1. Items (so services catalog is ready)
    const token = await getAccessToken()
    const zItems = await fetchAllItems(token)
    const segment = getSegment(req)
    const existingServices = await cacheGet(segment, 'books_services', []) || []
    const existingByZohoId = new Map(existingServices.filter(s => s.zoho_item_id).map(s => [s.zoho_item_id, s]))
    const existingByName = new Map(existingServices.map(s => [s.name.toLowerCase(), s]))
    const mergedServices = [...existingServices]
    let itemCreated = 0, itemUpdated = 0
    for (const z of zItems) {
      const mapped = mapZohoItemToService(z)
      if (existingByZohoId.has(z.item_id)) {
        const idx = mergedServices.findIndex(s => s.id === existingByZohoId.get(z.item_id).id)
        if (idx >= 0) { mergedServices[idx] = { ...mergedServices[idx], unit_price: mapped.unit_price, active: mapped.active }; itemUpdated++ }
      } else if (existingByName.has(mapped.name.toLowerCase())) {
        const idx = mergedServices.findIndex(s => s.id === existingByName.get(mapped.name.toLowerCase()).id)
        if (idx >= 0) { mergedServices[idx] = { ...mergedServices[idx], zoho_item_id: z.item_id, unit_price: mapped.unit_price }; itemUpdated++ }
      } else {
        mergedServices.push(mapped); itemCreated++
      }
    }
    await cacheSet(segment, 'books_services', mergedServices)
    results.items = { created: itemCreated, updated: itemUpdated, total: mergedServices.length }

    // 2. Customers → CRM shops
    const customers = await listCustomers()
    const app = catalyst.initialize(req)
    const tbl = app.datastore().table('CRMShops')
    const existingRows = await tbl.getAllRows()
    const existing = existingRows.map(r => r.toJSON ? r.toJSON() : r)
    let custCreated = 0, custUpdated = 0, custSkipped = 0
    for (const c of customers) {
      const matchByZohoId = existing.find(s => s.zoho_contact_id === c.contact_id)
      const matchByName = !matchByZohoId && existing.find(s =>
        (s.shop_name || '').toLowerCase() === (c.contact_name || '').toLowerCase()
      )
      const payload = {
        shop_name: c.contact_name,
        phone: c.phone || c.mobile || '',
        email: c.email || '',
        address: [c.billing_address?.address, c.billing_address?.city, c.billing_address?.state, c.billing_address?.zip].filter(Boolean).join(', '),
        zoho_contact_id: c.contact_id,
        pipeline_stage: 'active',
      }
      try {
        if (matchByZohoId) { await tbl.updateRow({ ROWID: matchByZohoId.ROWID, ...payload }); custUpdated++ }
        else if (matchByName) { await tbl.updateRow({ ROWID: matchByName.ROWID, ...payload }); custUpdated++ }
        else {
          await tbl.insertRow({ ...payload, people: '[]', activities: '[]', created_at: new Date().toISOString() })
          custCreated++
        }
      } catch { custSkipped++ }
    }
    results.customers = { created: custCreated, updated: custUpdated, skipped: custSkipped, total: customers.length }

    // 3. Invoices
    const zInvoices = await fetchAllInvoices(token)
    const existingInvoices = await readInvoices(req)
    const existingByZohoInvId = new Map(existingInvoices.filter(i => i.zoho_invoice_id).map(i => [i.zoho_invoice_id, i]))
    const mergedInvoices = [...existingInvoices]
    let invCreated = 0, invUpdated = 0, invFailed = 0
    for (let i = 0; i < zInvoices.length; i++) {
      try {
        const detail = await fetchInvoiceDetail(token, zInvoices[i].invoice_id)
        const mapped = mapZohoInvoiceToNative(detail)
        if (existingByZohoInvId.has(zInvoices[i].invoice_id)) {
          const idx = mergedInvoices.findIndex(inv => inv.id === existingByZohoInvId.get(zInvoices[i].invoice_id).id)
          if (idx >= 0) {
            mergedInvoices[idx] = {
              ...mapped,
              job_id: mergedInvoices[idx].job_id || '',
              crm_shop_id: mergedInvoices[idx].crm_shop_id || '',
              payments: mergedInvoices[idx].payments || [],
            }
            invUpdated++
          }
        } else {
          mergedInvoices.push(mapped)
          invCreated++
        }
        if (i % 10 === 9) await new Promise(r => setTimeout(r, 1000))
      } catch { invFailed++ }
    }
    mergedInvoices.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    await writeInvoices(req, mergedInvoices)
    results.invoices = { created: invCreated, updated: invUpdated, failed: invFailed, total: mergedInvoices.length }

    res.json({ success: true, results })
  } catch (e) {
    console.error('[zoho-import] full import failed:', e.message)
    res.status(500).json({ error: e.message })
  }
})

export default router
