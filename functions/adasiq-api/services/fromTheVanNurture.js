// From the Van — Partnership Discount Magic Lantern (7-day sequence).
//
// Fires daily from the capture_van_nurture cron. Every subscriber to the
// From the Van weekly newsletter also gets enrolled here — one email per day
// for 7 days that walks them through the Partnership Discount Model, the
// math, a case study, the Guarantee, and lands on the Partnership Audit CTA.
//
// Voice: plain-spoken Mark (per From the Van master prompt + v3.1 doctrine).
// No em dashes, no AI tells, no exclamation points. First-person, peer voice.
//
// Unsubscribe URL: the `wrap()` output contains the placeholder
// `__VAN_UNSUB_URL__`. The sender (cron handler + preview endpoint)
// substitutes this per-recipient with a signed URL built via
// `vanUnsubscribeUrl()`. This avoids relying on Resend's `{{{RESEND_UNSUBSCRIBE_URL}}}`
// which only substitutes inside Resend Broadcasts, not `/emails` transactional sends.

const BREW_URL = 'https://absoluteadas.com/brew'
const AUDIT_URL = 'https://absoluteadas.com/partnership-audit'
const CALCULATOR_URL = 'https://absoluteadas.com/calculator'
const MAILING_ADDRESS = '2307 Cedar Rd · Lake Stevens, WA 98258'
export const VAN_UNSUB_PLACEHOLDER = '__VAN_UNSUB_URL__'

function firstName(sub) {
  const raw = String(sub?.name || sub?.firstName || '').trim().split(/\s+/)[0]
  return raw || 'there'
}

// Shared wrapper — minimal email-safe single-column, #CD4419 accent bar.
function wrap({ preview, bodyHtml }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preview}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:16px;line-height:1.55;">
<tr><td style="border-top:3px solid #CD4419;padding-top:14px;">
<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#666;">From the Van</div>
</td></tr>
<tr><td style="padding:20px 0 0 0;">${bodyHtml}</td></tr>
<tr><td style="border-top:1px solid #e5e5e5;padding-top:16px;margin-top:24px;font-size:13px;line-height:1.55;color:#666;">
<p style="margin:20px 0 10px 0;">Want the daily version? ADAS Brew delivers industry news every morning: <a href="${BREW_URL}" style="color:#CD4419;">absoluteadas.com/brew</a></p>
<p style="margin:0 0 6px 0;">${MAILING_ADDRESS}</p>
<p style="margin:0;"><a href="__VAN_UNSUB_URL__" style="color:#666;text-decoration:underline;">Unsubscribe</a></p>
</td></tr>
</table></td></tr></table></body></html>`
}

function signoff() {
  return `<p style="margin:22px 0 4px 0;">— Mark</p>
<p style="margin:0 0 24px 0;color:#666;font-size:14px;">Absolute ADAS &nbsp;|&nbsp; Lake Stevens, WA</p>`
}

// ─── Goodbye email (fires from /from-the-van/unsubscribe) ─────────────────
// "Van Is Sad" flavor per Mark's pick 2026-07-07. Light, self-aware,
// leaves the door open. No pitch. Uses a stripped-down wrapper (no
// unsubscribe link in the footer since they just unsubscribed) but keeps
// the mailing address for CAN-SPAM compliance on the transactional send.
export function buildGoodbyeEmail() {
  const subject = `You broke the van's heart`
  const preview = `A short goodbye from a mobile ADAS truck.`
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preview}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:16px;line-height:1.55;">
<tr><td style="border-top:3px solid #CD4419;padding-top:14px;">
<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#666;">From the Van &nbsp;·&nbsp; goodbye</div>
</td></tr>
<tr><td style="padding:20px 0 0 0;">
<p>Alright. You unsubscribed. That's cool. I'll break it to the van gently.</p>
<p>If it helps, the last three issues were about a Honda camera that cooked itself, a Toyota Prius with no DTCs but a lit-up dash, and a Corolla Cross that needed a coolant top-off to make the warning light shut up. You didn't miss much. Except for those. Which were pretty good.</p>
<p>If the calibration side of a job ever ruins your week, my line's below. Reply to this email and it lands in my actual inbox. Not a form. Not a bot. Me.</p>
<p>Best of luck out there. Doors open if you change your mind.</p>
${signoff()}
<p style="margin:0 0 24px 0;color:#666;font-size:14px;">1-844-FIX-ADAS &nbsp;|&nbsp; <a href="mailto:mark@absoluteadas.com" style="color:#CD4419;">mark@absoluteadas.com</a></p>
</td></tr>
<tr><td style="border-top:1px solid #e5e5e5;padding-top:16px;margin-top:24px;font-size:13px;line-height:1.55;color:#666;">
<p style="margin:20px 0 6px 0;">You've been removed from the From the Van list. This is the last email you'll get from this list.</p>
<p style="margin:0 0 6px 0;">${MAILING_ADDRESS}</p>
</td></tr>
</table></td></tr></table></body></html>`
  const text = `Alright. You unsubscribed. That's cool. I'll break it to the van gently.

If it helps, the last three issues were about a Honda camera that cooked itself, a Toyota Prius with no DTCs but a lit-up dash, and a Corolla Cross that needed a coolant top-off to make the warning light shut up. You didn't miss much. Except for those. Which were pretty good.

If the calibration side of a job ever ruins your week, my line's below. Reply to this email and it lands in my actual inbox. Not a form. Not a bot. Me.

Best of luck out there. Doors open if you change your mind.

— Mark
Absolute ADAS | Lake Stevens, WA
1-844-FIX-ADAS
mark@absoluteadas.com

You've been removed from the From the Van list. This is the last email you'll get from this list.
${MAILING_ADDRESS}
`
  return { subject, previewText: preview, html, text }
}

// ─── DAY 1 (BACKFILL) — for the 1,410 warm-list contacts Mark met earlier ─
// Voice: "I stopped by your shop a while back, business card exchange,
// this is me following up like I should have." Owns the gap.
function buildDay1Backfill(sub) {
  const name = firstName(sub)
  return {
    subject: `Following up on the business card I left with you`,
    preview: `Stopped by your shop a while back. This is me following up like I should have.`,
    html: wrap({
      preview: 'Stopped by your shop a while back. This is me following up like I should have.',
      bodyHtml: `
<p>${name} — this is Mark from Absolute ADAS.</p>
<p>Sometime in the last stretch I stopped by your shop and left a card. We may have talked about calibrations, we may not have. Either way, I stuck your info in a stack and did not follow up the way I should have. This week I'm fixing that.</p>
<p>Starting today, you're on my From the Van list. Tuesday emails only. Real field cases from mobile ADAS jobs across the region. No product pitch, no cadence traps.</p>
<p>Before Tuesday's issue lands, I want to earn 5 minutes over the next week to walk through something specific about the ADAS sublet side of your business. A math problem most shops have never run.</p>
<p>Here it is in one line: <strong>on every static calibration you sublet at $450 list, there's $67.50 of margin the industry has decided belongs to the vendor. It doesn't have to.</strong></p>
<p>I'll walk you through how that math works over the next few days. If it's not useful, the unsubscribe link at the bottom works and I won't take it personally.</p>
${signoff()}`,
    }),
    text: `${name} — this is Mark from Absolute ADAS.\n\nSometime in the last stretch I stopped by your shop and left a card. We may have talked about calibrations, we may not have. Either way, I stuck your info in a stack and did not follow up the way I should have. This week I'm fixing that.\n\nStarting today, you're on my From the Van list. Tuesday emails only. Real field cases from mobile ADAS jobs across the region. No product pitch.\n\nBefore Tuesday's issue lands, I want to earn 5 minutes over the next week to walk through something specific about the ADAS sublet side of your business. A math problem most shops have never run.\n\nOn every static calibration you sublet at $450 list, there's $67.50 of margin the industry has decided belongs to the vendor. It doesn't have to.\n\nI'll walk you through that math over the next few days. If it's not useful, the unsubscribe link works and I won't take it personally.\n\n— Mark\nAbsolute ADAS | Lake Stevens, WA`,
  }
}

// ─── DAY 1 (SIGNUP) — for future contacts Mark just met in person ────────
// Voice: "thanks for the minute at your shop today." Warm handoff from
// the in-person conversation to the email pitch.
function buildDay1Signup(sub) {
  const name = firstName(sub)
  return {
    subject: `Thanks for the minute at your shop today`,
    preview: `Following up from our conversation with the short version.`,
    html: wrap({
      preview: 'Following up from our conversation with the short version.',
      bodyHtml: `
<p>${name} — this is Mark from Absolute ADAS.</p>
<p>Appreciate you taking a minute when I stopped by. Most guys wave me off before I can even get to what I actually do, so thanks for hearing me out.</p>
<p>You're on my From the Van list now. Tuesday emails only. Real field cases from mobile ADAS jobs across the region. No product pitch, no cadence traps.</p>
<p>Before Tuesday's issue lands, I want to earn 5 more minutes over the next week to walk through something specific about the ADAS sublet side of your business. A math problem most shops have never run.</p>
<p>Here it is in one line: <strong>on every static calibration you sublet at $450 list, there's $67.50 of margin the industry has decided belongs to the vendor. It doesn't have to.</strong></p>
<p>I'll walk you through how that math works over the next few days. If it's not for you, the unsubscribe link at the bottom works and I won't take it personally.</p>
${signoff()}`,
    }),
    text: `${name} — this is Mark from Absolute ADAS.\n\nAppreciate you taking a minute when I stopped by. Most guys wave me off before I can even get to what I actually do, so thanks for hearing me out.\n\nYou're on my From the Van list now. Tuesday emails only. Real field cases from mobile ADAS jobs across the region. No product pitch.\n\nBefore Tuesday's issue lands, I want to earn 5 more minutes over the next week to walk through something specific about the ADAS sublet side of your business. A math problem most shops have never run.\n\nOn every static calibration you sublet at $450 list, there's $67.50 of margin the industry has decided belongs to the vendor. It doesn't have to.\n\nI'll walk you through that math over the next few days. If it's not for you, the unsubscribe link works and I won't take it personally.\n\n— Mark\nAbsolute ADAS | Lake Stevens, WA`,
  }
}

// Router — picks the right Day 1 variant based on subscriber cohort.
// Missing cohort (existing 1,410 records) → backfill. Explicit 'signup' → signup.
function buildDay1(sub) {
  return sub?.cohort === 'signup' ? buildDay1Signup(sub) : buildDay1Backfill(sub)
}

// ─── DAY 2 — the villain ──────────────────────────────────────────────────
function buildDay2(sub) {
  const name = firstName(sub)
  return {
    subject: `Your sublet vendor uses your bay. Charges you list. Sound right?`,
    preview: `The standard playbook, and the one word missing from it.`,
    html: wrap({
      preview: 'The standard playbook, and the one word missing from it.',
      bodyHtml: `
<p>${name} — think about the last mobile ADAS calibration at your shop.</p>
<p>A tech showed up. Used your bay. Plugged into your power. Parked in your lot. Probably borrowed a hand from one of your guys when the target frame needed leveling. Ran the cal. Handed you an invoice for full list price. Left.</p>
<p>Then you billed the customer or insurance at that same list. Zero margin on the RO. The vendor kept 100%.</p>
<p>Nobody in that transaction acknowledged that <strong>your facility is what made the mobile calibration physically possible.</strong> Not the vendor. Not the adjuster. Nobody.</p>
<p>That's the standard sublet playbook. It's not broken because the people running it are bad. It's broken because "discount" was never in the vendor script.</p>
<p>Tomorrow I'll show you what the math looks like when someone puts it back in.</p>
${signoff()}`,
    }),
    text: `${name} — think about the last mobile ADAS calibration at your shop.\n\nA tech showed up. Used your bay. Plugged into your power. Parked in your lot. Borrowed a hand from one of your guys. Ran the cal. Handed you an invoice for full list. Left.\n\nYou billed the customer or insurance at that same list. Zero margin on the RO.\n\nYour facility made the mobile calibration physically possible. Nobody acknowledged it. That's the standard sublet playbook.\n\nTomorrow I'll show you the math when someone puts "discount" back in.\n\n— Mark`,
  }
}

// ─── DAY 3 — the mechanism (Partnership Discount Model, 4 components) ─────
function buildDay3(sub) {
  return {
    subject: `The Partnership Discount Model — 4 components`,
    preview: `We come to you. We discount. You bill at list. Volume rewards you.`,
    html: wrap({
      preview: 'We come to you. We discount. You bill at list. Volume rewards you.',
      bodyHtml: `
<p>Here is how Absolute ADAS is set up differently from the vendors most shops sublet to. It has a name — the Partnership Discount Model — and four moving parts.</p>
<p><strong>1. We come to you.</strong> Same-day when scheduled, next-day standard. Your bay, your schedule, your workflow. No car transport, no cycle time hit.</p>
<p><strong>2. We discount off list automatically.</strong> Standard partner: 15% off list on every calibration. No paperwork, no rebate forms, no chasing credits. The discount is on every invoice from day one.</p>
<p><strong>3. You bill insurance at list.</strong> We are a preferred vendor with State Farm and other major carriers. Retail pricing is approved on covered claims. The gap between our invoice and your billing IS your margin.</p>
<p><strong>4. Volume rewards you more.</strong> 15+ cals/mo unlocks 20% off. 30+ unlocks 25% off plus same-day priority and free documentation packages.</p>
<p>Tomorrow, the dollar math on a static cal.</p>
${signoff()}`,
    }),
    text: `The Partnership Discount Model — 4 components:\n\n1. We come to you. Same-day when scheduled.\n2. We discount off list automatically. 15% standard, on every invoice.\n3. You bill insurance at list. Preferred vendor with State Farm.\n4. Volume rewards you more. 15+/mo = 20% off. 30+/mo = 25% off + same-day priority.\n\nTomorrow: the dollar math.\n\n— Mark`,
  }
}

// ─── DAY 4 — the math ─────────────────────────────────────────────────────
function buildDay4(sub) {
  const name = firstName(sub)
  return {
    subject: `$450 → $382.50 → $67.50 stays with your shop`,
    preview: `The math on one calibration, and what it becomes at 10, 15, 30 a month.`,
    html: wrap({
      preview: 'The math on one calibration, and what it becomes at 10, 15, 30 a month.',
      bodyHtml: `
<p>${name} — here is what the Partnership Discount Model looks like in dollars.</p>
<p><strong>One static calibration:</strong></p>
<ul style="margin:0 0 16px 20px;padding:0;">
<li>List price your shop bills insurance: $450</li>
<li>What you pay Absolute ADAS at Standard tier: $382.50</li>
<li><strong>Your margin, on that one job: $67.50</strong></li>
</ul>
<p>At your monthly volume, that math scales:</p>
<ul style="margin:0 0 16px 20px;padding:0;">
<li>10 cals/mo at 15% off list = <strong>$675/mo, $8,100/year</strong></li>
<li>15 cals/mo at 20% off list = <strong>$1,350/mo, $16,200/year</strong></li>
<li>30 cals/mo at 25% off list = <strong>$3,375/mo, $40,500/year</strong></li>
</ul>
<p>Same list price you're billing insurance today. Smaller invoice from us. The difference is money that belongs on your side of the RO.</p>
<p>Tomorrow — a real shop that pulled the trigger.</p>
${signoff()}`,
    }),
    text: `${name} — the Partnership Discount Model in dollars.\n\nOne static cal:\n- List you bill insurance: $450\n- What you pay us (Standard): $382.50\n- Your margin: $67.50\n\nAt volume:\n- 10 cals/mo at 15% off = $675/mo, $8,100/yr\n- 15 cals/mo at 20% off = $1,350/mo, $16,200/yr\n- 30 cals/mo at 25% off = $3,375/mo, $40,500/yr\n\nSame list price you're billing insurance today. The difference is yours.\n\n— Mark`,
  }
}

// ─── DAY 5 — case study (composite) ───────────────────────────────────────
function buildDay5(sub) {
  return {
    subject: `Two-bay shop in Marysville. Nine cals a month. Nobody had done the math.`,
    preview: `A short story about a State Farm DRP question and a sticky note.`,
    html: wrap({
      preview: 'A short story about a State Farm DRP question and a sticky note.',
      bodyHtml: `
<p>Jim runs a two-bay shop in Marysville. Eighteen years in. Reads DRP scorecards in his sleep.</p>
<p>Last quarter his State Farm rep called for a check-in. Cycle time, touch time, ADAS workflow. When the rep got to the ADAS question, Jim answered in one sentence. Rep moved on. No flag, no follow-up.</p>
<p>After he hung up he said, "six months ago that question made me sweat."</p>
<p>Nine cals a month, Standard tier, 15% off list automatically. That is <strong>$607.50 back per month</strong> he wasn't seeing before. $7,290 a year. On a line item that was netting zero.</p>
<p>Two more cals a month and he steps into the Volume tier at 20% off list.</p>
<p>The DRP credibility came with the documentation. The margin came with the discount. Both came from moving to a partnership vendor instead of a list-price one.</p>
<p>(Composite of three real shops in our Western Washington portfolio.)</p>
${signoff()}`,
    }),
    text: `Jim runs a two-bay shop in Marysville. Eighteen years in.\n\nHis State Farm rep called for a check-in. When the rep got to the ADAS question, Jim answered in one sentence. Rep moved on.\n\nAfter he hung up he said "six months ago that question made me sweat."\n\n9 cals/mo, Standard tier, 15% off list = $607.50/mo back. $7,290/yr on a line item that was netting zero.\n\nDRP credibility came with the documentation. Margin came with the discount.\n\n(Composite of three real shops in our Western Washington portfolio.)\n\n— Mark`,
  }
}

// ─── DAY 6 — the guarantee ────────────────────────────────────────────────
function buildDay6(sub) {
  return {
    subject: `The Absolute Partnership Guarantee`,
    preview: `On time. OEM documentation. Discount on every invoice. Or we work for free.`,
    html: wrap({
      preview: 'On time. OEM documentation. Discount on every invoice. Or we work for free.',
      bodyHtml: `
<p>Here is the promise on the partnership, in one paragraph.</p>
<p style="background:#f5f3f0;padding:18px 20px;border-left:3px solid #CD4419;font-size:15px;line-height:1.6;margin:0 0 20px 0;">
<em>If we don't deliver every calibration on time, with full OEM documentation, AND apply your partnership discount on every single invoice for your first 90 days — we work for free until we do. And we cut you a check for $500 to make it right.</em>
</p>
<p>90 days is enough time to prove all three. If we fall short on any of them, you don't have to argue. The guarantee is in writing on your first invoice.</p>
<p>Tomorrow, the next step if any of this makes sense to you.</p>
${signoff()}`,
    }),
    text: `The Absolute Partnership Guarantee:\n\nIf we don't deliver every calibration on time, with full OEM documentation, AND apply your partnership discount on every single invoice for your first 90 days — we work for free until we do. And we cut you a check for $500 to make it right.\n\n90 days to prove all three. In writing on your first invoice.\n\nTomorrow, the next step.\n\n— Mark`,
  }
}

// ─── DAY 7 — the CTA ──────────────────────────────────────────────────────
function buildDay7(sub) {
  const name = firstName(sub)
  return {
    subject: `15 minutes on your calibration workflow. That's the whole ask.`,
    preview: `The Partnership Audit — free, no commitment, one call with me.`,
    html: wrap({
      preview: 'The Partnership Audit — free, no commitment, one call with me.',
      bodyHtml: `
<p>${name} — this is the last one of these emails. Then it's just the Tuesday field cases.</p>
<p>If any of what I laid out this week makes you want to look at your own numbers, here is what happens next:</p>
<p><strong>The Partnership Audit.</strong> 15 minutes. On a call with me directly, not an SDR. We look at your last 90 days of sublet calibration spend, I show you what the same volume would have earned on the Partnership Discount Model, and you decide if that's a conversation worth continuing.</p>
<p>No commitment. No pitch deck. Just the math on your shop, in your numbers.</p>
<p><strong><a href="${AUDIT_URL}" style="color:#CD4419;">Book a 15-minute Partnership Audit →</a></strong></p>
<p>Or if you'd rather run the numbers yourself first, the calculator is at <a href="${CALCULATOR_URL}" style="color:#CD4419;">absoluteadas.com/calculator</a>.</p>
<p>Either way, thanks for reading this week. Tuesday's field case still lands like always.</p>
${signoff()}`,
    }),
    text: `${name} — last of these emails. Tuesday field cases only from here.\n\nIf any of it makes you want to look at your own numbers: the Partnership Audit. 15 minutes on a call with me. We look at your last 90 days of sublet calibration spend, I show you what the same volume would earn on the Partnership Discount Model, you decide if it's worth continuing.\n\nNo commitment. No pitch deck. Just the math on your shop.\n\nBook a 15-minute Partnership Audit: ${AUDIT_URL}\nOr run the numbers yourself: ${CALCULATOR_URL}\n\nThanks for reading.\n\n— Mark`,
  }
}

export const VAN_NURTURE_DAYS = {
  1: buildDay1, 2: buildDay2, 3: buildDay3, 4: buildDay4,
  5: buildDay5, 6: buildDay6, 7: buildDay7,
}

/**
 * Compute which day of the 7-day sequence a subscriber should receive.
 * Day 1 = day of enrollment. Day 7 = 6 days later. Returns 0 or 8+ when
 * the subscriber is outside the send window.
 */
export function vanNurtureDayFor(sub, now = Date.now()) {
  const enrolledAt = new Date(sub?.enrolled_at || 0).getTime()
  if (!Number.isFinite(enrolledAt) || enrolledAt === 0) return 0
  // Optional per-subscriber delay so a welcome email fires first before Day 1.
  // Set to 1 on new signups (source-based) so their Day 1 lands the day AFTER
  // signup, not same-day. Missing/0 on backfilled subs — unchanged cadence.
  const delayMs = Number(sub?.nurture_delay_days || 0) * 86400000
  const daysSince = Math.floor((now - enrolledAt - delayMs) / 86400000)
  return daysSince + 1
}

export function buildVanNurtureEmail(sub, day) {
  const builder = VAN_NURTURE_DAYS[day]
  return builder ? builder(sub) : null
}
