import express from 'express'
import multer from 'multer'
import Anthropic from '@anthropic-ai/sdk'

const router = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are accepted'))
    } else {
      cb(null, true)
    }
  },
})

router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image provided.' })
  }

  const base64Image = req.file.buffer.toString('base64')
  const mimeType = req.file.mimetype || 'image/jpeg'

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64Image },
          },
          {
            type: 'text',
            text: `This is a photo of a repair order or vehicle document from an auto body shop.

Extract the following fields and return ONLY a raw JSON object — no markdown, no explanation:

{
  "shop_name": "repair shop or customer name, or null",
  "ro_number": "repair order number (look for RO#, R.O., Work Order #, W/O, or similar), or null",
  "year": "4-digit model year, or null",
  "make": "vehicle manufacturer (Toyota, Ford, Honda, etc.), or null",
  "model": "vehicle model name, or null",
  "vin": "VIN number or last 4 characters if partially visible, or null",
  "notes": "any damage descriptions, what work is needed, or special instructions, or null"
}

Use null for any field you cannot find. Return raw JSON only.`,
          },
        ],
      }],
    })

    const raw = message.content[0].text.trim()
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      console.warn('[extract-ro-image] Claude returned non-JSON:', cleaned.slice(0, 200))
      return res.status(422).json({ error: 'Could not read image. Please fill in the form manually.' })
    }

    res.json(parsed)
  } catch (err) {
    console.error('[extract-ro-image]', err.message)
    res.status(500).json({ error: err.message || 'Image extraction failed.' })
  }
})

export default router
