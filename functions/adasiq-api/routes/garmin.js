import { Router } from 'express'
import catalyst from 'zcatalyst-sdk-node'
import garminPkg from 'garmin-connect'
import Anthropic from '@anthropic-ai/sdk'

const { GarminConnect } = garminPkg
const router = Router()
console.log('[garmin] route module loaded; GarminConnect type:', typeof GarminConnect)

const SUGGESTION_SYSTEM = `You are Mark's personal performance coach. Mark owns an automotive ADAS calibration shop and wakes at 4:30 AM to run his schedule.

Given last night's sleep and yesterday's activity data, give him 2 short, actionable suggestions for today: one about energy management, one about what kind of Big 3 priorities to take on. Be direct, no fluff, no hedging. Under 60 words total. Plain text, no markdown.`

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

async function cacheGet(segment, key, fallback = null) {
  try {
    const val = await segment.getValue(key)
    return val ? JSON.parse(val) : fallback
  } catch (e) {
    if (isNotFound(e)) return fallback
    throw e
  }
}

async function cacheSet(segment, key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  try { await segment.update(key, str) }
  catch { await segment.put(key, str) }
}

function ymd(date) {
  return date.toISOString().slice(0, 10)
}

function yesterdayPT() {
  // Pacific Time "yesterday" — when the cron fires at 10 AM UTC, that's still
  // the same calendar day in PT for both PST and PDT, so subtracting 1 day
  // from now (UTC) gives us yesterday in PT.
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return ymd(d)
}

async function fetchGarminData(dateStr) {
  const email = process.env.GARMIN_EMAIL
  const password = process.env.GARMIN_PASSWORD
  if (!email || !password) {
    throw new Error('GARMIN_EMAIL or GARMIN_PASSWORD env var missing')
  }

  const client = new GarminConnect({ username: email, password })
  await client.login()

  const date = new Date(dateStr + 'T12:00:00Z')
  const result = { date: dateStr, sleep: null, activity: null, errors: [] }

  try {
    const sleep = await client.getSleepData(dateStr)
    result.sleep = {
      totalSeconds: sleep?.dailySleepDTO?.sleepTimeSeconds ?? null,
      deepSeconds: sleep?.dailySleepDTO?.deepSleepSeconds ?? null,
      remSeconds: sleep?.dailySleepDTO?.remSleepSeconds ?? null,
      lightSeconds: sleep?.dailySleepDTO?.lightSleepSeconds ?? null,
      awakeSeconds: sleep?.dailySleepDTO?.awakeSleepSeconds ?? null,
      score: sleep?.dailySleepDTO?.sleepScores?.overall?.value ?? null,
    }
  } catch (e) {
    result.errors.push('sleep: ' + e.message)
  }

  try {
    const steps = await client.getSteps(date)
    const hr = await client.getHeartRate(date).catch(() => null)
    result.activity = {
      steps: typeof steps === 'number' ? steps : (steps?.totalSteps ?? null),
      restingHeartRate: hr?.restingHeartRate ?? null,
      maxHeartRate: hr?.maxHeartRate ?? null,
    }
  } catch (e) {
    result.errors.push('activity: ' + e.message)
  }

  return result
}

function formatForPrompt(data) {
  const s = data.sleep || {}
  const a = data.activity || {}
  const hours = (sec) => sec ? (sec / 3600).toFixed(1) + 'h' : 'n/a'
  return [
    `Date: ${data.date}`,
    `Sleep: total ${hours(s.totalSeconds)}, deep ${hours(s.deepSeconds)}, REM ${hours(s.remSeconds)}, light ${hours(s.lightSeconds)}, awake ${hours(s.awakeSeconds)}, score ${s.score ?? 'n/a'}`,
    `Activity: ${a.steps ?? 'n/a'} steps, resting HR ${a.restingHeartRate ?? 'n/a'}, max HR ${a.maxHeartRate ?? 'n/a'}`,
  ].join('\n')
}

async function generateSuggestion(data) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 200,
    system: SUGGESTION_SYSTEM,
    messages: [{ role: 'user', content: formatForPrompt(data) }],
  })
  return msg.content[0]?.text?.trim() || null
}

// POST /api/garmin/sync — cron-triggered daily Garmin pull + AI suggestion
router.post('/sync', async (req, res) => {
  const cronSecret = process.env.GARMIN_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const dateStr = req.query.date || yesterdayPT()
  try {
    const data = await fetchGarminData(dateStr)
    let suggestion = null
    try { suggestion = await generateSuggestion(data) }
    catch (e) { data.errors.push('suggestion: ' + e.message) }

    const payload = { ...data, suggestion, syncedAt: Date.now() }
    const segment = catalyst.initialize(req).cache().segment()
    await cacheSet(segment, `garmin_data_${dateStr}`, payload)
    await cacheSet(segment, 'garmin_latest_date', dateStr)
    res.json({ ok: true, date: dateStr, hasSleep: !!data.sleep, hasActivity: !!data.activity, hasSuggestion: !!suggestion, errors: data.errors })
  } catch (err) {
    console.error('[garmin/sync] failed:', err.message)
    res.status(500).json({ ok: false, error: err.message })
  }
})

// GET /api/garmin/today — planner reads this; returns latest cached data + suggestion
router.get('/today', async (req, res) => {
  try {
    const segment = catalyst.initialize(req).cache().segment()
    const date = req.query.date || (await cacheGet(segment, 'garmin_latest_date'))
    if (!date) return res.json({ ok: true, data: null, message: 'No Garmin data synced yet' })
    const data = await cacheGet(segment, `garmin_data_${date}`)
    res.json({ ok: true, data })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// GET /api/garmin/debug — diagnostic: confirm env vars and last sync info
router.get('/debug', async (req, res) => {
  const out = {
    env_email: !!process.env.GARMIN_EMAIL,
    env_password: !!process.env.GARMIN_PASSWORD,
    env_cron_secret: !!process.env.GARMIN_CRON_SECRET,
    env_anthropic: !!process.env.ANTHROPIC_API_KEY,
  }
  try {
    const segment = catalyst.initialize(req).cache().segment()
    out.latest_date = await cacheGet(segment, 'garmin_latest_date')
    if (out.latest_date) {
      const data = await cacheGet(segment, `garmin_data_${out.latest_date}`)
      out.latest_synced_at = data?.syncedAt ? new Date(data.syncedAt).toISOString() : null
      out.latest_has_sleep = !!data?.sleep
      out.latest_has_activity = !!data?.activity
      out.latest_has_suggestion = !!data?.suggestion
      out.latest_errors = data?.errors || []
    }
  } catch (e) {
    out.cache_error = e.message
  }
  res.json(out)
})

export default router
