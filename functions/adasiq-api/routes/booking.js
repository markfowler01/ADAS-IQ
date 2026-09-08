// Website booking (Mark 2026-09-07): absoluteadas.com/#contact →
//   POST /api/public/booking/calibration  → a Job Requested card on the
//     day the shop asked for (before/after lunch), tagged 🌐 Website
//     booking, matched to the CRM shop, + alerts: #aajobs, #dispatch,
//     Kat's bell, Mark's alerts channel, SMS to Kat + Mark, and an
//     instant confirmation text/email to the shop.
//   POST /api/public/booking/snapshot     → Revenue Snapshot request →
//     Mark's alerts + SMS, confirmation email to the shop, CRM lead.
//
// Same public-form rules as the careers form: multipart via plain multer
// (.any()), honeypot, everything awaited before the response, and the
// site normalizes values (Catalyst's gateway truncates a multipart body
// at any value starting with "(").
import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import multer from 'multer'

export const publicRouter = express.Router()
const q = s => String(s ?? '').replace(/'/g, "''")
const clip = (v, n) => String(v ?? '').trim().slice(0, n)
const digits = s => String(s || '').replace(/\D/g, '')
const wdId = r => String((r && typeof r === 'object') ? (r.fileId || r.id || r.resource_id || '') : (r || ''))
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }).any()
const WINDOWS = { am: 'Before lunch', pm: 'After lunch', any: 'Any time' }

function fmtDay(iso) {
  const d = new Date(`${iso}T12:00:00`)
  return isNaN(d) ? iso : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function normPhone(p) {
  let d = digits(p)
  if (d.length === 11 && d[0] === '1') d = d.slice(1)
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : clip(p, 40)
}

// CRM shop match — exact (case-insensitive) name first, then contains.
async function matchShop(req, name) {
  const target = String(name || '').trim().toLowerCase()
  if (!target) return null
  try {
    const app = catalyst.initialize(req)
    const rows = await app.zcql().executeZCQLQuery(`SELECT ROWID, shop_name FROM CRMShops LIMIT 300`)
    const shops = (rows || []).map(r => r?.CRMShops || r).filter(s => s?.shop_name)
    const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
    return shops.find(s => norm(s.shop_name) === norm(target))
      || shops.find(s => norm(s.shop_name).includes(norm(target)) || norm(target).includes(norm(s.shop_name)))
      || null
  } catch { return null }
}

async function smsMany(req, cfg, numbers, body) {
  const { sendTwilioSMS } = await import('../services/twilio.js')
  const results = []
  for (const to of numbers.filter(Boolean)) {
    try { await sendTwilioSMS({ to, body, from: 'local', cfg }); results.push({ to, ok: true }) }
    catch (e) { console.log('[booking sms]', to, e.message); results.push({ to, ok: false }) }
  }
  return results
}

async function emailShop(to, subject, html, text) {
  if (!to) return
  try {
    const { sendBroadcast, resendConfigured } = await import('../services/brewResend.js')
    if (!resendConfigured()) return
    await sendBroadcast({ recipients: [to], subject, html, text, fromName: 'Absolute ADAS', replyTo: 'mark@absoluteadas.com' })
  } catch (e) { console.log('[booking email]', e.message) }
}

const bounded = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))])

// ── Book a calibration ───────────────────────────────────────────────────
publicRouter.post('/calibration', (req, res) => {
  upload(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message })
    res.set('Access-Control-Allow-Origin', '*')
    try {
      const b = req.body || {}
      if (b.website && String(b.website).trim()) return res.status(400).json({ error: 'Invalid submission' })
      const shop = clip(b.shop, 200)
      const contact = clip(b.contact, 120)
      const phone = normPhone(b.phone)
      const email = clip(b.email, 200).toLowerCase()
      const year = clip(b.year, 4), make = clip(b.make, 60), model = clip(b.model, 80)
      const vin = clip(b.vin, 20).toUpperCase().replace(/[^A-Z0-9]/g, '')
      const ro = clip(b.ro, 40)
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : ''
      const win = WINDOWS[b.window] ? b.window : 'any'
      const needs = clip(b.needs, 500), notes = clip(b.notes, 2000)
      if (!shop) return res.status(400).json({ error: 'Shop name is required' })
      if (!phone && !email) return res.status(400).json({ error: 'A phone number or email is required' })
      if (!date) return res.status(400).json({ error: 'Pick the day you need us' })

      const crmShop = await matchShop(req, shop)
      const shopName = crmShop?.shop_name || shop
      const vehicle = [year, make, model].filter(Boolean).join(' ')
      const noteLines = [
        `🌐 Website booking · ${WINDOWS[win]}`,
        `Contact: ${contact || '—'}${phone ? ` · 📞 ${phone}` : ''}${email ? ` · ✉ ${email}` : ''}`,
        crmShop ? '' : '⚠️ Shop not in CRM — add them',
        needs ? `Needs: ${needs}` : '',
        notes ? `Notes: ${notes}` : '',
      ].filter(Boolean)

      const { insertJobPublic, resolveJobFolderPublic } = await import('./jobs.js')
      const job = await insertJobPublic(req, {
        shop_name: shopName, vehicle, year, make, model, vin, technician: '',
        scheduled_date: date, status: 'job_requested', via_request: true, request_type: 'job',
        calibrations: '[]', notes: noteLines.join('\n'), quote_number: ro, source: 'website',
      })

      // Optional estimate photo → the job's WorkDrive folder (non-fatal)
      const photo = (Array.isArray(req.files) ? req.files : []).find(f => f.fieldname === 'photo')
      if (photo) {
        try {
          const { getAccessToken } = await import('../services/zoho.js')
          const { uploadFileToFolder } = await import('../services/workdrive.js')
          const wdToken = await getAccessToken()
          const folderId = await resolveJobFolderPublic(req, job, wdToken)
          if (folderId) await uploadFileToFolder(folderId, `estimate-${Date.now()}.${(photo.mimetype.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`, photo.buffer, wdToken, photo.mimetype)
        } catch (e) { console.log('[booking photo]', e.message) }
      }

      // Alerts (all bounded; the shop's confirmation goes out regardless)
      const line1 = `🌐 *Website booking* · ${shopName}${crmShop ? '' : ' (new shop)'}`
      const line2 = `${vehicle || 'Vehicle TBD'}${ro ? ` · RO# ${ro}` : ''} · 📅 ${fmtDay(date)} · ${WINDOWS[win]}`
      const line3 = `${contact || 'Contact TBD'}${phone ? ` · ${phone}` : ''}${needs ? `\nNeeds: ${needs}` : ''}`
      const cliqMsg = `${line1}\n${line2}\n${line3}\nKat — confirm it on the scheduler.`
      const smsMsg = `Web booking: ${shopName} · ${vehicle || 'vehicle TBD'} · ${fmtDay(date)} ${WINDOWS[win].toLowerCase()}${ro ? ` · RO ${ro}` : ''}. Confirm on the scheduler.`
      const tasks = []
      tasks.push((async () => {
        const { postToCliqChannel, postToCliqChannelById, AA_JOBS_CHANNEL, DISPATCH_CHANNEL, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
        await Promise.all([
          postToCliqChannel(AA_JOBS_CHANNEL, cliqMsg).catch(() => {}),
          postToCliqChannel(DISPATCH_CHANNEL, cliqMsg).catch(() => {}),
          postToCliqChannelById(MARK_ALERT_CHANNEL_ID, cliqMsg).catch(() => {}),
        ])
      })())
      tasks.push((async () => {
        const { createNotification } = await import('./notifications.js')
        await createNotification(req, {
          to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com', type: 'job_requested',
          title: `🌐 Website booking: ${shopName}`, body: `${vehicle || 'Vehicle TBD'} · ${fmtDay(date)} ${WINDOWS[win]}`,
          jobId: job.id, job, skipCliq: true, skipTechChannel: true,
        })
      })().catch(() => {}))
      tasks.push((async () => {
        const { resolvePhoneConfig } = await import('../services/phoneConfig.js')
        const cfg = await resolvePhoneConfig(req)
        await smsMany(req, cfg, [cfg.KAT_PHONE_NUMBER, cfg.MARK_PHONE_NUMBER], smsMsg)
        // Shop confirmation text
        if (phone) await smsMany(req, cfg, [phone], `Absolute ADAS: got your booking for ${fmtDay(date)}, ${WINDOWS[win].toLowerCase()}${vehicle ? ` (${vehicle})` : ''}. Kat will confirm shortly. Reply here with any changes.`)
      })().catch(e => console.log('[booking sms]', e.message)))
      tasks.push(emailShop(email, `We got your booking — ${fmtDay(date)}, ${WINDOWS[win].toLowerCase()}`,
        `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;color:#1a1a1a"><p>Hi ${contact || 'there'},</p><p>We've penciled in <b>${vehicle || 'your vehicle'}</b> for <b>${fmtDay(date)}, ${WINDOWS[win].toLowerCase()}</b>${ro ? ` (RO# ${ro})` : ''}. Kat will confirm shortly by text.</p><p>Need to change anything? Just reply to this email.</p><p>— Absolute ADAS<br><span style="color:#666">Same Day. Done Right.</span></p></div>`,
        `Hi ${contact || 'there'},\n\nWe've penciled in ${vehicle || 'your vehicle'} for ${fmtDay(date)}, ${WINDOWS[win].toLowerCase()}${ro ? ` (RO# ${ro})` : ''}. Kat will confirm shortly by text.\n\nNeed to change anything? Just reply to this email.\n\n— Absolute ADAS`))
      tasks.push((async () => {
        const { syncNewsletterSubscriberToCrm } = await import('../services/zohoCrm.js')
        await syncNewsletterSubscriberToCrm({ email, name: contact, shop: shopName, source: 'Website booking' })
      })().catch(() => {}))
      await bounded(Promise.all(tasks), 18000)
      res.json({ ok: true, day: fmtDay(date), window: WINDOWS[win] })
    } catch (e) {
      console.error('[booking calibration]', e.message)
      res.status(500).json({ error: 'Something went wrong — call or text us and we\'ll get you on the schedule.' })
    }
  })
})

// ── Revenue Snapshot request ─────────────────────────────────────────────
publicRouter.post('/snapshot', express.json({ limit: '32kb' }), express.urlencoded({ extended: false, limit: '32kb' }), async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  try {
    const b = req.body || {}
    if (b.website && String(b.website).trim()) return res.status(400).json({ error: 'Invalid submission' })
    const shop = clip(b.shop, 200), contact = clip(b.contact, 120)
    const phone = normPhone(b.phone), email = clip(b.email, 200).toLowerCase()
    const cars = clip(b.cars, 40), best = clip(b.best_time, 120), notes = clip(b.notes, 1000)
    if (!shop) return res.status(400).json({ error: 'Shop name is required' })
    if (!phone && !email) return res.status(400).json({ error: 'A phone number or email is required' })
    const msg = `📊 *Revenue Snapshot request* · ${shop}\n${contact || 'Contact TBD'}${phone ? ` · ${phone}` : ''}${email ? ` · ${email}` : ''}${cars ? ` · ~${cars} cars/mo` : ''}\n${best ? `Best time: ${best}` : ''}${notes ? `\n${notes}` : ''}`
    const tasks = []
    tasks.push((async () => {
      const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('../services/cliq.js')
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg)
    })().catch(() => {}))
    tasks.push((async () => {
      const { resolvePhoneConfig } = await import('../services/phoneConfig.js')
      const cfg = await resolvePhoneConfig(req)
      await smsMany(req, cfg, [cfg.MARK_PHONE_NUMBER], `Snapshot request: ${shop} · ${contact || ''}${phone ? ` · ${phone}` : ''}${cars ? ` · ~${cars} cars/mo` : ''}`)
    })().catch(() => {}))
    // No auto-reply to the shop here — Mark sends his own follow-up. The
    // request is logged durably so nothing is lost if a ping is missed.
    tasks.push((async () => {
      const app = catalyst.initialize(req)
      await app.datastore().table('AppConfig').insertRow({
        config_key: `snapshot_req:${Date.now()}`.slice(0, 64),
        config_value: JSON.stringify({ shop, contact, phone, email, cars, best_time: best, notes, at: new Date().toISOString() }),
      })
    })().catch(e => console.log('[booking snapshot log]', e.message)))
    tasks.push((async () => {
      const { syncNewsletterSubscriberToCrm } = await import('../services/zohoCrm.js')
      await syncNewsletterSubscriberToCrm({ email, name: contact, shop, source: 'Revenue Snapshot request' })
    })().catch(() => {}))
    await bounded(Promise.all(tasks), 14000)
    res.json({ ok: true })
  } catch (e) {
    console.error('[booking snapshot]', e.message)
    res.status(500).json({ error: 'Something went wrong — call or text us instead.' })
  }
})

publicRouter.options('*', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type'); res.status(204).end()
})
