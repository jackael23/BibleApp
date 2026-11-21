// Bibliya ng Iglesia: offline cache. Palitan ang VERSION kapag may binago para ma-update ang phones.
const VERSION = "bibliya-v15";
const CORE = ["./","index.html","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png","fonts/figtree-latin-400-normal.woff2","fonts/figtree-latin-500-normal.woff2","fonts/figtree-latin-600-normal.woff2","fonts/figtree-latin-700-normal.woff2","fonts/literata-latin-400-italic.woff2","fonts/literata-latin-400-normal.woff2","fonts/literata-latin-600-normal.woff2","fonts/gentium-book-plus-latin-400-normal.woff2","fonts/gentium-book-plus-latin-400-italic.woff2","fonts/gentium-book-plus-latin-700-normal.woff2"];
const DATA = ["data/adb.json","data/kjv.json","data/web.json","church.json","church/logo.png"]; // church.json at logo: opsyonal (hindi papalya ang install kapag wala)
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    await c.addAll(CORE);
    // Bible data: isa-isa para hindi pumalya lahat kapag mabagal ang net
    for (const u of DATA) { try { await c.add(u); } catch (err) {} }
  }).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).pathname.includes("/api/")) return; // AI at komentaryo: laging sa server, hindi naka-cache dito
  // 2026-11-21: pangalan at logo ng simbahan: network muna (para kita agad ang pinalitan ng admin), cache kapag offline
  const path = new URL(e.request.url).pathname;
  if (/\/church\.json$|\/church\//.test(path)) {
    e.respondWith(fetch(e.request, {cache: "no-cache"}).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(hit => hit || Response.error())));
    return;
  }
  e.respondWith(caches.match(e.request, {ignoreSearch: true}).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok && new URL(e.request.url).origin === location.origin) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  })));
});
