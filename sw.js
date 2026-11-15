
const CACHE = 'hemocare-v1-4-4-cloud-auto';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('hemocare-') && key !== CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin
  ) return;

  // API-запросы не сохраняем в кеш.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();

          event.waitUntil(
            caches.open(CACHE).then(cache =>
              cache.put(request, copy)
            )
          );
        }

        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (request.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }

        return Response.error();
      })
  );
});

self.addEventListener('push', event => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      body: event.data?.text() || ''
    };
  }

  const title = data.title || 'HemoCare ❤️';

  const options = {
    body: data.body ||
      'У вас запланировано напоминание. Откройте HemoCare.',
    icon: './icon.svg',
    badge: './icon.svg',
    tag: data.tag || 'hemocare-reminder',
    data: {
      url: './index.html'
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const target = new URL(
    event.notification.data?.url || './index.html',
    self.registration.scope
  ).href;

  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      });

      for (const windowClient of windows) {
        if (windowClient.url.startsWith(self.location.origin)) {
          await windowClient.navigate(target);
          return windowClient.focus();
        }
      }

      return clients.openWindow(target);
    })()
  );
});
