import axios from 'axios'

const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'
const CRM_API = 'https://www.zohoapis.com/crm/v6'

let cachedToken = null
let tokenExpiresAt = 0

async function getCrmAccessToken() {
  const now = Date.now()
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken

  const refreshToken = process.env.ZOHO_CRM_REFRESH_TOKEN
  if (!refreshToken) throw new Error('ZOHO_CRM_REFRESH_TOKEN not set. Generate one with ZohoCRM scopes. Current env keys: ' + Object.keys(process.env).filter(k => k.includes('ZOHO')).join(', '))

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: refreshToken,
  })

  const res = await axios.post(ZOHO_TOKEN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  })

  if (!res.data.access_token) throw new Error(`Zoho CRM token refresh failed: ${JSON.stringify(res.data)}`)

  cachedToken = res.data.access_token
  tokenExpiresAt = now + (res.data.expires_in || 3600) * 1000
  return cachedToken
}

function crmHeaders(token) {
  return { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }
}

/**
 * Search for an existing Lead by company name.
 */
export async function findLeadByName(companyName) {
  const token = await getCrmAccessToken()
  try {
    const res = await axios.get(`${CRM_API}/Leads/search`, {
      headers: crmHeaders(token),
      params: { criteria: `(Company:equals:${encodeURIComponent(companyName)})`, fields: 'Company,Phone,Email,Lead_Status,First_Name,Last_Name' },
      timeout: 10000,
    })
    return res.data?.data?.[0] || null
  } catch (e) {
    if (e.response?.status === 204 || e.response?.status === 404 || e.response?.status === 400) return null
    console.warn(`[zohoCrm] Lead search failed for "${companyName}":`, e.response?.status, e.response?.data?.message || e.message)
    return null
  }
}

/**
 * Create a Lead in Zoho CRM from an ADAS IQ shop.
 */
export async function createLead(shop) {
  const token = await getCrmAccessToken()
  const primaryContact = shop.people?.[0] || {}
  const [firstName, ...lastParts] = (primaryContact.name || shop.contact_name || 'Unknown').split(' ')

  const lead = {
    Company: shop.shop_name,
    First_Name: firstName || '',
    Last_Name: lastParts.join(' ') || shop.shop_name,
    Phone: shop.phone || primaryContact.phone || '',
    Email: shop.email || primaryContact.email || '',
    Street: shop.address || '',
    Lead_Source: shop.referral_source || 'ADAS IQ',
    Lead_Status: mapStageToLeadStatus(shop.pipeline_stage),
    Description: shop.notes || '',
  }

  const res = await axios.post(`${CRM_API}/Leads`, { data: [lead] }, {
    headers: crmHeaders(token),
    timeout: 10000,
  })

  const created = res.data?.data?.[0]
  if (created?.code !== 'SUCCESS') {
    console.error('[zohoCrm] Create lead failed:', created)
    throw new Error(created?.message || 'Failed to create lead')
  }

  console.log(`[zohoCrm] Created lead: ${shop.shop_name} → ${created.details?.id}`)
  return created.details?.id
}

/**
 * Update an existing Lead in Zoho CRM.
 */
export async function updateLead(leadId, shop) {
  const token = await getCrmAccessToken()
  const primaryContact = shop.people?.[0] || {}

  const lead = {
    id: leadId,
    Company: shop.shop_name,
    Phone: shop.phone || primaryContact.phone || '',
    Email: shop.email || primaryContact.email || '',
    Street: shop.address || '',
    Lead_Status: mapStageToLeadStatus(shop.pipeline_stage),
    Description: shop.notes || '',
  }

  const res = await axios.put(`${CRM_API}/Leads`, { data: [lead] }, {
    headers: crmHeaders(token),
    timeout: 10000,
  })

  console.log(`[zohoCrm] Updated lead: ${shop.shop_name} (${leadId})`)
  return res.data?.data?.[0]
}

/**
 * Convert a Lead to Account + Contact (when shop becomes Active).
 */
export async function convertLead(leadId) {
  const token = await getCrmAccessToken()
  const res = await axios.post(`${CRM_API}/Leads/${leadId}/actions/convert`, {
    data: [{ overwrite: true, notify_lead_owner: false, notify_new_entity_owner: false }],
  }, {
    headers: crmHeaders(token),
    timeout: 10000,
  })

  const result = res.data?.data?.[0]
  console.log(`[zohoCrm] Converted lead ${leadId}:`, result)
  return {
    accountId: result?.Accounts || null,
    contactId: result?.Contacts || null,
    dealId: result?.Deals || null,
  }
}

/**
 * Map ADAS IQ pipeline stage to Zoho CRM Lead Status.
 */
function mapStageToLeadStatus(stage) {
  const map = {
    target: 'Not Contacted',
    contacted: 'Contacted',
    interested: 'Contact in Future',
    proposal: 'Attempted to Contact',
    active: 'Converted',
    second_active: 'Converted',
    denied: 'Lost Lead',
    lost: 'Lost Lead',
  }
  return map[stage] || 'Not Contacted'
}

/**
 * Full sync: push all ADAS IQ shops to Zoho CRM as Leads.
 * - Creates new leads for shops not in CRM
 * - Updates existing leads with latest data
 * - Converts leads when shop moves to Active
 * Returns { created, updated, converted, errors }
 */
export async function syncAllShopsToZohoCrm(shops) {
  // Pre-warm the token so all operations use the cached one
  await getCrmAccessToken()

  let created = 0, updated = 0, converted = 0, errors = 0
  const errorDetails = []

  for (const shop of shops) {
    try {
      // Check if lead already exists
      const existing = await findLeadByName(shop.shop_name)

      if (existing) {
        // Update existing lead
        await updateLead(existing.id, shop)
        updated++

        // Convert to account if Active and not already converted
        if ((shop.pipeline_stage === 'active' || shop.pipeline_stage === 'second_active') && existing.Lead_Status !== 'Converted') {
          try {
            await convertLead(existing.id)
            converted++
          } catch (convErr) {
            console.warn(`[zohoCrm] Convert failed for ${shop.shop_name}:`, convErr.message)
          }
        }
      } else {
        // Create new lead
        const leadId = await createLead(shop)

        // If already active, convert immediately
        if (shop.pipeline_stage === 'active' || shop.pipeline_stage === 'second_active') {
          try {
            await convertLead(leadId)
            converted++
          } catch (convErr) {
            console.warn(`[zohoCrm] Convert failed for ${shop.shop_name}:`, convErr.message)
          }
        }
        created++
      }

      // Delay to avoid Zoho rate limits
      await new Promise(r => setTimeout(r, 500))
    } catch (e) {
      const detail = e.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : e.message
      console.error(`[zohoCrm] Sync failed for ${shop.shop_name}:`, detail)
      errorDetails.push(`${shop.shop_name}: ${detail}`)
      errors++
    }
  }

  return { created, updated, converted, errors, errorDetails: errorDetails.slice(0, 5) }
}

// ── Zoho CRM Tasks ────────────────────────────────────────────────

/**
 * Create a task in Zoho CRM.
 */
export async function createTask({ subject, dueDate, priority, description }) {
  const token = await getCrmAccessToken()
  const task = {
    Subject: subject,
    Due_Date: dueDate,
    Status: 'Not Started',
    Priority: priority || 'Normal',
    Description: description || '',
  }
  const res = await axios.post(`${CRM_API}/Tasks`, { data: [task] }, {
    headers: crmHeaders(token), timeout: 10000,
  })
  const created = res.data?.data?.[0]
  if (created?.code !== 'SUCCESS') throw new Error(created?.message || 'Failed to create task')
  console.log(`[zohoCrm] Created task: ${subject} → ${created.details?.id}`)
  return created.details?.id
}

/**
 * Update a task in Zoho CRM (e.g. mark as Completed).
 */
export async function updateTask(taskId, updates) {
  const token = await getCrmAccessToken()
  const res = await axios.put(`${CRM_API}/Tasks`, {
    data: [{ id: taskId, ...updates }],
  }, { headers: crmHeaders(token), timeout: 10000 })
  return res.data?.data?.[0]
}

/**
 * Delete a task from Zoho CRM.
 */
export async function deleteTask(taskId) {
  const token = await getCrmAccessToken()
  await axios.delete(`${CRM_API}/Tasks?ids=${taskId}`, {
    headers: crmHeaders(token), timeout: 10000,
  })
  console.log(`[zohoCrm] Deleted task: ${taskId}`)
}
