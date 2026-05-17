// Render an ADAS Brew digest object → email-ready HTML.
// Uses a <style> block + classnames (instead of inline styles on every element)
// to keep the payload under Zoho Campaigns' ~10KB htmlcontent limit.
// Style-block CSS works in Gmail, Apple Mail, Outlook web/Mac, and most modern clients.

import { stripEmDashes } from './textSanitize.js'

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
  const takeBlock = s.mark_take
    ? `<p class="mtake"><span class="mtake-label">Mark says:</span> ${esc(stripEmDashes(s.mark_take))}</p>`
    : ''
  return `<div class="story"><div class="tagrow">${tagSpan(s.tag)}</div><h2><span class="num">${idx}.</span> ${esc(s.headline)}</h2><p>${esc(s.body)}</p>${takeBlock}<p class="src">Source: <a href="${safeUrl(s.source_url)}">${esc(s.source_label || 'Read more')} →</a></p></div>`
}

const STYLES = `body{margin:0;padding:0;background:#f5f3f0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a}
.wrap{max-width:640px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);margin-top:32px;margin-bottom:32px}
.head{padding:28px 28px 16px;border-bottom:3px solid ${ORANGE}}
.brand{font-family:monospace;font-size:11px;font-weight:700;letter-spacing:.16em;color:${ORANGE};text-transform:uppercase}
.slogan{font-size:14px;color:#6b7280;font-style:italic;margin:6px 0 14px;line-height:1.4}
.h1{font-size:30px;font-weight:800;line-height:1.1;margin:4px 0 0}
.date{font-family:monospace;font-size:12px;color:#6b7280;margin-top:6px}
.markets{margin:20px 28px 0;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;background:#fafafa}
.mh{font-family:monospace;font-size:11px;font-weight:700;letter-spacing:.16em;color:#2563eb;text-transform:uppercase;margin-bottom:10px}
.mt{width:100%;border-collapse:collapse;font-size:13px}
.mt td{padding:8px 0;border-bottom:1px solid #ececec;vertical-align:middle}
.mt tr:last-child td{border-bottom:none}
.ma{width:18px;text-align:center;font-size:14px;font-weight:700}
.ma.up{color:#16a34a}
.ma.down{color:#dc2626}
.mn{padding-left:6px}
.mn a{font-weight:700;color:#1a1a1a;text-decoration:none}
.mn a:hover{color:${ORANGE}}
.mp{text-align:right;color:#1a1a1a;padding-right:10px;font-variant-numeric:tabular-nums}
.mc{text-align:right;font-weight:700;font-size:12px;white-space:nowrap;padding-right:6px}
.mc span{padding:3px 8px;border-radius:6px;display:inline-block;font-variant-numeric:tabular-nums}
.mc.up span{background:#dcfce7;color:#166534}
.mc.down span{background:#fee2e2;color:#b91c1c}
.my{text-align:right;font-weight:600;font-size:11px;white-space:nowrap;color:#6b7280;font-variant-numeric:tabular-nums}
.my.up{color:#16a34a}
.my.down{color:#dc2626}
.mco{margin-top:10px;padding-top:8px;border-top:1px solid #ececec;font-size:13px;font-style:italic;color:#374151;line-height:1.45}
.mf{font-size:11px;color:#9ca3af;margin-top:6px;text-align:right}
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
.mtake{margin:10px 0 8px;padding:10px 14px;background:#fff7f3;border-left:3px solid ${ORANGE};border-radius:6px;font-size:14px;line-height:1.5;color:#1a1a1a;font-style:italic}
.mtake-label{color:${ORANGE};font-weight:800;font-style:normal;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-right:6px}
.cta{margin:32px 28px 8px;background:#fff7f3;border:1.5px solid ${ORANGE};border-radius:12px;padding:20px 22px}
.cta p{margin:0 0 14px}
.btn{display:inline-block;background:${ORANGE};color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:11px 22px;border-radius:8px}
.readtime{font-size:11px;color:#9ca3af;font-family:monospace;letter-spacing:.04em;margin-top:4px}
.audio{margin:20px 28px 0;padding:18px 22px;background:linear-gradient(135deg,#1a1208 0%,#0d0d0d 100%);border:1px solid rgba(205,68,25,.4);border-radius:12px;color:#e5e7eb}
.audio-eyebrow{font-family:monospace;font-size:11px;font-weight:700;letter-spacing:.18em;color:${ORANGE};text-transform:uppercase;margin-bottom:8px}
.audio-title{font-size:16px;font-weight:700;color:#fff;margin-bottom:10px;line-height:1.3}
.audio-player{width:100%;border-radius:6px}
.audio-fallback{font-size:13px;color:#fbbf24;margin-top:10px}
.audio-fallback a{color:#fbbf24;font-weight:700;text-decoration:underline}
.greet{padding:20px 28px 0;font-size:16px;font-weight:600;color:#1a1a1a}
.reply{margin:20px 28px 8px;padding:14px 18px;background:#fff8f4;border-left:3px solid ${ORANGE};border-radius:8px;font-size:14px;line-height:1.5;color:#374151}
.reply strong{color:${ORANGE}}
.tomorrow{margin:18px 28px 0;padding:12px 16px;background:#0f172a;color:#e5e7eb;border-radius:8px;font-size:13px;line-height:1.5;font-style:italic}
.tomorrow strong{color:#fbbf24}
.byline{padding:32px 28px 8px;font-size:13px;line-height:1.55;color:#6b7280;font-style:italic;margin:0}
.foot{padding:24px 28px 28px;border-top:1px solid #ececec;font-size:12px;color:#6b7280}
.foot a{color:#6b7280}`.replace(/\s*\n\s*/g, '')

// Estimate reading time at ~200 wpm. Round up, min 1.
function estimateReadingMin(intro, stories, commentary) {
  const text = [intro || '', commentary || '', ...(stories || []).map(s => `${s.headline || ''} ${s.body || ''}`)].join(' ')
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

function fmtPrice(n) {
  if (!Number.isFinite(n)) return '—'
  // 4-digit indices like 26,635 → no decimals; <100 → 2 decimals
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return n.toFixed(2)
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

function renderMarketsBlock(stocks, commentary) {
  if (!stocks || stocks.length === 0) return ''
  const rows = stocks.map(s => {
    const dir = s.direction || (s.changeAbs >= 0 ? 'up' : 'down')
    const arrow = dir === 'up' ? '▲' : '▼'
    const url = s.url || `https://finance.yahoo.com/quote/${encodeURIComponent(s.symbol)}`
    const ytdDir = Number.isFinite(s.ytdPct) ? (s.ytdPct >= 0 ? 'up' : 'down') : ''
    const ytdCell = Number.isFinite(s.ytdPct)
      ? `<td class="my ${ytdDir}">YTD ${esc(fmtPct(s.ytdPct))}</td>`
      : `<td class="my"></td>`
    return `<tr><td class="ma ${dir}">${arrow}</td><td class="mn"><a href="${url}" target="_blank" rel="noopener">${esc(s.name)}</a></td><td class="mp">$${fmtPrice(s.price)}</td><td class="mc ${dir}"><span>${esc(fmtPct(s.changePct))}</span></td>${ytdCell}</tr>`
  }).join('')
  const commentaryBlock = commentary
    ? `<div class="mco">${esc(commentary)}</div>`
    : ''
  return `<div class="markets"><div class="mh">Markets</div><table class="mt">${rows}</table>${commentaryBlock}<div class="mf">Data via Yahoo Finance</div></div>`
}

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

  // Sanitize all Claude-generated text fields — strip em dashes that slip past
  // the system-prompt rule (Claude occasionally uses them despite instructions).
  const subject      = stripEmDashes(digest.subject || 'ADAS Brew - today\'s top stories')
  const previewText  = stripEmDashes(digest.preview_text || '')
  const tagline      = stripEmDashes(digest.tagline || 'Today\'s brew')
  const intro        = stripEmDashes(digest.intro || '')
  const rawStories   = Array.isArray(digest.stories) ? digest.stories : []
  const stories      = rawStories.map(s => ({
    ...s,
    headline: stripEmDashes(s.headline),
    body: stripEmDashes(s.body),
  }))
  const stocks            = Array.isArray(opts.stocks) ? opts.stocks : []
  const marketsCommentary = String(opts.marketsCommentary || '')
  const marketsHtml       = renderMarketsBlock(stocks, marketsCommentary)
  const replyPrompt       = String(opts.replyPrompt || '')
  const tomorrowStinger   = String(opts.tomorrowStinger || '')
  const audioUrl          = String(opts.audioUrl || '')
  const readMin           = estimateReadingMin(intro, stories, marketsCommentary)
  // Per-recipient personalization marker — sendBroadcast does .replace per email.
  // Falls back to "Good morning." with no name if substitution didn't happen.
  const greetingHtml = `<div class="greet">Good morning, {{firstName}}.</div>`

  // Audio block (Friday voice memo) — only renders if voiceMemo service published
  // an MP3. Native <audio> tag for clients that support it (Apple Mail, modern
  // webmail) + a "Listen on the web" link for clients that strip it (Gmail, Outlook).
  const audioHtml = audioUrl
    ? `<div class="audio"><div class="audio-eyebrow">🎙️ Mark's Voice Memo</div><div class="audio-title">60 seconds on this week's biggest signal</div><audio class="audio-player" controls preload="none"><source src="${safeUrl(audioUrl)}" type="audio/mpeg"></audio><div class="audio-fallback">Inbox player not showing? <a href="${safeUrl(audioUrl)}">Listen on the web →</a></div></div>`
    : ''
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
    text: digest.cta?.text || 'Got a denied calibration on your desk? Reply with the carrier, the procedure, and what they said — I\'ll write you the OEM-cited rebuttal in 60 seconds. Free.',
    button_text: digest.cta?.button_text || 'Get a free audit →',
    button_url: ALLOWED_CTA_URLS.includes(wantedUrl) ? wantedUrl : 'https://absoluteadas.com/',
  }

  const storiesHtml = stories.map((s, i) => renderStory(s, i + 1)).join('')

  // Pre-built share links for the forward block — mailto opens a new email
  // with subject + issue link pre-filled, X / LinkedIn share with the issue URL.
  const issueUrl = `https://absoluteadas.com/brew/issues/${encodeURIComponent(issueNumber)}`
  const shareSubject = encodeURIComponent(`Read this ADAS Brew issue: ${subject}`)
  const shareBody = encodeURIComponent(`Saw this and thought of you. Calibration and collision intel for body shops.\n\n${subject}\n${issueUrl}\n\nSubscribe free: https://absoluteadas.com/brew`)
  const mailtoUrl = `mailto:?subject=${shareSubject}&body=${shareBody}`
  const liShareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(issueUrl)}`
  const fbShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(issueUrl)}`
  const xShareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(subject)}&url=${encodeURIComponent(issueUrl)}`

  const forwardBlock = `<div style="margin:28px 0 18px;padding:18px 20px;background:#fff8f4;border-left:3px solid #CD4419;border-radius:8px"><p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#CD4419;letter-spacing:.02em">📤 Know a shop that should read this?</p><p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#374151">One forward could save them three hours of denial fights this month.</p><div style="font-size:13px"><a href="${mailtoUrl}" style="display:inline-block;margin:0 8px 4px 0;padding:7px 13px;background:#CD4419;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Forward by email</a><a href="${liShareUrl}" style="display:inline-block;margin:0 8px 4px 0;padding:7px 13px;background:#0a66c2;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">LinkedIn</a><a href="${fbShareUrl}" style="display:inline-block;margin:0 8px 4px 0;padding:7px 13px;background:#1877f2;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Facebook</a><a href="${xShareUrl}" style="display:inline-block;margin:0 8px 4px 0;padding:7px 13px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">X</a></div></div>`

  const replyBlock = replyPrompt
    ? `<div class="reply"><strong>📬 Hit reply.</strong> ${esc(replyPrompt)}</div>`
    : ''
  const tomorrowBlock = tomorrowStinger
    ? `<div class="tomorrow"><strong>👀 ${esc(tomorrowStinger)}</strong></div>`
    : ''

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title><style>${STYLES}</style></head><body><span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0">${esc(previewText)}</span><div class="wrap"><div class="head"><div class="brand">ADAS Brew</div><div class="slogan">Grab a cup of coffee and get caught up on all things calibration and body shop.</div><div class="h1">${esc(tagline)}</div><div class="date">${esc(dateLabel)}${issueNumber ? ` · #${esc(issueNumber)}` : ''}</div><div class="readtime">~${readMin} min read</div></div>${audioHtml}${marketsHtml}${greetingHtml}${intro ? `<div class="intro"><p>${esc(intro)}</p></div>` : ''}${storiesHtml}<div class="cta"><p>${esc(cta.text || '')}</p><a class="btn" href="${safeUrl(cta.button_url)}">${esc(cta.button_text || 'Learn more')} →</a></div>${replyBlock}${forwardBlock}<p class="byline">Published by Absolute ADAS. Mark Fowler, owner. Mobile ADAS calibration in Western Washington. 50,000+ calibrations on the floor.</p>${tomorrowBlock}<div class="foot">ADAS Brew · brew@absoluteadas.com<br><a href="${safeUrl(unsubscribeUrl)}">Unsubscribe</a></div></div></body></html>`

  // Plain-text alternative
  const stocksText = stocks.length
    ? [
        'MARKETS',
        ...stocks.map(s => {
          const dir = (s.changeAbs >= 0 ? '▲' : '▼')
          return `${dir} ${s.name.padEnd(12)} $${fmtPrice(s.price)}   ${fmtPct(s.changePct)}`
        }),
        '(Data via Yahoo Finance)',
        '',
      ].join('\n')
    : ''
  const text = [
    `ADAS BREW — ${dateLabel}${issueNumber ? ` · Issue #${issueNumber}` : ''} · ~${readMin} min read`,
    '',
    stocksText,
    `Good morning, {{firstName}}.`,
    '',
    intro,
    '',
    ...stories.map((s, i) => [
      `${i + 1}. [${s.tag || 'INDUSTRY'}] ${s.headline}`,
      s.body,
      s.mark_take ? `Mark says: ${stripEmDashes(s.mark_take)}` : '',
      `Source: ${s.source_label}: ${s.source_url}`,
      '',
    ].filter(Boolean).join('\n')),
    '---',
    cta.text || '',
    cta.button_url ? `→ ${cta.button_url}` : '',
    '',
    replyPrompt ? `📬 Hit reply. ${replyPrompt}` : '',
    '',
    'Published by Absolute ADAS. Mark Fowler, owner — mobile ADAS calibration, Western Washington. 50,000+ calibrations on the floor.',
    '',
    tomorrowStinger ? `👀 ${tomorrowStinger}` : '',
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
  lines.push(`Published by Absolute ADAS. Mark Fowler, owner — mobile ADAS calibration, Western Washington. 50,000+ calibrations on the floor.`)
  lines.push('')
  lines.push('#ADAS #CollisionRepair #ADASCalibration #BodyShop #AutomotiveIndustry #InsuranceClaims #VehicleSafety #AutoRepair')

  return { headline, body: lines.join('\n').trim() }
}

