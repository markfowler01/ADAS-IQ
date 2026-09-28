// 📚 Ongoing estimator series (Mark 2026-09-28: "i want this on going").
//
// The 30 hand-written posts are season one. From day 31 on, the morning the
// series finds no post for today it drafts one here: a topic from the guide's
// fact bank (or a fresh OEM position statement the doc watcher filed), written
// by Claude in Mark's voice under hard rules, checked (no em dashes, no
// exclamation points, anti-sublet, no repeat of the last 45 days), then given
// a highlight card or a scene photo through the same generators, saved as the
// next day, and queued like any other day. If drafting fails, the day reruns
// the oldest season-one post rather than going dark, and Mark hears about it.
import Anthropic from '@anthropic-ai/sdk'
import catalyst from 'zcatalyst-sdk-node'
import { getVal, setVal } from './vanDatastore.js'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from './cliq.js'

const CHECKLIST = 'https://absoluteadas.com/checklist'      // full https so LinkedIn and Facebook make it tappable
const GUIDE = 'https://absoluteadas.com/estimator-guide'
const TAIL = `Download the one-page checklist for your estimating desk, free, no signup:\n${CHECKLIST}\n\nFull guide, line picker, and five short lessons by email:\n${GUIDE}\n\nNot sure on a car? Text the van. 1-844-FIX-ADAS.`
const IG_TAIL = `Download the checklist, free. Link in bio, or type absoluteadas.com/checklist\nFive short lessons by email on the guide page.\nText the van 1-844-FIX-ADAS`
const USED_KEY = 'guide_series_topics_used'   // { [topic_key]: last_used_date }
const REPEAT_DAYS = 45

// ── Fact bank. Every line here is already on the guide page; the drafter may not invent beyond it. ──
export const BANK = [
  { key: 'camera-glass', highlight: 'windshield', facts: 'The forward camera is glued to the windshield behind the mirror. It runs lane keep, auto brake and adaptive cruise. Every glass R&R moves it. Aftermarket glass fails the calibration more often than OE. Subaru says genuine glass only.' },
  { key: 'camera-roof-pillar', highlight: 'windshield', facts: 'Roof and A-pillar structural work moves the forward camera. Subaru mounts the EyeSight camera to the roof header, so roof and pillar repairs move it even with the glass untouched.' },
  { key: 'camera-after-alignment', highlight: 'windshield', facts: 'An alignment changes where the forward camera and front radar look, because thrust angle sets their aim. Most makes require a recalibration after an alignment plus a steering angle sensor reset. Honda calls for camera aiming after an alignment on many models.' },
  { key: 'radar-emblem', highlight: 'grille', facts: 'The front radar sits behind the emblem or grille on the bumper beam. Grille R&R, emblem R&R, bumper cover refinish and a new beam all move it. The emblem has to be the radar-transparent version. On Toyota it will not set a code when it is a little off.' },
  { key: 'radar-paint', highlight: 'front-bumper', facts: 'The radar looks through the bumper cover. Extra coats of paint, plastic weld or a non-OE cover cut the signal. Nothing shows in the bay. It shows on the highway when the car brakes late, or on Nissan as a front radar obstruction warning after delivery.' },
  { key: 'grille-camera', highlight: 'grille', facts: 'On cars with a 360 view the front camera lives low in the grille under the emblem. Grille, front cover and emblem R&R all move it. A wrong grille gives no picture and no code.' },
  { key: 'front-park', highlight: 'front-bumper', facts: 'Front park sensors live in the bumper cover. Most makes want them verified on the post-scan, not calibrated. Paint, plastic weld and the wrong cover are what break them. Ford lists the sensor retainer rings as no-repair parts.' },
  { key: 'mirror-cameras', highlight: 'mirror', facts: 'Mirror cameras feed the 360 view and Honda LaneWatch. Mirror R&R and door R&R move them. A wrong variant mirror gives no code and the wrong picture. A blind spot light alone is not a camera and needs a verify, not a calibration.' },
  { key: 'bsm-two-radars', highlight: 'rear-bumper', facts: 'Blind spot radars sit one each corner behind the rear bumper cover, bracketed to the quarter panel. Rear cross traffic uses the same two. Rear cover R&R, quarter repair and rear body work all move them. Refinish counts.' },
  { key: 'bsm-cover-off', highlight: 'rear-bumper', facts: 'Toyota, Honda, Acura, Hyundai and Kia mount the blind spot module to the quarter panel, not the bumper cover, and it usually needs a hand adjustment. Absolute ADAS calibrates those with the rear cover off. Book the calibration before the cover goes back on. One trip instead of two.' },
  { key: 'rear-camera', highlight: 'liftgate', facts: 'The rear camera sits in the liftgate or trunk trim. Liftgate, tailgate and license trim R&R move it. On Honda multi-view, Toyota panoramic view and Ford 360 that means a camera aim or a surround view calibration. Check the OEM for the VIN.' },
  { key: 'rear-park-ford', highlight: 'rear-bumper', facts: 'Rear park sensors sit in the rear cover. Verify after any refinish. Ford limits rear cover repairs to topcoat refinish only, 12 mils max, and says substrate repairs mean replacement.' },
  { key: 'wheels-thrust', scene: 'A silver compact crossover SUV in the proportions of a RAV4, no badges, on a drive-on alignment rack in a clean shop, alignment heads on all four wheels, no screens visible. Side profile, cool light.', facts: 'Thrust angle decides where the forward camera and the front radar look. Alignment, struts, springs, control arms, tie rods, tires a different size and a lift all move the aim. Alignment first, then calibration, then the steering angle sensor reset.' },
  { key: 'tire-size', highlight: 'front-bumper', facts: 'Bigger tires or a lift change radar height. Ford lists a tire size change as a camera alignment trigger by name.' },
  { key: 'subaru-any-collision', scene: 'A dark gray Subaru-style wagon with slightly raised ride height inside a clean body shop bay, a new windshield on a padded glass stand beside it, no badges. Three-quarter front view, soft bay door light.', facts: 'Subaru with EyeSight: any collision repair gets the EyeSight calibration, not just glass. A hit anywhere can tilt the body a fraction of a degree and the stereo camera sees it. Subaru bulletin 18-231-23 has the shop check body angle with a digital gauge before the cal. Spec OE glass.' },
  { key: 'scan-vs-aim', scene: 'A silver compact crossover SUV in the proportions of a RAV4, no badges, parked squarely on a level line-marked floor in a clean bright bay, open floor in front of it. Calm front view.', facts: 'A scan finds what is broken. It does not prove the aim is right. Ford, May 1, 2026: calibration is required for all vehicles with ADAS-related repairs regardless of whether a DTC is present, and a pre-repair scan is required on every vehicle with damage even when no dashboard indicator is present. "Scanned, no codes found" is not a calibration.' },
  { key: 'scan-order', scene: 'A silver compact crossover SUV in the proportions of a RAV4, no badges, finished and gleaming in a clean delivery bay, roll-up door open to soft morning light. Three-quarter front.', facts: 'The order is pre-scan before the estimate is final, repair, calibrate, post-scan before delivery. Pre-scan and post-scan are both required on every collision RO by Ford, GM and most OEMs.' },
  { key: 'paperwork-six', scene: 'A clean service desk inside a body shop office with a compact crossover visible through the window in the bay behind, a blank clipboard and a pen on the desk, no readable text. Warm interior light.', facts: 'Six things on the calibration paperwork or it is not done: the OEM procedure by name, pre-scan and post-scan reports, aim values before and after, bay or road or both, VIN with tech and date, and any fault found with what was done about it. That paperwork gets the line paid and keeps the shop off a subrogation letter.' },
  { key: 'usually-no', highlight: 'mirror', facts: 'Three things that usually do not need a calibration: a mirror with only a blind spot light, a door skin or shell alone, and a battery disconnect with no parts touched. Verify on the post-scan and move on. One exception: some GM front cameras need a relearn after a dead battery.' },
  { key: 'bay-vs-road', scene: 'A graphite compact crossover SUV in the proportions of a RAV4, no badges, driving on a wet two-lane Pacific Northwest road with crisp painted lane lines, evergreen trees, overcast light. Low three-quarter front view.', facts: 'Bay means targets on a level floor with no metal in the radar view, done at the shop the same day. Road means a drive at speed with good lane lines in daylight, usually not in rain. GM and Jeep cameras calibrate on the road. Toyota, Subaru and VW in the bay. Honda and Nissan need both, bay first. Tesla teaches itself over miles. Plan the road time before promising the car.' },
  { key: 'airbag-structure', scene: 'A white compact crossover SUV in the proportions of a RAV4, no badges, on a frame rack in a clean structural repair bay, hood removed, front structure being measured, no debris. Three-quarter front view.', facts: 'An airbag deployment means the hit was hard enough to move the structure the camera and radar bolt to. Treat the front systems as suspect even when the parts look fine. If seats or pretensioners were replaced, check the OEM for an occupant sensor zero-point.' },
  { key: 'quarter-bracket', highlight: 'quarter', facts: 'Radar brackets live in the quarter panel. A bracket bent two degrees still completes the routine and still reads wrong on the road. On Hyundai, Kia and Genesis the rear corner radars self-align by driving, so check the bracket before the drive, not after the comeback.' },
  { key: 'toyota-no-code', highlight: 'grille', facts: 'Toyota and Lexus: the radar sits behind the emblem and will not throw a code when it is a little off. Clean scan, wrong radar. Front hit means radar calibration every time, and the emblem must be the radar version. The RAV4 is the car Absolute ADAS calibrates most.' },
  { key: 'honda-order', scene: 'A white compact sedan with no badges in a clean shop bay on a line-marked level floor, an open bay door with a quiet road beyond. Three-quarter front view.', facts: 'Honda and Acura: the forward camera aims in the bay and then on the road, in that order. LaneWatch and 360 cameras in the mirror need aiming after a mirror R&R. Blind spot radars mount to the quarter, so the rear cover comes off for the calibration.' },
  { key: 'ford-statement', scene: 'A dark blue full-size pickup with no badges in a clean collision bay, rear bumper removed and set aside, rear corner sensor modules visible on the frame. Three-quarter rear view.', facts: 'Ford and Lincoln: the May 2026 position statement requires calibration on any ADAS repair regardless of DTC. Rear cover refinish is topcoat only, 12 mils max over BLIS. A tire size change is a camera alignment trigger by name.' },
  { key: 'gm-road', scene: 'A gray full-size SUV with no badges on an open highway with crisp lane lines in daylight, dry pavement, low sun behind clouds. Three-quarter front view in motion.', facts: 'GM: the forward camera calibrates on the road and needs miles, lane lines and daylight, so the drive belongs in the delivery promise. Digital surround-view cameras need no calibration, analog ones do. A dead battery can knock a front camera into relearn.' },
  { key: 'nissan-obstruction', highlight: 'front-bumper', facts: 'Nissan and Infiniti: radar behind the emblem. Too many coats on the cover or an aftermarket cover cuts the signal. There is no code in the bay. There is a front radar obstruction warning after delivery, and a phone call.' },
  { key: 'stellantis-order', highlight: 'grille', facts: 'Jeep, Ram, Chrysler: the camera calibrates on the road, the radar in the bay with a reflector. Most front hits need both, bay work first. Level floor and a clear bay, or the radar aim is a guess.' },
  { key: 'tesla-self', scene: 'A white electric crossover with no badges parked at a clean modern overlook with a city skyline in soft focus, early morning blue-hour light. Three-quarter front view.', facts: 'Tesla: cameras self-calibrate over miles and there is no radar to aim. Deliver before the drive is done and the customer calls about Autopilot the next morning.' },
  { key: 'module-programming', highlight: 'grille', facts: 'When a camera or radar module is replaced, it needs programming or configuration first and calibration after, per the OEM. Any ADAS sensor, camera or bracket R&R gets a calibration of that sensor plus pre-scan and post-scan.' },
  { key: 'promise', scene: 'A silver compact crossover SUV in the proportions of a RAV4, no badges, finished and gleaming in a clean delivery bay, roll-up door open to soft morning light. Three-quarter front hero composition.', facts: 'The Absolute Promise: every calibration Absolute ADAS recommends, the shop gets paid for. If the carrier denies it after the documentation, the shop does not pay. Mark writes the OEM-cited rebuttal and it usually flips on the next round. Most calibration lines cost less than the tow that brings the car back.' },
  { key: 'line-wording', scene: 'A clean service desk inside a body shop office with a compact crossover visible through the window in the bay behind, a blank clipboard and a pen on the desk, no readable text. Warm interior light.', facts: 'Estimate lines that survive an adjuster name the sensor and the procedure: "Forward camera calibration per OEM procedure." "Front radar calibration; radar-transparent emblem only." "Blind spot radar calibration, left and right." "Steering angle sensor reset; forward camera and front radar calibration after alignment per OEM." The line picker on the guide page writes them.' },
  { key: 'text-early', scene: 'A silver compact crossover SUV in the proportions of a RAV4, no badges, parked in a clean bay with the roll-up door open to early morning light, keys on the hood not readable. Three-quarter front.', facts: 'Tell Absolute ADAS in the morning that a car is ready and it can almost always be calibrated the same day. Later in the afternoon, plan on the next day. Before the van arrives: alignment done, windshield in, bumper covers on, keys with the car, half a tank if the calibration is dynamic.' },
]

function anthropic() { return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) }
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)

/** Fresh OEM position statements the doc watcher filed (last 60 days) become topics too. */
async function oemTopics(req) {
  try {
    const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery('SELECT ROWID, doc_oem, doc_title, doc_summary, doc_imported_at FROM AdasPositionStatements LIMIT 60')
    const cutoff = Date.now() - 60 * 86400000
    return (rows || []).map(r => r.AdasPositionStatements || r).filter(r => r.doc_summary && Date.parse(r.doc_imported_at || 0) > cutoff).map(r => ({
      key: `oem-${r.ROWID}`,
      scene: `A late-model ${String(r.doc_oem || 'vehicle')}-style vehicle with no badges or readable logos inside a clean modern collision repair bay, three-quarter front view, soft bay door light.`,
      facts: `${r.doc_oem} position statement, "${String(r.doc_title || '').slice(0, 120)}": ${String(r.doc_summary || '').slice(0, 700)}`,
      oem: true,
    }))
  } catch (e) { console.warn('[series drafter] oem topics:', e.message); return [] }
}

async function pickTopic(req, recentPosts) {
  const used = (await getVal(req, USED_KEY)) || {}
  const cutoff = Date.now() - REPEAT_DAYS * 86400000
  const fresh = k => !used[k] || Date.parse(used[k]) < cutoff
  const oem = (await oemTopics(req)).filter(t => fresh(t.key))
  if (oem.length) return oem[0]                                        // new OEM paper beats evergreen
  const evergreen = BANK.filter(t => fresh(t.key))
  const pool = evergreen.length ? evergreen : BANK                     // all used inside 45 days: start over
  // Least-recently used first, ties broken randomly
  pool.sort((a, b) => (Date.parse(used[a.key] || 0) - Date.parse(used[b.key] || 0)) || (Math.random() - 0.5))
  return pool[0]
}

const VOICE = `You write as Mark Fowler, owner of Absolute ADAS, a mobile ADAS calibration company in Western Washington, talking to body shop owners and estimators.
Voice test: would a guy in a blue shirt with grease on his hands write this? Plain words. Short sentences, 5 to 14 words. Third-grade reading level. Industry words are fine (RO, DTC, OEM, cal, R&R, subrogation).
HARD RULES: no em dashes, no exclamation points, no emojis, no hashtags, no links (they are added after), no discounts, no words like synergy or leverage. Never tell a shop to avoid, drop or stop using any calibration vendor or sublet. Use only the facts you are given. Do not invent numbers, bulletins, or OEM claims.`

/** Draft one new post for a date. dry=true returns the draft without saving or making an image. */
export async function draftNextSeriesPost(req, { dateStr, dry = false }) {
  const { readChunkedArray, writeChunkedArray } = await import('./vanDatastore.js')
  const { generateHighlightImage, generateSeriesImage } = await import('./guideSeries.js')
  const meta = await getVal(req, 'guide_series_meta')
  if (!meta || !meta.active) return { ok: false, error: 'series inactive' }
  const posts = await readChunkedArray(req, 'guide_series_posts')
  const idx = daysBetween(meta.start_date, dateStr)
  const day = idx + 1
  if (posts.find(p => Number(p.day) === day)) return { ok: true, existed: true, day }
  const recent = posts.filter(p => day - Number(p.day) <= REPEAT_DAYS && day - Number(p.day) > 0)
  const topic = await pickTopic(req, recent)
  const avoid = recent.map(p => `- ${p.kicker}: ${p.headline}`).join('\n')

  const resp = await anthropic().messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 900,
    system: `${VOICE}
You draft ONE social post for a daily series called "When does this car need a calibration?" for estimators. Output ONLY JSON:
{"kicker": "UPPERCASE LABEL, 2 TO 6 WORDS", "headline": "one plain sentence, 6 to 11 words, ends with a period", "body": "3 short paragraphs separated by blank lines, 55 to 110 words total, last paragraph starts with 'Ask your cal shop:' and is one question in quotes", "ig": "the same idea in 2 short paragraphs, 35 to 70 words"}
The headline must not repeat any headline in the AVOID list. Do not add a sign-off, links or a call to action; those are appended.`,
    messages: [{ role: 'user', content: `TOPIC FACTS (use only these):\n${topic.facts}\n\nAVOID (recent headlines):\n${avoid || '(none)'}` }],
  })
  const raw = resp.content?.[0]?.text || ''
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  let d
  try { d = JSON.parse(json) } catch { throw new Error(`drafter returned non-JSON: ${raw.slice(0, 120)}`) }
  for (const k of ['kicker', 'headline', 'body', 'ig']) if (!d[k] || typeof d[k] !== 'string') throw new Error(`drafter missing ${k}`)
  const all = `${d.kicker}\n${d.headline}\n${d.body}\n${d.ig}`
  if (/—|!/.test(all)) throw new Error('drafter used an em dash or exclamation point')
  if (d.headline.length > 90) throw new Error('headline too long')
  const { detectAntiSubletViolation } = await import('./captureStoryGenerator.js')
  const hit = detectAntiSubletViolation(all)
  if (hit) throw new Error(`anti-sublet guard: ${hit}`)

  const post = {
    day, kicker: String(d.kicker).toUpperCase().slice(0, 60), headline: d.headline.trim(), body: `${d.body.trim()}\n\n${TAIL}`, ig: `${d.ig.trim()}\n\n${IG_TAIL}`,
    image_url: '', scene: topic.scene || '', topic_key: topic.key, auto_drafted_at: new Date().toISOString(),
  }
  if (dry) return { ok: true, dry: true, day, topic: topic.key, post }

  posts.push(post); posts.sort((a, b) => Number(a.day) - Number(b.day))
  await writeChunkedArray(req, 'guide_series_posts', posts, { chunkSize: 3 })
  await setVal(req, 'guide_series_meta', { ...meta, count: Math.max(meta.count || 0, day), end_date: dateStr, ongoing: true })
  const used = (await getVal(req, USED_KEY)) || {}
  used[topic.key] = dateStr
  await setVal(req, USED_KEY, used)
  // Picture: highlight card when the topic names a panel, otherwise a scene photo.
  let img
  try { img = topic.highlight ? await generateHighlightImage(req, { day, key: topic.highlight, segment: catalyst.initialize(req).cache().segment() }) : await generateSeriesImage(req, { day, segment: catalyst.initialize(req).cache().segment() }) }
  catch (e) { img = { ok: false, error: e.message } }
  if (!img?.ok) await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `⚠️ Estimator series day ${day} drafted ("${post.headline}") but the picture failed: ${img?.error || 'unknown'}. It will post text-only on LinkedIn/Facebook and be skipped on Instagram unless a picture is added.`).catch(() => {})
  return { ok: true, day, topic: topic.key, headline: post.headline, image: img?.ok ? img.url : null }
}

/** Fallback when drafting fails: rerun the oldest season-one post for this day so the slot is never dark. */
export async function rerunSeedPost(req, { dateStr }) {
  const { readChunkedArray, writeChunkedArray } = await import('./vanDatastore.js')
  const meta = await getVal(req, 'guide_series_meta')
  const posts = await readChunkedArray(req, 'guide_series_posts')
  const idx = daysBetween(meta.start_date, dateStr); const day = idx + 1
  const seeds = posts.filter(p => Number(p.day) <= 30 && p.image_url)
  if (!seeds.length) return { ok: false }
  const src = seeds[(day - 1) % seeds.length]
  const post = { ...src, day, rerun_of: src.day, auto_drafted_at: new Date().toISOString() }
  posts.push(post); posts.sort((a, b) => Number(a.day) - Number(b.day))
  await writeChunkedArray(req, 'guide_series_posts', posts, { chunkSize: 3 })
  await setVal(req, 'guide_series_meta', { ...meta, count: Math.max(meta.count || 0, day), end_date: dateStr, ongoing: true })
  return { ok: true, day, rerun_of: src.day, headline: post.headline }
}
