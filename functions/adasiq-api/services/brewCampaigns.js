// Zoho Campaigns push integration for ADAS Brew.
// Stubbed: returns ok+queued unless ZOHO_CAMPAIGNS_ACCESS_TOKEN is set.
// When configured, creates a campaign + sends to the configured list.

import axios from 'axios'

const CAMPAIGNS_API = 'https://campaigns.zoho.com/api/v1.1'

function envBundle() {
  return {
    accessToken: process.env.ZOHO_CAMPAIGNS_ACCESS_TOKEN || '',
    refreshToken: process.env.ZOHO_CAMPAIGNS_REFRESH_TOKEN || '',
    clientId: process.env.ZOHO_CAMPAIGNS_CLIENT_ID || '',
    clientSecret: process.env.ZOHO_CAMPAIGNS_CLIENT_SECRET || '',
    listKey: process.env.ZOHO_CAMPAIGNS_LIST_KEY || '',
    fromEmail: process.env.ZOHO_CAMPAIGNS_FROM_EMAIL || 'brew@adas-iq.com',
    fromName: process.env.ZOHO_CAMPAIGNS_FROM_NAME || 'Mark @ ADAS Brew',
  }
}

function isConfigured() {
  const e = envBundle()
  return Boolean((e.accessToken || (e.refreshToken && e.clientId && e.clientSecret)) && e.listKey)
}

// Refresh OAuth access token via Zoho's refresh-token grant.
async function refreshAccessToken() {
  const e = envBundle()
  if (!e.refreshToken || !e.clientId || !e.clientSecret) {
    throw new Error('refresh token + client id/secret not configured')
  }
  const params = new URLSearchParams({
    refresh_token: e.refreshToken,
    client_id: e.clientId,
    client_secret: e.clientSecret,
    grant_type: 'refresh_token',
  })
  const res = await axios.post('https://accounts.zoho.com/oauth/v2/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  })
  if (!res.data?.access_token) {
    throw new Error('zoho oauth refresh returned no access_token')
  }
  return res.data.access_token
}

async function getAccessToken() {
  const e = envBundle()
  if (e.accessToken) return e.accessToken
  return refreshAccessToken()
}

/**
 * Send a digest as an immediate campaign.
 * Prefers `contentUrl` (Zoho fetches HTML from URL) over inline `html` because
 * Zoho's createCampaign htmlcontent param has a tight ~6KB limit.
 * @param {{ subject, html, contentUrl?, fromName, fromEmail, listKey }} payload
 * @returns {Promise<{ status: string, campaignKey?: string, dryRun?: boolean, error?: string }>}
 */
export async function sendCampaign(payload) {
  const subject = String(payload.subject || '').slice(0, 200)
  const html = String(payload.html || '')
  const contentUrl = String(payload.contentUrl || '')
  const e = envBundle()
  const fromName = payload.fromName || e.fromName
  const fromEmail = payload.fromEmail || e.fromEmail
  const listKey = payload.listKey || e.listKey

  if (!isConfigured()) {
    console.log(`[brew] DRY RUN — Zoho Campaigns not configured. Subject: "${subject}". Would send to list ${listKey || '<unset>'}.`)
    return { status: 'queued', dryRun: true }
  }

  let token
  try {
    token = await getAccessToken()
  } catch (err) {
    return { status: 'error', error: `oauth: ${err.message}` }
  }

  const headers = {
    Authorization: `Zoho-oauthtoken ${token}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  // Step 1: create the campaign.
  // Zoho Campaigns v1.1 API: from_email must be just the address; from_name separate.
  // Stick to ASCII for campaignname — non-ASCII chars trigger "Pattern doesn't Match" (code 1001).
  // campaignname is capped at 100 chars by Zoho.
  // Use multipart/form-data so large htmlcontent isn't rejected as "More than max length".
  // Zoho campaignname is strict: letters, digits, spaces, hyphens, underscores only.
  const today = new Date().toISOString().slice(0, 10)
  const safeSubject = String(subject).replace(/[^a-zA-Z0-9 \-_]/g, '').replace(/\s+/g, ' ').trim()
  const campaignname = `ADAS Brew ${today} ${safeSubject}`.replace(/\s+/g, ' ').trim().slice(0, 95)

  const params = new URLSearchParams()
  params.append('resfmt', 'JSON')
  params.append('campaignname', campaignname)
  params.append('from_email', fromEmail)
  params.append('from_name', fromName)
  params.append('subject', String(subject).slice(0, 100))
  params.append('list_details', JSON.stringify({ [listKey]: ['all'] }))

  if (contentUrl) {
    // Preferred path — Zoho fetches HTML from this URL during campaign creation
    params.append('content_url', contentUrl)
  } else {
    // Fallback — inline HTML, capped to ~6KB by Zoho
    const minified = String(html)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/>\s+</g, '><')
      .replace(/\s{2,}/g, ' ')
      .trim()
    params.append('htmlcontent', minified)
  }

  console.log('[brew zoho] createCampaign sizes:', {
    campaignname: campaignname.length,
    subject: String(subject).length,
    contentUrl: contentUrl || null,
    htmlInline: contentUrl ? 0 : html.length,
    totalForm: params.toString().length,
  })

  let campaignKey
  try {
    const createRes = await axios.post(
      `${CAMPAIGNS_API}/createCampaign`,
      params.toString(),
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: s => s < 500,
      }
    )
    if (createRes.data?.status !== 'success' || !createRes.data?.campaign_key) {
      return {
        status: 'error',
        error: `createCampaign: ${JSON.stringify(createRes.data).slice(0, 400)}`,
        sizes: { html: html.length, total: params.toString().length, contentUrl: contentUrl || null },
      }
    }
    campaignKey = createRes.data.campaign_key
  } catch (err) {
    return { status: 'error', error: `createCampaign: ${err.message}` }
  }

  // Step 2: send (sendcampaign endpoint may require a separate call)
  try {
    const sendParams = new URLSearchParams({ resfmt: 'JSON', campaignkey: campaignKey })
    const sendRes = await axios.post(
      `${CAMPAIGNS_API}/sendcampaign`,
      sendParams.toString(),
      { headers, timeout: 20000, validateStatus: s => s < 500 }
    )
    if (sendRes.data?.status !== 'success') {
      return { status: 'created_not_sent', campaignKey, error: `sendcampaign: ${JSON.stringify(sendRes.data).slice(0, 300)}` }
    }
    return { status: 'sent', campaignKey }
  } catch (err) {
    return { status: 'created_not_sent', campaignKey, error: `sendcampaign: ${err.message}` }
  }
}

export const campaignsConfigured = isConfigured
