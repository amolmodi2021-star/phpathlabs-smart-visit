/**
 * Session PDF cache shared across LIMS tabs/popups (same origin) via IndexedDB,
 * with an in-memory Map for instant same-window hits.
 */

export type CachedReportPdf = {
  blob: Blob;
  filename: string;
  builtAt: number;
};

const memory = new Map<string, CachedReportPdf>();
const MAX_ENTRIES = 24;
const TTL_MS = 45 * 60_000;
const DB_NAME = "phpl-report-pdf-cache";
const STORE = "pdfs";

export function reportPdfCacheKey(registrationId: string, testIds: string[] | string | null | undefined): string {
  const ids = Array.isArray(testIds)
    ? testIds
    : String(testIds || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  // v3: full A4 @ PR2 / JPEG 0.9 (no downscaled queue capture).
  return `v3|${String(registrationId || "").trim()}|${[...ids].sort().join(",")}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexedDB open failed"));
  });
}

function pruneMemory() {
  while (memory.size > MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest == null) break;
    memory.delete(oldest);
  }
}

export async function getCachedReportPdf(key: string): Promise<CachedReportPdf | null> {
  if (!key) return null;
  const mem = memory.get(key);
  if (mem) {
    if (Date.now() - mem.builtAt > TTL_MS) {
      memory.delete(key);
    } else {
      return mem;
    }
  }
  try {
    const db = await openDb();
    const row = await new Promise<CachedReportPdf | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as CachedReportPdf | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!row?.blob || Date.now() - Number(row.builtAt || 0) > TTL_MS) return null;
    const hit: CachedReportPdf = {
      blob: row.blob,
      filename: String(row.filename || "report.pdf"),
      builtAt: Number(row.builtAt) || Date.now(),
    };
    memory.set(key, hit);
    pruneMemory();
    return hit;
  } catch {
    return null;
  }
}

export async function setCachedReportPdf(key: string, blob: Blob, filename: string): Promise<void> {
  if (!key || !blob) return;
  const entry: CachedReportPdf = { blob, filename, builtAt: Date.now() };
  memory.set(key, entry);
  pruneMemory();
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // memory hit still works in this window
  }
}

export function clearCachedReportPdf(key: string): void {
  if (!key) return;
  memory.delete(key);
  void openDb()
    .then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    )
    .catch(() => {});
}
