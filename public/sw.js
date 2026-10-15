// Service worker: اپلیکیشن و لیست فروشگاه‌ها بدون اینترنت هم باز می‌شوند.
// با هر تغییر در فایل‌های اپلیکیشن، VERSION را یکی بالا ببرید.
const VERSION = "v2";
const APP_CACHE = `app-${VERSION}`;
const DATA_CACHE = "data";
const TILE_CACHE = "tiles";
const MAX_TILES = 1500;

const APP_FILES = [
  "./",
  "index.html",
  "app.js",
  "style.css",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "vendor/leaflet.js",
  "vendor/leaflet.css",
  "vendor/leaflet.markercluster.js",
  "vendor/MarkerCluster.css",
  "vendor/MarkerCluster.Default.css",
  "vendor/vazirmatn.css",
  "vendor/fonts/Vazirmatn-Regular.woff2",
  "vendor/fonts/Vazirmatn-Medium.woff2",
  "vendor/fonts/Vazirmatn-Bold.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("app-") && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(k);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // لیست فروشگاه‌ها: اول از اینترنت (تا همیشه به‌روز باشد)، اگر نشد از حافظه
  if (url.pathname.endsWith("/data/stores.json")) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { cacheName: DATA_CACHE }))
    );
    return;
  }

  // کاشی‌های نقشه: اول از حافظه، وگرنه از اینترنت و ذخیره
  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    e.respondWith(
      caches.match(req, { cacheName: TILE_CACHE }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok || res.type === "opaque") {
              const copy = res.clone();
              caches.open(TILE_CACHE).then((c) => c.put(req, copy).then(trimTiles));
            }
            return res;
          })
      )
    );
    return;
  }

  // فایل‌های خود اپلیکیشن: اول از حافظه
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
  }
});
