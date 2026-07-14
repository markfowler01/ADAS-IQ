// From the Van — welcome email fired instantly on subscribe.
//
// Purpose: deliver the pricing sheet they signed up for, plant the
// partnership-discount hook, and set expectation for the 7-day Magic
// Lantern series so it doesn't feel like a spam blast.
//
// Two openers, picked by `source`:
//   - "self-signup"       → shop owner filled the form themselves
//   - anything else       → Mark entered them from a business card at
//                           an in-person visit ("mark-visit", "van-visit", etc.)
//
// Voice: locked "Van Is Sad" energy from [[feedback_van_is_sad_energy]] —
// warm, wry, brief. No em dashes, no exclamations, no AI tells.
//
// Pricing sheet is a WorkDrive external share URL. Update the file in-place
// in WorkDrive (right-click → Replace) and the URL stays the same — new
// welcome emails auto-serve the new pricing.

const PRICING_SHEET_URL = 'https://workdrive.zohoexternal.com/external/6d6d1dc7e74945443f1e13536c4bf38558716c32df6ba61da2250ed8dafc39c6'
const MAILING_ADDRESS = '2307 Cedar Rd · Lake Stevens, WA 98258'

function firstName(sub) {
  const raw = String(sub?.name || sub?.firstName || '').trim().split(/\s+/)[0]
  return raw || 'there'
}

function openerFor(source) {
  // 'self-signup' → shop owner used the form themselves
  // everything else (mark-visit, van-visit, manual, etc.) → Mark entered them
  return source === 'self-signup'
    ? 'Grabbed your info off the form.'
    : 'Great meeting you today.'
}

/**
 * Build the welcome email. Returns { subject, previewText, html, text }
 * ready to hand to sendBroadcast().
 *
 * @param {Object} sub — enrollment record with { email, name, source }
 * @param {string} unsubUrl — signed per-recipient unsubscribe URL
 */
export function buildWelcomeEmail(sub, unsubUrl) {
  const name = firstName(sub)
  const opener = openerFor(sub?.source)
  const subject = `The pricing sheet you asked for (and a heads-up)`
  const previewText = `List prices attached. Partnership pricing coming this week.`

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${previewText}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:16px;line-height:1.55;">
<tr><td style="border-top:3px solid #CD4419;padding-top:14px;">
<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#666;">From the Van &nbsp;·&nbsp; welcome</div>
</td></tr>
<tr><td style="padding:20px 0 0 0;">
<p>Hey ${name},</p>
<p><strong>${opener}</strong> Pricing sheet linked below, as promised.</p>
<p>Two things worth knowing about it:</p>
<p><strong>1.</strong> Those are list prices. Paperwork always says "subject to change," but I stand behind what's on there today. If you're bidding a job this week, use these numbers.</p>
<p><strong>2.</strong> There's a discount side to this that isn't on the sheet. It's what partner shops actually pay. I'll walk through it in a short series over the next week &mdash; one email a day, each takes 90 seconds. If it's not for you, the unsubscribe link at the bottom works and I won't take it personally.</p>
<div style="margin:28px 0;text-align:center;">
<a href="${PRICING_SHEET_URL}" style="display:inline-block;background:#CD4419;color:#ffffff;font-size:16px;font-weight:600;padding:14px 28px;border-radius:8px;text-decoration:none;">Download the Pricing Sheet &rarr;</a>
</div>
<p>The van's out today. Talk soon.</p>
<p style="margin:22px 0 4px 0;">&mdash; Mark</p>
<p style="margin:0 0 24px 0;color:#666;font-size:14px;">Absolute ADAS &nbsp;|&nbsp; Lake Stevens, WA</p>
</td></tr>
<tr><td style="border-top:1px solid #e5e5e5;padding-top:16px;margin-top:24px;font-size:13px;line-height:1.55;color:#666;">
<p style="margin:20px 0 6px 0;">${MAILING_ADDRESS}</p>
<p style="margin:0;"><a href="${unsubUrl}" style="color:#666;text-decoration:underline;">Unsubscribe</a></p>
</td></tr>
</table></td></tr></table></body></html>`

  const text = `Hey ${name},

${opener} Pricing sheet linked below, as promised.

Two things worth knowing about it:

1. Those are list prices. Paperwork always says "subject to change," but I stand behind what's on there today. If you're bidding a job this week, use these numbers.

2. There's a discount side to this that isn't on the sheet. It's what partner shops actually pay. I'll walk through it in a short series over the next week — one email a day, each takes 90 seconds. If it's not for you, the unsubscribe link at the bottom works and I won't take it personally.

Download the Pricing Sheet: ${PRICING_SHEET_URL}

The van's out today. Talk soon.

— Mark
Absolute ADAS | Lake Stevens, WA

${MAILING_ADDRESS}
Unsubscribe: ${unsubUrl}
`

  return { subject, previewText, html, text }
}
