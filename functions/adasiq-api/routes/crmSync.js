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


// POST /api/crm-sync-cron/customers?dry=1 — Books customers → CRM shops
// (Mark 2026-09-22). Same secret as the rest of this router. Additive only.
router.post('/customers', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  const provided = String(req.headers['x-cron-secret'] || req.headers['x_cron_secret'] || '').trim()
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { syncCustomersFromBooks } = await import('./shops.js')
    res.json(await syncCustomersFromBooks(req, { dry: req.query.dry === '1' }))
  } catch (err) { console.error('[crm-sync-cron customers]', err.message); res.status(500).json({ error: err.message }) }
})

// POST /api/crm-sync-cron/zoho-payments — run the Zoho Payments sweep now (cron secret).
router.post('/zoho-payments', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { sweepZohoPayments } = await import('../services/zohoPayments.js'); res.json(await sweepZohoPayments(req)) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/crm-sync-cron/group-texting — make sure the 425's group texting is on (cron secret).
router.post('/group-texting', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { keepGroupTextingOn } = await import('./sms.js'); res.json(await keepGroupTextingOn(req)) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/crm-sync-cron/a2p-resubmit?dry=1 — resubmit the 425's A2P campaign (cron secret; Mark's go 2026-09-23).
router.post('/a2p-resubmit', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { resolvePhoneConfig } = await import('../services/phoneConfig.js'); const cfg = await resolvePhoneConfig(req)
    const { resubmitA2p } = await import('../services/conversations.js')
    res.json({ ok: true, ...(await resubmitA2p(cfg, { dry: req.query.dry === '1' })) })
  } catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})

// POST /api/crm-sync-cron/email-to-job?dry=1 — run the email → job sweep now (cron secret).
router.post('/email-to-job', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { sweepEmailToJob } = await import('../services/emailToJob.js'); res.json(await sweepEmailToJob(req, { dry: req.query.dry === '1' })) }
  catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})

// 📧 Email intake (2026-09-24) — every 15 min from GitHub Actions + the Zoho Mail webhook.
// POST /api/crm-sync-cron/email-intake?dry=1 — stage A (sweep) then one stage B (scrub) if there is time.
router.post('/email-intake', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { sweepEmailToJob, runScrubQueue } = await import('../services/emailToJob.js')
    const t0 = Date.now()
    const sweep = await sweepEmailToJob(req, { dry: req.query.dry === '1' })
    let scrub = null
    if (req.query.dry !== '1' && Date.now() - t0 < 4000) scrub = await runScrubQueue(req, { max: 1 })
    res.json({ sweep, scrub })
  } catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})
// POST /api/crm-sync-cron/email-scrub — stage B only: scrub one queued estimate (call until left = 0).
router.post('/email-scrub', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { runScrubQueue } = await import('../services/emailToJob.js'); res.json(await runScrubQueue(req, { max: Number(req.query.max) || 1 })) }
  catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})
// POST /api/crm-sync-cron/email-scrub/requeue?job=<id> — scrub a card's newest folder PDF again.
router.post('/email-scrub/requeue', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { requeueScrub } = await import('../services/emailToJob.js'); res.json(await requeueScrub(req, req.query.job)) }
  catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})
// POST /api/crm-sync-cron/email-scrub/unscrub?job=<id> — remove our scrub from a card.
router.post('/email-scrub/unscrub', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { unscrubCard } = await import('../services/emailToJob.js'); res.json(await unscrubCard(req, req.query.job)) }
  catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})
// POST /api/crm-sync-cron/email-scrub/upload?job=<id>&name=<file.pdf> — raw PDF body → the car's WorkDrive folder
// (Kinetic ID report hand-off, 2026-09-24). Stamps the card: report_url + a 📄 note.
router.post('/email-scrub/upload', express.raw({ type: 'application/pdf', limit: '25mb' }), async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const buf = Buffer.isBuffer(req.body) ? req.body : null
    if (!buf || buf.length < 512) return res.status(400).json({ error: 'no PDF body' })
    const J = await import('./jobs.js'); const job = (await J.readJobsPublic(req)).find(j => String(j.id) === String(req.query.job || ''))
    if (!job) return res.status(404).json({ error: 'card not found' })
    const { getAccessToken } = await import('../services/zoho.js'); const { uploadFileToFolder } = await import('../services/workdrive.js')
    const wdToken = await getAccessToken(); const folderId = await J.resolveJobFolderPublic(req, job, wdToken)
    if (!folderId) return res.status(500).json({ error: 'no WorkDrive folder' })
    const name = String(req.query.name || 'Kinetic report.pdf').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120)
    const { fileId } = await uploadFileToFolder(folderId, name, buf, wdToken, 'application/pdf')
    const patch = { ...job, notes: `📄 ${name} filed to the job folder (Kinetic ID)\n${job.notes || ''}`.slice(0, 9000) }
    if (!job.folder_url) patch.folder_url = `https://workdrive.zoho.com/folder/${folderId}`
    const upd = await J.updateJobPublic(req, job.id, patch)
    res.json({ ok: true, fileId, folderId, name, job: upd.id })
  } catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})
// GET /api/crm-sync-cron/email-scrub/pdf?file=<id> — stream a job-folder PDF (for the Kinetic ID hand-off).
router.get('/email-scrub/pdf', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { getAccessToken } = await import('../services/zoho.js'); const { downloadFile } = await import('../services/workdrive.js'); const { buffer } = await downloadFile(String(req.query.file || ''), await getAccessToken()); res.setHeader('Content-Type', 'application/pdf'); res.send(buffer) }
  catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})
// GET /api/crm-sync-cron/email-scrub/probe?file=<id> — can the server pull this WorkDrive file? (bytes + head)
router.get('/email-scrub/probe', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { getAccessToken } = await import('../services/zoho.js'); const { downloadFile } = await import('../services/workdrive.js'); const { buffer, contentType } = await downloadFile(String(req.query.file || ''), await getAccessToken()); res.json({ ok: true, bytes: buffer.length, contentType, head: buffer.slice(0, 8).toString('latin1') }) }
  catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})
// POST /api/crm-sync-cron/email-intake/unblock?sender=<email> — take a sender off the suppress list.
router.post('/email-intake/unblock', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { removeSuppressed } = await import('../services/emailToJob.js'); res.json({ suppress: await removeSuppressed(req, req.query.sender) }) }
  catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})
// POST /api/crm-sync-cron/email-intake/config?key=email2job_scrub&value=true — flip an intake switch (whitelisted keys).
router.post('/email-intake/config', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  const key = String(req.query.key || ''); const value = String(req.query.value ?? '')
  if (!['email2job_scrub', 'email2job_enabled', 'email2job_inboxes', 'adasmaps_sender_domain'].includes(key)) return res.status(400).json({ error: 'key not allowed' })
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const rows = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = '${key}' LIMIT 1`)
    const row = rows?.[0]?.AppConfig?.ROWID; const t = app.datastore().table('AppConfig')
    if (row) await t.updateRow({ ROWID: String(row), config_key: key, config_value: value }); else await t.insertRow({ config_key: key, config_value: value })
    res.json({ ok: true, key, value })
  } catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})
// POST /api/crm-sync-cron/attach-report?job=<id> — attach the job folder's Kinetic report to its Books quote + invoice (backfill / retry).
router.post('/attach-report', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const J = await import('./jobs.js'); const job = (await J.readJobsPublic(req)).find(j => String(j.id) === String(req.query.job || ''))
    if (!job) return res.status(404).json({ error: 'card not found' })
    const { getAccessToken, getInvoiceByNumber } = await import('../services/zoho.js'); const { attachJobReports, findJobReportPdfs } = await import('../services/reportAttach.js')
    const token = await getAccessToken()
    const targets = []
    if (job.zoho_estimate_id) targets.push({ kind: 'estimates', id: job.zoho_estimate_id })
    if (job.zoho_invoice_id) targets.push({ kind: 'invoices', id: job.zoho_invoice_id })
    else if (job.invoice_number) { try { const inv = await getInvoiceByNumber(job.invoice_number); if (inv?.invoice_id) targets.push({ kind: 'invoices', id: inv.invoice_id }) } catch (e) { console.log('[attach-report] invoice lookup failed:', e.message) } }
    if (req.query.dry === '1') return res.json({ dry: true, targets, files: await findJobReportPdfs(req, job) })
    if (!targets.length) return res.status(400).json({ error: 'no Books quote or invoice on this card' })
    res.json({ ok: true, targets, ...(await attachJobReports(req, token, job, targets)) })
  } catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})
// GET /api/crm-sync-cron/email-intake/status — what was skipped, what is queued, which inboxes.
router.get('/email-intake/status', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const E = await import('../services/emailToJob.js'); res.json({ ...(await E.mailboxStatus(req)), suppress: await E.readSuppressedList(req), queue: await E.scrubQueue(req), skipped: await E.readSkipped(req) }) }
  catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})

// POST /api/crm-sync-cron/sms-media-backup?limit=5 — copy texted pictures into WorkDrive (catch-up).
router.post('/sms-media-backup', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { backfillSmsMedia } = await import('../services/smsMediaBackup.js'); res.json(await backfillSmsMedia(req, { limit: Number(req.query.limit) || 5 })) }
  catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})

// 📋 OEM position statements — daily web scan (Mark 2026-09-24).
// dry=1 reports without writing. once=1 makes it a no-op after the first run of the PT day.
router.post('/position-statements', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { scanPositionStatements } = await import('../services/positionStatements.js'); res.json(await scanPositionStatements(req, { dry: req.query.dry === '1', onceADay: req.query.once === '1' })) }
  catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})
// POST /api/crm-sync-cron/position-statements/import-next — read one queued PDF into the library.
router.post('/position-statements/import-next', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { importNextPositionStatement } = await import('../services/positionStatements.js'); res.json(await importNextPositionStatement(req)) }
  catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})
// POST /api/crm-sync-cron/position-statements/backfill?limit=5&oem=Toyota — fill the library from the back catalogue.
router.post('/position-statements/backfill', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { backfillPositionStatements } = await import('../services/positionStatements.js'); res.json(await backfillPositionStatements(req, { limit: req.query.limit, oem: String(req.query.oem || '') })) }
  catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})
// GET /api/crm-sync-cron/position-statements/library — what's in the library today.
router.get('/position-statements/library', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery("SELECT ROWID, doc_oem, doc_type, doc_title, doc_published_date, doc_hosted_url, doc_source_url FROM AdasPositionStatements LIMIT 300")
    res.json({ ok: true, docs: (rows || []).map(r => r.AdasPositionStatements || r) })
  } catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})

// POST /api/crm-sync-cron/photos-reconcile — check every owed card against its WorkDrive folder now (cron secret).
router.post('/photos-reconcile', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const J = await import('./jobs.js')
    if (req.query.job) { const job = (await J.readJobsPublic(req)).find(j => String(j.id) === String(req.query.job)); if (!job) return res.status(404).json({ error: 'job not found' }); const r = await J.reconcilePhotosFromFolder(req, job, { notify: false }); return res.json({ ...r, job: undefined }) }
    res.json(await J.reconcileOwedPhotos(req))
  }
  catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})

export default router
