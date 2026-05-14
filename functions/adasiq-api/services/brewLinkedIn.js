// LinkedIn auto-post for ADAS Brew.
// Posts to the LinkedIn member's feed via the official UGC Posts API.
// Refreshes access tokens using the refresh-token grant when expired.
//
// Required env vars (set in Catalyst):
//   LINKEDIN_REFRESH_TOKEN  — long-lived refresh token (~365 days)
//   LINKEDIN_CLIENT_ID      — from your LinkedIn app
//   LINKEDIN_CLIENT_SECRET  — from your LinkedIn app
//   LINKEDIN_USER_URN       — e.g. "urn:li:person:ABC123XYZ" (or "urn:li:organization:..." for company page)
//
// Optional:
//   LINKEDIN_ACCESS_TOKEN   — short-lived (~60 days). If set, used directly. Otherwise refreshed from above.

import axios from 'axios'

const LI_API = 'https://api.linkedin.com'
const LI_OAUTH = 'https://www.linkedin.com/oauth/v2'

function envBundle() {
  return {
    accessToken: process.env.LINKEDIN_ACCESS_TOKEN || '',
    refreshToken: process.env.LINKEDIN_REFRESH_TOKEN || '',
    clientId: process.env.LINKEDIN_CLIENT_ID || '',
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
    userUrn: process.env.LINKEDIN_USER_URN || '',
  }
}

function isConfigured() {
  const e = envBundle()
  if (!e.userUrn) return false
  return Boolean(e.accessToken || (e.refreshToken && e.clientId && e.clientSecret))
}

// In-memory token cache so we don't refresh on every send.
let cachedToken = null
let cachedTokenExpiresAt = 0

async function refreshAccessToken() {
  const e = envBundle()
  if (!e.refreshToken || !e.clientId || !e.clientSecret) {
    throw new Error('LinkedIn refresh token + client id/secret not configured')
  }
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: e.refreshToken,
    client_id: e.clientId,
    client_secret: e.clientSecret,
  })
  const res = await axios.post(`${LI_OAUTH}/accessToken`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 12000,
  })
  if (!res.data?.access_token) {
    throw new Error('LinkedIn refresh returned no access_token')
  }
  cachedToken = res.data.access_token
  // expires_in is in seconds; cache for slightly less to avoid edge cases
  cachedTokenExpiresAt = Date.now() + (res.data.expires_in || 3600) * 1000 - 60_000
  return cachedToken
}

async function getAccessToken() {
  const e = envBundle()
  if (e.accessToken) return e.accessToken
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken
  return refreshAccessToken()
}

/**
 * Post a feed post (UGC) to LinkedIn as the configured member.
 * @param {{ text: string }} payload — the text body of the post
 * @returns {Promise<{ ok: boolean, id?: string, error?: string, dryRun?: boolean }>}
 */
export async function postToLinkedIn({ text }) {
  if (!isConfigured()) {
    console.log(`[brew linkedin] DRY RUN — LinkedIn not configured. Would post ${String(text).length} chars.`)
    return { ok: true, dryRun: true }
  }

  let token
  try {
    token = await getAccessToken()
  } catch (err) {
    return { ok: false, error: `oauth: ${err.message}` }
  }

  const e = envBundle()
  const body = {
    author: e.userUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: String(text || '').slice(0, 3000),
        },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  }

  try {
    const res = await axios.post(`${LI_API}/v2/ugcPosts`, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      timeout: 15000,
      validateStatus: s => s < 500,
    })
    if (res.status >= 200 && res.status < 300 && res.data?.id) {
      return { ok: true, id: res.data.id }
    }
    return { ok: false, error: `LinkedIn ${res.status}: ${JSON.stringify(res.data).slice(0, 400)}` }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

import Anthropic from '@anthropic-ai/sdk'

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

const LI_SYSTEM_PROMPT = `You are converting Mark Fowler's daily ADAS/collision industry newsletter into a LinkedIn post. Mark owns Absolute ADAS, a mobile ADAS calibration company in Western Washington. He has done 50,000+ calibrations, runs his own shop, reads the OEM bulletins, and respects the reader's time. Not a marketer. Not a salesman.

His audience: collision shop owners, glass shop managers, service writers, estimators, and adjusters who have 90 seconds before the next car rolls in.

VOICE & TONE
- Direct and practical. No fluff, no corporate jargon.
- Confident without arrogance. We have done 50,000+ calibrations. Do not brag about it in every post.
- Technical when it matters, plain English when it does not. If you mention a Honda Sensing camera recalibration, explain why a shop owner should care in one short sentence.
- Short sentences. Active voice.
- Talk to the reader like a peer in the bay, not a customer in a showroom.
- Safety-first framing. Every calibration protects a real driver. Lead with that when relevant.
- Industry insider talking to industry insiders. Assume they know the acronyms (TSB, ADAS, R&I, OEM).
- Faith and family values are part of the brand but never preached. They show up in integrity and follow-through, not in scripture quotes.

HARD RULES (non-negotiable)
- NEVER use em dashes. Use periods, commas, or parentheses instead.
- NEVER use AI-sounding phrases: "delve into", "tapestry", "in today's fast-paced world", "navigate the landscape", "unlock", "harness".
- NEVER use hype words: "revolutionary", "game-changing", "cutting-edge", "leverage", "unleash".
- NEVER use corporate LinkedIn-speak: "excited to share", "thoughts?", "in today's landscape".

Voice test before publishing: would a guy in a blue shirt with grease on his hands write this, or roll his eyes at it?

STRUCTURE
- Hook line: a specific claim or observation that makes the reader stop scrolling. The first 3 lines must earn the "see more" click on mobile.
- 1-2 sentence setup with the actual data point or news.
- The insight: what this means that others aren't saying.
- The practical implication: what a shop owner or estimator should actually do.
- A bridge to calibration shops or Mark's lane (only if it fits naturally, do not force it).
- A closing question that forces a specific answer or invites a story. Avoid generic "what do you think" prompts.

FORMATTING
- Single sentences on their own line where they hit hardest.
- Double line breaks between thought units.
- One memorable phrase per post that someone might screenshot.
- 3-5 hashtags max at the end, all relevant to collision and ADAS.
- Target length: 150-220 words. Cut ruthlessly.

RULES
- Cite or attribute any specific number, percentage, or earnings claim. If the source is not in the newsletter draft, flag it instead of inventing one.
- No filler triplets (three sentences saying the same thing in a row).
- No transitional throat-clearing ("This isn't new, but...", "It's worth noting...").
- If the newsletter has multiple ideas, pick the single strongest one. Do not cram.
- HARD RULES from voice spec above are non-negotiable.

OUTPUT
Return only the LinkedIn post. No preamble, no explanation, no alternatives unless I ask.`

/**
 * Render the digest as a plain-text newsletter draft for the AI to convert.
 */
function digestAsNewsletterDraft(digest) {
  const lines = []
  if (digest.tagline) {
    lines.push(`Tagline: ${digest.tagline}`)
    lines.push('')
  }
  if (digest.intro) {
    lines.push(`Intro: ${digest.intro}`)
    lines.push('')
  }
  const stories = Array.isArray(digest.stories) ? digest.stories : []
  stories.forEach((s, i) => {
    lines.push(`Story ${i + 1}: ${s.headline}`)
    if (s.tag) lines.push(`Tag: ${s.tag}`)
    if (s.source_label) lines.push(`Source: ${s.source_label}`)
    if (s.body) {
      lines.push('')
      lines.push(s.body)
    }
    lines.push('')
    lines.push('---')
    lines.push('')
  })
  return lines.join('\n').trim()
}

/**
 * Use AI to write a LinkedIn-optimized post from the digest's source material.
 * Falls back to a mechanical formatter if AI fails.
 *
 * @param {Object} digest — output of assembleDigest()
 * @returns {Promise<string>} — LinkedIn post body, ready to post
 */
export async function digestToLinkedInPost(digest) {
  const stories = Array.isArray(digest.stories) ? digest.stories : []
  if (stories.length === 0) return mechanicalFallback(digest)

  const newsletterDraft = digestAsNewsletterDraft(digest)

  try {
    const client = getAnthropic()
    // Detect Friday mode by inspecting the digest's CTA — Friday format always
    // ends with the "DM me audit" direct ask. If we see it, instruct the AI to
    // preserve that CTA verbatim instead of writing its own closing question.
    const isFriday = String(digest.cta?.text || '').toLowerCase().includes("dm me 'audit'")

    const fridayInstruction = isFriday
      ? `\n\nThis is the FRIDAY edition (Field Notes / direct lead-gen). Override the standard "closing question" rule. The post MUST end with this exact CTA, verbatim, on its own line(s):\n\n"DM me 'audit' on LinkedIn. I'll review your last 3 denied calibrations and write the OEM-cited justification that flips them. Free. No pitch."\n\nDo not add a question after it. Do not soften it. Do not add an additional CTA.`
      : ''

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: LI_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `NEWSLETTER DRAFT:\n\n${newsletterDraft}\n\nReminder: pick ONE story from the draft above and write the post about that one story only. Do not synthesize or combine multiple stories. The HARD RULES from the system prompt are non-negotiable (no em dashes, no AI-sounding phrases, no hype words, no corporate LinkedIn-speak).${fridayInstruction}`,
      }],
    })

    let post = (message.content?.[0]?.text || '').trim()
    if (!post) throw new Error('AI returned empty post')

    // Strip any code fences if present
    post = post.replace(/^```(?:[a-z]*)?\n?/i, '').replace(/\n?```$/i, '').trim()
    if (post.length > 2900) post = post.slice(0, 2880) + '…'
    return post
  } catch (e) {
    console.warn('[brew linkedin AI] fell back to mechanical formatter:', e.message)
    return mechanicalFallback(digest)
  }
}

// Mechanical fallback if AI fails — better than nothing.
function mechanicalFallback(digest) {
  const tagline = digest.tagline || ''
  const intro = digest.intro || ''
  const stories = Array.isArray(digest.stories) ? digest.stories : []
  const top = stories[0]

  const lines = []
  if (top?.headline) lines.push(top.headline)
  else if (tagline) lines.push(tagline)
  else lines.push('What moved in calibration today')
  lines.push('')
  if (intro) { lines.push(intro); lines.push('') }
  if (top?.body) { lines.push(top.body); lines.push('') }
  lines.push('What are you seeing in your shop this week?')
  lines.push('')
  lines.push('#ADAS #CollisionRepair #ADASCalibration #BodyShop')
  return lines.join('\n').trim()
}

export const linkedInConfigured = isConfigured

/**
 * Post an image + caption to LinkedIn (member feed).
 * Uses the v2 Assets API: register upload → PUT bytes → create UGC post w/ image.
 *
 * @param {{ imageUrl: string, text: string }} payload
 * @returns {Promise<{ ok: boolean, id?: string, error?: string, dryRun?: boolean }>}
 */
export async function postImageToLinkedIn({ imageUrl, text }) {
  if (!isConfigured()) {
    console.log(`[brew linkedin image] DRY RUN — LinkedIn not configured.`)
    return { ok: true, dryRun: true }
  }
  if (!imageUrl) return { ok: false, error: 'imageUrl required' }

  let token
  try {
    token = await getAccessToken()
  } catch (err) {
    return { ok: false, error: `oauth: ${err.message}` }
  }

  const e = envBundle()

  try {
    // 1. Register the upload — get a one-shot URL we can PUT bytes to
    const regBody = {
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: e.userUrn,
        serviceRelationships: [{
          relationshipType: 'OWNER',
          identifier: 'urn:li:userGeneratedContent',
        }],
      },
    }
    const regRes = await axios.post(`${LI_API}/v2/assets?action=registerUpload`, regBody, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 15000,
      validateStatus: s => s < 500,
    })
    if (regRes.status >= 300) {
      return { ok: false, error: `register: LinkedIn ${regRes.status}: ${JSON.stringify(regRes.data).slice(0, 300)}` }
    }
    const uploadUrl = regRes.data?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl
    const assetUrn = regRes.data?.value?.asset
    if (!uploadUrl || !assetUrn) {
      return { ok: false, error: 'register: no uploadUrl/asset in response' }
    }

    // 2. Download the image bytes (LinkedIn won't fetch from URL itself)
    const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 20000 })

    // 3. PUT bytes to the upload URL
    const upRes = await axios.put(uploadUrl, Buffer.from(imgRes.data), {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
      timeout: 30000,
      validateStatus: s => s < 500,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    })
    if (upRes.status >= 300) {
      return { ok: false, error: `upload: LinkedIn ${upRes.status}` }
    }

    // 4. Create the UGC post referencing the uploaded image
    const postBody = {
      author: e.userUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: String(text || '').slice(0, 3000) },
          shareMediaCategory: 'IMAGE',
          media: [{
            status: 'READY',
            description: { text: '' },
            media: assetUrn,
            title: { text: '' },
          }],
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }
    const postRes = await axios.post(`${LI_API}/v2/ugcPosts`, postBody, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      timeout: 15000,
      validateStatus: s => s < 500,
    })
    if (postRes.status >= 300 || !postRes.data?.id) {
      return { ok: false, error: `post: LinkedIn ${postRes.status}: ${JSON.stringify(postRes.data).slice(0, 300)}` }
    }
    return { ok: true, id: postRes.data.id }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * Add a comment to an existing LinkedIn post (UGC share URN).
 * Used to drop a newsletter-signup link in the first comment after auto-posting,
 * since LinkedIn de-prioritizes posts with external links in the body but not comments.
 *
 * @param {string} shareUrn — e.g. "urn:li:share:7459227147837149184"
 * @param {string} text — the comment body
 * @returns {Promise<{ ok: boolean, id?: string, error?: string, dryRun?: boolean }>}
 */
export async function commentOnLinkedInPost(shareUrn, text) {
  if (!isConfigured()) {
    console.log(`[brew linkedin comment] DRY RUN — LinkedIn not configured.`)
    return { ok: true, dryRun: true }
  }
  if (!shareUrn) return { ok: false, error: 'shareUrn required' }

  let token
  try {
    token = await getAccessToken()
  } catch (err) {
    return { ok: false, error: `oauth: ${err.message}` }
  }

  const e = envBundle()
  const encodedUrn = encodeURIComponent(shareUrn)
  const body = {
    actor: e.userUrn,
    object: shareUrn,
    message: { text: String(text || '').slice(0, 1250) },
  }

  try {
    const res = await axios.post(`${LI_API}/v2/socialActions/${encodedUrn}/comments`, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      timeout: 15000,
      validateStatus: s => s < 500,
    })
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, id: res.data?.id || res.headers?.['x-restli-id'] || null }
    }
    return { ok: false, error: `LinkedIn ${res.status}: ${JSON.stringify(res.data).slice(0, 400)}` }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
