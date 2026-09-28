// 📊 Estimator campaign report (Mark 2026-09-28: "i need to keep track of clicks and downloads").
// One Cliq card a day at 5 PM PT, plus /campaign/report on demand:
//   checklist clicks by source (social / email / page / lesson), guide clicks and
//   page views, lesson signups, series posts published, month to date.
// Counts come from the /hit beacon (VanKV link_hits_YYYY-MM), the lantern
// enrollments and the approval queue. Approximate by design, consistent day to day.
import { getVal, setVal } from './vanDatastore.js'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from './cliq.js'

const DONE_KEY = 'campaign_report_done'   // { date }
const ptDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

function sumBy(dayMap, prefix) {
  let n = 0
  for (const [src, c] of Object.entries(dayMap || {})) if (src === prefix || src.startsWith(prefix + '-')) n += Number(c) || 0
  return n
}
function bySource(dayMap, prefix) {
  const out = {}
  for (const [src, c] of Object.entries(dayMap || {})) if (src.startsWith(prefix + '-')) out[src.slice(prefix.length + 1)] = (out[src.slice(prefix.length + 1)] || 0) + (Number(c) || 0)
  if (dayMap && dayMap[prefix]) out.direct = (out.direct || 0) + Number(dayMap[prefix])
  return out
}

export async function campaignNumbers(req, { dateStr = ptDate() } = {}) {
  const month = dateStr.slice(0, 7)
  const hits = (await getVal(req, `link_hits_${month}`)) || {}
  const today = hits[dateStr] || {}
  const mtd = {}
  for (const d of Object.values(hits)) for (const [s, c] of Object.entries(d)) mtd[s] = (mtd[s] || 0) + (Number(c) || 0)
  let lantern = { total: 0, today: 0, active: 0, done: 0, unsubscribed: 0 }
  try {
    const { listEnrollments } = await import('./estimatorLantern.js')
    const list = await listEnrollments(req)
    lantern = { total: list.length, today: list.filter(e => String(e.enrolled_at || '').startsWith(dateStr)).length, active: list.filter(e => e.status === 'active').length, done: list.filter(e => e.status === 'done').length, unsubscribed: list.filter(e => e.status === 'unsubscribed').length }
  } catch (e) { console.warn('[campaign] lantern:', e.message) }
  let series = { published_today: 0, failed_today: 0 }
  try {
    const { listQueue } = await import('./captureApprovalQueue.js')
    const q = await listQueue(req, {})
    const todays = q.filter(d => d.category === 'estimator_series' && String(d.scheduled_for || d.created_at || '').slice(0, 10) === dateStr)
    series = { published_today: todays.filter(d => d.status === 'published').length, failed_today: todays.filter(d => d.status === 'publish_failed').length, queued_today: todays.length }
  } catch (e) { console.warn('[campaign] series:', e.message) }
  let guideDrop = null
  try { const s = (await getVal(req, 'guide_drop_sent')) || {}; guideDrop = { emailed_total: Object.keys(s).length } } catch { /* fine */ }
  return {
    date: dateStr,
    today: { checklist: sumBy(today, 'checklist'), checklist_by_source: bySource(today, 'checklist'), guide_clicks: sumBy(today, 'guide') - (Number(today['guide-page']) || 0), guide_page_views: Number(today['guide-page']) || 0 },
    month: { checklist: sumBy(mtd, 'checklist'), checklist_by_source: bySource(mtd, 'checklist'), guide_clicks: sumBy(mtd, 'guide') - (Number(mtd['guide-page']) || 0), guide_page_views: Number(mtd['guide-page']) || 0 },
    lantern, series, guide_drop: guideDrop,
  }
}

export function formatCampaignCard(n) {
  const src = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none yet'
  return [
    `📊 *Estimator campaign · ${n.date}*`,
    `Checklist downloads today: *${n.today.checklist}* (${src(n.today.checklist_by_source)})`,
    `Guide clicks today: ${n.today.guide_clicks} · guide page views: ${n.today.guide_page_views}`,
    `Lesson signups today: *${n.lantern.today}* · active ${n.lantern.active} · finished ${n.lantern.done} · stopped ${n.lantern.unsubscribed}`,
    `Series posts published today: ${n.series.published_today}${n.series.failed_today ? ` · failed ${n.series.failed_today}` : ''}`,
    '',
    `Month to date: ${n.month.checklist} checklist downloads (${src(n.month.checklist_by_source)}), ${n.month.guide_clicks} guide clicks, ${n.month.guide_page_views} page views, ${n.lantern.total} lesson signups${n.guide_drop ? `, ${n.guide_drop.emailed_total} shops emailed` : ''}.`,
  ].join('\n')
}

/** Post the card once per day (called hourly; fires at or after 17:00 PT). */
export async function maybeDailyCampaignReport(req, { hourPt, force = false } = {}) {
  const today = ptDate()
  const done = (await getVal(req, DONE_KEY)) || {}
  if (!force && (done.date === today || hourPt < 17)) return { skipped: true, reason: done.date === today ? 'already sent today' : 'before 5 PM' }
  const n = await campaignNumbers(req, { dateStr: today })
  await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, formatCampaignCard(n))
  await setVal(req, DONE_KEY, { date: today, at: new Date().toISOString() })
  return { sent: true, numbers: n }
}
