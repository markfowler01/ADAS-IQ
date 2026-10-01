// 📨 Welcome email for a new shop (Mark 2026-09-24). Sent from Mark the
// moment a shop becomes a customer: Active in the CRM, the field "New shop"
// form, or the button on the Billing tab. Third-grade level, the Absolute
// Promise up top, one ask (text FIRST + last 4), pricing sheet attached,
// From the Van invite at the end. Logged on the CRM card; ticks the New Shop
// checklist item; copies Kat.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sendBroadcast } from './brewResend.js'
import { postToCliqChannel, DISPATCH_CHANNEL } from './cliq.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PDF_PATH = path.join(__dirname, '..', 'assets', 'absolute-adas-pricing-sheet.pdf')
const KAT = 'k.belmonte@absoluteadas.com'
const FROM_EMAIL = process.env.WELCOME_FROM_EMAIL || 'brew@absoluteadas.com'   // delivers; replies go to mark@
const REPLY_TO = 'mark@absoluteadas.com'

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const first = n => String(n || '').trim().split(/\s+/)[0] || ''

// 📨 One welcome per customer type (Mark 2026-09-30): Collision keeps the
// original; Dealers and Auto repair shops lead with programming and
// diagnostics; Retail (a person) is short, no pricing sheet. Copy approved in
// the vault: 01 Absolute ADAS/Marketing/Welcome Emails by Customer Type — drafts.
const REACH = (who) => `• Text (425) 675-1329. Call (844) 349-2327. Email mark@absoluteadas.com.\n• ${who}\n• Kat runs scheduling and billing: k.belmonte@absoluteadas.com.`
const SIGN = `Thanks again. We will earn it every car.\n\nMark Fowler\nAbsolute ADAS · (844) 349-2327 · absoluteadas.com`
const PROG = `• New or used module? We program it to the car. Any module, any make.\n• Software updates and reflash when the car maker has a fix out.\n• Priced per module, one line each. Security access or gateway fees only when the car maker charges them. You know the price before we start.`
const DIAG_HOURS = `• Diagnostic time is by the hour. Before we start, our tech checks with you. The first hour finds most problems. If it needs more, we tell you first.`
const FIRST_CAR = where => `Text FIRST and the last four of the VIN to (425) 675-1329.\nWe text you back with a time, usually the same day. We come to your ${where} and do the work to the car maker's procedure.\nIf you are not happy with that first one, it is free.`

function collisionSections(hi) {
  // Email 1 is about the FIRST JOB only (Mark 2026-10-01: "it's probably way too
  // much for their first email … keep this about the first job"). Everything
  // else goes in email 2, "Welcome to Absolute ADAS", after the first invoice.
  return [
    ['', `${hi}\n\nThank you. I mean it. Absolute ADAS is a small shop. A couple of vans. A few people who care about doing this right. When a body shop trusts us with their cars, that is what keeps us going. You are what makes this work. My crew and I do not take that lightly.\n\nMy goal is simple. Help your shop win. Cars go out right. The paperwork holds up. You get paid.`],
    ['👉 Give us your first car. It takes one text.', `Text FIRST and the last four of the VIN to (425) 675-1329.\nThat is it. We text you back with a time, usually the same day. We show up, calibrate it to the car maker's procedure, and your report and photos are in your folder before we leave the lot.\nAnd if you are not happy with that first one, it is free.`],
    ['The Absolute Promise', `Every ADAS calibration we recommend, we guarantee you get paid for. We only recommend what the car maker requires. We document every job the way insurers want it. If a carrier pushes back, we fight it with you. If a calibration we recommended and did still gets denied, you do not pay us for it.`],
    ['Before we arrive', `Alignment done. Windshield in. Bumper covers on. Keys with the car. Half a tank if the calibration is dynamic. That is what lets us finish in one visit.`],
    ['', `Thanks again for the trust. We will earn it every car.\n\nReady when you are. Text FIRST + last 4 of the VIN to (425) 675-1329.\n\nMark Fowler\nAbsolute ADAS · (844) 349-2327 · absoluteadas.com`],
  ]
}

// ── Email 2: "Welcome to Absolute ADAS" (collision shops, after the first invoice) ──
// The 📝 section is the tap-to-answer questionnaire (rendered as buttons).
function collisionWelcome2Sections(hi) {
  return [
    ['', `${hi}\n\nYour first car with us is done and invoiced. The report and photos are in your folder. Thank you for giving us the shot.\n\nNow that you have seen how we work, here is everything else, in one place.`],
    ['📝 30 seconds: tell us how you want to work', ''],
    ['Full Service. We finish the car.', `Most cal shops stop at the calibration. We can finish the car.\n• Headlamp aim\n• TPMS relearn\n• Module programming and software updates\n• The resets after a battery disconnect (windows, sunroof, power liftgate)\nWe catch every one of these when we scrub your estimate. We do them while we are already there. They go on the same report, with the same photos, under the same Promise.\nYour techs stay on body work. Nothing gets missed at delivery. No comeback because a window will not auto-up.\nI want every one of my shops on Full Service. It is the best way we know to get a car out the door right.`],
    ['Scans and the safety inspection', `On a collision car the car maker requires all three. Someone has to do them. It can be you or it can be us.\n• Pre-scan. Required before repairs.\n• Post-scan. Required after repairs.\n• Post Collision Safety Inspection. Seatbelts, airbags, and the safety checks after a hit. Required on every collision car.\nSome shops do the pre-scan and we do the post-scan. Some want us to do all of it. Either way works.\nIf you do your own post-scan, we add a Calibration Snapshot. It shows every calibration held when the car left your shop.\nEvery car also gets our Calibration ID report, so the carrier sees exactly why each calibration was needed.`],
    ['How to get us on a car, any day', `• Text (425) 675-1329. Call (844) 349-2327. Email mark@absoluteadas.com.\n• Send the year, make, model, and RO. Connected on Kinetic? Just the last four of the VIN.\n• Want it scrubbed first? Email us with "estimate" in the subject and the CCC estimate PDF attached. We scrub it and send you what the car needs.\n• Group texts work. Add the 425 to your thread. Every "car is ready" text becomes a job on our board.\n• Kat runs scheduling and billing: k.belmonte@absoluteadas.com.`],
    ['Same day. Done right.', `That is our policy. Tell us early in the morning that a car is ready and we can almost always get it done that day. Later, say 1 to 3 in the afternoon, plan on the next day. Either way, you hear back fast with a time.`],
    ['How we know what a car needs', `We check every estimate against the car maker's own rules. If a calibration is required, we catch it before the car is done. Not after.\nWant your estimators to see it coming too? Our one-sheet, When does this car need a calibration, has a sensor map, a line picker, and a checklist to tape by the desk: https://absoluteadas.com/estimator-guide/`],
    ['Billing and insurance', `Our app documents every job so the carrier has what it needs to pay you. The report. The photos. The post-scan. The calibration ID. State Farm, Allstate, or GEICO claim? We price to their schedule. Any billing question, reach me direct at mark@absoluteadas.com or (425) 870-1495. We will make it right.`],
    ['Two quick setups that make this smoother', `• CCC Secure Share. Two minutes on your CCC ONE and your estimates flow to us on their own. We will walk you through it on our next visit.\n• On ADAS Maps for State Farm or Allstate? Add Absolute ADAS under Vendors. Then we are told the moment a car is ready.`],
    ['One more thing', `Once a week I send a short note from the van. One real car, what went wrong, what to ask your cal shop. No fluff. Get it here: https://absoluteadas.com/van`],
    ['', `Thanks again for the trust. We will earn it every car.\n\nMark Fowler\nAbsolute ADAS · (844) 349-2327 · absoluteadas.com`],
  ]
}

// The four questions (keys match the answer page and applyShopAnswers).
export const SHOP_QUESTIONS = [
  { key: 'pre_scan',  q: 'Pre-scans?', opts: [['us', 'We do them'], ['shop', 'You do them']] },
  { key: 'post_scan', q: 'Post-scans?', opts: [['us', 'We do them'], ['shop', 'You do them']] },
  { key: 'pcsi',      q: 'Post Collision Safety Inspection?', opts: [['us', 'We do it'], ['shop', 'You do it']] },
  { key: 'full_service', q: 'Full Service?', opts: [['yes', 'Yes, I want it'], ['more', 'Tell me more'], ['no', 'Not now']] },
]

function dealerSections(hi) {
  return [
    ['', `${hi}\n\nThank you. Absolute ADAS is a small shop. A couple of vans and a few people who care about doing this right. When a dealer trusts us with their cars, that is what keeps us going. We do not take it lightly.\n\nMy goal is simple. Get your cars front-line ready faster. Programming, software updates, and safety systems done right, on your lot, usually the same day.`],
    ['👉 Give us your first car. It takes one text.', FIRST_CAR('lot')],
    ['Module programming and reflash. All makes.', PROG.replace('when the car maker has a fix out', 'when the car maker has a fix or a recall out')],
    ['Diagnostics', `• The warning light that holds a car off the front line. We find it and tell you what it needs.\n${DIAG_HOURS}`],
    ['Calibrations', `• After a windshield, alignment, bumper, or suspension job. Cameras, radars, blind spot, park assist, 360.`],
    ['Our promise', `We only do what the car maker requires. Every car gets a report, photos, and a post-scan for your deal jacket. If it is not right, we come back and make it right at no charge.`],
    ['Same day. Done right.', `Text us early and we can almost always get it done that day. Later in the afternoon, plan on the next day. Either way you hear back fast with a time.`],
    ['Before we arrive', `Keys with the car. A good battery or a charger on it, because programming needs steady power. For calibrations: alignment done, windshield in, and half a tank if the calibration is dynamic.`],
    ['Billing', `One invoice per car, straight from the job. You pay on site when the job is done. Our tech takes a check or card. Pricing sheet attached. Questions? mark@absoluteadas.com or (425) 870-1495.`],
    ['How to reach us', REACH('Send the year, make, model, and stock number or last four of the VIN.')],
    ['', SIGN],
  ]
}
function repairSections(hi) {
  return [
    ['', `${hi}\n\nThank you. Absolute ADAS is a small shop too. A couple of vans and a few people who care about doing this right. When another shop trusts us with their customers' cars, that means a lot. You are what makes this work.\n\nMy goal is simple. When a car needs programming or a problem you can't chase down, you text us and it gets done. Your bay stays moving and your customer leaves happy.`],
    ['👉 Give us your first car. It takes one text.', FIRST_CAR('shop')],
    ['Module programming and reflash. All makes.', PROG],
    ['Diagnostics', `• A light that won't clear. A no-start. A network fault. A problem that comes and goes.\n• We bring the factory-level scan tools and the car maker's info, find it, and tell you what it needs.\n${DIAG_HOURS}`],
    ['Calibrations too', `After an alignment, a windshield, or suspension work, many cars need the camera or radar set back to spec. We do that the same visit.`],
    ['Our promise', `We only do what the car maker requires. We show you why with a report and photos your customer can see. If it is not right, we come back and make it right at no charge.`],
    ['Same day. Done right.', `Text us early and we can almost always get it done that day. Later in the afternoon, plan on the next day.`],
    ['Before we arrive', `A good battery or a charger on it, because programming needs steady power. Keys with the car. For calibrations: alignment done and half a tank.`],
    ['Billing', `One invoice per car. Our tech can take a check or card on site, or we email it. Pricing sheet attached. Any question, mark@absoluteadas.com or (425) 870-1495.`],
    ['How to reach us', REACH('Send the year, make, model, last four of the VIN, and what is going on with the car.')],
    ['', SIGN],
  ]
}
function retailSections(hi) {
  return [
    ['', `${hi}\n\nThank you for trusting us with your car. We are a small local company. A few people who care about getting this right, because these systems keep you and your family safe on the road.`],
    ['What we do', `Your car has cameras and radars that help it brake, stay in its lane, and watch your blind spots. After a windshield, an alignment, or a repair, they have to be set back to the car maker's spec. That is what we do.`],
    ['What happens next', `• We text you a time and a place. Depending on the job, we come to you or we set it up at a shop.\n• The work is done to the car maker's procedure.\n• You get a report showing what we did, before we leave.`],
    ['Paying', `You pay when the job is done. Card or check. Washington sales tax (10.1%) is added.`],
    ['Our promise', `We only do what your car maker requires. If something is not right, we come back and make it right at no charge.`],
    ['Questions?', `Text (425) 675-1329 or call (844) 349-2327. A real person answers.`],
    ['', `Thanks again. Drive safe.\n\nMark Fowler\nAbsolute ADAS · (844) 349-2327 · absoluteadas.com`],
  ]
}
const WELCOME_TYPES = {
  body_shop:   { sections: collisionSections, subject: 'Your first job is on us to get right. Here is how.', pdf: true },
  dealer:      { sections: dealerSections, subject: 'Your first car is on us to get right. Here is how.', pdf: true },
  repair_shop: { sections: repairSections, subject: 'Your first car is on us to get right. Here is how.', pdf: true },
  retail:      { sections: retailSections, subject: 'Thanks for choosing Absolute ADAS. Here is what happens next.', pdf: false },
}
/** Which version a customer type gets. No type yet = the Collision original (it was the only one). */
export const welcomeKind = type => (WELCOME_TYPES[type] ? type : 'body_shop')

export function welcomeCopy({ firstName, type = 'body_shop' } = {}) {
  const hi = firstName ? `Hi ${firstName},` : 'Hi there,'
  const def = WELCOME_TYPES[welcomeKind(type)]
  const sections = def.sections(hi)
  const subject = def.subject
  const attach = def.pdf ? '\n\nAttached: Absolute ADAS pricing sheet' : ''
  const text = sections.map(([h, b]) => (h ? `${h.toUpperCase()}\n${b}` : b)).join('\n\n') + attach
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:600px;color:#1a1a1a;font-size:16px;line-height:1.5">
<div style="background:#CD4419;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:700">Absolute ADAS</div>
<div style="border:1px solid #e8e4e0;border-top:none;padding:20px;border-radius:0 0 10px 10px">
${sections.map(([h, b]) => {
    const body = esc(b).split('\n').map(l => l.startsWith('• ') ? `<div style="padding-left:14px;text-indent:-14px">${l}</div>` : (l ? `<div>${l.replace(/https:\/\/absoluteadas\.com\/estimator-guide\//g, '<a href="https://absoluteadas.com/estimator-guide/" style="color:#CD4419;font-weight:700">absoluteadas.com/estimator-guide</a>').replace(/https:\/\/absoluteadas\.com\/van/g, '<a href="https://absoluteadas.com/van" style="color:#CD4419;font-weight:700">absoluteadas.com/van</a>')}</div>` : '<div style="height:10px"></div>')).join('')
    if (h.startsWith('👉')) return `<div style="background:#fff5f0;border:2px solid #CD4419;border-radius:12px;padding:14px 16px;margin:18px 0"><div style="font-size:18px;font-weight:800;color:#CD4419;margin-bottom:6px">${esc(h)}</div>${body}</div>`
    return `${h ? `<h3 style="margin:18px 0 6px;font-size:16px;color:#1a1a1a">${esc(h)}</h3>` : ''}${body}`
  }).join('')}
${def.pdf ? '<p style="color:#666;font-size:12px;margin-top:22px">Attached: Absolute ADAS pricing sheet (PDF)</p>' : ''}
</div></div>`
  return { subject, text, html, pdf: def.pdf, kind: welcomeKind(type) }
}

const brOf = shop => (typeof shop?.billing_rules === 'string' ? (JSON.parse(shop.billing_rules || '{}') || {}) : (shop?.billing_rules || {}))
const ownerOf = shop => { const p = (shop.people || []).find(x => x?.email) || {}; return { name: p.name || shop.contact_name || '', email: (p.email || shop.email || '').trim().toLowerCase() } }

/** Send it. Returns { sent, to, why }. Never throws. */
export async function sendShopWelcome(req, shop, { by = 'app', force = false } = {}) {
  try {
    const br = brOf(shop)
    // Auto sends happen ONCE, ever (Mark 2026-09-24). Only a person pressing Resend (force) can send again.
    if (br.welcome?.sent_at && !force) return { sent: false, why: `already sent ${br.welcome.sent_at.slice(0, 10)}`, to: br.welcome.to }
    if (!force) {   // two triggers in the same minute (Active + field form) → the second one loses
      try { const seg = (await import('zcatalyst-sdk-node')).default.initialize(req, { type: 'advancedio' }).cache().segment(); const k = `welcome_lock:${shop.id}`; if (await seg.getValue(k)) return { sent: false, why: 'already sending' }; await seg.put(k, '1', 1) } catch { /* no cache — carry on */ }
      const freshBr = brOf((await (await import('../routes/shops.js')).getAllShops(req)).find(x => String(x.id) === String(shop.id)) || shop)
      if (freshBr.welcome?.sent_at) return { sent: false, why: `already sent ${freshBr.welcome.sent_at.slice(0, 10)}`, to: freshBr.welcome.to }
    }
    const owner = ownerOf(shop)
    if (!owner.email) {
      try { const { createNotification } = await import('../routes/notifications.js'); await createNotification(req, { to: 'Kath', toEmail: KAT, type: 'onboarding', title: `Welcome email not sent — ${shop.shop_name} has no email`, body: 'Add the owner\'s email on the CRM card, then press Send welcome email on the Billing tab.', skipCliq: true, skipTechChannel: true }) } catch { /* fine */ }
      return { sent: false, why: 'no email on the card' }
    }
    const { subject, text, html, pdf, kind } = welcomeCopy({ firstName: first(owner.name), type: br.customer_type || '' })
    let attachments
    if (pdf) try { attachments = [{ filename: 'Absolute ADAS pricing sheet.pdf', content: fs.readFileSync(PDF_PATH).toString('base64') }] } catch (e) { console.warn('[welcome] pricing sheet missing:', e.message) }
    await sendBroadcast({ recipients: [owner.email, KAT], subject, html, text, attachments, fromEmail: FROM_EMAIL, fromName: 'Mark Fowler · Absolute ADAS', replyTo: REPLY_TO })
    // Log on the card + tick the checklist item.
    const next = { ...br, welcome: { sent_at: new Date().toISOString(), to: owner.email, by, kind } }
    if (next.new_shop?.items) { const it = next.new_shop.items.find(i => i.key === 'welcome'); if (it && !it.done) { it.done = true; it.at = new Date().toISOString(); it.by = 'app (welcome email)' } }
    const { updateShop } = await import('../routes/shops.js')
    await updateShop(req, shop.id, { ...shop, billing_rules: next })
    await postToCliqChannel(DISPATCH_CHANNEL, `📨 *Welcome email sent to ${shop.shop_name}* (${owner.name || owner.email}) — ${({ body_shop: 'Collision', dealer: 'Dealer', repair_shop: 'Auto repair', retail: 'Retail' })[kind]} version${pdf ? ', pricing sheet attached' : ''}.`).catch(() => {})
    console.log(`[welcome] sent to ${owner.email} for ${shop.shop_name} by ${by}`)
    return { sent: true, to: owner.email }
  } catch (e) { console.warn('[welcome] failed:', e.message); return { sent: false, why: e.message } }
}

/**
 * 👤 Retail welcome — a person (not a shop) added for the first time with an
 * email (Mark 2026-09-30). Called once, right after the retail customer row is
 * created, so it can never repeat. No pricing sheet. Never throws.
 */
export async function sendRetailWelcome(req, person, { by = 'app' } = {}) {
  try {
    const email = String(person?.email || '').trim().toLowerCase()
    if (!/.+@.+\..+/.test(email)) return { sent: false, why: 'no email' }
    const { subject, text, html } = welcomeCopy({ firstName: first(person.name), type: 'retail' })
    await sendBroadcast({ recipients: [email, KAT], subject, html, text, fromEmail: FROM_EMAIL, fromName: 'Mark Fowler · Absolute ADAS', replyTo: REPLY_TO })
    await postToCliqChannel(DISPATCH_CHANNEL, `📨 *Welcome email sent to ${person.name || email}* (Retail version).`).catch(() => {})
    console.log(`[welcome] retail sent to ${email} by ${by}`)
    return { sent: true, to: email }
  } catch (e) { console.warn('[welcome] retail failed:', e.message); return { sent: false, why: e.message } }
}


// ── 📝 Email 2 + the tap-to-answer questionnaire (Mark 2026-10-01) ─────────
const PUBLIC_BASE = process.env.API_PUBLIC_BASE || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'
let _secret = ''
async function answersSecret(req) {
  if (_secret) return _secret
  const catalyst = (await import('zcatalyst-sdk-node')).default
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const rows = await app.zcql().executeZCQLQuery("SELECT ROWID, config_value FROM AppConfig WHERE config_key = 'shop_answers_secret' LIMIT 1")
  _secret = String(rows?.[0]?.AppConfig?.config_value || '')
  if (!_secret) {
    _secret = (await import('node:crypto')).randomBytes(24).toString('hex')
    await app.datastore().table('AppConfig').insertRow({ config_key: 'shop_answers_secret', config_value: _secret })
  }
  return _secret
}
/** A link token for one shop: "<shopId>.<hmac>" — can't be guessed or pointed at another shop. */
export async function answersToken(req, shopId) {
  const crypto = await import('node:crypto')
  const sig = crypto.createHmac('sha256', await answersSecret(req)).update(`answers:${shopId}`).digest('base64url').slice(0, 22)
  return `${shopId}.${sig}`
}
export async function shopIdFromToken(req, token) {
  const [id, sig] = String(token || '').split('.')
  if (!/^\d{1,25}$/.test(id || '') && id !== 'test') return null
  const want = (await answersToken(req, id)).split('.')[1]
  return sig && sig.length === want.length && (await import('node:crypto')).timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? id : null
}

export async function welcome2Copy(req, { firstName, shopId }) {
  const hi = firstName ? `Hi ${firstName},` : 'Hi there,'
  const token = await answersToken(req, shopId)
  const url = (q, a) => `${PUBLIC_BASE}/api/public/shop-answers/${token}${q ? `?${q}=${a}` : ''}`
  const sections = collisionWelcome2Sections(hi)
  const subject = 'Welcome to Absolute ADAS. Here is everything else.'
  const qText = SHOP_QUESTIONS.map(x => `${x.q} ${x.opts.map(o => o[1]).join(' / ')}`).join('\n')
  const text = sections.map(([h, b]) => (h.startsWith('📝') ? `${h.toUpperCase()}\n${qText}\nAnswer here: ${url()}` : h ? `${h.toUpperCase()}\n${b}` : b)).join('\n\n')
  const link = l => l.replace(/https:\/\/absoluteadas\.com\/estimator-guide\//g, '<a href="https://absoluteadas.com/estimator-guide/" style="color:#CD4419;font-weight:700">absoluteadas.com/estimator-guide</a>').replace(/https:\/\/absoluteadas\.com\/van/g, '<a href="https://absoluteadas.com/van" style="color:#CD4419;font-weight:700">absoluteadas.com/van</a>')
  const btn = (href, label) => `<a href="${href}" style="display:inline-block;margin:3px 6px 3px 0;padding:9px 14px;border-radius:999px;border:2px solid #CD4419;color:#CD4419;font-weight:700;font-size:14px;text-decoration:none">${esc(label)}</a>`
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:600px;color:#1a1a1a;font-size:16px;line-height:1.5">
<div style="background:#CD4419;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:700">Absolute ADAS</div>
<div style="border:1px solid #e8e4e0;border-top:none;padding:20px;border-radius:0 0 10px 10px">
${sections.map(([h, b]) => {
    if (h.startsWith('📝')) return `<div style="background:#fff5f0;border:2px solid #CD4419;border-radius:12px;padding:14px 16px;margin:18px 0"><div style="font-size:18px;font-weight:800;color:#CD4419;margin-bottom:4px">${esc(h)}</div><div style="font-size:13px;color:#555;margin-bottom:8px">Tap an answer. A short page opens to finish the rest.</div>${SHOP_QUESTIONS.map(x => `<div style="margin:10px 0 2px;font-weight:700">${esc(x.q)}</div><div>${x.opts.map(([a, l]) => btn(url(x.key, a), l)).join('')}</div>`).join('')}</div>`
    const body = esc(b).split('\n').map(l => l.startsWith('• ') ? `<div style="padding-left:14px;text-indent:-14px">${l}</div>` : (l ? `<div>${link(l)}</div>` : '<div style="height:10px"></div>')).join('')
    if (h.startsWith('Full Service')) return `<div style="background:#f0f9ff;border:2px solid #0369a1;border-radius:12px;padding:14px 16px;margin:18px 0"><div style="font-size:18px;font-weight:800;color:#0369a1;margin-bottom:6px">🧰 ${esc(h)}</div>${body}</div>`
    return `${h ? `<h3 style="margin:18px 0 6px;font-size:16px;color:#1a1a1a">${esc(h)}</h3>` : ''}${body}`
  }).join('')}
</div></div>`
  return { subject, text, html }
}

/**
 * Send email 2 once, after a collision shop's first invoice. Only shops that got
 * email 1 from the app (new since 2026-09-24) qualify, so long-time customers
 * never get it by surprise. Never throws.
 */
export async function sendShopWelcome2(req, shop, { by = 'app', force = false, testTo = '' } = {}) {
  try {
    const br = brOf(shop)
    if (!testTo) {
      if (br.customer_type && br.customer_type !== 'body_shop') return { sent: false, why: 'not a collision shop' }
      if (br.welcome2?.sent_at && !force) return { sent: false, why: `already sent ${br.welcome2.sent_at.slice(0, 10)}` }
      if (!br.welcome?.sent_at && !force) return { sent: false, why: 'shop predates the welcome emails' }
      try { const seg = (await import('zcatalyst-sdk-node')).default.initialize(req, { type: 'advancedio' }).cache().segment(); const k = `welcome2_lock:${shop.id}`; if (await seg.getValue(k)) return { sent: false, why: 'already sending' }; await seg.put(k, '1', 1) } catch { /* no cache */ }
    }
    const owner = ownerOf(shop)
    const to = testTo || owner.email
    if (!to) return { sent: false, why: 'no email on the card' }
    const { subject, text, html } = await welcome2Copy(req, { firstName: first(testTo ? 'Mark' : owner.name), shopId: testTo ? 'test' : shop.id })
    let attachments; try { attachments = [{ filename: 'Absolute ADAS pricing sheet.pdf', content: fs.readFileSync(PDF_PATH).toString('base64') }] } catch { /* fine */ }
    await sendBroadcast({ recipients: testTo ? [to] : [to, KAT], subject: testTo ? `[TEST · Collision email 2] ${subject}` : subject, html, text, attachments, fromEmail: FROM_EMAIL, fromName: 'Mark Fowler · Absolute ADAS', replyTo: REPLY_TO })
    if (testTo) return { sent: true, to }
    const { updateShop } = await import('../routes/shops.js')
    await updateShop(req, shop.id, { ...shop, billing_rules: { ...br, welcome2: { sent_at: new Date().toISOString(), to, by } } })
    await postToCliqChannel(DISPATCH_CHANNEL, `📨 *Welcome to Absolute ADAS sent to ${shop.shop_name}* (${owner.name || to}) after their first invoice. It asks pre-scan / post-scan / PCSI / Full Service.`).catch(() => {})
    return { sent: true, to }
  } catch (e) { console.warn('[welcome2] failed:', e.message); return { sent: false, why: e.message } }
}

/** Save a shop's questionnaire answers and set its Big 3 to match. */
export async function applyShopAnswers(req, shopId, answers) {
  const { getAllShops, updateShop } = await import('../routes/shops.js')
  const shop = (await getAllShops(req)).find(x => String(x.id) === String(shopId))
  if (!shop) throw new Error('shop not found')
  const clean = {}
  for (const x of SHOP_QUESTIONS) if (x.opts.some(o => o[0] === answers[x.key])) clean[x.key] = answers[x.key]
  if (!Object.keys(clean).length) throw new Error('no answers')
  const br = brOf(shop)
  await updateShop(req, shop.id, { ...shop, billing_rules: { ...br, onboarding_answers: { ...clean, at: new Date().toISOString() } } })
  const b3 = await import('./big3.js')
  const cur = b3.withDefaults(br.big3)
  const next = { ...cur }
  if (clean.pre_scan) next.pre_scan = clean.pre_scan === 'us' ? 'charge' : 'off'
  if (clean.post_scan === 'shop') { next.post_scan = 'off'; next.snapshot = 'charge' }
  if (clean.post_scan === 'us') { next.snapshot = 'off'; if (next.post_scan === 'off') next.post_scan = 'included' }
  if (clean.pcsi === 'shop') next.pcsi = 'off'
  if (clean.pcsi === 'us' && next.pcsi === 'off') next.pcsi = 'included'
  const fresh = (await getAllShops(req)).find(x => String(x.id) === String(shopId)) || shop
  await b3.saveBig3(req, shop.shop_name, next, 'shop (welcome answers)', { shop: fresh, silent: true })
  const who = v => (v === 'us' ? 'we do' : 'they do')
  const fsLine = { yes: '🧰 *WANTS FULL SERVICE*. Call them to set terms, then switch it on in CRM → Billing.', more: '🧰 Wants to hear more about Full Service. Give them a call.', no: 'Full Service: not now.' }[clean.full_service] || ''
  const msg = `🗒 *${shop.shop_name} answered the welcome questions*\n${['pre_scan', 'post_scan', 'pcsi'].filter(k => clean[k]).map(k => `• ${({ pre_scan: 'Pre-scans', post_scan: 'Post-scans', pcsi: 'Safety inspection' })[k]}: ${who(clean[k])}`).join('\n')}${clean.post_scan === 'shop' ? '\n• Calibration Snapshot added to their invoices' : ''}\n${fsLine}\nBig 4 now: ${b3.describeRules(next)}`
  const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('./cliq.js')
  await Promise.allSettled([postToCliqChannel(DISPATCH_CHANNEL, msg), postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg)])
  return { ok: true, shop: shop.shop_name, answers: clean, big3: next }
}
