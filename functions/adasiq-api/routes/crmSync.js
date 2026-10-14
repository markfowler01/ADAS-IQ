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

// POST /api/crm-sync-cron/position-statements/upload — file one PDF from Mark's
// own OEM collection. multipart: file=<pdf>, folder=<OEM folder>, path=<label>.
const oemDocUpload = (await import('multer')).default({ storage: (await import('multer')).default.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }).single('file')
router.post('/position-statements/upload', (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  oemDocUpload(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'no file' })
    try {
      const P = await import('../services/positionStatements.js')
      const filename = String(req.body?.name || req.file.originalname || 'document.pdf')
      const known = await P.knownUrls(req)
      if (known.has(P.normUrl(filename))) return res.json({ skipped: 'already in the library', filename })
      const r = await P.importBuffer(req, { buffer: req.file.buffer, filename, oemHint: String(req.body?.folder || ''), sourceLabel: String(req.body?.path || `workdrive:${filename}`) })
      res.json({ ok: true, oem: r.row.doc_oem, title: r.row.doc_title, type: r.row.doc_type, published: r.row.doc_published_date })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
})

// GET /api/crm-sync-cron/wd-find?q=3111218046 — every WorkDrive folder matching
// a car, with how many images each holds. Read-only; for chasing "the photos
// are there but the card says they aren't".
router.get('/wd-find', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const q = String(req.query.q || '').trim()
    const folderId = String(req.query.folder || '').trim()
    if (!q && !folderId) return res.status(400).json({ error: 'q or folder required' })
    const axios = (await import('axios')).default
    const { getAccessToken } = await import('../services/zoho.js')
    const { listChildren } = await import('../services/workdrive.js')
    const token = await getAccessToken()
    const IMG0 = /\.(jpe?g|png|heic|heif|webp|gif)$/i
    if (folderId) {
      // Direct listing — the search index misses folders that plainly exist.
      const meta = await axios.get(`https://www.zohoapis.com/workdrive/api/v1/files/${folderId}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 20000, validateStatus: () => true })
      const a = meta.data?.data?.attributes || {}
      const kids = await listChildren(folderId, token)
      const parentId = a.parent_id || ''
      let siblings = []
      if (parentId && req.query.siblings === '1') { try { siblings = (await listChildren(parentId, token, { folders: true })).map(x => ({ id: x.id, name: x.name, files: x.files_count })) } catch { siblings = [] } }
      return res.json({ ok: true, folder: { id: folderId, name: a.name || a.display_name || '', parent_id: parentId, created: a.created_time }, files: kids.length, images: kids.filter(k => IMG0.test(k.name || '')).length, names: kids.map(k => k.name), siblings })
    }
    const r = await axios.get('https://www.zohoapis.com/workdrive/api/v1/files/search', {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { search_str: q, search_scope: 'team', type: 'folder' }, timeout: 20000, validateStatus: () => true,
    })
    const IMG = /\.(jpe?g|png|heic|heif|webp|gif)$/i
    const out = []
    for (const f of (r.data?.data || []).slice(0, 8)) {
      const id = f.id, name = f.attributes?.name || f.attributes?.display_name || ''
      let kids = []
      try { kids = await listChildren(id, token, { folders: false }) } catch (e) { out.push({ id, name, error: e.message }); continue }
      out.push({ id, name, files: kids.length, images: kids.filter(k => IMG.test(k.name || '')).length, sample: kids.slice(0, 12).map(k => k.name) })
    }
    res.json({ ok: true, q, folders: out })
  } catch (err) { res.status(500).json({ ok: false, error: err.message }) }
})

// GET /api/crm-sync-cron/who-gets-the-text?tech=Jayden — who a dispatch text would reach. Sends nothing.
router.get('/who-gets-the-text', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { whoGetsTheText } = await import('../services/techAssignText.js')
    const names = String(req.query.tech || 'Mark,Jayden,Jaden,Jayden Goshorn,Mark Fowler').split(',').map(x => x.trim()).filter(Boolean)
    res.json({ ok: true, checked: await Promise.all(names.map(n => whoGetsTheText(req, n))) })
  } catch (err) { res.status(500).json({ ok: false, error: err.message }) }
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
  try { const { scanPositionStatements } = await import('../services/positionStatements.js'); res.json(await scanPositionStatements(req, { dry: req.query.dry === '1', onceADay: req.query.once === '1', baseline: req.query.baseline === '1' })) }
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
// GET /api/crm-sync-cron/position-statements/reference?make=Ford — exactly what the scrubber is handed. Scrubs nothing.
router.get('/position-statements/reference', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { oemReferenceBlock } = await import('../services/positionStatements.js'); const block = await oemReferenceBlock(req, { make: String(req.query.make || '') }); res.json({ ok: true, chars: block.length, block }) }
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

// 📥 Scrub every PDF in a mailbox — backfill + ongoing (Mark 2026-09-28).
// Call repeatedly: each call scrubs one PDF and advances the cursor.
router.post('/mail-scrub', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const M = await import('../services/mailboxScrub.js')
    res.json(await M.runMailboxScrub(req, {
      inbox: String(req.query.inbox || 'ar@absoluteadas.com'),
      max: Math.min(Number(req.query.max) || 1, 5),
      via: String(req.query.via || ''),
      includeOwn: req.query.includeOwn === '1',
      depth: Math.min(Number(req.query.depth) || 0, 20000),
      dry: req.query.dry === '1',
    }))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /mail-scrub/status — can we read it, and how far has the backfill got?
router.get('/mail-scrub/status', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const M = await import('../services/mailboxScrub.js')
    const inbox = String(req.query.inbox || 'ar@absoluteadas.com')
    res.json({ ...(await M.mailboxReachable(req, inbox)), progress: await M.mailboxScrubStatus(req) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/mail-scrub/reset', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const M = await import('../services/mailboxScrub.js')
    res.json(await M.resetMailboxScrub(req, String(req.query.inbox || 'ar@absoluteadas.com')))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 📁 Scrub one PDF handed to us as a file — the Downloads-folder sweep
// (Mark 2026-09-28: "go through my downloads folder and scrub every CCC
// estimate you can find"). multipart: file=<pdf>, name=<original name>.
// Classifies first so a bank notice never costs an Opus call; skips files
// already in the library by name.
const scrubFileUpload = (await import('multer')).default({ storage: (await import('multer')).default.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }).single('file')
router.post('/scrub-file', (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  scrubFileUpload(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file || req.file.buffer.length < 512) return res.status(400).json({ error: 'no usable file' })
    const name = String(req.body?.name || req.file.originalname || 'file.pdf').slice(0, 255)
    try {
      const { hasScrubForFile } = await import('../services/scrubStore.js')
      // force=1 re-scrubs a file that is already in the library (benchmark
      // after a prompt change); the row lands under the source given, e.g.
      // "benchmark-v2", so the scorer can compare versions side by side.
      if (req.body?.force !== '1' && await hasScrubForFile(req, name)) return res.json({ skipped: 'already in the library', name })
      const { detectPdfKind } = await import('../services/claude.js')
      let kind = 'OTHER', make = ''
      let detectErr = ''
      try { ({ kind, make } = await detectPdfKind(req.file.buffer.toString('base64'))) } catch (e) { kind = 'OTHER'; detectErr = e.message }
      if (!['CCC', 'ESTIMATE'].includes(kind)) return res.json({ skipped: kind, name, ...(detectErr ? { error: detectErr.slice(0, 200) } : {}) })   // the reason, e.g. API credit   // estimates only; ABSOLUTE = our own report
      const { scrubPdfBuffer } = await import('./extract.js')
      const data = await scrubPdfBuffer(req, req.file.buffer, {
        learn: false, source: String(req.body?.source || 'downloads').slice(0, 30), by: 'Downloads sweep',
        file: { name }, pdfType: 'CCC', make,
        textMode: req.body?.mode !== 'pdf', effort: ['low', 'medium', 'high'].includes(req.body?.effort) ? req.body.effort : '',
      })
      res.json({ ok: true, kind, name, shop: data?.shop || '', vehicle: data?.vehicle || '', ro: data?.ro_number || '', required: (data?.calibrations || []).filter(c => c.enabled !== false).length, scrubId: data?._scrubId || '' })
    } catch (e) { res.status(500).json({ error: e.message, name }) }
  })
})

// 🔭 Source registry + discovery bot (Mark 2026-09-28). All cron-secret.
const srcOk = (req, res) => { const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'; if (String(req.headers['x-cron-secret'] || '').trim() !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false } return true }
router.get('/position-statements/sources', async (req, res) => {
  if (!srcOk(req, res)) return
  try { const S = await import('../services/statementSources.js'); const list = await S.listSources(req); res.json({ count: list.length, enabled: list.filter(s => s.enabled).length, sources: list }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/position-statements/sources/seed', async (req, res) => {
  if (!srcOk(req, res)) return
  try { const S = await import('../services/statementSources.js'); res.json(await S.seedSources(req, { verify: req.query.verify !== '0' })) } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/position-statements/sources/add', express.json(), async (req, res) => {
  if (!srcOk(req, res)) return
  try {
    const S = await import('../services/statementSources.js'); const b = req.body || {}
    if (!/^https?:/i.test(String(b.url || ''))) return res.status(400).json({ error: 'url required' })
    const v = await S.verifySource(b.url)
    const r = await S.addSource(req, { name: b.name || '', url: v.finalUrl || b.url, kind: b.kind || 'other', oem: b.oem || '', why: b.why || '' }, { by: String(b.by || 'Mark'), verifyNote: v.note, enabled: v.ok || b.force === true })
    res.json({ ...r, verify: v })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/position-statements/sources/toggle', async (req, res) => {
  if (!srcOk(req, res)) return
  try { const S = await import('../services/statementSources.js'); res.json(await S.setSourceEnabled(req, String(req.query.key || ''), req.query.on === '1', String(req.query.by || 'Mark'))) } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/position-statements/sources/check', async (req, res) => {
  if (!srcOk(req, res)) return
  try {
    const S = await import('../services/statementSources.js'); const P = await import('../services/positionStatements.js')
    const r = await S.checkSources(req, { parsers: { icar: P.fetchIcar, oem1stop: P.fetchOem1stop }, max: Math.min(Number(req.query.max) || 20, 60), only: String(req.query.key || '') })
    res.json({ checked: r.checked, due: r.due, items: r.items.length, errors: r.errors, ms: r.ms, sample: r.items.slice(0, 12).map(i => ({ src: i.source_key, title: i.title, published: i.published, pdf: i.is_pdf })) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/position-statements/sources/dedupe', async (req, res) => {
  if (!srcOk(req, res)) return
  try { const S = await import('../services/statementSources.js'); res.json(await S.dedupeSources(req)) } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/position-statements/sources/discover', async (req, res) => {
  if (!srcOk(req, res)) return
  try { const S = await import('../services/statementSources.js'); res.json(await S.discoverSources(req, { dry: req.query.dry === '1', maxAdds: Math.min(Number(req.query.max) || 15, 30) })) } catch (e) { res.status(500).json({ error: e.message }) }
})

// 🧪 Compact export of the scrub library for the Kinetic benchmark (Mark
// 2026-09-28: "work on this scrubber tonight and get it working better").
// One row per scrub with just the verdicts — scored locally against the
// Kinetic reports, never in the browser. Cron secret.
// 📂 WorkDrive helpers for bulk collection jobs run from the Mac (Mark
// 2026-09-30: "add in every CCC PDF … in this folder"). list → names + ids
// (folder=scrub-library resolves the estimate archive), file → raw bytes,
// upload → drop a file into any folder. Cron secret only.
const wdAuth = req => String(req.headers['x-cron-secret'] || '').trim() === (process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026')
async function wdFolder(token, id) {
  if (id !== 'scrub-library') return id
  const { listChildren, JOB_PARENT_FOLDER_ID } = await import('../services/workdrive.js')
  const kids = await listChildren(JOB_PARENT_FOLDER_ID, token, { folders: true })
  return kids.find(k => k.name === 'Scrub Library')?.id || ''
}
router.get('/wd/list', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const { listChildren } = await import('../services/workdrive.js')
    const folder = await wdFolder(token, String(req.query.folder || ''))
    if (!folder) return res.status(404).json({ error: 'folder not found' })
    const files = await listChildren(folder, token, { folders: false, max: 5000 })
    res.json({ folder, count: files.length, files: files.map(f => ({ id: f.id, name: f.name, size: f.size })) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/wd/file', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const { downloadFile } = await import('../services/workdrive.js')
    const { buffer, contentType } = await downloadFile(String(req.query.id || ''), token)
    res.set('Content-Type', contentType || 'application/pdf').send(buffer)
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/wd/upload', (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  scrubFileUpload(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'no file' })
    try {
      const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
      const { uploadFileToFolder } = await import('../services/workdrive.js')
      const name = String(req.body?.name || req.file.originalname || 'file.pdf').slice(0, 250)
      const r = await uploadFileToFolder(String(req.query.to || ''), name, req.file.buffer, token)
      res.json({ ok: true, name, id: r?.fileId || r?.id || null })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
})

// 📧 Mail side of the same collection job: every message with an attachment in
// a mailbox (all folders, via search), then one attachment's bytes.
// ?inbox=info@absoluteadas.com&start=1&limit=50
router.get('/mail/pdfs', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { resolveMailbox } = await import('../services/mailboxScrub.js')
    const { getMessageAttachments } = await import('../services/mail.js')
    const mb = await resolveMailbox(req, String(req.query.inbox || 'info@absoluteadas.com'))
    if (!mb.accountId) return res.status(404).json({ error: 'mailbox not visible to the mail token', accounts: mb.accounts })
    const axios = (await import('axios')).default
    const start = Math.max(1, Number(req.query.start) || 1), limit = Math.min(100, Number(req.query.limit) || 50)
    const r = await axios.get(`https://mail.zoho.com/api/accounts/${mb.accountId}/messages/search`, {
      headers: { Authorization: `Zoho-oauthtoken ${mb.token}`, Accept: 'application/json' },
      params: { searchKey: 'has:attachment', start, limit }, timeout: 20000,
    })
    const msgs = r.data?.data || []
    const out = []
    for (const m of msgs) {
      let atts = []
      try { atts = await getMessageAttachments(mb.token, mb.accountId, String(m.folderId || ''), String(m.messageId || '')) } catch { continue }
      for (const a of atts || []) if (/\.pdf$/i.test(a.attachmentName || '')) out.push({ folder: String(m.folderId || ''), msg: String(m.messageId || ''), att: String(a.attachmentId || ''), name: a.attachmentName, size: Number(a.attachmentSize || 0), from: m.fromAddress || '', subject: m.subject || '', date: m.receivedTime || m.sentDateInGMT || '' })
    }
    res.json({ start, messages: msgs.length, pdfs: out })
  } catch (e) { res.status(500).json({ error: e.response?.data?.data?.moreInfo || e.message }) }
})
router.get('/mail/att', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { resolveMailbox } = await import('../services/mailboxScrub.js')
    const { downloadAccountAttachment } = await import('../services/mail.js')
    const mb = await resolveMailbox(req, String(req.query.inbox || 'info@absoluteadas.com'))
    const buf = await downloadAccountAttachment(mb.token, mb.accountId, String(req.query.folder), String(req.query.msg), String(req.query.att))
    res.set('Content-Type', 'application/pdf').send(Buffer.isBuffer(buf) ? buf : Buffer.from(buf?.buffer || buf))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 🧾 Mark scrubs whose car was invoiced (Mark 2026-09-30: "all jobs that are
// invoiced that are in the scrub library — mark them invoiced"). A scrub is
// invoiced when (1) its linked job card is invoiced, (2) an invoiced job has
// the same 17-char VIN, or (3) an invoiced job or a Books invoice (not
// void/draft) carries the same RO (5+ chars). Stage only moves forward.
// ?dry=1 = counts + samples, no writes. Re-call until remaining = 0.
router.post('/scrubs/mark-invoiced', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  const t0 = Date.now(), dry = req.query.dry === '1'
  try {
    const { listScrubs, setScrubStageById } = await import('../services/scrubStore.js')
    const { readJobsPublic } = await import('./jobs.js')
    const { readAll } = await import('../services/zohoMirror.js')
    const norm = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const roOf = j => norm(j.quote_number) || norm((String(j.notes || '').match(/RO#?\s*([\w-]+)/i) || [])[1])
    const { scrubs } = await listScrubs(req, { limit: 3000, maxScan: 5000 })
    const jobs = await readJobsPublic(req)
    const done = j => j.invoiced === true || !!String(j.invoice_number || '').trim() || j.status === 'complete'
    const inv = jobs.filter(done)
    const byId = new Map(jobs.map(j => [String(j.id), j]))
    const byVin = new Map(inv.filter(j => norm(j.vin).length === 17).map(j => [norm(j.vin), j]))
    const byRo = new Map(inv.filter(j => roOf(j).length >= 5).map(j => [roOf(j), j]))
    let books = []
    try { books = (await readAll(req, 'inv')).filter(b => !['void', 'draft'].includes(String(b.status).toLowerCase())) } catch { books = [] }
    const matches = []
    for (const s of scrubs) {
      if (['invoiced', 'paid'].includes(s.stage)) continue
      let hit = null, why = ''
      const j = s.jobId && byId.get(String(s.jobId))
      if (j && done(j)) { hit = j.invoice_number || 'invoiced'; why = 'job card' }
      if (!hit && norm(s.vin).length === 17 && byVin.get(norm(s.vin))) { hit = byVin.get(norm(s.vin)).invoice_number || 'invoiced'; why = 'VIN' }
      const ro = norm(s.ro)
      if (!hit && ro.length >= 5 && byRo.get(ro)) { hit = byRo.get(ro).invoice_number || 'invoiced'; why = 'RO (job)' }
      // Whole-token match only — "10643" must not hit "210643" (dry run 2026-09-30).
      const toks = x => String(x || '').toUpperCase().split(/[^A-Z0-9]+/).map(t => t.replace(/^RO/, '')).filter(Boolean)
      if (!hit && ro.length >= 5) { const b = books.find(b => toks(b.reference_number).includes(ro) || toks(b.invoice_number).some(t => t === ro || t.replace(/\d$/, '') === ro)); if (b) { hit = b.invoice_number; why = `RO (Books ${b.status})` } }
      if (hit) matches.push({ id: s.id, ro: s.ro, vehicle: s.vehicle, vin: s.vin, stage: s.stage, invoice: hit, why })
    }
    const summary = { scrubs: scrubs.length, already: scrubs.filter(s => ['invoiced', 'paid'].includes(s.stage)).length, to_mark: matches.length, by: matches.reduce((a, m) => (a[m.why.split(' (')[0]] = (a[m.why.split(' (')[0]] || 0) + 1, a), {}), jobs_invoiced: inv.length, books_invoices: books.length }
    if (dry) return res.json({ dry: true, ...summary, sample: matches.slice(0, 15) })
    let marked = 0
    for (const m of matches) {
      if (Date.now() - t0 > 24000) break
      await setScrubStageById(req, m.id, 'invoiced', { invoiceNumber: m.invoice === 'invoiced' ? '' : m.invoice })
      marked++
    }
    res.json({ ...summary, marked, remaining: matches.length - marked })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 🔎 Debug: raw job rows by VIN / invoice / quote number (any status, deleted-from-board too).
// 🔗 Re-link a job card to its Books estimate by number (2026-10-01: ORBITA X7's
// card lost zoho_estimate_id on a later save). Restores estimate id, quote #,
// insurer, Y/M/M from the estimate. ?dry=1 shows what it would write.
router.all('/jobs/relink-estimate', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const axios = (await import('axios')).default
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const H = { Authorization: `Zoho-oauthtoken ${token}` }, P = { organization_id: process.env.ZOHO_ORGANIZATION_ID }
    const n = String(req.query.number || '')
    const el = await axios.get('https://www.zohoapis.com/books/v3/estimates', { headers: H, params: { ...P, estimate_number: n }, timeout: 15000 })
    const hit = (el.data?.estimates || []).find(e => e.estimate_number === n)
    if (!hit) return res.status(404).json({ error: `estimate ${n} not found` })
    const ed = await axios.get(`https://www.zohoapis.com/books/v3/estimates/${hit.estimate_id}`, { headers: H, params: P, timeout: 15000 })
    const est = ed.data?.estimate || {}
    const cf = l => (est.custom_fields || []).find(c => c.label === l)?.value || ''
    const jobId = String(req.query.job || '')
    const t = catalyst.initialize(req).datastore().table('Jobs')
    const cur = await t.getRow(jobId).catch(() => null)
    if (!cur) return res.status(404).json({ error: 'job not found (billed cards are removed after billing)' })
    const patch = { ROWID: jobId, zoho_estimate_id: String(est.estimate_id), quote_number: est.estimate_number }
    if (!cur.insurer && cf('Insurer')) patch.insurer = cf('Insurer')
    const ymm = [cf('Year'), cf('Make'), cf('Model')].filter(Boolean).join(' ')
    if (ymm) { patch.vehicle = ymm; patch.make = cf('Make') || cur.make; patch.model = cf('Model') || cur.model }
    if (req.query.dry === '1') return res.json({ dry: true, job: { id: jobId, shop: cur.shop_name, vin: cur.vin }, estimate: { id: est.estimate_id, number: est.estimate_number, customer: est.customer_name, total: est.total, status: est.status, vin: cf('VIN') }, patch })
    if (cf('VIN') && cur.vin && cf('VIN') !== cur.vin) return res.status(409).json({ error: 'VIN on the estimate does not match the job', estimate_vin: cf('VIN'), job_vin: cur.vin })
    await t.updateRow(patch)
    res.json({ ok: true, patch })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})
// 💵 Claude spend by feature, today or ?day=YYYYMMDD (aiSpend.js).
router.get('/ai-spend', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  const { spendDay } = await import('../services/aiSpend.js')
  res.json(await spendDay(req, String(req.query.day || '')))
})
// ⏱ Last 30 scrub timings (speed study 2026-10-02).
router.get('/scrub-timings', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try { const r = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery("SELECT config_value FROM AppConfig WHERE config_key = 'scrub_timings' LIMIT 1"); res.json(JSON.parse(r?.[0]?.AppConfig?.config_value || '[]')) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
// 📎 Which OEM docs a scrub cites and whether each file loads.
router.get('/report-docs', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { getScrub } = await import('../services/scrubStore.js'); const A = await import('../services/oemAttach.js')
    const s = await getScrub(req, String(req.query.scrub || '')); const cals = (s?.payload?.calibrations || []).map(c => ({ ...c }))
    const docs = await A.citedDocs(req, cals); const warns = []; const w = console.warn; console.warn = (...x) => { warns.push(x.join(' ')); w(...x) }
    let got = []; try { got = await A.fetchCited(req, docs, cals) } finally { console.warn = w }
    res.json({ cited: docs.map(d => ({ n: d.n, title: d.row.doc_title, src: d.row.doc_hosted_url || d.row.doc_source_url, cals: d.cals })), loaded: got.map(d => ({ n: d.n, title: d.row.doc_title, pages: d.pageTexts?.length })), warns })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// 🌐 The online-report link for a scrub (preview / support).
router.get('/report-link', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try { const R = await import('../services/publicReport.js'); res.json({ url: await R.reportUrl(req, String(req.query.scrub || '')) }) } catch (e) { res.status(500).json({ error: e.message }) }
})
// 🔎 CRM duplicate finder (Mark 2026-10-02: "I see 2 Showcases"). Read-only: groups
// shops whose names match once "auto / body / collision / rebuild / shop / inc / llc"
// are ignored, or share a phone / email / Books link. Nothing is merged here.
// Exact-twin auto-merge (Mark 2026-10-02 "auto merge exact twins"); ?dry=1 lists only.
router.post('/shops/merge-twins', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try { const M = await import('../services/shopMerge.js'); res.json(await M.mergeExactTwins(req, 'auto-merge (exact twins)', { dry: String(req.query.dry || '') === '1' })) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
// 📚 Books invoice mirror: how fresh is it, and refresh recent months (same pull the
// nightly job makes). 2026-10-03: the Customers view showed nobody invoiced in 60 days.
router.get('/books/mirror-status', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { readMeta } = await import('../services/zohoMirror.js')
    const z = catalyst.initialize(req, { type: 'advancedio' }).zcql()
    const months = {}
    const rows = await z.executeZCQLQuery("SELECT inv_month, COUNT(ROWID) FROM AdasInvoices GROUP BY inv_month")
    for (const r of rows || []) { const x = r.AdasInvoices || r; months[x.inv_month] = Number(x['COUNT(ROWID)'] ?? Object.values(x).find(v => /^\d+$/.test(String(v)))) }
    const mx = await z.executeZCQLQuery("SELECT MAX(inv_date) FROM AdasInvoices")
    const stamps = await z.executeZCQLQuery("SELECT config_key, config_value FROM AppConfig WHERE config_key LIKE 'zb_mirror:%' ORDER BY config_key DESC LIMIT 5")
    res.json({ meta: await readMeta(req), months, newest_invoice: Object.values((mx?.[0] || {}).AdasInvoices || mx?.[0] || {})[0] || null, nightly_stamps: (stamps || []).map(r => r.AppConfig || r) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/books/mirror-sync', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { syncMonths } = await import('../services/zohoMirror.js')
    const months = String(req.query.months || '').split(',').map(x => x.trim()).filter(x => /^\d{4}-\d{2}$/.test(x)).slice(0, 6)
    if (!months.length) return res.status(400).json({ error: 'months=YYYY-MM,YYYY-MM' })
    res.json(await syncMonths(req, months, { dryRun: req.query.dry === '1' }))
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})
router.post('/ops/clean-placeholder-dates', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  const ops = (await import('./ops.js')).default
  req.url = `/clean-placeholder-dates${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`
  return ops(req, res, () => res.status(404).json({ error: 'no route' }))
})
// Non-secret config knobs (whitelisted) — e.g. the Notion "Parked" database id.
router.post('/config/set', express.json(), async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const key = String(req.body?.key || ''), value = String(req.body?.value ?? '')
    if (!['notion_parked_db', 'huddle_tech_goals', 'huddle_playlist', 'huddle_meeting_link', 'huddle_channel', 'huddle_room_token', 'deals_channel'].includes(key)) return res.status(400).json({ error: 'key not allowed here' })
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const r = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = '${key}' LIMIT 1`)
    const row = r?.[0]?.AppConfig
    if (row) await app.datastore().table('AppConfig').updateRow({ ROWID: row.ROWID, config_value: value })
    else await app.datastore().table('AppConfig').insertRow({ config_key: key, config_value: value })
    res.json({ ok: true, key })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/parked/status', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const r = await app.zcql().executeZCQLQuery("SELECT config_key, config_value FROM AppConfig WHERE config_key = 'notion_token' OR config_key = 'notion_parked_db'")
    const cfg = Object.fromEntries((r || []).map(x => { const c = x.AppConfig || x; return [c.config_key, c.config_value] }))
    const { listParked } = await import('../services/parked.js')
    const items = await listParked(req)
    res.json({ token_env: !!process.env.NOTION_TOKEN, token_appconfig: !!cfg.notion_token, db: cfg.notion_parked_db || process.env.NOTION_PARKED_DB || '', store: items[0]?.notion || (items.length === 0 && (process.env.NOTION_TOKEN || cfg.notion_token) && (cfg.notion_parked_db || process.env.NOTION_PARKED_DB)) ? 'notion' : 'server', open: items.length })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/van-ops/due', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try { const V = await import('../services/vanOps.js'); res.json({ due: await V.vanOpsDue(req), brief: await V.vanOpsForBrief(req) }) } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/van-ops/remind', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try { const V = await import('../services/vanOps.js'); res.json(await V.maybeVanOpsReminders(req)) } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/shops/customers', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const C = await import('../services/customers.js')
    if (req.query.debug) return res.json(await C.debugCustomer(req, String(req.query.debug)))
    res.json(await C.customerReport(req))
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// 🛠 Fix one CRM row from the shell (Mark 2026-10-05, Carstar at 272nd was invisible):
// name / stage / type only, on Mark's explicit go. Stage change stamps stage_changed_at.
router.post('/shops/set', express.json(), async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { getAllShops, updateShop } = await import('./shops.js')
    const id = String(req.body?.id || ''); const cur = (await getAllShops(req)).find(s => String(s.id) === id)
    if (!cur) return res.status(404).json({ error: 'no such shop' })
    const patch = {}
    if (req.body.shop_name) patch.shop_name = String(req.body.shop_name).slice(0, 120)
    if (req.body.pipeline_stage) { patch.pipeline_stage = String(req.body.pipeline_stage); if (patch.pipeline_stage !== cur.pipeline_stage) patch.stage_changed_at = new Date().toISOString() }
    if (req.body.customer_type) { let br = cur.billing_rules || {}; if (typeof br === 'string') { try { br = JSON.parse(br) } catch { br = {} } } patch.billing_rules = { ...br, customer_type: String(req.body.customer_type) } }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to set' })
    const updated = await updateShop(req, id, { ...cur, ...patch })
    res.json({ ok: true, before: { name: cur.shop_name, stage: cur.pipeline_stage }, after: { name: updated.shop_name, stage: updated.pipeline_stage, type: patch.billing_rules?.customer_type || '' } })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// 🧪 Recent scrubs incl. benchmark runs (Mark 2026-10-05 "rerun this"): the
// required list per row, so an accuracy test can be read from the shell.
router.get('/scrubs/recent', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { listScrubs, getScrub } = await import('../services/scrubStore.js')
    const src = String(req.query.source || ''), limit = Math.min(Number(req.query.limit) || 5, 30)
    const r = await listScrubs(req, { q: String(req.query.q || ''), limit: 200, includeBench: true })
    const rows = (r?.scrubs || r?.rows || r || []).filter(x => !src || String(x.source || x.scrub_source || '').startsWith(src)).slice(0, limit)
    const out = []
    for (const x of rows) {
      const full = req.query.full ? await getScrub(req, x.id || x.ROWID) : null
      out.push({ id: x.id || x.ROWID, at: x.at || x.scrub_at, source: x.source || x.scrub_source, vehicle: x.vehicle || x.scrub_vehicle, ro: x.ro || x.scrub_ro, required: x.required_names || x.scrub_required_names || '', status: x.status || x.scrub_status,
        ...(full ? { calibrations: (full.payload?.calibrations || []).map(c => ({ name: c.calibration_name, type: c.cal_type, enabled: c.enabled !== false, lines: c.line_references || '', guard: c._guard || '' })) } : {}) })
    }
    res.json({ count: out.length, scrubs: out })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// ☎️ Phone Setup from the shell on Mark's explicit go (2026-10-05: Kat's +63 number
// into the ring cascade). Only the two cascade keys; everything else stays in the UI.
router.post('/phone/set', express.json(), async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const key = String(req.body?.key || ''), value = String(req.body?.value ?? '').trim()
    if (!['KAT_PHONE_NUMBER', 'CASCADE_ORDER', 'JAYDEN_PHONE_NUMBER', 'MARK_PHONE_NUMBER', 'SHOP_LAT', 'SHOP_LNG', 'CLOCK_IN_GEOFENCE_MI', 'AFTER_HOURS_START', 'AFTER_HOURS_END'].includes(key)) return res.status(400).json({ error: 'key not allowed here' })
    const P = await import('../services/phoneConfig.js')
    const next = await P.setPhoneConfigValue(req, key, value)
    res.json({ ok: true, key, value, cascade: next.CASCADE_ORDER || '', kat: next.KAT_PHONE_NUMBER || '' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// 📞 Live-call debug (2026-10-05): what the transfer bar would show, raw.
router.get('/voice/live', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try { const L = await import('../services/liveCalls.js'); res.json({ live: await L.listLive(req), events: (await L.recentEvents(req)).slice(-20) }) } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/phone/get', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const P = await import('../services/phoneConfig.js'); const cfg = await P.resolvePhoneConfig(req)
    const keys = ['CASCADE_ORDER', 'KAT_PHONE_NUMBER', 'MARK_PHONE_NUMBER', 'JAYDEN_PHONE_NUMBER', 'SHOP_LAT', 'SHOP_LNG', 'SERVICE_RADIUS_MI', 'CLOCK_IN_GEOFENCE_MI', 'AFTER_HOURS_START', 'AFTER_HOURS_END', 'DESK_PHONE_ON']
    res.json(Object.fromEntries(keys.map(k => [k, cfg[k] ?? ''])))
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/jobs/find', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const J = await import('./jobs.js'); const q = String(req.query.q || '').toLowerCase()
    const all = await J.readJobsPublic(req)
    const hits = all.filter(j => [j.invoice_number, j.quote_number, j.vin, j.shop_name, j.vehicle, j.id].some(v => String(v || '').toLowerCase().includes(q))).slice(0, 10)
    res.json({ count: hits.length, jobs: hits.map(j => ({ id: j.id, shop: j.shop_name, vehicle: j.vehicle, vin: j.vin, status: j.status, invoice: j.invoice_number, quote: j.quote_number, scheduled: j.scheduled_date, technician: j.technician, created: j.created_at, notes: String(j.notes || '').slice(0, 200) })) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/jobs/set-vin', express.json(), async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const J = await import('./jobs.js'); const id = String(req.body?.id || ''), vin = String(req.body?.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (vin.length !== 17) return res.status(400).json({ error: 'vin must be 17 chars' })
    const job = (await J.readJobsPublic(req)).find(j => String(j.id) === id); if (!job) return res.status(404).json({ error: 'job not found' })
    const upd = await J.updateJobPublic(req, id, { ...job, vin, notes: `🔧 VIN corrected ${job.vin || '(blank)'} → ${vin} by Claude 2026-10-06 (report went out on the wrong car)\n${job.notes || ''}`.slice(0, 9000) })
    res.json({ ok: true, id, before: job.vin, after: upd.vin })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// 💼 Deals automations (2026-10-08): 6 AM due list → Cliq (+ Ada reads /api/deals/due), daily sweep.
router.post('/deals/morning', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const D = await import('../services/deals.js'); const l = await D.dueList(req)
    const { postToCliqChannel } = await import('../services/cliq.js')
    const ch = (await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery("SELECT config_value FROM AppConfig WHERE config_key = 'deals_channel' LIMIT 1"))?.[0]?.AppConfig?.config_value || 'technicians'
    if (l.open) await postToCliqChannel(ch, D.formatDue(l))
    res.json({ ok: true, posted: !!l.open, channel: ch, due: l.due.length, overdue: l.overdue.length })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// 💼 Sales block nudge (Mark: Tue/Wed/Thu 08:00–12:00): push to Mark "Sales block — tap to start" with the queue size; launchd fires it at 08:00.
router.post('/deals/sales-block', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const D = await import('../services/deals.js'); const qd = await D.salesQueue(req, { owner: 'Mark' })
    const { sendPushToAll } = await import('./push.js')
    const r = await sendPushToAll(req, { title: '💼 Sales block — tap to start', body: `${qd.count} in your queue · ${qd.totals.overdue} overdue · ${qd.totals.today} due today · ${qd.totals.nearby} near today's jobs`, url: '/app/index.html?sales=1', tag: 'sales-block' }, s => /mark|mf@/i.test(String(s.user || '')))
    res.json({ ok: true, queue: qd.count, pushed: r.sent })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/deals/sweep', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try { const D = await import('../services/deals.js'); res.json({ ok: true, ...(await D.dailySweep(req)) }) } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/shops/duplicates', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { findShopDuplicates } = await import('../services/shopDupes.js')
    const d = await findShopDuplicates(req); const q = String(req.query.q || '').toLowerCase()
    res.json(q ? { ...d, groups: d.groups.filter(g => g.shops.some(s => s.name.toLowerCase().includes(q))) } : d)
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/quote-audit', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const app = (await import('zcatalyst-sdk-node')).default.initialize(req, { type: 'advancedio' })
    const r = await app.zcql().executeZCQLQuery("SELECT config_value FROM AppConfig WHERE config_key = 'quote_audit' LIMIT 1")
    res.json(JSON.parse(r?.[0]?.AppConfig?.config_value || '[]').slice(0, Number(req.query.n) || 20))
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/jobs/find', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const q = v => String(v || '').replace(/'/g, "''")
    const w = []
    if (req.query.vin) w.push(`vin = '${q(req.query.vin)}'`)
    if (req.query.invoice) w.push(`invoice_number = '${q(req.query.invoice)}'`)
    if (req.query.quote) w.push(`quote_number = '${q(req.query.quote)}'`)
    if (!w.length) return res.status(400).json({ error: 'vin | invoice | quote' })
    const rows = await catalyst.initialize(req).zcql().executeZCQLQuery(`SELECT ROWID, CREATEDTIME, MODIFIEDTIME, shop_name, vehicle, vin, status, quote_number, invoice_number, folder_url, report_url FROM Jobs WHERE ${w.join(' OR ')} LIMIT 50`)
    res.json(rows.map(r => r.Jobs || r))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 🔎 Audit: Books invoices/estimates whose attached reports don't name that
// car (2026-09-30: an Audi's reports went out on invoice ABS 20656). Read-only.
// ?days=10&kind=invoices|estimates
router.get('/books/attach-audit', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  const t0 = Date.now()
  try {
    const axios = (await import('axios')).default
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const { belongsToJob } = await import('../services/reportAttach.js')
    const kind = req.query.kind === 'estimates' ? 'estimates' : 'invoices'
    const since = new Date(Date.now() - (Number(req.query.days) || 10) * 864e5).toISOString().slice(0, 10)
    const API = 'https://www.zohoapis.com/books/v3', H = { Authorization: `Zoho-oauthtoken ${token}` }, org = process.env.ZOHO_ORGANIZATION_ID
    const list = []
    for (let page = 1; page <= 10; page++) {
      const r = await axios.get(`${API}/${kind}`, { headers: H, params: { organization_id: org, date_start: since, per_page: 200, page }, timeout: 20000 })
      const docs = r.data?.[kind] || []; list.push(...docs); if (!r.data?.page_context?.has_more_page) break
    }
    const bad = [], checked = []
    for (const d of list) {
      if (Date.now() - t0 > 25000) break
      const id = d.invoice_id || d.estimate_id
      const r = await axios.get(`${API}/${kind}/${id}`, { headers: H, params: { organization_id: org }, timeout: 15000 }).catch(() => null)
      const doc = r?.data?.invoice || r?.data?.estimate || {}
      const names = (doc.documents || []).map(x => x.file_name || x.document_name || '').filter(n => /\.pdf$/i.test(n))
      if (!names.length) continue
      const vinField = (doc.custom_fields || []).map(c => String(c.value || '')).find(v => /^[A-HJ-NPR-Z0-9]{17}$/i.test(v)) || ''
      const mine = belongsToJob({ invoice_number: doc.invoice_number || doc.estimate_number, ro_number: doc.reference_number, vin: vinField })
      const foreign = names.filter(n => /kinetic|absolute.?adas|post.?scan|report/i.test(n) && !mine(n))
      checked.push(doc.invoice_number || doc.estimate_number)
      if (foreign.length) bad.push({ number: doc.invoice_number || doc.estimate_number, id, customer: doc.customer_name, reference: doc.reference_number, status: doc.status, foreign, all: names })
    }
    res.json({ kind, since, total: list.length, with_reports: checked.length, suspect: bad.length, bad })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// Read-only helpers for the attachment audit: a Books doc's VINs + documents, and one document's bytes.
router.get('/books/doc-info', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const axios = (await import('axios')).default
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const kind = req.query.kind === 'estimates' ? 'estimates' : 'invoices'
    const r = await axios.get(`https://www.zohoapis.com/books/v3/${kind}/${req.query.id}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { organization_id: process.env.ZOHO_ORGANIZATION_ID }, timeout: 15000 })
    const doc = r.data?.invoice || r.data?.estimate || {}
    const txt = JSON.stringify(doc)
    res.json({ number: doc.invoice_number || doc.estimate_number, customer: doc.customer_name, reference: doc.reference_number, vins: [...new Set(txt.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || [])].filter(v => /\d/.test(v) && /[A-Z]/.test(v)), notes: String(doc.notes || '').slice(0, 300), lines: (doc.line_items || []).map(l => String(l.description || l.name || '').slice(0, 120)).slice(0, 6), documents: (doc.documents || []).map(d => ({ id: d.document_id, name: d.file_name })) })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})
router.get('/books/doc-file', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const axios = (await import('axios')).default
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const kind = req.query.kind === 'estimates' ? 'estimates' : 'invoices'
    const r = await axios.get(`https://www.zohoapis.com/books/v3/${kind}/${req.query.id}/documents/${req.query.doc}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { organization_id: process.env.ZOHO_ORGANIZATION_ID }, responseType: 'arraybuffer', timeout: 30000 })
    res.set('Content-Type', 'application/pdf').send(Buffer.from(r.data))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 🔒 Daily attachment check (Mark 2026-09-30: "make it so this can never happen
// again"). Reads every report PDF on recent Books invoices + estimates and
// compares the VIN printed inside to the car on the document. Any mismatch →
// #dispatch, once per document. Catches anything the Bill it gate missed,
// including files attached by hand in Books. ?days=2&dry=1
router.all('/books/attach-verify', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  const t0 = Date.now(), dry = req.query.dry === '1'
  try {
    const axios = (await import('axios')).default
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default
    const API = 'https://www.zohoapis.com/books/v3', H = { Authorization: `Zoho-oauthtoken ${token}` }, org = process.env.ZOHO_ORGANIZATION_ID
    const since = new Date(Date.now() - (Number(req.query.days) || 2) * 864e5).toISOString().slice(0, 10)
    const VIN = t => [...new Set((String(t || '').toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || []).filter(v => /\d/.test(v) && /[A-Z]/.test(v)))]
    const bad = []; let checked = 0, files = 0
    for (const kind of ['invoices', 'estimates']) {
      const r = await axios.get(`${API}/${kind}`, { headers: H, params: { organization_id: org, date_start: since, per_page: 200 }, timeout: 20000 })
      for (const d of r.data?.[kind] || []) {
        if (Date.now() - t0 > 24000) break
        const id = d.invoice_id || d.estimate_id
        const full = (await axios.get(`${API}/${kind}/${id}`, { headers: H, params: { organization_id: org }, timeout: 15000 }).catch(() => null))?.data
        const doc = full?.invoice || full?.estimate || {}
        const pdfs = (doc.documents || []).filter(x => /\.pdf$/i.test(x.file_name || ''))
        if (!pdfs.length) continue
        checked++
        const docVins = VIN(JSON.stringify({ ...doc, documents: undefined }))
        for (const x of pdfs) {
          files++
          const b = await axios.get(`${API}/${kind}/${id}/documents/${x.document_id}`, { headers: H, params: { organization_id: org }, responseType: 'arraybuffer', timeout: 30000 }).catch(() => null)
          if (!b) continue
          let text = ''; try { text = (await pdf(Buffer.from(b.data), { max: 3 })).text } catch { text = '' }
          const inside = VIN(text)
          if (!inside.length) continue
          if (docVins.length ? !inside.some(v => docVins.includes(v)) : true) {
            bad.push({ kind: kind.slice(0, -1), number: doc.invoice_number || doc.estimate_number, customer: doc.customer_name, file: x.file_name, report_vin: inside[0], doc_vin: docVins[0] || 'none on the document', id })
          }
        }
      }
    }
    let alerted = 0
    if (!dry && bad.length) {
      const seg = catalyst.initialize(req).cache().segment()
      const fresh = []
      for (const b of bad) { const k = `attachbad_${b.id}_${String(b.file).replace(/[^a-z0-9]/gi, '').slice(0, 40)}`; let seen = null; try { seen = await seg.getValue(k) } catch {}; if (!seen) { fresh.push(b); try { await seg.put(k, '1', 48) } catch {} } }
      if (fresh.length) {
        const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js')
        await postToCliqChannel(DISPATCH_CHANNEL, `🔒 *WRONG-CAR REPORT ON A BOOKS DOCUMENT* — pull it before it goes (again):\n` + fresh.map(b => `• ${b.kind} *${b.number}* (${b.customer}) has *${b.file}* — report VIN ${b.report_vin}, document VIN ${b.doc_vin}`).join('\n'))
        alerted = fresh.length
      }
    }
    res.json({ since, checked, files, mismatches: bad.length, alerted, bad })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// 🧹 One-off repair of a Books document that went out with another car's
// paperwork (2026-09-30, Mark approved). GET = where a string appears in it.
// POST body: { kind, id, remove: [document_id], fields: [{ customfield_id, value }],
//   attach: [{ name, base64 }], email: true } — email re-sends to the contacts
// Books already has on the document.
router.get('/books/find-in-doc', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const axios = (await import('axios')).default
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const kind = req.query.kind === 'estimates' ? 'estimates' : 'invoices'
    const r = await axios.get(`https://www.zohoapis.com/books/v3/${kind}/${req.query.id}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { organization_id: process.env.ZOHO_ORGANIZATION_ID }, timeout: 15000 })
    const doc = r.data?.invoice || r.data?.estimate || {}
    const needle = String(req.query.q || '').toLowerCase(), hits = []
    const walk = (o, path) => { if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`) } else if (String(o).toLowerCase().includes(needle)) hits.push({ path, value: String(o).slice(0, 300) }) }
    walk(doc, kind)
    res.json({ number: doc.invoice_number || doc.estimate_number, documents: (doc.documents || []).map(x => ({ id: x.document_id, name: x.file_name })), hits, custom_fields: (doc.custom_fields || []).map(c => ({ id: c.customfield_id, label: c.label, value: String(c.value || '').slice(0, 200) })), documents: (doc.documents || []).map(d => ({ id: d.document_id, name: d.file_name })) })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})
router.post('/books/fix-doc', express.json({ limit: '30mb' }), async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  const out = { removed: [], fields: false, attached: [], emailed: null, errors: [] }
  try {
    const axios = (await import('axios')).default
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const { attachToBooks, verifyReportForJob } = await import('../services/reportAttach.js')
    const b = req.body || {}, kind = b.kind === 'estimates' ? 'estimates' : 'invoices', id = String(b.id || '')
    const API = 'https://www.zohoapis.com/books/v3', H = { Authorization: `Zoho-oauthtoken ${token}` }, params = { organization_id: process.env.ZOHO_ORGANIZATION_ID }
    for (const d of b.remove || []) {
      const r = await axios.delete(`${API}/${kind}/${id}/documents/${d}`, { headers: H, params, timeout: 15000, validateStatus: s => s < 500 })
      if (r.data?.code === 0) out.removed.push(d); else out.errors.push(`remove ${d}: ${r.data?.message}`)
    }
    // The car's OWN folder for the "Scan Report and Documentation" link: exact
    // RO match only, else a new folder; the verified reports are filed in it.
    if (b.folder?.ro && b.folder?.field) {
      const { findFolderByRO, createJobFolder, createShareLink, uploadFileToFolder } = await import('../services/workdrive.js')
      let fid = ''
      const hit = await findFolderByRO(String(b.folder.ro), token).catch(() => null)
      if (hit?.folderId && !hit.fuzzyMatch) fid = hit.folderId
      if (!fid) { const c = await createJobFolder(String(b.folder.name || b.folder.ro).slice(0, 80), token); fid = c?.folderId || '' }
      if (fid) {
        out.folder = fid
        b._fileInto = fid
        const link = await createShareLink(fid, `Job ${b.folder.ro}`.slice(0, 50), token).catch(() => '')
        const url = typeof link === 'string' ? link : (link?.shareLink || link?.url || '')
        if (url) b.fields = [...(b.fields || []).filter(f => f.customfield_id !== b.folder.field), { customfield_id: b.folder.field, value: url }]
        out.folder_link = url
      }
    }
    if (Array.isArray(b.fields) && b.fields.length) {
      const r = await axios.put(`${API}/${kind}/${id}`, { custom_fields: b.fields }, { headers: H, params, timeout: 20000, validateStatus: s => s < 500 })
      if (r.data?.code === 0) out.fields = true; else out.errors.push(`fields: ${r.data?.message}`)
    }
    // Build our Absolute ADAS report from a scrub, with only the billed lines required.
    if (b.scrubReport?.id) {
      const { getScrub } = await import('../services/scrubStore.js')
      const sc = await getScrub(req, b.scrubReport.id)
      if (!sc) out.errors.push('scrub not found')
      else {
        const p = sc.payload || {}, only = (b.scrubReport.only || []).map(x => String(x).toLowerCase())
        const cals = (p.calibrations || []).map(c => ({ ...c, enabled: only.length ? only.some(o => String(c.calibration_name || c.sensor || '').toLowerCase().includes(o)) : c.enabled }))
        const { generateADASIQPdf } = await import('../services/pdf.js')
        const buf = await generateADASIQPdf({ shop: sc.shop || p.shop || '', ro_number: sc.ro || p.ro_number || '', insurer: sc.insurer || p.insurer || '', vin: sc.vin || p.vin || '', vehicle: sc.vehicle || p.vehicle || '', year: sc.year || '', make: sc.make || '', model: sc.model || '', claim: sc.claim || p.claim || '', calibrations: cals, document_links: Array.isArray(p.document_links) ? p.document_links : [], technician: '', folder_share_url: '' })
        b.attach = [...(b.attach || []), { name: `Absolute ADAS_${sc.ro || 'report'}${sc.vin ? `_${sc.vin}` : ''}.pdf`, base64: Buffer.from(buf).toString('base64') }]
      }
    }
    for (const a of b.attach || []) {
      const buffer = Buffer.from(a.base64, 'base64')
      if (b.vin) { const chk = await verifyReportForJob({ vin: b.vin, invoice_number: b.ro || '' }, a.name, buffer); if (!chk.ok) { out.errors.push(`🔒 refused ${a.name}: ${chk.why}`); continue } }
      try { await attachToBooks(token, kind, id, { name: a.name, buffer }); out.attached.push(a.name) } catch (e) { out.errors.push(`attach ${a.name}: ${e.message}`) }
      if (b._fileInto && b.fileReports !== false) { try { const { uploadFileToFolder } = await import('../services/workdrive.js'); await uploadFileToFolder(b._fileInto, a.name, buffer, token) } catch (e) { out.errors.push(`file ${a.name} in folder: ${e.message}`) } }
    }
    if (b.email) {
      const g = await axios.get(`${API}/${kind}/${id}/email`, { headers: H, params, timeout: 15000 })
      const to = (g.data?.data?.to_contacts || []).filter(c => c.selected !== false).map(c => c.email).filter(Boolean)
      if (!to.length) out.errors.push('email: no contacts on the document')
      else {
        const r = await axios.post(`${API}/${kind}/${id}/email`, { to_mail_ids: to, subject: g.data?.data?.subject, body: g.data?.data?.body }, { headers: H, params, timeout: 30000, validateStatus: s => s < 500 })
        out.emailed = r.data?.code === 0 ? to : null; if (r.data?.code !== 0) out.errors.push(`email: ${r.data?.message}`)
      }
    }
    res.json(out)
  } catch (e) { out.errors.push(e.response?.data?.message || e.message); res.status(500).json(out) }
})

// 🧹 Move misfiled files into a car's own new folder and point its job card
// there (2026-09-30: the Audi's reports sat in the Ford's folder). Body:
// { files: [fileId], folderName, jobId }
router.post('/wd/rehome', express.json(), async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const { createJobFolder, moveFile, createShareLink } = await import('../services/workdrive.js')
    const b = req.body || {}
    const c = await createJobFolder(String(b.folderName || 'Rehomed').slice(0, 80), token)
    if (!c?.folderId) return res.status(500).json({ error: 'could not create the folder' })
    const moved = []
    for (const f of b.files || []) { try { await moveFile(f, c.folderId, token); moved.push(f) } catch (e) { moved.push(`${f}: ${e.message}`) } }
    const link = await createShareLink(c.folderId, String(b.folderName || ''), token).catch(() => '')
    const url = typeof link === 'string' ? link : (link?.shareLink || '')
    let job = null
    if (b.jobId && url) {
      const { readJobsPublic, updateJobPublic } = await import('./jobs.js')
      const cur = (await readJobsPublic(req)).find(j => String(j.id) === String(b.jobId))
      if (cur) job = await updateJobPublic(req, cur.id, { ...cur, folder_url: url })
    }
    res.json({ folder: c.folderId, link: url, moved, job_updated: !!job })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// Send a Books invoice/estimate to the customer's billing contacts (same list Bill it uses).
router.post('/books/resend', express.json(), async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const axios = (await import('axios')).default
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const kind = req.body?.kind === 'estimates' ? 'estimates' : 'invoices', id = String(req.body?.id || '')
    const API = 'https://www.zohoapis.com/books/v3', H = { Authorization: `Zoho-oauthtoken ${token}` }, params = { organization_id: process.env.ZOHO_ORGANIZATION_ID }
    const d = (await axios.get(`${API}/${kind}/${id}`, { headers: H, params, timeout: 15000 })).data
    const doc = d.invoice || d.estimate
    const c = (await axios.get(`${API}/contacts/${doc.customer_id}`, { headers: H, params, timeout: 15000 })).data?.contact || {}
    const emails = [...new Set([c.email, ...(c.contact_persons || []).filter(p => p.is_primary_contact || p.email).map(p => p.email)].filter(e => /.+@.+\..+/.test(e || '')).map(e => e.toLowerCase()))]
    if (req.query.dry === '1') return res.json({ number: doc.invoice_number || doc.estimate_number, customer: doc.customer_name, would_send_to: emails, documents: (doc.documents || []).map(x => x.file_name) })
    if (!emails.length) return res.status(400).json({ error: 'no email on the customer' })
    const r = await axios.post(`${API}/${kind}/${id}/email`, { to_mail_ids: emails }, { headers: H, params, timeout: 30000, validateStatus: s => s < 500 })
    res.json({ ok: r.data?.code === 0, message: r.data?.message, sent_to: emails })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

// 💉 Collision copies of the programming items (Mark 2026-09-30): every
// "Module Programming and Reflash - <Make>" + the Security Access and Gateway
// fees gets a "(Collision)" twin at exactly +30%. Repair shops keep the
// originals; body shops price on the twins (zoho.js collisionVariant).
// ?dry=1 lists what would be created. Idempotent by exact name.
const PROG_RE = /^Module Programming and Reflash - |^Security Access and Authorization Fee$|^Gateway Access Fee$/i
router.all('/books/collision-items', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  const t0 = Date.now(), dry = req.query.dry === '1'
  try {
    const axios = (await import('axios')).default
    const { getAccessToken, getItemCatalogForAudit } = await import('../services/zoho.js'); const token = await getAccessToken()
    const { allItems } = await getItemCatalogForAudit()
    const names = new Set(allItems.map(i => String(i.name).trim().toLowerCase()))
    const base = allItems.filter(i => PROG_RE.test(String(i.name).trim()) && !/\(collision\)\s*$/i.test(i.name))
    const plan = base.map(i => ({ from: i.name, rate: Number(i.rate), sku: i.sku || '', name: `${String(i.name).trim()} (Collision)`, new_rate: Math.round(Number(i.rate) * 1.3 * 100) / 100, exists: names.has(`${String(i.name).trim()} (collision)`.toLowerCase()) }))
      .sort((a, b) => a.rate - b.rate || a.from.localeCompare(b.from))
    if (dry) return res.json({ dry: true, base: plan.length, to_create: plan.filter(p => !p.exists).length, plan })
    const created = [], errors = []
    for (const p of plan.filter(p => !p.exists)) {
      if (Date.now() - t0 > 24000) break
      const src = allItems.find(i => i.name === p.from) || {}
      const desc = `${String(src.description || '').trim()}${src.description ? '\n' : ''}COLLISION (body shop) price = standard + 30%.`.slice(0, 2000)
      const r = await axios.post('https://www.zohoapis.com/books/v3/items', { name: p.name.slice(0, 100), rate: p.new_rate, description: desc, product_type: 'service', ...(p.sku ? { sku: `${p.sku}-C`.slice(0, 40) } : {}) },
        { headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { organization_id: process.env.ZOHO_ORGANIZATION_ID }, timeout: 15000, validateStatus: s => s < 500 })
      if (r.data?.code === 0) created.push({ name: p.name, rate: p.new_rate, id: r.data.item?.item_id }); else errors.push(`${p.name}: ${r.data?.message}`)
    }
    try { const { invalidateItemCache } = await import('../services/zoho.js'); invalidateItemCache && invalidateItemCache() } catch {}
    res.json({ created: created.length, remaining: plan.filter(p => !p.exists).length - created.length, errors, sample: created.slice(0, 5) })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

router.get('/books/items-search', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const axios = (await import('axios')).default
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const out = []
    for (let page = 1; page <= 5; page++) {
      const r = await axios.get('https://www.zohoapis.com/books/v3/items', { headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { organization_id: process.env.ZOHO_ORGANIZATION_ID, name_contains: String(req.query.q || ''), per_page: 200, page }, timeout: 20000 })
      out.push(...(r.data?.items || []).map(i => ({ id: i.item_id, name: i.name, rate: i.rate, status: i.status, sku: i.sku })))
      if (!r.data?.page_context?.has_more_page) break
    }
    res.json({ count: out.length, items: out })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})

router.get('/books/catalog-debug', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { getItemCatalogForAudit } = await import('../services/zoho.js')
    const { allItems } = await getItemCatalogForAudit()
    const q = String(req.query.q || '').toLowerCase()
    res.json({ total: allItems.length, matches: allItems.filter(i => i.name.toLowerCase().includes(q)).slice(0, 10).map(i => i.name), last: allItems.slice(-3).map(i => i.name) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 🧪 Price-only check (no Books writes): the same lines as a repair shop vs a body shop.
// ➕ Create one Zoho Books service item (Mark approves each: 2026-10-02 "Headlamp Aim"
// $100). Idempotent: an exact-name item already in Books is returned, not duplicated.
router.post('/books/create-item', express.json(), async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { name, rate, description } = req.body || {}
    if (!name || !Number.isFinite(Number(rate))) return res.status(400).json({ error: 'name and rate required' })
    const axios = (await import('axios')).default
    const { getAccessToken, getItemCatalogForAudit } = await import('../services/zoho.js'); const token = await getAccessToken()
    try { const { allItems } = await getItemCatalogForAudit(); const dup = allItems.find(i => String(i.name).trim().toLowerCase() === String(name).trim().toLowerCase()); if (dup) return res.json({ ok: true, existed: true, item: { item_id: dup.item_id, name: dup.name, rate: dup.rate } }) } catch { /* create anyway */ }
    const r = await axios.post('https://www.zohoapis.com/books/v3/items', { name: String(name).slice(0, 100), rate: Number(rate), description: String(description || '').slice(0, 2000), product_type: 'service' },
      { headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { organization_id: process.env.ZOHO_ORGANIZATION_ID }, timeout: 15000, validateStatus: st => st < 500 })
    if (r.data?.code !== 0) return res.status(400).json({ error: r.data?.message || 'Zoho refused', code: r.data?.code })
    const it = r.data.item || {}
    console.log(`[books item] created "${it.name}" $${it.rate} (${it.item_id})`)
    res.json({ ok: true, item: { item_id: it.item_id, name: it.name, rate: it.rate } })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})
router.get('/books/price-test', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { previewInvoiceLines } = await import('../services/zoho.js')
    const cals = String(req.query.lines || 'Module Programming and Reflash - Ford,Security Access and Authorization Fee').split(',').map(n => ({ calibration_name: n.trim(), quantity: 1 }))
    const run = async collision => (await previewInvoiceLines({ insurer: String(req.query.insurer || ''), make: String(req.query.make || 'Ford'), calibrations: cals, req, collision, big3Rules: { cal_id: 'off', pcsi: 'off', post_scan: 'off', snapshot: 'off' } })).lines.map(l => `${l.name} $${l.rate}`)
    res.json({ repair_shop: await run(false), body_shop: await run(true) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Shops by customer type (read-only) — who still needs Collision / Repair / Dealer / Retail set.
router.get('/shops/types', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const b3 = await import('../services/big3.js')
    const { map = {}, missing = [] } = await b3.big3Map(req)
    const counts = {}; for (const e of Object.values(map)) { const t = e.billing?.customer_type || 'none'; counts[t] = (counts[t] || 0) + 1 }
    res.json({ typed_counts: counts, active_without_type: missing.filter(m => m.no_billing).map(m => m.shop_name).sort() })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 📨 Test copies of every welcome version to one address (Mark only, no Kat).
// 📨 Test copy of email 2 ("Welcome to Absolute ADAS") to an absoluteadas.com inbox. The
// questionnaire links point at a test token: the page works, nothing saves.
router.post('/welcome2/test', express.json(), async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  const to = String(req.body?.to || 'mark@absoluteadas.com').toLowerCase()
  if (!/@absoluteadas\.com$/.test(to)) return res.status(400).json({ error: 'test copies go to an absoluteadas.com address only' })
  const { sendShopWelcome2 } = await import('../services/shopWelcome.js')
  res.json(await sendShopWelcome2(req, { id: 'test', shop_name: 'TEST' }, { testTo: to }))
})
router.post('/welcome/test', express.json(), async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const to = String(req.body?.to || 'mark@absoluteadas.com').toLowerCase()
    if (!/@absoluteadas\.com$/.test(to)) return res.status(400).json({ error: 'test copies go to an absoluteadas.com address only' })
    const { welcomeCopy } = await import('../services/shopWelcome.js')
    const { sendBroadcast } = await import('../services/brewResend.js')
    const fs = (await import('node:fs')).default, path = (await import('node:path')).default, { fileURLToPath } = await import('node:url')
    const pdfPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'absolute-adas-pricing-sheet.pdf')
    const label = { body_shop: 'Collision', dealer: 'Dealer', repair_shop: 'Auto repair', retail: 'Retail' }
    const sent = []
    for (const type of ['body_shop', 'dealer', 'repair_shop', 'retail']) {
      const c = welcomeCopy({ firstName: 'Mark', type })
      let attachments; if (c.pdf) { try { attachments = [{ filename: 'Absolute ADAS pricing sheet.pdf', content: fs.readFileSync(pdfPath).toString('base64') }] } catch {} }
      await sendBroadcast({ recipients: [to], subject: `[TEST · ${label[type]}] ${c.subject}`, html: c.html, text: c.text, attachments, fromEmail: process.env.WELCOME_FROM_EMAIL || 'brew@absoluteadas.com', fromName: 'Mark Fowler · Absolute ADAS', replyTo: 'mark@absoluteadas.com' })
      sent.push(label[type])
    }
    res.json({ ok: true, to, sent })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// 🏷 Set customer types in bulk by shop name (silent, no welcome email). Body: { set: [{ name, type }] }, ?dry=1
router.post('/shops/set-types', express.json(), async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  const dry = req.query.dry === '1'
  try {
    const b3 = await import('../services/big3.js')
    const { getAllShops } = await import('./shops.js')
    const shops = await getAllShops(req)
    const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const out = []
    for (const { name, type } of req.body?.set || []) {
      const shop = shops.find(s => key(s.shop_name) === key(name))
      if (!shop) { out.push({ name, error: 'not found' }); continue }
      if (!b3.CUSTOMER_TYPES[type]) { out.push({ name, error: `bad type ${type}` }); continue }
      const br = typeof shop.billing_rules === 'string' ? (JSON.parse(shop.billing_rules || '{}') || {}) : (shop.billing_rules || {})
      if (br.customer_type) { out.push({ name, skipped: `already ${br.customer_type}` }); continue }
      const def = b3.CUSTOMER_TYPES[type]
      const pct = def.discount ?? (Number.isFinite(Number(br.discount_value)) ? Number(br.discount_value) : null)
      if (dry) { out.push({ name: shop.shop_name, would: type, discount: pct, pay: def.pay }); continue }
      await b3.saveBig3(req, shop.shop_name, b3.normalizeRules(br.big3) || b3.DEFAULT_RULES, 'Mark (bulk types 2026-09-30)', { shop, customer_type: type, discount_pct: pct, pay_mode: def.pay, silent: true })
      out.push({ name: shop.shop_name, set: type })
    }
    try { b3.invalidateBig3Map && b3.invalidateBig3Map() } catch {}
    res.json({ dry, done: out.filter(o => o.set || o.would).length, out })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 📝 Mark scrubs "quote sent" from Books estimates that went out (status sent /
// viewed, not yet accepted, declined or invoiced). Same exact RO / VIN matching
// as mark-invoiced. Stage only moves forward, so it never undoes a job or an
// invoice. ?dry=1 = counts only. (Mark 2026-09-30: blue border on quoted cars.)
router.all('/scrubs/mark-quoted', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  const t0 = Date.now(), dry = req.query.dry === '1'
  try {
    const axios = (await import('axios')).default
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const { listScrubs, setScrubStageById } = await import('../services/scrubStore.js')
    const API = 'https://www.zohoapis.com/books/v3', H = { Authorization: `Zoho-oauthtoken ${token}` }, params = { organization_id: process.env.ZOHO_ORGANIZATION_ID }
    const since = new Date(Date.now() - (Number(req.query.days) || 120) * 864e5).toISOString().slice(0, 10)
    const ests = []
    for (let page = 1; page <= 10; page++) {
      const r = await axios.get(`${API}/estimates`, { headers: H, params: { ...params, date_start: since, per_page: 200, page }, timeout: 20000 })
      ests.push(...(r.data?.estimates || [])); if (!r.data?.page_context?.has_more_page) break
    }
    const sent = ests.filter(e => ['sent', 'viewed', 'expired'].includes(String(e.status).toLowerCase()))
    const toks = x => String(x || '').toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length >= 5)
    const N = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const { scrubs } = await listScrubs(req, { limit: 3000, maxScan: 5000 })
    const matches = []
    for (const s of scrubs) {
      if (!['scrubbed', 'quote_requested', 'requested', ''].includes(s.stage || '')) continue
      const ro = N(s.ro), vin6 = N(s.vin).slice(-6)
      const e = sent.find(e => (ro.length >= 5 && (toks(e.reference_number).includes(ro) || toks(e.estimate_number).includes(ro))) || (vin6.length === 6 && toks(e.estimate_number).some(t => t.endsWith(vin6))))
      if (e) matches.push({ id: s.id, ro: s.ro, vehicle: s.vehicle, quote: e.estimate_number, status: e.status })
    }
    if (dry) return res.json({ dry: true, sent_quotes: sent.length, to_mark: matches.length, sample: matches.slice(0, 12) })
    let marked = 0
    for (const m of matches) { if (Date.now() - t0 > 24000) break; await setScrubStageById(req, m.id, 'quoted', { quoteNumber: m.quote }); marked++ }
    res.json({ sent_quotes: sent.length, to_mark: matches.length, marked, remaining: matches.length - marked })
  } catch (e) { res.status(500).json({ error: e.response?.data?.message || e.message }) }
})
// 🔄 Daily: keep the Scrub Library's stages current from Books (quotes sent, invoices).
router.all('/scrubs/sync-stages', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  const base = `${(process.env.API_PUBLIC_BASE || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api')}/api/crm-sync-cron`
  const axios = (await import('axios')).default
  const H = { 'x-cron-secret': req.headers['x-cron-secret'] }
  const out = {}
  for (const p of ['scrubs/mark-quoted', 'scrubs/mark-invoiced']) {
    try { out[p] = (await axios.post(`${base}/${p}`, {}, { headers: H, timeout: 28000 })).data } catch (e) { out[p] = { error: e.message } }
  }
  res.json(out)
})

// 🧱 Scrub piles (Mark 2026-09-30: no maximum). The dispatcher reclaims dead
// workers, counts what's ready, and starts one worker per ready estimate, in
// parallel. Each worker claims one row, scrubs it, marks it done. Workers keep
// running after the gateway's 30s cut (Catalyst finishes the invocation), so
// the dispatcher only waits long enough for each call to be sent.
router.all('/scrub-dispatch', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const SQ = await import('../services/scrubQueue.js')
    const reclaimed = await SQ.reclaimStale(req)
    const stats = await SQ.queueStats(req)
    const n = stats.ready
    const base = `${(process.env.API_PUBLIC_BASE || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api')}/api/crm-sync-cron`
    const axios = (await import('axios')).default
    const fire = i => axios.post(`${base}/scrub-worker?w=d${Date.now().toString(36)}${i}`, {}, { headers: { 'x-cron-secret': req.headers['x-cron-secret'] }, timeout: 20000 }).catch(() => null)   // 2.5s dropped cold starts (CCC test 2026-09-30); workers run past the gateway's 30s cut anyway
    await Promise.all(Array.from({ length: n }, (_, i) => fire(i)))
    if (stats.dead) { try { const { maybeAlertDead } = await import('../services/scrubQueue.js'); maybeAlertDead && await maybeAlertDead(req, stats.dead) } catch {} }
    res.json({ started: n, reclaimed, ...stats })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.all('/scrub-worker', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try { const { runScrubQueue } = await import('../services/emailToJob.js'); res.json(await runScrubQueue(req, { max: 1, worker: String(req.query.w || '') })) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
// 🛟 Never lose one (Mark 2026-09-30). (1) Every estimate CCC delivered is a file
// in WorkDrive → CCC Inbox; each must have a queue row — any that don't are
// queued now. (2) Anything waiting > 30 min, or a "needs a human" row, posts
// to #dispatch (once per item per day). Runs every 15 min from the ticker.
router.all('/scrub-safety', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  const out = { inbox: 0, missing: 0, requeued: [], stale: 0, dead: 0, alerted: 0 }
  try {
    const catalystApp = catalyst.initialize(req, { type: 'advancedio' })
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const { listChildren, JOB_PARENT_FOLDER_ID } = await import('../services/workdrive.js')
    const kids = await listChildren(JOB_PARENT_FOLDER_ID, token, { folders: true }).catch(() => [])
    const inbox = kids.find(k => k.name === 'CCC Inbox')
    const SQ = await import('../services/scrubQueue.js')
    if (inbox) {
      const files = await listChildren(inbox.id, token, { folders: false, max: 5000 })
      out.inbox = files.length
      const rows = []
      for (let off = 0; off < 20000; off += 300) {
        const page = await catalystApp.zcql().executeZCQLQuery(`SELECT sj_file FROM AdasScrubJobs WHERE sj_source = 'ccc' LIMIT 300 OFFSET ${off}`)
        rows.push(...page.map(r => r.AdasScrubJobs?.sj_file)); if (page.length < 300) break
      }
      const have = new Set(rows.filter(Boolean))
      for (const f of files.filter(f => /\.xml$/i.test(f.name) && !have.has(f.id))) {
        out.missing++
        const hash = (f.name.match(/([0-9a-f]{8})\.xml$/i) || [])[1] || f.id
        await SQ.enqueue(req, { key: `ccc:file:${f.id}`, file: f.id, name: f.name, source: 'ccc', by: 'safety check', priority: 1 })
        out.requeued.push(f.name)
      }
    }
    const stats = await SQ.queueStats(req)
    out.dead = stats.dead
    const oldMin = stats.oldest_waiting ? (Date.now() - new Date(String(stats.oldest_waiting.since).replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}):\d+$/, '$1T$2-07:00')).getTime()) / 60000 : 0
    out.stale = oldMin > 30 ? Math.round(oldMin) : 0
    const msgs = []
    if (out.missing) msgs.push(`🛟 Found ${out.missing} CCC estimate${out.missing === 1 ? '' : 's'} with no scrub — queued now: ${out.requeued.slice(0, 5).join(', ')}`)
    if (out.stale) msgs.push(`⏰ A scrub has been waiting ${out.stale} min (${stats.oldest_waiting?.name || ''}). Scrubbers may be stuck.`)
    if (stats.dead) msgs.push(`🧑‍🔧 ${stats.dead} estimate${stats.dead === 1 ? '' : 's'} need a human (failed 3 times).`)
    if (msgs.length) {
      const seg = catalyst.initialize(req).cache().segment()
      const k = `scrub_safety_${new Date().toISOString().slice(0, 10)}_${msgs.join('|').replace(/[^a-z0-9]/gi, '').slice(0, 40)}`
      let seen = null; try { seen = await seg.getValue(k) } catch {}
      if (!seen || out.missing) {
        try { const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js'); await postToCliqChannel(DISPATCH_CHANNEL, msgs.join('\n')); out.alerted = msgs.length } catch {}
        try { await seg.put(k, '1', 24) } catch {}
      }
    }
    if (stats.ready) { try { const axios = (await import('axios')).default; await axios.post(`${(process.env.API_PUBLIC_BASE || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api')}/api/crm-sync-cron/scrub-dispatch`, {}, { headers: { 'x-cron-secret': req.headers['x-cron-secret'] }, timeout: 20000 }) } catch {} }
    res.json({ ...out, queue: stats })
  } catch (e) { res.status(500).json({ ...out, error: e.message }) }
})

// 🧪 Test-only: feed a BMS XML into the CCC pipeline exactly like the webhook
// does after the signature check (save to CCC Inbox → queue). Cron secret.
router.post('/ccc/test-enqueue', express.text({ type: () => true, limit: '10mb' }), async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const raw = String(req.body || '')
    const crypto = (await import('node:crypto')).default
    const { parseBms } = await import('../services/cccScrub.js')
    const e = parseBms(raw)
    const hash = crypto.createHash('sha1').update(raw).digest('hex')
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const { listChildren, uploadFileToFolder, JOB_PARENT_FOLDER_ID } = await import('../services/workdrive.js')
    const inbox = (await listChildren(JOB_PARENT_FOLDER_ID, token, { folders: true })).find(k => k.name === 'CCC Inbox')
    const name = `TEST ${e.ro} ${e.year} ${e.make} ${e.model} ${e.verCode}${e.version} ${hash.slice(0, 8)}.xml`
    const up = await uploadFileToFolder(inbox.id, name, Buffer.from(raw, 'utf8'), token, 'application/xml')
    const { enqueue } = await import('../services/scrubQueue.js')
    res.json({ name, ...(await enqueue(req, { key: `ccc:${hash}`, file: up?.fileId || '', name, source: 'ccc', by: 'test', priority: 1 })) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/scrub-queue', async (req, res) => {
  if (!wdAuth(req)) return res.status(401).json({ error: 'Unauthorized' })
  try { const SQ = await import('../services/scrubQueue.js'); res.json({ stats: await SQ.queueStats(req), needs_a_human: await SQ.listDead(req, 20) }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/scrubs-export', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { listScrubs } = await import('../services/scrubStore.js')
    const { scrubs } = await listScrubs(req, { limit: 2000, maxScan: 4000, includeBench: true })   // the benchmark scorer needs its own test rows
    const rows = scrubs.map(s => ({
      id: s.id, vin: s.vin, ro: s.ro, shop: s.shop, vehicle: s.vehicle, make: s.make, year: s.year, source: s.source, status: s.status, file: s.fileName || '', fileId: s.fileId || '', at: s.at,
      required: (s.sensors || []).filter(x => x.r).map(x => x.n),
      not_required: (s.sensors || []).filter(x => !x.r).map(x => x.n),
      detail: (s.sensors || []).map(x => ({ n: x.n, r: !!x.r, l: x.l || '', g: x.g || '' })),
    }))
    res.json({ count: rows.length, rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 🧪 Scrub the CCC estimate sitting in a car's WorkDrive folder, found by RO
// (benchmark 2026-09-28: 19 Kinetic cars whose estimates never touched
// Downloads — they came in through Secure Share and live only in the job
// folder). No job card needed: the folder resolver searches by RO, then by
// shop + vehicle. ?ro=&shop=&vehicle=&source=&force=1
router.post('/scrub-by-ro', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  const ro = String(req.query.ro || '').trim(); if (!ro) return res.status(400).json({ error: 'ro required' })
  try {
    const jobsMod = await import('./jobs.js'); const { getAccessToken } = await import('../services/zoho.js'); const { listChildren, downloadFile } = await import('../services/workdrive.js')
    const wdToken = await getAccessToken()
    const stub = { quote_number: ro, shop_name: String(req.query.shop || ''), vehicle: String(req.query.vehicle || '') }
    const folderId = await jobsMod.resolveJobFolderPublic(req, stub, wdToken, { noCreate: true })
    if (!folderId) return res.json({ ro, skipped: 'no WorkDrive folder found for this RO' })
    const pdfs = (await listChildren(folderId, wdToken, { folders: false })).filter(f => /\.pdf$/i.test(f.name || ''))
      .sort((a, b) => Number(b.created || 0) - Number(a.created || 0))
      .sort((a, b) => Number(/kinetic|absolute|post.?scan|pre.?scan|invoice|report|estimate-sent/i.test(a.name || '')) - Number(/kinetic|absolute|post.?scan|pre.?scan|invoice|report|estimate-sent/i.test(b.name || '')))
    if (!pdfs.length) return res.json({ ro, folderId, skipped: 'no PDF in the folder' })
    const { detectPdfKind } = await import('../services/claude.js'); const { hasScrubForFile } = await import('../services/scrubStore.js'); const { scrubPdfBuffer } = await import('./extract.js')
    const tried = []
    for (const f of pdfs.slice(0, 4)) {
      if (req.query.force !== '1' && await hasScrubForFile(req, f.name)) { tried.push(`${f.name}: already in the library`); continue }
      const { buffer } = await downloadFile(f.id, wdToken); if (!buffer || buffer.length < 512) { tried.push(`${f.name}: empty`); continue }
      let kind = 'OTHER', make = ''; try { ({ kind, make } = await detectPdfKind(buffer.toString('base64'))) } catch { kind = 'OTHER' }
      if (!['CCC', 'ESTIMATE'].includes(kind)) { tried.push(`${f.name}: ${kind}`); continue }
      const data = await scrubPdfBuffer(req, buffer, { learn: false, source: String(req.query.source || 'folder').slice(0, 30), by: 'folder by RO', file: { id: f.id, name: f.name }, pdfType: 'CCC', make })
      return res.json({ ok: true, ro, file: f.name, kind, shop: data?.shop || '', vehicle: data?.vehicle || '', vin: data?.vin || '', required: (data?.calibrations || []).filter(c => c.enabled !== false).length, scrubId: data?._scrubId || '', tried })
    }
    res.json({ ro, folderId, skipped: 'no estimate among the PDFs', tried })
  } catch (e) { res.status(500).json({ error: e.message, ro }) }
})

// 🧹 Remove exact duplicate scrubs (same file + VIN + source), newest kept. ?dry=1 to preview.
router.post('/scrubs-dedupe', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try { const { dedupeScrubs } = await import('../services/scrubStore.js'); res.json(await dedupeScrubs(req, { dry: req.query.dry === '1' })) } catch (e) { res.status(500).json({ error: e.message }) }
})

// 📎 Backfill: file an estimate PDF for a scrub that has none (multipart file=, id=). Cron secret.
const attachUpload = (await import('multer')).default({ storage: (await import('multer')).default.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }).single('file')
router.post('/scrubs/attach-file', (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  attachUpload(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message })
    const id = String(req.body?.id || ''); if (!req.file || !id) return res.status(400).json({ error: 'file and id required' })
    try {
      const { getScrub, setScrubFile } = await import('../services/scrubStore.js')
      const s = await getScrub(req, id); if (!s) return res.status(404).json({ error: 'no such scrub' })
      if (s.fileId) return res.json({ skipped: 'already has a file', id })
      const { getAccessToken } = await import('../services/zoho.js'); const { listChildren, createFolderUnder, uploadFileToFolder, JOB_PARENT_FOLDER_ID } = await import('../services/workdrive.js')
      const token = await getAccessToken()
      const kids = await listChildren(JOB_PARENT_FOLDER_ID, token, { folders: true }).catch(() => [])
      const folder = (kids || []).find(f => /^scrub library$/i.test(f.name || ''))?.id || (await createFolderUnder(JOB_PARENT_FOLDER_ID, 'Scrub Library', token))?.folderId
      const label = [s.year, s.make, s.model].filter(Boolean).join(' ').slice(0, 50)
      const fname = `${s.ro ? 'RO ' + s.ro + ' - ' : ''}${label || 'estimate'} - ${String(req.file.originalname || 'estimate.pdf').replace(/[^\w .()&-]+/g, ' ').trim()}`.slice(0, 120)
      const { fileId } = await uploadFileToFolder(folder, fname, req.file.buffer, token)
      await setScrubFile(req, id, { id: fileId, name: fname })
      res.json({ ok: true, id, file: fname })
    } catch (e) { res.status(500).json({ error: e.message, id }) }
  })
})

// ── 🗂 WorkDrive housekeeping (Mark 2026-10-09: "organize my WorkDrive"). Cron secret.
//   GET  /workdrive/ls?id=<folder>      children (id, name, is_folder)
//   GET  /workdrive/info?id=<file>      name + parent_id (walk up to find roots)
//   POST /workdrive/ops { ops:[ {op:'mkdir',parent,name} | {op:'move',id,to} | {op:'rename',id,name} | {op:'trash',id} ] }
//        runs in order, stops at ~24s (gateway cap) and returns { done, results } so the caller resumes.
//        mkdir is idempotent (exact-name child reused) and returns the folder id; later ops may
//        reference an earlier mkdir with to:'$<index>' / parent:'$<index>'.
const wdGuard = (req, res) => { const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'; if (String(req.headers['x-cron-secret'] || '').trim() !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false } return true }
router.get('/workdrive/ls', async (req, res) => {
  if (!wdGuard(req, res)) return
  try { const { getAccessToken } = await import('../services/zoho.js'); const { listChildren } = await import('../services/workdrive.js'); res.json({ ok: true, items: await listChildren(String(req.query.id || ''), await getAccessToken()) }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/workdrive/info', async (req, res) => {
  if (!wdGuard(req, res)) return
  try {
    const { getAccessToken } = await import('../services/zoho.js'); const axios = (await import('axios')).default
    const r = await axios.get(`https://www.zohoapis.com/workdrive/api/v1/files/${String(req.query.id || '')}`, { headers: { Authorization: `Zoho-oauthtoken ${await getAccessToken()}`, Accept: 'application/vnd.api+json' }, timeout: 15000 })
    const a = r.data?.data?.attributes || {}
    res.json({ ok: true, id: r.data?.data?.id, name: a.name, parent_id: a.parent_id, is_folder: a.is_folder, type: a.type, library_id: a.library_id, team_id: a.team_id })
  } catch (e) { res.status(e.response?.status || 500).json({ error: e.message, body: e.response?.data }) }
})
// GET /workdrive/spaces?team=<team_id> → team folders (workspaces) + the token owner's private space ("My Folders")
router.get('/workdrive/spaces', async (req, res) => {
  if (!wdGuard(req, res)) return
  try {
    const { getAccessToken } = await import('../services/zoho.js'); const axios = (await import('axios')).default
    const H = { Authorization: `Zoho-oauthtoken ${await getAccessToken()}`, Accept: 'application/vnd.api+json' }
    const API = 'https://www.zohoapis.com/workdrive/api/v1'; const team = String(req.query.team || '')
    const out = { ok: true, workspaces: [], privatespace: null, errors: [] }
    try { const r = await axios.get(`${API}/teams/${team}/workspaces`, { headers: H, timeout: 15000 }); out.workspaces = (r.data?.data || []).map(w => ({ id: w.id, name: w.attributes?.name })) } catch (e) { out.errors.push('workspaces: ' + (e.response?.status || '') + ' ' + JSON.stringify(e.response?.data || e.message).slice(0, 200)) }
    try {
      const me = await axios.get(`${API}/teams/${team}/currentuser`, { headers: H, timeout: 15000 })
      const memberId = me.data?.data?.id
      const ps = await axios.get(`${API}/users/${memberId}/privatespace`, { headers: H, timeout: 15000 })
      const d = Array.isArray(ps.data?.data) ? ps.data.data[0] : ps.data?.data
      out.privatespace = { id: d?.id, name: d?.attributes?.name, owner: me.data?.data?.attributes?.email_id || me.data?.data?.attributes?.display_name }
    } catch (e) { out.errors.push('privatespace: ' + (e.response?.status || '') + ' ' + JSON.stringify(e.response?.data || e.message).slice(0, 200)) }
    res.json(out)
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// POST /durable/backfill — copy every durable key that is sitting in the cache right now into the
// DurableKV table (cron secret). Safe to re-run; keys already saved are left alone.
router.post('/durable/backfill', async (req, res) => {
  if (!wdGuard(req, res)) return
  try {
    const { durable, kvGet } = await import('../services/durableKV.js')
    const app = catalyst.initialize(req); const raw = app.cache().segment(); const seg = durable(raw, app)
    const fixed = ['books_counter', 'books_expenses', 'books_deposits', 'books_services', 'books_invoices_meta', 'payroll_runs', 'payroll_settings', 'bonus_config', 'bonus_payouts',
      'mileage_trips_meta', 'mileage_settings', 'quotes', 'declined_calibrations', 'adas_jobs', 'adas_jobs_meta', 'nps_responses', 'capture_calc_submissions', 'partnership_audit_requests',
      'audit_tool_submissions', 'tool_quote_submissions', 'comms_log', 'announcements', 'org_open_seats', 'adas_iq_settings', 'adas_iq_branding', 'adas_iq_notifications',
      'absolute_adas_job_state', 'absolute_adas_tech_config', 'van_inventory', 'pm_projects', 'pm_tasks', 'capture_approval_queue', 'pace_monthly_goal', 'brew_meta', 'brew_tips_queue',
      'marketing_notified_comments', 'brew_email_marker', 'github_pat_secondbrain', 'week_plan', 'family_devo_passages', 'closing_history']
    const chunked = ['books_invoices_chunk_', 'mileage_trips_chunk_', 'adas_jobs_chunk_']
    const keys = [...fixed]; for (const p of chunked) for (let i = 0; i < 60; i++) keys.push(p + i)
    const saved = [], already = [], emptyKeys = []
    for (const k of keys) {
      let inCache = null; try { inCache = await raw.getValue(k) } catch { inCache = null }
      if (inCache === null || inCache === undefined || inCache === '') { if (!k.includes('_chunk_')) emptyKeys.push(k); continue }
      const before = await kvGet(app, k).catch(() => null)
      if (before) { already.push(k); continue }
      await seg.getValue(k)   // read-through backfills it
      saved.push(`${k} (${String(inCache).length} chars)`)
    }
    res.json({ ok: true, saved, already, empty_in_cache: emptyKeys })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// POST /shops/fill-addresses?apply=1&max=40 — every shop gets a full mailing address (Mark 2026-10-14:
// "so that later I can send mail and physical mail to them"). Blank addresses only, never overwrites.
// Source 1: the shop's Zoho Books customer (billing address, plus email/phone if blank).
// Source 2: Google Places by shop name in Washington (best match, name must agree).
// Then the zone is set from the new address. Dry run by default.
router.post('/shops/fill-addresses', async (req, res) => {
  if (!wdGuard(req, res)) return
  const t0 = Date.now()
  try {
    const axios = (await import('axios')).default; const { getAccessToken } = await import('../services/zoho.js')
    const { getAllShops } = await import('./shops.js'); const P = await import('../services/pipeline.js')
    const apply = req.query.apply === '1', max = Math.min(Number(req.query.max) || 40, 120)
    const all = await getAllShops(req)
    const todo = all.filter(s => !/^test\b/i.test(String(s.shop_name || '')) && (!String(s.address || '').trim() || !/\d{5}/.test(String(s.address || '')))).slice(0, max)
    const token = await getAccessToken(); const H = { Authorization: `Zoho-oauthtoken ${token}` }; const org = { organization_id: process.env.ZOHO_ORGANIZATION_ID }
    const norm = x => String(x || '').toLowerCase().replace(/\b(inc|llc|corp|ltd|co|the|llp|dba)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    const fmt = b => { if (!b) return ''; const line = [b.address, b.street2].filter(Boolean).join(' ').trim(); const cs = [b.city, [b.state_code || b.state, b.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '); return line && b.city ? `${line}, ${cs}, USA` : '' }
    const out = []; const t = catalyst.initialize(req, { type: 'advancedio' }).datastore().table('CRMShops')
    for (const sh of todo) {
      if (Date.now() - t0 > 24000) break
      let address = '', email = '', phone = '', source = ''
      try {
        let c = null
        if (sh.zoho_contact_id) c = (await axios.get(`https://www.zohoapis.com/books/v3/contacts/${sh.zoho_contact_id}`, { headers: H, params: org, timeout: 10000 })).data?.contact
        if (!c) { const l = (await axios.get('https://www.zohoapis.com/books/v3/contacts', { headers: H, params: { ...org, contact_name_contains: String(sh.shop_name).slice(0, 40) }, timeout: 10000 })).data?.contacts || []; const hit = l.find(x => norm(x.contact_name) === norm(sh.shop_name)) || (l.length === 1 ? l[0] : null); if (hit) c = (await axios.get(`https://www.zohoapis.com/books/v3/contacts/${hit.contact_id}`, { headers: H, params: org, timeout: 10000 })).data?.contact }
        if (c) { address = fmt(c.billing_address) || fmt(c.shipping_address); email = c.email || ''; phone = c.phone || c.mobile || ''; if (address) source = 'Books' }
      } catch (e) { /* fall through to Google */ }
      if (!address && process.env.GOOGLE_PLACES_API_KEY) {
        try {
          const r = await axios.post('https://places.googleapis.com/v1/places:searchText', { textQuery: `${sh.shop_name}, Washington`, maxResultCount: 3 }, { headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.nationalPhoneNumber' }, timeout: 10000 })
          const words = norm(sh.shop_name).split(' ').filter(w => w.length > 2 && !['auto', 'body', 'bodyshop', 'shop', 'repair', 'collision', 'center', 'sales', 'automotive'].includes(w))
          // A word can match the business name OR its address ("Maaco - Bellingham" is listed as "Maaco Auto Body Shop & Painting", Bellingham)
          const p = (r.data?.places || []).find(x => /\bWA\b/.test(x.formattedAddress || '') && (words.length === 0 ? norm(x.displayName?.text) === norm(sh.shop_name) : words.every(w => norm(x.displayName?.text).includes(w) || norm(x.formattedAddress).includes(w)) && words.some(w => norm(x.displayName?.text).includes(w))))
          if (p) { address = p.formattedAddress; if (!phone) phone = p.nationalPhoneNumber || ''; source = 'Google' }
        } catch { /* none */ }
      }
      const row = { shop: sh.shop_name, stage: sh.pipeline_stage, address, source: source || 'not found' }
      if (address) {
        const patch = { ROWID: String(sh.id), address }
        if (!String(sh.email || '').trim() && email) { patch.email = email; row.email = email }
        if (!String(sh.phone || '').trim() && phone) patch.phone = phone
        const region = P.regionForAddress(address); if (region && !P.ZONE_BY_ID[sh.region] && sh.region !== 'out') { patch.region = region; row.zone = region }
        if (apply) await t.updateRow(patch)
      }
      out.push(row)
    }
    const missing = all.filter(s => !String(s.address || '').trim() || !/\d{5}/.test(String(s.address || ''))).length
    res.json({ ok: true, missing_before: missing, checked: out.length, found: out.filter(r => r.address).length, applied: apply, rows: out })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// POST /pipeline/discover-add?city=Yakima&apply=1 — Google body-shop discovery for one city, added as
// Targets with zone + owner (Mark 2026-10-14: "add in all the body shops from each of those areas").
// Without apply=1 it only lists what it would add. Never touches shops already in the CRM.
router.post('/pipeline/discover-add', async (req, res) => {
  if (!wdGuard(req, res)) return
  try {
    const { discoverCity } = await import('./pipeline.js'); const P = await import('../services/pipeline.js'); const { insertShop, getAllShops } = await import('./shops.js')
    const d = await discoverCity(req, String(req.query.city || ''))
    const have = new Set((await getAllShops(req)).map(s => String(s.shop_name || '').toLowerCase().trim()))
    const rows = []
    for (const c of d.candidates || []) {
      const region = P.regionForAddress(c.address) || c.zone || ''
      if (!region || have.has(String(c.shop_name).toLowerCase().trim())) continue
      have.add(String(c.shop_name).toLowerCase().trim())
      rows.push({ shop_name: c.shop_name, address: c.address, phone: c.phone || '', email: '', pipeline_stage: 'target', region, assigned_to: P.ZONE_BY_ID[region]?.owner || '', referral_source: 'Google',
        notes: `Found by territory discovery ${new Date().toISOString().slice(0, 10)} · ${c.rating ? `${c.rating}★ (${c.reviews})` : 'no rating'}${c.website ? ` · ${c.website}` : ''}${c.google_maps_url ? ` · ${c.google_maps_url}` : ''}` })
    }
    let added = 0
    if (req.query.apply === '1') for (const r of rows) { await insertShop(req, r); added++ }
    res.json({ ok: true, city: d.city, google_found: d.found, already_in_crm: d.already, new: rows.length, added, by_zone: rows.reduce((m, r) => (m[r.region] = (m[r.region] || 0) + 1, m), {}), shops: rows.map(r => `${r.shop_name} · ${r.address.split(',').slice(-3, -1).join(',').trim()}`) })
  } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})
// POST /shops/rezone?apply=1 — set every shop's zone from its address (Mark 2026-10-14). Default is a
// dry run listing the changes. Only region changes; a shop whose address names no known city is left alone.
router.post('/shops/rezone', async (req, res) => {
  if (!wdGuard(req, res)) return
  try {
    const P = await import('../services/pipeline.js'); const { getAllShops } = await import('./shops.js')
    const shops = await getAllShops(req); const changes = []; const unknown = []
    for (const sh of shops) {
      const target = P.regionForAddress(sh.address) || (!String(sh.address || '').trim() && !sh.region ? P.zoneForAddress(sh.shop_name) : '')
      if (!target) { if (!sh.region && String(sh.address || '').trim()) unknown.push(`${sh.shop_name} · ${String(sh.address).slice(0, 60)}`); continue }
      if (target !== (sh.region || '')) changes.push({ id: String(sh.id), shop: sh.shop_name, stage: sh.pipeline_stage, from: sh.region || '', to: target, address: String(sh.address || '').slice(0, 70) })
    }
    let applied = 0
    if (req.query.apply === '1') {
      const t = catalyst.initialize(req, { type: 'advancedio' }).datastore().table('CRMShops')
      for (const c of changes) { await t.updateRow({ ROWID: c.id, region: c.to }); applied++ }
    }
    const tally = {}; for (const c of changes) tally[`${c.from || '(none)'} → ${c.to}`] = (tally[`${c.from || '(none)'} → ${c.to}`] || 0) + 1
    res.json({ ok: true, total: shops.length, changes: changes.length, applied, tally, list: changes, unknown_city: unknown })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// GET /cliq/channels — name, unique name and id of every Cliq channel the app's login can see (cron secret).
router.get('/cliq/channels', async (req, res) => {
  if (!wdGuard(req, res)) return
  try {
    const { getCliqAccessToken } = await import('../services/cliq.js'); const axios = (await import('axios')).default
    const r = await axios.get('https://cliq.zoho.com/company/883116359/api/v2/channels', { params: { limit: 100 }, headers: { Authorization: `Zoho-oauthtoken ${await getCliqAccessToken()}` }, timeout: 15000 })
    res.json({ ok: true, channels: (r.data?.channels || []).map(c => ({ name: c.name, unique_name: c.unique_name, channel_id: c.channel_id, members: c.participant_count })) })
  } catch (e) { res.status(e.response?.status || 500).json({ error: e.message, body: e.response?.data }) }
})
// POST /team-text { who: 'kat'|'jayden'|'mark', body } — text a team member from the business line
// (cron secret). Number comes from phone_config, never from the request.
router.post('/team-text', express.json(), async (req, res) => {
  if (!wdGuard(req, res)) return
  try {
    const who = String(req.body?.who || '').toLowerCase(); const body = String(req.body?.body || '').trim()
    if (!['kat', 'jayden', 'mark'].includes(who) || !body) return res.status(400).json({ error: 'who (kat|jayden|mark) and body required' })
    const { resolvePhoneConfig } = await import('../services/phoneConfig.js'); const cfg = await resolvePhoneConfig(req)
    const to = cfg?.[`${who.toUpperCase()}_PHONE_NUMBER`] || process.env[`${who.toUpperCase()}_PHONE_NUMBER`] || ''
    if (!to) return res.status(400).json({ error: `no number on file for ${who}` })
    const { sendSMS } = await import('../services/comms.js')
    const r = await sendSMS(req, { to, body, category: 'team' })
    res.json({ ok: !!r.sent, who, to_last4: String(to).slice(-4), ...r })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// POST /tsb-post-test?id=<tsb id>&via=link — send a TSB bulletin to Mark's private alert channel (cron secret).
router.post('/tsb-post-test', async (req, res) => {
  if (!wdGuard(req, res)) return
  try {
    const T = await import('./tsb.js'); const { MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
    const all = await T.readAllTsbs(req); const tsb = all.find(t => String(t.id) === String(req.query.id)) || all.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
    if (!tsb) return res.status(404).json({ error: 'no TSBs' })
    res.json({ title: tsb.title, ...(await T.postTsbToChannel(req, tsb, { reason: 'update', channelId: MARK_ALERT_CHANNEL_ID })) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// POST /photo-scout?days=&max=&dry=1 — run the Photo Scout now (cron secret). dry=1 counts candidates, no AI spend.
router.post('/photo-scout', async (req, res) => {
  if (!wdGuard(req, res)) return
  if (req.query.rejudge === '1') { try { const { rejudgeHeld } = await import('../services/photoScout.js'); return res.json({ ok: true, ...(await rejudgeHeld(req, { max: Number(req.query.max) || 8 })) }) } catch (e) { return res.status(500).json({ error: e.message }) } }
  try { const { scout } = await import('../services/photoScout.js'); res.json({ ok: true, ...(await scout(req, { days: Math.min(Number(req.query.days) || 3, 3650), max: Math.min(Number(req.query.max) || 24, 60), dry: req.query.dry === '1' })) }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/workdrive/ops', async (req, res) => {
  if (!wdGuard(req, res)) return
  const ops = Array.isArray(req.body?.ops) ? req.body.ops : []
  if (!ops.length || ops.length > 300) return res.status(400).json({ error: 'ops: 1..300 required' })
  const t0 = Date.now(), results = []
  try {
    const { getAccessToken } = await import('../services/zoho.js'); const W = await import('../services/workdrive.js'); const token = await getAccessToken()
    const ref = v => { const m = /^\$(\d+)$/.exec(String(v || '')); return m ? (results[Number(m[1])]?.id || '') : String(v || '') }
    for (let i = 0; i < ops.length; i++) {
      if (Date.now() - t0 > 24000) break
      const o = ops[i] || {}
      try {
        if (o.op === 'mkdir') {
          const parent = ref(o.parent); const kids = await W.listChildren(parent, token, { folders: true })
          const hit = kids.find(k => k.name === String(o.name))
          if (hit) results.push({ i, op: 'mkdir', ok: true, id: hit.id, existed: true, name: o.name })
          else { const f = await W.createFolderUnder(parent, String(o.name), token); results.push({ i, op: 'mkdir', ok: !!f?.folderId, id: f?.folderId || '', name: o.name }) }
        } else if (o.op === 'move') { await W.moveFile(ref(o.id), ref(o.to), token); results.push({ i, op: 'move', ok: true, id: ref(o.id) }) }
        else if (o.op === 'rename') { await W.renameFile(ref(o.id), String(o.name), token); results.push({ i, op: 'rename', ok: true, id: ref(o.id) }) }
        else if (o.op === 'trash') { await W.trashFile(ref(o.id), token); results.push({ i, op: 'trash', ok: true, id: ref(o.id) }) }
        else results.push({ i, op: o.op, ok: false, error: 'unknown op' })
      } catch (e) { results.push({ i, op: o.op, ok: false, error: e.message.slice(0, 300) }) }
    }
    res.json({ ok: true, done: results.length, total: ops.length, ms: Date.now() - t0, results })
  } catch (e) { res.status(500).json({ error: e.message, results }) }
})

export default router
