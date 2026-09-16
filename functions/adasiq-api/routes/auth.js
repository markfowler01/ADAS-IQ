import express from 'express'
import axios from 'axios'
import crypto from 'crypto'
import catalyst from 'zcatalyst-sdk-node'

// Sign-in + first-open-of-the-day alerts to Mark (2026-09-16: "I am not
// getting Cliq notifications when people login"). Real sign-ins are rare
// now that tokens last 30 days, so the first app open of each PT day
// pings too (deduped per person per day in Cache, 24h). Never for Mark,
// never for demo, never blocks the response for more than 6s.
const _openedToday = new Set()
async function pingMark(text) {
  const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
  await Promise.race([
    postToCliqChannelById(MARK_ALERT_CHANNEL_ID, text),
    new Promise((_, rej) => setTimeout(() => rej(new Error('cliq ping timed out (6s)')), 6000)),
  ])
}
function skipAlerts(user) {
  const e = String(user?.email || '').toLowerCase()
  return !e || ['mark@absoluteadas.com', 'mf@absoluteadas.com', 'mfowler4456@gmail.com'].includes(e) || /demo/.test(e)
}
const ptNow = () => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date())
const ptDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
async function firstOpenPing(req, user) {
  if (skipAlerts(user)) return
  const key = `first_open:${ptDay()}:${String(user.email).toLowerCase()}`
  if (_openedToday.has(key)) return
  _openedToday.add(key)
  try {
    const seg = catalyst.initialize(req).cache().segment()
    let seen = null
    try { seen = await seg.getValue(key) } catch { seen = null }
    if (seen) return
    try { await seg.put(key, new Date().toISOString(), 24) } catch { try { await seg.update(key, new Date().toISOString()) } catch {} }
    await pingMark(`👋 *${user.name || user.email} opened the app* at ${ptNow()} (first time today)`)
  } catch (e) { console.warn('[auth] first-open ping failed:', e.message) }
}

const router = express.Router()

const ZOHO_AUTH_URL = 'https://accounts.zoho.com/oauth/v2/auth'
const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'
const ZOHO_USER_URL  = 'https://accounts.zoho.com/oauth/v2/userinfo'

const LOGIN_CLIENT_ID     = process.env.ZOHO_LOGIN_CLIENT_ID     || ''
const LOGIN_CLIENT_SECRET = process.env.ZOHO_LOGIN_CLIENT_SECRET || ''
const CLIENT_APP_URL      = process.env.CLIENT_URL || 'https://adas-iq-904191467.development.catalystserverless.com/app/index.html'
const SECRET              = process.env.SESSION_SECRET || 'adasiq-secret-2026'

if (!LOGIN_CLIENT_ID || !LOGIN_CLIENT_SECRET) {
  console.error('❌ ZOHO_LOGIN_CLIENT_ID and ZOHO_LOGIN_CLIENT_SECRET must be set as environment variables.')
}

// Role map — keyed by lowercase email (Mark 2026-08-30 permissions):
//   owner       — Mark: everything incl. payroll, approvals, settings
//                 Kat too (Mark 2026-09-15: "I want Kat to have permission
//                 for everything"). The only things still keyed to Mark's
//                 own email: 💬 Text as Mark (his personal cell), PTO /
//                 time-card approvals.
//   dispatcher  — full operations incl. all invoicing/quoting
//   technician  — field view: jobs, time clock, photos, navigation
// Unrecognised logins get dispatcher (staff) — owners are explicit.
const USER_ROLES = {
  'mark@absoluteadas.com':      { role: 'owner' },
  'mf@absoluteadas.com':        { role: 'owner' },   // Mark's mailbox — what Zoho login actually sends (2026-09-16)
  'mfowler4456@gmail.com':      { role: 'owner' },   // Mark's personal Zoho identity, just in case
  'k.belmonte@absoluteadas.com': { role: 'owner' },
  'jayden@absoluteadas.com':    { role: 'technician', techName: 'Jaden' },
}
function applyRole(email) {
  return USER_ROLES[(email || '').toLowerCase()] || { role: 'dispatcher' }
}

// ── Token helpers (stateless JWT-like, no library needed) ─────────────────────

function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({
    user,
    // 30 days (was 8h — Kat's early login expired mid-afternoon and every
    // save then failed quietly, 2026-09-15). The client now signs you out
    // on a 401 instead of pretending the page still works.
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  })).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyToken(token) {
  try {
    if (!token) return null
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const payload = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
    if (sig !== expected) return null
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (data.exp < Date.now()) return null
    return data.user
  } catch { return null }
}

function getRedirectUri() { return CLIENT_APP_URL }

// GET /auth/zoho — kick off Zoho login
router.get('/zoho', (req, res) => {
  const redirectUri = getRedirectUri()
  console.log('[auth] redirect_uri =', redirectUri)
  // Fix #5 — generate and store OAuth state to prevent CSRF
  const state = crypto.randomBytes(16).toString('hex')
  req.session.oauthState = state
  const params = new URLSearchParams({
    client_id:     LOGIN_CLIENT_ID,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'AaaServer.profile.Read',
    access_type:   'online',
    prompt:        'consent',
    state,
  })
  res.redirect(`${ZOHO_AUTH_URL}?${params}`)
})

// POST /auth/exchange — frontend sends the Zoho code here after redirect
router.post('/exchange', async (req, res) => {
  const { code, state } = req.body
  if (!code) return res.status(400).json({ error: 'Missing code' })

  // Fix #5 — validate state to prevent CSRF during login
  if (req.session?.oauthState) {
    if (!state || state !== req.session.oauthState) {
      return res.status(400).json({ error: 'Invalid login state. Please try signing in again.' })
    }
    req.session.oauthState = null
  }

  try {
    const tokenRes = await axios.post(ZOHO_TOKEN_URL, null, {
      timeout: 10000,
      params: {
        grant_type:    'authorization_code',
        client_id:     LOGIN_CLIENT_ID,
        client_secret: LOGIN_CLIENT_SECRET,
        redirect_uri:  getRedirectUri(),
        code,
      },
    })

    const { access_token } = tokenRes.data
    if (!access_token) {
      console.error('[auth] No access_token:', tokenRes.data)
      return res.status(401).json({ error: 'Token exchange failed' })
    }

    const userRes = await axios.get(ZOHO_USER_URL, {
      headers: { Authorization: `Zoho-oauthtoken ${access_token}` },
      timeout: 10000,
    })

    const profile = userRes.data || {}
    // Zoho's userinfo can answer with capitalised keys (Email, Display_Name,
    // First_Name…) or OIDC-style lowercase ones. Read both (2026-09-16:
    // Mark had no owner menu because the email came back empty here).
    const email = String(profile.email || profile.Email || profile.email_id || profile.primary_email || '').trim().toLowerCase()
    const name = profile.name || profile.display_name || profile.Display_Name
      || [profile.first_name || profile.First_Name, profile.last_name || profile.Last_Name].filter(Boolean).join(' ')
      || email || 'Team Member'
    // Zoho only grants the profile scope here, so there is NO email in the
    // response (2026-09-16: keys were sub,name,first_name,last_name,picture).
    // Map the person by name to their known address so roles apply.
    let mapped = email
    if (!mapped) {
      try {
        const { canonicalIdentity } = await import('../services/hr.js')
        const [id] = canonicalIdentity('', name)
        if (id && id.includes('@')) mapped = id
      } catch { /* leave empty */ }
    }
    const user = {
      name,
      email: mapped,
      picture: profile.picture || null,
      zuid: profile.sub || profile.ZUID || null,
      ...applyRole(mapped),
    }
    console.log(`[auth] signed in: ${name} <${mapped || 'NO EMAIL'}>${!email && mapped ? ' (by name)' : ''} role=${user.role} · sub=${profile.sub || '?'} · profile keys: ${Object.keys(profile).join(',')}`)

    req.session.user = user

    const token = makeToken(user)
    if (!skipAlerts(user)) {
      try { await pingMark(`🔓 *${user.name || user.email} signed in* at ${ptNow()} (${user.role})`) } catch (e) { console.warn('[auth] sign-in ping failed:', e.message) }
      try { _openedToday.add(`first_open:${ptDay()}:${String(user.email).toLowerCase()}`) } catch {}
    }
    res.json({ ok: true, user, token })
  } catch (err) {
    console.error('[auth] Exchange error:', err.response?.data || err.message)
    res.status(500).json({ error: 'Auth failed' })
  }
})

// GET /auth/me — check token first (includes role), fall back to session cookie
router.get('/me', async (req, res) => {
  if (process.env.SKIP_AUTH === 'true') {
    return res.json({ name: 'Test User', email: 'test@absoluteadas.com', picture: null, role: 'admin' })
  }
  const headerToken = req.headers['x-auth-token']
  if (headerToken) {
    const user = verifyToken(headerToken)
    if (user) { await firstOpenPing(req, user); return res.json(user) }
  }
  if (req.session?.user) { await firstOpenPing(req, req.session.user); return res.json(req.session.user) }
  res.status(401).json({ error: 'Not authenticated' })
})

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session = null
  res.json({ ok: true })
})

export default router
