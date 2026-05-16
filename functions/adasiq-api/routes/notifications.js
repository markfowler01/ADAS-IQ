import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
import { getMailAccessToken, getMailAccountId, sendMail } from '../services/mail.js'
import { getTechEmail } from './settings.js'
import { postToCliqUser, postToCliqChannelById, postToCliqChannel, TECH_CLIQ_IDS, TECHNICIANS_CHANNEL, MARK_ALERT_CHANNEL_ID } from '../services/cliq.js'

const router = express.Router()
const CACHE_KEY = 'adas_iq_notifications'

function getSegment(req) {
  const app = catalyst.initialize(req)
  return app.cache().segment()
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

async function getNotifications(req) {
  try {
    const seg = getSegment(req)
    const item = await seg.get(CACHE_KEY)
    return item?.cache_value ? JSON.parse(item.cache_value) : []
  } catch (e) {
    if (isNotFound(e)) return []
    console.warn('[notifications] Cache read failed:', e.message)
    return []
  }
}

async function saveNotifications(req, notifications) {
  const value = JSON.stringify(notifications)
  const seg = getSegment(req)
  try {
    await seg.update(CACHE_KEY, value)
  } catch (updateErr) {
    try {
      await seg.put(CACHE_KEY, value)
    } catch (putErr) {
      console.error('[notifications] Cache save failed (update+put):', updateErr.message, '/', putErr.message)
    }
  }
}

// Status label + color map matching the Kanban board
const STATUS_MAP = {
  job_requested:    { label: 'Job Requested',   bg: '#e0f2fe', color: '#0369a1', border: '#bae6fd' },
  need_dispatch:    { label: 'Need to Dispatch', bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
  dispatched_jaden: { label: 'Dispatched to Jaden', bg: '#dbeafe', color: '#1e40af', border: '#bfdbfe' },
  dispatched_mark:  { label: 'Dispatched to Mark',  bg: '#ede9fe', color: '#6d28d9', border: '#ddd6fe' },
  pending_parts:    { label: 'Pending Parts',  bg: '#fff7ed', color: '#9a3412', border: '#fed7aa' },
  ready_invoice:    { label: 'Ready to Invoice',bg: '#fdf4ff', color: '#7e22ce', border: '#e9d5ff' },
  complete:         { label: 'Complete',        bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
}

function buildCardHtml(job) {
  if (!job) return ''

  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ') || 'Unknown vehicle'
  const st = STATUS_MAP[job.status] || { label: job.status || 'New', bg: '#f5f3f0', color: '#555', border: '#e0dbd6' }

  // Parse calibrations
  let cals = []
  try {
    cals = typeof job.calibrations === 'string' ? JSON.parse(job.calibrations) : (job.calibrations || [])
  } catch { cals = [] }

  const calTags = cals.slice(0, 6).map(c => {
    const name = c.name || c.calibration_name || c
    const mode = c.mode && c.mode.toLowerCase() !== 'static' ? ` (${c.mode})` : ''
    return `<span style="display:inline-block;font-size:11px;padding:2px 7px;border-radius:5px;margin:2px;background:#fdf3ef;color:#CD4419;font-weight:500;">${name}${mode}</span>`
  }).join('')

  const moreTag = cals.length > 6 ? `<span style="display:inline-block;font-size:11px;padding:2px 7px;border-radius:5px;margin:2px;background:#f5f3f0;color:#aaa;">+${cals.length - 6} more</span>` : ''

  // PCSI + POST always
  const fixedTags = `<span style="display:inline-block;font-size:11px;padding:2px 7px;border-radius:5px;margin:2px;background:#dbeafe;color:#1e40af;font-weight:600;">PCSI</span><span style="display:inline-block;font-size:11px;padding:2px 7px;border-radius:5px;margin:2px;background:#dbeafe;color:#1e40af;font-weight:600;">POST</span>`

  return `
    <div style="border:1px solid #e8e4e0;border-radius:12px;padding:16px;background:white;max-width:380px;margin:16px 0;font-family:-apple-system,system-ui,sans-serif;">
      <!-- Shop + status -->
      <div style="margin-bottom:6px;">
        <span style="font-weight:600;font-size:14px;color:#1a1a1a;">${job.shop_name || 'No shop'}</span>
        <span style="display:inline-block;font-size:11px;font-weight:500;padding:2px 8px;border-radius:999px;margin-left:8px;background:${st.bg};color:${st.color};border:1px solid ${st.border};">${st.label}</span>
      </div>
      <!-- Vehicle -->
      <div style="font-size:13px;color:#555;margin-bottom:8px;">${vehicle}</div>
      <!-- Meta row -->
      <div style="font-size:12px;color:#aaa;margin-bottom:10px;">
        ${job.technician ? `<span style="margin-right:10px;">👤 ${job.technician}</span>` : ''}
        ${job.scheduled_date ? `<span style="margin-right:10px;">📅 ${job.scheduled_date}</span>` : ''}
        ${job.insurer ? `<span>🏢 ${job.insurer}</span>` : ''}
      </div>
      <!-- Calibrations -->
      <div style="line-height:1.8;">
        ${calTags}${moreTag}${fixedTags}
      </div>
    </div>
  `
}

/**
 * Send email notification with Kanban card rendering.
 */
async function emailNotify(toEmail, title, body, job) {
  if (!toEmail) { console.log('[notifications] No email provided — skipping'); return }
  try {
    const token = await getMailAccessToken()
    const accountId = await getMailAccountId(token)
    const cardHtml = buildCardHtml(job)

    // Build subject: "2024 Toyota RAV4 — Front Radar, Forward Camera, PCSI, POST"
    let subject = `ADAS IQ — ${title}`
    if (job) {
      const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
      const shop = job.shop_name || ''
      let cals = []
      try { cals = typeof job.calibrations === 'string' ? JSON.parse(job.calibrations) : (job.calibrations || []) } catch {}
      const calNames = cals.map(c => c.name || c.calibration_name || c).filter(Boolean).slice(0, 5)
      calNames.push('PCSI', 'POST')
      const parts = [vehicle, shop].filter(Boolean).join(' @ ')
      subject = parts
        ? `${parts} — ${calNames.join(', ')} - get some!`
        : `New Job — ${calNames.join(', ')} - get some!`
    }

    await sendMail(token, accountId, {
      to: toEmail,
      subject,
      body: `
        <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px;">
          <div style="background: #CD4419; color: white; padding: 12px 18px; border-radius: 8px 8px 0 0; font-weight: 600; font-size: 15px;">
            ADAS IQ Notification
          </div>
          <div style="border: 1px solid #ebebeb; border-top: none; border-radius: 0 0 8px 8px; padding: 18px;">
            <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px; color: #1a1a1a;">${title}</div>
            <div style="font-size: 13px; color: #888; margin-bottom: 4px;">${body}</div>
            ${cardHtml}
            <div style="margin-top: 16px;">
              <a href="https://adas-iq-904191467.development.catalystserverless.com/app/index.html"
                style="display: inline-block; background: #CD4419; color: white; padding: 8px 18px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600;">
                Open ADAS IQ
              </a>
            </div>
          </div>
        </div>
      `,
    })
    console.log(`[notifications] Email sent to ${toEmail} — ${title}`)
  } catch (err) {
    console.error(`[notifications] Email to ${toEmail} failed:`, err.message)
  }
}

// Fallback hardcoded map (used if settings haven't been configured yet)
const FALLBACK_EMAILS = {
  'jaden':  'jayden@absoluteadas.com',
  'mark':   'mf@absoluteadas.com',
  'kath':   'k.belmonte@absoluteadas.com',
}

/**
 * Create a notification + send emails to BOTH the dispatcher and the assigned tech.
 * @param {Request} req
 * @param {{ to, toEmail, type, title, body, jobId }} data
 *   - to: tech name (for in-app filtering + tech email lookup)
 *   - toEmail: dispatcher's email (the logged-in user)
 */
export async function createNotification(req, { to, toEmail, type, title, body, jobId, job }) {
  console.log(`[notifications] Creating notification for "${to}" — ${title}`)
  let all = []
  try {
    all = await getNotifications(req)
  } catch (e) {
    console.error('[notifications] Failed to read existing notifications:', e.message)
  }
  const notif = {
    id: 'n' + Date.now() + Math.random().toString(36).slice(2, 6),
    to,
    type,
    title,
    body,
    jobId,
    read: false,
    created_at: new Date().toISOString(),
  }
  all.unshift(notif)
  if (all.length > 200) all.length = 200
  try {
    await saveNotifications(req, all)
    console.log(`[notifications] Saved ${all.length} notifications to cache`)
  } catch (e) {
    console.error('[notifications] Failed to save notifications:', e.message)
  }

  // Send email + Cliq DM in parallel. Awaited so they actually complete before
  // the route handler responds — Catalyst kills the function instance once the
  // response is sent, so fire-and-forget promises silently drop.
  await Promise.all([
    (async () => {
      try {
        let emailAddr = await getTechEmail(req, to)
        if (!emailAddr) emailAddr = FALLBACK_EMAILS[to?.toLowerCase().trim()] || null
        if (!emailAddr && toEmail && toEmail.includes('@')) emailAddr = toEmail
        if (emailAddr) await emailNotify(emailAddr, title, body, job)
        else console.log(`[notifications] No email found for "${to}" — configure in Settings`)
      } catch (e) {
        console.warn('[notifications] Email failed:', e.message)
      }
    })(),
    (async () => {
      try {
        const vehicle = job?.vehicle || [job?.year, job?.make, job?.model].filter(Boolean).join(' ') || ''
        const shop = job?.shop_name || ''
        const isDispatch = type === 'job_assigned' || type === 'job_updated'
        const isReadyInvoice = type === 'job_ready_invoice'

        let cliqMsg
        if (isReadyInvoice && job) {
          const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ') || ''
          const roMatch = (job.notes || '').match(/RO#[:\s]*([^\s|,]+)/i)
          const roNum = roMatch?.[1] || ''
          const timeStr = new Date().toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles',
          })
          const booksLink = job.quote_url || job.report_url || ''
          const jobBoardUrl = 'https://adas-iq-904191467.development.catalystserverless.com/app/index.html'

          const lines = [
            `🟢 *Ready to Invoice: ${job.shop_name || 'Job'}*`,
            '',
            vehicle ? `🚗 ${vehicle}` : null,
            roNum ? `📋 RO#: ${roNum}` : null,
            job.technician ? `👤 Tech: ${job.technician}` : null,
            `⏰ ${timeStr}`,
            '',
            booksLink ? `📗 Open in Zoho Books:\n${booksLink}` : null,
            `🗂 Job Board: ${jobBoardUrl}`,
          ]
          cliqMsg = lines.filter(l => l !== null).join('\n')
        } else if (isDispatch && job) {
          // Rich dispatch message — full job details
          let cals = []
          try { cals = typeof job.calibrations === 'string' ? JSON.parse(job.calibrations) : (job.calibrations || []) } catch {}
          const calLines = cals.map(c => {
            const name = c.name || c.calibration_name || c
            const mode = c.mode && c.mode.toLowerCase() !== 'static' ? ` (${c.mode})` : ''
            return `• ${name}${mode}`
          })
          calLines.push('• PCSI', '• POST')

          // Extract RO# from notes (e.g. "RO#: 20463 | Quote: ABS 20463.1" → "20463")
          const roMatch = (job.notes || '').match(/RO#[:\s]*([^\s|,]+)/i)
          const roNum = roMatch?.[1] || ''
          // Extra notes = anything that isn't the RO# or Quote segment
          const extraNotes = (job.notes || '')
            .replace(/RO#[:\s]*[^\s|,]+/i, '')
            .replace(/\|?\s*Quote[:\s]*\S+/i, '')
            .trim()

          const jobBoardUrl = 'https://adas-iq-904191467.development.catalystserverless.com/app/index.html'

          const lines = [
            `🔔 *${title}*`,
            '',
            `🏢 ${shop || 'No shop'}`,
            vehicle ? `🚗 ${vehicle}${job.vin ? ' · VIN: ' + job.vin : ''}` : null,
            job.insurer ? `🏦 ${job.insurer}` : null,
            job.scheduled_date ? `📅 ${job.scheduled_date}` : null,
            '',
            // RO# + vehicle above calibrations
            roNum ? `📋 RO#: ${roNum} · ${[job.year, job.make, job.model].filter(Boolean).join(' ') || vehicle}` : null,
            '',
            'Calibrations:',
            ...calLines,
            extraNotes ? `\n📝 ${extraNotes}` : null,
            '\n' + [
              job.folder_url ? `📁 WorkDrive: ${job.folder_url}` : null,
              job.report_url ? `📄 Report: ${job.report_url}` : null,
              `🗂 Job Board: ${jobBoardUrl}`,
            ].filter(Boolean).join('\n'),
          ]
          cliqMsg = lines.filter(l => l !== null).join('\n')
        } else {
          // Simple message for non-dispatch notifications
          const jobBoardUrl = 'https://adas-iq-904191467.development.catalystserverless.com/app/index.html'
          const date = job?.scheduled_date ? ` · 📅 ${job.scheduled_date}` : ''
          cliqMsg = [
            `🔔 *${title}*`,
            body || '',
            vehicle && shop ? `${vehicle} @ ${shop}${date}` : (vehicle || shop || ''),
            `\n🗂 Job Board: ${jobBoardUrl}`,
          ].filter(Boolean).join('\n')
        }

        const nameKey = to?.toLowerCase().trim()
        if (nameKey === 'mark') {
          await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, cliqMsg)
        } else {
          const cliqId = TECH_CLIQ_IDS[to] || TECH_CLIQ_IDS[
            Object.keys(TECH_CLIQ_IDS).find(k => k.toLowerCase() === nameKey)
          ]
          if (cliqId) await postToCliqUser(cliqId, cliqMsg)
          else console.log(`[notifications] No Cliq ID for "${to}" — skipping DM`)
        }

        // Also post to #technicians channel for dispatch + ready_invoice events
        if (isDispatch || isReadyInvoice) {
          await postToCliqChannel(TECHNICIANS_CHANNEL, cliqMsg)
        }

        console.log(`[notifications] Cliq sent to "${to}"${(isDispatch || isReadyInvoice) ? ' + #technicians' : ''}`)
      } catch (e) {
        console.warn(`[notifications] Cliq to "${to}" failed:`, e.message)
      }
    })(),
  ])

  return notif
}

// GET /api/notifications?user=Jaden
router.get('/', async (req, res) => {
  const user = req.query.user || ''
  if (!user) return res.json({ ok: true, notifications: [] })
  try {
    const all = await getNotifications(req)
    const isAdmin = req.query.role !== 'technician'
    const filtered = isAdmin
      ? all.slice(0, 50)
      : all.filter(n => n.to?.toLowerCase() === user.toLowerCase()).slice(0, 50)
    const unread = filtered.filter(n => !n.read).length
    res.json({ ok: true, notifications: filtered, unread })
  } catch (err) {
    console.error('[notifications GET]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/notifications/read
router.patch('/read', async (req, res) => {
  const { ids, user } = req.body
  try {
    const all = await getNotifications(req)
    let count = 0
    for (const n of all) {
      if (n.read) continue
      const isForUser = !user || n.to?.toLowerCase() === user.toLowerCase()
      if (!isForUser) continue
      if (ids === 'all' || (Array.isArray(ids) && ids.includes(n.id))) {
        n.read = true
        count++
      }
    }
    await saveNotifications(req, all)
    res.json({ ok: true, marked: count })
  } catch (err) {
    console.error('[notifications PATCH]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/notifications/test — test creating a notification + cache read/write
router.get('/test', async (req, res) => {
  const errors = []
  let step = 'init'
  try {
    step = 'getSegment'
    const seg = getSegment(req)

    step = 'cache read'
    let all = []
    try {
      const item = await seg.get(CACHE_KEY)
      all = item?.cache_value ? JSON.parse(item.cache_value) : []
    } catch (e) {
      errors.push(`read: ${e.message} (statusCode: ${e.statusCode})`)
    }

    step = 'cache write'
    const testNotif = {
      id: 'test_' + Date.now(),
      to: 'Mark',
      type: 'job_assigned',
      title: 'Test notification',
      body: 'This is a test notification',
      jobId: 'test',
      read: false,
      created_at: new Date().toISOString(),
    }
    all.unshift(testNotif)

    try {
      await seg.update(CACHE_KEY, JSON.stringify(all))
      errors.push('update: OK')
    } catch (updateErr) {
      errors.push(`update failed: ${updateErr.message}`)
      try {
        await seg.put(CACHE_KEY, JSON.stringify(all))
        errors.push('put: OK')
      } catch (putErr) {
        errors.push(`put failed: ${putErr.message}`)
      }
    }

    step = 'verify read'
    let verified = []
    try {
      const item2 = await seg.get(CACHE_KEY)
      verified = item2?.cache_value ? JSON.parse(item2.cache_value) : []
    } catch (e) {
      errors.push(`verify read: ${e.message}`)
    }

    res.json({ ok: true, steps: errors, notifCount: verified.length, firstNotif: verified[0]?.title })
  } catch (e) {
    res.status(500).json({ ok: false, step, error: e.message, steps: errors })
  }
})

export default router
