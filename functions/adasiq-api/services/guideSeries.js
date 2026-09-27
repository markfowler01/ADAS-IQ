// 📚 Estimator guide daily series (Mark 2026-09-26: "create a new post every
// day with info from this"). Thirty posts written from the reviewed guide, one
// card image each, hosted on absoluteadas.com/estimator-guide/posts/.
//
// Why not pre-queue a month: the approval queue is Catalyst Cache (48h TTL,
// 50-item cap). So the posts live in VanKV (Datastore) and each morning the
// hourly Van safety net enqueues TODAY's three channel drafts (LI 9:00, IG
// 11:30, FB 12:00 PT) as approved, and the normal scheduler publishes them.
// While the series is active the unified daily drafter stands down, so volume
// stays what it was: this post, the van-in-the-field post, the 3 PM ad.
import { enqueueDraft, updateDraft, buildSignedActionUrl } from './captureApprovalQueue.js'
import { getVal, setVal, readChunkedArray, writeChunkedArray } from './vanDatastore.js'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from './cliq.js'

const META_KEY = 'guide_series_meta'     // { start_date, count, active, imported_at }
const POSTS_KEY = 'guide_series_posts'   // chunked array of { day, kicker, headline, body, ig, image_url }
const DONE_KEY = 'guide_series_done'     // { [date]: { ids, at } }
const PUBLIC_BASE = process.env.API_PUBLIC_BASE || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'
const SCHEDULE = [
  { channel: 'linkedin_personal',  hour: 9,  minute: 0,  field: 'body', label: 'LinkedIn 9:00' },
  { channel: 'instagram_business', hour: 11, minute: 30, field: 'ig',   label: 'Instagram 11:30' },
  { channel: 'facebook_page',      hour: 12, minute: 0,  field: 'body', label: 'Facebook 12:00' },
]

export function ptDateStr(d = new Date()) { return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) }

/** PT wall-clock (date + hour:minute) → ISO instant, DST-correct. */
export function ptIso(dateStr, hour, minute) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, hour, minute)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess))
  const get = t => Number(parts.find(p => p.type === t)?.value)
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'))
  return new Date(guess - (asIfUtc - guess)).toISOString()
}

const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)

export async function importSeries(req, { start_date, posts }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start_date || ''))) throw new Error('start_date must be YYYY-MM-DD')
  if (!Array.isArray(posts) || !posts.length) throw new Error('posts[] required')
  const clean = posts.map((p, i) => ({
    day: Number(p.day) || i + 1,
    kicker: String(p.kicker || '').slice(0, 80),
    headline: String(p.headline || '').slice(0, 160),
    body: String(p.body || '').slice(0, 2800),
    ig: String(p.ig || p.body || '').slice(0, 2100),
    image_url: String(p.image_url || ''),
  })).sort((a, b) => a.day - b.day)
  for (const p of clean) if (!p.headline || !p.body || !/^https:\/\//.test(p.image_url)) throw new Error(`day ${p.day}: headline, body and https image_url required`)
  await writeChunkedArray(req, POSTS_KEY, clean, { chunkSize: 10 })
  const meta = { start_date, count: clean.length, active: true, imported_at: new Date().toISOString(), end_date: addDays(start_date, clean.length - 1) }
  await setVal(req, META_KEY, meta)
  return meta
}

function addDays(dateStr, n) { const t = Date.parse(dateStr + 'T12:00:00Z') + n * 86400000; return new Date(t).toISOString().slice(0, 10) }

export async function setSeriesActive(req, active) {
  const meta = (await getVal(req, META_KEY)) || {}
  const next = { ...meta, active: Boolean(active), toggled_at: new Date().toISOString() }
  await setVal(req, META_KEY, next)
  return next
}

export async function seriesStatus(req) {
  const meta = (await getVal(req, META_KEY)) || null
  const done = (await getVal(req, DONE_KEY)) || {}
  const today = ptDateStr()
  const post = meta ? await seriesPostFor(req, today) : null
  return { meta, today, today_post: post ? { day: post.day, headline: post.headline } : null, queued_days: Object.keys(done).sort() }
}

/** The post for a PT date, or null when the series is inactive or the date is outside it. */
export async function seriesPostFor(req, dateStr) {
  const meta = await getVal(req, META_KEY)
  if (!meta || !meta.active || !meta.start_date) return null
  const idx = daysBetween(meta.start_date, dateStr)
  if (idx < 0 || idx >= (meta.count || 0)) return null
  const posts = await readChunkedArray(req, POSTS_KEY)
  return posts.find(p => Number(p.day) === idx + 1) || posts[idx] || null
}

/**
 * Enqueue today's three channel drafts, once per day. Safe to call every hour.
 * Respects the social kill switch: paused → nothing is queued.
 */
export async function enqueueTodaysSeries(req, { dateStr = ptDateStr(), dry = false } = {}) {
  const { isMarketingPaused } = await import('./marketingKillSwitch.js')
  if (await isMarketingPaused(req, 'social')) return { skipped: true, reason: 'marketing_paused (social)' }
  const done = (await getVal(req, DONE_KEY)) || {}
  if (done[dateStr]) return { skipped: true, reason: 'already queued', ids: done[dateStr].ids }
  const post = await seriesPostFor(req, dateStr)
  if (!post) return { skipped: true, reason: `no series post for ${dateStr}` }

  const ids = []
  for (const s of SCHEDULE) {
    const scheduled_for = ptIso(dateStr, s.hour, s.minute)
    if (dry) { ids.push({ channel: s.channel, scheduled_for }); continue }
    const entry = await enqueueDraft(req, {
      status: 'approved',
      channel: s.channel,
      category: 'estimator_series',
      headline: `Estimator guide, day ${post.day}: ${post.headline}`,
      body: post[s.field] || post.body,
      scheduled_for,
      meta: { series_day: post.day, kicker: post.kicker },
    })
    await updateDraft(req, entry.id, { image_url: post.image_url, image_status: 'series_card' })
    ids.push({ id: entry.id, channel: s.channel, scheduled_for })
  }
  if (!dry) {
    done[dateStr] = { ids: ids.map(i => i.id), day: post.day, at: new Date().toISOString() }
    await setVal(req, DONE_KEY, done)
    const kills = ids.map((i, k) => `${SCHEDULE[k].label}: ${buildSignedActionUrl(PUBLIC_BASE, i.id, 'kill')}`).join('\n')
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID,
      `📚 *Estimator series, day ${post.day} of 30 queued for today*\n"${post.headline}"\nLinkedIn 9:00 · Instagram 11:30 · Facebook 12:00 PT · card: ${post.image_url}\n\nKill one if you need to:\n${kills}`).catch(() => {})
  }
  return { queued: !dry, dry, date: dateStr, day: post.day, headline: post.headline, ids }
}
