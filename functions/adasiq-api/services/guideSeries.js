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
// VanKV value_json is a Datastore text column: it silently truncates at 10,000
// chars (found 2026-09-26 when 10 posts per chunk came back cut off mid-post 8).
// Three posts per chunk keeps every row under ~9.5K.
const CHUNK = 3
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
    scene: String(p.scene || '').slice(0, 900),          // directive for the capture-image generator
  })).sort((a, b) => a.day - b.day)
  for (const p of clean) if (!p.headline || !p.body || !/^https:\/\//.test(p.image_url)) throw new Error(`day ${p.day}: headline, body and https image_url required`)
  await writeChunkedArray(req, POSTS_KEY, clean, { chunkSize: CHUNK })
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
 * Generate the photo card for one day through the capture-image pipeline
 * (Gemini photo from the post's scene directive, cream masthead with the
 * headline, dark brand footer, hosted on GitHub Pages) and store its URL on
 * the post. force:true so the daily budget is not consumed; audit still logs.
 */
export async function generateSeriesImage(req, { day, segment }) {
  const posts = await readChunkedArray(req, POSTS_KEY)
  const idx = posts.findIndex(p => Number(p.day) === Number(day))
  if (idx < 0) throw new Error(`no post for day ${day}`)
  const post = posts[idx]
  const { generateCaptureImage } = await import('./captureImage.js')
  const r = await generateCaptureImage({ headline: post.headline, draftId: `estimator-series-day-${String(post.day).padStart(2, '0')}` }, { force: true, segment, sceneOverride: post.scene || undefined })
  if (!r.ok) return { ok: false, day: post.day, error: r.error }
  posts[idx] = { ...post, image_url: r.url, image_generated_at: new Date().toISOString() }
  await writeChunkedArray(req, POSTS_KEY, posts, { chunkSize: CHUNK })
  return { ok: true, day: post.day, url: r.url }
}

// ── Highlight cards (Mark 2026-09-27: "show the back of a car and highlight
// the rear bumper orange, bumper on the car") ───────────────────────────────
const HL_CAR = 'a silver compact crossover SUV with the proportions of a Toyota RAV4, no badges or readable logos, all panels installed'
const HIGHLIGHTS = {
  'rear-bumper':  { view: `straight rear three-quarter view of ${HL_CAR}`, part: 'the entire rear bumper cover, following its seams exactly from corner to corner', dots: 'two small solid orange dots on the cover at the left and right rear corners, where the blind spot radars sit behind it' },
  'front-bumper': { view: `low front three-quarter view of ${HL_CAR}`, part: 'the entire front bumper cover including the grille opening, following its seams exactly', dots: 'one small solid orange dot at the center of the grille where the radar sits behind the emblem' },
  'grille':       { view: `straight-on front view of ${HL_CAR}, slightly above hood height so the whole face of the car shows`, part: 'the ENTIRE front grille as one shape: the upper grille, the lower grille opening, and the large front emblem in the center of the upper grille, all of it tinted together', dots: 'one small solid darker orange dot exactly on the center of the emblem where the radar sits behind it, and one small dot low in the lower grille where the front camera sits' },
  'windshield':   { view: `front three-quarter view of ${HL_CAR}`, part: 'the entire windshield glass', dots: 'one small solid orange dot at the top center of the windshield behind the mirror where the forward camera mounts' },
  'quarter':      { view: `rear three-quarter view of ${HL_CAR}`, part: 'the rear quarter panel on the visible side, from the door seam to the tail lamp', dots: 'one small solid orange dot low on the rear corner where the blind spot radar mounts to the quarter' },
  'liftgate':     { view: `straight rear view of ${HL_CAR}`, part: 'the liftgate from the roof spoiler down to the bumper cover', dots: 'one small solid orange dot above the license plate recess where the rear camera sits' },
  'mirror':       { view: `close three-quarter view of the front door and side mirror of ${HL_CAR}`, part: 'the side mirror housing only', dots: 'one small solid orange dot on the underside of the mirror where the 360 camera lens sits' },
}
export const HIGHLIGHT_KEYS = Object.keys(HIGHLIGHTS)

function highlightPrompt(key) {
  const h = HIGHLIGHTS[key]
  return `Documentary photograph, square 1080x1080. Photoreal, magazine quality, shot on a 35mm camera with shallow depth of field.

SCENE: ${h.view}, parked inside a clean modern collision repair bay with polished concrete and soft light from a bay door or skylight. The vehicle is complete and undamaged.

TECHNICAL CALLOUT (the one deliberate graphic in this image): ${h.part} is tinted a translucent bright orange, hex #CD4419, at about 65 percent opacity, exactly as if a highlight layer had been placed over that one panel. The tint follows the panel edges and seams precisely, reflections and body lines still show through it. Everything outside that panel stays photoreal and untinted. ${h.dots}.

HARD BANS: no people, no hands, no silhouettes. No text, captions, labels, arrows, numbers or watermarks anywhere. No brand logos on the vehicle, tools or walls. No scan tools, no calibration target boards, no measuring equipment. No stock-photo lighting.

COMPOSITION (important): the top 28 percent of the frame is plain, out-of-focus shop wall and ceiling with nothing important in it, because a title band is printed over it later. The vehicle sits in the MIDDLE of the frame: its roof at about 32 percent from the top, its tires at about 80 percent. Nothing of the vehicle above the 28 percent line. Bottom 15 percent is near-black shadow of the bay floor, no detail.

Do not write any words in the image. Just the photograph with the one orange panel.`
}

/** Generate a highlight card for one day and store its URL on the post. */
export async function generateHighlightImage(req, { day, key, segment }) {
  if (!HIGHLIGHTS[key]) throw new Error(`unknown highlight '${key}'. Use one of: ${HIGHLIGHT_KEYS.join(', ')}`)
  const posts = await readChunkedArray(req, POSTS_KEY)
  const idx = posts.findIndex(p => Number(p.day) === Number(day))
  if (idx < 0) throw new Error(`no post for day ${day}`)
  const post = posts[idx]
  const { generateCaptureImage } = await import('./captureImage.js')
  const r = await generateCaptureImage({ headline: post.headline, draftId: `estimator-series-day-${String(post.day).padStart(2, '0')}-${key}` }, { force: true, segment, promptOverride: highlightPrompt(key) })
  if (!r.ok) return { ok: false, day: post.day, key, error: r.error }
  posts[idx] = { ...post, image_url: r.url, image_generated_at: new Date().toISOString(), highlight: key }
  await writeChunkedArray(req, POSTS_KEY, posts, { chunkSize: CHUNK })
  return { ok: true, day: post.day, key, url: r.url }
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
