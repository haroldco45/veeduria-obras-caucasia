// Primero la red (para que siempre salga lo último); si no hay internet, lo guardado.
const CACHE = "veeduria-caucasia-v2";
const BASE = ["./", "index.html", "manifest.json", "icon-192.png", "data/obras.json", "data/noticias.json", "data/secop.json",
  "img/docs/contrato.jpg", "img/docs/presupuesto.jpg", "img/docs/cdp.jpg", "img/docs/aviso.jpg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
