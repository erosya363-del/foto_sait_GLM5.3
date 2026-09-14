/*
 * Минимальный Service Worker — ТОЛЬКО offline-fallback (F-002).
 *
 * Принципы (намеренно консервативно, чтобы не повторить «вечный старый фронт»):
 *  — НИЧЕГО не отдаём из кэша при наличии сети (network-first везде);
 *  — кэшируется ровно один документ: "/" (оболочка приложения);
 *  — fallback срабатывает только для навигаций (document) и только если сеть
 *    недоступна — офлайн пользователь видит оболочку приложения, а не белый экран;
 *  — API/статика/фото никогда не перехватываются — стратегия кэширования
 *    приложения не меняется вовсе.
 */
const SHELL_CACHE = "skovo-shell-v1";
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(SHELL_URL))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => {})
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate") return; // перехватываем только переходы по документу
  event.respondWith(
    fetch(req).catch(() =>
      caches
        .match(SHELL_URL, { ignoreSearch: true })
        .then((cached) => cached || Response.error())
    )
  );
});
