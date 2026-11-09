const VER = '20261109221324';
const CACHE = 'rb-' + VER;

const PRECACHE = [
  './',
  './index.html',
  './catalog.html',
  './week/',
  './week/shopping.html',
  './week/print.html',
  './sync.js',
  './manifest.json',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.allSettled(PRECACHE.map(u => c.add(u))))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 页面导航：网络优先。拿到最新 HTML 就顺手更新缓存；
  // 断网时回退缓存，保证离线仍能用。这是「无感刷新」的第一层。
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true })
            .then(hit => hit || caches.match('./index.html') || caches.match('./catalog.html'))
        )
    );
    return;
  }

  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html')))
  );
});
