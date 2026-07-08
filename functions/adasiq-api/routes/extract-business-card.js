// POST /api/extract-business-card
//
// Mark snaps a photo of a shop employee's business card (or a paper opt-in
// slip) at the counter. This endpoint hands the image to Claude Haiku to
// extract first name, last name, email, phone, shop/company name, and
// title/role notes. The frontend then auto-populates the Van Contact
// modal so Mark can eyeball the result and submit in ~5 seconds.
//
// Mirrors routes/extract-ro-image.js — same multer setup, same Anthropic
// invocation, business-card-specific prompt. Errors return 422 with a
// friendly message so the modal can prompt the user to fill in manually.

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
            text: `This is a photo of a business card OR a paper newsletter opt-in slip from an auto body shop or collision repair center.

Extract the contact's info. Return ONLY a raw JSON object — no markdown, no explanation:

{
  "first_name": "given name, or null",
  "last_name": "family name, or null",
  "email": "email address (lowercase), or null",
  "phone": "phone number in any format, or null",
  "shop_name": "the shop or company name printed on the card, or null",
  "title": "job title or role — Estimator, Owner, Service Manager, etc., or null",
  "notes": "anything useful for follow-up (department, secondary email, preferred contact method), or null"
}

Rules:
- If a mobile and office phone are both shown, prefer mobile.
- If there are multiple emails, pick the personal work email over generic aliases like info@ or sales@.
- Trim titles from names (no "Mr.", "Owner —", certifications like ", I-CAR").
- Return null for anything you can't confidently read.

Return raw JSON only.`,
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
      console.warn('[extract-business-card] Claude returned non-JSON:', cleaned.slice(0, 200))
      return res.status(422).json({ error: 'Could not read card. Fill in the form manually.' })
    }

    res.json(parsed)
  } catch (err) {
    console.error('[extract-business-card]', err.message)
    res.status(500).json({ error: err.message || 'Business card extraction failed.' })
  }
})

export default router
