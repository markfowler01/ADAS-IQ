import express from 'express'
import axios from 'axios'

const router = express.Router()

const ZOHO_AUTH_URL = 'https://accounts.zoho.com/oauth/v2/auth'
const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'
const ZOHO_USER_URL = 'https://accounts.zoho.com/oauth/v2/userinfo'

function getRedirectUri() {
  const base = process.env.APP_URL || 'http://localhost:3001'
  return `${base}/auth/zoho/callback`
}

// GET /auth/zoho — kick off Zoho login
router.get('/zoho', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.ZOHO_LOGIN_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: 'AaaServer.profile.Read',
    access_type: 'online',
    prompt: 'consent',
  })
  res.redirect(`${ZOHO_AUTH_URL}?${params}`)
})

// GET /auth/zoho/callback — Zoho redirects here after login
router.get('/zoho/callback', async (req, res) => {
  const { code, error } = req.query

  if (error || !code) {
    return res.redirect('/?auth_error=1')
  }

  try {
    // Exchange code for tokens
    const tokenRes = await axios.post(ZOHO_TOKEN_URL, null, {
      params: {
        grant_type: 'authorization_code',
        client_id: process.env.ZOHO_LOGIN_CLIENT_ID,
        client_secret: process.env.ZOHO_LOGIN_CLIENT_SECRET,
        redirect_uri: getRedirectUri(),
        code,
      },
    })

    const { access_token } = tokenRes.data

    // Fetch user profile
    const userRes = await axios.get(ZOHO_USER_URL, {
      headers: { Authorization: `Zoho-oauthtoken ${access_token}` },
    })

    const profile = userRes.data
    const name = profile.name || profile.display_name || profile.email || 'Team Member'
    const email = profile.email || ''
    const picture = profile.picture || null

    // Restrict to Absolute ADAS team only
    if (!email.toLowerCase().endsWith('@absoluteadas.com')) {
      console.warn(`[auth] Blocked login attempt from: ${email}`)
      return res.redirect('/?auth_error=1')
    }

    // Store in session
    req.session.user = { name, email, picture }
    req.session.save(() => {
      res.redirect('/')
    })
  } catch (err) {
    console.error('[auth] Zoho callback error:', err.response?.data || err.message)
    res.redirect('/?auth_error=1')
  }
})

// GET /auth/me — returns current session user (or 401)
router.get('/me', (req, res) => {
  if (req.session?.user) {
    res.json(req.session.user)
  } else {
    res.status(401).json({ error: 'Not authenticated' })
  }
})

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true })
  })
})

export default router
