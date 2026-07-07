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

// Channels
// #technicians: Channel ID O6015142000000681005, Chat ID CT_1423989185010509377_883116359
export const TECHNICIANS_CHANNEL = 'technicians'
// Mark's personal alert channel (used instead of DM — self-DM blocked)
// Channel ID P6015142000000718001
export const MARK_ALERT_CHANNEL_ID = 'P6015142000000718001'

// AA Jobs — shared job-flow channel. All job lifecycle events (requested,
// needs-dispatch, dispatched, ready-invoice, invoice sent) fan into this
// one channel instead of DMing Mark / Kat / Jayden individually. Match by
// channel NAME so the ID isn't hardcoded to this specific Cliq workspace;
// posts go through postToCliqChannel(AA_JOBS_CHANNEL, msg).
// URL: https://cliq.zoho.com/company/883116359/channels/aajobs
export const AA_JOBS_CHANNEL = 'aajobs'

// Dispatch channel — requests (job + quote) fan into #dispatch in addition
// to #aajobs so the dispatch conversation stays with the people running
// the schedule, not buried in the shared jobs feed.
export const DISPATCH_CHANNEL = 'dispatch'

// Stub for a rich Cliq action-button. captureCalculator.js imports
// `cliqUrlButton(label, url, style?)` and passes the return value into
// message payloads that presumably support a `buttons` array. The real
// helper was never checked into this environment — its absence takes
// adasiq-api down with a SyntaxError on module load. Returning a plain
// text-link string keeps the calls alive; the button just renders as an
// inline link inside the Cliq message instead of a clickable action row.
// Restore the rich implementation when the source is recovered.
export function cliqUrlButton(label, url /* , style */) {
  return `[${label || 'Open'}](${url || ''})`
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
