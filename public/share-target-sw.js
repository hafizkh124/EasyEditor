// Share target (SYSTEM-2026 §2): "Share → Easy Editor" on Android sends the
// file here as a POST. It is parked in the Cache API and the app opens the
// Extract screen, which picks it up and starts at once — a WhatsApp voice note
// or a photo of a page becomes text in one step.
//
// Loaded into the generated service worker with workbox `importScripts`, so
// this listener runs before workbox's own router; it only answers POSTs to
// /share-target and leaves every other request to workbox.
const SHARE_CACHE = "easyeditor-share-target";

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/share-target") return;

  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const file = form.getAll("file").find((f) => f && typeof f === "object" && "size" in f);
        if (file) {
          const cache = await caches.open(SHARE_CACHE);
          await cache.put(
            "/shared-file",
            new Response(file, {
              headers: {
                "Content-Type": file.type || "application/octet-stream",
                "X-File-Name": encodeURIComponent(file.name || "shared"),
              },
            }),
          );
          return Response.redirect("/extract?shared=1", 303);
        }
      } catch (_err) {
        // Fall through: open the screen empty rather than show an error page.
      }
      return Response.redirect("/extract", 303);
    })(),
  );
});
