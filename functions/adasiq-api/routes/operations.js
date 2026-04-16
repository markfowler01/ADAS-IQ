// Phase 8 — operational endpoints:
// - Per-van tool inventory
// - Daily route optimization (sequence jobs by proximity)
// - Monthly rollup invoice generation

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

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

function isAdmin(req) { return req.user?.role !== 'technician' }

// ── Per-van tool inventory ───────────────────────────────────────────────────

const DEFAULT_VAN_INVENTORY = []

router.get('/vans', async (req, res) => {
  try {
    const segment = getSegment(req)
    const vans = (await cacheGet(segment, 'van_inventory', DEFAULT_VAN_INVENTORY)) || []
    res.json(vans)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/vans', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const vans = Array.isArray(req.body) ? req.body : []
    const segment = getSegment(req)
    await cacheSet(segment, 'van_inventory', vans)
    res.json(vans)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Check tool availability for a job
router.post('/tool-availability', async (req, res) => {
  try {
    const { required_tools } = req.body
    if (!Array.isArray(required_tools) || required_tools.length === 0) {
      return res.json({ available: true, matching_vans: [] })
    }
    const segment = getSegment(req)
    const vans = (await cacheGet(segment, 'van_inventory', [])) || []
    const matching = vans.filter(v => {
      const tools = new Set((v.tools || []).map(t => (t.name || t).toLowerCase()))
      return required_tools.every(rt => tools.has((rt || '').toLowerCase()))
    })
    res.json({
      available: matching.length > 0,
      matching_vans: matching.map(v => ({
        van_id: v.id, van_name: v.name, technician: v.assigned_to,
      })),
      required_tools,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Route optimization ──────────────────────────────────────────────────────
// Simple nearest-neighbor sequencing — orders a tech's today jobs by proximity

function haversineMiles(a, b) {
  if (!a?.lat || !b?.lat) return Infinity
  const R = 3959
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h))
}

router.post('/optimize-route', async (req, res) => {
  try {
    const { technician, start_location, date } = req.body
    const targetDate = date || new Date().toISOString().slice(0, 10)

    const jobs = await readJobs(req)
    const shops = await readShops(req)
    const shopsByName = new Map(shops.map(s => [(s.shop_name || '').toLowerCase(), s]))

    // Filter: tech's open jobs scheduled for today
    const myJobs = jobs.filter(j => {
      if (technician && j.technician !== technician) return false
      const scheduledDate = (j.scheduled_date || '').slice(0, 10)
      if (scheduledDate && scheduledDate !== targetDate) return false
      return !['complete', 'cancelled'].includes(j.status)
    })

    // Attach location coordinates from shop addresses (best effort — shops need geocoded lat/lng)
    const enriched = myJobs.map(j => {
      const shop = shopsByName.get((j.shop_name || '').toLowerCase())
      return {
        ...j,
        shop_location: shop?.location || null,  // expects { lat, lng } on shop record
        shop_address: shop?.address || j.shop_address || '',
      }
    })

    // Nearest-neighbor from start
    if (!start_location) {
      // Fall back to sorting by scheduled_time if present, else as-is
      enriched.sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''))
      return res.json({
        strategy: 'no_start_location',
        route: enriched.map(j => ({ job_id: j.id, shop_name: j.shop_name, address: j.shop_address })),
        note: 'Provide start_location { lat, lng } for distance-based optimization',
      })
    }

    const remaining = [...enriched]
    const ordered = []
    let current = start_location
    let totalMiles = 0

    while (remaining.length > 0) {
      let nearestIdx = 0
      let nearestDist = Infinity
      for (let i = 0; i < remaining.length; i++) {
        const d = haversineMiles(current, remaining[i].shop_location)
        if (d < nearestDist) { nearestDist = d; nearestIdx = i }
      }
      const next = remaining.splice(nearestIdx, 1)[0]
      ordered.push({
        job_id: next.id,
        shop_name: next.shop_name,
        address: next.shop_address,
        vehicle: [next.year, next.make, next.model].filter(Boolean).join(' '),
        ro_number: next.ro_number,
        leg_miles: nearestDist === Infinity ? null : Math.round(nearestDist * 10) / 10,
      })
      if (next.shop_location) {
        current = next.shop_location
        if (nearestDist !== Infinity) totalMiles += nearestDist
      }
    }

    res.json({
      strategy: 'nearest_neighbor',
      technician,
      date: targetDate,
      total_jobs: ordered.length,
      total_miles_estimated: Math.round(totalMiles * 10) / 10,
      route: ordered,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Monthly rollup invoicing ─────────────────────────────────────────────────
// Generates a single consolidated invoice per shop for all unbilled jobs in a month.
// Only triggered for shops with billing_rules.monthly_rollup === true.

router.post('/monthly-rollup', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })

    const month = req.body?.month || new Date().toISOString().slice(0, 7)  // YYYY-MM
    const [monthYear] = month.split('-')
    const year = Number(monthYear)
    const monthNum = Number(month.split('-')[1])
    const monthStart = `${month}-01`
    const nextMonth = monthNum === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(monthNum + 1).padStart(2, '0')}-01`

    const shops = await readShops(req)
    const rolloverShops = shops.filter(s => s.billing_rules?.monthly_rollup === true)

    if (rolloverShops.length === 0) {
      return res.json({
        ok: true,
        note: 'No shops have monthly_rollup enabled (opt-in per shop in billing rules)',
        created: 0,
      })
    }

    const jobs = await readJobs(req)
    const invoices = await readInvoices(req)
    const invoicedJobIds = new Set(invoices.map(i => i.job_id).filter(Boolean))

    const created = []
    for (const shop of rolloverShops) {
      const shopName = (shop.shop_name || '').toLowerCase()
      const shopJobs = jobs.filter(j => {
        if ((j.shop_name || '').toLowerCase() !== shopName) return false
        if (j.status !== 'complete') return false
        if (invoicedJobIds.has(j.id)) return false
        const completedDate = (j.completed_at || j.created_at || '').slice(0, 10)
        return completedDate >= monthStart && completedDate < nextMonth
      })

      if (shopJobs.length === 0) continue

      // Build line items from all jobs
      const lineItems = []
      let total = 0
      for (const j of shopJobs) {
        const cals = Array.isArray(j.calibrations) ? j.calibrations : []
        for (const c of cals) {
          const name = typeof c === 'string' ? c : (c.name || 'Calibration')
          const rate = typeof c === 'object' ? (Number(c.price) || 0) : 0
          const amount = rate
          total += amount
          lineItems.push({
            id: `li_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            description: `${name} — ${[j.year, j.make, j.model].filter(Boolean).join(' ')}${j.ro_number ? ` (RO# ${j.ro_number})` : ''}`,
            qty: 1, rate, amount, retail_amount: amount,
            job_id: j.id,
          })
        }
      }

      const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const due = new Date()
      due.setDate(due.getDate() + 30)
      const newInv = {
        id: invoiceId,
        invoice_number: `INV-ROLLUP-${year}${String(monthNum).padStart(2, '0')}-${shop.id.slice(-4)}`,
        customer_type: 'b2b',
        invoice_type: 'shop',
        customer_name: shop.shop_name,
        customer_email: shop.billing_rules?.billing_contact_email || shop.email || '',
        customer_phone: shop.phone || '',
        customer_address: shop.address || '',
        customer_contact: shop.billing_rules?.billing_contact_name || '',
        po_number: '',
        date: new Date().toISOString().slice(0, 10),
        due_date: due.toISOString().slice(0, 10),
        terms: shop.billing_rules?.default_terms || 'Net 30',
        line_items: lineItems,
        tax_rate: 0, tax_amount: 0,
        discount: 0, discount_pct: 0,
        subtotal: total, total,
        amount_paid: 0, balance_due: total,
        status: 'draft',
        job_id: '',
        crm_shop_id: shop.id,
        notes: `Monthly rollup invoice for ${month} covering ${shopJobs.length} jobs. Please review before sending.`,
        is_monthly_rollup: true,
        rollup_month: month,
        rollup_job_ids: shopJobs.map(j => j.id),
        created_at: new Date().toISOString(),
      }
      invoices.push(newInv)
      created.push({
        invoice_id: invoiceId,
        shop: shop.shop_name,
        jobs: shopJobs.length,
        total: Math.round(total * 100) / 100,
      })
    }

    if (created.length > 0) await writeInvoices(req, invoices)
    res.json({ ok: true, month, created_count: created.length, created })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
