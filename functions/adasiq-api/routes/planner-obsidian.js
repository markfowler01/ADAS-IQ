import { Router } from 'express'
import axios from 'axios'
import catalyst from 'zcatalyst-sdk-node'

const router = Router()

const REPO_OWNER = 'markfowler01'
const REPO_NAME = 'Second-brain'
const AUTHOR_NAME = 'Mark Fowler'
const AUTHOR_EMAIL = 'mf@absoluteadas.com'
const CACHE_KEY_TOKEN = 'github_pat_secondbrain'
const CACHE_KEY_LAST_SYNC = 'obsidian_last_sync'
const GH_API = 'https://api.github.com'

async function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}

async function readToken(segment) {
  try {
    const raw = await segment.getValue(CACHE_KEY_TOKEN)
    return raw ? JSON.parse(raw).token : null
  } catch { return null }
}

async function writeToken(segment, token) {
  const value = JSON.stringify({ token, storedAt: Date.now() })
  try { await segment.update(CACHE_KEY_TOKEN, value) }
  catch { await segment.put(CACHE_KEY_TOKEN, value) }
}

function buildDailyBriefingMarkdown({ date, data }) {
  const {
    intention = '',
    big3 = [],
    bigWin = '',
    didHardThing = '',
    revenue = '',
    kpis = {},
    energy = {},
    delegations = [],
    wentWell = '',
    doDifferently = '',
    gratefulFor = '',
    big3Hit = '',
    score = 0,
    garminBrief = null,
    notes = '',
  } = data

  const fm = [
    '---',
    'type: briefing',
    `date_created: ${date}`,
    'person: Mark',
    'source: 530-app',
    'status: closed',
    `score: ${score}`,
    revenue ? `revenue: ${revenue}` : null,
    kpis.shopVisits ? `shop_visits: ${kpis.shopVisits}` : null,
    kpis.callsMade ? `calls_made: ${kpis.callsMade}` : null,
    kpis.jobsCompleted ? `jobs_completed: ${kpis.jobsCompleted}` : null,
    garminBrief?.sleep?.score ? `sleep_score: ${garminBrief.sleep.score}` : null,
    '---',
  ].filter(Boolean).join('\n')

  const lines = []
  lines.push(`# ${date} Daily Briefing`)
  lines.push('')
  if (intention) { lines.push(`> ${intention}`); lines.push('') }

  lines.push('## Big 3')
  big3.forEach((b, i) => {
    const box = b.done ? '[x]' : '[ ]'
    lines.push(`${i + 1}. ${box} ${b.text || '(empty)'}${b.why ? ` — _${b.why}_` : ''}`)
  })
  if (big3Hit) lines.push(`\n_Big 3 Hit:_ ${big3Hit}`)
  lines.push('')

  if (bigWin) { lines.push('## Big Win'); lines.push(bigWin); lines.push('') }
  if (didHardThing) { lines.push('## Hard Thing'); lines.push(`_${didHardThing}_`); lines.push('') }

  if (revenue || Object.values(kpis).some(v => v)) {
    lines.push('## Revenue & KPIs')
    if (revenue) lines.push(`- Revenue: $${revenue}`)
    if (kpis.shopVisits) lines.push(`- Shop visits: ${kpis.shopVisits}`)
    if (kpis.callsMade)  lines.push(`- Calls made: ${kpis.callsMade}`)
    if (kpis.jobsCompleted) lines.push(`- Jobs completed: ${kpis.jobsCompleted}`)
    lines.push('')
  }

  if (energy.morning || energy.midday || energy.evening) {
    lines.push('## Energy')
    if (energy.morning) lines.push(`- Morning: ${energy.morning}/5`)
    if (energy.midday)  lines.push(`- Midday: ${energy.midday}/5`)
    if (energy.evening) lines.push(`- Evening: ${energy.evening}/5`)
    lines.push('')
  }

  const activeDelegations = (delegations || []).filter(d => d && d.task)
  if (activeDelegations.length) {
    lines.push('## Delegations')
    activeDelegations.forEach(d => {
      lines.push(`- ${d.done ? '[x]' : '[ ]'} **${d.assignee || 'Someone'}:** ${d.task}`)
    })
    lines.push('')
  }

  if (wentWell || doDifferently || gratefulFor) {
    lines.push('## Evening Review')
    if (wentWell) { lines.push('**What went well**'); lines.push(wentWell); lines.push('') }
    if (doDifferently) { lines.push('**What to do differently**'); lines.push(doDifferently); lines.push('') }
    if (gratefulFor) { lines.push('**Grateful for**'); lines.push(gratefulFor); lines.push('') }
  }

  if (garminBrief) {
    lines.push('## Body')
    const s = garminBrief.sleep || {}
    const a = garminBrief.activity || {}
    if (s.totalSeconds) lines.push(`- Sleep: ${(s.totalSeconds / 3600).toFixed(1)}h · score ${s.score ?? '—'}`)
    if (a.steps != null) lines.push(`- Steps: ${a.steps.toLocaleString()}`)
    if (a.restingHeartRate) lines.push(`- Resting HR: ${a.restingHeartRate}`)
    if (garminBrief.suggestion) { lines.push(''); lines.push(`_${garminBrief.suggestion.replace(/\n+/g, ' ')}_`) }
    lines.push('')
  }

  if (notes) { lines.push('## Notes'); lines.push(notes); lines.push('') }

  lines.push(`---`)
  lines.push(`_Synced from 5:30 App on ${new Date().toISOString()}_`)

  return fm + '\n\n' + lines.join('\n')
}

async function putFileToRepo({ token, path, content, message }) {
  const url = `${GH_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    Accept: 'application/vnd.github+json',
    'User-Agent': 'adas-iq-planner-obsidian-sync',
  }

  // Check if file exists to get its SHA
  let sha
  try {
    const existing = await axios.get(url, { headers, timeout: 15000 })
    sha = existing.data?.sha
  } catch (e) {
    if (e.response?.status !== 404) throw e
  }

  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    committer: { name: AUTHOR_NAME, email: AUTHOR_EMAIL },
    author: { name: AUTHOR_NAME, email: AUTHOR_EMAIL },
  }
  if (sha) body.sha = sha

  const res = await axios.put(url, body, { headers, timeout: 20000 })
  return { path, sha: res.data?.content?.sha, commit: res.data?.commit?.sha, updated: !!sha }
}

// POST /api/planner-obsidian/store-token — one-time seeding of the PAT into Cache
router.post('/store-token', async (req, res) => {
  const cronSecret = process.env.MAIL_AGENT_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { token } = req.body || {}
  if (!token || !token.startsWith('github_pat_')) {
    return res.status(400).json({ error: 'token must be a github_pat_... string' })
  }
  try {
    const segment = await getSegment(req)
    await writeToken(segment, token)
    res.json({ ok: true, stored: true, length: token.length })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// POST /api/planner-obsidian/sync-day — planner calls this on Complete Day
// Public (planner is a separate app). Rate is naturally low (once per day).
router.post('/sync-day', async (req, res) => {
  try {
    const { date, data } = req.body || {}
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date required in YYYY-MM-DD form' })
    }
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'data object required' })
    }

    const segment = await getSegment(req)
    const token = await readToken(segment)
    if (!token) return res.status(500).json({ error: 'GitHub PAT not stored yet; call /store-token first' })

    const [year] = date.split('-')
    const path = `Daily Briefings/${year}/${date} Daily Briefing.md`
    const markdown = buildDailyBriefingMarkdown({ date, data })
    const commitMsg = `530: daily briefing ${date}`

    const result = await putFileToRepo({ token, path, content: markdown, message: commitMsg })

    // Track last sync for the debug endpoint
    try {
      const lastSync = JSON.stringify({ date, path, syncedAt: Date.now() })
      try { await segment.update(CACHE_KEY_LAST_SYNC, lastSync) }
      catch { await segment.put(CACHE_KEY_LAST_SYNC, lastSync) }
    } catch {}

    res.json({ ok: true, ...result })
  } catch (err) {
    const detail = err.response?.data || err.message
    console.error('[planner-obsidian] sync failed:', detail)
    res.status(500).json({ ok: false, error: typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500) })
  }
})

// GET /api/planner-obsidian/debug — env + last sync
router.get('/debug', async (req, res) => {
  const out = { repo: `${REPO_OWNER}/${REPO_NAME}` }
  try {
    const segment = await getSegment(req)
    const token = await readToken(segment)
    out.token_stored = !!token
    out.token_prefix = token ? token.slice(0, 15) + '…' : null
    try {
      const last = await segment.getValue(CACHE_KEY_LAST_SYNC)
      if (last) out.last_sync = JSON.parse(last)
    } catch {}
  } catch (e) {
    out.cache_error = e.message
  }
  res.json(out)
})

export default router
