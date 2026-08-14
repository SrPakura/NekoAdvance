// NekoAdvance Rolling-Release Service Worker
// Automatically checks for updates, auto-activates in the background, and serves freshest content.
const CACHE_NAME = 'nekoadvance-rolling-v52';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './css/console.css',
  './css/modal.css',
  './css/hud.css',
  './js/app.js',
  './js/core/renderer/webgl-renderer.js',
  './js/core/audio/audio-driver.js',
  './js/core/mgba/mgba-bridge.js',
  './js/core/mgba/mgba.js',
  './js/core/mgba/mgba.wasm',
  './js/core/gbajs/util.js',
  './js/core/gbajs/arm.js',
  './js/core/gbajs/thumb.js',
  './js/core/gbajs/core.js',
  './js/core/gbajs/video/software.js',
  './js/core/gbajs/video.js',
  './js/core/gbajs/mmu.js',
  './js/core/gbajs/savedata.js',
  './js/core/gbajs/gpio.js',
  './js/core/gbajs/io.js',
  './js/core/gbajs/audio.js',
  './js/core/gbajs/irq.js',
  './js/core/gbajs/keypad.js',
  './js/core/gbajs/sio.js',
  './js/core/gbajs/gba.js',
  './js/core/storage.js',
  './js/core/cheat-engine.js',
  './js/core/gba-engine.js',
  './js/input/input-manager.js',
  './js/input/keybindings.js',
  './js/ui/console-view.js',
  './js/ui/menu-modal.js',
  './js/ui/hud.js',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './icon_neko.svg',
  './UI/Neko.svg'
];

// Install: Pre-cache assets and immediately activate (skipWaiting)
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('[SW] Pre-caching warning:', err);
      });
    })
  );
});

// Activate: Delete old caches and immediately claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => {
          console.log('[SW] Purging old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Message listener for manual skip-waiting trigger
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch Strategy:
// Network-First for HTML/Scripts/CSS so updates are instant and cached in background,
// Stale-While-Revalidate for images and media.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isHtml = event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html');
  const isCode = url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.json') || url.pathname.endsWith('.wasm');

  if (isHtml || isCode) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            if (isHtml) return caches.match('./index.html');
          });
        })
    );
    return;
  }

  // Stale-While-Revalidate for images, fonts, and other assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {});

      return cachedResponse || fetchPromise;
    })
  );
});
