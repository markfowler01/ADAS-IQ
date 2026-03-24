import express from 'express'
import axios from 'axios'

const router = express.Router()
const WORKDRIVE_API    = 'https://workdrive.zoho.com/api/v1'
const HISTORY_FOLDER_ID = 'fcnuh72b278dac80b4342a5396a1cf4d44baf'

let cachedToken = null
let tokenExpiresAt = 0

async function getAccessToken() {
  const now = Date.now()
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken

  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  })

  const res = await axios.post(
    'https://accounts.zoho.com/oauth/v2/token',
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )

  if (!res.data.access_token) throw new Error('Token refresh failed')
  cachedToken    = res.data.access_token
  tokenExpiresAt = now + (res.data.expires_in || 3600) * 1000
  return cachedToken
}

router.get('/', async (req, res) => {
  try {
    const token = await getAccessToken()

    const response = await axios.get(
      `${WORKDRIVE_API}/files/${HISTORY_FOLDER_ID}/files`,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          'Content-Type': 'application/vnd.api+json',
        },
        params: { sort_by: 'created_time', sort_order: 'DESC' },
      }
    )

    const items = response.data?.data || []

    const entries = items
      .filter((item) => item.attributes?.type === 'folder')
      .map((item) => {
        const name      = item.attributes?.name || ''
        const folderId  = item.id
        const createdAt = item.attributes?.created_time || null

        // Parse folder name: "{RO} — {Shop} — {Year Make Model}"
        const parts     = name.split(' — ')
        const roNumber  = parts[0]?.trim() || null
        const shop      = parts[1]?.trim() || null
        const vehicle   = parts[2]?.trim() || null

        return {
          name,
          roNumber,
          shop,
          vehicle,
          createdAt,
          folderUrl: `https://workdrive.zoho.com/folder/${folderId}`,
        }
      })

    res.json(entries)
  } catch (err) {
    console.error('[history]', err.response?.data || err.message)
    // If READ scope is missing, return a helpful message
    const msg = err.response?.data?.errors?.[0]?.title || err.message
    res.status(500).json({ error: msg })
  }
})

export default router
