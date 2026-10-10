// 📸 Photo Scout (Mark 2026-10-09: "an agent that goes through all the calibration photos
// and finds me good ones to post on social media").
//
// How it works
//   1. Walks job folders (2026 job root) touched in the last `days` days and picks out the
//      calibration shots: files named "07 Setup…" plus unlabeled images (anything that isn't
//      one of the 8 slot names). Odometer / VIN / corner shots are never social material.
//   2. Haiku screens each new photo (cheap, ~1¢/10 photos): is this post-worthy at all?
//   3. Anything screening ≥ 6 gets a second look from Opus: final 1–10 score, privacy check
//      (licence plate, VIN, customer face, shop sign/logo, paperwork on screen), crop advice,
//      and a caption angle in Mark's brand voice.
//   4. Score ≥ 7 AND safe → the original is COPIED (job folder keeps it) into
//      00_Brand Assets/04_Photos/03_Calibrations/✨ Social picks, named "<score> · <vehicle> · <angle>.jpg".
//   5. Every photo looked at is a row in AdasPhotoScout, so nothing is ever scored twice.
//
// Spend guard: hard cap per run (MAX_PER_RUN) and per day (DAILY_CAP_USD in AppConfig
// photo_scout_spend:<date>). Runs from the hourly postscan piggyback 20:00–05:00 PT, or on demand.
import catalyst from 'zcatalyst-sdk-node'
import Anthropic from '@anthropic-ai/sdk'
import axios from 'axios'
import sharp from 'sharp'
import { tracked } from './spend.js'

const TABLE = 'AdasPhotoScout'
const JOB_ROOT = '28exmfc33000b044047f18dc7f1617c730889'          // 2026 job folders
const VAN_PHOTOS_FOLDER_ID = '0catccbe82bc6c3f243fc9c407f5d39a71b82' // its parent = 00_Brand Assets/04_Photos
const MAX_PER_RUN = 24
const DAILY_CAP_USD = 3
const PICK_SCORE = 7
const SCREEN_MODEL = 'claude-haiku-4-5'
const JUDGE_MODEL = 'claude-opus-4-7'
const SLOT_NAME = /^0[1-8] (odo|vin|lf|rf|rr|lr|setup)/i
const IMG = /\.(jpe?g|png|heic|heif|webp)$/i

const todayPT = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
const hourPT = () => Number(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }))
const esc = s => String(s ?? '').replace(/'/g, "''")
const client = () => tracked(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }))
const parseJson = t => { const m = String(t || '').match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null } catch { return null } }

// ── AppConfig helpers ───────────────────────────────────────────
async function cfgGet(req, key) {
  const r = await catalyst.initialize(req).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${esc(key)}' LIMIT 1`).catch(() => [])
  const row = r?.[0]?.AppConfig; return row ? { id: row.ROWID, value: row.config_value } : null
}
async function cfgSet(req, key, value) {
  const t = catalyst.initialize(req).datastore().table('AppConfig'); const cur = await cfgGet(req, key)
  if (cur) await t.updateRow({ ROWID: cur.id, config_value: String(value) }); else await t.insertRow({ config_key: key, config_value: String(value) })
}

// ── table helpers ───────────────────────────────────────────────
async function seenInFolder(req, folderId) {
  const r = await catalyst.initialize(req).zcql().executeZCQLQuery(`SELECT ps_file_id FROM ${TABLE} WHERE ps_folder_id = '${esc(folderId)}' LIMIT 300`).catch(() => [])
  return new Set((r || []).map(x => x[TABLE]?.ps_file_id))
}
async function saveRow(req, row) {
  const t = catalyst.initialize(req).datastore().table(TABLE)
  try { return await t.insertRow(row) } catch (e) { if (!/unique|duplicate/i.test(e.message)) throw e }
}
export async function listScout(req, { state = '', limit = 200 } = {}) {
  const where = state ? `WHERE ps_state = '${esc(state)}'` : ''
  const r = await catalyst.initialize(req).zcql().executeZCQLQuery(`SELECT * FROM ${TABLE} ${where} ORDER BY ps_score DESC LIMIT ${Math.min(Number(limit) || 200, 300)}`).catch(() => [])
  return (r || []).map(x => { const o = x[TABLE]; let d = {}; try { d = JSON.parse(o.ps_details || '{}') } catch { /* fine */ } return { id: o.ROWID, file_id: o.ps_file_id, folder_id: o.ps_folder_id, folder: o.ps_folder_name, file: o.ps_file_name, score: Number(o.ps_score) || 0, safe: o.ps_safe === 'yes', state: o.ps_state, pick_file_id: o.ps_pick_file_id, scored_at: o.ps_scored_at, ...d } })
}
export async function setState(req, rowId, state) {
  if (!['pick', 'maybe', 'approved', 'used', 'rejected', 'skip'].includes(state)) throw Object.assign(new Error('bad state'), { status: 400 })
  await catalyst.initialize(req).datastore().table(TABLE).updateRow({ ROWID: String(rowId), ps_state: state })
  return { ok: true }
}

// ── WorkDrive ───────────────────────────────────────────────────
async function picksFolder(req, token) {
  const cached = await cfgGet(req, 'photo_scout_picks_folder'); if (cached?.value) return cached.value
  const W = await import('./workdrive.js')
  const H = { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/vnd.api+json' }
  const photos = (await axios.get(`https://www.zohoapis.com/workdrive/api/v1/files/${VAN_PHOTOS_FOLDER_ID}`, { headers: H, timeout: 15000 })).data?.data?.attributes?.parent_id
  const kids = await W.listChildren(photos, token, { folders: true })
  const cal = kids.find(k => /calibrations/i.test(k.name))?.id || (await W.createFolderUnder(photos, '03_Calibrations', token)).folderId
  const ck = await W.listChildren(cal, token, { folders: true })
  const id = ck.find(k => /social picks/i.test(k.name))?.id || (await W.createFolderUnder(cal, '✨ Social picks', token)).folderId
  await cfgSet(req, 'photo_scout_picks_folder', id)
  return id
}

// ── the two looks ───────────────────────────────────────────────
const SCREEN_PROMPT = `You screen photos from a mobile ADAS calibration company (Absolute ADAS) for its social media.
The photos were shot by technicians on the job: calibration targets, radar reflectors, scan tool screens, the van, cars in body shops.
Score how POST-WORTHY this photo is for Instagram/LinkedIn/Facebook, 1-10:
9-10 striking, sharp, well lit, clearly shows calibration work (target boards, laser alignment, rig in front of a car), clean background
7-8 good and usable with a crop
5-6 ok but plain, cluttered, or unclear what is happening
1-4 blurry, dark, tilted, mostly floor/ceiling, a screen photo of paperwork, or not calibration at all
Return ONLY raw JSON: {"score":<1-10>,"what":"<5-10 words describing the photo>"}`

const JUDGE_PROMPT = `You are the social media photo editor for Absolute ADAS, a mobile ADAS calibration company in Western Washington.
Brand voice: plain-spoken, confident, "guy in a blue shirt with grease on his hands" — no hype, no exclamation points, no em dashes.
The audience is collision shop owners and estimators. Posts show real calibration work done right.

Judge this technician photo for posting. Be strict: we would rather post nothing than post a weak or risky photo.
Privacy/safety — flag anything that must NOT be posted as-is:
- licence plate readable, VIN readable, customer name/RO/claim number, phone screen with customer data
- a person's face (techs are OK only if the photo is clearly about the work, but still flag it)
- another company's sign, logo or branding prominent (body shop name, insurer) — flag it, the shop may not want to be shown
Return ONLY raw JSON:
{"score":<1-10 final post-worthiness>,
 "safe":<true if it can be posted as-is or with the suggested crop, false if it needs blurring or can't be used>,
 "issues":["short phrases, empty if none"],
 "crop":"<how to crop/straighten, or 'none'>",
 "subject":"<what the photo shows, e.g. 'front radar target set up on a 2023 Subaru Outback'>",
 "angle":"<the post angle in 3-6 words, e.g. 'Radar aim takes a laser'>",
 "caption":"<one or two sentence caption in the brand voice, no hashtags>"}`

async function look(model, prompt, jpeg, maxTokens) {
  const msg = await client().messages.create({
    model, max_tokens: maxTokens,
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } }, { type: 'text', text: prompt }] }],
  })
  return parseJson(msg.content?.find(c => c.type === 'text')?.text)
}

async function spentToday(req) { return Number((await cfgGet(req, `photo_scout_spend:${todayPT()}`))?.value || 0) }
async function addSpend(req, usd) { await cfgSet(req, `photo_scout_spend:${todayPT()}`, (await spentToday(req) + usd).toFixed(4)) }
// rough per-call cost at ~1024px (≈1.4k image tokens): Haiku ≈ $0.002, Opus ≈ $0.015
const COST = { screen: 0.002, judge: 0.015 }

/** One scouting pass. Returns a summary; safe to call repeatedly (never rescoring a file). */
export async function scout(req, { days = 3, max = MAX_PER_RUN, dry = false } = {}) {
  const { getAccessToken } = await import('./zoho.js'); const W = await import('./workdrive.js')
  const token = await getAccessToken()
  const since = Date.now() - days * 86400000
  const out = { folders: 0, candidates: 0, screened: 0, judged: 0, picked: [], skipped_cap: false, spend_today: 0 }
  const folders = (await W.listChildren(JOB_ROOT, token, { folders: true }))
    .filter(f => !/^530 Planner Backups|^ADAS IQ Backups|^CCC Inbox|^Scrub Library|^SMS Photos|^Absolute ADAS Candidates|^TSB|test/i.test(f.name))
    .filter(f => Number(f.modified || f.created || 0) >= since || days >= 3650)
    .sort((a, b) => Number(b.modified || 0) - Number(a.modified || 0))
  let budget = max; let pickFolder = ''
  // Folders already fully scouted at their current modified time are skipped without a
  // WorkDrive call (a full re-list of every folder per batch tripped WorkDrive's 429 limit).
  let done = {}; try { done = JSON.parse((await cfgGet(req, 'photo_scout_folders_done'))?.value || '{}') } catch { done = {} }
  const markDone = (id, mod) => { done[id] = Number(mod || 0) }
  try {
  for (const f of folders) {
    if (budget <= 0) break
    if (done[f.id] && done[f.id] === Number(f.modified || 0)) continue
    out.folders++
    const files = (await W.listChildren(f.id, token, { folders: false })).filter(x => IMG.test(x.name) && (/^07 setup/i.test(x.name) || !SLOT_NAME.test(x.name)))
    if (!files.length) { markDone(f.id, f.modified); continue }
    const seen = await seenInFolder(req, f.id)
    if (files.every(x => seen.has(x.id))) { markDone(f.id, f.modified); continue }
    let left = 0
    for (const file of files) {
      if (budget <= 0) break
      if (seen.has(file.id)) continue
      out.candidates++; left++
      if (dry) { budget--; continue }
      if (await spentToday(req) > DAILY_CAP_USD) { out.skipped_cap = true; budget = 0; break }
      budget--
      let jpeg
      try { const { buffer } = await W.downloadFile(file.id, token); jpeg = await sharp(buffer).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer() }
      catch (e) { await saveRow(req, { ps_file_id: file.id, ps_folder_id: f.id, ps_folder_name: f.name.slice(0, 250), ps_file_name: file.name.slice(0, 250), ps_score: 0, ps_safe: 'no', ps_state: 'error', ps_details: JSON.stringify({ error: e.message.slice(0, 200) }), ps_scored_at: new Date().toISOString() }); continue }
      const s = await look(SCREEN_MODEL, SCREEN_PROMPT, jpeg, 120).catch(() => null); out.screened++; await addSpend(req, COST.screen)
      let score = Number(s?.score) || 0, details = { what: s?.what || '' }, safe = false
      if (score >= 6) {
        const j = await look(JUDGE_MODEL, JUDGE_PROMPT, jpeg, 500).catch(() => null); out.judged++; await addSpend(req, COST.judge)
        if (j) { score = Number(j.score) || score; safe = j.safe === true; details = { ...details, issues: j.issues || [], crop: j.crop || '', subject: j.subject || '', angle: j.angle || '', caption: j.caption || '' } }
      }
      const isPick = score >= PICK_SCORE && safe
      let pickId = ''
      if (isPick) {
        try {
          pickFolder = pickFolder || await picksFolder(req, token)
          const { buffer, contentType } = await W.downloadFile(file.id, token)
          const name = `${score} · ${f.name.split(' — ').slice(-1)[0].slice(0, 60)} · ${(details.angle || 'calibration').slice(0, 40)}.${(file.name.split('.').pop() || 'jpg').toLowerCase()}`.replace(/[\\/:*?"<>|]+/g, ' ')
          pickId = (await W.uploadFileToFolder(pickFolder, name, buffer, token, contentType || 'image/jpeg'))?.fileId || ''
          out.picked.push({ score, folder: f.name, angle: details.angle, caption: details.caption })
        } catch (e) { details.copy_error = e.message.slice(0, 160) }
      }
      await saveRow(req, { ps_file_id: file.id, ps_folder_id: f.id, ps_folder_name: f.name.slice(0, 250), ps_file_name: file.name.slice(0, 250), ps_score: score, ps_safe: safe ? 'yes' : 'no', ps_state: isPick ? 'pick' : (safe && score >= PICK_SCORE - 1 ? 'maybe' : 'skip'), ps_details: JSON.stringify(details).slice(0, 9500), ps_pick_file_id: pickId, ps_scored_at: new Date().toISOString() })
    }
    if (!dry && budget > 0) markDone(f.id, f.modified)   // inner loop finished this folder
  }
  } catch (e) {
    if (e.response?.status === 429 || /429/.test(e.message)) out.rate_limited = true   // stop quietly; next run resumes
    else throw e
  } finally {
    const keep = Object.fromEntries(Object.entries(done).filter(([id]) => folders.some(f => f.id === id)))
    if (!dry) await cfgSet(req, 'photo_scout_folders_done', JSON.stringify(keep)).catch(() => {})
  }
  out.spend_today = await spentToday(req)
  if (out.picked.length) await announce(req, out.picked).catch(() => {})
  return out
}

async function announce(req, picked) {
  const { postToCliqChannel, SALES_CHANNEL } = await import('./cliq.js')
  const lines = picked.slice(0, 6).map(p => `• *${p.score}/10* · ${p.angle || p.folder}\n   _${p.caption || ''}_`).join('\n')
  await postToCliqChannel(SALES_CHANNEL, `📸 *Photo Scout* found ${picked.length} post-worthy calibration shot${picked.length === 1 ? '' : 's'}\n${lines}\nThey're in 00_Brand Assets → 04_Photos → 03_Calibrations → ✨ Social picks. Review: https://app.adas-iq.com/app/?photoscout=1`)
}

/** Hourly piggyback: 20:00–05:00 PT, one pass per hour, quiet when there's nothing new. */
export async function maybeScout(req) {
  const h = hourPT(); if (!(h >= 20 || h < 5)) return { skipped: 'window' }
  const key = `photo_scout_run:${todayPT()}:${h}`; if (await cfgGet(req, key)) return { skipped: 'done' }
  await cfgSet(req, key, new Date().toISOString())
  return scout(req, { days: 3 })
}
