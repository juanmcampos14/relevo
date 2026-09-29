// RELEVO · service worker mínimo para trabajar sin señal.
// - Navegación: siempre red primero (datos frescos). Sin red → página /offline, que permite
//   capturar y guarda todo en el teléfono (IndexedDB) hasta que vuelva la conexión.
// - /_next/static: archivos inmutables → caché primero (así /offline carga sin red).
// - Nunca se guarda en caché HTML con datos del workspace ni respuestas de la API.
const VERSION = "v1";
const STATIC = `relevo-static-${VERSION}`;
const SHELL = `relevo-shell-${VERSION}`;
const OFFLINE_URL = "/offline";
const NAV_TIMEOUT_MS = 8000;
const REFRESH_EVERY_MS = 60 * 60 * 1000;
let lastShellRefresh = 0;

// Descarga /offline y los JS/CSS que usa, para que esté completo sin red.
async function refreshShell() {
  lastShellRefresh = Date.now();
  const res = await fetch(OFFLINE_URL, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) return;
  const html = await res.clone().text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]))];
  const staticCache = await caches.open(STATIC);
  await Promise.all(
    assets.map(async (url) => {
      if (await staticCache.match(url)) return;
      const r = await fetch(url);
      if (r.ok) await staticCache.put(url, r);
    }),
  );
  await (await caches.open(SHELL)).put(OFFLINE_URL, res);
}

self.addEventListener("install", (event) => {
  event.waitUntil(refreshShell().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("relevo-") && ![STATIC, SHELL].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      withTimeout(fetch(req), NAV_TIMEOUT_MS)
        .then((res) => {
          if (Date.now() - lastShellRefresh > REFRESH_EVERY_MS) event.waitUntil(refreshShell().catch(() => {}));
          return res;
        })
        .catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
  }
});
