import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'

// Load .env relative to this file so it works regardless of cwd
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.join(__dirname, '..', '.env')
const dotenvResult = config({ path: envPath, override: true })
console.log('[dotenv] path:', envPath)
console.log('[dotenv] error:', dotenvResult.error?.message || 'none')
console.log('[dotenv] key present:', !!process.env.ANTHROPIC_API_KEY)

import express from 'express'
import cors from 'cors'
import session from 'express-session'
import authRouter from './routes/auth.js'
import extractRouter from './routes/extract.js'
import invoiceRouter from './routes/invoice.js'
import customersRouter from './routes/customers.js'
import salespersonsRouter from './routes/salespersons.js'
import reportRouter from './routes/report.js'
import auditRouter from './routes/audit.js'
import historyRouter from './routes/history.js'

const app = express()
const PORT = process.env.PORT || 3001
const IS_PROD = process.env.NODE_ENV === 'production'

app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '25mb' }))

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'adasiq-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: IS_PROD,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}))

// Auth routes (no protection needed — these are the login endpoints)
app.use('/auth', authRouter)

// Auth middleware — protects all /api/* routes
function requireAuth(req, res, next) {
  if (req.session?.user) return next()
  res.status(401).json({ error: 'Not authenticated' })
}

// Protected API routes
app.use('/api/extract', requireAuth, extractRouter)
app.use('/api/create-invoice', requireAuth, invoiceRouter)
app.use('/api/customers', requireAuth, customersRouter)
app.use('/api/salespersons', requireAuth, salespersonsRouter)
app.use('/api/report', requireAuth, reportRouter)
app.use('/api/audit', requireAuth, auditRouter)
app.use('/api/history', requireAuth, historyRouter)

// Serve the built React client in production
const clientDist = path.join(__dirname, '..', 'client', 'dist')
app.use(express.static(clientDist))
app.get('*', (req, res) => {
  const indexFile = path.join(clientDist, 'index.html')
  res.sendFile(indexFile, (err) => {
    if (err) res.status(200).send('ADAS IQ API running.')
  })
})

app.listen(PORT, () => {
  console.log(`ADAS IQ server running on http://localhost:${PORT}`)
  console.log(`Anthropic key loaded: ${process.env.ANTHROPIC_API_KEY ? 'YES' : 'NO ⚠️'}`)
})
