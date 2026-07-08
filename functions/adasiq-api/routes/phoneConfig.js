// Phone-config admin endpoints — auth'd. Feeds the in-app Phone Setup
// page. Values live in Catalyst Cache (see services/phoneConfig.js) so
// Mark can add Twilio credentials without touching env vars.

import express from 'express'
import {
  PHONE_CONFIG_KEYS,
  readPhoneCache,
  setPhoneConfigValue,
  deletePhoneConfigValue,
  maskSecret,
} from '../services/phoneConfig.js'

const router = express.Router()

// GET /api/phone-config
// Returns every declared key + the current value + the source (env / cache /
// unset). Secret values are masked. Mark can see which knobs are wired and
// which still need input without ever seeing the actual secret in plaintext.
router.get('/', async (req, res) => {
  try {
    const cache = await readPhoneCache(req)
    const entries = PHONE_CONFIG_KEYS.map(spec => {
      const envVal = process.env[spec.key]
      const cacheVal = cache[spec.key]
      let source = 'unset'
      let value = ''
      if (envVal !== undefined && envVal !== '') {
        source = 'env'
        value = spec.secret ? maskSecret(envVal) : envVal
      } else if (cacheVal !== undefined && cacheVal !== '') {
        source = 'cache'
        value = spec.secret ? maskSecret(cacheVal) : cacheVal
      }
      return {
        key:      spec.key,
        label:    spec.label,
        help:     spec.help || '',
        secret:   !!spec.secret,
        required: !!spec.required,
        source,
        value,
        set:      source !== 'unset',
      }
    })
    res.json({ ok: true, entries })
  } catch (err) {
    console.error('[phone-config GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/phone-config
// Body: { key, value }
router.post('/', async (req, res) => {
  try {
    const bodyType = typeof req.body
    const bodyPreview = bodyType === 'string' ? req.body.slice(0, 200) : JSON.stringify(req.body).slice(0, 200)
    console.log('[phone-config POST] body type:', bodyType, 'preview:', bodyPreview)

    const rawKey = req.body?.key
    const key = String(rawKey || '').trim()
    const value = req.body?.value == null ? '' : String(req.body.value).trim()
    if (!key) {
      return res.status(400).json({
        error: 'key is required',
        debug: { received_body_type: bodyType, received_body_preview: bodyPreview, received_key: rawKey },
      })
    }
    if (!PHONE_CONFIG_KEYS.find(k => k.key === key)) {
      return res.status(400).json({
        error: `Unknown key: ${key}`,
        debug: { valid_keys: PHONE_CONFIG_KEYS.map(k => k.key) },
      })
    }
    await setPhoneConfigValue(req, key, value)
    res.json({ ok: true, key })
  } catch (err) {
    console.error('[phone-config POST]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/phone-config/:key — wipe cache entry (falls back to env
// var or "unset" state, doesn't touch env).
router.delete('/:key', async (req, res) => {
  try {
    const key = String(req.params.key || '').trim()
    if (!PHONE_CONFIG_KEYS.find(k => k.key === key)) {
      return res.status(400).json({ error: `Unknown key: ${key}` })
    }
    await deletePhoneConfigValue(req, key)
    res.json({ ok: true, key })
  } catch (err) {
    console.error('[phone-config DELETE]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
