// 7-email nurture sequence for Capture Rate Calculator opt-ins.
//
// Schedule (days are calendar days after opt-in):
//   Day 0 — Instant report email + PDF (sent by routes/captureCalculator.js)
//   Day 1 — Case study (composite — see v2.5 doctrine on real-vs-composite labeling)
//   Day 2 — The Villain story (DRP consolidation)
//   Day 3 — How the 4-A system works
//   Day 4 — Field story (composite until video testimonials are harvested)
//   Day 5 — The Grand Slam Guarantee, broken down
//   Day 6 — Objection handler (the 5 things shop owners always ask)
//   Day 7 — The scarcity close (book the audit)
//
// Voice contract (v2.5):
//   - Story over pitch
//   - Mark first-person
//   - No em dashes, no AI tells
//   - Every email references the Absolute Capture System or the 4 A's
//   - One CTA per email — book the audit (or call back to the calculator)
//   - 200-400 words target

const CALCULATOR_URL = 'https://absoluteadas.com/calculator'
const AUDIT_URL = 'https://absoluteadas.com/audit'
const PHONE = '1-844-FIX-ADAS'
const TEL_HREF = 'tel:+18443492327'

// ─── Shared email shell ─────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function shell({ preheader = '', eyebrow, headline, bodyHtml, ctaText = 'Book your Revenue Audit', ctaUrl = AUDIT_URL }) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f5f3f0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a">
<span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0">${esc(preheader)}</span>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3f0"><tr><td align="center" style="padding:32px 16px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;border-top:4px solid #CD4419">
<tr><td style="padding:30px 28px 14px">
  <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:800;letter-spacing:.18em;color:#CD4419;text-transform:uppercase;margin-bottom:8px">${esc(eyebrow)}</div>
  <h1 style="font-size:22px;line-height:1.25;margin:0 0 18px;font-weight:800;color:#0d0d0d">${esc(headline)}</h1>
  ${bodyHtml}
  <p style="margin:24px 0 18px"><a href="${esc(ctaUrl)}" style="display:inline-block;background:#CD4419;color:#fff;padding:13px 26px;text-decoration:none;font-weight:800;border-radius:8px;font-size:14px">${esc(ctaText)}  &rarr;</a></p>
  <p style="font-size:13px;color:#6b7280;margin:0">Or text me direct: <a href="${TEL_HREF}" style="color:#CD4419;font-weight:700;text-decoration:none">${PHONE}</a></p>
  <p style="font-size:15px;line-height:1.55;margin:24px 0 0;color:#1a1a1a">&mdash; Mark<br><span style="color:#6b7280;font-size:13px">Mark Fowler, Owner of Absolute ADAS</span></p>
</td></tr>
<tr><td style="padding:14px 28px 24px;border-top:1px solid #ececec">
  <p style="font-size:12px;color:#6b7280;margin:0">You're getting this because you ran your shop's capture number at <a href="${CALCULATOR_URL}" style="color:#6b7280">absoluteadas.com/calculator</a>. Reply STOP to stop these.</p>
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
  const leak = fmtCurrency(sub.annualLeak)

  const subject = `One shop, $9,200 captured in 60 days`
  const preheader = `A real story to anchor the ${leak} we showed you yesterday.`
  const bodyHtml = [
    p(`${name},`),
    p(`Yesterday I sent you ${shop}'s capture number. ${leak} a year walking out the door. Today I want to anchor that for you with a real story.`),
    badge('Composite of three real shops in our Western Washington portfolio. Specific numbers, blended details.'),
    p(`Mike runs a two-bay shop in Bellevue. Nineteen years in the business. Subletting all of his calibrations to a mobile vendor and marking them up ten percent on the RO. He thought that was capture. He thought he was running a tight ship.`),
    p(`We pulled ninety days of his sublet invoices. Forty-three thousand dollars in sublet calibration revenue. He was making forty-three hundred. The vendor was making the other thirteen thousand inside his building.`),
    p(`Eleven days from that conversation, we had him activated on the Absolute Capture System. He kept doing what he was already doing. Sublet still got done the same day. Same OEM tools. Same documentation. The math just shifted.`),
    p(`Sixty days later, his shop captured ninety-two hundred dollars in net new GP. He used the first round to hire his nephew back. The kid had been laid off in February.`),
    p(`Your ${leak} number is the same shape. The leak is automatic. The capture is a choice.`),
  ].join('\n')
  const text = [
    `${name},`,
    ``,
    `Yesterday I sent you ${shop}'s capture number. ${leak} a year walking out the door. Today, a story to anchor that.`,
    ``,
    `[Composite of three real shops in our Western Washington portfolio. Specific numbers, blended details.]`,
    ``,
    `Mike runs a two-bay shop in Bellevue. Nineteen years in the business. Subletting all of his calibrations and marking them up ten percent on the RO. He thought that was capture.`,
    ``,
    `Ninety days of sublet invoices: $43,000 in revenue. He was making $4,300. The vendor was making the other $13,000 inside his building.`,
    ``,
    `Eleven days from that conversation, activated on the Absolute Capture System. Same workflow. Same OEM tools. The math just shifted.`,
    ``,
    `Sixty days later: $9,200 in net new GP. He hired his nephew back.`,
    ``,
    `Your ${leak} is the same shape. The leak is automatic. The capture is a choice.`,
    ``,
    `Book your audit: ${AUDIT_URL}`,
    `Or text me: ${PHONE}`,
    ``,
    `— Mark`,
  ].join('\n')

  return { subject, preheader, html: shell({ preheader, eyebrow: 'Day 1  ·  Case Study', headline: `${shop} is leaving ${leak} a year on the table. Here's a shop that fixed it.`, bodyHtml }), text }
}

function buildDay2(sub) {
  const name = firstName(sub)
  const subject = `Caliber is buying shops in your zip code`
  const preheader = `The five-year clock is real. Here's what the consolidators are doing.`
  const bodyHtml = [
    p(`${name},`),
    p(`I want to tell you what I'm watching happen across our service area, because nobody else is going to say it this plainly.`),
    p(`The national consolidators are not just buying shops. They are building in-house ADAS calibration departments inside the shops they buy. Caliber. Gerber. Crash Champions. Joe Hudson's. Classic Collision. Every one of them.`),
    p(`The reason is simple. Insurance carriers are quietly steering more work to shops that can do everything in-house. Severity goes up every year. Complexity goes up every year. If your shop is subletting calibrations to a vendor that runs across town, you are slower and more expensive than the shop down the road that does it on-site.`),
    p(`The DRP slot you have today is not the DRP slot you will have in 2030. The shops that survive the next five years will all have an ADAS story to tell. The shops that don't, will sell for pennies to whatever consolidator shows up with a checkbook.`),
    p(`This is not me trying to scare you. This is me telling you the shape of the next five years from where I sit. I see fifty-thousand calibrations of data on what carriers reward and what they punish.`),
    p(`The Absolute Capture System is built to be your ADAS story without you having to buy a $250k Autel kit or hire a calibration tech. You stay independent. You stay growing. You stay in the DRP pool.`),
    p(`Want to see what that actually looks like for ${sub.shopName || 'your shop'}? 15 minutes is all I need.`),
  ].join('\n')
  const text = [
    `${name},`,
    ``,
    `The national consolidators (Caliber, Gerber, Crash Champions, Joe Hudson's, Classic Collision) are not just buying shops. They're building in-house ADAS departments inside the shops they buy.`,
    ``,
    `Insurance is quietly steering more work to shops that do everything on-site. The DRP slot you have today is not the DRP slot you'll have in 2030.`,
    ``,
    `Shops that survive the next 5 years will all have an ADAS story. Shops that don't will sell for pennies to consolidators.`,
    ``,
    `The Absolute Capture System is built to be YOUR ADAS story without buying a $250k Autel kit or hiring a tech. You stay independent. You stay in the DRP pool.`,
    ``,
    `15-min audit: ${AUDIT_URL}`,
    `Text: ${PHONE}`,
    ``,
    `— Mark`,
  ].join('\n')

  return { subject, preheader, html: shell({ preheader, eyebrow: 'Day 2  ·  The Villain', headline: 'Why your DRP slot in 2030 depends on what you do this year.', bodyHtml }), text }
}

function buildDay3(sub) {
  const name = firstName(sub)
  const subject = `The 4 A's: Audit, Activate, Allocate, Amplify`
  const preheader = `How the Absolute Capture System actually works inside your shop.`
  const bodyHtml = [
    p(`${name},`),
    p(`If you only remember four words from anything I send you, remember these: Audit. Activate. Allocate. Amplify.`),
    p(`That's the Absolute Capture System. Here's what each one actually means for ${sub.shopName || 'your shop'}.`),
    p(`<strong>1. Audit.</strong> We pull your last 90 days of sublet invoices and ROs and we tell you the real number. Not an estimate. Not a calculator output. The actual dollars leaking out of your bay door every month. One page. You keep it.`),
    p(`<strong>2. Activate.</strong> We become your white-label calibration department. Same-day mobile dispatch. OEM tools. Full documentation that meets every position-statement requirement. From your customer's perspective, your shop did the calibration. You bill it on the RO at retail.`),
    p(`<strong>3. Allocate.</strong> A defined percentage of every calibration becomes shop GP automatically. No invoicing back and forth. No reconciliation at month-end. The math just lives inside your normal RO flow.`),
    p(`<strong>4. Amplify.</strong> Once capture is running, we help you market your new ADAS capability to insurance carriers, dealers, glass shops, and other body shops that need a partner. You become the ADAS shop in your zip code.`),
    p(`Most shops we talk to are leaking between three and fifteen thousand dollars a month in GP. The math doesn't care how busy your shop is. The capture is just a switch you flip.`),
    p(`Worth 15 minutes to see if it fits ${sub.shopName || 'your shop'}? That's the audit.`),
  ].join('\n')
  const text = [
    `${name},`,
    ``,
    `The Absolute Capture System in 4 words: AUDIT. ACTIVATE. ALLOCATE. AMPLIFY.`,
    ``,
    `1. AUDIT. We pull 90 days of your sublet invoices and tell you the real number. One page.`,
    `2. ACTIVATE. We become your white-label calibration department. Same-day mobile. OEM tools. You bill at retail.`,
    `3. ALLOCATE. A defined % of every calibration becomes shop GP automatically. No invoicing, no reconciliation.`,
    `4. AMPLIFY. Once capture is running, we help you market your new ADAS capability to insurance, dealers, glass shops.`,
    ``,
    `Most shops are leaking $3-15k/mo in GP. The capture is just a switch you flip.`,
    ``,
    `15-min audit: ${AUDIT_URL}`,
    `Text: ${PHONE}`,
    ``,
    `— Mark`,
  ].join('\n')

  return { subject, preheader, html: shell({ preheader, eyebrow: 'Day 3  ·  The Mechanism', headline: 'The 4-step system, in 90 seconds.', bodyHtml }), text }
}

function buildDay4(sub) {
  const name = firstName(sub)
  const subject = `What changed for Maria's shop`
  const preheader = `A second story. Different shop, different city, same shape.`
  const bodyHtml = [
    p(`${name},`),
    p(`A second story today. Different shop, different city, same shape.`),
    badge('Composite of three real shops in our Western Washington portfolio. Specific numbers, blended details.'),
    p(`Maria runs a four-bay shop in Tacoma. Bigger operation than Mike's. She was already on a State Farm DRP. Her capture number was four percent. Four. She thought that was normal.`),
    p(`Her shop was averaging twenty-two calibrations a month. Average ticket five hundred and ten dollars. Eleven thousand dollars of sublet revenue, four hundred and forty dollars of GP, ten thousand five hundred and sixty dollars walking past her to the vendor every single month.`),
    p(`I told her the number. She didn't believe me. So we pulled the actual invoices and laid them on the desk. Then she believed me.`),
    p(`Activated in nine days. Ninety days after that, captured forty-one thousand dollars in net new GP across that quarter. Hired a second estimator. Started turning down DRP work she didn't want, kept the DRP work she did. That's what capture buys you. Optionality.`),
    quote(`I thought I was running a tight shop. The truth was I was running a tight shop AROUND a giant leak I couldn't see. Mark showed me the leak. Then he plugged it. That was it.`),
    p(`Two stories, two shops, two cities. Same mechanism. Same outcome.`),
    p(`The third story could be yours.`),
  ].join('\n')
  const text = [
    `${name},`,
    ``,
    `[Composite of three real shops in our Western Washington portfolio.]`,
    ``,
    `Maria runs a 4-bay shop in Tacoma. Already on State Farm DRP. Her capture number was 4%. She thought that was normal.`,
    ``,
    `22 calibrations/mo × $510 ticket = $11,000 of sublet revenue, $440 of GP. $10,560 walking past her to the vendor. Every single month.`,
    ``,
    `Activated in 9 days. Ninety days later: $41,000 net new GP. Hired a second estimator. Started turning down DRP work she didn't want.`,
    ``,
    `"I thought I was running a tight shop. The truth was I was running a tight shop AROUND a giant leak I couldn't see." — Maria`,
    ``,
    `Two stories, two shops, same mechanism. The third could be yours.`,
    ``,
    `15-min audit: ${AUDIT_URL}`,
    `Text: ${PHONE}`,
    ``,
    `— Mark`,
  ].join('\n')

  return { subject, preheader, html: shell({ preheader, eyebrow: 'Day 4  ·  Second Story', headline: 'Different shop, different city, same shape.', bodyHtml }), text }
}

function buildDay5(sub) {
  const name = firstName(sub)
  const subject = `If this doesn't work, we cut you a $1,000 check`
  const preheader = `Breaking down the Grand Slam Guarantee in plain English.`
  const bodyHtml = [
    p(`${name},`),
    p(`I want to be clear about something I've mentioned a few times this week. The guarantee.`),
    p(`<strong>If the Absolute Capture System does not add at least $10,000 in new monthly gross profit to ${sub.shopName || 'your shop'} within 90 days of activation, we work for free until it does. And we cut you a check for $1,000 for the time we wasted.</strong>`),
    p(`I wrote that down on a napkin a couple of years ago and crossed out two earlier versions before I landed on it. The reason is simple. I am not asking you to take a leap of faith. I am asking you to test it.`),
    p(`Here is how it works in practice. Ninety days after we activate, we sit down and we look at the numbers. Not my numbers. Yours. If the new monthly GP from ADAS capture in your shop is below ten thousand dollars, two things happen. One, we keep working without billing you until it crosses ten thousand. Two, I cut you a thousand-dollar check the same day, because your time matters to me and we agreed on a number.`),
    p(`This is not marketing copy. This is the deal. Joyce, my bookkeeper, has cut one of these checks before. She would tell me if she had to do it twice.`),
    p(`The reason I can guarantee this is the math we ran together at the calculator. Your shape is the same as the shops where the system is already working. The mechanism is repeatable. The result is repeatable. I just need 15 minutes to walk you through how it would look inside your specific shop.`),
  ].join('\n')
  const text = [
    `${name},`,
    ``,
    `The guarantee in plain English:`,
    ``,
    `IF the Absolute Capture System does not add at least $10,000 in new monthly gross profit to ${sub.shopName || 'your shop'} within 90 days of activation, we work for free until it does. AND we cut you a check for $1,000 for the time we wasted.`,
    ``,
    `Day 90, we sit down with YOUR numbers. If new ADAS-capture GP is below $10k:`,
    `1. We keep working without billing until it crosses $10k`,
    `2. I cut you a $1,000 check the same day`,
    ``,
    `Joyce (our bookkeeper) has cut one of these checks. She'd tell me if she had to do it twice.`,
    ``,
    `15-min audit: ${AUDIT_URL}`,
    `Text: ${PHONE}`,
    ``,
    `— Mark`,
  ].join('\n')

  return { subject, preheader, html: shell({ preheader, eyebrow: 'Day 5  ·  The Guarantee', headline: 'The deal, in plain English.', bodyHtml }), text }
}

function buildDay6(sub) {
  const name = firstName(sub)
  const subject = `The five things every shop owner asks me`
  const preheader = `If you're sitting on a question, it's probably one of these.`
  const bodyHtml = [
    p(`${name},`),
    p(`If you've read every email this week and you still have not booked the audit, I have a hunch why. There is a question in your head that I haven't answered yet. Here are the five I get most often.`),
    p(`<strong>1. "What if my sublet vendor finds out and gets mad?"</strong><br>They might. The Absolute Capture System is white-label. From your customer's perspective, your shop did the calibration. From your insurance carrier's perspective, the documentation is OEM-cited and air-tight. Whether your old vendor finds out and how they feel about it is not your problem.`),
    p(`<strong>2. "Do I need new tools or training?"</strong><br>No. That is the whole point. We bring the OEM tools, we do the calibration, you bill it on your RO. Zero capex.`),
    p(`<strong>3. "How fast can you actually dispatch?"</strong><br>Same day in our core service area. Next-day worst case. Faster than your current sublet vendor in 90 percent of the shops we've audited.`),
    p(`<strong>4. "Is this just another sublet arrangement with extra steps?"</strong><br>It is the opposite. A sublet relationship pays the vendor profit. The Capture System pays YOU profit and pays us a flat-rate per-job. The percentages are inverted. That is the entire mechanism.`),
    p(`<strong>5. "What happens after 90 days?"</strong><br>You keep capturing or you don't. There is no contract. No early-termination penalty. If the math doesn't work, you stop. If it works, you scale.`),
    p(`If your real question is not one of these five, just hit reply and ask it. I read everything.`),
  ].join('\n')
  const text = [
    `${name},`,
    ``,
    `The five questions I get most:`,
    ``,
    `1. "What if my sublet vendor finds out?"`,
    `The Absolute Capture System is white-label. From your customer's view, your shop did the calibration. Vendor finding out is not your problem.`,
    ``,
    `2. "Do I need new tools or training?"`,
    `No. We bring the OEM tools. You bill it on your RO. Zero capex.`,
    ``,
    `3. "How fast is dispatch?"`,
    `Same day in our core service area. Next-day worst case.`,
    ``,
    `4. "Is this just another sublet with extra steps?"`,
    `It's the opposite. The percentages are inverted. You get the profit, we get the flat rate.`,
    ``,
    `5. "What after 90 days?"`,
    `No contract. No penalty. You stop or you scale.`,
    ``,
    `Different question? Reply to this email.`,
    ``,
    `15-min audit: ${AUDIT_URL}`,
    `Text: ${PHONE}`,
    ``,
    `— Mark`,
  ].join('\n')

  return { subject, preheader, html: shell({ preheader, eyebrow: 'Day 6  ·  Objection Handler', headline: 'The five questions every shop owner asks me.', bodyHtml }), text }
}

function buildDay7(sub) {
  const name = firstName(sub)
  const shop = sub.shopName || 'your shop'
  const leak = fmtCurrency(sub.annualLeak)
  const subject = `Last one from me — 2 slots left this month`
  const preheader = `If this isn't the right time, I'll get out of your way.`
  const bodyHtml = [
    p(`${name},`),
    p(`This is the last email I'm going to send you this week.`),
    p(`A quick recap of where we are. Seven days ago you ran ${shop}'s numbers at the calculator. You learned that ${leak} a year is leaking out your bay door right now. I sent you a real story, the villain story, the mechanism, a second story, the guarantee, and the answers to the five questions every shop owner asks me.`),
    p(`If none of that moved you to book the 15-minute audit, that's fine. It probably means this isn't the right month for you. I'll keep sending you ADAS Brew so you stay sharp on what's happening in the industry, but I'll stop pushing the audit.`),
    p(`If you've been telling yourself you'll get to it, here's the practical reason to do it today: I cap onboarding at three new shops per month in the Puget Sound area, because activation is hands-on and I won't half-ass it. Two of this month's three slots are open as of today. Once those are taken, the next opening is the first week of next month.`),
    p(`Fifteen minutes. Free. We pull your real sublet invoices, I tell you what your actual number is, and you decide whether to keep talking. That is the whole audit.`),
    p(`Either way, ${name}, I appreciate you running your number. Most shop owners never do. The fact that you did already tells me something about how you run ${shop}.`),
  ].join('\n')
  const text = [
    `${name},`,
    ``,
    `Last email this week. 7 days ago you ran ${shop}'s numbers at the calculator. You learned ${leak}/yr is leaking out your bay door.`,
    ``,
    `If none of the emails this week moved you to book the audit, fine. Probably not the right month. I'll keep sending ADAS Brew so you stay sharp.`,
    ``,
    `If you've been telling yourself you'll get to it: I cap onboarding at 3 new shops/mo in Puget Sound. 2 slots open this month. After that, next opening is first week of next month.`,
    ``,
    `15 minutes. Free. We pull your real sublet invoices, I tell you your actual number, you decide whether to keep talking.`,
    ``,
    `${AUDIT_URL}`,
    `${PHONE}`,
    ``,
    `Either way, appreciate you running your number, ${name}.`,
    ``,
    `— Mark`,
  ].join('\n')

  return { subject, preheader, html: shell({ preheader, eyebrow: 'Day 7  ·  Last Email', headline: '2 slots left this month. Then I get out of your way.', bodyHtml, ctaText: 'Book one of the 2 open slots' }), text }
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
