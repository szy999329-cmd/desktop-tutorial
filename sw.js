/* 面包工厂 Service Worker —— 离线缓存（安全加固版） */
const CACHE = "breadfactory-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/favicon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 只缓存“同源、状态正常、非不透明”的响应，杜绝缓存投毒
function cacheable(res) {
  return res && res.ok && res.type === "basic";
}
function putCache(req, res) {
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return; // 只处理同源请求

  const isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  if (isHTML) {
    // HTML：网络优先，保证更新能及时生效；断网回退缓存
    e.respondWith(
      fetch(req).then((res) => { if (cacheable(res)) putCache(req, res); return res; })
        .catch(() => caches.match(req).then((c) => c || caches.match("./index.html")))
    );
    return;
  }
  // 其它同源静态资源：缓存优先
  e.respondWith(
    caches.match(req).then((cached) =>
      cached || fetch(req).then((res) => { if (cacheable(res)) putCache(req, res); return res; }).catch(() => cached)
    )
  );
});
