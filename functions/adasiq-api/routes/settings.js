import express from 'express'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()
const CACHE_KEY = 'adas_iq_settings'

function getSegment(req) {
  const app = catalyst.initialize(req)
  return app.cache().segment()
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

async function getSettings(req) {
  try {
    const seg = getSegment(req)
    const item = await seg.get(CACHE_KEY)
    return item?.cache_value ? JSON.parse(item.cache_value) : {}
  } catch (e) {
    if (isNotFound(e)) return {}
    return {}
  }
}

async function saveSettings(req, settings) {
  const value = JSON.stringify(settings)
  const seg = getSegment(req)
  try {
    await seg.update(CACHE_KEY, value)
  } catch {
    await seg.put(CACHE_KEY, value)
  }
}

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const settings = await getSettings(req)
    res.json({ ok: true, settings })
  } catch (err) {
    console.error('[settings GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/settings — full replace
router.put('/', async (req, res) => {
  try {
    await saveSettings(req, req.body)
    res.json({ ok: true })
  } catch (err) {
    console.error('[settings PUT]', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * Exported helper: look up a tech's email by name from cached settings.
 * Used by notifications.js to send emails.
 */
export async function getTechEmail(req, techName) {
  if (!techName) return null
  const settings = await getSettings(req)
  const contacts = settings.dispatch_contacts || []
  const match = contacts.find(c => c.name?.toLowerCase().trim() === techName.toLowerCase().trim())
  return match?.email || null
}

export default router
