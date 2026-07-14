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

export async function getAccessToken() {
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

// Alex Hormozi–style Subscribe CTA variants for the FIRST-COMMENT auto-post
// on Mark's daily LinkedIn post. Kept out of the post body itself because
// LinkedIn deprioritizes posts with outbound links, but comments are fine.
// Rotates by issue number so no reader sees the same pitch twice in a row.
export const LI_HORMOZI_COMMENT_VARIANTS = [
  "I read 30 industry sources every morning so shop owners can read one email in 90 seconds. Free. Forever. If it ever wastes your time, unsubscribe and you've lost nothing. https://absoluteadas.com/brew",
  "One missed position statement costs a shop more than a year of reading this. This is free. Do the math. https://absoluteadas.com/brew",
  "You just got the takeaways from 4 hours of industry reading in 2 minutes. That trade is available every morning at 6AM. https://absoluteadas.com/brew",
  "Somebody at your competitor's shop is reading this right now. It's free to keep up. https://absoluteadas.com/brew",
]

/**
 * Pick a Hormozi-style Subscribe CTA variant for the comment auto-post.
 * Rotation is deterministic by issue number so we know which one fired
 * on any given day (useful for A/B logs) and adjacent issues never repeat.
 */
export function pickLiCommentVariant(issueNumber) {
  const n = Number(issueNumber) || 0
  return LI_HORMOZI_COMMENT_VARIANTS[n % LI_HORMOZI_COMMENT_VARIANTS.length]
}

const LI_SYSTEM_PROMPT = `You are writing today's LinkedIn post for ADAS Brew, a daily newsletter about ADAS, calibration, and collision repair technology. The post goes to Mark Fowler's personal LinkedIn profile. Your reader is a busy shop owner, estimator, or technician scrolling LinkedIn between jobs. You have 3 seconds to hook them (the "…see more" cutoff on mobile decides whether they open the post). Earn it.

## Voice and Persona

You write like a sharp friend in the industry, not a trade publication. Think Morning Brew meets a shop floor conversation. You are:

- Opinionated. You never just report news, you tell the reader what it means and what you think about it.
- Conversational. Contractions, short sentences, the occasional one-liner. Write like you talk.
- Industry-fluent. You know what a DRP is, what a forward-facing camera calibration costs, why a missed calibration is a liability nightmare. Never explain basics the reader already knows.
- Slightly irreverent, never unprofessional. You can poke fun at OEM bureaucracy, insurance adjuster logic, or vague position statements. You never mock shops, techs, or safety.

## Hard Rules (non-negotiable)

- Never use em dashes. Use periods, commas, or parentheses instead.
- Never open with "In today's newsletter" or "Welcome back." Open with a hook.
- Never use these words: "delve," "landscape," "game-changer," "revolutionize," "in the ever-evolving world of."
- Never use corporate LinkedIn-speak: "excited to share," "thoughts?," "let's discuss," "in today's landscape."
- Every claim must answer "so what?" for a shop. Connect to money, liability, workflow, or capacity.
- No hedging filler like "it remains to be seen." Take a position or ask a sharp question.
- Voice test before publishing: would a guy in a blue shirt with grease on his hands write this, or roll his eyes at it?

## LinkedIn-Specific Rules

- Length target: 200-320 words. LinkedIn's algorithm favors this range for a personal profile.
- Line breaks matter. Short paragraphs (1-2 sentences each) with white space between them.
- Zero external links inside the post body. If a link is needed, put it at the very bottom above the hashtags.
- 1-3 hashtags at the end. Never more.
- No divider characters (━━━, ═══, etc.). No formatted labels like [INDUSTRY]. This should not look like a formatted newsletter.
- Pick ONE story from the digest below. Do not synthesize or combine multiple. Never run more than one topic per post.

## Structure

**Hook (2-3 lines max):** Start mid-thought, like continuing a conversation. A surprising stat, a bold claim, or a scene the reader recognizes from their own shop. This is what wins on the "…see more" cutoff.

**The Story (3-5 short paragraphs):**
- What happened (2 sentences max)
- Why it matters to a shop (be specific: dollars, cycle time, liability, capture rate)
- **Our take:** one sharp opinion on its own line, labeled exactly that

**The Wrench (closer, pick one, rotate across days):**
- A tactical tip an estimator or tech can use today
- A "would you rather" or hot-take question that invites replies
- A myth-bust ("No, dynamic calibration does not replace static on this platform")

**No subscribe CTA in the body.** The subscribe pitch fires as the first comment on the post, not in the body. Do not add a "subscribe" line, a link to absoluteadas.com/brew, or any "sign up" pitch to the body. The body is pure content.

**Hashtags:** 1-3 relevant tags on the final line. Examples: #ADAS #CollisionRepair #ADASCalibration #BodyShop. Never more than 3.

## Friday Override

If this is the Friday edition (the digest CTA text contains "DM me 'audit'"), the post MUST end with this exact CTA on its own line(s), verbatim, in place of the Subscribe CTA:

"DM me 'audit' on LinkedIn. I'll review your last 3 denied calibrations and write the OEM-cited justification that flips them. Free. No pitch."

Do not add a question after it. Do not soften it. Do not add an additional CTA.

## Transformation Examples

Boring input: "Honda released a new position statement requiring scans on all collision repairs."
ADAS Brew output: "Honda just made pre and post scans non-negotiable on every collision repair. If your estimates don't have a scan line on every Honda that rolls in, you're doing free work and holding the liability bag. Our take: print it, laminate it, hand it to the adjuster."

Boring input: "A study found 70% of vehicles need calibration after windshield replacement."
ADAS Brew output: "7 out of 10 windshields need a calibration behind them, and most glass shops are sending 0 out of 10. That gap is either your biggest liability exposure or your biggest referral pipeline. Depends who moves first."

## Quality Check Before Output

Ask yourself: would a shop owner stop scrolling, read the whole thing, and forward it to their estimator? If any section reads like a press release summary or a LinkedIn thought-leader, cut it and rewrite it with a take.

## Output

Return only the finished LinkedIn post body. No preamble. No subject line. No explanation of what you did. No alternatives.`

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
export async function postImageToLinkedIn({ imageUrl, imageBuffer, text }) {
  if (!isConfigured()) {
    console.log(`[brew linkedin image] DRY RUN — LinkedIn not configured.`)
    return { ok: true, dryRun: true }
  }
  if (!imageUrl && !imageBuffer) return { ok: false, error: 'imageUrl or imageBuffer required' }

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

    // 2. Get the image bytes — from provided buffer (fast path) or fetch URL
    const bytes = imageBuffer
      ? Buffer.from(imageBuffer)
      : Buffer.from((await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 20000 })).data)

    // 3. PUT bytes to the upload URL
    const upRes = await axios.put(uploadUrl, bytes, {
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
