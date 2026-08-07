// Web Push client helpers — pairs with /api/push on the backend and
// public/sw.js. On iPhone this only works when the app is installed to
// the Home Screen (iOS 16.4+); in plain Safari `PushManager` is absent
// and pushSupported() returns false.

import { API_BASE, apiFetch } from './api.js'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// 'unsupported' | 'denied' | 'off' | 'on'
export async function getPushState() {
  if (!pushSupported()) return 'unsupported'
  try {
    const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (sub) return 'on'
  } catch { /* fall through */ }
  return Notification.permission === 'denied' ? 'denied' : 'off'
}

export async function enablePush() {
  if (!pushSupported()) {
    throw new Error('On iPhone: add this app to your Home Screen first (Share → Add to Home Screen), then try again from the installed app.')
  }
  const reg = await navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') {
    throw new Error('Notifications are blocked — allow them for this app in Settings and try again.')
  }
  const kr = await apiFetch(`${API_BASE}/api/push/public-key`)
  const kj = await kr.json()
  if (!kr.ok || !kj.key) throw new Error(kj.error || 'Could not fetch push key')
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(kj.key),
  })
  const sr = await apiFetch(`${API_BASE}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  })
  const sj = await sr.json()
  if (!sr.ok) throw new Error(sj.error || 'Could not save subscription')
  return sub
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (sub) {
    const endpoint = sub.endpoint
    await sub.unsubscribe()
    try {
      await apiFetch(`${API_BASE}/api/push/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      })
    } catch { /* server-side prune will catch it */ }
  }
}
