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
export async function getMailAccountId(token) {
  const res = await axios.get(`${MAIL_API}/accounts`, {
    headers: mailHeaders(token),
    timeout: 10000,
  })
  const accounts = res.data?.data || []
  if (accounts.length === 0) throw new Error('No Zoho Mail accounts found')
  console.log(`[mail] Accounts (${accounts.length}): ${accounts.map(a => a.accountId).join(', ')}`)
  return accounts[0].accountId
}

// Fetch unread messages from the SCAN REPORTS folder (folderId 147686000000057026).
// All postscan emails land here — directly readable from Mark's primary account.
const SCAN_REPORTS_FOLDER_ID = '147686000000057026'

// Zoho returns messageId as a bare JSON number > Number.MAX_SAFE_INTEGER.
// We must capture it as a string BEFORE JSON.parse truncates it.
function safeParseMailResponse(raw) {
  if (typeof raw !== 'string') return JSON.parse(raw)
  const fixed = raw.replace(/"messageId"\s*:\s*(\d+)/g, '"messageId":"$1"')
  return JSON.parse(fixed)
}

export async function getUnreadPostscanMessages(token, accountId) {
  const res = await axios.get(`${MAIL_API}/accounts/${accountId}/messages/view`, {
    headers: mailHeaders(token),
    params: { folderId: SCAN_REPORTS_FOLDER_ID, status: 'unread', limit: 50 },
    timeout: 15000,
    transformResponse: [safeParseMailResponse],
  })
  return res.data?.data || []
}

// Fetch the attachment list for a message.
// Correct Zoho Mail API: /accounts/{id}/folders/{fid}/messages/{mid}/attachmentinfo
// The folderId comes from the message listing (msg.folderId).
export async function getMessageAttachments(token, accountId, folderId, messageId) {
  const res = await axios.get(
    `${MAIL_API}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/attachmentinfo`,
    {
      headers: mailHeaders(token),
      timeout: 15000,
      transformResponse: [safeParseMailResponse],
    }
  )
  // Zoho may return data as array or object — normalise to array
  const data = res.data?.data
  if (!data) return []
  return Array.isArray(data) ? data : [data]
}

// Download an attachment — returns Buffer.
// Correct Zoho Mail API: /accounts/{id}/folders/{fid}/messages/{mid}/attachments/{aid}
export async function downloadAccountAttachment(token, accountId, folderId, messageId, attachmentId) {
  const res = await axios.get(
    `${MAIL_API}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/attachments/${attachmentId}`,
    {
      headers: mailHeaders(token),
      responseType: 'arraybuffer',
      timeout: 30000,
    }
  )
  return Buffer.from(res.data)
}

// Mark a message as read.
// Correct Zoho Mail API: PUT /accounts/{id}/folders/{fid}/messages/{mid}
export async function markAccountMessageRead(token, accountId, folderId, messageId) {
  await axios.put(
    `${MAIL_API}/accounts/${accountId}/folders/${folderId}/messages/${messageId}`,
    { isRead: 'true' },
    {
      headers: { ...mailHeaders(token), 'Content-Type': 'application/json' },
      timeout: 10000,
    }
  )
}
