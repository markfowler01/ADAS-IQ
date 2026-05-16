import express from 'express'
import axios from 'axios'
import crypto from 'crypto'

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

// Role map — keyed by lowercase email. Unrecognised users get admin by default.
const USER_ROLES = {
  'jayden@absoluteadas.com': { role: 'technician', techName: 'Jaden' },
}
function applyRole(email) {
  return USER_ROLES[(email || '').toLowerCase()] || { role: 'admin' }
}

// ── Token helpers (stateless JWT-like, no library needed) ─────────────────────

function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({
    user,
    exp: Date.now() + 8 * 60 * 60 * 1000, // 8 hours
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

    const profile = userRes.data
    const user = {
      name:    profile.name || profile.display_name || profile.email || 'Team Member',
      email:   profile.email || '',
      picture: profile.picture || null,
      ...applyRole(profile.email),
    }

    req.session.user = user

    const token = makeToken(user)
    res.json({ ok: true, user, token })
  } catch (err) {
    console.error('[auth] Exchange error:', err.response?.data || err.message)
    res.status(500).json({ error: 'Auth failed' })
  }
})

// GET /auth/me — check token first (includes role), fall back to session cookie
router.get('/me', (req, res) => {
  if (process.env.SKIP_AUTH === 'true') {
    return res.json({ name: 'Test User', email: 'test@absoluteadas.com', picture: null, role: 'admin' })
  }
  const headerToken = req.headers['x-auth-token']
  if (headerToken) {
    const user = verifyToken(headerToken)
    if (user) return res.json(user)
  }
  if (req.session?.user) return res.json(req.session.user)
  res.status(401).json({ error: 'Not authenticated' })
})

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session = null
  res.json({ ok: true })
})

export default router
