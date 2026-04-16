import express from 'express'
import axios from 'axios'
import Anthropic from '@anthropic-ai/sdk'
import { createDraftQuote } from '../services/zoho.js'
import { saveCalibrationAsRule } from '../services/calibrationRulesService.js'

// Clean up technician notes into professional line item descriptions (single batched call)
async function cleanDescriptions(calibrations) {
  const toClean = calibrations
    .map((c, i) => ({ i, name: c.calibration_name, text: (c.description || '').trim() }))
    .filter(x => x.text.length > 0)

  if (toClean.length === 0) return calibrations

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const prompt = `You are editing line item descriptions for a professional automotive ADAS calibration insurance invoice.

Clean up each technician note below into a clear, professional 1-3 sentence description suitable for an insurance invoice. Fix grammar, spelling, and clarity. Keep all technical details. Do not invent information not present. Return ONLY a JSON array of strings in the same order as the input — no other text.

Items:
${JSON.stringify(toClean.map(x => ({ item: x.name, note: x.text })), null, 2)}`

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = msg.content[0]?.text?.trim() || '[]'
    const cleaned = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim())

    if (!Array.isArray(cleaned) || cleaned.length !== toClean.length) {
      console.warn('[invoice] cleanDescriptions: unexpected response shape, using originals')
      return calibrations
    }

    const result = calibrations.map(c => ({ ...c }))
    toClean.forEach((x, idx) => {
      result[x.i] = { ...result[x.i], description: cleaned[idx] || result[x.i].description }
    })
    return result
  } catch (e) {
    console.warn('[invoice] cleanDescriptions failed (non-fatal):', e.message)
    return calibrations // fall back to originals
  }
}

const router = express.Router()
const CATALYST_API = 'https://api.catalyst.zoho.com'
const HISTORY_CACHE_KEY = 'history_records'

function getCatalystToken(req) {
  return req.headers['x-zc-admin-cred-token'] || req.headers['x-zc-user-cred-token'] || ''
}

function getProjectId(req) {
  return req.headers['x-zc-projectid'] || process.env.CATALYST_PROJECT_ID || ''
}

function authHeader(token) {
  return { Authorization: `Zoho-oauthtoken ${token}` }
}

async function appendHistory(entry, req) {
  const token = getCatalystToken(req)
  if (!token) return
  const projectId = getProjectId(req)
  const url = `${CATALYST_API}/baas/v1/project/${projectId}/cache`
  const headers = { ...authHeader(token), 'Content-Type': 'application/json' }

  // Read existing records
  let records = []
  try {
    const res = await axios.get(url, { headers: authHeader(token), params: { cacheKey: HISTORY_CACHE_KEY } })
    const val = res.data?.data?.cache_value
    records = val ? JSON.parse(val) : []
  } catch (e) {
    if (e.response?.status !== 404) console.error('[history append] read error:', e.message)
  }

  records.push(entry)
  const body = { cache_name: HISTORY_CACHE_KEY, cache_value: JSON.stringify(records), expiry_in_hours: null }

  try {
    await axios.put(url, body, { headers })
  } catch (e) {
    if (e.response?.status === 404) {
      await axios.post(url, body, { headers })
    } else {
      console.error('[history append] write error:', e.message)
    }
  }
}

router.post('/', async (req, res) => {
  const { customerId, customerName, salespersonId, salespersonName, shop, ro_number, insurer, vin, vehicle, year, make, model, claim, calibrations, pdfBase64, pdfFilename, notes } = req.body

  // Demo mode — return a realistic-looking fake invoice without hitting Zoho Books
  if (req.user?.demo) {
    const demoEstimateNum = `EST-DEMO-${String(Math.floor(Math.random() * 9000) + 1000)}`
    return res.json({
      estimate_id: `demo-${Date.now()}`,
      estimate_number: demoEstimateNum,
      estimate_url: '#',
      workdrive_url: 'https://workdrive.zohoexternal.com/demo',
      _demo: true,
    })
  }

  try {
    // Clean up technician notes before sending to Zoho Books
    const cleanedCalibrations = calibrations?.length
      ? await cleanDescriptions(calibrations)
      : calibrations

    const result = await createDraftQuote({
      customerId: customerId || null,
      customerName: customerName || null,
      salespersonId: salespersonId || null,
      salespersonName: salespersonName || null,
      shop,
      ro_number,
      vin,
      vehicle,
      year,
      make,
      model,
      insurer,
      claim,
      calibrations: cleanedCalibrations,
      pdfBase64: pdfBase64 || null,
      pdfFilename: pdfFilename || null,
      notes: notes || null,
    })

    // Auto-save enabled calibrations as rules to grow the DB over time (non-blocking)
    if (make && year && cleanedCalibrations?.length) {
      const enabledCals = cleanedCalibrations.filter(c => c.enabled !== false)
      for (const cal of enabledCals) {
        saveCalibrationAsRule(req, { make, model, year, calibration: cal }).catch(() => {})
      }
    }

    // History is written by the client (ToggleBoard / ManualQuoteScreen) after this response,
    // so we do NOT write it here — that would create duplicate history entries.
    res.json(result)
  } catch (err) {
    console.error('[invoice]', err.message)
    res.status(500).json({ error: err.message || 'Quote creation failed.' })
  }
})

export default router
