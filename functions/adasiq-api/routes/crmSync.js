import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { syncAllShopsToZohoCrm, createLead, updateLead, convertLead, findLeadByName } from '../services/zohoCrm.js'

const router = express.Router()
const TABLE_NAME = 'CRMShops'

function rowToShop(row) {
  const r = row.CRMShops || row
  function parse(val) { try { return JSON.parse(val) } catch { return val } }
  return {
    id: String(r.ROWID || ''),
    shop_name: r.shop_name || '',
    contact_name: r.contact_name || '',
    phone: r.phone || '',
    email: r.email || '',
    address: r.address || '',
    pipeline_stage: r.pipeline_stage || 'target',
    notes: r.notes || '',
    people: typeof r.people === 'string' ? parse(r.people) : (r.people || []),
    referral_source: r.referral_source || '',
  }
}

async function getAllShops(req) {
  let app
  try {
    app = catalyst.initialize(req, { type: 'advancedio' })
  } catch {
    app = catalyst.initialize(req)
  }
  const table = app.datastore().table(TABLE_NAME)
  const rows = await table.getAllRows()
  return (rows || []).map(rowToShop)
}

// POST /api/crm-sync/run — manual sync all shops to Zoho CRM
router.post('/run', async (req, res) => {
  try {
    const shops = await getAllShops(req)
    if (shops.length === 0) return res.json({ ok: true, message: 'No shops to sync', created: 0, updated: 0 })

    console.log(`[crm-sync] Starting sync of ${shops.length} shops to Zoho CRM`)
    const result = await syncAllShopsToZohoCrm(shops)
    console.log(`[crm-sync] Done:`, result)

    res.json({ ok: true, ...result, total: shops.length })
  } catch (err) {
    console.error('[crm-sync] Failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/crm-sync/cron — hourly cron endpoint (protected by secret)
router.get('/cron', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (req.headers['x-cron-secret'] !== secret) return res.status(401).json({ error: 'Unauthorized' })

  try {
    let shops = []
    try {
      shops = await getAllShops(req)
    } catch (dbErr) {
      console.error('[crm-sync cron] DB read failed:', dbErr.message, dbErr.statusCode)
      return res.status(500).json({ error: 'Failed to read shops: ' + dbErr.message })
    }

    if (shops.length === 0) return res.json({ ok: true, message: 'No shops to sync' })

    console.log(`[crm-sync cron] Syncing ${shops.length} shops`)
    const result = await syncAllShopsToZohoCrm(shops)
    console.log(`[crm-sync cron] Done:`, result)

    res.json({ ok: true, ...result, total: shops.length })
  } catch (err) {
    console.error('[crm-sync cron] Failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/crm-sync/shop/:id — sync a single shop to Zoho CRM
router.post('/shop/:id', async (req, res) => {
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const table = app.datastore().table(TABLE_NAME)
    const row = await table.getRow(String(req.params.id))
    const shop = rowToShop(row)

    const existing = await findLeadByName(shop.shop_name)
    let action = ''

    if (existing) {
      await updateLead(existing.id, shop)
      action = 'updated'

      if ((shop.pipeline_stage === 'active' || shop.pipeline_stage === 'second_active') && existing.Lead_Status !== 'Converted') {
        await convertLead(existing.id)
        action = 'converted'
      }
    } else {
      const leadId = await createLead(shop)
      action = 'created'

      if (shop.pipeline_stage === 'active' || shop.pipeline_stage === 'second_active') {
        await convertLead(leadId)
        action = 'converted'
      }
    }

    res.json({ ok: true, action, shop_name: shop.shop_name })
  } catch (err) {
    console.error('[crm-sync shop]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
