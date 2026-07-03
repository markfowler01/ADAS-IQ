// YouTube posting stub.
//
// routes/captureCalculator.js imports { postShortToYouTube, youtubeConfigured }
// from this module. The real implementation was never checked into this
// environment. With no stub the whole adasiq-api function fails on startup
// with ERR_MODULE_NOT_FOUND, which takes the app offline.
//
// This stub reports "not configured" so the calculator's YouTube fan-out
// takes its skip branch. No YouTube post ever fires, which matches current
// production behavior.

export function youtubeConfigured() {
  return false
}

export async function postShortToYouTube(/* opts */) {
  throw new Error('YouTube posting is not configured in this environment (youtubePosting stub).')
}
