import express from 'express'
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'
import { getAccessToken } from '../services/zoho.js'
import { uploadFileToFolder } from '../services/workdrive.js'

const router = express.Router()

const BACKUP_FOLDER_KEY = 'adas_iq_backup_folder_id'
const PARENT_FOLDER_ID  = '28exmfc33000b044047f18dc7f1617c730889'
const WORKDRIVE_API     = 'https://workdrive.zoho.com/api/v1'

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function readCache(segment, key) {
  try {
    const val = await segment.getValue(key)
    return val ? JSON.parse(val) : []
  } catch (e) {
    console.warn(`[backup] cache miss for ${key}:`, e.message)
    return []
  }
}

async function readDatastore(app, tableName) {
  try {
    const rows = await app.datastore().table(tableName).getAllRows()
    return Array.isArray(rows) ? rows : []
  } catch (e) {
    console.warn(`[backup] datastore read failed for ${tableName}:`, e.message)
    return []
  }
}

async function getOrCreateBackupFolder(segment, token) {
  // Try cached folder ID first
  try {
    const cachedId = await segment.getValue(BACKUP_FOLDER_KEY)
    if (cachedId && cachedId.trim()) return cachedId.trim()
  } catch (e) { /* not cached yet */ }

  // Create "ADAS IQ Backups" folder inside the parent WorkDrive folder
  const res = await axios.post(
    `${WORKDRIVE_API}/files`,
    { data: { attributes: { name: 'ADAS IQ Backups', parent_id: PARENT_FOLDER_ID }, type: 'files' } },
    { headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/vnd.api+json' }, timeout: 15000 }
  )
  const folderId = res.data?.data?.id
  if (!folderId) throw new Error('Could not create ADAS IQ Backups folder in WorkDrive')

  // Cache the folder ID so we don't recreate it next time
  try { await segment.put(BACKUP_FOLDER_KEY, folderId) } catch (e) {
    try { await segment.update(BACKUP_FOLDER_KEY, folderId) } catch { /* non-fatal */ }
  }

  console.log(`[backup] Created backup folder: ${folderId}`)
  return folderId
}

// ─── GET /api/backup/run ──────────────────────────────────────────────────────
// Protected by X-Cron-Secret (BACKUP_CRON_SECRET env var).
router.get('/run', async (req, res) => {
  const secret = process.env.BACKUP_CRON_SECRET
  if (secret && req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const app     = catalyst.initialize(req)
    const segment = app.cache().segment()

    console.log('[backup] Reading all data sources...')

    // Read CRM shops from Datastore (permanent storage)
    async function readShopsForBackup() {
      try {
        const shopsTable = app.datastore().table('CRMShops')
        const rows = await shopsTable.getAllRows()
        return (rows || []).map(r => {
          const s = r.CRMShops || r
          function parse(v) { try { return JSON.parse(v) } catch { return v } }
          return {
            id: String(s.ROWID || ''), shop_name: s.shop_name || '', contact_name: s.contact_name || '',
            phone: s.phone || '', email: s.email || '', address: s.address || '',
            pipeline_stage: s.pipeline_stage || '', notes: s.notes || '',
            last_contact: s.last_contact || '', next_followup: s.next_followup || '',
            estimated_monthly: s.estimated_monthly || '', region: s.region || '',
            assigned_to: s.assigned_to || '', people: typeof s.people === 'string' ? parse(s.people) : (s.people || []),
            activities: typeof s.activities === 'string' ? parse(s.activities) : (s.activities || []),
            created_at: s.created_at || '', shop_id: s.shop_id || '',
          }
        })
      } catch (e) {
        console.warn('[backup] Datastore read failed, falling back to cache:', e.message)
        // Fallback to cache
        try {
          const metaRaw = await segment.getValue('crm_shops_meta')
          if (metaRaw) {
            const { chunks } = JSON.parse(metaRaw)
            const parts = await Promise.all(
              Array.from({ length: chunks }, (_, i) =>
                segment.getValue(`crm_shops_chunk_${i}`).then(v => v ? JSON.parse(v) : []).catch(() => [])
              )
            )
            return parts.flat()
          }
        } catch {}
        return readCache(segment, 'crm_shops')
      }
    }

    // Read Books invoices — supports chunked format (books_invoices_meta + books_invoices_chunk_N)
    async function readInvoicesForBackup() {
      try {
        const metaRaw = await segment.getValue('books_invoices_meta')
        if (metaRaw) {
          const { chunks } = JSON.parse(metaRaw)
          const parts = await Promise.all(
            Array.from({ length: chunks }, (_, i) =>
              segment.getValue(`books_invoices_chunk_${i}`)
                .then(v => (v ? JSON.parse(v) : []))
                .catch(() => [])
            )
          )
          return parts.flat()
        }
      } catch (e) { /* fall through */ }
      return []
    }

    // Read everything in parallel
    const [crmShops, jobHistory, jobs, calRules, booksInvoices, booksServices, booksExpenses, booksDeposits, pinnedShops] = await Promise.all([
      readShopsForBackup(),
      readCache(segment, 'job_history'),
      readDatastore(app, 'Jobs'),
      readDatastore(app, 'AdasCalibrationRules'),
      readInvoicesForBackup(),
      readCache(segment, 'books_services'),
      readCache(segment, 'books_expenses'),
      readCache(segment, 'books_deposits'),
      readDatastore(app, 'PinnedShops'),
    ])

    // Read invoice counter (scalar, not array)
    let booksCounter = 0
    try {
      const cv = await segment.getValue('books_counter')
      if (cv) booksCounter = parseInt(cv, 10) || 0
    } catch (e) { /* not set yet */ }

    const backup = {
      timestamp:         new Date().toISOString(),
      crm_shops:         crmShops,
      job_history:       jobHistory,
      jobs:              jobs,
      calibration_rules: calRules,
      pinned_shops:      pinnedShops,
      books: {
        invoices:      booksInvoices,
        services:      Array.isArray(booksServices) ? booksServices : (booksServices || []),
        expenses:      Array.isArray(booksExpenses)  ? booksExpenses  : [],
        deposits:      Array.isArray(booksDeposits)  ? booksDeposits  : [],
        invoice_counter: booksCounter,
      },
      counts: {
        crm_shops:         Array.isArray(crmShops)       ? crmShops.length       : 0,
        job_history:       Array.isArray(jobHistory)     ? jobHistory.length     : 0,
        jobs:              Array.isArray(jobs)            ? jobs.length           : 0,
        calibration_rules: Array.isArray(calRules)       ? calRules.length       : 0,
        pinned_shops:      Array.isArray(pinnedShops)    ? pinnedShops.length    : 0,
        books_invoices:    Array.isArray(booksInvoices)  ? booksInvoices.length  : 0,
        books_expenses:    Array.isArray(booksExpenses)  ? booksExpenses.length  : 0,
        books_deposits:    Array.isArray(booksDeposits)  ? booksDeposits.length  : 0,
      },
    }

    // Upload to WorkDrive
    const token    = await getAccessToken()
    const folderId = await getOrCreateBackupFolder(segment, token)
    const date     = new Date().toISOString().split('T')[0]
    const filename = `ADAS-IQ-Backup-${date}.json`
    const buffer   = Buffer.from(JSON.stringify(backup, null, 2), 'utf8')

    await uploadFileToFolder(folderId, filename, buffer, token, 'application/json')

    console.log(`[backup] Saved ${filename} — shops: ${backup.counts.crm_shops}, jobs: ${backup.counts.jobs}, rules: ${backup.counts.calibration_rules}, history: ${backup.counts.job_history}, invoices: ${backup.counts.books_invoices}, expenses: ${backup.counts.books_expenses}`)

    res.json({ success: true, file: filename, counts: backup.counts })
  } catch (err) {
    console.error('[backup] Failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/backup/list — list backup files in WorkDrive ────────────────────
router.get('/list', async (req, res) => {
  const secret = process.env.BACKUP_CRON_SECRET
  if (secret && req.headers['x-cron-secret'] !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const app = catalyst.initialize(req)
    const segment = app.cache().segment()
    const token = await getAccessToken()
    const folderId = await getOrCreateBackupFolder(segment, token)
    const resp = await axios.get(`${WORKDRIVE_API}/files/${folderId}/files`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    })
    const files = (resp.data?.data || []).map(f => ({
      id: f.id,
      name: f.attributes?.name,
      size: f.attributes?.storage_info?.size,
      modified: f.attributes?.modified_time,
    })).sort((a, b) => (b.modified || '').localeCompare(a.modified || ''))
    res.json({ ok: true, files })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/backup/restore/:fileId — download a backup and restore CRM data ─
router.get('/restore/:fileId', async (req, res) => {
  const secret = process.env.BACKUP_CRON_SECRET
  if (secret && req.headers['x-cron-secret'] !== secret) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const token = await getAccessToken()
    // Download the backup file from WorkDrive
    const dlResp = await axios.get(`https://workdrive.zoho.com/api/v1/download/${req.params.fileId}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      responseType: 'arraybuffer',
    })
    const backup = JSON.parse(Buffer.from(dlResp.data).toString('utf8'))
    console.log('[backup] Restoring from backup:', backup.timestamp, 'shops:', backup.crm_shops?.length)

    const app = catalyst.initialize(req)
    const segment = app.cache().segment()
    const restored = {}

    // Restore CRM shops (chunked format)
    if (backup.crm_shops && backup.crm_shops.length > 0) {
      const CHUNK_SIZE = 15
      const chunks = []
      for (let i = 0; i < backup.crm_shops.length; i += CHUNK_SIZE) {
        chunks.push(backup.crm_shops.slice(i, i + CHUNK_SIZE))
      }
      for (let i = 0; i < chunks.length; i++) {
        const key = `crm_shops_chunk_${i}`
        const val = JSON.stringify(chunks[i])
        try { await segment.update(key, val) } catch { await segment.put(key, val) }
      }
      const meta = JSON.stringify({ chunks: chunks.length, total: backup.crm_shops.length })
      try { await segment.update('crm_shops_meta', meta) } catch { await segment.put('crm_shops_meta', meta) }
      restored.crm_shops = backup.crm_shops.length
    }

    // Restore job history
    if (backup.job_history && backup.job_history.length > 0) {
      const val = JSON.stringify(backup.job_history)
      try { await segment.update('job_history', val) } catch { await segment.put('job_history', val) }
      restored.job_history = backup.job_history.length
    }

    // Restore books data if present
    if (backup.books) {
      for (const key of ['invoices', 'services', 'expenses', 'deposits']) {
        if (backup.books[key]?.length > 0) {
          const cacheKey = `books_${key}`
          // Books invoices might be chunked
          if (key === 'invoices' && backup.books[key].length > 15) {
            const CHUNK_SIZE = 15
            const chunks = []
            for (let i = 0; i < backup.books[key].length; i += CHUNK_SIZE) {
              chunks.push(backup.books[key].slice(i, i + CHUNK_SIZE))
            }
            for (let i = 0; i < chunks.length; i++) {
              const ck = `books_invoices_chunk_${i}`
              const cv = JSON.stringify(chunks[i])
              try { await segment.update(ck, cv) } catch { await segment.put(ck, cv) }
            }
            const meta = JSON.stringify({ chunks: chunks.length, total: backup.books[key].length })
            try { await segment.update('books_invoices_meta', meta) } catch { await segment.put('books_invoices_meta', meta) }
          } else {
            const val = JSON.stringify(backup.books[key])
            try { await segment.update(cacheKey, val) } catch { await segment.put(cacheKey, val) }
          }
          restored[cacheKey] = backup.books[key].length
        }
      }
      if (backup.books.invoice_counter) {
        const val = String(backup.books.invoice_counter)
        try { await segment.update('books_counter', val) } catch { await segment.put('books_counter', val) }
      }
    }

    console.log('[backup] Restore complete:', restored)
    res.json({ ok: true, restored, timestamp: backup.timestamp })
  } catch (err) {
    console.error('[backup] Restore failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
