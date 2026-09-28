// 🎓 Estimator Magic Lantern (Mark 2026-09-28: "did you set up a magic lantern?"
// "yes, Sabri Suby and Alex Hormozi style").
//
// Five short lessons from the estimator guide, one every three days, for
// anyone who asks on the guide page. Suby's Magic Lantern shape: pure value
// for four steps, the offer only at the end. Hormozi's offer: the free
// estimate scrub, the Absolute Promise, first car free if not happy.
//
// Rules: opt-in only (the download itself is never gated), one enrollment per
// address, competitors silently dropped, unsubscribe link on every email,
// started_at lock on the hourly run, newsletter kill-switch honoured.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sendBroadcast } from './brewResend.js'
import { getVal, setVal, readChunkedArray, writeChunkedArray } from './vanDatastore.js'
import { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } from './cliq.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PDF_PATH = path.join(__dirname, '..', 'assets', 'calibration-checklist.pdf')
const KEY = 'estimator_lantern'            // chunked array of enrollments
const LOCK_KEY = 'estimator_lantern_lock'
const CHUNK = 25                           // VanKV rows truncate at 10K chars
const STEP_MS = 3 * 24 * 3600 * 1000       // one lesson every three days
const LOCK_MS = 15 * 60 * 1000
const FROM_EMAIL = process.env.WELCOME_FROM_EMAIL || 'brew@absoluteadas.com'
const REPLY_TO = 'mark@absoluteadas.com'
const MAILING_ADDRESS = '2307 Cedar Rd · Lake Stevens, WA 98258'
const PUBLIC_BASE = process.env.API_PUBLIC_BASE || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'
const GUIDE = 'absoluteadas.com/estimator-guide'
const COMPETITOR_RE = /avscalibrations|hivecalibrations|abs-c|calibration/i
const OURS_RE = /@absoluteadas\.com$|@adas-iq\.com$|^mfowler4456@gmail\.com$/i

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const first = n => String(n || '').trim().split(/\s+/)[0] || ''
const secret = () => process.env.APPROVAL_HMAC_SECRET || process.env.BREW_CRON_SECRET || 'lantern-default-rotate-me'
export function unsubToken(id) { return crypto.createHmac('sha256', secret()).update(`lantern-unsub|${id}`).digest('base64url').slice(0, 32) }
export function unsubUrl(id) { return `${PUBLIC_BASE}/api/capture-calc/lantern/unsub?id=${encodeURIComponent(id)}&sig=${unsubToken(id)}` }

// ── The five lessons. Mark's voice: short sentences, no em dashes, no exclamation points. ──
export const LESSONS = [
  {
    n: 1, subject: 'Lesson 1 of 5: the nine spots on the car', attachChecklist: true,
    paras: [
      'Thanks for asking. Five short lessons, one every three days. No pitch until the last one.',
      'Lesson 1. There are nine sensor spots on most cars. Every one is aimed at the factory to a fraction of a degree, and every one is bolted to, or looks through, a part your shop repairs. The camera on the windshield. The radar behind the emblem. The front camera low in the grille. Front park sensors in the cover. Cameras in the mirrors. Two blind spot radars behind the rear cover. The rear camera in the liftgate. Rear park sensors. And the wheels, because thrust angle decides where the camera and radar look.',
      'The rule that covers most cars: if the repair touched any of those parts, write the calibration line now. It is cheaper than the tow that brings the car back.',
      `The one-page checklist is attached. Tape it by the desk. The map with all nine spots drawn on a RAV4 is here: ${GUIDE}`,
      'Want printed copies for the desk? Reply with how many and I will bring them on the next visit.',
    ],
  },
  {
    n: 2, subject: 'Lesson 2 of 5: no code does not mean calibrated',
    paras: [
      'A scan finds what is broken. It does not prove the aim is right. Those are two different questions and the scan tool answers one of them.',
      'Ford put it in writing on May 1, 2026. Calibration is required for all vehicles with ADAS-related repairs, regardless of whether a DTC is present. And a pre-repair scan is required on every vehicle with damage, even when no light is on.',
      'So the order is: pre-scan before the estimate is final. Repair. Calibrate. Post-scan before delivery.',
      'Write the line so it survives the adjuster. Name the sensor and name the procedure. "Forward camera calibration per OEM procedure." "Blind spot radar calibration, left and right." "Scanned, no codes found" is not a calibration, and it will not protect you when the car comes back.',
      `The line picker on the guide page writes these lines for you. Tap what the repair touched, copy the lines: ${GUIDE}`,
    ],
  },
  {
    n: 3, subject: 'Lesson 3 of 5: the Subaru rule, and the bumper-off makes',
    paras: [
      'Two rules from the van that each save a comeback a month.',
      'One. Subaru with EyeSight: any collision repair gets the calibration. Not just glass. A hit anywhere on the car can tilt the body a fraction of a degree, and the stereo camera sees it. Subaru bulletin 18-231-23 has us check body angle with a digital gauge before the cal. Write it on every Subaru collision RO, and spec OE glass.',
      'Two. Toyota, Honda, Acura, Hyundai and Kia mount the blind spot modules to the quarter panel, not the bumper cover, and they usually need a hand adjustment. We calibrate those with the rear cover off. Book the calibration before the cover goes back on. One trip instead of two.',
      'Ask your cal shop on the next rear hit: do you want the cover off for this one? If they say it does not matter, that tells you something too.',
    ],
  },
  {
    n: 4, subject: 'Lesson 4 of 5: the six things on the paperwork, and a free scrub',
    paras: [
      'Six things on the calibration paperwork, or it is not done. One, the OEM procedure by name. Two, the pre-scan and post-scan reports. Three, the aim values before and after. Four, bay, road or both. Five, VIN, tech and date. Six, any fault that was found and what was done about it. That is what gets the line paid, and it is what keeps your shop off a subrogation letter six months from now.',
      'Here is the offer I make to every shop that reads this far. Email me your next CCC estimate with the word estimate in the subject line, to mark@absoluteadas.com. Inside 30 minutes you get back every calibration that car needs, with the OEM reason for each one. Free. The car never has to come to us.',
      'Use it on your next front hit. Most shops find a line their estimate was missing.',
    ],
  },
  {
    n: 5, subject: 'Lesson 5 of 5: how we work with your shop',
    paras: [
      'Last one. Here is the deal we make with every shop we work with.',
      'Every calibration we recommend, your shop gets paid for. If a carrier denies a calibration after our documentation, you do not pay us for it. We write the OEM-cited rebuttal and it usually flips on the next round.',
      'Same day. Text us in the morning that a car is ready and we can almost always do it that day. We come to your bay, calibrate to the car maker’s procedure, and the report and photos are in your folder before we leave the lot.',
      'Your first car is free if you are not happy with it. Text FIRST and the last four of the VIN to (425) 675-1329, or text the van at 1-844-FIX-ADAS.',
      'One more thing. Once a week I send one real car, what went wrong, and what to ask your cal shop. Owners and estimators read it in two minutes: absoluteadas.com/van',
      'Thanks for reading all five. Most calibration lines cost less than the tow that brings the car back. Write the line.',
    ],
  },
]

export function renderLesson(L, { firstName, id }) {
  const hi = firstName ? `Hi ${firstName},` : 'Hi there,'
  const unsub = unsubUrl(id)
  const text = [hi, ...L.paras, 'Mark\nAbsolute ADAS · 1-844-FIX-ADAS',
    `You asked for these five lessons at ${GUIDE}. Stop them any time: ${unsub}\n${MAILING_ADDRESS}`].join('\n\n')
  const linkify = s => esc(s)
    .replace(/absoluteadas\.com\/estimator-guide/g, '<a href="https://absoluteadas.com/estimator-guide/" style="color:#CD4419;font-weight:700">absoluteadas.com/estimator-guide</a>')
    .replace(/absoluteadas\.com\/van/g, '<a href="https://absoluteadas.com/van" style="color:#CD4419;font-weight:700">absoluteadas.com/van</a>')
    .replace(/mark@absoluteadas\.com/g, '<a href="mailto:mark@absoluteadas.com?subject=estimate" style="color:#CD4419;font-weight:700">mark@absoluteadas.com</a>')
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:600px;color:#1a1a1a;font-size:16px;line-height:1.55">
<div style="background:#CD4419;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:700">Absolute ADAS · Calibration 101 · ${L.n} of 5</div>
<div style="border:1px solid #e8e4e0;border-top:none;padding:20px;border-radius:0 0 10px 10px">
<p style="margin:0 0 14px">${esc(hi)}</p>
${L.paras.map(p => `<p style="margin:0 0 14px">${linkify(p)}</p>`).join('')}
${L.n === 1 ? '<p style="margin:18px 0 0"><a href="https://absoluteadas.com/checklist" style="display:inline-block;background:#CD4419;color:#fff;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:8px">Download the checklist (PDF)</a></p>' : ''}
${L.n === 5 ? '<p style="margin:18px 0 0"><a href="sms:18443492327" style="display:inline-block;background:#CD4419;color:#fff;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:8px">Text the van</a></p>' : ''}
<p style="margin:18px 0 0;white-space:pre-line">Mark\nAbsolute ADAS · 1-844-FIX-ADAS</p>
<p style="color:#666;font-size:12px;margin-top:22px">You asked for these five lessons at absoluteadas.com/estimator-guide. <a href="${unsub}" style="color:#666">Stop them any time.</a><br>${esc(MAILING_ADDRESS)}</p>
</div></div>`
  return { subject: L.subject, text, html }
}

export async function listEnrollments(req) { return readChunkedArray(req, KEY) }
async function save(req, list) { return writeChunkedArray(req, KEY, list, { chunkSize: CHUNK }) }

async function sendLesson(e, L) {
  const { subject, text, html } = renderLesson(L, { firstName: first(e.name), id: e.id })
  let attachments
  if (L.attachChecklist) { try { attachments = [{ filename: 'Absolute ADAS calibration checklist.pdf', content: fs.readFileSync(PDF_PATH).toString('base64') }] } catch (err) { console.warn('[lantern] checklist PDF missing:', err.message) } }
  const r = await sendBroadcast({ recipients: [e.email], subject, html, text, attachments, fromEmail: FROM_EMAIL, fromName: 'Mark Fowler · Absolute ADAS', replyTo: REPLY_TO })
  const ok = !r || r.failed === 0 || (r.sent || 0) > 0
  if (!ok) throw new Error(`send failed for lesson ${L.n}`)
  e.sent = [...(e.sent || []), { n: L.n, at: new Date().toISOString() }]
  e.next_lesson = L.n + 1
  if (e.next_lesson > LESSONS.length) { e.status = 'done'; e.next_due = null; e.done_at = new Date().toISOString() }
  else e.next_due = new Date(Date.now() + STEP_MS).toISOString()
}

/** Public enrollment. Sends lesson 1 right away. */
export async function enroll(req, { email, name, shop, source }) {
  const addr = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) || addr.length > 120) return { ok: false, error: 'That email does not look right.' }
  const shopName = String(shop || '').trim().slice(0, 120)
  const person = String(name || '').trim().slice(0, 80)
  // Competitors never end up on Mark's lists: say yes, enroll nobody (standing rule).
  if (COMPETITOR_RE.test(`${addr} ${shopName}`)) return { ok: true, silent: true }
  const list = await listEnrollments(req)
  const existing = list.find(x => x.email === addr)
  if (existing && existing.status === 'active') return { ok: true, already: true, next_lesson: existing.next_lesson }
  if (existing && existing.status === 'done') return { ok: true, already: true, done: true }
  let e = existing
  if (e) { e.status = 'active'; e.next_lesson = 1; e.next_due = new Date().toISOString(); e.reenrolled_at = new Date().toISOString(); e.source = String(source || e.source || 'guide').slice(0, 40) }
  else {
    e = { id: 'el_' + crypto.randomBytes(6).toString('base64url'), email: addr, name: person, shop: shopName, source: String(source || 'guide').slice(0, 40), status: 'active', enrolled_at: new Date().toISOString(), next_lesson: 1, next_due: new Date().toISOString(), sent: [] }
    list.push(e)
  }
  await save(req, list)
  try { await sendLesson(e, LESSONS[0]); await save(req, list) } catch (err) { console.warn('[lantern] lesson 1 send failed:', err.message) }
  if (!OURS_RE.test(addr)) {
    postToCliqChannelById(MARK_ALERT_CHANNEL_ID, `🎓 *Estimator lessons signup*\n${addr}${shopName ? ` · ${shopName}` : ''}${person ? ` · ${person}` : ''}\nvia ${e.source}. Lesson 1 sent with the checklist. A warm one: they asked.`).catch(() => {})
    try {   // log on the CRM card when the email matches a shop
      const { getAllShops, updateShop } = await import('../routes/shops.js')
      const shops = await getAllShops(req)
      const hit = shops.find(s => String(s.email || '').trim().toLowerCase() === addr || (s.people || []).some(p => String(p?.email || '').trim().toLowerCase() === addr))
      if (hit) {
        const activity = { id: `a_${Date.now()}`, type: 'note', at: new Date().toISOString(), by: 'app (estimator lessons)', text: `${addr} signed up for the five estimator lessons from the guide page. Warm lead: ask about printed checklists and the free scrub.` }
        await updateShop(req, hit.id, { ...hit, activities: [activity, ...(Array.isArray(hit.activities) ? hit.activities : [])].slice(0, 200) })
      }
    } catch (err) { console.warn('[lantern] CRM note failed:', err.message) }
  }
  return { ok: true, id: e.id, next_lesson: e.next_lesson }
}

/** Hourly: send whatever is due. Locked; honours the newsletter kill switch. */
export async function runEstimatorLantern(req, { dry = false, limit = 40 } = {}) {
  const { isMarketingPaused } = await import('./marketingKillSwitch.js')
  if (await isMarketingPaused(req, 'newsletter')) return { skipped: true, reason: 'marketing_paused (newsletter)' }
  const now = Date.now()
  const lock = (await getVal(req, LOCK_KEY)) || {}
  const started = lock.started_at ? Date.parse(lock.started_at) : 0
  const finished = lock.finished_at ? Date.parse(lock.finished_at) : 0
  if (!dry && started && started > finished && now - started < LOCK_MS) return { skipped: true, reason: 'run_in_progress' }
  const list = await listEnrollments(req)
  const due = list.filter(e => e.status === 'active' && e.next_due && Date.parse(e.next_due) <= now && LESSONS[e.next_lesson - 1]).slice(0, limit)
  if (!due.length) return { skipped: true, reason: 'nothing due', active: list.filter(e => e.status === 'active').length }
  if (dry) return { dry: true, due: due.map(e => ({ email: e.email, lesson: e.next_lesson })) }
  await setVal(req, LOCK_KEY, { started_at: new Date(now).toISOString(), finished_at: lock.finished_at || null })
  let sent = 0; const failed = []
  try {
    for (const e of due) {
      try { await sendLesson(e, LESSONS[e.next_lesson - 1]); sent++ } catch (err) { failed.push({ email: e.email, error: err.message }) }
    }
    await save(req, list)
  } finally {
    await setVal(req, LOCK_KEY, { started_at: new Date(now).toISOString(), finished_at: new Date().toISOString() })
  }
  return { sent, failed: failed.length, failures: failed }
}

export async function unsubscribe(req, { id, sig }) {
  if (!id || sig !== unsubToken(id)) return { ok: false, error: 'bad link' }
  const list = await listEnrollments(req)
  const e = list.find(x => x.id === id)
  if (!e) return { ok: false, error: 'not found' }
  if (e.status !== 'unsubscribed') { e.status = 'unsubscribed'; e.next_due = null; e.unsubscribed_at = new Date().toISOString(); await save(req, list) }
  return { ok: true, email: e.email }
}

export async function lanternStatus(req) {
  const list = await listEnrollments(req)
  const by = {}
  for (const e of list) by[e.status] = (by[e.status] || 0) + 1
  const nextDue = list.filter(e => e.status === 'active' && e.next_due).map(e => e.next_due).sort()[0] || null
  return { total: list.length, by_status: by, next_due: nextDue, recent: list.slice(-10).reverse().map(e => ({ email: e.email, shop: e.shop, source: e.source, status: e.status, next_lesson: e.next_lesson, enrolled_at: e.enrolled_at })) }
}

/** Demo copy of one lesson to our own address. Nothing enrolled. */
export async function sendLessonDemo({ to, n = 1 }) {
  const addr = String(to || '').trim().toLowerCase()
  if (!OURS_RE.test(addr)) throw new Error('demo only goes to our own addresses')
  const L = LESSONS[Number(n) - 1]
  if (!L) throw new Error('lesson 1-5')
  const { subject, text, html } = renderLesson(L, { firstName: 'Mark', id: 'demo' })
  let attachments
  if (L.attachChecklist) { try { attachments = [{ filename: 'Absolute ADAS calibration checklist.pdf', content: fs.readFileSync(PDF_PATH).toString('base64') }] } catch { /* fine */ } }
  const r = await sendBroadcast({ recipients: [addr], subject: `[DEMO] ${subject}`, html, text, attachments, fromEmail: FROM_EMAIL, fromName: 'Mark Fowler · Absolute ADAS', replyTo: REPLY_TO })
  return { demo: true, to: addr, lesson: L.n, sent: r?.sent ?? null, failed: r?.failed ?? null }
}
