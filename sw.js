// Service worker: offline, notifikationer og tryk på notifikationer.
// Hæv versionen når filerne ændres, så telefonen henter den nye udgave.
const CACHE = "ms-kompasset-v3";
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "config.js",
  "manifest.json",
  "js/app.js",
  "js/store.js",
  "js/logic.js",
  "js/push.js",
  "supabase/functions/_shared/calendar.js",
  "supabase/functions/_shared/catalog.js",
  "branding/logo.png",
  "branding/icon-180.png",
  "branding/icon-192.png",
  "branding/icon-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Netværk først (så opdateringer – fx et nyt logo – slår igennem), cache som reserve offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.hostname.endsWith(".supabase.co")) return;
  const sameOrigin = url.origin === self.location.origin;
  e.respondWith(
    fetch(sameOrigin ? new Request(e.request, { cache: "no-cache" }) : e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: sameOrigin && url.pathname.endsWith("/") }))
  );
});

// ---------- Notifikationer ----------

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: "MS Kompasset", body: e.data ? e.data.text() : "" };
  }
  e.waitUntil((async () => {
    await self.registration.showNotification(data.title || "MS Kompasset", {
      body: data.body || "",
      tag: data.tag,
      renotify: true,
      icon: "branding/icon-192.png",
      badge: "branding/icon-192.png",
      data,
    });
    // Er appen åben, får den besked, så den kan spille en lyd og vise spørgsmålet.
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) c.postMessage({ type: "push", data });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const target = new URL(data.url || "./", self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if ("focus" in c) {
        await c.focus();
        c.postMessage({ type: "open", data });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
