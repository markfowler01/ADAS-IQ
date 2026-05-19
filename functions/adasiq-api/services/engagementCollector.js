// Engagement collector — pulls post performance metrics for published drafts
// and applies kill rules per the Engineering Brief v1.0 section 4.
//
// Runs hourly via /api/capture-calc/engagement/run cron.
//
// Per draft entry, tracks rolling metrics keyed by elapsed-time bucket:
//   { 24h: {impressions, reactions, comments, clicks}, 72h: {...}, 7d: {...} }
//
// Kill rules (from brief):
//   - LinkedIn personal post < 200 impressions in 24h  → variant marked dead
//   - IG company post < 50 reach in 48h               → variant marked dead
//   - FB page post 0 engagement in 7d                 → variant marked dead
//
// LinkedIn analytics API note: requires r_organization_social or r_member_social
// scope on the token. The existing token used for posting may not have this
// scope. If the analytics fetch returns 403, the collector logs the issue and
// falls back to skipping that post until the token scope is fixed.

import axios from 'axios'

// Stub fetcher — replace with real LinkedIn / Meta analytics calls once token
// scopes are verified. Until then, returns nulls so the kill rules don't fire
// spuriously on missing data.
async function fetchLinkedInPostStats(_platformId) {
  // Real implementation outline:
  //   GET https://api.linkedin.com/rest/socialMetadata/{urn}
  //   Headers: Authorization Bearer + LinkedIn-Version: 202401
  //   Returns: shareStatistics: {impressionCount, uniqueImpressionsCount, shareCount, commentCount, likeCount, ...}
  //
  // For now: return null so we skip the kill-rule check until real data flows.
  return null
}

async function fetchMetaPostStats(_platformId, _platform) {
  // Real impl: Meta Graph API GET /{post-id}/insights?metric=post_impressions,post_reactions_by_type_total,post_clicks
  // Token used for newsletter posting may already have read_insights scope.
  return null
}

/**
 * Pull engagement for a single published draft. Returns the updated metrics
 * object or null if no data available.
 */
export async function collectForDraft(draft) {
  if (!draft || draft.status !== 'published' || !draft.platform_id) return null
  let stats = null
  if (draft.channel === 'linkedin_personal' || draft.channel === 'linkedin_company') {
    stats = await fetchLinkedInPostStats(draft.platform_id)
  } else if (draft.channel === 'facebook' || draft.channel === 'instagram') {
    stats = await fetchMetaPostStats(draft.platform_id, draft.channel)
  }
  if (!stats) return null

  const ageMs = Date.now() - new Date(draft.published_at || draft.updated_at || draft.created_at).getTime()
  const ageHours = ageMs / 3600000
  const bucket = ageHours <= 24 ? '24h' : ageHours <= 72 ? '72h' : '7d'

  const prev = draft.engagement || {}
  return {
    ...prev,
    [bucket]: {
      impressions: stats.impressions ?? prev[bucket]?.impressions ?? 0,
      reactions:   stats.reactions ?? prev[bucket]?.reactions ?? 0,
      comments:    stats.comments ?? prev[bucket]?.comments ?? 0,
      clicks:      stats.clicks ?? prev[bucket]?.clicks ?? 0,
      collected_at: new Date().toISOString(),
    },
    age_hours: Math.round(ageHours),
  }
}

/**
 * Apply kill rules to a draft's engagement data. Returns:
 *   { kill: boolean, reason?: string }
 * Skips the check if no engagement data has been collected yet (we don't
 * want to falsely kill posts that just don't have analytics-scope token).
 */
export function applyKillRules(draft) {
  const eng = draft?.engagement
  if (!eng) return { kill: false }
  const ageHours = (Date.now() - new Date(draft.published_at || draft.updated_at || draft.created_at).getTime()) / 3600000

  if (draft.channel === 'linkedin_personal' || draft.channel === 'linkedin_company') {
    if (ageHours >= 24 && eng['24h']?.impressions != null && eng['24h'].impressions < 200) {
      return { kill: true, reason: `LinkedIn post under 200 impressions in 24h (${eng['24h'].impressions})` }
    }
  }
  if (draft.channel === 'instagram') {
    if (ageHours >= 48 && eng['72h']?.impressions != null && eng['72h'].impressions < 50) {
      return { kill: true, reason: `IG post under 50 reach in 48h (${eng['72h'].impressions})` }
    }
  }
  if (draft.channel === 'facebook') {
    if (ageHours >= 168) {
      const total = (eng['7d']?.reactions || 0) + (eng['7d']?.comments || 0) + (eng['7d']?.clicks || 0)
      if (total === 0) return { kill: true, reason: '0 FB engagement in 7d' }
    }
  }
  return { kill: false }
}
