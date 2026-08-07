// Web Push notifications for the installed PWA (Mark 2026-08-07:
// "ok can the app alert me also"). Inbound SMS on the 844 line pushes a
// native notification to every subscribed device; tapping it deep-links
// into that conversation (?thread=…).
//
//   GET  /api/push/public-key   → { key } — VAPID public key (auto-generates
//                                 the pair into phone_config on first call)
//   POST /api/push/subscribe    { subscription } — store this device
//   POST /api/push/unsubscribe  { endpoint } — remove this device
//   GET  /api/push/status       → { subscribed_devices }
//   POST /api/push/test         — send a test notification to every device
//
// Storage: AppConfig KV rows `push_sub:<hash of endpoint>` (same durable
// pattern as tech to-dos / card notes). VAPID keys live in phone_config
// (env vars are maxed) via phoneConfig.js.
//
// iOS requirement: push only works when the app is added to the Home
// Screen (iOS 16.4+) — the client button explains this when unsupported.

import express from 'express'
import crypto from 'crypto'
import catalyst from 'zcatalyst-sdk-node'
import {
  resolvePhoneConfig,
  setPhoneConfigValue,
} from '../services/phoneConfig.js'

const router = express.Router()
const TABLE = 'AppConfig'
const PREFIX = 'push_sub:'
const VAPID_SUBJECT = 'mailto:mark@absoluteadas.com'

function subKey(endpoint) {
  const h = crypto.createHash('sha256').update(String(endpoint || '')).digest('hex').slice(0, 32)
  return (PREFIX + h).slice(0, 64)
}

// Lazy import so a missing/broken web-push dep can never take down the
// whole function at load time (the Aug 5 outage lesson).
async function getWebPush() {
  const mod = await import('web-push')
  return mod.default || mod
}

// VAPID pair — read from phone_config, generate + persist on first use.
export async function ensureVapidKeys(req) {
  const cfg = await resolvePhoneConfig(req)
  let pub = cfg.VAPID_PUBLIC_KEY || ''
  let priv = cfg.VAPID_PRIVATE_KEY || ''
  if (pub && priv) return { publicKey: pub, privateKey: priv }
  const webpush = await getWebPush()
  const keys = webpush.generateVAPIDKeys()
  await setPhoneConfigValue(req, 'VAPID_PUBLIC_KEY', keys.publicKey)
  await setPhoneConfigValue(req, 'VAPID_PRIVATE_KEY', keys.privateKey)
  console.log('[push] generated new VAPID key pair')
  return { publicKey: keys.publicKey, privateKey: keys.privateKey }
}

async function readAllSubscriptions(req) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const subs = []
  const PAGE = 250
  for (let offset = 0; offset < 20000; offset += PAGE) {
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT ROWID, config_key, config_value FROM ${TABLE} LIMIT ${PAGE} OFFSET ${offset}`
    )
    for (const row of rows || []) {
      const r = row[TABLE] || row
      const key = String(r?.config_key || '')
      if (key.startsWith(PREFIX) && r.config_value) {
        try {
          const parsed = JSON.parse(r.config_value)
          if (parsed?.subscription?.endpoint) {
            subs.push({ rowid: String(r.ROWID), key, ...parsed })
          }
        } catch { /* skip malformed */ }
      }
    }
    if (!rows || rows.length < PAGE) break
  }
  return subs
}

async function deleteSubscriptionRow(req, rowid) {
  const app = catalyst.initialize(req, { type: 'advancedio' })
  await app.datastore().table(TABLE).deleteRow(String(rowid))
}

// Broadcast to every subscribed device. Exported for sms.js (inbound
// texts). Never throws — push is best-effort on top of Cliq + forward.
// Dead subscriptions (404/410 from the push service) are pruned.
export async function sendPushToAll(req, { title, body, url, tag }) {
  try {
    const { publicKey, privateKey } = await ensureVapidKeys(req)
    const webpush = await getWebPush()
    webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey)
    const subs = await readAllSubscriptions(req)
    if (subs.length === 0) return { sent: 0, total: 0 }
    const payload = JSON.stringify({ title, body, url, tag })
    let sent = 0
    for (const s of subs) {
      try {
        await webpush.sendNotification(s.subscription, payload, { TTL: 3600 })
        sent++
      } catch (e) {
        const code = e?.statusCode
        if (code === 404 || code === 410) {
          try { await deleteSubscriptionRow(req, s.rowid) } catch { /* best-effort */ }
          console.log('[push] pruned dead subscription', s.key)
        } else {
          console.warn('[push] send failed:', code, e.message)
        }
      }
    }
    return { sent, total: subs.length }
  } catch (e) {
    console.warn('[push] broadcast failed:', e.message)
    return { sent: 0, total: 0, error: e.message }
  }
}

router.get('/public-key', async (req, res) => {
  try {
    const { publicKey } = await ensureVapidKeys(req)
    res.json({ ok: true, key: publicKey })
  } catch (err) {
    console.error('[push public-key]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/subscribe', async (req, res) => {
  try {
    const sub = req.body?.subscription
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return res.status(400).json({ error: 'valid subscription required' })
    }
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const key = subKey(sub.endpoint)
    const value = JSON.stringify({
      subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      user: req.user?.email || req.user?.name || '',
      created_at: new Date().toISOString(),
    })
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE config_key = '${key}' LIMIT 1`
    )
    const existing = rows?.[0]?.[TABLE] || rows?.[0] || null
    const table = app.datastore().table(TABLE)
    if (existing?.ROWID) {
      await table.updateRow({ ROWID: String(existing.ROWID), config_key: key, config_value: value })
    } else {
      await table.insertRow({ config_key: key, config_value: value })
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('[push subscribe]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/unsubscribe', async (req, res) => {
  try {
    const endpoint = req.body?.endpoint
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' })
    const app = catalyst.initialize(req, { type: 'advancedio' })
    const key = subKey(endpoint)
    const rows = await app.zcql().executeZCQLQuery(
      `SELECT ROWID FROM ${TABLE} WHERE config_key = '${key}' LIMIT 1`
    )
    const existing = rows?.[0]?.[TABLE] || rows?.[0] || null
    if (existing?.ROWID) await deleteSubscriptionRow(req, existing.ROWID)
    res.json({ ok: true, removed: !!existing?.ROWID })
  } catch (err) {
    console.error('[push unsubscribe]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/status', async (req, res) => {
  try {
    const subs = await readAllSubscriptions(req)
    res.json({ ok: true, subscribed_devices: subs.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/test', async (req, res) => {
  try {
    const result = await sendPushToAll(req, {
      title: 'Absolute ADAS',
      body: 'Test notification — push is working 🎉',
      url: '/app/index.html',
      tag: 'aa-test',
    })
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export { router as pushRouter }
