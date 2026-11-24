const CACHE_NAME = 'mi-billetera-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache){ return cache.addAll(CORE_ASSETS); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event){
  var req = event.request;
  var url = new URL(req.url);

  // Navegación: intenta red primero (para traer cambios), si no hay conexión usa el shell cacheado
  if(req.mode === 'navigate'){
    event.respondWith(
      fetch(req).then(function(res){
        caches.open(CACHE_NAME).then(function(cache){ cache.put('./index.html', res.clone()); });
        return res;
      }).catch(function(){ return caches.match('./index.html'); })
    );
    return;
  }

  // Mismo origen (app, estilos, iconos, manifest): cache primero, red como respaldo
  if(url.origin === self.location.origin){
    event.respondWith(
      caches.match(req).then(function(cached){
        if(cached) return cached;
        return fetch(req).then(function(res){
          caches.open(CACHE_NAME).then(function(cache){ cache.put(req, res.clone()); });
          return res;
        });
      })
    );
    return;
  }

  // Otro origen (Google Fonts): red primero, cache como respaldo si no hay conexión
  event.respondWith(
    fetch(req).then(function(res){
      caches.open(CACHE_NAME).then(function(cache){ cache.put(req, res.clone()); });
      return res;
    }).catch(function(){ return caches.match(req); })
  );
});
