// Fetch comments + reactions for a LinkedIn share URN.
//
// Uses the same OAuth token + flow as brewLinkedIn.js (posting). The
// /v2/socialActions/{urn}/comments endpoint accepts the SAME scope we already
// use to POST comments — so reads should "just work" with no extra scope ask.
//
// Returns: [{ id, authorUrn, authorName, message, createdAt, likeCount }, ...]
// Comments are returned NEWEST FIRST (most recent at index 0).

import axios from 'axios'
import { getAccessToken } from './brewLinkedIn.js'

const LI_API = 'https://api.linkedin.com'

// Fetch up to `max` comments for a LinkedIn share/post URN.
// shareUrn examples: "urn:li:share:7473789807094157313" or "urn:li:ugcPost:..."
export async function fetchPostComments(shareUrn, { max = 50 } = {}) {
  if (!shareUrn) throw new Error('shareUrn is required')
  let token
  try {
    token = await getAccessToken()
  } catch (e) {
    throw new Error(`LinkedIn oauth: ${e.message}`)
  }

  const encodedUrn = encodeURIComponent(shareUrn)
  const res = await axios.get(`${LI_API}/v2/socialActions/${encodedUrn}/comments`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    params: { count: max, sortBy: 'CREATED_TIME', sortOrder: 'DESCENDING' },
    timeout: 20000,
    validateStatus: s => s < 500,
  })
  if (res.status >= 400) {
    throw new Error(`LinkedIn ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`)
  }

  const elements = Array.isArray(res.data?.elements) ? res.data.elements : []
  return elements.map(c => ({
    id:         c.id || c.$URN || c.commentUrn || '',
    authorUrn:  c.actor || '',
    authorName: '',
    message:    String(c.message?.text || '').trim(),
    createdAt:  c.created?.time || 0,
    likeCount:  c.likesSummary?.totalLikes || 0,
  })).filter(c => c.id && c.message)
}

// Best-effort hydrate of a person URN → display name. Requires r_liteprofile
// scope, which a posting token may not have. Falls back to a shortened URN
// like "@ABC123" so the Cliq alert still has a referent.
export async function fetchAuthorName(authorUrn) {
  if (!authorUrn) return ''
  let token
  try { token = await getAccessToken() } catch { return shortUrn(authorUrn) }
  if (!authorUrn.startsWith('urn:li:person:')) return shortUrn(authorUrn)
  const id = authorUrn.slice('urn:li:person:'.length)
  const res = await axios.get(`${LI_API}/v2/people/(id:${encodeURIComponent(id)})`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' },
    timeout: 12000,
    validateStatus: s => s < 500,
  }).catch(() => null)
  if (!res || res.status >= 400) return shortUrn(authorUrn)
  const first = res.data?.localizedFirstName || ''
  const last  = res.data?.localizedLastName || ''
  const full  = `${first} ${last}`.trim()
  return full || shortUrn(authorUrn)
}

function shortUrn(urn) {
  const parts = String(urn).split(':')
  return '@' + (parts[parts.length - 1] || urn).slice(0, 8)
}
