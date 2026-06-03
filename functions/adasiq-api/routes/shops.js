import express from 'express'
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { getMailAccessToken, getMailAccountId, sendMail } from '../services/mail.js'
import { listCustomers } from '../services/zoho.js'
import { findLeadByName, createLead, updateLead, convertLead } from '../services/zohoCrm.js'

const router = express.Router()
const TABLE_NAME = 'CRMShops'

// ── Datastore helpers ─────────────────────────────────────────────────────────

function getTable(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  return app.datastore().table(TABLE_NAME)
}

function rowToShop(row) {
  const r = row.CRMShops || row
  function parse(val) { try { return JSON.parse(val) } catch { return val } }
  return {
    id:                String(r.ROWID || r.id || ''),
    shop_name:         r.shop_name         || '',
    contact_name:      r.contact_name      || '',
    phone:             r.phone             || '',
    email:             r.email             || '',
    address:           r.address           || '',
    pipeline_stage:    r.pipeline_stage    || 'target',
    notes:             r.notes             || '',
    last_contact:      r.last_contact      || '',
    next_followup:     r.next_followup     || '',
    estimated_monthly: r.estimated_monthly || '',
    region:            r.region            || '',
    assigned_to:       r.assigned_to       || '',
    volume_potential:  r.volume_potential  || '',
    referral_source:   r.referral_source   || '',
    shop_rate:         r.shop_rate         || '',
    insurance_rate:    r.insurance_rate    || '',
    lost_reason:       r.lost_reason       || '',
    lost_to:           r.lost_to           || '',
    people:            typeof r.people === 'string' ? parse(r.people) : (r.people || []),
    activities:        typeof r.activities === 'string' ? parse(r.activities) : (r.activities || []),
    custom_competitors: typeof r.custom_competitors === 'string' ? parse(r.custom_competitors) : (r.custom_competitors || []),
    denied_reasons:    typeof r.denied_reasons === 'string' ? parse(r.denied_reasons) : (r.denied_reasons || []),
    billing_rules:     typeof r.billing_rules === 'string' ? parse(r.billing_rules) : (r.billing_rules || null),
    denied_reason:     r.denied_reason     || '',
    kinetic_in_bed:    r.kinetic_in_bed === 'true' || r.kinetic_in_bed === true,
    zoho_contact_id:   r.zoho_contact_id   || '',
    created_at:        r.created_at        || '',
    shop_id:           r.shop_id           || '',
  }
}

function shopToRow(shop) {
  return {
    shop_name:         shop.shop_name         || '',
    contact_name:      shop.contact_name      || '',
    phone:             shop.phone             || '',
    email:             shop.email             || '',
    address:           shop.address           || '',
    pipeline_stage:    shop.pipeline_stage    || 'target',
    notes:             shop.notes             || '',
    last_contact:      shop.last_contact      || '',
    next_followup:     shop.next_followup     || '',
    estimated_monthly: shop.estimated_monthly || '',
    region:            shop.region            || '',
    assigned_to:       shop.assigned_to       || '',
    volume_potential:  shop.volume_potential  || '',
    referral_source:   shop.referral_source   || '',
    shop_rate:         shop.shop_rate         || '',
    insurance_rate:    shop.insurance_rate    || '',
    lost_reason:       shop.lost_reason       || '',
    lost_to:           shop.lost_to           || '',
    people:            JSON.stringify(shop.people || []),
    activities:        JSON.stringify(shop.activities || []),
    custom_competitors: JSON.stringify(shop.custom_competitors || []),
    denied_reasons:    JSON.stringify(shop.denied_reasons || []),
    billing_rules:     JSON.stringify(shop.billing_rules || null),
    denied_reason:     shop.denied_reason     || '',
    kinetic_in_bed:    String(Boolean(shop.kinetic_in_bed)),
    zoho_contact_id:   shop.zoho_contact_id   || '',
    created_at:        shop.created_at        || new Date().toISOString(),
    shop_id:           shop.shop_id || shop.id || '',
  }
}

async function getAllShops(req) {
  const table = getTable(req)
  const rows = await table.getAllRows()
  return (rows || []).map(rowToShop)
}

// Exported for the dispatch-map feature (geocoding cron, map data endpoint).
export { getAllShops }

async function insertShop(req, shopData) {
  const table = getTable(req)
  const row = shopToRow({ ...shopData, created_at: shopData.created_at || new Date().toISOString() })
  const inserted = await table.insertRow(row)
  return rowToShop(inserted)
}

async function updateShop(req, rowId, updates) {
  const table = getTable(req)
  const row = { ROWID: String(rowId), ...shopToRow(updates) }
  const updated = await table.updateRow(row)
  return rowToShop(updated)
}

async function deleteShop(req, rowId) {
  const table = getTable(req)
  await table.deleteRow(String(rowId))
}

// ── Template helper ───────────────────────────────────────────────────────────

function fillTemplate(text, shop) {
  const contactName  = shop.people?.[0]?.name || shop.contact_name || ''
  const contactFirst = contactName.split(' ')[0] || contactName || 'there'
  return (text || '')
    .replace(/\{shop_name\}/g,     shop.shop_name    || 'your shop')
    .replace(/\{contact_name\}/g,  contactName       || 'there')
    .replace(/\{contact_first\}/g, contactFirst)
    .replace(/\{phone\}/g,         shop.phone        || '')
    .replace(/\{region\}/g,        shop.region       || 'your area')
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/shops/sync-customers — import from Zoho Books
router.post('/sync-customers', async (req, res) => {
  try {
    const zohoCustomers = await listCustomers()
    const businesses = zohoCustomers.filter(c =>
      c.status !== 'inactive' && c.company_name && c.company_name.trim() !== ''
    )
    const shops = await getAllShops(req)
    const existingNames = new Set(shops.map(s => (s.shop_name || '').toLowerCase().trim()))

    const added = []
    const skipped = []
    const now = new Date().toISOString()

    for (const c of businesses) {
      const name = (c.company_name || c.contact_name || '').trim()
      if (!name) continue
      if (existingNames.has(name.toLowerCase())) { skipped.push(name); continue }

      const addr = c.billing_address || {}
      const addressParts = [addr.address, addr.city, addr.state].filter(Boolean)
      const phone = c.phone || c.mobile || ''
      const email = c.email || ''
      const primaryPerson = (phone || email) ? [{ id: `p_zoho_${c.contact_id || Date.now()}`, name: '', title: '', phone, email }] : []

      const shop = await insertShop(req, {
        shop_name: name, contact_name: c.contact_name || '', phone, email,
        address: addressParts.join(', '), pipeline_stage: 'active',
        people: primaryPerson, referral_source: 'Zoho Sync',
        zoho_contact_id: c.contact_id || '', created_at: now,
      })
      added.push(name)
      existingNames.add(name.toLowerCase())
    }

    res.json({ added: added.length, skipped: skipped.length, added_names: added })
  } catch (err) {
    console.error('[shops sync-customers]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/shops/debug-size
router.get('/debug-size', async (req, res) => {
  try {
    const shops = await getAllShops(req)
    res.json({ total_shops: shops.length, storage: 'datastore' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/shops/cal-counts
router.get('/cal-counts', async (req, res) => {
  try {
    const app = catalyst.initialize(req)
    const segment = app.cache().segment()
    let history = []
    try { const val = await segment.getValue('job_history'); history = val ? JSON.parse(val) : [] } catch {}
    const counts = {}
    for (const job of history) {
      const name = (job.shop || job.shop_name || '').trim()
      if (!name) continue
      counts[name.toLowerCase()] = (counts[name.toLowerCase()] || 0) + 1
    }
    res.json(counts)
  } catch (err) {
    console.error('[shops cal-counts]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/shops
router.get('/', async (req, res) => {
  try {
    const shops = await getAllShops(req)
    res.json(shops)
  } catch (err) {
    console.error('[shops GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/shops
router.post('/', async (req, res) => {
  try {
    const shop = await insertShop(req, req.body)
    res.status(201).json(shop)
  } catch (err) {
    console.error('[shops POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/shops/bulk — import array of shops (CSV)
router.post('/bulk', async (req, res) => {
  try {
    const incoming = Array.isArray(req.body) ? req.body : []
    if (incoming.length === 0) return res.status(400).json({ error: 'No shops provided' })

    const existing = await getAllShops(req)
    const existingNames = new Set(existing.map(s => (s.shop_name || '').toLowerCase().trim()))
    const added = []
    const dupes = []

    for (const row of incoming) {
      const name = (row.shop_name || '').trim()
      if (!name) continue
      if (existingNames.has(name.toLowerCase())) { dupes.push(name); continue }

      const shop = await insertShop(req, {
        ...row,
        shop_name: name,
        pipeline_stage: row.pipeline_stage || 'target',
      })
      added.push(shop)
      existingNames.add(name.toLowerCase())
    }

    res.status(201).json({ imported: added.length, duplicates: dupes.length, skipped: dupes, shops: added })
  } catch (err) {
    console.error('[shops bulk]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/shops/broadcast — send email to shops
router.post('/broadcast', async (req, res) => {
  try {
    const { stage, subject, body } = req.body
    if (!subject?.trim() || !body?.trim()) return res.status(400).json({ error: 'subject and body are required' })

    const shops = await getAllShops(req)
    const targets = shops.filter(s => {
      if (stage && s.pipeline_stage !== stage) return false
      return !!(s.people?.[0]?.email || s.email)
    })

    const token = await getMailAccessToken()
    const accountId = await getMailAccountId(token)
    let sent = 0

    for (const shop of targets) {
      const to = shop.people?.[0]?.email || shop.email
      try {
        await sendMail(token, accountId, {
          to,
          subject: fillTemplate(subject, shop),
          body: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#333;">${fillTemplate(body, shop).replace(/\n/g, '<br>')}</div>`,
        })
        sent++
        if (sent % 5 === 0) await new Promise(r => setTimeout(r, 500))
      } catch (mailErr) {
        console.error(`[broadcast] Failed to send to ${to}:`, mailErr.message)
      }
    }

    res.json({ sent, skipped: shops.length - targets.length })
  } catch (err) {
    console.error('[shops broadcast]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/shops/:id — full update
router.put('/:id', async (req, res) => {
  try {
    const table = getTable(req)
    const current = rowToShop(await table.getRow(String(req.params.id)))
    const merged = { ...current, ...req.body, id: current.id, created_at: current.created_at }
    const updated = await updateShop(req, req.params.id, merged)
    res.json(updated)
  } catch (err) {
    console.error('[shops PUT]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/shops/:id — partial update + auto-sync to Zoho CRM on stage change
router.patch('/:id', async (req, res) => {
  try {
    const table = getTable(req)
    const current = rowToShop(await table.getRow(String(req.params.id)))
    const merged = { ...current, ...req.body }
    const updated = await updateShop(req, req.params.id, merged)

    // Auto-sync stage changes to Zoho CRM (non-blocking)
    if (req.body.pipeline_stage && req.body.pipeline_stage !== current.pipeline_stage) {
      setImmediate(async () => {
        try {
          const existing = await findLeadByName(updated.shop_name)
          if (existing) {
            await updateLead(existing.id, updated)
            if ((updated.pipeline_stage === 'active' || updated.pipeline_stage === 'second_active') && existing.Lead_Status !== 'Converted') {
              await convertLead(existing.id)
              console.log(`[shops] Auto-converted lead ${updated.shop_name} to Account`)
            }
          } else {
            const leadId = await createLead(updated)
            if (updated.pipeline_stage === 'active' || updated.pipeline_stage === 'second_active') {
              await convertLead(leadId)
            }
          }
        } catch (e) { console.warn('[shops] CRM auto-sync failed:', e.message) }
      })
    }

    res.json(updated)
  } catch (err) {
    console.error('[shops PATCH]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/shops/:id
router.delete('/:id', async (req, res) => {
  try {
    await deleteShop(req, req.params.id)
    res.json({ success: true })
  } catch (err) {
    console.error('[shops DELETE]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/shops/migrate — one-time: move cache data to Datastore
router.get('/migrate', async (req, res) => {
  try {
    const app = catalyst.initialize(req)
    const segment = app.cache().segment()

    // Read from old cache
    let shops = []
    try {
      const metaRaw = await segment.getValue('crm_shops_meta')
      if (metaRaw) {
        const { chunks } = JSON.parse(metaRaw)
        const parts = await Promise.all(
          Array.from({ length: chunks }, (_, i) =>
            segment.getValue(`crm_shops_chunk_${i}`).then(v => v ? JSON.parse(v) : []).catch(() => [])
          )
        )
        shops = parts.flat()
      }
    } catch {}
    if (shops.length === 0) {
      try { const val = await segment.getValue('crm_shops'); shops = val ? JSON.parse(val) : [] } catch {}
    }

    if (shops.length === 0) return res.json({ ok: true, migrated: 0, message: 'No cache data to migrate' })

    // Check what's already in Datastore
    const existing = await getAllShops(req)
    const existingIds = new Set(existing.map(s => s.shop_id || s.id))

    let migrated = 0
    for (const shop of shops) {
      if (existingIds.has(shop.id)) continue
      await insertShop(req, { ...shop, shop_id: shop.id })
      migrated++
    }

    res.json({ ok: true, migrated, total_in_cache: shops.length, already_in_db: existing.length })
  } catch (err) {
    console.error('[shops migrate]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/shops/search-places — search Google Places (New API) for body shops
router.get('/search-places', async (req, res) => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Google Places API key not configured. Add GOOGLE_PLACES_API_KEY to Catalyst env vars.' })

  const { location, radius, query } = req.query
  if (!location) return res.status(400).json({ error: 'location is required (city name or zip code)' })

  // Run multiple search variations to get more results (Google caps at 20 per request)
  const searchTerms = [
    (query || 'auto body shop') + ' near ' + location,
    'collision repair near ' + location,
    'auto body repair near ' + location,
    'car body shop near ' + location,
  ]
  const radiusMiles = parseInt(radius) || 25

  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': apiKey,
    'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.id,places.googleMapsUri',
  }

  try {
    const allPlaces = new Map() // dedupe by place_id

    for (const q of searchTerms) {
      try {
        const searchResp = await axios.post('https://places.googleapis.com/v1/places:searchText', {
          textQuery: q,
          maxResultCount: 20,
        }, { headers, timeout: 15000 })

        for (const p of (searchResp.data.places || [])) {
          if (!allPlaces.has(p.id)) {
            allPlaces.set(p.id, {
              name: p.displayName?.text || '',
              address: p.formattedAddress || '',
              phone: p.nationalPhoneNumber || '',
              website: p.websiteUri || '',
              google_maps_url: p.googleMapsUri || '',
              rating: p.rating || 0,
              user_ratings_total: p.userRatingCount || 0,
              place_id: p.id || '',
              email: '',
            })
          }
        }
      } catch (e) { console.warn(`[places] Search "${q}" failed:`, e.message) }
    }

    const places = [...allPlaces.values()]
    console.log(`[places] Found ${places.length} unique results across ${searchTerms.length} searches`)

    // Scrape emails from websites (parallel, best-effort)
    const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
    const SKIP_EMAILS = ['example.com','sentry.io','wixpress.com','googleapis.com','schema.org','wordpress.org','w3.org','gravatar.com','gstatic.com']
    await Promise.all(places.map(async (p) => {
      if (!p.website) return
      try {
        const resp = await axios.get(p.website, { timeout: 5000, maxRedirects: 3, headers: { 'User-Agent': 'Mozilla/5.0' } })
        const html = typeof resp.data === 'string' ? resp.data : ''
        const emails = [...new Set((html.match(EMAIL_RE) || []))]
          .filter(e => !SKIP_EMAILS.some(skip => e.toLowerCase().includes(skip)))
          .filter(e => !e.includes('.png') && !e.includes('.jpg') && !e.includes('.gif'))
        if (emails.length > 0) p.email = emails[0]
      } catch {}
    }))

    // Sort by rating (highest first)
    places.sort((a, b) => (b.rating || 0) - (a.rating || 0))

    res.json({ ok: true, places, total: places.length })
  } catch (err) {
    console.error('[places] Search error:', err.response?.data || err.message)
    res.status(500).json({ error: err.response?.data?.error?.message || err.message })
  }
})

// ── Dispatch-map geocoding extensions (absolute_adas namespace) ─────────────

// POST /api/shops/:shopName/geocode
// Force a single-shop re-geocode against Google. Used when an address changes
// or when an automatic geocode came back ambiguous and dispatch wants to retry.
router.post('/:shopName/geocode', async (req, res) => {
  try {
    const { readGeocacheRaw, writeGeocache, geocodeAddress, normalizeKey } = await import('../services/geocoding.js')
    const shopName = decodeURIComponent(req.params.shopName)
    const shops = await getAllShops(req)
    const shop = shops.find(s => s.shop_name?.toLowerCase().trim() === shopName.toLowerCase().trim())
    if (!shop) return res.status(404).json({ error: `Shop "${shopName}" not found` })
    if (!shop.address) return res.status(400).json({ error: 'Shop has no address to geocode' })

    const result = await geocodeAddress(shop.address)
    if (!result) return res.status(500).json({ error: 'Geocoding API unavailable (check GOOGLE_PLACES_API_KEY + Geocoding API enabled)' })

    const cache = await readGeocacheRaw(req)
    cache[normalizeKey(shopName)] = { ...result, geocoded_at: new Date().toISOString() }
    await writeGeocache(req, cache)

    res.json({ ok: true, shop_name: shopName, ...cache[normalizeKey(shopName)] })
  } catch (err) {
    console.error('[shops geocode]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/shops/:shopName/coordinates
// Manual lat/lng override for a shop. Used when geocoding fails or returns
// the wrong location (common for industrial parks). Sticky: marked source
// "manual" so the cron does not overwrite it.
router.put('/:shopName/coordinates', async (req, res) => {
  try {
    const { readGeocacheRaw, writeGeocache, normalizeKey } = await import('../services/geocoding.js')
    const shopName = decodeURIComponent(req.params.shopName)
    const { lat, lng } = req.body || {}
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat and lng must be numbers' })
    }

    const cache = await readGeocacheRaw(req)
    cache[normalizeKey(shopName)] = {
      lat, lng,
      geocoded_at: new Date().toISOString(),
      geocode_status: 'ok',
      geocode_source: 'manual',
    }
    await writeGeocache(req, cache)

    res.json({ ok: true, shop_name: shopName, ...cache[normalizeKey(shopName)] })
  } catch (err) {
    console.error('[shops coordinates]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Pinned shops (Mark's main-client list) ──────────────────────────────────
//
// Stored in Catalyst Datastore table `PinnedShops` (durable). The read path
// in services/geocoding.js merges these on top of the geocache so all
// dispatch code sees pinned coords transparently. The cron skips any shop
// whose key is in the pinned set.

// GET /api/shops/pins — list every pinned shop (durable)
router.get('/pins', async (req, res) => {
  try {
    const { listPinnedShops } = await import('../services/pinnedShops.js')
    const all = await listPinnedShops(req)
    const pins = all
      .map(p => ({
        shop_name_key: p.shop_name_key,
        shop_name: p.shop_name,
        lat: p.lat,
        lng: p.lng,
        address: p.address,
        geocoded_at: p.geocoded_at,
      }))
      .sort((a, b) => a.shop_name_key.localeCompare(b.shop_name_key))
    res.json({ ok: true, pins })
  } catch (err) {
    console.error('[shops pins list]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/shops/pin — add or update a pinned shop by typing an address.
// Body: { shop_name, address }. Geocodes the address and writes to Datastore.
router.post('/pin', async (req, res) => {
  try {
    const { shop_name, address } = req.body || {}
    if (!shop_name || !shop_name.trim()) return res.status(400).json({ error: 'shop_name is required' })
    if (!address || !address.trim()) return res.status(400).json({ error: 'address is required' })

    const { geocodeAddress } = await import('../services/geocoding.js')
    const { upsertPinnedShop } = await import('../services/pinnedShops.js')
    const result = await geocodeAddress(address)
    if (!result || result.lat == null) {
      return res.status(422).json({ error: `Could not geocode "${address}". Try a more specific address.` })
    }

    const saved = await upsertPinnedShop(req, {
      shop_name: shop_name.trim(),
      address: address.trim(),
      lat: result.lat,
      lng: result.lng,
    })
    res.json({ ok: true, ...saved })
  } catch (err) {
    console.error('[shops pin add]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/shops/pin/:shopName — remove a pinned shop.
router.delete('/pin/:shopName', async (req, res) => {
  try {
    const { normalizeKey } = await import('../services/geocoding.js')
    const { deletePinnedShopByKey } = await import('../services/pinnedShops.js')
    const key = normalizeKey(decodeURIComponent(req.params.shopName))
    const removed = await deletePinnedShopByKey(req, key)
    if (!removed) return res.status(404).json({ error: 'Pinned shop not found' })
    res.json({ ok: true })
  } catch (err) {
    console.error('[shops pin delete]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/shops/migrate-pins — one-time: copy manual pins from the cache
// into the PinnedShops Datastore table. Idempotent: skips entries that
// already exist by shop_name_key. Optionally clears the cache copies after
// a successful migration (?clearCache=true).
router.post('/migrate-pins', async (req, res) => {
  try {
    const { readGeocacheRaw, writeGeocache } = await import('../services/geocoding.js')
    const { listPinnedShops, upsertPinnedShop } = await import('../services/pinnedShops.js')
    const cache = await readGeocacheRaw(req)
    const existing = await listPinnedShops(req)
    const existingKeys = new Set(existing.map(p => p.shop_name_key))

    const cacheManual = Object.entries(cache).filter(([, v]) => v.geocode_source === 'manual')
    const migrated = []
    const skipped = []
    for (const [key, v] of cacheManual) {
      if (existingKeys.has(key)) { skipped.push(key); continue }
      if (v.lat == null || v.lng == null) { skipped.push(key); continue }
      await upsertPinnedShop(req, {
        shop_name: key,
        address: v.address || '',
        lat: v.lat,
        lng: v.lng,
      })
      migrated.push(key)
    }

    let cleared = 0
    if (req.query.clearCache === 'true') {
      for (const [key] of cacheManual) {
        delete cache[key]
        cleared++
      }
      await writeGeocache(req, cache)
    }

    res.json({
      ok: true,
      migrated_count: migrated.length,
      skipped_count: skipped.length,
      cleared_from_cache: cleared,
      migrated, skipped,
    })
  } catch (err) {
    console.error('[shops migrate-pins]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/shops/zoho-duplicates?q=L-M
// Diagnostic: list every Zoho Books contact whose name contains the query
// substring (case-insensitive). Returns count, contact_ids, created_time,
// status. Use to see the scope of duplicate customers in Zoho Books so a
// cleanup pass can be planned.
router.get('/zoho-duplicates', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase()
    if (!q) return res.status(400).json({ error: 'Pass ?q=<name fragment>, e.g. ?q=l-m' })
    const all = await listCustomers()
    const matches = all
      .filter(c => (c.contact_name || '').toLowerCase().includes(q))
      .map(c => ({
        contact_id: c.contact_id,
        contact_name: c.contact_name,
        company_name: c.company_name,
        email: c.email,
        phone: c.phone || c.mobile,
        status: c.status,
        billing_city: c.billing_address?.city || '',
      }))
    // Group by exact normalized name to surface dup clusters
    const normalize = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const clusters = {}
    for (const c of matches) {
      const k = normalize(c.contact_name)
      if (!clusters[k]) clusters[k] = []
      clusters[k].push(c)
    }
    const clusterSummary = Object.entries(clusters)
      .map(([k, list]) => ({ normalized: k, count: list.length, sample: list[0]?.contact_name }))
      .sort((a, b) => b.count - a.count)
    res.json({
      ok: true,
      query: q,
      total_matches: matches.length,
      total_clusters: Object.keys(clusters).length,
      clusters: clusterSummary,
      contacts: matches,
    })
  } catch (err) {
    console.error('[shops zoho-duplicates]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
