// TikTok posting stub.
//
// routes/captureCalculator.js imports { postPhotoToTikTok, tiktokConfigured }
// from this module. The real implementation was never checked into this
// environment (deployment inherited a broken import from an earlier branch).
// With no stub the whole adasiq-api function fails on startup with
// ERR_MODULE_NOT_FOUND, which takes the app offline entirely.
//
// This stub reports "not configured" so the calculator's TikTok fan-out
// takes its skip branch (see the `if (!tiktokConfigured()) { ... return ... }`
// guard in captureCalculator.js). No TikTok post ever fires, which matches
// current production behavior — the important thing is the rest of the app
// stays online.
//
// Replace with a real implementation when TikTok posting comes online.

export function tiktokConfigured() {
  return false
}

export async function postPhotoToTikTok(/* { imageUrl, caption } */) {
  throw new Error('TikTok posting is not configured in this environment (tikTokPosting stub).')
}
