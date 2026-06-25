const CACHE = 'cricket-v3';
const SHELL = [
  '/',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&display=swap',
  '/static/css/index.css',
  '/static/js/index.js',
  '/static/css/score.css',
  '/static/js/score.js',
  '/static/css/profile.css',
  '/static/js/profile.js',
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(SHELL); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);
  // Always network-first for API calls
  if(url.pathname.startsWith('/api/')){ return; }
  // Cache-first for shell / static assets
  e.respondWith(
    caches.match(e.request).then(function(cached){
      return cached || fetch(e.request).then(function(res){
        if(res && res.status === 200 && res.type !== 'opaque'){
          var clone = res.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, clone); });
        }
        return res;
      });
    })
  );
});
