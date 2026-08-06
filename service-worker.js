const CACHE_NAME = 'bullshit-v1';
const SHELL_FILES = [
  '/index.html',
  '/share-target.html',
  '/css/style.css',
  '/js/app.js',
  '/js/heuristics.js',
  '/js/llm-mesh.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Network-first for everything (analysis calls go straight to provider
// APIs and are never intercepted here); falls back to cache offline.
self.addEventListener('fetch', (event) => {
  if(event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
