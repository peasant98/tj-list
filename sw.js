// TJ's Run service worker — cache-first app shell, runtime-cache fonts.
var CACHE = 'tjrun-v1';
var CORE = ['.', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icon.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
      return caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

// stale-while-revalidate: serve cache instantly, refresh it in the background
// so the family actually receives app updates on the next launch.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = e.request.url;
  var cacheable = url.indexOf(self.location.origin) === 0 ||
                  url.indexOf('fonts.googleapis.com') >= 0 ||
                  url.indexOf('fonts.gstatic.com') >= 0;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
      var refresh = fetch(e.request).then(function (resp) {
        if (resp.ok && cacheable) {
          var clone = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, clone); });
        }
        return resp;
      }).catch(function () { return hit; });
      return hit || refresh;
    })
  );
});
