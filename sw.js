// ══════════════════════════════════════════════
//  SERVICE WORKER – Lauf Tracker PWA
//  Cacht Leaflet + App-Shell + OSM-Kartenkacheln
// ══════════════════════════════════════════════

const CACHE_VERSION = 'v1';
const APP_CACHE    = 'lauftracker-app-' + CACHE_VERSION;
const TILE_CACHE   = 'lauftracker-tiles-' + CACHE_VERSION;

// App-Shell: alles was beim ersten Laden gecacht werden soll
const APP_SHELL = [
  './',
  './index.html',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
];

// ── INSTALL: App-Shell in Cache legen ──────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE).then(cache => {
      console.log('[SW] App-Shell wird gecacht…');
      // addAll bricht ab wenn eine Ressource fehlschlägt → einzeln cachen
      return Promise.allSettled(
        APP_SHELL.map(url => cache.add(url).catch(e => console.warn('[SW] Cache miss:', url, e)))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: Alte Caches aufräumen ────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== APP_CACHE && k !== TILE_CACHE)
          .map(k => { console.log('[SW] Alter Cache gelöscht:', k); return caches.delete(k); })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: Cache-Strategie je nach Request-Typ ─
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. OpenStreetMap Kartenkacheln → Cache-first, dann Netz
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(tileStrategy(event.request));
    return;
  }

  // 2. Leaflet CDN → Cache-first
  if (url.hostname === 'unpkg.com') {
    event.respondWith(cacheFirst(event.request, APP_CACHE));
    return;
  }

  // 3. App-Shell (eigene Dateien) → Network-first mit Cache-Fallback
  if (url.origin === self.location.origin || event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, APP_CACHE));
    return;
  }
});

// ── Strategie: Cache-first (Kacheln) ───────────
async function tileStrategy(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Kacheln sind immutable → einfach cachen
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline: weiße/leere Kachel zurückgeben (transparent 1×1 PNG)
    return new Response(
      Uint8Array.from(atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      ), c => c.charCodeAt(0)),
      { headers: { 'Content-Type': 'image/png' } }
    );
  }
}

// ── Strategie: Cache-first (Leaflet etc.) ──────
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    return new Response('Offline – Ressource nicht gecacht', { status: 503 });
  }
}

// ── Strategie: Network-first (App-Shell) ───────
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('Offline – App nicht gecacht. Bitte einmal mit Internet öffnen.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}
