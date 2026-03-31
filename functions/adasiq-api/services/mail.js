import axios from 'axios'

const MAIL_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'
const MAIL_API = 'https://mail.zoho.com/api'

let cachedMailToken = null
let mailTokenExpiresAt = 0

export async function getMailAccessToken() {
  const now = Date.now()
  if (cachedMailToken && now < mailTokenExpiresAt - 60_000) return cachedMailToken

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_MAIL_REFRESH_TOKEN,
  })

  const res = await axios.post(MAIL_TOKEN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  })

  if (!res.data.access_token) {
    throw new Error(`Zoho Mail token refresh failed: ${JSON.stringify(res.data)}`)
  }

  cachedMailToken = res.data.access_token
  mailTokenExpiresAt = now + (res.data.expires_in || 3600) * 1000
  return cachedMailToken
}

function mailHeaders(token) {
  return { Authorization: `Zoho-oauthtoken ${token}` }
}

// Returns the accountId for the first account (Mark's primary account)
// Also returns full accounts list for diagnostics
export async function getMailAccountId(token) {
  const res = await axios.get(`${MAIL_API}/accounts`, {
    headers: mailHeaders(token),
    timeout: 10000,
  })
  const accounts = res.data?.data || []
  if (accounts.length === 0) throw new Error('No Zoho Mail accounts found')
  console.log(`[mail] Accounts (${accounts.length}): ${accounts.map(a => `${a.accountId}/${a.mailId}/${a.accountType}`).join(', ')}`)
  return accounts[0].accountId
}

// Returns all mail accounts (including group inboxes if they appear here)
export async function listAllMailAccounts(token) {
  const res = await axios.get(`${MAIL_API}/accounts`, {
    headers: mailHeaders(token),
    timeout: 10000,
  })
  return res.data?.data || []
}

// Find the postscan group inbox — returns groupId
// Uses the organization-level groups API (not account-level)
export async function findPostscanGroup(token, orgName = 'absoluteadas') {
  const res = await axios.get(`${MAIL_API}/organization/${orgName}/groups`, {
    headers: mailHeaders(token),
    timeout: 10000,
  })
  const groups = res.data?.data || []
  console.log(`[mail] Org groups (${groups.length}): ${groups.map(g => `${g.groupId}/${g.mailId}`).join(', ')}`)
  const group = groups.find(g =>
    g.mailId?.toLowerCase() === 'postscan@absoluteadas.com' ||
    g.groupName?.toLowerCase().includes('postscan') ||
    g.name?.toLowerCase().includes('postscan')
  )
  if (!group) {
    throw new Error(`postscan group not found. Available: ${JSON.stringify(groups.map(g => ({ id: g.groupId, mail: g.mailId, name: g.groupName || g.name })))}`)
  }
  return group.groupId
}

// Fetch unread messages from the group inbox (up to 20)
export async function getUnreadGroupMessages(token, accountId, groupId, orgName = 'absoluteadas') {
  const res = await axios.get(`${MAIL_API}/organization/${orgName}/groups/${groupId}/messages`, {
    headers: mailHeaders(token),
    params: { isread: false, limit: 20 },
    timeout: 15000,
  })
  return res.data?.data || []
}

// Fetch full message details (includes attachments array)
export async function getGroupMessage(token, groupId, messageId, orgName = 'absoluteadas') {
  const res = await axios.get(
    `${MAIL_API}/organization/${orgName}/groups/${groupId}/messages/${messageId}`,
    {
      headers: mailHeaders(token),
      timeout: 15000,
    }
  )
  return res.data?.data
}

// Download an attachment — returns Buffer
export async function downloadGroupAttachment(token, accountId, groupId, messageId, attachmentId, orgName = 'absoluteadas') {
  const res = await axios.get(
    `${MAIL_API}/organization/${orgName}/groups/${groupId}/messages/${messageId}/attachments/${attachmentId}`,
    {
      headers: mailHeaders(token),
      responseType: 'arraybuffer',
      timeout: 30000,
    }
  )
  return Buffer.from(res.data)
}

// Mark a group message as read
export async function markGroupMessageRead(token, accountId, groupId, messageId, orgName = 'absoluteadas') {
  await axios.put(
    `${MAIL_API}/organization/${orgName}/groups/${groupId}/messages/${messageId}`,
    { data: { isread: 'true' } },
    {
      headers: { ...mailHeaders(token), 'Content-Type': 'application/json' },
      timeout: 10000,
    }
  )
}
