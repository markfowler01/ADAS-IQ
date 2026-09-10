// Recruiting + shop CRM, condensed for the morning brief.
//
// Both boards already exist and both are places Mark has to remember to go
// look. The brief's job is to make that unnecessary: surface only what has a
// date on it or has gone quiet, and stay silent otherwise. A section that
// prints every day regardless of whether anything changed teaches him to skip
// it.
import { getAllShops } from '../routes/shops.js'
import { readAll as readCandidates, STAGES } from '../routes/recruit.js'

const DAY = 86400000
const daysBetween = (a, b) => Math.floor((new Date(b + 'T12:00:00Z') - new Date(String(a).slice(0, 10) + 'T12:00:00Z')) / DAY)

// How long a candidate can sit in a stage before it counts as stalled. These
// are the stages where the ball is in Mark's court; 'new' is short because a
// tech who applied and heard nothing for three days is usually gone.
const STALE_AFTER = { new: 3, contacted: 5, project: 7, phone_screen: 5, ride_along: 5, offer: 3 }
const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.id, s.label.replace(/^\S+\s/, '')]))

export async function recruitingBrief(req, todayISO) {
  let all = []
  try { all = await readCandidates(req) } catch (e) { return { error: e.message, fresh: [], stalled: [], counts: {} } }

  const live = all.filter(c => !['hired', 'did_not_hire', 'do_not_hire'].includes(c.stage))
  const counts = {}
  for (const c of live) counts[c.stage] = (counts[c.stage] || 0) + 1

  // Applied in the last 24h — the only thing here that is genuinely news.
  const fresh = live.filter(c => c.created_at && daysBetween(c.created_at, todayISO) <= 1)

  const stalled = live
    .filter(c => {
      const limit = STALE_AFTER[c.stage]
      if (!limit) return false
      const since = c.updated_at || c.created_at
      return since && daysBetween(since, todayISO) > limit
    })
    .map(c => ({ ...c, idleDays: daysBetween(c.updated_at || c.created_at, todayISO) }))
    .sort((a, b) => b.idleDays - a.idleDays)

  return { fresh, stalled, counts, liveTotal: live.length }
}

export async function shopsBrief(req, todayISO) {
  let all = []
  try { all = await getAllShops(req) } catch (e) { return { error: e.message, due: [], quiet: [] } }
  const active = all.filter(s => s.pipeline_stage !== 'lost' && s.shop_name)

  // A follow-up date Mark set himself. Overdue first, then today's.
  const due = active
    .filter(s => s.next_followup && String(s.next_followup).slice(0, 10) <= todayISO)
    .map(s => ({ ...s, daysLate: daysBetween(s.next_followup, todayISO) }))
    .sort((a, b) => b.daysLate - a.daysLate)

  // Targets he has not touched in a month. Not urgent, but this is the pile
  // that quietly becomes a dead pipeline.
  const quiet = active
    .filter(s => s.pipeline_stage === 'target' && s.last_contact && daysBetween(s.last_contact, todayISO) >= 30)
    .map(s => ({ ...s, idleDays: daysBetween(s.last_contact, todayISO) }))
    .sort((a, b) => b.idleDays - a.idleDays)

  // 41 shops in the CRM, and as of 2026-09-08 not one has a next_followup or
  // a last_contact. Keying the section only off those fields would mean it
  // never prints. So the untouched targets are the section: they are the
  // actual state of the pipeline, and they are the thing worth doing today.
  const neverTouched = active.filter(s => s.pipeline_stage === 'target' && !s.last_contact)

  // Two names a day, rotating, so he gets somebody new each morning instead of
  // staring at the same top-of-list shop until he stops reading the section.
  const seed = Number(todayISO.replace(/-/g, '')) % (neverTouched.length || 1)
  const todaysTwo = neverTouched.length
    ? [neverTouched[seed % neverTouched.length], neverTouched[(seed + 1) % neverTouched.length]]
        .filter((v, i, a) => v && a.indexOf(v) === i)
    : []

  return { due, quiet, neverTouched, todaysTwo, activeTotal: active.length }
}

// Plenty of shop names end in "INC." or "LLC." — appending a period gives
// "ACCURATE AUTO BODY INC..".
const period = t => /[.!?]$/.test(String(t).trim()) ? String(t).trim() : String(t).trim() + '.'

export function formatPipeline(rec, shops) {
  const L = []

  if (rec && !rec.error && (rec.fresh.length || rec.stalled.length)) {
    L.push('', 'Recruiting')
    for (const c of rec.fresh) L.push(`New applicant: ${c.name}${c.certs ? `, ${c.certs}` : ''}.`)
    for (const c of rec.stalled.slice(0, 3)) {
      L.push(`${c.name} has sat in ${STAGE_LABEL[c.stage] || c.stage} for ${c.idleDays} days.`)
    }
  }

  if (shops && !shops.error && (shops.due.length || shops.quiet.length || shops.todaysTwo?.length)) {
    L.push('', 'Shops')
    for (const s of shops.due.slice(0, 4)) {
      L.push(s.daysLate > 0
        ? `${s.shop_name} — follow-up was ${s.daysLate} ${s.daysLate === 1 ? 'day' : 'days'} ago.`
        : `${s.shop_name} — follow-up due today.`)
    }
    if (shops.quiet.length) {
      const top = shops.quiet[0]
      L.push(shops.quiet.length === 1
        ? `${top.shop_name} has gone ${top.idleDays} days with no contact.`
        : `${shops.quiet.length} targets past 30 days with no contact. Longest is ${top.shop_name} at ${top.idleDays}.`)
    }
    if (shops.todaysTwo?.length) {
      L.push(`${shops.neverTouched.length} targets have never been contacted.`)
      L.push(period(`Two for today: ${shops.todaysTwo.map(s2 => s2.shop_name).join(' and ')}`))
    }
  }

  return L.join('\n')
}
