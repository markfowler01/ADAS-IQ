// Dedicated VIN reader (Mark 2026-09-03). The extract-ro-image scanner
// is tuned for CCC estimate paperwork — this one reads VIN plates:
// door-jamb stickers, windshield VIN plates, barcode labels.
import express from 'express'
import multer from 'multer'
import Anthropic from '@anthropic-ai/sdk'

const router = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) cb(new Error('Only image files are accepted'))
    else cb(null, true)
  },
})

// VINs never contain I, O, or Q. 17 chars on anything 1981+.
const VIN_RE = /[A-HJ-NPR-Z0-9]{17}/

router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided.' })
  const base64Image = req.file.buffer.toString('base64')
  const mimeType = req.file.mimetype || 'image/jpeg'
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
          { type: 'text', text:
            `This photo shows a vehicle VIN — likely a door-jamb sticker, windshield VIN plate, registration, or barcode label.\n\n` +
            `Find the 17-character VIN. VINs use digits and capital letters but NEVER the letters I, O, or Q — ` +
            `if a character looks like I/O/Q it is 1/0/9 or another valid character.\n\n` +
            `Return ONLY raw JSON, no markdown: {"vin": "<17 chars>" } or {"vin": null} if no VIN is readable.` },
        ],
      }],
    })
    const raw = message.content[0].text.trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
    let parsed
    try { parsed = JSON.parse(raw) } catch {
      return res.status(422).json({ error: 'Could not read the VIN. Try a closer, straight-on shot.' })
    }
    const cleaned = String(parsed?.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const vin = cleaned.match(VIN_RE)?.[0] || ''
    if (!vin) return res.status(422).json({ error: 'No full 17-character VIN found in that photo.' })
    res.json({ vin })
  } catch (err) {
    console.error('[extract-vin-image]', err.message)
    res.status(500).json({ error: err.message || 'VIN extraction failed.' })
  }
})

export default router
