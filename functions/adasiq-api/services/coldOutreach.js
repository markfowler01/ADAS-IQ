// Cold email outbound engine for the v3.1 Partnership Discount campaign.
//
// 3 hook sequences × 3 emails = 9 variants.
//   GREED:     "$X/yr of margin you're not earning at your current cal volume"
//   FAIRNESS:  "your vendor uses your bay and charges you full list anyway"
//   CURIOSITY: "the calibration math 95% of shop owners never run"
//
// Cadence: Email 1 (Day 0) → Email 2 (Day 4) → Email 3 (Day 10). Pause sending
// if reply rate < 3%.
//
// v3.1 doctrine: villain = list-price vendors that don't discount.
// Mechanism = Partnership Discount Model (15/20/25% off list).
// Canonical pricing only. Phone = digits (1-844-349-2327).

const CALCULATOR_URL = 'https://absoluteadas.com/calculator'
const AUDIT_URL = 'https://absoluteadas.com/partnership-audit'
const PHONE = '1-844-349-2327'

const HOOKS = ['greed', 'fairness', 'curiosity']
const DAYS = [0, 4, 10]

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Cold emails are intentionally plain-text-feel. Minimal HTML, no design
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

// ─── GREED sequence ─────────────────────────────────────────────────────────
function buildGreedDay0(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `${shop} is leaving $8,100+/yr of calibration margin uncollected`
  const preheader = `Same insurance bill. Smaller invoice from us. The difference is your margin.`
  const bodyHtml = [
    name ? p(`${name}. Bad opener, true math.`) : p(`Bad opener, true math.`),
    p(`A shop doing 10 static calibrations a month at the $450 list price most carriers approve is sending the entire calibration margin to whatever mobile vendor is invoicing them at full list. That's $8,100 a year of margin uncollected, on calibration work the shop is already billing insurance for.`),
    p(`Absolute ADAS gives partner shops a 15% discount off list on every invoice. Same insurance bill ($450). Smaller invoice from us ($382.50). The difference ($67.50 per cal) is your shop's margin. Automatic, every job, no paperwork.`),
    pHtml(`<a href="${esc(CALCULATOR_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/calculator</a>`),
    p(`Two numbers in. Personalized PDF out. No call required.`),
    p(`If your current mobile vendor isn't already discounting your invoices, hit reply and I'll show you how the math works on your specific volume.`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `Bad opener, true math.`,
    ``,
    `Shop doing 10 static cals/mo at $450 list = $8,100/yr of margin uncollected if the mobile vendor charges full list.`,
    ``,
    `Absolute ADAS gives partner shops 15% off list on every invoice. Same insurance bill ($450). Smaller invoice from us ($382.50). $67.50 per cal is your margin.`,
    ``,
    `Two numbers in, PDF out, no call:`,
    `${CALCULATOR_URL}`,
    ``,
    `If your current vendor doesn't discount, hit reply.`,
  ] }) }
}

function buildGreedDay4(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `Following up. Mike's shop captured $9,200 in 60 days.`
  const preheader = `Real story. Same shape as yours is.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`Quick story to anchor the email I sent this week.`),
    p(`Mike runs a 2-bay shop about an hour from me. He was already running calibrations through a mobile vendor that charged full list and pocketed the margin. He thought that was how the model worked. We moved him onto a Partnership Discount Model invoice in eleven days. Same vehicles. Same insurance approvals at list. Every Absolute ADAS invoice now shows the 15% line item discount.`),
    p(`Sixty days later: $9,200 of net new margin captured by the shop. He hired his nephew back.`),
    p(`Composite of three real shops in our Western Washington portfolio. Specific numbers, blended details.`),
    p(`I'm not asking you to take anyone's word. The calculator runs your shop's numbers in 60 seconds. The Partnership Audit walks through how the discount lands on your specific RO workflow in 15 minutes.`),
    pHtml(`<a href="${esc(CALCULATOR_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/calculator</a>. 60 seconds, no call.`),
    pHtml(`<a href="${esc(AUDIT_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/audit</a>. 15 minutes, with me.`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `Quick story.`,
    ``,
    `Mike runs a 2-bay shop. Was running cals through a vendor that charged full list and pocketed the margin. Eleven days from our first conversation, on a Partnership Discount Model invoice. Same vehicles, same insurance approvals, 15% line item discount on every invoice.`,
    ``,
    `60 days later: $9,200 net new margin captured. Hired his nephew back.`,
    ``,
    `[Composite of three real shops in our Western Washington portfolio.]`,
    ``,
    `Calculator (60 sec): ${CALCULATOR_URL}`,
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
    p(`Quick recap. A shop running 10 static calibrations a month at $450 list = $8,100/year of margin currently going to whatever mobile vendor invoices at full list. On 15 cals/mo at the Volume tier, $16,200/year. On 30+/mo at the Preferred Partner tier, $40,500/year. Same insurance bills. The only thing that changes is whose invoice shows the discount.`),
    p(`If the math doesn't bother you, that's a fine answer. I'll get out of your way.`),
    p(`If it does, the cleanest next step is the 15-minute Partnership Audit. I walk through how the discount lands on your specific RO workflow, you decide if it fits, we schedule a trial. Free, no commitment.`),
    p(`I cap onboarding at three new partner shops per month in our service area. Two trial slots are open this month. After that, first week of next month is the next opening.`),
    pHtml(`<a href="${esc(AUDIT_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/audit</a>`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `Last email to ${shop} unless I hear back.`,
    ``,
    `Recap: 10 cals/mo @ $450 list = $8,100/yr margin to whoever invoices at full list. 15 cals = $16,200. 30+ cals = $40,500. Same insurance bills, just who keeps the discount.`,
    ``,
    `If the math doesn't bother you, fine. I'll get out of your way.`,
    ``,
    `If it does: 15-min Partnership Audit. Free, no commitment.`,
    ``,
    `I cap onboarding at 3 partner shops/mo. 2 trial slots open this month.`,
    ``,
    `${AUDIT_URL}`,
  ] }) }
}

// ─── FAIRNESS sequence ─────────────────────────────────────────────────────
function buildFairnessDay0(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `Your mobile calibration vendor uses your bay. Why no discount?`
  const preheader = `Most shops never ask. It's a fair question.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`Cold email, I know. One question and I'm out.`),
    p(`When your mobile ADAS calibration vendor pulls up to your shop, they use your bay. They use your power. When something needs a second set of hands, they pull your tech for a minute. The customer pays insurance at list price. The vendor sends ${shop} an invoice for the full list amount and leaves.`),
    p(`Fair question: why isn't your shop on the invoice for some piece of the margin? Your facility is what makes mobile calibration possible. The vendor walks in with tools, walks out with profit, and your shop carries none of it on the P&L.`),
    p(`Absolute ADAS runs the Partnership Discount Model. Every invoice to a partner shop shows a 15-25% line item discount off list because your bay, your power, and your time matter to us economically. You bill insurance at list (insurance-approved, since we're a preferred vendor with State Farm and other major carriers). The discount we give you is your shop's margin.`),
    p(`The calculator runs your numbers in 60 seconds. No call required.`),
    pHtml(`<a href="${esc(CALCULATOR_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/calculator</a>`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `Cold email. One question and I'm out.`,
    ``,
    `Your mobile cal vendor uses your bay, your power, your tech's time when needed. Customer pays insurance at list. Vendor invoices ${shop} for full list and leaves.`,
    ``,
    `Why isn't your shop on the invoice for some of the margin? Your facility is what makes mobile possible.`,
    ``,
    `Absolute ADAS = Partnership Discount Model. 15-25% off list on every partner invoice because your bay matters to us economically. You bill insurance at list (approved with State Farm and other major carriers). The discount is your shop's margin.`,
    ``,
    `60-sec calculator: ${CALCULATOR_URL}`,
  ] }) }
}

function buildFairnessDay4(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `Standard sublet playbook vs Partnership Discount`
  const preheader = `Same vehicle, same insurance bill, different math.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`The math, side by side.`),
    p(`<strong>Standard sublet playbook:</strong> vendor charges your shop $450 list. You bill insurance $450. Your margin is whatever you can mark up the sublet on the RO. If your carrier doesn't pay the markup, your margin is zero.`),
    p(`<strong>Partnership Discount Model:</strong> Absolute ADAS invoices your shop $382.50 (15% off list). You bill insurance the same $450 (insurance-approved). Your margin is $67.50 per cal, automatic, every invoice, no markup negotiation, no carrier pushback.`),
    p(`Per calibration, that's $67.50 in your pocket instead of the vendor's. At 10 cals a month, $675/mo or $8,100/yr. At 15 cals, $1,350/mo or $16,200/yr. At 30+, $3,375/mo or $40,500/yr.`),
    p(`The Partnership Audit walks you through how this lands on your specific RO workflow. 15 minutes, free, with me.`),
    pHtml(`<a href="${esc(AUDIT_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/audit</a>`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `Math side by side.`,
    ``,
    `STANDARD: vendor charges $450. You bill $450. Margin = whatever markup you can negotiate. Often zero.`,
    ``,
    `PARTNERSHIP: vendor invoices $382.50 (15% off). You bill $450 (insurance-approved). $67.50/cal margin, automatic, no negotiation.`,
    ``,
    `10 cals/mo = $8,100/yr. 15 cals = $16,200/yr. 30+ cals = $40,500/yr.`,
    ``,
    `15-min audit, with me, free: ${AUDIT_URL}`,
  ] }) }
}

function buildFairnessDay10(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `Last try. One direct question.`
  const preheader = `Then I'm out of your inbox.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`One direct question and I'm done.`),
    p(`If a mobile ADAS calibration vendor walked into ${shop} this week, used your bay, charged your shop full list price, sent the invoice, and left, what part of that arrangement would you describe as a partnership?`),
    p(`That's the question shop owners can't unhear once they've heard it. The standard sublet playbook treats your facility as a free amenity. The Partnership Discount Model treats it as part of the deal, and shows the discount on every invoice to prove it.`),
    p(`Fifteen minutes is all I need to walk through what that would look like inside ${shop} specifically. Free, no pitch. If the math doesn't fit, we shake hands and you keep doing what you're doing.`),
    pHtml(`<a href="${esc(AUDIT_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/audit</a>`),
    p(`Two trial slots open this month. After that, first week of next month.`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `One direct question and I'm done.`,
    ``,
    `If a mobile cal vendor walked into ${shop}, used your bay, charged your shop full list, invoiced you, and left, what part of that would you call a partnership?`,
    ``,
    `Standard sublet treats your facility as a free amenity. Partnership Discount Model treats it as part of the deal, and proves it with the line item discount.`,
    ``,
    `15-min audit, free: ${AUDIT_URL}`,
    ``,
    `2 trial slots open this month.`,
  ] }) }
}

// ─── CURIOSITY sequence ─────────────────────────────────────────────────────
function buildCuriosityDay0(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `The calibration math 95% of shop owners never run`
  const preheader = `Two numbers, sixty seconds, free tool.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`Two numbers. Sixty seconds. You'll see how much partnership margin ${shop} could be earning on the calibration volume you're already doing.`),
    p(`Most shop owners never run this math. Not because it's hard. Because nobody asked them to. The mobile cal vendor has zero incentive to bring up the discount they could be giving and aren't.`),
    p(`Calibrations per month and your average list price. Plug those in, see your shop's annual margin under the Partnership Discount Model (15% off list at the Standard tier, 20% at Volume, 25% at Preferred Partner).`),
    pHtml(`<a href="${esc(CALCULATOR_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/calculator</a>`),
    p(`PDF emailed to you instantly. Nobody calls you. No upsell. If the number is small, great. If the number is big, the Partnership Audit walks through how the discount lands on your specific RO workflow. We can talk about that when you're ready, or never.`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `Two numbers. Sixty seconds.`,
    ``,
    `Calibrations per month + your average list price. Plug in, see your shop's annual margin at the Standard / Volume / Preferred tiers.`,
    ``,
    `Most shop owners never run this math. The mobile cal vendor has zero incentive to bring it up.`,
    ``,
    `${CALCULATOR_URL}`,
    ``,
    `PDF instant. No call. No upsell.`,
  ] }) }
}

function buildCuriosityDay4(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `Why every Absolute ADAS invoice shows a 15% discount line item`
  const preheader = `Pattern most shop owners haven't seen on a calibration invoice before.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`If you've ever pulled up a calibration invoice from your mobile vendor and looked for the discount line, you probably didn't find one. There usually isn't one. The standard sublet playbook charges list and doesn't acknowledge that your facility is part of the calibration.`),
    p(`Every Absolute ADAS invoice to a partner shop shows a partner discount line item: 15% off list at the Standard tier, 20% at Volume (15+ cals/mo), 25% at Preferred Partner (30+ cals/mo). It's the same place on the invoice every time. Same percentage. No carrier negotiation, no markup math, no waiting on a quarterly rebate.`),
    p(`The discount IS your shop's margin. You bill insurance at list ($450 for static, the canonical insurance-approved rate we share with State Farm and other major carriers). You pay us less than list. The difference shows up on your P&L automatically.`),
    p(`See what your shop's number looks like:`),
    pHtml(`<a href="${esc(CALCULATOR_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/calculator</a>`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `If you've ever looked at a calibration invoice from your mobile vendor for the discount line, there usually isn't one. Standard playbook charges list, doesn't acknowledge your facility is part of the calibration.`,
    ``,
    `Every Absolute ADAS invoice to a partner shop shows the partner discount line: 15% (Standard), 20% (Volume, 15+/mo), 25% (Preferred, 30+/mo).`,
    ``,
    `The discount IS your margin. Bill insurance $450 (approved with State Farm and other carriers). Pay us less. The difference is on your P&L automatically.`,
    ``,
    `${CALCULATOR_URL}`,
  ] }) }
}

function buildCuriosityDay10(target) {
  const name = firstName(target)
  const shop = target.shopName || 'your shop'
  const subject = `Closing the loop. One specific offer.`
  const preheader = `Before I stop emailing.`
  const bodyHtml = [
    name ? p(`${name},`) : p(`Hey,`),
    p(`Closing the loop on this thread. Two emails this month, this is the third. After this I stop.`),
    p(`Specific offer: I'll do one trial calibration at ${shop} so you can see exactly what the workflow + the partner discount look like from the inside. Your tech watches. Your service writer sees the invoice with the discount line item. Your customer gets a fully calibrated vehicle. No long-term commitment after the trial.`),
    p(`If after that trial you don't see how it would work in your shop, no harm done. If you do see it, we walk through the math, and you decide whether to onboard as a partner.`),
    p(`The Partnership Guarantee says: if we don't deliver every calibration on-time, with full OEM documentation, AND apply your partnership discount on every single invoice for your first 90 days as a partner, we work for free until we do, and I cut you a check for $500 to make it right.`),
    p(`Three steps. Run the calculator. Book the 15-minute Partnership Audit. We schedule the trial calibration.`),
    pHtml(`<a href="${esc(CALCULATOR_URL)}" style="color:#CD4419;font-weight:700">absoluteadas.com/calculator</a>`),
  ].join('\n')
  return { subject, preheader, html: shell({ preheader, bodyHtml }), text: textVersion({ name, shop, lines: [
    `Closing the loop. Specific offer:`,
    ``,
    `One trial calibration at ${shop}. Your tech watches. Your service writer sees the invoice with the 15% partner discount line. Customer gets a fully calibrated vehicle. No long-term commitment after the trial.`,
    ``,
    `Partnership Guarantee: on-time + full OEM docs + discount on every invoice for your first 90 days as partner, or we work free until we do + $500 check.`,
    ``,
    `Steps: Calculator → Audit → Trial.`,
    ``,
    `${CALCULATOR_URL}`,
  ] }) }
}

// ─── Sequence registry ──────────────────────────────────────────────────────
const BUILDERS = {
  greed:     { 0: buildGreedDay0,     4: buildGreedDay4,     10: buildGreedDay10 },
  fairness:  { 0: buildFairnessDay0,  4: buildFairnessDay4,  10: buildFairnessDay10 },
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
