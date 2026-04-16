import catalyst from 'zcatalyst-sdk-node'

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
    console.warn('[notification-helper] Cache read failed:', e.message)
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
      console.error('[notification-helper] Cache save failed (update+put):', updateErr.message, '/', putErr.message)
    }
  }
}

/**
 * Create a notification programmatically (for use by cron jobs and other routes).
 * Follows the same storage pattern as notifications.js.
 *
 * @param {Request} req - Express request (needed for Catalyst init)
 * @param {Object} opts
 * @param {string} opts.title - Notification title
 * @param {string} opts.message - Notification body text
 * @param {string} opts.type - e.g. 'billing_reminder', 'overdue_alert', 'escalation'
 * @param {string} [opts.link] - Optional link/route within the app
 * @param {Object} [opts.data] - Optional extra metadata
 * @returns {Object} The created notification object
 */
export async function createNotification(req, { title, message, type, link, data }) {
  console.log(`[notification-helper] Creating notification — ${title}`)

  let all = []
  try {
    all = await getNotifications(req)
  } catch (e) {
    console.error('[notification-helper] Failed to read existing notifications:', e.message)
  }

  const notif = {
    id: 'n' + Date.now() + Math.random().toString(36).slice(2, 6),
    to: 'Mark',          // billing notifications go to admin
    type,
    title,
    body: message,
    jobId: data?.invoiceId || null,
    link: link || null,
    data: data || null,
    read: false,
    created_at: new Date().toISOString(),
  }

  all.unshift(notif)
  if (all.length > 200) all.length = 200

  try {
    await saveNotifications(req, all)
    console.log(`[notification-helper] Saved ${all.length} notifications to cache`)
  } catch (e) {
    console.error('[notification-helper] Failed to save notifications:', e.message)
  }

  return notif
}
