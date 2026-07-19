const CACHE_NAME = "watchlog-shell-v2";
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
      return cache.addAll(SHELL_FILES);
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
  // (AniList API, Google Fonts, ad network scripts) passes straight through
  // to the network so it behaves normally and simply fails offline, as expected.
  if(event.request.method !== "GET" || url.origin !== self.location.origin){
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(cached){
      if(cached) return cached;
      return fetch(event.request).then(function(response){
        if(response && response.ok){
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, copy); });
        }
        return response;
      }).catch(function(){
        // Offline and not cached — for navigations, fall back to the cached shell page.
        if(event.request.mode === "navigate"){
          return caches.match("./index.html");
        }
      });
    })
  );
});
