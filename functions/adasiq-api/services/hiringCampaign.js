// 👷 Now Hiring campaign (Mark 2026-09-28: "one more campaign, a now hiring campaign").
//
// Twelve posts in Mark's voice, written from the live careers section of
// absoluteadas.com (no invented pay numbers), one post on Monday, Wednesday
// and Friday evenings at 5:30 PT when techs are off the clock. Each post is a
// real van photo from the WorkDrive library under a NOW HIRING masthead, and
// every one points at absoluteadas.com/careers (counted). Cycles through the
// twelve until Mark turns it off. Additive: nothing else stands down.
import { enqueueDraft, updateDraft, buildSignedActionUrl } from './captureApprovalQueue.js'
import { getVal, setVal } from './vanDatastore.js'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from './cliq.js'

const META_KEY = 'hiring_campaign'         // { active, next_index, done: { [date]: { n, ids } } }
const PHOTO_ROTATION_KEY = 'hiring_photo_rotation'
const PUBLIC_BASE = process.env.API_PUBLIC_BASE || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'
const POST_DAYS = new Set([1, 3, 5])       // Mon, Wed, Fri
const SCHEDULE = [
  { channel: 'linkedin_personal',  hour: 17, minute: 30, field: 'body', label: 'LinkedIn 5:30' },
  { channel: 'instagram_business', hour: 17, minute: 45, field: 'ig',   label: 'Instagram 5:45' },
  { channel: 'facebook_page',      hour: 18, minute: 0,  field: 'body', label: 'Facebook 6:00' },
]
const TAIL = 'Apply in two minutes. Six questions land in your inbox right away:\nhttps://absoluteadas.com/careers\n\nKnow a tech who should see this? Send it to them.'
const IG_TAIL = 'Apply at absoluteadas.com/careers (type it in). Six questions land in your inbox right away.\nKnow a tech? Send them this.'

const P = (headline, body) => ({ headline, body: `${body.trim()}\n\n${TAIL}`, ig: `${body.trim()}\n\n${IG_TAIL}` })
export const POSTS = [
  // Headlines stay under ~55 characters: the locked masthead fits two lines,
  // and a third line runs into the byline (seen on the first preview 2026-09-28).
  P('Now hiring ADAS techs. No ADAS experience needed.',
    `Absolute ADAS is hiring technicians in Western Washington, Bellingham to Olympia.

You do not need ADAS calibration experience. We teach that in weeks. What we cannot teach is how you think through an electrical problem, so that is what we hire for.

Company van, all the equipment, OEM-level training, a real growth path. Apply and six questions land in your inbox. Then a short call with me. Then a paid day out with me on real cars.`),
  P('We teach calibration. We hire for how you think.',
    `Most people who apply have never done an ADAS calibration. That is fine. The procedure is teachable. Diagnostic thinking is not.

If you can chase a voltage drop, find a parasitic draw, and explain why a five-volt reference reads zero, you can learn the rest with us.

Automotive tech experience, comfortable with scanners and tablets, self-motivated, clean driving record. Do not check every box? Apply anyway. We train the right people.`),
  P('Six questions. Your own words. No ghosting.',
    `Here is how hiring works at Absolute ADAS.

Fill out the form and six questions about electrical diagnostics land in your inbox right away. Answer them in your own words. Then a short call with me. Then a paid day out with me on real cars.

You hear back at every step. That is how we operate.`),
  P('A paid day out with the owner, on real cars.',
    `Before anyone joins Absolute ADAS, we spend a paid day together in the van. Real shops, real cars, real calibrations.

You see exactly what the job is. I see how you work. No surprises on either side.

If you have ever taken a job that was not what the ad said, this one is built so that cannot happen.`),
  P('Fully loaded van. Autel scanners. OEM software.',
    `Every Absolute ADAS tech runs a company van with everything on it. Autel scanners, MA600 target frames, seventeen plus OEM software subscriptions.

No buying your own tools for this job. No waiting on a bay. You run your route and go home when the work is done.`),
  P('No shop politics. No clock punching. You run your route.',
    `Mobile means the day is yours to run. Shops from Bellingham to Olympia, cars ready when you get there, the van set up the way you like it.

Self-motivated techs love it. If you need someone standing over you, it is not for you. If you do not, it might be the best job you have had.`),
  P('Get in early. Market lead, trainer, partner.',
    `Absolute ADAS is scaling across the Pacific Northwest. The people who join now are the people who lead the next markets.

Market lead. Trainer. Partner. This is not a dead-end gig. We are building something bigger than one van, and we want techs who want to build it with us.`),
  P('OEM-level training most techs never touch.',
    `Seventeen plus OEM software subscriptions. I-CAR certified. Tools and systems most shops do not have.

You will learn how the car makers want their systems calibrated, not how a video says. We invest in the people who work here, because the work depends on it.`),
  P('Faith, family, fitness, hard work. No drama.',
    `That is the culture at Absolute ADAS. We push each other and we celebrate wins. We show up on time and do the job right. We do not do drama.

If that sounds like you, keep reading. If it sounds like a lot, it is, and it is worth it.`),
  P('Apprentice path: start here, learn ADAS on real cars.',
    `Not a full tech yet? We have an apprentice path.

You ride with our techs, learn the procedures, learn the paperwork, and earn while you do it. Bring automotive experience, a clean record, and the will to learn. We teach the rest.`),
  P('Also hiring: programming and dispatch.',
    `Not everything at Absolute ADAS happens in a van. We are hiring for key and module programming, and for dispatch and shop support.

If you are organized, comfortable with technology, and want to be part of a team that gets cars delivered, apply and pick your role.`),
  P('Know a tech who is better than their job? Send them this.',
    `Our best people come from people who know us.

If you know a technician who is sharp with electrical work and stuck in a flat-rate shop, send them this post. Company van, real training, a paid day out with me before anyone commits. Bellingham to Olympia.`),
]

const ptDateStr = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
const weekdayOf = dateStr => new Date(dateStr + 'T12:00:00Z').getUTCDay()

export async function hiringStatus(req) {
  const meta = (await getVal(req, META_KEY)) || { active: false, next_index: 0, done: {} }
  return { ...meta, posts: POSTS.length, post_days: 'Mon Wed Fri 5:30 PM PT', done_days: Object.keys(meta.done || {}).sort() }
}
export async function setHiringActive(req, active) {
  const meta = (await getVal(req, META_KEY)) || { next_index: 0, done: {} }
  const next = { ...meta, active: Boolean(active), toggled_at: new Date().toISOString() }
  await setVal(req, META_KEY, next)
  return next
}

/** Raw phone photos are 12 MP; sharp on the full frame took the function down (empty 200, 2026-09-28).
 *  Rotate for EXIF, crop a square that keeps the van in the lower two-thirds (the masthead covers the top), resize to 1080. */
async function squareForMasthead(buffer) {
  const sharp = (await import('sharp')).default
  const img = sharp(buffer).rotate()
  const m = await img.metadata()
  const w = m.width || 1200, h = m.height || 1600
  const side = Math.min(w, h)
  const top = h > w ? Math.round((h - w) * 0.30) : 0      // start above the van, not below it
  const left = w > h ? Math.round((w - h) / 2) : 0
  return img.extract({ left, top, width: side, height: side }).resize(1080, 1080).jpeg({ quality: 90 }).toBuffer()
}

async function cardFor(req, n, dateStr) {
  const { pickNextVanPhotoDatastore } = await import('./vanPhotoLibrary.js')
  const { composeAndHostImage } = await import('./captureImage.js')
  const photo = await pickNextVanPhotoDatastore(req, PHOTO_ROTATION_KEY)
  if (!photo?.buffer) throw new Error('no van photo available')
  const base = await squareForMasthead(photo.buffer)
  const r = await composeAndHostImage({ rawBuffer: base, headline: POSTS[n].headline, kicker: 'NOW HIRING', draftId: `hiring-${dateStr}-${String(n + 1).padStart(2, '0')}` })
  if (!r.ok) throw new Error(r.error)
  return { url: r.url, photo: photo.name }
}

/** Preview: build the card for post n (1-12) without queueing anything. */
export async function previewHiring(req, n = 1) {
  const i = Math.max(0, Math.min(POSTS.length - 1, Number(n) - 1))
  const card = await cardFor(req, i, `preview-${Date.now()}`)
  return { n: i + 1, headline: POSTS[i].headline, body: POSTS[i].body, ig: POSTS[i].ig, image_url: card.url, photo: card.photo }
}

/** Queue today's hiring post (Mon/Wed/Fri only), once. Safe to call every hour. */
export async function enqueueTodaysHiring(req, { dateStr = ptDateStr(), dry = false } = {}) {
  const meta = (await getVal(req, META_KEY)) || { active: false, next_index: 0, done: {} }
  if (!meta.active) return { skipped: true, reason: 'hiring campaign inactive' }
  if (!POST_DAYS.has(weekdayOf(dateStr))) return { skipped: true, reason: 'not a posting day' }
  if (meta.done?.[dateStr]) return { skipped: true, reason: 'already queued', ids: meta.done[dateStr].ids }
  const { isMarketingPaused } = await import('./marketingKillSwitch.js')
  if (await isMarketingPaused(req, 'social')) return { skipped: true, reason: 'marketing_paused (social)' }
  const n = (Number(meta.next_index) || 0) % POSTS.length
  const post = POSTS[n]
  const { ptIso } = await import('./guideSeries.js')
  if (dry) return { dry: true, date: dateStr, n: n + 1, headline: post.headline, slots: SCHEDULE.map(s => ({ channel: s.channel, scheduled_for: ptIso(dateStr, s.hour, s.minute) })) }
  const card = await cardFor(req, n, dateStr)
  const ids = []
  for (const s of SCHEDULE) {
    const entry = await enqueueDraft(req, { status: 'approved', channel: s.channel, category: 'hiring', headline: `Now hiring ${n + 1}/12: ${post.headline}`, body: post[s.field], scheduled_for: ptIso(dateStr, s.hour, s.minute), meta: { hiring_n: n + 1 } })
    await updateDraft(req, entry.id, { image_url: card.url, image_status: 'van_photo_card' })
    ids.push({ id: entry.id, channel: s.channel })
  }
  const done = { ...(meta.done || {}), [dateStr]: { n: n + 1, ids: ids.map(i => i.id), at: new Date().toISOString() } }
  await setVal(req, META_KEY, { ...meta, next_index: n + 1, done })
  const kills = ids.map((i, k) => `${SCHEDULE[k].label}: ${buildSignedActionUrl(PUBLIC_BASE, i.id, 'kill')}`).join('\n')
  await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `👷 *Now Hiring post ${n + 1} of 12 queued for tonight*\n"${post.headline}"\nLinkedIn 5:30 · Instagram 5:45 · Facebook 6:00 PT · photo: ${card.photo}\ncard: ${card.url}\n\nKill one if you need to:\n${kills}`).catch(() => {})
  return { queued: true, date: dateStr, n: n + 1, headline: post.headline, image_url: card.url, ids }
}
