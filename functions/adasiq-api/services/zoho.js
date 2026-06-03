import axios from 'axios'
import { createJobFolder, uploadFileToFolder } from './workdrive.js'
import { generateADASIQPdf } from './pdf.js'

const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'
const ZOHO_API_BASE = 'https://www.zohoapis.com/books/v3'  // Zoho Books
const ZOHO_EXPENSE_API = 'https://www.zohoapis.com/expense/v1'  // Zoho Expense

/**
 * Generate shop initials from a shop name.
 * e.g. "Avon Body Shop, LLC" → "ABS"
 *      "L-M Body Shop, Inc." → "LMBS"
 */
function getShopInitials(shopName) {
  if (!shopName) return ''
  const SKIP = new Set(['inc', 'llc', 'corp', 'ltd', 'co', 'the', 'and', 'llp', 'pc', 'dba'])
  return shopName
    .replace(/[,\.]/g, '')                        // strip commas/periods
    .split(/[\s\-–—]+/)                           // split on spaces and dashes
    .filter((w) => w.length > 0 && !SKIP.has(w.toLowerCase()))
    .map((w) => w[0].toUpperCase())
    .join('')
}

let cachedToken = null
let tokenExpiresAt = 0

export async function getAccessToken() {
  const now = Date.now()
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  })

  const res = await axios.post(ZOHO_TOKEN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  })

  if (!res.data.access_token) {
    throw new Error(`Zoho token refresh failed: ${JSON.stringify(res.data)}`)
  }

  cachedToken = res.data.access_token
  tokenExpiresAt = now + (res.data.expires_in || 3600) * 1000
  return cachedToken
}

function zohoHeaders(token) {
  return {
    Authorization: `Zoho-oauthtoken ${token}`,
    'Content-Type': 'application/json',
  }
}

function orgParam() {
  return { organization_id: process.env.ZOHO_ORGANIZATION_ID }
}

/**
 * Fetch a single customer's full record from Zoho Books, including
 * billing_address (which the list endpoint omits). Returns the contact object
 * or null on error.
 */
export async function getCustomerFull(contactId) {
  if (!contactId) return null
  try {
    const token = await getAccessToken()
    const res = await axios.get(`${ZOHO_API_BASE}/contacts/${contactId}`, {
      headers: zohoHeaders(token),
      params: orgParam(),
      timeout: 10000,
    })
    return res.data?.contact || null
  } catch (e) {
    console.warn('[zoho] getCustomerFull failed for', contactId, ':', e.message)
    return null
  }
}

/**
 * Pre-flight check used by every estimate creator. Confirms the picked
 * customer_id still maps to a real, non-deleted contact in Zoho Books.
 * Refusing to POST the estimate when this fails is what prevents a stale
 * contact_id from triggering Zoho's "auto-create contact from estimate"
 * fallback (which is how the Kinetic scrubber occasionally creates a new
 * L-M Body Shop entry).
 *
 * Returns true when verified, false otherwise. Never throws.
 */
export async function verifyCustomerExists(contactId) {
  if (!contactId) return false
  const contact = await getCustomerFull(contactId)
  return !!(contact && contact.contact_id)
}

/**
 * Fetch all customers from Zoho Books.
 * Returns array of { contact_id, contact_name, company_name, email, phone, mobile, billing_address }
 */
export async function listCustomers() {
  const token = await getAccessToken()
  let allContacts = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const res = await axios.get(`${ZOHO_API_BASE}/contacts`, {
      headers: zohoHeaders(token),
      params: { ...orgParam(), contact_type: 'customer', per_page: 200, page },
      timeout: 10000,
    })
    const contacts = res.data?.contacts || []
    allContacts = allContacts.concat(contacts.map((c) => ({
      contact_id:      c.contact_id,
      contact_name:    c.contact_name,
      company_name:    c.company_name    || '',
      email:           c.email           || '',
      phone:           c.phone           || '',
      mobile:          c.mobile          || '',
      status:          c.status          || 'active',
      billing_address: c.billing_address || {},
    })))
    hasMore = res.data?.page_context?.has_more_page === true
    page++
  }

  allContacts.sort((a, b) => a.contact_name.localeCompare(b.contact_name))
  return allContacts
}

// Words that carry no matching weight — do NOT include directional or technical
// terms like front/rear/left/right/static/dynamic/sensor — those are critical
// for distinguishing "Front Camera" from "Rear Camera" etc.
const STOP_WORDS = new Set([
  'the','a','an','and','or','of','for','with','in','at','to','from',
  'by','on','is','are','was','be','as','after',
])

/**
 * Strip vendor prefixes (AS -, SFP -, CP -), parenthetical abbreviations,
 * punctuation, and extra whitespace, then lowercase.
 */
function normalizeItemName(str) {
  return str
    .replace(/^(AS|SFP|CP|AS\s*-|SFP\s*-|CP\s*-)\s*/i, '') // strip leading prefixes
    .replace(/\([^)]*\)/g, '')   // remove (abbreviations)
    .replace(/[-–—_/]/g, ' ')   // dashes → space
    .replace(/[^a-z0-9 ]/gi, '') // strip remaining punctuation
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Return significant keywords from a string */
function keywords(str) {
  return normalizeItemName(str)
    .split(' ')
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
}

// Directional / type words that must match exactly if present in cal name
const CRITICAL_WORDS = new Set(['front','rear','left','right','static','dynamic','forward','backup','surround'])

/**
 * Score how well calName matches itemName.
 * Returns 0–1 (1 = perfect).
 * Critical words (front/rear/left/right etc.) cause a large penalty if they
 * appear in one name but not the other — prevents "Front Camera" → "Rear Camera".
 */
function matchScore(calName, itemName) {
  const calWords  = keywords(calName)
  const itemWords = new Set(keywords(itemName))
  if (calWords.length === 0 || itemWords.size === 0) return 0

  const hits = calWords.filter(w => itemWords.has(w)).length
  const union = new Set([...calWords, ...itemWords]).size
  let score = hits / union

  // Heavy penalty if a critical word appears in one name but not the other
  const calCritical  = calWords.filter(w => CRITICAL_WORDS.has(w))
  const itemCritical = [...itemWords].filter(w => CRITICAL_WORDS.has(w))
  for (const cw of calCritical) {
    if (!itemWords.has(cw)) score *= 0.2   // cal has "front", item doesn't
  }
  for (const iw of itemCritical) {
    if (!calWords.includes(iw)) score *= 0.2  // item has "rear", cal doesn't
  }

  return score
}

/**
 * Fetch all items from Zoho Books catalog.
 * Returns { exactMap, allItems } for both fast exact lookup and fuzzy matching.
 */
async function fetchItemCatalog(token) {
  let allItems = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const res = await axios.get(`${ZOHO_API_BASE}/items`, {
      headers: zohoHeaders(token),
      params: { ...orgParam(), per_page: 200, page },
      timeout: 10000,
    })
    const items = res.data?.items || []
    allItems = allItems.concat(items.map((i) => ({ item_id: i.item_id, name: i.name, rate: i.rate || 0 })))
    hasMore = res.data?.page_context?.has_more_page === true
    page++
  }

  // Exact-match map (normalized, no prefix strip needed — kept for safety)
  const exactMap = new Map()
  for (const item of allItems) {
    exactMap.set(item.name.trim().toLowerCase(), item.item_id)
    // Also index the prefix-stripped version
    exactMap.set(normalizeItemName(item.name), item.item_id)
  }

  return { exactMap, allItems }
}

/**
 * Exported version of fetchItemCatalog for use by the audit route.
 */
export async function getItemCatalogForAudit() {
  const token = await getAccessToken()
  return fetchItemCatalog(token)
}

/**
 * Detect insurer pricing prefix from insurer name.
 * State Farm → 'SF'  (items prefixed "SF -" or "SFP -")
 * Allstate   → 'AS'  (items prefixed "AS -")
 * Others     → null  (use standard/unprefixed items only)
 */
function getInsurerPrefix(insurer) {
  if (!insurer) return null
  const ins = insurer.toLowerCase()
  if (ins.includes('state farm')) return 'SF'
  if (ins.includes('allstate'))   return 'AS'
  return null
}

/**
 * Filter the item catalog pool based on insurer prefix.
 * - insurerPrefix 'SF' → only items starting with SF / SFP prefix
 * - insurerPrefix 'AS' → only items starting with AS prefix
 * - null              → exclude ALL prefixed items (regular pricing only)
 * Falls back to standard items if no prefixed items exist for that insurer.
 */
function filterItemsByInsurer(allItems, insurerPrefix) {
  const PREFIXED = /^(SF|SFP|AS|CP)\s*[-\s]/i

  if (insurerPrefix === 'SF') {
    const sfItems = allItems.filter(i => /^(SF|SFP)\s*[-\s]/i.test(i.name))
    if (sfItems.length > 0) return sfItems
    // No SF items in catalog — fall back to standard
    return allItems.filter(i => !PREFIXED.test(i.name))
  }

  if (insurerPrefix === 'AS') {
    const asItems = allItems.filter(i => /^AS\s*[-\s]/i.test(i.name))
    if (asItems.length > 0) return asItems
    // No AS items in catalog — fall back to standard
    return allItems.filter(i => !PREFIXED.test(i.name))
  }

  // Default: standard pricing — exclude ALL insurer-prefixed items
  return allItems.filter(i => !PREFIXED.test(i.name))
}

/**
 * Find the best matching Zoho item_id for a calibration name.
 * Returns { item_id, matchedName, score } or null if no confident match.
 * Exported so the audit route can reuse the same logic.
 */
export function findBestMatchExported(calName, exactMap, allItems, insurerPrefix = null) {
  return findBestMatch(calName, exactMap, allItems, insurerPrefix)
}

function findBestMatch(calName, exactMap, allItems, insurerPrefix = null) {
  // Filter candidate pool based on insurer (SF/AS/standard)
  const candidateItems = filterItemsByInsurer(allItems, insurerPrefix)

  // 1. Exact match first (within filtered pool)
  const exactKey = calName.trim().toLowerCase()
  const normalKey = normalizeItemName(calName)
  for (const item of candidateItems) {
    if (item.name.trim().toLowerCase() === exactKey || normalizeItemName(item.name) === normalKey) {
      return { item_id: item.item_id, matchedName: item.name, score: 1, rate: item.rate || 0 }
    }
  }

  // 2. Fuzzy match — score only within filtered candidate pool
  let bestScore = 0
  let bestItem = null
  for (const item of candidateItems) {
    const score = matchScore(calName, item.name)
    if (score > bestScore) {
      bestScore = score
      bestItem = item
    }
  }

  // Require at least 0.5 overlap to accept a match
  if (bestItem && bestScore >= 0.5) {
    return { item_id: bestItem.item_id, matchedName: bestItem.name, score: bestScore, rate: bestItem.rate || 0 }
  }

  return null
}

/**
 * Fetch all salespersons (users) from Zoho Books.
 * Returns array of { user_id, name, email }
 */
export async function listSalespersons() {
  const token = await getAccessToken()
  const res = await axios.get(`${ZOHO_API_BASE}/users`, {
    headers: zohoHeaders(token),
    params: { ...orgParam(), filter_by: 'Status.Active' },
    timeout: 10000,
  })
  const users = res.data?.users || []
  return users
    .map((u) => ({ user_id: u.user_id, name: u.name, email: u.email }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Create a draft quote (estimate) in Zoho Books.
 * Returns { quoteId, quoteNumber, quoteUrl }
 */
export async function createDraftQuote({
  customerId,
  customerName,
  salespersonId,
  salespersonName,
  shop,
  ro_number,
  vin,
  vehicle,
  year,
  make,
  model,
  insurer,
  claim,
  calibrations,
  pdfBase64,
  pdfFilename,
  notes: userNotes,
}) {
  const token = await getAccessToken()

  // 1. Fetch item catalog and build matched line items
  let exactMap = new Map()
  let allItems = []
  try {
    ;({ exactMap, allItems } = await fetchItemCatalog(token))
    console.log(`[zoho] Item catalog loaded: ${allItems.length} items`)
  } catch (catalogErr) {
    console.warn('[zoho] Could not load item catalog (non-fatal):', catalogErr.message)
  }

  // Fixed items — always included on every invoice
  const fixedNames = [
    'Calibration Identification Report',
    'Post Collision Safety Inspection 1 (L-M)',
    'Post-Scan (L-M)',
  ]
  console.log(`[zoho] Fixed items: ${fixedNames.join(', ')}`)

  const unmatchedItems = []
  const zeroPriceItems = []

  // Determine insurer-based pricing prefix (SF / AS / null)
  const insurerPrefix = getInsurerPrefix(insurer)
  console.log(`[zoho] Insurer: "${insurer || 'none'}" → prefix: ${insurerPrefix || 'standard'}`)

  function buildLineItem(name, description, quantity = 1) {
    const match = findBestMatch(name, exactMap, allItems, insurerPrefix)
    if (match) {
      console.log(`[zoho] ✓ "${name}" → "${match.matchedName}" (score ${match.score.toFixed(2)}, rate $${match.rate})`)
      if (!match.rate || match.rate === 0) {
        zeroPriceItems.push(match.matchedName || name)
        console.warn(`[zoho] ⚠ "${name}" matched but has $0 price in Zoho Books`)
      }
      return { item_id: match.item_id, description: description || '', quantity }
    } else {
      unmatchedItems.push(name)
      console.warn(`[zoho] ✗ No match for: "${name}" — will appear in quote notes`)
      return null
    }
  }

  // Fixed items first, then calibrations
  const fixedLineItems = fixedNames.map((name) => buildLineItem(name, '')).filter(Boolean)
  const calLineItems = calibrations.map((cal) => {
    // If the technician provided a description (e.g. Diagnostic 1 / Mechanical notes), use it directly
    let description = cal.description || ''
    if (!description) {
      const parts = []
      if (cal.trigger)         parts.push(`Trigger: ${cal.trigger}`)
      if (cal.line_references) parts.push(`Line Numbers: ${cal.line_references}`)
      if (cal.cal_type)        parts.push(`Type: ${cal.cal_type}`)
      if (cal.justification)   parts.push(cal.justification)
      description = parts.join('\n')
    }
    const quantity = cal.quantity || 1
    return buildLineItem(cal.calibration_name, description, quantity)
  }).filter(Boolean)
  const lineItems = [...fixedLineItems, ...calLineItems]

  if (unmatchedItems.length > 0) {
    console.warn('[zoho] Unmatched items (added to notes):', unmatchedItems)
  }

  // If nothing matched at all, warn but still try — Zoho will respond with its own error
  if (lineItems.length === 0) {
    console.warn('[zoho] No line items matched catalog — sending empty line items, Zoho will validate')
  }

  // 3. Notes — user story (manual invoice), then VIN, insurer, claim, plus any unmatched calibrations
  const notesLines = [
    userNotes ? userNotes.trim() : null,
    vin     ? `VIN: ${vin}`         : null,
    insurer ? `Insurer: ${insurer}` : null,
    claim   ? `Claim: ${claim}`     : null,
    unmatchedItems.length > 0
      ? `Items needing manual pricing:\n${unmatchedItems.map(n => `  - ${n}`).join('\n')}`
      : null,
  ].filter(Boolean)

  // 4. Custom fields — Year, Make, Model, RO#, VIN (WorkDrive link added after estimate created)
  console.log('[zoho] Custom field values — Year:', year, '| Make:', make, '| Model:', model, '| RO#:', ro_number, '| VIN:', vin)
  const baseCustomFields = [
    year       ? { label: 'Year',    value: year      } : null,
    make       ? { label: 'Make',    value: make      } : null,
    model      ? { label: 'Model',   value: model     } : null,
    ro_number  ? { label: 'RO#',     value: ro_number } : null,
    vin        ? { label: 'VIN',     value: vin       } : null,
    insurer    ? { label: 'Insurer', value: insurer   } : null,
  ].filter(Boolean)

  // Build estimate number: "{SHOP INITIALS} {RO NUMBER}" e.g. "ABS 20305"
  const initials = getShopInitials(customerName || shop)
  const estimateNumber = initials && ro_number
    ? `${initials} ${ro_number}`
    : ro_number || ''

  console.log(`[zoho] Estimate number: "${estimateNumber}" (initials="${initials}")`)

  const body = {
    estimate_number: estimateNumber,
    reference_number: ro_number || '',
    notes: notesLines.join('\n'),
    custom_fields: baseCustomFields,
    line_items: lineItems,
    status: 'draft',
  }

  // Never create a new Zoho Books customer. Always require an existing contact_id.
  // If no customer is selected the caller must provide one; reject rather than auto-create.
  if (!customerId) {
    throw new Error('Please select a Zoho Books customer before creating an estimate. Creating new customers from the app is disabled.')
  }
  // Pre-flight verify the picked contact still exists. A stale contact_id
  // (picker showed a customer that was deleted in Zoho) would otherwise risk
  // Zoho silently auto-creating a new contact under the wire.
  const verified = await verifyCustomerExists(customerId)
  if (!verified) {
    throw new Error(`Selected Zoho Books customer (id ${customerId}) no longer exists in Zoho. Refresh the customer dropdown and pick again. Creating new customers from the app is disabled.`)
  }
  body.customer_id = customerId
  // Defense-in-depth: never send customer_name. Zoho's estimate API can
  // auto-create a contact when customer_name appears in the body without a
  // matching customer_id, which is exactly what we are guarding against.
  delete body.customer_name
  if (salespersonName) body.salesperson_name = salespersonName

  // 4. Create the estimate — retry with .1, .2 etc. on duplicate number or unique field conflict
  let res
  let attempt = 0
  const MAX_ATTEMPTS = 10
  while (attempt < MAX_ATTEMPTS) {
    const suffix = attempt === 0 ? '' : `.${attempt}`
    const currentNumber = `${estimateNumber}${suffix}`
    const currentRO = `${ro_number || ''}${suffix}`

    if (attempt > 0) {
      console.log(`[zoho] Duplicate detected — retrying with estimate "${currentNumber}", RO# "${currentRO}"`)
    }

    body.estimate_number = currentNumber
    // Keep RO# custom field in sync so Zoho's unique constraint doesn't block us
    body.custom_fields = baseCustomFields.map((cf) =>
      cf.label === 'RO#' ? { ...cf, value: currentRO } : cf
    )

    try {
      res = await axios.post(`${ZOHO_API_BASE}/estimates`, body, {
        headers: zohoHeaders(token),
        params: orgParam(),
        timeout: 15000,
      })
    } catch (axiosErr) {
      const data = axiosErr.response?.data
      const zohoMsg = (typeof data === 'object' ? data?.message : null) || axiosErr.message
      const zohoCode = typeof data === 'object' ? data?.code : null
      console.error('[zoho] Estimate POST failed:', JSON.stringify(data || axiosErr.message))

      // Detect duplicate / unique-constraint error by Zoho code OR message
      const errMsg = zohoMsg.toLowerCase()
      const isAxiosDuplicate =
        zohoCode === 120303 ||                         // Zoho unique field constraint
        zohoCode === 1004 ||                           // Duplicate estimate number
        errMsg.includes('added already') ||
        errMsg.includes('already exists') ||
        errMsg.includes('already been used') ||
        errMsg.includes('unique value') ||
        errMsg.includes('duplicate')

      if (isAxiosDuplicate) {
        console.log(`[zoho] Duplicate on attempt ${attempt} (code ${zohoCode}) — will retry`)
        attempt++
        continue
      }

      const friendlyMsg = zohoMsg.toLowerCase().includes('greater than zero')
        ? 'Invoice total is $0 — make sure your Zoho Books items have prices set (Zoho Books → Items → edit each item → set Rate).'
        : `Zoho Books error: "${zohoMsg}"`
      throw new Error(friendlyMsg)
    }

    // Success
    if (res.data?.code === 0) break

    // Duplicate estimate number OR unique custom-field constraint (RO# already used)
    const resCode = res.data?.code
    const msg = res.data?.message?.toLowerCase() || ''
    const isDuplicate =
      resCode === 120303 ||
      resCode === 1004 ||
      msg.includes('added already') ||
      msg.includes('already exists') ||
      msg.includes('already been used') ||
      msg.includes('unique value') ||
      msg.includes('duplicate')

    if (isDuplicate) {
      console.log(`[zoho] Duplicate on attempt ${attempt} (code ${resCode}) — will retry`)
      attempt++
      continue
    }

    // Any other error — throw immediately
    console.error('[zoho] Non-zero code:', JSON.stringify(res.data))
    throw new Error(res.data?.message || `Zoho Books estimate failed (code ${res.data?.code})`)
  }

  if (!res || res.data?.code !== 0) {
    throw new Error(`Could not find a unique estimate number after ${MAX_ATTEMPTS} attempts.`)
  }

  const estimate = res.data.estimate
  const estimateId = estimate.estimate_id
  const orgId = process.env.ZOHO_ORGANIZATION_ID

  // 5. Now that the estimate exists, create the WorkDrive folder (once, guaranteed)
  const finalRO = estimate.estimate_number?.split(' ').pop() || ro_number // e.g. "24249.1"
  const folderName = [
    finalRO,
    shop,
    [year, make, model].filter(Boolean).join(' '),
  ].filter(Boolean).join(' — ')

  let workdriveResult = null
  try {
    workdriveResult = await createJobFolder(folderName, token)
    console.log('[workdrive] Folder created:', workdriveResult.folderUrl)
  } catch (wdErr) {
    console.warn('[workdrive] Folder creation failed (non-fatal):', wdErr.message)
  }

  // Upload the Kinetic PDF into the folder if provided
  if (workdriveResult?.folderId && pdfBase64) {
    try {
      const pdfBuffer = Buffer.from(pdfBase64, 'base64')
      const uploadName = pdfFilename || `Kinetic-Report-${finalRO}.pdf`
      await uploadFileToFolder(workdriveResult.folderId, uploadName, pdfBuffer, token)
      console.log('[workdrive] Kinetic PDF uploaded:', uploadName)
    } catch (uploadErr) {
      console.warn('[workdrive] Kinetic PDF upload failed (non-fatal):', uploadErr.message)
    }
  }

  // NOTE: ADAS IQ PDF report is now generated AFTER invoice creation (books.js from-job endpoint)
  // so it reflects the exact final invoice line items. Removed from here 2026-05-16.

  // 6. If we got a WorkDrive link, update the estimate's custom fields with it
  if (workdriveResult?.shareLink) {
    try {
      const updatedFields = [
        ...baseCustomFields.map((cf) =>
          cf.label === 'RO#' ? { ...cf, value: finalRO } : cf
        ),
        { label: 'Scan Report and Documentation', value: workdriveResult.shareLink },
      ]
      await axios.put(
        `${ZOHO_API_BASE}/estimates/${estimateId}`,
        { custom_fields: updatedFields },
        { headers: zohoHeaders(token), params: orgParam() }
      )
      console.log('[zoho] Estimate updated with WorkDrive link')
    } catch (updateErr) {
      console.warn('[zoho] Could not update estimate with WorkDrive link (non-fatal):', updateErr.message)
    }
  }

  return {
    quoteId: estimateId,
    quoteNumber: estimate.estimate_number,
    quoteUrl: `https://books.zoho.com/app#/estimates/${estimateId}?organization_id=${orgId}`,
    folderUrl: workdriveResult?.folderUrl || null,
    shareLink: workdriveResult?.shareLink || null,
    unmatchedItems: unmatchedItems.length > 0 ? unmatchedItems : null,
  }
}

/**
 * Update the "Scan Report and Documentation" custom field on a Zoho Books estimate.
 * Used by the refresh-share-link endpoint to fix broken WorkDrive links without
 * re-creating the whole estimate.
 */
export async function updateEstimateShareLink(estimateId, shareLink) {
  const token = await getAccessToken()
  await axios.put(
    `${ZOHO_API_BASE}/estimates/${estimateId}`,
    { custom_fields: [{ label: 'Scan Report and Documentation', value: shareLink }] },
    { headers: zohoHeaders(token), params: orgParam() }
  )
}

// Short tech name → full Zoho Books salesperson name. Jobs may store either form
// ("Jayden" from a column drag, "Jayden Goshorn" from the picker/Zoho sync).
const SALESPERSON_FULL_NAME = {
  mark:   'Mark Fowler',
  jayden: 'Jayden Goshorn',
  jaden:  'Jayden Goshorn',  // alias — old data may say "Jaden"
}

/**
 * Update the salesperson on a Zoho Books estimate. Called when a job's
 * technician is reassigned on the Kanban board, so Zoho stays in sync.
 * Normalizes short names to the full salesperson name Zoho Books expects.
 */
export async function updateEstimateSalesperson(estimateId, technicianName) {
  if (!estimateId || !technicianName) return
  const key = technicianName.trim().toLowerCase()
  const salespersonName = SALESPERSON_FULL_NAME[key] || technicianName
  const token = await getAccessToken()
  await axios.put(
    `${ZOHO_API_BASE}/estimates/${estimateId}`,
    { salesperson_name: salespersonName },
    { headers: zohoHeaders(token), params: orgParam() }
  )
}

/**
 * Fetch all estimates from Zoho Books (all statuses except void).
 * Returns array of estimate objects with custom fields parsed into cf_* keys.
 */
export async function listAllEstimates() {
  const token = await getAccessToken()
  const orgId = process.env.ZOHO_ORGANIZATION_ID
  let all = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const res = await axios.get(`${ZOHO_API_BASE}/estimates`, {
      headers: zohoHeaders(token),
      params: { ...orgParam(), per_page: 200, page },
      timeout: 15000,
    })
    const estimates = res.data?.estimates || []
    // Parse custom fields into a flat map for easy access
    const parsed = estimates.map(est => {
      const cf = {}
      ;(est.custom_fields || []).forEach(f => {
        const key = f.label?.toLowerCase().replace(/[^a-z0-9]/g, '_')
        if (key) cf[`cf_${key}`] = f.value
      })
      return {
        estimate_id: est.estimate_id,
        estimate_number: est.estimate_number,
        customer_name: est.customer_name,
        status: est.status, // draft, sent, accepted, declined, invoiced, void, expired
        salesperson_name: est.salesperson_name || '',
        quote_url: `https://books.zoho.com/app#/estimates/${est.estimate_id}?organization_id=${orgId}`,
        ...cf,
      }
    })
    all = all.concat(parsed)
    hasMore = res.data?.page_context?.has_more_page === true
    page++
  }

  return all
}

/**
 * Create a draft repair estimate in Zoho Books.
 * Uses raw line items (parts + labor) — no catalog matching needed.
 */
export async function createRepairDraftQuote({
  customerId, customerName, salespersonId, salespersonName,
  shop, ro_number, vin, vehicle, year, make, model, insurer, claim,
  parts, laborLines, laborRate, notes,
}) {
  const token = await getAccessToken()

  // Build line items from parts
  const lineItems = []
  for (const part of (parts || [])) {
    if (!part.name) continue
    const cost = parseFloat(part.cost) || 0
    const mult = parseFloat(part.multiplier) || 1
    const price = parseFloat(part.customerPrice) || cost * mult
    lineItems.push({
      name:     part.name,
      rate:     Math.round(price * 100) / 100,
      quantity: 1,
    })
  }

  // Labor line items (one per labor line)
  for (const line of (laborLines || [])) {
    const hrs = parseFloat(line.hours) || 0
    if (!hrs) continue
    lineItems.push({
      name:        line.description || 'Labor',
      description: `${hrs} flat rate ${hrs === 1 ? 'hour' : 'hours'} @ $${laborRate}/hr`,
      rate:        Math.round(hrs * laborRate * 100) / 100,
      quantity:    1,
    })
  }

  // Notes
  const notesLines = [
    notes   ? notes.trim()       : null,
    vin     ? `VIN: ${vin}`      : null,
    insurer ? `Insurer: ${insurer}` : null,
    claim   ? `Claim: ${claim}`  : null,
  ].filter(Boolean)

  // Custom fields
  const baseCustomFields = [
    year      ? { label: 'Year',    value: year      } : null,
    make      ? { label: 'Make',    value: make      } : null,
    model     ? { label: 'Model',   value: model     } : null,
    ro_number ? { label: 'RO#',     value: ro_number } : null,
    vin       ? { label: 'VIN',     value: vin       } : null,
    insurer   ? { label: 'Insurer', value: insurer   } : null,
  ].filter(Boolean)

  const initials      = getShopInitials(customerName || shop)
  const estimateNumber = initials && ro_number ? `${initials} ${ro_number}` : ro_number || ''

  const body = {
    estimate_number:  estimateNumber,
    reference_number: ro_number || '',
    notes:            notesLines.join('\n'),
    custom_fields:    baseCustomFields,
    line_items:       lineItems,
    status:           'draft',
  }
  // Never create a new Zoho Books customer. Require an existing contact_id.
  if (!customerId) {
    throw new Error('Please select a Zoho Books customer before creating an estimate. Creating new customers from the app is disabled.')
  }
  // Pre-flight verify the picked contact still exists. See createDraftQuote
  // for the rationale (stale picker IDs were silently creating duplicate
  // L-M Body Shop entries via Zoho's auto-fallback).
  const verifiedRepair = await verifyCustomerExists(customerId)
  if (!verifiedRepair) {
    throw new Error(`Selected Zoho Books customer (id ${customerId}) no longer exists in Zoho. Refresh the customer dropdown and pick again. Creating new customers from the app is disabled.`)
  }
  body.customer_id = customerId
  delete body.customer_name
  if (salespersonName) body.salesperson_name = salespersonName

  // Create with retry on duplicate number
  let res
  let attempt = 0
  const MAX_ATTEMPTS = 10

  while (attempt < MAX_ATTEMPTS) {
    const suffix        = attempt === 0 ? '' : `.${attempt}`
    const currentNumber = `${estimateNumber}${suffix}`
    const currentRO     = `${ro_number || ''}${suffix}`

    if (attempt > 0) {
      console.log(`[repair-estimate] Duplicate — retrying with "${currentNumber}"`)
    }

    body.estimate_number = currentNumber
    body.custom_fields   = baseCustomFields.map(cf =>
      cf.label === 'RO#' ? { ...cf, value: currentRO } : cf
    )

    try {
      res = await axios.post(`${ZOHO_API_BASE}/estimates`, body, {
        headers: zohoHeaders(token),
        params:  orgParam(),
        timeout: 15000,
      })
    } catch (axiosErr) {
      const data     = axiosErr.response?.data
      const zohoMsg  = (typeof data === 'object' ? data?.message : null) || axiosErr.message
      const zohoCode = typeof data === 'object' ? data?.code : null
      const errMsg   = zohoMsg.toLowerCase()
      const isDup    =
        zohoCode === 120303 || zohoCode === 1004 ||
        errMsg.includes('added already') || errMsg.includes('already exists') ||
        errMsg.includes('already been used') || errMsg.includes('unique value') ||
        errMsg.includes('duplicate')
      if (isDup) { attempt++; continue }
      throw new Error(`Zoho Books error: "${zohoMsg}"`)
    }

    if (res.data?.code === 0) break

    const resCode  = res.data?.code
    const msg      = res.data?.message?.toLowerCase() || ''
    const isDup    =
      resCode === 120303 || resCode === 1004 ||
      msg.includes('added already') || msg.includes('already exists') ||
      msg.includes('already been used') || msg.includes('unique value') ||
      msg.includes('duplicate')
    if (isDup) { attempt++; continue }

    throw new Error(res.data?.message || `Zoho Books estimate failed (code ${res.data?.code})`)
  }

  if (!res || res.data?.code !== 0) {
    throw new Error(`Could not find a unique estimate number after ${MAX_ATTEMPTS} attempts.`)
  }

  const estimate  = res.data.estimate
  const estimateId = estimate.estimate_id
  const orgId     = process.env.ZOHO_ORGANIZATION_ID

  return {
    quoteId:     estimateId,
    quoteNumber: estimate.estimate_number,
    quoteUrl:    `https://books.zoho.com/app#/estimates/${estimateId}?organization_id=${orgId}`,
  }
}

/**
 * Fetch full estimate details including line items.
 * Used by sync-quotes to populate calibrations on the job card.
 */
export async function getEstimateLineItems(estimateId) {
  const token = await getAccessToken()
  const orgId = process.env.ZOHO_ORGANIZATION_ID
  try {
    const res = await axios.get(`${ZOHO_API_BASE}/estimates/${estimateId}`, {
      headers: zohoHeaders(token),
      params: { organization_id: orgId },
      timeout: 10000,
    })
    const lineItems = res.data?.estimate?.line_items || []
    // Map to calibrations format: [{ name, mode }]
    // Skip purely administrative items
    const SKIP_ITEMS = new Set([
      'calibration identification report',
      'post-scan (l-m)',
      'post scan (l-m)',
      'post collision safety inspection 1 (l-m)',
    ])
    return lineItems
      .filter(item => item.name && !SKIP_ITEMS.has(item.name.toLowerCase()))
      .map(item => ({ name: item.name, mode: 'Static' }))
  } catch (err) {
    console.warn(`[zoho] Could not fetch line items for estimate ${estimateId}:`, err.message)
    return []
  }
}

// ── Vehicle Expense helpers ─────────────────────────────────────────────────

/**
 * Fetch expense accounts from Zoho Books (Chart of Accounts filtered to Expense type).
 * Returns [{ account_id, account_name }]
 */
export async function getExpenseAccounts() {
  const token = await getAccessToken()
  const res = await axios.get(`${ZOHO_API_BASE}/chartofaccounts`, {
    headers: zohoHeaders(token),
    params: { ...orgParam(), account_type: 'expense', filter_by: 'Status.Active' },
    timeout: 15000,
  })
  return (res.data?.chartofaccounts || []).map(a => ({
    account_id: a.account_id,
    account_name: a.account_name,
  }))
}

/**
 * Create an expense in Zoho Books.
 * @param {{ account_id, date, amount, description, reference_number, vehicle_name }} data
 * @returns {{ expense_id, expense_number }}
 */
export async function createExpense({ account_id, date, amount, description, reference_number, vehicle_name }) {
  const token = await getAccessToken()
  const body = {
    account_id,
    date,
    amount: Number(amount),
    description: description || '',
    reference_number: reference_number || '',
    is_billable: false,
  }
  // Add vehicle name as custom field or in description
  if (vehicle_name) {
    body.description = `[${vehicle_name}] ${body.description}`.trim()
  }

  const res = await axios.post(`${ZOHO_API_BASE}/expenses`, body, {
    headers: zohoHeaders(token),
    params: orgParam(),
    timeout: 15000,
  })

  const expense = res.data?.expense
  if (!expense?.expense_id) {
    console.error('[zoho] Create expense response:', JSON.stringify(res.data))
    throw new Error('Failed to create expense in Zoho Books')
  }

  console.log(`[zoho] Created expense ${expense.expense_id} — $${amount} for ${vehicle_name}`)
  return { expense_id: expense.expense_id, expense_number: expense.expense_number || '' }
}

// ── Zoho Expense — Mileage ──────────────────────────────────────────────────

/**
 * Fetch mileage expense reports from Zoho Expense.
 * Uses the Trip/Mileage endpoint: GET /trips or GET /expensereports with category filter.
 * @param {{ page, per_page }} opts
 * @returns {{ trips: Array, has_more: boolean }}
 */
export async function getMileageTrips({ page = 1, per_page = 50 } = {}) {
  const token = await getAccessToken()
  try {
    // Try the trips/mileage endpoint first
    const res = await axios.get(`${ZOHO_EXPENSE_API}/trips`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: {
        organization_id: process.env.ZOHO_ORGANIZATION_ID,
        page,
        per_page,
        sort_column: 'start_date',
        sort_order: 'D',
      },
      timeout: 15000,
    })
    const trips = res.data?.trips || []
    const pageContext = res.data?.page_context || {}
    console.log(`[zoho-expense] Fetched ${trips.length} trips (page ${page})`)
    return {
      trips: trips.map(t => ({
        trip_id: t.trip_id,
        trip_number: t.trip_number,
        start_date: t.start_date,
        end_date: t.end_date,
        destination: t.destination_place || t.destination || '',
        source: t.source_place || t.source || '',
        distance: t.distance || 0,
        unit: t.unit || 'mi',
        amount: t.total || t.amount || 0,
        status: t.status || '',
        description: t.description || '',
      })),
      has_more: pageContext.has_more_page || false,
    }
  } catch (err) {
    // If trips endpoint fails, try expense_reports with mileage filter
    console.warn('[zoho-expense] Trips endpoint failed, trying expense reports:', err.response?.status, err.response?.data?.message || err.message)

    try {
      const res = await axios.get(`${ZOHO_EXPENSE_API}/expensereports`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: {
          organization_id: process.env.ZOHO_ORGANIZATION_ID,
          page,
          per_page,
          sort_column: 'created_time',
          sort_order: 'D',
        },
        timeout: 15000,
      })
      const reports = res.data?.expense_reports || []
      console.log(`[zoho-expense] Fetched ${reports.length} expense reports`)
      return {
        trips: reports.map(r => ({
          trip_id: r.report_id,
          trip_number: r.report_number,
          start_date: r.start_date || r.created_date,
          end_date: r.end_date || '',
          destination: r.report_name || '',
          source: '',
          distance: r.mileage || 0,
          unit: 'mi',
          amount: r.total || 0,
          status: r.status || '',
          description: r.description || '',
        })),
        has_more: (res.data?.page_context?.has_more_page) || false,
      }
    } catch (err2) {
      console.error('[zoho-expense] Both endpoints failed:', err2.response?.status, err2.response?.data || err2.message)
      throw new Error(
        err2.response?.status === 401 || err2.response?.status === 403
          ? 'Zoho Expense access not authorized. Add ZohoExpense scopes to the OAuth client in api-console.zoho.com.'
          : `Failed to fetch mileage data: ${err2.response?.data?.message || err2.message}`
      )
    }
  }
}
