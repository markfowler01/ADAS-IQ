import express from 'express'
import axios from 'axios'

const router = express.Router()

const PORTAL      = 'absoluteadasdotcom'
const PROJECT_ID  = '2519545000000938003'
const PROJECTS_API = `https://projectsapi.zoho.com/restapi/portal/${PORTAL}/projects/${PROJECT_ID}`

const TYPE_LABEL = {
  bug:         '🐛 Bug',
  improvement: '💡 Improvement',
  feature:     '⭐ Feature Request',
}

const TYPE_PRIORITY = {
  bug:         'Critical',
  improvement: 'Medium',
  feature:     'Low',
}

// Reuse same token pattern as rest of the app
let _cachedToken = null
let _tokenExpiry = 0

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken
  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_PROJECTS_REFRESH_TOKEN,
  })
  const res = await axios.post('https://accounts.zoho.com/oauth/v2/token', params, { timeout: 10000 })
  if (!res.data?.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(res.data))
  _cachedToken = res.data.access_token
  _tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000
  return _cachedToken
}

// POST /api/feedback
router.post('/', async (req, res) => {
  const { type = 'bug', title, description, reportedBy } = req.body

  if (!title?.trim()) {
    return res.status(400).json({ error: 'Title is required.' })
  }

  try {
    const token    = await getAccessToken()
    const label    = TYPE_LABEL[type]    || type
    const priority = TYPE_PRIORITY[type] || 'Medium'

    const descLines = [
      reportedBy    ? `Reported by: ${reportedBy}`   : null,
      description?.trim() ? `\n${description.trim()}` : null,
    ].filter(Boolean).join('\n')

    const body = new URLSearchParams()
    body.append('name',     `${label}: ${title.trim()}`)
    body.append('priority', priority)
    if (descLines) body.append('description', descLines)

    const zohoRes = await axios.post(
      `${PROJECTS_API}/tasks/`,
      body,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000,
      }
    )

    const task = zohoRes.data?.tasks?.[0]
    console.log('[feedback] Task created:', task?.id, task?.name)
    res.json({ ok: true, taskId: task?.id })
  } catch (e) {
    const msg = e.response?.data?.message || e.message
    console.error('[feedback] Failed to create task:', msg)

    // Surface scope errors clearly
    if (e.response?.status === 401 || e.response?.status === 403) {
      return res.status(403).json({
        error: 'Zoho Projects access denied. Add ZohoProjects.tasks.CREATE scope to your server OAuth token and re-deploy.',
      })
    }

    res.status(500).json({ error: msg || 'Failed to submit feedback.' })
  }
})

export default router
