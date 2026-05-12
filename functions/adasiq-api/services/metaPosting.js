// Meta (Facebook Page + Instagram Business) posting for ADAS Brew.
// Single Page Access Token authorizes both — the IG Business account
// is linked to the FB Page, so Graph API treats them as one auth context.
//
// Required env vars:
//   FB_PAGE_ID                 — numeric Page ID (e.g. 715304948324709)
//   FB_PAGE_ACCESS_TOKEN       — long-lived Page Access Token (never expires
//                                while the issuing user remains a Page admin)
//   IG_BUSINESS_USER_ID        — Instagram Business User ID linked to the Page
//
// All three are derived once via developers.facebook.com tools and never
// need refreshing.

import axios from 'axios'

const GRAPH_API = 'https://graph.facebook.com/v22.0'

function envBundle() {
  return {
    pageId: process.env.FB_PAGE_ID || '',
    pageToken: process.env.FB_PAGE_ACCESS_TOKEN || '',
    igUserId: process.env.IG_BUSINESS_USER_ID || '',
  }
}

export function facebookConfigured() {
  const e = envBundle()
  return Boolean(e.pageId && e.pageToken)
}

export function instagramConfigured() {
  const e = envBundle()
  return Boolean(e.igUserId && e.pageToken)
}

/**
 * Post an image + caption to the Facebook Page.
 *
 * @param {Object} args
 * @param {string} args.imageUrl — publicly-fetchable image URL (FB downloads it)
 * @param {string} args.caption — post caption text
 * @returns {Promise<{ok: true, id: string} | {ok: false, error: string}>}
 */
export async function postToFacebookPage({ imageUrl, caption }) {
  if (!facebookConfigured()) {
    return { ok: false, error: 'FB_PAGE_ID or FB_PAGE_ACCESS_TOKEN not set' }
  }
  const { pageId, pageToken } = envBundle()
  try {
    const res = await axios.post(
      `${GRAPH_API}/${pageId}/photos`,
      null,
      {
        params: {
          url: imageUrl,
          caption: String(caption || '').slice(0, 5000),
          access_token: pageToken,
        },
        timeout: 25000,
        validateStatus: s => s < 500,
      }
    )
    if (res.status >= 400 || res.data?.error) {
      return {
        ok: false,
        error: res.data?.error?.message || `HTTP ${res.status}`,
      }
    }
    return { ok: true, id: res.data?.post_id || res.data?.id }
  } catch (e) {
    return { ok: false, error: e.message || 'request failed' }
  }
}

/**
 * Post a comment on an existing Facebook Page post.
 *
 * @param {Object} args
 * @param {string} args.postId — page-scoped post ID (format: "{page-id}_{post-id}")
 * @param {string} args.message — comment text
 * @returns {Promise<{ok: true, id: string} | {ok: false, error: string}>}
 */
export async function commentOnFacebookPost({ postId, message }) {
  if (!facebookConfigured()) {
    return { ok: false, error: 'FB not configured' }
  }
  if (!postId) {
    return { ok: false, error: 'postId required' }
  }
  const { pageToken } = envBundle()
  try {
    const res = await axios.post(
      `${GRAPH_API}/${postId}/comments`,
      null,
      {
        params: { message: String(message || '').slice(0, 8000), access_token: pageToken },
        timeout: 20000,
        validateStatus: s => s < 500,
      }
    )
    if (res.status >= 400 || res.data?.error) {
      return { ok: false, error: res.data?.error?.message || `HTTP ${res.status}` }
    }
    return { ok: true, id: res.data?.id }
  } catch (e) {
    return { ok: false, error: e.message || 'request failed' }
  }
}

/**
 * Post a comment on an existing Instagram Business media post.
 * Requires `instagram_manage_comments` permission, which the current app
 * scope may not have — returns a clear error if so. Caller should treat
 * failure as non-fatal.
 *
 * @param {Object} args
 * @param {string} args.mediaId — IG media ID returned from postToInstagram
 * @param {string} args.message — comment text
 */
export async function commentOnInstagramMedia({ mediaId, message }) {
  if (!instagramConfigured()) {
    return { ok: false, error: 'IG not configured' }
  }
  if (!mediaId) {
    return { ok: false, error: 'mediaId required' }
  }
  const { pageToken } = envBundle()
  try {
    const res = await axios.post(
      `${GRAPH_API}/${mediaId}/comments`,
      null,
      {
        params: { message: String(message || '').slice(0, 2200), access_token: pageToken },
        timeout: 20000,
        validateStatus: s => s < 500,
      }
    )
    if (res.status >= 400 || res.data?.error) {
      return { ok: false, error: res.data?.error?.message || `HTTP ${res.status}` }
    }
    return { ok: true, id: res.data?.id }
  } catch (e) {
    return { ok: false, error: e.message || 'request failed' }
  }
}

/**
 * Read recent comments on a Facebook Page post.
 *
 * @param {Object} args
 * @param {string} args.postId
 * @param {number} [args.limit=100]
 * @returns {Promise<{ok: true, comments: Array} | {ok: false, error: string}>}
 */
export async function readFacebookPostComments({ postId, limit = 100 }) {
  if (!facebookConfigured()) {
    return { ok: false, error: 'FB not configured' }
  }
  const { pageToken } = envBundle()
  try {
    const res = await axios.get(
      `${GRAPH_API}/${postId}/comments`,
      {
        params: {
          fields: 'id,message,created_time,from{id,name}',
          limit,
          access_token: pageToken,
          order: 'reverse_chronological',
        },
        timeout: 15000,
        validateStatus: s => s < 500,
      }
    )
    if (res.status >= 400 || res.data?.error) {
      return { ok: false, error: res.data?.error?.message || `HTTP ${res.status}` }
    }
    return { ok: true, comments: res.data?.data || [] }
  } catch (e) {
    return { ok: false, error: e.message || 'request failed' }
  }
}

/**
 * List recent Page posts (used by the comment-watcher to scan for replies).
 *
 * @param {Object} [args]
 * @param {number} [args.limit=10]
 * @returns {Promise<{ok: true, posts: Array} | {ok: false, error: string}>}
 */
export async function listFacebookPagePosts({ limit = 10 } = {}) {
  if (!facebookConfigured()) {
    return { ok: false, error: 'FB not configured' }
  }
  const { pageId, pageToken } = envBundle()
  try {
    const res = await axios.get(
      `${GRAPH_API}/${pageId}/posts`,
      {
        params: {
          fields: 'id,message,created_time',
          limit,
          access_token: pageToken,
        },
        timeout: 15000,
        validateStatus: s => s < 500,
      }
    )
    if (res.status >= 400 || res.data?.error) {
      return { ok: false, error: res.data?.error?.message || `HTTP ${res.status}` }
    }
    return { ok: true, posts: res.data?.data || [] }
  } catch (e) {
    return { ok: false, error: e.message || 'request failed' }
  }
}

/**
 * Post an image + caption to the Instagram Business account. Two-step:
 *   1. POST /{ig-user-id}/media        → creates a media container
 *   2. POST /{ig-user-id}/media_publish → publishes the container
 *
 * @param {Object} args
 * @param {string} args.imageUrl — publicly-fetchable image URL
 * @param {string} args.caption  — post caption (≤ 2200 chars, includes hashtags)
 * @returns {Promise<{ok: true, id: string} | {ok: false, error: string, step?: string}>}
 */
export async function postToInstagram({ imageUrl, caption }) {
  if (!instagramConfigured()) {
    return { ok: false, error: 'IG_BUSINESS_USER_ID or FB_PAGE_ACCESS_TOKEN not set' }
  }
  const { igUserId, pageToken } = envBundle()
  const trimmedCaption = String(caption || '').slice(0, 2200)

  // 1. Create the media container
  let creationId
  try {
    const createRes = await axios.post(
      `${GRAPH_API}/${igUserId}/media`,
      null,
      {
        params: { image_url: imageUrl, caption: trimmedCaption, access_token: pageToken },
        timeout: 25000,
        validateStatus: s => s < 500,
      }
    )
    if (createRes.status >= 400 || createRes.data?.error) {
      return {
        ok: false,
        step: 'create',
        error: createRes.data?.error?.message || `HTTP ${createRes.status}`,
      }
    }
    creationId = createRes.data?.id
    if (!creationId) {
      return { ok: false, step: 'create', error: 'no creation id returned' }
    }
  } catch (e) {
    return { ok: false, step: 'create', error: e.message || 'request failed' }
  }

  // 2. Wait until the container reports FINISHED — IG processes the image
  // asynchronously after the create call; publishing too fast fails with
  // "Media ID is not available". Poll for up to ~20s.
  const POLL_INTERVAL_MS = 1500
  const POLL_MAX_ATTEMPTS = 14 // ~21s total
  let containerReady = false
  let lastStatus = 'UNKNOWN'
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    try {
      const statusRes = await axios.get(
        `${GRAPH_API}/${creationId}`,
        {
          params: { fields: 'status_code', access_token: pageToken },
          timeout: 10000,
          validateStatus: s => s < 500,
        }
      )
      lastStatus = statusRes.data?.status_code || 'UNKNOWN'
      if (lastStatus === 'FINISHED') { containerReady = true; break }
      if (lastStatus === 'ERROR' || lastStatus === 'EXPIRED') {
        return { ok: false, step: 'container-status', error: `IG container ${lastStatus}`, creationId }
      }
    } catch (e) {
      // Transient — keep polling
    }
  }
  if (!containerReady) {
    return { ok: false, step: 'container-status', error: `IG container not ready after polling (last: ${lastStatus})`, creationId }
  }

  // 3. Publish the container
  try {
    const pubRes = await axios.post(
      `${GRAPH_API}/${igUserId}/media_publish`,
      null,
      {
        params: { creation_id: creationId, access_token: pageToken },
        timeout: 25000,
        validateStatus: s => s < 500,
      }
    )
    if (pubRes.status >= 400 || pubRes.data?.error) {
      return {
        ok: false,
        step: 'publish',
        error: pubRes.data?.error?.message || `HTTP ${pubRes.status}`,
        creationId,
      }
    }
    return { ok: true, id: pubRes.data?.id }
  } catch (e) {
    return { ok: false, step: 'publish', error: e.message || 'request failed', creationId }
  }
}
