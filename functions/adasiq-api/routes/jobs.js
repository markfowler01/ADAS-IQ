import express from 'express'
import axios from 'axios'

const router = express.Router()

const WORKDRIVE_API = 'https://workdrive.zoho.com/api/v1'
const JOBS_FOLDER_ID = process.env.WORKDRIVE_FOLDER_ID || '28exmfc33000b044047f18dc7f1617c730889'
const JOBS_FILE_NAME = 'kanban-jobs.json'

// ─── Token Management ─────────────────────────────────────────────────────────
let _cachedToken = null
let _tokenExpiry = 0

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  })
  const res = await axios.post('https://accounts.zoho.com/oauth/v2/token', params)
  if (!res.data?.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(res.data))
  _cachedToken = res.data.access_token
  _tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000
  return _cachedToken
}

// ─── File ID Cache ────────────────────────────────────────────────────────────
let _jobsFileId = process.env.JOBS_FILE_ID || null

async function getJobsFileId(token) {
  if (_jobsFileId) return _jobsFileId
  // Search folder for the jobs file — sort newest first so we always get the latest version
  try {
    const res = await axios.get(
      `${WORKDRIVE_API}/files/${JOBS_FOLDER_ID}/files`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: { sort_by: 'created_time', sort_order: 'DESC' },
      }
    )
    const files = res.data?.data || []
    const found = files.find(f => f.attributes?.name === JOBS_FILE_NAME)
    if (found) { _jobsFileId = found.id; return found.id }
  } catch (e) {
    console.warn('[jobs] folder list failed:', e.response?.data || e.message)
  }
  return null
}

// ─── Read Jobs ────────────────────────────────────────────────────────────────
async function readJobs() {
  try {
    const token = await getAccessToken()
    const fileId = await getJobsFileId(token)
    if (!fileId) return []

    // Try WorkDrive v1 download endpoint
    const res = await axios.get(
      `${WORKDRIVE_API}/download/${fileId}`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        responseType: 'text',
        timeout: 15000,
      }
    )
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    return JSON.parse(text)
  } catch (e) {
    // If the file no longer exists, clear the cached ID so the next call re-discovers it
    if (e.response?.status === 404) {
      console.warn('[jobs] readJobs: file not found (404) — clearing cached file ID')
      _jobsFileId = null
    } else {
      console.error('[jobs] readJobs error:', e.response?.status, e.response?.data || e.message)
    }
    return []
  }
}

// ─── Write Jobs ───────────────────────────────────────────────────────────────

// Serialize all writes to prevent concurrent saves from overwriting each other
let _writeQueue = Promise.resolve()

// Track which dates we've already backed up (in-process guard)
const _backedUpDates = new Set()

async function _uploadFile(token, filename, content) {
  const buffer = Buffer.from(content, 'utf8')
  const boundary = `----JobsBoundary${Date.now()}`
  const CRLF = '\r\n'

  const preamble = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="filename"`,
    '',
    filename,
    `--${boundary}`,
    `Content-Disposition: form-data; name="parent_id"`,
    '',
    JOBS_FOLDER_ID,
    `--${boundary}`,
    `Content-Disposition: form-data; name="override-name-exist"`,
    '',
    'true',
    `--${boundary}`,
    `Content-Disposition: form-data; name="content"; filename="${filename}"`,
    `Content-Type: application/json`,
    '',
    '',
  ].join(CRLF)

  const epilogue = `${CRLF}--${boundary}--${CRLF}`
  const body = Buffer.concat([Buffer.from(preamble, 'utf8'), buffer, Buffer.from(epilogue, 'utf8')])

  return axios.post(
    `${WORKDRIVE_API}/upload`,
    body,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      maxBodyLength: Infinity,
      timeout: 30000,
    }
  )
}

async function _doWrite(jobs) {
  const token = await getAccessToken()
  const content = JSON.stringify(jobs, null, 2)

  // Daily backup — non-fatal if it fails
  const today = new Date().toISOString().slice(0, 10)
  if (!_backedUpDates.has(today)) {
    _backedUpDates.add(today)
    try {
      await _uploadFile(token, `kanban-jobs-backup-${today}.json`, content)
      console.log('[jobs] backup written for', today)
    } catch (e) {
      _backedUpDates.delete(today) // allow retry on next write
      console.warn('[jobs] backup failed (non-fatal):', e.message)
    }
  }

  // Primary write
  const res = await _uploadFile(token, JOBS_FILE_NAME, content)

  // Update cached file ID
  const newFileId = res.data?.data?.[0]?.attributes?.resource_id || res.data?.data?.id
  _jobsFileId = newFileId || null
  console.log('[jobs] writeJobs success, count:', jobs.length, 'fileId:', _jobsFileId)
}

function writeJobs(jobs) {
  // Chain onto the queue to serialize concurrent writes
  _writeQueue = _writeQueue.then(() => _doWrite(jobs)).catch(() => _doWrite(jobs))
  return _writeQueue
}

// ─── Debug ────────────────────────────────────────────────────────────────────
router.get('/debug', async (req, res) => {
  let tokenOk = false, fileId = null, readOk = false, jobCount = 0
  try {
    const token = await getAccessToken()
    tokenOk = true
    fileId = await getJobsFileId(token)
    const jobs = await readJobs()
    readOk = true
    jobCount = jobs.length
  } catch (e) {
    return res.json({ tokenOk, fileId, readOk, error: e.message })
  }
  res.json({ tokenOk, fileId, readOk, jobCount })
})

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/jobs
router.get('/', async (req, res) => {
  try {
    const jobs = await readJobs()
    res.json(jobs)
  } catch (err) {
    console.error('[jobs GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/jobs
router.post('/', async (req, res) => {
  try {
    const jobs = await readJobs()
    const newJob = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ...req.body,
      created_at: new Date().toISOString(),
    }
    jobs.push(newJob)
    await writeJobs(jobs)
    res.status(201).json(newJob)
  } catch (err) {
    console.error('[jobs POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/jobs/:id
router.put('/:id', async (req, res) => {
  try {
    const jobs = await readJobs()
    const idx = jobs.findIndex(j => j.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Job not found' })
    jobs[idx] = { ...jobs[idx], ...req.body, id: req.params.id }
    await writeJobs(jobs)
    res.json(jobs[idx])
  } catch (err) {
    console.error('[jobs PUT]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/jobs/:id
router.delete('/:id', async (req, res) => {
  try {
    const jobs = await readJobs()
    const filtered = jobs.filter(j => j.id !== req.params.id)
    await writeJobs(filtered)
    res.json({ success: true })
  } catch (err) {
    console.error('[jobs DELETE]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export { readJobs as readJobsPublic, writeJobs as writeJobsPublic }
export default router
