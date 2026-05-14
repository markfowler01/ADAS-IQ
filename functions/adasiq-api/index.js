import express from 'express'
import cors from 'cors'
import cookieSession from 'cookie-session'
import rateLimit from 'express-rate-limit'
import authRouter, { verifyToken } from './routes/auth.js'
import demoRouter from './routes/demo.js'
import extractRouter from './routes/extract.js'
import extractRoImageRouter from './routes/extract-ro-image.js'
import invoiceRouter from './routes/invoice.js'
import customersRouter from './routes/customers.js'
import salespersonsRouter from './routes/salespersons.js'
import reportRouter from './routes/report.js'
import auditRouter from './routes/audit.js'
import historyRouter from './routes/history.js'
import jobsRouter, { performSyncQuotes, readJobsPublic } from './routes/jobs.js'
import brewRouter, { cronRouter as brewCronRouter } from './routes/brew.js'
import { tipsRouter as brewTipsRouter } from './routes/brewTips.js'
import { auditRouter as auditToolRouter } from './routes/auditTool.js'
import webhookRouter from './routes/webhook.js'
import feedbackRouter from './routes/feedback.js'
import postscanRouter from './routes/postscan.js'
import estimatesRouter from './routes/estimates.js'
import calibrationRulesRouter from './routes/calibrationRules.js'
import shopsRouter from './routes/shops.js'
import booksRouter from './routes/books.js'
import crmReminderRouter from './routes/crmReminder.js'
import backupRouter from './routes/backup.js'
import calendarRouter from './routes/calendar.js'
import garminRouter from './routes/garmin.js'
import mailAgentRouter from './routes/mail-agent.js'
import plannerBrainDumpRouter from './routes/planner-brain-dump.js'
import expensesRouter from './routes/expenses.js'
import notificationsRouter from './routes/notifications.js'
import crmSyncRouter from './routes/crmSync.js'
import plannerBackupRouter from './routes/plannerBackup.js'
import settingsRouter from './routes/settings.js'
import brandingRouter from './routes/branding.js'
import billingCronRouter from './routes/billing-cron.js'
import cleanupCompletedRouter from './routes/cleanup-completed.js'
import ptoRouter from './routes/pto.js'
import timeclockRouter from './routes/timeclock.js'
import bonusesRouter from './routes/bonuses.js'
import mileageRouter from './routes/mileage.js'
import analyticsRouter from './routes/analytics.js'
import projectsRouter from './routes/projects.js'
import teamRouter from './routes/team.js'
import portalRouter, { handleStripeWebhook } from './routes/portal.js'
import zohoImportRouter from './routes/zoho-import.js'
import quotesRouter from './routes/quotes.js'
import declinedRouter from './routes/declined.js'
import jobEnhancementsRouter from './routes/job-enhancements.js'
import disputesRouter from './routes/disputes.js'
import cxRouter from './routes/customer-experience.js'
import intelligenceRouter from './routes/intelligence.js'
import operationsRouter from './routes/operations.js'
import booksFromExtractRouter from './routes/books-from-extract.js'
import payrollRouter from './routes/payroll.js'

// Fix #2 — Warn loudly if session secret is using insecure default
if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET is not set — using insecure default. Set this env var in production.')
}

const app = express()

app.use(cors({ origin: true, credentials: true }))
app.options('*', cors({ origin: true, credentials: true })) // handle preflight for all routes
// Stripe webhook MUST come before express.json() so we can verify with the raw body
app.post('/api/portal/stripe-webhook',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook
)

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
app.use('/auth/demo', demoRouter)

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
app.use('/api/extract-ro-image', requireAuth, extractLimiter, extractRoImageRouter)
app.use('/api/create-invoice', requireAuth, invoiceRouter)
app.use('/api/customers', requireAuth, customersRouter)
app.use('/api/salespersons', requireAuth, salespersonsRouter)
app.use('/api/report', requireAuth, reportRouter)
app.use('/api/audit', requireAuth, auditLimiter, auditRouter)
app.use('/api/history', requireAuth, historyRouter)
app.use('/api/jobs', requireAuth, jobsRouter)
app.use('/api/brew', requireAuth, brewRouter)

app.use('/api/feedback', requireAuth, feedbackRouter)
app.use('/api/estimates', requireAuth, estimatesRouter)
app.use('/api/calibration-rules', requireAuth, calibrationRulesRouter)
app.use('/api/shops', requireAuth, shopsRouter)
app.use('/api/books', requireAuth, booksRouter)

// Webhook routes — no auth required (called by Zoho Books servers)
app.use('/webhooks', webhookRouter)

// Postscan cron route — protected by X-Cron-Secret header, not user auth
app.use('/api/postscan', postscanRouter)

// CRM sync cron — no user auth, protected by cron secret
app.use('/api/crm-sync-cron', crmSyncRouter)

// CRM reminder cron route — protected by X-Cron-Secret (CRM_CRON_SECRET env var)
app.use('/api/crm-reminder', crmReminderRouter)

// Backup cron route — protected by X-Cron-Secret (BACKUP_CRON_SECRET env var)
app.use('/api/backup', backupRouter)

// Billing cron route — protected by X-Cron-Secret (BILLING_CRON_SECRET env var)
app.use('/api/billing-cron', billingCronRouter)

// Cleanup cron — removes completed+invoiced jobs older than 24 h
// Protected by X-Cron-Secret (CLEANUP_CRON_SECRET env var)
app.use('/api/cleanup-completed', cleanupCompletedRouter)

// Sync-quotes cron — pulls Zoho Books drafts onto the kanban and merges any
// matching "Job Requested" cards by RO# so duplicates don't appear.
// Protected by X-Cron-Secret (SYNC_QUOTES_CRON_SECRET env var).
app.post('/api/cron/sync-quotes', async (req, res) => {
  const cronSecret = (process.env.SYNC_QUOTES_CRON_SECRET || '').trim().replace(/^["']|["']$/g, '')
  const provided = (req.headers['x_cron_secret'] || req.headers['x-cron-secret'] || '').trim()
  if (cronSecret && provided !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const result = await performSyncQuotes(req)
    res.json(result)
  } catch (err) {
    console.error('[cron sync-quotes]', err.message, err.stack)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// WorkDrive health check cron — scans all jobs for internal-only folder URLs
// (workdrive.zoho.com/folder/...) that should have been public share links.
// Alerts Mark via Cliq if any are found so they can be fixed with one click.
// Protected by BILLING_CRON_SECRET (reuses existing billing secret).
app.post('/api/cron/workdrive-health', async (req, res) => {
  const cronSecret = process.env.BILLING_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const { postToCliqUser, TECH_CLIQ_IDS } = await import('./services/cliq.js')
    const jobs = await readJobsPublic(req)

    // Jobs with internal WorkDrive URLs — public link was never created or failed
    const broken = jobs.filter(j =>
      j.folder_url &&
      j.folder_url.includes('workdrive.zoho.com/folder/') &&
      !j.folder_url.includes('zohoexternal.com')
    )

    if (broken.length > 0) {
      const lines = broken.slice(0, 10).map(j => {
        const vehicle = j.vehicle || [j.year, j.make, j.model].filter(Boolean).join(' ')
        return `• ${j.shop_name || 'Unknown'} — ${vehicle} (RO# ${j.invoice_number || j.quote_number || j.id})`
      })
      const msg = [
        `⚠️ WorkDrive health check: ${broken.length} job${broken.length > 1 ? 's' : ''} have internal-only links (no public access).`,
        '',
        ...lines,
        '',
        'Open each job card in ADAS IQ and tap "Fix Link" to regenerate the public URL.',
      ].join('\n')
      await postToCliqUser(TECH_CLIQ_IDS.Mark, msg)
      console.log(`[workdrive-health] Found ${broken.length} jobs with broken share links — Cliq alert sent`)
    } else {
      console.log('[workdrive-health] All job WorkDrive links look healthy ✅')
    }

    res.json({ ok: true, broken: broken.length })
  } catch (err) {
    console.error('[workdrive-health]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ADAS Brew cron — fetches industry feeds, assembles digest, sends via Zoho Campaigns.
// Protected by X-Cron-Secret (BREW_CRON_SECRET env var).
app.use('/api/cron/brew', brewCronRouter)

// Absolute ADAS daily tip card cron — separate post stream from the brew
// newsletter. Posts to FB + IG with a dramatic calibration-tip image. Picks
// the next manually-queued tip first, falls back to synthesizing one from
// today's brew digest. Shared BREW_CRON_SECRET.
app.use('/api/cron/brew-tips', brewTipsRouter)

// Public AUDIT tool — Sabri Godfather Offer delivered at scale.
// /generate is public (no auth) so the form at adas-iq.com/audit can call it
// directly. /submissions is cron-secret protected for Mark's review.
app.use('/api/audit-tool', auditToolRouter)

// Calendar route — public (called from 5:30 planner)
app.use('/api/calendar', calendarRouter)
app.use('/api/planner-backup', plannerBackupRouter) // no auth — planner is a separate app
// Garmin sync — /sync is cron-protected (GARMIN_CRON_SECRET); /today and /debug are public for the planner
app.use('/api/garmin', garminRouter)
// Mail agent — /run is cron-protected (MAIL_AGENT_CRON_SECRET), drafts replies via Claude into Zoho Mail
app.use('/api/mail-agent', mailAgentRouter)
// Planner brain-dump — public (planner is a separate app); takes free text, returns structured planner draft
app.use('/api/planner', plannerBrainDumpRouter)
app.use('/api/expenses', requireAuth, expensesRouter)
app.use('/api/notifications', requireAuth, notificationsRouter)
app.use('/api/crm-sync', requireAuth, crmSyncRouter)
app.use('/api/settings', requireAuth, settingsRouter)
app.use('/api/branding', requireAuth, brandingRouter)
app.use('/api/pto', requireAuth, ptoRouter)
app.use('/api/timeclock', requireAuth, timeclockRouter)
app.use('/api/bonuses', requireAuth, bonusesRouter)
app.use('/api/mileage', requireAuth, mileageRouter)
app.use('/api/analytics', requireAuth, analyticsRouter)
app.use('/api/projects', requireAuth, projectsRouter)
app.use('/api/team', requireAuth, teamRouter)
// Portal routes have their OWN auth (portal session token), not the main app auth
app.use('/api/portal', portalRouter)
app.use('/api/zoho-import', requireAuth, zohoImportRouter)
// Quotes: public subpaths (under /public/*) bypass auth since they verify their own signed tokens
app.use('/api/quotes', (req, res, next) => {
  if (req.path.startsWith('/public/')) return next()
  return requireAuth(req, res, next)
}, quotesRouter)
app.use('/api/declined', requireAuth, declinedRouter)
// Phase 6 job enhancements mount under /api/jobs to feel native alongside existing routes
app.use('/api/jobs', requireAuth, jobEnhancementsRouter)
app.use('/api/disputes', requireAuth, disputesRouter)
// CX: NPS public endpoints (under /nps/respond + /nps/survey) bypass auth; the rest require admin.
app.use('/api/cx', (req, res, next) => {
  if (req.path === '/nps/respond' || req.path === '/nps/survey') return next()
  return requireAuth(req, res, next)
}, cxRouter)
app.use('/api/intelligence', requireAuth, intelligenceRouter)
app.use('/api/operations', requireAuth, operationsRouter)
app.use('/api/books', requireAuth, booksFromExtractRouter)
app.use('/api/payroll', requireAuth, payrollRouter)

// Deployment version probe
app.get('/version', (req, res) => res.json({ version: 'postscan-v1' }))

export default app
