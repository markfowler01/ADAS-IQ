// From the Van weekly renderer — wraps drafter output in email-safe HTML.
//
// Style is intentionally minimal to match the Cadillac Lyriq Issue #1:
// single column, system fonts, #CD4419 accent bar only. Plain-text-looking
// emails from a real person deliver better than heavy templates.
//
// The unsubscribe URL slot is handled by Resend Broadcasts — this template
// uses `{{{RESEND_UNSUBSCRIBE_URL}}}` because weekly issues go out via the
// Resend Broadcast API (not `/emails`), where Resend does substitute the
// template variable per-recipient. Different from Magic Lantern, which uses
// per-recipient signed URLs because it sends via `/emails`.

const BREW_URL = 'https://absoluteadas.com/brew'
const MAILING_ADDRESS = '2307 Cedar Rd · Lake Stevens, WA 98258'

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Convert markdown body to email-safe HTML. Supports:
 *   - Double-newline → paragraph split
 *   - **bold** → <strong>
 *   - Inline links [text](url) → <a>
 *   - Nothing else — we want plain-looking emails.
 */
function markdownToHtml(md) {
  const paragraphs = String(md || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  return paragraphs.map(p => {
    let html = escapeHtml(p)
    // **bold**
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    // [text](url) — url is escaped by escapeHtml already, unescape ampersands
    // in the href because Resend's URL parser doesn't want &amp;
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) =>
      `<a href="${url.replace(/&amp;/g, '&')}" style="color:#CD4419;">${text}</a>`
    )
    // Single newlines inside a paragraph -> <br>
    html = html.replace(/\n/g, '<br>')
    return `<p style="margin:0 0 16px 0;">${html}</p>`
  }).join('\n')
}

/**
 * Render one weekly issue. Returns `{ subject, previewText, html, text }`
 * ready to hand to Resend's Broadcast API.
 */
export function renderWeeklyIssue({ subject, previewText, bodyMarkdown, issueNumber }) {
  const previewClean = String(previewText || '').slice(0, 140)
  const bodyHtml = markdownToHtml(bodyMarkdown)

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(previewClean)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:16px;line-height:1.55;">
<tr><td style="border-top:3px solid #CD4419;padding-top:14px;">
<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#666;">From the Van${issueNumber ? ` · Issue #${issueNumber}` : ''}</div>
</td></tr>
<tr><td style="padding:20px 0 0 0;">
${bodyHtml}
<p style="margin:22px 0 4px 0;">— Mark</p>
<p style="margin:0 0 24px 0;color:#666;font-size:14px;">Absolute ADAS &nbsp;|&nbsp; Lake Stevens, WA</p>
</td></tr>
<tr><td style="border-top:1px solid #e5e5e5;padding-top:16px;margin-top:24px;font-size:13px;line-height:1.55;color:#666;">
<p style="margin:20px 0 10px 0;">Want the daily version? ADAS Brew delivers industry news every morning: <a href="${BREW_URL}" style="color:#CD4419;">absoluteadas.com/brew</a></p>
<p style="margin:0 0 6px 0;">${MAILING_ADDRESS}</p>
<p style="margin:0;"><a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#666;text-decoration:underline;">Unsubscribe</a></p>
</td></tr>
</table></td></tr></table></body></html>`

  // Plain-text version. Strip markdown, keep it human.
  const plainBody = String(bodyMarkdown || '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
  const text = `${plainBody}

— Mark
Absolute ADAS | Lake Stevens, WA

Want the daily version? ADAS Brew delivers industry news every morning: ${BREW_URL}

${MAILING_ADDRESS}
Unsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}
`

  return { subject, previewText: previewClean, html, text }
}
