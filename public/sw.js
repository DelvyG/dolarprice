/* ═══ DolarPrice · service worker ═══
   El anterior tenia un handler de fetch vacio, asi que la app no funcionaba sin
   conexion ni arrancaba rapido. Aqui: la cascara se sirve desde cache y se
   revalida en segundo plano; la API va a la red primero y cae al cache si no
   hay senal, de modo que siempre se ve algo -- aunque sea viejo, y la interfaz
   avisa cuando lo es. */

const VERSION = 'v2.3.1'
const CACHE_SHELL = `dp-shell-${VERSION}`
const CACHE_DATOS = `dp-datos-${VERSION}`

const SHELL = [
  '/',
  '/index.html',
  '/styles.css?v=9',
  '/app.js?v=10',
  '/manifest.webmanifest',
  '/icons/icon-96.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/favicon-32.png',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_SHELL)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((k) => k !== CACHE_SHELL && k !== CACHE_DATOS).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

// Red primero, con tope de tiempo y respaldo en cache.
async function redPrimero(req, cacheName, msTope) {
  const cache = await caches.open(cacheName)
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), msTope)
    const res = await fetch(req, { signal: ctrl.signal })
    clearTimeout(t)
    if (res && res.ok) cache.put(req, res.clone())
    return res
  } catch {
    const guardado = await cache.match(req)
    if (guardado) return guardado
    throw new Error('sin red y sin cache')
  }
}

// Cache primero, revalidando por detras: es lo que hace que abra al instante.
async function cacheYRevalida(req, cacheName) {
  const cache = await caches.open(cacheName)
  const guardado = await cache.match(req, { ignoreSearch: false })
  const enRed = fetch(req)
    .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res })
    .catch(() => null)
  return guardado || enRed || fetch(req)
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // La API: siempre intenta datos frescos, pero nunca deja la pantalla vacia.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      redPrimero(req, CACHE_DATOS, 6000).catch(
        () => new Response(JSON.stringify({ error: 'sin conexion' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )
    return
  }

  // Navegacion: si no hay red, se entrega la cascara guardada.
  if (req.mode === 'navigate') {
    e.respondWith(
      redPrimero(req, CACHE_SHELL, 4000).catch(async () => {
        const cache = await caches.open(CACHE_SHELL)
        return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error()
      })
    )
    return
  }

  e.respondWith(cacheYRevalida(req, CACHE_SHELL))
})
