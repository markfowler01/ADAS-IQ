// 🎁 Estimator guide drop (Mark 2026-09-26: "I want to get started on the outreach").
// One email from Mark to each customer shop handing them the estimator one-sheet
// "When does this car need a calibration?" with the printable checklist attached.
//
// Rules baked in (see feedback_never_spam_subscribers):
//   • dry run by default — the route only sends with ?send=1
//   • one send per email address, ever, stamped in VanKV (Datastore, durable)
//   • a started_at lock so two triggers can never double-send
//   • competitors and our own addresses are silently skipped
//   • per-run cap, default 60
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sendBroadcast } from './brewResend.js'
import { getAllShops } from '../routes/shops.js'
import { getVal, setVal } from './vanDatastore.js'
import { postToCliqChannel, DISPATCH_CHANNEL } from './cliq.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PDF_PATH = path.join(__dirname, '..', 'assets', 'calibration-checklist.pdf')
const FROM_EMAIL = process.env.WELCOME_FROM_EMAIL || 'brew@absoluteadas.com'   // delivers; replies go to mark@
const REPLY_TO = 'mark@absoluteadas.com'
const SENT_KEY = 'guide_drop_sent'      // { [email]: { at, shop } }
const LOCK_KEY = 'guide_drop_lock'      // { started_at, finished_at }
const LOCK_MS = 15 * 60 * 1000
const COMPETITOR_RE = /avscalibrations|hivecalibrations|abs-c|calibration/i
const OURS_RE = /@absoluteadas\.com$|@adas-iq\.com$|^mfowler/i                 // our domains + Mark's personal Gmail (test shops)
const NOT_A_SHOP_RE = /trucking|landscap|autozone|the auto repair shop/i        // CRM rows that are not estimating desks
// CRM "names" are often the shop name again. Only greet by first name when it reads like a person.
const BIZ_WORD_RE = /\b(llc|inc|co|corp|auto|autos|automotive|body|shop|collision|motors?|motorsports|transmission|glass|towing|tint|repair|sales|fleet|center|carstar|maaco|gerber|goodyear|ford|toyota|honda|subaru|credit|care|guys|pros|unlimited|international|pioneers|refinishing|service|dealer)\b/i
export function personFirstName(name, shopName) {
  const n = String(name || '').trim()
  if (!n || n.toLowerCase() === String(shopName || '').trim().toLowerCase() || BIZ_WORD_RE.test(n)) return ''
  const parts = n.split(/\s+/)
  if (parts.length > 3) return ''
  return parts[0].replace(/[^A-Za-z'’-]/g, '')
}

export const GUIDE_URL = 'https://absoluteadas.com/estimator-guide/'
export const CHECKLIST_URL = 'https://absoluteadas.com/estimator-guide/calibration-checklist.pdf'

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const first = n => String(n || '').trim().split(/\s+/)[0] || ''

/** Copy lives here and in the vault note "Estimator Guide Outreach". Third-grade level, no em dashes, no exclamation points. */
export function guideDropCopy({ firstName }) {
  const hi = firstName ? `Hi ${firstName},` : 'Hi there,'
  const paras = [
    hi,
    'I wrote a one-sheet for your estimating desk. When does this car need a calibration.',
    `It has the nine sensor spots on a RAV4, a table of repairs and the line to write for each one, a picker that writes the lines for you, and a checklist to tape by the desk. The checklist is attached. The rest is here: ${GUIDE_URL}`,
    'One rule worth passing on today. Subaru with EyeSight, any collision repair gets the calibration. Not just glass.',
    'Want printed copies for the desk? Reply with how many and I will bring them on the next visit.',
    'Mark\nAbsolute ADAS · 1-844-FIX-ADAS',
  ]
  const subject = 'For your estimator: when does this car need a calibration?'
  const text = paras.join('\n\n') + '\n\nAttached: the one-page calibration checklist (PDF)'
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:600px;color:#1a1a1a;font-size:16px;line-height:1.55">
<div style="background:#CD4419;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:700">Absolute ADAS</div>
<div style="border:1px solid #e8e4e0;border-top:none;padding:20px;border-radius:0 0 10px 10px">
${paras.map((p, i) => {
    if (i === paras.length - 1) return `<p style="margin:18px 0 0;white-space:pre-line">${esc(p)}</p>`
    return `<p style="margin:0 0 14px">${esc(p).replace(GUIDE_URL, `<a href="${GUIDE_URL}" style="color:#CD4419;font-weight:700">absoluteadas.com/estimator-guide</a>`)}</p>`
  }).join('')}
<p style="margin:22px 0 0"><a href="https://absoluteadas.com/checklist?src=email" style="display:inline-block;background:#CD4419;color:#fff;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:8px;margin-right:10px">Download the checklist (PDF)</a><a href="${GUIDE_URL}" style="display:inline-block;background:#1e1e1e;color:#fff;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:8px;border:1px solid #444">Open the guide</a></p>
<p style="color:#666;font-size:12px;margin-top:22px">Attached: the one-page calibration checklist (PDF). Print it, tape it by the desk.</p>
</div></div>`
  return { subject, text, html }
}

const personOf = shop => {
  const p = (shop.people || []).find(x => x?.email) || {}
  return { name: p.name || shop.contact_name || '', email: String(p.email || shop.email || '').trim().toLowerCase() }
}

/** Customer shops with an email we have not sent to yet. One row per email address. */
export function pickGuideDropRecipients({ shops, sent = {}, stages = ['active'] }) {
  const seen = new Set()
  const out = []
  for (const s of shops || []) {
    if (!stages.includes(String(s.pipeline_stage || '').toLowerCase())) continue
    const { name, email } = personOf(s)
    if (!email || !email.includes('@')) continue
    if (seen.has(email) || sent[email]) continue
    if (COMPETITOR_RE.test(`${s.shop_name} ${email}`) || OURS_RE.test(email) || NOT_A_SHOP_RE.test(String(s.shop_name || ''))) continue
    seen.add(email)
    out.push({ shop_id: s.id, shop_name: s.shop_name, name, first_name: personFirstName(name, s.shop_name), email })
  }
  return out.sort((a, b) => String(a.shop_name).localeCompare(String(b.shop_name)))
}

// ── Scheduled send ──────────────────────────────────────────────────────────
// Mark 2026-09-26: "send out to the 52 shops on Monday at 10am". The schedule
// lives in VanKV and is picked up by the hourly Van safety-net cron (which we
// know fires) and by a one-time Catalyst cron at the exact minute. Both paths
// are safe to collide: the lock + per-address stamps mean the second finds
// nothing left to send.
const SCHEDULE_KEY = 'guide_drop_schedule'   // { send_at, stages, limit, status: pending|done|cancelled, created_at, result }

export async function getGuideDropSchedule(req) { return (await getVal(req, SCHEDULE_KEY)) || null }

export async function setGuideDropSchedule(req, { send_at, stages = ['active'], limit = 60, by = 'app' }) {
  const t = Date.parse(send_at)
  if (!t) throw new Error(`bad send_at: ${send_at}`)
  const sched = { send_at: new Date(t).toISOString(), stages, limit, status: 'pending', created_at: new Date().toISOString(), by }
  await setVal(req, SCHEDULE_KEY, sched)
  return sched
}

export async function clearGuideDropSchedule(req) {
  const cur = await getGuideDropSchedule(req)
  if (cur && cur.status === 'pending') await setVal(req, SCHEDULE_KEY, { ...cur, status: 'cancelled', cancelled_at: new Date().toISOString() })
  return cur
}

/** Called by the hourly safety net and the one-time cron. Sends only when the time has come, exactly once. */
export async function runScheduledGuideDrop(req) {
  const sched = await getGuideDropSchedule(req)
  if (!sched || sched.status !== 'pending') return { skipped: true, reason: sched ? sched.status : 'no schedule' }
  if (Date.now() < Date.parse(sched.send_at)) return { skipped: true, reason: 'not yet', send_at: sched.send_at }
  const result = await runGuideDrop(req, { dry: false, limit: sched.limit || 60, stages: sched.stages || ['active'] })
  if (result.skipped && result.reason === 'run_in_progress') return { skipped: true, reason: 'run_in_progress' }
  await setVal(req, SCHEDULE_KEY, { ...sched, status: 'done', ran_at: new Date().toISOString(), result: { sent: result.sent, failed: result.failed, eligible: result.eligible } })
  return { fired: true, ...result }
}

/** Demo copy to one of our own addresses. No stamp, no lock, nothing counted. */
export async function sendGuideDropDemo({ to, firstName = 'Mark' }) {
  const addr = String(to || '').trim().toLowerCase()
  if (!/@absoluteadas\.com$|^mfowler4456@gmail\.com$/.test(addr)) throw new Error('demo only goes to our own addresses')
  const { subject, text, html } = guideDropCopy({ firstName })
  let attachments
  try { attachments = [{ filename: 'Absolute ADAS calibration checklist.pdf', content: fs.readFileSync(PDF_PATH).toString('base64') }] } catch (e) { console.warn('[guide-drop] checklist PDF missing:', e.message) }
  const res = await sendBroadcast({ recipients: [addr], subject: `[DEMO] ${subject}`, html, text, attachments, fromEmail: FROM_EMAIL, fromName: 'Mark Fowler · Absolute ADAS', replyTo: REPLY_TO })
  return { demo: true, to: addr, sent: res?.sent ?? null, failed: res?.failed ?? null, dryRun: !!res?.dryRun }
}

export async function runGuideDrop(req, { dry = true, limit = 60, stages = ['active'] } = {}) {
  const now = Date.now()
  const lock = (await getVal(req, LOCK_KEY)) || {}
  const started = lock.started_at ? Date.parse(lock.started_at) : 0
  const finished = lock.finished_at ? Date.parse(lock.finished_at) : 0
  if (!dry && started && started > finished && now - started < LOCK_MS) {
    return { dry, skipped: true, reason: 'run_in_progress', started_at: lock.started_at }
  }
  const shops = await getAllShops(req)
  const sent = (await getVal(req, SENT_KEY)) || {}
  const all = pickGuideDropRecipients({ shops, sent, stages })
  const batch = all.slice(0, limit)
  const summary = { dry, stages, eligible: all.length, in_batch: batch.length, already_sent: Object.keys(sent).length }
  if (dry) return { ...summary, recipients: batch.map(r => ({ shop: r.shop_name, greeting: r.first_name ? `Hi ${r.first_name},` : 'Hi there,', email: r.email })) }

  await setVal(req, LOCK_KEY, { started_at: new Date(now).toISOString(), finished_at: lock.finished_at || null })
  let attachments
  try { attachments = [{ filename: 'Absolute ADAS calibration checklist.pdf', content: fs.readFileSync(PDF_PATH).toString('base64') }] } catch (e) { console.warn('[guide-drop] checklist PDF missing:', e.message) }
  const results = []
  try {
    for (const r of batch) {
      const { subject, text, html } = guideDropCopy({ firstName: r.first_name })
      try {
        const res = await sendBroadcast({ recipients: [r.email], subject, html, text, attachments, fromEmail: FROM_EMAIL, fromName: 'Mark Fowler · Absolute ADAS', replyTo: REPLY_TO })
        const ok = !res || res.failed === 0 || (res.sent || 0) > 0
        if (ok) {
          sent[r.email] = { at: new Date().toISOString(), shop: r.shop_name }
          await setVal(req, SENT_KEY, sent)                       // stamp per recipient: a crash mid-run can never resend
          // Log it on the CRM card so the pipeline sees the give. No last_contact change: that drives the quiet clocks.
          try {
            const shop = shops.find(s => String(s.id) === String(r.shop_id))
            if (shop) {
              const { updateShop } = await import('../routes/shops.js')
              const activity = { id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'email', at: new Date().toISOString(), by: 'app (guide drop)', text: `Estimator guide emailed to ${r.email}: "When does this car need a calibration?" with the checklist PDF. Ask on the next visit if they want printed copies.` }
              await updateShop(req, shop.id, { ...shop, activities: [activity, ...(Array.isArray(shop.activities) ? shop.activities : [])].slice(0, 200) })
            }
          } catch (e) { console.warn('[guide-drop] activity log failed:', r.shop_name, e.message) }
        }
        results.push({ shop: r.shop_name, email: r.email, ok })
      } catch (e) {
        results.push({ shop: r.shop_name, email: r.email, ok: false, error: e.message })
      }
    }
  } finally {
    await setVal(req, LOCK_KEY, { started_at: new Date(now).toISOString(), finished_at: new Date().toISOString() })
  }
  const sentN = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok)
  await postToCliqChannel(DISPATCH_CHANNEL,
    `🎁 *Estimator guide sent to ${sentN} shop${sentN === 1 ? '' : 's'}* from Mark (checklist attached).` +
    (failed.length ? `\n⚠️ ${failed.length} failed: ${failed.map(f => f.shop).join(', ')}` : '') +
    `\n${all.length - batch.length} left for a later run. Replies land at mark@.`).catch(() => {})
  return { ...summary, sent: sentN, failed: failed.length, results }
}
