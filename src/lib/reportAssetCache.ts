/**
 * Browser cache for rarely changing report assets (letterhead + signatures).
 * Cuts Supabase Storage egress: first open downloads once; later opens reuse IndexedDB.
 * Cache key = bucket + storage path (new uploads use new paths → automatic miss).
 */
const DB_NAME = "phpl-report-assets-v1";
const STORE = "assets";
const DB_VERSION = 1;

export type ReportAssetBucket = "letterheads" | "signatures";

type CacheRow = {
  key: string;
  dataUrl: string;
  savedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB_unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexedDB_open_failed"));
  });
}

export function reportAssetCacheKey(bucket: ReportAssetBucket | string, path: string, variant = ""): string {
  const p = String(path || "").replace(/^\/+/, "");
  return variant ? `${bucket}:${p}:${variant}` : `${bucket}:${p}`;
}

export async function getCachedDataUrl(key: string): Promise<string | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const row = req.result as CacheRow | undefined;
        resolve(row?.dataUrl || null);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function setCachedDataUrl(key: string, dataUrl: string): Promise<void> {
  if (!key || !dataUrl) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ key, dataUrl, savedAt: Date.now() } satisfies CacheRow);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Cache write failures are non-fatal
  }
}

export async function invalidateCachedAsset(
  bucket: ReportAssetBucket | string,
  path: string,
): Promise<void> {
  const prefix = `${bucket}:${String(path || "").replace(/^\/+/, "")}`;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const key = String((cursor.value as CacheRow)?.key || cursor.key || "");
        if (key === prefix || key.startsWith(prefix + ":")) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function invalidateBucket(bucket: ReportAssetBucket | string): Promise<void> {
  const prefix = `${bucket}:`;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const key = String((cursor.value as CacheRow)?.key || cursor.key || "");
        if (key.startsWith(prefix)) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

/** Sniff JPEG/PNG/GIF/WEBP magic when Storage serves application/octet-stream. */
function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  // RIFF....WEBP
  if (
    bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Rewrite `data:application/octet-stream;base64,…` (and other non-image MIME)
 * to a real image MIME so <img> + html-to-image PDF capture do not hang.
 */
export function normalizeImageDataUrl(dataUrl: string | null | undefined): string | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  if (!dataUrl.startsWith("data:")) return dataUrl;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return dataUrl;
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml)/i.test(meta)) return dataUrl;
  if (!/;base64/i.test(meta) || !payload) return dataUrl;
  try {
    const headB64 = payload.slice(0, 64);
    const bin = atob(headB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const mime = sniffImageMime(bytes);
    if (!mime) return dataUrl;
    return `data:${mime};base64,${payload}`;
  } catch {
    return dataUrl;
  }
}

async function ensureImageTypedBlob(blob: Blob): Promise<Blob> {
  if (blob.type && /^image\//i.test(blob.type)) return blob;
  try {
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const mime = sniffImageMime(head);
    if (mime && mime !== blob.type) return new Blob([blob], { type: mime });
  } catch {
    // keep original
  }
  return blob;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const typed = await ensureImageTypedBlob(blob);
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(normalizeImageDataUrl(String(r.result || "")) || String(r.result || ""));
    r.onerror = () => reject(r.error || new Error("read_failed"));
    r.readAsDataURL(typed);
  });
}

/**
 * Fetch a remote URL as a data URL, using IndexedDB when `cacheKey` is provided.
 * Uses normal HTTP cache (no `no-cache`) so CDN/browser can help too.
 */
export async function getOrFetchUrlAsDataUrl(
  url: string,
  cacheKey?: string | null,
): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return normalizeImageDataUrl(url) || url;
  if (cacheKey) {
    const hit = await getCachedDataUrl(cacheKey);
    if (hit) {
      const fixed = normalizeImageDataUrl(hit) || hit;
      // Rewrite stale IndexedDB rows that were cached as octet-stream
      if (fixed !== hit) void setCachedDataUrl(cacheKey, fixed);
      return fixed;
    }
  }
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    const dataUrl = await blobToDataUrl(blob);
    if (cacheKey && dataUrl) void setCachedDataUrl(cacheKey, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

/**
 * Letterhead: cache the rendered PNG (not the PDF) so we skip pdf.js on every report open.
 */
export async function getCachedLetterheadPng(
  path: string,
  publicUrl: string,
  renderPdfToPng: (pdfUrl: string) => Promise<string | null>,
): Promise<string | null> {
  const key = reportAssetCacheKey("letterheads", path, "png");
  const hit = await getCachedDataUrl(key);
  if (hit) return hit;
  const png = await renderPdfToPng(publicUrl);
  if (png) void setCachedDataUrl(key, png);
  return png;
}

/** Signature image → data URL with IndexedDB cache. */
export async function getCachedSignatureDataUrl(
  path: string,
  publicUrl: string,
): Promise<string | null> {
  const key = reportAssetCacheKey("signatures", path);
  return getOrFetchUrlAsDataUrl(publicUrl, key);
}