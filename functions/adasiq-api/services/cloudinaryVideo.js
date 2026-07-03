// Cloudinary video conversion stub.
//
// routes/captureCalculator.js imports { imageToShortVideo, cloudinaryConfigured }
// from this module. The real implementation was never checked into this
// environment. With no stub the whole adasiq-api function fails on startup
// with ERR_MODULE_NOT_FOUND, which takes the app offline.
//
// This stub reports "not configured" so the calculator's video-conversion
// paths take their skip branches. No Cloudinary call ever fires, which
// matches current production behavior.

export function cloudinaryConfigured() {
  return false
}

export async function imageToShortVideo(/* { imageUrl, duration } */) {
  return { ok: false, error: 'Cloudinary video conversion is not configured in this environment (cloudinaryVideo stub).' }
}
