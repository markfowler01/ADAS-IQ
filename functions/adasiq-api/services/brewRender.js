// Render an ADAS Brew digest object → email-ready HTML.
// Uses a <style> block + classnames (instead of inline styles on every element)
// to keep the payload under Zoho Campaigns' ~10KB htmlcontent limit.
// Style-block CSS works in Gmail, Apple Mail, Outlook web/Mac, and most modern clients.

const ORANGE = '#CD4419'

const TAG_COLORS = {
  TSB:       { bg: '#fdeee8', fg: ORANGE },
  RECALL:    { bg: '#fee2e2', fg: '#b91c1c' },
  INSURANCE: { bg: '#fef3c7', fg: '#92400e' },
  OEM:       { bg: '#dbeafe', fg: '#1e40af' },
  INDUSTRY:  { bg: '#e5e7eb', fg: '#374151' },
  TRAINING:  { bg: '#dcfce7', fg: '#166534' },
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeUrl(u) {
  const s = String(u || '').trim()
  if (!s) return '#'
  if (!/^https?:\/\//i.test(s)) return '#'
  return esc(s)
}

function tagSpan(tag) {
  const t = String(tag || 'INDUSTRY').toUpperCase()
  const c = TAG_COLORS[t] || TAG_COLORS.INDUSTRY
  return `<span class="tag" style="background:${c.bg};color:${c.fg}">${esc(t)}</span>`
}

function renderStory(s, idx) {
  return `<div class="story"><div class="tagrow">${tagSpan(s.tag)}</div><h2><span class="num">${idx}.</span> ${esc(s.headline)}</h2><p>${esc(s.body)}</p><p class="src">Source: <a href="${safeUrl(s.source_url)}">${esc(s.source_label || 'Read more')} →</a></p></div>`
}

const STYLES = `body{margin:0;padding:0;background:#f5f3f0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a}
.wrap{max-width:640px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);margin-top:32px;margin-bottom:32px}
.head{padding:28px 28px 16px;border-bottom:3px solid ${ORANGE}}
.brand{font-family:monospace;font-size:11px;font-weight:700;letter-spacing:.16em;color:${ORANGE};text-transform:uppercase}
.slogan{font-size:14px;color:#6b7280;font-style:italic;margin:6px 0 14px;line-height:1.4}
.h1{font-size:30px;font-weight:800;line-height:1.1;margin:4px 0 0}
.date{font-family:monospace;font-size:12px;color:#6b7280;margin-top:6px}
.intro{padding:24px 28px 0;font-size:16px;line-height:1.55}
.story{padding:24px 28px 0;border-bottom:1px solid #ececec}
.story:last-of-type{border-bottom:0}
.tagrow{margin-bottom:8px}
.tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;padding:3px 8px;border-radius:999px;text-transform:uppercase;font-family:monospace}
h2{font-size:20px;line-height:1.3;font-weight:700;margin:0 0 8px}
.num{color:${ORANGE};font-weight:800}
p{font-size:15px;line-height:1.55;margin:0 0 10px}
.src{font-size:13px;color:#6b7280;margin:0}
.src a{color:${ORANGE};font-weight:600;text-decoration:none}
.cta{margin:32px 28px 8px;background:#fff7f3;border:1.5px solid ${ORANGE};border-radius:12px;padding:20px 22px}
.cta p{margin:0 0 14px}
.btn{display:inline-block;background:${ORANGE};color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:11px 22px;border-radius:8px}
.byline{padding:32px 28px 8px;font-size:13px;line-height:1.55;color:#6b7280;font-style:italic;margin:0}
.foot{padding:24px 28px 28px;border-top:1px solid #ececec;font-size:12px;color:#6b7280}
.foot a{color:#6b7280}`.replace(/\s*\n\s*/g, '')

/**
 * Render a digest to HTML.
 * @param {Object} digest — output of assembleDigest()
 * @param {Object} opts — { issueNumber, dateISO, unsubscribeUrl }
 * @returns {{ subject: string, preview_text: string, html: string, text: string }}
 */
export function renderDigest(digest, opts = {}) {
  const issueNumber    = opts.issueNumber || ''
  const dateISO        = opts.dateISO || new Date().toISOString().slice(0, 10)
  const dateLabel      = new Date(dateISO).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const unsubscribeUrl = opts.unsubscribeUrl || 'https://absoluteadas.com/unsubscribe'

  const subject      = digest.subject || 'ADAS Brew — Today\'s top stories'
  const previewText  = digest.preview_text || ''
  const tagline      = digest.tagline || 'Today\'s brew'
  const intro        = digest.intro || ''
  const stories      = Array.isArray(digest.stories) ? digest.stories : []
  // Pin CTA destination to one of a small allowlist — prevents AI from inventing
  // URLs but lets Friday Field Notes mode point at Mark's LinkedIn for the
  // "DM me 'audit'" CTA.
  const ALLOWED_CTA_URLS = [
    'https://absoluteadas.com/',
    'https://absoluteadas.com',
    'https://absoluteadas.com/brew',
    'https://absoluteadas.com/audit',
    'https://www.linkedin.com/in/mark-fowler-764611a7',
    'https://linkedin.com/in/mark-fowler-764611a7',
  ]
  const wantedUrl = digest.cta?.button_url || ''
  const cta = {
    text: digest.cta?.text || 'See how ADAS IQ helps shops run faster, get paid quicker, and stop losing supplements.',
    button_text: digest.cta?.button_text || 'Explore ADAS IQ',
    button_url: ALLOWED_CTA_URLS.includes(wantedUrl) ? wantedUrl : 'https://absoluteadas.com/',
  }

  const storiesHtml = stories.map((s, i) => renderStory(s, i + 1)).join('')

  // Pre-built share links for the forward block — mailto opens a new email
  // with subject + issue link pre-filled, X / LinkedIn share with the issue URL.
  const issueUrl = `https://absoluteadas.com/brew/issues/${encodeURIComponent(issueNumber)}`
  const shareSubject = encodeURIComponent(`Read this ADAS Brew issue: ${subject}`)
  const shareBody = encodeURIComponent(`Saw this and thought of you — calibration / collision intel for body shops.\n\n${subject}\n${issueUrl}\n\nSubscribe free: https://absoluteadas.com/brew`)
  const mailtoUrl = `mailto:?subject=${shareSubject}&body=${shareBody}`
  const liShareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(issueUrl)}`
  const fbShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(issueUrl)}`
  const xShareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(subject)}&url=${encodeURIComponent(issueUrl)}`

  const forwardBlock = `<div style="margin:28px 0 18px;padding:18px 20px;background:#fff8f4;border-left:3px solid #CD4419;border-radius:8px"><p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#CD4419;letter-spacing:.02em">📤 Know a shop that should read this?</p><p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#374151">One forward could save them three hours of denial fights this month.</p><div style="font-size:13px"><a href="${mailtoUrl}" style="display:inline-block;margin:0 8px 4px 0;padding:7px 13px;background:#CD4419;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Forward by email</a><a href="${liShareUrl}" style="display:inline-block;margin:0 8px 4px 0;padding:7px 13px;background:#0a66c2;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">LinkedIn</a><a href="${fbShareUrl}" style="display:inline-block;margin:0 8px 4px 0;padding:7px 13px;background:#1877f2;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Facebook</a><a href="${xShareUrl}" style="display:inline-block;margin:0 8px 4px 0;padding:7px 13px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">X</a></div></div>`

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title><style>${STYLES}</style></head><body><span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0">${esc(previewText)}</span><div class="wrap"><div class="head"><div class="brand">ADAS Brew</div><div class="slogan">Grab a cup of coffee and get caught up on all things calibration and body shop.</div><div class="h1">${esc(tagline)}</div><div class="date">${esc(dateLabel)}${issueNumber ? ` · #${esc(issueNumber)}` : ''}</div></div>${intro ? `<div class="intro"><p>${esc(intro)}</p></div>` : ''}${storiesHtml}<div class="cta"><p>${esc(cta.text || '')}</p><a class="btn" href="${safeUrl(cta.button_url)}">${esc(cta.button_text || 'Learn more')} →</a></div>${forwardBlock}<p class="byline">From Absolute ADAS — mobile ADAS calibration in Western Washington. Mark Fowler, owner. We also build ADAS IQ, the software we run our shop on.</p><div class="foot">ADAS Brew · brew@adas-iq.com<br><a href="${safeUrl(unsubscribeUrl)}">Unsubscribe</a></div></div></body></html>`

  // Plain-text alternative
  const text = [
    `ADAS BREW — ${dateLabel}${issueNumber ? ` · Issue #${issueNumber}` : ''}`,
    '',
    intro,
    '',
    ...stories.map((s, i) => [
      `${i + 1}. [${s.tag || 'INDUSTRY'}] ${s.headline}`,
      s.body,
      `Source: ${s.source_label} — ${s.source_url}`,
      '',
    ].join('\n')),
    '---',
    cta.text || '',
    cta.button_url ? `→ ${cta.button_url}` : '',
    '',
    'From Absolute ADAS — mobile ADAS calibration, Western Washington. Mark Fowler, owner. We also build ADAS IQ.',
    `Unsubscribe: ${unsubscribeUrl}`,
  ].filter(Boolean).join('\n')

  return { subject, preview_text: previewText, html, text }
}

/**
 * Render a digest to a LinkedIn-Newsletter-ready text block.
 * Plain text, no HTML, formatted for LinkedIn's editor — short paragraphs,
 * emoji-light, hashtags at the end. Built to be copy-pasted directly into
 * LinkedIn's Newsletter editor.
 *
 * @param {Object} digest — output of assembleDigest()
 * @returns {{ headline: string, body: string }}
 */
export function renderLinkedIn(digest) {
  const subject = String(digest.subject || 'ADAS Brew').replace(/^ADAS Brew\s*[—–-]\s*/i, '')
  const tagline = digest.tagline || ''
  const intro   = digest.intro || ''
  const stories = Array.isArray(digest.stories) ? digest.stories : []
  const cta     = digest.cta || {}

  // LinkedIn Newsletter title (used as the issue's headline at top of editor)
  const headline = `${tagline || subject}`.slice(0, 120)

  const lines = []
  lines.push(`☕ Grab a cup of coffee and get caught up on all things calibration and body shop.`)
  lines.push('')
  if (intro) {
    lines.push(intro)
    lines.push('')
  }
  lines.push('━━━━━━━━━━━━━━━━━')
  lines.push('')

  stories.forEach((s, i) => {
    const tag = String(s.tag || 'INDUSTRY').toUpperCase()
    lines.push(`${i + 1}. ${s.headline}`)
    lines.push(`[${tag}]`)
    lines.push('')
    lines.push(s.body)
    lines.push('')
    if (s.source_url) lines.push(`→ ${s.source_label || 'Read'}: ${s.source_url}`)
    lines.push('')
    lines.push('━━━━━━━━━━━━━━━━━')
    lines.push('')
  })

  if (cta.text) {
    lines.push(cta.text)
    lines.push('')
  }
  if (cta.button_url) {
    lines.push(`👉 ${cta.button_text || 'Learn more'}: ${cta.button_url}`)
    lines.push('')
  }

  lines.push('━━━━━━━━━━━━━━━━━')
  lines.push('')
  lines.push(`From Absolute ADAS — mobile ADAS calibration, Western Washington. Mark Fowler, owner. We also build ADAS IQ.`)
  lines.push('')
  lines.push('#ADAS #CollisionRepair #ADASCalibration #BodyShop #AutomotiveIndustry #InsuranceClaims #VehicleSafety #AutoRepair')

  return { headline, body: lines.join('\n').trim() }
}

