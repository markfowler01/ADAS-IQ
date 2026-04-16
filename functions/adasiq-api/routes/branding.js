import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()
const CACHE_KEY = 'adas_iq_branding'

const DEFAULTS = {
  company_name: 'Absolute ADAS',
  tagline: 'Mobile ADAS Calibration Services',
  logo_url: '',
  primary_color: '#CD4419',
  secondary_color: '#1a1a1a',
  accent_color: '#2563eb',
  phone: '',
  email: '',
  website: 'absoluteadas.com',
  address: '',
  invoice_prefix: 'INV',
  invoice_footer: 'Thank you for your business!',
  email_signature: '',
  timezone: 'America/Los_Angeles',
}

function getSegment(req) {
  const app = catalyst.initialize(req)
  return app.cache().segment()
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

async function getBranding(req) {
  try {
    const seg = getSegment(req)
    const item = await seg.get(CACHE_KEY)
    const stored = item?.cache_value ? JSON.parse(item.cache_value) : {}
    return { ...DEFAULTS, ...stored }
  } catch (e) {
    if (isNotFound(e)) return { ...DEFAULTS }
    return { ...DEFAULTS }
  }
}

async function saveBranding(req, branding) {
  const value = JSON.stringify(branding)
  const seg = getSegment(req)
  try {
    await seg.update(CACHE_KEY, value)
  } catch {
    await seg.put(CACHE_KEY, value)
  }
}

// GET /api/branding
router.get('/', async (req, res) => {
  try {
    const branding = await getBranding(req)
    res.json(branding)
  } catch (err) {
    console.error('[branding GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/branding — full replace (admin only)
router.put('/', async (req, res) => {
  try {
    const role = req.user?.role || req.session?.user?.role
    if (role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    await saveBranding(req, req.body)
    res.json({ ok: true })
  } catch (err) {
    console.error('[branding PUT]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
