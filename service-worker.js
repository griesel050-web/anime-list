const CACHE_NAME = "watchlog-shell-v3";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./stats.html",
  "./schedule.html",
  "./discover.html",
  "./settings.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/favicon-48.png",
  "./icons/watchlog-logo-header.png"
];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      // cache.addAll() is all-or-nothing — if even one file 404s or hiccups,
      // the whole install rejects and NOTHING gets cached, including every
      // page. Cache each file independently so one bad entry can't take the
      // rest down with it.
      return Promise.all(
        SHELL_FILES.map(function(url){
          return cache.add(url).catch(function(){ /* skip just this one file */ });
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(
        names.filter(function(name){ return name !== CACHE_NAME; })
          .map(function(name){ return caches.delete(name); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function(event){
  var url = new URL(event.request.url);

  // Only handle same-origin GET requests for the app shell — everything else
  // (AniList API, Google Fonts, etc.) passes straight through to the network
  // so it behaves normally and simply fails offline, as expected.
  if(event.request.method !== "GET" || url.origin !== self.location.origin){
    return;
  }

  // Page navigations: network-first, so you always get the live page instead
  // of a stale cached one when you're online — cache only kicks in if the
  // network truly fails (offline). Every branch below returns a real
  // Response; resolving with `undefined` here is what causes ERR_FAILED
  // instead of a normal page load.
  if(event.request.mode === "navigate"){
    event.respondWith(
      fetch(event.request)
        .then(function(response){
          if(response && response.ok){
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, copy); });
          }
          return response;
        })
        .catch(function(){
          return caches.match(event.request).then(function(cached){
            return cached || caches.match("./index.html");
          }).then(function(fallback){
            return fallback || Response.error();
          });
        })
    );
    return;
  }

  // Everything else (CSS/JS/images): cache-first, falling back to network.
  event.respondWith(
    caches.match(event.request).then(function(cached){
      if(cached) return cached;
      return fetch(event.request).then(function(response){
        if(response && response.ok){
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, copy); });
        }
        return response;
      }).catch(function(){ return Response.error(); });
    })
  );
});
