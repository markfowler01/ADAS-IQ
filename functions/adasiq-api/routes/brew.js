// ADAS Brew — daily/weekly industry digest pipeline.
//
//   POST /api/brew/preview      — assemble + render but do not send (auth-required)
//   POST /api/cron/brew/fetch   — fetch from sources, cache items (cron secret)
//   POST /api/cron/brew/send    — assemble + render + send via Zoho Campaigns (cron secret)
//   POST /api/cron/brew/run     — fetch + send in one call (cron secret)
//
// Cron secret env: BREW_CRON_SECRET. Header: X_CRON_SECRET (or x-cron-secret).

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { fetchAllSources, recentItems } from '../services/brewSources.js'
import { assembleDigest } from '../services/brewAssembly.js'
import { renderDigest, renderLinkedIn } from '../services/brewRender.js'
import { sendCampaign, campaignsConfigured } from '../services/brewCampaigns.js'
import { sendBroadcast, resendConfigured } from '../services/brewResend.js'
import { postToLinkedIn, digestToLinkedInPost, linkedInConfigured, commentOnLinkedInPost } from '../services/brewLinkedIn.js'
import { syncNewsletterSubscriberToCrm } from '../services/zohoCrm.js'
import { commitFile, commitBinaryFile, deleteFile, wrapIssueHtmlForArchive, renderArchiveIndex, githubConfigured } from '../services/brewArchive.js'
import { postToCliqUser, postToCliqChannel, TECH_CLIQ_IDS } from '../services/cliq.js'
import { generateCoverImage, nanoBananaConfigured } from '../services/nanoBanana.js'
import { postToFacebookPage, postToInstagram, facebookConfigured, instagramConfigured } from '../services/metaPosting.js'

const router = express.Router()

// ─── Cache helpers ──────────────────────────────────────────────────────────
function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}
function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}
async function cacheSet(segment, key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  try { await segment.update(key, str) }
  catch { await segment.put(key, str) }
}
async function cacheGet(segment, key, fallback = null) {
  try {
    const val = await segment.getValue(key)
    return val ? JSON.parse(val) : fallback
  } catch (e) {
    if (isNotFound(e)) return fallback
    throw e
  }
}

// ─── Cron auth ──────────────────────────────────────────────────────────────
// Aggressive normalization — strips any non-alphanumeric chars from both ends
// (whitespace, quotes, parens, newlines, trailing pasted junk).
function normalizeSecret(s) {
  return String(s || '').replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
}

export function requireCronSecret(req, res, next) {
  const cronSecret = normalizeSecret(process.env.BREW_CRON_SECRET)
  const provided = normalizeSecret(req.headers['x_cron_secret'] || req.headers['x-cron-secret'] || '')
  if (cronSecret && provided !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// ─── Issue numbering ────────────────────────────────────────────────────────
async function nextIssueNumber(segment) {
  const meta = (await cacheGet(segment, 'brew_meta', {})) || {}
  const next = (Number(meta.last_issue_number) || 0) + 1
  return next
}
async function recordIssueSent(segment, issueNumber, info) {
  const meta = (await cacheGet(segment, 'brew_meta', {})) || {}
  meta.last_issue_number = issueNumber
  meta.last_sent_at = new Date().toISOString()
  meta.last_info = info
  await cacheSet(segment, 'brew_meta', meta)
}

// ─── Pipeline ───────────────────────────────────────────────────────────────
// Trim each item to keep the cached blob under Catalyst's per-value size cap.
function trimItem(it) {
  return {
    title: String(it.title || '').slice(0, 160),
    link: String(it.link || '').slice(0, 200),
    pubDate: it.pubDate || null,
    summary: String(it.summary || '').slice(0, 180),
    source: String(it.source || '').slice(0, 40),
  }
}

// Drop the verbose `label`/`error` strings from status before caching — they
// can balloon if a feed returns a long error message. Status is only used for
// diagnostics in the /run response, which is returned directly from runFetch.
function trimStatusForCache(status) {
  return (status || []).map(s => ({ id: s.id, ok: !!s.ok, count: s.count || 0 }))
}

// Pure fetch + sort + trim. No cache I/O. Used by /run so the daily cron path
// never touches Catalyst Cache (which has a tight per-value cap).
async function fetchAndTrim() {
  const { items, status } = await fetchAllSources()
  const sorted = items.slice().sort((a, b) => {
    const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0
    const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0
    return tb - ta
  })
  // Keep top 35 — covers Mon's 96h lookback comfortably.
  const slim = sorted.slice(0, 35).map(trimItem)
  return { items: slim, status, fetched: items.length, kept: slim.length }
}

// Writes the cache for /fetch + /preview reuse. /run no longer calls this.
async function runFetch(req) {
  const { items, status, fetched, kept } = await fetchAndTrim()
  const segment = getSegment(req)
  await cacheSet(segment, 'brew_feed_items', {
    fetched_at: new Date().toISOString(),
    items,
    status: trimStatusForCache(status),
  })
  return { fetched, kept, sources: status, items }
}

async function buildIssue(req, preFetched = null) {
  const segment = getSegment(req)
  let items, sourceStatus
  if (preFetched?.items?.length) {
    items = preFetched.items
    sourceStatus = preFetched.status
  } else {
    const cached = await cacheGet(segment, 'brew_feed_items', null)
    if (cached?.items?.length && (Date.now() - new Date(cached.fetched_at).getTime() < 12 * 60 * 60 * 1000)) {
      items = cached.items
      sourceStatus = cached.status
    } else {
      const fresh = await fetchAndTrim()
      items = fresh.items
      sourceStatus = fresh.status
    }
  }

  // Monday issues need to look back through Friday's news (weekend cycle is dead).
  // Other days use the standard 48-hour window.
  const dayPT = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
  const recencyHours = dayPT === 'Mon' ? 96 : 48
  const recent = recentItems(items, recencyHours)
  // Feed past subject-line performance to the AI so it learns what works
  const subjectHistory = await getSettledPerformance(req, 24, 10).catch(() => [])
  // Friday gets a different mode — Field Notes + direct CTA, not news digest.
  // Override via ?mode=friday for previewing on any day.
  const todayPT = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
  const overrideMode = req.query?.mode
  const mode = overrideMode === 'friday' ? 'friday' : (todayPT === 'Fri' ? 'friday' : 'standard')
  const digest = await assembleDigest(recent, subjectHistory, { mode })
  const issueNumber = await nextIssueNumber(segment)
  const rendered = renderDigest(digest, {
    issueNumber: String(issueNumber),
    dateISO: new Date().toISOString().slice(0, 10),
  })
  return { digest, rendered, issueNumber, sourceStatus, itemsConsidered: recent.length }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// Auth-required preview — runs the whole pipeline, returns rendered HTML, does NOT send.
// Visit in browser (logged in) for a quick visual check.
router.get('/preview', async (req, res) => {
  try {
    const built = await buildIssue(req)
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(built.rendered.html)
  } catch (e) {
    console.error('[brew preview]', e.message, e.stack)
    res.status(500).type('text/plain').send(`Preview failed: ${e.message}`)
  }
})

// LinkedIn-ready preview — plain text formatted for LinkedIn Newsletter editor.
// Open in browser → select all → copy → paste into LinkedIn.
router.get('/linkedin-preview', async (req, res) => {
  try {
    const built = await buildIssue(req)
    const li = renderLinkedIn(built.digest)
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>ADAS Brew — LinkedIn version</title><style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:680px;margin:24px auto;padding:0 16px;color:#1a1a1a}h1{font-size:22px;margin-bottom:4px}h2{font-size:14px;color:#6b7280;margin:0 0 16px;font-weight:500}textarea{width:100%;min-height:520px;padding:14px;border:1px solid #e5e7eb;border-radius:10px;font-family:'IBM Plex Mono',monospace;font-size:13px;line-height:1.5;color:#1a1a1a}.btn{display:inline-block;background:#CD4419;color:#fff;font-weight:700;padding:10px 18px;border-radius:8px;border:none;cursor:pointer;margin:12px 0}.note{background:#fff7f3;border:1px solid #f5cfc3;padding:10px 14px;border-radius:8px;font-size:13px;color:#7a2b0e;margin-bottom:16px}</style></head><body><h1>ADAS Brew — LinkedIn copy</h1><h2>Issue #${built.issueNumber} · headline: <strong>${li.headline}</strong></h2><div class="note">Click the body, hit Cmd+A then Cmd+C, paste into LinkedIn Newsletter editor. Headline goes in the title field. Hashtags are at the bottom.</div><textarea id="t" readonly>${li.body.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</textarea><button class="btn" onclick="document.getElementById('t').select();document.execCommand('copy');this.textContent='Copied!'">Copy body to clipboard</button></body></html>`)
  } catch (e) {
    console.error('[brew linkedin-preview]', e.message)
    res.status(500).type('text/plain').send(`Preview failed: ${e.message}`)
  }
})

// Preview the AI-generated LinkedIn post WITHOUT actually posting to LinkedIn.
router.get('/linkedin-post-preview', async (req, res) => {
  try {
    const built = await buildIssue(req)
    const postText = await digestToLinkedInPost(built.digest)
    res.set('Content-Type', 'text/plain; charset=utf-8')
    res.send(`====================\nLinkedIn post preview — Issue #${built.issueNumber}\n${postText.length} chars\n====================\n\n${postText}\n\n====================\nNot actually posted to LinkedIn. To post, hit /api/cron/brew/run?force=1.`)
  } catch (e) {
    console.error('[brew linkedin-preview]', e.message, e.stack)
    res.status(500).type('text/plain').send(`Preview failed: ${e.message}`)
  }
})

// JSON variant of preview — useful for debugging the digest object itself.
router.get('/preview.json', async (req, res) => {
  try {
    const built = await buildIssue(req)
    res.json({
      issueNumber: built.issueNumber,
      itemsConsidered: built.itemsConsidered,
      sourceStatus: built.sourceStatus,
      digest: built.digest,
      subject: built.rendered.subject,
      preview_text: built.rendered.preview_text,
      campaignsConfigured: campaignsConfigured(),
    })
  } catch (e) {
    console.error('[brew preview.json]', e.message, e.stack)
    res.status(500).json({ error: e.message })
  }
})

export default router

// ─── Cron-protected handlers (mounted in index.js outside requireAuth) ─────

export const cronRouter = express.Router()

// Permissive secret check for the public preview — accepts secret via header
// OR ?secret= query param so it can be opened directly in a browser.
function requireCronSecretFlex(req, res, next) {
  const cronSecret = normalizeSecret(process.env.BREW_CRON_SECRET)
  const provided = normalizeSecret(
    req.headers['x_cron_secret'] ||
    req.headers['x-cron-secret'] ||
    req.query.secret ||
    ''
  )
  if (cronSecret && provided !== cronSecret) {
    return res.status(401).type('text/plain').send('Unauthorized — pass ?secret=<BREW_CRON_SECRET>')
  }
  next()
}

// ─── Public signup (no auth) ────────────────────────────────────────────────
// Open landing page at GET /api/cron/brew/signup, form posts to /subscribe.

cronRouter.get('/signup', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Subscribe to ADAS Brew</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f3f0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 16px}.card{background:#fff;max-width:520px;width:100%;border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.08);padding:40px 32px;border-top:4px solid #CD4419}.brand{font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.16em;color:#CD4419;text-transform:uppercase;margin-bottom:6px}h1{font-size:30px;margin:0 0 8px;font-weight:800;line-height:1.15}.lede{color:#374151;font-size:16px;line-height:1.55;margin:0 0 12px}.benefit{color:#6b7280;font-size:14px;line-height:1.55;margin:0 0 24px}label{display:block;font-size:13px;font-weight:600;color:#374151;margin:14px 0 6px}input{width:100%;padding:11px 14px;font-size:15px;border:1.5px solid #e5e7eb;border-radius:9px;background:#fff;color:#1a1a1a;font-family:inherit}input:focus{outline:none;border-color:#CD4419}button{display:block;width:100%;background:#CD4419;color:#fff;font-size:15px;font-weight:700;padding:13px 22px;border-radius:9px;border:none;cursor:pointer;margin-top:18px;font-family:inherit}button:hover{background:#b53a15}button:disabled{opacity:.6;cursor:not-allowed}.foot{margin-top:24px;font-size:12px;color:#6b7280;line-height:1.5}.foot a{color:#CD4419;text-decoration:none}.msg{padding:12px 14px;border-radius:8px;font-size:14px;margin-top:16px}.ok{background:#dcfce7;color:#166534;border:1px solid #86efac}.err{background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5}.hp{position:absolute;left:-9999px}</style></head><body><div class="card"><div class="brand">ADAS Brew</div><h1>Grab a coffee. Get caught up on calibration and body shop.</h1><p class="lede">A quick read for collision shop owners and calibration techs — the OEM bulletins, recalls, insurance signals, and craft tips that actually matter, delivered every weekday morning.</p><p class="benefit">Free. ~5 min read. Built by Mark Fowler — owner of Absolute ADAS.</p><form id="f" onsubmit="return s(event)"><label for="email">Email</label><input id="email" name="email" type="email" required placeholder="you@yourshop.com" autocomplete="email"><label for="name">Name <span style="font-weight:400;color:#9ca3af">(optional)</span></label><input id="name" name="name" type="text" placeholder="First name" autocomplete="given-name"><label for="shop">Shop name <span style="font-weight:400;color:#9ca3af">(optional)</span></label><input id="shop" name="shop" type="text" placeholder="Your collision shop" autocomplete="organization"><input class="hp" name="website" tabindex="-1" autocomplete="off"><button id="b" type="submit">Subscribe</button></form><div id="m"></div><p class="foot">No spam. Unsubscribe anytime. Issues land Mon–Fri at 6am Pacific.</p></div><script>async function s(e){e.preventDefault();const b=document.getElementById('b'),m=document.getElementById('m');b.disabled=true;b.textContent='Subscribing…';m.innerHTML='';try{const r=await fetch('/server/adasiq-api/api/cron/brew/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,name:document.getElementById('name').value,shop:document.getElementById('shop').value,website:document.getElementById('website').value})});const d=await r.json();if(r.ok&&d.ok){m.innerHTML='<div class="msg ok">✓ You\\'re in. Check your inbox for a quick welcome.</div>';document.getElementById('f').reset();b.textContent='Subscribed!'}else{m.innerHTML='<div class="msg err">'+(d.error||'Something went wrong. Try again.')+'</div>';b.disabled=false;b.textContent='Subscribe'}}catch(err){m.innerHTML='<div class="msg err">Network error. Try again.</div>';b.disabled=false;b.textContent='Subscribe'}return false}</script></body></html>`)
})

cronRouter.post('/subscribe', express.json(), express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const body = req.body || {}
    // Honeypot — bots fill the hidden "website" field; humans don't see it
    if (body.website && String(body.website).trim() !== '') {
      return res.status(400).json({ error: 'Invalid submission' })
    }
    const email = normalizeEmail(body.email)
    const name = String(body.name || '').trim().slice(0, 100)
    const shop = String(body.shop || '').trim().slice(0, 200)
    const location = String(body.location || '').trim().slice(0, 100)
    const role = String(body.role || '').trim().slice(0, 60)
    if (!email || !email.includes('@') || email.length < 5 || email.length > 250) {
      return res.status(400).json({ error: 'Valid email required' })
    }

    const result = await addSubscriber(req, {
      email,
      name,
      shop,
      location,
      role,
      added_at: new Date().toISOString(),
      source: 'public_signup',
      ip: (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || '',
      onboarding_sent: ['welcome'],
    })
    if (result.already) {
      return res.json({ ok: true, already: true })
    }

    // Fire-and-forget welcome email
    sendWelcomeEmail({ email, name }).catch(e => console.warn('[brew welcome]', e.message))

    // Fire-and-forget Zoho CRM sync — creates or tags the Lead with "adasbrew"
    syncNewsletterSubscriberToCrm({ email, name, shop, source: 'ADAS Brew Newsletter' })
      .catch(e => console.warn('[brew crm-sync]', e.message))

    // Fire-and-forget Cliq DM to Mark — instant signup notification (count is approximate, fetched async)
    readSubscribers(req).then(allSubs => {
      return notifyMarkOfSignup({ email, name, shop, location, role, total: allSubs.length })
    }).catch(e => console.warn('[brew cliq-notify]', e.message))

    res.json({ ok: true })
  } catch (e) {
    console.error('[brew subscribe]', e.message)
    res.status(500).json({ error: 'Server error' })
  }
})

// ─── Onboarding sequence ────────────────────────────────────────────────────
// Daily cron checks every subscriber's age and sends the right "day N" email
// if it's due and hasn't been sent yet. Skips weekends.

const ONBOARDING_STEPS = [
  { id: 'day3',  daysAfter: 3,  build: buildDay3Email },
  { id: 'day7',  daysAfter: 7,  build: buildDay7Email },
  { id: 'day14', daysAfter: 14, build: buildDay14Email },
]

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there'
}

function buildDay3Email({ name }) {
  const greeting = `Hey ${firstName(name)} —`
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f3f0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3f0"><tr><td align="center" style="padding:32px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;border-top:4px solid #CD4419"><tr><td style="padding:32px 28px"><div style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.16em;color:#CD4419;text-transform:uppercase;margin-bottom:6px">ADAS Brew · Tip</div><h1 style="font-size:22px;margin:0 0 14px;font-weight:800;line-height:1.25">The 3-line calibration sublet that gets paid every time</h1><p style="font-size:16px;line-height:1.6;margin:0 0 14px">${greeting}</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">Quick one — useful on your next windshield or front-end job.</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">When shops sublet a calibration to me, the ones that get fully reimbursed by insurance break it into <strong>three separate line items</strong>:</p><ol style="font-size:15px;line-height:1.7;color:#374151;padding-left:22px;margin:0 0 14px"><li>Pre-scan</li><li>OEM-cited calibration (with sublet invoice attached)</li><li>Post-scan</li></ol><p style="font-size:16px;line-height:1.6;margin:0 0 14px">Bundle them into a single line and the carrier kicks it back as "duplicate" or "included in R&I." Three lines. Three OEM cites. Approved every time.</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">Sounds like splitting hairs. It's the difference between getting fully paid for the calibration line and eating $400.</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">Try it on your next sublet. Reply and tell me what carrier you ran it past.</p><p style="font-size:16px;line-height:1.6;margin:0 0 0">— Mark<br><span style="color:#6b7280;font-size:14px">Owner, Absolute ADAS · Builder, ADAS IQ</span></p></td></tr><tr><td style="padding:18px 28px 28px;border-top:1px solid #ececec"><p style="font-size:12px;color:#6b7280;margin:0">ADAS Brew · brew@adas-iq.com — to unsubscribe, just reply with "unsub".</p></td></tr></table></td></tr></table></body></html>`
  const text = `${greeting}\n\nQuick one — useful on your next windshield or front-end job.\n\nWhen shops sublet a calibration to me, the ones that get fully reimbursed by insurance break it into THREE separate line items:\n\n  1. Pre-scan\n  2. OEM-cited calibration (with sublet invoice attached)\n  3. Post-scan\n\nBundle them into a single line and the carrier kicks it back as "duplicate" or "included in R&I." Three lines. Three OEM cites. Approved every time.\n\nSounds like splitting hairs. It's the difference between getting fully paid for the calibration line and eating $400.\n\nTry it on your next sublet. Reply and tell me what carrier you ran it past.\n\n— Mark\nOwner, Absolute ADAS · Builder, ADAS IQ`
  return { subject: 'The 3-line calibration sublet that gets paid every time', html, text }
}

function buildDay7Email({ name }) {
  const greeting = `Hey ${firstName(name)} —`
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f3f0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3f0"><tr><td align="center" style="padding:32px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;border-top:4px solid #CD4419"><tr><td style="padding:32px 28px"><div style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.16em;color:#CD4419;text-transform:uppercase;margin-bottom:6px">ADAS Brew · Story</div><h1 style="font-size:22px;margin:0 0 14px;font-weight:800;line-height:1.25">Why I started this newsletter</h1><p style="font-size:16px;line-height:1.6;margin:0 0 14px">${greeting}</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">Quick context on who I am and why this exists.</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">I run <strong>Absolute ADAS</strong> — a mobile ADAS calibration service in Western Washington. We come to your shop, calibrate the vehicle, and leave you with the documentation insurance actually accepts. From the truck I work out of, I've been on the floor for thousands of calibrations across our region.</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">What I see every week: the shops that grow have figured calibration out as its own line of business. They bill it right, document it right, fight for it when the carrier pushes back. The shops that grind treat calibration like an afterthought and leave money on every job.</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">ADAS Brew is built from that vantage point. The OEM bulletins, the carrier signals, the calibration craft tips — what's actually moving in the world your shop operates in, every weekday.</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">If something I share helps you get a denied calibration approved, or saves you 30 minutes on a windshield job, the newsletter has done its job.</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">Glad you're here.</p><p style="font-size:16px;line-height:1.6;margin:0 0 0">— Mark<br><span style="color:#6b7280;font-size:14px">Owner, Absolute ADAS · Builder, ADAS IQ</span></p></td></tr><tr><td style="padding:18px 28px 28px;border-top:1px solid #ececec"><p style="font-size:12px;color:#6b7280;margin:0">ADAS Brew · brew@adas-iq.com — to unsubscribe, just reply with "unsub".</p></td></tr></table></td></tr></table></body></html>`
  const text = `${greeting}\n\nQuick context on who I am and why this exists.\n\nI run Absolute ADAS — a mobile ADAS calibration service in Western Washington. We come to your shop, calibrate the vehicle, and leave you with the documentation insurance actually accepts. From the truck I work out of, I've been on the floor for thousands of calibrations across our region.\n\nWhat I see every week: the shops that grow have figured calibration out as its own line of business. They bill it right, document it right, fight for it when the carrier pushes back. The shops that grind treat calibration like an afterthought and leave money on every job.\n\nADAS Brew is built from that vantage point. The OEM bulletins, the carrier signals, the calibration craft tips — what's actually moving in the world your shop operates in, every weekday.\n\nIf something I share helps you get a denied calibration approved, or saves you 30 minutes on a windshield job, the newsletter has done its job.\n\nGlad you're here.\n\n— Mark\nOwner, Absolute ADAS · Builder, ADAS IQ`
  return { subject: 'Why I started this newsletter', html, text }
}

function buildDay14Email({ name }) {
  const greeting = `Hey ${firstName(name)} —`
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f3f0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3f0"><tr><td align="center" style="padding:32px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;border-top:4px solid #CD4419"><tr><td style="padding:32px 28px"><div style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.16em;color:#CD4419;text-transform:uppercase;margin-bottom:6px">ADAS Brew · Offer</div><h1 style="font-size:22px;margin:0 0 14px;font-weight:800;line-height:1.25">A no-strings offer (45 sec to read)</h1><p style="font-size:16px;line-height:1.6;margin:0 0 14px">${greeting}</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">Two weeks in. Hope at least one issue has been useful.</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px"><strong>Quick offer — no strings:</strong></p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">Reply to this email with <strong>one calibration that got short-paid or denied</strong>. Carrier name, the procedure, what they said.</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">I'll write you the OEM-citation justification myself. The exact language, the documentation checklist, the line-item format that flips it.</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">Free. No upsell. No "schedule a demo" funnel. Just pay it forward.</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">I do this maybe twice a week for ADAS Brew readers. It's the best way I know to keep my finger on what carriers are pushing back on this month.</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">Hit reply. Tell me what's stuck.</p><p style="font-size:16px;line-height:1.6;margin:0 0 14px">— Mark<br><span style="color:#6b7280;font-size:14px">Owner, Absolute ADAS · Builder, ADAS IQ</span></p><p style="font-size:13px;line-height:1.6;color:#6b7280;margin:18px 0 0;border-top:1px solid #ececec;padding-top:14px"><strong>P.S.</strong> If your shop's calibration workflow is bleeding money — missed line items, denied procedures, sublet chaos — that's what ADAS IQ exists to fix. But that's a separate conversation. First, send me the denial.</p></td></tr><tr><td style="padding:18px 28px 28px;border-top:1px solid #ececec"><p style="font-size:12px;color:#6b7280;margin:0">ADAS Brew · brew@adas-iq.com — to unsubscribe, just reply with "unsub".</p></td></tr></table></td></tr></table></body></html>`
  const text = `${greeting}\n\nTwo weeks in. Hope at least one issue has been useful.\n\nQuick offer — no strings:\n\nReply to this email with ONE calibration that got short-paid or denied. Carrier name, the procedure, what they said.\n\nI'll write you the OEM-citation justification myself. The exact language, the documentation checklist, the line-item format that flips it.\n\nFree. No upsell. No "schedule a demo" funnel. Just pay it forward.\n\nI do this maybe twice a week for ADAS Brew readers. It's the best way I know to keep my finger on what carriers are pushing back on this month.\n\nHit reply. Tell me what's stuck.\n\n— Mark\nOwner, Absolute ADAS · Builder, ADAS IQ\n\nP.S. If your shop's calibration workflow is bleeding money — missed line items, denied procedures, sublet chaos — that's what ADAS IQ exists to fix. But that's a separate conversation. First, send me the denial.`
  return { subject: 'A no-strings offer (45 sec to read)', html, text }
}

function isWeekendPT() {
  const day = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
  return ['Sat', 'Sun'].includes(day)
}

cronRouter.post('/onboarding', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true'
    if (!force && isWeekendPT()) {
      return res.json({ skipped: true, reason: 'Weekend PT' })
    }

    const subs = await readSubscribers(req)
    const now = Date.now()
    const results = []

    for (const sub of subs) {
      if (!sub.email || !sub.added_at) continue
      const ageDays = Math.floor((now - new Date(sub.added_at).getTime()) / (24 * 60 * 60 * 1000))
      const sent = Array.isArray(sub.onboarding_sent) ? sub.onboarding_sent : []

      // Find the most-recent step that's due and hasn't been sent yet
      const due = ONBOARDING_STEPS
        .filter(s => ageDays >= s.daysAfter && !sent.includes(s.id))
        .pop()

      if (!due) continue

      const built = due.build({ name: sub.name })
      const r = await sendBroadcast({
        recipients: [sub.email],
        subject: built.subject,
        html: built.html,
        text: built.text,
      })

      if (r.status === 'sent' || r.status === 'queued') {
        const newSent = [...sent, due.id]
        await updateSubscriberOnboarding(req, sub.email, newSent)
        results.push({ email: sub.email, step: due.id, status: 'sent' })
      } else {
        results.push({ email: sub.email, step: due.id, status: 'failed', error: r.error })
      }
    }

    res.json({ processed: results.length, results })
  } catch (e) {
    console.error('[brew onboarding]', e.message, e.stack)
    res.status(500).json({ error: e.message })
  }
})

async function notifyMarkOfSignup({ email, name, shop, location, role, total }) {
  // 1. Cliq channel post — avoids self-DM restriction. Channel name from env or default.
  const channel = process.env.BREW_SIGNUP_CLIQ_CHANNEL || 'adasbrew'
  const cliqLines = [`📬 *New ADAS Brew subscriber*`, '']
  cliqLines.push(`*Email:* ${email}`)
  if (name) cliqLines.push(`*Name:* ${name}`)
  if (shop) cliqLines.push(`*Shop:* ${shop}`)
  if (location) cliqLines.push(`*Location:* ${location}`)
  if (role) cliqLines.push(`*Role:* ${role}`)
  cliqLines.push('')
  cliqLines.push(`_Total subscribers: ${total}_`)
  postToCliqChannel(channel, cliqLines.join('\n'))
    .catch(e => console.warn('[brew cliq-channel]', e.message))

  // 2. Email notification — backup channel + paper trail
  const recipient = process.env.BREW_SIGNUP_NOTIFY_EMAIL || 'brew@adas-iq.com'
  const subject = `📬 New ADAS Brew subscriber${name ? ` from ${name}` : ''}`
  const rows = [
    `<tr><td style="padding:6px 0;color:#6b7280;width:80px">Email:</td><td style="padding:6px 0;font-weight:600">${email}</td></tr>`,
    name && `<tr><td style="padding:6px 0;color:#6b7280">Name:</td><td style="padding:6px 0">${name}</td></tr>`,
    shop && `<tr><td style="padding:6px 0;color:#6b7280">Shop:</td><td style="padding:6px 0">${shop}</td></tr>`,
    location && `<tr><td style="padding:6px 0;color:#6b7280">Location:</td><td style="padding:6px 0">${location}</td></tr>`,
    role && `<tr><td style="padding:6px 0;color:#6b7280">Role:</td><td style="padding:6px 0">${role}</td></tr>`,
    `<tr><td style="padding:6px 0;color:#6b7280">Total:</td><td style="padding:6px 0;color:#6b7280">${total} subscribers</td></tr>`,
  ].filter(Boolean).join('')
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a"><h2 style="color:#CD4419;font-size:20px;margin:0 0 14px">New ADAS Brew subscriber</h2><table style="width:100%;border-collapse:collapse;font-size:15px;line-height:1.5">${rows}</table></div>`
  const text = `New ADAS Brew subscriber\n\nEmail: ${email}${name ? `\nName: ${name}` : ''}${shop ? `\nShop: ${shop}` : ''}${location ? `\nLocation: ${location}` : ''}${role ? `\nRole: ${role}` : ''}\n\nTotal: ${total} subscribers`
  return sendBroadcast({ recipients: [recipient], subject, html, text })
}

async function sendWelcomeEmail({ email, name }) {
  const greeting = name ? `Hey ${name}` : 'Hey there'
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f3f0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3f0"><tr><td align="center" style="padding:32px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;border-top:4px solid #CD4419"><tr><td style="padding:32px 28px"><div style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.16em;color:#CD4419;text-transform:uppercase;margin-bottom:6px">ADAS Brew</div><h1 style="font-size:24px;margin:0 0 14px;font-weight:800;line-height:1.2">You're in. Welcome to ADAS Brew.</h1><p style="font-size:16px;line-height:1.55;margin:0 0 14px">${greeting} —</p><p style="font-size:16px;line-height:1.55;margin:0 0 14px">Thanks for subscribing. Here's what to expect:</p><ul style="font-size:15px;line-height:1.6;color:#374151;padding-left:22px;margin:0 0 18px"><li><strong>Every weekday (Mon–Fri)</strong> at 6am Pacific</li><li>The 5 most important calibration / collision / insurance industry stories from the last 24 hours</li><li>Curated, not aggregated. ~5 min read.</li></ul><p style="font-size:16px;line-height:1.55;margin:0 0 14px">If you ever want to reply with what you're seeing in your shop — what insurance is denying, what OEM bulletin is driving you nuts, what calibration is killing your margins — I read every reply. The newsletter gets better when readers tell me where to dig.</p><p style="font-size:16px;line-height:1.55;margin:0 0 14px">First issue lands the next weekday at 6am Pacific.</p><p style="font-size:16px;line-height:1.55;margin:0 0 0">— Mark<br><span style="color:#6b7280;font-size:14px">Owner, Absolute ADAS · Builder, ADAS IQ</span></p></td></tr><tr><td style="padding:18px 28px 28px;border-top:1px solid #ececec"><p style="font-size:12px;color:#6b7280;margin:0">ADAS Brew · brew@adas-iq.com — to unsubscribe, just reply with "unsub".</p></td></tr></table></td></tr></table></body></html>`
  const text = `${greeting} —\n\nYou're in. Welcome to ADAS Brew.\n\nWhat to expect:\n- Every weekday (Mon–Fri) at 6am Pacific\n- The 5 most important calibration / collision / insurance industry stories\n- Curated, not aggregated. ~5 min read.\n\nReply anytime with what you're seeing in your shop. I read every reply.\n\nFirst issue lands the next weekday at 6am Pacific.\n\n— Mark\nOwner, Absolute ADAS · Builder, ADAS IQ`
  return sendBroadcast({
    recipients: [email],
    subject: `Welcome to ADAS Brew ☕`,
    html,
    text,
  })
}

// TEMP — fire all 4 welcome + onboarding emails to a given address for review.
// GET /api/cron/brew/_send-all-emails?to=brew@adas-iq.com&secret=...
cronRouter.get('/_send-all-emails', requireCronSecretFlex, async (req, res) => {
  const to = String(req.query.to || 'brew@adas-iq.com').trim()
  const name = String(req.query.name || 'Mark').trim()
  const out = []

  // 1. Welcome
  try {
    const r = await sendWelcomeEmail({ email: to, name })
    out.push({ step: 'welcome', subject: 'Welcome to ADAS Brew ☕', ok: r?.status === 'sent' })
  } catch (e) { out.push({ step: 'welcome', ok: false, error: e.message }) }

  // 2-4. Onboarding steps
  for (const step of ONBOARDING_STEPS) {
    try {
      const built = step.build({ name })
      const r = await sendBroadcast({ recipients: [to], subject: built.subject, html: built.html, text: built.text })
      out.push({ step: step.id, subject: built.subject, ok: r?.status === 'sent' })
    } catch (e) {
      out.push({ step: step.id, ok: false, error: e.message })
    }
  }

  res.json({ to, sent: out })
})

// TEMP — test the LinkedIn comment feature on an existing post URN
cronRouter.get('/_test-linkedin-comment', requireCronSecretFlex, async (req, res) => {
  const urn = String(req.query.urn || '').trim()
  const text = String(req.query.text || `If you want a 5-min version of this in your inbox every weekday morning, free → adas-iq.com/brew`).trim()
  if (!urn) return res.status(400).json({ error: 'pass ?urn=urn:li:share:...' })
  try {
    const r = await commentOnLinkedInPost(urn, text)
    res.json(r)
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

// Monthly summary cron — runs 1st of each month at 8am PT.
// Posts a recap of the prior month to Cliq #adasbrew + emails brew@adas-iq.com.
cronRouter.post('/monthly-summary', async (req, res) => {
  try {
    // Date range: the calendar month BEFORE today (in Pacific time)
    const tz = 'America/Los_Angeles'
    const ptNow = new Date(new Date().toLocaleString('en-US', { timeZone: tz }))
    const monthEnd = new Date(ptNow.getFullYear(), ptNow.getMonth(), 1)
    const monthStart = new Date(monthEnd.getFullYear(), monthEnd.getMonth() - 1, 1)
    const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

    const inRange = (iso) => {
      if (!iso) return false
      const t = new Date(iso).getTime()
      return t >= monthStart.getTime() && t < monthEnd.getTime()
    }

    // Pull data
    const perf = await readPerformance(req)
    const subs = await readSubscribers(req)

    const monthIssues = perf.filter(p => inRange(p.sentAt))
    const monthSubs = subs.filter(s => inRange(s.added_at))

    // Open rate analysis
    let totalSent = 0, totalOpens = 0
    monthIssues.forEach(p => {
      const u = Array.isArray(p.uniqueOpens) ? p.uniqueOpens.length : 0
      totalSent += p.sentCount || 0
      totalOpens += u
    })
    const avgOpenRate = totalSent > 0 ? totalOpens / totalSent : 0

    const ranked = [...monthIssues].map(p => {
      const unique = Array.isArray(p.uniqueOpens) ? p.uniqueOpens.length : 0
      const rate = p.sentCount > 0 ? unique / p.sentCount : 0
      return { ...p, unique, rate }
    }).sort((a, b) => b.rate - a.rate)
    const best = ranked[0]
    const worst = ranked[ranked.length - 1]

    // Subscriber breakdown
    const totalSubs = subs.length
    const byRole = {}
    const byLocation = {}
    monthSubs.forEach(s => {
      if (s.role) byRole[s.role] = (byRole[s.role] || 0) + 1
      if (s.location) byLocation[s.location] = (byLocation[s.location] || 0) + 1
    })
    const topRole = Object.entries(byRole).sort((a, b) => b[1] - a[1])[0]
    const topLocation = Object.entries(byLocation).sort((a, b) => b[1] - a[1])[0]

    // Build the Cliq post
    const cliqLines = [`📊 *ADAS Brew · Monthly Recap · ${monthLabel}*`, '']
    cliqLines.push(`*📨 Sends*`)
    cliqLines.push(`${monthIssues.length} issues sent`)
    cliqLines.push(`Total subscribers: ${totalSubs} (+${monthSubs.length} this month)`)
    cliqLines.push('')
    cliqLines.push(`*📈 Open Rates*`)
    cliqLines.push(`Avg open rate: ${(avgOpenRate * 100).toFixed(0)}%`)
    if (best) cliqLines.push(`Best (${(best.rate * 100).toFixed(0)}%): "${String(best.subject || '').slice(0, 80)}"`)
    if (worst && worst !== best) cliqLines.push(`Worst (${(worst.rate * 100).toFixed(0)}%): "${String(worst.subject || '').slice(0, 80)}"`)
    cliqLines.push('')
    cliqLines.push(`*👥 New Subscribers (${monthSubs.length})*`)
    if (topRole) cliqLines.push(`Top role: ${topRole[0]} (${topRole[1]})`)
    if (topLocation) cliqLines.push(`Top location: ${topLocation[0]} (${topLocation[1]})`)
    cliqLines.push('')
    cliqLines.push(`_View full stats: adas-iq-904191467.development.catalystserverless.com/server/adasiq-api/api/cron/brew/stats?secret=…_`)

    // Build email
    const emailHtml = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a"><h2 style="color:#CD4419;margin:0 0 18px">📊 ADAS Brew Monthly Recap · ${monthLabel}</h2><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.12em;color:#6b7280;margin:24px 0 8px">Sends</h3><p style="margin:0;line-height:1.6">${monthIssues.length} issues sent · ${totalSubs} total subs (+${monthSubs.length} this month)</p><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.12em;color:#6b7280;margin:24px 0 8px">Open Rates</h3><p style="margin:0 0 6px;line-height:1.6"><strong>${(avgOpenRate * 100).toFixed(0)}%</strong> avg</p>${best ? `<p style="margin:0 0 4px;line-height:1.5;font-size:14px"><strong>Best (${(best.rate * 100).toFixed(0)}%):</strong> ${String(best.subject || '').replace(/[<>"]/g, '')}</p>` : ''}${worst && worst !== best ? `<p style="margin:0;line-height:1.5;font-size:14px"><strong>Worst (${(worst.rate * 100).toFixed(0)}%):</strong> ${String(worst.subject || '').replace(/[<>"]/g, '')}</p>` : ''}<h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.12em;color:#6b7280;margin:24px 0 8px">New Subscribers (${monthSubs.length})</h3>${topRole ? `<p style="margin:0 0 4px;line-height:1.5;font-size:14px">Top role: <strong>${topRole[0]}</strong> (${topRole[1]})</p>` : ''}${topLocation ? `<p style="margin:0;line-height:1.5;font-size:14px">Top location: <strong>${topLocation[0]}</strong> (${topLocation[1]})</p>` : ''}</div>`

    const emailText = cliqLines.join('\n').replace(/\*/g, '').replace(/_/g, '')

    // Fire both notifications in parallel
    const channel = process.env.BREW_SIGNUP_CLIQ_CHANNEL || 'adasbrew'
    const recipient = process.env.BREW_SIGNUP_NOTIFY_EMAIL || 'brew@adas-iq.com'
    const [cliqResult, emailResult] = await Promise.allSettled([
      postToCliqChannel(channel, cliqLines.join('\n')),
      sendBroadcast({ recipients: [recipient], subject: `📊 ADAS Brew Monthly Recap · ${monthLabel}`, html: emailHtml, text: emailText }),
    ])

    res.json({
      ok: true,
      month: monthLabel,
      issuesSent: monthIssues.length,
      newSubs: monthSubs.length,
      totalSubs,
      avgOpenRate,
      cliq: cliqResult.status === 'fulfilled' ? 'sent' : `failed: ${cliqResult.reason?.message}`,
      email: emailResult.status === 'fulfilled' ? emailResult.value : `failed: ${emailResult.reason?.message}`,
    })
  } catch (e) {
    console.error('[brew monthly-summary]', e.message, e.stack)
    res.status(500).json({ error: e.message })
  }
})

// Stats viewer — shows past issues ranked by open rate so you can see what works.
// GET /api/cron/brew/stats?secret=...
cronRouter.get('/stats', requireCronSecretFlex, async (req, res) => {
  try {
    const perf = await readPerformance(req)
    if (!perf.length) {
      res.set('Content-Type', 'text/html; charset=utf-8')
      return res.send(`<!doctype html><html><head><meta charset="utf-8"><title>ADAS Brew Stats</title><style>body{margin:0;background:#0d0d0d;color:#fff;font-family:-apple-system,'Inter',Helvetica,Arial,sans-serif;padding:48px 24px;text-align:center;line-height:1.5}.brand{font-family:monospace;font-size:11px;font-weight:700;letter-spacing:.22em;color:#CD4419;text-transform:uppercase;margin-bottom:14px}h1{font-size:28px;font-weight:900;margin:0 0 12px}.empty{color:#999;margin-top:32px}</style></head><body><div class="brand">ADAS Brew · Stats</div><h1>No issues sent yet.</h1><p class="empty">Stats appear here after Mon–Fri sends accumulate open data.</p></body></html>`)
    }

    const now = Date.now()
    const enriched = perf.map(p => {
      const ageHours = p.sentAt ? (now - new Date(p.sentAt).getTime()) / 36e5 : 0
      const settled = ageHours >= 24
      const unique = Array.isArray(p.uniqueOpens) ? p.uniqueOpens.length : 0
      const openRate = p.sentCount > 0 ? Math.min(1, unique / p.sentCount) : 0
      return {
        ...p,
        unique,
        openRate,
        ageHours,
        settled,
      }
    }).sort((a, b) => b.openRate - a.openRate)

    const totalSent = enriched.reduce((s, p) => s + (p.sentCount || 0), 0)
    const totalOpens = enriched.reduce((s, p) => s + p.unique, 0)
    const avgOpenRate = totalSent > 0 ? totalOpens / totalSent : 0

    const rows = enriched.map(p => {
      const pct = (p.openRate * 100).toFixed(0)
      const subject = String(p.subject || '').replace(/[<>"]/g, '')
      const tag = p.settled ? '' : '<span class="pending">pending</span>'
      const date = p.sentAt ? new Date(p.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
      return `<tr><td class="num">#${p.issueNumber}</td><td class="rate"><span class="bar" style="width:${pct}%"></span><span class="pct">${pct}%</span></td><td class="subject">${subject}${tag}</td><td class="meta">${p.unique}/${p.sentCount}</td><td class="meta">${date}</td></tr>`
    }).join('')

    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADAS Brew Stats</title><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}body{background:#0d0d0d;color:#fff;font-family:-apple-system,'Inter',Helvetica,Arial,sans-serif;padding:48px 24px;line-height:1.5;min-height:100vh}.wrap{max-width:920px;margin:0 auto}.brand{font-family:monospace;font-size:11px;font-weight:700;letter-spacing:.22em;color:#CD4419;text-transform:uppercase;margin-bottom:14px;text-align:center}h1{font-size:32px;font-weight:900;margin:0 0 28px;text-align:center}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:32px}.stat{background:#151515;border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:18px 22px;text-align:center}.stat .label{font-size:11px;text-transform:uppercase;letter-spacing:.16em;color:#999;font-family:monospace;margin-bottom:8px}.stat .val{font-size:28px;font-weight:800}table{width:100%;border-collapse:separate;border-spacing:0;background:#151515;border:1px solid rgba(255,255,255,.06);border-radius:10px;overflow:hidden}th,td{padding:14px 16px;text-align:left;font-size:14px;border-bottom:1px solid rgba(255,255,255,.05)}tr:last-child td{border-bottom:none}th{font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#999;font-weight:700;background:#1a1a1a}.num{font-family:monospace;color:#CD4419;font-weight:800;width:60px}.rate{position:relative;width:160px;font-family:monospace;font-weight:700}.bar{position:absolute;left:16px;top:50%;transform:translateY(-50%);height:18px;background:rgba(205,68,25,.18);border-left:2px solid #CD4419;border-radius:2px;max-width:128px;z-index:0}.pct{position:relative;z-index:1}.subject{color:#f0ece6;line-height:1.4}.pending{display:inline-block;margin-left:8px;font-size:10px;font-family:monospace;background:rgba(255,255,255,.06);color:#999;padding:2px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:.08em}.meta{color:#999;font-family:monospace;font-size:13px;width:80px}@media(max-width:680px){.summary{grid-template-columns:1fr}.subject{font-size:13px}.meta{display:none}}</style></head><body><div class="wrap"><div class="brand">ADAS Brew · Subject Performance</div><h1>What's working in your subject lines</h1><div class="summary"><div class="stat"><div class="label">Total Issues</div><div class="val">${enriched.length}</div></div><div class="stat"><div class="label">Avg Open Rate</div><div class="val">${(avgOpenRate * 100).toFixed(0)}%</div></div><div class="stat"><div class="label">Total Opens</div><div class="val">${totalOpens}</div></div></div><table><thead><tr><th>#</th><th>Open Rate</th><th>Subject</th><th>Opens</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div></body></html>`)
  } catch (e) {
    console.error('[brew stats]', e.message, e.stack)
    res.status(500).type('text/plain').send(`Stats failed: ${e.message}`)
  }
})

// Resend webhook receiver — captures email.opened / email.clicked events.
// Set up at https://resend.com/webhooks pointing to:
//   POST /server/adasiq-api/api/cron/brew/resend-webhook
// Resend signs payloads via Svix; we verify if RESEND_WEBHOOK_SECRET is set.
cronRouter.post('/resend-webhook', express.json({ limit: '256kb' }), async (req, res) => {
  // Optional signature verification
  const secret = process.env.RESEND_WEBHOOK_SECRET || ''
  if (secret) {
    try {
      const { Webhook } = await import('svix').catch(() => ({ Webhook: null }))
      if (Webhook) {
        const wh = new Webhook(secret)
        const headers = {
          'svix-id': req.headers['svix-id'] || '',
          'svix-timestamp': req.headers['svix-timestamp'] || '',
          'svix-signature': req.headers['svix-signature'] || '',
        }
        wh.verify(JSON.stringify(req.body), headers)
      }
    } catch (e) {
      console.warn('[brew webhook] signature verify failed:', e.message)
      return res.status(401).json({ error: 'Invalid signature' })
    }
  }

  try {
    const event = req.body || {}
    const type = event.type || ''
    const data = event.data || {}
    const emailId = data.email_id || data.id || null
    const recipientArr = Array.isArray(data.to) ? data.to : (data.to ? [data.to] : [])
    const recipient = recipientArr[0] || ''

    if (!emailId || (type !== 'email.opened' && type !== 'email.clicked')) {
      return res.json({ ok: true, ignored: true })
    }

    // Find the issue that contains this email ID. We iterate because Datastore
    // doesn't natively query JSON-string array contains.
    const allIssues = await dsReadAllIssues(req)
    const entry = allIssues.find(p => Array.isArray(p.emailIds) && p.emailIds.includes(emailId))
    if (!entry) {
      return res.json({ ok: true, unknown_email_id: emailId })
    }

    const updates = { issueNumber: entry.issueNumber }
    if (type === 'email.opened') {
      updates.openCount = (entry.openCount || 0) + 1
      const uniqueOpens = entry.uniqueOpens || []
      if (recipient && !uniqueOpens.includes(recipient)) uniqueOpens.push(recipient)
      updates.uniqueOpens = uniqueOpens
    } else if (type === 'email.clicked') {
      updates.clickCount = (entry.clickCount || 0) + 1
      const uniqueClicks = entry.uniqueClicks || []
      if (recipient && !uniqueClicks.includes(recipient)) uniqueClicks.push(recipient)
      updates.uniqueClicks = uniqueClicks
    }
    await dsUpsertIssue(req, updates)
    res.json({ ok: true, type, issueNumber: entry.issueNumber })
  } catch (e) {
    console.error('[brew webhook]', e.message, e.stack)
    res.status(500).json({ error: e.message })
  }
})

// Public HTML endpoint — used as content_url for Zoho campaign creation.
// Zoho's createCampaign htmlcontent has a small limit (~6KB), so instead of
// inlining the HTML we cache it under a key and pass Zoho a URL to fetch.
// Key is opaque (random) and content is short-lived; not auth-gated because
// Zoho's servers don't authenticate when fetching content_url.
cronRouter.get('/published/:key', async (req, res) => {
  try {
    const segment = getSegment(req)
    // Read raw — don't JSON.parse, the value is HTML.
    let html
    try {
      html = await segment.getValue(`brew_published_${req.params.key}`)
    } catch (e) {
      if (isNotFound(e)) return res.status(404).type('text/plain').send('Not found')
      throw e
    }
    if (!html) return res.status(404).type('text/plain').send('Not found')
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(String(html))
  } catch (e) {
    console.error('[brew published]', e.message)
    res.status(500).type('text/plain').send(e.message)
  }
})

// Preview the AI-generated LinkedIn post (cron-secret variant)
cronRouter.get('/linkedin-post-preview', requireCronSecretFlex, async (req, res) => {
  try {
    const built = await buildIssue(req)
    const postText = await digestToLinkedInPost(built.digest)
    res.set('Content-Type', 'text/plain; charset=utf-8')
    res.send(`====================\nLinkedIn post preview — Issue #${built.issueNumber}\n${postText.length} chars\n====================\n\n${postText}`)
  } catch (e) {
    res.status(500).type('text/plain').send(`Preview failed: ${e.message}`)
  }
})

// GET /api/cron/brew/preview?secret=... — open in browser to see today's email
cronRouter.get('/preview', requireCronSecretFlex, async (req, res) => {
  try {
    const built = await buildIssue(req)
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(built.rendered.html)
  } catch (e) {
    console.error('[brew public preview]', e.message, e.stack)
    res.status(500).type('text/plain').send(`Preview failed: ${e.message}`)
  }
})

// GET /api/cron/brew/_test-image?secret=...&headline=...&issue=...&date=...
// Renders a Nano Banana cover image inline so you can preview the brand look
// without affecting any sends or social posts. Defaults plug in plausible values.
// Add &commit=1 to also push it to GitHub at brew/images/test-{timestamp}.png and
// return JSON with the public URL instead of the image bytes.
cronRouter.get('/_test-image', requireCronSecretFlex, async (req, res) => {
  try {
    const issueNumber = req.query.issue || '999'
    const dateISO = req.query.date || new Date().toISOString().slice(0, 10)
    const headline = String(req.query.headline || 'OEM parts spike, alternative hits 40%')

    const img = await generateCoverImage({ issueNumber, dateISO, headline })
    if (!img.ok) {
      return res.status(500).type('text/plain').send(`Image gen failed: ${img.error}`)
    }

    if (req.query.commit === '1') {
      const commitResult = await commitBinaryFile({
        path: `brew/images/test-${Date.now()}.png`,
        buffer: img.buffer,
        message: 'Nano Banana test image',
      })
      return res.json({ ok: true, prompt: img.prompt, ...commitResult })
    }

    res.set('Content-Type', img.mimeType || 'image/png')
    res.set('Content-Disposition', 'inline; filename="brew-test.png"')
    res.set('Cache-Control', 'no-store')
    return res.send(img.buffer)
  } catch (e) {
    console.error('[brew test-image]', e.message, e.stack)
    return res.status(500).type('text/plain').send(e.message)
  }
})

// POST /api/cron/brew/_prep-bonus?secret=... — builds today's digest fresh
// and stashes it for /run-bonus to pick up, WITHOUT sending email. Use this
// to test the social pipeline against real content without duplicating sends.
// Does not advance the issue counter (no recordIssueSent call here).
cronRouter.post('/_prep-bonus', requireCronSecretFlex, async (req, res) => {
  try {
    const fetched = await fetchAndTrim()
    const built = await buildIssue(req, { items: fetched.items, status: fetched.status })
    const segment = getSegment(req)
    const stash = {
      digest: built.digest,
      issueNumber: built.issueNumber,
      subject: built.rendered.subject,
      dateISO: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    }
    await cacheSet(segment, 'brew_pending_bonus', stash)
    await cacheSet(segment, 'brew_today_digest', stash)
    res.json({
      ok: true,
      issueNumber: built.issueNumber,
      subject: built.rendered.subject,
      itemsConsidered: built.itemsConsidered,
    })
  } catch (e) {
    console.error('[brew _prep-bonus]', e.message, e.stack)
    res.status(500).json({ error: e.message })
  }
})

cronRouter.use(requireCronSecret)

cronRouter.post('/fetch', async (req, res) => {
  try {
    const out = await runFetch(req)
    res.json(out)
  } catch (e) {
    console.error('[brew cron fetch]', e.message, e.stack)
    res.status(500).json({ error: e.message })
  }
})

// ─── Issues (combined manifest + performance, stored in Catalyst Datastore) ─
//
// Table: BrewIssues
// Columns: issue_number (Integer, unique, indexed), subject, date_iso, sent_at,
//          sent_count, open_count, click_count, email_ids, unique_opens, unique_clicks

function getIssuesTable(req) {
  return catalyst.initialize(req, { type: 'advancedio' }).datastore().table('BrewIssues')
}

function parseJsonArray(s) {
  if (!s) return []
  try { const p = JSON.parse(s); return Array.isArray(p) ? p : [] }
  catch { return [] }
}

function rowToIssue(row) {
  return {
    id: String(row.ROWID),
    issueNumber: Number(row.issue_number || 0),
    subject: row.subject || '',
    dateISO: row.date_iso || '',
    sentAt: row.sent_at || '',
    sentCount: Number(row.sent_count || 0),
    openCount: Number(row.open_count || 0),
    clickCount: Number(row.click_count || 0),
    emailIds: parseJsonArray(row.email_ids),
    uniqueOpens: parseJsonArray(row.unique_opens),
    uniqueClicks: parseJsonArray(row.unique_clicks),
  }
}

function issueToRow(issue) {
  return {
    issue_number: Number(issue.issueNumber || 0),
    subject: String(issue.subject || '').slice(0, 250),
    date_iso: String(issue.dateISO || '').slice(0, 40),
    sent_at: String(issue.sentAt || '').slice(0, 40),
    sent_count: Number(issue.sentCount || 0),
    open_count: Number(issue.openCount || 0),
    click_count: Number(issue.clickCount || 0),
    email_ids: JSON.stringify(issue.emailIds || []),
    unique_opens: JSON.stringify(issue.uniqueOpens || []),
    unique_clicks: JSON.stringify(issue.uniqueClicks || []),
  }
}

async function dsFindIssueByNumber(req, issueNumber) {
  const app = catalyst.initialize(req)
  const result = await app.zcql().executeZCQLQuery(`SELECT * FROM BrewIssues WHERE issue_number = ${Number(issueNumber)}`)
  if (result && result.length > 0) return rowToIssue(result[0].BrewIssues)
  return null
}

async function dsReadAllIssues(req) {
  const table = getIssuesTable(req)
  const rows = await table.getAllRows()
  return (rows || []).map(rowToIssue)
}

async function dsUpsertIssue(req, issue) {
  const table = getIssuesTable(req)
  const existing = await dsFindIssueByNumber(req, issue.issueNumber)
  if (existing) {
    const merged = { ...existing, ...issue }
    const row = issueToRow(merged)
    row.ROWID = existing.id
    return rowToIssue(await table.updateRow(row))
  }
  return rowToIssue(await table.insertRow(issueToRow(issue)))
}

// ─── Compatibility shims (so existing call sites don't change) ────────────
//
// readPerformance / readIssuesManifest both now pull from the same BrewIssues
// table — they just project different shapes for backward compatibility.

async function readPerformance(req) {
  const all = await dsReadAllIssues(req)
  // Sort by issue number ascending (matches old cache behavior)
  return all.sort((a, b) => a.issueNumber - b.issueNumber)
}

async function recordIssueSent_v2(req, { issueNumber, subject, sentAt, emailIds }) {
  await dsUpsertIssue(req, {
    issueNumber: Number(issueNumber),
    subject: String(subject || '').slice(0, 250),
    sentAt: sentAt || new Date().toISOString(),
    sentCount: Array.isArray(emailIds) ? emailIds.length : 0,
    emailIds: Array.isArray(emailIds) ? emailIds.slice(0, 200) : [],
  })
}

/**
 * Compute open rate for an issue (unique opens / sent count).
 * Returns 0-1 range, or null if not enough data yet.
 */
function computeOpenRate(entry) {
  if (!entry || !entry.sentCount) return null
  const unique = Array.isArray(entry.uniqueOpens) ? entry.uniqueOpens.length : entry.openCount
  return Math.min(1, unique / entry.sentCount)
}

/**
 * Get past issues that have had at least `minHoursOld` hours to accumulate opens.
 * Default 24h — opens after 24h are rare; data is settled enough.
 */
export async function getSettledPerformance(req, minHoursOld = 24, limit = 10) {
  const perf = await readPerformance(req)
  const now = Date.now()
  const cutoff = now - minHoursOld * 60 * 60 * 1000
  return perf
    .filter(p => p.sentAt && new Date(p.sentAt).getTime() < cutoff && p.sentCount > 0)
    .slice(-limit)
    .map(p => ({
      issueNumber: p.issueNumber,
      subject: p.subject,
      sentCount: p.sentCount,
      openRate: computeOpenRate(p),
    }))
    .filter(p => p.openRate !== null)
}

// ─── Issue manifest (for the public archive) ───────────────────────────────
// Backed by the same BrewIssues Datastore table. Manifest entries are just
// projected fields from each row.

async function readIssuesManifest(req) {
  const all = await dsReadAllIssues(req)
  return all
    .filter(it => it.issueNumber > 0)
    .map(it => ({ issueNumber: it.issueNumber, dateISO: it.dateISO, subject: it.subject }))
}

async function writeIssuesManifest(req, manifest) {
  // No-op — manifest is derived from BrewIssues table. Use dsUpsertIssue to add
  // entries. Kept for backward compatibility.
  return
}

/**
 * Publish a rendered issue to the GitHub-hosted archive (adas-iq.com/brew/...).
 * Commits the issue HTML + regenerates the archive index. Updates the manifest.
 * Fire-and-forget safe — returns { ok, ... } and never throws.
 */
async function publishIssueToArchive(req, { issueNumber, dateISO, subject, html }) {
  if (!githubConfigured()) {
    return { ok: false, error: 'GITHUB_TOKEN not set', dryRun: true }
  }

  // 1. Wrap email HTML with archive page chrome and commit the issue file
  const wrapped = wrapIssueHtmlForArchive({ html, subject, issueNumber, dateISO })
  const issueResult = await commitFile({
    path: `brew/issues/${issueNumber}.html`,
    content: wrapped,
    message: `Publish ADAS Brew Issue #${issueNumber}`,
  })

  if (!issueResult.ok) {
    return { ok: false, step: 'issue_commit', error: issueResult.error }
  }

  // 2. Upsert the issue's manifest entry in the Datastore
  await dsUpsertIssue(req, {
    issueNumber: Number(issueNumber),
    dateISO,
    subject: String(subject || '').slice(0, 250),
  })

  // 3. Regenerate and commit the archive index from the full Datastore
  const manifest = await readIssuesManifest(req)
  const indexHtml = renderArchiveIndex(manifest)
  const indexResult = await commitFile({
    path: 'brew/archive/index.html',
    content: indexHtml,
    message: `Refresh ADAS Brew archive (latest: #${issueNumber})`,
  })

  return {
    ok: true,
    issueNumber,
    issueUrl: `https://adas-iq.com/brew/issues/${issueNumber}`,
    archiveUrl: `https://adas-iq.com/brew/archive`,
    issueCommit: issueResult.url,
    indexOk: indexResult.ok,
    indexError: indexResult.error || null,
  }
}

// ─── Subscribers (stored in Catalyst Datastore — durable, no eviction) ────
//
// Table: BrewSubscribers
// Columns: email (unique, indexed, mandatory), name, shop, location, role,
//          added_at, source, ip, onboarding_sent (comma-separated step IDs)

function getSubscribersTable(req) {
  return catalyst.initialize(req, { type: 'advancedio' }).datastore().table('BrewSubscribers')
}

function rowToSubscriber(row) {
  return {
    id: String(row.ROWID),
    email: row.email || '',
    name: row.name || '',
    shop: row.shop || '',
    location: row.location || '',
    role: row.role || '',
    added_at: row.added_at || '',
    source: row.source || '',
    ip: row.ip || '',
    onboarding_sent: parseOnboardingSent(row.onboarding_sent),
  }
}

function parseOnboardingSent(str) {
  if (!str) return []
  return String(str).split(',').map(s => s.trim()).filter(Boolean)
}

function subscriberToRow(sub) {
  return {
    email: String(sub.email || '').trim(),
    name: String(sub.name || '').trim().slice(0, 100),
    shop: String(sub.shop || '').trim().slice(0, 200),
    location: String(sub.location || '').trim().slice(0, 100),
    role: String(sub.role || '').trim().slice(0, 60),
    added_at: sub.added_at || new Date().toISOString(),
    source: String(sub.source || '').trim().slice(0, 60),
    ip: String(sub.ip || '').trim().slice(0, 60),
    onboarding_sent: Array.isArray(sub.onboarding_sent) ? sub.onboarding_sent.join(',').slice(0, 200) : '',
  }
}

async function dsFindSubscriberByEmail(req, email) {
  const app = catalyst.initialize(req)
  const safeEmail = String(email).replace(/'/g, "''")
  const result = await app.zcql().executeZCQLQuery(`SELECT * FROM BrewSubscribers WHERE email = '${safeEmail}'`)
  if (result && result.length > 0) {
    return rowToSubscriber(result[0].BrewSubscribers)
  }
  return null
}

async function readSubscribers(req) {
  const table = getSubscribersTable(req)
  const rows = await table.getAllRows()
  return (rows || []).map(rowToSubscriber)
}

async function addSubscriber(req, sub) {
  const existing = await dsFindSubscriberByEmail(req, sub.email)
  if (existing) return { already: true, sub: existing }
  const table = getSubscribersTable(req)
  const row = await table.insertRow(subscriberToRow(sub))
  return { already: false, sub: rowToSubscriber(row) }
}

async function updateSubscriberOnboarding(req, email, onboardingArr) {
  const existing = await dsFindSubscriberByEmail(req, email)
  if (!existing) return null
  const table = getSubscribersTable(req)
  const onboardingStr = Array.isArray(onboardingArr) ? onboardingArr.join(',').slice(0, 200) : ''
  await table.updateRow({ ROWID: existing.id, onboarding_sent: onboardingStr })
  return { ...existing, onboarding_sent: onboardingArr }
}

async function deleteSubscriberByEmail(req, email) {
  const existing = await dsFindSubscriberByEmail(req, email)
  if (!existing) return false
  const table = getSubscribersTable(req)
  await table.deleteRow(existing.id)
  return true
}

function normalizeEmail(e) {
  return String(e || '').trim().toLowerCase()
}

// Stash the rendered HTML at a temp public URL so Zoho can fetch it as content_url.
async function publishHtml(req, html) {
  const segment = getSegment(req)
  const key = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  await cacheSet(segment, `brew_published_${key}`, html)
  // Build the publicly-fetchable URL to this Catalyst function.
  // Strip default ports — Zoho's URL fetcher rejects URLs with explicit :443/:80.
  let host = String(req.headers['x-forwarded-host'] || req.headers['host'] || '')
  let proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0]
  host = host.replace(/:443$/, '').replace(/:80$/, '')
  return `${proto}://${host}/server/adasiq-api/api/cron/brew/published/${key}`
}

// Subscriber management
//   GET    /api/cron/brew/subscribers        — list current subscribers
//   POST   /api/cron/brew/subscribers        — add: { email, name? }
//   DELETE /api/cron/brew/subscribers/:email — remove

cronRouter.get('/subscribers', async (req, res) => {
  try {
    const subs = await readSubscribers(req)
    res.json({ count: subs.length, subscribers: subs })
  } catch (e) {
    console.error('[brew subs GET]', e.message)
    res.status(500).json({ error: e.message })
  }
})

cronRouter.post('/subscribers', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    const name = String(req.body?.name || '').trim().slice(0, 100)
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' })
    }
    const result = await addSubscriber(req, {
      email,
      name,
      shop: String(req.body?.shop || '').trim(),
      added_at: new Date().toISOString(),
      source: 'manual_api',
    })
    const count = (await readSubscribers(req)).length
    if (result.already) {
      return res.json({ ok: true, already: true, count })
    }
    res.json({ ok: true, count })
  } catch (e) {
    console.error('[brew subs POST]', e.message)
    res.status(500).json({ error: e.message })
  }
})

cronRouter.delete('/subscribers/:email', async (req, res) => {
  try {
    const email = normalizeEmail(req.params.email)
    const deleted = await deleteSubscriberByEmail(req, email)
    if (!deleted) {
      return res.status(404).json({ error: 'Not found' })
    }
    const count = (await readSubscribers(req)).length
    res.json({ ok: true, count })
  } catch (e) {
    console.error('[brew subs DELETE]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// After each issue sends, ping the LinkedIn cross-poster (e.g., Kat) with the
// LinkedIn-formatted body so she can paste it into the LinkedIn Newsletter editor.
async function emailLinkedInToCrossPoster({ digest, issueNumber }) {
  const recipient = process.env.BREW_LINKEDIN_RECIPIENT
  if (!recipient) return { skipped: true, reason: 'BREW_LINKEDIN_RECIPIENT not set' }

  const li = renderLinkedIn(digest)
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:680px;margin:0 auto;color:#1a1a1a"><h2 style="color:#CD4419;margin:0 0 4px">ADAS Brew Issue #${issueNumber} — LinkedIn version ready</h2><p style="color:#6b7280;margin:0 0 16px">Hi Kat — please paste the body below into our LinkedIn Newsletter editor. Headline goes in the title field. The body block has hashtags at the bottom — keep them.</p><div style="background:#fff7f3;border:1px solid #f5cfc3;padding:10px 14px;border-radius:8px;color:#7a2b0e;font-size:13px;margin-bottom:16px"><strong>Headline:</strong> ${li.headline.replace(/</g,'&lt;')}</div><pre style="background:#fafafa;border:1px solid #e5e7eb;border-radius:10px;padding:16px;font-family:'IBM Plex Mono',monospace;font-size:13px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word">${li.body.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre><p style="color:#6b7280;font-size:12px;margin-top:24px">— ADAS Brew automation</p></div>`
  const text = `ADAS Brew Issue #${issueNumber} — LinkedIn version\n\nHi Kat — paste the body below into our LinkedIn Newsletter. Headline goes in the title field.\n\nHEADLINE: ${li.headline}\n\n---\n\n${li.body}`

  const r = await sendBroadcast({
    recipients: [recipient],
    subject: `[ADAS Brew #${issueNumber}] LinkedIn version ready to post`,
    html,
    text,
  })
  return r
}

// Send the current digest via Resend to all subscribers.
// preFetched: { items, status } — if provided, skips cache/fetch in buildIssue.
async function sendIssueViaResend(req, preFetched = null) {
  const built = await buildIssue(req, preFetched)
  const subs = await readSubscribers(req)
  const recipients = subs.map(s => s.email).filter(Boolean)
  if (recipients.length === 0) {
    return {
      issueNumber: built.issueNumber,
      itemsConsidered: built.itemsConsidered,
      send: { status: 'error', error: 'No subscribers — add at least one via POST /api/cron/brew/subscribers' },
    }
  }
  const result = await sendBroadcast({
    recipients,
    subject: built.rendered.subject,
    html: built.rendered.html,
    text: built.rendered.text,
  })

  // Bookkeeping FIRST — so the issue counter + datastore record are durable
  // even if the function is torn down before the side-effects below finish.
  if (result.status === 'sent' || result.status === 'partial' || result.status === 'queued') {
    const segment = getSegment(req)
    await recordIssueSent(segment, built.issueNumber, {
      subject: built.rendered.subject,
      status: result.status,
      sent: result.sent,
      failed: result.failed,
      total: result.total,
      dryRun: Boolean(result.dryRun),
    })
    const successIds = (result.results || []).filter(r => r.ok && r.id).map(r => r.id)
    await recordIssueSent_v2(req, {
      issueNumber: built.issueNumber,
      subject: built.rendered.subject,
      sentAt: new Date().toISOString(),
      emailIds: successIds,
    })
  }

  // Stash everything /run-bonus needs to do LinkedIn + archive in its own
  // 30s budget (separate cron, fires ~3 min later). Just the digest JSON +
  // metadata — small and safe for Cache. The bonus endpoint re-renders the
  // HTML from the digest, so we don't have to cache the (much larger) HTML.
  const segmentForStash = getSegment(req)
  const todayStash = {
    digest: built.digest,
    issueNumber: built.issueNumber,
    subject: built.rendered.subject,
    dateISO: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
  }
  await cacheSet(segmentForStash, 'brew_pending_bonus', todayStash)
    .catch(e => console.warn('[brew pending-bonus stash]', e.message))
  // Persistent copy that survives /run-bonus clearing the bonus stash.
  // Used by the tips pipeline later in the day to synthesize a tip card
  // from the current issue's stories.
  await cacheSet(segmentForStash, 'brew_today_digest', todayStash)
    .catch(e => console.warn('[brew today-digest stash]', e.message))

  // emailLinkedInToCrossPoster is fast (just sends a notification email),
  // keep it inline as fire-and-forget — it's already non-blocking.
  emailLinkedInToCrossPoster({ digest: built.digest, issueNumber: built.issueNumber })
    .catch(e => console.warn('[brew linkedin-notify]', e.message))

  return {
    issueNumber: built.issueNumber,
    itemsConsidered: built.itemsConsidered,
    send: result,
    bonus: { queued: true },
  }
}

// Reset issue counter + wipe archive — used once before launch to start at #1.
cronRouter.post('/_reset-archive', async (req, res) => {
  try {
    const segment = getSegment(req)
    const issues = await dsReadAllIssues(req)
    const deleted = []
    const table = getIssuesTable(req)
    // Delete each archived issue file from GitHub + the Datastore row
    for (const it of issues) {
      const r = await deleteFile({
        path: `brew/issues/${it.issueNumber}.html`,
        message: `Reset archive: remove pre-launch test issue #${it.issueNumber}`,
      })
      try {
        await table.deleteRow(it.id)
        deleted.push({ issueNumber: it.issueNumber, ok: r.ok, skipped: r.skipped, error: r.error })
      } catch (delErr) {
        deleted.push({ issueNumber: it.issueNumber, ok: false, error: `row delete: ${delErr.message}` })
      }
    }
    // Reset issue counter to 0 (next issue will be #1)
    await cacheSet(segment, 'brew_meta', { last_issue_number: 0, last_sent_at: null })
    // Regenerate empty archive index
    const indexHtml = renderArchiveIndex([])
    const indexResult = await commitFile({
      path: 'brew/archive/index.html',
      content: indexHtml,
      message: 'Reset archive index — pre-launch wipe',
    })
    res.json({
      ok: true,
      deleted,
      counterReset: true,
      manifestCleared: true,
      indexResult,
    })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

// Manual archive publish — useful for backfilling or retesting an issue.
cronRouter.post('/_publish-archive', async (req, res) => {
  try {
    const built = await buildIssue(req)
    const r = await publishIssueToArchive(req, {
      issueNumber: built.issueNumber,
      dateISO: new Date().toISOString().slice(0, 10),
      subject: built.rendered.subject,
      html: built.rendered.html,
    })
    res.json(r)
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

cronRouter.post('/send', async (req, res) => {
  try {
    const out = await sendIssueViaResend(req)
    res.json(out)
  } catch (e) {
    console.error('[brew cron send]', e.message, e.stack)
    res.status(500).json({ error: e.message })
  }
})

// Returns the day-of-week in Pacific Time (matches subscriber audience).
function dayOfWeekPT() {
  return new Date().toLocaleString('en-US', {
    weekday: 'short',
    timeZone: 'America/Los_Angeles',
  })
}

// Comma-separated list of allowed day abbreviations from BREW_SEND_DAYS env var,
// or default to weekdays (Mon-Fri).
function allowedDays() {
  const env = String(process.env.BREW_SEND_DAYS || 'Mon,Tue,Wed,Thu,Fri').trim()
  return env.split(',').map(s => s.trim()).filter(Boolean)
}

// Fire-and-forget Cliq DM to Mark on /run failure (thrown error OR send.status === 'error').
// Never throws; logs and moves on if Cliq is unreachable.
async function alertCronFailure(label, detail) {
  try {
    const msg = `🚨 ADAS Brew — ${label}\n${detail}`.slice(0, 2000)
    await postToCliqUser(TECH_CLIQ_IDS.Mark, msg)
  } catch (e) {
    console.warn('[brew cliq alert failed]', e.message)
  }
}

cronRouter.post('/run', async (req, res) => {
  try {
    // Server-side day filter — keeps the Catalyst cron simple (fires daily)
    // while restricting actual sends to allowed days. Default: Mon–Fri.
    // Override via BREW_SEND_DAYS env var (e.g. "Mon,Tue,Wed,Thu,Fri").
    // Manual test send any day with ?force=1 query param.
    const force = req.query.force === '1' || req.query.force === 'true'
    if (!force) {
      const today = dayOfWeekPT()
      const allowed = allowedDays()
      if (!allowed.includes(today)) {
        const day = new Date().toLocaleString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' })
        return res.json({ skipped: true, reason: `${day} PT not in allowed list [${allowed.join(', ')}]` })
      }
    }
    // Core path awaited (fetch + digest + Resend + bookkeeping); LinkedIn +
    // archive are handled by the separate /run-bonus cron, scheduled to fire
    // a few minutes after this one. Keeps both endpoints under Catalyst's
    // ~30s HTTP gateway cap.
    const fetched = await fetchAndTrim()
    const out = await sendIssueViaResend(req, { items: fetched.items, status: fetched.status })
    if (out?.send?.status === 'error') {
      alertCronFailure('send failed', `issue #${out.issueNumber}: ${out.send.error || 'unknown'}`)
    }
    res.json({
      fetched: fetched.fetched,
      sources: fetched.status,
      ...out,
    })
  } catch (e) {
    console.error('[brew cron run]', e.message, e.stack)
    alertCronFailure('cron threw', e.message)
    res.status(500).json({ error: e.message })
  }
})

// Build the caption for Facebook + Instagram posts from the digest.
// Includes a one-line brand bridge so Absolute ADAS followers understand
// the relationship between Absolute ADAS (Mark's mobile calibration service),
// ADAS IQ (the software/newsletter brand), and ADAS Brew (this newsletter).
function buildSocialCaption(digest) {
  const subject = String(digest?.subject || '').trim()
  const intro = String(digest?.intro || '').trim()
  const lines = []
  if (subject) lines.push(subject)
  if (intro) lines.push('', intro)
  lines.push('', '5 stories every weekday morning. Free.', 'Subscribe → adas-iq.com/brew')
  lines.push('', 'ADAS Brew is published by ADAS IQ — software we\'re building for collision shops handling ADAS calibration. Built from what we see on the floor at Absolute ADAS (mobile calibration, Western Washington).')
  lines.push('', '#ADAS #CollisionRepair #AutoBodyShop #Calibration #ADASCalibration #InsuranceClaims #OEMRepair')
  return lines.join('\n').slice(0, 2100) // IG cap is 2200, leave headroom
}

// Bonus tasks for the most recently sent issue — runs as a separate Catalyst
// cron a few minutes after /run so the slow tasks (image gen, GitHub commits,
// LinkedIn + FB + IG posts) get their own 30s budget instead of competing
// with the send path. Reads the digest stashed by /run (cache key
// `brew_pending_bonus`), generates the cover image, publishes archive, posts
// to LinkedIn + Facebook Page + Instagram, then clears the stash.
//
// Schedule via a second Catalyst Cron: e.g. daily 6:03 AM PT, POST to
// /api/cron/brew/run-bonus, header X-Cron-Secret: BREW_CRON_SECRET.
cronRouter.post('/run-bonus', async (req, res) => {
  try {
    const segment = getSegment(req)
    const pending = await cacheGet(segment, 'brew_pending_bonus', null)
    if (!pending || !pending.digest || !pending.issueNumber) {
      return res.json({ skipped: true, reason: 'no pending bonus' })
    }

    // Stale guard — don't process a stash older than 6h. Avoids retrying
    // yesterday's bonus when today's /run hasn't fired yet (e.g. weekend).
    const ageMs = Date.now() - new Date(pending.createdAt || 0).getTime()
    if (!Number.isFinite(ageMs) || ageMs > 6 * 60 * 60 * 1000) {
      await cacheSet(segment, 'brew_pending_bonus', null).catch(() => {})
      return res.json({ skipped: true, reason: 'pending bonus is stale (>6h)' })
    }

    const { digest, issueNumber, subject, dateISO } = pending
    const isoDate = dateISO || new Date().toISOString().slice(0, 10)
    const rendered = renderDigest(digest, {
      issueNumber: String(issueNumber),
      dateISO: isoDate,
    })
    const caption = buildSocialCaption(digest)
    const headline = subject || rendered.subject

    // Run the three independent slow tasks in parallel: archive HTML commit,
    // Nano Banana image generation, LinkedIn text generation. Each can fail
    // independently — we report which.
    const [archiveSettled, imageSettled, liTextSettled] = await Promise.allSettled([
      publishIssueToArchive(req, {
        issueNumber,
        dateISO: isoDate,
        subject: headline,
        html: rendered.html,
      }),
      generateCoverImage({ issueNumber, dateISO: isoDate, headline }),
      digestToLinkedInPost(digest).catch(e => ({ _liTextError: e.message || 'failed' })),
    ])

    const archiveResult = archiveSettled.status === 'fulfilled'
      ? archiveSettled.value
      : { ok: false, error: archiveSettled.reason?.message || 'archive failed' }

    const imageResult = imageSettled.status === 'fulfilled'
      ? imageSettled.value
      : { ok: false, error: imageSettled.reason?.message || 'image gen failed' }

    // Upload the generated image to the public archive repo so FB/IG can fetch it.
    let imageUrl = null
    let imageCommitResult = null
    if (imageResult?.ok && imageResult.buffer) {
      try {
        imageCommitResult = await commitBinaryFile({
          path: `brew/images/issue-${issueNumber}.png`,
          buffer: imageResult.buffer,
          message: `Cover image for ADAS Brew Issue #${issueNumber}`,
        })
        if (imageCommitResult.ok) {
          imageUrl = imageCommitResult.rawUrl
        }
      } catch (e) {
        imageCommitResult = { ok: false, error: e.message }
      }
    }

    // LinkedIn post — uses pre-generated text from the parallel step.
    let liResult
    if (liTextSettled.status === 'fulfilled' && liTextSettled.value && !liTextSettled.value._liTextError) {
      try {
        liResult = await postToLinkedIn({ text: liTextSettled.value })
        if (liResult?.ok && liResult.id) {
          const commentText = `If you want a 5-min version of this in your inbox every weekday morning, free → adas-iq.com/brew`
          const cr = await commentOnLinkedInPost(liResult.id, commentText)
          liResult.comment = cr
        }
      } catch (e) {
        liResult = { ok: false, error: e.message }
      }
    } else {
      const err = liTextSettled.status === 'fulfilled'
        ? liTextSettled.value._liTextError
        : liTextSettled.reason?.message || 'linkedin text failed'
      liResult = { ok: false, error: `linkedin-text: ${err}` }
    }

    // FB Page + IG posts — both need the public image URL.
    let fbResult = null
    let igResult = null
    if (imageUrl) {
      const [fbSettled, igSettled] = await Promise.allSettled([
        postToFacebookPage({ imageUrl, caption }),
        postToInstagram({ imageUrl, caption }),
      ])
      fbResult = fbSettled.status === 'fulfilled'
        ? fbSettled.value
        : { ok: false, error: fbSettled.reason?.message || 'fb failed' }
      igResult = igSettled.status === 'fulfilled'
        ? igSettled.value
        : { ok: false, error: igSettled.reason?.message || 'ig failed' }
    } else {
      const reason = imageResult?.ok === false
        ? `image gen failed: ${imageResult.error}`
        : imageCommitResult?.ok === false
        ? `image upload failed: ${imageCommitResult.error}`
        : 'no image url'
      fbResult = { ok: false, error: reason, skipped: true }
      igResult = { ok: false, error: reason, skipped: true }
    }

    // Clear the stash so the next /run-bonus call no-ops until /run queues again
    await cacheSet(segment, 'brew_pending_bonus', null).catch(() => {})

    const failures = []
    if (archiveResult?.ok === false) failures.push(`archive: ${archiveResult.error || 'failed'}`)
    if (liResult?.ok === false) failures.push(`linkedin: ${liResult.error || 'failed'}`)
    if (fbResult?.ok === false && !fbResult.skipped) failures.push(`facebook: ${fbResult.error || 'failed'}`)
    if (igResult?.ok === false && !igResult.skipped) failures.push(`instagram: ${igResult.error || 'failed'}`)
    if (imageResult?.ok === false) failures.push(`image: ${imageResult.error || 'failed'}`)
    if (failures.length) {
      alertCronFailure('bonus partial', `issue #${issueNumber} — ${failures.join('; ')}`)
    }

    res.json({
      issueNumber,
      archive: archiveResult,
      image: imageResult?.ok ? { ok: true, url: imageUrl } : imageResult,
      linkedin: liResult,
      facebook: fbResult,
      instagram: igResult,
    })
  } catch (e) {
    console.error('[brew cron run-bonus]', e.message, e.stack)
    alertCronFailure('run-bonus threw', e.message)
    res.status(500).json({ error: e.message })
  }
})
