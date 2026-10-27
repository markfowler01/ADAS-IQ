// ⚡ Pays on the spot (Mark 2026-10-26): "a couple of our shops give us
// paychecks right after the job is done … Showcase and Perfect Reflections …
// the point of this is to get an invoice ASAP so that we can pick up a check
// on the spot." The shop won't write the check until it has the invoice, so the
// tech is standing there waiting on Kat.
//
// Loop: tech taps "10 min out" → Kat gets a push → car hits Ready to Invoice →
// card jumps to the top with a timer + Kat push + bell → 10 min no invoice →
// Kat again → 20 min → Mark (Cliq) → Bill it sends → the tech gets "invoice
// sent, grab the check" → tech logs check # + amount → #financeadmin.
//
// Per-shop rule: CRM billing_rules.spot_pay. State per job in DurableKV
// `spot_pay:<jobId>`; the open list in `spot_pay_open`; finished ones in `spot_pay_log`.
// Kat never gets a Cliq DM (Mark 2026-10-24) — push + bell + #dispatch only.
import catalyst from 'zcatalyst-sdk-node'
import { kvGet, kvSet } from './durableKV.js'

const OPEN_KEY = 'spot_pay_open', LOG_KEY = 'spot_pay_log'
const KAT_NUDGE_MIN = 10, MARK_NUDGE_MIN = 20
const app = req => catalyst.initialize(req)
const fmtUSD = n => `$${(Number(n) || 0).toFixed(2)}`
const carOf = j => j.vehicle || [j.year, j.make, j.model].filter(Boolean).join(' ') || 'car'
const minsSince = iso => Math.round((Date.now() - Date.parse(iso)) / 60000)

async function getJson(req, key, fallback) { try { const v = await kvGet(app(req), key); return v ? JSON.parse(v) : fallback } catch { return fallback } }
async function setJson(req, key, val) { await kvSet(app(req), key, JSON.stringify(val)) }
export const readSpot = (req, jobId) => getJson(req, `spot_pay:${jobId}`, null)
const writeSpot = (req, jobId, st) => setJson(req, `spot_pay:${jobId}`, st)
async function trackOpen(req, jobId, on) {
  const list = new Set(await getJson(req, OPEN_KEY, []))
  if (on) list.add(String(jobId)); else list.delete(String(jobId))
  await setJson(req, OPEN_KEY, [...list].slice(-100))
}

/** Is this job's shop a pays-on-the-spot shop? */
export async function isSpotPayShop(req, shopName) {
  if (!shopName) return false
  try {
    const { findShopByName } = await import('./big3.js')
    const sh = await findShopByName(req, shopName)
    const br = typeof sh?.billing_rules === 'string' ? (JSON.parse(sh.billing_rules || '{}') || {}) : (sh?.billing_rules || {})
    return !!br.spot_pay
  } catch { return false }
}

// Push to one person's phones (subscriptions are tagged with the user).
async function pushTo(req, who, msg) {
  try {
    const { sendPushToAll } = await import('../routes/push.js')
    const { cascadeKeyFor } = await import('./liveCalls.js')
    return await sendPushToAll(req, msg, s => cascadeKeyFor({ email: s.user, name: s.user }) === who)
  } catch (e) { console.warn('[spot-pay] push', e.message); return { sent: 0 } }
}
async function bell(req, to, toEmail, title, body, job) {
  try { const { createNotification } = await import('../routes/notifications.js'); await createNotification(req, { to, toEmail, type: 'spot_pay', title, body, jobId: job?.id, job, skipCliq: true }) } catch (e) { console.warn('[spot-pay] bell', e.message) }
}
const techKey = j => { const t = String(j.technician || '').toLowerCase(); return /jayden|jaden/.test(t) ? 'jayden' : /mark/.test(t) ? 'mark' : t.split(/\s+/)[0] || '' }

/** Tech: "⚡ 10 min out" — Kat gets ready before the car is done. */
export async function spotHeadsUp(req, job, by) {
  const st = (await readSpot(req, job.id)) || { job_id: String(job.id), shop: job.shop_name }
  st.heads_up_at = new Date().toISOString(); st.heads_up_by = by
  await writeSpot(req, job.id, st); await trackOpen(req, job.id, true)
  const title = `⚡ ${job.shop_name} · ${carOf(job)} done in ~10 min`
  const body = `${by || 'The tech'} is waiting on site for the check. Get Bill it ready.`
  await Promise.all([pushTo(req, 'kat', { title, body, url: '/app/index.html', tag: `spot-${job.id}` }), bell(req, 'Kath', 'k.belmonte@absoluteadas.com', title, body, job)])
  return st
}

/** Car moved to Ready to Invoice. Called from routes/jobs.js on the status change. */
export async function spotPayReady(req, job) {
  if (!(await isSpotPayShop(req, job.shop_name))) return null
  const st = (await readSpot(req, job.id)) || { job_id: String(job.id), shop: job.shop_name }
  if (st.ready_at && !st.billed_at) return st
  Object.assign(st, { ready_at: new Date().toISOString(), tech: job.technician || '', car: carOf(job), nudged_kat: null, nudged_mark: null })
  await writeSpot(req, job.id, st); await trackOpen(req, job.id, true)
  const title = `⚡ Bill now · ${job.shop_name} · ${carOf(job)}`
  const body = `${job.technician || 'The tech'} is on site waiting for the check. The shop pays as soon as it has the invoice.`
  await Promise.all([
    pushTo(req, 'kat', { title, body, url: '/app/index.html', tag: `spot-${job.id}` }),
    bell(req, 'Kath', 'k.belmonte@absoluteadas.com', title, body, job),
    import('./cliq.js').then(({ postToCliqChannel, DISPATCH_CHANNEL }) => postToCliqChannel(DISPATCH_CHANNEL, `⚡ *Pays on the spot · ${job.shop_name}* · ${carOf(job)} is Ready to Invoice. ${job.technician || 'The tech'} is waiting for the check. Bill it now.`)).catch(() => {}),
  ])
  return st
}

/** Bill it finished. The tech hears it right away. */
export async function spotPayBilled(req, job, { number, total }) {
  const st = await readSpot(req, job.id)
  if (!st?.ready_at && !(await isSpotPayShop(req, job.shop_name))) return null
  const s = st || { job_id: String(job.id), shop: job.shop_name, car: carOf(job), tech: job.technician || '' }
  Object.assign(s, { billed_at: new Date().toISOString(), invoice_number: number, invoice_total: Math.round((Number(total) || 0) * 100) / 100, minutes: s.ready_at ? minsSince(s.ready_at) : null })
  await writeSpot(req, job.id, s); await trackOpen(req, job.id, true)   // stays open until the check is logged
  const who = techKey(job)
  const title = `🧾 Invoice sent to ${job.shop_name}${s.invoice_total ? ` (${fmtUSD(s.invoice_total)})` : ''}`
  const body = 'Grab the check. Log it in the app when you have it.'
  if (who) await pushTo(req, who, { title, body, url: '/app/index.html?spot=1', tag: `spot-${job.id}` })
  if (job.technician) await bell(req, job.technician, '', title, body, job)
  return s
}

/** Tech has the check in hand → #financeadmin. */
export async function spotCheck(req, job, { number, amount, by }) {
  const s = (await readSpot(req, job.id)) || { job_id: String(job.id), shop: job.shop_name, car: carOf(job) }
  s.check = { number: String(number || '').slice(0, 30), amount: Math.round((Number(amount) || 0) * 100) / 100, by, at: new Date().toISOString() }
  await writeSpot(req, job.id, s); await trackOpen(req, job.id, false)
  const off = s.invoice_total && Math.abs(s.check.amount - s.invoice_total) > 0.009
  // Mark 2026-10-27: by the time the tech taps this the check is already deposited
  // (mobile deposit → the Revenue account). Finance's only job: mark the invoice paid in Zoho Books.
  const lines = [
    `💵 *Check deposited · ${s.shop}*`,
    `Check #${s.check.number || '—'} · *${fmtUSD(s.check.amount)}* · ${s.car || carOf(job)}`,
    s.invoice_number ? `Invoice ${s.invoice_number}${s.invoice_total ? ` · ${fmtUSD(s.invoice_total)}` : ''}${off ? ` · ⚠️ check is ${fmtUSD(s.check.amount - s.invoice_total)} off the invoice` : ' · matches'}` : '⚠️ Invoice not sent through Bill it yet',
    `Already deposited to the *Revenue* account by ${by}. No bank deposit needed.`,
    s.invoice_number
      ? `👉 *Finance:* mark invoice ${s.invoice_number} *paid* in Zoho Books: record payment, ${fmtUSD(s.check.amount)}, mode Check, ref #${s.check.number || '—'}, deposit to Revenue.`
      : `👉 *Finance:* find this job's invoice in Zoho Books and mark it *paid*: ${fmtUSD(s.check.amount)}, mode Check, ref #${s.check.number || '—'}, deposit to Revenue.`,
    s.minutes != null ? `Invoiced ${s.minutes} min after Ready to Invoice` : '',
  ].filter(Boolean)
  try { const { postToCliqChannel } = await import('./cliq.js'); await postToCliqChannel('financeadmin', lines.join('\n')) } catch (e) { console.warn('[spot-pay] finance post', e.message) }
  const log = await getJson(req, LOG_KEY, [])
  log.push({ job_id: s.job_id, shop: s.shop, ready_at: s.ready_at || null, billed_at: s.billed_at || null, minutes: s.minutes ?? null, invoice_total: s.invoice_total || null, check: s.check })
  await setJson(req, LOG_KEY, log.slice(-300))
  return { ...s, mismatch: !!off }
}

/** Open spot-pay jobs (for the board + Live Day). */
export async function openSpots(req) {
  const ids = await getJson(req, OPEN_KEY, [])
  const out = []
  for (const id of ids) { const s = await readSpot(req, id); if (s && !s.check) out.push(s) }
  return out
}

/** Every few minutes (selfTick): Kat at 10 min, Mark at 20 min, while the car waits on an invoice. */
export async function spotNudges(req) {
  const done = []
  for (const s of await openSpots(req)) {
    if (!s.ready_at || s.billed_at) continue
    const m = minsSince(s.ready_at)
    if (m >= KAT_NUDGE_MIN && !s.nudged_kat) {
      s.nudged_kat = new Date().toISOString(); await writeSpot(req, s.job_id, s)
      await pushTo(req, 'kat', { title: `⚡ Still waiting · ${s.shop}`, body: `${s.tech || 'The tech'} has waited ${m} min for the invoice. Bill it now.`, url: '/app/index.html', tag: `spot-${s.job_id}` })
      done.push({ job: s.job_id, kat: m })
    }
    if (m >= MARK_NUDGE_MIN && !s.nudged_mark) {
      s.nudged_mark = new Date().toISOString(); await writeSpot(req, s.job_id, s)
      try { const { postToCliqUser, TECH_CLIQ_IDS } = await import('./cliq.js'); await postToCliqUser(TECH_CLIQ_IDS.Mark, `⚡ ${s.shop} · ${s.car || 'car'}: ${s.tech || 'the tech'} has waited ${m} min on site and the invoice hasn't gone out.`) } catch (e) { console.warn('[spot-pay] mark nudge', e.message) }
      done.push({ job: s.job_id, mark: m })
    }
  }
  return { nudged: done }
}

/** Last 7 days for the morning meeting. */
export async function spotWeek(req) {
  const since = Date.now() - 7 * 86400000
  const log = (await getJson(req, LOG_KEY, [])).filter(x => Date.parse(x.check?.at || 0) >= since)
  const mins = log.map(x => x.minutes).filter(x => x != null)
  return { checks: log.length, dollars: Math.round(log.reduce((t, x) => t + (x.check?.amount || 0), 0)), avgMinutes: mins.length ? Math.round(mins.reduce((t, x) => t + x, 0) / mins.length) : null }
}
