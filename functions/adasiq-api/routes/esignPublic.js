// ✍️ Public signing page API (no login; HMAC link from services/esign.js).
import express from 'express'
const router = express.Router()
const ip = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()

async function guard(req, res) {
  const es = await import('../services/esign.js')
  const env = await es.readEnvelope(req, req.params.id)
  if (!env || !es.verifyToken(req.query.t || req.body?.t, env)) { res.status(401).json({ error: 'This signing link is not valid any more. Ask Mark for a new one.' }); return null }
  return { es, env }
}
router.get('/:id', async (req, res) => {
  try {
    const g = await guard(req, res); if (!g) return
    const { env } = g
    res.json({ ok: true, subject: env.subject, signer: env.signer.name, status: env.status, kind: env.kind, sent_at: env.sent_at, signed_at: env.signed_at || null })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/:id/pdf', async (req, res) => {
  try {
    const g = await guard(req, res); if (!g) return
    const pdf = await g.es.readPdf(req, g.env.id, g.env.status === 'completed')
    if (!pdf) return res.status(404).json({ error: 'Document not found' })
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `inline; filename="${g.env.subject.replace(/[^\w .,()-]+/g, ' ')}${g.env.status === 'completed' ? ' (signed)' : ''}.pdf"`)
    res.send(pdf)
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/:id/sign', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const g = await guard(req, res); if (!g) return
    if (g.env.status !== 'sent') return res.status(400).json({ error: g.env.status === 'completed' ? 'Already signed. Thank you!' : 'This document was withdrawn. Ask Mark for a new one.' })
    const b = req.body || {}
    try { await g.es.signEnvelope(req, g.env.id, { name: b.name, consent: b.consent === true, png: b.png, ip: ip(req), ua: req.headers['user-agent'] }) }
    catch (e) { return res.status(400).json({ error: e.message }) }
    console.log(`[esign] ${g.env.id} signed by ${b.name}`)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// Step 2, called by the page right after signing (and hourly as a backup).
router.post('/:id/finish', async (req, res) => {
  try {
    const g = await guard(req, res); if (!g) return
    const env = await g.es.finishEnvelope(req, g.env.id)
    res.json({ ok: true, copies_sent: !!env?.copies_sent, done: !!env?.hook_done })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
export default router
