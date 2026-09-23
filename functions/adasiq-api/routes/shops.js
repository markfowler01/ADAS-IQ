import express from 'express'
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { getMailAccessToken, getMailAccountId, sendMail } from '../services/mail.js'
import { listCustomers, getAccessToken, listInvoicesForDateRange } from '../services/zoho.js'
import { postToCliqChannel, DISPATCH_CHANNEL } from '../services/cliq.js'
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
    drps:              typeof r.drps === 'string' ? (parse(r.drps) || []) : (r.drps || []),   // DRP insurers (Mark 2026-09-10)
    denied_reason:     r.denied_reason     || '',
    kinetic_in_bed:    r.kinetic_in_bed === 'true' || r.kinetic_in_bed === true,
    zoho_contact_id:   r.zoho_contact_id   || '',
    next_action:       r.next_action       || '',   // pipeline cadence (2026-09-15)
    fit_score:         r.fit_score == null || r.fit_score === '' ? null : Number(r.fit_score),
    stage_changed_at:  r.stage_changed_at  || '',
    created_at:        r.created_at        || '',
    shop_id:           r.shop_id           || '',
  }
}

// Territory auto-zone (2026-09-15): a shop with no valid zone gets one from its
// address, else its name; owner defaults to the zone owner. Never overrides a
// zone or owner someone set on purpose.
async function autoZone(shop) {
  try {
    const pz = await import('../services/pipeline.js')
    const out = { ...shop }
    if (!pz.ZONE_BY_ID[out.region]) { const z = pz.zoneForAddress(out.address) || pz.zoneForAddress(out.shop_name); if (z) out.region = z }
    if (!pz.OWNERS.includes(out.assigned_to) && pz.ZONE_BY_ID[out.region]) out.assigned_to = pz.ZONE_BY_ID[out.region].owner
    return out
  } catch { return shop }
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
    drps:              JSON.stringify(Array.isArray(shop.drps) ? shop.drps : []),
    denied_reason:     shop.denied_reason     || '',
    kinetic_in_bed:    String(Boolean(shop.kinetic_in_bed)),
    zoho_contact_id:   shop.zoho_contact_id   || '',
    next_action:       String(shop.next_action || '').slice(0, 255),
    fit_score:         shop.fit_score == null || shop.fit_score === '' ? null : Math.max(0, Math.min(10, Number(shop.fit_score) || 0)),
    stage_changed_at:  shop.stage_changed_at  || '',
    created_at:        shop.created_at        || new Date().toISOString(),
    shop_id:           shop.shop_id || shop.id || '',
  }
}

async function getAllShops(req) {
  // getAllRows() silently caps at 200 rows (found 2026-09-15 when the CRM passed
  // 200 shops). Page through ZCQL instead; same shape, same export.
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const out = []
  for (let off = 0; ; off += 300) {
    const rows = await app.zcql().executeZCQLQuery(`SELECT * FROM CRMShops ORDER BY ROWID LIMIT ${off}, 300`)
    const batch = (rows || []).map(r => r?.CRMShops || r).filter(Boolean)
    out.push(...batch)
    if (batch.length < 300) break
  }
  return out.map(rowToShop)
}

// Exported for the dispatch-map feature (geocoding cron, map data endpoint).
export { getAllShops, insertShop, updateShop }

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

// Books → CRM import. Mark 2026-09-22: "make sure all of my current
// customers are in the CRM". Every active Books customer that is a
// business comes over — by company name, or by contact name when the
// company field is blank and the name reads like a shop (All Makes Autos
// LLC was invisible for months because of that blank). Existing shops are
// matched by normalized name (also minus Inc/LLC, and on the loose key)
// and get their Books id linked when missing. People (retail) stay out.
const BIZ_RE = /\b(llc|inc|corp|co|ltd|auto|autos|automotive|body|autobody|collision|shop|glass|carstar|maaco|motors|repair|center|centre|dealer|dealership|fleet|truck|trucks|tire|tires|service|services|garage|detail|paint|fix|gerber|ford|toyota|honda|chevrolet|chevy|subaru|nissan|kia|hyundai|dodge|jeep|ram|gmc|buick|mazda|lexus|bmw|mercedes|audi|volkswagen|vw|tesla|rivian|volvo|porsche|works|restoration|rebuild|customs|sales|rv|towing|mobile)\b/i
const NOT_SHOP_RE = /^(test|walk-?in customer|amazon customer service|unknown|demo.*)$/i
// Insurers get billed directly sometimes — they're payers, not shops.
const INSURER_RE = /\b(state farm|allstate|geico|liberty mutual|safeco|progressive|usaa|farmers|pemco|nationwide|travelers|american family|amfam|hartford|mutual of enumclaw|country financial)\b/i
const keyOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const keyNoSuffix = s => keyOf(s).replace(/(inc|llc|corp|ltd)$/, '')
const looseOf = s => keyOf(s).replace(/(autobody|bodyshop|collision|repair|center|centre|inc|llc|auto|body|shop)/g, '')
export async function syncCustomersFromBooks(req, { dry = false } = {}) {
  const [zohoCustomers, invoices] = await Promise.all([listCustomers(), listInvoicesForDateRange('2024-01-01', new Date().toISOString().slice(0, 10))])
  // "Current customer" = someone we've actually invoiced. A Books contact
  // with no invoice stays out until it earns one.
  const billed = new Set(invoices.map(i => String(i.customer_id || '')).filter(Boolean))
  const unbilled = []
  const candidates = zohoCustomers.filter(c => {
    if (c.status === 'inactive') return false
    const cn = String(c.contact_name || '').trim(), co = String(c.company_name || '').trim()
    if (NOT_SHOP_RE.test(cn) || NOT_SHOP_RE.test(co) || INSURER_RE.test(cn) || INSURER_RE.test(co)) return false
    return !!(co || BIZ_RE.test(cn))
  })
  const shops = await getAllShops(req)
  const byKey = new Map(), byNoSuffix = new Map(), byLoose = new Map(), byContact = new Map()
  for (const s of shops) {
    byKey.set(keyOf(s.shop_name), s); byNoSuffix.set(keyNoSuffix(s.shop_name), s)
    const l = looseOf(s.shop_name); if (l.length >= 4 && !byLoose.has(l)) byLoose.set(l, s)
    if (s.zoho_contact_id) byContact.set(String(s.zoho_contact_id), s)
  }
  const added = [], linked = [], skipped = [], people = zohoCustomers.length - candidates.length
  const now = new Date().toISOString()
  for (const c of candidates) {
    const name = (String(c.company_name || '').trim() || String(c.contact_name || '').trim())
    if (!name) continue
    const names = [name, String(c.contact_name || '').trim()].filter(Boolean)
    let hit = byContact.get(String(c.contact_id)) || null
    for (const n of names) hit = hit || byKey.get(keyOf(n)) || byNoSuffix.get(keyNoSuffix(n)) || (looseOf(n).length >= 4 ? byLoose.get(looseOf(n)) : null)
    if (hit) {
      if (!hit.zoho_contact_id) {
        linked.push({ shop: hit.shop_name, books: name, contact_id: c.contact_id })
        if (!dry) await updateShop(req, hit.id, { ...hit, zoho_contact_id: c.contact_id })
        hit.zoho_contact_id = c.contact_id; byContact.set(String(c.contact_id), hit)
      } else skipped.push(name)
      continue
    }
    // Never invoiced → not a customer yet; link if we already have them, but don't add.
    if (!billed.has(String(c.contact_id))) { unbilled.push(name); continue }
    const addr = c.billing_address || {}
    const addressParts = [addr.address, addr.city, addr.state].filter(Boolean)
    const phone = c.phone || c.mobile || ''
    const email = c.email || ''
    const primaryPerson = (phone || email) ? [{ id: `p_zoho_${c.contact_id || Date.now()}`, name: c.company_name ? (c.contact_name || '') : '', title: '', phone, email }] : []
    added.push({ name, city: addr.city || '', phone, email, contact_id: c.contact_id })
    if (!dry) {
      const shop = await insertShop(req, {
        shop_name: name, contact_name: c.company_name ? (c.contact_name || '') : '', phone, email,
        address: addressParts.join(', '), pipeline_stage: 'active',
        people: primaryPerson, referral_source: 'Zoho Sync',
        zoho_contact_id: c.contact_id || '', created_at: now,
      })
      byKey.set(keyOf(name), shop); byContact.set(String(c.contact_id), shop)
    }
  }
  return { dry, candidates: candidates.length, people_skipped: people, unbilled_skipped: unbilled, added: added.length, added_names: added, linked: linked.length, linked_names: linked, already: skipped.length }
}

// POST /api/shops/sync-customers — import from Zoho Books (?dry=1 to preview)
router.post('/sync-customers', async (req, res) => {
  try { res.json(await syncCustomersFromBooks(req, { dry: req.query.dry === '1' })) }
  catch (err) { console.error('[shops sync-customers]', err.message); res.status(500).json({ error: err.message }) }
})

// 🔗 Integrations (Mark 2026-09-23): Kinetic via CCC Secure Share, ADAS Maps.
router.get('/:id/integrations', async (req, res) => {
  try {
    const shop = (await getAllShops(req)).find(x => String(x.id) === String(req.params.id)); if (!shop) return res.status(404).json({ error: 'Shop not found' })
    const I = await import('../services/integrations.js')
    let images = {}; try { const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT config_value FROM AppConfig WHERE config_key = 'walkthrough_images' LIMIT 1`); images = JSON.parse(rows?.[0]?.AppConfig?.config_value || '{}') } catch { images = {} }
    res.json({ ok: true, integrations: I.readIntegrations(shop), steps: { kinetic: I.KINETIC_STEPS, adasmaps: I.ADASMAPS_STEPS }, images, labels: I.LABEL })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/:id/integrations/:which/:action', async (req, res) => {
  try {
    const which = String(req.params.which); const action = String(req.params.action)
    const I = await import('../services/integrations.js')
    if (!I.WHICH.includes(which)) return res.status(400).json({ error: 'kinetic or adasmaps' })
    const shop = (await getAllShops(req)).find(x => String(x.id) === String(req.params.id)); if (!shop) return res.status(404).json({ error: 'Shop not found' })
    const by = req.user?.name || req.user?.techName || req.user?.email || 'staff'
    const isTech = String(req.user?.role || '') === 'technician'
    let r
    if (action === 'start') r = await I.setState(req, shop, which, 'started', by, 'setup started')
    else if (action === 'step-done' && which === 'kinetic') r = await I.kineticStepDone(req, shop, by)
    else if (action === 'invite' && which === 'adasmaps') r = await I.adasMapsInvite(req, shop, by)
    else if (action === 'reemail' && which === 'kinetic') r = await I.kineticStepDone(req, shop, by)
    else if (action === 'connected' && !isTech) r = await I.setState(req, shop, which, 'connected', by, 'marked connected by hand')
    else if (action === 'off' && !isTech) r = await I.setState(req, shop, which, 'off', by, 'turned off')
    else return res.status(400).json({ error: `Can't ${action} on ${which}${isTech ? ' (owner/Kat only)' : ''}` })
    try { const { invalidate } = await import('../services/big3.js'); invalidate && invalidate() } catch { /* fine */ }
    res.json({ ok: true, ...r, integrations: I.readIntegrations(r.shop) })
  } catch (e) { console.error('[integrations]', e.message); res.status(500).json({ error: e.message }) }
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

// ── Customer card notes (Mark 2026-07-10) ──────────────────────────────────
// Per-customer sticky info that shows on every Kanban card for that
// shop — set once, saved on the CRM shop row (billing_rules.card_note;
// the billing engine only reads its own keys so this is inert to it).
// Matching is by normalized shop name since jobs only carry shop_name.
function normShopName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[,.]?\s*(inc|llc|corp|co)\.?\s*$/i, '')  // "L-M Body Shop, Inc." ≈ "L-M Body Shop"
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Storage: the AppConfig Datastore table (config_key varchar /
// config_value text — schema verified 2026-07-09). One row per shop,
// key `card_note:<normalized name>`. NOT on CRMShops — that table's
// live schema doesn't actually have the billing_rules column the code
// maps ("Invalid input value for column name" = unknown column).
const CARD_NOTE_PREFIX = 'card_note:'
const APP_CONFIG_TABLE = 'AppConfig'

function cardNoteKey(shopName) {
  return (CARD_NOTE_PREFIX + normShopName(shopName)).slice(0, 64)
}

// GET /api/shops/card-notes → { notes: { "<normalized name>": "note" } }
// Paginated full-table read + JS prefix filter. AppConfig grows daily
// now (invoice-alert stamps, day totals, delete tombstones), so the old
// single `LIMIT 500` window silently dropped notes once the table
// passed 500 rows (Mark hit this 2026-07-14: "note is saved but it
// doesn't pop on the Kanban card"). ZCQL LIKE stays off the table —
// it returned empty results in prod 2026-07-11.
router.get('/card-notes', async (req, res) => {
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const notes = {}
    const PAGE = 300
    for (let offset = 0; offset < 20000; offset += PAGE) {
      const rows = await app.zcql().executeZCQLQuery(
        `SELECT config_key, config_value FROM ${APP_CONFIG_TABLE} LIMIT ${PAGE} OFFSET ${offset}`
      )
      for (const row of rows || []) {
        const r = row[APP_CONFIG_TABLE] || row
        const key = String(r?.config_key || '')
        if (key.startsWith(CARD_NOTE_PREFIX) && r.config_value) {
          notes[key.slice(CARD_NOTE_PREFIX.length)] = String(r.config_value)
        }
      }
      if (!rows || rows.length < PAGE) break
    }
    res.json({ ok: true, notes })
  } catch (err) {
    console.error('[shops card-notes]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/shops/card-note { shop_name, note } — empty note clears it.
router.post('/card-note', async (req, res) => {
  try {
    const shopName = String(req.body?.shop_name || '').trim()
    const note = String(req.body?.note || '').trim()
    if (!shopName) return res.status(400).json({ error: 'shop_name required' })
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const key = cardNoteKey(shopName)
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT ROWID FROM ${APP_CONFIG_TABLE} WHERE config_key = '${key.replace(/'/g, "''")}' LIMIT 1`
    )
    const existing = rows?.[0]?.[APP_CONFIG_TABLE] || rows?.[0] || null
    const table = app.datastore().table(APP_CONFIG_TABLE)
    if (existing?.ROWID) {
      if (note) {
        await table.updateRow({ ROWID: String(existing.ROWID), config_key: key, config_value: note })
      } else {
        await table.deleteRow(String(existing.ROWID))
      }
    } else if (note) {
      await table.insertRow({ config_key: key, config_value: note })
    }
    res.json({ ok: true, shop_name: shopName, note })
  } catch (err) {
    console.error('[shops card-note save]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/shops
// Big 3: every shop's rule (card badges) + active shops without one.
router.get('/big3-map', async (req, res) => {
  try { const b3 = await import('../services/big3.js'); res.json({ ok: true, ...(await b3.big3Map(req)) }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
// Big 3: suggestion from the shop's recent Books invoices (Kat confirms).
router.get('/:id/big3-suggest', async (req, res) => {
  try {
    const shop = rowToShop(await getTable(req).getRow(String(req.params.id)))
    const b3 = await import('../services/big3.js')
    res.json({ ok: true, shop_name: shop.shop_name, ...(await b3.suggestBig3(shop.shop_name)) })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// Big 3 by shop NAME (creates the CRM shop if needed) — for seeding rules.
router.put('/big3-by-name', async (req, res) => {
  try {
    const b3 = await import('../services/big3.js')
    const name = String(req.body?.shop_name || '').trim()
    const rules = b3.normalizeRules(req.body?.rules)
    if (!name || !rules) return res.status(400).json({ error: 'shop_name and rules required' })
    const r = await b3.saveBig3(req, name, rules, req.body?.by || req.user?.name || req.user?.email || '', { discount_pct: req.body?.discount_pct, customer_type: req.body?.customer_type, silent: !!req.body?.silent })
    res.json({ ok: true, ...r, rules })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 🧾 Zoho Books customer for a CRM shop (Mark 2026-09-14: "does this also
// add the customer to Zoho Books because I do need that to happen").
// Links to an existing Books contact by exact name first (the L-M dupes
// came from blind creates), otherwise creates one: business customer,
// billing address, phone, the CRM people as contact persons, Due on
// Receipt. Stores the id on the shop (zoho_contact_id).
router.post('/:id/books-customer', async (req, res) => {
  try {
    if (req.user?.role === 'technician') return res.status(403).json({ error: 'Staff only' })
    const shop = rowToShop(await getTable(req).getRow(String(req.params.id)))
    if (!shop) return res.status(404).json({ error: 'Shop not found' })
    if (shop.zoho_contact_id && !req.body?.relink) return res.json({ ok: true, existing: true, contact_id: shop.zoho_contact_id })
    const token = await getAccessToken()
    const B = 'https://www.zohoapis.com/books/v3'
    const H = { Authorization: `Zoho-oauthtoken ${token}` }
    const P = { organization_id: process.env.ZOHO_ORGANIZATION_ID }
    const name = String(shop.shop_name || '').trim()
    if (!name) return res.status(400).json({ error: 'Shop has no name' })
    const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    // 1. Already in Books under this name? Link, don't duplicate.
    const found = await axios.get(`${B}/contacts`, { headers: H, params: { ...P, contact_name_contains: name.slice(0, 40), contact_type: 'customer' }, timeout: 15000, validateStatus: s => s < 500 })
    const hit = (found.data?.contacts || []).find(c => norm(c.contact_name) === norm(name) || norm(c.company_name) === norm(name))
    if (hit) {
      await updateShop(req, shop.id, { ...shop, zoho_contact_id: hit.contact_id })
      return res.json({ ok: true, linked: true, contact_id: hit.contact_id, contact_name: hit.contact_name })
    }
    // 2. Create it.
    let people = shop.people
    if (typeof people === 'string') { try { people = JSON.parse(people) } catch { people = [] } }
    const persons = (people || []).filter(p => p?.name).slice(0, 10).map((p, i) => {
      const parts = String(p.name).trim().split(/\s+/)
      return { first_name: parts[0] || '', last_name: parts.slice(1).join(' ') || '', email: p.email || '', phone: p.phone || '', designation: p.title || '', is_primary_contact: i === 0 }
    })
    const addr = String(shop.address || '').trim()
    const m = /^(.*?),?\s*([A-Za-z .]+),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/.exec(addr)
    const billing_address = m ? { address: m[1].trim(), city: m[2].trim(), state: m[3], zip: m[4], country: 'U.S.A' } : (addr ? { address: addr, country: 'U.S.A' } : undefined)
    const body = {
      contact_name: name, company_name: name, contact_type: 'customer', customer_sub_type: 'business',
      ...(shop.phone ? { phone: shop.phone } : {}), ...(billing_address ? { billing_address, shipping_address: billing_address } : {}),
      contact_persons: persons, payment_terms: 0, payment_terms_label: 'Due on Receipt',
      notes: `Created from the Absolute ADAS app CRM by ${req.user?.name || req.user?.email || 'staff'} on ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' })}`,
    }
    const c = await axios.post(`${B}/contacts`, body, { headers: H, params: P, timeout: 20000, validateStatus: s => s < 500 })
    if (c.data?.code !== 0) return res.status(502).json({ error: `Books said: ${c.data?.message || c.status}` })
    const contact = c.data.contact
    await updateShop(req, shop.id, { ...shop, zoho_contact_id: contact.contact_id })
    console.log(`[shops] Books customer created: ${name} (${contact.contact_id}) by ${req.user?.email || 'staff'}`)
    postToCliqChannel(DISPATCH_CHANNEL, `🧾 *New Zoho Books customer* · ${name}${persons.length ? ` · ${persons.length} contact${persons.length === 1 ? '' : 's'}` : ''} — created from the app's New Customer form`).catch(() => {})
    res.json({ ok: true, created: true, contact_id: contact.contact_id, contact_name: contact.contact_name })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// ── ➕ New shop from the request form (single-invoice billing Phase E, Mark
//    2026-09-22: "make sure there is something that says New Shop and then
//    the new shop onboarding"). The tech, standing in the shop, gives the
//    short version; the app makes the CRM card, the Books customer, the
//    billing rules, and hands Kat a checklist. Any signed-in user.
const NEW_SHOP_ITEMS = [
  { key: 'w9',       label: 'W-9 / resale certificate on file (if they ask for one, send ours)', owner: 'kat', due: 7 },
  { key: 'insurers', label: 'Which insurers / DRPs they work with — on the CRM card',          owner: 'kat', due: 7 },
  { key: 'signoff',  label: 'Who signs off on invoices (name + email) — on the CRM card',       owner: 'kat', due: 3 },
  { key: 'terms',    label: 'Payment terms confirmed with them (on site / net terms)',          owner: 'kat', due: 3 },
  { key: 'route',    label: 'Added to the route day for their zone',                            owner: 'mark', due: 7 },
  { key: 'welcome',  label: 'Welcome email sent — who to call, how to book, the Big 3',         owner: 'kat', due: 2 },
  { key: 'kinetic',  label: 'Kinetic turned on in CCC Secure Share (CRM → Billing → Kinetic → walk-through)', owner: 'mark', due: 7 },
  { key: 'adasmaps', label: 'ADAS Maps: shop added us as vendor (CRM → Billing → ADAS Maps → send steps)', owner: 'mark', due: 7 },
  { key: 'first30',  label: '30-day check-in after the first job',                              owner: 'mark', due: 30 },
]
const addDaysISO = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
function newShopChecklist(by) { const t = todayISO(); return { started_at: new Date().toISOString(), started_by: by || '', items: NEW_SHOP_ITEMS.map(i => ({ ...i, done: false, at: '', by: '', due_date: addDaysISO(t, i.due) })) } }

/** Books customer for a CRM shop — linked, found by name, or created (business). */
async function ensureShopBooksContact(req, shop, by) {
  if (shop.zoho_contact_id) return { contact_id: shop.zoho_contact_id, contact_name: shop.shop_name, existing: true }
  const token = await getAccessToken()
  const B = 'https://www.zohoapis.com/books/v3', H = { Authorization: `Zoho-oauthtoken ${token}` }, P = { organization_id: process.env.ZOHO_ORGANIZATION_ID }
  const name = String(shop.shop_name || '').trim(); if (!name) throw new Error('Shop has no name')
  const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const found = await axios.get(`${B}/contacts`, { headers: H, params: { ...P, contact_name_contains: name.slice(0, 40), contact_type: 'customer' }, timeout: 15000, validateStatus: s => s < 500 })
  const hit = (found.data?.contacts || []).find(c => norm(c.contact_name) === norm(name) || norm(c.company_name) === norm(name))
  if (hit) { await updateShop(req, shop.id, { ...shop, zoho_contact_id: hit.contact_id }); return { contact_id: hit.contact_id, contact_name: hit.contact_name, linked: true } }
  let people = shop.people; if (typeof people === 'string') { try { people = JSON.parse(people) } catch { people = [] } }
  const persons = (people || []).filter(p => p?.name).slice(0, 10).map((p, i) => { const parts = String(p.name).trim().split(/\s+/); return { first_name: parts[0] || '', last_name: parts.slice(1).join(' ') || '', email: p.email || '', phone: p.phone || '', designation: p.title || '', is_primary_contact: i === 0 } })
  const addr = String(shop.address || '').trim()
  const m = /^(.*?),?\s*([A-Za-z .]+),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/.exec(addr)
  const billing_address = m ? { address: m[1].trim(), city: m[2].trim(), state: m[3], zip: m[4], country: 'U.S.A' } : (addr ? { address: addr, country: 'U.S.A' } : undefined)
  const body = { contact_name: name, company_name: name, contact_type: 'customer', customer_sub_type: 'business', ...(shop.phone ? { phone: shop.phone } : {}), ...(billing_address ? { billing_address, shipping_address: billing_address } : {}), contact_persons: persons, payment_terms: 0, payment_terms_label: 'Due on Receipt', notes: `Created from the Absolute ADAS app by ${by || 'staff'} on ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' })}` }
  const c = await axios.post(`${B}/contacts`, body, { headers: H, params: P, timeout: 20000, validateStatus: s => s < 500 })
  if (c.data?.code !== 0) throw new Error(`Books said: ${c.data?.message || c.status}`)
  await updateShop(req, shop.id, { ...shop, zoho_contact_id: c.data.contact.contact_id })
  return { contact_id: c.data.contact.contact_id, contact_name: c.data.contact.contact_name, created: true }
}

router.post('/quick', async (req, res) => {
  try {
    const b = req.body || {}
    const name = String(b.shop_name || '').trim().slice(0, 120)
    if (!name) return res.status(400).json({ error: 'Shop name is required.' })
    const by = req.user?.name || req.user?.email || 'tech'
    const b3 = await import('../services/big3.js')
    const ctype = b3.CUSTOMER_TYPES[b.customer_type] ? b.customer_type : 'repair_shop'
    const pay = b3.PAY_MODES[b.pay_mode] ? b.pay_mode : b3.CUSTOMER_TYPES[ctype].pay
    // Never a duplicate: same name (normalized) → use the card that exists.
    const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
    const all = await getAllShops(req)
    let shop = all.find(x => norm(x.shop_name) === norm(name)) || null
    let created = false
    if (!shop) {
      const person = b.contact_name ? [{ id: `p_${Date.now()}`, name: String(b.contact_name).slice(0, 80), title: String(b.contact_title || 'Contact').slice(0, 40), phone: String(b.phone || '').slice(0, 40), email: String(b.email || '').trim().toLowerCase().slice(0, 120), source: 'new-shop' }] : []
      shop = await insertShop(req, await autoZone({ shop_name: name, contact_name: String(b.contact_name || '').slice(0, 80), phone: String(b.phone || '').slice(0, 40), email: String(b.email || '').trim().toLowerCase().slice(0, 120), address: String(b.address || '').slice(0, 200), pipeline_stage: 'active', referral_source: `New shop · ${by}`, people: person, activities: [{ id: `a_${Date.now()}`, type: 'note', at: new Date().toISOString(), by, text: `Added from the field by ${by} on a job request.` }], notes: String(b.notes || '').slice(0, 500), stage_changed_at: new Date().toISOString() }))
      created = true
    }
    // Billing answers + the new-shop checklist, in one save.
    const br = shop.billing_rules && typeof shop.billing_rules === 'object' ? shop.billing_rules : {}
    const rules = b3.normalizeRules(br.big3) || b3.DEFAULT_RULES
    await b3.saveBig3(req, shop.shop_name, rules, by, { shop, customer_type: ctype, discount_pct: br.discount_value ?? (b3.CUSTOMER_TYPES[ctype].discount ?? 0), pay_mode: pay, silent: true })
    shop = rowToShop(await getTable(req).getRow(String(shop.id)))
    if (!shop.billing_rules?.new_shop) { shop.billing_rules = { ...(shop.billing_rules || {}), new_shop: newShopChecklist(by) }; shop = await updateShop(req, shop.id, shop) }
    let books = null
    try { books = await ensureShopBooksContact(req, shop, by) } catch (e) { console.warn('[shops quick] Books customer failed:', e.message); books = { error: e.message } }
    if (created) {
      await postToCliqChannel(DISPATCH_CHANNEL, `🆕 *New shop — ${shop.shop_name}* · ${b3.CUSTOMER_TYPES[ctype].label} · ${pay.replace('_', ' ')} · by ${by}${shop.region ? ` · zone ${shop.region}` : ''}${books?.contact_id ? ' · Books customer ready' : ' · ⚠ Books customer NOT created'}\nKat: the new-shop checklist is on the CRM card → Billing.`).catch(() => {})
      try { const { createNotification } = await import('./notifications.js'); await createNotification(req, { to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com', type: 'new_shop', title: `New shop: ${shop.shop_name}`, body: `${b3.CUSTOMER_TYPES[ctype].label} · added by ${by} · checklist on the CRM card`, skipCliq: true, skipTechChannel: true }) } catch { /* fine */ }
    }
    console.log(`[shops quick] ${created ? 'created' : 'matched'} ${shop.shop_name} (${ctype}, ${pay}) by ${by} → Books ${books?.contact_id || books?.error}`)
    res.json({ ok: true, created, shop: { id: shop.id, shop_name: shop.shop_name, region: shop.region }, contact_id: books?.contact_id || '', contact_name: books?.contact_name || shop.shop_name, books_error: books?.error || '' })
  } catch (e) { console.error('[shops quick]', e.message); res.status(500).json({ error: e.message }) }
})
// Kat ticks the new-shop checklist from the CRM card.
router.post('/:id/new-shop', async (req, res) => {
  try {
    if (req.user?.role === 'technician') return res.status(403).json({ error: 'Staff only' })
    const shop = rowToShop(await getTable(req).getRow(String(req.params.id)))
    if (!shop) return res.status(404).json({ error: 'Shop not found' })
    const br = shop.billing_rules && typeof shop.billing_rules === 'object' ? shop.billing_rules : {}
    if (req.body?.action === 'start' || !br.new_shop) br.new_shop = newShopChecklist(req.user?.name || '')
    const key = String(req.body?.key || '')
    if (key) { const it = br.new_shop.items.find(i => i.key === key); if (it) { it.done = !it.done; it.at = it.done ? new Date().toISOString() : ''; it.by = it.done ? (req.user?.name || '') : '' } }
    if (br.new_shop.items.every(i => i.done)) br.new_shop.completed_at = br.new_shop.completed_at || new Date().toISOString(); else br.new_shop.completed_at = ''
    const saved = await updateShop(req, shop.id, { ...shop, billing_rules: br })
    res.json({ ok: true, new_shop: saved.billing_rules?.new_shop || br.new_shop })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Big 3 rule on a CRM shop (Mark 2026-09-10) — read/set from the Billing tab.
router.get('/:id/big3', async (req, res) => {
  try {
    const shop = rowToShop(await getTable(req).getRow(String(req.params.id)))
    const b3 = await import('../services/big3.js')
    const br = typeof shop.billing_rules === 'string' ? (JSON.parse(shop.billing_rules || '{}') || {}) : (shop.billing_rules || {})
    res.json({ ok: true, rules: b3.normalizeRules(br.big3), set_by: br.big3_set_by || '', set_at: br.big3_set_at || '', modes: b3.MODES, big3: b3.BIG3,
      customer_type: br.customer_type || '', discount_pct: Number.isFinite(Number(br.discount_value)) ? Number(br.discount_value) : null, pay_mode: br.pay_mode || '', types: b3.CUSTOMER_TYPES, pay_modes: b3.PAY_MODES })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// The three billing questions (Mark 2026-09-22): what kind of customer,
// discount shown, how they pay. Saved on billing_rules next to the Big 3.
router.put('/:id/billing', async (req, res) => {
  try {
    const shop = rowToShop(await getTable(req).getRow(String(req.params.id)))
    const b3 = await import('../services/big3.js')
    const br = typeof shop.billing_rules === 'string' ? (JSON.parse(shop.billing_rules || '{}') || {}) : (shop.billing_rules || {})
    const ctype = String(req.body?.customer_type || '')
    if (!b3.CUSTOMER_TYPES[ctype]) return res.status(400).json({ error: 'customer_type must be body_shop, repair_shop, dealer or retail' })
    const pct = req.body?.discount_pct == null || req.body.discount_pct === '' ? (b3.CUSTOMER_TYPES[ctype].discount ?? Number(br.discount_value) ?? 0) : Math.max(0, Math.min(60, Number(req.body.discount_pct) || 0))
    const pay = b3.PAY_MODES[req.body?.pay_mode] ? req.body.pay_mode : b3.CUSTOMER_TYPES[ctype].pay
    const rules = b3.normalizeRules(br.big3) || b3.DEFAULT_RULES
    const r = await b3.saveBig3(req, shop.shop_name, rules, req.user?.name || req.user?.email || '', { shop, customer_type: ctype, discount_pct: pct, pay_mode: pay, silent: true })
    console.log(`[billing] ${shop.shop_name}: ${ctype} · ${pct}% · ${pay} (by ${req.user?.name || '?'})`)
    res.json({ ok: true, ...r, customer_type: ctype, discount_pct: pct, pay_mode: pay })
  } catch (e) { console.error('[shops billing PUT]', req.params.id, e.message); res.status(500).json({ error: e.message }) }
})
router.put('/:id/big3', async (req, res) => {
  try {
    const shop = rowToShop(await getTable(req).getRow(String(req.params.id)))
    const b3 = await import('../services/big3.js')
    const rules = b3.normalizeRules(req.body?.rules || req.body)
    if (!rules) return res.status(400).json({ error: 'rules required: cal_id / pcsi / post_scan = bill | included | shop' })
    const r = await b3.saveBig3(req, shop.shop_name, rules, req.user?.name || req.user?.email || '', { shop })
    if (!r?.changed) console.log(`[big3] ${shop.shop_name}: unchanged re-save by ${req.user?.name || req.user?.email || '?'} — no ping`)
    res.json({ ok: true, ...r, rules, set_by: req.user?.name || req.user?.email || '' })
  } catch (e) { console.error('[shops big3 PUT]', req.params.id, e.message); res.status(500).json({ error: e.message }) }
})

router.get('/', async (req, res) => {
  try {
    const shops = await getAllShops(req)
    res.json(shops)
  } catch (err) {
    console.error('[shops GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/shops/van-contact
// Single-entry contact capture. Adds the person to the matching CRM shop
// (creating the shop if it doesn't exist yet) AND enrolls their email
// into the From-the-Van Resend audience. Both operations are best-effort
// so a Resend hiccup never blocks the CRM row from saving; the response
// tells the caller which side succeeded.
//
// Body: { first_name, last_name, email, phone, shop_name, notes? }
// Response: { ok, shop_id, shop_created, van_subscribed, van_error? }
router.post('/van-contact', async (req, res) => {
  try {
    const body = req.body || {}
    const first_name = String(body.first_name || '').trim()
    const last_name  = String(body.last_name  || '').trim()
    const email      = String(body.email      || '').trim().toLowerCase()
    const phone      = String(body.phone      || '').trim()
    const shopName   = String(body.shop_name  || '').trim()
    const notes      = String(body.notes      || '').trim()

    if (!shopName)        return res.status(400).json({ error: 'shop_name is required' })
    if (!email && !phone) return res.status(400).json({ error: 'email or phone is required' })

    const fullName = [first_name, last_name].filter(Boolean).join(' ')

    // ── 1) CRM side — find or create shop, upsert person by email ───────────
    const all = await getAllShops(req)
    const shopKey = shopName.toLowerCase()
    let shop = all.find(s => String(s.shop_name || '').toLowerCase().trim() === shopKey)
    let shop_created = false

    const newPerson = {
      name:  fullName || undefined,
      email: email    || undefined,
      phone: phone    || undefined,
      source: 'van-contact-form',
      added_at: new Date().toISOString(),
    }
    // Strip undefined so we don't store empty keys.
    Object.keys(newPerson).forEach(k => newPerson[k] === undefined && delete newPerson[k])

    if (!shop) {
      // Brand new shop — bootstrap with this person as person[0].
      const inserted = await insertShop(req, {
        shop_name: shopName,
        phone: phone || '',
        email: email || '',
        pipeline_stage: 'target',
        people: [newPerson],
        notes: notes ? `Van-form: ${notes}` : '',
        referral_source: 'From the Van sign-up',
      })
      shop = inserted
      shop_created = true
    } else {
      // Existing shop — dedup people by email (case-insensitive). If a
      // matching person already exists, patch their fields; otherwise
      // append. Shop-level phone/email left alone to avoid clobbering
      // primary-contact data.
      const people = Array.isArray(shop.people) ? [...shop.people] : []
      const emailKey = email.toLowerCase()
      const idx = emailKey ? people.findIndex(p => String(p.email || '').toLowerCase() === emailKey) : -1
      if (idx >= 0) people[idx] = { ...people[idx], ...newPerson }
      else people.push(newPerson)

      // Append the note as an activity entry instead of overwriting shop.notes.
      const activities = Array.isArray(shop.activities) ? [...shop.activities] : []
      if (notes || fullName || email || phone) {
        activities.unshift({
          type: 'van-contact-signup',
          summary: `Added van newsletter contact${fullName ? ' — ' + fullName : ''}${email ? ' (' + email + ')' : ''}${notes ? ' — ' + notes : ''}`,
          at: new Date().toISOString(),
        })
      }
      await updateShop(req, shop.id, { ...shop, people, activities })
    }

    // ── 2) Van newsletter side — Resend enrollment (idempotent) ─────────────
    let van_subscribed = false
    let van_error = null
    if (email) {
      try {
        const { addVanSubscriber } = await import('../services/fromTheVan.js')
        const r = await addVanSubscriber({ email, firstName: first_name, lastName: last_name })
        if (r?.ok) van_subscribed = true
        else van_error = r?.error || 'unknown addVanSubscriber failure'
      } catch (e) {
        van_error = e.message
      }
    } else {
      van_error = 'no email provided — newsletter enrollment skipped'
    }

    res.json({
      ok: true,
      shop_id: shop.id,
      shop_name: shop.shop_name,
      shop_created,
      van_subscribed,
      ...(van_error ? { van_error } : {}),
    })
  } catch (err) {
    console.error('[shops van-contact]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/shops
router.post('/', async (req, res) => {
  try {
    const body = await autoZone(req.body || {})
    // A shop added straight in as a customer (Active) gets the New Shop
    // checklist — Kinetic + ADAS Maps + billing items — same as the field
    // "New shop" form (Mark 2026-09-23: "built into both add-a-shop processes").
    if (['active', 'second_active'].includes(String(body.pipeline_stage || '')) && !body.billing_rules?.new_shop) body.billing_rules = { ...(body.billing_rules || {}), new_shop: newShopChecklist(req.user?.name || req.user?.email || '') }
    const shop = await insertShop(req, body)
    if (shop.billing_rules?.new_shop) { try { const { createNotification } = await import('./notifications.js'); await createNotification(req, { to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com', type: 'onboarding', title: `New shop: ${shop.shop_name}`, body: 'New Shop checklist started — W-9, insurers, sign-off, terms, Kinetic, ADAS Maps (CRM → Billing).', skipCliq: true, skipTechChannel: true }) } catch { /* fine */ } }
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
    const merged = await autoZone({ ...current, ...req.body, id: current.id, created_at: current.created_at })
    if (req.body.pipeline_stage && req.body.pipeline_stage !== current.pipeline_stage) merged.stage_changed_at = new Date().toISOString()
    // Prospect → customer: start the New Shop checklist the moment a shop goes Active (Mark 2026-09-23).
    let seededChecklist = false
    if (req.body.pipeline_stage && req.body.pipeline_stage !== current.pipeline_stage && ['active', 'second_active'].includes(String(req.body.pipeline_stage)) && !merged.billing_rules?.new_shop) {
      merged.billing_rules = { ...(merged.billing_rules || {}), new_shop: newShopChecklist(req.user?.name || req.user?.email || '') }; seededChecklist = true
    }
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
    const merged = await autoZone({ ...current, ...req.body })
    if (req.body.pipeline_stage && req.body.pipeline_stage !== current.pipeline_stage) merged.stage_changed_at = new Date().toISOString()
    const updated = await updateShop(req, req.params.id, merged)

    // New customer with no Big 3 rule → ask for it once (Mark 2026-09-10).
    if (req.body.pipeline_stage && /^(active|second_active|active2)$/.test(req.body.pipeline_stage) && !/^(active|second_active|active2)$/.test(current.pipeline_stage || '')) {
      try {
        const b3 = await import('../services/big3.js')
        const cur = await b3.readBig3(req, updated.shop_name)
        if (!cur.rules) {
          const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js')
          await postToCliqChannel(DISPATCH_CHANNEL, `🧾 *${updated.shop_name} just went Active* — set their Big 3 rule (CRM → shop → Billing) so the first invoice comes out right. Cal ID / PCSI / Post-Scan: we bill, no charge, or shop handles.`)
        }
      } catch (e) { console.log('[shops] big3 onboarding ping failed:', e.message) }
    }

    // Auto-sync stage changes to Zoho CRM (non-blocking)
    if (seededChecklist) { try { const { createNotification } = await import('./notifications.js'); await createNotification(req, { to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com', type: 'onboarding', title: `${updated.shop_name} went Active — New Shop checklist started`, body: 'W-9, insurers, sign-off, terms, welcome email, Kinetic, ADAS Maps (CRM → Billing).', skipCliq: true, skipTechChannel: true }); await postToCliqChannel(DISPATCH_CHANNEL, `🆕 *${updated.shop_name} is now Active* — New Shop checklist started (CRM → Billing): billing questions, Kinetic on Secure Share, ADAS Maps.`) } catch { /* fine */ } }
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
