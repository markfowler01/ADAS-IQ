import express from 'express'
import axios from 'axios'

const router = express.Router()
const CATALYST_API = 'https://api.catalyst.zoho.com'
const CACHE_KEY = 'history_records'

function getCatalystToken(req) {
  return req.headers['x-zc-admin-cred-token'] || req.headers['x-zc-user-cred-token'] || ''
}

function getProjectId(req) {
  return req.headers['x-zc-projectid'] || process.env.CATALYST_PROJECT_ID || ''
}

function authHeader(token) {
  return { Authorization: `Zoho-oauthtoken ${token}` }
}

async function readRecords(req) {
  const token = getCatalystToken(req)
  if (!token) return []
  const projectId = getProjectId(req)
  try {
    const res = await axios.get(
      `${CATALYST_API}/baas/v1/project/${projectId}/cache`,
      { headers: authHeader(token), params: { cacheKey: CACHE_KEY }, timeout: 10000 }
    )
    const val = res.data?.data?.cache_value
    return val ? JSON.parse(val) : []
  } catch (e) {
    if (e.response?.status === 404) return []
    console.error('[history] readRecords error:', e.response?.status, e.response?.data || e.message)
    return []
  }
}

async function writeRecords(records, req) {
  const token = getCatalystToken(req)
  if (!token) throw new Error('No Catalyst token available')
  const projectId = getProjectId(req)
  const url = `${CATALYST_API}/baas/v1/project/${projectId}/cache`
  const body = { cache_name: CACHE_KEY, cache_value: JSON.stringify(records), expiry_in_hours: null }
  const headers = { ...authHeader(token), 'Content-Type': 'application/json' }
  try {
    await axios.put(url, body, { headers, timeout: 10000 })
  } catch (e) {
    if (e.response?.status === 404) {
      await axios.post(url, body, { headers, timeout: 10000 })
    } else {
      throw e
    }
  }
}

// GET /api/history — returns all records newest first
router.get('/', async (req, res) => {
  try {
    const records = await readRecords(req)
    res.json(records.slice().reverse())
  } catch (err) {
    console.error('[history GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/history — log a new history entry (retries to reduce race window)
router.post('/', async (req, res) => {
  const entry = {
    id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    shop: req.body.shop || '',
    vehicle: req.body.vehicle || '',
    roNumber: req.body.roNumber || '',
    vin: req.body.vin || '',
    calibrations: req.body.calibrations || [],
    estimateUrl: req.body.estimateUrl || '',
    pdfUrl: req.body.pdfUrl || '',
    technician: req.body.technician || '',
    createdAt: new Date().toISOString(),
  }

  const MAX_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const records = await readRecords(req)
      // Deduplicate — skip if same id already present (retry scenario)
      if (!records.find(r => r.id === entry.id)) records.push(entry)
      await writeRecords(records, req)
      return res.status(201).json(entry)
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error('[history POST] All retries failed:', err.message)
        return res.status(500).json({ error: err.message })
      }
      console.warn(`[history POST] Write attempt ${attempt} failed, retrying…`)
      await new Promise(r => setTimeout(r, 150 * attempt))
    }
  }
})

export default router
