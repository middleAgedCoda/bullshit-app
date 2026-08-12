const CACHE_NAME = 'bullshit-v19';
const SHELL_FILES = [
  '/bullshit-app/index.html',
  '/bullshit-app/share-target.html',
  '/bullshit-app/css/style.css',
  '/bullshit-app/js/app.js',
  '/bullshit-app/js/heuristics.js',
  '/bullshit-app/js/llm-mesh.js',
  '/bullshit-app/js/taxonomy.js',
  '/bullshit-app/js/history.js',
  '/bullshit-app/manifest.json'
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
