// The crew line — who's working, in Mark's own names for them.
//
// Two jobs, and the second one is temporary. It flags any agent that has
// missed its window, and while Mark is still learning the names it prints the
// whole roster with a one-word job so the names attach to something. Once the
// names stick, drop ROSTER_VERBOSE and it collapses to exceptions only.
//
// Windows are deliberately generous. A crew line that cries wolf gets skipped,
// and a skipped line is worse than no line — it trains him to ignore the one
// place a real outage would show up.
import axios from 'axios'

const HEARTBEATS = 'https://adas-iq-904191467.development.catalystserverless.com' +
  '/server/adasiq-api/api/capture-calc/debug/heartbeats'

// key -> [name, one-word job, max age in minutes before it counts as late]
// Weekly and weekday agents get windows wide enough to survive a weekend.
const CREW = {
  postscan:                 ['Otto',    'scans',     150],
  cron_monitor:             ['Sentry',  'crons',     150],
  capture_scheduler:        ['Bristol', 'leads',     150],
  capture_nurture:          ['Bristol', 'drip',      150],
  capture_engagement:       ['Bristol', 'replies',   150],
  capture_van_safety_net:   ['Nora',    'net',       150],
  holiday_poster:           ['Holly',   'holidays',  150],
  capture_meta:             ['Sable',   'meta',     1560],
  van_post:                 ['Miles',   'van post', 1560],
  capture_van_nurture:      ['Nora',    'nurture',  1560],
  mail_agent:               ['Wren',    'mail',      900],
  li_comments:              ['Link',    'LinkedIn',  900],
  li_outreach:              ['Link',    'LinkedIn', 4300],
  capture_weekly:           ['Brew',    'newsletter', 11520],
  capture_van_weekly_draft: ['Hazel',   'weekly',   11520],
  // capture_linkedin is disabled on purpose (if: false in the workflow).
  // Listing it would report a permanent failure for a job nobody wants run.
}

// Shown while the names are still new. Set to false once they stick.
const ROSTER_VERBOSE = process.env.CREW_VERBOSE !== '0'

export async function crewStatus() {
  let hb
  try {
    const r = await axios.get(HEARTBEATS, { timeout: 8000, validateStatus: s => s < 500 })
    hb = r.data?.heartbeats
  } catch (e) { return { error: e.message } }
  if (!hb) return { error: 'no heartbeats' }

  const late = []
  const seen = new Map()   // name -> worst state, since Bristol/Nora/Link own several jobs
  for (const [key, [name, job, maxAge]] of Object.entries(CREW)) {
    const age = hb[key]?.last_success_age_min
    const isLate = age == null || age > maxAge
    if (isLate) late.push({ name, job, age, maxAge })
    const prev = seen.get(name)
    if (!prev || isLate) seen.set(name, { name, job, isLate })
  }
  return { late, roster: [...seen.values()], total: seen.size, working: seen.size - new Set(late.map(l => l.name)).size }
}

// Event-driven: they fire when something happens, not on a clock, so there is
// no window to miss and nothing to health-check. Listed so the names are all
// in one place while Mark learns them — never counted as working or late,
// because we genuinely do not know.
const ON_CALL = [['Marlowe', 'promises'], ['Scout', 'stops'], ['Pierce', 'hiring']]

export function formatCrew(c) {
  if (!c || c.error) return ''
  const L = ['']
  if (!c.late.length) L.push(`Crew: all ${c.total} working.`)
  else {
    L.push(`Crew: ${c.working} of ${c.total} working.`)
    for (const x of c.late) {
      L.push(x.age == null
        ? `${x.name} (${x.job}) has no successful run on record.`
        : `${x.name} (${x.job}) last ran ${x.age > 1440 ? `${Math.round(x.age / 1440)} days` : `${Math.round(x.age / 60)} hours`} ago.`)
    }
  }
  if (ROSTER_VERBOSE) {
    // Names with their job attached, so they stick. Ada and Quill run from the
    // Mac on launchd and have no server heartbeat — Ada is the one writing
    // this, so her being here is its own proof of life.
    L.push('Ada brief · Quill vault · ' + c.roster.map(r => `${r.name} ${r.job}`).join(' · '))
    L.push('On call: ' + ON_CALL.map(([n, j]) => `${n} ${j}`).join(' · '))
  }
  return L.join('\n')
}

export { CREW as CREW_ROSTER }
