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
      if (await hasScrubForFile(req, name)) return res.json({ skipped: 'already in the library', name })
      const { detectPdfKind } = await import('../services/claude.js')
      let kind = 'OTHER', make = ''
      try { ({ kind, make } = await detectPdfKind(req.file.buffer.toString('base64'))) } catch { kind = 'OTHER' }
      if (!['CCC', 'ESTIMATE'].includes(kind)) return res.json({ skipped: kind, name })   // estimates only; ABSOLUTE = our own report
      const { scrubPdfBuffer } = await import('./extract.js')
      const data = await scrubPdfBuffer(req, req.file.buffer, {
        learn: false, source: String(req.body?.source || 'downloads').slice(0, 30), by: 'Downloads sweep',
        file: { name }, pdfType: 'CCC', make,
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
router.get('/scrubs-export', async (req, res) => {
  const secret = process.env.CRM_SYNC_CRON_SECRET || 'crm-sync-2026'
  if (String(req.headers['x-cron-secret'] || '').trim() !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { listScrubs } = await import('../services/scrubStore.js')
    const { scrubs } = await listScrubs(req, { limit: 2000, maxScan: 4000 })
    const rows = scrubs.map(s => ({
      id: s.id, vin: s.vin, ro: s.ro, shop: s.shop, vehicle: s.vehicle, make: s.make, year: s.year, source: s.source, status: s.status, file: s.fileName || '', at: s.at,
      required: (s.sensors || []).filter(x => x.r).map(x => x.n),
      not_required: (s.sensors || []).filter(x => !x.r).map(x => x.n),
      detail: (s.sensors || []).map(x => ({ n: x.n, r: !!x.r, l: x.l || '', g: x.g || '' })),
    }))
    res.json({ count: rows.length, rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default router
