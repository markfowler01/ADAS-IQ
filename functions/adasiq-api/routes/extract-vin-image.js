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
    // Textbook sample VINs the model falls back to when the photo is unreadable
    // (2026-10-06: JT2BF18K5M0025798 and 2G1FB1E39D1240124 landed on two Avon cards and
    // their reports went out on the wrong invoices). Never accept one.
    const SAMPLE_VINS = new Set(['JT2BF18K5M0025798', '2G1FB1E39D1240124', '1HGCM82633A004352', '1HGBH41JXMN109186', '5YJSA1E26HF000337', 'WBA3A5C51CF256291', '1FTFW1ET5EKE12345', 'JH4KA7561PC008269', '2HGFB2F5XEH542858', '1G1YY22G965105430'])
    if (SAMPLE_VINS.has(vin)) return res.status(422).json({ error: 'That came back as a textbook sample VIN, not this car. Take a closer, straight-on shot of the door-jamb sticker.' })
    const YEAR = { A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017, J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025, T: 2026, V: 2027, W: 2028, X: 2029, Y: 2030, 1: 2001, 2: 2002, 3: 2003, 4: 2004, 5: 2005, 6: 2006, 7: 2007, 8: 2008, 9: 2009 }
    const modelYear = YEAR[vin[9]] || null
    res.json({ vin, model_year: modelYear, ...(modelYear && modelYear < 2010 ? { warning: `Decodes as a ${modelYear} — double-check the sticker before you save it.` } : {}) })
  } catch (err) {
    console.error('[extract-vin-image]', err.message)
    res.status(500).json({ error: err.message || 'VIN extraction failed.' })
  }
})

export default router
