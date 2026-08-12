// Holiday auto-poster (Mark 2026-08-13: "yes build it") — the feature
// the June design doc described but whose code never actually shipped
// (the old GH cron step 404'd on this exact path for two months).
//
//   POST/GET /api/holiday-poster/run  (BREW cron secret, same flex gate
//   as /api/cron-monitor) — called daily by the GH Actions daily-tasks
//   job via the /debug/holiday-poster-run forward.
//
// Behavior: the day BEFORE one of the 7 major US holidays, draft ONE
// unified brand-presence post (same body for LinkedIn + Instagram +
// Facebook, one shared image, auto-approved) scheduled for 8am PT on
// the holiday itself. Per-holiday AppConfig stamp = drafting is
// idempotent no matter how many times the cron fires. Heartbeat
// 'holiday_poster' stamps from day one so the watchdog sees it.

import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import catalyst from 'zcatalyst-sdk-node'
import { enqueueDraft, updateDraft } from '../services/captureApprovalQueue.js'
import { generateCaptureImage, captureImagesEnabled } from '../services/captureImage.js'
import { sanitizeAiOutput } from '../services/textSanitize.js'
import { heartbeatAttempt, stampSuccess } from '../services/cronHeartbeat.js'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from '../services/cliq.js'

const router = express.Router()

function requireCronSecretFlex(req, res, next) {
  const want = String(process.env.BREW_CRON_SECRET || '').replace(/[^a-zA-Z0-9]/g, '')
  const got = String(req.headers['x_cron_secret'] || req.headers['x-cron-secret'] || req.query.secret || '').replace(/[^a-zA-Z0-9]/g, '')
  if (want && got !== want) return res.status(401).type('text/plain').send('Unauthorized')
  next()
}

// ── The 7 major US holidays ─────────────────────────────────────────────
function nthWeekdayOfMonth(year, month, weekday, n) {
  // month 0-11, weekday 0=Sun. n>0: nth from start; n=-1: last of month.
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const lastDay = new Date(Date.UTC(year, month + 1, 0))
  const back = (lastDay.getUTCDay() - weekday + 7) % 7
  const day = lastDay.getUTCDate() - back
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function holidaysForYear(year) {
  return [
    { slug: 'new-years',    name: "New Year's Day",   date: `${year}-01-01`, closed: true },
    { slug: 'memorial-day', name: 'Memorial Day',     date: nthWeekdayOfMonth(year, 4, 1, -1), closed: true },
    { slug: 'july-4',       name: 'Independence Day', date: `${year}-07-04`, closed: true },
    { slug: 'labor-day',    name: 'Labor Day',        date: nthWeekdayOfMonth(year, 8, 1, 1), closed: true },
    { slug: 'veterans-day', name: 'Veterans Day',     date: `${year}-11-11`, closed: false },
    { slug: 'thanksgiving', name: 'Thanksgiving',     date: nthWeekdayOfMonth(year, 10, 4, 4), closed: true },
    { slug: 'christmas',    name: 'Christmas',        date: `${year}-12-25`, closed: true },
  ]
}

function todayPT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
function addDaysISO(iso, n) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
// 8am PT on the given date, as a real instant (handles PDT/PST via trick:
// build both offsets and pick the one that formats back to 8am PT).
function eightAmPT(dateISO) {
  for (const off of ['-07:00', '-08:00']) {
    const d = new Date(`${dateISO}T08:00:00${off}`)
    const back = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(d)
    if (Number(back) === 8) return d
  }
  return new Date(`${dateISO}T08:00:00-07:00`)
}

// ── Dedup stamp (AppConfig KV — durable, one row per holiday) ───────────
async function readStamp(req, key) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT config_value FROM AppConfig WHERE config_key = '${key}' LIMIT 1`
  )
  const r = rows?.[0]?.AppConfig || rows?.[0] || null
  return r?.config_value || null
}
async function writeStamp(req, key, value) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const rows = await app.zcql().executeZCQLQuery(
    `SELECT ROWID FROM AppConfig WHERE config_key = '${key}' LIMIT 1`
  )
  const existing = rows?.[0]?.AppConfig || rows?.[0] || null
  const table = app.datastore().table('AppConfig')
  if (existing?.ROWID) await table.updateRow({ ROWID: String(existing.ROWID), config_key: key, config_value: value })
  else await table.insertRow({ config_key: key, config_value: value })
}

// ── Claude draft — brand-presence holiday post, unified across channels ─
const HOLIDAY_SYSTEM = `You write social posts for Absolute ADAS, a mobile ADAS calibration company in Snohomish County, WA. The owner is a guy in a blue work shirt with grease on his hands — every word must sound like HIM, not a marketing department.

VOICE RULES (hard):
- Plain, warm, short sentences. No corporate holiday-speak ("wishing you and yours").
- NO exclamation points. NO em dashes (use a comma or period). NO hashtags. NO emojis. NO call to action, no phone number, no links. This is a brand-presence post, not an ad.
- 2-4 sentences max. It should read like a text from a guy who works on cars.
- If the shop is closed that day, say it simply and say when we're back.
- Gratitude beats salesmanship. Mention the crew, the shops we work with, or the quiet of a day off.

IMAGE PROMPT RULES:
- Documentary photo style, real working shop or driveway, natural light.
- A non-luxury vehicle (Camry, F-150, RAV4, Civic era 2015-2022).
- A small, tasteful nod to the holiday (a flag on the toolbox, frost on the windshield, an empty quiet bay). Never cheesy graphics or text overlays.
- One sentence, under 100 words.`

async function draftHolidayPost(holiday) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 700,
    system: HOLIDAY_SYSTEM,
    messages: [{
      role: 'user',
      content: `Holiday: ${holiday.name} (${holiday.date}). Shop is ${holiday.closed ? 'CLOSED that day, back the next business day' : 'OPEN, normal schedule'}.

Write the post. Return JSON only: {"headline":"...","body":"...","image_prompt":"..."}`,
    }],
  })
  const raw = (msg.content?.[0]?.text || '').trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '')
  const parsed = JSON.parse(raw)
  return {
    headline: sanitizeAiOutput(String(parsed.headline || holiday.name)).slice(0, 120),
    body: sanitizeAiOutput(String(parsed.body || '')).slice(0, 900),
    image_prompt: String(parsed.image_prompt || '').trim().slice(0, 1200),
  }
}

// ── The run ─────────────────────────────────────────────────────────────
router.all('/run', heartbeatAttempt('holiday_poster'), requireCronSecretFlex, async (req, res) => {
  try {
    const today = todayPT()
    const tomorrow = addDaysISO(today, 1)
    const year = Number(today.slice(0, 4))
    // Look across the year boundary too (Dec 31 → Jan 1).
    const all = [...holidaysForYear(year), ...holidaysForYear(year + 1)]

    // Dry run — draft the copy for a named holiday and return it WITHOUT
    // enqueueing, stamping, or generating an image. Verification only.
    if (String(req.query.dry || '') === '1') {
      const slug = String(req.query.holiday || 'thanksgiving')
      const h = all.find(x => x.slug === slug) || all[0]
      const preview = await draftHolidayPost(h)
      return res.json({ ok: true, action: 'dry-run', holiday: h.name, date: h.date, preview })
    }
    // Draft the day before, so the 8am-PT slot is always in the future
    // when the (once-daily, ~8:43am PT) cron fires.
    const target = all.find(h => h.date === tomorrow)

    if (!target) {
      await stampSuccess(req, 'holiday_poster', { checked: today, next: all.find(h => h.date > today)?.date || null })
      return res.json({ ok: true, action: 'none', reason: `no holiday tomorrow (${tomorrow})` })
    }

    const stampKey = `holiday_posted:${target.date}-${target.slug}`.slice(0, 64)
    if (await readStamp(req, stampKey)) {
      await stampSuccess(req, 'holiday_poster', { holiday: target.slug, action: 'already-drafted' })
      return res.json({ ok: true, action: 'already-drafted', holiday: target.name })
    }

    const draft = await draftHolidayPost(target)

    // ONE image shared across the three channels (same pattern as the
    // daily unified drafter).
    let imageUrl = null
    let imageError = null
    if (captureImagesEnabled()) {
      const segment = catalyst.initialize(req).cache().segment()
      const r = await generateCaptureImage(
        { headline: draft.headline, draftId: `holiday-${target.date}-${target.slug}` },
        { segment, sceneOverride: draft.image_prompt }
      ).catch(e => ({ ok: false, error: e.message }))
      if (r?.ok) imageUrl = r.url
      else imageError = r?.error || 'image generation failed'
    }

    const CHANNELS = [
      { channel: 'linkedin_personal',  minute: 0 },
      { channel: 'instagram_business', minute: 15 },
      { channel: 'facebook_page',      minute: 30 },
    ]
    const base = eightAmPT(target.date)
    const drafts = []
    for (const { channel, minute } of CHANNELS) {
      const when = new Date(base.getTime() + minute * 60_000)
      const entry = await enqueueDraft(req, {
        channel,
        category: 'holiday',
        headline: draft.headline,
        body: draft.body,
        scheduled_for: when.toISOString(),
        meta: { group: `holiday-${target.date}`, holiday: target.slug, image_prompt: draft.image_prompt || null, unified: true },
        status: 'approved',
      })
      if (imageUrl) await updateDraft(req, entry.id, { image_url: imageUrl, image_status: 'generated' })
      else if (!captureImagesEnabled()) await updateDraft(req, entry.id, { image_status: 'disabled' })
      else await updateDraft(req, entry.id, { image_status: 'failed', image_error: imageError })
      drafts.push({ channel, id: entry.id, scheduled_for: when.toISOString() })
    }

    await writeStamp(req, stampKey, new Date().toISOString())

    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, [
      `🎆 *HOLIDAY POST DRAFTED* — ${target.name} (${target.date})`,
      `Posts 8am PT on the holiday to LinkedIn, Instagram, Facebook. Auto-approved, delete any you don't want.`,
      '',
      `*Headline:* ${draft.headline}`,
      `"${draft.body.slice(0, 300)}"`,
      imageUrl ? '🖼️ image attached' : `⚠️ no image: ${imageError || 'images disabled'}`,
    ].join('\n')).catch(() => {})

    await stampSuccess(req, 'holiday_poster', { holiday: target.slug, drafts: drafts.length, with_image: !!imageUrl })
    res.json({ ok: true, action: 'drafted', holiday: target.name, drafts })
  } catch (e) {
    console.error('[holiday-poster]', e.message)
    res.json({ ok: false, error: e.message })
  }
})

export { router as holidayPosterRouter }
