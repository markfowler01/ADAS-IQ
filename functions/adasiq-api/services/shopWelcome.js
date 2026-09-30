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
  return [
    ['', `${hi}\n\nThank you. I mean it. Absolute ADAS is a small shop. A couple of vans. A few people who care about doing this right. When a body shop trusts us with their cars, that is what keeps us going. You are what makes this work. My crew and I do not take that lightly.\n\nMy goal is simple. Help your shop win. Cars go out right. The paperwork holds up. You get paid.`],
    ['👉 Give us your first car. It takes one text.', `Text FIRST and the last four of the VIN to (425) 675-1329.\nThat is it. We text you back with a time, usually the same day. We show up, calibrate it to the car maker's procedure, and your report and photos are in your folder before we leave the lot.\nAnd if you are not happy with that first one, it is free.`],
    ['The Absolute Promise', `Every ADAS calibration we recommend, we guarantee you get paid for. We only recommend what the car maker requires. We document every job the way insurers want it. If a carrier pushes back, we fight it with you. If a calibration we recommended and did still gets denied, you do not pay us for it.`],
    ['How we know what a car needs', `We check every estimate with Kinetic, ADAS Maps, and the car maker's own rules. If a calibration is required, we catch it before the car is done. Not after.\nWant your estimators to see it coming too? Our one-sheet, When does this car need a calibration, has a sensor map, a line picker, and a checklist to tape by the desk: https://absoluteadas.com/estimator-guide/`],
    ['How to get us on a car, any day', `• Text (425) 675-1329. Call (844) 349-2327. Email mark@absoluteadas.com.\n• Send the year, make, model, and RO. Connected on Kinetic? Just the last four of the VIN.\n• Want it scrubbed first? Email us with "estimate" in the subject and the CCC estimate PDF attached. We scrub it and send you what the car needs.\n• Group texts work. Add the 425 to your thread. Every "car is ready" text becomes a job on our board.\n• Kat runs scheduling and billing: k.belmonte@absoluteadas.com.`],
    ['Same day. Done right.', `That is our policy. Tell us early in the morning that a car is ready and we can almost always get it done that day. Later, say 1 to 3 in the afternoon, plan on the next day. Either way, you hear back fast with a time.`],
    ['Before we arrive', `Alignment done. Windshield in. Bumper covers on. Keys with the car. Half a tank if the calibration is dynamic. That is what lets us finish in one visit.`],
    ['Billing and insurance', `Our app documents every job so the carrier has what it needs to pay you. The report. The photos. The post-scan. The calibration ID. State Farm, Allstate, or GEICO claim? We price to their schedule. Our pricing sheet is attached. Any billing question, reach me direct at mark@absoluteadas.com or (425) 870-1495. We will make it right.`],
    ['Two quick setups that make this smoother', `• Kinetic on CCC Secure Share. Two minutes on your CCC ONE and your estimates flow to us on their own. We will walk you through it on our first visit.\n• On ADAS Maps for State Farm or Allstate? Add Absolute ADAS under Vendors. Then we are told the moment a car is ready.`],
    ['One more thing', `Once a week I send a short note from the van. One real car, what went wrong, what to ask your cal shop. No fluff. Get it here: https://absoluteadas.com/van`],
    ['', `Thanks again for the trust. We will earn it every car.\n\nReady when you are. Text FIRST + last 4 of the VIN to (425) 675-1329.\n\nMark Fowler\nAbsolute ADAS · (844) 349-2327 · absoluteadas.com`],
  ]

}
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
