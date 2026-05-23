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
import todayRouter from './routes/today.js'
import dispatchRouter from './routes/dispatch.js'
import brewRouter, { cronRouter as brewCronRouter } from './routes/brew.js'
import { tipsRouter as brewTipsRouter } from './routes/brewTips.js'
import { auditRouter as auditToolRouter } from './routes/auditTool.js'
import { captureCalcRouter } from './routes/captureCalculator.js'
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
// Accept text/plain bodies too — public forms on absoluteadas.com send JSON as
// text/plain to dodge the CORS preflight that Catalyst's gateway swallows.
app.use(express.text({ type: 'text/plain', limit: '25mb' }))
app.use((req, res, next) => {
  if (typeof req.body === 'string' && (req.body.startsWith('{') || req.body.startsWith('['))) {
    try { req.body = JSON.parse(req.body) } catch (e) { /* leave as string */ }
  }
  next()
})

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
app.use('/api/today', requireAuth, todayRouter)
app.use('/api/dispatch', requireAuth, dispatchRouter)
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
        'Open each job card in Absolute ADAS and tap "Fix Link" to regenerate the public URL.',
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

// Stuck-job digest cron — flags jobs parked too long in dispatched_* or pending_parts.
// Sends a digest to Mark (channel) + Kat (DM). Protected by BILLING_CRON_SECRET.
// Only pings when there's something stuck — no news = no message.
app.post('/api/cron/stuck-jobs', async (req, res) => {
  const cronSecret = process.env.BILLING_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const { postToCliqChannelById, postToCliqUser, MARK_ALERT_CHANNEL_ID, TECH_CLIQ_IDS } = await import('./services/cliq.js')
    const jobs = await readJobsPublic(req)

    const now = Date.now()
    const DAY = 24 * 60 * 60 * 1000
    // status → days in the system before it counts as "stuck"
    const THRESHOLD_DAYS = { dispatched_jaden: 3, dispatched_mark: 3, pending_parts: 7 }

    const stuck = []
    for (const job of jobs) {
      const threshold = THRESHOLD_DAYS[job.status]
      if (!threshold) continue
      const createdAt = new Date(job.created_at || 0).getTime()
      if (!createdAt) continue
      const ageDays = Math.floor((now - createdAt) / DAY)
      if (ageDays < threshold) continue
      stuck.push({ job, ageDays })
    }

    if (stuck.length === 0) {
      console.log('[stuck-jobs] No stuck jobs ✅')
      return res.json({ ok: true, stuck: 0 })
    }

    stuck.sort((a, b) => b.ageDays - a.ageDays)

    const fmt = ({ job, ageDays }) => {
      const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
      const roNum = job.quote_number || (job.notes || '').match(/RO#[:\s]*([^\s|,]+)/i)?.[1] || ''
      return '• ' + [
        job.shop_name || 'Unknown shop',
        roNum ? `RO# ${roNum}` : null,
        vehicle || null,
        job.technician || null,
        `${ageDays}d`,
      ].filter(Boolean).join(' · ')
    }

    const dispatched   = stuck.filter(s => s.job.status.startsWith('dispatched_'))
    const pendingParts = stuck.filter(s => s.job.status === 'pending_parts')

    const lines = [`⚠️ *${stuck.length} job${stuck.length !== 1 ? 's' : ''} stuck in the pipeline*`]
    if (dispatched.length) {
      lines.push('', `🔧 Dispatched 3+ days (${dispatched.length}):`, ...dispatched.map(fmt))
    }
    if (pendingParts.length) {
      lines.push('', `📦 Pending parts 7+ days (${pendingParts.length}):`, ...pendingParts.map(fmt))
    }
    lines.push('', '🗂 Job Board: https://adas-iq-904191467.development.catalystserverless.com/app/index.html')
    const msg = lines.join('\n')

    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg)
      .catch(e => console.warn('[stuck-jobs] Mark alert failed:', e.message))
    const katId = TECH_CLIQ_IDS.Kat || TECH_CLIQ_IDS.Kath
    if (katId) {
      await postToCliqUser(katId, msg)
        .catch(e => console.warn('[stuck-jobs] Kat alert failed:', e.message))
    }

    console.log(`[stuck-jobs] ${stuck.length} stuck — digest sent to Mark + Kat`)
    res.json({ ok: true, stuck: stuck.length, dispatched: dispatched.length, pending_parts: pendingParts.length })
  } catch (err) {
    console.error('[stuck-jobs]', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// One-time cleanup: remove geocache entries that came from name-only guesses
// or "ambiguous" results. Manual pins and "ok" entries from real addresses
// are kept. Protected by BILLING_CRON_SECRET.
app.post('/api/cron/cleanup-name-fallback', async (req, res) => {
  const cronSecret = process.env.BILLING_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const { readGeocache, writeGeocache } = await import('./services/geocoding.js')
    const cache = await readGeocache(req)
    const before = Object.keys(cache).length
    let removed = 0
    for (const [key, v] of Object.entries(cache)) {
      if (v.geocode_source === 'manual') continue            // keep pins
      if (v.geocode_status === 'ok' && v.address_source !== 'name-fallback') continue  // keep real addresses
      delete cache[key]
      removed++
    }
    await writeGeocache(req, cache)
    res.json({ ok: true, before, after: Object.keys(cache).length, removed })
  } catch (err) {
    console.error('[cleanup-name-fallback]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// One-time diagnostic: show how every job-shop's address would be resolved.
// Reads Zoho Books customers + CRM Shops + current geocache and returns the
// chain we'd use, so we can see why a shop is "ambiguous" or "name-fallback".
// Protected by BILLING_CRON_SECRET.
app.get('/api/cron/address-debug', async (req, res) => {
  const cronSecret = process.env.BILLING_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const { getAllShops } = await import('./routes/shops.js')
    const { readJobsPublic } = await import('./routes/jobs.js')
    const { readGeocache, normalizeKey, formatZohoAddress } = await import('./services/geocoding.js')
    const { listCustomers } = await import('./services/zoho.js')

    const [shops, jobs, cache, zohoCustomers] = await Promise.all([
      getAllShops(req),
      readJobsPublic(req),
      readGeocache(req),
      listCustomers().catch(() => []),
    ])

    const crmByKey = new Map()
    for (const s of shops) if (s.shop_name) crmByKey.set(normalizeKey(s.shop_name), s)

    const zohoByKey = new Map()
    for (const c of zohoCustomers) {
      const addr = formatZohoAddress(c.billing_address)
      if (!addr) continue
      if (c.company_name) zohoByKey.set(normalizeKey(c.company_name), { addr, matched: c.company_name })
      if (c.contact_name) zohoByKey.set(normalizeKey(c.contact_name), { addr, matched: c.contact_name })
    }

    const jobShopNames = new Set()
    for (const j of jobs || []) if (j.shop_name && j.status !== 'complete') jobShopNames.add(j.shop_name)

    const out = []
    for (const name of jobShopNames) {
      const k = normalizeKey(name)
      const crm = crmByKey.get(k)
      const zohoExact = zohoByKey.get(k)
      let zohoLoose = null
      if (!zohoExact) {
        for (const [zk, v] of zohoByKey.entries()) {
          if (zk.includes(k) || k.includes(zk)) { zohoLoose = { ...v, viaKey: zk }; break }
        }
      }
      const cached = cache[k]
      out.push({
        shop_name: name,
        crm_address: crm?.address || null,
        zoho_exact: zohoExact || null,
        zoho_loose: zohoLoose,
        cached: cached ? { status: cached.geocode_status, source: cached.geocode_source, address: cached.address || null, address_source: cached.address_source || null } : null,
      })
    }

    // Sample: fetch full record for ONE customer (first one we can find by name
    // from a job) via the individual contact endpoint, to see what fields
    // Zoho actually returns when we query a single contact.
    let sampleContact = null
    try {
      const axios = (await import('axios')).default
      const { getAccessToken } = await import('./services/zoho.js')
      const token = await getAccessToken()
      // Try to find a Zoho contact that loosely matches one of our job shop names
      const firstJobShopName = [...jobShopNames][0]
      const match = zohoCustomers.find(c => {
        const cn = (c.company_name || c.contact_name || '').toLowerCase()
        return cn && (cn.includes((firstJobShopName || '').toLowerCase()) || (firstJobShopName || '').toLowerCase().includes(cn))
      }) || zohoCustomers[0]
      if (match?.contact_id) {
        const r = await axios.get(`https://www.zohoapis.com/books/v3/contacts/${match.contact_id}`, {
          headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
          params: { organization_id: process.env.ZOHO_ORGANIZATION_ID || process.env.ZOHO_ORG_ID || '' },
          timeout: 10000,
        })
        sampleContact = r.data?.contact || r.data
      }
    } catch (e) {
      sampleContact = { error: e.message }
    }

    res.json({
      ok: true,
      counts: {
        zoho_customers: zohoCustomers.length,
        zoho_with_address: zohoByKey.size,
        crm_shops: shops.length,
        job_shop_names: jobShopNames.size,
      },
      sample_contact_keys: sampleContact && !sampleContact.error
        ? Object.keys(sampleContact).slice(0, 60)
        : sampleContact,
      sample_contact_address_fields: sampleContact && !sampleContact.error
        ? {
            billing_address: sampleContact.billing_address || null,
            shipping_address: sampleContact.shipping_address || null,
            contact_name: sampleContact.contact_name,
            company_name: sampleContact.company_name,
          }
        : null,
      shops: out,
    })
  } catch (err) {
    console.error('[address-debug]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Force-reseed the tech config from TECH_HOME_DEFAULTS in services/geocoding.js.
// Use this after editing a tech's home address in code: it overwrites any cached
// entry and nulls lat/lng so the next geocode-shops run re-geocodes it.
app.post('/api/cron/reseed-tech-config', async (req, res) => {
  const cronSecret = process.env.BILLING_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const { ensureTechConfigSeed, readTechConfig } = await import('./services/geocoding.js')
    await ensureTechConfigSeed(req, { force: true })
    const cfg = await readTechConfig(req)
    res.json({ ok: true, config: cfg })
  } catch (err) {
    console.error('[reseed-tech-config]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Geocoding cron — populates lat/lng for CRM shops + tech home bases.
// Reads addresses from CRMShops Datastore and absolute_adas_tech_config cache,
// calls Google Geocoding API (reuses GOOGLE_PLACES_API_KEY; Geocoding API must
// be enabled on the same Google Cloud project), writes results to the
// absolute_adas_geocache cache. Manual overrides (geocode_source = "manual")
// are never overwritten. Caps at 25 lookups per run to stay under the gateway.
// Protected by BILLING_CRON_SECRET (reuses existing billing secret).
app.post('/api/cron/geocode-shops', async (req, res) => {
  const cronSecret = process.env.BILLING_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const { getAllShops } = await import('./routes/shops.js')
    const {
      readGeocache, writeGeocache, geocodeAddress, normalizeKey,
      readTechConfig, writeTechConfig, ensureTechConfigSeed,
      formatZohoAddress,
    } = await import('./services/geocoding.js')
    const { readJobsPublic } = await import('./routes/jobs.js')
    const { listCustomers, getCustomerFull } = await import('./services/zoho.js')

    const MAX_PER_RUN = 25
    const STALE_DAYS = 90
    const now = Date.now()
    const isStale = (iso) => !iso || (now - new Date(iso).getTime()) > STALE_DAYS * 24 * 60 * 60 * 1000

    // Seed tech config if first run
    await ensureTechConfigSeed(req)

    const [shops, jobs, cache, techConfig, zohoCustomers] = await Promise.all([
      getAllShops(req),
      readJobsPublic(req),
      readGeocache(req),
      readTechConfig(req),
      listCustomers().catch(e => {
        console.warn('[geocode-shops] listCustomers failed (non-fatal):', e.message)
        return []
      }),
    ])

    // Address resolution chain per shop:
    //  1) CRM Shops table (if address present)
    //  2) Zoho Books customer billing_address (matched by company_name or contact_name)
    //  3) Fallback to "ShopName, Lake Stevens, WA"
    const crmByKey = new Map()
    for (const s of shops) {
      if (!s.shop_name) continue
      crmByKey.set(normalizeKey(s.shop_name), s)
    }
    // Zoho's list endpoint doesn't return billing_address. We need the individual
    // contact endpoint for that. Pre-resolve the names we care about (jobs +
    // CRM shops missing addresses) into a name → contact_id map, then fetch
    // those full records in parallel.
    const jobShopNames = new Set()
    for (const j of jobs || []) {
      if (j.shop_name && j.status !== 'complete') jobShopNames.add(j.shop_name)
    }
    const namesNeedingZoho = new Set([...jobShopNames])
    for (const s of shops) if (s.shop_name && !(s.address && s.address.trim())) namesNeedingZoho.add(s.shop_name)

    const zohoIdByName = new Map() // normalized shop_name -> contact_id
    for (const name of namesNeedingZoho) {
      const k = normalizeKey(name)
      let matched = zohoCustomers.find(c => normalizeKey(c.company_name) === k || normalizeKey(c.contact_name) === k)
      if (!matched) {
        matched = zohoCustomers.find(c => {
          const cn = normalizeKey(c.company_name) || normalizeKey(c.contact_name)
          return cn && (cn.includes(k) || k.includes(cn))
        })
      }
      if (matched?.contact_id) zohoIdByName.set(k, matched.contact_id)
    }

    // Fetch full contact records (limited to keep cron under 30s — at ~1s per
    // call, 20 in parallel is safe).
    const idsToFetch = [...new Set(zohoIdByName.values())].slice(0, 20)
    const fullById = new Map()
    if (idsToFetch.length > 0) {
      const records = await Promise.all(idsToFetch.map(id => getCustomerFull(id).catch(() => null)))
      idsToFetch.forEach((id, i) => { if (records[i]) fullById.set(id, records[i]) })
    }

    const zohoAddrByKey = new Map()
    for (const [k, id] of zohoIdByName.entries()) {
      const full = fullById.get(id)
      if (!full) continue
      const addr = formatZohoAddress(full.billing_address) || formatZohoAddress(full.shipping_address)
      if (addr) zohoAddrByKey.set(k, addr)
    }

    function bestAddressFor(shopName, crmShop) {
      const k = normalizeKey(shopName)
      if (crmShop?.address && crmShop.address.trim()) return { address: crmShop.address, source: 'crm' }
      if (zohoAddrByKey.has(k)) return { address: zohoAddrByKey.get(k), source: 'zoho' }
      // Mark only wants real addresses on the map. No name-only guesses.
      // Shops with no address stay un-pinned until manually pinned via
      // the Pinned Shops tab.
      return null
    }

    // Pick shops needing geocoding. Skip manual overrides forever. Skip "ok"
    // entries that aren't stale. Re-process "ambiguous" entries IF we have a
    // better address now than we did before (e.g., we previously had only the
    // shop name and now we have a Zoho Books street address).
    const todo = []
    function queueShop(name, address, addressSource) {
      const key = normalizeKey(name)
      const existing = cache[key]
      if (existing?.geocode_source === 'manual') return
      if (existing?.geocode_status === 'ok' && !isStale(existing.geocoded_at)) return
      todo.push({ kind: 'shop', key, name, address, addressSource })
    }

    // Resolve every shop that has a job or is in CRM to its best real address.
    // Shops with no address in CRM and no Zoho billing_address are skipped —
    // they stay un-pinned and surface in "no location" for manual pinning.
    const allShopNames = new Set(jobShopNames)
    for (const s of shops) if (s.shop_name) allShopNames.add(s.shop_name)
    let skippedNoAddress = 0
    for (const name of allShopNames) {
      const crmShop = crmByKey.get(normalizeKey(name)) || null
      const resolved = bestAddressFor(name, crmShop)
      if (!resolved) { skippedNoAddress++; continue }
      queueShop(name, resolved.address, resolved.source)
      if (todo.length >= MAX_PER_RUN) break
    }

    // Also queue tech home bases that are not yet geocoded.
    if (todo.length < MAX_PER_RUN) {
      for (const [tech, cfg] of Object.entries(techConfig)) {
        if (!cfg.home_address) continue
        if (cfg.home_lat != null && cfg.home_lng != null) continue
        todo.push({ kind: 'tech', tech, address: cfg.home_address })
        if (todo.length >= MAX_PER_RUN) break
      }
    }

    let ok = 0, ambiguous = 0, failed = 0
    for (const item of todo) {
      const result = await geocodeAddress(item.address)
      if (!result) { failed++; continue }
      if (result.geocode_status === 'ok') ok++
      else if (result.geocode_status === 'ambiguous') ambiguous++
      else failed++

      const stamp = new Date().toISOString()
      if (item.kind === 'shop') {
        cache[item.key] = {
          ...result,
          geocoded_at: stamp,
          address: item.address,                  // formatted address actually used
          address_source: item.addressSource,     // crm | zoho | name-fallback
        }
      } else if (item.kind === 'tech') {
        techConfig[item.tech] = {
          ...(techConfig[item.tech] || {}),
          home_lat: result.lat,
          home_lng: result.lng,
          geocoded_at: stamp,
          geocode_status: result.geocode_status,
        }
      }
    }

    await Promise.all([writeGeocache(req, cache), writeTechConfig(req, techConfig)])
    console.log(`[geocode-shops] processed=${todo.length} ok=${ok} ambiguous=${ambiguous} failed=${failed}`)
    res.json({ ok: true, processed: todo.length, geocoded_ok: ok, ambiguous, failed })
  } catch (err) {
    console.error('[geocode-shops]', err.message, err.stack)
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

// Public CAPTURE RATE CALCULATOR — the Tier-1 lead magnet for the v2.5
// acquisition campaign (separate engine from the newsletter). Form at
// absoluteadas.com/calculator. /generate is public, /submissions is cron-secret.
app.use('/api/capture-calc', captureCalcRouter)

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
