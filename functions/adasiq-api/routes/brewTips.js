// Absolute ADAS calibration-tip daily post pipeline.
//
//   GET  /api/cron/brew-tips/submit       — open in browser, see the form
//   POST /api/cron/brew-tips/submit       — submit a tip from the form (queues it)
//   GET  /api/cron/brew-tips/queue        — list pending tips
//   DELETE /api/cron/brew-tips/queue/:id  — remove a pending tip
//   POST /api/cron/brew-tips/run          — main daily cron; picks queue or
//                                            synthesizes from today's brew digest
//
// Cron secret env: BREW_CRON_SECRET (shared with the brew newsletter).

import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { assembleTipCard } from '../services/tipsAssembly.js'
import { generateTipCardImage } from '../services/nanoBanana.js'
import { composeTipImage } from '../services/tipImageComposite.js'
import { commitBinaryFile } from '../services/brewArchive.js'
import { postToFacebookPage, postToInstagram, facebookConfigured, instagramConfigured, commentOnFacebookPost, commentOnInstagramMedia, readFacebookPostComments, listFacebookPagePosts } from '../services/metaPosting.js'
import { postToCliqUser, TECH_CLIQ_IDS } from '../services/cliq.js'

// ─── Cache helpers (same shape as brew.js) ──────────────────────────────────
function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}
// Named handoff segment shared with brew.js. Must match getHandoffSegment()
// in brew.js or brew_today_digest reads will return null.
function getHandoffSegment(req) {
  return catalyst.initialize(req).cache().segment('brew_handoff')
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
function normalizeSecret(s) {
  return String(s || '').replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
}
function requireCronSecret(req, res, next) {
  const cronSecret = normalizeSecret(process.env.BREW_CRON_SECRET)
  const provided = normalizeSecret(req.headers['x_cron_secret'] || req.headers['x-cron-secret'] || '')
  if (cronSecret && provided !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}
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

// ─── Queue helpers ──────────────────────────────────────────────────────────
const QUEUE_KEY = 'brew_tips_queue'

async function readQueue(req) {
  const seg = getSegment(req)
  const q = await cacheGet(seg, QUEUE_KEY, [])
  return Array.isArray(q) ? q : []
}
async function writeQueue(req, items) {
  const seg = getSegment(req)
  await cacheSet(seg, QUEUE_KEY, items.slice(0, 50)) // hard cap at 50 pending tips
}

// ─── Routes ─────────────────────────────────────────────────────────────────
export const tipsRouter = express.Router()

// HTML form to submit a tip — protected by ?secret=<BREW_CRON_SECRET>
tipsRouter.get('/submit', requireCronSecretFlex, (req, res) => {
  const secret = String(req.query.secret || '').replace(/[^a-zA-Z0-9_-]/g, '')
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Queue an ADAS Brew Tip</title><style>*{box-sizing:border-box}body{margin:0;background:#0d0d0d;color:#fff;font-family:-apple-system,Helvetica,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 16px}.card{background:#151515;max-width:560px;width:100%;border-radius:14px;padding:36px 32px;border-top:4px solid #CD4419}.brand{font-family:monospace;font-size:11px;font-weight:700;letter-spacing:.22em;color:#CD4419;text-transform:uppercase;margin-bottom:10px}h1{font-size:26px;margin:0 0 8px;font-weight:800}.lede{color:#999;font-size:14px;line-height:1.55;margin:0 0 24px}label{display:block;font-size:13px;font-weight:600;color:#ddd;margin:14px 0 6px}input,textarea{width:100%;padding:11px 14px;font-size:15px;border:1.5px solid #2a2a2a;border-radius:8px;background:#0d0d0d;color:#fff;font-family:inherit}textarea{min-height:120px;resize:vertical;line-height:1.5}input:focus,textarea:focus{outline:none;border-color:#CD4419}button{display:block;width:100%;background:#CD4419;color:#fff;font-size:15px;font-weight:700;padding:13px 22px;border-radius:8px;border:none;cursor:pointer;margin-top:20px;font-family:inherit}button:hover{background:#b53a15}button:disabled{opacity:.6;cursor:not-allowed}.hint{font-size:12px;color:#999;margin-top:4px;line-height:1.4}.msg{padding:12px 14px;border-radius:8px;font-size:14px;margin-top:16px}.ok{background:rgba(34,197,94,.12);color:#86efac;border:1px solid rgba(134,239,172,.3)}.err{background:rgba(239,68,68,.12);color:#fca5a5;border:1px solid rgba(252,165,165,.3)}.foot{font-size:12px;color:#666;margin-top:20px;text-align:center}.foot a{color:#CD4419;text-decoration:none}</style></head><body><div class="card"><div class="brand">Absolute ADAS · Tip Queue</div><h1>Queue a calibration-tip post</h1><p class="lede">Drop an idea here; the next morning's tip cron will pick it up (or fall back to today's brew if no tips are queued).</p><form id="f" onsubmit="return s(event)"><label for="headline">Headline <span style="color:#999;font-weight:400">(4–9 words)</span></label><input id="headline" name="headline" type="text" required maxlength="120" placeholder="e.g. What technicians check before calibration starts"><div class="hint">Punchy. Imperative or noun-phrase. Claude will polish it.</div><label for="bullets">Bullets <span style="color:#999;font-weight:400">(one per line, 3–6 items)</span></label><textarea id="bullets" name="bullets" required placeholder="Scan for system faults&#10;Inspect sensors and cameras&#10;Verify vehicle condition&#10;Confirm alignment is correct&#10;Check OEM requirements&#10;Ensure proper environment"></textarea><div class="hint">Each 3–7 words. Concrete and specific.</div><label for="notes">Notes / context <span style="color:#999;font-weight:400">(optional)</span></label><textarea id="notes" name="notes" placeholder="Any background, examples, or angle you want Claude to lean into."></textarea><button id="b" type="submit">Queue tip</button></form><div id="m" class="msg" style="display:none"></div><p class="foot"><a href="queue?secret=${secret}">View pending queue</a> · <a href="https://absoluteadas.com/brew">absoluteadas.com/brew</a></p></div><script>const SEC=${JSON.stringify(secret)};async function s(e){e.preventDefault();const b=document.getElementById('b'),m=document.getElementById('m');b.disabled=true;b.textContent='Queueing...';m.style.display='none';try{const r=await fetch('submit?secret='+encodeURIComponent(SEC),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({headline:document.getElementById('headline').value,bullets:document.getElementById('bullets').value,notes:document.getElementById('notes').value})});const d=await r.json();if(r.ok&&d.ok){m.className='msg ok';m.textContent='Queued. Position #'+d.position+' in line. Will go out the next time the tip cron fires (no tip queued = falls back to today\\'s brew).';m.style.display='block';document.getElementById('f').reset();b.textContent='Queue another'}else{m.className='msg err';m.textContent=d.error||'Submission failed.';m.style.display='block';b.disabled=false;b.textContent='Queue tip'}}catch(err){m.className='msg err';m.textContent='Network error.';m.style.display='block';b.disabled=false;b.textContent='Queue tip'}return false}</script></body></html>`)
})

tipsRouter.post('/submit', express.json({ limit: '64kb' }), requireCronSecretFlex, async (req, res) => {
  try {
    const headline = String(req.body?.headline || '').trim().slice(0, 200)
    const bulletsRaw = String(req.body?.bullets || '').trim()
    const notes = String(req.body?.notes || '').trim().slice(0, 800)

    if (!headline) return res.status(400).json({ ok: false, error: 'headline required' })
    if (!bulletsRaw) return res.status(400).json({ ok: false, error: 'bullets required' })

    const bullets = bulletsRaw
      .split('\n')
      .map(s => s.replace(/^[-•*\d.\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 8)
    if (bullets.length === 0) {
      return res.status(400).json({ ok: false, error: 'at least one bullet required' })
    }

    const tip = {
      id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      headline,
      bullets,
      notes,
      submittedAt: new Date().toISOString(),
    }
    const queue = await readQueue(req)
    queue.push(tip)
    await writeQueue(req, queue)

    res.json({ ok: true, id: tip.id, position: queue.length })
  } catch (e) {
    console.error('[tips submit]', e.message, e.stack)
    res.status(500).json({ ok: false, error: e.message })
  }
})

tipsRouter.get('/queue', requireCronSecretFlex, async (req, res) => {
  try {
    const queue = await readQueue(req)
    res.json({ ok: true, count: queue.length, items: queue })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

tipsRouter.delete('/queue/:id', requireCronSecretFlex, async (req, res) => {
  try {
    const queue = await readQueue(req)
    const filtered = queue.filter(t => t.id !== req.params.id)
    if (filtered.length === queue.length) {
      return res.status(404).json({ ok: false, error: 'not found' })
    }
    await writeQueue(req, filtered)
    res.json({ ok: true, removed: req.params.id, remaining: filtered.length })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ─── Godfather Offer comment (Sabri-Suby style direct-response CTA) ─────────
// Posted as the first comment on every Marketing post on FB and IG. Direct,
// risk-reversed, scarcity-tagged. The phone is the alt-path for shops that
// don't want to comment publicly.
function buildOfferComment() {
  return [
    '👉 Stuck on a calibration denial or short-pay?',
    '',
    '📩 Tap to DM me: https://m.me/715304948324709',
    '📞 Call or text: 1-844-FIX-ADAS (1-844-349-2327)',
    '💬 Or reply "AUDIT" below — I\'ll reach out',
    '',
    'I\'ll write the OEM-cited rebuttal that flips your denial — free, 24h turnaround, no pitch. I take 2-3 shops a week.',
    '',
    '— Mark Fowler, Absolute ADAS',
  ].join('\n')
}

// ─── Failure alert (mirrors brew.js pattern) ────────────────────────────────
// The daily tip-post pipeline is named "Marketing" internally — see Cliq DMs.
async function alertTipsFailure(label, detail) {
  try {
    const msg = `🚨 Marketing — ${label}\n${detail}`.slice(0, 2000)
    await postToCliqUser(TECH_CLIQ_IDS.Mark, msg)
  } catch (e) {
    console.warn('[Marketing cliq alert failed]', e.message)
  }
}

// ─── Main cron handler ──────────────────────────────────────────────────────
// Add ?dry_run=1 to skip FB+IG posting and just return the image URL +
// generated headline/bullets/caption — useful for previewing the look.
tipsRouter.post('/run', requireCronSecret, async (req, res) => {
  const dryRun = req.query.dry_run === '1' || req.query.dry_run === 'true'
  try {
    // 1. Try the manual queue first
    const queue = await readQueue(req)
    let manualTip = null
    if (queue.length > 0 && !dryRun) {
      manualTip = queue.shift() // take oldest
    }

    // 2. Build the tip card via Claude — manual idea if queued, else brew digest
    let card
    let source
    if (manualTip) {
      card = await assembleTipCard({ manualTip })
      source = 'manual'
    } else {
      // Fall back to today's brew digest (read from the named handoff segment
      // that brew.js /run writes to — default segment scoping was unreliable)
      const seg = getHandoffSegment(req)
      const today = await cacheGet(seg, 'brew_today_digest', null)
      if (!today || !today.digest) {
        return res.json({
          skipped: true,
          reason: 'no queued tip and no brew_today_digest in cache (run /run first)',
        })
      }
      // Stale guard — don't repurpose a digest older than 12h
      const ageMs = Date.now() - new Date(today.createdAt || 0).getTime()
      if (!Number.isFinite(ageMs) || ageMs > 12 * 60 * 60 * 1000) {
        return res.json({ skipped: true, reason: 'brew_today_digest is stale (>12h)' })
      }
      card = await assembleTipCard({ brewDigest: today.digest })
      source = 'brew-synthesis'
    }

    // 3. Generate the PHOTO background via Nano Banana — Claude picked a
    // thematic photo subject that matches the tip's topic
    const photo = await generateTipCardImage({ photoSubject: card.photoSubject })
    if (!photo.ok) {
      if (manualTip) {
        const q = await readQueue(req)
        q.unshift(manualTip)
        await writeQueue(req, q)
      }
      alertTipsFailure('image gen failed', photo.error)
      return res.status(500).json({ error: `image gen: ${photo.error}`, restoredQueue: !!manualTip })
    }

    // 3b. Composite eyebrow + headline + 3 bullets + CTA + logo footer ON TOP
    // of the photo, in code, so brand color, typography, and logo are exact.
    let finalBuffer
    try {
      finalBuffer = await composeTipImage({
        photoBuffer: photo.buffer,
        eyebrow: card.eyebrow,
        headline: card.headline,
        headlineEmphasis: card.headlineEmphasis,
        bullets: card.bullets,
      })
    } catch (e) {
      if (manualTip) {
        const q = await readQueue(req)
        q.unshift(manualTip)
        await writeQueue(req, q)
      }
      alertTipsFailure('compose failed', e.message)
      return res.status(500).json({ error: `compose: ${e.message}`, restoredQueue: !!manualTip })
    }

    // 4. Upload the composited image to GitHub for a public URL
    const imageCommit = await commitBinaryFile({
      path: `brew/images/tip-${new Date().toISOString().slice(0, 10)}-${Date.now()}.png`,
      buffer: finalBuffer,
      message: `Daily Absolute ADAS tip card: ${card.headline}`,
    })
    if (!imageCommit.ok) {
      if (manualTip) {
        const q = await readQueue(req)
        q.unshift(manualTip)
        await writeQueue(req, q)
      }
      alertTipsFailure('image upload failed', imageCommit.error)
      return res.status(500).json({ error: `image upload: ${imageCommit.error}`, restoredQueue: !!manualTip })
    }

    // Dry-run exit — return the image + tip card without consuming the queue
    // or posting to FB/IG. Useful for previewing the daily output.
    if (dryRun) {
      return res.json({
        dryRun: true,
        source,
        eyebrow: card.eyebrow,
        headline: card.headline,
        headlineEmphasis: card.headlineEmphasis,
        bullets: card.bullets,
        photoSubject: card.photoSubject,
        caption: card.caption,
        image: { ok: true, url: imageCommit.rawUrl },
      })
    }

    // 5. Commit queue write — already consumed manualTip via shift(); persist
    if (manualTip) {
      const q = await readQueue(req)
      // queue was already shifted in-memory but not yet persisted
      // (we did the work above before persisting in case posting fails midway)
      const stillThere = q.find(t => t.id === manualTip.id)
      if (stillThere) {
        await writeQueue(req, q.filter(t => t.id !== manualTip.id))
      }
    }

    // 6. Post to FB + IG in parallel
    const caption = card.caption || ''
    const [fbSettled, igSettled] = await Promise.allSettled([
      facebookConfigured()
        ? postToFacebookPage({ imageUrl: imageCommit.rawUrl, caption })
        : Promise.resolve({ ok: false, error: 'FB not configured', skipped: true }),
      instagramConfigured()
        ? postToInstagram({ imageUrl: imageCommit.rawUrl, caption })
        : Promise.resolve({ ok: false, error: 'IG not configured', skipped: true }),
    ])
    const fbResult = fbSettled.status === 'fulfilled'
      ? fbSettled.value
      : { ok: false, error: fbSettled.reason?.message || 'fb failed' }
    const igResult = igSettled.status === 'fulfilled'
      ? igSettled.value
      : { ok: false, error: igSettled.reason?.message || 'ig failed' }

    // 7. Auto-post a "Godfather Offer" comment on each successful post.
    // FB allows author comments via Graph API; IG requires instagram_manage_comments
    // permission and may fail silently — treated as non-fatal.
    const offerComment = buildOfferComment()
    let fbComment = null
    let igComment = null
    if (fbResult?.ok && fbResult.id) {
      fbComment = await commentOnFacebookPost({ postId: fbResult.id, message: offerComment })
        .catch(e => ({ ok: false, error: e.message }))
    }
    if (igResult?.ok && igResult.id) {
      igComment = await commentOnInstagramMedia({ mediaId: igResult.id, message: offerComment })
        .catch(e => ({ ok: false, error: e.message }))
    }

    // 8. Failure alerts
    const failures = []
    if (fbResult?.ok === false && !fbResult.skipped) failures.push(`facebook: ${fbResult.error}`)
    if (igResult?.ok === false && !igResult.skipped) failures.push(`instagram: ${igResult.error}`)
    if (failures.length) {
      alertTipsFailure('post partial', `${card.headline} — ${failures.join('; ')}`)
    }

    res.json({
      source,
      headline: card.headline,
      bullets: card.bullets,
      image: { ok: true, url: imageCommit.rawUrl },
      facebook: fbResult,
      facebookComment: fbComment,
      instagram: igResult,
      instagramComment: igComment,
      caption,
    })
  } catch (e) {
    console.error('[tips run]', e.message, e.stack)
    alertTipsFailure('cron threw', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── Comment watcher: poll FB Page posts for "AUDIT" replies ────────────────
// Runs as its own cron (separate from the daily /run); scans recent Page
// posts, finds new "AUDIT" comments, and DMs Mark via Cliq. Already-notified
// comment IDs are tracked in cache so each lead pings only once.
//
// Cron suggestion: every 30 min, POST /api/cron/brew-tips/watch-comments
const NOTIFIED_KEY = 'marketing_notified_comments'
const AUDIT_KEYWORDS = ['audit', 'a u d i t', 'auditt', 'auidt'] // tolerate typos

tipsRouter.post('/watch-comments', requireCronSecret, async (req, res) => {
  try {
    const postsRes = await listFacebookPagePosts({ limit: 12 })
    if (!postsRes.ok) {
      return res.status(500).json({ error: `list posts: ${postsRes.error}` })
    }
    const seg = getSegment(req)
    const notified = new Set(await cacheGet(seg, NOTIFIED_KEY, []) || [])
    const newLeads = []
    for (const post of postsRes.posts) {
      const c = await readFacebookPostComments({ postId: post.id, limit: 50 })
      if (!c.ok) continue
      for (const comment of c.comments) {
        if (notified.has(comment.id)) continue
        const lower = String(comment.message || '').toLowerCase()
        const isAudit = AUDIT_KEYWORDS.some(k => lower.includes(k))
        if (!isAudit) continue
        newLeads.push({
          commentId: comment.id,
          from: comment.from?.name || 'Unknown',
          fromId: comment.from?.id || '',
          message: comment.message || '',
          createdTime: comment.created_time,
          postId: post.id,
          postSnippet: String(post.message || '').slice(0, 120),
        })
        notified.add(comment.id)
      }
    }

    // DM Mark for each new lead (one Cliq message per lead so each gets attention)
    for (const lead of newLeads) {
      const msg = [
        '🎯 New AUDIT lead — Marketing',
        '',
        `From: ${lead.from}`,
        `Comment: "${lead.message.slice(0, 400)}"`,
        `Time: ${lead.createdTime}`,
        '',
        `On post: ${lead.postSnippet}…`,
        `https://www.facebook.com/${lead.postId.replace('_', '/posts/')}`,
      ].join('\n')
      try {
        await postToCliqUser(TECH_CLIQ_IDS.Mark, msg.slice(0, 2000))
      } catch (e) {
        console.warn('[Marketing watch cliq]', e.message)
      }
    }

    // Cap notified set at 500 entries — drop the oldest if larger
    let notifiedArr = Array.from(notified)
    if (notifiedArr.length > 500) {
      notifiedArr = notifiedArr.slice(-500)
    }
    await cacheSet(seg, NOTIFIED_KEY, notifiedArr)

    res.json({
      ok: true,
      postsScanned: postsRes.posts.length,
      newLeads: newLeads.length,
      leads: newLeads,
    })
  } catch (e) {
    console.error('[Marketing watch-comments]', e.message, e.stack)
    alertTipsFailure('watch-comments threw', e.message)
    res.status(500).json({ error: e.message })
  }
})
