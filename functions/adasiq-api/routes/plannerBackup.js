import express from 'express'
import axios from 'axios'
import { getAccessToken } from '../services/zoho.js'
import { uploadFileToFolder } from '../services/workdrive.js'

const router = express.Router()
const WORKDRIVE_API = 'https://workdrive.zoho.com/api/v1'

// Mark's personal WorkDrive root — we'll create/find a "530 Planner Backups" folder
const PERSONAL_TEAM_FOLDER = '28exmfc33000b044047f18dc7f1617c730889' // same parent as ADAS IQ backups

// Resolve the backup folder ONCE: exact-name lookup among the parent's children, cached in
// memory + Catalyst Cache. The old WorkDrive /files/search call returned nothing for this
// folder, so every save created a fresh folder and WorkDrive auto-suffixed it with a
// timestamp ("530 Planner Backups 13-06-2026 022322021"), 45+ junk folders by 2026-10-09.
let _plannerFolderId = ''
const PLANNER_FOLDER_KEY = 'planner_backup_folder_id'
async function getOrCreatePlannerFolder(token, req) {
  if (_plannerFolderId) return _plannerFolderId
  let segment = null
  try { const catalyst = (await import('zcatalyst-sdk-node')).default; segment = catalyst.initialize(req).cache().segment() } catch { /* no req scope */ }
  try { const c = segment ? await segment.getValue(PLANNER_FOLDER_KEY) : ''; if (c && c.trim()) return (_plannerFolderId = c.trim()) } catch { /* not cached */ }

  // Exact-name match among the parent's folders (oldest wins = the original folder).
  try {
    const { listChildren } = await import('../services/workdrive.js')
    const kids = await listChildren(PERSONAL_TEAM_FOLDER, token, { folders: true })
    const exact = kids.filter(k => k.name === '530 Planner Backups').sort((a, b) => Number(a.created || 0) - Number(b.created || 0))
    if (exact[0]) { _plannerFolderId = exact[0].id }
  } catch (e) { console.warn('[planner-backup] folder lookup failed:', e.message) }

  if (!_plannerFolderId) {
    const createResp = await axios.post(`${WORKDRIVE_API}/files`, {
      data: { attributes: { name: '530 Planner Backups', parent_id: PERSONAL_TEAM_FOLDER }, type: 'files' },
    }, { headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }, timeout: 10000 })
    _plannerFolderId = createResp.data?.data?.id || createResp.data?.data?.[0]?.id || ''
  }
  if (_plannerFolderId && segment) { try { await segment.put(PLANNER_FOLDER_KEY, _plannerFolderId, 48) } catch { try { await segment.update(PLANNER_FOLDER_KEY, _plannerFolderId, 48) } catch { /* non-fatal */ } } }
  return _plannerFolderId
}

// POST /api/planner-backup/save — save planner data to WorkDrive
router.post('/save', async (req, res) => {
  try {
    const { data } = req.body
    if (!data) return res.status(400).json({ error: 'No data provided' })

    const token = await getAccessToken()
    const folderId = await getOrCreatePlannerFolder(token, req)

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
    const folderId = await getOrCreatePlannerFolder(token, req)
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
