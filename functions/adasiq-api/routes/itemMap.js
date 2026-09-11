// Item Map API — backs the More → Item Mapping screen (Mark 2026-08-11).
//
//   GET    /api/item-map          → { map, books_items, vocab }
//   PUT    /api/item-map          { kinetic_name, item_name, item_id } — upsert one
//   POST   /api/item-map/delete   { kinetic_name }
//   POST   /api/item-map/seed     → Claude proposes pairings for every
//                                   unmapped vocab entry; stored source:'seed'
//
// Mounted with requireAuth. See services/itemMap.js for storage.

import express from 'express'
import {
  readItemMap, upsertMapping, deleteMapping, normalizeMapKey, KINETIC_SENSOR_VOCAB,
} from '../services/itemMap.js'
import { getItemCatalogForAudit } from '../services/zoho.js'

const router = express.Router()

// ── Zoho Books items: scope probe + create (Mark 2026-09-09: "wait you
// can add items in zoho books") ─────────────────────────────────────────
// Creating items needs ZohoBooks.settings.CREATE on the Books refresh
// token. /books-scope reports what the token was granted (scope string
// only — never the token). /create-item is owner-or-cron-secret only.
import axios from 'axios'
const ownerOrSecret = req => {
  const owner = String(req.user?.email || '').toLowerCase().startsWith('mark@') || req.user?.role === 'owner'
  const secret = String(process.env.BILLING_CRON_SECRET || process.env.MORNING_CRON_SECRET || 'morning-2026').trim()
  return owner || String(req.headers['x-cron-secret'] || '').trim() === secret
}
router.get('/books-scope', async (req, res) => {
  try {
    const p = new URLSearchParams({
      grant_type: 'refresh_token', client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET, refresh_token: process.env.ZOHO_REFRESH_TOKEN || '',
    })
    const t = await axios.post('https://accounts.zoho.com/oauth/v2/token', p.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 12000, validateStatus: s => s < 500,
    })
    const scope = String(t.data?.scope || t.data?.error || '')
    res.json({ ok: true, scope, can_create_items: /ZohoBooks\.(settings\.(CREATE|ALL)|fullaccess\.all)/i.test(scope) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// PDF templates in Books (estimate + invoice) — so Bill it can pin the right ones.
router.get('/books-templates', async (req, res) => {
  try {
    const { getAccessToken } = await import('../services/zoho.js')
    const token = await getAccessToken()
    const H = { Authorization: `Zoho-oauthtoken ${token}` }
    const P = { organization_id: process.env.ZOHO_ORGANIZATION_ID }
    const [e, i] = await Promise.all([
      axios.get('https://www.zohoapis.com/books/v3/estimates/templates', { headers: H, params: P, timeout: 12000, validateStatus: s => s < 500 }),
      axios.get('https://www.zohoapis.com/books/v3/invoices/templates', { headers: H, params: P, timeout: 12000, validateStatus: s => s < 500 }),
    ])
    const slim = t => ({ template_id: t.template_id, template_name: t.template_name, template_type: t.template_type, is_default: !!t.is_default })
    // Which template do the recent hand-made invoices actually use?
    const recent = await axios.get('https://www.zohoapis.com/books/v3/invoices', { headers: H, params: { ...P, per_page: 25, sort_column: 'created_time', sort_order: 'D' }, timeout: 12000, validateStatus: s => s < 500 })
    const usage = {}
    for (const inv of recent.data?.invoices || []) { const k = inv.template_name || inv.template_id || '?'; usage[k] = (usage[k] || 0) + 1 }
    res.json({ ok: true, estimate_templates: (e.data?.templates || []).map(slim), invoice_templates: (i.data?.templates || []).map(slim), recent_invoice_template_usage: usage,
      recent: (recent.data?.invoices || []).slice(0, 12).map(x => ({ n: x.invoice_number, customer: x.customer_name, template: x.template_name || x.template_id, date: x.date })) })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})
// Full invoice by number (template + terms + discount shape) — for comparing hand-made vs app-made.
router.get('/books-invoice', async (req, res) => {
  try {
    const { getAccessToken } = await import('../services/zoho.js')
    const token = await getAccessToken()
    const H = { Authorization: `Zoho-oauthtoken ${token}` }
    const P = { organization_id: process.env.ZOHO_ORGANIZATION_ID }
    const n = String(req.query.n || '')
    if (req.query.estimate) {
      const el = await axios.get('https://www.zohoapis.com/books/v3/estimates', { headers: H, params: { ...P, estimate_number: n }, timeout: 12000, validateStatus: s => s < 500 })
      const eh = (el.data?.estimates || []).find(i => i.estimate_number === n)
      if (!eh) return res.status(404).json({ error: 'estimate not found' })
      const ed = await axios.get(`https://www.zohoapis.com/books/v3/estimates/${eh.estimate_id}`, { headers: H, params: P, timeout: 12000, validateStatus: s => s < 500 })
      const est = ed.data?.estimate || {}
      return res.json({ ok: true, estimate_number: est.estimate_number, template_name: est.template_name, notes: est.notes, terms: est.terms, reference_number: est.reference_number, salesperson_name: est.salesperson_name, custom_fields: (est.custom_fields || []).map(c => ({ api_name: c.api_name, label: c.label, value: c.value, customfield_id: c.customfield_id, show_on_pdf: c.show_on_pdf })) })
    }
    const list = await axios.get('https://www.zohoapis.com/books/v3/invoices', { headers: H, params: { ...P, invoice_number: n }, timeout: 12000, validateStatus: s => s < 500 })
    const hit = (list.data?.invoices || []).find(i => i.invoice_number === n)
    if (!hit) return res.status(404).json({ error: 'not found' })
    const d = await axios.get(`https://www.zohoapis.com/books/v3/invoices/${hit.invoice_id}`, { headers: H, params: P, timeout: 12000, validateStatus: s => s < 500 })
    const inv = d.data?.invoice || {}
    res.json({ ok: true, invoice_number: inv.invoice_number, template_id: inv.template_id, template_name: inv.template_name, template_type: inv.template_type, payment_terms: inv.payment_terms, payment_terms_label: inv.payment_terms_label, discount_type: inv.discount_type, discount: inv.discount, is_discount_before_tax: inv.is_discount_before_tax, notes: inv.notes, terms: inv.terms, salesperson_name: inv.salesperson_name, reference_number: inv.reference_number, custom_fields: inv.custom_fields, line_items: (inv.line_items || []).map(l => ({ name: l.name, rate: l.rate, quantity: l.quantity, discount: l.discount, discount_amount: l.discount_amount, item_total: l.item_total })), total: inv.total, sub_total: inv.sub_total, status: inv.status, created_by: inv.created_by_name || inv.created_by_id })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})
router.post('/create-item', async (req, res) => {
  try {
    if (!ownerOrSecret(req)) return res.status(403).json({ error: 'Only Mark can add Zoho Books items.' })
    const { name, rate, description } = req.body || {}
    if (!name || !Number.isFinite(Number(rate))) return res.status(400).json({ error: 'name and rate required' })
    const { getAccessToken } = await import('../services/zoho.js')
    const token = await getAccessToken()
    const r = await axios.post('https://www.zohoapis.com/books/v3/items', {
      name: String(name).slice(0, 100), rate: Number(rate), description: String(description || '').slice(0, 2000), product_type: 'service',
    }, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { organization_id: process.env.ZOHO_ORGANIZATION_ID },
      timeout: 15000, validateStatus: s => s < 500,
    })
    if (r.data?.code !== 0) return res.status(400).json({ error: r.data?.message || 'Zoho refused', code: r.data?.code })
    const it = r.data.item || {}
    console.log(`[books item] created "${it.name}" $${it.rate} (${it.item_id})`)
    res.json({ ok: true, item: { item_id: it.item_id, name: it.name, rate: it.rate } })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// Owner/secret diagnostic: search Books for a name across contacts,
// estimates, invoices, items. Read-only. (Mark 2026-09-09: LM duplicates.)
router.get('/books-search', async (req, res) => {
  try {
    if (!ownerOrSecret(req)) return res.status(403).json({ error: 'Owner only.' })
    const q = String(req.query.q || '').trim()
    if (!q) return res.status(400).json({ error: 'q required' })
    const { getAccessToken } = await import('../services/zoho.js')
    const token = await getAccessToken()
    const H = { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 20000, validateStatus: s => s < 500 }
    const org = process.env.ZOHO_ORGANIZATION_ID
    const get = (path, params) => axios.get(`https://www.zohoapis.com/books/v3/${path}`, { ...H, params: { organization_id: org, per_page: 200, ...params } }).then(r => r.data)
    const [contacts, estimates, invoices, items] = await Promise.all([
      get('contacts', { contact_name_contains: q }),
      get('estimates', { customer_name_contains: q }),
      get('invoices', { customer_name_contains: q }),
      get('items', { name_contains: q }),
    ])
    res.json({
      contacts: (contacts.contacts || []).map(c => ({ id: c.contact_id, name: c.contact_name, type: c.contact_type, status: c.status, created: c.created_time, outstanding: c.outstanding_receivable_amount })),
      estimates: (estimates.estimates || []).map(e => ({ id: e.estimate_id, number: e.estimate_number, customer: e.customer_name, date: e.date, status: e.status, total: e.total, ref: e.reference_number, created: e.created_time })),
      invoices: (invoices.invoices || []).map(i => ({ id: i.invoice_id, number: i.invoice_number, customer: i.customer_name, date: i.date, status: i.status, total: i.total, ref: i.reference_number, created: i.created_time })),
      items: (items.items || []).map(i => ({ id: i.item_id, name: i.name, rate: i.rate, status: i.status })),
    })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// Owner/secret: dedupe Books customers by exact name (Mark 2026-09-09:
// "several duplicates for L-M … remove all the duplicates that have a
// zero dollar amount"). Keeps every contact with money on it
// (outstanding/unused credits) and anything Books refuses to delete
// (has transactions). dry=1 (default) only reports. Deletes are capped
// per call so a run stays under the 30s gateway.
router.post('/dedupe-contacts', async (req, res) => {
  try {
    if (!ownerOrSecret(req)) return res.status(403).json({ error: 'Owner only.' })
    const name = String(req.body?.name || '').trim()
    const dry = String(req.body?.dry ?? '1') !== '0'
    const limit = Math.min(80, Number(req.body?.limit) || 60)
    if (!name) return res.status(400).json({ error: 'name required' })
    const { getAccessToken } = await import('../services/zoho.js')
    const token = await getAccessToken()
    const H = { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 20000, validateStatus: s => s < 500 }
    const org = process.env.ZOHO_ORGANIZATION_ID
    const all = []
    for (let page = 1; page <= 10; page++) {
      const r = await axios.get('https://www.zohoapis.com/books/v3/contacts', { ...H, params: { organization_id: org, per_page: 200, page, contact_name_contains: name, contact_type: 'customer' } })
      all.push(...(r.data?.contacts || []))
      if (!r.data?.page_context?.has_more_page) break
    }
    const exact = all.filter(c => String(c.contact_name || '').trim().toLowerCase() === name.toLowerCase())
    const money = c => Number(c.outstanding_receivable_amount || 0) !== 0 || Number(c.unused_credits_receivable_amount || 0) !== 0
    const keep = exact.filter(money)
    const candidates = exact.filter(c => !money(c)).sort((a, b) => String(a.created_time).localeCompare(String(b.created_time)))
    // If NOTHING carries money, keep the oldest one so the name survives —
    // unless keep_one=0 (the real customer lives under another name).
    const keepOne = String(req.body?.keep_one ?? '1') !== '0'
    if (!keep.length && candidates.length && keepOne) keep.push(candidates.shift())
    const out = { name, matched: exact.length, keep: keep.map(c => ({ id: c.contact_id, created: c.created_time, outstanding: c.outstanding_receivable_amount })), to_delete: candidates.length, dry, deleted: 0, refused: [] }
    if (!dry) {
      const t0 = Date.now()
      for (const c of candidates.slice(0, limit)) {
        if (Date.now() - t0 > 22000) break
        const d = await axios.delete(`https://www.zohoapis.com/books/v3/contacts/${c.contact_id}`, { ...H, params: { organization_id: org } })
        if (d.data?.code === 0) out.deleted++
        else if (d.status === 429 || /rate|too many/i.test(String(d.data?.message))) { out.rate_limited = true; break }
        else out.refused.push({ id: c.contact_id, msg: d.data?.message })
        await new Promise(r => setTimeout(r, 650))   // Books allows ~100 req/min
      }
      out.remaining = candidates.length - out.deleted - out.refused.length
      console.log(`[dedupe-contacts] "${name}": deleted ${out.deleted}, refused ${out.refused.length}, remaining ${out.remaining}`)
    }
    res.json(out)
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// ── Zoho CRM side of the same mess (Mark 2026-09-09 "saying the word") ──
// Every broken sync run created a Lead → converted it → Account (+ a
// Contact). Dedupe by exact name: keep the OLDEST Lead and Account (and
// the Contacts on that Account), delete the rest. CRM deletes go to the
// recycle bin (recoverable for 60 days). dry=1 default.
const CRM_API = 'https://www.zohoapis.com/crm/v6'
async function crmListRecent(token, module, fields, sinceISO) {
  const out = []
  for (let page = 1; page <= 10; page++) {
    const r = await axios.get(`${CRM_API}/${module}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 20000, validateStatus: st => st < 500,
      params: { fields, page, per_page: 200, sort_by: 'Created_Time', sort_order: 'desc' },
    })
    if (r.status === 204) break
    if (r.status !== 200) throw new Error(`CRM ${module} list ${r.status}: ${r.data?.message || ''}`)
    const rows = r.data?.data || []
    out.push(...rows)
    const last = rows[rows.length - 1]?.Created_Time || ''
    if (!r.data?.info?.more_records || (sinceISO && last && last < sinceISO)) break
  }
  return out
}
router.get('/crm-scope', async (req, res) => {
  try {
    const p = new URLSearchParams({
      grant_type: 'refresh_token', client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET, refresh_token: process.env.ZOHO_CRM_REFRESH_TOKEN || '',
    })
    const t = await axios.post('https://accounts.zoho.com/oauth/v2/token', p.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 12000, validateStatus: s => s < 500,
    })
    res.json({ ok: true, scope: String(t.data?.scope || t.data?.error || '') })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/dedupe-crm', async (req, res) => {
  try {
    if (!ownerOrSecret(req)) return res.status(403).json({ error: 'Owner only.' })
    const name = String(req.body?.name || '').trim()
    const dry = String(req.body?.dry ?? '1') !== '0'
    const since = String(req.body?.since || '2026-08-01')
    if (!name) return res.status(400).json({ error: 'name required' })
    const { getCrmAccessToken } = await import('../services/zohoCrm.js')
    const token = await getCrmAccessToken()
    const same = v => String(v || '').trim().toLowerCase() === name.toLowerCase()
    const byOldest = (a, b) => String(a.Created_Time).localeCompare(String(b.Created_Time))

    const leads = (await crmListRecent(token, 'Leads', 'id,Company,Lead_Status,Created_Time', since)).filter(l => same(l.Company)).sort(byOldest)
    const accounts = (await crmListRecent(token, 'Accounts', 'id,Account_Name,Created_Time', since)).filter(a => same(a.Account_Name)).sort(byOldest)
    const keepAccount = accounts[0] || null
    const contacts = (await crmListRecent(token, 'Contacts', 'id,Full_Name,Account_Name,Created_Time', since))
      .filter(c => same(c.Account_Name?.name)).sort(byOldest)
    const delLeads = leads.slice(1), delAccounts = accounts.slice(1)
    const delContacts = contacts.filter(c => !keepAccount || String(c.Account_Name?.id) !== String(keepAccount.id))

    const out = {
      name, dry, since,
      leads: { matched: leads.length, keep: leads[0]?.id || null, to_delete: delLeads.length },
      accounts: { matched: accounts.length, keep: keepAccount?.id || null, to_delete: delAccounts.length },
      contacts: { matched: contacts.length, to_delete: delContacts.length },
      deleted: { Leads: 0, Accounts: 0, Contacts: 0 }, errors: [],
    }
    if (!dry) {
      const t0 = Date.now()
      for (const [module, rows] of [['Contacts', delContacts], ['Accounts', delAccounts], ['Leads', delLeads]]) {
        for (let i = 0; i < rows.length; i += 100) {
          if (Date.now() - t0 > 22000) { out.partial = true; break }
          const ids = rows.slice(i, i + 100).map(r => r.id).join(',')
          const d = await axios.delete(`${CRM_API}/${module}`, {
            headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 20000, validateStatus: st => st < 500,
            params: { ids, wf_trigger: 'false' },
          })
          const okCount = (d.data?.data || []).filter(x => x.code === 'SUCCESS').length
          out.deleted[module] += okCount
          if (d.status !== 200) out.errors.push(`${module}: ${d.status} ${d.data?.message || ''}`)
          await new Promise(r => setTimeout(r, 1000))
        }
      }
      console.log(`[dedupe-crm] "${name}":`, JSON.stringify(out.deleted), out.errors.join(' | '))
    }
    res.json(out)
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// Owner/secret: one Books contact's origin fields (who/what created it).
router.get('/books-contact/:id', async (req, res) => {
  try {
    if (!ownerOrSecret(req)) return res.status(403).json({ error: 'Owner only.' })
    const { getAccessToken } = await import('../services/zoho.js')
    const token = await getAccessToken()
    const r = await axios.get(`https://www.zohoapis.com/books/v3/contacts/${req.params.id}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { organization_id: process.env.ZOHO_ORGANIZATION_ID }, timeout: 15000, validateStatus: st => st < 500,
    })
    const c = r.data?.contact || {}
    const pick = ['contact_id', 'contact_name', 'company_name', 'source', 'created_time', 'created_by_name', 'last_modified_time', 'zcrm_account_id', 'zcrm_contact_id', 'crm_owner_id', 'is_crm_customer', 'is_linked_with_zohocrm', 'outstanding_receivable_amount', 'status', 'email', 'phone', 'customer_sub_type']
    res.json(Object.fromEntries(pick.filter(k => c[k] !== undefined).map(k => [k, c[k]])))
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// Cliq health (Mark 2026-09-09): granted scopes + a one-line test post
// to Mark's alert channel. Owner/secret only.
router.get('/cliq-scope', async (req, res) => {
  try {
    const rt = process.env.ZOHO_CLIQ_REFRESH_TOKEN || process.env.ZOHO_TASKS_REFRESH_TOKEN || process.env.ZOHO_REFRESH_TOKEN || ''
    const which = process.env.ZOHO_CLIQ_REFRESH_TOKEN ? 'ZOHO_CLIQ_REFRESH_TOKEN' : process.env.ZOHO_TASKS_REFRESH_TOKEN ? 'ZOHO_TASKS_REFRESH_TOKEN' : 'ZOHO_REFRESH_TOKEN'
    const p = new URLSearchParams({ grant_type: 'refresh_token', client_id: process.env.ZOHO_CLIENT_ID, client_secret: process.env.ZOHO_CLIENT_SECRET, refresh_token: rt })
    const t = await axios.post('https://accounts.zoho.com/oauth/v2/token', p.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 12000, validateStatus: s => s < 500 })
    res.json({ ok: true, env_var: which, scope: String(t.data?.scope || t.data?.error || '') })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/cliq-test', async (req, res) => {
  try {
    if (!ownerOrSecret(req)) return res.status(403).json({ error: 'Owner only.' })
    const { postToCliqChannelById, postToCliqChannel, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
    const msg = String(req.body?.msg || `🧪 Cliq test from the app · ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}`)
    const channel = String(req.body?.channel || '').trim()   // unique name, e.g. salesmarketing
    const t0 = Date.now()
    if (channel) await postToCliqChannel(channel, msg)
    else await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg)
    res.json({ ok: true, ms: Date.now() - t0, channel: channel || 'mark-alerts' })
  } catch (e) { res.status(500).json({ ok: false, error: e.message, status: e.response?.status, data: e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : null }) }
})

router.get('/', async (req, res) => {
  try {
    const [map, catalog] = await Promise.all([
      readItemMap(req),
      getItemCatalogForAudit().catch(e => {
        console.warn('[item-map] catalog fetch failed:', e.message)
        return { allItems: [] }
      }),
    ])
    // Diagnostic: AppConfig total rows. Full-table scans cap at 20k —
    // if this number approaches that, card notes / tech to-dos / push
    // subs need the same index-row treatment this map now uses.
    let table_rows = null
    try {
      const catalystMod = (await import('zcatalyst-sdk-node')).default
      const app = catalystMod.initialize(req, { type: 'advancedio' })
      const r = await app.zcql().executeZCQLQuery('SELECT COUNT(ROWID) FROM AppConfig')
      const row = r?.[0]?.AppConfig || r?.[0] || {}
      table_rows = Number(Object.values(row)[0]) || null
    } catch { /* diagnostic only */ }

    res.json({
      ok: true,
      map,
      books_items: (catalog.allItems || []).sort((a, b) => a.name.localeCompare(b.name)),
      vocab: KINETIC_SENSOR_VOCAB,
      table_rows,
    })
  } catch (err) {
    console.error('[item-map GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.put('/', async (req, res) => {
  try {
    const { kinetic_name, item_name, item_id } = req.body || {}
    if (!kinetic_name || !item_name) {
      return res.status(400).json({ error: 'kinetic_name and item_name required' })
    }
    await upsertMapping(req, kinetic_name, { item_name, item_id: item_id || '', source: 'manual' })
    res.json({ ok: true, key: normalizeMapKey(kinetic_name) })
  } catch (err) {
    console.error('[item-map PUT]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/delete', async (req, res) => {
  try {
    const { kinetic_name } = req.body || {}
    if (!kinetic_name) return res.status(400).json({ error: 'kinetic_name required' })
    const removed = await deleteMapping(req, kinetic_name)
    res.json({ ok: true, removed })
  } catch (err) {
    console.error('[item-map delete]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Seed: Claude proposes a Books item for every vocab entry that isn't
// mapped yet. Existing mappings are never overwritten.
// ── Pricing Brain (Mark 2026-08-29 fix #1): learned insurer tiers ──────
router.get('/tiers', async (req, res) => {
  try {
    const { readTierMap } = await import('../services/tierMap.js')
    const map = await readTierMap(req)
    const entries = Object.entries(map).map(([key, item]) => {
      const [pool, make, cal] = key.split('|')
      return { key, pool, make, calibration: cal, item }
    }).sort((a, z) => (a.pool + a.make + a.calibration).localeCompare(z.pool + z.make + z.calibration))
    res.json({ ok: true, entries })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/tiers/delete', async (req, res) => {
  try {
    if (req.user?.role === 'technician') return res.status(403).json({ error: 'Staff only' })
    const key = String(req.body?.key || '')
    if (!key) return res.status(400).json({ error: 'key required' })
    const { deleteTierMapping } = await import('../services/tierMap.js')
    res.json({ ok: true, ...(await deleteTierMapping(req, key)) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/seed', async (req, res) => {
  try {
    const [map, catalog] = await Promise.all([readItemMap(req), getItemCatalogForAudit()])
    const unmapped = KINETIC_SENSOR_VOCAB.filter(n => !map[normalizeMapKey(n)])
    if (unmapped.length === 0) {
      return res.json({ ok: true, seeded: 0, message: 'Everything already mapped' })
    }
    const { proposeItemMap } = await import('../services/claude.js')
    const proposals = await proposeItemMap({
      kineticNames: unmapped,
      catalogItems: catalog.allItems || [],
    })
    let seeded = 0
    const skipped = []
    for (const p of proposals) {
      if (p?.kinetic_name && p.item_name && p.item_id) {
        await upsertMapping(req, p.kinetic_name, {
          item_name: p.item_name, item_id: p.item_id, source: 'seed',
        })
        seeded++
      } else if (p?.kinetic_name) {
        skipped.push(p.kinetic_name)
      }
    }
    res.json({ ok: true, seeded, skipped })
  } catch (err) {
    console.error('[item-map seed]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export { router as itemMapRouter }
