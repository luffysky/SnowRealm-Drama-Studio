/**
 * Service worker for SnowRealm Drama Studio.
 *
 * Scope is deliberately narrow. This is a private tool whose every page is
 * behind a session, so the one thing the cache must never hold is a response
 * that depends on who is signed in:
 *
 *   - navigations (HTML)  — network only, with an offline page as fallback
 *   - /api/*              — never touched
 *   - /_next/static/*     — cache-first; content-hashed, so it cannot go stale
 *   - /icons/*, manifest  — cache-first
 *
 * That is also what makes the app installable: Chrome requires a fetch
 * handler before it will offer "install".
 *
 * Bump CACHE_VERSION to retire every previously cached asset.
 */

const CACHE_VERSION = 'v1'
const CACHE_NAME = `srds-static-${CACHE_VERSION}`
const OFFLINE_URL = '/offline'

/** Paths whose responses are identical for every user and safe to keep. */
function isCacheableAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/icon.png' ||
    url.pathname === '/apple-icon.png'
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      // `reload` bypasses the HTTP cache so a redeploy cannot precache a stale
      // copy of the offline page.
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('message', (event) => {
  // Sent on sign-out: belt and braces, even though nothing user-specific is
  // ever cached.
  if (event.data === 'srds:clear-cache') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))))
  }
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Navigations: always go to the network. A cached page would show one
  // member's work to the other, or survive a sign-out.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch {
          const cached = await caches.match(OFFLINE_URL)
          return (
            cached ??
            new Response('離線中', {
              status: 503,
              headers: { 'content-type': 'text/plain; charset=utf-8' },
            })
          )
        }
      })()
    )
    return
  }

  if (!isCacheableAsset(url)) return

  event.respondWith(
    (async () => {
      const cached = await caches.match(request)
      if (cached) return cached

      const response = await fetch(request)
      // Opaque and error responses are not worth keeping.
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME)
        cache.put(request, response.clone())
      }
      return response
    })()
  )
})

/**
 * Clicking a notification has to do something (Z193).
 *
 * `src/lib/notifications.ts` shows these through `registration.showNotification()`
 * — the only path that works on Android, where the `Notification` constructor
 * throws. But a notification shown by a worker is dismissed by the worker, and
 * without this handler clicking one just closed it: no focus, no navigation.
 * The two things that notify are an incoming message and an incoming *call*,
 * and a call you cannot answer by tapping its notification is the whole point
 * of the notification gone.
 *
 * Focus an existing window rather than opening a second one — the chat and the
 * call both live in a widget that is already mounted in the open tab, and a
 * fresh tab would leave the ringing one behind.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const target = event.notification.data?.url || '/dashboard'

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        // Without this, a client controlled by a previous worker generation is
        // invisible here and we open a duplicate tab next to the live one.
        includeUncontrolled: true,
      })

      for (const client of windows) {
        // Same origin only; `matchAll` is already scoped, but `focus()` on a
        // cross-origin client throws rather than returning null.
        if (new URL(client.url).origin !== self.location.origin) continue
        await client.focus()
        // Already somewhere in the app: leave the person where they were.
        // Navigating would discard an open dialog or an unsaved draft.
        return
      }

      await self.clients.openWindow(target)
    })()
  )
})
