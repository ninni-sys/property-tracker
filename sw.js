// Service worker
const CACHE_NAME = 'property-tracker-v2';
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/tax.js',
  '/js/db.js',
  '/js/auth.js',
  '/js/sheets.js',
  '/js/drive.js',
  '/js/gmail.js',
  '/js/sync.js',
  '/js/app.js',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE.filter(url => !url.includes('icon'))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Only handle same-origin GET requests
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (e.request.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});

// Messages from app
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// Background Sync — wake app clients to flush their IndexedDB queue
self.addEventListener('sync', (e) => {
  if (e.tag === 'sheets-sync') {
    e.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: false }).then(clients => {
        clients.forEach(c => c.postMessage('process-queue'));
      })
    );
  }
});
