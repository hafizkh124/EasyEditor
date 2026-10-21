/**
 * The file "Share → Easy Editor" handed over (see public/share-target-sw.js),
 * taken once: reading it removes it, so a reload does not start it again.
 */
const SHARE_CACHE = "easyeditor-share-target";
const SHARED_KEY = "/shared-file";

export async function takeSharedFile(): Promise<File | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const res = await cache.match(SHARED_KEY);
    if (!res) return null;
    await cache.delete(SHARED_KEY);
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get("X-File-Name") ?? "shared");
    return new File([blob], name, { type: res.headers.get("Content-Type") ?? blob.type });
  } catch {
    return null;
  }
}
