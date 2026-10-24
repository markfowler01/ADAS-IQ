// ADAS IQ early-access signup — POST /api/early-access
// Called from the adas-iq.com landing page form (no auth, honeypot inside).
// Saves lead to AdasEarlyAccess Datastore table and pings Mark's alert channel.
import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import multer from 'multer'

export const router = express.Router()
const upload = multer({ storage: multer.memoryStorage() }).any()
const clip = (v, n) => String(v ?? '').trim().slice(0, n)

router.post('/', upload, async (req, res) => {
  try {
    const body = req.body || {}
    const name    = clip(body.name,    120)
    const company = clip(body.company, 120)
    const email   = clip(body.email,   200)
    const pain    = clip(body.pain,    1000)
    const hp      = clip(body.website, 10)  // honeypot

    if (hp) return res.status(200).json({ ok: true })  // bot
    if (!name || !company || !email) return res.status(400).json({ error: 'Missing required fields' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' })

    const app = catalyst.initialize(req)
    const datastore = app.datastore()
    const table = datastore.table('AdasEarlyAccess')

    const row = await table.insertRow({
      name,
      company,
      email,
      pain,
      source: 'adas-iq.com',
      submitted_at: new Date().toISOString(),
    })

    const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
    const msg = `🎯 *New ADAS IQ early-access request*\n\n*${name}* — ${company}\n📧 ${email}\n\n*Their biggest headache:*\n"${pain}"\n\n→ Reply directly or text them from the app.`
    await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg).catch(e => console.warn('[early-access cliq]', e.message))

    res.status(200).json({ ok: true, id: row?.ROWID || row?.rowid })
  } catch (e) {
    console.error('[early-access]', e.message)
    res.status(500).json({ error: 'Server error' })
  }
})
