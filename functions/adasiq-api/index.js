import express from 'express'
import cors from 'cors'
import cookieSession from 'cookie-session'
import rateLimit from 'express-rate-limit'
import authRouter, { verifyToken } from './routes/auth.js'
import extractRouter from './routes/extract.js'
import invoiceRouter from './routes/invoice.js'
import customersRouter from './routes/customers.js'
import salespersonsRouter from './routes/salespersons.js'
import reportRouter from './routes/report.js'
import auditRouter from './routes/audit.js'
import historyRouter from './routes/history.js'
import jobsRouter from './routes/jobs.js'
import webhookRouter from './routes/webhook.js'
import feedbackRouter from './routes/feedback.js'
import postscanRouter from './routes/postscan.js'

// Fix #2 — Warn loudly if session secret is using insecure default
if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET is not set — using insecure default. Set this env var in production.')
}

const app = express()

app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '25mb' }))

app.use(cookieSession({
  name: 'adasiq_sess',
  keys: [process.env.SESSION_SECRET || 'adasiq-secret'],
  maxAge: 7 * 24 * 60 * 60 * 1000,
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
}))

// Fix #1 — Rate limiting on expensive AI endpoints
const extractLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
})

const auditLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many audit requests. Please wait a few minutes and try again.' },
})

// Health check
app.get('/ping', (req, res) => res.json({
  ok: true,
  env: !!process.env.ZOHO_LOGIN_CLIENT_ID,
  skip_auth: process.env.SKIP_AUTH,
  host: req.get('host'),
}))

// Auth routes
app.use('/auth', authRouter)

// Auth middleware — X-Auth-Token header (primary) or session cookie (fallback)
function requireAuth(req, res, next) {
  if (process.env.SKIP_AUTH === 'true') return next()
  // Primary: HMAC-signed token via X-Auth-Token header
  const headerToken = req.headers['x-auth-token']
  if (headerToken) {
    const user = verifyToken(headerToken)
    if (user) { req.user = user; return next() }
    console.warn('[auth] X-Auth-Token present but invalid — falling back to session cookie')
  }
  // Fallback: session cookie
  if (req.session?.user) { req.user = req.session.user; return next() }
  res.status(401).json({ error: 'Not authenticated' })
}

// Debug route (auth required)
app.get('/debug/cache', requireAuth, async (req, res) => {
  const token = req.headers['x-zc-admin-cred-token'] || req.headers['x-zc-user-cred-token'] || ''
  const projectId = req.headers['x-zc-projectid'] || '45874000000016010'
  const CATALYST_API = 'https://api.catalyst.zoho.com'
  const CACHE_KEY = 'kanban_jobs'
  const authHdr = { Authorization: `Catalyst-Cred-Token ${token}`, 'Content-Type': 'application/json' }
  let readTest = null, writeTest = null
  try {
    const r = await (await import('axios')).default.get(`${CATALYST_API}/baas/v1/project/${projectId}/cache/${CACHE_KEY}`, { headers: authHdr })
    readTest = { ok: true, status: r.status, has_value: !!r.data?.data?.cache_value }
  } catch (e) { readTest = { error: e.response?.status, msg: e.response?.data || e.message } }
  try {
    const axios = (await import('axios')).default
    const w = await axios.put(`${CATALYST_API}/baas/v1/project/${projectId}/cache/${CACHE_KEY}`, { cache_value: 'test_' + Date.now(), expiry_in_hours: 0 }, { headers: authHdr })
    writeTest = { ok: true, status: w.status, data: w.data }
  } catch (e) {
    if (e.response?.status === 404) {
      try {
        const axios = (await import('axios')).default
        const w = await axios.post(`${CATALYST_API}/baas/v1/project/${projectId}/cache`, { cache_name: CACHE_KEY, cache_value: 'test_' + Date.now(), expiry_in_hours: 0 }, { headers: authHdr })
        writeTest = { ok: true, method: 'POST', status: w.status, data: w.data }
      } catch (e2) { writeTest = { error: e2.response?.status, msg: e2.response?.data || e2.message, method: 'POST' } }
    } else { writeTest = { error: e.response?.status, msg: e.response?.data || e.message } }
  }
  res.json({ has_token: !!token, token_preview: token?.substring(0,20), project_id: projectId, read_test: readTest, write_test: writeTest })
})

// Protected API routes (rate limiters applied to AI-heavy endpoints)
app.use('/api/extract', requireAuth, extractLimiter, extractRouter)
app.use('/api/create-invoice', requireAuth, invoiceRouter)
app.use('/api/customers', requireAuth, customersRouter)
app.use('/api/salespersons', requireAuth, salespersonsRouter)
app.use('/api/report', requireAuth, reportRouter)
app.use('/api/audit', requireAuth, auditLimiter, auditRouter)
app.use('/api/history', requireAuth, historyRouter)
app.use('/api/jobs', requireAuth, jobsRouter)

app.use('/api/feedback', requireAuth, feedbackRouter)

// Webhook routes — no auth required (called by Zoho Books servers)
app.use('/webhooks', webhookRouter)

// Postscan cron route — protected by X-Cron-Secret header, not user auth
app.use('/api/postscan', postscanRouter)

export default app
