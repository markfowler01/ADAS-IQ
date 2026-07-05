// Van photo library — reads Mark's real van photos from a WorkDrive folder.
//
// Mark drops photos into the folder from his phone; the daily van-post cron
// picks one on rotation (least-recently-used first, tracked in cache) and
// feeds it to Gemini as the image-to-image reference so the REAL van appears
// in the generated scene.
//
// Folder (Mark created 2026-07-05):
//   https://workdrive.zoho.com/folder/0catccbe82bc6c3f243fc9c407f5d39a71b82

import axios from 'axios'
import { getAccessToken } from './zoho.js'

const WORKDRIVE_API = 'https://workdrive.zoho.com/api/v1'
export const VAN_PHOTOS_FOLDER_ID = '0catccbe82bc6c3f243fc9c407f5d39a71b82'

const IMAGE_EXT = /\.(jpe?g|png|heic|webp)$/i

/**
 * List image files in the van photos folder.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listVanPhotos() {
  const token = await getAccessToken()
  // WorkDrive /files/{id}/files does NOT accept query params (F6012) — plain GET.
  const res = await axios.get(`${WORKDRIVE_API}/files/${VAN_PHOTOS_FOLDER_ID}/files`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: 'application/vnd.api+json',
    },
    timeout: 15000,
    validateStatus: s => s < 500,
  })
  if (res.status >= 400) {
    throw new Error(`WorkDrive list failed: ${res.status} ${JSON.stringify(res.data?.errors || res.data).slice(0, 200)}`)
  }
  const items = Array.isArray(res.data?.data) ? res.data.data : []
  return items
    .filter(f => f.attributes?.type === 'file' || !f.attributes?.is_folder)
    .map(f => ({ id: String(f.id), name: String(f.attributes?.name || '') }))
    .filter(f => IMAGE_EXT.test(f.name))
}

/**
 * Download one photo as a Buffer.
 * @param {string} fileId
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
export async function downloadVanPhoto(fileId) {
  const token = await getAccessToken()
  const res = await axios.get(`${WORKDRIVE_API}/download/${fileId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: 30 * 1024 * 1024,
    validateStatus: s => s < 500,
  })
  if (res.status >= 400) {
    throw new Error(`WorkDrive download failed: ${res.status}`)
  }
  const mimeType = String(res.headers['content-type'] || 'image/jpeg').split(';')[0]
  return { buffer: Buffer.from(res.data), mimeType }
}

/**
 * Pick the next photo on rotation (least-recently-used).
 * Rotation state lives in cache key `van_photo_rotation` — a map of
 * fileId → lastUsedEpochMs. Unknown (new) photos sort first.
 *
 * @param {Object} segment — Catalyst cache segment (caller provides)
 * @param {Function} cacheGet — (segment, key, fallback) => value
 * @param {Function} cacheSet — (segment, key, value) => void
 * @returns {Promise<{id, name, buffer, mimeType} | null>} null if folder empty
 */
export async function pickNextVanPhoto(segment, cacheGet, cacheSet) {
  const photos = await listVanPhotos()
  if (!photos.length) return null

  const rotation = (await cacheGet(segment, 'van_photo_rotation', {})) || {}
  photos.sort((a, b) => (rotation[a.id] || 0) - (rotation[b.id] || 0))
  const chosen = photos[0]

  const { buffer, mimeType } = await downloadVanPhoto(chosen.id)

  rotation[chosen.id] = Date.now()
  // Prune rotation entries for photos that no longer exist (Mark deleted them)
  const liveIds = new Set(photos.map(p => p.id))
  for (const id of Object.keys(rotation)) {
    if (!liveIds.has(id)) delete rotation[id]
  }
  await cacheSet(segment, 'van_photo_rotation', rotation)

  return { ...chosen, buffer, mimeType }
}
