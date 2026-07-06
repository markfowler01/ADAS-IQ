// Cloudinary image hosting — immediate-availability URLs for social publishing.
//
// WHY: social images were hosted via GitHub Pages commits, but Pages builds
// are rate-limited (~10/hour) and were taking 10+ minutes on busy days —
// Facebook/Instagram fetch the image at publish time and fail on 404
// ("Missing or invalid image file"). Cloudinary URLs are live the moment
// the upload returns.
//
// Uses the plain REST API with a signed upload — no SDK dependency.
// Credentials come from CLOUDINARY_URL (cloudinary://api_key:api_secret@cloud).

import crypto from 'crypto'
import axios from 'axios'

function parseCloudinaryUrl() {
  const raw = process.env.CLOUDINARY_URL || ''
  const m = raw.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/)
  if (!m) return null
  return { apiKey: m[1], apiSecret: m[2], cloudName: m[3] }
}

export function cloudinaryImageConfigured() {
  return Boolean(parseCloudinaryUrl())
}

/**
 * Upload an image buffer. Returns a permanently public, immediately live URL.
 * @param {Object} args
 * @param {Buffer} args.buffer
 * @param {string} [args.publicId] — stable id (e.g. "van-2026-07-06-mon"); reupload replaces
 * @returns {Promise<{ok: true, url: string} | {ok: false, error: string}>}
 */
export async function uploadImageToCloudinary({ buffer, publicId }) {
  const creds = parseCloudinaryUrl()
  if (!creds) return { ok: false, error: 'CLOUDINARY_URL not set/parseable' }
  try {
    const timestamp = Math.floor(Date.now() / 1000)
    // Signature: sha1 of the alphabetized param string + api_secret
    const params = { timestamp: String(timestamp) }
    if (publicId) params.public_id = publicId
    const toSign = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')
    const signature = crypto.createHash('sha1').update(toSign + creds.apiSecret).digest('hex')

    const form = new URLSearchParams()
    form.set('file', `data:image/jpeg;base64,${buffer.toString('base64')}`)
    form.set('api_key', creds.apiKey)
    form.set('timestamp', String(timestamp))
    if (publicId) form.set('public_id', publicId)
    form.set('signature', signature)

    const res = await axios.post(
      `https://api.cloudinary.com/v1_1/${creds.cloudName}/image/upload`,
      form.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 60000,
        maxBodyLength: 30 * 1024 * 1024,
        validateStatus: s => s < 500,
      }
    )
    if (res.status >= 400 || !res.data?.secure_url) {
      return { ok: false, error: `Cloudinary ${res.status}: ${JSON.stringify(res.data?.error || res.data).slice(0, 200)}` }
    }
    return { ok: true, url: res.data.secure_url }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}
