import axios from 'axios'

const WORKDRIVE_API = 'https://workdrive.zoho.com/api/v1'
const PARENT_FOLDER_ID = '28exmfc33000b044047f18dc7f1617c730889'

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

  // 2. Create a shareable link (view access, anyone with link)
  let shareLink = folderUrl // fallback to direct URL if share creation fails
  try {
    const shareRes = await axios.post(
      `${WORKDRIVE_API}/links`,
      {
        data: {
          attributes: {
            resource_id: folderId,
            resource_type: 'folder',
            link_type: 'open',       // anyone with the link
            permission_type: 'view', // view only
          },
          type: 'links',
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
    const link = shareRes.data?.data?.attributes?.link
    if (link) shareLink = link
  } catch (shareErr) {
    console.warn('[workdrive] Share link creation failed (non-fatal):', shareErr.response?.data?.errors || shareErr.message)
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
export async function findFolderByRO(roNumber, accessToken) {
  let offset = 0
  const limit = 100

  while (true) {
    const res = await axios.get(`${WORKDRIVE_API}/files/${PARENT_FOLDER_ID}/files`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      params: { limit, offset },
      timeout: 15000,
    })

    const items = res.data?.data || []
    for (const item of items) {
      const name = item.attributes?.name || ''
      if (name.startsWith(roNumber)) {
        return { folderId: item.id, folderName: name }
      }
    }

    // If fewer results than limit, we've reached the end
    if (items.length < limit) break
    offset += limit
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
export async function uploadFileToFolder(folderId, filename, buffer, accessToken) {
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
    `Content-Type: application/pdf`,
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

  const fileData = res.data?.data
  if (!fileData?.id) {
    throw new Error(`WorkDrive upload failed: ${JSON.stringify(res.data)}`)
  }

  return { fileId: fileData.id }
}
