// Cold email outbound engine for the v2.5 Capture System campaign.
//
// 3 sequences × 3 emails = 9 variants. Each sequence tests a different
// hook angle (Greed / Fear / Curiosity). All emails follow the v2.5 voice
// contract: pattern-interrupt opener, story over pitch, one CTA per email,
// no em dashes, no AI tells.
//
// Cadence: Email 1 (Day 0) → Email 2 (Day 4) → Email 3 (Day 10). Total
// sequence length: 10 days. Pause sending if reply rate < 3%.
//
// Send via Resend (same warm domain as the newsletter). Throttle inside
// sendBroadcast keeps us under Resend's rate limits.

const CALCULATOR_URL = 'https://absoluteadas.com/calculator'
const AUDIT_URL = 'https://absoluteadas.com/audit'
const PHONE = '1-844-FIX-ADAS'
const TEL_HREF = 'tel:+18443492327'

const HOOKS = ['greed', 'fear', 'curiosity']
const DAYS = [0, 4, 10]   // Day-0 first contact, Day-4 follow-up, Day-10 close

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Cold emails are intentionally plain-text-feel. Minimal HTML, no big design
// flourishes — a cold email that looks like a newsletter gets caught by spam.
function shell({ preheader, bodyHtml }) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.6">
<span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0">${esc(preheader)}</span>
<div style="max-width:580px;margin:0 auto;padding:24px 22px">
${bodyHtml}
<p style="margin:18px 0 6px;color:#1a1a1a">Mark Fowler<br><span style="color:#6b7280;font-size:13px">Owner, Absolute ADAS  ·  Western Washington<br>${PHONE}  ·  <a href="${CALCULATOR_URL}" style="color:#6b7280">absoluteadas.com</a></span></p>
<p style="font-size:11px;color:#9ca3af;margin:22px 0 0;border-top:1px solid #e5e7eb;padding-top:10px">If this isn't relevant, just reply UNSUBSCRIBE and I'll take you off the list.</p>
</div></body></html>`
}

function p(text) {
  return `<p style="margin:0 0 14px">${esc(text)}</p>`
}

function pHtml(htmlStr) {
  return `<p style="margin:0 0 14px">${htmlStr}</p>`
}

function firstName(target) {
  return String(target?.contactName || '').trim().split(/\s+/)[0] || ''
}

// ─── GREED sequence ─────────────────────────────────────────────────────────
function buildGreedDay0(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `${shop} is paying your sublet vendor about $50k/yr`
  const preheader = `60 seconds to see your number. Free tool.`
  const bodyHtml = [
    name ? p(`${name}. Bad opener, true math.`) : p(`Bad opener, true math.`),
    p(`A two-bay shop subletting 18 calibrations a month at $450 average is sending the sublet vendor roughly $50,000 of gross profit per year. Most shop owners I talk to are within $10,000 of that number and don't realize it.`),
    p(`Your shop's specific number is probably bigger or smaller depending on volume, ticket, and how much you're already marking up. The math is easy. Built a free calculator that does it in 60 seconds.`),
    pHtml(`<a href="${esc(CALCULATOR_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/calculator</a>`),
    p(`Three numbers in. Personalized PDF out. No call required.`),
    p(`If the number scares you, hit reply and I'll show you the four-step system to capture it back. If it doesn't, ignore me and have a good week.`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `Bad opener, true math.`,
    ``,
    `A 2-bay shop subletting 18 calibrations/mo at $450 avg sends ~$50,000 of GP per year to the sublet vendor.`,
    ``,
    `Your shop's number is bigger or smaller depending on volume + ticket. Easy math. Free calculator:`,
    ``,
    `${CALCULATOR_URL}`,
    ``,
    `Three numbers in. Personalized PDF out. No call required.`,
    ``,
    `If the number scares you, hit reply.`,
  ] }) }
}

function buildGreedDay4(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `Following up. The $43,000 leak.`
  const preheader = `A real shop's number. Same shape as yours probably is.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`Quick story to anchor the email I sent earlier this week.`),
    p(`Mike runs a two-bay shop about an hour from me. Nineteen years in. I asked him to pull ninety days of sublet invoices. Forty-three thousand dollars in sublet calibration revenue. He was making forty-three hundred. The sublet vendor was making the other thirteen thousand inside his building.`),
    p(`He didn't believe me until we laid the actual invoices on his desk.`),
    p(`I'm not asking you to take anyone's word for anything. The calculator gives you the math in 60 seconds. The Revenue Audit gives you the math from your real invoices in 15 minutes.`),
    pHtml(`<a href="${esc(CALCULATOR_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/calculator</a>. 60 seconds, no call.`),
    pHtml(`<a href="${esc(AUDIT_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/audit</a>. 15 minutes, with me.`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `Quick story.`,
    ``,
    `Mike runs a 2-bay shop about an hour from me. 19 years in. Pulled 90 days of sublet invoices: $43,000 in revenue. He was making $4,300. The vendor was making $13,000 inside his building.`,
    ``,
    `He didn't believe me until we laid the actual invoices on his desk.`,
    ``,
    `Calculator (60 sec, no call): ${CALCULATOR_URL}`,
    `Audit (15 min, with me): ${AUDIT_URL}`,
  ] }) }
}

function buildGreedDay10(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `Last one. I'll get out of your way.`
  const preheader = `If this isn't the right month, I'll stop.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`This is my last email to ${shop} unless I hear back.`),
    p(`Quick recap. Two weeks ago I told you a two-bay shop is typically sending fifty thousand dollars of gross profit a year to a sublet vendor. Last week I told you about Mike, who was paying thirteen thousand a quarter to a vendor running across town.`),
    p(`If the math doesn't bother you, that's a fine answer. I'll get out of your way.`),
    p(`If the math does bother you, the cleanest next step is the 15-minute Revenue Audit. I pull your real sublet invoices, I tell you your real number, and you decide if you want to keep talking. Free. No commitment.`),
    p(`I cap onboarding at three new shops per month in our service area. Two slots are open this month. After that, first week of next month is the next opening.`),
    pHtml(`<a href="${esc(AUDIT_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/audit</a>`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `Last email to ${shop} unless I hear back.`,
    ``,
    `Recap: a 2-bay shop typically sends $50k/yr of GP to a sublet vendor. Mike was paying $13k/quarter to a vendor across town.`,
    ``,
    `If the math doesn't bother you, fine answer. I'll get out of your way.`,
    ``,
    `If it does: 15-min Revenue Audit. Real invoices, real number, no commitment.`,
    ``,
    `I cap onboarding at 3 shops/mo. 2 slots open this month.`,
    ``,
    `${AUDIT_URL}`,
  ] }) }
}

// ─── FEAR sequence ──────────────────────────────────────────────────────────
function buildFearDay0(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `Caliber is buying shops in your zip code`
  const preheader = `Sending this to indie shops in our service area.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`Quick note from one independent collision shop to another. Cold email, I know. Read it or don't.`),
    p(`The national consolidators are not just buying shops anymore. They are building in-house ADAS calibration departments inside the shops they buy. Caliber, Gerber, Crash Champions, Joe Hudson's, Classic Collision. All of them.`),
    p(`The reason is the same reason it should worry you. Insurance carriers are quietly steering more work to shops that do everything on-site, fast, with documentation. If your shop is subletting calibrations across town to a vendor, you are slower and more expensive than the consolidator shop down the road. That's a DRP problem in 2027.`),
    p(`I run a mobile ADAS calibration shop in Western Washington. I built a calculator that shows you in 60 seconds how much GP your sublet vendor is making inside your building, and how much of it you could capture back without buying any new equipment.`),
    pHtml(`<a href="${esc(CALCULATOR_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/calculator</a>`),
    p(`Hit reply if the number lights you up. Or don't.`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `Cold email. Read it or don't.`,
    ``,
    `The national consolidators (Caliber, Gerber, Crash Champions, Joe Hudson's, Classic Collision) are building in-house ADAS departments inside the shops they buy.`,
    ``,
    `Insurance is steering work to on-site shops with fast documentation. Subletting calibrations across town = DRP problem in 2027.`,
    ``,
    `Calculator (60 sec): ${CALCULATOR_URL}`,
  ] }) }
}

function buildFearDay4(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `The shops that don't pivot get bought for pennies`
  const preheader = `Hard truth from the field.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`I'm going to say something that probably sounds dramatic and isn't. The independents that don't have an ADAS story by 2030 are going to sell to consolidators for pennies on the dollar.`),
    p(`Severity goes up every year. Complexity goes up every year. The carriers are not subtle about which shops they want on DRPs. Those shops have the certifications, the OEM-procedure documentation, and the on-site capability. Subletting to a vendor that runs across town is slower, more expensive, and more error-prone. Every adjuster knows it.`),
    p(`You don't need to buy a $250k Autel kit to have an ADAS story. You need a white-label partner that handles the calibration on your floor with OEM tools and full documentation, and a math arrangement that gives YOU the gross profit instead of the vendor. That's what I built. We call it the Absolute Capture System.`),
    p(`Easiest first step is the calculator. Shows you your number. Sixty seconds.`),
    pHtml(`<a href="${esc(CALCULATOR_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/calculator</a>`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `The independents that don't have an ADAS story by 2030 will sell to consolidators for pennies.`,
    ``,
    `Carriers steer DRPs to shops with on-site ADAS, OEM documentation, fast cycle time. Subletting across town is the opposite of that.`,
    ``,
    `You don't need to buy a $250k Autel kit. You need a white-label partner doing the calibration on YOUR floor with the math arrangement giving YOU the GP. That's the Absolute Capture System.`,
    ``,
    `Calculator: ${CALCULATOR_URL}`,
  ] }) }
}

function buildFearDay10(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `Last try. I'll stop after this.`
  const preheader = `One direct question.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`One direct question and then I'm done.`),
    p(`If a national consolidator made you a check offer for ${shop} in the next 18 months, would you have the leverage to say no?`),
    p(`The shops that have leverage in that conversation are the ones that show DRP-ready ADAS capability on their P&L. That's revenue captured in-house, documented to OEM standard, with cycle-time data the carrier respects. The shops that don't have that get the lowball offer and have to take it.`),
    p(`Fifteen minutes is all I need to show you what that capability would look like inside ${shop}. Free. No pitch. If the math doesn't work, we shake hands and you keep doing what you're doing.`),
    pHtml(`<a href="${esc(AUDIT_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/audit</a>`),
    p(`I cap onboarding at three shops per month. Two slots open this month. After that, first week of next month.`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `One direct question and then I'm done.`,
    ``,
    `If a consolidator made you a check offer for ${shop} in 18 months, would you have leverage to say no?`,
    ``,
    `Leverage = DRP-ready ADAS capability on your P&L. Captured in-house, documented to OEM, cycle-time data carriers respect.`,
    ``,
    `Without that, the offer is a lowball and you have to take it.`,
    ``,
    `15-min audit, free, no pitch: ${AUDIT_URL}`,
    ``,
    `3 shops/mo cap. 2 slots open.`,
  ] }) }
}

// ─── CURIOSITY sequence ─────────────────────────────────────────────────────
function buildCuriosityDay0(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `The capture number your vendor hopes you never run`
  const preheader = `60 seconds to see it. Free tool.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`Three numbers. Sixty seconds. You'll see how much gross profit your sublet calibration vendor is making inside ${shop} every year.`),
    p(`Most shop owners I talk to have never run this math. Not because it's hard. Because nobody asked them to. The vendor has zero incentive to bring it up.`),
    p(`Calibrations subbed per month, average ticket, and the margin you currently make when you mark up the sublet on the RO. Plug those in. See your number.`),
    pHtml(`<a href="${esc(CALCULATOR_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/calculator</a>`),
    p(`PDF emailed to you instantly. Nobody calls you. No upsell. If the number is small, great. If the number is big, I built a system to capture it back without buying a $250k Autel kit. We can talk about that when you're ready, or never.`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `Three numbers. Sixty seconds.`,
    ``,
    `Calibrations subbed/mo, avg ticket, current capture %. Plug in. See your number.`,
    ``,
    `Most shop owners never run this math because the vendor has zero incentive to bring it up.`,
    ``,
    `${CALCULATOR_URL}`,
    ``,
    `PDF instant. No call. No upsell.`,
  ] }) }
}

function buildCuriosityDay4(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `Why State Farm is quietly steering work to in-house ADAS`
  const preheader = `Pattern I see every week.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`Pattern I see every week and nobody talks about.`),
    p(`State Farm in particular is quietly tightening which shops get severity work. The signal is calibration documentation. Shops that show OEM-cited pre-scan, post-scan, calibration, and R&R line items, with on-site capability and same-day turnaround, are getting more steering. Shops that sublet across town and submit late docs are getting less.`),
    p(`This is not on any public memo. It's a pattern across the fifty thousand calibrations of data I sit on top of, plus what adjusters tell me off the record at trade shows.`),
    p(`The Absolute Capture System gives you on-site capability without buying equipment. Same-day mobile dispatch, OEM tools, full documentation that meets every position-statement requirement. Documentation that adjusters can't deny because it's already cited.`),
    p(`It also pays you more gross profit on the work, which is the part most shops care about first. Calculator below.`),
    pHtml(`<a href="${esc(CALCULATOR_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/calculator</a>`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `Pattern I see every week:`,
    ``,
    `State Farm quietly steers severity to shops showing OEM-cited pre/post-scan, calibration, R&R with on-site cap and same-day docs. Subletting + late docs = less steering.`,
    ``,
    `Not on any public memo. It's a pattern from the 50k calibrations of data we sit on + what adjusters tell me off-record.`,
    ``,
    `Absolute Capture System = on-site capability without buying gear. Same-day mobile, OEM tools, full docs. Pays you more GP too.`,
    ``,
    `${CALCULATOR_URL}`,
  ] }) }
}

function buildCuriosityDay10(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `Closing the loop`
  const preheader = `One specific offer before I stop emailing.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`Closing the loop on this thread. Two emails this month, this is the third. After this I stop.`),
    p(`Specific offer. I'll do one calibration at ${shop}, white-label, no charge to you, so you can see exactly what the workflow looks like from the inside. Your tech watches, your service writer sees the documentation, your customer gets a fully-calibrated vehicle. Zero cost trial.`),
    p(`If after that trial calibration you don't see how it would work in your shop, no harm done. If you do see it, we walk through the math, and you decide whether to onboard. The Absolute Capture System has a guarantee that says if it doesn't add at least ten thousand dollars in new monthly gross profit within ninety days of activation, we work for free until it does, and I cut you a thousand-dollar check for the time we wasted.`),
    p(`Three steps to claim the trial. Run the calculator. Book the 15-minute audit. We schedule the trial.`),
    pHtml(`<a href="${esc(CALCULATOR_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/calculator</a>`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `Closing the loop. Specific offer:`,
    ``,
    `One calibration at ${shop}, white-label, no charge. Your tech watches. Your service writer sees the docs. Zero-cost trial.`,
    ``,
    `If after the trial you don't see how it works in your shop, no harm. If you do, we walk through the math.`,
    ``,
    `Absolute Capture System guarantee: $10k new monthly GP within 90 days of activation, or we work free until it does + I cut you a $1,000 check.`,
    ``,
    `Steps: Calculator → Audit → Trial.`,
    ``,
    `${CALCULATOR_URL}`,
  ] }) }
}

function textVersion({ name, shop, lines }) {
  const sig = [
    '',
    `Mark Fowler`,
    `Owner, Absolute ADAS  ·  Western Washington`,
    `${PHONE}  ·  absoluteadas.com`,
    '',
    `If this isn't relevant, reply UNSUBSCRIBE and I'll take you off the list.`,
  ]
  const head = name ? `${name},` : 'Hey,'
  return [head, '', ...lines, ...sig].join('\n')
}

// ─── Sequence registry ──────────────────────────────────────────────────────
const BUILDERS = {
  greed:     { 0: buildGreedDay0,     4: buildGreedDay4,     10: buildGreedDay10 },
  fear:      { 0: buildFearDay0,      4: buildFearDay4,      10: buildFearDay10 },
  curiosity: { 0: buildCuriosityDay0, 4: buildCuriosityDay4, 10: buildCuriosityDay10 },
}

/**
 * Build a cold email. Target shape: { contactName?, shopName, email, city? }
 * @param {{hook:string, day:number}} pick
 * @param {Object} target
 * @returns {{subject:string, preheader:string, html:string, text:string}|null}
 */
export function buildColdEmail({ hook, day }, target) {
  const sequence = BUILDERS[hook]
  if (!sequence) return null
  const builder = sequence[day]
  if (!builder) return null
  return builder(target || {})
}

export const COLD_HOOKS = HOOKS
export const COLD_DAYS = DAYS
