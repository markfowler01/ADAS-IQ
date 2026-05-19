// 7-email nurture sequence for Partnership Calculator opt-ins (v3.1).
//
// Schedule (days are calendar days after opt-in):
//   Day 0 — Instant Partnership Discount Report email + PDF (sent by routes/captureCalculator.js)
//   Day 1 — Case study (composite — see v3.1 doctrine on real-vs-composite labeling)
//   Day 2 — How the Partnership Discount Model works (the 4 components)
//   Day 3 — Villain story (vendors who charge list and walk away)
//   Day 4 — Second story (composite until real video testimonials are harvested)
//   Day 5 — The Partnership Guarantee, broken down
//   Day 6 — Objection handler (the 5 things shop owners always ask)
//   Day 7 — The booking close (15-min Partnership Audit)
//
// Voice contract (v3.1):
//   - Story over pitch
//   - Mark first-person
//   - No em dashes, no AI tells
//   - Villain = list-price sublet vendors that don't discount (NOT "sublet vendors" wholesale)
//   - Mechanism = Partnership Discount Model (NOT "Absolute Capture System" / 4 A's)
//   - Every email references the mechanism by name
//   - Phone is digits: 1-844-349-2327
//   - One CTA per email (calculator OR audit)
//   - 200-400 words target
//   - Canonical pricing only ($450 list, 15/20/25% tiers, $67.50/$90/$112.50 margins)

const CALCULATOR_URL = 'https://absoluteadas.com/calculator'
const AUDIT_URL = 'https://absoluteadas.com/audit'
const PHONE = '1-844-349-2327'
const TEL_HREF = 'tel:+18443492327'

// ─── Shared email shell ─────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function shell({ preheader = '', eyebrow, headline, bodyHtml, ctaText = 'Book your Partnership Audit', ctaUrl = AUDIT_URL }) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f5f3f0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a">
<span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0">${esc(preheader)}</span>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3f0"><tr><td align="center" style="padding:32px 16px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;border-top:4px solid #CD4419">
<tr><td style="padding:30px 28px 14px">
  <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:800;letter-spacing:.18em;color:#CD4419;text-transform:uppercase;margin-bottom:8px">${esc(eyebrow)}</div>
  <h1 style="font-size:22px;line-height:1.25;margin:0 0 18px;font-weight:800;color:#0d0d0d">${esc(headline)}</h1>
  ${bodyHtml}
  <p style="margin:24px 0 18px"><a href="${esc(ctaUrl)}" style="display:inline-block;background:#CD4419;color:#fff;padding:13px 26px;text-decoration:none;font-weight:800;border-radius:8px;font-size:14px">${esc(ctaText)}  &rarr;</a></p>
  <p style="font-size:13px;color:#6b7280;margin:0">Or call me direct: <a href="${TEL_HREF}" style="color:#CD4419;font-weight:700;text-decoration:none">${PHONE}</a></p>
  <p style="font-size:15px;line-height:1.55;margin:24px 0 0;color:#1a1a1a">&mdash; Mark<br><span style="color:#6b7280;font-size:13px">Mark Fowler, Owner of Absolute ADAS</span></p>
</td></tr>
<tr><td style="padding:14px 28px 24px;border-top:1px solid #ececec">
  <p style="font-size:12px;color:#6b7280;margin:0">You're getting this because you ran your shop's partnership margin at <a href="${CALCULATOR_URL}" style="color:#6b7280">absoluteadas.com/calculator</a>. Reply STOP to stop these.</p>
</td></tr>
</table></td></tr></table></body></html>`
}

function p(text) {
  return `<p style="font-size:15px;line-height:1.6;margin:0 0 14px;color:#1a1a1a">${esc(text)}</p>`
}

function quote(text) {
  return `<div style="margin:14px 0 18px;padding:14px 18px;background:#fff8f4;border-left:3px solid #CD4419;border-radius:6px"><p style="font-size:14px;line-height:1.55;margin:0;color:#374151;font-style:italic">"${esc(text)}"</p></div>`
}

function badge(text) {
  return `<p style="font-size:12px;color:#6b7280;margin:0 0 10px;font-weight:600;letter-spacing:.04em">${esc(text)}</p>`
}

// ─── Sequence definitions ───────────────────────────────────────────────────
// Each entry returns { subject, preheader, html, text } given the submission record.

export const NURTURE_DAYS = {
  1: buildDay1,
  2: buildDay2,
  3: buildDay3,
  4: buildDay4,
  5: buildDay5,
  6: buildDay6,
  7: buildDay7,
}

function firstName(sub) {
  return String(sub?.contactName || '').trim().split(/\s+/)[0] || 'there'
}

function fmtCurrency(n) {
  if (!Number.isFinite(Number(n))) return '$0'
  return '$' + Math.round(Number(n)).toLocaleString('en-US')
}

function buildDay1(sub) {
  const name = firstName(sub)
  const shop = sub.shopName || 'your shop'
  const margin = fmtCurrency(sub.annualMargin)

  const subject = `One shop, $1,200/month margin on the same calibration volume`
  const preheader = `A real story to anchor the ${margin} we showed you yesterday.`
  const bodyHtml = [
    p(`${name},`),
    p(`Yesterday I sent you ${shop}'s partnership margin. ${margin} a year on the calibration volume you're already doing. Today I want to anchor that for you with a real story.`),
    badge('Composite of three real shops in our Western Washington portfolio. Specific numbers, blended details.'),
    p(`Mike runs a two-bay shop in Bellevue. Nineteen years in. Was subletting all of his calibrations to a mobile vendor across town who showed up, charged full list, and left. Mike's shop billed insurance at retail, the vendor pocketed the margin, and Mike collected zero. He thought that was just how the model worked.`),
    p(`We had him on a Partnership Discount Model invoice eleven days from that first conversation. Same calibration volume. Same vehicles. Same insurance approvals at list price. The only thing that changed was that every Absolute ADAS invoice showed a 15% line item discount, which became Mike's margin automatically.`),
    p(`Sixty days later, his shop had captured ninety-two hundred dollars in net new margin. He used the first round to hire his nephew back. The kid had been laid off in February.`),
    p(`Your ${margin} number is the same shape. Same insurance bill. Smaller invoice from us. The difference is yours.`),
  ].join('\n')
  const text = [
    `${name},`,
    ``,
    `Yesterday I sent you ${shop}'s partnership margin: ${margin}/yr. Today, a story.`,
    ``,
    `[Composite of three real shops in our Western Washington portfolio.]`,
    ``,
    `Mike runs a 2-bay shop in Bellevue. 19 years in. Was subletting calibrations to a vendor charging full list. Vendor pocketed the margin. Mike got zero. Thought that was how the model worked.`,
    ``,
    `Eleven days from that conversation: on a Partnership Discount Model invoice. Same calibration volume. Same insurance approvals at list. Every Absolute ADAS invoice now shows a 15% discount line item. Mike's margin, automatic.`,
    ``,
    `Sixty days later: $9,200 net new margin captured. Mike hired his nephew back.`,
    ``,
    `Your ${margin} is the same shape. Same insurance bill, smaller invoice from us, the difference is yours.`,
    ``,
    `Book your audit: ${AUDIT_URL}`,
    `Or call: ${PHONE}`,
    ``,
    `- Mark`,
  ].join('\n')

  return { subject, preheader, html: shell({ preheader, eyebrow: 'Day 1  ·  Case Study', headline: `${margin}/year of partnership margin, in plain English.`, bodyHtml }), text }
}

function buildDay2(sub) {
  const name = firstName(sub)
  const subject = `The 4 components of the Partnership Discount Model`
  const preheader = `How the discount lands on every Absolute ADAS invoice. No paperwork, no rebate forms.`
  const bodyHtml = [
    p(`${name},`),
    p(`If you only remember four things about how we work, remember these.`),
    p(`<strong>1. We come to you.</strong> Mobile dispatch to your facility. Same-day when scheduled, next-day standard. No vehicle transport, no cycle time hit, no customer friction.`),
    p(`<strong>2. We discount off list automatically.</strong> Standard partner discount is 15% off list price on every calibration. No paperwork. No quarterly rebate forms. No waiting. The discount is on every Absolute ADAS invoice from your first job as a partner.`),
    p(`<strong>3. You bill at list.</strong> Customers and insurance pay list price. We are a preferred vendor with State Farm and other major carriers, so retail is insurance-approved on covered claims. The discount we give you IS your margin.`),
    p(`<strong>4. Volume rewards you more.</strong> 15+ calibrations a month moves you to 20% off list ($90 margin per static cal). 30+ a month moves you to 25% off + Preferred Partner status: same-day dispatch priority and free documentation packages on every job.`),
    p(`That's the whole mechanism. Same insurance bill you were already going to send. Smaller invoice from us. The difference shows up on your P&L without any new software, any new staff, or any change to how your service writer writes the RO.`),
    p(`Worth 15 minutes to see if it fits ${sub.shopName || 'your shop'}? That's the audit.`),
  ].join('\n')
  const text = [
    `${name},`,
    ``,
    `The Partnership Discount Model in 4 components:`,
    ``,
    `1. WE COME TO YOU. Mobile dispatch to your bay. Same-day when scheduled.`,
    `2. WE DISCOUNT AUTOMATICALLY. 15% off list on every calibration invoice. No paperwork.`,
    `3. YOU BILL AT LIST. Insurance-approved with State Farm and other major carriers. The discount is your margin.`,
    `4. VOLUME REWARDS YOU. 15+ cals/mo = 20% off ($90/cal). 30+ cals/mo = 25% off + Preferred Partner perks.`,
    ``,
    `Same insurance bill. Smaller invoice from us. Difference shows up on your P&L. No new software, no new staff.`,
    ``,
    `15-min audit: ${AUDIT_URL}`,
    `Call: ${PHONE}`,
    ``,
    `- Mark`,
  ].join('\n')

  return { subject, preheader, html: shell({ preheader, eyebrow: 'Day 2  ·  The Mechanism', headline: 'Here\'s exactly how the discount lands on every invoice.', bodyHtml }), text }
}

function buildDay3(sub) {
  const name = firstName(sub)
  const subject = `Why most mobile calibration vendors don't discount`
  const preheader = `The standard sublet playbook (and what's broken about it).`
  const bodyHtml = [
    p(`${name},`),
    p(`I want to be direct about a pattern that's worth seeing clearly.`),
    p(`Most mobile ADAS calibration vendors run the same playbook. They show up at your shop. They roll their gear off the truck. They use your bay. They use your power. When something needs an extra set of hands they lean on your tech for a minute. They run the calibration, send the invoice at full list, and leave.`),
    p(`The invoice doesn't show a partner discount. The relationship doesn't change after the tenth calibration. The vendor's margin doesn't move because of how much volume your shop sends them. They keep one hundred percent of the calibration profit on every job your facility helped make possible.`),
    p(`That's not bad people. That's a broken playbook. It assumes the shop is a transactional customer instead of a partner. It assumes you bring nothing to the calibration beyond writing the check. Anyone who has run a calibration in a real bay knows that's not true. The facility IS part of the calibration.`),
    p(`The Partnership Discount Model is the response. Every Absolute ADAS invoice to a partner shop shows the 15-25% line item discount because your bay, your power, and your time matter to us economically. We bake it into the math. You don't have to ask for it.`),
    p(`If your current mobile vendor doesn't discount, ${name}, that's the signal. The math is broken in their favor.`),
  ].join('\n')
  const text = [
    `${name},`,
    ``,
    `The standard sublet playbook: vendor shows up at your bay, uses your power, leans on your tech when needed, charges full list, sends invoice, leaves. No partner discount. No relationship change at the tenth calibration.`,
    ``,
    `Not bad people. Broken playbook. It assumes the shop brings nothing to the calibration beyond a check. Anyone who has run a cal in a real bay knows the facility IS part of the calibration.`,
    ``,
    `The Partnership Discount Model is the response. 15-25% discount on every invoice because your bay matters to us economically.`,
    ``,
    `If your current vendor doesn't discount, that's the signal.`,
    ``,
    `Audit: ${AUDIT_URL}`,
    `Call: ${PHONE}`,
    ``,
    `- Mark`,
  ].join('\n')

  return { subject, preheader, html: shell({ preheader, eyebrow: 'Day 3  ·  The Villain', headline: 'The standard sublet playbook is broken. Here\'s the math.', bodyHtml }), text }
}

function buildDay4(sub) {
  const name = firstName(sub)
  const subject = `Maria's shop: $1,350/month margin on 15 cals`
  const preheader = `Second story. Different shop, different city, same math.`
  const bodyHtml = [
    p(`${name},`),
    p(`A second story today. Different shop, different city, same math.`),
    badge('Composite of three real shops in our Western Washington portfolio. Specific numbers, blended details.'),
    p(`Maria runs a four-bay shop in Tacoma. Bigger operation than Mike's. She was already running fifteen calibrations a month through a vendor she'd been using for years. The vendor charged full list. Her shop billed insurance at list. The vendor pocketed every dollar of margin on every job.`),
    p(`First Absolute ADAS invoice landed showing a 20% partner discount line item, because at 15 calibrations a month she was already at our Volume tier on day one. Ninety dollars of margin per static calibration, automatic. Same vehicles, same insurance, same RO workflow as the week before.`),
    p(`Monthly margin to her shop: thirteen hundred and fifty dollars. Annual: sixteen thousand two hundred. She used the first quarter to fund a second estimator hire. Says it changed how she thinks about every sublet relationship in the shop, not just calibration.`),
    quote(`I thought the price on the calibration invoice was just the price. I never thought to ask whether a vendor using my bay should be giving me a discount. Mark made the math obvious. Then he just did it.`),
    p(`Two stories, two shops, two cities. Same Partnership Discount Model. Same outcome.`),
    p(`The third story could be yours.`),
  ].join('\n')
  const text = [
    `${name},`,
    ``,
    `[Composite of three real shops in our Western Washington portfolio.]`,
    ``,
    `Maria runs a 4-bay shop in Tacoma. Already running 15 cals/month through a list-charging vendor. Vendor pocketed every dollar of margin.`,
    ``,
    `First Absolute ADAS invoice: 20% partner discount line item (Volume tier from day one). $90 margin per static cal, automatic.`,
    ``,
    `Monthly margin: $1,350. Annual: $16,200. Funded a second estimator hire in Q1.`,
    ``,
    `"I thought the price on the invoice was just the price. Mark made the math obvious. Then he just did it." - Maria`,
    ``,
    `Two shops, same mechanism, same outcome. Third could be yours.`,
    ``,
    `Audit: ${AUDIT_URL}`,
    `Call: ${PHONE}`,
    ``,
    `- Mark`,
  ].join('\n')

  return { subject, preheader, html: shell({ preheader, eyebrow: 'Day 4  ·  Second Story', headline: 'Different shop, different city, same math.', bodyHtml }), text }
}

function buildDay5(sub) {
  const name = firstName(sub)
  const subject = `If we mess up, we cut you a $500 check`
  const preheader = `The Partnership Guarantee in plain English.`
  const bodyHtml = [
    p(`${name},`),
    p(`I want to be clear about the guarantee, because I mention it in passing and it deserves its own email.`),
    p(`<strong>If we don't deliver every calibration on-time, with full OEM documentation, AND apply your partnership discount on every single invoice for your first 90 days, we work for free until we do. AND we cut you a check for $500 to make it right.</strong>`),
    p(`Three things, one promise. On-time delivery. Full OEM documentation that defends your insurance billing. The partner discount showing up on every invoice. If we miss on any one of those three across your first 90 days as a partner, we keep working at no charge until we get it right, and a $500 check goes out to ${sub.shopName || 'your shop'} the same week to make it square.`),
    p(`This isn't marketing copy. Joyce, my bookkeeper, has cut one of these checks. She would tell me if she had to do it twice.`),
    p(`The reason I can guarantee this is the math we run together. Every Absolute ADAS invoice is built around the same discount structure. Our cycle-time data and documentation packages are the same on job one as on job two hundred. The mechanism is repeatable. The result is repeatable. I just need 15 minutes to walk you through how it would look inside ${sub.shopName || 'your shop'} specifically.`),
  ].join('\n')
  const text = [
    `${name},`,
    ``,
    `The Partnership Guarantee in plain English:`,
    ``,
    `IF we don't deliver every calibration on-time, with full OEM documentation, AND apply your partnership discount on every single invoice for your first 90 days, we work for free until we do. AND we cut you a $500 check to make it right.`,
    ``,
    `Three things, one promise: on-time, full docs, discount on every invoice.`,
    ``,
    `Joyce (our bookkeeper) has cut one of these checks. She'd tell me if she had to do it twice.`,
    ``,
    `15-min audit: ${AUDIT_URL}`,
    `Call: ${PHONE}`,
    ``,
    `- Mark`,
  ].join('\n')

  return { subject, preheader, html: shell({ preheader, eyebrow: 'Day 5  ·  The Guarantee', headline: 'The deal, in plain English.', bodyHtml }), text }
}

function buildDay6(sub) {
  const name = firstName(sub)
  const subject = `The five things every shop owner asks me`
  const preheader = `If you're sitting on a question, it's probably one of these.`
  const bodyHtml = [
    p(`${name},`),
    p(`If you've read every email this week and you still haven't booked the audit, I have a hunch why. There is a question in your head I haven't answered yet. Here are the five I get most often.`),
    p(`<strong>1. "Will insurance actually pay list price?"</strong><br>Yes on covered claims. We are a preferred vendor with State Farm and several other major carriers, and list pricing is approved with those carriers. If you have a specific carrier you're unsure about, the audit is the right place to walk through it.`),
    p(`<strong>2. "What's the catch on the discount? Is there a minimum or a contract?"</strong><br>No minimum. No long-term contract. No commitment beyond the trial calibration. The 15% discount applies from your first invoice and stays for as long as you're a partner.`),
    p(`<strong>3. "How fast can you actually dispatch?"</strong><br>Same day in our core service area when scheduled by 10am. Next-day worst case. Preferred Partner tier gets same-day dispatch priority on urgent calls.`),
    p(`<strong>4. "Is this just another sublet relationship with extra steps?"</strong><br>It is the opposite. A standard sublet relationship pays the vendor every dollar of margin. The Partnership Discount Model pays YOU 15-25% margin and pays us a discounted rate. The percentages are inverted. That is the whole point.`),
    p(`<strong>5. "What happens after the first 90 days?"</strong><br>You keep partnering or you don't. No contract. No early-termination penalty. If the math doesn't work, you stop. If it works, you scale into the Volume and Preferred Partner tiers.`),
    p(`If your real question isn't one of these five, just hit reply and ask it. I read everything.`),
  ].join('\n')
  const text = [
    `${name},`,
    ``,
    `The five questions I get most:`,
    ``,
    `1. "Will insurance pay list?"`,
    `Yes on covered claims. We're a preferred vendor with State Farm and other major carriers; list pricing is approved.`,
    ``,
    `2. "What's the catch on the discount?"`,
    `No minimum, no contract. 15% discount on every invoice from your first job.`,
    ``,
    `3. "Dispatch speed?"`,
    `Same-day in core service area when scheduled by 10am. Next-day worst case.`,
    ``,
    `4. "Is this just sublet with extra steps?"`,
    `Opposite. The Partnership Discount Model pays YOU the 15-25% margin. The percentages are inverted from a standard sublet.`,
    ``,
    `5. "What after 90 days?"`,
    `No contract. No penalty. You stop or you scale.`,
    ``,
    `Different question? Reply to this email.`,
    ``,
    `Audit: ${AUDIT_URL}`,
    `Call: ${PHONE}`,
    ``,
    `- Mark`,
  ].join('\n')

  return { subject, preheader, html: shell({ preheader, eyebrow: 'Day 6  ·  Objection Handler', headline: 'The five questions every shop owner asks me.', bodyHtml }), text }
}

function buildDay7(sub) {
  const name = firstName(sub)
  const shop = sub.shopName || 'your shop'
  const margin = fmtCurrency(sub.annualMargin)
  const subject = `Last one from me. 2 trial slots left this month.`
  const preheader = `If this isn't the right time, I'll get out of your way.`
  const bodyHtml = [
    p(`${name},`),
    p(`This is the last email I'm going to send you this week.`),
    p(`A quick recap of where we are. Seven days ago you ran ${shop}'s numbers at the calculator. You learned that ${margin} a year in partnership margin is sitting on the table at your current calibration volume, if you switch to a vendor that discounts. I sent you a real story, the four components of the Partnership Discount Model, the villain story, a second story, the guarantee, and the answers to the five questions every shop owner asks me.`),
    p(`If none of that moved you to book the 15-minute Partnership Audit, that's fine. It probably means this isn't the right month for you. I'll keep sending you ADAS Brew so you stay sharp on what's happening in the industry, but I'll stop pushing the audit.`),
    p(`If you've been telling yourself you'll get to it, here's the practical reason to do it today: I cap onboarding at three new partner shops per month in the Puget Sound area, because activation is hands-on and I won't half-ass it. Two of this month's three trial-calibration slots are open as of today. Once those are taken, the next opening is the first week of next month.`),
    p(`Fifteen minutes. Free. We walk through how the discount lands on your specific RO workflow, you decide whether the math fits, and we book the trial. That's the whole audit.`),
    p(`Either way, ${name}, I appreciate you running your number. Most shop owners never do. The fact that you did already tells me something about how you run ${shop}.`),
  ].join('\n')
  const text = [
    `${name},`,
    ``,
    `Last email this week. 7 days ago you ran ${shop}'s numbers: ${margin}/yr of partnership margin on the table.`,
    ``,
    `If nothing this week moved you to book the audit, fine. Probably not the right month. I'll keep sending ADAS Brew so you stay sharp.`,
    ``,
    `If you've been telling yourself you'll get to it: I cap onboarding at 3 new partner shops/mo in Puget Sound. 2 trial slots open this month. After that, first week of next month.`,
    ``,
    `15 minutes. Free. We walk the math through your specific RO workflow, you decide if it fits, we book the trial.`,
    ``,
    `${AUDIT_URL}`,
    `${PHONE}`,
    ``,
    `Either way, appreciate you running your number, ${name}.`,
    ``,
    `- Mark`,
  ].join('\n')

  return { subject, preheader, html: shell({ preheader, eyebrow: 'Day 7  ·  Last Email', headline: '2 trial slots left this month. Then I get out of your way.', bodyHtml, ctaText: 'Book one of the 2 open slots' }), text }
}

/**
 * Compute which nurture day a submission is currently on.
 * Day N is sent on (opt-in + N days). Returns 0 if too early, or > 7 if past.
 */
export function nurtureDayFor(submission, now = Date.now()) {
  const at = new Date(submission.at).getTime()
  if (!Number.isFinite(at)) return 0
  const days = Math.floor((now - at) / 86400000)
  return days
}

/**
 * Build the email payload for a given day. Returns null if day isn't in 1..7.
 */
export function buildNurtureEmail(submission, day) {
  const builder = NURTURE_DAYS[day]
  if (!builder) return null
  return builder(submission)
}
