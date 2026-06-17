const STATIC_CACHE = 'imove-static-v1'
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/imove-logo-transparent.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => undefined)
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Do not cache app pages or API-like paths; trips and alerts can contain private user data.
  if (request.mode === 'navigate') return
  if (/^\/(trips|alerts|chat|users|places|transit|health)\b/.test(url.pathname)) return

  event.respondWith(
    caches.match(request)
      .then((cached) => cached || fetch(request))
  )
})
