import axios from 'axios'
import { postToCliqChannelById } from './cliq.js'

const WORKDRIVE_API = 'https://workdrive.zoho.com/api/v1'
const PARENT_FOLDER_ID = '28exmfc33000b044047f18dc7f1617c730889'
const MARK_ALERT_CHANNEL_ID = 'P6015142000000718001'

/**
 * Create an external (no-login) public share link for an existing WorkDrive folder.
 * role_id 6 = External viewer — generates a workdrive.zohoexternal.com URL.
 * Throws if the API call fails so callers can decide how to handle it.
 * @param {string} folderId
 * @param {string} folderName  used as the link label in WorkDrive
 * @param {string} accessToken
 * @returns {string} public URL (zohoexternal.com)
 */
export async function createShareLink(folderId, folderName, accessToken) {
  const shareRes = await axios.post(
    `${WORKDRIVE_API}/links`,
    {
      data: {
        attributes: {
          resource_id:       folderId,
          link_name:         folderName,
          role_id:           '6',
          request_user_data: false,
          allow_download:    true,
        },
        type: 'links',
      },
    },
    {
      headers: {
        Authorization:  `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/vnd.api+json',
        'Accept':       'application/vnd.api+json',
      },
      timeout: 15000,
    }
  )
  const link = shareRes.data?.data?.attributes?.link
  console.log('[workdrive] createShareLink response:', JSON.stringify(shareRes.data?.data?.attributes))
  if (!link) throw new Error('WorkDrive returned no link URL in response')
  return link
}

/**
 * Create a folder in Zoho WorkDrive and return a shareable link.
 * @param {string} folderName  e.g. "RO-10492 — Prestige Auto Body — 2022 Toyota RAV4"
 * @param {string} accessToken  valid Zoho OAuth access token with WorkDrive scopes
 * @returns {{ folderId: string, folderUrl: string, shareLink: string }}
 */
export async function createJobFolder(folderName, accessToken) {
  // 1. Create the folder
  const createRes = await axios.post(
    `${WORKDRIVE_API}/files`,
    {
      data: {
        attributes: {
          name: folderName,
          parent_id: PARENT_FOLDER_ID,
        },
        type: 'files',
      },
    },
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/vnd.api+json',
      },
      timeout: 15000,
    }
  )

  const folder = createRes.data?.data
  if (!folder?.id) {
    console.error('[workdrive] Create folder response:', JSON.stringify(createRes.data))
    throw new Error('WorkDrive folder creation failed — no folder ID returned.')
  }

  const folderId = folder.id
  const folderUrl = `https://workdrive.zoho.com/folder/${folderId}`

  // 2. Create an external share link (no Zoho login required, view-only)
  let shareLink = folderUrl // fallback to direct URL if share creation fails
  try {
    const link = await createShareLink(folderId, folderName, accessToken)
    if (link) shareLink = link
  } catch (shareErr) {
    const errMsg = `⚠️ WorkDrive share link failed for "${folderName}" (folder ${folderId}). Link on invoice will be internal-only. Error: ${shareErr.message}`
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, errMsg).catch(e =>
      console.warn('[workdrive] Cliq alert failed:', e.message)
    )
  }

  return { folderId, folderUrl, shareLink }
}

/**
 * Search for a job folder in the parent folder by RO number.
 * Folder names look like: "24223 — L-M Body Shop, Inc. — 2024 Audi Q8 Premium Plus"
 * @param {string} roNumber  e.g. "24223"
 * @param {string} accessToken
 * @returns {{ folderId: string, folderName: string } | null}
 */
/**
 * Levenshtein distance between two strings (used for fuzzy RO matching).
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

/**
 * Extract the leading numeric RO part from a folder name.
 * "225916 — L-M Body Shop" → "225916"
 * "TWF 225916"             → "225916"
 * "ABS 20403"              → "20403"
 */
function extractFolderRO(folderName) {
  const m = folderName.match(/\b(\d{4,7})\b/)
  return m ? m[1] : null
}

/**
 * Search for a job folder in WorkDrive by RO number.
 * Returns { folderId, folderName, fuzzyMatch, fuzzyDistance } or null.
 * fuzzyMatch=true means the folder name didn't match exactly — the RO numbers
 * were close (within 2 edits) but not identical.
 */
export async function findFolderByRO(roNumber, accessToken) {
  // Collect all candidate folders from search + listing fallback
  let candidates = []

  // 1. Try WorkDrive search API (works regardless of total folder count)
  try {
    const searchRes = await axios.get(`${WORKDRIVE_API}/files/search`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      params: { search_str: roNumber, search_scope: 'team', type: 'folder' },
      timeout: 15000,
    })
    candidates = candidates.concat(searchRes.data?.data || [])
    console.log(`[workdrive] Search returned ${searchRes.data?.data?.length ?? 0} results for "${roNumber}"`)
  } catch (searchErr) {
    console.warn('[workdrive] Search API failed, falling back to listing:', searchErr.response?.data || searchErr.message)
  }

  // 2. Fallback: plain listing (capped at ~50, but covers cases where search misses)
  try {
    const listRes = await axios.get(`${WORKDRIVE_API}/files/${PARENT_FOLDER_ID}/files`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      timeout: 15000,
    })
    candidates = candidates.concat(listRes.data?.data || [])
  } catch (listErr) {
    console.warn('[workdrive] Listing fallback failed:', listErr.message)
  }

  // Deduplicate by folder id
  const seen = new Set()
  candidates = candidates.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })

  // 3. Exact match first
  for (const item of candidates) {
    const name = item.attributes?.name || ''
    if (name.startsWith(roNumber)) {
      console.log(`[workdrive] Exact match: "${name}"`)
      return { folderId: item.id, folderName: name, fuzzyMatch: false, fuzzyDistance: 0 }
    }
  }

  // 4. Fuzzy match — compare extracted numeric RO from folder name against roNumber
  let bestItem = null
  let bestDist = Infinity
  let bestFolderRO = null

  for (const item of candidates) {
    const name = item.attributes?.name || ''
    const folderRO = extractFolderRO(name)
    if (!folderRO || folderRO.length !== roNumber.length) continue
    const dist = levenshtein(roNumber, folderRO)
    if (dist < bestDist) {
      bestDist = dist
      bestItem = item
      bestFolderRO = folderRO
    }
  }

  // Accept fuzzy matches within 2 edits (catches transpositions, 1-2 wrong digits)
  if (bestItem && bestDist <= 2) {
    const name = bestItem.attributes?.name || ''
    console.warn(`[workdrive] Fuzzy match (dist ${bestDist}): searched "${roNumber}", matched folder RO "${bestFolderRO}" → "${name}"`)
    return { folderId: bestItem.id, folderName: name, fuzzyMatch: true, fuzzyDistance: bestDist, matchedRO: bestFolderRO }
  }

  return null
}

/**
 * Find a job folder by matching shop name and vehicle against folder names.
 * Scores each folder in the parent by how many words from shopName/vehicle appear in it.
 * Falls back to listing (up to ~50 folders) since WorkDrive search requires exact terms.
 */
export async function findFolderByShopVehicle(shopName, vehicle, accessToken) {
  if (!shopName && !vehicle) return null

  let candidates = []
  try {
    const listRes = await axios.get(`${WORKDRIVE_API}/files/${PARENT_FOLDER_ID}/files`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      timeout: 15000,
    })
    candidates = listRes.data?.data || []
  } catch (e) {
    console.warn('[workdrive] Listing failed in findFolderByShopVehicle:', e.message)
    return null
  }

  if (candidates.length === 0) return null

  function score(folderName) {
    const name = folderName.toLowerCase()
    let s = 0
    if (shopName) {
      const words = shopName.toLowerCase().split(/\W+/).filter(w => w.length > 2)
      for (const w of words) if (name.includes(w)) s += 2
    }
    if (vehicle) {
      const words = vehicle.toLowerCase().split(/\s+/).filter(w => w.length > 2)
      for (const w of words) if (name.includes(w)) s += 1
    }
    return s
  }

  let best = null
  let bestScore = 0
  for (const item of candidates) {
    const name = item.attributes?.name || ''
    const s = score(name)
    if (s > bestScore) { bestScore = s; best = item }
  }

  if (best && bestScore >= 2) {
    console.log(`[workdrive] Shop/vehicle match (score ${bestScore}): "${best.attributes?.name}"`)
    return { folderId: best.id, folderName: best.attributes?.name || '' }
  }
  return null
}

/**
 * Upload a file (Buffer) into a WorkDrive folder.
 * @param {string} folderId  destination folder ID
 * @param {string} filename  e.g. "Kinetic-Report.pdf"
 * @param {Buffer} buffer    file contents
 * @param {string} accessToken  Zoho OAuth token
 */
export async function uploadFileToFolder(folderId, filename, buffer, accessToken, mimeType = 'application/pdf') {
  const boundary = `----WorkDriveBoundary${Date.now()}`

  // Build multipart body manually — works in Node without extra deps
  const CRLF = '\r\n'
  const preamble = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="filename"`,
    '',
    filename,
    `--${boundary}`,
    `Content-Disposition: form-data; name="parent_id"`,
    '',
    folderId,
    `--${boundary}`,
    `Content-Disposition: form-data; name="override-name-exist"`,
    '',
    'true',
    `--${boundary}`,
    `Content-Disposition: form-data; name="content"; filename="${filename}"`,
    `Content-Type: ${mimeType}`,
    '',
    '',
  ].join(CRLF)

  const epilogue = `${CRLF}--${boundary}--${CRLF}`

  const body = Buffer.concat([
    Buffer.from(preamble, 'utf8'),
    buffer,
    Buffer.from(epilogue, 'utf8'),
  ])

  const res = await axios.post(
    `${WORKDRIVE_API}/upload`,
    body,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 30000,
      maxBodyLength: Infinity,
    }
  )

  // WorkDrive upload returns data as an array: [{attributes: {resource_id, ...}}]
  const fileData = Array.isArray(res.data?.data) ? res.data.data[0] : res.data?.data
  const fileId = fileData?.attributes?.resource_id || fileData?.id
  if (!fileId) {
    throw new Error(`WorkDrive upload failed: ${JSON.stringify(res.data)}`)
  }

  return { fileId }
}
