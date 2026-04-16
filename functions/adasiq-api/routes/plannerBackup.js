import express from 'express'
import axios from 'axios'
import { getAccessToken } from '../services/zoho.js'
import { uploadFileToFolder } from '../services/workdrive.js'

const router = express.Router()
const WORKDRIVE_API = 'https://workdrive.zoho.com/api/v1'

// Mark's personal WorkDrive root — we'll create/find a "530 Planner Backups" folder
const PERSONAL_TEAM_FOLDER = '28exmfc33000b044047f18dc7f1617c730889' // same parent as ADAS IQ backups

async function getOrCreatePlannerFolder(token) {
  // Search for existing folder
  try {
    const searchResp = await axios.get(`${WORKDRIVE_API}/files/search`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { search_str: '530 Planner Backups', search_scope: 'team', type: 'folder' },
      timeout: 10000,
    })
    const found = (searchResp.data?.data || []).find(f => f.attributes?.name === '530 Planner Backups')
    if (found) return found.id
  } catch {}

  // Create new folder
  const createResp = await axios.post(`${WORKDRIVE_API}/files`, {
    data: { attributes: { name: '530 Planner Backups', parent_id: PERSONAL_TEAM_FOLDER }, type: 'files' },
  }, {
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
    timeout: 10000,
  })
  return createResp.data?.data?.id || createResp.data?.data?.[0]?.id
}

// POST /api/planner-backup/save — save planner data to WorkDrive
router.post('/save', async (req, res) => {
  try {
    const { data } = req.body
    if (!data) return res.status(400).json({ error: 'No data provided' })

    const token = await getAccessToken()
    const folderId = await getOrCreatePlannerFolder(token)

    const now = new Date()
    const filename = `530-Planner-Backup-${now.toISOString().slice(0, 10)}.json`
    const buffer = Buffer.from(JSON.stringify(data, null, 2), 'utf8')

    await uploadFileToFolder(folderId, filename, buffer, token, 'application/json')

    console.log(`[planner-backup] Saved ${filename} (${Math.round(buffer.length / 1024)}KB)`)
    res.json({ ok: true, file: filename, size: buffer.length })
  } catch (err) {
    console.error('[planner-backup] Save failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/planner-backup/list — list backup files
router.get('/list', async (req, res) => {
  try {
    const token = await getAccessToken()
    const folderId = await getOrCreatePlannerFolder(token)
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

// GET /api/planner-backup/restore/:fileId — download and return backup data
router.get('/restore/:fileId', async (req, res) => {
  try {
    const token = await getAccessToken()
    const dlResp = await axios.get(`https://workdrive.zoho.com/api/v1/download/${req.params.fileId}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      responseType: 'arraybuffer',
    })
    const data = JSON.parse(Buffer.from(dlResp.data).toString('utf8'))
    res.json({ ok: true, data })
  } catch (err) {
    console.error('[planner-backup] Restore failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
