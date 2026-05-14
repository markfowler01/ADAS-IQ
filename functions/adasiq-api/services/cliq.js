import axios from 'axios'

const ORG_ID = '883116359'
const CLIQ_BASE = `https://cliq.zoho.com/company/${ORG_ID}/api/v2`

// Technician/team name -> Zoho Cliq DM target (numeric user ID or email — buddies endpoint accepts both).
// Mark + Kat IDs from group discovery 2026-05-02. Jayden's prior ID (Test Technician 882215088) was an
// INACTIVE shell account; switched to his real email 2026-05-03 since Cliq's user-list API requires
// scopes we don't have.
export const TECH_CLIQ_IDS = {
  Mark:   858216366,
  Kat:    914153354,
  Kath:   914153354,
  Jaden:  'jayden@absoluteadas.com',
  Jayden: 'jayden@absoluteadas.com',
}

let cachedAccessToken = null
let accessExpiresAt = 0

async function getAccessToken() {
  const now = Date.now()
  if (cachedAccessToken && now < accessExpiresAt - 60000) return cachedAccessToken
  const refreshToken = process.env.ZOHO_CLIQ_REFRESH_TOKEN || process.env.ZOHO_TASKS_REFRESH_TOKEN || process.env.ZOHO_REFRESH_TOKEN
  if (!refreshToken) throw new Error('No Zoho refresh token for Cliq')
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: refreshToken,
  })
  const res = await axios.post('https://accounts.zoho.com/oauth/v2/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000,
  })
  if (!res.data.access_token) throw new Error('Cliq token refresh failed')
  cachedAccessToken = res.data.access_token
  accessExpiresAt = now + (res.data.expires_in || 3600) * 1000
  return cachedAccessToken
}

export async function postToCliqChannel(channelName, text) {
  const token = await getAccessToken()
  await axios.post(
    `${CLIQ_BASE}/channelsbyname/${encodeURIComponent(channelName)}/message`,
    { text },
    { headers: { 'Content-Type': 'application/json', Authorization: `Zoho-oauthtoken ${token}` }, timeout: 8000 }
  )
}

export async function postToCliqUser(userIdOrEmail, text) {
  const token = await getAccessToken()
  // Buddies endpoint accepts numeric user ID OR email; encode for safety on emails.
  const target = encodeURIComponent(String(userIdOrEmail))
  await axios.post(
    `${CLIQ_BASE}/buddies/${target}/message`,
    { text },
    { headers: { 'Content-Type': 'application/json', Authorization: `Zoho-oauthtoken ${token}` }, timeout: 8000 }
  )
}

export async function postToCliqChannelById(channelId, text) {
  const token = await getAccessToken()
  await axios.post(
    `${CLIQ_BASE}/channels/${channelId}/message`,
    { text },
    { headers: { 'Content-Type': 'application/json', Authorization: `Zoho-oauthtoken ${token}` }, timeout: 8000 }
  )
}
