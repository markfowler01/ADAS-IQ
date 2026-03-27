import express from 'express'
import axios from 'axios'

const router = express.Router()

// ── WorkDrive storage (same approach as jobs.js — shared across all users) ────
const WORKDRIVE_API   = 'https://workdrive.zoho.com/api/v1'
const FOLDER_ID       = process.env.WORKDRIVE_FOLDER_ID || '28exmfc33000b044047f18dc7f1617c730889'
const HISTORY_FILE    = 'adas-history.json'

let _cachedToken  = null
let _tokenExpiry  = 0
let _historyFileId = process.env.HISTORY_FILE_ID || null

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken
  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  })
  const res = await axios.post('https://accounts.zoho.com/oauth/v2/token', params)
  if (!res.data?.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(res.data))
  _cachedToken  = res.data.access_token
  _tokenExpiry  = Date.now() + (res.data.expires_in - 60) * 1000
  return _cachedToken
}

async function getHistoryFileId(token) {
  if (_historyFileId) return _historyFileId
  try {
    const res = await axios.get(
      `${WORKDRIVE_API}/files/${FOLDER_ID}/files`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: { sort_by: 'created_time', sort_order: 'DESC' },
      }
    )
    const files = res.data?.data || []
    const found = files.find(f => f.attributes?.name === HISTORY_FILE)
    if (found) { _historyFileId = found.id; return found.id }
  } catch (e) {
    console.warn('[history] folder list failed:', e.response?.data || e.message)
  }
  return null
}

async function readHistory() {
  try {
    const token  = await getAccessToken()
    const fileId = await getHistoryFileId(token)
    if (!fileId) return []
    const res = await axios.get(
      `${WORKDRIVE_API}/download/${fileId}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` }, responseType: 'text', timeout: 15000 }
    )
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    return JSON.parse(text)
  } catch (e) {
    if (e.response?.status === 404) {
      console.warn('[history] file not found — clearing cache')
      _historyFileId = null
    } else {
      console.error('[history] readHistory error:', e.response?.status, e.response?.data || e.message)
    }
    return []
  }
}

// Serialize writes to prevent race conditions
let _writeQueue = Promise.resolve()

async function _doWriteHistory(records) {
  const token    = await getAccessToken()
  const content  = JSON.stringify(records, null, 2)
  const buffer   = Buffer.from(content, 'utf8')
  const boundary = `----HistoryBoundary${Date.now()}`
  const CRLF     = '\r\n'

  const preamble = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="filename"`,
    '', HISTORY_FILE,
    `--${boundary}`,
    `Content-Disposition: form-data; name="parent_id"`,
    '', FOLDER_ID,
    `--${boundary}`,
    `Content-Disposition: form-data; name="override-name-exist"`,
    '', 'true',
    `--${boundary}`,
    `Content-Disposition: form-data; name="content"; filename="${HISTORY_FILE}"`,
    `Content-Type: application/json`,
    '', '',
  ].join(CRLF)

  const epilogue = `${CRLF}--${boundary}--${CRLF}`
  const body = Buffer.concat([Buffer.from(preamble, 'utf8'), buffer, Buffer.from(epilogue, 'utf8')])

  const res = await axios.post(
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
  const newId = res.data?.data?.[0]?.attributes?.resource_id || res.data?.data?.id
  _historyFileId = newId || null
  console.log('[history] write success, count:', records.length)
}

function writeHistory(records) {
  _writeQueue = _writeQueue.then(() => _doWriteHistory(records)).catch(() => _doWriteHistory(records))
  return _writeQueue
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/history
router.get('/', async (req, res) => {
  try {
    const records = await readHistory()
    res.json(records.slice().reverse())
  } catch (err) {
    console.error('[history GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/history
router.post('/', async (req, res) => {
  const entry = {
    id:           `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    shop:         req.body.shop        || '',
    vehicle:      req.body.vehicle     || '',
    roNumber:     req.body.roNumber    || '',
    vin:          req.body.vin         || '',
    calibrations: req.body.calibrations || [],
    estimateUrl:  req.body.estimateUrl || '',
    pdfUrl:       req.body.pdfUrl      || '',
    technician:   req.body.technician  || '',
    createdAt:    new Date().toISOString(),
  }

  const MAX_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const records = await readHistory()
      if (!records.find(r => r.id === entry.id)) records.push(entry)
      await writeHistory(records)
      return res.status(201).json(entry)
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error('[history POST] All retries failed:', err.message)
        return res.status(500).json({ error: err.message })
      }
      console.warn(`[history POST] attempt ${attempt} failed, retrying…`)
      await new Promise(r => setTimeout(r, 150 * attempt))
    }
  }
})

export default router
