// Service worker sederhana agar aplikasi bisa "Add to Home Screen" dan tetap
// dapat dibuka saat offline. Strategi: network-first untuk file aplikasi
// (selalu ambil versi terbaru saat online), dengan cache sebagai cadangan.
const CACHE = "kk-cache-v16";
const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/config.js",
  "./js/supabase.js",
  "./js/utils.js",
  "./js/data.js",
  "./js/auth.js",
  "./js/summary.js",
  "./js/advice.js",
  "./js/price.js",
  "./js/ai.js",
  "./js/app.js",
  "./js/install.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Biarkan permintaan lintas-origin (Supabase API & CDN) langsung ke jaringan.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) =>
          hit || (req.mode === "navigate" ? caches.match("./index.html") : Promise.reject("offline"))
        )
      )
  );
});
