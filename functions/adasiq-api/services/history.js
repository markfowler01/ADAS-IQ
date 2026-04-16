import axios from 'axios'

const HISTORY_KEY  = 'job_history'
const CATALYST_API = 'https://api.catalyst.zoho.com'

function catalystHeaders(req) {
  const token = req.headers['x-zc-admin-cred-token'] || req.headers['x-zc-user-cred-token'] || ''
  return { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }
}

function catalystProjectId(req) {
  return req.headers['x-zc-projectid'] || process.env.CATALYST_PROJECT_ID || ''
}

export async function readHistory(req) {
  const url = `${CATALYST_API}/baas/v1/project/${catalystProjectId(req)}/cache/${HISTORY_KEY}`
  try {
    const r = await axios.get(url, { headers: catalystHeaders(req) })
    const val = r.data?.data?.cache_value
    return val ? JSON.parse(val) : []
  } catch (e) {
    if (e.response?.status === 404) return []
    throw e
  }
}

export async function writeHistory(req, records) {
  const projectId = catalystProjectId(req)
  const baseUrl   = `${CATALYST_API}/baas/v1/project/${projectId}/cache`
  const headers   = catalystHeaders(req)
  const body      = { cache_name: HISTORY_KEY, cache_value: JSON.stringify(records), expiry_in_hours: null }
  try {
    await axios.put(`${baseUrl}/${HISTORY_KEY}`, { cache_value: body.cache_value, expiry_in_hours: null }, { headers })
  } catch (e) {
    if (e.response?.status === 404) await axios.post(baseUrl, body, { headers })
    else throw e
  }
}

const HISTORY_DAYS = 30

export function pruneHistory(records) {
  const cutoff = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000
  return records.filter(r => new Date(r.createdAt).getTime() > cutoff)
}

export async function appendHistory(req, entry) {
  try {
    let records = []
    try { records = await readHistory(req) } catch {}
    if (!records.find(r => r.id === entry.id)) {
      records.push(entry)
    }
    await writeHistory(req, pruneHistory(records))
  } catch (e) {
    console.error('[history] appendHistory failed:', e.message)
  }
}
