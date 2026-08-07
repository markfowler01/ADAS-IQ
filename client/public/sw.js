// Service worker — Web Push only, NO fetch/caching handlers on purpose.
// This app has been bitten by stale-cache bugs before (SMS log showing
// old data); the SW exists solely so the installed PWA can receive push
// notifications and deep-link taps into the right conversation.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  const title = data.title || 'Absolute ADAS'
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/app/logo.png',
    badge: '/app/logo.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/app/index.html' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/app/index.html'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('navigate' in client && 'focus' in client) {
          return client.navigate(url).then((c) => (c || client).focus())
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
