// ADAS Brew archive — auto-publishes each issue to GitHub Pages
// (markfowler01/adas-iq-landing) so it's served from adas-iq.com/brew/issues/N
// and an archive index at adas-iq.com/brew/archive.
//
// Required env vars:
//   GITHUB_TOKEN          — Personal Access Token with `repo` scope
// Optional env vars:
//   GITHUB_REPO_OWNER     — default: markfowler01
//   GITHUB_REPO_NAME      — default: adas-iq-landing
//   GITHUB_BRANCH         — default: main

import axios from 'axios'

const GH_API = 'https://api.github.com'

function envBundle() {
  return {
    token: process.env.GITHUB_TOKEN || '',
    owner: process.env.GITHUB_REPO_OWNER || 'markfowler01',
    repo: process.env.GITHUB_REPO_NAME || 'adas-iq-landing',
    branch: process.env.GITHUB_BRANCH || 'main',
  }
}

function isConfigured() {
  return Boolean(envBundle().token)
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/**
 * Get the SHA of an existing file at `path`, or null if not found.
 */
async function getFileSha({ owner, repo, branch, path, token }) {
  try {
    const res = await axios.get(
      `${GH_API}/repos/${owner}/${repo}/contents/${encodeURIPath(path)}`,
      { headers: ghHeaders(token), params: { ref: branch }, timeout: 12000, validateStatus: s => s < 500 }
    )
    if (res.status === 200 && res.data?.sha) return res.data.sha
    return null
  } catch {
    return null
  }
}

function encodeURIPath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/')
}

/**
 * Create or update a file in the repo. Returns { ok, sha, url } or { ok:false, error }.
 */
export async function commitFile({ path, content, message }) {
  if (!isConfigured()) {
    return { ok: false, error: 'GITHUB_TOKEN not set', dryRun: true }
  }
  const e = envBundle()
  const sha = await getFileSha({ ...e, path, token: e.token })
  const body = {
    message: String(message || `update ${path}`).slice(0, 200),
    content: Buffer.from(String(content), 'utf-8').toString('base64'),
    branch: e.branch,
  }
  if (sha) body.sha = sha

  try {
    const res = await axios.put(
      `${GH_API}/repos/${e.owner}/${e.repo}/contents/${encodeURIPath(path)}`,
      body,
      { headers: ghHeaders(e.token), timeout: 20000, validateStatus: s => s < 500 }
    )
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, sha: res.data?.content?.sha, url: res.data?.content?.html_url }
    }
    return { ok: false, error: `GitHub ${res.status}: ${JSON.stringify(res.data).slice(0, 400)}` }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * Commit a Buffer of binary content (e.g. PNG). Same shape as commitFile but
 * preserves bytes. Returns { ok, rawUrl } where rawUrl is the public raw URL
 * suitable for handing to FB/IG Graph API (which fetch the image themselves).
 */
export async function commitBinaryFile({ path, buffer, message }) {
  if (!isConfigured()) {
    return { ok: false, error: 'GITHUB_TOKEN not set', dryRun: true }
  }
  if (!Buffer.isBuffer(buffer)) {
    return { ok: false, error: 'buffer arg must be a Buffer' }
  }
  const e = envBundle()
  const sha = await getFileSha({ ...e, path, token: e.token })
  const body = {
    message: String(message || `update ${path}`).slice(0, 200),
    content: buffer.toString('base64'),
    branch: e.branch,
  }
  if (sha) body.sha = sha

  try {
    const res = await axios.put(
      `${GH_API}/repos/${e.owner}/${e.repo}/contents/${encodeURIPath(path)}`,
      body,
      { headers: ghHeaders(e.token), timeout: 30000, validateStatus: s => s < 500 }
    )
    if (res.status >= 200 && res.status < 300) {
      const rawUrl = `https://raw.githubusercontent.com/${e.owner}/${e.repo}/${e.branch}/${encodeURIPath(path)}`
      return { ok: true, sha: res.data?.content?.sha, rawUrl }
    }
    return { ok: false, error: `GitHub ${res.status}: ${JSON.stringify(res.data).slice(0, 400)}` }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// ─── Page chrome / templating ────────────────────────────────────────────────

const SUBSCRIBE_BANNER = `<div style="background:#CD4419;color:#fff;padding:12px 20px;text-align:center;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px"><a href="/brew" style="color:#fff;text-decoration:none;font-weight:700">☕ ADAS Brew · Free, Every Weekday Morning · Subscribe →</a></div>`

const ARCHIVE_FOOTER = `<div style="max-width:640px;margin:0 auto;padding:32px 24px;text-align:center;border-top:1px solid #ececec;font-family:-apple-system,Helvetica,Arial,sans-serif"><p style="font-size:14px;color:#6b7280;margin:0 0 14px">Read more issues in the <a href="/brew/archive" style="color:#CD4419;font-weight:600;text-decoration:none">ADAS Brew archive</a> · or <a href="/brew" style="color:#CD4419;font-weight:600;text-decoration:none">subscribe</a> to get them by email.</p></div>`

/**
 * Wrap the issue's email HTML with archive page chrome (subscribe banner top,
 * archive footer bottom).
 */
export function wrapIssueHtmlForArchive({ html, subject, issueNumber, dateISO }) {
  const safeSubject = String(subject || `ADAS Brew — Issue #${issueNumber}`).replace(/[<>"]/g, '')
  const dateLabel = new Date(dateISO).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  // Inject the banner right after <body> and the footer right before </body>.
  // The email HTML is self-contained; we're just adding chrome.
  const withBanner = String(html)
    .replace(/<body([^>]*)>/i, `<body$1>${SUBSCRIBE_BANNER}`)
    .replace(/<\/body>/i, `${ARCHIVE_FOOTER}</body>`)

  // Also tweak the <title> to include the issue subject + number.
  const withTitle = withBanner.replace(
    /<title>[^<]*<\/title>/i,
    `<title>${safeSubject} · ADAS Brew #${issueNumber} · ${dateLabel}</title>`
  )

  // Add canonical + meta description for SEO
  const meta = `<link rel="canonical" href="https://adas-iq.com/brew/issues/${issueNumber}"><meta name="description" content="ADAS Brew Issue #${issueNumber} — ${safeSubject}"><meta property="og:title" content="${safeSubject}"><meta property="og:description" content="ADAS Brew · ${dateLabel}"><meta property="og:type" content="article">`
  return withTitle.replace(/<\/head>/i, `${meta}</head>`)
}

/**
 * Render the archive index page from an array of issue manifest entries.
 */
export function renderArchiveIndex(issues) {
  // Sort by issue number descending (newest first)
  const sorted = [...issues].sort((a, b) => Number(b.issueNumber) - Number(a.issueNumber))

  const rows = sorted.map(it => {
    const dateLabel = new Date(it.dateISO).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const subject = String(it.subject || `Issue #${it.issueNumber}`).replace(/[<>"]/g, '')
    return `<a class="row" href="/brew/issues/${it.issueNumber}"><div class="row-date">${dateLabel}</div><div class="row-subject">${subject}</div><div class="row-num">#${it.issueNumber}</div></a>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ADAS Brew · Archive</title>
<meta name="description" content="Past issues of ADAS Brew — the calibration and body shop industry digest.">
<link rel="canonical" href="https://adas-iq.com/brew/archive">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, 'Inter', Helvetica, Arial, sans-serif; background: #0d0d0d; color: #fff; min-height: 100vh; padding: 56px 24px; line-height: 1.5; }
.wrap { max-width: 720px; margin: 0 auto; }
.brand { font-family: monospace; font-size: 12px; font-weight: 700; letter-spacing: .22em; color: #CD4419; text-transform: uppercase; margin-bottom: 16px; text-align: center; }
h1 { font-size: clamp(34px, 5vw, 44px); font-weight: 900; line-height: 1.1; margin: 0 0 12px; text-align: center; }
.lede { font-size: 16px; color: #ccc; margin: 0 0 28px; text-align: center; max-width: 540px; margin-left: auto; margin-right: auto; }
.subscribe { display: block; max-width: 380px; margin: 0 auto 36px; padding: 14px 24px; background: #CD4419; color: #fff; text-align: center; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 15px; }
.subscribe:hover { background: #e8541f; }
.list { background: #151515; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06); }
.row { display: grid; grid-template-columns: 110px 1fr 60px; gap: 14px; padding: 16px 20px; align-items: center; color: #f0ece6; text-decoration: none; border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.15s; }
.row:last-child { border-bottom: none; }
.row:hover { background: #1e1e1e; }
.row-date { font-family: monospace; font-size: 13px; color: #999; }
.row-subject { font-size: 16px; font-weight: 500; line-height: 1.4; }
.row-num { font-family: monospace; font-size: 13px; color: #CD4419; text-align: right; font-weight: 700; }
.empty { text-align: center; padding: 48px 24px; color: #999; }
@media (max-width: 600px) { .row { grid-template-columns: 90px 1fr; } .row-num { display: none; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">ADAS Brew · Archive</div>
  <h1>Past issues</h1>
  <p class="lede">A weekday digest for collision shop owners, production managers, and calibration techs. Free, every weekday at 6am Pacific.</p>
  <a class="subscribe" href="/brew">Subscribe to ADAS Brew →</a>
  <div class="list">
    ${sorted.length ? rows : '<div class="empty">No issues yet. The first one lands the next weekday at 6am Pacific.</div>'}
  </div>
</div>
</body>
</html>`
}

export const githubConfigured = isConfigured

/**
 * Delete a file from the repo. Returns { ok } or { ok:false, error }.
 */
export async function deleteFile({ path, message }) {
  if (!isConfigured()) {
    return { ok: false, error: 'GITHUB_TOKEN not set', dryRun: true }
  }
  const e = envBundle()
  const sha = await getFileSha({ ...e, path, token: e.token })
  if (!sha) {
    return { ok: true, skipped: true, reason: 'file not found' }
  }
  try {
    const res = await axios.delete(
      `${GH_API}/repos/${e.owner}/${e.repo}/contents/${encodeURIPath(path)}`,
      {
        headers: ghHeaders(e.token),
        data: {
          message: String(message || `delete ${path}`).slice(0, 200),
          sha,
          branch: e.branch,
        },
        timeout: 20000,
        validateStatus: s => s < 500,
      }
    )
    if (res.status >= 200 && res.status < 300) return { ok: true }
    return { ok: false, error: `GitHub ${res.status}: ${JSON.stringify(res.data).slice(0, 400)}` }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
